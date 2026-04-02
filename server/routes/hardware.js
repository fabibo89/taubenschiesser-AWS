const express = require('express');
const axios = require('axios');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const logger = require('../utils/logger');
const router = express.Router();

const cvServiceUrl = process.env.CV_SERVICE_URL || 'http://localhost:8000';

/** Resolve current CV model display name (e.g. YOLO26, YOLOv8) from CV service for hardware detections. */
async function getCvModelName() {
  try {
    const res = await axios.get(`${cvServiceUrl}/config`, { timeout: 2000 });
    const name = res.data?.model_name;
    return typeof name === 'string' && name ? name : 'YOLO';
  } catch (err) {
    logger.debug('CV service config unavailable for model name, using fallback:', err.message);
    return 'YOLO';
  }
}

// Hardware Monitor Detection Endpoint (no auth required)
router.post('/detection', async (req, res) => {
  try {
    const { 
      deviceId, 
      original_image, 
      zoomed_image, 
      detections, 
      target_bird,
      bird_count, 
      confidence_level, 
      processing_time, 
      zoom_factor,
      image_info,
      camera_source,
      temperature,
      camera_position,
      shotFired,
      shot_fired,
      // Dual camera support
      tapo_original_image,
      tapo_zoomed_image,
      tapo_image_info,
      raspberry_pi_original_image,
      raspberry_pi_zoomed_image,
      raspberry_pi_image_info,
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

    // Log temperature if provided
    if (temperature !== null && temperature !== undefined) {
      logger.info(`🌡️ Temperatur in Detection-Request erhalten: ${temperature}°C (Device: ${deviceId})`);
    } else {
      logger.debug(`⚠️ Keine Temperatur in Detection-Request (Device: ${deviceId})`);
    }

    const modelDisplayName = await getCvModelName();

    // Create detection record - support both single and dual camera modes
    const detectionData = {
      device: device._id,
      detections: detections || [],
      processedAt: new Date(timestamp || Date.now()),
      processingTime: processing_time || 0,
      zoom_factor: zoom_factor || 1.0,
      model: {
        name: `${modelDisplayName}-Hardware`,
        version: '1.0.0'
      },
      camera_source: camera_source || 'unknown',
      temperature: temperature !== null && temperature !== undefined ? temperature : undefined,
      camera_position: camera_position && camera_position.rotation !== undefined && camera_position.tilt !== undefined ? {
        rotation: camera_position.rotation,
        tilt: camera_position.tilt
      } : undefined,
      shotFired: shotFired === true || shot_fired === true
    };

    if (target_bird && (target_bird.bbox || target_bird.position)) {
      detectionData.target_bird = target_bird;
    }

    // esp_rot / esp_tilt are not stored; they are computed on demand when returning detections for the UI (same logic as shoot).

    // Add images based on mode (single or dual camera)
    if (tapo_original_image || raspberry_pi_original_image) {
      // Dual camera mode - both cameras
      if (tapo_original_image) {
        detectionData.tapo_image = {
          url: tapo_original_image,
          filename: `detection_tapo_original_${deviceId}_${Date.now()}.jpg`,
          size: tapo_original_image ? tapo_original_image.length : 0
        };
      }
      if (tapo_zoomed_image) {
        detectionData.tapo_zoomed_image = {
          url: tapo_zoomed_image,
          filename: `detection_tapo_zoomed_${deviceId}_${Date.now()}.jpg`,
          size: tapo_zoomed_image ? tapo_zoomed_image.length : 0
        };
      }
      if (raspberry_pi_original_image) {
        detectionData.raspberry_pi_image = {
          url: raspberry_pi_original_image,
          filename: `detection_raspberry_pi_original_${deviceId}_${Date.now()}.jpg`,
          size: raspberry_pi_original_image ? raspberry_pi_original_image.length : 0
        };
      }
      if (raspberry_pi_zoomed_image) {
        detectionData.raspberry_pi_zoomed_image = {
          url: raspberry_pi_zoomed_image,
          filename: `detection_raspberry_pi_zoomed_${deviceId}_${Date.now()}.jpg`,
          size: raspberry_pi_zoomed_image ? raspberry_pi_zoomed_image.length : 0
        };
      }
      // Store image info for both cameras
      if (tapo_image_info) {
        detectionData.image_info = tapo_image_info; // Use tapo as primary for backward compatibility
      }
      if (raspberry_pi_image_info) {
        detectionData.image_info = detectionData.image_info || {};
        detectionData.image_info.raspberry_pi = raspberry_pi_image_info;
      }
    } else {
      // Single camera mode - backward compatibility
      if (original_image) {
        detectionData.image = {
          url: original_image,
          filename: `detection_original_${deviceId}_${Date.now()}.jpg`,
          size: original_image ? original_image.length : 0
        };
      }
      if (zoomed_image) {
        detectionData.zoomed_image = {
          url: zoomed_image,
          filename: `detection_zoomed_${deviceId}_${Date.now()}.jpg`,
          size: zoomed_image ? zoomed_image.length : 0
        };
      }
      if (image_info) {
        detectionData.image_info = image_info;
      }
    }
    
    const detection = new Detection(detectionData);
    
    await detection.save();
    
    // Log saved temperature and position
    if (detection.temperature !== null && detection.temperature !== undefined) {
      logger.info(`✅ Detection gespeichert mit Temperatur: ${detection.temperature}°C (Detection ID: ${detection._id})`);
    } else {
      logger.debug(`⚠️ Detection gespeichert ohne Temperatur (Detection ID: ${detection._id})`);
    }
    
    if (detection.camera_position && detection.camera_position.rotation !== undefined && detection.camera_position.tilt !== undefined) {
      logger.info(`📐 Detection gespeichert mit Kamera-Position: Rot=${detection.camera_position.rotation}°, Tilt=${detection.camera_position.tilt}° (Detection ID: ${detection._id})`);
    } else {
      logger.debug(`⚠️ Detection gespeichert ohne Kamera-Position (Detection ID: ${detection._id})`);
    }
    
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

// Hardware Monitor Live Event Endpoint
router.post('/monitor-event', async (req, res) => {
  try {
    const { 
      deviceId,
      eventType,
      data,
      timestamp 
    } = req.body;
    
    if (!deviceId || !eventType) {
      return res.status(400).json({ error: 'Device ID and event type are required' });
    }
    
    // Find device
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Sanitize data before persisting (avoid MongoDB 16MB document limit, e.g. base64 images)
    const persistedData = (() => {
      if (!data || typeof data !== 'object') return data;
      const d = { ...data };
      // Most image payloads are under "image" as base64 string
      if (typeof d.image === 'string' && d.image.length > 100_000) {
        d.image = `[omitted ${d.image.length} chars]`;
      }
      // Sometimes nested image info exists
      if (d.image_info && typeof d.image_info === 'object') {
        d.image_info = { ...d.image_info };
      }
      return d;
    })();

    // Persist last monitor event so poll-based clients (e.g. Home Assistant / dashboards) can show it immediately
    try {
      if (!device.hardwareMonitor) {
        device.hardwareMonitor = {};
      }
      device.hardwareMonitor.lastEventType = eventType;
      device.hardwareMonitor.lastEventData = persistedData;
      device.hardwareMonitor.lastEventAt = new Date(timestamp || Date.now());

      // Keep last waiting info even if later events overwrite lastEventType
      if (eventType === 'device_waiting') {
        device.hardwareMonitor.lastWaitingData = persistedData;
        device.hardwareMonitor.lastWaitingAt = new Date(timestamp || Date.now());
      }

      await device.save();
    } catch (persistError) {
      logger.warn('Failed to persist hardware monitor event on device', {
        deviceId,
        eventType,
        error: persistError?.message || String(persistError)
      });
    }
    
    // Emit real-time update to clients watching this device
    const io = req.app.get('io');
    if (io) {
      io.to(`monitor-${device._id}`).emit('hardware-monitor-event', {
        deviceId,
        eventType,
        data,
        timestamp: timestamp || new Date().toISOString()
      });
      
      logger.info(`Hardware monitor event emitted for device ${deviceId}: ${eventType}`);
    }
    
    res.json({
      success: true,
      message: 'Event emitted successfully'
    });
    
  } catch (error) {
    logger.error('Hardware monitor event error:', error);
    res.status(500).json({ error: 'Failed to emit monitor event' });
  }
});

module.exports = router;
