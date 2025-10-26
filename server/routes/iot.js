const express = require('express');
const router = express.Router();
const awsIotHelper = require('../utils/awsIotHelper');
const logger = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const Device = require('../models/Device');

/**
 * Register a new device with AWS IoT Core
 * Creates IoT Thing, generates certificates, and attaches policies
 */
router.post('/register-device', authenticateToken, async (req, res) => {
  try {
    const { deviceName, attributes } = req.body;

    if (!deviceName) {
      return res.status(400).json({ error: 'Device name is required' });
    }

    // Check if AWS IoT is enabled
    if (!awsIotHelper.isEnabled()) {
      return res.status(503).json({ 
        error: 'AWS IoT Core is not enabled',
        details: 'AWS_IOT_ENDPOINT environment variable not set'
      });
    }

    // Check if device already exists in database
    const existingDevice = await Device.findOne({ 
      name: deviceName,
      owner: req.user.userId 
    });

    if (existingDevice) {
      return res.status(409).json({ 
        error: 'Device name already exists',
        deviceId: existingDevice._id
      });
    }

    logger.info(`Registering new device: ${deviceName} for user ${req.user.userId}`);

    // Register device in AWS IoT Core
    const registration = await awsIotHelper.registerDevice(deviceName, attributes || {});

    logger.info(`Device ${deviceName} registered successfully in AWS IoT Core`);

    // Return certificate details
    // WARNING: These are sensitive! Only show once, never store in database
    res.json({
      success: true,
      message: 'Device registered successfully in AWS IoT Core',
      warning: 'Save these credentials securely! They will not be shown again.',
      device: {
        thingName: registration.thingName,
        certificateId: registration.certificateId,
        certificateArn: registration.certificateArn,
        endpoint: registration.endpoint
      },
      credentials: {
        certificatePem: registration.certificatePem,
        privateKey: registration.privateKey,
        publicKey: registration.publicKey
      },
      topics: {
        status: `taubenschiesser/${deviceName}/status`,
        telemetry: `taubenschiesser/${deviceName}/telemetry`,
        commands: `taubenschiesser/${deviceName}/commands`,
        config: `taubenschiesser/${deviceName}/config`
      },
      nextSteps: [
        'Save the certificate and private key securely',
        'Download Amazon Root CA from https://www.amazontrust.com/repository/AmazonRootCA1.pem',
        'Configure your ESP32 with these credentials',
        'Create the device in the Dashboard to link it to your account'
      ]
    });

  } catch (error) {
    logger.error('Error registering device:', error);
    
    if (error.code === 'ResourceAlreadyExistsException') {
      return res.status(409).json({ 
        error: 'Device already exists in AWS IoT Core',
        details: error.message
      });
    }

    res.status(500).json({ 
      error: 'Failed to register device',
      details: error.message
    });
  }
});

/**
 * Get device shadow
 */
router.get('/device/:thingName/shadow', authenticateToken, async (req, res) => {
  try {
    const { thingName } = req.params;

    if (!awsIotHelper.isEnabled()) {
      return res.status(503).json({ error: 'AWS IoT Core is not enabled' });
    }

    // Check if user owns this device
    const device = await Device.findOne({ 
      name: thingName,
      owner: req.user.userId 
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found or access denied' });
    }

    const shadow = await awsIotHelper.getDeviceShadow(thingName);

    res.json({
      success: true,
      thingName,
      shadow
    });

  } catch (error) {
    logger.error('Error getting device shadow:', error);
    res.status(500).json({ 
      error: 'Failed to get device shadow',
      details: error.message
    });
  }
});

/**
 * Update device shadow
 */
router.post('/device/:thingName/shadow', authenticateToken, async (req, res) => {
  try {
    const { thingName } = req.params;
    const { state } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State is required' });
    }

    if (!awsIotHelper.isEnabled()) {
      return res.status(503).json({ error: 'AWS IoT Core is not enabled' });
    }

    // Check if user owns this device
    const device = await Device.findOne({ 
      name: thingName,
      owner: req.user.userId 
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found or access denied' });
    }

    const result = await awsIotHelper.updateDeviceShadow(thingName, state);

    res.json({
      success: true,
      thingName,
      state
    });

  } catch (error) {
    logger.error('Error updating device shadow:', error);
    res.status(500).json({ 
      error: 'Failed to update device shadow',
      details: error.message
    });
  }
});

/**
 * Publish command to device
 */
router.post('/device/:thingName/command', authenticateToken, async (req, res) => {
  try {
    const { thingName } = req.params;
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    if (!awsIotHelper.isEnabled()) {
      return res.status(503).json({ error: 'AWS IoT Core is not enabled' });
    }

    // Check if user owns this device
    const device = await Device.findOne({ 
      name: thingName,
      owner: req.user.userId 
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found or access denied' });
    }

    const result = await awsIotHelper.publishCommand(thingName, command);

    res.json({
      success: true,
      thingName,
      command,
      topic: result.topic
    });

  } catch (error) {
    logger.error('Error publishing command:', error);
    res.status(500).json({ 
      error: 'Failed to publish command',
      details: error.message
    });
  }
});

/**
 * List all IoT things (admin only)
 */
router.get('/things', authenticateToken, async (req, res) => {
  try {
    if (!awsIotHelper.isEnabled()) {
      return res.status(503).json({ error: 'AWS IoT Core is not enabled' });
    }

    const things = await awsIotHelper.listThings();

    res.json({
      success: true,
      count: things.length,
      things
    });

  } catch (error) {
    logger.error('Error listing things:', error);
    res.status(500).json({ 
      error: 'Failed to list things',
      details: error.message
    });
  }
});

/**
 * IoT Core status endpoint
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    res.json({
      enabled: awsIotHelper.isEnabled(),
      endpoint: process.env.AWS_IOT_ENDPOINT || null,
      region: process.env.AWS_REGION || 'eu-central-1'
    });
  } catch (error) {
    logger.error('Error getting IoT status:', error);
    res.status(500).json({ error: 'Failed to get IoT status' });
  }
});

/**
 * Webhook endpoint for IoT Rules Engine
 * Receives status updates and telemetry from devices
 */
router.post('/status', async (req, res) => {
  try {
    // This endpoint is called by AWS IoT Rules Engine
    // No authentication needed as it comes from AWS
    const data = req.body;
    
    logger.info('Received IoT status update:', data);

    // TODO: Process status update
    // - Update device status in database
    // - Emit Socket.IO event
    // - Store telemetry data

    res.json({ success: true });

  } catch (error) {
    logger.error('Error processing IoT status:', error);
    res.status(500).json({ error: 'Failed to process status update' });
  }
});

/**
 * Webhook endpoint for IoT Rules Engine
 * Receives telemetry data from devices
 */
router.post('/telemetry', async (req, res) => {
  try {
    const data = req.body;
    
    logger.info('Received IoT telemetry:', data);

    // TODO: Process telemetry data
    // - Store in database
    // - Trigger alerts if needed
    // - Update device metrics

    res.json({ success: true });

  } catch (error) {
    logger.error('Error processing IoT telemetry:', error);
    res.status(500).json({ error: 'Failed to process telemetry' });
  }
});

module.exports = router;


