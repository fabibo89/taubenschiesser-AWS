const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

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
    const { deviceId, page = 1, limit = 20, classificationStatus } = req.query;
    const skip = (page - 1) * limit;

    // Get all devices owned by user for filtering
    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map(d => d._id);

    let query = {
      device: { $in: deviceIds }
    };

    if (deviceId) {
      const device = await Device.findOne({ 
        deviceId, 
        owner: req.user.userId 
      });
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }
      query.device = device._id;
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

    const detections = await Detection.find(query)
      .sort({ processedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('device', 'name deviceId type');

    const total = await Detection.countDocuments(query);

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

// Get unclassified detections for Tinder view (must be before /detections/:id)
router.get('/detections/unclassified', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    // Get all devices owned by user
    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map(d => d._id);
    
    // If user has no devices, return empty array
    if (deviceIds.length === 0) {
      return res.json({ detections: [] });
    }
    
    const detections = await Detection.find({
      device: { $in: deviceIds },
      $or: [
        { classification_status: null },
        { classification_status: { $exists: false } }
      ]
    })
      .sort({ processedAt: -1 })
      .limit(parseInt(limit))
      .populate('device', 'name deviceId type');

    res.json({ detections });
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
      .populate('device', 'owner');
    
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    
    // Check ownership
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (action === 'delete') {
      // Delete detection
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
