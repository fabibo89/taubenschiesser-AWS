#!/usr/bin/env python3
"""
Hardware Monitor Service
Monitors Taubenschiesser hardware devices and controls them via MQTT
"""

import asyncio
import aiohttp
import json
import logging
import os
import time
import socket
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np
from threading import Lock
import paho.mqtt.client as mqtt
import threading
import base64
import sys

# Import shared angle logic from cv-service (single source of truth)
_cv_service_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cv-service')
if _cv_service_dir not in sys.path:
    sys.path.insert(0, _cv_service_dir)
from angle_helper import (
    calculate_angle_adjustment as shared_calculate_angle_adjustment,
    enrich_detections_esp_angles as shared_enrich_detections_esp_angles,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class HardwareMonitor:
    def __init__(self):
        self.api_url = os.getenv('API_URL', 'http://localhost:5001')
        self.cv_service_url = os.getenv('CV_SERVICE_URL', 'http://localhost:8000')
        self.service_token = os.getenv('SERVICE_TOKEN', 'hardware-monitor-service-token')
        
        # MQTT management
        self.mqtt_clients = {}  # MQTT clients per user
        self.user_mqtt_settings = {}  # Cache user MQTT settings
        
        # Device state tracking
        self.device_positions = {}  # Track device positions
        self.device_moving = {}     # Track if device is moving
        self.device_last_seen = {}  # Track last MQTT message (any status = device online)
        self.device_last_moved = {}  # When we last completed a move (for 20s inactivity before next move)
        self.movement_queue = {}    # Queue movements per device
        self.device_movement_start = {}  # Track when movement started
        self.last_position_update = {}  # Track last position update time for throttling
        
        # Thread safety
        self.camera_lock = Lock()
        
        # MQTT listener for receiving messages
        self.mqtt_listener = None
        self.loop = None
        
    async def load_user_mqtt_settings(self, user_id):
        """Load MQTT settings for a specific user"""
        try:
            headers = {'Authorization': f'Bearer {self.service_token}'}
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.api_url}/api/users/{user_id}/settings", headers=headers) as response:
                    if response.status == 200:
                        user_data = await response.json()
                        mqtt_settings = user_data.get('settings', {}).get('mqtt', {})
                        
                        if mqtt_settings.get('enabled', False):
                            self.user_mqtt_settings[user_id] = {
                                'broker': mqtt_settings.get('broker', 'localhost'),
                                'port': mqtt_settings.get('port', 1883),
                                'username': mqtt_settings.get('username', ''),
                                'password': mqtt_settings.get('password', '')
                            }
                            logger.info(f"Loaded MQTT settings for user {user_id}: {mqtt_settings.get('broker')}:{mqtt_settings.get('port')}")
                        else:
                            logger.info(f"User {user_id} has MQTT disabled, using default settings")
                    else:
                        logger.warning(f"Failed to load settings for user {user_id}: {response.status}")
        except Exception as e:
            logger.error(f"Error loading MQTT settings for user {user_id}: {e}")
    
    async def get_mqtt_client_for_user(self, user_id):
        """Get or create MQTT client for specific user"""
        if user_id in self.mqtt_clients:
            return self.mqtt_clients[user_id]
        
        # Get settings for user
        if user_id in self.user_mqtt_settings:
            settings = self.user_mqtt_settings[user_id]
            broker = settings['broker']
            port = settings['port']
            username = settings['username']
            password = settings['password']
        else:
            # No user settings available, skip MQTT for this user
            logger.warning(f"No MQTT settings found for user {user_id}, skipping MQTT commands")
            return None
        
        # Create new MQTT client for this user
        try:
            client = mqtt.Client()
            client.username_pw_set(username, password)
            client.on_connect = self.on_mqtt_connect
            client.on_message = self.on_mqtt_message
            client.on_disconnect = self.on_mqtt_disconnect
            
            # Connect to MQTT broker
            client.connect(broker, port, 60)
            client.loop_start()
            
            # Store client for this user
            self.mqtt_clients[user_id] = client
            
            logger.info(f"Created MQTT client for user {user_id}: {broker}:{port}")
            return client
            
        except Exception as e:
            logger.error(f"Failed to create MQTT client for user {user_id}: {e}")
            return None
        
    async def start(self):
        """Start the hardware monitoring service"""
        logger.info("Starting Hardware Monitor Service")
        self.loop = asyncio.get_running_loop()
        
        # Start monitoring tasks
        tasks = [
            asyncio.create_task(self.monitor_devices()),
            asyncio.create_task(self.process_camera_streams()),
            asyncio.create_task(self.taubenschiesser_control_loop())
        ]
        
        await asyncio.gather(*tasks)
    
    def schedule_async(self, coro):
        """Schedule coroutine on main event loop from other threads"""
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(coro, self.loop)
        else:
            logger.warning("No running event loop available to schedule coroutine")
    
    def on_mqtt_connect(self, client, userdata, flags, rc):
        """MQTT connection callback"""
        if rc == 0:
            logger.info("Connected to MQTT broker")
            # Subscribe to all taubenschiesser info topics
            client.subscribe("taubenschiesser/+/info")
            client.subscribe("taubenschiesser/info")
        else:
            logger.error(f"Failed to connect to MQTT broker: {rc}")
    
    def on_mqtt_message(self, client, userdata, msg):
        """MQTT message callback"""
        try:
            topic = msg.topic
            payload_str = msg.payload.decode()
            
            # Skip empty messages
            if not payload_str.strip():
                logger.info(f"⚠️ Received empty MQTT message on topic: {topic}")
                return
            
            payload = json.loads(payload_str)
            logger.info(f"📨 MQTT message received on {topic}: {payload_str[:100]}...")
            
            # Extract device IP from topic: taubenschiesser/{IP}/info or taubenschiesser/info
            if topic == "taubenschiesser/info":
                # For global info topic, we need to get IP from payload
                device_ip = payload.get('ip', 'unknown')
            else:
                # For device-specific topic: taubenschiesser/{IP}/info
                device_ip = topic.split('/')[1]
            
            # Update device position and status
            self.device_positions[device_ip] = {
                'rot': payload.get('Rot', 0),
                'tilt': payload.get('Tilt', 0),
                'moving': payload.get('moving', False),
                'watertank': payload.get('watertank', True),
                'cam': payload.get('Cam', False),
                'last_seen': datetime.now()
            }
            
            # Update device moving status
            is_moving = payload.get('moving', False)
            was_moving = self.device_moving.get(device_ip, False)
            self.device_moving[device_ip] = is_moving
            self.device_last_seen[device_ip] = datetime.now()
            
            # Send position update (event + log) only while moving, with coordinates; throttle to max 1/s
            current_time = datetime.now()
            last_update = self.last_position_update.get(device_ip)
            should_send_position = False
            if is_moving:
                if not was_moving and is_moving:
                    should_send_position = True  # movement just started
                elif not last_update or (current_time - last_update).total_seconds() >= 1.0:
                    should_send_position = True  # throttle to 1 update per second while moving
            if should_send_position:
                self.last_position_update[device_ip] = current_time
                self.schedule_async(self.send_position_update(device_ip, payload.get('Rot', 0), payload.get('Tilt', 0)))
                logger.info(f"📍 Device {device_ip} position (moving): Rot={payload.get('Rot')}, Tilt={payload.get('Tilt')}")
            
            # If device is no longer moving, clear the movement start time
            if not is_moving and device_ip in self.device_movement_start:
                del self.device_movement_start[device_ip]
                # Also clear the device_moving status to allow immediate next movement
                self.device_moving[device_ip] = False
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON parsing error on topic {topic}: {e}")
            logger.error(f"📄 Raw payload: '{payload_str}' (length: {len(payload_str)})")
            logger.error(f"🔍 First 50 chars: '{payload_str[:50]}'")
        except Exception as e:
            logger.error(f"Error processing MQTT message: {e}")
            logger.error(f"📄 Raw payload: '{payload_str}' (length: {len(payload_str)})")
    
    def on_mqtt_disconnect(self, client, userdata, rc):
        """MQTT disconnection callback"""
        logger.warning(f"MQTT disconnected: {rc}")
    
    async def taubenschiesser_control_loop(self):
        """Main control loop for Taubenschiesser devices"""
        logger.info("Starting taubenschiesser control loop")
        # Wait longer before starting to avoid rate limiting
        await asyncio.sleep(5)
        
        # Track previous monitor status to detect when device is restarted
        previous_monitor_status = {}
        
        while True:
            try:
                sleep_seconds = 10.0  # default: poll at least every 10s for device list/config
                # logger.info("Fetching devices from API...")
                # Get all devices from API
                headers = {'Authorization': f'Bearer {self.service_token}'}
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"{self.api_url}/api/devices", headers=headers) as response:
                        if response.status == 200:
                            devices = await response.json()
                            logger.info(f"Found {len(devices)} devices")
                            
                            # Load user MQTT settings for each device owner (only once)
                            for device in devices:
                                owner_id = device.get('owner')
                                if owner_id and owner_id not in self.user_mqtt_settings:
                                    await self.load_user_mqtt_settings(owner_id)
                                
                                device_id = device.get('_id')
                                device_monitor_status = device.get('monitorStatus')
                                
                                # Check if device was just restarted (paused -> running)
                                taubenschiesser_config = device.get('taubenschiesser', {})
                                device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
                                
                                if device_id and device_ip:
                                    prev_status = previous_monitor_status.get(device_id)
                                    if prev_status == 'paused' and device_monitor_status == 'running':
                                        # Device was just restarted - set last_moved to 25s ago to trigger immediate movement
                                        logger.info(f"🔄 Device {device_ip} restarted (paused -> running), setting timer to trigger movement")
                                        self.device_last_seen[device_ip] = datetime.now()
                                        self.device_last_moved[device_ip] = datetime.now() - timedelta(seconds=25)
                                        # Also clear any movement state
                                        if device_ip in self.device_moving:
                                            self.device_moving[device_ip] = False
                                        if device_ip in self.device_movement_start:
                                            del self.device_movement_start[device_ip]
                                    
                                    # Update previous status
                                    previous_monitor_status[device_id] = device_monitor_status
                                
                                # Only process devices with monitorStatus: 'running'
                                if device_monitor_status == 'running':
                                    # logger.info(f"Processing device {device.get('_id')} with status: {device.get('monitorStatus')}")
                                    await self.process_taubenschiesser_device(device)
                                else:
                                    logger.debug(f"Skipping device {device.get('_id')} with status: {device.get('monitorStatus')}")
                            
                            # Dynamic sleep: wake (at latest) when the next device is allowed to move
                            now = datetime.now()
                            for device in devices:
                                if device.get('monitorStatus') != 'running':
                                    continue
                                taubenschiesser_config = device.get('taubenschiesser', {})
                                device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
                                if not device_ip or device_ip not in self.device_last_moved:
                                    continue
                                raw_threshold = device.get('actions', {}).get('waitBetweenMovesSeconds', 20)
                                threshold = max(5, min(300, int(raw_threshold) if isinstance(raw_threshold, (int, float)) else 20))
                                last_moved = self.device_last_moved[device_ip]
                                next_move_at = last_moved + timedelta(seconds=threshold)
                                if next_move_at > now:
                                    sec_until = (next_move_at - now).total_seconds()
                                    sleep_seconds = min(sleep_seconds, max(0.5, sec_until))
                        elif response.status == 429:
                            logger.warning("Rate limited, waiting longer...")
                            await asyncio.sleep(60)  # Wait 1 minute if rate limited
                            continue
                        else:
                            logger.error(f"API error: {response.status}")
                
                await asyncio.sleep(sleep_seconds)
                
            except Exception as e:
                logger.error(f"Error in taubenschiesser control loop: {e}")
                await asyncio.sleep(30)
    
    async def process_taubenschiesser_device(self, device: Dict):
        """Process a single Taubenschiesser device"""
        try:
            device_id = device.get('_id') or device.get('deviceId')
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            logger.info(f"🔍 Processing device {device_ip} (ID: {device_id})")
            # Log only essential device info
            actions = device.get('actions', {})
            logger.info(f"📋 Device: {device.get('name', 'Unknown')} | IP: {device_ip} | Status: {device.get('status', 'unknown')} | Mode: {actions.get('mode', 'unknown')}")
            
            if not device_ip:
                logger.warning("❌ No device IP found")
                return
            
            # Check if device is offline - skip processing if offline
            if device.get('status') == 'offline':
                logger.info(f"📴 Device {device_ip} is offline, skipping all processing")
                return
            
            # First time we see this device: set last_moved to 25s ago so we move immediately
            if device_ip not in self.device_last_moved:
                logger.info(f"ℹ️ Device {device_ip} first run - setting last_moved to trigger first movement")
                self.device_last_moved[device_ip] = datetime.now() - timedelta(seconds=25)
            
            # Check if device is moving
            if self.device_moving.get(device_ip, False):
                # Check if movement has been going on too long (timeout)
                movement_start = self.device_movement_start.get(device_ip)
                if movement_start:
                    movement_duration = (datetime.now() - movement_start).total_seconds()
                    if movement_duration > 30:  # 30 second timeout
                        logger.warning(f"⏰ Device {device_ip} movement timeout ({movement_duration:.1f}s) - forcing continue")
                        self.device_moving[device_ip] = False
                        del self.device_movement_start[device_ip]
                    else:
                        logger.info(f"⏸️ Device {device_ip} is moving ({movement_duration:.1f}s), skipping")
                        await self.send_monitor_event(device, 'device_busy', {
                            'message': f'Device bewegt sich noch ({movement_duration:.1f}s)',
                            'duration': movement_duration
                        })
                        return
                else:
                    logger.info(f"⏸️ Device {device_ip} is moving, skipping")
                    await self.send_monitor_event(device, 'device_busy', {
                        'message': 'Device bewegt sich noch'
                    })
                    return
            
            # Note: Device active check is handled by monitorStatus field
            # Devices with monitorStatus != 'running' are already filtered out
            
            # Check sleep mode
            if device.get('sleep', False):
                logger.info(f"⏸️ Device {device_ip} in sleep mode")
                return
            
            # Check if it's time to move (configurable wait since last completed move)
            last_moved = self.device_last_moved.get(device_ip)
            time_since_last_moved = (datetime.now() - last_moved).total_seconds() if last_moved else 0
            raw_threshold = device.get('actions', {}).get('waitBetweenMovesSeconds', 20)
            timeout_threshold = max(5, min(300, int(raw_threshold) if isinstance(raw_threshold, (int, float)) else 20))

            if time_since_last_moved > timeout_threshold:
                await self.move_device(device, time_since_last_moved)
            else:
                logger.info(f"⏳ Waiting for {timeout_threshold}s inactivity period (current: {time_since_last_moved:.1f}s)")
                await self.send_monitor_event(device, 'device_waiting', {
                    'message': f'Warte auf Inaktivität ({time_since_last_moved:.1f}s / {timeout_threshold}s)',
                    'current_wait': time_since_last_moved,
                    'threshold': timeout_threshold
                })
            
        except Exception as e:
            logger.error(f"Error processing device {device.get('deviceId', 'unknown')}: {e}")
    
    async def move_device(self, device: Dict, time_since_last_seen: float = None):
        """Move a Taubenschiesser device"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            if not device_ip:
                logger.error("❌ No device IP found in taubenschiesser configuration")
                return
            
            # Check if device has route configured
            actions = device.get('actions', {})
            mode = actions.get('mode', 'impulse')
            route_coordinates = actions.get('route', {}).get('coordinates', [])
            
            if mode == 'route' and route_coordinates:
                await self.move_device_route(device, time_since_last_seen)
            else:
                await self.move_device_step(device, time_since_last_seen)
                
        except Exception as e:
            logger.error(f"Error moving device: {e}")
    
    async def move_device_step(self, device: Dict, time_since_last_seen: float = None):
        """Move device step by step"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            if not device_ip:
                logger.error("❌ xNo device IP found in taubenschiesser configuration")
                return
            
            # Get step size from actions or use default
            actions = device.get('actions', {})
            step_size = actions.get('basicStep', 40)
            
            # Send movement event
            await self.send_monitor_event(device, 'device_moving', {
                'message': f'Device bewegt sich (Impulse: {step_size} Schritte)',
                'step_size': step_size,
                'movement_type': 'impulse'
            })
            
            # Send impulse command via MQTT
            command = {
                "type": "impulse",
                "position": {
                    "rot": step_size,
                    "tilt": 0
                },
                "speed": 0,
                "bounce": False
            }
            
            topic = f"taubenschiesser/{device_ip}"
            
            # Get user-specific MQTT client
            owner_id = device.get('owner')
            mqtt_client = await self.get_mqtt_client_for_user(owner_id)
            
            if mqtt_client:
                mqtt_client.publish(topic, json.dumps(command))
                # Mark device as moving and set start time
                self.device_moving[device_ip] = True
                self.device_movement_start[device_ip] = datetime.now()
                logger.info(f"✅ Sent MQTT command to topic '{topic}': {json.dumps(command)}")
            else:
                logger.warning(f"No MQTT client available for user {owner_id}, skipping command")
            
            # Create combined log message
            if time_since_last_seen is not None:
                logger.info(f"🚀 Moving device {device_ip} - no activity for {time_since_last_seen:.1f}s 📍 Impulse: {step_size} steps (user: {owner_id})")
            else:
                logger.info(f"📍 Sent impulse command to device {device_ip}: {step_size} steps (user: {owner_id})")
            
            # Wait for movement to complete before analyzing
            await self.wait_for_movement_complete(device_ip)
            
            # Send movement complete event
            await self.send_monitor_event(device, 'device_stopped', {
                'message': 'Device hat Bewegung beendet'
            })
            
            # Wait additional 2 seconds for camera/device to stabilize
            logger.info(f"⏱️ Waiting 2s for device {device_ip} to stabilize...")
            await self.send_monitor_event(device, 'device_stabilizing', {
                'message': 'Warte 2s bis Kamera stabilisiert...',
                'wait_time': 2
            })
            await asyncio.sleep(2)
            await self.analyze_after_movement(device)
            
            # Record when we last moved so the 20s inactivity period starts now
            self.device_last_moved[device_ip] = datetime.now()
            logger.info(f"✅ Analysis complete for device {device_ip}, resetting wait timer (20s inactivity period starts now)")
            
        except Exception as e:
            logger.error(f"Error moving device step: {e}")
    
    def apply_position_inversion(self, device: Dict, rotation: int, tilt: int) -> Tuple[int, int]:
        """
        Apply position inversion if enabled in device settings.
        Returns inverted values (180 - value) if inversion is enabled, otherwise original values.
        
        Args:
            device: Device configuration dictionary
            rotation: Original rotation value
            tilt: Original tilt value
            
        Returns:
            Tuple of (rotation, tilt) with inversion applied if enabled
        """
        taubenschiesser_config = device.get('taubenschiesser', {})
        if isinstance(taubenschiesser_config, dict):
            invert_rotation = taubenschiesser_config.get('invertRotation', False)
            invert_tilt = taubenschiesser_config.get('invertTilt', False)
            
            if invert_rotation:
                rotation = 180 - rotation
            if invert_tilt:
                tilt = 180 - tilt
        
        return rotation, tilt
    
    async def move_device_route(self, device: Dict, time_since_last_seen: float = None):
        """Move device along configured route"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            if not device_ip:
                logger.error("❌ No device IP found in taubenschiesser configuration")
                return
            
            actions = device.get('actions', {})
            route_coordinates = actions.get('route', {}).get('coordinates', [])
            
            if not route_coordinates:
                logger.warning(f"No route coordinates configured for device {device_ip}")
                return
            
            # Get current route position (this would need to be tracked)
            route_index = self.movement_queue.get(device_ip, 0)
            route_item = route_coordinates[route_index]
            
            # Get original rotation and tilt values
            original_rotation = route_item.get('rotation', 0)
            original_tilt = route_item.get('tilt', 0)
            
            # Apply position inversion if enabled
            rotation, tilt = self.apply_position_inversion(device, original_rotation, original_tilt)
            
            # Send movement event
            await self.send_monitor_event(device, 'device_moving', {
                'message': f'Device bewegt sich zu Route-Punkt {route_index + 1}/{len(route_coordinates)}',
                'rotation': rotation,
                'tilt': tilt,
                'route_index': route_index,
                'total_points': len(route_coordinates),
                'movement_type': 'route'
            })
            
            # Send move command
            command = {
                "type": "move",
                "position": {
                    "rot": rotation,
                    "tilt": tilt
                },
                "speed": 0
            }
            
            topic = f"taubenschiesser/{device_ip}"
            
            # Get user-specific MQTT client
            owner_id = device.get('owner')
            mqtt_client = await self.get_mqtt_client_for_user(owner_id)
            
            if mqtt_client:
                mqtt_client.publish(topic, json.dumps(command))
                # Mark device as moving and set start time
                self.device_moving[device_ip] = True
                self.device_movement_start[device_ip] = datetime.now()
            else:
                logger.warning(f"No MQTT client available for user {owner_id}, skipping command")
            
            # Create combined log message
            if time_since_last_seen is not None:
                logger.info(f"🚀 Moving device {device_ip} - no activity for {time_since_last_seen:.1f}s 📍 Route: rotation={rotation}, tilt={tilt} (user: {owner_id})")
            else:
                logger.info(f"📍 Sent route command to device {device_ip}: rotation={rotation}, tilt={tilt} (user: {owner_id})")
            
            # Wait for movement to complete before analyzing
            await self.wait_for_movement_complete(device_ip)
            
            # Send movement complete event
            await self.send_monitor_event(device, 'device_stopped', {
                'message': f'Device erreichte Route-Punkt {route_index + 1}'
            })
            
            # Wait additional 2 seconds for camera/device to stabilize
            logger.info(f"⏱️ Waiting 2s for device {device_ip} to stabilize...")
            await self.send_monitor_event(device, 'device_stabilizing', {
                'message': 'Warte 2s bis Kamera stabilisiert...',
                'wait_time': 2
            })
            await asyncio.sleep(2)
            await self.analyze_after_movement(device)
            
            # Record when we last moved so the 20s inactivity period starts now
            self.device_last_moved[device_ip] = datetime.now()
            logger.info(f"✅ Analysis complete for device {device_ip}, resetting wait timer (20s inactivity period starts now)")
            
            # Update route index AFTER analysis is complete
            self.movement_queue[device_ip] = (route_index + 1) % len(route_coordinates)
            
        except Exception as e:
            logger.error(f"Error moving device route: {e}")
    
    async def wait_for_movement_complete(self, device_ip: str, timeout: int = 30):
        """Wait for device to complete movement via MQTT or timeout"""
        try:
            logger.info(f"⏳ Waiting for device {device_ip} to complete movement...")
            start_time = datetime.now()
            
            while True:
                # Check if movement is complete (MQTT reported moving=false)
                if not self.device_moving.get(device_ip, False):
                    elapsed = (datetime.now() - start_time).total_seconds()
                    logger.info(f"✅ Device {device_ip} movement complete after {elapsed:.1f}s")
                    return
                
                # Check timeout
                elapsed = (datetime.now() - start_time).total_seconds()
                if elapsed >= timeout:
                    logger.warning(f"⏰ Movement timeout ({timeout}s) reached for device {device_ip}")
                    # Clear movement status on timeout
                    self.device_moving[device_ip] = False
                    if device_ip in self.device_movement_start:
                        del self.device_movement_start[device_ip]
                    return
                
                # Wait a bit before checking again
                await asyncio.sleep(0.5)
                
        except Exception as e:
            logger.error(f"Error waiting for movement complete: {e}")
    
    async def send_monitor_event(self, device: Dict, event_type: str, data: Dict):
        """Send live monitoring event to server"""
        try:
            device_id = device.get('_id') or device.get('deviceId')
            
            event_data = {
                'deviceId': device_id,
                'eventType': event_type,
                'data': data,
                'timestamp': datetime.now().isoformat()
            }
            
            headers = {'Authorization': f'Bearer {self.service_token}'}
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.api_url}/api/hardware/monitor-event",
                    json=event_data,
                    headers=headers
                ) as response:
                    if response.status != 200:
                        logger.warning(f"Failed to send monitor event {event_type}: {response.status}")
                        
        except Exception as e:
            logger.error(f"Error sending monitor event: {e}")
    
    async def send_position_update(self, device_ip: str, rotation: int, tilt: int):
        """Send device position update to server for real-time display"""
        try:
            # Find device by IP
            headers = {'Authorization': f'Bearer {self.service_token}'}
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.api_url}/api/devices", headers=headers) as response:
                    if response.status == 200:
                        devices = await response.json()
                        device = next((d for d in devices if d.get('taubenschiesser', {}).get('ip') == device_ip), None)
                        
                        if device:
                            device_id = device.get('_id')
                            
                            # Send position update event
                            position_data = {
                                'deviceId': device_id,
                                'eventType': 'device_position',
                                'data': {
                                    'rotation': rotation,
                                    'tilt': tilt,
                                    'timestamp': datetime.now().isoformat()
                                },
                                'timestamp': datetime.now().isoformat()
                            }
                            
                            async with session.post(
                                f"{self.api_url}/api/hardware/monitor-event",
                                json=position_data,
                                headers=headers
                            ) as pos_response:
                                if pos_response.status != 200:
                                    logger.debug(f"Failed to send position update: {pos_response.status}")
                        
        except Exception as e:
            logger.debug(f"Error sending position update: {e}")
    
    async def analyze_after_movement(self, device: Dict):
        """Analyze camera after movement - supports both Tapo and Raspberry Pi cameras"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            # Send event: Starting analysis
            await self.send_monitor_event(device, 'analysis_started', {
                'device_ip': device_ip,
                'message': 'Starting image analysis'
            })
            
            # Early offline check - skip if device hasn't been seen recently
            last_seen = self.device_last_seen.get(device_ip)
            if not last_seen:
                logger.info(f"ℹ️ Device {device_ip} not seen via MQTT yet - skipping image analysis")
                return
            
            time_since_last_seen = (datetime.now() - last_seen).total_seconds()
            if time_since_last_seen > 30:  # 30 second offline threshold
                logger.info(f"⏰ Device {device_ip} timeout reached ({time_since_last_seen:.1f}s since last message), continuing with image analysis")
                # Don't return - continue with image analysis after timeout
            
            # Check for different camera types
            camera_config = device.get('camera', {})
            camera_type = camera_config.get('type')
            
            # Check if using local image file instead of camera
            use_local_image = camera_config.get('useLocalImage', False)
            local_image_path = camera_config.get('localImagePath', '')
            
            # Determine which cameras to check
            has_tapo = False
            has_raspberry_pi = False
            
            # Check for Tapo camera
            tapo_config = camera_config.get('tapo', {})
            if tapo_config and tapo_config.get('ip') and tapo_config.get('username') and tapo_config.get('password'):
                has_tapo = True
            
            # Check for Raspberry Pi camera
            pi_config = camera_config.get('raspberryPi', {})
            if pi_config and pi_config.get('ip'):
                has_raspberry_pi = True
            
            # Single camera only: use device camera type (tapo or raspberry-pi)
            if use_local_image and local_image_path:
                # Use local image file
                logger.info(f"📁 Using local image file for device {device_ip}: {local_image_path}")
                await self.send_monitor_event(device, 'image_source', {
                    'source': 'local',
                    'path': local_image_path
                })
                original_frame = await self.load_local_image(local_image_path)
                if original_frame is not None:
                    await self.process_single_camera(device, original_frame, 'local')
            elif (camera_type == 'raspberry-pi' and has_raspberry_pi) or (has_raspberry_pi and not has_tapo):
                await self.analyze_raspberry_pi_camera(device, device_ip, camera_config)
            elif (camera_type == 'tapo' and has_tapo) or has_tapo:
                await self.analyze_tapo_camera(device, device_ip, camera_config)
            else:
                logger.warning(f"No camera configured for device {device_ip}")
                await self.send_monitor_event(device, 'error', {
                    'message': 'No camera configured'
                })
                
        except Exception as e:
            logger.error(f"Error analyzing after movement: {e}")
            await self.send_monitor_event(device, 'error', {
                'message': str(e)
            })
    
    async def analyze_tapo_camera(self, device: Dict, device_ip: str, camera_config: Dict, camera_label: str = 'tapo'):
        """Analyze Tapo camera"""
        try:
            tapo_config = camera_config.get('tapo', {})
            tapo_ip = tapo_config.get('ip')
            tapo_username = tapo_config.get('username')
            tapo_password = tapo_config.get('password')
            tapo_stream = tapo_config.get('stream', 'stream1')
            
            if not (tapo_ip and tapo_username and tapo_password):
                logger.warning(f"Tapo camera configuration incomplete for device {device_ip}")
                return
            
            # Construct RTSP URL for Tapo camera
            rtsp_url = f"rtsp://{tapo_username}:{tapo_password}@{tapo_ip}:554/{tapo_stream}"
            logger.info(f"Using Tapo camera RTSP URL for device {device_ip}")
            await self.send_monitor_event(device, 'image_source', {
                'source': 'tapo',
                'ip': tapo_ip,
                'stream': tapo_stream,
                'camera_label': camera_label
            })
            
            # Capture frame from RTSP camera
            logger.info(f"📷 Attempting to capture frame from Tapo camera: {device_ip}")
            await self.send_monitor_event(device, 'capturing_image', {
                'message': 'Capturing image from Tapo camera',
                'camera': 'tapo'
            })
            # Use device_id if available to use API endpoint (same as Dashboard)
            device_id = device.get('_id') or device.get('id')
            original_frame = await self.capture_frame(rtsp_url, device_id=device_id)
            
            if original_frame is not None:
                await self.process_single_camera(device, original_frame, 'tapo', camera_label)
            else:
                logger.warning(f"❌ Could not capture frame from Tapo camera for device {device_ip}")
                await self.send_monitor_event(device, 'error', {
                    'message': 'Could not capture frame from Tapo camera',
                    'camera': 'tapo'
                })
                
        except Exception as e:
            logger.error(f"Error analyzing Tapo camera: {e}")
            await self.send_monitor_event(device, 'error', {
                'message': f'Tapo camera error: {str(e)}',
                'camera': 'tapo'
            })
    
    async def analyze_raspberry_pi_camera(self, device: Dict, device_ip: str, camera_config: Dict, camera_label: str = 'raspberry-pi'):
        """Analyze Raspberry Pi camera"""
        try:
            pi_config = camera_config.get('raspberryPi', {})
            pi_ip = pi_config.get('ip')
            pi_port = pi_config.get('port', 8080)
            pi_endpoint = pi_config.get('endpoint', '/image.jpg')
            pi_flip = pi_config.get('flip', False)
            pi_angle = pi_config.get('angle', 0)
            pi_square = pi_config.get('square', False)
            pi_resolution = pi_config.get('resolution')
            
            if not pi_ip:
                logger.warning(f"Raspberry Pi camera IP not configured for device {device_ip}")
                return
            
            # Resolve hostname to IP if needed (in case hostname is used instead of IP)
            resolved_ip = pi_ip
            try:
                # Check if it's already an IP address
                socket.inet_aton(pi_ip)
            except socket.error:
                # It's a hostname, try to resolve it
                try:
                    resolved_ip = socket.gethostbyname(pi_ip)
                    logger.debug(f"Resolved hostname {pi_ip} to IP {resolved_ip}")
                except socket.gaierror as e:
                    logger.warning(f"Could not resolve hostname {pi_ip}: {e}, using as-is")
                    resolved_ip = pi_ip
            
            # Build URL with query parameters (flip, angle)
            base_url = f"http://{resolved_ip}:{pi_port}{pi_endpoint}"
            query_params = []
            if pi_flip:
                query_params.append("flip=true")
            if isinstance(pi_angle, (int, float)) and pi_angle not in (0, 0.0):
                query_params.append(f"angle={pi_angle}")
            if pi_square:
                query_params.append("square=true")
            if pi_resolution:
                query_params.append(f"resolution={pi_resolution}")
            
            image_url = f"{base_url}?{'&'.join(query_params)}" if query_params else base_url
            logger.info(f"Using Raspberry Pi camera HTTP URL for device {device_ip}: {image_url}")
            await self.send_monitor_event(device, 'image_source', {
                'source': 'raspberry-pi',
                'ip': pi_ip,
                'port': pi_port,
                'endpoint': pi_endpoint,
                'camera_label': camera_label
            })
            
            # Capture frame from Raspberry Pi
            logger.info(f"📷 Attempting to capture frame from Raspberry Pi: {device_ip}")
            await self.send_monitor_event(device, 'capturing_image', {
                'message': 'Capturing image from Raspberry Pi camera',
                'camera': 'raspberry-pi'
            })
            original_frame = await self.capture_frame_from_http(image_url)
            
            if original_frame is not None:
                await self.process_single_camera(device, original_frame, 'raspberry-pi', camera_label)
            else:
                logger.warning(f"❌ Could not capture frame from Raspberry Pi camera for device {device_ip}")
                await self.send_monitor_event(device, 'error', {
                    'message': 'Could not capture frame from Raspberry Pi camera',
                    'camera': 'raspberry-pi'
                })
                
        except Exception as e:
            logger.error(f"Error analyzing Raspberry Pi camera: {e}")
            await self.send_monitor_event(device, 'error', {
                'message': f'Raspberry Pi camera error: {str(e)}',
                'camera': 'raspberry-pi'
            })
    
    async def process_single_camera(self, device: Dict, original_frame: np.ndarray, camera_source: str, camera_label: str = None):
        """Process a single camera frame (Tapo or Raspberry Pi)"""
        try:
            height, width = original_frame.shape[:2]
            logger.info(f"✅ Frame captured successfully from {camera_source}: {width}x{height} pixels")
            
            # Send original image with camera label
            _, buffer = cv2.imencode('.jpg', original_frame)
            original_image_base64 = base64.b64encode(buffer).decode('utf-8')
            
            event_data = {
                'width': width,
                'height': height,
                'image': f"data:image/jpeg;base64,{original_image_base64}",
                'camera': camera_source
            }
            if camera_label:
                event_data['camera_label'] = camera_label
            
            await self.send_monitor_event(device, 'image_captured', event_data)
            
            # Apply zoom if in route mode (only for Tapo, Raspberry Pi handles zoom itself)
            if camera_source == 'tapo':
                zoomed_frame = await self.apply_zoom_to_frame(device, original_frame)
            else:
                # Raspberry Pi handles zoom itself via query parameters
                zoomed_frame = original_frame
            
            # Send zoomed image if different
            if zoomed_frame is not original_frame:
                zoom_height, zoom_width = zoomed_frame.shape[:2]
                _, zoom_buffer = cv2.imencode('.jpg', zoomed_frame)
                zoomed_image_base64 = base64.b64encode(zoom_buffer).decode('utf-8')
                
                zoom_event_data = {
                    'width': zoom_width,
                    'height': zoom_height,
                    'zoom_factor': round(width / zoom_width, 2) if zoom_width > 0 else 1,
                    'image': f"data:image/jpeg;base64,{zoomed_image_base64}",
                    'camera': camera_source
                }
                if camera_label:
                    zoom_event_data['camera_label'] = camera_label
                
                await self.send_monitor_event(device, 'image_zoomed', zoom_event_data)
            
            # Analyze with CV service (using zoomed frame for better detection)
            await self.send_monitor_event(device, 'analyzing', {
                'message': f'Analyzing image with CV service ({camera_source})',
                'camera': camera_source
            })
            await self.analyze_frame_for_birds(device, original_frame, zoomed_frame, camera_source)
                
        except Exception as e:
            logger.error(f"Error processing camera {camera_source}: {e}")
            await self.send_monitor_event(device, 'error', {
                'message': f'Error processing {camera_source} camera: {str(e)}',
                'camera': camera_source
            })
    
    async def apply_zoom_to_frame(self, device: Dict, frame: np.ndarray) -> np.ndarray:
        """Apply zoom to frame based on route configuration"""
        try:
            # Get IP for logging
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            camera_config = device.get('camera', {})
            is_local_image = camera_config.get('useLocalImage', False)
            
            actions = device.get('actions', {})
            mode = actions.get('mode', 'impulse')
            
            # Only apply zoom in route mode
            if mode != 'route':
                logger.info(f"⏭️ No zoom for device {device_ip} - mode is {mode} (not route)")
                return frame
            
            route_coordinates = actions.get('route', {}).get('coordinates', [])
            if not route_coordinates:
                logger.info(f"⏭️ No zoom for device {device_ip} - no route coordinates")
                return frame
            
            # Get current route position
            route_index = self.movement_queue.get(device_ip, 0) if device_ip else 0
            
            if route_index >= len(route_coordinates):
                logger.warning(f"⏭️ No zoom for device {device_ip} - route index {route_index} out of range")
                return frame
            
            route_item = route_coordinates[route_index]
            zoom_factor = route_item.get('zoom', 1.0)
            
            # If zoom is 1.0, no cropping needed
            if zoom_factor <= 1.0:
                logger.info(f"⏭️ No zoom for device {device_ip} - zoom factor is {zoom_factor} (no magnification needed)")
                return frame
            
            # Check frame dimensions - ONLY for local images
            height, width = frame.shape[:2]
            
            if is_local_image:
                # For local images: check pixel dimensions before zooming
                tapo_config = camera_config.get('tapo', {})
                stream_type = tapo_config.get('stream', 'stream1')
                
                # Expected resolutions based on stream type
                if stream_type == 'stream1':
                    # High quality stream
                    expected_resolutions = [
                        (2560, 1440),  # 2K
                        (1920, 1080),  # Full HD
                        (1280, 720),   # HD
                    ]
                else:  # stream2
                    # Low quality stream
                    expected_resolutions = [
                        (640, 360),    # Low quality
                        (640, 480),    # Alternative low quality
                        (320, 240)     # Very low quality
                    ]
                
                # Check if frame matches any expected resolution for this stream
                resolution_matches = any(
                    (width == exp_w and height == exp_h) or (width == exp_h and height == exp_w)
                    for exp_w, exp_h in expected_resolutions
                )
                
                if not resolution_matches:
                    expected_str = ", ".join([f"{w}x{h}" for w, h in expected_resolutions])
                    logger.warning(f"⚠️ Local image {width}x{height} doesn't match {stream_type} expected resolutions ({expected_str}) - skipping zoom")
                    return frame
                else:
                    logger.info(f"✅ Local image {width}x{height} matches {stream_type} - applying zoom")
            
            # Calculate new dimensions based on zoom
            new_width = int(width / zoom_factor)
            new_height = int(height / zoom_factor)
            
            # Calculate center crop coordinates
            start_x = (width - new_width) // 2
            start_y = (height - new_height) // 2
            end_x = start_x + new_width
            end_y = start_y + new_height
            
            # Crop the frame
            cropped_frame = frame[start_y:end_y, start_x:end_x]
            
            source_type = "local image" if is_local_image else "camera stream"
            logger.info(f"🔍 Applied zoom {zoom_factor}x to {source_type} {device_ip}: {width}x{height} -> {new_width}x{new_height}")
            
            return cropped_frame
            
        except Exception as e:
            logger.error(f"Error applying zoom to frame: {e}")
            return frame
    
    async def analyze_frame_for_birds(self, device: Dict, original_frame: np.ndarray, zoomed_frame: np.ndarray, camera_source: str = 'unknown'):
        """Analyze frame for birds and trigger shoot if found"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            device_id = device.get('_id') or device.get('deviceId')
            
            # Use zoomed frame for better detection
            _, buffer = cv2.imencode('.jpg', zoomed_frame)
            
            cv_request_url = f"{self.cv_service_url}/detect_birds_optimized"
            logger.info(f"🔍 Sending frame to CV service (device: {device_ip}, camera: {camera_source}) URL: {cv_request_url}")
            
            # Send to CV service with timeout
            async with aiohttp.ClientSession() as session:
                data = aiohttp.FormData()
                data.add_field('file', buffer.tobytes(), filename='camera.jpg', content_type='image/jpeg')
                
                timeout = aiohttp.ClientTimeout(total=30)  # 30 second timeout for CV analysis
                async with session.post(
                    cv_request_url,
                    data=data,
                    timeout=timeout
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        
                        # Log CV service response details
                        bird_count = result.get('bird_count', 0)
                        detections = result.get('detections', [])
                        processing_time = result.get('processing_time', 0)
                        detection_classes = [d.get('class', 'unknown') for d in detections]
                        birds_found = result.get('birds_found', False)
                        logger.info(f"📥 CV response ({camera_source}): birds_found={birds_found}, bird_count={bird_count}, len(detections)={len(detections)}, classes={detection_classes}, service={result.get('service', 'N/A')}")
                        
                        # Count all objects (not just birds)
                        all_objects = {}
                        for detection in detections:
                            obj_class = detection.get('class', 'unknown')
                            if obj_class in all_objects:
                                all_objects[obj_class] += 1
                            else:
                                all_objects[obj_class] = 1

                        # Consistency check: birds_found True but no detection with class 'bird'
                        has_bird_class = any(d.get('class') == 'bird' for d in detections)
                        if birds_found and not has_bird_class:
                            logger.warning(f"⚠️ CV response inconsistent: birds_found=True but no detection with class='bird'. classes={detection_classes}, bird_count={bird_count}, service={result.get('service', 'N/A')}")

                        # Pick target_bird and enrich detections with esp_rot, esp_tilt, is_target_bird for UI
                        target_bird_for_event = None
                        if detections:
                            birds = [d for d in detections if d.get('class') == 'bird']
                            if birds:
                                target_bird_for_event = max(birds, key=lambda x: x.get('confidence', 0))
                                target_bird_for_event['camera_source'] = camera_source
                            image_info = {
                                'zoomed_size': {'width': zoomed_frame.shape[1], 'height': zoomed_frame.shape[0]},
                                'original_size': {'width': original_frame.shape[1], 'height': original_frame.shape[0]},
                            }
                            self.last_image_info = image_info
                            current_rotation, current_tilt = 0.0, 0.0
                            if device_ip and device_ip in self.device_positions:
                                pos = self.device_positions[device_ip]
                                current_rotation = float(pos.get('rot') or 0)
                                current_tilt = float(pos.get('tilt') or 0)
                            else:
                                actions = device.get('actions', {})
                                if actions.get('mode') == 'route':
                                    route_coordinates = actions.get('route', {}).get('coordinates', [])
                                    route_index = self.movement_queue.get(device_ip, 0) if device_ip else 0
                                    if route_index < len(route_coordinates):
                                        current_rotation = float(route_coordinates[route_index].get('rotation') or 0)
                                        current_tilt = float(route_coordinates[route_index].get('tilt') or 0)
                                        current_rotation, current_tilt = self.apply_position_inversion(device, int(current_rotation), int(current_tilt))
                            zoom_factor = 1.0
                            actions = device.get('actions', {})
                            if actions.get('mode') == 'route' and device_ip:
                                route_coordinates = actions.get('route', {}).get('coordinates', [])
                                route_index = self.movement_queue.get(device_ip, 0)
                                if route_index < len(route_coordinates):
                                    zoom_factor = float(route_coordinates[route_index].get('zoom') or 1.0)
                            self._enrich_detections_esp_angles(
                                device, detections, target_bird_for_event,
                                image_info, zoom_factor, current_rotation, current_tilt, camera_source,
                            )

                        # Send CV analysis result event (detections include esp_rot, esp_tilt, is_target_bird)
                        await self.send_monitor_event(device, 'cv_analysis_complete', {
                            'bird_count': bird_count,
                            'detections': detections,
                            'target_bird': target_bird_for_event,
                            'processing_time': processing_time,
                            'birds_found': result.get('birds_found', False),
                            'confidence_level': result.get('confidence_level', 0),
                            'total_objects': len(detections),
                            'objects_by_class': all_objects,
                            'camera': camera_source
                        })
                        
                        # Log detections only if objects found
                        if detections:
                            logger.info(f"🤖 CV Analysis ({camera_source}): {bird_count} birds found, processing time: {processing_time:.2f}s")
                            for idx, detection in enumerate(detections, 1):
                                obj_class = detection.get('class', 'unknown')
                                confidence = detection.get('confidence', 0)
                                logger.info(f"  Detection #{idx}: {obj_class} (confidence: {confidence:.2f})")
                        else:
                            logger.info(f"🤖 CV Analysis ({camera_source}): No objects detected (processing time: {processing_time:.2f}s)")
                        
                        if result.get('birds_found', False):
                            confidence = result.get('confidence_level', 0)
                            monitor_armed = device.get('monitorArmed', False)
                            action_msg = "save+shoot" if monitor_armed else "save only (monitor not armed)"
                            logger.info(f"🦅 BIRDS DETECTED on device {device_ip} ({camera_source}): {action_msg} because birds_found=True, detections classes={detection_classes}, bird_count={bird_count}, max confidence: {confidence:.2f}")
                            
                            # Send bird detection event
                            await self.send_monitor_event(device, 'birds_detected', {
                                'bird_count': bird_count,
                                'confidence': confidence,
                                'message': f'{bird_count} birds detected with confidence {confidence:.2f} ({camera_source})',
                                'camera': camera_source
                            })
                            
                            # Save detection to database (with shotFired=monitor_armed)
                            target_bird = await self.save_detection_to_db(device, original_frame, zoomed_frame, result, camera_source, shot_fired=monitor_armed)
                            
                            # Trigger shoot only when monitor is armed
                            if monitor_armed:
                                await self.trigger_shoot(device, target_bird=target_bird)
                    else:
                        logger.error(f"❌ CV analysis failed for device {device_ip} ({camera_source}): HTTP {response.status}")
                        await self.send_monitor_event(device, 'error', {
                            'message': f'CV analysis failed: HTTP {response.status}',
                            'camera': camera_source
                        })
                        
        except Exception as e:
            logger.error(f"Error analyzing frame for birds ({camera_source}): {e}")
            await self.send_monitor_event(device, 'error', {
                'message': f'CV analysis error: {str(e)}',
                'camera': camera_source
            })
    
    async def save_combined_detection_to_db(self, device: Dict, 
                                            tapo_original_frame: Optional[np.ndarray], tapo_zoomed_frame: Optional[np.ndarray], tapo_cv_result: Optional[Dict],
                                            raspberry_pi_original_frame: Optional[np.ndarray], raspberry_pi_zoomed_frame: Optional[np.ndarray], raspberry_pi_cv_result: Optional[Dict],
                                            shot_fired: bool = False):
        """Save combined detection with images from both cameras. shot_fired: whether monitor was armed (shot fired for this detection)."""
        try:
            device_id = device.get('_id') or device.get('deviceId')
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            # Combine detections from both cameras, marking which camera detected what
            all_detections = []
            
            if tapo_cv_result and tapo_cv_result.get('detections'):
                for detection in tapo_cv_result.get('detections', []):
                    detection['camera_source'] = 'tapo'
                    all_detections.append(detection)
            
            if raspberry_pi_cv_result and raspberry_pi_cv_result.get('detections'):
                for detection in raspberry_pi_cv_result.get('detections', []):
                    detection['camera_source'] = 'raspberry-pi'
                    all_detections.append(detection)
            
            # Find target bird (highest confidence bird from either camera)
            target_bird = None
            if all_detections:
                birds = [d for d in all_detections if d.get('class') == 'bird']
                if birds:
                    target_bird = max(birds, key=lambda x: x.get('confidence', 0))
                    logger.info(f"🎯 Target bird selected: confidence={target_bird.get('confidence', 0):.2f}, camera={target_bird.get('camera_source', 'unknown')}")
            
            # Get zoom factor and route position
            zoom_factor = 1.0
            actions = device.get('actions', {})
            route_coordinates = actions.get('route', {}).get('coordinates', []) if actions.get('mode') == 'route' else []
            route_index = self.movement_queue.get(device_ip, 0) if device_ip else 0
            if actions.get('mode') == 'route' and route_index < len(route_coordinates):
                zoom_factor = route_coordinates[route_index].get('zoom', 1.0)

            # esp_rot/esp_tilt are not stored; they are computed on demand when returning detections for the UI (same logic as shoot).

            # Prepare image data
            detection_data = {
                "deviceId": device_id,
                "detections": all_detections,
                "target_bird": target_bird,
                "bird_count": len([d for d in all_detections if d.get('class') == 'bird']),
                "confidence_level": max(
                    tapo_cv_result.get('confidence_level', 0) if tapo_cv_result else 0,
                    raspberry_pi_cv_result.get('confidence_level', 0) if raspberry_pi_cv_result else 0
                ),
                "processing_time": (
                    (tapo_cv_result.get('processing_time', 0) if tapo_cv_result else 0) +
                    (raspberry_pi_cv_result.get('processing_time', 0) if raspberry_pi_cv_result else 0)
                ),
                "zoom_factor": zoom_factor,
                "camera_source": "both",
                "shotFired": shot_fired,
                "timestamp": datetime.now().isoformat()
            }
            
            # Add Tapo images if available
            if tapo_original_frame is not None:
                _, tapo_original_buffer = cv2.imencode('.jpg', tapo_original_frame)
                tapo_original_base64 = base64.b64encode(tapo_original_buffer).decode('utf-8')
                detection_data["tapo_original_image"] = f"data:image/jpeg;base64,{tapo_original_base64}"
                
                if tapo_zoomed_frame is not None and tapo_zoomed_frame is not tapo_original_frame:
                    _, tapo_zoomed_buffer = cv2.imencode('.jpg', tapo_zoomed_frame)
                    tapo_zoomed_base64 = base64.b64encode(tapo_zoomed_buffer).decode('utf-8')
                    detection_data["tapo_zoomed_image"] = f"data:image/jpeg;base64,{tapo_zoomed_base64}"
                else:
                    # If no zoom, use original as zoomed
                    detection_data["tapo_zoomed_image"] = detection_data["tapo_original_image"]
                
                # Store image info
                detection_data["tapo_image_info"] = {
                    "original_size": {
                        "width": tapo_original_frame.shape[1],
                        "height": tapo_original_frame.shape[0]
                    },
                    "zoomed_size": {
                        "width": tapo_zoomed_frame.shape[1] if tapo_zoomed_frame is not None and tapo_zoomed_frame is not tapo_original_frame else tapo_original_frame.shape[1],
                        "height": tapo_zoomed_frame.shape[0] if tapo_zoomed_frame is not None and tapo_zoomed_frame is not tapo_original_frame else tapo_original_frame.shape[0]
                    }
                }
            
            # Add Raspberry Pi images if available
            if raspberry_pi_original_frame is not None:
                _, pi_original_buffer = cv2.imencode('.jpg', raspberry_pi_original_frame)
                pi_original_base64 = base64.b64encode(pi_original_buffer).decode('utf-8')
                detection_data["raspberry_pi_original_image"] = f"data:image/jpeg;base64,{pi_original_base64}"
                
                if raspberry_pi_zoomed_frame is not None and raspberry_pi_zoomed_frame is not raspberry_pi_original_frame:
                    _, pi_zoomed_buffer = cv2.imencode('.jpg', raspberry_pi_zoomed_frame)
                    pi_zoomed_base64 = base64.b64encode(pi_zoomed_buffer).decode('utf-8')
                    detection_data["raspberry_pi_zoomed_image"] = f"data:image/jpeg;base64,{pi_zoomed_base64}"
                else:
                    # If no zoom, use original as zoomed
                    detection_data["raspberry_pi_zoomed_image"] = detection_data["raspberry_pi_original_image"]
                
                # Store image info
                detection_data["raspberry_pi_image_info"] = {
                    "original_size": {
                        "width": raspberry_pi_original_frame.shape[1],
                        "height": raspberry_pi_original_frame.shape[0]
                    },
                    "zoomed_size": {
                        "width": raspberry_pi_zoomed_frame.shape[1] if raspberry_pi_zoomed_frame is not None and raspberry_pi_zoomed_frame is not raspberry_pi_original_frame else raspberry_pi_original_frame.shape[1],
                        "height": raspberry_pi_zoomed_frame.shape[0] if raspberry_pi_zoomed_frame is not None and raspberry_pi_zoomed_frame is not raspberry_pi_original_frame else raspberry_pi_original_frame.shape[0]
                    }
                }
            
            # Send to internal API endpoint
            headers = {'Authorization': f'Bearer {self.service_token}'}
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.api_url}/api/hardware/detection",
                    json=detection_data,
                    headers=headers
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        logger.info(f"Combined detection saved for device {device_ip}: {len(all_detections)} objects from both cameras")
                        await self.update_device_last_detection(device_id)
                    else:
                        logger.error(f"Failed to save combined detection for device {device_ip}: {response.status}")
            
            return target_bird
                        
        except Exception as e:
            logger.error(f"Error saving combined detection: {e}")
            return None
    
    async def save_detection_to_db(self, device: Dict, original_frame: np.ndarray, zoomed_frame: np.ndarray, cv_result: Dict, camera_source: str = 'unknown', shot_fired: bool = False):
        """Save detection to database via API with both images and detailed detection info. shot_fired: whether monitor was armed (shot fired for this detection)."""
        try:
            device_id = device.get('_id') or device.get('deviceId')
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
            # Encode both frames as JPEG
            _, original_buffer = cv2.imencode('.jpg', original_frame)
            _, zoomed_buffer = cv2.imencode('.jpg', zoomed_frame)
            
            original_image_base64 = base64.b64encode(original_buffer).decode('utf-8')
            zoomed_image_base64 = base64.b64encode(zoomed_buffer).decode('utf-8')
            
            # Get zoom factor for context
            zoom_factor = 1.0
            actions = device.get('actions', {})
            if actions.get('mode') == 'route':
                route_coordinates = actions.get('route', {}).get('coordinates', [])
                taubenschiesser_config = device.get('taubenschiesser', {})
                device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
                route_index = self.movement_queue.get(device_ip, 0) if device_ip else 0
                if route_index < len(route_coordinates):
                    zoom_factor = route_coordinates[route_index].get('zoom', 1.0)
            
            # Find target bird (highest confidence bird)
            detections = cv_result.get('detections', [])
            target_bird = None
            if detections:
                birds = [d for d in detections if d.get('class') == 'bird']
                if birds:
                    # Sort by confidence and take the highest
                    target_bird = max(birds, key=lambda x: x.get('confidence', 0))
                    target_bird['camera_source'] = camera_source  # for FOV selection in trigger_shoot
                    logger.info(f"🎯 Target bird selected ({camera_source}): confidence={target_bird.get('confidence', 0):.2f}, bbox={target_bird.get('bbox')}")

            # Store image info for angle calculations
            image_info = {
                "original_size": {
                    "width": original_frame.shape[1],
                    "height": original_frame.shape[0]
                },
                "zoomed_size": {
                    "width": zoomed_frame.shape[1],
                    "height": zoomed_frame.shape[0]
                }
            }
            self.last_image_info = image_info
            
            # Get current temperature for this device
            current_temperature = await self.get_temperature_for_device(device)
            
            # Log temperature result
            if current_temperature is not None:
                logger.info(f"🌡️ Temperatur für Detection abgerufen: {current_temperature}°C (Device: {device.get('_id')})")
            else:
                logger.warning(f"⚠️ Keine Temperatur für Detection abgerufen (Device: {device.get('_id')}) - Wetter-API möglicherweise nicht konfiguriert oder Fehler")
            
            # Get camera position: prefer route target position (what we commanded), fallback to MQTT-reported position
            camera_position = None
            actions = device.get('actions', {})
            route_coordinates = actions.get('route', {}).get('coordinates', [])
            route_index = self.movement_queue.get(device_ip, 0) if device_ip else 0
            if actions.get('mode') == 'route' and route_coordinates and route_index < len(route_coordinates):
                # Use the route target position we just drove to (avoids wrong position from MQTT timing)
                original_rotation = route_coordinates[route_index].get('rotation', 0)
                original_tilt = route_coordinates[route_index].get('tilt', 0)
                rot, tilt = self.apply_position_inversion(device, int(original_rotation), int(original_tilt))
                camera_position = {'rotation': rot, 'tilt': tilt}
                logger.info(f"📐 Kamera-Position für Detection (Route-Ziel): Rot={rot}°, Tilt={tilt}° (Device: {device.get('_id')}, Route-Punkt {route_index + 1})")
            elif device_ip and device_ip in self.device_positions:
                position_data = self.device_positions[device_ip]
                rot = position_data.get('rot')
                tilt = position_data.get('tilt')
                if rot is not None and tilt is not None:
                    camera_position = {'rotation': rot, 'tilt': tilt}
                    logger.info(f"📐 Kamera-Position für Detection (MQTT): Rot={rot}°, Tilt={tilt}° (Device: {device.get('_id')})")
                else:
                    logger.debug(f"⚠️ Keine Kamera-Position verfügbar für Device {device_ip}")
            else:
                logger.debug(f"⚠️ Keine Kamera-Position: Device {device_ip} nicht in Route und nicht in device_positions")

            # esp_rot/esp_tilt are not stored; they are computed on demand when returning detections for the UI (same logic as shoot).

            # Prepare detailed detection data
            detection_data = {
                "deviceId": device_id,
                "original_image": f"data:image/jpeg;base64,{original_image_base64}",
                "zoomed_image": f"data:image/jpeg;base64,{zoomed_image_base64}",
                "detections": cv_result.get('detections', []),
                "target_bird": target_bird,  # Which bird was targeted for shooting (with esp_rot, esp_tilt)
                "bird_count": cv_result.get('bird_count', 0),
                "confidence_level": cv_result.get('confidence_level', 0),
                "processing_time": cv_result.get('processing_time', 0),
                "zoom_factor": zoom_factor,
                "image_info": image_info,
                "camera_source": camera_source,  # Store which camera detected this
                "temperature": current_temperature,  # Add temperature
                "camera_position": camera_position,  # Add camera position (rotation/tilt)
                "shotFired": shot_fired,  # Whether monitor was armed and shot was fired for this detection
                "timestamp": datetime.now().isoformat()
            }
            
            # Send to internal API endpoint for hardware monitor
            headers = {'Authorization': f'Bearer {self.service_token}'}
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.api_url}/api/hardware/detection",
                    json=detection_data,
                    headers=headers
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        saved_detections = cv_result.get('detections', [])
                        saved_classes = [d.get('class', 'unknown') for d in saved_detections]
                        temp_info = f", Temperatur: {current_temperature}°C" if current_temperature is not None else ", Temperatur: N/A"
                        logger.info(f"✅ Detection saved to database for device {device_ip} ({camera_source}): {result.get('detection_count', 0)} objects, classes={saved_classes}, zoom: {zoom_factor}x{temp_info}")
                        
                        # Update device last detection time
                        await self.update_device_last_detection(device_id)
                        
                    else:
                        error_text = await response.text()
                        logger.error(f"❌ Failed to save detection to database for device {device_ip} ({camera_source}): {response.status} - {error_text}")
            
            return target_bird
                        
        except Exception as e:
            logger.error(f"Error saving detection to database ({camera_source}): {e}")
            return None
    
    async def get_temperature_for_device(self, device: Dict) -> Optional[float]:
        """Holt die aktuelle Temperatur für ein Gerät basierend auf User-Settings"""
        try:
            # Zuerst versuchen, User-Settings zu holen
            owner_id = device.get('owner')
            if not owner_id:
                logger.warning(f"Device {device.get('_id')} hat keinen Owner, überspringe Temperaturabfrage")
                return None
            
            headers = {'Authorization': f'Bearer {self.service_token}'}
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.api_url}/api/users/{owner_id}/settings",
                    headers=headers
                ) as user_response:
                    if user_response.status == 200:
                        user_data = await user_response.json()
                        weather_settings = user_data.get('settings', {}).get('weather', {})
                        
                        if weather_settings.get('enabled') and weather_settings.get('apiKey'):
                            logger.info(f"🌡️ Wetter-API konfiguriert für User {owner_id}, rufe Temperatur ab...")
                            # Verwende User-Settings
                            provider = weather_settings.get('provider', 'openweathermap')
                            api_key = weather_settings.get('apiKey')
                            location = weather_settings.get('location', {})
                            lat = location.get('lat')
                            lng = location.get('lng')
                            
                            if lat and lng:
                                logger.info(f"📍 Koordinaten: lat={lat}, lng={lng}, Provider={provider}")
                                temperature = await self._fetch_temperature_from_api(provider, api_key, lat, lng)
                                if temperature is not None:
                                    logger.info(f"✅ Temperatur erfolgreich abgerufen: {temperature}°C")
                                    return temperature
                                else:
                                    logger.warning(f"❌ Temperatur-Abfrage fehlgeschlagen für User {owner_id}")
                            else:
                                logger.warning(f"User {owner_id} hat keine Koordinaten in Wetter-Settings (lat: {lat}, lng: {lng})")
                        else:
                            enabled = weather_settings.get('enabled', False)
                            has_key = bool(weather_settings.get('apiKey'))
                            logger.debug(f"Wetter-API nicht aktiviert (enabled: {enabled}) oder kein API-Key (has_key: {has_key}) für User {owner_id}")
                    else:
                        logger.warning(f"Konnte User-Settings nicht abrufen: {user_response.status}")
                        error_text = await user_response.text()
                        logger.warning(f"Fehler-Details: {error_text}")
            
            return None
            
        except Exception as e:
            logger.error(f"Fehler beim Abrufen der Temperatur: {e}")
            return None

    async def _fetch_temperature_from_api(self, provider: str, api_key: str, lat: float, lng: float) -> Optional[float]:
        """Holt Temperatur von Wetter-API"""
        try:
            if provider == 'openweathermap':
                url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lng}&appid={api_key}&units=metric"
            elif provider == 'weatherapi':
                url = f"http://api.weatherapi.com/v1/current.json?key={api_key}&q={lat},{lng}"
            else:
                logger.error(f"Unbekannter Wetter-API Provider: {provider}")
                return None
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        if provider == 'openweathermap':
                            temperature = data.get('main', {}).get('temp')
                        elif provider == 'weatherapi':
                            temperature = data.get('current', {}).get('temp_c')
                        
                        if temperature is not None:
                            logger.info(f"🌡️ Temperatur abgerufen: {temperature}°C (Provider: {provider})")
                            return float(temperature)
                        else:
                            logger.warning(f"⚠️ Temperatur nicht in API-Antwort gefunden. Response: {json.dumps(data, indent=2)[:500]}")
                    else:
                        error_text = await response.text()
                        logger.error(f"❌ Wetter-API Fehler: {response.status} - {error_text}")
                        # Log more details for debugging
                        try:
                            error_data = json.loads(error_text)
                            logger.error(f"❌ API-Fehler-Details: {json.dumps(error_data, indent=2)}")
                        except:
                            logger.error(f"❌ API-Fehler-Text: {error_text}")
            
            return None
            
        except asyncio.TimeoutError:
            logger.error("Timeout beim Abrufen der Temperatur")
            return None
        except Exception as e:
            logger.error(f"Fehler beim Abrufen der Temperatur von API: {e}")
            return None
    
    async def update_device_last_detection(self, device_id: str):
        """Update device last detection time"""
        try:
            headers = {'Authorization': f'Bearer {self.service_token}'}
            async with aiohttp.ClientSession() as session:
                async with session.put(
                    f"{self.api_url}/api/devices/{device_id}",
                    json={"lastDetection": datetime.now().isoformat()},
                    headers=headers
                ) as response:
                    if response.status == 200:
                        logger.debug(f"Updated last detection time for device {device_id}")
                    else:
                        logger.warning(f"Failed to update last detection time for device {device_id}: {response.status}")
                        
        except Exception as e:
            logger.error(f"Error updating device last detection: {e}")
    
    def _enrich_detections_esp_angles(
        self,
        device: Dict,
        detections: List[Dict],
        target_bird: Optional[Dict],
        image_info: Dict,
        zoom_factor: float,
        current_rotation: float,
        current_tilt: float,
        camera_source: Optional[str] = None,
    ) -> None:
        """Add esp_rot, esp_tilt and is_target_bird (uses shared cv-service angle_helper)."""
        camera_position = {'rotation': current_rotation, 'tilt': current_tilt}
        camera_config = device.get('camera', {}) or {}
        raspberry_pi_image_info = image_info.get('raspberry_pi') if isinstance(image_info.get('raspberry_pi'), dict) else None
        shared_enrich_detections_esp_angles(
            detections,
            target_bird,
            camera_position,
            image_info,
            zoom_factor,
            camera_config,
            camera_source,
            raspberry_pi_image_info,
        )

    async def trigger_shoot(self, device: Dict, target_bird: Dict = None):
        """Trigger shoot on device, optionally aiming at target bird first"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            owner_id = device.get('owner')
            mqtt_client = await self.get_mqtt_client_for_user(owner_id)
            
            if not mqtt_client:
                logger.warning(f"No MQTT client available for user {owner_id}, skipping shoot")
                return
            
            topic = f"taubenschiesser/{device_ip}"
            
            # If we have a target bird, aim at it first
            if target_bird and target_bird.get('bbox'):
                logger.info(f"🎯 Aiming at target bird before shooting...")
                
                # Get current position from device state
                # TODO: We need to track current position - for now use route position
                actions = device.get('actions', {})
                if actions.get('mode') == 'route':
                    route_coordinates = actions.get('route', {}).get('coordinates', [])
                    route_index = self.movement_queue.get(device_ip, 0) if device_ip else 0
                    if route_index < len(route_coordinates):
                        current_pos = route_coordinates[route_index]
                        original_rotation = current_pos.get('rotation', 0)
                        original_tilt = current_pos.get('tilt', 0)
                        # Apply position inversion if enabled
                        current_rotation, current_tilt = self.apply_position_inversion(device, original_rotation, original_tilt)
                        zoom_factor = current_pos.get('zoom', 1.0)
                        
                        # Calculate adjustment needed
                        # BBox is from zoomed image
                        camera_config = device.get('camera', {})
                        use_local = camera_config.get('useLocalImage', False)
                        
                        # Get image dimensions (zoomed image dimensions)
                        # For zoom 3x on 1280x720: zoomed is ~426x240
                        # But bbox is relative to zoomed image
                        image_info = getattr(self, 'last_image_info', {})
                        zoomed_size = image_info.get('zoomed_size', {})
                        img_width = zoomed_size.get('width', 426)
                        img_height = zoomed_size.get('height', 240)

                        # Use FOV from device settings for the camera that produced target_bird
                        cam_source = target_bird.get('camera_source') if isinstance(target_bird, dict) else None

                        camera_config = device.get('camera', {}) or {}
                        rot_adjust, tilt_adjust = shared_calculate_angle_adjustment(
                            target_bird['bbox'],
                            img_width,
                            img_height,
                            zoom_factor,
                            camera_config,
                            cam_source,
                        )
                        
                        # Calculate new position (absolute degrees; ESP "move" expects absolute, not relative)
                        target_rotation = current_rotation + rot_adjust
                        target_tilt = current_tilt + tilt_adjust

                        logger.info(f"🎯 Moving from ({current_rotation}°, {current_tilt}°) to ({target_rotation:.1f}°, {target_tilt:.1f}°)")

                        # Move to target (ESP interprets "move" as absolute rot/tilt)
                        aim_command = {
                            "type": "move",
                            "position": {
                                "rot": int(target_rotation),
                                "tilt": int(target_tilt)
                            },
                            "speed": 1
                        }
                        mqtt_client.publish(topic, json.dumps(aim_command))
                        self.device_moving[device_ip] = True
                        
                        # Wait for movement
                        await self.wait_for_movement_complete(device_ip, timeout=10)
                        await asyncio.sleep(0.5)  # Brief stabilization
                        
                        # Shoot (duration from device settings)
                        duration_ms = device.get("taubenschiesser", {}).get("shootingTimeMs", 500)
                        shoot_command = {
                            "type": "shoot",
                            "duration": duration_ms
                        }
                        mqtt_payload = json.dumps(shoot_command)
                        mqtt_client.publish(topic, mqtt_payload)
                        logger.info(f"💥 Shot fired at target bird! (duration: {duration_ms} ms)")
                        logger.info(f"📤 MQTT shoot: topic={topic} payload={mqtt_payload}")
                        
                        await asyncio.sleep(1.5)  # Wait for shoot to complete
                        
                        # Return to original position
                        return_command = {
                            "type": "move",
                            "position": {
                                "rot": int(current_rotation),
                                "tilt": int(current_tilt)
                            },
                            "speed": 1
                        }
                        mqtt_client.publish(topic, json.dumps(return_command))
                        self.device_moving[device_ip] = True
                        logger.info(f"🔄 Returning to original position ({current_rotation}°, {current_tilt}°)")
                        
                        await self.wait_for_movement_complete(device_ip, timeout=10)
                        return

            # No shoot: we only shoot when we can aim at a target bird
            device_id = device.get('_id') or device.get('deviceId')
            device_name = device.get('name', 'unknown')
            actions = device.get('actions', {})
            mode = actions.get('mode', 'unknown')
            route_coords = actions.get('route', {}).get('coordinates', [])
            route_index = self.movement_queue.get(device_ip, 0) if device_ip else 0
            has_target = bool(target_bird)
            has_bbox = bool(target_bird and target_bird.get('bbox')) if target_bird else False
            image_info = getattr(self, 'last_image_info', None)
            logger.error(
                "Shoot skipped: no valid target/aim. Only shooting when we can aim at a target bird. "
                "device_ip=%s device_id=%s device_name=%s owner_id=%s "
                "target_bird_present=%s target_bird_has_bbox=%s mode=%s "
                "route_len=%s route_index=%s last_image_info=%s",
                device_ip, device_id, device_name, owner_id,
                has_target, has_bbox, mode,
                len(route_coords), route_index, "yes" if image_info else "no"
            )

        except Exception as e:
            logger.error(f"Error triggering shoot: {e}")
    
    async def monitor_devices(self):
        """Monitor hardware devices and send status updates"""
        while True:
            try:
                # Get list of devices from API
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"{self.api_url}/api/devices") as response:
                        if response.status == 200:
                            devices = await response.json()
                            
                            for device in devices:
                                await self.check_device_status(device)
                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                logger.error(f"Error monitoring devices: {e}")
                await asyncio.sleep(60)
    
    async def check_device_status(self, device: Dict):
        """Check status of a specific device"""
        try:
            device_id = device.get('_id') or device.get('deviceId')
            
            # Simulate hardware communication
            # In real implementation, this would communicate with actual hardware
            status = await self.get_hardware_status(device_id)
            
            if status:
                # Send status update to API
                await self.send_device_status(device_id, status)
                
        except Exception as e:
            logger.error(f"Error checking device {device.get('deviceId', 'unknown')}: {e}")
    
    async def get_hardware_status(self, device_id: str) -> Optional[Dict]:
        """Get status from hardware device"""
        try:
            # Simulate hardware communication
            # In real implementation, this would use actual hardware protocols
            
            return {
                'status': 'online',
                'lastSeen': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting hardware status for {device_id}: {e}")
            return None
    
    async def send_device_status(self, device_id: str, status: Dict):
        """Send device status to API"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.api_url}/api/devices/{device_id}/status",
                    json=status
                ) as response:
                    if response.status == 200:
                        logger.info(f"Status updated for device {device_id}")
                    else:
                        logger.error(f"Failed to update status for device {device_id}: {response.status}")
                        
        except Exception as e:
            logger.error(f"Error sending device status: {e}")
    
    async def process_camera_streams(self):
        """Process camera streams and send images for CV analysis"""
        while True:
            try:
                # Get devices with cameras
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"{self.api_url}/api/devices") as response:
                        if response.status == 200:
                            devices = await response.json()
                            
                            for device in devices:
                                if device.get('camera', {}).get('rtspUrl'):
                                    await self.process_camera_stream(device)
                
                await asyncio.sleep(10)  # Process every 10 seconds
                
            except Exception as e:
                logger.error(f"Error processing camera streams: {e}")
                await asyncio.sleep(30)
    
    async def process_camera_stream(self, device: Dict):
        """Process a single camera stream"""
        try:
            rtsp_url = device.get('camera', {}).get('rtspUrl')
            device_id = device.get('_id') or device.get('deviceId')
            
            # Capture frame from RTSP stream (use API endpoint if device_id available)
            frame = await self.capture_frame(rtsp_url, device_id=device_id)
            
            if frame is not None:
                # Send frame for CV analysis
                await self.send_frame_for_analysis(device_id, frame)
                
        except Exception as e:
            logger.error(f"Error processing camera stream for device {device.get('deviceId', 'unknown')}: {e}")
    
    async def capture_frame_from_http(self, image_url: str) -> Optional[np.ndarray]:
        """Capture a frame from HTTP endpoint (e.g. Raspberry Pi)"""
        try:
            # Increase timeout and add connection timeout
            timeout = aiohttp.ClientTimeout(total=15, connect=5)  # 15s total, 5s connect
            connector = aiohttp.TCPConnector(limit=10, limit_per_host=5)
            async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                logger.debug(f"Fetching image from: {image_url}")
                async with session.get(image_url) as response:
                    if response.status == 200:
                        image_data = await response.read()
                        
                        # Convert bytes to numpy array
                        nparr = np.frombuffer(image_data, np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        
                        if frame is not None:
                            height, width = frame.shape[:2]
                            logger.debug(f"📸 Frame captured from HTTP: {width}x{height} pixels")
                            return frame
                        else:
                            logger.warning(f"❌ Could not decode image from HTTP response")
                            return None
                    else:
                        logger.warning(f"❌ HTTP request failed with status {response.status}")
                        return None
        except asyncio.TimeoutError:
            logger.warning(f"❌ Timeout while fetching image from {image_url}")
            return None
        except Exception as e:
            logger.error(f"❌ Error capturing frame from HTTP: {e}")
            return None
    
    async def capture_frame(self, rtsp_url: str, device_id: str = None) -> Optional[np.ndarray]:
        """Capture a frame from RTSP stream with timeout
        
        If device_id is provided, uses the API endpoint (same as Dashboard) for consistency.
        Otherwise, falls back to direct cv2.VideoCapture.
        """
        # If device_id is provided, use API endpoint (same logic as Dashboard)
        if device_id:
            try:
                logger.debug(f"Using API endpoint to capture frame for device {device_id}")
                timeout = aiohttp.ClientTimeout(total=15, connect=5)
                connector = aiohttp.TCPConnector(limit=10, limit_per_host=5)
                async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                    image_url = f"{self.api_url}/api/device-image/{device_id}"
                    async with session.get(image_url) as response:
                        if response.status == 200:
                            image_data = await response.read()
                            # Convert bytes to numpy array
                            nparr = np.frombuffer(image_data, np.uint8)
                            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                            
                            if frame is not None:
                                height, width = frame.shape[:2]
                                logger.debug(f"📸 Frame captured from API: {width}x{height} pixels")
                                return frame
                            else:
                                logger.warning(f"❌ Could not decode image from API response")
                                # Fall through to direct capture
                        else:
                            logger.warning(f"❌ API request failed with status {response.status}, falling back to direct capture")
                            # Fall through to direct capture
            except Exception as e:
                logger.warning(f"❌ Error using API endpoint: {e}, falling back to direct capture")
                # Fall through to direct capture
        
        # Fallback to direct cv2.VideoCapture
        try:
            # Run synchronous capture in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._capture_frame_sync, rtsp_url),
                timeout=15.0  # 15 second timeout for RTSP capture
            )
        except asyncio.TimeoutError:
            logger.warning(f"❌ Timeout while capturing frame from RTSP stream: {rtsp_url}")
            return None
        except Exception as e:
            logger.error(f"❌ Error capturing frame: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None
    
    def _capture_frame_sync(self, rtsp_url: str) -> Optional[np.ndarray]:
        """Synchronous frame capture (called from async with timeout)"""
        with self.camera_lock:
            cap = cv2.VideoCapture(rtsp_url)
            
            if not cap.isOpened():
                logger.warning(f"❌ Could not open RTSP stream")
                cap.release()
                return None
            
            ret, frame = cap.read()
            
            # Manche Kameras liefern nicht sofort ein gültiges Frame – ein paar Versuche erlauben
            attempt = 1
            while (not ret or frame is None) and attempt < 6:
                time.sleep(0.1)
                ret, frame = cap.read()
                attempt += 1
            
            cap.release()
            
            if ret and frame is not None:
                height, width = frame.shape[:2]
                logger.debug(f"📸 Frame captured from RTSP: {width}x{height} pixels (attempt {attempt})")
                return frame
            else:
                logger.warning(f"❌ Could not read frame from RTSP stream after {attempt} attempts (ret={ret})")
                return None
    
    async def load_local_image(self, image_path: str) -> Optional[np.ndarray]:
        """Load image from local file"""
        try:
            # Support both absolute and relative paths
            if not os.path.isabs(image_path):
                # Relative path - resolve from project root (one level up from hardware-monitor)
                project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                image_path = os.path.join(project_root, image_path)
                logger.info(f"Resolved relative path to: {image_path}")
            
            if not os.path.exists(image_path):
                logger.error(f"❌ Local image file not found: {image_path}")
                return None
            
            # Load image using OpenCV
            frame = cv2.imread(image_path)
            
            if frame is not None:
                height, width = frame.shape[:2]
                logger.info(f"✅ Loaded local image: {width}x{height} pixels from {image_path}")
                return frame
            else:
                logger.error(f"❌ Could not load image from {image_path}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error loading local image: {e}")
            return None
    
    async def send_frame_for_analysis(self, device_id: str, frame: np.ndarray):
        """Send frame to CV service for analysis"""
        try:
            # Encode frame as JPEG
            _, buffer = cv2.imencode('.jpg', frame)
            
            # Create form data
            data = aiohttp.FormData()
            data.add_field('image', buffer.tobytes(), filename='camera.jpg', content_type='image/jpeg')
            data.add_field('deviceId', device_id)
            
            # Send to CV service
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.api_url}/api/cv/detect",
                    data=data
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        logger.info(f"CV analysis completed for device {device_id}: {result.get('detections', [])}")
                    else:
                        logger.error(f"CV analysis failed for device {device_id}: {response.status}")
                        
        except Exception as e:
            logger.error(f"Error sending frame for analysis: {e}")
    
    async def health_check(self):
        """Health check for the service"""
        while True:
            try:
                # Check API connectivity with proper endpoint
                headers = {'Authorization': f'Bearer {self.service_token}'}
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"{self.api_url}/api/devices", headers=headers) as response:
                        if response.status == 200:
                            logger.info("Health check: API is reachable")
                        else:
                            logger.warning(f"Health check: API returned status {response.status}")
                
                await asyncio.sleep(300)  # Check every 5 minutes
                
            except Exception as e:
                logger.error(f"Health check failed: {e}")
                await asyncio.sleep(60)

async def main():
    """Main function"""
    monitor = HardwareMonitor()
    await monitor.start()

if __name__ == "__main__":
    asyncio.run(main())

# HardwareMonitor class is available for import
