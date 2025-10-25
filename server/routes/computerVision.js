const express = require('express');
const multer = require('multer');
const axios = require('axios');
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
          'Content-Type': 'multipart/form-data'
        },
        timeout: 30000 // 30 second timeout
      }
    );

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
      detectionId: detection._id,
      processingTime: cvResponse.data.processing_time,
      image_info: cvResponse.data.image_info
    });

  } catch (error) {
    logger.error('CV detection error:', error);
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: 'Computer Vision service unavailable' 
      });
    }
    
    res.status(500).json({ error: 'Detection processing failed' });
  }
});

// Get detection history
router.get('/detections', authenticateToken, async (req, res) => {
  try {
    const { deviceId, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
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

// Get single detection
router.get('/detections/:id', authenticateToken, async (req, res) => {
  try {
    const detection = await Detection.findById(req.params.id)
      .populate('device', 'name deviceId type owner');
    
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    // Check if user owns the device
    if (detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(detection);
  } catch (error) {
    logger.error('Get detection error:', error);
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
