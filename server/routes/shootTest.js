const express = require('express');
const router = express.Router({ mergeParams: true });
const Device = require('../models/Device');
const Detection = require('../models/Detection');
const logger = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const hardwareHelper = require('../utils/hardwareHelper');
const { buildShootCommand } = require('../utils/shootCommand');
const { calculateAngleAdjustment, resolveAxisFov } = require('../utils/angleHelper');
const {
  normalizeLaserZone,
  isLaserRestrictionActive,
  isBirdInZone
} = require('../utils/laserZone');
const axios = require('axios');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const routeImages = require('../utils/routeImages');

const CV_SERVICE_URL = process.env.CV_SERVICE_URL || 'http://localhost:8000';
const LOCATE_CLI = path.join(__dirname, '../../cv-service/locate_point_cli.py');
const CV_VENV_PYTHON = path.join(__dirname, '../../cv-service/venv/bin/python');

function pickDetectionImageBase64(detection) {
  const url = detection.zoomed_image?.url
    || detection.raspberry_pi_zoomed_image?.url
    || detection.tapo_zoomed_image?.url
    || detection.image?.url
    || detection.raspberry_pi_image?.url
    || detection.tapo_image?.url
    || null;
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:')) {
    const parts = url.split(',');
    return parts.length > 1 ? parts[1] : null;
  }
  // Already raw base64
  return url;
}

function computeFovFromOffsets(offsetPx, scanPose, finalPose, imgW, imgH, zoomFactor) {
  const zoom = Math.max(0.1, Number(zoomFactor) || 1);
  const dRot = Number(finalPose.rotation) - Number(scanPose.rotation);
  const dTilt = Number(finalPose.tilt) - Number(scanPose.tilt);
  let fovH = null;
  let fovV = null;
  if (Math.abs(offsetPx.x) >= 8) {
    fovH = (dRot * imgW / offsetPx.x) * zoom;
  }
  if (Math.abs(offsetPx.y) >= 8) {
    fovV = (-dTilt * imgH / offsetPx.y) * zoom;
  }
  return { fovH, fovV, dRot, dTilt };
}

/** Prefer HTTP CV service; fall back to local OpenCV CLI (no FastAPI needed). */
function locatePointViaCli(payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const py = fs.existsSync(CV_VENV_PYTHON) ? CV_VENV_PYTHON : 'python3';
    if (!fs.existsSync(LOCATE_CLI)) {
      reject(new Error(`locate_point_cli.py fehlt: ${LOCATE_CLI}`));
      return;
    }
    const child = spawn(py, [LOCATE_CLI], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('locate_point CLI timeout'));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `locate_point CLI exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`locate_point CLI invalid JSON: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function locatePoint(payload) {
  try {
    const cvRes = await axios.post(`${CV_SERVICE_URL}/locate_point`, payload, { timeout: 15000 });
    if (cvRes.data) return cvRes.data;
  } catch (httpErr) {
    logger.warn('locate_point HTTP failed, trying CLI', {
      detail: httpErr.code || httpErr.message
    });
  }
  return locatePointViaCli(payload);
}

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
  if (req.user?.isService) {
    return Device.findById(req.params.id);
  }
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

    const { rotation, tilt, asMotor, wait } = req.body || {};
    if (rotation == null || tilt == null || Number.isNaN(Number(rotation)) || Number.isNaN(Number(tilt))) {
      return res.status(400).json({ error: 'rotation und tilt erforderlich' });
    }

    // asMotor: pose already in motor space (e.g. autoAimPose / finalPose from calibrate-*).
    // Default: camera_position-style coords → applyInversion.
    const pose = asMotor
      ? { rotation: Math.round(Number(rotation)), tilt: Math.round(Number(tilt)) }
      : applyInversion(device, rotation, tilt);

    const ctx = await hardwareHelper.moveToPosition(device, pose.rotation, pose.tilt);
    if (wait) {
      const stabMs = getStabilizationMs(device);
      await hardwareHelper.waitForMovementComplete(device, ctx, {
        timeoutMs: 15000,
        stabilizationMs: Math.min(500, stabMs)
      });
    }
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
      camSource,
      (Number(req.body?.fovH) > 0 && Number(req.body?.fovV) > 0)
        ? { horizontal: Number(req.body.fovH), vertical: Number(req.body.fovV) }
        : null
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
 * move to scan pose → aim from detection bbox → optional shoot → return|stay
 * When all actions are off, only movement/aim runs (no MQTT shoot).
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
    const willShoot = finalWater || finalLaser || finalAudio;

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

    // 3) Shoot (optional — move-only if all actions off)
    if (willShoot) {
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
    } else {
      steps.push({ step: 'skip_shoot', reason: 'no_actions_selected' });
    }

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

/**
 * FOV calibration: move to scan pose → auto-aim from detection bbox → stay.
 * If resumeManual + stored manual finalPose: go there instead of fresh auto-aim.
 * Client then lets the user nudge residuals on live and records final pose.
 */
router.post('/calibrate-start', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    if (!device.taubenschiesser?.ip) {
      return res.status(400).json({ error: 'Taubenschiesser IP nicht konfiguriert' });
    }

    const { detectionId, directAim, resumeManual } = req.body || {};
    if (!detectionId) return res.status(400).json({ error: 'detectionId erforderlich' });

    const detection = await Detection.findById(detectionId)
      .select('device camera_position detections target_bird zoom_factor image_info camera_source fovCalibration')
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
    const zoomFactor = detection.zoom_factor || routeCoordinate?.zoom || 1;

    const imgW = detection.image_info?.zoomed_size?.width
      || detection.image_info?.original_size?.width
      || 640;
    const imgH = detection.image_info?.zoomed_size?.height
      || detection.image_info?.original_size?.height
      || 640;

    const camSource = targetBird.camera_source
      || detection.camera_source
      || (device.camera?.type === 'raspberry-pi' ? 'raspberry-pi' : 'tapo');

    const bbox = targetBird.bbox;
    const bboxCenterX = Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
    const bboxCenterY = Number(bbox.y || 0) + Number(bbox.height || 0) / 2;
    const offsetX = bboxCenterX - imgW / 2;
    const offsetY = bboxCenterY - imgH / 2;

    const resolvedFov = resolveAxisFov(device.camera || {}, camSource, imgW, imgH);
    const { rotationAdjustment, tiltAdjustment } = calculateAngleAdjustment(
      bbox,
      imgW,
      imgH,
      zoomFactor,
      device.camera || {},
      camSource
    );

    const cal = detection.fovCalibration || null;
    const storedManualPose = (resumeManual
      && (cal?.manual === true || cal?.method === 'manual')
      && cal?.finalPose?.rotation != null
      && cal?.finalPose?.tilt != null)
      ? {
        rotation: Math.round(Number(cal.finalPose.rotation)),
        tilt: Math.round(Number(cal.finalPose.tilt))
      }
      : null;

    // Prefer stored scanPose from prior calibration when resuming manual (FOV math).
    const scanPose = (storedManualPose && cal?.scanPose?.rotation != null && cal?.scanPose?.tilt != null)
      ? {
        rotation: Math.round(Number(cal.scanPose.rotation)),
        tilt: Math.round(Number(cal.scanPose.tilt))
      }
      : applyInversion(device, pos.rotation, pos.tilt);

    const autoAimPose = (storedManualPose && cal?.autoAimPose?.rotation != null && cal?.autoAimPose?.tilt != null)
      ? {
        rotation: Math.round(Number(cal.autoAimPose.rotation)),
        tilt: Math.round(Number(cal.autoAimPose.tilt))
      }
      : {
        rotation: Math.round(scanPose.rotation + rotationAdjustment),
        tilt: Math.round(scanPose.tilt + tiltAdjustment)
      };

    // Aim target: stored manual finalPose, else fresh auto-aim.
    const aimPose = storedManualPose || autoAimPose;

    // directAim: skip scan home (e.g. batch manual after replay already at finalPose).
    // scanPose is still returned for FOV math; only the physical detour is skipped.
    const stabMs = getStabilizationMs(device);
    let ctx;
    if (!directAim) {
      ctx = await hardwareHelper.moveToPosition(device, scanPose.rotation, scanPose.tilt);
      await hardwareHelper.waitForMovementComplete(device, ctx, { timeoutMs: 30000, stabilizationMs: stabMs });
    }

    ctx = await hardwareHelper.moveToPosition(device, aimPose.rotation, aimPose.tilt);
    await hardwareHelper.waitForMovementComplete(device, ctx, {
      timeoutMs: 15000,
      stabilizationMs: Math.min(500, stabMs)
    });

    res.json({
      success: true,
      detectionId,
      waypointNumber: routeMatch != null ? routeMatch.index + 1 : null,
      zoomFactor,
      imageSize: { width: imgW, height: imgH },
      bbox,
      offsetPx: (storedManualPose && cal?.offsetPx)
        ? { x: Number(cal.offsetPx.x), y: Number(cal.offsetPx.y) }
        : { x: offsetX, y: offsetY },
      scanPose,
      autoAimPose,
      aimPose,
      resumedManual: !!storedManualPose,
      adjustment: { rotation: rotationAdjustment, tilt: tiltAdjustment },
      resolvedFov,
      cameraSource: camSource,
      directAim: !!directAim
    });
  } catch (error) {
    logger.error('Shoot-test calibrate-start error:', error);
    res.status(500).json({ error: 'Kalibrierung fehlgeschlagen', message: error.message });
  }
});

/**
 * Save calibrated FOV onto the device camera config.
 * Prefer single `fov` (square camera → H=V=fov). Falls back to fovH/fovV.
 */
router.post('/calibrate-save-fov', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    let fov = Number(req.body?.fov);
    let fovH = Number(req.body?.fovH);
    let fovV = Number(req.body?.fovV);
    if (Number.isFinite(fov) && fov > 0 && fov <= 180) {
      fovH = fov;
      fovV = fov;
    } else if (Number.isFinite(fovH) && Number.isFinite(fovV) && fovH > 0 && fovV > 0
      && fovH <= 180 && fovV <= 180) {
      // Square default: store one combined value on all three fields
      fov = Math.round(((fovH + fovV) / 2) * 100) / 100;
      fovH = fov;
      fovV = fov;
    } else {
      return res.status(400).json({ error: 'fov (oder fovH/fovV) muss zwischen 0 und 180 liegen' });
    }

    if (!device.camera) device.camera = {};
    if (!device.camera.raspberryPi) device.camera.raspberryPi = {};
    device.camera.raspberryPi.fov = Math.round(fov * 100) / 100;
    device.camera.raspberryPi.fovH = Math.round(fovH * 100) / 100;
    device.camera.raspberryPi.fovV = Math.round(fovV * 100) / 100;
    device.markModified('camera');
    await device.save();

    res.json({
      success: true,
      raspberryPi: {
        fov: device.camera.raspberryPi.fov,
        fovH: device.camera.raspberryPi.fovH,
        fovV: device.camera.raspberryPi.fovV
      }
    });
  } catch (error) {
    logger.error('Shoot-test calibrate-save-fov error:', error);
    res.status(500).json({ error: 'FOV speichern fehlgeschlagen', message: error.message });
  }
});

/**
 * Fully automatic FOV calibration for one detection:
 * scan → auto-aim → capture live → locate bird-point via CV image match →
 * residual nudge loop → compute FOV → optionally save to device.
 * Options: directAim (skip scan home), returnToScan, source (e.g. post_shot).
 */
router.post('/calibrate-auto', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    if (!device.taubenschiesser?.ip) {
      return res.status(400).json({ error: 'Taubenschiesser IP nicht konfiguriert' });
    }

    const {
      detectionId,
      maxIterations = 6,
      pixelThreshold = 8,
      saveFov = false,
      directAim = false,
      returnToScan = false,
      source = null
    } = req.body || {};
    if (!detectionId) return res.status(400).json({ error: 'detectionId erforderlich' });

    const detection = await Detection.findById(detectionId)
      .select('device camera_position detections target_bird zoom_factor image_info camera_source zoomed_image image tapo_image tapo_zoomed_image raspberry_pi_image raspberry_pi_zoomed_image')
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

    const refBase64 = pickDetectionImageBase64(detection);
    if (!refBase64) {
      return res.status(400).json({ error: 'Detection ohne Bild für Abgleich' });
    }

    const routeMatch = findRouteCoordinate(device, pos.rotation, pos.tilt);
    const zoomFactor = detection.zoom_factor || routeMatch?.coordinate?.zoom || 1;
    const imgW = detection.image_info?.zoomed_size?.width
      || detection.image_info?.original_size?.width
      || 640;
    const imgH = detection.image_info?.zoomed_size?.height
      || detection.image_info?.original_size?.height
      || 640;

    const camSource = targetBird.camera_source
      || detection.camera_source
      || (device.camera?.type === 'raspberry-pi' ? 'raspberry-pi' : 'tapo');

    const bbox = targetBird.bbox;
    const birdX = Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
    const birdY = Number(bbox.y || 0) + Number(bbox.height || 0) / 2;
    const offsetPx = { x: birdX - imgW / 2, y: birdY - imgH / 2 };

    let resolved = resolveAxisFov(device.camera || {}, camSource, imgW, imgH);
    let trialFovH = resolved.horizontal || 60;
    let trialFovV = resolved.vertical || 60;
    const fovSoll = {
      h: trialFovH,
      v: trialFovV,
      mode: resolved.mode || null
    };

    const { rotationAdjustment, tiltAdjustment } = calculateAngleAdjustment(
      bbox,
      imgW,
      imgH,
      zoomFactor,
      device.camera || {},
      camSource,
      { horizontal: trialFovH, vertical: trialFovV }
    );

    const scanPose = applyInversion(device, pos.rotation, pos.tilt);
    let pose = {
      rotation: Math.round(scanPose.rotation + rotationAdjustment),
      tilt: Math.round(scanPose.tilt + tiltAdjustment)
    };
    const autoAimPose = { ...pose };

    const stabMs = getStabilizationMs(device);
    let ctx;
    if (!directAim) {
      ctx = await hardwareHelper.moveToPosition(device, scanPose.rotation, scanPose.tilt);
      await hardwareHelper.waitForMovementComplete(device, ctx, { timeoutMs: 30000, stabilizationMs: stabMs });
      ctx = await hardwareHelper.moveToPosition(device, pose.rotation, pose.tilt);
      await hardwareHelper.waitForMovementComplete(device, ctx, {
        timeoutMs: 15000,
        stabilizationMs: Math.min(800, stabMs)
      });
    } else {
      // Already near aim (e.g. post-shot): short settle only
      await new Promise((r) => setTimeout(r, Math.min(500, stabMs)));
    }

    const iterations = [];
    const maxIter = Math.min(10, Math.max(1, Number(maxIterations) || 6));
    const pxThresh = Math.max(2, Number(pixelThreshold) || 8);
    let lastLocate = null;
    let lastLiveBase64 = null;
    let converged = false;

    for (let i = 0; i < maxIter; i += 1) {
      const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(device, zoomFactor, {
        cameraSource: camSource === 'tapo' ? 'tapo' : 'raspberry-pi'
      });
      const liveBase64 = (zoomFactor > 1 ? zoomed : original) || original;
      if (!liveBase64) {
        return res.status(500).json({ error: 'Live-Bild konnte nicht geholt werden', iterations });
      }
      lastLiveBase64 = liveBase64;

      let locate;
      try {
        locate = await locatePoint({
          referenceImage: refBase64,
          liveImage: liveBase64,
          point: { x: birdX, y: birdY }
        });
      } catch (cvErr) {
        const detail = cvErr.response?.data?.detail
          || cvErr.response?.data?.error
          || cvErr.message
          || 'unbekannt';
        const code = cvErr.code || cvErr.response?.status || null;
        logger.error('locate_point failed', { detail, code, url: `${CV_SERVICE_URL}/locate_point` });
        return res.status(502).json({
          error: code === 'ECONNREFUSED'
            ? `CV-Service nicht erreichbar (${CV_SERVICE_URL}) und CLI-Fallback fehlgeschlagen`
            : 'CV Bildabgleich fehlgeschlagen',
          message: typeof detail === 'string' ? detail : JSON.stringify(detail),
          iterations
        });
      }

      lastLocate = locate;
      if (!locate?.success) {
        return res.status(422).json({
          error: locate?.error || 'Bildabgleich ohne Treffer',
          iterations,
          locate
        });
      }

      const rx = Number(locate.residualPx?.x) || 0;
      const ry = Number(locate.residualPx?.y) || 0;
      const liveW = Number(locate.liveSize?.width) || imgW;
      const liveH = Number(locate.liveSize?.height) || imgH;
      const step = {
        i,
        pose: { ...pose },
        residualPx: { x: rx, y: ry },
        confidence: locate.confidence,
        method: locate.method,
        livePoint: locate.livePoint
      };

      if (Math.abs(rx) <= pxThresh && Math.abs(ry) <= pxThresh) {
        step.done = true;
        iterations.push(step);
        converged = true;
        break;
      }

      const zoom = Math.max(0.1, Number(zoomFactor) || 1);
      const dRot = rx * ((trialFovH / zoom) / liveW);
      const dTilt = -ry * ((trialFovV / zoom) / liveH);
      pose = {
        rotation: Math.round(pose.rotation + dRot),
        tilt: Math.round(pose.tilt + dTilt)
      };
      step.nudge = { rotation: dRot, tilt: dTilt };
      step.nextPose = { ...pose };
      iterations.push(step);

      ctx = await hardwareHelper.moveToPosition(device, pose.rotation, pose.tilt);
      await hardwareHelper.waitForMovementComplete(device, ctx, {
        timeoutMs: 15000,
        stabilizationMs: Math.min(600, stabMs)
      });
    }

    const fovComputed = computeFovFromOffsets(offsetPx, scanPose, pose, imgW, imgH, zoomFactor);
    let fovH = fovComputed.fovH;
    let fovV = fovComputed.fovV;
    if (fovH == null && fovV != null) fovH = fovV;
    if (fovV == null && fovH != null) fovV = fovH;
    // Square camera: one FOV for device write (per-sample H/V stay as measured)
    const fovCombined = (fovH != null && fovV != null)
      ? (fovH + fovV) / 2
      : (fovH ?? fovV);

    let saved = null;
    // Post-shot never writes device FOV — samples only on Detection
    const allowSaveFov = saveFov === true && source !== 'post_shot';
    if (allowSaveFov && fovCombined != null
      && fovCombined > 5 && fovCombined < 170) {
      if (!device.camera) device.camera = {};
      if (!device.camera.raspberryPi) device.camera.raspberryPi = {};
      const rounded = Math.round(fovCombined * 100) / 100;
      device.camera.raspberryPi.fovH = rounded;
      device.camera.raspberryPi.fovV = rounded;
      device.camera.raspberryPi.fov = rounded;
      device.markModified('camera');
      await device.save();
      saved = {
        fov: device.camera.raspberryPi.fov,
        fovH: device.camera.raspberryPi.fovH,
        fovV: device.camera.raspberryPi.fovV
      };
    }

    const fovIst = {
      h: fovH != null ? Math.round(fovH * 100) / 100 : null,
      v: fovV != null ? Math.round(fovV * 100) / 100 : null
    };
    const fovDelta = {
      h: (fovIst.h != null && fovSoll.h != null) ? Math.round((fovIst.h - fovSoll.h) * 100) / 100 : null,
      v: (fovIst.v != null && fovSoll.v != null) ? Math.round((fovIst.v - fovSoll.v) * 100) / 100 : null
    };

    const waypointNumber = routeMatch != null ? routeMatch.index + 1 : null;
    const report = {
      pos: {
        soll: { rotation: pose.rotation, tilt: pose.tilt },
        ist: { rotation: autoAimPose.rotation, tilt: autoAimPose.tilt },
        delta: {
          rotation: pose.rotation - autoAimPose.rotation,
          tilt: pose.tilt - autoAimPose.tilt
        }
      },
      fov: { soll: fovSoll, ist: fovIst, delta: fovDelta }
    };

    // Persist sample on this detection (does not write device FOV unless saveFov)
    try {
      await Detection.updateOne(
        { _id: detectionId },
        {
          $set: {
            fovCalibration: {
              at: new Date(),
              converged,
              manual: false,
              source: source === 'post_shot' ? 'post_shot' : 'auto',
              scanPose,
              autoAimPose,
              finalPose: pose,
              offsetPx,
              zoomFactor,
              fovH: fovIst.h,
              fovV: fovIst.v,
              fovSollH: fovSoll.h,
              fovSollV: fovSoll.v,
              residualPx: lastLocate?.residualPx || null,
              method: lastLocate?.method || null,
              confidence: lastLocate?.confidence ?? null,
              iterations: iterations.length,
              waypointNumber
            }
          }
        }
      );
    } catch (persistErr) {
      logger.warn('fovCalibration persist failed', { detectionId, message: persistErr.message });
    }

    if (returnToScan) {
      try {
        ctx = await hardwareHelper.moveToPosition(device, scanPose.rotation, scanPose.tilt);
        await hardwareHelper.waitForMovementComplete(device, ctx, {
          timeoutMs: 30000,
          stabilizationMs: Math.min(500, stabMs)
        });
      } catch (retErr) {
        logger.warn('calibrate-auto returnToScan failed', { message: retErr.message });
      }
    }

    res.json({
      success: true,
      converged,
      detectionId,
      waypointNumber,
      zoomFactor,
      imageSize: { width: imgW, height: imgH },
      offsetPx,
      scanPose,
      autoAimPose,
      finalPose: pose,
      fov: { fovH, fovV, ...fovComputed },
      fovSoll,
      fovIst,
      report,
      saved,
      iterations,
      lastLocate,
      persistedOnDetection: true,
      source: source === 'post_shot' ? 'post_shot' : 'auto',
      directAim: !!directAim,
      returnedToScan: !!returnToScan,
      liveImageBase64: lastLiveBase64 || null
    });
  } catch (error) {
    logger.error('Shoot-test calibrate-auto error:', error);
    res.status(500).json({ error: 'Auto-Kalibrierung fehlgeschlagen', message: error.message });
  }
});

/**
 * Persist a manually aimed FOV sample on Detection.fovCalibration (Batch / Einzelbild).
 * Client sends finalPose after Steuerkreuz / Nachklicken; FOV is computed server-side.
 * Optional: capture a live frame at finalPose for the UI (liveImageBase64).
 */
router.post('/calibrate-save-manual', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const {
      detectionId,
      finalPose,
      scanPose: bodyScanPose,
      autoAimPose: bodyAutoAimPose,
      offsetPx: bodyOffsetPx,
      zoomFactor: bodyZoom,
      imageSize: bodyImageSize,
      waypointNumber: bodyWp,
      captureLive = true
    } = req.body || {};

    if (!detectionId) return res.status(400).json({ error: 'detectionId erforderlich' });
    if (finalPose?.rotation == null || finalPose?.tilt == null) {
      return res.status(400).json({ error: 'finalPose (rotation, tilt) erforderlich' });
    }

    const detection = await Detection.findById(detectionId)
      .select('device camera_position detections target_bird zoom_factor image_info camera_source fovCalibration')
      .lean();
    if (!detection) return res.status(404).json({ error: 'Detection nicht gefunden' });
    if (detection.device.toString() !== device._id.toString()) {
      return res.status(403).json({ error: 'Detection gehört nicht zu diesem Gerät' });
    }

    const pos = detection.camera_position;
    const targetBird = pickTargetBird(detection);
    const routeMatch = pos?.rotation != null && pos?.tilt != null
      ? findRouteCoordinate(device, pos.rotation, pos.tilt)
      : null;
    const waypointNumber = bodyWp != null
      ? Number(bodyWp)
      : (routeMatch != null ? routeMatch.index + 1 : null);

    const zoomFactor = Number(bodyZoom)
      || detection.zoom_factor
      || routeMatch?.coordinate?.zoom
      || 1;

    const imgW = Number(bodyImageSize?.width)
      || detection.image_info?.zoomed_size?.width
      || detection.image_info?.original_size?.width
      || 640;
    const imgH = Number(bodyImageSize?.height)
      || detection.image_info?.zoomed_size?.height
      || detection.image_info?.original_size?.height
      || 640;

    let offsetPx = bodyOffsetPx;
    if (!offsetPx && targetBird?.bbox) {
      const bbox = targetBird.bbox;
      const bboxCenterX = Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
      const bboxCenterY = Number(bbox.y || 0) + Number(bbox.height || 0) / 2;
      offsetPx = { x: bboxCenterX - imgW / 2, y: bboxCenterY - imgH / 2 };
    }
    if (!offsetPx) {
      return res.status(400).json({ error: 'offsetPx fehlt und keine Vogel-BBox vorhanden' });
    }

    const scanPose = bodyScanPose
      || (pos?.rotation != null && pos?.tilt != null
        ? applyInversion(device, pos.rotation, pos.tilt)
        : null);
    if (!scanPose) {
      return res.status(400).json({ error: 'scanPose fehlt / Detection ohne Kamera-Position' });
    }

    const pose = {
      rotation: Math.round(Number(finalPose.rotation)),
      tilt: Math.round(Number(finalPose.tilt))
    };
    const autoAimPose = bodyAutoAimPose || pose;

    const fovComputed = computeFovFromOffsets(offsetPx, scanPose, pose, imgW, imgH, zoomFactor);
    const fovH = fovComputed.fovH != null ? Math.round(fovComputed.fovH * 100) / 100 : null;
    const fovV = fovComputed.fovV != null ? Math.round(fovComputed.fovV * 100) / 100 : null;

    const camSource = targetBird?.camera_source
      || detection.camera_source
      || (device.camera?.type === 'raspberry-pi' ? 'raspberry-pi' : 'tapo');
    const resolvedFov = resolveAxisFov(device.camera || {}, camSource, imgW, imgH);
    const fovSoll = {
      h: resolvedFov?.horizontal ?? device.camera?.raspberryPi?.fovH ?? device.camera?.raspberryPi?.fov ?? null,
      v: resolvedFov?.vertical ?? device.camera?.raspberryPi?.fovV ?? device.camera?.raspberryPi?.fov ?? null
    };
    const fovIst = { h: fovH, v: fovV };
    const fovDelta = {
      h: (fovIst.h != null && fovSoll.h != null) ? Math.round((fovIst.h - fovSoll.h) * 100) / 100 : null,
      v: (fovIst.v != null && fovSoll.v != null) ? Math.round((fovIst.v - fovSoll.v) * 100) / 100 : null
    };

    const report = {
      pos: {
        soll: { rotation: pose.rotation, tilt: pose.tilt },
        ist: { rotation: autoAimPose.rotation, tilt: autoAimPose.tilt },
        delta: {
          rotation: pose.rotation - Number(autoAimPose.rotation),
          tilt: pose.tilt - Number(autoAimPose.tilt)
        }
      },
      fov: { soll: fovSoll, ist: fovIst, delta: fovDelta }
    };

    const prevExcluded = detection.fovCalibration?.excluded;
    const prevExcludedAt = detection.fovCalibration?.excludedAt;

    await Detection.updateOne(
      { _id: detectionId },
      {
        $set: {
          fovCalibration: {
            at: new Date(),
            converged: true,
            manual: true,
            scanPose,
            autoAimPose,
            finalPose: pose,
            offsetPx,
            zoomFactor,
            fovH,
            fovV,
            fovSollH: fovSoll.h,
            fovSollV: fovSoll.v,
            residualPx: null,
            method: 'manual',
            confidence: null,
            iterations: 0,
            waypointNumber,
            ...(prevExcluded ? { excluded: true, excludedAt: prevExcludedAt || new Date() } : {})
          }
        }
      }
    );

    let liveImageBase64 = null;
    if (captureLive !== false && device.taubenschiesser?.ip) {
      try {
        const stabMs = getStabilizationMs(device);
        const ctx = await hardwareHelper.moveToPosition(device, pose.rotation, pose.tilt);
        await hardwareHelper.waitForMovementComplete(device, ctx, {
          timeoutMs: 30000,
          stabilizationMs: Math.min(500, stabMs)
        });
        const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(device, zoomFactor, {
          cameraSource: camSource === 'tapo' ? 'tapo' : 'raspberry-pi'
        });
        liveImageBase64 = (zoomFactor > 1 ? zoomed : original) || original || null;
      } catch (capErr) {
        logger.warn('calibrate-save-manual live capture failed', { message: capErr.message });
      }
    }

    res.json({
      success: true,
      detectionId,
      waypointNumber,
      zoomFactor,
      imageSize: { width: imgW, height: imgH },
      offsetPx,
      scanPose,
      autoAimPose,
      finalPose: pose,
      fov: { fovH, fovV, ...fovComputed },
      fovSoll,
      fovIst,
      report,
      manual: true,
      persistedOnDetection: true,
      liveImageBase64
    });
  } catch (error) {
    logger.error('calibrate-save-manual error:', error);
    res.status(500).json({ error: 'Manuelle Kalibrierung speichern fehlgeschlagen', message: error.message });
  }
});

/**
 * Persist manual excluded flag on Detection.fovCalibration (batch ungültig/gültig).
 */
router.post('/set-calibration-excluded', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const { detectionId, excluded } = req.body || {};
    if (!detectionId) return res.status(400).json({ error: 'detectionId erforderlich' });
    if (typeof excluded !== 'boolean') {
      return res.status(400).json({ error: 'excluded (boolean) erforderlich' });
    }

    const detection = await Detection.findById(detectionId).select('device fovCalibration').lean();
    if (!detection) return res.status(404).json({ error: 'Detection nicht gefunden' });
    if (detection.device.toString() !== device._id.toString()) {
      return res.status(403).json({ error: 'Detection gehört nicht zu diesem Gerät' });
    }
    if (!detection.fovCalibration || (!detection.fovCalibration.at && detection.fovCalibration.fovH == null)) {
      return res.status(400).json({
        error: 'Keine FOV-Kalibrierung auf dieser Detection — erst kalibrieren'
      });
    }

    await Detection.updateOne(
      { _id: detectionId },
      {
        $set: {
          'fovCalibration.excluded': excluded,
          'fovCalibration.excludedAt': excluded ? new Date() : null
        }
      }
    );

    res.json({ success: true, detectionId, excluded });
  } catch (error) {
    logger.error('set-calibration-excluded error:', error);
    res.status(500).json({ error: 'Speichern fehlgeschlagen', message: error.message });
  }
});

/**
 * On-demand: move to stored fovCalibration.finalPose and capture a live frame
 * (calibrated image is not persisted — regenerate when reviewing a prior run).
 */
router.post('/replay-calibrated-image', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    if (!device.taubenschiesser?.ip) {
      return res.status(400).json({ error: 'Taubenschiesser IP nicht konfiguriert' });
    }

    const { detectionId } = req.body || {};
    if (!detectionId) return res.status(400).json({ error: 'detectionId erforderlich' });

    const detection = await Detection.findById(detectionId)
      .select('device zoom_factor camera_source fovCalibration target_bird')
      .lean();
    if (!detection) return res.status(404).json({ error: 'Detection nicht gefunden' });
    if (detection.device.toString() !== device._id.toString()) {
      return res.status(403).json({ error: 'Detection gehört nicht zu diesem Gerät' });
    }

    const cal = detection.fovCalibration;
    const pose = cal?.finalPose;
    if (pose?.rotation == null || pose?.tilt == null) {
      return res.status(400).json({ error: 'Keine gespeicherte finalPose für diese Detection' });
    }

    const zoomFactor = cal.zoomFactor || detection.zoom_factor || 1;
    const camSource = detection.target_bird?.camera_source
      || detection.camera_source
      || (device.camera?.type === 'raspberry-pi' ? 'raspberry-pi' : 'tapo');

    const stabMs = getStabilizationMs(device);
    const ctx = await hardwareHelper.moveToPosition(device, pose.rotation, pose.tilt);
    await hardwareHelper.waitForMovementComplete(device, ctx, {
      timeoutMs: 30000,
      stabilizationMs: stabMs
    });

    const { original, zoomed } = await hardwareHelper.captureFrameWithZoom(device, zoomFactor, {
      cameraSource: camSource === 'tapo' ? 'tapo' : 'raspberry-pi'
    });
    const liveBase64 = (zoomFactor > 1 ? zoomed : original) || original;
    if (!liveBase64) {
      return res.status(500).json({ error: 'Live-Bild konnte nicht geholt werden' });
    }

    res.json({
      success: true,
      detectionId,
      finalPose: pose,
      zoomFactor,
      liveImageBase64: liveBase64,
      regenerated: true
    });
  } catch (error) {
    logger.error('replay-calibrated-image error:', error);
    res.status(500).json({
      error: 'Kalibrierbild erzeugen fehlgeschlagen',
      message: error.message
    });
  }
});

/**
 * Wegpunkt-Miniaturen aus der RouteImage-Collection (nicht im Device-Doc).
 */
router.get('/route-thumbs', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    const coords = device.actions?.route?.coordinates || [];
    const withImages = await routeImages.getCoordinatesWithImages(device._id, coords);
    res.json({
      thumbs: withImages.map((c, i) => ({
        number: i + 1,
        rotation: c.rotation,
        tilt: c.tilt,
        image: c.image || null
      }))
    });
  } catch (error) {
    logger.error('route-thumbs error:', error);
    res.status(500).json({ error: 'Wegpunkt-Bilder laden fehlgeschlagen', message: error.message });
  }
});

/**
 * List recent detections at a waypoint suitable for FOV batch calibration.
 * Query: waypointNumber (1-based) or rotation+tilt,
 *        OR allPositions=true + calibratedOnly — alle Pos mit gespeicherter Kalibrierung
 *        limit (default 10, max 30; calibratedOnly max 100; allPositions max 300),
 *        priorMode: overwrite | skip | append
 *        birdFilter: pigeon_and_unknown | confirmed_only | all
 *        calibratedOnly: true — nur Detections mit gespeicherter fovCalibration
 */
router.get('/calibrate-candidates', authenticateToken, async (req, res) => {
  try {
    const device = await loadOwnedDevice(req);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const calibratedOnly = req.query.calibratedOnly === '1'
      || req.query.calibratedOnly === 'true'
      || req.query.calibratedOnly === true;
    const allPositions = req.query.allPositions === '1'
      || req.query.allPositions === 'true'
      || req.query.allPositions === true;
    const limit = Math.min(
      allPositions && calibratedOnly ? 300 : (calibratedOnly ? 100 : 30),
      Math.max(1, Number(req.query.limit) || (
        allPositions && calibratedOnly ? 200 : (calibratedOnly ? 50 : 10)
      ))
    );
    const priorMode = ['overwrite', 'skip', 'append'].includes(String(req.query.priorMode || ''))
      ? String(req.query.priorMode)
      : 'overwrite';
    const birdFilter = ['pigeon_and_unknown', 'confirmed_only', 'all'].includes(String(req.query.birdFilter || ''))
      ? String(req.query.birdFilter)
      : 'pigeon_and_unknown';
    let rotation = req.query.rotation != null ? Number(req.query.rotation) : null;
    let tilt = req.query.tilt != null ? Number(req.query.tilt) : null;
    let waypointNumber = req.query.waypointNumber != null ? Number(req.query.waypointNumber) : null;

    const coords = device.actions?.route?.coordinates || [];

    const resolveWpFromPose = (camPos) => {
      if (!camPos || camPos.rotation == null || camPos.tilt == null) return null;
      const r = Math.round(Number(camPos.rotation));
      const t = Math.round(Number(camPos.tilt));
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const cr = Math.round(Number(c.rotation));
        const ct = Math.round(Number(c.tilt));
        const inv = applyInversion(device, c.rotation, c.tilt);
        if ((cr === r && ct === t) || (inv.rotation === r && inv.tilt === t)) {
          return i + 1;
        }
      }
      return null;
    };

    if (!(allPositions && calibratedOnly)) {
      if (waypointNumber != null && Number.isFinite(waypointNumber) && waypointNumber >= 1 && waypointNumber <= coords.length) {
        const c = coords[waypointNumber - 1];
        rotation = Number(c.rotation);
        tilt = Number(c.tilt);
      }
      if (rotation == null || tilt == null || Number.isNaN(rotation) || Number.isNaN(tilt)) {
        return res.status(400).json({ error: 'waypointNumber oder rotation+tilt erforderlich (oder allPositions+calibratedOnly)' });
      }
    }

    let poseOr = null;
    if (!(allPositions && calibratedOnly)) {
      const inv = applyInversion(device, rotation, tilt);
      poseOr = [
        { 'camera_position.rotation': Math.round(rotation), 'camera_position.tilt': Math.round(tilt) },
        { 'camera_position.rotation': inv.rotation, 'camera_position.tilt': inv.tilt }
      ];
    }

    const fetchCap = allPositions && calibratedOnly
      ? Math.min(500, Math.max(limit * 2, 100))
      : calibratedOnly
        ? Math.min(200, Math.max(limit * 2, 50))
        : priorMode === 'append'
          ? Math.min(200, Math.max(limit * 10, 50))
          : priorMode === 'skip'
            ? Math.min(120, Math.max(limit * 4, 30))
            : Math.min(90, limit * 3);

    const birdQuery = (() => {
      if (calibratedOnly) return {};
      if (birdFilter === 'confirmed_only') {
        return {
          'target_bird.bbox.width': { $gt: 0 },
          classification_status: 'confirmed_pigeon'
        };
      }
      if (birdFilter === 'all') {
        return {};
      }
      return {
        'target_bird.bbox.width': { $gt: 0 },
        classification_status: { $ne: 'no_pigeon' }
      };
    })();

    const findQuery = {
      device: device._id,
      ...birdQuery
    };
    if (poseOr) findQuery.$or = poseOr;
    if (calibratedOnly) {
      findQuery.$and = [
        {
          $or: [
            { 'fovCalibration.at': { $exists: true, $ne: null } },
            { 'fovCalibration.fovH': { $exists: true, $ne: null } },
            { 'fovCalibration.finalPose.rotation': { $exists: true, $ne: null } }
          ]
        }
      ];
    }

    const docs = await Detection.find(findQuery)
      .select('_id processedAt camera_position zoom_factor target_bird image_info fovCalibration classification_status')
      .sort(calibratedOnly
        ? { 'fovCalibration.at': -1, processedAt: -1 }
        : { processedAt: -1 })
      .limit(fetchCap)
      .lean();

    const hasCal = (d) => !!(d.fovCalibration && (
      d.fovCalibration.at
      || d.fovCalibration.fovH != null
      || d.fovCalibration.finalPose?.rotation != null
    ));

    let withImage = docs;
    // Per-Pos batch list still requires an image; global analysis only needs calibration numbers
    if (!(allPositions && calibratedOnly)) {
      const ids = docs.map((d) => d._id);
      const imaged = await Detection.find({ _id: { $in: ids } })
        .select('_id zoomed_image.url image.url raspberry_pi_zoomed_image.url raspberry_pi_image.url tapo_zoomed_image.url tapo_image.url')
        .lean();
      const hasImg = new Set(
        imaged
          .filter((d) => pickDetectionImageBase64(d))
          .map((d) => String(d._id))
      );
      withImage = docs.filter((d) => hasImg.has(String(d._id)));
    }

    let selectedDocs = [];
    if (calibratedOnly) {
      selectedDocs = withImage.filter(hasCal).slice(0, limit);
    } else if (priorMode === 'overwrite') {
      selectedDocs = withImage.slice(0, limit);
    } else if (priorMode === 'skip') {
      selectedDocs = withImage.slice(0, limit).filter((d) => !hasCal(d));
    } else {
      selectedDocs = withImage.filter((d) => !hasCal(d)).slice(0, limit);
    }

    const candidates = selectedDocs.map((d) => {
      const cal = d.fovCalibration || null;
      let dRot = null;
      let dTilt = null;
      if (cal?.finalPose && cal?.scanPose) {
        dRot = Number(cal.finalPose.rotation) - Number(cal.scanPose.rotation);
        dTilt = Number(cal.finalPose.tilt) - Number(cal.scanPose.tilt);
      }
      const wpFromPose = resolveWpFromPose(d.camera_position);
      // Prefer pose match over stored cal.waypointNumber (can be stale after reassignment)
      const wp = wpFromPose != null
        ? wpFromPose
        : (cal?.waypointNumber != null ? Number(cal.waypointNumber) : null);
      return {
        detectionId: d._id,
        processedAt: d.processedAt,
        camera_position: d.camera_position,
        zoom_factor: d.zoom_factor,
        targetBird: d.target_bird || null,
        imageInfo: d.image_info || null,
        hasPriorCalibration: hasCal(d),
        waypointNumber: Number.isFinite(wp) ? wp : null,
        priorFov: cal?.fovH != null
          ? { h: cal.fovH, v: cal.fovV, converged: cal.converged }
          : null,
        fovCalibration: cal
          ? {
            at: cal.at,
            converged: cal.converged,
            fovH: cal.fovH,
            fovV: cal.fovV,
            fovSollH: cal.fovSollH,
            fovSollV: cal.fovSollV,
            offsetPx: cal.offsetPx || null,
            residualPx: cal.residualPx || null,
            scanPose: cal.scanPose || null,
            autoAimPose: cal.autoAimPose || null,
            finalPose: cal.finalPose || null,
            zoomFactor: cal.zoomFactor,
            waypointNumber: Number.isFinite(wp) ? wp : (cal.waypointNumber || null),
            dRot,
            dTilt,
            excluded: !!cal.excluded,
            manual: !!cal.manual || cal.method === 'manual',
            method: cal.method || null,
            source: cal.source || (cal.manual || cal.method === 'manual' ? 'manual' : 'auto')
          }
          : null
      };
    });

    res.json({
      waypointNumber: allPositions ? null : (waypointNumber || null),
      allPositions: !!(allPositions && calibratedOnly),
      rotation: rotation != null && !Number.isNaN(rotation) ? Math.round(rotation) : null,
      tilt: tilt != null && !Number.isNaN(tilt) ? Math.round(tilt) : null,
      priorMode,
      birdFilter,
      calibratedOnly: !!calibratedOnly,
      limit,
      count: candidates.length,
      poolScanned: withImage.length,
      candidates
    });
  } catch (error) {
    logger.error('calibrate-candidates error:', error);
    res.status(500).json({ error: 'Candidates laden fehlgeschlagen', message: error.message });
  }
});


module.exports = router;
