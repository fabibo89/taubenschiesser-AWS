// Shared panorama pixel<->angle mapping helpers.
//
// The Hugin panorama is an *equirectangular* (spherical) projection: device
// yaw (rotation) maps linearly to x and pitch (tilt) maps linearly to y over
// the full 360x180 canvas, with identical px/deg on both axes (square pixels).
// Lines of constant rotation/tilt are therefore straight and evenly spaced in
// the flat image — only the image *content* and the camera frame edges look
// curved. On a 3D sphere those same lines curve and converge at the poles.

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function framePanoramaCenter(frame) {
  const corners = frame.panorama_corners;
  if (!corners?.length) return null;
  return {
    cx: corners.reduce((s, [x]) => s + x, 0) / corners.length,
    cy: corners.reduce((s, [, y]) => s + y, 0) / corners.length
  };
}

export function isWrapFrame(frame, frames) {
  const row = frames
    .filter((f) => f.tilt === frame.tilt && f.panorama_corners?.length)
    .sort((a, b) => a.rotation - b.rotation);
  const idx = row.findIndex((f) => f.order === frame.order);
  if (idx <= 0) return false;
  const prev = framePanoramaCenter(row[idx - 1]);
  const cur = framePanoramaCenter(frame);
  return prev && cur && cur.cx < prev.cx - 100;
}

export function linearFit(points, angleKey, pixelKey) {
  if (points.length < 2) return null;
  const n = points.length;
  const meanAngle = points.reduce((sum, p) => sum + p[angleKey], 0) / n;
  const meanPixel = points.reduce((sum, p) => sum + p[pixelKey], 0) / n;
  let cov = 0;
  let variance = 0;
  for (const p of points) {
    cov += (p[angleKey] - meanAngle) * (p[pixelKey] - meanPixel);
    variance += (p[angleKey] - meanAngle) ** 2;
  }
  if (Math.abs(variance) < 1e-9) return null;
  const slope = cov / variance;
  if (Math.abs(slope) < 1e-9) return null;
  return { slope, intercept: meanPixel - slope * meanAngle };
}

function computeFrameBounds(frames, fov) {
  if (!frames?.length || !fov) return null;
  const rots = frames
    .map((f) => f.rotation)
    .filter((v) => Number.isFinite(v));
  const tilts = frames
    .map((f) => f.tilt)
    .filter((v) => Number.isFinite(v));
  if (!rots.length || !tilts.length) return null;
  const half = Number(fov) / 2;
  return {
    rotMin: Math.min(...rots) - half,
    rotMax: Math.max(...rots) + half,
    tiltMin: Math.min(...tilts) - half,
    tiltMax: Math.max(...tilts) + half
  };
}

// Build a pixel<->angle mapping for the panorama. Returns null when no reliable
// mapping can be derived. `toPixel(rotation, tilt)` and `fromPixel(x, y)` /
// `fromPixelRaw(x, y)` operate on the cropped panorama image pixels.
export function buildAnglePixelMapping(frames, gridInfo, fov) {
  const scanBounds = computeFrameBounds(frames, fov);

  if (gridInfo?.projection === 'spherical_equirectangular') {
    const { rot_min, tilt_max, pixels_per_degree_x: ppdX, pixels_per_degree_y: ppdY } = gridInfo;
    if (!ppdX || !ppdY) return null;
    return {
      bounds: scanBounds,
      toPixel: (rotation, tilt) => ({
        x: (rotation - rot_min) * ppdX,
        y: (tilt_max - tilt) * ppdY
      }),
      fromPixel: (x, y) => ({
        rotation: clamp(
          x / ppdX + rot_min,
          scanBounds?.rotMin ?? rot_min,
          scanBounds?.rotMax ?? gridInfo.rot_max ?? 180
        ),
        tilt: clamp(
          tilt_max - y / ppdY,
          scanBounds?.tiltMin ?? gridInfo.tilt_min ?? 0,
          scanBounds?.tiltMax ?? tilt_max
        )
      }),
      fromPixelRaw: (x, y) => ({
        rotation: x / ppdX + rot_min,
        tilt: tilt_max - y / ppdY
      })
    };
  }

  if (gridInfo?.projection === 'hugin_equirectangular') {
    const cropLeft = gridInfo.crop_left ?? 0;
    const cropTop = gridInfo.crop_top ?? 0;
    const horizonTilt = gridInfo.horizon_tilt ?? 90;
    // Hugin yaw = device rotation - yawOffset (panorama centered on the scan so
    // the full FoV stays within the +/-180 seam). Older results have no offset.
    const yawOffset = gridInfo.yaw_offset ?? 0;
    let fullW = gridInfo.hugin_canvas_width;
    let fullH = gridInfo.hugin_canvas_height;

    // Older saved results stored null canvas dims. Reconstruct the full
    // equirectangular canvas from the crop box (it spans the whole 360x180).
    if ((!fullW || !fullH) && gridInfo.crop_right && gridInfo.crop_bottom) {
      fullW = gridInfo.crop_right;
      fullH = gridInfo.crop_bottom;
    }

    // Path A: full equirectangular canvas known -> exact analytic formula.
    if (fullW && fullH) {
      return {
        bounds: scanBounds,
        toPixel: (rotation, tilt) => ({
          x: fullW * (0.5 + (rotation - yawOffset) / 360) - cropLeft,
          y: fullH * (0.5 - (tilt - horizonTilt) / 180) - cropTop
        }),
        fromPixel: (x, y) => ({
          rotation: clamp(
            ((x + cropLeft) / fullW - 0.5) * 360 + yawOffset,
            scanBounds?.rotMin ?? 0,
            scanBounds?.rotMax ?? 180
          ),
          tilt: clamp(
            horizonTilt + (0.5 - (y + cropTop) / fullH) * 180,
            scanBounds?.tiltMin ?? 0,
            scanBounds?.tiltMax ?? 90
          )
        }),
        fromPixelRaw: (x, y) => ({
          rotation: ((x + cropLeft) / fullW - 0.5) * 360 + yawOffset,
          tilt: horizonTilt + (0.5 - (y + cropTop) / fullH) * 180
        })
      };
    }

    // Path B: derive px/deg from the most reliable (highest-tilt) frame row.
    const centers = (frames || [])
      .filter((f) => f.panorama_corners?.length && f.rotation != null && f.tilt != null)
      .map((f) => ({ ...f, ...framePanoramaCenter(f) }))
      .filter((f) => Number.isFinite(f.cx) && Number.isFinite(f.cy) && !isWrapFrame(f, frames));

    const byTilt = new Map();
    for (const f of centers) {
      if (!byTilt.has(f.tilt)) byTilt.set(f.tilt, []);
      byTilt.get(f.tilt).push(f);
    }

    const candidateTilts = [...byTilt.keys()]
      .filter((t) => byTilt.get(t).length >= 2)
      .sort((a, b) => b - a);
    const anchorTilt = candidateTilts.find((t) => byTilt.get(t).length >= 3)
      ?? candidateTilts[0];

    if (anchorTilt != null) {
      const row = byTilt.get(anchorTilt);
      const rowFit = linearFit(row, 'rotation', 'cx');
      if (rowFit && Math.abs(rowFit.slope) > 1e-6) {
        const pxPerDeg = Math.abs(rowFit.slope);
        const xAtRot0 = rowFit.intercept;
        const yAnchor = row.reduce((s, p) => s + p.cy, 0) / row.length;
        return {
          bounds: scanBounds,
          toPixel: (rotation, tilt) => ({
            x: xAtRot0 + rotation * rowFit.slope,
            y: yAnchor + (anchorTilt - tilt) * pxPerDeg
          }),
          fromPixel: (x, y) => ({
            rotation: clamp(
              (x - xAtRot0) / rowFit.slope,
              scanBounds?.rotMin ?? 0,
              scanBounds?.rotMax ?? 180
            ),
            tilt: clamp(
              anchorTilt - (y - yAnchor) / pxPerDeg,
              scanBounds?.tiltMin ?? 0,
              scanBounds?.tiltMax ?? 90
            )
          }),
          fromPixelRaw: (x, y) => ({
            rotation: (x - xAtRot0) / rowFit.slope,
            tilt: anchorTilt - (y - yAnchor) / pxPerDeg
          })
        };
      }
    }
  }

  return null;
}
