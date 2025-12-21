const mqtt = require('mqtt');
const axios = require('axios');
const logger = require('./logger');
const awsIotHelper = require('./awsIotHelper');
const rtspFrameManager = require('./rtspFrameManager');

class HardwareHelper {
  constructor() {
    this.mqttClients = new Map();
    this.CV_SERVICE_URL = process.env.CV_SERVICE_URL || 'http://localhost:8000';
    this.useAwsIot = awsIotHelper.isEnabled();
    this.deviceMovementWaiters = new Map(); // Map<deviceIp, Array<{resolve,reject,timeout,seenMoving}>>
    this.subscribedTopics = new Set();
    
    if (this.useAwsIot) {
      logger.info('Hardware Helper initialized with AWS IoT Core support');
    } else {
      logger.info('Hardware Helper initialized with local MQTT support');
    }
  }

  /**
   * Get or create MQTT client for a user
   * Falls back to local MQTT if AWS IoT is not available
   */
  async getMqttClient(userId, settings) {
    const clientKey = `user_${userId}`;
    
    if (this.mqttClients.has(clientKey)) {
      return this.mqttClients.get(clientKey);
    }

    try {
      const broker = settings.mqtt?.broker || 'localhost';
      const port = settings.mqtt?.port || 1883;
      const username = settings.mqtt?.username || '';
      const password = settings.mqtt?.password || '';

      const client = mqtt.connect(`mqtt://${broker}:${port}`, {
        username,
        password,
        clientId: `server_hardware_helper_${userId}_${Date.now()}`
      });

      client.on('message', (topic, message) => {
        this.handleMqttMessage(topic, message);
      });

      await new Promise((resolve, reject) => {
        client.on('connect', () => {
          logger.info(`MQTT client connected for user ${userId}`);
          client.subscribe('taubenschiesser/+/info', (err) => {
            if (err) {
              logger.error('Failed to subscribe to taubenschiesser/+/info:', err);
            } else {
              logger.info('Subscribed to taubenschiesser/+/info');
            }
          });
          client.subscribe('taubenschiesser/info', (err) => {
            if (err) {
              logger.error('Failed to subscribe to taubenschiesser/info:', err);
            } else {
              logger.info('Subscribed to taubenschiesser/info');
            }
          });
          resolve();
        });
        client.on('error', (error) => {
          logger.error(`MQTT connection error for user ${userId}:`, error);
          reject(error);
        });
      });

      this.mqttClients.set(clientKey, client);
      return client;
    } catch (error) {
      logger.error('Failed to create MQTT client:', error);
      throw error;
    }
  }

  handleMqttMessage(topic, message) {
    try {
      if (!topic.startsWith('taubenschiesser/')) {
        return;
      }

      if (!(topic.endsWith('/info') || topic === 'taubenschiesser/info')) {
        return;
      }

      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch (error) {
        logger.warn(`Failed to parse MQTT payload on ${topic}: ${error.message}`);
        return;
      }

      let deviceIp;
      if (topic === 'taubenschiesser/info') {
        deviceIp = payload?.ip;
      } else {
        const parts = topic.split('/');
        deviceIp = parts[1];
      }

      if (!deviceIp) {
        return;
      }

      const isMoving = !!payload?.moving;

      const waiters = this.deviceMovementWaiters.get(deviceIp);
      if (waiters && waiters.length) {
        const remaining = [];
        for (const waiter of waiters) {
          if (isMoving) {
            waiter.seenMoving = true;
            remaining.push(waiter);
          } else if (!waiter.requireMoving || waiter.seenMoving) {
            clearTimeout(waiter.timeout);
            waiter.resolve();
          } else {
            remaining.push(waiter);
          }
        }

        if (remaining.length > 0) {
          this.deviceMovementWaiters.set(deviceIp, remaining);
        } else {
          this.deviceMovementWaiters.delete(deviceIp);
        }
      }
    } catch (error) {
      logger.error('Error handling MQTT message:', error);
    }
  }

  async ensureDeviceSubscription(client, deviceIp) {
    if (!deviceIp || !client) {
      return;
    }

    const topic = `taubenschiesser/${deviceIp}/info`;
    if (this.subscribedTopics.has(topic)) {
      return;
    }

    await new Promise((resolve, reject) => {
      client.subscribe(topic, (err) => {
        if (err) {
          reject(err);
        } else {
          logger.info(`Subscribed to MQTT topic ${topic}`);
          this.subscribedTopics.add(topic);
          resolve();
        }
      });
    });
  }

  waitForMovementViaMqtt(deviceIp, timeoutMs = 35000) {
    return new Promise((resolve) => {
      const waiter = {
        resolve: () => resolve(),
        timeout: setTimeout(() => {
          logger.warn(`Movement MQTT timeout reached for device ${deviceIp}`);
          resolve();
        }, timeoutMs),
        seenMoving: false,
        requireMoving: false
      };

      const waiters = this.deviceMovementWaiters.get(deviceIp) || [];
      waiters.push(waiter);
      this.deviceMovementWaiters.set(deviceIp, waiters);
    });
  }

  /**
   * Move device to specific position
   * Supports both AWS IoT Core and local MQTT
   */
  async moveToPosition(device, rotation, tilt) {
    try {
      const deviceIp = device.taubenschiesser?.ip;
      if (!deviceIp) {
        throw new Error('Device IP not found');
      }

      const command = {
        type: 'move',
        position: {
          rot: parseInt(rotation),
          tilt: parseInt(tilt)
        },
        speed: 1  // Speed 1 for faster, precise positioning (like bird targeting)
      };

      // Use AWS IoT Core if available and device has a name
      if (this.useAwsIot && device.name) {
        logger.info(`Sending move command via AWS IoT to ${device.name}:`, command);
        await awsIotHelper.publishCommand(device.name, command, 'commands');
        logger.info('Move command sent successfully via AWS IoT');
        return { transport: 'aws' };
      }

      // Fall back to local MQTT
      const User = require('../models/User');
      const user = await User.findById(device.owner);
      
      if (!user) {
        throw new Error('Device owner not found');
      }

      const mqttClient = await this.getMqttClient(device.owner, user.settings);
      const topic = `taubenschiesser/${deviceIp}`;

      await this.ensureDeviceSubscription(mqttClient, deviceIp);
      
      logger.info(`Sending move command via local MQTT to ${topic}:`, command);
      
      await new Promise((resolve, reject) => {
        mqttClient.publish(topic, JSON.stringify(command), (error) => {
          if (error) {
            logger.error('Failed to publish MQTT message:', error);
            reject(error);
          } else {
            logger.info('Move command sent successfully via local MQTT');
            resolve();
          }
        });
      });

      return { transport: 'mqtt', deviceIp };
    } catch (error) {
      logger.error('Error moving to position:', error);
      throw error;
    }
  }

  /**
   * Wait for device movement to complete
   */
  async waitForMovementComplete(device, movementContext = {}, options = {}) {
    const timeoutMs = options.timeoutMs || 35000;
    const stabilizationMs = options.stabilizationMs ?? 500;

    if (this.useAwsIot) {
      await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 5000)));
      if (stabilizationMs > 0) {
        await new Promise(resolve => setTimeout(resolve, stabilizationMs));
      }
      return;
    }

    const deviceIp = movementContext.deviceIp || device?.taubenschiesser?.ip;
    if (!deviceIp) {
      logger.warn('No device IP available for movement wait, falling back to timeout');
      await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 3000)));
      if (stabilizationMs > 0) {
        await new Promise(resolve => setTimeout(resolve, stabilizationMs));
      }
      return;
    }

    logger.info(`Waiting for MQTT movement completion for device ${deviceIp}`);
    await this.waitForMovementViaMqtt(deviceIp, timeoutMs);

    if (stabilizationMs > 0) {
      logger.info(`Waiting additional ${stabilizationMs}ms for stabilization`);
      await new Promise(resolve => setTimeout(resolve, stabilizationMs));
    }
  }

  /**
   * Capture frame from camera
   */
  async captureFrame(device) {
    try {
      const camera = device.camera;
      
      if (!camera) {
        throw new Error('No camera configured for device');
      }

      // Check if using local image
      if (camera.useLocalImage && camera.localImagePath) {
        logger.info(`Using local image: ${camera.localImagePath}`);
        // For local images, we would need to read the file
        // For now, we'll return a placeholder or use RTSP if available
        // This is handled by the frontend or CV service
        throw new Error('Local image capture not yet implemented in server');
      }

      // Handle Raspberry Pi camera (HTTP GET)
      if (camera.type === 'raspberry-pi') {
        const pi = camera.raspberryPi;
        if (!pi || !pi.ip) {
          throw new Error('Raspberry Pi camera IP not configured');
        }

        const port = pi.port || 8080;
        const endpoint = pi.endpoint || '/image.jpg';
        const baseUrl = `http://${pi.ip}:${port}${endpoint}`;
        
        // Build query params (flip)
        const queryParams = [];
        if (pi.flip) {
          queryParams.push('flip=true');
        }
        const url = queryParams.length > 0 
          ? `${baseUrl}?${queryParams.join('&')}`
          : baseUrl;

        logger.info(`Capturing frame from Raspberry Pi: ${url}`);
        
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 10000 // 10 second timeout
        });

        if (response.data) {
          // Convert arraybuffer to base64
          const imageBase64 = Buffer.from(response.data, 'binary').toString('base64');
          logger.info('Successfully captured image from Raspberry Pi');
          return imageBase64;
        }

        throw new Error('Failed to capture frame from Raspberry Pi - empty response');
      }

      // Get RTSP URL for other camera types
      // Use device.getRtspUrl() if available (handles tapo, dual, and other types)
      let rtspUrl = null;
      
      if (device.getRtspUrl && typeof device.getRtspUrl === 'function') {
        rtspUrl = device.getRtspUrl();
      } else {
        // Fallback: try to construct RTSP URL manually
        rtspUrl = camera.rtspUrl;
        
        if (!rtspUrl && (camera.type === 'tapo' || camera.type === 'dual')) {
          const tapo = camera.tapo;
          if (tapo && tapo.ip && tapo.username && tapo.password) {
            const stream = tapo.stream || 'stream1';
            rtspUrl = `rtsp://${tapo.username}:${tapo.password}@${tapo.ip}:554/${stream}`;
          }
        }
      }

      if (!rtspUrl) {
        throw new Error('No RTSP URL available for device');
      }

      logger.info(`Capturing frame from RTSP stream: ${rtspUrl.replace(/:[^:@]+@/, ':****@')}`);
      
      // Use rtspFrameManager (same as Dashboard) for consistent behavior
      const deviceId = device._id?.toString() || device.id || 'unknown';
      const frameBuffer = await rtspFrameManager.getFrame(deviceId, rtspUrl, 10000);
      
      if (frameBuffer && frameBuffer.length > 0) {
        // Convert buffer to base64
        const imageBase64 = frameBuffer.toString('base64');
        logger.info('Successfully captured frame from RTSP stream');
        return imageBase64;
      }

      throw new Error('Failed to capture frame from camera - empty frame');
    } catch (error) {
      logger.error('Error capturing frame:', error);
      throw error;
    }
  }

  /**
   * Apply zoom to image
   */
  async applyZoom(imageBase64, zoomFactor = 1.0) {
    try {
      if (zoomFactor <= 1.0) {
        logger.info('No zoom applied (zoom factor <= 1.0)');
        return imageBase64;
      }

      logger.info(`Applying zoom factor: ${zoomFactor}x`);

      // Use CV service to apply zoom
      const response = await axios.post(`${this.CV_SERVICE_URL}/apply_zoom`, {
        image: imageBase64,
        zoom: zoomFactor
      }, {
        timeout: 10000
      });

      if (response.data && response.data.image) {
        return response.data.image;
      }

      throw new Error('Failed to apply zoom to image');
    } catch (error) {
      logger.error('Error applying zoom:', error);
      // Return original image if zoom fails
      return imageBase64;
    }
  }

  /**
   * Capture frame with zoom - returns both original and zoomed images
   * This centralizes the logic from hardware monitor
   */
  async captureFrameWithZoom(device, zoomFactor = 1.0) {
    try {
      const camera = device.camera;
      
      if (!camera) {
        throw new Error('No camera configured for device');
      }

      // Handle Raspberry Pi camera (HTTP GET)
      if (camera.type === 'raspberry-pi') {
        const pi = camera.raspberryPi;
        if (!pi || !pi.ip) {
          throw new Error('Raspberry Pi camera IP not configured');
        }

        const port = pi.port || 8080;
        const endpoint = pi.endpoint || '/image.jpg';
        const baseUrl = `http://${pi.ip}:${port}${endpoint}`;
        
        // Build base query params (flip)
        const baseQueryParams = [];
        if (pi.flip) {
          baseQueryParams.push('flip=true');
        }
        const baseUrlWithFlip = baseQueryParams.length > 0 
          ? `${baseUrl}?${baseQueryParams.join('&')}`
          : baseUrl;
        
        // Always get original image first (without zoom)
        logger.info(`Capturing original frame from Raspberry Pi: ${baseUrlWithFlip}`);
        const originalResponse = await axios.get(baseUrlWithFlip, {
          responseType: 'arraybuffer',
          timeout: 10000
        });
        
        if (!originalResponse.data) {
          throw new Error('Failed to capture original frame from Raspberry Pi - empty response');
        }
        
        const originalBase64 = Buffer.from(originalResponse.data, 'binary').toString('base64');
        
        // Get zoomed image if zoom > 1.0
        let zoomedBase64 = originalBase64;
        if (zoomFactor > 1.0) {
          const zoomQueryParams = [...baseQueryParams];
          zoomQueryParams.push(`zoom=${zoomFactor.toFixed(3)}`);
          const zoomedUrl = `${baseUrl}?${zoomQueryParams.join('&')}`;
          
          logger.info(`Capturing zoomed frame from Raspberry Pi: ${zoomedUrl}`);
          const zoomedResponse = await axios.get(zoomedUrl, {
            responseType: 'arraybuffer',
            timeout: 10000
          });
          
          if (zoomedResponse.data) {
            zoomedBase64 = Buffer.from(zoomedResponse.data, 'binary').toString('base64');
          } else {
            logger.warn('Failed to capture zoomed frame from Raspberry Pi, using original');
            zoomedBase64 = originalBase64;
          }
        }
        
        return {
          original: originalBase64,
          zoomed: zoomedBase64
        };
      }

      // For other cameras (Tapo, RTSP), capture original and apply zoom
      const originalBase64 = await this.captureFrame(device);
      let zoomedBase64 = originalBase64;
      
      if (zoomFactor > 1.0) {
        zoomedBase64 = await this.applyZoom(originalBase64, zoomFactor);
      }
      
      return {
        original: originalBase64,
        zoomed: zoomedBase64
      };
    } catch (error) {
      logger.error('Error capturing frame with zoom:', error);
      throw error;
    }
  }

  /**
   * Update route image for a specific coordinate
   */
  async updateRouteImage(device, coordinate, index) {
    try {
      logger.info(`Starting route image update for device ${device._id}, coordinate ${index}`);

      // 1. Apply position inversion if enabled (same as position preview)
      let finalRotation = coordinate.rotation;
      let finalTilt = coordinate.tilt;
      
      const taubenschiesserConfig = device.taubenschiesser || {};
      if (taubenschiesserConfig.invertRotation) {
        finalRotation = 180 - finalRotation;
        logger.info(`Applied rotation inversion: ${coordinate.rotation} -> ${finalRotation}`);
      }
      if (taubenschiesserConfig.invertTilt) {
        finalTilt = 180 - finalTilt;
        logger.info(`Applied tilt inversion: ${coordinate.tilt} -> ${finalTilt}`);
      }

      // 2. Move to position (with inversion applied)
      logger.info(`Moving to position: rotation=${finalRotation} (original: ${coordinate.rotation}), tilt=${finalTilt} (original: ${coordinate.tilt})`);
      const movementContext = await this.moveToPosition(device, finalRotation, finalTilt);

      // 3. Wait for movement to complete (MQTT feedback when available)
      logger.info('Waiting for movement to complete...');
      await this.waitForMovementComplete(device, movementContext, { timeoutMs: 30000, stabilizationMs: 2000 });

      // 4. Capture frame
      // For dual mode, use Tapo camera (same as route preview)
      // For single camera, use the configured camera
      logger.info('Capturing frame from camera...');
      let captureDevice = device;
      if (device.camera && device.camera.type === 'dual' && device.camera.tapo) {
        // Create a device object with Tapo camera only for capture
        captureDevice = {
          ...device.toObject ? device.toObject() : device,
          camera: {
            ...device.camera,
            type: 'tapo'
          }
        };
        logger.info('Using Tapo camera for dual mode route image');
      }
      let imageBase64 = await this.captureFrame(captureDevice);

      // 5. Apply zoom if needed
      const zoomFactor = coordinate.zoom || 1.0;
      if (zoomFactor > 1.0) {
        logger.info(`Applying zoom: ${zoomFactor}x`);
        imageBase64 = await this.applyZoom(imageBase64, zoomFactor);
      }

      // 6. Return the result
      logger.info('Image update completed successfully');
      
      return {
        image: `data:image/jpeg;base64,${imageBase64}`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error updating route image:', error);
      throw error;
    }
  }

  /**
   * Cleanup - close all MQTT connections
   */
  cleanup() {
    this.mqttClients.forEach((client, key) => {
      logger.info(`Closing MQTT client: ${key}`);
      client.end();
    });
    this.mqttClients.clear();
  }
}

// Singleton instance
const hardwareHelper = new HardwareHelper();

// Cleanup on process exit
process.on('exit', () => {
  hardwareHelper.cleanup();
});

module.exports = hardwareHelper;

