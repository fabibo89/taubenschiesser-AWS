/**
 * Find duplicate bird detections (same device + camera position, within time window,
 * overlapping bird bounding boxes). Keep earliest; later ones are duplicates.
 * Does not load images — callers pass lean docs.
 */

function bboxDictToXyxy(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const w = Number(bbox.width);
  const h = Number(bbox.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x1: x, y1: y, x2: x + w, y2: y + h };
}

function positionToXyxy(pos) {
  if (!pos || typeof pos !== 'object') return null;
  const cx = Number(pos.center_x);
  const cy = Number(pos.center_y);
  const w = Number(pos.width);
  const h = Number(pos.height);
  if (![cx, cy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

function isBirdClass(cls) {
  const c = String(cls || '').toLowerCase();
  if (!c) return true;
  return ['bird', 'birds', 'vogel', 'vögel', 'pigeon', 'dove'].includes(c);
}

function birdBoxes(doc) {
  const boxes = [];
  const tb = doc.target_bird;
  if (tb && typeof tb === 'object') {
    const b = bboxDictToXyxy(tb.bbox) || positionToXyxy(tb.position);
    if (b) boxes.push(b);
  }
  for (const d of doc.detections || []) {
    if (!d || typeof d !== 'object') continue;
    if (!isBirdClass(d.class)) continue;
    const b = bboxDictToXyxy(d.bbox) || positionToXyxy(d.position);
    if (b) boxes.push(b);
  }
  return boxes;
}

function boxesOverlap(a, b) {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  return ix2 > ix1 && iy2 > iy1;
}

function anyBirdOverlap(aBoxes, bBoxes) {
  for (const a of aBoxes) {
    for (const b of bBoxes) {
      if (boxesOverlap(a, b)) return true;
    }
  }
  return false;
}

function positionKey(doc) {
  const cp = doc.camera_position || {};
  if (cp.rotation == null || cp.tilt == null) return null;
  const rot = Math.round(Number(cp.rotation));
  const tilt = Math.round(Number(cp.tilt));
  if (!Number.isFinite(rot) || !Number.isFinite(tilt)) return null;
  return `${rot},${tilt}`;
}

function toTime(doc) {
  const t = doc.processedAt || doc.createdAt;
  if (!t) return null;
  const d = t instanceof Date ? t : new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Array<object>} docs lean detections sorted by processedAt ascending
 * @param {number} windowMs
 * @returns {{ groups: Array, duplicateIds: string[] }}
 */
function findDuplicateGroups(docs, windowMs) {
  /** @type {Map<string, Array<{ t: Date, boxes: object[], doc: object }>>} */
  const keptByGroup = new Map();
  /** @type {Map<string, { device: any, rotation: number, tilt: number, keep: object, duplicates: object[] }>} */
  const resultGroups = new Map();

  const duplicateIds = [];

  for (const doc of docs) {
    const t = toTime(doc);
    if (!t) continue;
    const pos = positionKey(doc);
    if (!pos) continue;
    const boxes = birdBoxes(doc);
    if (!boxes.length) continue;

    const deviceId = doc.device?._id?.toString?.() || doc.device?.toString?.() || String(doc.device);
    const groupKey = `${deviceId}|${pos}`;
    const kept = keptByGroup.get(groupKey) || [];
    keptByGroup.set(groupKey, kept);

    let matchedKeep = null;
    for (const prev of kept) {
      const dt = t.getTime() - prev.t.getTime();
      if (dt < 0 || dt > windowMs) continue;
      if (anyBirdOverlap(boxes, prev.boxes)) {
        matchedKeep = prev;
        break;
      }
    }

    if (matchedKeep) {
      const [rotStr, tiltStr] = pos.split(',');
      const rotation = Number(rotStr);
      const tilt = Number(tiltStr);
      let rg = resultGroups.get(matchedKeep.doc._id.toString());
      if (!rg) {
        rg = {
          device: doc.device,
          rotation,
          tilt,
          keep: matchedKeep.doc,
          duplicates: []
        };
        resultGroups.set(matchedKeep.doc._id.toString(), rg);
      }
      const deltaSeconds = Math.round((t.getTime() - matchedKeep.t.getTime()) / 1000);
      rg.duplicates.push({
        ...summarizeDetection(doc),
        deltaSeconds,
        birdBoxes: boxes
      });
      duplicateIds.push(doc._id.toString());
    } else {
      kept.push({ t, boxes, doc });
    }
  }

  const groups = Array.from(resultGroups.values()).map((g) => ({
    device: g.device,
    rotation: g.rotation,
    tilt: g.tilt,
    keep: {
      ...summarizeDetection(g.keep),
      birdBoxes: birdBoxes(g.keep),
      deltaSeconds: 0
    },
    duplicates: g.duplicates
  }));

  // Only groups that have at least one duplicate
  return {
    groups: groups.filter((g) => g.duplicates.length > 0),
    duplicateIds: [...new Set(duplicateIds)]
  };
}

function summarizeDetection(doc) {
  return {
    _id: doc._id,
    processedAt: doc.processedAt,
    classification_status: doc.classification_status ?? null,
    shotFired: doc.shotFired === true,
    zoom_factor: doc.zoom_factor,
    image_info: doc.image_info || null,
    detections: (doc.detections || []).map((d) => ({
      class: d.class,
      confidence: d.confidence,
      bbox: d.bbox,
      position: d.position,
      is_target_bird: d.is_target_bird
    })),
    target_bird: doc.target_bird
      ? {
          class: doc.target_bird.class,
          confidence: doc.target_bird.confidence,
          bbox: doc.target_bird.bbox,
          position: doc.target_bird.position
        }
      : null
  };
}

module.exports = {
  findDuplicateGroups,
  birdBoxes,
  summarizeDetection
};
