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
from datetime import datetime
from typing import Dict, List, Optional
import cv2
import numpy as np
from threading import Lock
import paho.mqtt.client as mqtt
import threading
import base64

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
        self.device_last_seen = {}  # Track last MQTT message
        self.movement_queue = {}    # Queue movements per device
        self.device_movement_start = {}  # Track when movement started
        
        # Thread safety
        self.camera_lock = Lock()
        
        # MQTT listener for receiving messages
        self.mqtt_listener = None
        
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
        
        # Start monitoring tasks
        tasks = [
            asyncio.create_task(self.monitor_devices()),
            asyncio.create_task(self.process_camera_streams()),
            asyncio.create_task(self.taubenschiesser_control_loop())
        ]
        
        await asyncio.gather(*tasks)
    
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
            self.device_moving[device_ip] = is_moving
            self.device_last_seen[device_ip] = datetime.now()
            
            # If device is no longer moving, clear the movement start time
            if not is_moving and device_ip in self.device_movement_start:
                del self.device_movement_start[device_ip]
                # Also clear the device_moving status to allow immediate next movement
                self.device_moving[device_ip] = False
            
            logger.debug(f"Device {device_ip} position: Rot={payload.get('Rot')}, Tilt={payload.get('Tilt')}, Moving={payload.get('moving')}")
            
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
        
        while True:
            try:
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
                                
                                # Only process devices with monitorStatus: 'running'
                                if device.get('monitorStatus') == 'running':
                                    # logger.info(f"Processing device {device.get('_id')} with status: {device.get('monitorStatus')}")
                                    await self.process_taubenschiesser_device(device)
                                else:
                                    logger.debug(f"Skipping device {device.get('_id')} with status: {device.get('monitorStatus')}")
                        elif response.status == 429:
                            logger.warning("Rate limited, waiting longer...")
                            await asyncio.sleep(60)  # Wait 1 minute if rate limited
                            continue
                        else:
                            logger.error(f"API error: {response.status}")
                
                await asyncio.sleep(10)  # Check every 60 seconds
                
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
            
            # Check if device is online (received MQTT message recently)
            # Note: We don't require MQTT messages to start moving - the device might not send continuous updates
            if device_ip not in self.device_last_seen:
                logger.info(f"ℹ️ Device {device_ip} not seen via MQTT yet - will proceed with movement anyway")
                # Set a default last_seen timestamp to allow movement
                self.device_last_seen[device_ip] = datetime.now()
            
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
                        return
                else:
                    logger.info(f"⏸️ Device {device_ip} is moving, skipping")
                    return
            
            # Note: Device active check is handled by monitorStatus field
            # Devices with monitorStatus != 'running' are already filtered out
            
            # Check sleep mode
            if device.get('sleep', False):
                logger.info(f"⏸️ Device {device_ip} in sleep mode")
                return
            
            # Check if it's time to move
            last_seen = self.device_last_seen.get(device_ip)
            time_since_last_seen = (datetime.now() - last_seen).total_seconds() if last_seen else 0
            #logger.info(f"⏱️ Time since last MQTT message: {time_since_last_seen:.1f}s")
            
            # Smart timeout: 20s if device responds, 30s if no response
            timeout_threshold = 20 if last_seen else 30
            
            if last_seen and time_since_last_seen > timeout_threshold:
                await self.move_device(device, time_since_last_seen)
            elif not last_seen:
                # Device is offline - skip all processing
                logger.info(f"ℹ️ Device {device_ip} not seen via MQTT yet - will proceed with movement anyway")
                # Proceed anyway for first-time setup
                await self.move_device(device)
                return
            else:
                logger.info(f"⏳ Waiting for {timeout_threshold}s inactivity period (current: {time_since_last_seen:.1f}s)")
            
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
            # Wait additional 2 seconds for camera/device to stabilize
            logger.info(f"⏱️ Waiting 2s for device {device_ip} to stabilize...")
            await asyncio.sleep(2)
            await self.analyze_after_movement(device)
            
        except Exception as e:
            logger.error(f"Error moving device step: {e}")
    
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
            
            # Send move command
            command = {
                "type": "move",
                "position": {
                    "rot": route_item.get('rotation', 0),
                    "tilt": route_item.get('tilt', 0)
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
                logger.info(f"🚀 Moving device {device_ip} - no activity for {time_since_last_seen:.1f}s 📍 Route: rotation={route_item.get('rotation')}, tilt={route_item.get('tilt')} (user: {owner_id})")
            else:
                logger.info(f"📍 Sent route command to device {device_ip}: rotation={route_item.get('rotation')}, tilt={route_item.get('tilt')} (user: {owner_id})")
            
            # Wait for movement to complete before analyzing
            await self.wait_for_movement_complete(device_ip)
            # Wait additional 2 seconds for camera/device to stabilize
            logger.info(f"⏱️ Waiting 2s for device {device_ip} to stabilize...")
            await asyncio.sleep(2)
            await self.analyze_after_movement(device)
            
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
    
    async def analyze_after_movement(self, device: Dict):
        """Analyze camera after movement"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            
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
            
            # Check if using local image file instead of camera
            use_local_image = camera_config.get('useLocalImage', False)
            local_image_path = camera_config.get('localImagePath', '')
            
            if use_local_image and local_image_path:
                # Use local image file
                logger.info(f"📁 Using local image file for device {device_ip}: {local_image_path}")
                original_frame = await self.load_local_image(local_image_path)
            else:
                # Use camera/RTSP stream
                rtsp_url = camera_config.get('rtspUrl')
                
                # If no direct RTSP URL, check for Tapo camera
                if not rtsp_url and camera_config.get('type') == 'tapo':
                    tapo_config = camera_config.get('tapo', {})
                    if tapo_config:
                        tapo_ip = tapo_config.get('ip')
                        tapo_username = tapo_config.get('username')
                        tapo_password = tapo_config.get('password')
                        tapo_stream = tapo_config.get('stream', 'stream1')
                        
                        if tapo_ip and tapo_username and tapo_password:
                            # Construct RTSP URL for Tapo camera
                            rtsp_url = f"rtsp://{tapo_username}:{tapo_password}@{tapo_ip}:554/{tapo_stream}"
                            logger.info(f"Using Tapo camera RTSP URL for device {device_ip}")
                        else:
                            logger.warning(f"Tapo camera configuration incomplete for device {device_ip}")
                            return
                    else:
                        logger.warning(f"No Tapo camera configuration for device {device_ip}")
                        return
                elif not rtsp_url:
                    logger.warning(f"No camera configured for device {device_ip}")
                    return
                
                # Capture frame from camera
                logger.info(f"📷 Attempting to capture frame from device {device_ip}")
                original_frame = await self.capture_frame(rtsp_url)
            
            if original_frame is not None:
                height, width = original_frame.shape[:2]
                logger.info(f"✅ Frame captured successfully: {width}x{height} pixels")
                
                # Apply zoom if in route mode
                zoomed_frame = await self.apply_zoom_to_frame(device, original_frame)
                
                # Analyze with CV service (using zoomed frame for better detection)
                await self.analyze_frame_for_birds(device, original_frame, zoomed_frame)
            else:
                logger.warning(f"❌ Could not capture frame from device {device_ip}")
                
        except Exception as e:
            logger.error(f"Error analyzing after movement: {e}")
    
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
    
    async def analyze_frame_for_birds(self, device: Dict, original_frame: np.ndarray, zoomed_frame: np.ndarray):
        """Analyze frame for birds and trigger shoot if found"""
        try:
            # Get IP from taubenschiesser.ip (nested structure)
            taubenschiesser_config = device.get('taubenschiesser', {})
            device_ip = taubenschiesser_config.get('ip') if isinstance(taubenschiesser_config, dict) else None
            device_id = device.get('_id') or device.get('deviceId')
            
            # Use zoomed frame for better detection
            _, buffer = cv2.imencode('.jpg', zoomed_frame)
            
            logger.info(f"🔍 Sending frame to CV service for analysis (device: {device_ip})")
            
            # Send to CV service
            async with aiohttp.ClientSession() as session:
                data = aiohttp.FormData()
                data.add_field('file', buffer.tobytes(), filename='camera.jpg', content_type='image/jpeg')
                
                async with session.post(
                    f"{self.cv_service_url}/detect_birds_optimized",
                    data=data
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        
                        # Log CV service response details
                        bird_count = result.get('bird_count', 0)
                        detections = result.get('detections', [])
                        processing_time = result.get('processing_time', 0)
                        
                        # Log detections only if objects found
                        if detections:
                            logger.info(f"🤖 CV Analysis: {bird_count} birds found, processing time: {processing_time:.2f}s")
                            for idx, detection in enumerate(detections, 1):
                                obj_class = detection.get('class', 'unknown')
                                confidence = detection.get('confidence', 0)
                                logger.info(f"  Detection #{idx}: {obj_class} (confidence: {confidence:.2f})")
                        else:
                            logger.info(f"🤖 CV Analysis: No objects detected (processing time: {processing_time:.2f}s)")
                        
                        if result.get('birds_found', False):
                            confidence = result.get('confidence_level', 0)
                            
                            logger.info(f"🦅 BIRDS DETECTED on device {device_ip}: {bird_count} birds, max confidence: {confidence:.2f}")
                            
                            # Save detection to database with both images and detailed info
                            target_bird = await self.save_detection_to_db(device, original_frame, zoomed_frame, result)
                            
                            # Trigger shoot with targeting
                            await self.trigger_shoot(device, target_bird=target_bird)
                    else:
                        logger.error(f"❌ CV analysis failed for device {device_ip}: HTTP {response.status}")
                        
        except Exception as e:
            logger.error(f"Error analyzing frame for birds: {e}")
    
    async def save_detection_to_db(self, device: Dict, original_frame: np.ndarray, zoomed_frame: np.ndarray, cv_result: Dict):
        """Save detection to database via API with both images and detailed detection info"""
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
                    logger.info(f"🎯 Target bird selected: confidence={target_bird.get('confidence', 0):.2f}, bbox={target_bird.get('bbox')}")
            
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
            
            # Prepare detailed detection data
            detection_data = {
                "deviceId": device_id,
                "original_image": f"data:image/jpeg;base64,{original_image_base64}",
                "zoomed_image": f"data:image/jpeg;base64,{zoomed_image_base64}",
                "detections": cv_result.get('detections', []),
                "target_bird": target_bird,  # Which bird was targeted for shooting
                "bird_count": cv_result.get('bird_count', 0),
                "confidence_level": cv_result.get('confidence_level', 0),
                "processing_time": cv_result.get('processing_time', 0),
                "zoom_factor": zoom_factor,
                "image_info": image_info,
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
                        logger.info(f"Detection saved to database for device {device_ip}: {result.get('detection_count', 0)} objects, zoom: {zoom_factor}x")
                        
                        # Update device last detection time
                        await self.update_device_last_detection(device_id)
                        
                    else:
                        logger.error(f"Failed to save detection to database for device {device_ip}: {response.status}")
            
            return target_bird
                        
        except Exception as e:
            logger.error(f"Error saving detection to database: {e}")
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
    
    def calculate_angle_adjustment(self, bbox: Dict, image_width: int, image_height: int, zoom_factor: float = 1.0) -> tuple:
        """Calculate rotation and tilt adjustment needed to center the target"""
        try:
            # Get bbox center in pixels
            bbox_center_x = bbox.get('x', 0) + bbox.get('width', 0) / 2
            bbox_center_y = bbox.get('y', 0) + bbox.get('height', 0) / 2
            
            # Image center
            image_center_x = image_width / 2
            image_center_y = image_height / 2
            
            # Calculate pixel offset from center
            offset_x = bbox_center_x - image_center_x
            offset_y = bbox_center_y - image_center_y
            
            # Convert pixel offset to degrees
            # Assuming: 1280x720 image ≈ 60° horizontal FOV, 34° vertical FOV (typical for Tapo)
            # Adjust for zoom - higher zoom = narrower FOV
            horizontal_fov = 60.0 / zoom_factor
            vertical_fov = 34.0 / zoom_factor
            
            degrees_per_pixel_x = horizontal_fov / image_width
            degrees_per_pixel_y = vertical_fov / image_height
            
            rotation_adjustment = offset_x * degrees_per_pixel_x
            tilt_adjustment = -offset_y * degrees_per_pixel_y  # Negative because y increases downward
            
            logger.info(f"📐 Angle calculation: offset=({offset_x:.1f}, {offset_y:.1f})px, adjustment=({rotation_adjustment:.2f}°, {tilt_adjustment:.2f}°)")
            
            return rotation_adjustment, tilt_adjustment
            
        except Exception as e:
            logger.error(f"Error calculating angle adjustment: {e}")
            return 0, 0
    
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
                        current_rotation = current_pos.get('rotation', 0)
                        current_tilt = current_pos.get('tilt', 0)
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
                        
                        rot_adjust, tilt_adjust = self.calculate_angle_adjustment(
                            target_bird['bbox'], 
                            img_width, 
                            img_height,
                            zoom_factor
                        )
                        
                        # Calculate new position
                        target_rotation = current_rotation + rot_adjust
                        target_tilt = current_tilt + tilt_adjust
                        
                        logger.info(f"🎯 Moving from ({current_rotation}°, {current_tilt}°) to ({target_rotation:.1f}°, {target_tilt:.1f}°)")
                        
                        # Move to target
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
                        
                        # Shoot
                        shoot_command = {
                            "type": "shoot",
                            "duration": 300
                        }
                        mqtt_client.publish(topic, json.dumps(shoot_command))
                        logger.info(f"💥 Shot fired at target bird!")
                        
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
            
            # Fallback: Simple shoot without aiming
            command = {
                "type": "shoot",
                "duration": 1000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps(command))
            logger.info(f"💥 Triggered shoot on device {device_ip} (no aiming, user: {owner_id})")
            
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
            
            # Capture frame from RTSP stream
            frame = await self.capture_frame(rtsp_url)
            
            if frame is not None:
                # Send frame for CV analysis
                await self.send_frame_for_analysis(device_id, frame)
                
        except Exception as e:
            logger.error(f"Error processing camera stream for device {device.get('deviceId', 'unknown')}: {e}")
    
    async def capture_frame(self, rtsp_url: str) -> Optional[np.ndarray]:
        """Capture a frame from RTSP stream"""
        try:
            with self.camera_lock:
                cap = cv2.VideoCapture(rtsp_url)
                
                if not cap.isOpened():
                    logger.warning(f"❌ Could not open RTSP stream")
                    return None
                
                ret, frame = cap.read()
                cap.release()
                
                if ret and frame is not None:
                    height, width = frame.shape[:2]
                    logger.debug(f"📸 Frame captured from RTSP: {width}x{height} pixels")
                    return frame
                else:
                    logger.warning(f"❌ Could not read frame from RTSP stream (ret={ret})")
                    return None
                    
        except Exception as e:
            logger.error(f"❌ Error capturing frame: {e}")
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
