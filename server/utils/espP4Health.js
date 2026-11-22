/**
 * Live ESP-P4 /health helpers (sensor chip for slave still enrichment).
 */
const axios = require('axios');
const logger = require('./logger');

function httpCamHost(cam) {
  if (!cam || typeof cam !== 'object') return null;
  const type = (cam.type || '').toLowerCase();
  if (type !== 'esp32-p4') return null;
  const cfg = cam.esp32P4 || cam.raspberryPi || {};
  const ip = cfg.ip;
  if (!ip) return null;
  const port = cfg.port || 8080;
  return { ip, port, baseUrl: `http://${ip}:${port}` };
}

/**
 * Collect unique ESP-P4 HTTP hosts from device.cameras[].
 * @returns {Map<string, { baseUrl, cameraIds:Set, cameraNames:Set }>}
 */
function collectEspP4Hosts(devices) {
  const byHost = new Map();
  for (const d of devices || []) {
    for (const cam of d.cameras || []) {
      const host = httpCamHost(cam);
      if (!host) continue;
      const key = host.baseUrl;
      if (!byHost.has(key)) {
        byHost.set(key, {
          baseUrl: host.baseUrl,
          cameraIds: new Set(),
          cameraNames: new Set()
        });
      }
      const entry = byHost.get(key);
      if (cam.id) entry.cameraIds.add(String(cam.id));
      if (cam.name) entry.cameraNames.add(String(cam.name));
    }
  }
  return byHost;
}

async function fetchSensor(baseUrl) {
  try {
    const res = await axios.get(`${baseUrl}/health`, {
      timeout: 4000,
      validateStatus: (s) => s === 200
    });
    const sensor = res.data?.sensor;
    return typeof sensor === 'string' && sensor.trim() ? sensor.trim() : null;
  } catch (err) {
    logger.debug(`ESP-P4 /health failed (${baseUrl}): ${err.message}`);
    return null;
  }
}

/**
 * Resolve live sensor chip per camera id/name for owned devices.
 * Returns { byCameraId: Map, byCameraName: Map, sensors: string[] }
 */
async function resolveLiveSensors(devices) {
  const byCameraId = new Map();
  const byCameraName = new Map();
  const sensors = new Set();
  const hosts = collectEspP4Hosts(devices);

  await Promise.all([...hosts.values()].map(async (host) => {
    const sensor = await fetchSensor(host.baseUrl);
    if (!sensor) return;
    sensors.add(sensor);
    for (const id of host.cameraIds) byCameraId.set(id, sensor);
    for (const name of host.cameraNames) byCameraName.set(name, sensor);
  }));

  return { byCameraId, byCameraName, sensors: [...sensors] };
}

/**
 * Fill missing sensor on a slave entry / cluster using live maps.
 * Prefer cameraId, then cameraName; if only one live sensor known, use that.
 */
function applyLiveSensor(target, live, fallbackCameraName) {
  if (!target || target.sensor) return target;
  const id = target.cameraId;
  const name = target.cameraName || fallbackCameraName;
  let sensor = null;
  if (id && live.byCameraId.has(id)) sensor = live.byCameraId.get(id);
  else if (name && live.byCameraName.has(name)) sensor = live.byCameraName.get(name);
  else if (live.sensors.length === 1) sensor = live.sensors[0];
  if (sensor) target.sensor = sensor;
  return target;
}

module.exports = {
  collectEspP4Hosts,
  fetchSensor,
  resolveLiveSensors,
  applyLiveSensor
};
