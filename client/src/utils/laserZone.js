export const DEFAULT_POLYGON_POINTS = [
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 }
];

export const MIN_POLYGON_POINTS = 3;
export const MAX_POLYGON_POINTS = 24;

export function clampPoint(point) {
  return {
    x: Math.max(0, Math.min(1, Number(point.x))),
    y: Math.max(0, Math.min(1, Number(point.y)))
  };
}

export function clampPolygonPoints(points) {
  if (!Array.isArray(points) || points.length < MIN_POLYGON_POINTS) {
    return DEFAULT_POLYGON_POINTS.map((p) => ({ ...p }));
  }
  return points.slice(0, MAX_POLYGON_POINTS).map((p) => clampPoint(p));
}

export function rectToPolygonPoints(x, y, width, height) {
  return clampPolygonPoints([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ]);
}

export function isRoutePointAudioEnabled(coordinate) {
  if (!coordinate || typeof coordinate !== 'object') return false;
  if (coordinate.audioEnabled === true) return true;
  return coordinate.laserZone?.audioEnabled === true;
}

function parseLaserEnabled(zone) {
  return typeof zone.laserEnabled === 'boolean'
    ? zone.laserEnabled
    : zone.enabled !== false;
}

/** Normalize legacy rect / quad / polygon into polygon points. */
export function normalizeLaserZone(zone) {
  if (!zone || typeof zone !== 'object') return null;

  const laserEnabled = parseLaserEnabled(zone);
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
    enabled: laserEnabled,
    laserEnabled,
    shape: 'polygon',
    points
  };
}

export function isLaserRestrictionActive(zone) {
  const normalized = normalizeLaserZone(zone);
  if (!normalized) return false;
  return normalized.laserEnabled;
}

export function hasActiveLaserZone(zone) {
  return isLaserRestrictionActive(zone);
}

export function hasRoutePointSettings(coordinate) {
  return hasActiveLaserZone(coordinate?.laserZone) || isRoutePointAudioEnabled(coordinate);
}

export function updatePointAtIndex(points, index, normX, normY) {
  const next = clampPolygonPoints(points);
  if (index < 0 || index >= next.length) return next;
  next[index] = clampPoint({ x: normX, y: normY });
  return next;
}

export function insertPointOnEdge(points, edgeIndex, normX, normY) {
  const next = clampPolygonPoints(points);
  if (next.length >= MAX_POLYGON_POINTS) return next;
  const insertIndex = edgeIndex + 1;
  next.splice(insertIndex, 0, clampPoint({ x: normX, y: normY }));
  return next;
}

export function removePointAtIndex(points, index) {
  const next = clampPolygonPoints(points);
  if (next.length <= MIN_POLYGON_POINTS) return next;
  if (index < 0 || index >= next.length) return next;
  next.splice(index, 1);
  return next;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return { dist: Math.hypot(px - x1, py - y1), t: 0, x: x1, y: y1 };
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return { dist: Math.hypot(px - x, py - y), t, x, y };
}

/** Hit test vertices in screen pixels. Returns point index or -1. */
export function hitTestVertexIndex(points, bounds, clientX, clientY, hitPx = 20) {
  if (!bounds) return -1;
  let bestIndex = -1;
  let bestDist = hitPx;
  points.forEach((point, index) => {
    const px = bounds.left + point.x * bounds.width;
    const py = bounds.top + point.y * bounds.height;
    const dist = Math.hypot(clientX - px, clientY - py);
    if (dist <= bestDist) {
      bestDist = dist;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/** Hit test polygon edges in screen pixels. Returns edge index and norm point on edge. */
export function hitTestEdge(points, bounds, clientX, clientY, hitPx = 14) {
  if (!bounds || points.length < 2) return null;
  const px = clientX - bounds.left;
  const py = clientY - bounds.top;

  let best = null;
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length];
    const x1 = start.x * bounds.width;
    const y1 = start.y * bounds.height;
    const x2 = end.x * bounds.width;
    const y2 = end.y * bounds.height;
    const result = distanceToSegment(px, py, x1, y1, x2, y2);
    if (result.dist <= hitPx && result.t > 0.05 && result.t < 0.95) {
      if (!best || result.dist < best.dist) {
        best = {
          edgeIndex: index,
          dist: result.dist,
          x: result.x / bounds.width,
          y: result.y / bounds.height
        };
      }
    }
  });
  return best;
}

/** Ray-casting point-in-polygon for normalized coordinates. */
export function isPointInPolygon(normX, normY, points) {
  const polygon = clampPolygonPoints(points);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > normY) !== (yj > normY))
      && (normX < ((xj - xi) * (normY - yi)) / (yj - yi + 0.0000001) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function getZoomCropRect(zoom) {
  const z = Math.max(1, Number(zoom) || 1);
  const w = 1 / z;
  const h = 1 / z;
  return {
    x: (1 - w) / 2,
    y: (1 - h) / 2,
    width: w,
    height: h
  };
}

export function buildLaserZonePayload(laserEnabled, points) {
  if (!laserEnabled) return null;
  return {
    enabled: true,
    laserEnabled: true,
    shape: 'polygon',
    points: clampPolygonPoints(points)
  };
}

// Backward-compatible aliases
export const DEFAULT_QUAD_POINTS = DEFAULT_POLYGON_POINTS;
export const isPointInQuad = isPointInPolygon;
