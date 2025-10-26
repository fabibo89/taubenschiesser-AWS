const aws = require('aws-sdk');
const logger = require('./logger');

/**
 * AWS IoT Core Helper
 * 
 * This helper manages AWS IoT Core interactions from the backend.
 * It allows the backend to:
 * - Publish commands to devices via IoT Core
 * - Subscribe to device status updates
 * - Manage device shadows
 * - Register new devices programmatically
 */
class AwsIotHelper {
  constructor() {
    this.iot = null;
    this.iotData = null;
    this.enabled = false;
    this.endpoint = process.env.AWS_IOT_ENDPOINT;
    this.region = process.env.AWS_REGION || 'eu-central-1';
    
    this.init();
  }

  /**
   * Initialize AWS IoT clients
   */
  init() {
    try {
      if (!this.endpoint) {
        logger.info('AWS IoT endpoint not configured, AWS IoT features disabled');
        return;
      }

      // Configure AWS SDK
      if (this.region) {
        aws.config.update({ region: this.region });
      }

      // IoT client for control plane operations (create things, policies, etc.)
      this.iot = new aws.Iot();
      
      // IoT Data client for data plane operations (publish, subscribe, shadows)
      this.iotData = new aws.IotData({
        endpoint: this.endpoint
      });

      this.enabled = true;
      logger.info(`AWS IoT Core initialized with endpoint: ${this.endpoint}`);
    } catch (error) {
      logger.error('Failed to initialize AWS IoT Core:', error);
      this.enabled = false;
    }
  }

  /**
   * Check if AWS IoT is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Publish command to device
   * @param {string} deviceName - Device name (thing name)
   * @param {object} command - Command payload
   * @param {string} topicSuffix - Topic suffix (default: 'commands')
   */
  async publishCommand(deviceName, command, topicSuffix = 'commands') {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const topic = `taubenschiesser/${deviceName}/${topicSuffix}`;
      const payload = JSON.stringify(command);

      logger.info(`Publishing to AWS IoT topic: ${topic}`, command);

      const params = {
        topic: topic,
        payload: payload,
        qos: 1 // QoS 1 = at least once delivery
      };

      await this.iotData.publish(params).promise();
      logger.info(`Successfully published command to ${topic}`);

      return { success: true, topic, command };
    } catch (error) {
      logger.error('Error publishing to AWS IoT:', error);
      throw error;
    }
  }

  /**
   * Get device shadow
   * @param {string} thingName - Thing name
   */
  async getDeviceShadow(thingName) {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const params = {
        thingName: thingName
      };

      const result = await this.iotData.getThingShadow(params).promise();
      const shadow = JSON.parse(result.payload);
      
      logger.info(`Retrieved shadow for ${thingName}`);
      return shadow;
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        logger.info(`No shadow found for ${thingName}`);
        return null;
      }
      logger.error('Error getting device shadow:', error);
      throw error;
    }
  }

  /**
   * Update device shadow
   * @param {string} thingName - Thing name
   * @param {object} state - Desired state
   */
  async updateDeviceShadow(thingName, state) {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const params = {
        thingName: thingName,
        payload: JSON.stringify({
          state: {
            desired: state
          }
        })
      };

      await this.iotData.updateThingShadow(params).promise();
      logger.info(`Updated shadow for ${thingName}`, state);

      return { success: true, state };
    } catch (error) {
      logger.error('Error updating device shadow:', error);
      throw error;
    }
  }

  /**
   * Create IoT Thing
   * @param {string} thingName - Thing name
   * @param {string} thingTypeName - Thing type name
   * @param {object} attributes - Thing attributes
   */
  async createThing(thingName, thingTypeName, attributes = {}) {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const params = {
        thingName: thingName,
        thingTypeName: thingTypeName,
        attributePayload: {
          attributes: attributes
        }
      };

      const result = await this.iot.createThing(params).promise();
      logger.info(`Created IoT Thing: ${thingName}`);

      return result;
    } catch (error) {
      if (error.code === 'ResourceAlreadyExistsException') {
        logger.info(`Thing ${thingName} already exists`);
        return { thingName, alreadyExists: true };
      }
      logger.error('Error creating IoT Thing:', error);
      throw error;
    }
  }

  /**
   * Create keys and certificate
   */
  async createKeysAndCertificate() {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const params = {
        setAsActive: true
      };

      const result = await this.iot.createKeysAndCertificate(params).promise();
      logger.info('Created new certificate');

      return {
        certificateArn: result.certificateArn,
        certificateId: result.certificateId,
        certificatePem: result.certificatePem,
        keyPair: result.keyPair
      };
    } catch (error) {
      logger.error('Error creating certificate:', error);
      throw error;
    }
  }

  /**
   * Attach policy to certificate
   * @param {string} policyName - Policy name
   * @param {string} target - Certificate ARN
   */
  async attachPolicy(policyName, target) {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const params = {
        policyName: policyName,
        target: target
      };

      await this.iot.attachPolicy(params).promise();
      logger.info(`Attached policy ${policyName} to ${target}`);

      return { success: true };
    } catch (error) {
      logger.error('Error attaching policy:', error);
      throw error;
    }
  }

  /**
   * Attach thing principal (certificate to thing)
   * @param {string} thingName - Thing name
   * @param {string} principal - Certificate ARN
   */
  async attachThingPrincipal(thingName, principal) {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const params = {
        thingName: thingName,
        principal: principal
      };

      await this.iot.attachThingPrincipal(params).promise();
      logger.info(`Attached certificate to thing ${thingName}`);

      return { success: true };
    } catch (error) {
      logger.error('Error attaching thing principal:', error);
      throw error;
    }
  }

  /**
   * Register a complete device (thing + certificate + policy)
   * @param {string} deviceName - Device name
   * @param {object} attributes - Device attributes
   */
  async registerDevice(deviceName, attributes = {}) {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      logger.info(`Starting device registration for: ${deviceName}`);

      // 1. Create thing
      const thing = await this.createThing(
        deviceName, 
        'taubenschiesser-device',
        attributes
      );

      // 2. Create certificate
      const cert = await this.createKeysAndCertificate();

      // 3. Attach policy to certificate
      await this.attachPolicy('taubenschiesser-device-policy', cert.certificateArn);

      // 4. Attach certificate to thing
      await this.attachThingPrincipal(deviceName, cert.certificateArn);

      logger.info(`Successfully registered device: ${deviceName}`);

      return {
        success: true,
        thingName: deviceName,
        certificateId: cert.certificateId,
        certificateArn: cert.certificateArn,
        certificatePem: cert.certificatePem,
        privateKey: cert.keyPair.PrivateKey,
        publicKey: cert.keyPair.PublicKey,
        endpoint: this.endpoint
      };
    } catch (error) {
      logger.error('Error registering device:', error);
      throw error;
    }
  }

  /**
   * List all things
   */
  async listThings() {
    if (!this.enabled) {
      throw new Error('AWS IoT Core is not enabled');
    }

    try {
      const params = {
        thingTypeName: 'taubenschiesser-device',
        maxResults: 100
      };

      const result = await this.iot.listThings(params).promise();
      return result.things;
    } catch (error) {
      logger.error('Error listing things:', error);
      throw error;
    }
  }
}

// Singleton instance
const awsIotHelper = new AwsIotHelper();

module.exports = awsIotHelper;


