const express = require('express');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const logger = require('../utils/logger');

const router = express.Router();

// Hardware Monitor Detection Endpoint (no auth required)
router.post('/detection', async (req, res) => {
  try {
    const { 
      deviceId, 
      original_image, 
      zoomed_image, 
      detections, 
      bird_count, 
      confidence_level, 
      processing_time, 
      zoom_factor,
      image_info,
      timestamp 
    } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    // Find device
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Create detection record with both images
    const detection = new Detection({
      device: device._id,
      image: {
        url: original_image,
        filename: `detection_original_${deviceId}_${Date.now()}.jpg`,
        size: original_image ? original_image.length : 0
      },
      zoomed_image: {
        url: zoomed_image,
        filename: `detection_zoomed_${deviceId}_${Date.now()}.jpg`,
        size: zoomed_image ? zoomed_image.length : 0
      },
      detections: detections || [],
      processedAt: new Date(timestamp || Date.now()),
      processingTime: processing_time || 0,
      zoom_factor: zoom_factor || 1.0,
      image_info: image_info || {},
      model: {
        name: 'YOLOv8-Hardware',
        version: '1.0.0'
      }
    });
    
    await detection.save();
    
    // Update device last detection
    device.camera.lastDetection = new Date();
    await device.save();
    
    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`device-${device._id}`).emit('new-detection', {
        detection,
        bird_count,
        confidence_level,
        zoom_factor,
        timestamp: new Date()
      });
    }
    
    logger.info(`Hardware detection saved for device ${deviceId}: ${bird_count} birds, confidence: ${confidence_level}, zoom: ${zoom_factor}x`);
    
    res.json({
      success: true,
      detection_id: detection._id,
      detection_count: detections ? detections.length : 0,
      bird_count,
      confidence_level,
      zoom_factor,
      timestamp: detection.processedAt
    });
    
  } catch (error) {
    logger.error('Hardware detection save error:', error);
    res.status(500).json({ error: 'Failed to save detection' });
  }
});

// Get hardware detections (no auth required for monitoring)
router.get('/detections/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 10 } = req.query;
    
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const detections = await Detection.find({ device: deviceId })
      .sort({ processedAt: -1 })
      .limit(parseInt(limit))
      .select('detections processedAt processingTime model');
    
    res.json({
      detections,
      count: detections.length
    });
    
  } catch (error) {
    logger.error('Get hardware detections error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
