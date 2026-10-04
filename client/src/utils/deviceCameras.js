/** Client helpers for Device.cameras[] (master/slave) ↔ legacy camera. */

export const HTTP_STILL_TYPES = ['raspberry-pi', 'esp32-p4'];

export function newCameraId() {
  return `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultTapo() {
  return {
    ip: '',
    username: '',
    password: '',
    stream: 'stream1',
    fov: 110
  };
}

export function defaultHttpStill() {
  return {
    ip: '',
    port: 8080,
    endpoint: '/image.jpg',
    streamEndpoint: '/stream.mjpeg',
    flip: false,
    fov: 75,
    angle: 0,
    square: true,
    resolution: '640'
  };
}

export function defaultRaspberryPi() {
  return defaultHttpStill();
}

export function defaultEsp32P4() {
  return defaultHttpStill();
}

export function isHttpStillType(type) {
  return HTTP_STILL_TYPES.includes(type);
}

export function getHttpStillConfig(cam) {
  if (!cam) return null;
  if (cam.type === 'esp32-p4') return cam.esp32P4 || cam.raspberryPi || null;
  if (cam.type === 'raspberry-pi' || cam.type === 'dual') {
    return cam.raspberryPi || cam.esp32P4 || null;
  }
  return cam.esp32P4 || cam.raspberryPi || null;
}

export function createCameraEntry(type = 'tapo', role = 'slave', name = '') {
  const base = {
    id: newCameraId(),
    name: name || ({
      tapo: 'Tapo',
      'raspberry-pi': 'Raspberry Pi',
      'esp32-p4': 'ESP-P4 Cam',
      direct: 'RTSP',
      local: 'Lokal'
    }[type] || 'Kamera'),
    type,
    role,
    enabled: true,
    photoBeforeDeterrence: false,
    tapo: defaultTapo(),
    raspberryPi: defaultRaspberryPi(),
    esp32P4: defaultEsp32P4(),
    directUrl: '',
    useLocalImage: type === 'local',
    localImagePath: ''
  };
  return base;
}

export function normalizeRole(cameras) {
  const list = Array.isArray(cameras) ? cameras.filter(Boolean) : [];
  if (!list.length) return list;
  let masterIdx = list.findIndex((c) => c.role === 'master');
  if (masterIdx < 0) masterIdx = 0;
  return list.map((c, i) => {
    const isMaster = i === masterIdx;
    return {
      ...c,
      id: c.id || newCameraId(),
      role: isMaster ? 'master' : 'slave',
      // All cameras forced active for now (UI switch disabled)
      enabled: true,
      photoBeforeDeterrence: !!(c.photoBeforeDeterrence ?? c.photoAfterDetection)
    };
  });
}

export function camerasFromLegacy(camera) {
  const cam = camera || {};
  const type = cam.type || 'tapo';
  if (type === 'dual') {
    const httpType = cam.esp32P4?.ip && !cam.raspberryPi?.ip ? 'esp32-p4' : 'raspberry-pi';
    const httpCfg = httpType === 'esp32-p4'
      ? { ...defaultEsp32P4(), ...(cam.esp32P4 || cam.raspberryPi || {}) }
      : { ...defaultRaspberryPi(), ...(cam.raspberryPi || cam.esp32P4 || {}) };
    const httpEntry = createCameraEntry(httpType, 'slave', httpType === 'esp32-p4' ? 'ESP-P4 Cam' : 'Raspberry Pi');
    if (httpType === 'esp32-p4') httpEntry.esp32P4 = httpCfg;
    else httpEntry.raspberryPi = httpCfg;
    return normalizeRole([
      {
        ...createCameraEntry('tapo', 'master', 'Tapo'),
        tapo: { ...defaultTapo(), ...(cam.tapo || {}) }
      },
      httpEntry
    ]);
  }
  if (type === 'tapo') {
    return normalizeRole([{
      ...createCameraEntry('tapo', 'master', 'Tapo'),
      tapo: { ...defaultTapo(), ...(cam.tapo || {}) }
    }]);
  }
  if (type === 'raspberry-pi') {
    return normalizeRole([{
      ...createCameraEntry('raspberry-pi', 'master', 'Raspberry Pi'),
      raspberryPi: { ...defaultRaspberryPi(), ...(cam.raspberryPi || {}) }
    }]);
  }
  if (type === 'esp32-p4') {
    return normalizeRole([{
      ...createCameraEntry('esp32-p4', 'master', 'ESP-P4 Cam'),
      esp32P4: { ...defaultEsp32P4(), ...(cam.esp32P4 || cam.raspberryPi || {}) }
    }]);
  }
  if (type === 'direct') {
    return normalizeRole([{
      ...createCameraEntry('direct', 'master', 'RTSP'),
      directUrl: cam.directUrl || cam.rtspUrl || ''
    }]);
  }
  if (type === 'local') {
    return normalizeRole([{
      ...createCameraEntry('local', 'master', 'Lokal'),
      useLocalImage: true,
      localImagePath: cam.localImagePath || ''
    }]);
  }
  return normalizeRole([createCameraEntry('tapo', 'master', 'Tapo')]);
}

export function legacyCameraFromCameras(cameras, prevCamera = {}) {
  const list = normalizeRole(cameras);
  const master = list.find((c) => c.role === 'master') || list[0];
  const slaves = list.filter((c) => c !== master);
  const httpSlave = slaves.find((c) => isHttpStillType(c.type));
  const tapoSlave = slaves.find((c) => c.type === 'tapo');

  const next = {
    ...prevCamera,
    directUrl: prevCamera.directUrl || '',
    rtspUrl: prevCamera.rtspUrl || '',
    useLocalImage: false,
    localImagePath: prevCamera.localImagePath || '',
    tapo: { ...defaultTapo(), ...(prevCamera.tapo || {}) },
    raspberryPi: { ...defaultRaspberryPi(), ...(prevCamera.raspberryPi || {}) },
    esp32P4: { ...defaultEsp32P4(), ...(prevCamera.esp32P4 || {}) }
  };

  if (!master) {
    next.type = prevCamera.type || 'tapo';
    return next;
  }

  const applyHttpStill = (httpCam) => {
    const cfg = getHttpStillConfig(httpCam) || defaultHttpStill();
    if (httpCam.type === 'esp32-p4') {
      next.esp32P4 = { ...defaultEsp32P4(), ...cfg };
      next.raspberryPi = { ...defaultRaspberryPi(), ...cfg };
    } else {
      next.raspberryPi = { ...defaultRaspberryPi(), ...cfg };
    }
  };

  if (
    (master.type === 'tapo' && httpSlave)
    || (isHttpStillType(master.type) && tapoSlave)
  ) {
    next.type = 'dual';
    const tapoCam = master.type === 'tapo' ? master : tapoSlave;
    const httpCam = isHttpStillType(master.type) ? master : httpSlave;
    next.tapo = { ...defaultTapo(), ...(tapoCam.tapo || {}) };
    applyHttpStill(httpCam);
    return next;
  }

  next.type = master.type;
  if (master.type === 'tapo') next.tapo = { ...defaultTapo(), ...(master.tapo || {}) };
  if (isHttpStillType(master.type)) applyHttpStill(master);
  if (master.type === 'direct') next.directUrl = master.directUrl || '';
  if (master.type === 'local') {
    next.useLocalImage = true;
    next.localImagePath = master.localImagePath || '';
  }
  if (httpSlave) applyHttpStill(httpSlave);
  if (tapoSlave) next.tapo = { ...defaultTapo(), ...(tapoSlave.tapo || {}) };
  return next;
}

export function ensureFormCameras(deviceOrForm) {
  const camera = deviceOrForm?.camera || {};
  const existing = Array.isArray(deviceOrForm?.cameras) ? deviceOrForm.cameras : [];
  const cameras = existing.length ? normalizeRole(existing) : camerasFromLegacy(camera);
  return {
    cameras,
    camera: legacyCameraFromCameras(cameras, camera)
  };
}

export const emptyCameraForm = () => {
  const cameras = [createCameraEntry('tapo', 'master', 'Tapo')];
  return {
    cameras,
    camera: legacyCameraFromCameras(cameras, {
      type: 'tapo',
      directUrl: '',
      rtspUrl: '',
      tapo: defaultTapo(),
      raspberryPi: defaultRaspberryPi(),
      esp32P4: defaultEsp32P4(),
      useLocalImage: false,
      localImagePath: ''
    })
  };
};
