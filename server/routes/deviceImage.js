const express = require('express');
const { spawn } = require('child_process');
const Device = require('../models/Device');
const logger = require('../utils/logger');
const rtspFrameManager = require('../utils/rtspFrameManager');
const hardwareHelper = require('../utils/hardwareHelper');

const router = express.Router();

// Einfache Bild-API (kein Video-Stream)
router.get('/:deviceId', async (req, res) => {
  const deviceId = req.params.deviceId;
  
  try {
    // CORS-Header setzen
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // Gerät aus Datenbank laden
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Optional query params
    const rawZoom = req.query.zoom;
    let zoom = typeof rawZoom === 'string' ? Number.parseFloat(rawZoom) : 1.0;
    if (!Number.isFinite(zoom) || zoom < 1.0) zoom = 1.0;
    if (zoom > 3.0) zoom = 3.0;

    const variantParam = typeof req.query.variant === 'string' ? req.query.variant : '';
    const variant = (variantParam === 'original' || variantParam === 'zoomed')
      ? variantParam
      : (zoom > 1.0 ? 'zoomed' : 'original');

    const format = (req.query.format === 'json') ? 'json' : 'jpeg';

    const sourceParam = typeof req.query.source === 'string' ? req.query.source.trim() : '';
    const cameraSource = (sourceParam === 'raspberry-pi' || sourceParam === 'tapo')
      ? sourceParam
      : undefined;

    // 1) Preferred: use centralized helper (supports raspberry-pi + rtsp/tapo/dual)
    try {
      const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(device, zoom, {
        cameraSource
      });
      const imageBase64 = variant === 'zoomed' ? zoomed : original;

      if (format === 'json') {
        return res.json({
          deviceId,
          variant,
          zoom,
          source: cameraSource || device.camera?.type || null,
          contentType: 'image/jpeg',
          timestamp: new Date().toISOString(),
          imageBase64
        });
      }

      const buf = Buffer.from(imageBase64, 'base64');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Last-Modified', new Date().toUTCString());
      return res.end(buf);
    } catch (error) {
      logger.warn(`Centralized capture failed for device ${deviceId}: ${error.message}`);
    }

    // 2) Fallback: RTSP snapshot (legacy behavior)
    const rtspUrl = device.getRtspUrl();
    if (!rtspUrl) {
      return res.status(400).json({ error: 'Camera capture not available for this device' });
    }

    // Versuche, über persistenten RTSP-Stream sofort einen Frame zu liefern
    try {
      const frameBuffer = await rtspFrameManager.getFrame(deviceId, rtspUrl);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Last-Modified', new Date().toUTCString());
      return res.end(frameBuffer);
    } catch (error) {
      logger.warn(`Persistent RTSP frame failed for device ${deviceId}: ${error.message}`);
    }

    // Einfaches Bild mit FFmpeg erstellen (qualitativ hochwertig)
    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',      // Stabilere Verbindung
      '-i', rtspUrl,
      '-vframes', '1',
      '-an',                         // Kein Audio
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-q:v', '2',                   // Höchste JPEG-Qualität (2 ~ sehr gut)
      'pipe:1'
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // HTTP-Header setzen
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');

    // FFmpeg-Output direkt an HTTP-Response weiterleiten (OHNE zu speichern)
    ffmpegProcess.stdout.pipe(res);
    
    ffmpegProcess.stdout.on('end', () => {
      res.end();
    });

    // Fehlerbehandlung
    ffmpegProcess.stderr.on('data', (data) => {
      logger.debug(`FFmpeg stderr for device ${deviceId}: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
      logger.info(`FFmpeg process for device ${deviceId} exited with code ${code}`);
    });

    ffmpegProcess.on('error', (error) => {
      logger.error(`FFmpeg error for device ${deviceId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Image capture error' });
      }
    });

    // Client disconnect handling
    req.on('close', () => {
      if (ffmpegProcess && !ffmpegProcess.killed) {
        ffmpegProcess.kill();
      }
    });

    logger.info(`Image capture started for device ${deviceId}: ${rtspUrl}`);

  } catch (error) {
    logger.error(`Error capturing image for device ${deviceId}:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

module.exports = router;

