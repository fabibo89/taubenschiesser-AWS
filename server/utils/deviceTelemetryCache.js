/**
 * Ephemeral device telemetry (not persisted to MongoDB).
 * Populated by hardware-monitor from MQTT and merged into API responses.
 */
const byDeviceId = new Map();

function setTelemetry(deviceId, telemetry) {
  if (!deviceId) return;
  byDeviceId.set(String(deviceId), {
    ...telemetry,
    updatedAt: telemetry.updatedAt || new Date().toISOString()
  });
}

function getTelemetry(deviceId) {
  if (!deviceId) return null;
  return byDeviceId.get(String(deviceId)) || null;
}

function attachToDevice(deviceObj) {
  const telemetry = getTelemetry(deviceObj._id);
  if (telemetry) {
    deviceObj.liveTelemetry = telemetry;
  }
  return deviceObj;
}

module.exports = {
  setTelemetry,
  getTelemetry,
  attachToDevice
};
