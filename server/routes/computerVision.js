const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// In-memory cache for detection statistics (short TTL to reduce repeated aggregation)
const STATS_CACHE_TTL_MS = 90 * 1000; // 90 seconds
const statsCache = new Map(); // key -> { data, expiresAt }

// In-memory cache for unclassified detections (Tauben-Tinder)
const UNCLASSIFIED_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const unclassifiedCache = new Map(); // key -> { data, expiresAt }

function invalidateUnclassifiedCacheForUser(userId) {
  const prefix = `${userId}:unclassified:`;
  for (const key of unclassifiedCache.keys()) {
    if (key.startsWith(prefix)) unclassifiedCache.delete(key);
  }
}

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
          model: cvResponse.data.model || { name: 'YOLOv8' },
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
          model: { name: 'YOLOv8 Demo' },
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
      .select('_id device processedAt classification_status processingTime detections target_bird temperature camera_position model image_info')
      .sort({ processedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('device', 'name deviceId type');

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

// Get unclassified detections for Tinder view (must be before /detections/:id)
router.get('/detections/unclassified', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
    const cacheKey = `${req.user.userId}:unclassified:${limitNum}`;

    const cached = unclassifiedCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info('[Unclassified] Cache hit', { cacheKey });
      return res.json(cached.data);
    }

    // Get all devices owned by user
    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map(d => d._id);

    // If user has no devices, return empty array
    if (deviceIds.length === 0) {
      return res.json({ detections: [] });
    }

    // Lean select: only fields needed by Tauben-Tinder (images, detections, image_info, etc.)
    const detections = await Detection.find({
      device: { $in: deviceIds },
      $or: [
        { classification_status: null },
        { classification_status: { $exists: false } }
      ]
    })
      .select('_id device image zoomed_image tapo_image tapo_zoomed_image raspberry_pi_image raspberry_pi_zoomed_image image_info detections target_bird processedAt processingTime')
      .sort({ processedAt: -1 })
      .limit(limitNum)
      .populate('device', 'name deviceId type');

    const response = { detections };
    unclassifiedCache.set(cacheKey, { data: response, expiresAt: Date.now() + UNCLASSIFIED_CACHE_TTL_MS });

    res.json(response);
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

// Get detection statistics grouped by day and classification (must be before /detections/:id)
// Uses MongoDB aggregation for performance (no loading all detections into Node)
router.get('/detections/statistics', authenticateToken, async (req, res) => {
  try {
    const { deviceId, days = 30 } = req.query;
    const daysNum = parseInt(days, 10) || 30;
    const cacheKey = `${req.user.userId}:${deviceId || 'all'}:${daysNum}`;

    const cached = statsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info('[DetectionStats] Cache hit', { cacheKey });
      return res.json(cached.data);
    }

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

    const result = await Detection.aggregate([
      {
        $match: {
          device: matchDevice,
          processedAt: { $gte: startDate }
        }
      },
      {
        $project: {
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
    ]);

    // Attach device names from initial query (avoids $lookup in aggregation)
    const statistics = result.map(stat => ({
      ...stat,
      deviceName: deviceNameById.get(stat.deviceId) || 'Unknown'
    }));

    const totalDetections = statistics.reduce((sum, s) => sum + s.data.reduce((n, d) => n + d.unclassified + d.confirmed_pigeon + d.no_pigeon, 0), 0);
    logger.info(`[DetectionStats] Returning statistics for ${statistics.length} devices (aggregation), total detections in result: ${totalDetections}`);
    statistics.forEach(stat => {
      logger.info(`[DetectionStats] Device ${stat.deviceId} (${stat.deviceName}): ${stat.data.length} days with data`);
    });

    const response = { statistics };
    statsCache.set(cacheKey, { data: response, expiresAt: Date.now() + STATS_CACHE_TTL_MS });

    res.json(response);
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

// Get single detection
router.get('/detections/:id', authenticateToken, async (req, res) => {
  try {
    const detection = await Detection.findById(req.params.id)
      .populate('device', 'name deviceId type owner');
    
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    // Check if user owns the device
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

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
      .populate('device', 'owner');

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
    invalidateUnclassifiedCacheForUser(req.user.userId);

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
      .populate('device', 'owner');
    
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    
    // Check ownership
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (action === 'delete') {
      await Detection.deleteOne({ _id: detection._id });
      invalidateUnclassifiedCacheForUser(req.user.userId);
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
    invalidateUnclassifiedCacheForUser(req.user.userId);

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
