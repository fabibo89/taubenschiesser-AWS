/**
 * Hash helper for identical slave companion stills (scanPhotos / preShootPhotos).
 */
const crypto = require('crypto');

function hashImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return crypto.createHash('sha256').update(url).digest('hex');
}

function isSlavePhoto(photo) {
  if (!photo || typeof photo !== 'object') return false;
  const role = photo.role || 'slave';
  return role !== 'master' && Boolean(photo.image?.url);
}

function collectSlaveEntries(detection) {
  const out = [];
  const scan = Array.isArray(detection.scanPhotos) ? detection.scanPhotos : [];
  const pre = Array.isArray(detection.preShootPhotos) ? detection.preShootPhotos : [];
  scan.forEach((p, idx) => {
    if (!isSlavePhoto(p)) return;
    out.push({
      kind: 'scan',
      index: idx,
      hash: hashImageUrl(p.image.url),
      cameraId: p.cameraId || null,
      cameraName: p.cameraName || p.cameraType || 'Slave',
      cameraType: p.cameraType || null,
      sensor: p.sensor || null,
      role: p.role || 'slave',
      url: p.image.url,
      size: p.image.size || p.image.url.length
    });
  });
  pre.forEach((p, idx) => {
    if (!isSlavePhoto(p)) return;
    out.push({
      kind: 'pre',
      index: idx,
      hash: hashImageUrl(p.image.url),
      cameraId: p.cameraId || null,
      cameraName: p.cameraName || p.cameraType || 'Slave',
      cameraType: p.cameraType || null,
      sensor: p.sensor || null,
      role: p.role || 'slave',
      url: p.image.url,
      size: p.image.size || p.image.url.length
    });
  });
  return out;
}

/**
 * Build duplicate clusters from lean detection docs (must include scanPhotos/preShootPhotos urls).
 * Only groups with count >= 2.
 */
function buildSlaveDuplicateClusters(detections) {
  const byHash = new Map();

  for (const det of detections) {
    if (!det) continue;
    const id = String(det._id);
    const slaves = collectSlaveEntries(det);
    // One entry per detection per hash (prefer scan over pre)
    const seen = new Set();
    for (const s of slaves) {
      if (!s.hash || seen.has(s.hash)) continue;
      seen.add(s.hash);
      if (!byHash.has(s.hash)) {
        byHash.set(s.hash, {
          hash: s.hash,
          count: 0,
          cameraId: s.cameraId || null,
          cameraName: s.cameraName,
          cameraType: s.cameraType || null,
          sensor: s.sensor || null,
          size: s.size,
          firstAt: det.processedAt,
          lastAt: det.processedAt,
          detections: []
        });
      }
      const cluster = byHash.get(s.hash);
      cluster.count += 1;
      cluster.detections.push({
        id,
        processedAt: det.processedAt,
        device: det.device,
        kind: s.kind,
        cameraId: s.cameraId || null,
        sensor: s.sensor || null
      });
      if (det.processedAt && (!cluster.firstAt || det.processedAt < cluster.firstAt)) {
        cluster.firstAt = det.processedAt;
      }
      if (det.processedAt && (!cluster.lastAt || det.processedAt > cluster.lastAt)) {
        cluster.lastAt = det.processedAt;
      }
      if (!cluster.cameraName && s.cameraName) cluster.cameraName = s.cameraName;
      if (!cluster.cameraId && s.cameraId) cluster.cameraId = s.cameraId;
      if (!cluster.cameraType && s.cameraType) cluster.cameraType = s.cameraType;
      if (!cluster.sensor && s.sensor) cluster.sensor = s.sensor;
    }
  }

  return [...byHash.values()]
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count || (b.lastAt || 0) - (a.lastAt || 0));
}

module.exports = {
  hashImageUrl,
  isSlavePhoto,
  collectSlaveEntries,
  buildSlaveDuplicateClusters
};
