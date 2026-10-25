const Device = require('../models/Device');
const {
  syncDeviceCameras,
  getHttpStillConfig
} = require('./deviceCameras');

function baseUrlFromConfig(cfg) {
  if (!cfg?.ip || typeof cfg.ip !== 'string') return null;
  const ip = cfg.ip.trim();
  if (!ip) return null;
  const port = Number(cfg.port) > 0 ? Number(cfg.port) : 8080;
  return `http://${ip}:${port}`;
}

/**
 * All ESP32-P4 camera slots for the user's devices (with reachable base URL).
 */
async function listEspP4Targets(userId) {
  const devices = await Device.find({ owner: userId })
    .select('name deviceId cameras camera')
    .lean();
  const targets = [];
  for (const device of devices) {
    syncDeviceCameras(device);
    const cams = Array.isArray(device.cameras) ? device.cameras : [];
    for (const cam of cams) {
      if (!cam || cam.type !== 'esp32-p4' || cam.enabled === false) continue;
      const cfg = getHttpStillConfig(cam);
      const baseUrl = baseUrlFromConfig(cfg);
      if (!baseUrl) continue;
      targets.push({
        id: `${device._id}:${cam.id}`,
        deviceId: String(device._id),
        deviceName: device.name || device.deviceId || 'Gerät',
        cameraId: cam.id,
        cameraName: cam.name || 'ESP-P4 Cam',
        role: cam.role || 'slave',
        ip: cfg.ip,
        port: Number(cfg.port) || 8080,
        baseUrl
      });
    }
    // Legacy single-camera esp32-p4 without cameras[] entry
    if (!targets.some((t) => t.deviceId === String(device._id))) {
      if (device.camera?.type === 'esp32-p4') {
        const cfg = getHttpStillConfig(device.camera);
        const baseUrl = baseUrlFromConfig(cfg);
        if (baseUrl) {
          targets.push({
            id: `${device._id}:legacy`,
            deviceId: String(device._id),
            deviceName: device.name || device.deviceId || 'Gerät',
            cameraId: 'legacy',
            cameraName: 'ESP-P4 Cam',
            role: 'master',
            ip: cfg.ip,
            port: Number(cfg.port) || 8080,
            baseUrl
          });
        }
      }
    }
  }
  return targets;
}

async function resolveEspP4Target(userId, deviceId, cameraId) {
  const targets = await listEspP4Targets(userId);
  if (!targets.length) return null;
  if (deviceId) {
    const match = targets.find(
      (t) => t.deviceId === String(deviceId)
        && (!cameraId || t.cameraId === String(cameraId))
    );
    if (match) return match;
  }
  return targets[0] || null;
}

module.exports = {
  listEspP4Targets,
  resolveEspP4Target,
  baseUrlFromConfig
};
