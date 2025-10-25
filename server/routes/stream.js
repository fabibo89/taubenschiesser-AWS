const express = require('express');
const { spawn } = require('child_process');
const Device = require('../models/Device');
const logger = require('../utils/logger');

const router = express.Router();

// Aktive FFmpeg-Prozesse
const activeStreams = new Map();

// CORS-Preflight für alle Stream-Routen
router.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(200).end();
});

// HTTP-Stream für Browser (RTSP zu HTTP konvertiert)
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    // CORS-Header sofort setzen
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Gerät aus Datenbank laden
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // RTSP-URL generieren
    const rtspUrl = device.getRtspUrl();
    if (!rtspUrl) {
      return res.status(400).json({ error: 'RTSP URL not available' });
    }

    // Prüfen ob Stream bereits läuft
    if (activeStreams.has(deviceId)) {
      logger.info(`Stream already active for device ${deviceId}`);
      return res.redirect(`/stream/${deviceId}/live`);
    }

    // FFmpeg-Prozess starten (RTSP zu HTTP)
    const ffmpegArgs = [
      '-i', rtspUrl,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1'
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Stream-Info speichern
    activeStreams.set(deviceId, {
      process: ffmpegProcess,
      rtspUrl,
      startTime: new Date()
    });

    // HTTP-Header setzen
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // FFmpeg-Output an HTTP-Response weiterleiten
    ffmpegProcess.stdout.pipe(res);

    // Fehlerbehandlung
    ffmpegProcess.stderr.on('data', (data) => {
      logger.debug(`FFmpeg stderr for device ${deviceId}: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
      logger.info(`FFmpeg process for device ${deviceId} exited with code ${code}`);
      activeStreams.delete(deviceId);
    });

    ffmpegProcess.on('error', (error) => {
      logger.error(`FFmpeg error for device ${deviceId}:`, error);
      activeStreams.delete(deviceId);
      res.status(500).json({ error: 'Stream error' });
    });

    // Client disconnect handling
    req.on('close', () => {
      if (activeStreams.has(deviceId)) {
        const streamInfo = activeStreams.get(deviceId);
        if (streamInfo && streamInfo.process) {
          streamInfo.process.kill();
        }
        activeStreams.delete(deviceId);
      }
    });

    logger.info(`HTTP stream started for device ${deviceId}: ${rtspUrl}`);

  } catch (error) {
    logger.error(`Error starting HTTP stream for device ${deviceId}:`, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Stream stoppen
router.delete('/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  if (activeStreams.has(deviceId)) {
    const streamInfo = activeStreams.get(deviceId);
    if (streamInfo && streamInfo.process) {
      streamInfo.process.kill();
    }
    activeStreams.delete(deviceId);
    logger.info(`Stream stopped for device ${deviceId}`);
  }
  
  res.json({ success: true, message: 'Stream stopped' });
});

// Stream-Status
router.get('/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  const isActive = activeStreams.has(deviceId);
  
  res.json({
    deviceId,
    active: isActive,
    activeStreams: activeStreams.size
  });
});

module.exports = router;
