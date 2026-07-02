const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const Device = require('../models/Device');
const Detection = require('../models/Detection');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const hardwareHelper = require('../utils/hardwareHelper');
const { PANORAMA_STABILIZE_MS, getDeviceStabilizationMs } = hardwareHelper;
const deviceTelemetryCache = require('../utils/deviceTelemetryCache');
const routeImages = require('../utils/routeImages');
const panoramaScanImages = require('../utils/panoramaScanImages');
const panoramaScanResults = require('../utils/panoramaScanResults');

const router = express.Router();

// Helper function to get internal API URL (for server-to-server calls)
function getInternalApiUrl() {
  // In Docker, the API runs on port 5000 internally (see docker-compose.prod.yml)
  // Use the PORT env var if set, otherwise default to 5000 (Docker) or 5001 (local)
  const port = process.env.PORT || (process.env.NODE_ENV === 'production' ? 5000 : 5001);
  
  // Force IPv4 by using 127.0.0.1 instead of localhost
  // localhost can resolve to IPv6 ::1 which causes ECONNREFUSED
  // This works in Docker containers and locally
  return `http://127.0.0.1:${port}`;
}

// Helper function to log axios errors without request body
function logAxiosError(message, error) {
  logger.error(message, {
    message: error.message,
    code: error.code,
    syscall: error.syscall,
    hostname: error.hostname,
    address: error.address,
    port: error.port,
    url: error.config?.url,
    method: error.config?.method,
    response: error.response ? {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data
    } : undefined
    // Explicitly NOT logging error.config (contains request body with image data)
  });
}

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
    
    // Lean list: exclude heavy fields (route images, panorama, tapo password)
    const devices = await Device.find(query)
      .select('-actions.route.coordinates.image -actions.route.panorama -camera.tapo.password')
      .sort({ lastSeen: -1 });
    const deviceIds = devices.map(d => d._id);
    
    // Get today's date range (start of today to end of today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Get yesterday's date range
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Count all detections per device per day (based on processedAt)
    // Only run aggregation if we have devices
    let countMap = {};
    if (deviceIds.length > 0) {
      const detectionCounts = await Detection.aggregate([
        {
          $match: {
            device: { $in: deviceIds },
            processedAt: { $gte: yesterday, $lt: tomorrow }
          }
        },
        {
          $project: {
            device: 1,
            processedAt: 1,
            // Get date as YYYY-MM-DD string
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$processedAt'
              }
            }
          }
        },
        {
          $group: {
            _id: {
              device: '$device',
              date: '$date'
            },
            count: { $sum: 1 }
          }
        }
      ]);
      
      // Create a map: { deviceId: { '2024-01-15': count } }
      detectionCounts.forEach(stat => {
        const devId = stat._id.device.toString();
        const date = stat._id.date;
        
        if (!countMap[devId]) {
          countMap[devId] = {};
        }
        countMap[devId][date] = stat.count;
      });
    }

    // Total (all-time) unclassified detections per device (matches Tauben-Tinder).
    // Index-friendly countDocuments per device instead of an aggregation, which would
    // scan the full (multi-MB Base64) documents and hang.
    let unclassifiedTotalMap = {};
    if (deviceIds.length > 0) {
      const unclassifiedCounts = await Promise.all(
        deviceIds.map(id =>
          Detection.countDocuments({ device: id, classification_status: null })
        )
      );
      deviceIds.forEach((id, i) => {
        unclassifiedTotalMap[id.toString()] = unclassifiedCounts[i];
      });
    }
    
    // Calculate status dynamically for each device and add daily detection counts
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const devicesWithStatus = devices.map(device => {
      const deviceObj = device.toObject(); // Convert Mongoose document to plain object
      deviceObj.status = device.getOverallStatus(); // Dynamisch berechnen
      
      // Get today's and yesterday's counts
      const deviceCounts = countMap[device._id.toString()] || {};
      deviceObj.detectionCounts = {
        today: deviceCounts[todayStr] || 0,
        yesterday: deviceCounts[yesterdayStr] || 0
      };
      deviceObj.unclassifiedTotal = unclassifiedTotalMap[device._id.toString()] || 0;

      deviceTelemetryCache.attachToDevice(deviceObj);
      
      return deviceObj;
    });
    
    res.json(devicesWithStatus);
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
    }).select('-actions.route.coordinates.image');
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const deviceObj = device.toObject();
    deviceObj.status = device.getOverallStatus(); // Dynamisch berechnen
    deviceTelemetryCache.attachToDevice(deviceObj);
    // Route coordinate images live in a separate collection; re-attach them so
    // clients that read coordinates[i].image keep working.
    await routeImages.attachRouteImages(deviceObj);
    
    res.json(deviceObj);
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
    
    const device = await Device.findOne(query);
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Update device fields, including nested objects
    Object.keys(req.body).forEach(key => {
      if (key === 'taubenschiesser' && req.body[key]) {
        // Merge taubenschiesser object to preserve existing fields
        device.taubenschiesser = {
          ...device.taubenschiesser,
          ...req.body[key]
        };
      } else if (key === 'camera' && req.body[key]) {
        // Merge camera object to preserve existing fields
        device.camera = {
          ...device.camera,
          ...req.body[key]
        };
      } else if (key === 'location' && req.body[key]) {
        // Merge location object to preserve existing fields
        device.location = {
          ...device.location,
          ...req.body[key]
        };
      } else {
        device[key] = req.body[key];
      }
    });
    
    // Keep coordinate images in the RouteImage collection, not the device doc.
    await routeImages.persistAndStripCoordinateImages(device._id, device.actions?.route?.coordinates || []);
    routeImages.stripCoordinateImagesFromDoc(device);
    await device.save();
    
    const deviceObj = device.toObject();
    deviceObj.status = device.getOverallStatus(); // Dynamisch berechnen
    await routeImages.attachRouteImages(deviceObj);
    
    res.json(deviceObj);
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
    }).select('-actions.route.coordinates.image');
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const route = device.actions?.route
      ? device.actions.route.toObject()
      : { coordinates: [] };
    // Route coordinate images are stored separately; re-attach for the editor.
    await routeImages.attachRouteImages({ _id: device._id, actions: { route } });

    res.json({
      mode: device.actions?.mode || 'impulse',
      // Backward compatibility: keep returning the field, but it is now configured via device.taubenschiesser.maxWaitBetweenMovesSeconds.
      waitBetweenMovesSeconds: device.taubenschiesser?.maxWaitBetweenMovesSeconds ?? device.actions?.waitBetweenMovesSeconds ?? 20,
      route
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
      // Move any incoming coordinate images into the RouteImage collection and
      // strip them from the coordinates so the device document stays small.
      if (route.coordinates) {
        await routeImages.persistAndStripCoordinateImages(device._id, route.coordinates);
      }
      device.actions.route = route;
    }
    
    // Safety net: never write coordinate images back into the device document.
    routeImages.stripCoordinateImagesFromDoc(device);
    await device.save();
    
    logger.info('Device actions updated successfully');

    const responseRoute = device.actions.route ? device.actions.route.toObject() : { coordinates: [] };
    await routeImages.attachRouteImages({ _id: device._id, actions: { route: responseRoute } });
    
    res.json({
      mode: device.actions.mode,
      waitBetweenMovesSeconds: device.taubenschiesser?.maxWaitBetweenMovesSeconds ?? device.actions.waitBetweenMovesSeconds ?? 20,
      route: responseRoute
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

// Preview a coordinate by moving the camera and returning a live snapshot
router.post('/:id/preview-route-coordinate', authenticateToken, async (req, res) => {
  logger.info(`🎯 PREVIEW-ROUTE-COORDINATE REQUEST: deviceId=${req.params.id}, userId=${req.user?.userId}`);
  
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      logger.warn(`❌ Device not found for preview: ${req.params.id}`);
      return res.status(404).json({ error: 'Device not found' });
    }

    const { rotation, tilt, zoom = 1 } = req.body || {};

    if (rotation === undefined || tilt === undefined) {
      return res.status(400).json({ error: 'Rotation und Kippung sind erforderlich' });
    }

    const coordinate = {
      rotation: Number(rotation),
      tilt: Number(tilt),
      zoom: Number(zoom) || 1
    };

    logger.info(`📐 Preview coordinate -> rotation=${coordinate.rotation}, tilt=${coordinate.tilt}, zoom=${coordinate.zoom}`);

    const result = await hardwareHelper.updateRouteImage(device, coordinate, -1, {
      stabilizationMs: PANORAMA_STABILIZE_MS,
      waitFocus: true
    });

    res.json({
      message: 'Preview captured successfully',
      image: result.image,
      timestamp: result.timestamp
    });
  } catch (error) {
    logger.error('Preview route coordinate error:', error);
    res.status(500).json({
      error: 'Failed to capture preview',
      message: error.message
    });
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

    try {
      // Move device to position, capture and save image
      logger.info(`📡 Calling hardwareHelper.updateRouteImage...`);
      const result = await hardwareHelper.updateRouteImage(device, coordinate, index);
      
      // Store the image in the RouteImage collection (not in the device doc,
      // which would blow past MongoDB's 16MB document limit).
      await routeImages.setRouteImage(device._id, index, result.image);
      // Migrate/clear any image embedded in the device document so save() stays small.
      routeImages.stripCoordinateImagesFromDoc(device);
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

// Stitch panorama from route images
router.post('/:id/stitch-panorama', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ 
        error: 'Device not found',
        error_code: 'DEVICE_NOT_FOUND'
      });
    }

    if (device.actions?.mode !== 'route') {
      return res.status(400).json({ 
        error: 'Device is not in route mode',
        error_code: 'NOT_ROUTE_MODE'
      });
    }

    // Coordinate images are stored in the RouteImage collection; re-attach them.
    const coordinates = await routeImages.getCoordinatesWithImages(
      device._id,
      device.actions.route?.coordinates || []
    );
    
    if (coordinates.length < 2) {
      return res.status(400).json({ 
        error: 'Mindestens 2 Koordinaten mit Bildern werden benötigt',
        error_code: 'INSUFFICIENT_COORDINATES'
      });
    }

    // Prüfe ob alle Bilder vorhanden sind
    const imagesWithUrls = coordinates.filter(coord => coord.image);
    const missingImages = coordinates.length - imagesWithUrls.length;
    
    if (missingImages > 0) {
      return res.status(400).json({ 
        error: `${missingImages} Koordinaten haben keine Bilder. Bitte aktualisiere die Bilder zuerst.`,
        error_code: 'MISSING_IMAGES',
        missing_count: missingImages
      });
    }

    if (imagesWithUrls.length < 2) {
      return res.status(400).json({ 
        error: 'Mindestens 2 Bilder werden für Panorama benötigt',
        error_code: 'INSUFFICIENT_IMAGES'
      });
    }

    // Bilder extrahieren - unterstütze sowohl URLs als auch data URLs
    const imageUrls = [];
    const imageBase64List = [];
    
    imagesWithUrls.forEach(coord => {
      if (coord.image.startsWith('data:image')) {
        // Data URL - extrahiere base64
        imageBase64List.push(coord.image);
      } else {
        // Normale URL
        imageUrls.push(coord.image);
      }
    });
    
    logger.info(`Starte Panorama-Stitching für Device ${device.name} mit ${imageUrls.length} URLs und ${imageBase64List.length} base64 Bildern`);

    // CV-Service aufrufen
    try {
      const cvServiceUrl = process.env.CV_SERVICE_URL || 'http://localhost:8000';
      logger.info(`CV-Service URL: ${cvServiceUrl}`);
      logger.info(`Sende ${imageUrls.length} URLs und ${imageBase64List.length} base64 Bilder zum Stitching`);
      
      const requestPayload = {
        image_urls: imageUrls.length > 0 ? imageUrls : [],
        image_base64_list: imageBase64List.length > 0 ? imageBase64List : [],
        show_borders: req.body.show_borders || false
      };
      
      // Entferne leere Arrays, damit sie nicht gesendet werden
      if (requestPayload.image_urls.length === 0) {
        delete requestPayload.image_urls;
      }
      if (requestPayload.image_base64_list.length === 0) {
        delete requestPayload.image_base64_list;
      }
      
      const response = await axios.post(`${cvServiceUrl}/stitch-panorama`, requestPayload, {
        timeout: 120000, // 120 Sekunden Timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });

      logger.info('CV-Service Response Status:', response.status);
      logger.info('CV-Service Response Data:', JSON.stringify(response.data, null, 2));

      if (!response.data.success) {
        logger.error('Stitching fehlgeschlagen:', JSON.stringify(response.data, null, 2));
        return res.status(500).json({
          error: response.data.error || response.data.detail?.error || 'Stitching fehlgeschlagen',
          error_code: response.data.error_code || response.data.detail?.error_code,
          details: response.data.detail || response.data
        });
      }

      // Panorama als data URL zurückgeben
      const panoramaDataUrl = `data:image/jpeg;base64,${response.data.panorama_base64}`;
      
      logger.info(`Panorama erfolgreich erstellt für Device ${device.name}`);
      
      res.json({
        success: true,
        panorama_url: panoramaDataUrl,
        message: 'Panorama erfolgreich erstellt',
        panorama_size: response.data.panorama_size,
        statistics: response.data.statistics,
        transformation_matrices: response.data.transformation_matrices || null,  // 3x3 Matrizen für jedes Bild
        image_sizes: response.data.image_sizes || null,  // {width, height} für jedes Originalbild
        warnings: response.data.warnings
      });

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logger.error('CV-Service nicht erreichbar');
        return res.status(503).json({
          error: 'Computer Vision Service nicht verfügbar',
          error_code: 'CV_SERVICE_UNAVAILABLE'
        });
      }
      
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        logger.error('Stitching-Timeout');
        return res.status(504).json({
          error: 'Stitching-Prozess hat zu lange gedauert',
          error_code: 'STITCHING_TIMEOUT'
        });
      }

      if (error.response?.data) {
        const errorData = error.response.data;
        logger.error('Stitching-Fehler vom CV-Service:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: JSON.stringify(errorData, null, 2)
        });
        
        const detail = errorData.detail || errorData;
        return res.status(error.response.status || 500).json({
          error: detail.error || errorData.error || 'Stitching fehlgeschlagen',
          error_code: detail.error_code || errorData.error_code || 'STITCHING_ERROR',
          details: detail
        });
      }

      logger.error('Fehler beim Stitching:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      return res.status(500).json({
        error: 'Fehler beim Erstellen des Panoramas',
        error_code: 'STITCHING_ERROR',
        details: error.message
      });
    }

  } catch (error) {
    logger.error('Panorama-Stitching Fehler:', error);
    res.status(500).json({ 
      error: 'Server error',
      error_code: 'SERVER_ERROR',
      details: error.message
    });
  }
});

// Save panorama to database
router.post('/:id/save-panorama', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ 
        error: 'Device not found',
        error_code: 'DEVICE_NOT_FOUND'
      });
    }

    if (device.actions?.mode !== 'route') {
      return res.status(400).json({ 
        error: 'Device is not in route mode',
        error_code: 'NOT_ROUTE_MODE'
      });
    }

    let { panorama_url, transformation_matrices, image_sizes, statistics } = req.body;

    if (!panorama_url) {
      return res.status(400).json({ 
        error: 'Panorama image is required',
        error_code: 'MISSING_PANORAMA'
      });
    }

    // Prüfe Größe des Panorama-Bildes (Base64)
    // MongoDB Limit ist 16MB, wir wollen sicher unter 7MB bleiben für das gesamte Dokument
    // (mit Puffer für transformation_matrices, image_sizes, statistics und andere Felder)
    
    // Extrahiere Base64-String aus Data-URL falls vorhanden
    let base64String = panorama_url;
    if (panorama_url.startsWith('data:image')) {
      // Entferne Data-URL Präfix (z.B. "data:image/jpeg;base64,")
      const base64Index = panorama_url.indexOf(',');
      if (base64Index !== -1) {
        base64String = panorama_url.substring(base64Index + 1);
      }
    }
    
    const panoramaSize = base64String.length;
    const maxSize = 7 * 1024 * 1024; // 7MB (sicherer Puffer)
    
    logger.info(`Panorama-Größe: ${(panoramaSize / 1024 / 1024).toFixed(2)} MB, Max: ${(maxSize / 1024 / 1024).toFixed(2)} MB`);
    
    if (panoramaSize > maxSize) {
      logger.warn(`Panorama-Bild ist zu groß (${(panoramaSize / 1024 / 1024).toFixed(2)} MB), wird nicht gespeichert`);
      return res.status(400).json({ 
        error: `Panorama-Bild ist zu groß (${(panoramaSize / 1024 / 1024).toFixed(2)} MB). Maximale Größe: 7 MB. Das Bild sollte automatisch komprimiert werden. Bitte erstelle das Panorama erneut.`,
        error_code: 'PANORAMA_TOO_LARGE',
        size: panoramaSize,
        max_size: maxSize
      });
    }

    // Update device with panorama data
    if (!device.actions.route) {
      device.actions.route = {};
    }

    device.actions.route.panorama = {
      image: panorama_url,
      transformation_matrices: transformation_matrices || [],
      image_sizes: image_sizes || [],
      statistics: statistics || null,
      created_at: new Date()
    };

    // Keep coordinate images out of the device document (16MB BSON limit).
    await routeImages.persistAndStripCoordinateImages(device._id, device.actions.route?.coordinates || []);
    routeImages.stripCoordinateImagesFromDoc(device);
    await device.save();

    logger.info(`Panorama gespeichert für Device ${device.name}`);

    res.json({
      success: true,
      message: 'Panorama erfolgreich gespeichert'
    });

  } catch (error) {
    logger.error('Fehler beim Speichern des Panoramas:', error);
    res.status(500).json({
      error: 'Server error',
      error_code: 'SERVER_ERROR',
      details: error.message
    });
  }
});

// --- Panorama grid scan (separate image collection per device) ---

router.get('/:id/panorama-scan', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const frames = await panoramaScanImages.listByDevice(device._id);
    res.json({ frames, count: frames.length });
  } catch (error) {
    logger.error('Panorama scan list error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/panorama-scan/save', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const { frames } = req.body || {};
    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'Keine Bilder zum Speichern' });
    }

    for (const frame of frames) {
      if (frame.rotation === undefined || frame.tilt === undefined || !frame.image) {
        return res.status(400).json({ error: 'Jedes Bild braucht rotation, tilt und image' });
      }
    }

    const count = await panoramaScanImages.replaceAll(device._id, frames);
    logger.info(`Panorama-Scan gespeichert für ${device.name}: ${count} Bilder`);

    res.json({
      success: true,
      message: `${count} Bilder gespeichert`,
      count
    });
  } catch (error) {
    logger.error('Panorama scan save error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

router.delete('/:id/panorama-scan', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const deleted = await panoramaScanImages.clear(device._id);
    res.json({ success: true, deleted });
  } catch (error) {
    logger.error('Panorama scan delete error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Per-axis FoV (horizontal == vertical) for the square-cropped scan images.
function getDeviceFov(device) {
  const cam = device?.camera || {};
  if (cam.type === 'dual' || cam.type === 'tapo') {
    return cam.tapo?.fov || 110;
  }
  if (cam.type === 'raspberry-pi') {
    return cam.raspberryPi?.fov || 75;
  }
  return cam.tapo?.fov || cam.raspberryPi?.fov || 110;
}

function buildFrameMappings(scanFrames, transformationMatrices, imageSizes, frameCorners) {
  return scanFrames.map((frame, i) => ({
    order: frame.order,
    rotation: frame.rotation,
    tilt: frame.tilt,
    image_size: imageSizes?.[i] || null,
    transformation_matrix: transformationMatrices?.[i] || null,
    panorama_corners: frameCorners?.[i] || null
  }));
}

function buildStitchResponseFromCv(method, cvData) {
  const meta = cvData.frame_metadata || [];
  const scanFrames = meta.map((m, i) => ({
    order: m.order ?? i,
    rotation: m.rotation,
    tilt: m.tilt
  }));
  const frameMappings = buildFrameMappings(
    scanFrames,
    cvData.transformation_matrices,
    cvData.image_sizes,
    cvData.frame_corners
  );
  return {
    success: true,
    method,
    panorama_url: `data:image/jpeg;base64,${cvData.panorama_base64}`,
    panorama_size: cvData.panorama_size,
    statistics: cvData.statistics,
    frames: frameMappings,
    grid_info: cvData.grid_info || null,
    hugin_pto: cvData.hugin_pto || null,
    warnings: cvData.warnings || null
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

router.post('/:id/panorama-scan/stitch', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const method = req.body?.method || 'opencv';
    if (!['opencv', 'grid', 'hugin', 'cylindrical'].includes(method)) {
      return res.status(400).json({ error: 'method muss opencv, grid, hugin oder cylindrical sein' });
    }

    const scanFrames = req.body?.frames?.length
      ? req.body.frames.map((f, i) => ({
        order: f.order ?? i,
        rotation: f.rotation,
        tilt: f.tilt,
        image: f.image
      }))
      : await panoramaScanImages.listByDevice(device._id);
    if (scanFrames.length < 2) {
      return res.status(400).json({ error: 'Mindestens 2 gespeicherte Scan-Bilder benötigt' });
    }

    const cvServiceUrl = process.env.CV_SERVICE_URL || 'http://localhost:8000';
    let cvResponse;

    if (method === 'grid') {
      cvResponse = await axios.post(`${cvServiceUrl}/stitch-panorama-grid`, {
        frames: scanFrames.map(f => ({
          order: f.order,
          rotation: f.rotation,
          tilt: f.tilt,
          image: f.image
        })),
        fov: getDeviceFov(device),
        max_dimension: 1280
      }, {
        timeout: 180000,
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (method === 'hugin' || method === 'cylindrical') {
      const useAsync = req.body?.async !== false;
      const huginPayload = {
        frames: scanFrames.map(f => ({
          order: f.order,
          rotation: f.rotation,
          tilt: f.tilt,
          image: f.image
        })),
        fov: getDeviceFov(device),
        max_dimension: 1280,
        horizon_tilt: Number(req.body?.horizon_tilt ?? 90),
        output_projection: method === 'cylindrical' ? 'cylindrical' : 'equirectangular'
      };

      if (useAsync) {
        const cvResponse = await axios.post(`${cvServiceUrl}/stitch-panorama-hugin/jobs`, huginPayload, {
          timeout: 120000,
          headers: { 'Content-Type': 'application/json' }
        });
        return res.json({
          success: true,
          async: true,
          job_id: cvResponse.data.job_id,
          method,
          frame_count: scanFrames.length
        });
      }

      cvResponse = await axios.post(`${cvServiceUrl}/stitch-panorama-hugin`, huginPayload, {
        timeout: 360000,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      cvResponse = await axios.post(`${cvServiceUrl}/stitch-panorama`, {
        image_base64_list: scanFrames.map(f => f.image),
        show_borders: false,
        // Downscale inputs so stitching many full-res scan frames doesn't
        // exhaust memory and crash the CV service.
        max_dimension: 1280
      }, {
        timeout: 180000,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = cvResponse.data;
    if (!data.success) {
      return res.status(500).json({
        error: data.error || data.detail?.error || 'Stitching fehlgeschlagen'
      });
    }

    const frameMappings = buildFrameMappings(
      scanFrames,
      data.transformation_matrices,
      data.image_sizes,
      data.frame_corners
    );

    logger.info(`Panorama-Scan Stitch (${method}) für ${device.name}: ${scanFrames.length} Bilder`);

    res.json({
      success: true,
      method,
      panorama_url: `data:image/jpeg;base64,${data.panorama_base64}`,
      panorama_size: data.panorama_size,
      statistics: data.statistics,
      frames: frameMappings,
      grid_info: data.grid_info || null,
      hugin_pto: data.hugin_pto || null,
      warnings: data.warnings || null
    });
  } catch (error) {
    // IMPORTANT: never log the raw axios error or error.response.data here.
    // The request body contains ~40MB of base64 images; serializing it (winston)
    // blows up the Node heap (OOM). logAxiosError only logs safe metadata.
    logAxiosError('Panorama scan stitch error', error);

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Computer Vision Service nicht verfügbar' });
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Stitching hat zu lange gedauert (Timeout)' });
    }

    const detail = error.response?.data?.detail;
    const errMsg = (typeof detail === 'object' ? detail?.error : detail)
      || error.response?.data?.error
      || error.message
      || 'Stitching fehlgeschlagen';
    const errorCode = (typeof detail === 'object' ? detail?.error_code : null)
      || error.response?.data?.error_code;
    res.status(error.response?.status || 500).json({ error: errMsg, error_code: errorCode || undefined });
  }
});

router.get('/:id/panorama-scan/stitch/hugin/job/:jobId', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const cvServiceUrl = process.env.CV_SERVICE_URL || 'http://localhost:8000';
    const cvResponse = await axios.get(
      `${cvServiceUrl}/stitch-panorama-hugin/jobs/${req.params.jobId}`,
      { timeout: 15000 }
    );
    const job = cvResponse.data;

    if (job.status === 'done' && job.result) {
      const stitchMethod = job.result.method || 'hugin';
      logger.info(`Panorama-Scan Stitch (${stitchMethod}) fertig für ${device.name}`);
      return res.json({
        success: true,
        status: 'done',
        progress: 100,
        step: job.step,
        step_label: job.step_label || 'Fertig',
        result: buildStitchResponseFromCv(stitchMethod, job.result)
      });
    }

    if (job.status === 'error') {
      return res.status(job.error_code === 'HUGIN_NOT_INSTALLED' ? 503 : 500).json({
        success: false,
        status: 'error',
        progress: job.progress || 0,
        step: job.step,
        step_label: job.step_label,
        error: job.error || 'Stitching fehlgeschlagen',
        error_code: job.error_code || 'HUGIN_STITCH_FAILED',
        logs: job.logs || []
      });
    }

    res.json({
      success: true,
      status: job.status,
      progress: job.progress || 0,
      step: job.step,
      step_label: job.step_label,
      message: job.message,
      logs: job.logs || []
    });
  } catch (error) {
    logAxiosError('Panorama hugin job status error', error);
    if (error.response?.status === 404) {
      return res.status(404).json({ error: 'Job nicht gefunden' });
    }
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Computer Vision Service nicht verfügbar' });
    }
    res.status(error.response?.status || 500).json({ error: 'Job-Status konnte nicht geladen werden' });
  }
});

router.post('/:id/panorama-scan/result/save', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const { method, panorama_url, panorama_size, frames, statistics, grid_info, hugin_pto } = req.body || {};
    if (!method || !['opencv', 'grid', 'hugin', 'cylindrical'].includes(method)) {
      return res.status(400).json({ error: 'method muss opencv, grid, hugin oder cylindrical sein' });
    }
    if (!panorama_url) {
      return res.status(400).json({ error: 'panorama_url fehlt' });
    }

    let base64String = panorama_url;
    if (panorama_url.startsWith('data:image')) {
      const idx = panorama_url.indexOf(',');
      if (idx >= 0) base64String = panorama_url.substring(idx + 1);
    }
    const maxSize = 7 * 1024 * 1024;
    if (base64String.length > maxSize) {
      return res.status(400).json({
        error: `Panorama zu groß (${(base64String.length / 1024 / 1024).toFixed(2)} MB). Max 7 MB.`
      });
    }

    await panoramaScanResults.upsert(device._id, method, {
      panorama: panorama_url,
      panorama_size,
      frames: frames || [],
      statistics,
      grid_info,
      hugin_pto: ['hugin', 'cylindrical'].includes(method) ? (hugin_pto || null) : null
    });

    logger.info(`Panorama-Scan Ergebnis (${method}) gespeichert für ${device.name}`);
    res.json({ success: true, message: `Panorama (${method}) gespeichert` });
  } catch (error) {
    logger.error('Panorama scan result save error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

router.get('/:id/panorama-scan/results', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const results = await panoramaScanResults.listByDevice(device._id);
    res.json({ results });
  } catch (error) {
    logger.error('Panorama scan results list error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/panorama-scan/result/:method', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const method = req.params.method;
    if (!['opencv', 'grid', 'hugin', 'cylindrical'].includes(method)) {
      return res.status(400).json({ error: 'method muss opencv, grid, hugin oder cylindrical sein' });
    }

    const result = await panoramaScanResults.getPanorama(device._id, method);
    if (!result) {
      return res.status(404).json({ error: 'Kein gespeichertes Panorama für diese Methode' });
    }

    res.json({
      method: result.method,
      panorama_url: result.panorama,
      panorama_size: result.panorama_size,
      frames: result.frames,
      statistics: result.statistics,
      grid_info: result.grid_info,
      hugin_pto: result.hugin_pto || null,
      created_at: result.createdAt
    });
  } catch (error) {
    logger.error('Panorama scan result get error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Position Preview - Move device to position
router.post('/:id/position-preview/move', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const { rotation, tilt, zoom } = req.body;

    if (rotation === undefined || tilt === undefined) {
      return res.status(400).json({ error: 'Rotation und Tilt sind erforderlich' });
    }

    // Apply position inversion if enabled
    let finalRotation = rotation;
    let finalTilt = tilt;
    
    const taubenschiesserConfig = device.taubenschiesser || {};
    if (taubenschiesserConfig.invertRotation) {
      finalRotation = 180 - finalRotation;
      logger.info(`Applied rotation inversion: ${rotation} -> ${finalRotation}`);
    }
    if (taubenschiesserConfig.invertTilt) {
      finalTilt = 180 - finalTilt;
      logger.info(`Applied tilt inversion: ${tilt} -> ${finalTilt}`);
    }

    logger.info(`Moving device ${device.name} to position: rotation=${finalRotation} (original: ${rotation}), tilt=${finalTilt} (original: ${tilt})`);

    // Move device to position (with inversion applied)
    const movementContext = await hardwareHelper.moveToPosition(device, finalRotation, finalTilt);
    
    // Wait for movement to complete
    await hardwareHelper.waitForMovementComplete(device, movementContext, {
      timeoutMs: 30000,
      stabilizationMs: getDeviceStabilizationMs(device)
    });

    res.json({
      success: true,
      message: 'Device moved successfully',
      position: { rotation, tilt }
    });
  } catch (error) {
    logger.error('Position preview move error:', error);
    res.status(500).json({ 
      error: 'Failed to move device',
      message: error.message 
    });
  }
});

// Position Preview - Capture and analyze
router.post('/:id/position-preview/capture', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const { rotation, tilt, zoom = 1 } = req.body;

    logger.info(`Capturing and analyzing for device ${device.name} at position: rotation=${rotation}, tilt=${tilt}, zoom=${zoom}`);

    const camera = device.camera;
    const isDualMode = camera?.type === 'dual';
    const result = {};

    // Handle dual camera mode - process cameras sequentially to return results immediately
    if (isDualMode) {
      // Tapo camera - process first
      if (camera.tapo) {
        try {
          // Use zoom from route coordinate if available, otherwise use provided zoom
          const routeZoom = device.actions?.route?.coordinates?.find(c => 
            c.rotation === rotation && c.tilt === tilt
          )?.zoom;
          
          // Use provided zoom if it's set and > 1, otherwise use route zoom, otherwise default to 1
          const finalZoom = (zoom && zoom > 1.0) ? zoom : (routeZoom || 1.0);
          
          // Use centralized function from hardwareHelper (same logic as hardware monitor)
          const tapoDevice = { ...device.toObject(), camera: { ...camera, type: 'tapo' } };
          const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(tapoDevice, finalZoom);
          const tapoImageBase64 = `data:image/jpeg;base64,${original}`;
          const tapoZoomedBase64 = `data:image/jpeg;base64,${zoomed}`;

          // Send for analysis - use internal endpoint (it handles CV service routing)
          const FormData = require('form-data');
          const axios = require('axios');
          const formData = new FormData();
          formData.append('image', Buffer.from(zoomed, 'base64'), {
            filename: 'tapo.jpg',
            contentType: 'image/jpeg'
          });
          formData.append('deviceId', device._id.toString());

          const cvResponse = await axios.post(
            `${getInternalApiUrl()}/api/cv/detect`,
            formData,
            {
              headers: {
                ...formData.getHeaders(),
                'Authorization': req.headers.authorization || ''
              },
              timeout: 30000
            }
          );

          result.tapo = {
            original: tapoImageBase64,
            zoomed: tapoZoomedBase64,
            analysis: {
              detection_count: cvResponse.data.detection_count || cvResponse.data.detections?.length || 0,
              detections: cvResponse.data.detections || [],
              processing_time: cvResponse.data.processing_time || cvResponse.data.processingTime || 0,
              model: cvResponse.data.model || { name: 'YOLO' },
              image_url: cvResponse.data.image_url,
              image_info: cvResponse.data.image_info
            }
          };
        } catch (error) {
          logAxiosError('Error capturing/analyzing Tapo camera:', error);
          const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Unknown error';
          result.tapo = { error: errorMessage };
        }
      }

      // Raspberry Pi camera - process second
      if (camera.raspberryPi) {
        try {
          // Get zoom from route coordinate if available, otherwise use provided zoom
          const routeZoom = device.actions?.route?.coordinates?.find(c => 
            c.rotation === rotation && c.tilt === tilt
          )?.zoom;
          
          // Use provided zoom if it's set and > 1, otherwise use route zoom, otherwise default to 1
          const baseZoom = (zoom && zoom > 1.0) ? zoom : (routeZoom || 1.0);
          
          // Calculate FOV-based zoom adjustment for Raspberry Pi (like hardware monitor does)
          const tapoFov = camera.tapo?.fov || 110;
          const piFov = camera.raspberryPi?.fov || 41;
          let totalZoomFactor = 1.0;
          
          if (baseZoom > 1.0 && tapoFov > 0 && piFov > 0) {
            // Raspberry Pi needs less zoom because it already has smaller FOV
            const fovRatio = piFov / tapoFov;
            totalZoomFactor = baseZoom * fovRatio;
            logger.info(`FOV-based zoom: base=${baseZoom}, FOV ratio=${fovRatio.toFixed(3)} → total=${totalZoomFactor.toFixed(3)}`);
          }
          
          // Use centralized function from hardwareHelper (same logic as hardware monitor)
          const piDevice = { ...device.toObject(), camera: { ...camera, type: 'raspberry-pi' } };
          const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(piDevice, totalZoomFactor);
          const piImageBase64 = `data:image/jpeg;base64,${original}`;
          const piZoomedBase64 = `data:image/jpeg;base64,${zoomed}`;

            // Send for analysis - use internal endpoint (it handles CV service routing)
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('image', Buffer.from(zoomed, 'base64'), {
              filename: 'raspberry-pi.jpg',
              contentType: 'image/jpeg'
            });
            formData.append('deviceId', device._id.toString());

            const cvResponse = await axios.post(
              `${getInternalApiUrl()}/api/cv/detect`,
              formData,
              {
                headers: {
                  ...formData.getHeaders(),
                  'Authorization': req.headers.authorization || ''
                },
                timeout: 30000
              }
            );

          result.raspberryPi = {
            original: piImageBase64,
            zoomed: piZoomedBase64,
            analysis: {
              detection_count: cvResponse.data.detection_count || cvResponse.data.detections?.length || 0,
              detections: cvResponse.data.detections || [],
              processing_time: cvResponse.data.processing_time || cvResponse.data.processingTime || 0,
              model: cvResponse.data.model || { name: 'YOLO' },
              image_url: cvResponse.data.image_url,
              image_info: cvResponse.data.image_info
            }
          };
        } catch (error) {
          logAxiosError('Error capturing/analyzing Raspberry Pi camera:', error);
          const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Unknown error';
          result.raspberryPi = { error: errorMessage };
        }
      }
    } else {
      // Single camera mode
      try {
        // Use provided zoom if > 1, otherwise check route coordinate, otherwise default to 1
        const routeZoom = device.actions?.route?.coordinates?.find(c => 
          c.rotation === rotation && c.tilt === tilt
        )?.zoom;
        
        // Use provided zoom if it's set and > 1, otherwise use route zoom, otherwise default to 1
        const finalZoom = (zoom && zoom > 1.0) ? zoom : (routeZoom || 1.0);
        
        // Use centralized function from hardwareHelper (same logic as hardware monitor)
        const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(device, finalZoom);
        const imageBase64 = `data:image/jpeg;base64,${original}`;
        const zoomedBase64 = `data:image/jpeg;base64,${zoomed}`;

        // Send for analysis - use internal endpoint (it handles CV service routing)
        const FormData = require('form-data');
        const axios = require('axios');
        const formData = new FormData();
        formData.append('image', Buffer.from(zoomed, 'base64'), {
          filename: 'camera.jpg',
          contentType: 'image/jpeg'
        });
        formData.append('deviceId', device._id.toString());

        const cvResponse = await axios.post(
          `${getInternalApiUrl()}/api/cv/detect`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              'Authorization': req.headers.authorization || ''
            },
            timeout: 30000
          }
        );

        result.original = imageBase64;
        result.zoomed = zoomedBase64;
        result.analysis = {
          detection_count: cvResponse.data.detection_count || cvResponse.data.detections?.length || 0,
          detections: cvResponse.data.detections || [],
          processing_time: cvResponse.data.processing_time || cvResponse.data.processingTime || 0,
          model: cvResponse.data.model || { name: 'YOLO' },
          image_url: cvResponse.data.image_url,
          image_info: cvResponse.data.image_info
        };
      } catch (error) {
        logAxiosError('Error capturing/analyzing camera:', error);
        const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Unknown error';
        result.error = errorMessage;
      }
    }

    res.json(result);
  } catch (error) {
    logAxiosError('Position preview capture error:', error);
    res.status(500).json({
      error: 'Failed to capture and analyze',
      message: error.message
    });
  }
});

// Position Preview - Capture single camera (for progressive updates)
router.post('/:id/position-preview/capture-camera', authenticateToken, async (req, res) => {
  try {
    const device = await Device.findOne({
      _id: req.params.id,
      owner: req.user.userId
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const { rotation, tilt, zoom = 1, cameraType } = req.body;

    if (!cameraType) {
      return res.status(400).json({ error: 'cameraType is required (tapo, raspberry-pi, or single)' });
    }

    logger.info(`Capturing ${cameraType} camera for device ${device.name} at position: rotation=${rotation}, tilt=${tilt}, zoom=${zoom}`);

    const camera = device.camera;
    const result = {};

    // Process single camera based on type
    if (cameraType === 'tapo' && camera.tapo) {
      try {
        const tapoDevice = { ...device.toObject(), camera: { ...camera, type: 'tapo' } };
        
        // Use provided zoom if > 1, otherwise check route coordinate, otherwise default to 1
        const routeZoom = device.actions?.route?.coordinates?.find(c => 
          c.rotation === rotation && c.tilt === tilt
        )?.zoom;
        
        // Use provided zoom if it's set and > 1, otherwise use route zoom, otherwise default to 1
        const finalZoom = (zoom && zoom > 1.0) ? zoom : (routeZoom || 1.0);
        
        // Use centralized function from hardwareHelper (same logic as hardware monitor)
        const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(tapoDevice, finalZoom);
        const tapoImageBase64 = `data:image/jpeg;base64,${original}`;
        const tapoZoomedBase64 = `data:image/jpeg;base64,${zoomed}`;

        const FormData = require('form-data');
        const axios = require('axios');
        const formData = new FormData();
        formData.append('image', Buffer.from(zoomed, 'base64'), {
          filename: 'tapo.jpg',
          contentType: 'image/jpeg'
        });
        formData.append('deviceId', device._id.toString());

        const cvResponse = await axios.post(
          `${getInternalApiUrl()}/api/cv/detect`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              'Authorization': req.headers.authorization || ''
            },
            timeout: 30000
          }
        );

        result.tapo = {
          original: tapoImageBase64,
          zoomed: tapoZoomedBase64,
          analysis: {
            detection_count: cvResponse.data.detection_count || cvResponse.data.detections?.length || 0,
            detections: cvResponse.data.detections || [],
            processing_time: cvResponse.data.processing_time || cvResponse.data.processingTime || 0,
            model: cvResponse.data.model || { name: 'YOLO' },
            image_url: cvResponse.data.image_url,
            image_info: cvResponse.data.image_info
          }
        };
      } catch (error) {
        logAxiosError('Error capturing/analyzing Tapo camera:', error);
        const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Unknown error';
        result.tapo = { error: errorMessage };
      }
    } else if (cameraType === 'raspberry-pi' && camera.raspberryPi) {
      try {
        // Use provided zoom if > 1, otherwise check route coordinate, otherwise default to 1
        const routeZoom = device.actions?.route?.coordinates?.find(c => 
          c.rotation === rotation && c.tilt === tilt
        )?.zoom;
        
        // Use provided zoom if it's set and > 1, otherwise use route zoom, otherwise default to 1
        const baseZoom = (zoom && zoom > 1.0) ? zoom : (routeZoom || 1.0);
        
        const tapoFov = camera.tapo?.fov || 110;
        const piFov = camera.raspberryPi?.fov || 41;
        let totalZoomFactor = 1.0;
        
        if (baseZoom > 1.0 && tapoFov > 0 && piFov > 0) {
          const fovRatio = piFov / tapoFov;
          totalZoomFactor = baseZoom * fovRatio;
        }
        
        // Use centralized function from hardwareHelper (same logic as hardware monitor)
        // Note: For Raspberry Pi, we need to calculate FOV-adjusted zoom
        const piDevice = { ...device.toObject(), camera: { ...camera, type: 'raspberry-pi' } };
        const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(piDevice, totalZoomFactor);
        const piImageBase64 = `data:image/jpeg;base64,${original}`;
        const piZoomedBase64 = `data:image/jpeg;base64,${zoomed}`;

        const FormData = require('form-data');
        const axios = require('axios');
        const formData = new FormData();
        formData.append('image', Buffer.from(zoomed, 'base64'), {
          filename: 'raspberry-pi.jpg',
          contentType: 'image/jpeg'
        });
        formData.append('deviceId', device._id.toString());

        const cvResponse = await axios.post(
          `${getInternalApiUrl()}/api/cv/detect`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              'Authorization': req.headers.authorization || ''
            },
            timeout: 30000
          }
        );

        result.raspberryPi = {
          original: piImageBase64,
          zoomed: piZoomedBase64,
          analysis: {
            detection_count: cvResponse.data.detection_count || cvResponse.data.detections?.length || 0,
            detections: cvResponse.data.detections || [],
            processing_time: cvResponse.data.processing_time || cvResponse.data.processingTime || 0,
            model: cvResponse.data.model || { name: 'YOLO' },
            image_url: cvResponse.data.image_url,
            image_info: cvResponse.data.image_info
          }
        };
      } catch (error) {
        logAxiosError('Error capturing/analyzing Raspberry Pi camera:', error);
        const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Unknown error';
        result.raspberryPi = { error: errorMessage };
      }
    } else if (cameraType === 'single') {
      try {
        // Use provided zoom if > 1, otherwise check route coordinate, otherwise default to 1
        const routeZoom = device.actions?.route?.coordinates?.find(c => 
          c.rotation === rotation && c.tilt === tilt
        )?.zoom;
        
        // Use provided zoom if it's set and > 1, otherwise use route zoom, otherwise default to 1
        const finalZoom = (zoom && zoom > 1.0) ? zoom : (routeZoom || 1.0);
        
        // Use centralized function from hardwareHelper (same logic as hardware monitor)
        const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(device, finalZoom);
        const imageBase64 = `data:image/jpeg;base64,${original}`;
        const zoomedBase64 = `data:image/jpeg;base64,${zoomed}`;

        const FormData = require('form-data');
        const axios = require('axios');
        const formData = new FormData();
        formData.append('image', Buffer.from(zoomed, 'base64'), {
          filename: 'camera.jpg',
          contentType: 'image/jpeg'
        });
        formData.append('deviceId', device._id.toString());

        const cvResponse = await axios.post(
          `${getInternalApiUrl()}/api/cv/detect`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              'Authorization': req.headers.authorization || ''
            },
            timeout: 30000
          }
        );

        result.original = imageBase64;
        result.zoomed = zoomedBase64;
        result.analysis = {
          detection_count: cvResponse.data.detection_count || cvResponse.data.detections?.length || 0,
          detections: cvResponse.data.detections || [],
          processing_time: cvResponse.data.processing_time || cvResponse.data.processingTime || 0,
          model: cvResponse.data.model || { name: 'YOLO' },
          image_url: cvResponse.data.image_url,
          image_info: cvResponse.data.image_info
        };
      } catch (error) {
        logAxiosError('Error capturing/analyzing camera:', error);
        const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Unknown error';
        result.error = errorMessage;
      }
    } else {
      return res.status(400).json({ error: `Camera type ${cameraType} not available for this device` });
    }

    res.json(result);
  } catch (error) {
    logAxiosError('Position preview capture camera error:', error);
    res.status(500).json({
      error: 'Failed to capture and analyze',
      message: error.message
    });
  }
});

module.exports = router;
