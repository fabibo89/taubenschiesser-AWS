const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const { findDuplicateGroups } = require('../utils/duplicateDetections');
const cvServiceUrl = process.env.CV_SERVICE_URL || 'http://localhost:8000';

/** Enrich a detection doc with esp_rot, esp_tilt, is_target_bird for display. Uses cv-service (single source of truth). */
async function enrichDetectionForResponse(detection, device) {
  if (!detection || !device) return;
  const cameraPosition = detection.camera_position;
  const imageInfo = detection.image_info;
  if (!cameraPosition || cameraPosition.rotation == null || cameraPosition.tilt == null || !imageInfo) return;
  const cameraConfig = device.camera;
  if (!cameraConfig) return;

  try {
    const toPlain = (x) => (x && typeof x.toObject === 'function' ? x.toObject() : (x && typeof x === 'object' ? { ...x } : x));
    const payload = {
      detections: Array.isArray(detection.detections) ? detection.detections.map(d => toPlain(d)) : [],
      target_bird: detection.target_bird ? toPlain(detection.target_bird) : null,
      camera_position: cameraPosition,
      image_info: imageInfo,
      zoom_factor: detection.zoom_factor ?? 1.0,
      camera_config: cameraConfig,
      camera_source: detection.camera_source
    };
    const res = await axios.post(`${cvServiceUrl}/compute-esp-angles`, payload, { timeout: 5000 });
    if (res.data && Array.isArray(res.data.detections)) {
      detection.detections = res.data.detections;
      detection.target_bird = res.data.target_bird != null ? res.data.target_bird : detection.target_bird;
    }
  } catch (err) {
    logger.debug('CV service compute-esp-angles unavailable, skipping angle enrichment:', err.message || err.code);
  }
}

/** Resolve display image URLs (single + dual camera fields). */
function pickDetectionImages(detection) {
  const zoomedUrl =
    detection.zoomed_image?.url ||
    detection.tapo_zoomed_image?.url ||
    detection.raspberry_pi_zoomed_image?.url ||
    null;
  const imageUrl =
    detection.image?.url ||
    detection.tapo_image?.url ||
    detection.raspberry_pi_image?.url ||
    null;

  return {
    image: imageUrl ? { url: imageUrl } : null,
    zoomed_image: zoomedUrl ? { url: zoomedUrl } : null,
    image_info: detection.image_info || null
  };
}

const router = express.Router();

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Process image with CV service
router.post('/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { deviceId } = req.body;
    
    // Demo mode - call real CV service
    if (deviceId === 'demo-device') {
      try {
        // Send image to real CV service
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype
        });

        const cvResponse = await axios.post(
          `${process.env.CV_SERVICE_URL || 'http://localhost:8000'}/detect`,
          formData,
          {
            headers: {
              ...formData.getHeaders()
            },
            timeout: 30000 // 30 second timeout
          }
        );

        return res.json({
          success: true,
          detections: cvResponse.data.detections || [],
          detection_count: cvResponse.data.detection_count || 0,
          processing_time: cvResponse.data.processing_time || 0,
          model: cvResponse.data.model || { name: 'YOLO' },
          image_url: cvResponse.data.image_url,
          image_info: cvResponse.data.image_info,
          demo_mode: false
        });
      } catch (error) {
        // Fallback to demo response if CV service fails
        return res.json({
          success: true,
          detections: [
            { class: 'bird', confidence: 0.95, bbox: [100, 100, 200, 200] },
            { class: 'person', confidence: 0.87, bbox: [300, 150, 150, 300] }
          ],
          detection_count: 2,
          processing_time: 150,
          model: { name: 'YOLO Demo' },
          demo_mode: true
        });
      }
    }

    // Production mode - require authentication
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token manually for production mode
    try {
      const token = req.headers.authorization.split(' ')[1];
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      req.user = { userId: decoded.userId };
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    // Find device by _id instead of deviceId
    const device = await Device.findOne({ 
      _id: deviceId, 
      owner: req.user.userId 
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Send image to CV service
    // Use form-data package (not native FormData) for Node.js
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const cvServiceUrl = process.env.CV_SERVICE_URL || 'http://localhost:8000';
    logger.info(`Sending image to CV service: ${cvServiceUrl}/detect`);
    
    const cvResponse = await axios.post(
      `${cvServiceUrl}/detect`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        timeout: 30000 // 30 second timeout
      }
    );
    
    logger.info(`CV service response status: ${cvResponse.status}`);

    const detections = cvResponse.data.detections || [];
    
    // Save detection to database
    const detection = new Detection({
      device: device._id,
      image: {
        url: cvResponse.data.image_url,
        filename: req.file.originalname,
        size: req.file.size
      },
      detections: detections,
      processingTime: cvResponse.data.processing_time,
      model: cvResponse.data.model
    });

    await detection.save();

    // Update device last detection
    device.lastDetection = new Date();
    await device.save();

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`device-${device._id}`).emit('new-detection', detection);
    }

    res.json({
      success: true,
      detections,
      detection_count: detections.length,
      detectionId: detection._id,
      processing_time: cvResponse.data.processing_time,
      processingTime: cvResponse.data.processing_time,
      model: cvResponse.data.model,
      image_url: cvResponse.data.image_url,
      image_info: cvResponse.data.image_info
    });

  } catch (error) {
    logger.error('CV detection error:', error);
    logger.error('CV detection error details:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      status: error.response?.status,
      stack: error.stack
    });
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: 'Computer Vision service unavailable',
        details: error.message
      });
    }
    
    const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || 'Detection processing failed';
    res.status(500).json({ 
      error: 'Detection processing failed',
      details: errorMessage
    });
  }
});

// Get detection history
router.get('/detections', authenticateToken, async (req, res) => {
  try {
    const { deviceId, page = 1, limit = 20, classificationStatus, rotation, tilt, dateFrom, dateTo } = req.query;
    const skip = (page - 1) * limit;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 1000);

    // Get all devices owned by user for filtering
    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map(d => d._id);

    let query = {
      device: { $in: deviceIds }
    };

    if (deviceId) {
      const isMongoId = /^[a-fA-F0-9]{24}$/.test(deviceId);
      const device = await Device.findOne(
        isMongoId ? { _id: deviceId, owner: req.user.userId } : { deviceId, owner: req.user.userId }
      );
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }
      query.device = device._id;
    }

    // Filter by date range
    if (dateFrom || dateTo) {
      query.processedAt = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        query.processedAt.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        query.processedAt.$lte = to;
      }
    }

    // Filter by classification status
    if (classificationStatus) {
      if (classificationStatus === 'unclassified') {
        query.$or = [
          { classification_status: null },
          { classification_status: { $exists: false } }
        ];
      } else {
        query.classification_status = classificationStatus;
      }
    }

    // Filter by camera position (exact match for rotation and tilt pair)
    if (rotation !== undefined && rotation !== '' && tilt !== undefined && tilt !== '') {
      const rotationNum = parseInt(rotation, 10);
      const tiltNum = parseInt(tilt, 10);
      if (!isNaN(rotationNum) && !isNaN(tiltNum)) {
        query['camera_position.rotation'] = rotationNum;
        query['camera_position.tilt'] = tiltNum;
      }
    }

    // Lean list: image_info for bbox scaling; exclude image/zoomed_image (base64 URLs would make response 100MB+)
    const detections = await Detection.find(query)
      .select('_id device processedAt classification_status processingTime detections target_bird temperature camera_position model image_info zoom_factor camera_source shotFired shootActive')
      .sort({ processedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('device', 'name deviceId type camera');

    for (const d of detections) {
      await enrichDetectionForResponse(d, d.device);
    }

    const total = await Detection.countDocuments(query);

    res.json({
      detections,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    logger.error('Get detections error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get available camera positions from detections
router.get('/detections/positions', authenticateToken, async (req, res) => {
  try {
    // Get all devices owned by user
    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map(d => d._id);

    // Get all unique camera positions
    const positions = await Detection.aggregate([
      {
        $match: {
          device: { $in: deviceIds },
          'camera_position.rotation': { $exists: true, $ne: null },
          'camera_position.tilt': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: {
            rotation: '$camera_position.rotation',
            tilt: '$camera_position.tilt'
          }
        }
      },
      {
        $project: {
          _id: 0,
          rotation: '$_id.rotation',
          tilt: '$_id.tilt'
        }
      },
      {
        $sort: { rotation: 1, tilt: 1 }
      }
    ]);

    res.json({
      positions: positions
    });
  } catch (error) {
    logger.error('Get positions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Nearest detection at same camera position (before/after) for Tauben-Tinder "X min davor/danach" tag
router.get('/detections/nearest-at-position', authenticateToken, async (req, res) => {
  try {
    const { deviceId, rotation, tilt, processedAt } = req.query;
    const tolerance = Math.min(10, Math.max(1, parseInt(req.query.tolerance, 10) || 3)); // degrees, default 3

    if (!deviceId || rotation === undefined || tilt === undefined || !processedAt) {
      return res.status(400).json({
        error: 'Missing query params: deviceId, rotation, tilt, processedAt required'
      });
    }

    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map(d => d._id.toString());
    if (!deviceIds.includes(deviceId)) {
      return res.status(403).json({ error: 'Device not found or access denied' });
    }

    const rot = parseFloat(rotation);
    const tiltVal = parseFloat(tilt);
    const at = new Date(processedAt);
    if (Number.isNaN(at.getTime())) {
      return res.status(400).json({ error: 'Invalid processedAt date' });
    }

    const posMatch = {
      device: deviceId,
      $and: [
        { 'camera_position.rotation': { $gte: rot - tolerance, $lte: rot + tolerance } },
        { 'camera_position.tilt': { $gte: tiltVal - tolerance, $lte: tiltVal + tolerance } }
      ]
    };

    const [before, after] = await Promise.all([
      Detection.findOne({ ...posMatch, processedAt: { $lt: at } })
        .select('_id processedAt')
        .sort({ processedAt: -1 })
        .limit(1)
        .lean(),
      Detection.findOne({ ...posMatch, processedAt: { $gt: at } })
        .select('_id processedAt')
        .sort({ processedAt: 1 })
        .limit(1)
        .lean()
    ]);

    const result = {
      before: before
        ? { diffSeconds: Math.round((at - new Date(before.processedAt)) / 1000), processedAt: before.processedAt }
        : null,
      after: after
        ? { diffSeconds: Math.round((new Date(after.processedAt) - at) / 1000), processedAt: after.processedAt }
        : null
    };
    res.json(result);
  } catch (error) {
    logger.error('Nearest-at-position error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get unclassified detections for Tinder view (must be before /detections/:id)
router.get('/detections/unclassified', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

    // Get all devices owned by user
    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map(d => d._id);

    // If user has no devices, return empty array
    if (deviceIds.length === 0) {
      return res.json({ detections: [], total: 0 });
    }

    const filter = {
      device: { $in: deviceIds },
      classification_status: null
    };

    // Metadata only; images are loaded per card via GET /detections/:id/image.
    // `{ classification_status: null }` matches both null and missing fields,
    // while keeping the query index-friendly.
    const [detections, total] = await Promise.all([
      Detection.find(filter)
        .select('_id device image_info detections target_bird processedAt processingTime camera_position')
        .sort({ processedAt: -1 })
        .limit(limitNum)
        .populate('device', 'name deviceId type')
        .lean(),
      Detection.countDocuments(filter)
    ]);

    res.json({ detections, total });
  } catch (error) {
    logger.error('Get unclassified detections error:', error);
    logger.error('Get unclassified detections error details:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Server error',
      details: error.message
    });
  }
});

// Preview duplicate bird detections (dry-run). Must be before /detections/:id
router.get('/detections/duplicates/preview', authenticateToken, async (req, res) => {
  try {
    const windowMinutes = Math.min(60, Math.max(0.5, parseFloat(req.query.windowMinutes) || 5));
    const windowMs = windowMinutes * 60 * 1000;
    const deviceIdFilter = req.query.deviceId || null;

    const devices = await Device.find({ owner: req.user.userId }).select('_id name');
    let deviceIds = devices.map((d) => d._id);
    if (deviceIdFilter) {
      const allowed = deviceIds.some((id) => id.toString() === deviceIdFilter);
      if (!allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }
      deviceIds = deviceIds.filter((id) => id.toString() === deviceIdFilter);
    }
    if (deviceIds.length === 0) {
      return res.json({ windowMinutes, groups: [], totalDuplicates: 0, scanned: 0 });
    }

    const deviceNameById = new Map(devices.map((d) => [d._id.toString(), d.name || 'Unbekannt']));

    const docs = await Detection.find({
      device: { $in: deviceIds },
      'camera_position.rotation': { $exists: true, $ne: null },
      'camera_position.tilt': { $exists: true, $ne: null }
    })
      .select('_id device processedAt camera_position detections target_bird classification_status shotFired zoom_factor image_info')
      .populate('device', 'name')
      .sort({ processedAt: 1 })
      .lean();

    const { groups, duplicateIds } = findDuplicateGroups(docs, windowMs);

    const enriched = groups.map((g) => {
      const deviceId = g.device?._id?.toString?.() || g.device?.toString?.() || '';
      return {
        ...g,
        deviceId,
        deviceName: g.device?.name || deviceNameById.get(deviceId) || 'Unbekannt'
      };
    });

    res.json({
      windowMinutes,
      scanned: docs.length,
      groups: enriched,
      totalDuplicates: duplicateIds.length,
      duplicateIds
    });
  } catch (error) {
    logger.error('Duplicate preview error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Delete duplicate detections by id list (must belong to user's devices)
router.post('/detections/duplicates/delete', authenticateToken, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    if (ids.length > 5000) {
      return res.status(400).json({ error: 'Too many ids (max 5000)' });
    }

    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map((d) => d._id);
    if (deviceIds.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await Detection.deleteMany({
      _id: { $in: ids },
      device: { $in: deviceIds }
    });

    res.json({
      deleted: result.deletedCount || 0,
      requested: ids.length
    });
  } catch (error) {
    logger.error('Duplicate delete error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get detection statistics grouped by day and classification (must be before /detections/:id)
// Uses MongoDB aggregation for performance (no loading all detections into Node)
router.get('/detections/statistics', authenticateToken, async (req, res) => {
  try {
    const { deviceId, days = 30 } = req.query;
    const daysNum = parseInt(days, 10) || 30;

    // Get all devices owned by user (with name for result mapping, avoid $lookup)
    const devices = await Device.find({ owner: req.user.userId }).select('_id name');
    const deviceIds = devices.map(d => d._id);
    const deviceNameById = new Map(devices.map(d => [d._id.toString(), d.name || 'Unknown']));

    if (deviceIds.length === 0) {
      return res.json({ statistics: [] });
    }

    let matchDevice = { $in: deviceIds };

    if (deviceId) {
      const device = await Device.findOne({ _id: deviceId, owner: req.user.userId });
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }
      matchDevice = device._id;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    const statsPipeline = [
      {
        $match: {
          device: matchDevice,
          processedAt: { $gte: startDate }
        }
      },
      {
        $project: {
          _id: 0,
          device: 1,
          processedAt: 1,
          classification_status: 1,
          temperature: 1
        }
      },
      {
        $addFields: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$processedAt' } },
          classification: { $ifNull: ['$classification_status', 'unclassified'] }
        }
      },
      {
        $group: {
          _id: { device: '$device', date: '$date' },
          unclassified: {
            $sum: { $cond: [{ $eq: ['$classification', 'unclassified'] }, 1, 0] }
          },
          confirmed_pigeon: {
            $sum: { $cond: [{ $eq: ['$classification', 'confirmed_pigeon'] }, 1, 0] }
          },
          no_pigeon: {
            $sum: { $cond: [{ $eq: ['$classification', 'no_pigeon'] }, 1, 0] }
          },
          sum_temp_pigeon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$classification', 'confirmed_pigeon'] },
                    { $ne: ['$temperature', null] },
                    { $in: [{ $type: '$temperature' }, ['double', 'int', 'long']] }
                  ]
                },
                '$temperature',
                0
              ]
            }
          },
          count_temp_pigeon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$classification', 'confirmed_pigeon'] },
                    { $ne: ['$temperature', null] },
                    { $in: [{ $type: '$temperature' }, ['double', 'int', 'long']] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { '_id.device': 1, '_id.date': 1 } },
      {
        $group: {
          _id: '$_id.device',
          data: {
            $push: {
              date: '$_id.date',
              unclassified: '$unclassified',
              confirmed_pigeon: '$confirmed_pigeon',
              no_pigeon: '$no_pigeon',
              avg_temp_pigeon: {
                $cond: [
                  { $gt: ['$count_temp_pigeon', 0] },
                  { $round: [{ $divide: ['$sum_temp_pigeon', '$count_temp_pigeon'] }, 1] },
                  null
                ]
              }
            }
          }
        }
      },
      {
        $project: {
          deviceId: { $toString: '$_id' },
          data: 1
        }
      }
    ];
    // Force covering index so we don't read full ~3MB docs (only index fields)
    const result = await Detection.aggregate(statsPipeline).hint('device_1_processedAt_-1_classification_status_1_temperature_1');

    // Attach device names from initial query (avoids $lookup in aggregation)
    const statistics = result.map(stat => ({
      ...stat,
      deviceName: deviceNameById.get(stat.deviceId) || 'Unknown'
    }));

    res.json({ statistics });
  } catch (error) {
    logger.error('Get detection statistics error:', error);
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?.userId
    });
    res.status(500).json({
      error: 'Server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// Get detection statistics grouped by hour of day (0-23) over the last N days
router.get('/detections/statistics/hourly', authenticateToken, async (req, res) => {
  try {
    const { deviceId, days = 30 } = req.query;
    const daysNum = parseInt(days, 10) || 30;

    const devices = await Device.find({ owner: req.user.userId }).select('_id name');
    const deviceIds = devices.map(d => d._id);
    const deviceNameById = new Map(devices.map(d => [d._id.toString(), d.name || 'Unknown']));

    if (deviceIds.length === 0) {
      return res.json({ statistics: [] });
    }

    let matchDevice = { $in: deviceIds };
    if (deviceId) {
      const device = await Device.findOne({ _id: deviceId, owner: req.user.userId });
      if (!device) return res.status(404).json({ error: 'Device not found' });
      matchDevice = device._id;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    const hourlyPipeline = [
      {
        $match: {
          device: matchDevice,
          processedAt: { $gte: startDate },
          classification_status: 'confirmed_pigeon'
        }
      },
      {
        $project: {
          _id: 0,
          device: 1,
          processedAt: 1,
          temperature: 1
        }
      },
      {
        $addFields: {
          hour: { $hour: '$processedAt' }
        }
      },
      {
        $group: {
          _id: { device: '$device', hour: '$hour' },
          count: { $sum: 1 },
          sum_temp: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$temperature', null] },
                    { $in: [{ $type: '$temperature' }, ['double', 'int', 'long']] }
                  ]
                },
                '$temperature',
                0
              ]
            }
          },
          count_temp: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$temperature', null] },
                    { $in: [{ $type: '$temperature' }, ['double', 'int', 'long']] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { '_id.device': 1, '_id.hour': 1 } },
      {
        $group: {
          _id: '$_id.device',
          data: {
            $push: {
              hour: '$_id.hour',
              count: '$count',
              avg_temp: {
                $cond: [
                  { $gt: ['$count_temp', 0] },
                  { $round: [{ $divide: ['$sum_temp', '$count_temp'] }, 1] },
                  null
                ]
              }
            }
          }
        }
      },
      {
        $project: {
          deviceId: { $toString: '$_id' },
          data: 1
        }
      }
    ];
    const result = await Detection.aggregate(hourlyPipeline)
      .hint('device_1_processedAt_-1_classification_status_1_temperature_1');

    const statistics = result.map(stat => ({
      ...stat,
      deviceName: deviceNameById.get(stat.deviceId) || 'Unknown'
    }));

    res.json({ statistics });
  } catch (error) {
    logger.error('Get hourly detection statistics error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get detection images only (lightweight; used by Tauben-Tinder + Erkennungen thumbnails)
router.get('/detections/:id/image', authenticateToken, async (req, res) => {
  try {
    const detection = await Detection.findById(req.params.id)
      .select('device image zoomed_image tapo_image tapo_zoomed_image raspberry_pi_image raspberry_pi_zoomed_image image_info')
      .populate('device', 'owner');

    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(pickDetectionImages(detection));
  } catch (error) {
    logger.error('Get detection image error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single detection
router.get('/detections/:id', authenticateToken, async (req, res) => {
  try {
    const detection = await Detection.findById(req.params.id)
      .populate('device', 'name deviceId type owner camera');
    
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    // Check if user owns the device
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await enrichDetectionForResponse(detection, detection.device);
    res.json(detection);
  } catch (error) {
    logger.error('Get detection error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update detection camera_position (e.g. assign to device route point)
router.patch('/detections/:id', authenticateToken, async (req, res) => {
  try {
    const { camera_position: cameraPosition } = req.body;
    if (!cameraPosition || typeof cameraPosition.rotation !== 'number' || typeof cameraPosition.tilt !== 'number') {
      return res.status(400).json({ error: 'camera_position.rotation and camera_position.tilt (numbers) required' });
    }

    const detection = await Detection.findById(req.params.id)
      .populate('device', 'owner camera');

    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    detection.camera_position = {
      rotation: cameraPosition.rotation,
      tilt: cameraPosition.tilt
    };
    await detection.save();

    await enrichDetectionForResponse(detection, detection.device);
    res.json(detection);
  } catch (error) {
    logger.error('Patch detection error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete single detection (and associated images references)
router.delete('/detections/:id', authenticateToken, async (req, res) => {
  try {
    const detection = await Detection.findById(req.params.id)
      .populate('device', 'owner');

    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    // Ensure the current user owns the related device
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await Detection.deleteOne({ _id: detection._id });

    res.json({ message: 'Detection deleted successfully' });
  } catch (error) {
    logger.error('Delete detection error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Classify detection (swipe actions)
router.patch('/detections/:id/classify', authenticateToken, async (req, res) => {
  try {
    const { action } = req.body; // 'confirm_pigeon', 'no_pigeon', 'delete'
    
    const detection = await Detection.findById(req.params.id)
      .populate('device', 'owner camera');
    
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    
    // Check ownership
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (action === 'delete') {
      await Detection.deleteOne({ _id: detection._id });
      return res.json({ message: 'Detection deleted successfully' });
    }

    // Update classification status
    const statusMap = {
      'confirm_pigeon': 'confirmed_pigeon',
      'no_pigeon': 'no_pigeon',
      'unclassified': null
    };
    
    if (action === 'unclassified') {
      detection.classification_status = null;
      detection.classifiedAt = null;
    } else {
      detection.classification_status = statusMap[action] || null;
      detection.classifiedAt = new Date();
    }
    await detection.save();

    await enrichDetectionForResponse(detection, detection.device);
    res.json({
      message: 'Detection classified successfully',
      detection
    });
  } catch (error) {
    logger.error('Classify detection error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// CV service health check
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.CV_SERVICE_URL || 'http://localhost:8000'}/health`,
      { timeout: 5000 }
    );
    
    res.json({
      status: 'OK',
      cvService: response.data
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      error: 'CV service unavailable'
    });
  }
});

module.exports = router;
