const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Device = require('../models/Device');
const logger = require('../utils/logger');

const router = express.Router();

// Einfache Bild-API (kein Video-Stream)
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
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

    // RTSP-URL generieren
    const rtspUrl = device.getRtspUrl();
    if (!rtspUrl) {
      return res.status(400).json({ error: 'RTSP URL not available' });
    }

    // Einfaches Bild mit FFmpeg erstellen
    const ffmpegArgs = [
      '-i', rtspUrl,
      '-vframes', '1',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      'pipe:1'
    ];
    
    // Optional: Bild auch speichern
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const imagePath = path.join(__dirname, '../../images', `${deviceId}_${timestamp}.jpg`);
    
    // Images-Verzeichnis erstellen falls nicht vorhanden
    const imagesDir = path.join(__dirname, '../../images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // HTTP-Header setzen
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');

    // FFmpeg-Output an HTTP-Response weiterleiten UND speichern
    const chunks = [];
    
    ffmpegProcess.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      res.write(chunk);
    });
    
    ffmpegProcess.stdout.on('end', () => {
      // Bild speichern
      const imageBuffer = Buffer.concat(chunks);
      fs.writeFile(imagePath, imageBuffer, (err) => {
        if (err) {
          logger.error(`Error saving image for device ${deviceId}:`, err);
        } else {
          logger.info(`Image saved for device ${deviceId}: ${imagePath}`);
        }
      });
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
      res.status(500).json({ error: 'Image capture error' });
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
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
