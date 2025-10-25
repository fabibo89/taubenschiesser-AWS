const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const logger = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const hardwareHelper = require('../utils/hardwareHelper');

// MQTT-Steuerungsbefehle für Taubenschiesser
// Format entspricht dem ESP32-Code (verwendet "type" statt "action")
const MQTT_COMMANDS = {
  rotate_left: {
    message: JSON.stringify({ 
      type: 'impulse',
      speed: 1,
      bounce: 0,
      position: {
        rot: -10,  // 10 Grad nach links
        tilt: 0
      }
    })
  },
  rotate_right: {
    message: JSON.stringify({ 
      type: 'impulse',
      speed: 1,
      bounce: 0,
      position: {
        rot: 10,   // 10 Grad nach rechts
        tilt: 0
      }
    })
  },
  move_up: {
    message: JSON.stringify({ 
      type: 'impulse',
      speed: 1,
      bounce: 0,
      position: {
        rot: 0,
        tilt: 10   // 10 Grad nach oben
      }
    })
  },
  move_down: {
    message: JSON.stringify({ 
      type: 'impulse',
      speed: 1,
      bounce: 0,
      position: {
        rot: 0,
        tilt: -10  // 10 Grad nach unten
      }
    })
  },
  shoot: {
    message: JSON.stringify({ 
      type: 'shoot',
      duration: 500
    })
  },
  reset: {
    message: JSON.stringify({ 
      type: 'reset'
    })
  }
};

// Gerät steuern
router.post('/:id/control', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!action || !MQTT_COMMANDS[action]) {
      return res.status(400).json({ 
        error: 'Ungültige Aktion. Verfügbare Aktionen: ' + Object.keys(MQTT_COMMANDS).join(', ')
      });
    }

    const device = await Device.findOne({
      _id: id,
      owner: req.user.userId
    });

    if (!device) {
      return res.status(404).json({ error: 'Gerät nicht gefunden' });
    }

    if (!device.taubenschiesser?.ip) {
      return res.status(400).json({ error: 'Taubenschiesser IP nicht konfiguriert' });
    }

    // MQTT-Befehl senden
    const command = MQTT_COMMANDS[action];
    const topic = `taubenschiesser/${device.taubenschiesser.ip}`;
    
    logger.info(`Sending MQTT command to device ${device.name}: ${action}`, {
      deviceId: device._id,
      deviceIp: device.taubenschiesser.ip,
      topic: topic,
      message: command.message
    });

    // Get user to access MQTT settings
    const User = require('../models/User');
    const user = await User.findById(device.owner);
    
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    try {
      // Get MQTT client for this user
      const mqttClient = await hardwareHelper.getMqttClient(device.owner, user.settings);
      
      // Send MQTT command
      await new Promise((resolve, reject) => {
        mqttClient.publish(topic, command.message, (error) => {
          if (error) {
            logger.error('Failed to publish MQTT message:', error);
            reject(error);
          } else {
            logger.info(`MQTT command '${action}' sent successfully to ${topic}`);
            resolve();
          }
        });
      });
    } catch (mqttError) {
      logger.error('MQTT error:', mqttError);
      return res.status(500).json({ 
        error: 'MQTT-Verbindungsfehler',
        details: mqttError.message
      });
    }

    // Aktualisiere Geräte-Status
    device.lastSeen = new Date();
    await device.save();

    // Emit Socket.IO Event für Echtzeit-Updates
    const io = req.app.get('io');
    if (io) {
      io.to(`device-${device._id}`).emit('device-control', {
        deviceId: device._id,
        action,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: `Befehl '${action}' an Gerät '${device.name}' gesendet`,
      device: {
        id: device._id,
        name: device.name,
        ip: device.taubenschiesser.ip,
        action,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Device control error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Alle verfügbaren Befehle abrufen
router.get('/commands', (req, res) => {
  const commands = Object.keys(MQTT_COMMANDS).map(action => ({
    action,
    description: getCommandDescription(action),
    topic: MQTT_COMMANDS[action].topic
  }));

  res.json({ commands });
});

// Geräte-Überwachung starten
router.post('/:id/start', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const device = await Device.findOne({
      _id: id,
      owner: req.user.userId
    });

    if (!device) {
      return res.status(404).json({ error: 'Gerät nicht gefunden' });
    }

    // Aktualisiere Monitor-Status
    device.monitorStatus = 'running';
    device.lastSeen = new Date();
    await device.save();

    // Emit Socket.IO Event für Echtzeit-Updates
    const io = req.app.get('io');
    if (io) {
      io.emit('device-update', device);
    }

    logger.info(`Device monitoring started for ${device.name}`, {
      deviceId: device._id,
      monitorStatus: device.monitorStatus
    });

    res.json({
      success: true,
      message: `Überwachung für Gerät '${device.name}' gestartet`,
      device: {
        id: device._id,
        name: device.name,
        monitorStatus: device.monitorStatus
      }
    });

  } catch (error) {
    logger.error('Device start error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Geräte-Überwachung pausieren
router.post('/:id/pause', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const device = await Device.findOne({
      _id: id,
      owner: req.user.userId
    });

    if (!device) {
      return res.status(404).json({ error: 'Gerät nicht gefunden' });
    }

    // Aktualisiere Monitor-Status
    device.monitorStatus = 'paused';
    device.lastSeen = new Date();
    await device.save();

    // Emit Socket.IO Event für Echtzeit-Updates
    const io = req.app.get('io');
    if (io) {
      io.emit('device-update', device);
    }

    logger.info(`Device monitoring paused for ${device.name}`, {
      deviceId: device._id,
      monitorStatus: device.monitorStatus
    });

    res.json({
      success: true,
      message: `Überwachung für Gerät '${device.name}' pausiert`,
      device: {
        id: device._id,
        name: device.name,
        monitorStatus: device.monitorStatus
      }
    });

  } catch (error) {
    logger.error('Device pause error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Geräte-Status manuell aktualisieren
router.post('/:id/refresh', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const device = await Device.findOne({
      _id: id,
      owner: req.user.userId
    });

    if (!device) {
      return res.status(404).json({ error: 'Gerät nicht gefunden' });
    }

    // Starte manuelle Status-Prüfung
    const deviceMonitor = req.app.get('deviceMonitor');
    if (deviceMonitor) {
      await deviceMonitor.checkDeviceById(id);
    }

    res.json({
      success: true,
      message: 'Geräte-Status wird aktualisiert'
    });

  } catch (error) {
    logger.error('Device refresh error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Geräte-Stream starten/stoppen
router.post('/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'start' oder 'stop'

    const device = await Device.findOne({
      _id: id
    });

    if (!device) {
      return res.status(404).json({ error: 'Gerät nicht gefunden' });
    }

    const streamService = req.app.get('streamService');
    
    if (action === 'start') {
      // RTSP-Stream starten
      const rtspUrl = device.getRtspUrl();
      if (!rtspUrl) {
        return res.status(400).json({ error: 'RTSP-URL nicht verfügbar' });
      }

      logger.info(`Starting stream for device ${device.name}: ${rtspUrl}`);
      
      try {
        const streamUrl = await streamService.startStream(device._id, rtspUrl);
        logger.info(`Stream started for device ${device.name}: ${streamUrl}`);
      } catch (error) {
        logger.error(`Error starting stream for device ${device.name}:`, error);
        return res.status(500).json({ error: 'Fehler beim Starten des Streams' });
      }

    } else if (action === 'stop') {
      // RTSP-Stream stoppen
      logger.info(`Stopping stream for device ${device.name}`);
      
      try {
        await streamService.stopStream(device._id);
        logger.info(`Stream stopped for device ${device.name}`);
      } catch (error) {
        logger.error(`Error stopping stream for device ${device.name}:`, error);
        return res.status(500).json({ error: 'Fehler beim Stoppen des Streams' });
      }
    }

    res.json({
      success: true,
      message: `Stream ${action === 'start' ? 'gestartet' : 'gestoppt'}`,
      device: {
        id: device._id,
        name: device.name,
        streamAction: action
      }
    });

  } catch (error) {
    logger.error('Stream control error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Hilfsfunktion für Befehlsbeschreibungen
function getCommandDescription(action) {
  const descriptions = {
    start: 'Gerät starten',
    stop: 'Gerät stoppen',
    pause: 'Gerät pausieren',
    rotate_left: 'Nach links drehen',
    rotate_right: 'Nach rechts drehen',
    move_up: 'Nach oben bewegen',
    move_down: 'Nach unten bewegen',
    shoot: 'Schießen',
    reset: 'Gerät zurücksetzen'
  };
  return descriptions[action] || 'Unbekannter Befehl';
}

// Stream-Status abrufen
router.get('/:id/stream-status', async (req, res) => {
  try {
    const { id } = req.params;
    const streamService = req.app.get('streamService');
    
    const device = await Device.findOne({
      _id: id
    });

    if (!device) {
      return res.status(404).json({ error: 'Gerät nicht gefunden' });
    }

    const streamStatus = streamService.getStreamStatus(id);
    const rtspUrl = device.getRtspUrl();
    const isActive = streamService.isStreamActive(id);

    res.json({
      deviceId: id,
      deviceName: device.name,
      rtspUrl,
      streamStatus: {
        active: isActive,
        streamUrl: isActive ? `http://localhost:8080/streams/${id}.m3u8` : null
      },
      isActive
    });

  } catch (error) {
    logger.error('Stream status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Alle aktiven Streams abrufen
router.get('/streams/active', authenticateToken, async (req, res) => {
  try {
    const streamService = req.app.get('streamService');
    const activeStreams = streamService.getAllActiveStreams();
    
    res.json({
      activeStreams,
      count: activeStreams.length
    });

  } catch (error) {
    logger.error('Active streams error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
