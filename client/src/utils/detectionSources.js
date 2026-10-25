/**
 * Cloud YOLO (= Master) vs ESP-P4 parallel (= Slave) on a stored detection.
 * Uses detection_authority + esp_parallel from hardware-monitor.
 */

function espParallelHasHit(espParallel) {
  if (!Array.isArray(espParallel)) return false;
  return espParallel.some((ep) => {
    if (!ep || typeof ep !== 'object' || ep.pending) return false;
    const count = Number(ep.count);
    if (Number.isFinite(count) && count > 0) return true;
    return Array.isArray(ep.birds) && ep.birds.length > 0;
  });
}

/**
 * @returns {{ known: boolean, master: boolean, slave: boolean }}
 * master = Cloud YOLO drove / hit; slave = P4 also (or only) hit
 */
export function resolveDetectionSources(detection) {
  if (!detection || typeof detection !== 'object') {
    return { known: false, master: false, slave: false };
  }

  const authority = detection.detection_authority;
  const slaveHit = espParallelHasHit(detection.esp_parallel);

  if (authority === 'esp') {
    return { known: true, master: false, slave: true };
  }
  if (authority === 'cloud') {
    return { known: true, master: true, slave: slaveHit };
  }

  // Legacy docs without authority — nothing to show
  return { known: false, master: false, slave: false };
}

export function detectionSourceLabels(detection) {
  const src = resolveDetectionSources(detection);
  if (!src.known) return [];
  const labels = [];
  if (src.master) {
    labels.push({
      key: 'master',
      label: 'Master',
      title: 'Cloud-YOLO hat erkannt (Master)'
    });
  }
  if (src.slave) {
    labels.push({
      key: 'slave',
      label: 'Slave',
      title: src.master
        ? 'ESP-P4 hat parallel auch erkannt (Slave)'
        : 'Nur ESP-P4 hat erkannt (Slave; Cloud leer)'
    });
  }
  return labels;
}
