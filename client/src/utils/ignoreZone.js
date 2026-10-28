import {
  DEFAULT_POLYGON_POINTS,
  MIN_POLYGON_POINTS,
  MAX_POLYGON_POINTS,
  clampPoint,
  clampPolygonPoints,
  rectToPolygonPoints,
  isPointInPolygon,
  updatePointAtIndex,
  insertPointOnEdge,
  removePointAtIndex,
  hitTestVertexIndex,
  hitTestEdge
} from './laserZone';

export {
  DEFAULT_POLYGON_POINTS,
  MIN_POLYGON_POINTS,
  MAX_POLYGON_POINTS,
  clampPoint,
  clampPolygonPoints,
  rectToPolygonPoints,
  isPointInPolygon,
  updatePointAtIndex,
  insertPointOnEdge,
  removePointAtIndex,
  hitTestVertexIndex,
  hitTestEdge
};

/** Normalize one ignore zone to polygon points. */
export function normalizeIgnoreZone(zone) {
  if (!zone || typeof zone !== 'object') return null;
  if (zone.enabled === false) return null;

  let points = null;
  if (Array.isArray(zone.points) && zone.points.length >= MIN_POLYGON_POINTS) {
    const parsed = zone.points.map((p) => ({
      x: Number(p?.x),
      y: Number(p?.y)
    }));
    if (parsed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
      points = clampPolygonPoints(parsed);
    }
  }

  if (!points) {
    const x = Number(zone.x);
    const y = Number(zone.y);
    const width = Number(zone.width);
    const height = Number(zone.height);
    if (![x, y, width, height].every(Number.isFinite)) return null;
    points = rectToPolygonPoints(
      Math.max(0, Math.min(1, x)),
      Math.max(0, Math.min(1, y)),
      Math.max(0.01, Math.min(1, width)),
      Math.max(0.01, Math.min(1, height))
    );
  }

  return {
    enabled: true,
    shape: 'polygon',
    points
  };
}

export function normalizeIgnoreZones(zones) {
  if (!Array.isArray(zones)) return [];
  return zones.map(normalizeIgnoreZone).filter(Boolean);
}

export function hasActiveIgnoreZones(zones) {
  return normalizeIgnoreZones(zones).length > 0;
}

export function buildIgnoreZonePayload(points) {
  return {
    enabled: true,
    shape: 'polygon',
    points: clampPolygonPoints(points)
  };
}

/** Normalized axis-aligned rect from one bird box, or null. */
export function birdBoxNormRect(bird, imageSize) {
  const w = Number(imageSize?.width) || 0;
  const h = Number(imageSize?.height) || 0;
  if (!w || !h || !bird) return null;

  let x0;
  let y0;
  let x1;
  let y1;
  if (bird.bbox && bird.bbox.width != null) {
    x0 = Number(bird.bbox.x) / w;
    y0 = Number(bird.bbox.y) / h;
    x1 = (Number(bird.bbox.x) + Number(bird.bbox.width)) / w;
    y1 = (Number(bird.bbox.y) + Number(bird.bbox.height)) / h;
  } else if (bird.position) {
    const { center_x, center_y, width, height } = bird.position;
    let bw = Number(width);
    let bh = Number(height);
    let cx = Number(center_x);
    let cy = Number(center_y);
    // position.width/height sometimes relative (0–1), sometimes pixels
    if (bw > 0 && bw <= 1.5 && bh > 0 && bh <= 1.5) {
      bw *= w;
      bh *= h;
    }
    if (cx >= 0 && cx <= 1.5 && cy >= 0 && cy <= 1.5 && w > 2) {
      cx *= w;
      cy *= h;
    }
    x0 = (cx - bw / 2) / w;
    y0 = (cy - bh / 2) / h;
    x1 = (cx + bw / 2) / w;
    y1 = (cy + bh / 2) / h;
  } else {
    return null;
  }

  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1)
  };
}

function padNormRect(rect, pad = 0) {
  if (!rect) return null;
  const p = Math.max(0, Number(pad) || 0);
  const x0 = Math.max(0, Math.min(1, rect.x0 - p));
  const y0 = Math.max(0, Math.min(1, rect.y0 - p));
  const x1 = Math.max(0, Math.min(1, rect.x1 + p));
  const y1 = Math.max(0, Math.min(1, rect.y1 + p));
  return buildIgnoreZonePayload(rectToPolygonPoints(
    x0,
    y0,
    Math.max(0.02, x1 - x0),
    Math.max(0.02, y1 - y0)
  ));
}

/**
 * Build an ignore zone from a detection bbox/position in image pixel space.
 * @param {{ bbox?: object, position?: object }} bird
 * @param {{ width: number, height: number }} imageSize
 * @param {number} [pad=0] padding in normalized units
 */
export function ignoreZoneFromBirdBox(bird, imageSize, pad = 0) {
  return padNormRect(birdBoxNormRect(bird, imageSize), pad);
}

function unionRect(rects) {
  if (!rects?.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  rects.forEach((r) => {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  });
  return { x0, y0, x1, y1 };
}

/** True if rects overlap or are closer than mergeGap (normalized). */
function rectsNear(a, b, mergeGap = 0.1) {
  const g = Math.max(0, Number(mergeGap) || 0);
  const ax0 = a.x0 - g;
  const ay0 = a.y0 - g;
  const ax1 = a.x1 + g;
  const ay1 = a.y1 + g;
  return !(ax1 < b.x0 || b.x1 < ax0 || ay1 < b.y0 || b.y1 < ay0);
}

function zonePointsToRect(points) {
  if (!Array.isArray(points) || !points.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let any = false;
  points.forEach((p) => {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    any = true;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  });
  return any ? { x0, y0, x1, y1 } : null;
}

/**
 * Cluster axis-aligned rects: nearby/overlapping → same group, then one max-box each.
 * Separates e.g. shoe vs planter into two ignore zones instead of one huge box.
 * @param {Array<{x0,y0,x1,y1}>} rects
 * @param {number} [mergeGap=0.1] how close (in 0–1 image space) before merge
 * @returns {Array<{x0,y0,x1,y1}>}
 */
export function clusterNormRects(rects, mergeGap = 0.1) {
  const list = (rects || []).filter(Boolean);
  const n = list.length;
  if (!n) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    let p = i;
    while (parent[p] !== p) p = parent[p];
    let cur = i;
    while (parent[cur] !== p) {
      const next = parent[cur];
      parent[cur] = p;
      cur = next;
    }
    return p;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (rectsNear(list[i], list[j], mergeGap)) unite(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(list[i]);
  }
  return [...groups.values()].map((g) => unionRect(g)).filter(Boolean);
}

/**
 * One max-box per spatial cluster of detection boxes (not one giant union).
 * @param {Array<{ bird: object, imageSize: { width: number, height: number } }>} birdBoxes
 * @param {number} [pad=0]
 * @param {number} [mergeGap=0.1]
 * @returns {Array<object>} ignore zone payloads
 */
export function maxIgnoreZonesFromBirdBoxes(birdBoxes, pad = 0, mergeGap = 0.1) {
  if (!Array.isArray(birdBoxes) || !birdBoxes.length) return [];
  const rects = birdBoxes.map((bb) => birdBoxNormRect(bb?.bird, bb?.imageSize)).filter(Boolean);
  return clusterNormRects(rects, mergeGap)
    .map((r) => padNormRect(r, pad))
    .filter(Boolean);
}

/** @deprecated use maxIgnoreZonesFromBirdBoxes — kept for single-box callers */
export function maxIgnoreZoneFromBirdBoxes(birdBoxes, pad = 0) {
  const zones = maxIgnoreZonesFromBirdBoxes(birdBoxes, pad);
  return zones[0] || null;
}

/**
 * Cluster current zone polygons → one max-box per cluster.
 * @param {Array<{ points: Array<{x:number,y:number}> }>} zones
 * @param {number} [pad=0]
 * @param {number} [mergeGap=0.1]
 */
export function maxIgnoreZonesFromZones(zones, pad = 0, mergeGap = 0.1) {
  if (!Array.isArray(zones) || !zones.length) return [];
  const rects = zones.map((z) => zonePointsToRect(z?.points)).filter(Boolean);
  return clusterNormRects(rects, mergeGap)
    .map((r) => padNormRect(r, pad))
    .filter(Boolean);
}

/** @deprecated use maxIgnoreZonesFromZones */
export function maxIgnoreZoneFromZones(zones, pad = 0) {
  const list = maxIgnoreZonesFromZones(zones, pad);
  return list[0] || null;
}

export function isNormPointInAnyIgnoreZone(normX, normY, zones) {
  return normalizeIgnoreZones(zones).some((z) => isPointInPolygon(normX, normY, z.points));
}

function collectBirds(detection) {
  const birds = [];
  if (detection?.target_bird) birds.push(detection.target_bird);
  (detection?.detections || []).forEach((det) => {
    if (det?.class === 'bird') birds.push(det);
  });
  return birds;
}

function overlaysForSize(detection, zones, imageSize, { onlyAffected = true } = {}) {
  if (!imageSize?.width || !imageSize?.height) return [];
  const normalized = normalizeIgnoreZones(zones);
  const out = [];
  collectBirds(detection).forEach((bird) => {
    const rect = birdBoxNormRect(bird, imageSize);
    if (!rect) return;
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;
    const hit = normalized.length > 0 && isNormPointInAnyIgnoreZone(cx, cy, normalized);
    if (onlyAffected && !hit) return;
    out.push({
      left: rect.x0 * 100,
      top: rect.y0 * 100,
      width: (rect.x1 - rect.x0) * 100,
      height: (rect.y1 - rect.y0) * 100,
      affected: hit
    });
  });
  return out;
}

/**
 * Bird boxes as % overlays. Tries original_size then zoomed_size so coords match the image.
 * Prefers sizeHint when provided ('original' | 'zoomed').
 * @returns {Array<{ left: number, top: number, width: number, height: number, affected: boolean }>}
 */
export function affectedBirdOverlays(detection, zones, sizeHint = null) {
  if (!detection) return [];
  const info = detection.image_info || {};
  const order = [];
  if (sizeHint === 'zoomed' && info.zoomed_size) order.push(info.zoomed_size);
  if (sizeHint === 'original' && info.original_size) order.push(info.original_size);
  if (info.original_size) order.push(info.original_size);
  if (info.zoomed_size) order.push(info.zoomed_size);

  const seen = new Set();
  for (const size of order) {
    const key = `${size.width}x${size.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const affected = overlaysForSize(detection, zones, size, { onlyAffected: true });
    if (affected.length) return affected;
  }
  // Fallback: show all bird boxes (still mark which hit zones) so UI is never empty
  for (const size of order) {
    const all = overlaysForSize(detection, zones, size, { onlyAffected: false });
    if (all.length) return all;
  }
  return [];
}

/**
 * True if any bird box center of this detection falls inside an ignore zone
 * (same rule as hardware-monitor: center-in-polygon).
 */
export function detectionHitsIgnoreZones(detection, zones) {
  return affectedBirdOverlays(detection, zones).some((o) => o.affected);
}
