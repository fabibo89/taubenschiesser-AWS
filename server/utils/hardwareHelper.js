const mqtt = require('mqtt');
const axios = require('axios');
const logger = require('./logger');
const awsIotHelper = require('./awsIotHelper');

class HardwareHelper {
  constructor() {
    this.mqttClients = new Map();
    this.CV_SERVICE_URL = process.env.CV_SERVICE_URL || 'http://localhost:8000';
    this.useAwsIot = awsIotHelper.isEnabled();
    
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

      await new Promise((resolve, reject) => {
        client.on('connect', () => {
          logger.info(`MQTT client connected for user ${userId}`);
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
        return;
      }

      // Fall back to local MQTT
      const User = require('../models/User');
      const user = await User.findById(device.owner);
      
      if (!user) {
        throw new Error('Device owner not found');
      }

      const mqttClient = await this.getMqttClient(device.owner, user.settings);
      const topic = `taubenschiesser/${deviceIp}`;
      
      logger.info(`Sending move command via local MQTT to ${topic}:`, command);
      
      return new Promise((resolve, reject) => {
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
    } catch (error) {
      logger.error('Error moving to position:', error);
      throw error;
    }
  }

  /**
   * Wait for device movement to complete
   */
  async waitForMovementComplete(timeoutMs = 30000) {
    // Wait for movement to complete
    // In a production system, you would listen to MQTT feedback
    // For now, we use a simple timeout
    await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 5000)));
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

      // Get RTSP URL
      let rtspUrl = camera.rtspUrl;
      
      if (!rtspUrl && camera.type === 'tapo') {
        const tapo = camera.tapo;
        if (tapo && tapo.ip && tapo.username && tapo.password) {
          const stream = tapo.stream || 'stream1';
          rtspUrl = `rtsp://${tapo.username}:${tapo.password}@${tapo.ip}:554/${stream}`;
        }
      }

      if (!rtspUrl) {
        throw new Error('No RTSP URL available for device');
      }

      logger.info('Capturing frame from RTSP stream...');
      
      // Use CV service to capture frame
      const response = await axios.post(`${this.CV_SERVICE_URL}/capture_frame`, {
        rtsp_url: rtspUrl
      }, {
        timeout: 15000
      });

      if (response.data && response.data.image) {
        return response.data.image; // Base64 encoded image
      }

      throw new Error('Failed to capture frame from camera');
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
   * Update route image for a specific coordinate
   */
  async updateRouteImage(device, coordinate, index) {
    try {
      logger.info(`Starting route image update for device ${device._id}, coordinate ${index}`);

      // 1. Move to position
      logger.info(`Moving to position: rotation=${coordinate.rotation}, tilt=${coordinate.tilt}`);
      await this.moveToPosition(device, coordinate.rotation, coordinate.tilt);

      // 2. Wait for movement to complete
      logger.info('Waiting for movement to complete...');
      await this.waitForMovementComplete(5000);
      
      // 3. Additional stabilization time
      logger.info('Waiting for camera stabilization...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 4. Capture frame
      logger.info('Capturing frame from camera...');
      let imageBase64 = await this.captureFrame(device);

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

