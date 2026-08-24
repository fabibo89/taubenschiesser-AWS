const express = require('express');
const router = express.Router({ mergeParams: true });
const Device = require('../models/Device');
const Detection = require('../models/Detection');
const logger = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const hardwareHelper = require('../utils/hardwareHelper');
const { buildShootCommand } = require('../utils/shootCommand');
const { calculateAngleAdjustment } = require('../utils/angleHelper');
const {
  normalizeLaserZone,
  isLaserRestrictionActive,
  isBirdInZone
} = require('../utils/laserZone');

/** deviceId -> { previousMonitorStatus, previousMonitorArmed, userId } */
const shootTestSessions = new Map();

function applyInversion(device, rotation, tilt) {
  let rot = Number(rotation);
  let t = Number(tilt);
  const cfg = device.taubenschiesser || {};
  if (cfg.invertRotation) rot = 180 - rot;
  if (cfg.invertTilt) t = 180 - t;
  return { rotation: rot, tilt: t };
}

function findRouteCoordinate(device, rotation, tilt) {
  const coords = device.actions?.route?.coordinates || [];
  const r = Math.round(Number(rotation));
  const t = Math.round(Number(tilt));
  const index = coords.findIndex(
    (c) => Math.round(Number(c.rotation)) === r && Math.round(Number(c.tilt)) === t
  );
  if (index < 0) return null;
  return { coordinate: coords[index], index };
}

function pickTargetBird(detection) {
  if (detection.target_bird?.bbox) return detection.target_bird;
  const birds = (detection.detections || []).filter((d) => {
    const cls = String(d.class || '').toLowerCase();
    return !cls || ['bird', 'birds', 'vogel', 'vögel', 'pigeon', 'dove'].includes(cls);
  });
  if (!birds.length) return null;
  return birds.reduce((best, d) => ((d.confidence || 0) > (best.confidence || 0) ? d : best));
}

function resolveZoneAvailability(device, routeCoordinate, targetBird, zoomFactor, imageInfo, waypointIndex = null) {
  const taub = device.taubenschiesser || {};
  const globalLaser = taub.shootUseLaser !== false;
  const globalAudio = !!taub.shootUseAudio;
  const zone = normalizeLaserZone(routeCoordinate?.laserZone);
  const laserRestrictionActive = isLaserRestrictionActive(zone);

  let laserAllowed = false;
  let laserReason = null;
  if (!globalLaser) {
    laserReason = 'Laser global deaktiviert';
  } else if (!laserRestrictionActive) {
    laserAllowed = true;
  } else if (!targetBird?.bbox) {
    laserReason = 'Keine Vogel-Bounding-Box für Zonenprüfung';
  } else {
    const origW = imageInfo?.original_size?.width;
    const origH = imageInfo?.original_size?.height;
    if (!origW || !origH) {
      laserReason = 'Keine Bildgröße für Zonenprüfung';
    } else if (isBirdInZone(targetBird, zone, zoomFactor, origW, origH)) {
      laserAllowed = true;
    } else {
      laserReason = 'Ziel außerhalb der Laser-Zone dieses Wegpunkts';
    }
  }

  let audioAllowed = false;
  let audioReason = null;
  if (!globalAudio) {
    audioReason = 'Audio global deaktiviert';
  } else if (!routeCoordinate) {
    audioReason = 'Kein passender Wegpunkt für diese Position';
  } else if (routeCoordinate.audioEnabled !== true) {
    audioReason = 'Audio an diesem Wegpunkt deaktiviert';
  } else {
    audioAllowed = true;
  }

  // Water has no zone; always allowed for shoot-test selection
  return {
    water: { allowed: true, reason: null },
    laser: { allowed: laserAllowed, reason: laserReason, zoneActive: laserRestrictionActive },
    audio: { allowed: audioAllowed, reason: audioReason },
    routeCoordinate: routeCoordinate
      ? {
          rotation: routeCoordinate.rotation,
          tilt: routeCoordinate.tilt,
          zoom: routeCoordinate.zoom,
          audioEnabled: !!routeCoordinate.audioEnabled,
          hasLaserZone: laserRestrictionActive,
          hasRouteImage: Boolean(routeCoordinate.image),
          laserZone: zone,
          waypointIndex: typeof waypointIndex === 'number' ? waypointIndex : null,
          waypointNumber: typeof waypointIndex === 'number' ? waypointIndex + 1 : null
        }
      : null
  };
}

async function loadOwnedDevice(req) {
  return Device.findOne({ _id: req.params.id, owner: req.user.userId });
}

function getStabilizationMs(device) {
  return hardwareHelper.getDeviceStabilizationMs
    ? hardwareHelper.getDeviceStabilizationMs(device)
    : (device.taubenschiesser?.stabilizeTimeMs ?? 500);
}

// Enter shoot-test: remember state, pause monitor (no home reset), disarm
router.post('/enter', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const previousMonitorStatus = device.monitorStatus || 'paused';
    const previousMonitorArmed = device.monitorArmed === true;

    shootTestSessions.set(device._id.toString(), {
      previousMonitorStatus,
      previousMonitorArmed,
      userId: req.user.userId,
      startedAt: new Date().toISOString()
    });

    device.monitorStatus = 'paused';
    device.monitorArmed = false;
    device.lastSeen = new Date();
    await device.save();

    const io = req.app.get('io');
    if (io) io.emit('device-update', device);

    logger.info(`Shoot-test enter for ${device.name}`, {
      deviceId: device._id,
      previousMonitorStatus,
      previousMonitorArmed
    });

    res.json({
      success: true,
      previous: { monitorStatus: previousMonitorStatus, monitorArmed: previousMonitorArmed },
      device: {
        id: device._id,
        name: device.name,
        monitorStatus: device.monitorStatus,
        monitorArmed: device.monitorArmed
      }
    });
  } catch (error) {
    logger.error('Shoot-test enter error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Leave shoot-test: restore previous monitor status/arm
router.post('/leave', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const key = device._id.toString();
    const session = shootTestSessions.get(key);
    if (!session || session.userId !== req.user.userId) {
      return res.json({ success: true, restored: false, message: 'Keine aktive Shoot-Test-Session' });
    }

    device.monitorStatus = session.previousMonitorStatus || 'paused';
    device.monitorArmed = session.previousMonitorArmed === true;
    device.lastSeen = new Date();
    await device.save();
    shootTestSessions.delete(key);

    const io = req.app.get('io');
    if (io) io.emit('device-update', device);

    logger.info(`Shoot-test leave for ${device.name}`, {
      deviceId: device._id,
      restoredStatus: device.monitorStatus,
      restoredArmed: device.monitorArmed
    });

    res.json({
      success: true,
      restored: true,
      device: {
        id: device._id,
        name: device.name,
        monitorStatus: device.monitorStatus,
        monitorArmed: device.monitorArmed
      }
    });
  } catch (error) {
    logger.error('Shoot-test leave error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Zone availability for a detection (for UI toggles)
router.get('/zone-status/:detectionId', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const detection = await Detection.findById(req.params.detectionId)
      .select('device camera_position detections target_bird zoom_factor image_info camera_source')
      .lean();
    if (!detection) return res.status(404).json({ error: 'Detection nicht gefunden' });
    if (detection.device.toString() !== device._id.toString()) {
      return res.status(403).json({ error: 'Detection gehört nicht zu diesem Gerät' });
    }

    const pos = detection.camera_position || {};
    const routeMatch = findRouteCoordinate(device, pos.rotation, pos.tilt);
    const routeCoordinate = routeMatch?.coordinate || null;
    const waypointIndex = routeMatch?.index ?? null;
    const targetBird = pickTargetBird(detection);
    const zoomFactor = detection.zoom_factor || routeCoordinate?.zoom || 1;
    const availability = resolveZoneAvailability(
      device,
      routeCoordinate,
      targetBird,
      zoomFactor,
      detection.image_info,
      waypointIndex
    );

    res.json({
      camera_position: pos,
      zoom_factor: zoomFactor,
      hasTargetBird: Boolean(targetBird?.bbox || targetBird?.position),
      routeImage: routeCoordinate?.image || null,
      waypointIndex,
      waypointNumber: waypointIndex != null ? waypointIndex + 1 : null,
      image_info: detection.image_info || null,
      targetBird: targetBird
        ? {
            bbox: targetBird.bbox || null,
            position: targetBird.position || null,
            confidence: targetBird.confidence,
            class: targetBird.class
          }
        : null,
      availability
    });
  } catch (error) {
    logger.error('Shoot-test zone-status error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Move to a logical route pose (applies inversion). Used when selecting a detection.
router.post('/goto-pose', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    if (!device.taubenschiesser?.ip) {
      return res.status(400).json({ error: 'Taubenschiesser IP nicht konfiguriert' });
    }

    const { rotation, tilt } = req.body || {};
    if (rotation == null || tilt == null || Number.isNaN(Number(rotation)) || Number.isNaN(Number(tilt))) {
      return res.status(400).json({ error: 'rotation und tilt erforderlich' });
    }

    const pose = applyInversion(device, rotation, tilt);
    await hardwareHelper.moveToPosition(device, pose.rotation, pose.tilt);
    res.json({ position: pose });
  } catch (error) {
    logger.error('Shoot-test goto-pose error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

/**
 * Aim by clicking on the live image: move so the clicked point becomes image center.
 * `rotation`/`tilt` are the current motor pose (as returned by goto-pose / previous aim-click).
 * `normX`/`normY` are 0–1 coordinates in the live frame.
 */
router.post('/aim-click', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    if (!device.taubenschiesser?.ip) {
      return res.status(400).json({ error: 'Taubenschiesser IP nicht konfiguriert' });
    }

    const {
      rotation,
      tilt,
      normX,
      normY,
      zoomFactor = 1,
      imageWidth,
      imageHeight,
      cameraSource
    } = req.body || {};

    if (rotation == null || tilt == null) {
      return res.status(400).json({ error: 'rotation und tilt (aktuelle Pose) erforderlich' });
    }
    if (normX == null || normY == null
      || Number(normX) < 0 || Number(normX) > 1
      || Number(normY) < 0 || Number(normY) > 1) {
      return res.status(400).json({ error: 'normX/normY müssen zwischen 0 und 1 liegen' });
    }

    const imgW = Number(imageWidth) > 0 ? Number(imageWidth) : 640;
    const imgH = Number(imageHeight) > 0 ? Number(imageHeight) : 640;
    const cx = Number(normX) * imgW;
    const cy = Number(normY) * imgH;
    const bbox = { x: cx - 0.5, y: cy - 0.5, width: 1, height: 1 };

    const camSource = cameraSource
      || (device.camera?.type === 'raspberry-pi' ? 'raspberry-pi' : 'tapo');

    const { rotationAdjustment, tiltAdjustment } = calculateAngleAdjustment(
      bbox,
      imgW,
      imgH,
      zoomFactor,
      device.camera || {},
      camSource
    );

    const newPose = {
      rotation: Math.round(Number(rotation) + rotationAdjustment),
      tilt: Math.round(Number(tilt) + tiltAdjustment)
    };

    await hardwareHelper.moveToPosition(device, newPose.rotation, newPose.tilt);

    res.json({
      position: newPose,
      adjustment: { rotation: rotationAdjustment, tilt: tiltAdjustment }
    });
  } catch (error) {
    logger.error('Shoot-test aim-click error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

/**
 * Execute shoot test from a stored detection:
 * move to scan pose → aim from detection bbox → shoot → return|stay
 */
router.post('/execute', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    if (!device.taubenschiesser?.ip) {
      return res.status(400).json({ error: 'Taubenschiesser IP nicht konfiguriert' });
    }

    const {
      detectionId,
      mode = 'return', // 'return' | 'stay'
      useWater = true,
      useLaser = true,
      useAudio = true
    } = req.body || {};

    if (!detectionId) return res.status(400).json({ error: 'detectionId erforderlich' });
    if (!['return', 'stay'].includes(mode)) {
      return res.status(400).json({ error: 'mode muss return oder stay sein' });
    }

    const detection = await Detection.findById(detectionId)
      .select('device camera_position detections target_bird zoom_factor image_info camera_source')
      .lean();
    if (!detection) return res.status(404).json({ error: 'Detection nicht gefunden' });
    if (detection.device.toString() !== device._id.toString()) {
      return res.status(403).json({ error: 'Detection gehört nicht zu diesem Gerät' });
    }

    const pos = detection.camera_position;
    if (pos?.rotation == null || pos?.tilt == null) {
      return res.status(400).json({ error: 'Detection ohne Kamera-Position' });
    }

    const targetBird = pickTargetBird(detection);
    if (!targetBird?.bbox) {
      return res.status(400).json({ error: 'Keine Vogel-Bounding-Box in der Detection' });
    }

    const routeMatch = findRouteCoordinate(device, pos.rotation, pos.tilt);
    const routeCoordinate = routeMatch?.coordinate || null;
    const waypointIndex = routeMatch?.index ?? null;
    const zoomFactor = detection.zoom_factor || routeCoordinate?.zoom || 1;
    const availability = resolveZoneAvailability(
      device,
      routeCoordinate,
      targetBird,
      zoomFactor,
      detection.image_info,
      waypointIndex
    );

    const finalWater = useWater === true && availability.water.allowed;
    const finalLaser = useLaser === true && availability.laser.allowed;
    const finalAudio = useAudio === true && availability.audio.allowed;

    if (!finalWater && !finalLaser && !finalAudio) {
      return res.status(400).json({
        error: 'Keine erlaubte Schuss-Aktion ausgewählt (Zone/Einstellungen)',
        availability
      });
    }

    const scanPose = applyInversion(device, pos.rotation, pos.tilt);
    const imgW = detection.image_info?.zoomed_size?.width
      || detection.image_info?.original_size?.width
      || 640;
    const imgH = detection.image_info?.zoomed_size?.height
      || detection.image_info?.original_size?.height
      || 640;

    const camSource = targetBird.camera_source
      || detection.camera_source
      || (device.camera?.type === 'raspberry-pi' ? 'raspberry-pi' : 'tapo');

    const { rotationAdjustment, tiltAdjustment } = calculateAngleAdjustment(
      targetBird.bbox,
      imgW,
      imgH,
      zoomFactor,
      device.camera || {},
      camSource
    );

    const aimPose = {
      rotation: scanPose.rotation + rotationAdjustment,
      tilt: scanPose.tilt + tiltAdjustment
    };

    const steps = [];
    const stabMs = getStabilizationMs(device);

    // 1) Move to scan position (where detection was taken)
    let ctx = await hardwareHelper.moveToPosition(device, scanPose.rotation, scanPose.tilt);
    await hardwareHelper.waitForMovementComplete(device, ctx, { timeoutMs: 30000, stabilizationMs: stabMs });
    steps.push({ step: 'move_scan', position: scanPose });

    // 2) Aim
    ctx = await hardwareHelper.moveToPosition(device, Math.round(aimPose.rotation), Math.round(aimPose.tilt));
    await hardwareHelper.waitForMovementComplete(device, ctx, { timeoutMs: 15000, stabilizationMs: Math.min(500, stabMs) });
    steps.push({
      step: 'aim',
      position: { rotation: Math.round(aimPose.rotation), tilt: Math.round(aimPose.tilt) },
      adjustment: { rotation: rotationAdjustment, tilt: tiltAdjustment }
    });

    // 3) Shoot
    const shootPayload = buildShootCommand(device.taubenschiesser, {
      useWater: finalWater,
      useLaser: finalLaser,
      useAudio: finalAudio
    });
    const User = require('../models/User');
    const user = await User.findById(device.owner);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    const mqttClient = await hardwareHelper.getMqttClient(device.owner, user.settings);
    const topic = `taubenschiesser/${device.taubenschiesser.ip}`;
    await hardwareHelper.ensureDeviceSubscription(mqttClient, device.taubenschiesser.ip);
    await new Promise((resolve, reject) => {
      mqttClient.publish(topic, JSON.stringify(shootPayload), (err) => (err ? reject(err) : resolve()));
    });
    const durationMs = shootPayload.duration || 500;
    await new Promise((r) => setTimeout(r, Math.max(800, durationMs + 400)));
    steps.push({
      step: 'shoot',
      payload: {
        useWater: finalWater,
        useLaser: finalLaser,
        useAudio: finalAudio,
        duration: durationMs
      }
    });

    // 4) Return or stay
    if (mode === 'return') {
      ctx = await hardwareHelper.moveToPosition(device, scanPose.rotation, scanPose.tilt);
      await hardwareHelper.waitForMovementComplete(device, ctx, { timeoutMs: 30000, stabilizationMs: stabMs });
      steps.push({ step: 'return', position: scanPose });
    } else {
      steps.push({ step: 'stay', position: { rotation: Math.round(aimPose.rotation), tilt: Math.round(aimPose.tilt) } });
    }

    logger.info(`Shoot-test executed for ${device.name}`, {
      detectionId,
      mode,
      finalWater,
      finalLaser,
      finalAudio
    });

    res.json({
      success: true,
      mode,
      availability,
      applied: { water: finalWater, laser: finalLaser, audio: finalAudio },
      steps
    });
  } catch (error) {
    logger.error('Shoot-test execute error:', error);
    res.status(500).json({ error: 'Shoot-Test fehlgeschlagen', message: error.message });
  }
});

module.exports = router;
