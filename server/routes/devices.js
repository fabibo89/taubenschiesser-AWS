const express = require('express');
const { body, validationResult } = require('express-validator');
const Device = require('../models/Device');
const Detection = require('../models/Detection');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get all devices for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = { isActive: true };
    
    // If service token, get all devices with monitorStatus: 'running'
    if (req.user.isService) {
      query.monitorStatus = 'running';
    } else {
      // Regular user gets only their devices
      query.owner = req.user.userId;
    }
    
    const devices = await Device.find(query).sort({ lastSeen: -1 });
    
    res.json(devices);
  } catch (error) {
    logger.error('Get devices error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single device
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json(device);
  } catch (error) {
    logger.error('Get device error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new device
router.post('/', authenticateToken, [
  body('name').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, location, camera, taubenschiesser } = req.body;

    const device = new Device({
      name,
      type: 'taubenschiesser', // Immer Taubenschiesser
      location,
      camera,
      taubenschiesser,
      owner: req.user.userId
    });

    await device.save();
    res.status(201).json(device);
  } catch (error) {
    logger.error('Create device error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update device
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // Build query - service tokens can update any device
    let query = { _id: req.params.id };
    if (!req.user.isService) {
      query.owner = req.user.userId;
    }
    
    const device = await Device.findOneAndUpdate(
      query,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json(device);
  } catch (error) {
    logger.error('Update device error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete device
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOneAndUpdate(
      { _id: req.params.id, owner: req.user.userId },
      { isActive: false },
      { new: true }
    );
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    logger.error('Delete device error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get device detections
router.get('/:id/detections', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const detections = await Detection.find({ device: req.params.id })
      .sort({ processedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('device', 'name deviceId');

    const total = await Detection.countDocuments({ device: req.params.id });

    res.json({
      detections,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get detections error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get device RTSP URL
router.get('/:id/rtsp-url', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    try {
      const rtspUrl = device.getRtspUrl();
      res.json({ rtspUrl });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  } catch (error) {
    logger.error('Get RTSP URL error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get device configuration for stream.py
router.get('/:id/config', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const config = {
      id: device._id,
      ip: device.getTaubenschiesserIp(),
      stream: device.camera.tapo?.stream || 'stream1',
      ipCam: device.camera.tapo?.ip || device.camera.directUrl?.split('@')[1]?.split(':')[0] || '',
      rtspUrl: device.getRtspUrl()
    };

    res.json(config);
  } catch (error) {
    logger.error('Get device config error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all devices configuration for stream.py (legacy compatibility)
router.get('/config/all', async (req, res) => {
  try {
    const devices = await Device.find({ 
      isActive: true 
    });
    
    const configs = devices.map(device => ({
      id: device._id,
      ip: device.getTaubenschiesserIp(),
      stream: device.camera.tapo?.stream || 'stream1',
      ipCam: device.camera.tapo?.ip || device.camera.directUrl?.split('@')[1]?.split(':')[0] || '',
      rtspUrl: device.getRtspUrl()
    }));

    res.json(configs);
  } catch (error) {
    logger.error('Get all devices config error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update Taubenschiesser status
router.post('/:id/taubenschiesser-status', async (req, res) => {
  try {
    const { status } = req.body;
    
    const device = await Device.findById(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    await device.updateTaubenschiesserStatus(status || 'online');
    
    // Update overall status
    device.status = device.getOverallStatus();
    await device.save();
    
    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`device-${device._id}`).emit('device-update', device);
    }
    
    res.json(device);
  } catch (error) {
    logger.error('Update Taubenschiesser status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update camera status
router.post('/:id/camera-status', async (req, res) => {
  try {
    const { status } = req.body;
    
    const device = await Device.findById(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    await device.updateCameraStatus(status || 'online');
    
    // Update overall status
    device.status = device.getOverallStatus();
    await device.save();
    
    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`device-${device._id}`).emit('device-update', device);
    }
    
    res.json(device);
  } catch (error) {
    logger.error('Update camera status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update device status (legacy - for backward compatibility)
router.post('/:id/status', async (req, res) => {
  try {
    const { status, lastSeen } = req.body;
    
    const device = await Device.findOneAndUpdate(
      { _id: req.params.id },
      { 
        status: status || 'online',
        lastSeen: lastSeen || new Date()
      },
      { new: true }
    );
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`device-${device._id}`).emit('device-update', device);
    }
    
    res.json(device);
  } catch (error) {
    logger.error('Update device status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Manual device check (ping)
router.post('/:id/check', async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Get device monitor from app
    const deviceMonitor = req.app.get('deviceMonitor');
    if (!deviceMonitor) {
      return res.status(500).json({ error: 'Device monitor not available' });
    }

    await deviceMonitor.checkDeviceById(device._id);
    const updatedDevice = await Device.findById(device._id);
    
    res.json(updatedDevice);
  } catch (error) {
    logger.error('Manual device check error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get status summary
router.get('/status/summary', async (req, res) => {
  try {
    const deviceMonitor = req.app.get('deviceMonitor');
    if (!deviceMonitor) {
      return res.status(500).json({ error: 'Device monitor not available' });
    }

    const summary = await deviceMonitor.getStatusSummary();
    res.json(summary);
  } catch (error) {
    logger.error('Get status summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get device actions configuration
router.get('/:id/actions', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({
      mode: device.actions?.mode || 'impulse',
      route: device.actions?.route || { coordinates: [] }
    });
  } catch (error) {
    logger.error('Get device actions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update device actions configuration
router.put('/:id/actions', authenticateToken, async (req, res) => {
  try {
    // Temporarily disable validation for debugging
    // const errors = validationResult(req);
    // if (!errors.isEmpty()) {
    //   logger.error('Validation errors:', errors.array());
    //   return res.status(400).json({ 
    //     error: 'Validation failed',
    //     details: errors.array() 
    //   });
    // }

    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      logger.error('Device not found:', req.params.id);
      return res.status(404).json({ error: 'Device not found' });
    }

    const { mode, route } = req.body;
    
    logger.info('Updating device actions:', { 
      deviceId: req.params.id, 
      mode, 
      route,
      coordinates: route?.coordinates,
      coordinatesLength: route?.coordinates?.length
    });
    
    // Initialize actions if not exists
    if (!device.actions) {
      device.actions = {};
    }
    
    if (mode !== undefined) {
      device.actions.mode = mode;
    }
    
    if (route !== undefined) {
      device.actions.route = route;
    }
    
    await device.save();
    
    logger.info('Device actions updated successfully:', device.actions);
    
    res.json({
      mode: device.actions.mode,
      route: device.actions.route
    });
  } catch (error) {
    logger.error('Update device actions error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message 
    });
  }
});

// Execute route action
router.post('/:id/execute-route', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.actions?.mode !== 'route') {
      return res.status(400).json({ error: 'Device is not in route mode' });
    }

    if (!device.actions?.route?.coordinates || device.actions.route.coordinates.length === 0) {
      return res.status(400).json({ error: 'No route coordinates configured' });
    }

    // Here you would implement the actual route execution logic
    // For now, we'll just return success
    res.json({ 
      message: 'Route execution started',
      coordinates: device.actions.route.coordinates
    });
  } catch (error) {
    logger.error('Execute route error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update route image for a specific coordinate
router.post('/:id/update-route-image/:index', authenticateToken, async (req, res) => {
  logger.info(`🖼️ UPDATE-ROUTE-IMAGE REQUEST: deviceId=${req.params.id}, index=${req.params.index}, userId=${req.user?.userId}`);
  
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      logger.warn(`❌ Device not found: ${req.params.id} for user ${req.user.userId}`);
      return res.status(404).json({ error: 'Device not found' });
    }

    logger.info(`✅ Device found: ${device.name}, mode=${device.actions?.mode}`);

    if (device.actions?.mode !== 'route') {
      logger.warn(`❌ Device not in route mode: ${device.actions?.mode}`);
      return res.status(400).json({ error: 'Device is not in route mode' });
    }

    const coordinates = device.actions.route?.coordinates || [];
    const index = parseInt(req.params.index);
    
    if (index < 0 || index >= coordinates.length) {
      logger.warn(`❌ Invalid coordinate index: ${index}, total coordinates: ${coordinates.length}`);
      return res.status(400).json({ error: 'Invalid coordinate index' });
    }

    const coordinate = coordinates[index];
    
    logger.info(`🎯 Updating image for coordinate ${index}: rotation=${coordinate.rotation}, tilt=${coordinate.tilt}, zoom=${coordinate.zoom}`);

    // Get hardware monitor helper from app
    const hardwareHelper = require('../utils/hardwareHelper');
    
    try {
      // Move device to position, capture and save image
      logger.info(`📡 Calling hardwareHelper.updateRouteImage...`);
      const result = await hardwareHelper.updateRouteImage(device, coordinate, index);
      
      // Update the coordinate with the new image
      coordinates[index].image = result.image;
      device.actions.route.coordinates = coordinates;
      await device.save();
      
      logger.info(`✅ Image updated successfully for coordinate ${index}`);
      
      res.json({
        message: 'Image updated successfully',
        image: result.image,
        index: index
      });
    } catch (error) {
      logger.error('❌ Error updating route image:', error);
      res.status(500).json({ 
        error: 'Failed to update image',
        message: error.message 
      });
    }
  } catch (error) {
    logger.error('Update route image error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
