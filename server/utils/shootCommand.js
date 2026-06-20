/**
 * Build ESP shoot MQTT payload from device taubenschiesser settings.
 * @param {object} taubenschiesser - device.taubenschiesser
 * @param {{ durationMs?: number, useLaser?: boolean, laserBlink?: boolean, laserBlinkMs?: number, useAudio?: boolean }} [overrides]
 */
function buildShootCommand(taubenschiesser = {}, overrides = {}) {
  const durationMs = typeof overrides.durationMs === 'number' && overrides.durationMs >= 0
    ? overrides.durationMs
    : (taubenschiesser.shootingTimeMs ?? 500);

  const useLaser = typeof overrides.useLaser === 'boolean'
    ? overrides.useLaser
    : (taubenschiesser.shootUseLaser !== false);

  const useAudio = typeof overrides.useAudio === 'boolean'
    ? overrides.useAudio
    : !!taubenschiesser.shootUseAudio;

  const payload = {
    type: 'shoot',
    duration: durationMs,
    useLaser,
    useAudio
  };

  if (useLaser) {
    const laserBlink = typeof overrides.laserBlink === 'boolean'
      ? overrides.laserBlink
      : !!taubenschiesser.shootLaserBlink;

    if (laserBlink) {
      let laserBlinkMs = typeof overrides.laserBlinkMs === 'number'
        ? overrides.laserBlinkMs
        : (taubenschiesser.shootLaserBlinkMs ?? 100);
      laserBlinkMs = Math.min(500, Math.max(20, laserBlinkMs));
      payload.laserBlink = true;
      payload.laserBlinkMs = laserBlinkMs;
    }
  }

  return payload;
}

module.exports = { buildShootCommand };
