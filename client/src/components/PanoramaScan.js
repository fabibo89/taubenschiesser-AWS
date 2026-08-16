import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  TextField,
  Card,
  CardContent,
  CardMedia,
  Chip,
  LinearProgress,
  Alert,
  CircularProgress,
  FormControlLabel,
  Switch,
  Divider,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  Panorama as PanoramaIcon,
  PlayArrow as StartIcon,
  Stop as StopIcon,
  Save as SaveIcon,
  Download as DownloadIcon,
  Merge as StitchIcon,
  Image as ImageIcon,
  ThreeDRotation as ThreeDIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import {
  clamp,
  framePanoramaCenter,
  isWrapFrame,
  buildAnglePixelMapping
} from './panoramaMapping';
import PanoramaGlobe from './PanoramaGlobe';

// Overlap between adjacent scan positions (degrees). ~50% of FoV (41°) → step 21°.
const FOV_OVERLAP_DEG = 20;
const HUGIN_ASYNC_METHODS = ['hugin', 'cylindrical'];
const PANORAMA_SAVE_MAX_BASE64_BYTES = 6.5 * 1024 * 1024;
const STITCH_METHODS = [
  { id: 'grid', label: 'Grid (Sphärisch)' },
  { id: 'hugin', label: 'Hugin (Equirect.)' },
  { id: 'cylindrical', label: 'Hugin (Zylindrisch)' },
  { id: 'opencv', label: 'OpenCV (Feature-Matching)' }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sourcePixelToPanorama(x, y, frame, gridInfo) {
  if (!gridInfo || !frame?.image_size) return null;
  const { fov, rot_min, tilt_max, pixels_per_degree_x: ppdX, pixels_per_degree_y: ppdY } = gridInfo;
  const { width: w, height: h } = frame.image_size;
  const rotW = frame.rotation + (x - w / 2) * (fov / w);
  const tiltW = frame.tilt - (y - h / 2) * (fov / h);
  return {
    x: (rotW - rot_min) * ppdX,
    y: (tilt_max - tiltW) * ppdY
  };
}

function panoramaPixelToSphere(px, py, gridInfo) {
  if (!gridInfo) return null;

  if (gridInfo.projection === 'spherical_equirectangular') {
    const { rot_min, tilt_max, pixels_per_degree_x: ppdX, pixels_per_degree_y: ppdY } = gridInfo;
    if (!ppdX || !ppdY) return null;
    return {
      rotation: px / ppdX + rot_min,
      tilt: tilt_max - py / ppdY
    };
  }

  if (gridInfo.projection === 'hugin_equirectangular') {
    const cropLeft = gridInfo.crop_left ?? 0;
    const cropTop = gridInfo.crop_top ?? 0;
    const canvasW = gridInfo.hugin_canvas_width ?? gridInfo.canvas_width;
    const canvasH = gridInfo.hugin_canvas_height ?? gridInfo.canvas_height;
    if (!canvasW || !canvasH) return null;
    const horizonTilt = gridInfo.horizon_tilt ?? 90;
    const yawOffset = gridInfo.yaw_offset ?? 0;
    const pitchCenter = gridInfo.pitch_center ?? horizonTilt;
    const hfov = gridInfo.output_hfov ?? 360;
    const vfov = gridInfo.output_vfov ?? 180;
    const fullX = px + cropLeft;
    const fullY = py + cropTop;
    const rotation = ((fullX / canvasW) - 0.5) * hfov + yawOffset;
    const tilt = pitchCenter + (0.5 - fullY / canvasH) * vfov;
    return { rotation, tilt };
  }

  // Cylindrical: mapping comes from pano_trafo frame outlines (anglePixelMapping).

  return null;
}

function formatDeg(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}°`;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersectsY = (yi > y) !== (yj > y);
    const intersect = intersectsY
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function axisPixelsPerDegree(frames, frame, axis) {
  const MIN_DELTA_PX = 40;

  const tryPair = (a, b, angleKey, pixKey) => {
    const ca = framePanoramaCenter(a);
    const cb = framePanoramaCenter(b);
    if (!ca || !cb) return null;
    const dAngle = b[angleKey] - a[angleKey];
    const dPix = cb[pixKey] - ca[pixKey];
    if (Math.abs(dAngle) < 1e-6 || Math.abs(dPix) < MIN_DELTA_PX) return null;
    return dPix / dAngle;
  };

  if (axis === 'rotation') {
    const row = frames
      .filter((f) => f.tilt === frame.tilt && f.panorama_corners?.length)
      .sort((a, b) => a.rotation - b.rotation);
    const idx = row.findIndex((f) => f.order === frame.order);
    if (idx < 0) return null;
    if (idx > 0) {
      const v = tryPair(row[idx - 1], row[idx], 'rotation', 'cx');
      if (v != null) return v;
    }
    if (idx < row.length - 1) {
      const v = tryPair(row[idx], row[idx + 1], 'rotation', 'cx');
      if (v != null) return v;
    }
    for (let i = 0; i < row.length - 1; i++) {
      const v = tryPair(row[i], row[i + 1], 'rotation', 'cx');
      if (v != null) return v;
    }
    return null;
  }

  const col = frames
    .filter((f) => f.rotation === frame.rotation && f.panorama_corners?.length)
    .sort((a, b) => a.tilt - b.tilt);
  const idx = col.findIndex((f) => f.order === frame.order);
  if (idx < 0) return null;
  if (idx > 0) {
    const v = tryPair(col[idx - 1], col[idx], 'tilt', 'cy');
    if (v != null) return v;
  }
  if (idx < col.length - 1) {
    const v = tryPair(col[idx], col[idx + 1], 'tilt', 'cy');
    if (v != null) return v;
  }
  for (let i = 0; i < col.length - 1; i++) {
    const v = tryPair(col[i], col[i + 1], 'tilt', 'cy');
    if (v != null) return v;
  }
  return null;
}

// Map panorama pixel -> device rotation/tilt using frame outlines and local
// scale from scan neighbours (handles Hugin wrap where rot 0° and 180° share a centroid).
function panoramaPixelToDevice(px, py, frames) {
  if (!frames?.length) return null;

  const mapped = frames
    .filter((f) => f.panorama_corners?.length >= 3 && f.rotation != null && f.tilt != null)
    .map((f) => ({ frame: f, center: framePanoramaCenter(f) }))
    .filter((p) => p.center);

  if (!mapped.length) return null;

  const containing = mapped.filter(
    (p) => pointInPolygon(px, py, p.frame.panorama_corners)
      && !isWrapFrame(p.frame, frames)
  );

  const pickNearest = (candidates) => candidates.reduce((best, p) => {
    const d = (px - p.center.cx) ** 2 + (py - p.center.cy) ** 2;
    if (!best || d < best.d) return { p, d };
    return best;
  }, null)?.p;

  const anchor = containing.length >= 1
    ? pickNearest(containing)
    : pickNearest(mapped);

  if (!anchor) return null;

  const { frame, center } = anchor;
  const ppdRot = axisPixelsPerDegree(frames, frame, 'rotation');
  const ppdTilt = axisPixelsPerDegree(frames, frame, 'tilt');

  let rotation = frame.rotation;
  let tilt = frame.tilt;
  if (ppdRot) rotation += (px - center.cx) / ppdRot;
  if (ppdTilt) tilt += (py - center.cy) / ppdTilt;

  return { rotation, tilt };
}

function strokePolylineSegments(ctx, points, maxJump = 250) {
  if (points.length < 2) return;
  let segment = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const jump = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (jump > maxJump && segment.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(segment[0].x, segment[0].y);
      segment.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      segment = [cur];
    } else {
      segment.push(cur);
    }
  }
  if (segment.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(segment[0].x, segment[0].y);
    segment.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }
}

function strokeFrameOutline(ctx, corners, width, height) {
  const maxJump = Math.max(width, height) * 0.25;
  const points = (corners || [])
    .map(([x, y]) => ({ x, y }))
    .filter((p) => (
      Number.isFinite(p.x) && Number.isFinite(p.y)
      && p.x > -width && p.x < width * 2
      && p.y > -height && p.y < height * 2
    ));
  if (points.length < 2) return;
  strokePolylineSegments(ctx, points, maxJump);
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) <= maxJump) {
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(first.x, first.y);
    ctx.stroke();
  }
}

const GRATICULE_STEP_DEG = 10;
const GRATICULE_SAMPLE_DEG = 1;

// Draw the rotation/tilt graticule (straight equirectangular lines) across the
// full visible canvas, including negative degrees (image edges reach beyond the
// scanned 0..180 / 0..90 because each frame is FoV/2 wider than its center).
function drawGraticule(ctx, mapping, width, height) {
  if (!mapping?.toPixel || !mapping?.fromPixelRaw) return;

  const cornersAngles = [
    mapping.fromPixelRaw(0, 0),
    mapping.fromPixelRaw(width, 0),
    mapping.fromPixelRaw(0, height),
    mapping.fromPixelRaw(width, height)
  ];
  const rots = cornersAngles.map((a) => a.rotation);
  const tilts = cornersAngles.map((a) => a.tilt);
  const floorTo = (v, s) => Math.floor(v / s) * s;
  const ceilTo = (v, s) => Math.ceil(v / s) * s;
  const rotStart = floorTo(mapping.bounds?.rotMin ?? Math.min(...rots), GRATICULE_STEP_DEG);
  const rotEnd = ceilTo(mapping.bounds?.rotMax ?? Math.max(...rots), GRATICULE_STEP_DEG);
  const tiltStart = floorTo(mapping.bounds?.tiltMin ?? Math.min(...tilts), GRATICULE_STEP_DEG);
  const tiltEnd = ceilTo(mapping.bounds?.tiltMax ?? Math.max(...tilts), GRATICULE_STEP_DEG);

  const toPixel = (rot, tilt) => mapping.toPixel(rot, tilt);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 3;

  for (let rot = rotStart; rot <= rotEnd; rot += GRATICULE_STEP_DEG) {
    const points = [];
    for (let tilt = tiltStart; tilt <= tiltEnd; tilt += GRATICULE_SAMPLE_DEG) {
      points.push(toPixel(rot, tilt));
    }
    strokePolylineSegments(ctx, points, Math.max(width, height));
  }

  for (let tilt = tiltStart; tilt <= tiltEnd; tilt += GRATICULE_STEP_DEG) {
    const points = [];
    for (let rot = rotStart; rot <= rotEnd; rot += GRATICULE_SAMPLE_DEG) {
      points.push(toPixel(rot, tilt));
    }
    strokePolylineSegments(ctx, points, Math.max(width, height));
  }

  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.font = 'bold 22px sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = 3;

  for (let rot = rotStart; rot <= rotEnd; rot += GRATICULE_STEP_DEG) {
    const p = toPixel(rot, tiltStart);
    if (p.x < 0 || p.x > width) continue;
    const label = `${rot}°`;
    const lx = clamp(p.x - 12, 2, width - 40);
    ctx.strokeText(label, lx, height - 10);
    ctx.fillText(label, lx, height - 10);
  }

  for (let tilt = tiltStart; tilt <= tiltEnd; tilt += GRATICULE_STEP_DEG) {
    const p = toPixel(rotStart < 0 ? 0 : rotStart, tilt);
    if (p.y < 0 || p.y > height) continue;
    const label = `${tilt}°`;
    const ly = clamp(p.y + 6, 18, height - 4);
    ctx.strokeText(label, 8, ly);
    ctx.fillText(label, 8, ly);
  }

  ctx.restore();
}

function drawCameraGrid(ctx, frames, width, height) {
  if (!frames?.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 2;

  frames.forEach((frame) => {
    const corners = frame.panorama_corners;
    if (!corners?.length) return;
    strokeFrameOutline(ctx, corners, width, height);
  });

  ctx.restore();
}

function getDeviceFov(device) {
  if (!device?.camera) return 110;
  const cam = device.camera;
  if (cam.type === 'dual' || cam.type === 'tapo') {
    return cam.tapo?.fov || 110;
  }
  if (cam.type === 'raspberry-pi') {
    return cam.raspberryPi?.fov || 75;
  }
  return cam.tapo?.fov || 110;
}

function buildAxisValues(min, max, step) {
  if (min > max || step <= 0) return [];
  const values = [];
  for (let v = min; v <= max; v += step) {
    values.push(Math.round(v));
  }
  const last = values[values.length - 1];
  if (last === undefined || last < max) {
    values.push(Math.round(max));
  }
  return values;
}

function generateScanPositions(minRot, maxRot, minTilt, maxTilt, stepRot, stepTilt) {
  const tilts = buildAxisValues(minTilt, maxTilt, stepTilt).reverse();
  const positions = [];
  for (const tilt of tilts) {
    const rotations = buildAxisValues(minRot, maxRot, stepRot);
    for (const rotation of rotations) {
      positions.push({ rotation, tilt });
    }
  }
  return positions;
}

function panoramaDataUrlBase64Bytes(dataUrl) {
  const idx = dataUrl.indexOf(',');
  const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  return base64.length;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasToJpegDataUrl(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('JPEG-Kodierung fehlgeschlagen'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

async function compressPanoramaForSave(dataUrl, maxBase64Bytes = PANORAMA_SAVE_MAX_BASE64_BYTES) {
  if (!dataUrl?.startsWith('data:image') || panoramaDataUrlBase64Bytes(dataUrl) <= maxBase64Bytes) {
    return dataUrl;
  }

  const img = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  let quality = 0.88;
  let compressed = dataUrl;
  while (quality >= 0.4) {
    compressed = await canvasToJpegDataUrl(canvas, quality);
    if (panoramaDataUrlBase64Bytes(compressed) <= maxBase64Bytes) {
      return compressed;
    }
    quality -= 0.08;
  }

  let scale = 0.85;
  while (scale >= 0.5) {
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    compressed = await canvasToJpegDataUrl(canvas, 0.82);
    if (panoramaDataUrlBase64Bytes(compressed) <= maxBase64Bytes) {
      return compressed;
    }
    scale -= 0.1;
  }

  throw new Error(
    `Panorama auch nach Kompression zu groß (${(panoramaDataUrlBase64Bytes(compressed) / 1024 / 1024).toFixed(2)} MB). Bitte als JPG herunterladen.`
  );
}

const PanoramaPreview = ({ panoramaUrl, frames, gridInfo, fov, showBorders, showCameraGrid, showGraticule }) => {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const [hoverCoords, setHoverCoords] = useState(null);
  const anglePixelMapping = useMemo(
    () => buildAnglePixelMapping(frames, gridInfo, fov),
    [frames, gridInfo, fov]
  );

  const handleMouseMove = useCallback((e) => {
    const img = imgRef.current;
    if (!img?.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    if (
      e.clientX < rect.left || e.clientX > rect.right
      || e.clientY < rect.top || e.clientY > rect.bottom
    ) {
      setHoverCoords(null);
      return;
    }
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    const device = anglePixelMapping?.fromPixel(px, py) ?? panoramaPixelToDevice(px, py, frames);
    let rotation = device?.rotation ?? null;
    let tilt = device?.tilt ?? null;
    if (rotation == null || tilt == null) {
      const sphere = panoramaPixelToSphere(px, py, gridInfo);
      rotation = sphere?.rotation ?? rotation;
      tilt = sphere?.tilt ?? tilt;
    }

    setHoverCoords({
      px: Math.round(px),
      py: Math.round(py),
      rotation,
      tilt
    });
  }, [anglePixelMapping, frames, gridInfo]);

  const handleMouseLeave = useCallback(() => {
    setHoverCoords(null);
  }, []);

  useEffect(() => {
    const needsOverlay = showBorders || showCameraGrid || showGraticule;
    if (!panoramaUrl || !needsOverlay) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const draw = () => {
      if (!img.complete || img.naturalWidth === 0) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const container = containerRef.current;
      if (container) {
        const scale = container.offsetWidth / img.naturalWidth;
        canvas.style.width = `${container.offsetWidth}px`;
        canvas.style.height = `${img.naturalHeight * scale}px`;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (showCameraGrid && frames?.length) {
        drawCameraGrid(ctx, frames, canvas.width, canvas.height);
      }

      if (showGraticule && anglePixelMapping) {
        drawGraticule(ctx, anglePixelMapping, canvas.width, canvas.height);
      }

      if (showBorders && frames?.length) {
        const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#800080', '#FFA500'];

        frames.forEach((frame, i) => {
          const size = frame.image_size;
          if (!size) return;

          let corners;
          if (frame.panorama_corners?.length >= 2) {
            corners = frame.panorama_corners;
          } else if (gridInfo?.projection === 'spherical_equirectangular') {
            const { width: w, height: h } = size;
            corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => {
              const p = sourcePixelToPanorama(x, y, frame, gridInfo);
              return p ? [p.x, p.y] : [0, 0];
            });
          } else {
            const matrix = frame.transformation_matrix;
            if (!matrix) return;
            const { width: w, height: h } = size;
            corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => {
              const xt = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2];
              const yt = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2];
              const wv = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
              return [xt / wv, yt / wv];
            });
          }

          ctx.strokeStyle = colors[i % colors.length];
          ctx.lineWidth = 8;
          ctx.setLineDash([]);
          strokeFrameOutline(ctx, corners, canvas.width, canvas.height);
          const cx = corners.reduce((s, [x]) => s + x, 0) / corners.length;
          const cy = corners.reduce((s, [, y]) => s + y, 0) / corners.length;
          ctx.fillStyle = colors[i % colors.length];
          ctx.font = 'bold 48px sans-serif';
          ctx.fillText(`#${frame.order + 1}`, cx - 20, cy + 16);
        });
      }
    };

    if (img.complete) draw();
    else img.onload = draw;
  }, [panoramaUrl, frames, gridInfo, showBorders, showCameraGrid, showGraticule, anglePixelMapping]);

  if (!panoramaUrl) return null;

  return (
    <Box>
      <Box
        ref={containerRef}
        sx={{ position: 'relative', width: '100%', cursor: gridInfo ? 'crosshair' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <img
          ref={imgRef}
          src={panoramaUrl}
          alt="Panorama"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
        {showBorders || showCameraGrid || showGraticule ? (
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
          />
        ) : null}
      </Box>
      <Box
        sx={{
          mt: 1,
          px: 1.5,
          py: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap'
        }}
      >
        {hoverCoords ? (
          <>
            <span>Rot {formatDeg(hoverCoords.rotation)}</span>
            <span>Tilt {formatDeg(hoverCoords.tilt)}</span>
            <span style={{ opacity: 0.7 }}>
              Pixel {hoverCoords.px}, {hoverCoords.py}
            </span>
          </>
        ) : (
          <span style={{ opacity: 0.6 }}>Maus über Panorama bewegen für Kugelkoordinaten</span>
        )}
      </Box>
    </Box>
  );
};

const PanoramaScan = () => {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [device, setDevice] = useState(null);
  const [loadingDevices, setLoadingDevices] = useState(true);

  const [minRot, setMinRot] = useState(30);
  const [maxRot, setMaxRot] = useState(150);
  const [minTilt, setMinTilt] = useState(50);
  const [maxTilt, setMaxTilt] = useState(130);

  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState([]);
  const [savedFrameCount, setSavedFrameCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scanError, setScanError] = useState(null);

  const [stitchResults, setStitchResults] = useState({
    opencv: null, grid: null, hugin: null, cylindrical: null
  });
  const [stitchingMethod, setStitchingMethod] = useState(null);
  const [huginProgress, setHuginProgress] = useState(null);
  const [savingResultMethod, setSavingResultMethod] = useState(null);
  const [showBorders, setShowBorders] = useState(true);
  const [showCameraGrid, setShowCameraGrid] = useState(false);
  const [showGraticule, setShowGraticule] = useState(false);
  const [viewMode, setViewMode] = useState('image');

  const abortRef = useRef(false);

  const fovInfo = useMemo(() => {
    // Stored FoV is already the per-axis FoV (after rotation + square crop),
    // i.e. horizontal == vertical == fov. No diagonal->H/V conversion.
    const fov = getDeviceFov(device);
    const stepRot = Math.max(5, fov - FOV_OVERLAP_DEG);
    const stepTilt = Math.max(5, fov - FOV_OVERLAP_DEG);
    return { fov, horizontalFovDeg: fov, verticalFovDeg: fov, stepRot, stepTilt };
  }, [device]);

  const plannedPositions = useMemo(() => {
    if (!device) return [];
    return generateScanPositions(
      Number(minRot), Number(maxRot),
      Number(minTilt), Number(maxTilt),
      fovInfo.stepRot, fovInfo.stepTilt
    );
  }, [device, minRot, maxRot, minTilt, maxTilt, fovInfo.stepRot, fovInfo.stepTilt]);

  // Use unsaved session frames if present, otherwise fall back to frames in DB.
  const hasSessionFrames = !saved && capturedFrames.length >= 2;
  const stitchSourceCount = hasSessionFrames ? capturedFrames.length : savedFrameCount;
  const canStitch = stitchSourceCount >= 2 && !scanning;

  const loadDeviceData = useCallback(async (deviceId) => {
    if (!deviceId) return;
    try {
      const [deviceRes, scanRes, resultsRes] = await Promise.all([
        axios.get(`/api/devices/${deviceId}`),
        axios.get(`/api/devices/${deviceId}/panorama-scan`),
        axios.get(`/api/devices/${deviceId}/panorama-scan/results`)
      ]);
      setDevice(deviceRes.data);
      setSavedFrameCount(scanRes.data.count || 0);

      const loaded = {};
      for (const method of ['opencv', 'grid', 'hugin', 'cylindrical']) {
        if ((resultsRes.data.results || []).some(r => r.method === method)) {
          try {
            const r = await axios.get(`/api/devices/${deviceId}/panorama-scan/result/${method}`);
            loaded[method] = {
              panorama_url: r.data.panorama_url,
              panorama_size: r.data.panorama_size,
              frames: r.data.frames,
              statistics: r.data.statistics,
              grid_info: r.data.grid_info,
              hugin_pto: r.data.hugin_pto || null,
              persisted: true
            };
          } catch {
            // ignore
          }
        }
      }
      setStitchResults(prev => ({ ...prev, ...loaded }));
    } catch {
      toast.error('Fehler beim Laden des Geräts');
    }
  }, []);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await axios.get('/api/devices');
        setDevices(res.data);
      } catch {
        toast.error('Fehler beim Laden der Geräte');
      } finally {
        setLoadingDevices(false);
      }
    };
    fetchDevices();
  }, []);

  useEffect(() => {
    if (selectedDeviceId) {
      loadDeviceData(selectedDeviceId);
      setCapturedFrames([]);
      setScanComplete(false);
      setSaved(false);
      setStitchResults({ opencv: null, grid: null, hugin: null, cylindrical: null });
    } else {
      setDevice(null);
    }
  }, [selectedDeviceId, loadDeviceData]);

  const captureAtPosition = useCallback(async (position) => {
    const res = await axios.post(
      `/api/devices/${selectedDeviceId}/preview-route-coordinate`,
      { rotation: position.rotation, tilt: position.tilt, zoom: 1 },
      { timeout: 120000 }
    );
    return res.data.image;
  }, [selectedDeviceId]);

  const startScan = async () => {
    if (!selectedDeviceId || plannedPositions.length === 0) return;

    abortRef.current = false;
    setScanning(true);
    setScanComplete(false);
    setSaved(false);
    setScanError(null);
    setCapturedFrames([]);
    setCurrentIndex(0);
    setStitchResults({ opencv: null, grid: null, hugin: null, cylindrical: null });

    const frames = [];

    try {
      for (let i = 0; i < plannedPositions.length; i++) {
        if (abortRef.current) break;
        const pos = plannedPositions[i];
        setCurrentIndex(i);
        const image = await captureAtPosition(pos);
        frames.push({ order: i, rotation: pos.rotation, tilt: pos.tilt, image });
        setCapturedFrames([...frames]);
      }

      if (!abortRef.current) {
        setScanComplete(true);
        toast.success(`Scan abgeschlossen: ${frames.length} Bilder`);
      } else {
        toast.info('Scan abgebrochen');
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Scan fehlgeschlagen';
      setScanError(msg);
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    if (capturedFrames.length === 0) return;
    setSaving(true);
    try {
      const res = await axios.post(`/api/devices/${selectedDeviceId}/panorama-scan/save`, {
        frames: capturedFrames
      });
      toast.success(res.data.message || 'Gespeichert');
      setSaved(true);
      setSavedFrameCount(capturedFrames.length);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const handleStitch = async (method) => {
    if (!canStitch) return;
    setStitchingMethod(method);
    if (HUGIN_ASYNC_METHODS.includes(method)) {
      const label = STITCH_METHODS.find((m) => m.id === method)?.label || method;
      setHuginProgress({ progress: 0, step_label: `${label}…` });
    }
    try {
      const payload = { method };
      if (hasSessionFrames) {
        payload.frames = capturedFrames;
      }

      if (HUGIN_ASYNC_METHODS.includes(method)) {
        const startRes = await axios.post(
          `/api/devices/${selectedDeviceId}/panorama-scan/stitch`,
          { ...payload, async: true },
          { timeout: 120000 }
        );
        if (!startRes.data.async || !startRes.data.job_id) {
          throw new Error('Hugin-Job konnte nicht gestartet werden');
        }

        const jobId = startRes.data.job_id;
        let result = null;
        while (true) {
          const statusRes = await axios.get(
            `/api/devices/${selectedDeviceId}/panorama-scan/stitch/hugin/job/${jobId}`,
            { timeout: 30000 }
          );
          const job = statusRes.data;
          setHuginProgress({
            progress: job.progress || 0,
            step: job.step,
            step_label: job.step_label || 'Hugin läuft…',
            message: job.message
          });

          if (job.status === 'done' && job.result) {
            result = job.result;
            break;
          }
          if (job.status === 'error') {
            const err = new Error(job.error || 'Stitching fehlgeschlagen');
            err.response = { data: { error: job.error, error_code: job.error_code } };
            throw err;
          }
          await sleep(1500);
        }

        setStitchResults(prev => ({
          ...prev,
          [method]: {
            panorama_url: result.panorama_url,
            panorama_size: result.panorama_size,
            frames: result.frames,
            statistics: result.statistics,
            grid_info: result.grid_info,
            hugin_pto: result.hugin_pto || null,
            persisted: false
          }
        }));
        const label = STITCH_METHODS.find((m) => m.id === method)?.label || method;
        toast.success(`Stitching (${label}) erfolgreich`);
      } else {
        const res = await axios.post(
          `/api/devices/${selectedDeviceId}/panorama-scan/stitch`,
          payload,
          { timeout: 180000 }
        );
        setStitchResults(prev => ({
          ...prev,
          [method]: {
            panorama_url: res.data.panorama_url,
            panorama_size: res.data.panorama_size,
            frames: res.data.frames,
            statistics: res.data.statistics,
            grid_info: res.data.grid_info,
            hugin_pto: res.data.hugin_pto || null,
            persisted: false
          }
        }));
        toast.success(`Stitching (${method}) erfolgreich`);
      }
    } catch (err) {
      const data = err.response?.data;
      const errorCode = data?.error_code || data?.detail?.error_code;
      if (errorCode === 'HUGIN_NOT_INSTALLED') {
        toast.error('Hugin ist nicht installiert (macOS: brew install --cask hugin, Linux: apt install hugin-tools)');
      } else {
        const msg = data?.error || err.message || 'Stitching fehlgeschlagen';
        toast.error(msg);
      }
    } finally {
      setStitchingMethod(null);
      setHuginProgress(null);
    }
  };

  const handleDownloadResult = (method) => {
    const result = stitchResults[method];
    if (!result?.panorama_url) return;
    const deviceName = (device?.name || 'panorama')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'panorama';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `panorama_${deviceName}_${method}_${stamp}.jpg`;
    const link = document.createElement('a');
    link.href = result.panorama_url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveResult = async (method) => {
    const result = stitchResults[method];
    if (!result) return;
    setSavingResultMethod(method);
    try {
      const panoramaUrl = await compressPanoramaForSave(result.panorama_url);
      const wasCompressed = panoramaUrl !== result.panorama_url;
      const panoramaSize = wasCompressed
        ? await loadImageElement(panoramaUrl).then((img) => ({
          width: img.naturalWidth,
          height: img.naturalHeight
        }))
        : result.panorama_size;

      await axios.post(`/api/devices/${selectedDeviceId}/panorama-scan/result/save`, {
        method,
        panorama_url: panoramaUrl,
        panorama_size: panoramaSize,
        frames: result.frames,
        statistics: result.statistics,
        grid_info: result.grid_info,
        hugin_pto: result.hugin_pto || null
      });
      setStitchResults(prev => ({
        ...prev,
        [method]: { ...prev[method], persisted: true }
      }));
      toast.success(
        wasCompressed
          ? `Panorama (${method}) gespeichert (JPEG komprimiert)`
          : `Panorama (${method}) gespeichert`
      );
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Speichern fehlgeschlagen');
    } finally {
      setSavingResultMethod(null);
    }
  };

  if (loadingDevices) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <PanoramaIcon /> Panorama-Scan
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Raster-Scan, dann mit OpenCV oder Grid stitchen. Beide Varianten speichern Transformationsmatrizen für Pixel-Mapping.
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Gerät</InputLabel>
              <Select
                value={selectedDeviceId}
                label="Gerät"
                onChange={(e) => setSelectedDeviceId(e.target.value)}
              >
                {devices.map((d) => (
                  <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField fullWidth label="Min Rotation" type="number" value={minRot}
              onChange={(e) => setMinRot(e.target.value)} disabled={scanning} />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField fullWidth label="Max Rotation" type="number" value={maxRot}
              onChange={(e) => setMaxRot(e.target.value)} disabled={scanning} />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField fullWidth label="Min Tilt" type="number" value={minTilt}
              onChange={(e) => setMinTilt(e.target.value)} disabled={scanning} />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField fullWidth label="Max Tilt" type="number" value={maxTilt}
              onChange={(e) => setMaxTilt(e.target.value)} disabled={scanning} />
          </Grid>
        </Grid>

        {device && (
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip label={`FoV: ${fovInfo.fov}°`} size="small" />
            <Chip label={`Schritt Rot: ${fovInfo.stepRot.toFixed(1)}°`} size="small" />
            <Chip label={`Schritt Tilt: ${fovInfo.stepTilt.toFixed(1)}°`} size="small" />
            <Chip label={`${plannedPositions.length} Positionen`} size="small" color="primary" />
            {savedFrameCount > 0 && (
              <Chip label={`${savedFrameCount} in DB`} size="small" color="success" />
            )}
          </Box>
        )}

        <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<StartIcon />} onClick={startScan}
            disabled={!selectedDeviceId || scanning || plannedPositions.length === 0}>
            Start
          </Button>
          {scanning && (
            <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={() => { abortRef.current = true; }}>
              Abbrechen
            </Button>
          )}
          {scanComplete && capturedFrames.length > 0 && (
            <Button variant="contained" color="success" startIcon={<SaveIcon />} onClick={handleSave}
              disabled={saving || saved}>
              {saved ? 'Gespeichert' : saving ? 'Speichern…' : `${capturedFrames.length} Bilder speichern`}
            </Button>
          )}
        </Box>

        {scanning && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate"
              value={plannedPositions.length > 0 ? (currentIndex / plannedPositions.length) * 100 : 0} />
            <Typography variant="caption" color="text.secondary">
              Position {currentIndex + 1} / {plannedPositions.length}
            </Typography>
          </Box>
        )}
        {scanError && <Alert severity="error" sx={{ mt: 2 }}>{scanError}</Alert>}
      </Paper>

      {canStitch && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Stitching</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {hasSessionFrames ? `${capturedFrames.length} Bilder (Session)` : `${savedFrameCount} gespeicherte Bilder`} — alle Methoden testen:
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {STITCH_METHODS.map(({ id, label }) => (
              <Button
                key={id}
                variant="outlined"
                startIcon={stitchingMethod === id ? <CircularProgress size={18} /> : <StitchIcon />}
                onClick={() => handleStitch(id)}
                disabled={!!stitchingMethod}
              >
                {label}
              </Button>
            ))}
          </Box>
          {huginProgress && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress variant="determinate" value={huginProgress.progress || 0} />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {huginProgress.step_label}
                {huginProgress.progress > 0 ? ` (${huginProgress.progress}%)` : ''}
              </Typography>
              {huginProgress.message && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, fontFamily: 'monospace' }}>
                  {huginProgress.message}
                </Typography>
              )}
            </Box>
          )}
        </Paper>
      )}

      {STITCH_METHODS.some(({ id }) => stitchResults[id]) && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={viewMode}
                onChange={(_, value) => { if (value) setViewMode(value); }}
              >
                <ToggleButton value="image">
                  <ImageIcon sx={{ mr: 0.75, fontSize: 18 }} />
                  Bild
                </ToggleButton>
                <ToggleButton value="3d">
                  <ThreeDIcon sx={{ mr: 0.75, fontSize: 18 }} />
                  3D
                </ToggleButton>
              </ToggleButtonGroup>
              {viewMode === 'image' && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                  <FormControlLabel
                    control={<Switch size="small" checked={showBorders} onChange={(e) => setShowBorders(e.target.checked)} />}
                    label="Bildgrenzen"
                  />
                  <FormControlLabel
                    control={<Switch size="small" checked={showCameraGrid} onChange={(e) => setShowCameraGrid(e.target.checked)} />}
                    label="Kamera-Zellenraster"
                  />
                  <FormControlLabel
                    control={<Switch size="small" checked={showGraticule} onChange={(e) => setShowGraticule(e.target.checked)} />}
                    label="Gradnetz (10°)"
                  />
                </Box>
              )}
            </Box>
          </Paper>
          <Grid container spacing={3} sx={{ mb: 3 }}>
          {STITCH_METHODS.map(({ id, label }) => {
            const result = stitchResults[id];
            if (!result) return null;
            const supports3d = result.grid_info?.projection !== 'hugin_cylindrical';
            return (
              <Grid item xs={12} key={id}>
                <Paper sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">{label}</Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {result.persisted && <Chip label="gespeichert" size="small" color="success" />}
                      {result.statistics && (
                        <Chip label={`${result.statistics.total_used} Bilder`} size="small" />
                      )}
                    </Box>
                  </Box>
                  {viewMode === '3d' && supports3d ? (
                    <PanoramaGlobe
                      panoramaUrl={result.panorama_url}
                      frames={result.frames}
                      gridInfo={result.grid_info}
                      fov={fovInfo.fov}
                    />
                  ) : (
                    <>
                      {viewMode === '3d' && !supports3d && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          3D-Ansicht nicht verfügbar für zylindrische Projektion.
                        </Typography>
                      )}
                      <PanoramaPreview
                        panoramaUrl={result.panorama_url}
                        frames={result.frames}
                        gridInfo={result.grid_info}
                        fov={fovInfo.fov}
                        showBorders={showBorders}
                        showCameraGrid={showCameraGrid}
                        showGraticule={showGraticule}
                      />
                    </>
                  )}
                  {result.grid_info && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                      {result.grid_info.projection === 'hugin_equirectangular'
                        ? `Hugin Equirectangular${result.grid_info.position_optimized ? ', cpfind optimiert' : ''}, Mapping via pano_trafo${result.hugin_pto ? ', .pto gespeichert' : ''}`
                        : result.grid_info.projection === 'hugin_cylindrical'
                        ? `Hugin Zylindrisch${result.grid_info.position_optimized ? ', cpfind optimiert' : ''}, Mapping via pano_trafo${result.hugin_pto ? ', .pto gespeichert' : ''}`
                        : result.grid_info.projection === 'spherical_equirectangular'
                        ? `Sphärisch, FoV ${result.grid_info.fov}°`
                        : `Grid: H-FoV ${result.grid_info.horizontal_fov?.toFixed(1)}° / V-FoV ${result.grid_info.vertical_fov?.toFixed(1)}°`}
                    </Typography>
                  )}
                  <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<SaveIcon />}
                      onClick={() => handleSaveResult(id)}
                      disabled={result.persisted || savingResultMethod === id}
                    >
                      {result.persisted ? 'Gespeichert' : savingResultMethod === id ? 'Speichern…' : 'Panorama speichern'}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={() => handleDownloadResult(id)}
                    >
                      Als JPG herunterladen
                    </Button>
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
        </>
      )}

      {capturedFrames.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>
            Aufgenommene Bilder ({capturedFrames.length})
          </Typography>
          <Grid container spacing={2}>
            {capturedFrames.map((frame) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={frame.order}>
                <Card>
                  <CardMedia component="img" image={frame.image}
                    alt={`Rot ${frame.rotation}, Tilt ${frame.tilt}`}
                    sx={{ width: '100%', height: 'auto' }} />
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="body2">
                      #{frame.order + 1} — Rot {frame.rotation}°, Tilt {frame.tilt}°
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Box>
  );
};

export default PanoramaScan;
