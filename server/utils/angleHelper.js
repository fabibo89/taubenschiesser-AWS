/**
 * Diagonal FOV → aim angle offsets (same formula as cv-service/angle_helper.py).
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

/**
 * @returns {{ rotationAdjustment: number, tiltAdjustment: number }}
 */
function calculateAngleAdjustment(bbox, imageWidth, imageHeight, zoomFactor = 1, cameraConfig = null, cameraSource = null) {
  if (!bbox || !cameraConfig || !imageWidth || !imageHeight) {
    return { rotationAdjustment: 0, tiltAdjustment: 0 };
  }

  const bboxCenterX = Number(bbox.x || 0) + Number(bbox.width || 0) / 2;
  const bboxCenterY = Number(bbox.y || 0) + Number(bbox.height || 0) / 2;
  const offsetX = bboxCenterX - imageWidth / 2;
  const offsetY = bboxCenterY - imageHeight / 2;

  let diagonalFov = null;
  if (cameraSource === 'raspberry-pi') {
    diagonalFov = cameraConfig.raspberryPi?.fov;
  }
  if (diagonalFov == null) {
    diagonalFov = cameraConfig.tapo?.fov;
  }
  if (diagonalFov == null || diagonalFov <= 0) {
    return { rotationAdjustment: 0, tiltAdjustment: 0 };
  }

  let { horizontal, vertical } = diagonalFovToHorizontalVertical(diagonalFov, imageWidth, imageHeight);
  const zoom = Math.max(0.1, Number(zoomFactor) || 1);
  horizontal /= zoom;
  vertical /= zoom;

  return {
    rotationAdjustment: offsetX * (horizontal / imageWidth),
    tiltAdjustment: -offsetY * (vertical / imageHeight)
  };
}

module.exports = { calculateAngleAdjustment, diagonalFovToHorizontalVertical };
