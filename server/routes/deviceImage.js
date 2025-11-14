const express = require('express');
const { spawn } = require('child_process');
const axios = require('axios');
const Device = require('../models/Device');
const logger = require('../utils/logger');
const rtspFrameManager = require('../utils/rtspFrameManager');

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

    // RTSP-URL generieren (Fallback)
    const rtspUrl = device.getRtspUrl();
    if (!rtspUrl) {
      return res.status(400).json({ error: 'RTSP URL not available' });
    }

    // Versuche, über persistenten RTSP-Stream sofort einen Frame zu liefern
    try {
      const frameBuffer = await rtspFrameManager.getFrame(deviceId, rtspUrl);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
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

