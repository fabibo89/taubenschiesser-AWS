/**
 * Diagonal FOV → per-axis FOV (non-square frames).
 */
function diagonalFovToHorizontalVertical(diagonalFovDeg, imageWidth, imageHeight) {
  if (imageWidth <= 0 || imageHeight <= 0 || diagonalFovDeg <= 0) {
    return { horizontal: 0, vertical: 0 };
  }
  const dRad = (diagonalFovDeg * Math.PI) / 180;
  const diag = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);
  const halfD = Math.tan(dRad / 2);
  const halfHRad = Math.atan((imageWidth / diag) * halfD);
  const halfVRad = Math.atan((imageHeight / diag) * halfD);
  return {
    horizontal: (2 * halfHRad * 180) / Math.PI,
    vertical: (2 * halfVRad * 180) / Math.PI
  };
}

function isSquareFrame(imageWidth, imageHeight) {
  const w = Number(imageWidth) || 0;
  const h = Number(imageHeight) || 0;
  if (w <= 0 || h <= 0) return false;
  return Math.abs(w - h) / Math.max(w, h) < 0.02;
}

/**
 * Resolve horizontal/vertical FOV for aiming.
 * Prefer explicit fovH/fovV; for square frames treat `fov` as per-axis
 * (square crop → equal H/V, no diagonal decomposition).
 */
function resolveAxisFov(cameraConfig, cameraSource, imageWidth, imageHeight) {
  const pi = {
    ...(cameraConfig?.raspberryPi || {}),
    ...(cameraConfig?.esp32P4 || {})
  };
  const tapo = cameraConfig?.tapo || {};
  const fromHttpStill = cameraSource === 'raspberry-pi'
    || cameraSource === 'raspberry_pi'
    || cameraSource === 'esp32-p4';

  const fovH = fromHttpStill ? pi.fovH : (tapo.fovH ?? pi.fovH);
  const fovV = fromHttpStill ? pi.fovV : (tapo.fovV ?? pi.fovV);
  if (Number(fovH) > 0 && Number(fovV) > 0) {
    return { horizontal: Number(fovH), vertical: Number(fovV), mode: 'explicit' };
  }

  let fov = fromHttpStill ? pi.fov : null;
  if (fov == null || fov <= 0) fov = tapo.fov;
  if (fov == null || fov <= 0) fov = pi.fov;
  if (fov == null || fov <= 0) {
    return { horizontal: 0, vertical: 0, mode: 'none' };
  }

  if (isSquareFrame(imageWidth, imageHeight) || (fromHttpStill && pi.square)) {
    return { horizontal: Number(fov), vertical: Number(fov), mode: 'square-per-axis' };
  }

  const hv = diagonalFovToHorizontalVertical(Number(fov), imageWidth, imageHeight);
  return { ...hv, mode: 'diagonal' };
}

/**
 * @param {{ horizontal?: number, vertical?: number }} [fovOverrides]
 * @returns {{ rotationAdjustment: number, tiltAdjustment: number }}
 */
function calculateAngleAdjustment(
  bbox,
  imageWidth,
  imageHeight,
  zoomFactor = 1,
  cameraConfig = null,
  cameraSource = null,
  fovOverrides = null
) {
  if (!bbox || !imageWidth || !imageHeight) {
    return { rotationAdjustment: 0, tiltAdjustment: 0 };
  }

  const bboxCenterX = Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
  const bboxCenterY = Number(bbox.y || 0) + Number(bbox.height || 0) / 2;
  const offsetX = bboxCenterX - imageWidth / 2;
  const offsetY = bboxCenterY - imageHeight / 2;

  let horizontal;
  let vertical;
  if (fovOverrides && Number(fovOverrides.horizontal) > 0 && Number(fovOverrides.vertical) > 0) {
    horizontal = Number(fovOverrides.horizontal);
    vertical = Number(fovOverrides.vertical);
  } else if (!cameraConfig) {
    return { rotationAdjustment: 0, tiltAdjustment: 0 };
  } else {
    const resolved = resolveAxisFov(cameraConfig, cameraSource, imageWidth, imageHeight);
    horizontal = resolved.horizontal;
    vertical = resolved.vertical;
  }

  if (!(horizontal > 0) || !(vertical > 0)) {
    return { rotationAdjustment: 0, tiltAdjustment: 0 };
  }

  const zoom = Math.max(0.1, Number(zoomFactor) || 1);
  horizontal /= zoom;
  vertical /= zoom;

  return {
    rotationAdjustment: offsetX * (horizontal / imageWidth),
    tiltAdjustment: -offsetY * (vertical / imageHeight)
  };
}

module.exports = {
  calculateAngleAdjustment,
  diagonalFovToHorizontalVertical,
  resolveAxisFov,
  isSquareFrame
};
