/**
 * Shoot zone helpers – laser uses a free polygon on the full camera frame.
 */

const DEFAULT_POLYGON_POINTS = [
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 }
];

const MIN_POLYGON_POINTS = 3;
const MAX_POLYGON_POINTS = 24;

function clampPoint(point) {
  return {
    x: Math.max(0, Math.min(1, Number(point.x))),
    y: Math.max(0, Math.min(1, Number(point.y)))
  };
}

function clampPolygonPoints(points) {
  if (!Array.isArray(points) || points.length < MIN_POLYGON_POINTS) {
    return DEFAULT_POLYGON_POINTS.map((p) => ({ ...p }));
  }
  return points.slice(0, MAX_POLYGON_POINTS).map((p) => clampPoint(p));
}

function rectToPolygonPoints(x, y, width, height) {
  return clampPolygonPoints([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ]);
}

function parseLaserEnabled(zone) {
  return typeof zone.laserEnabled === 'boolean'
    ? zone.laserEnabled
    : zone.enabled !== false;
}

function normalizeLaserZone(zone) {
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

function isLaserRestrictionActive(zone) {
  const normalized = normalizeLaserZone(zone);
  if (!normalized) return false;
  return normalized.laserEnabled;
}

function isPointInPolygon(normX, normY, points) {
  const polygon = clampPolygonPoints(points);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > normY) !== (yj > normY))
      && (normX < ((xj - xi) * (normY - yi)) / (yj - yi + 1e-7) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function bboxCenterToNormalized(bbox, zoomFactor, originalWidth, originalHeight) {
  if (!bbox || !originalWidth || !originalHeight) return null;
  const zoom = Math.max(1, Number(zoomFactor) || 1);
  const W = originalWidth;
  const H = originalHeight;
  const Wz = W / zoom;
  const Hz = H / zoom;
  const startX = (W - Wz) / 2;
  const startY = (H - Hz) / 2;

  const cx = startX + Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
  const cy = startY + Number(bbox.y || 0) + Number(bbox.height || 0) / 2;

  return { x: cx / W, y: cy / H };
}

function isBirdInZone(targetBird, zone, zoomFactor, originalWidth, originalHeight) {
  const normalized = normalizeLaserZone(zone);
  if (!normalized) return false;

  const bbox = targetBird?.bbox;
  if (!bbox) return false;

  const center = bboxCenterToNormalized(bbox, zoomFactor, originalWidth, originalHeight);
  if (!center) return false;

  return isPointInPolygon(center.x, center.y, normalized.points);
}

function getOriginalDimensions(imageInfo) {
  const origW = imageInfo?.original_size?.width || imageInfo?.originalSize?.width;
  const origH = imageInfo?.original_size?.height || imageInfo?.originalSize?.height;
  return { origW, origH };
}

function resolveShootUseLaser(taubenschiesser, routeCoordinate, targetBird, zoomFactor, imageInfo) {
  const globalLaser = taubenschiesser?.shootUseLaser !== false;
  if (!globalLaser) return false;

  const zone = normalizeLaserZone(routeCoordinate?.laserZone);
  if (!zone || !isLaserRestrictionActive(zone)) return true;

  const { origW, origH } = getOriginalDimensions(imageInfo);
  if (!origW || !origH) return false;

  return isBirdInZone(targetBird, zone, zoomFactor, origW, origH);
}

function resolveShootUseAudio(taubenschiesser, routeCoordinate) {
  if (!taubenschiesser?.shootUseAudio) return false;
  if (!routeCoordinate || typeof routeCoordinate !== 'object') return false;
  return routeCoordinate.audioEnabled === true;
}

module.exports = {
  DEFAULT_POLYGON_POINTS,
  normalizeLaserZone,
  isLaserRestrictionActive,
  isPointInPolygon,
  bboxCenterToNormalized,
  isBirdInZone,
  resolveShootUseLaser,
  resolveShootUseAudio
};
