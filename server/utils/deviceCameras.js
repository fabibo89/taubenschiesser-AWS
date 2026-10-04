/**
 * Multi-camera helpers: cameras[] (master/slave) ↔ legacy camera.type / tapo / raspberryPi / esp32P4.
 * ESP32-P4 Cam uses the same HTTP still API as PiCam (/image.jpg, /stream.mjpeg).
 */

const HTTP_STILL_TYPES = ['raspberry-pi', 'esp32-p4'];

function newCameraId() {
  return `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTapo() {
  return {
    ip: '',
    username: '',
    password: '',
    stream: 'stream1',
    fov: 110
  };
}

function defaultHttpStill() {
  return {
    ip: '',
    port: 8080,
    endpoint: '/image.jpg',
    streamEndpoint: '/stream.mjpeg',
    flip: false,
    fov: 75,
    fovH: undefined,
    fovV: undefined,
    angle: 0,
    square: true,
    resolution: '640'
  };
}

function defaultRaspberryPi() {
  return defaultHttpStill();
}

function defaultEsp32P4() {
  return defaultHttpStill();
}

function isHttpStillType(type) {
  return HTTP_STILL_TYPES.includes(type);
}

function plain(obj) {
  if (!obj) return null;
  if (typeof obj.toObject === 'function') return obj.toObject();
  return { ...obj };
}

/** Config blob for PiCam / ESP-P4 (same shape). */
function getHttpStillConfig(camOrLegacy) {
  if (!camOrLegacy) return null;
  const type = camOrLegacy.type;
  if (type === 'esp32-p4') {
    return plain(camOrLegacy.esp32P4) || plain(camOrLegacy.raspberryPi) || null;
  }
  if (type === 'raspberry-pi' || type === 'dual') {
    return plain(camOrLegacy.raspberryPi) || plain(camOrLegacy.esp32P4) || null;
  }
  return plain(camOrLegacy.esp32P4) || plain(camOrLegacy.raspberryPi) || null;
}

function normalizeRole(cameras) {
  const list = Array.isArray(cameras) ? cameras.map((c) => plain(c) || c) : [];
  if (!list.length) return list;
  let masterIdx = list.findIndex((c) => c && c.role === 'master');
  if (masterIdx < 0) masterIdx = 0;
  return list.map((c, i) => {
    const isMaster = i === masterIdx;
    return {
      ...c,
      id: c.id || newCameraId(),
      role: isMaster ? 'master' : 'slave',
      // All cameras forced active for now
      enabled: true,
      photoBeforeDeterrence: !!(c.photoBeforeDeterrence ?? c.photoAfterDetection)
    };
  });
}

function camerasFromLegacy(camera) {
  const cam = plain(camera) || {};
  const type = cam.type || 'tapo';
  const list = [];

  if (type === 'dual') {
    list.push({
      id: newCameraId(),
      name: 'Tapo',
      type: 'tapo',
      role: 'master',
      enabled: true,
      tapo: { ...defaultTapo(), ...(plain(cam.tapo) || {}) }
    });
    list.push({
      id: newCameraId(),
      name: 'Raspberry Pi',
      type: 'raspberry-pi',
      role: 'slave',
      enabled: true,
      raspberryPi: { ...defaultRaspberryPi(), ...(plain(cam.raspberryPi) || {}) }
    });
    return normalizeRole(list);
  }

  if (type === 'tapo') {
    list.push({
      id: newCameraId(),
      name: 'Tapo',
      type: 'tapo',
      role: 'master',
      enabled: true,
      tapo: { ...defaultTapo(), ...(plain(cam.tapo) || {}) }
    });
  } else if (type === 'raspberry-pi') {
    list.push({
      id: newCameraId(),
      name: 'Raspberry Pi',
      type: 'raspberry-pi',
      role: 'master',
      enabled: true,
      raspberryPi: { ...defaultRaspberryPi(), ...(plain(cam.raspberryPi) || {}) }
    });
  } else if (type === 'esp32-p4') {
    list.push({
      id: newCameraId(),
      name: 'ESP-P4 Cam',
      type: 'esp32-p4',
      role: 'master',
      enabled: true,
      esp32P4: {
        ...defaultEsp32P4(),
        ...(plain(cam.esp32P4) || plain(cam.raspberryPi) || {})
      }
    });
  } else if (type === 'direct') {
    list.push({
      id: newCameraId(),
      name: 'RTSP',
      type: 'direct',
      role: 'master',
      enabled: true,
      directUrl: cam.directUrl || cam.rtspUrl || ''
    });
  } else if (type === 'local') {
    list.push({
      id: newCameraId(),
      name: 'Lokal',
      type: 'local',
      role: 'master',
      enabled: true,
      useLocalImage: true,
      localImagePath: cam.localImagePath || ''
    });
  } else {
    list.push({
      id: newCameraId(),
      name: 'Kamera',
      type: 'tapo',
      role: 'master',
      enabled: true,
      tapo: defaultTapo()
    });
  }

  return normalizeRole(list);
}

function legacyCameraFromCameras(cameras, prevCamera) {
  const prev = plain(prevCamera) || {};
  const list = normalizeRole(cameras);
  const master = list.find((c) => c.role === 'master') || list[0];
  const slaves = list.filter((c) => c !== master);
  const httpSlave = slaves.find((c) => isHttpStillType(c.type));
  const tapoSlave = slaves.find((c) => c.type === 'tapo');

  const next = {
    ...prev,
    directUrl: prev.directUrl || '',
    rtspUrl: prev.rtspUrl || '',
    useLocalImage: false,
    localImagePath: prev.localImagePath || '',
    tapo: { ...defaultTapo(), ...(plain(prev.tapo) || {}) },
    raspberryPi: { ...defaultRaspberryPi(), ...(plain(prev.raspberryPi) || {}) },
    esp32P4: { ...defaultEsp32P4(), ...(plain(prev.esp32P4) || {}) }
  };

  if (!master) {
    next.type = prev.type || 'tapo';
    return next;
  }

  const applyHttpStill = (httpCam) => {
    const cfg = getHttpStillConfig(httpCam) || defaultHttpStill();
    if (httpCam.type === 'esp32-p4') {
      next.esp32P4 = { ...defaultEsp32P4(), ...cfg };
      // Mirror into raspberryPi so older monitor/helper paths keep working.
      next.raspberryPi = { ...defaultRaspberryPi(), ...cfg };
    } else {
      next.raspberryPi = { ...defaultRaspberryPi(), ...cfg };
    }
  };

  // Dual legacy when master is tapo and an HTTP-still slave exists (or vice versa)
  if (
    (master.type === 'tapo' && httpSlave)
    || (isHttpStillType(master.type) && tapoSlave)
  ) {
    next.type = 'dual';
    const tapoCam = master.type === 'tapo' ? master : tapoSlave;
    const httpCam = isHttpStillType(master.type) ? master : httpSlave;
    next.tapo = { ...defaultTapo(), ...(plain(tapoCam.tapo) || {}) };
    applyHttpStill(httpCam);
    return next;
  }

  next.type = master.type;
  if (master.type === 'tapo') {
    next.tapo = { ...defaultTapo(), ...(plain(master.tapo) || {}) };
  } else if (isHttpStillType(master.type)) {
    applyHttpStill(master);
  } else if (master.type === 'direct') {
    next.directUrl = master.directUrl || '';
  } else if (master.type === 'local') {
    next.useLocalImage = true;
    next.localImagePath = master.localImagePath || '';
  }

  // Keep secondary HTTP config for slaves WITHOUT overwriting the master's slot.
  // (Previously applyHttpStill(slave) mirrored ESP-P4 into raspberryPi and clobbered master.)
  if (httpSlave) {
    const cfg = getHttpStillConfig(httpSlave) || defaultHttpStill();
    if (httpSlave.type === 'esp32-p4') {
      next.esp32P4 = { ...defaultEsp32P4(), ...cfg };
    } else if (httpSlave.type === 'raspberry-pi' && master.type !== 'raspberry-pi') {
      next.raspberryPi = { ...defaultRaspberryPi(), ...cfg };
    }
  }
  if (tapoSlave && master.type !== 'tapo') {
    next.tapo = { ...defaultTapo(), ...(plain(tapoSlave.tapo) || {}) };
  }

  return next;
}

/**
 * Ensure device.cameras is set and legacy camera stays in sync.
 * Mutates device (mongoose doc or plain object).
 */
function syncDeviceCameras(device) {
  if (!device) return device;
  const existing = Array.isArray(device.cameras) ? device.cameras.filter(Boolean) : [];
  if (existing.length > 0) {
    device.cameras = normalizeRole(existing);
    device.camera = legacyCameraFromCameras(device.cameras, device.camera);
  } else {
    device.cameras = camerasFromLegacy(device.camera);
    // Keep legacy as-is (already source); still refresh type consistency
    device.camera = legacyCameraFromCameras(device.cameras, device.camera);
  }
  return device;
}

function getMasterCamera(device) {
  syncDeviceCameras(device);
  const list = Array.isArray(device.cameras) ? device.cameras : [];
  return list.find((c) => c.role === 'master') || list[0] || null;
}

function getEnabledCameras(device) {
  syncDeviceCameras(device);
  return (device.cameras || []).filter((c) => c && c.enabled !== false);
}

module.exports = {
  HTTP_STILL_TYPES,
  newCameraId,
  defaultTapo,
  defaultHttpStill,
  defaultRaspberryPi,
  defaultEsp32P4,
  isHttpStillType,
  getHttpStillConfig,
  normalizeRole,
  camerasFromLegacy,
  legacyCameraFromCameras,
  syncDeviceCameras,
  getMasterCamera,
  getEnabledCameras
};
