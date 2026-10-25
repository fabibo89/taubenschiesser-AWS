/**
 * Device layout: how motion (shooter ESP) and cameras relate.
 * cam_only | motion_only | separate | combined
 */

const LAYOUTS = ['cam_only', 'motion_only', 'separate', 'combined'];

function normalizeLayout(value) {
  const v = String(value || '').trim();
  return LAYOUTS.includes(v) ? v : 'separate';
}

function hasMotion(layout) {
  const l = normalizeLayout(layout);
  return l === 'motion_only' || l === 'separate' || l === 'combined';
}

function hasCameras(layout) {
  const l = normalizeLayout(layout);
  return l === 'cam_only' || l === 'separate' || l === 'combined';
}

function plain(obj) {
  if (!obj) return null;
  if (typeof obj.toObject === 'function') return obj.toObject();
  return { ...obj };
}

/**
 * Mutates device (mongoose doc or plain) to match deviceLayout.
 */
function normalizeDeviceLayout(device) {
  if (!device) return device;
  const layout = normalizeLayout(device.deviceLayout);
  device.deviceLayout = layout;

  if (!device.taubenschiesser) {
    device.taubenschiesser = {};
  }

  if (layout === 'cam_only') {
    if (device.taubenschiesser.ip == null || String(device.taubenschiesser.ip).trim() === '') {
      device.taubenschiesser.ip = '';
    }
  }

  if (layout === 'motion_only') {
    device.cameras = [];
    if (device.camera && typeof device.camera === 'object') {
      // Keep type stub but clear connection details for clarity
      const cam = plain(device.camera) || {};
      device.camera = {
        ...cam,
        tapo: cam.tapo ? { ...cam.tapo, ip: '' } : cam.tapo,
        raspberryPi: cam.raspberryPi ? { ...cam.raspberryPi, ip: '' } : cam.raspberryPi,
        esp32P4: cam.esp32P4 ? { ...cam.esp32P4, ip: '' } : cam.esp32P4
      };
    }
  }

  if (layout === 'combined') {
    const ip = String(device.taubenschiesser?.ip || '').trim();
    if (ip) {
      const cameras = Array.isArray(device.cameras) ? device.cameras : [];
      let master = cameras.find((c) => c && c.role === 'master') || cameras[0];
      if (!master) {
        master = {
          id: `cam_${Date.now().toString(36)}`,
          name: 'ESP-P4',
          type: 'esp32-p4',
          role: 'master',
          enabled: true,
          esp32P4: { ip, port: 8080, endpoint: '/image.jpg', streamEndpoint: '/stream.mjpeg', square: true, resolution: '640' }
        };
        device.cameras = [master];
      } else {
        const type = master.type || 'esp32-p4';
        if (type === 'esp32-p4') {
          master.esp32P4 = { ...(plain(master.esp32P4) || {}), ip };
          if (!master.esp32P4.port) master.esp32P4.port = 8080;
        } else if (type === 'raspberry-pi' || type === 'dual') {
          master.raspberryPi = { ...(plain(master.raspberryPi) || {}), ip };
          if (!master.raspberryPi.port) master.raspberryPi.port = 8080;
        } else if (type === 'tapo') {
          master.tapo = { ...(plain(master.tapo) || {}), ip };
        }
        master.role = 'master';
        device.cameras = cameras.map((c) => (c && c.id === master.id ? master : c));
      }
    }
  }

  return device;
}

function layoutLabel(layout) {
  switch (normalizeLayout(layout)) {
    case 'cam_only':
      return 'Nur Cam';
    case 'motion_only':
      return 'Nur Bewegung';
    case 'combined':
      return 'Bewegung & Cam (ein Gerät)';
    case 'separate':
    default:
      return 'Bewegung & Cam (separat)';
  }
}

module.exports = {
  LAYOUTS,
  normalizeLayout,
  hasMotion,
  hasCameras,
  normalizeDeviceLayout,
  layoutLabel
};
