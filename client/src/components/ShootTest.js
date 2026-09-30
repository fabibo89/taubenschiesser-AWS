import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Chip,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Radio,
  RadioGroup,
  FormLabel,
  Alert,
  CircularProgress,
  LinearProgress,
  Paper,
  IconButton,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Stack
} from '@mui/material';
import {
  GpsFixed as CrosshairIcon,
  PlayArrow as ShootIcon,
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
  ArrowBack as ArrowLeftIcon,
  ArrowForward as ArrowRightIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { hasActiveLaserZone, normalizeLaserZone } from '../utils/laserZone';

const POS_COLORS = [
  '#1976d2', '#ed6c02', '#2e7d32', '#9c27b0',
  '#d32f2f', '#00838f', '#f9a825', '#5d4037',
  '#c2185b', '#455a64'
];

function posColor(wp) {
  const n = Number(wp);
  if (!Number.isFinite(n) || n < 1) return '#757575';
  return POS_COLORS[(n - 1) % POS_COLORS.length];
}

function residualMag(r) {
  const rx = Number(r?.residualPx?.x);
  const ry = Number(r?.residualPx?.y);
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
  return Math.hypot(rx, ry);
}

/** Map full-frame normalized polygon points into the digital-zoom crop view. */
function mapPolygonToZoomedView(points, zoomFactor = 1) {
  const zoom = Math.max(1, Number(zoomFactor) || 1);
  if (!Array.isArray(points) || points.length < 3) return [];
  if (zoom <= 1.001) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  const inset = (1 - 1 / zoom) / 2;
  return points.map((p) => ({
    x: (Number(p.x) - inset) * zoom,
    y: (Number(p.y) - inset) * zoom
  }));
}

function ZoneOverlay({ laserZone, zoomFactor, showLaser, showAudio, audioEnabled }) {
  const zone = normalizeLaserZone(laserZone);
  const laserActive = showLaser && hasActiveLaserZone(zone);
  const mapped = laserActive ? mapPolygonToZoomedView(zone.points, zoomFactor) : [];
  const polygonAttr = mapped.length
    ? mapped.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')
    : '';

  if (!laserActive && !(showAudio && audioEnabled)) return null;

  return (
    <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
      {laserActive && polygonAttr && (
        <Box
          component="svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <polygon
            points={polygonAttr}
            fill="rgba(76, 175, 80, 0.18)"
            stroke="rgba(76, 175, 80, 0.95)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </Box>
      )}
      {showAudio && audioEnabled && (
        <Chip
          size="small"
          label="Audio-Zone an"
          color="primary"
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            bgcolor: 'rgba(25, 118, 210, 0.85)',
            color: '#fff'
          }}
        />
      )}
      {laserActive && (
        <Chip
          size="small"
          label="Laser-Zone"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'rgba(76, 175, 80, 0.9)',
            color: '#fff'
          }}
        />
      )}
    </Box>
  );
}

function CrosshairOverlay({
  centerX = 50,
  centerY = 50,
  color = 'rgba(255, 0, 0, 0.9)',
  zIndex = 1
}) {
  const line = color;
  const gap = 40; // half of 80px circle — lines stop outside the circle
  const cx = `${centerX}%`;
  const cy = `${centerY}%`;

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex
      }}
    >
      {/* Horizontal mid lines (outside circle) */}
      <Box
        sx={{
          position: 'absolute',
          top: cy,
          left: 0,
          width: `calc(${cx} - ${gap}px)`,
          height: 2,
          bgcolor: line,
          transform: 'translateY(-50%)'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: cy,
          left: `calc(${cx} + ${gap}px)`,
          right: 0,
          height: 2,
          bgcolor: line,
          transform: 'translateY(-50%)'
        }}
      />
      {/* Vertical mid lines (outside circle) */}
      <Box
        sx={{
          position: 'absolute',
          left: cx,
          top: 0,
          height: `calc(${cy} - ${gap}px)`,
          width: 2,
          bgcolor: line,
          transform: 'translateX(-50%)'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: cx,
          top: `calc(${cy} + ${gap}px)`,
          bottom: 0,
          width: 2,
          bgcolor: line,
          transform: 'translateX(-50%)'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: cy,
          left: cx,
          transform: 'translate(-50%, -50%)',
          width: 80,
          height: 80,
          borderRadius: '50%',
          border: `2px solid ${line}`,
          boxSizing: 'border-box'
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: 2,
            bgcolor: line,
            transform: 'translateY(-50%) rotate(45deg)'
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: 2,
            bgcolor: line,
            transform: 'translateY(-50%) rotate(-45deg)'
          }}
        />
      </Box>
    </Box>
  );
}

/** Map a click on an object-fit:contain image to normalized 0–1 image coords. */
function clickToNormalized(event, containerEl, naturalW, naturalH) {
  if (!containerEl || !(naturalW > 0) || !(naturalH > 0)) return null;
  const rect = containerEl.getBoundingClientRect();
  const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
  const dw = naturalW * scale;
  const dh = naturalH * scale;
  const offsetX = (rect.width - dw) / 2;
  const offsetY = (rect.height - dh) / 2;
  const x = event.clientX - rect.left - offsetX;
  const y = event.clientY - rect.top - offsetY;
  if (x < 0 || y < 0 || x > dw || y > dh) return null;
  return {
    normX: x / dw,
    normY: y / dh,
    displayX: offsetX + x,
    displayY: offsetY + y
  };
}

/** Position children in the object-fit:contain letterbox of a square/rect container. */
function ContainFitLayer({ imgW, imgH, children }) {
  const w = Number(imgW) || 0;
  const h = Number(imgH) || 0;
  if (!(w > 0 && h > 0)) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {children}
      </Box>
    );
  }
  const widthPct = Math.min(100, 100 * (w / h));
  const heightPct = Math.min(100, 100 * (h / w));
  const leftPct = (100 - widthPct) / 2;
  const topPct = (100 - heightPct) / 2;
  return (
    <Box
      sx={{
        position: 'absolute',
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        pointerEvents: 'none'
      }}
    >
      {children}
    </Box>
  );
}

/** Resolve target-bird rect in image pixel space (for frame + aim crosshair). */
function resolveTargetBirdRect(targetBird, imageInfo, useZoomed) {
  if (!targetBird || !imageInfo) return null;

  let imgW;
  let imgH;
  let left;
  let top;
  let width;
  let height;

  if (useZoomed) {
    imgW = imageInfo.zoomed_size?.width || imageInfo.original_size?.width || 0;
    imgH = imageInfo.zoomed_size?.height || imageInfo.original_size?.height || 0;
    if (!imgW || !imgH) return null;

    if (targetBird.position) {
      const { center_x, center_y, width: bw, height: bh } = targetBird.position;
      left = (center_x || 0) - (bw || 0) / 2;
      top = (center_y || 0) - (bh || 0) / 2;
      width = bw || 0;
      height = bh || 0;
    } else if (targetBird.bbox) {
      ({ x: left, y: top, width, height } = targetBird.bbox);
    } else {
      return null;
    }
  } else {
    imgW = imageInfo.original_size?.width || 0;
    imgH = imageInfo.original_size?.height || 0;
    if (!imgW || !imgH || !targetBird.bbox) return null;

    let { x, y, width: bw, height: bh } = targetBird.bbox;
    // BBox is relative to the zoom crop when a zoomed frame exists
    if (imageInfo.zoomed_size?.width && imageInfo.zoomed_size?.height) {
      const zw = imageInfo.zoomed_size.width;
      const zh = imageInfo.zoomed_size.height;
      x += (imgW - zw) / 2;
      y += (imgH - zh) / 2;
    }
    left = x;
    top = y;
    width = bw;
    height = bh;
  }

  if (!(width > 0 && height > 0 && imgW > 0 && imgH > 0)) return null;
  return { imgW, imgH, left, top, width, height };
}

/** Frame the shoot-target bird on the detection preview (zoomed or original). */
function TargetBirdFrame({ targetBird, imageInfo, useZoomed }) {
  const rect = resolveTargetBirdRect(targetBird, imageInfo, useZoomed);
  if (!rect) return null;
  const { imgW, imgH, left, top, width, height } = rect;

  return (
    <Box
      sx={{
        position: 'absolute',
        left: `${(left / imgW) * 100}%`,
        top: `${(top / imgH) * 100}%`,
        width: `${(width / imgW) * 100}%`,
        height: `${(height / imgH) * 100}%`,
        border: '3px solid #00e676',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
        zIndex: 3
      }}
    />
  );
}

/** Compact crosshair centered on the target bird (Aim-Ziel). */
function TargetBirdCrosshair({ targetBird, imageInfo, useZoomed }) {
  const rect = resolveTargetBirdRect(targetBird, imageInfo, useZoomed);
  if (!rect) return null;
  const { imgW, imgH, left, top, width, height } = rect;
  const cx = ((left + width / 2) / imgW) * 100;
  const cy = ((top + height / 2) / imgH) * 100;

  return <CrosshairOverlay centerX={cx} centerY={cy} zIndex={4} />;
}

/** FOV from scan→final pose and bbox offset in the detection image. */
function computeFovFromSample({ offsetPx, scanPose, finalPose, imageSize, zoomFactor }) {
  const zoom = Math.max(0.1, Number(zoomFactor) || 1);
  const w = Number(imageSize?.width) || 0;
  const h = Number(imageSize?.height) || 0;
  if (!w || !h || !offsetPx || !scanPose || !finalPose) {
    return { fovH: null, fovV: null, dRot: 0, dTilt: 0 };
  }
  const dRot = Number(finalPose.rotation) - Number(scanPose.rotation);
  const dTilt = Number(finalPose.tilt) - Number(scanPose.tilt);
  let fovH = null;
  let fovV = null;
  if (Math.abs(offsetPx.x) >= 8) {
    fovH = (dRot * w / offsetPx.x) * zoom;
  }
  if (Math.abs(offsetPx.y) >= 8) {
    fovV = (-dTilt * h / offsetPx.y) * zoom;
  }
  return { fovH, fovV, dRot, dTilt };
}

function medianFinite(values, min = 5, max = 170) {
  const a = (values || [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= min && n <= max)
    .sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** ok-Messungen ohne manuell ungültige — für Median / Kalibrier-Ergebnis. */
function validBatchRows(items) {
  return (items || []).filter((r) => r.status === 'ok' && !r.excluded);
}

function medianFovFromBatchRows(rows) {
  const valid = validBatchRows(rows);
  const hVals = valid.map((r) => r.fovH);
  const vVals = valid.map((r) => r.fovV);
  const h = medianFinite(hVals);
  const v = medianFinite(vVals);
  // Square camera: one FOV = median over all H and V axis samples
  const fov = medianFinite([...hVals, ...vVals])
    ?? (h != null && v != null ? (h + v) / 2 : (h ?? v ?? null));
  return { count: valid.length, h, v, fov };
}

function buildReportFovFromBatchRows(rows, soll) {
  const { h: medH, v: medV, fov } = medianFovFromBatchRows(rows);
  if (fov == null && medH == null && medV == null) return null;
  const istVal = fov ?? medH ?? medV;
  const sollH = soll?.h != null ? Number(soll.h) : (soll?.horizontal != null ? Number(soll.horizontal) : null);
  const sollV = soll?.v != null ? Number(soll.v) : (soll?.vertical != null ? Number(soll.vertical) : null);
  const sollCombined = (sollH != null && sollV != null)
    ? (sollH + sollV) / 2
    : (sollH ?? sollV ?? null);
  return {
    soll: { h: sollH, v: sollV, combined: sollCombined },
    ist: { h: istVal, v: istVal },
    delta: {
      h: istVal != null && sollCombined != null ? istVal - sollCombined : null,
      v: istVal != null && sollCombined != null ? istVal - sollCombined : null
    },
    fov: istVal,
    axis: { h: medH, v: medV }
  };
}

/** Unclamped stats for batch overview (mean / median / std / min / max). */
function statsFinite(values) {
  const a = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (!a.length) {
    return {
      n: 0, mean: null, median: null, std: null, min: null, max: null
    };
  }
  const sorted = [...a].sort((x, y) => x - y);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const m = Math.floor(n / 2);
  const median = n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    n,
    mean,
    median,
    std: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1]
  };
}

function fmtNum(n, digits = 1, signed = false) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const body = Math.abs(v).toFixed(digits);
  if (!signed) return body;
  if (v > 0) return `+${body}`;
  if (v < 0) return `−${body}`;
  return body;
}

function fmtPoseShort(pose) {
  if (!pose || pose.rotation == null || pose.tilt == null) return '—';
  return `R ${Math.round(Number(pose.rotation))}° / T ${Math.round(Number(pose.tilt))}°`;
}

/** ESP aim for the bird (as computed for shoot) — fallback autoAim from calibration. */
function espAimPoseFromItem(item) {
  const bird = item?.targetBird;
  if (bird?.esp_rot != null && bird?.esp_tilt != null) {
    return { rotation: Number(bird.esp_rot), tilt: Number(bird.esp_tilt) };
  }
  if (item?.autoAimPose?.rotation != null && item?.autoAimPose?.tilt != null) {
    return item.autoAimPose;
  }
  const ist = item?.report?.pos?.ist;
  if (ist?.rotation != null && ist?.tilt != null) return ist;
  return null;
}

function determinedPoseFromItem(item) {
  if (item?.finalPose?.rotation != null && item?.finalPose?.tilt != null) {
    return item.finalPose;
  }
  const soll = item?.report?.pos?.soll;
  if (soll?.rotation != null && soll?.tilt != null) return soll;
  return null;
}

function scanPoseFromItem(item) {
  if (item?.scanPose?.rotation != null && item?.scanPose?.tilt != null) {
    return item.scanPose;
  }
  return null;
}

function poseDelta(a, b) {
  if (!a || !b || a.rotation == null || a.tilt == null || b.rotation == null || b.tilt == null) {
    return null;
  }
  return {
    rotation: Number(b.rotation) - Number(a.rotation),
    tilt: Number(b.tilt) - Number(a.tilt)
  };
}

function fmtPoseDelta(d) {
  if (!d) return '—';
  return `Δ R ${fmtNum(d.rotation, 0, true)}° / T ${fmtNum(d.tilt, 0, true)}°`;
}

/** Route/detection image may be data-URL, http(s) URL, or raw base64. */
function toImageSrc(img) {
  if (!img || typeof img !== 'string') return null;
  if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://') || img.startsWith('blob:')) {
    return img;
  }
  return `data:image/jpeg;base64,${img}`;
}

function reportFromPriorCal(cal) {
  if (!cal) return null;
  const soll = {
    h: cal.fovSollH != null ? Number(cal.fovSollH) : null,
    v: cal.fovSollV != null ? Number(cal.fovSollV) : null
  };
  const ist = {
    h: cal.fovH != null ? Number(cal.fovH) : null,
    v: cal.fovV != null ? Number(cal.fovV) : null
  };
  const fov = {
    soll,
    ist,
    delta: {
      h: ist.h != null && soll.h != null ? ist.h - soll.h : null,
      v: ist.v != null && soll.v != null ? ist.v - soll.v : null
    }
  };
  const pos = (cal.finalPose && cal.autoAimPose)
    ? {
      soll: { rotation: cal.finalPose.rotation, tilt: cal.finalPose.tilt },
      ist: { rotation: cal.autoAimPose.rotation, tilt: cal.autoAimPose.tilt },
      delta: {
        rotation: Number(cal.finalPose.rotation) - Number(cal.autoAimPose.rotation),
        tilt: Number(cal.finalPose.tilt) - Number(cal.autoAimPose.tilt)
      }
    }
    : null;
  return { pos, fov };
}

function batchRowFromCandidate(c, index) {
  const cal = c.fovCalibration;
  const hasCal = !!(cal && (cal.at || cal.fovH != null || cal.fovV != null));
  const targetBird = c.targetBird || c.target_bird || null;
  const imageInfo = c.imageInfo || c.image_info || null;
  const useZoomed = !!(imageInfo?.zoomed_size?.width && imageInfo?.zoomed_size?.height);
  if (hasCal) {
    let dRot = cal.dRot;
    let dTilt = cal.dTilt;
    if ((dRot == null || dTilt == null) && cal.scanPose && cal.finalPose) {
      dRot = Number(cal.finalPose.rotation) - Number(cal.scanPose.rotation);
      dTilt = Number(cal.finalPose.tilt) - Number(cal.scanPose.tilt);
    }
    return {
      key: `prior-${c.detectionId}-${index}`,
      detectionId: c.detectionId,
      index: index + 1,
      status: 'ok',
      source: 'prior',
      excluded: !!cal.excluded,
      originalUrl: null,
      liveUrl: null,
      targetBird,
      imageInfo,
      useZoomed,
      fovH: cal.fovH,
      fovV: cal.fovV,
      dRot,
      dTilt,
      offsetPx: cal.offsetPx || null,
      converged: !!cal.converged,
      report: reportFromPriorCal(cal),
      residualPx: cal.residualPx || null,
      calibratedAt: cal.at || null,
      finalPose: cal.finalPose || null,
      autoAimPose: cal.autoAimPose || null,
      scanPose: cal.scanPose || null,
      zoomFactor: cal.zoomFactor || c.zoom_factor || null,
      cameraPosition: c.camera_position || null,
      waypointNumber: cal.waypointNumber ?? c.waypointNumber ?? null,
      manual: !!cal.manual || cal.method === 'manual',
      calSource: cal.source || (cal.manual || cal.method === 'manual' ? 'manual' : 'auto'),
      error: null
    };
  }
  return {
    key: `cand-${c.detectionId}-${index}`,
    detectionId: c.detectionId,
    index: index + 1,
    status: 'pending',
    source: 'candidate',
    excluded: false,
    originalUrl: null,
    liveUrl: null,
    targetBird,
    imageInfo,
    useZoomed,
    fovH: null,
    fovV: null,
    dRot: null,
    dTilt: null,
    offsetPx: null,
    converged: null,
    report: null,
    residualPx: null,
    calibratedAt: null,
    finalPose: null,
    autoAimPose: null,
    scanPose: null,
    zoomFactor: c.zoom_factor || null,
    cameraPosition: c.camera_position || null,
    waypointNumber: c.waypointNumber ?? null,
    manual: false,
    calSource: null,
    error: null
  };
}

/** Image pane without letterbox: frame hugs image. Original = bird box; calibrated = center crosshair. */
function BatchImagePane({
  src,
  alt,
  emptyLabel = '—',
  loading = false,
  mode = 'original',
  targetBird = null,
  imageInfo = null,
  useZoomed = false,
  large = false,
  showBirdCrosshair = false
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: large ? '100%' : 120,
        maxWidth: '100%',
        bgcolor: '#111',
        borderRadius: large ? 1 : 0.5,
        overflow: 'hidden',
        lineHeight: 0
      }}
    >
      {src && src !== 'loading' ? (
        <>
          <Box
            component="img"
            src={src}
            alt={alt}
            sx={{
              width: '100%',
              height: 'auto',
              display: 'block',
              verticalAlign: 'top'
            }}
          />
          <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {mode === 'original' ? (
              <>
                <TargetBirdFrame
                  targetBird={targetBird}
                  imageInfo={imageInfo}
                  useZoomed={useZoomed}
                />
                {showBirdCrosshair && (
                  <TargetBirdCrosshair
                    targetBird={targetBird}
                    imageInfo={imageInfo}
                    useZoomed={useZoomed}
                  />
                )}
              </>
            ) : (
              <CrosshairOverlay />
            )}
          </Box>
        </>
      ) : loading || src === 'loading' ? (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          sx={{ width: '100%', aspectRatio: '4 / 3', bgcolor: '#000' }}
        >
          <CircularProgress size={large ? 28 : 18} sx={{ color: '#fff' }} />
        </Box>
      ) : (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          sx={{ width: '100%', aspectRatio: '4 / 3', bgcolor: '#000' }}
        >
          <Typography variant="caption" color="grey.500">{emptyLabel}</Typography>
        </Box>
      )}
    </Box>
  );
}

function StatsRow({ label, stats, digits = 1, unit = '°' }) {
  if (!stats || !stats.n) {
    return (
      <Typography variant="body2" color="text.secondary">
        {label}: —
      </Typography>
    );
  }
  return (
    <Box sx={{ mb: 0.75 }}>
      <Typography variant="body2" fontWeight={600}>
        {label}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
          n={stats.n}
        </Typography>
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        Median {fmtNum(stats.median, digits)}{unit}
        {' · '}
        Mittel {fmtNum(stats.mean, digits)}{unit}
        {' · '}
        σ {fmtNum(stats.std, digits)}{unit}
        {' · '}
        [{fmtNum(stats.min, digits)} … {fmtNum(stats.max, digits)}]{unit}
      </Typography>
    </Box>
  );
}

/** Ordinary least-squares y = slope·x + intercept for scatter points {x,y}. */
function linearFit(points) {
  const pts = (points || []).filter(
    (p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
  );
  const n = pts.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const p of pts) {
    const x = Number(p.x);
    const y = Number(p.y);
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of pts) {
    const y = Number(p.y);
    const pred = slope * Number(p.x) + intercept;
    ssTot += (y - meanY) ** 2;
    ssRes += (y - pred) ** 2;
  }
  const r2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : 1;
  if (!(xMax > xMin)) {
    xMin -= 1;
    xMax += 1;
  }
  return {
    slope,
    intercept,
    r2,
    n,
    segment: [
      { x: xMin, y: slope * xMin + intercept },
      { x: xMax, y: slope * xMax + intercept }
    ]
  };
}

function fmtLinearFitLabel(name, fit) {
  if (!fit) return `${name}: —`;
  const sign = fit.intercept >= 0 ? '+' : '−';
  const absInt = Math.abs(fit.intercept);
  return `${name}: y = ${fmtNum(fit.slope, 4, true)}·x ${sign} ${fmtNum(absInt, 2)}  (R²=${fmtNum(fit.r2, 2)}, n=${fit.n})`;
}

/** Post-batch: measurement overview + deviation vs bird pixel position */
function BatchAnalysisPanel({ items, fromPrior = false, global = false }) {
  const okAll = (items || []).filter((r) => r.status === 'ok');
  const ok = okAll.filter((r) => !r.excluded);
  const excludedCount = okAll.length - ok.length;

  const dataOffsetMax = (() => {
    let maxO = 0;
    ok.forEach((r) => {
      const ox = Number(r.offsetPx?.x);
      const oy = Number(r.offsetPx?.y);
      if (Number.isFinite(ox)) maxO = Math.max(maxO, Math.abs(ox));
      if (Number.isFinite(oy)) maxO = Math.max(maxO, Math.abs(oy));
    });
    return Math.max(50, Math.ceil(maxO / 25) * 25 || 400);
  })();
  const dataDeltaAbsMax = (() => {
    let maxD = 0;
    ok.forEach((r) => {
      const dH = Number(r.report?.fov?.delta?.h);
      const dV = Number(r.report?.fov?.delta?.v);
      if (Number.isFinite(dH)) maxD = Math.max(maxD, Math.abs(dH));
      if (Number.isFinite(dV)) maxD = Math.max(maxD, Math.abs(dV));
    });
    return Math.max(5, Math.ceil(maxD / 5) * 5 || 40);
  })();

  const [offsetRange, setOffsetRange] = useState([0, 400]);
  const [deltaAbsMax, setDeltaAbsMax] = useState(40);

  useEffect(() => {
    setOffsetRange([0, dataOffsetMax]);
    setDeltaAbsMax(dataDeltaAbsMax);
  }, [dataOffsetMax, dataDeltaAbsMax, global, ok.length]);

  if (!okAll.length) return null;
  if (!ok.length) {
    return (
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            {global ? 'Auswertung alle Positionen' : 'Auswertung'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Alle {okAll.length} ok-Messungen sind manuell als ungültig markiert — Statistik ausgeblendet.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const fovHStats = statsFinite(ok.map((r) => r.fovH));
  const fovVStats = statsFinite(ok.map((r) => r.fovV));
  const dRotStats = statsFinite(ok.map((r) => r.dRot));
  const dTiltStats = statsFinite(ok.map((r) => r.dTilt));
  const deltaHStats = statsFinite(ok.map((r) => r.report?.fov?.delta?.h));
  const deltaVStats = statsFinite(ok.map((r) => r.report?.fov?.delta?.v));
  const residualMagStats = statsFinite(ok.map((r) => residualMag(r)));

  // Speichern-Wahrheit: alle gültigen Samples (unabhängig vom Fokus-Regler)
  const fovTruth = medianFovFromBatchRows(ok);
  const empFovAll = fovTruth.fov;
  const sollMedAll = medianFinite(
    ok.flatMap((r) => [r.report?.fov?.soll?.h, r.report?.fov?.soll?.v, r.report?.fov?.soll?.combined]),
    1,
    179
  );
  const medDeltaAll = (empFovAll != null && sollMedAll != null)
    ? empFovAll - sollMedAll
    : null;

  const posSampleById = new Map();
  {
    const ctr = {};
    ok.forEach((r) => {
      const key = String(r.waypointNumber ?? '_');
      ctr[key] = (ctr[key] || 0) + 1;
      if (r.detectionId != null) posSampleById.set(String(r.detectionId), ctr[key]);
    });
  }

  const rotVsOffsetX = ok
    .filter((r) => Number.isFinite(Number(r.offsetPx?.x)) && Number.isFinite(Number(r.dRot)))
    .map((r) => ({
      x: Number(r.offsetPx.x),
      y: Number(r.dRot),
      index: r.index,
      pos: r.waypointNumber ?? '?',
      posSample: posSampleById.get(String(r.detectionId)) ?? r.index,
      detectionId: r.detectionId ? String(r.detectionId) : null
    }));
  const tiltVsOffsetY = ok
    .filter((r) => Number.isFinite(Number(r.offsetPx?.y)) && Number.isFinite(Number(r.dTilt)))
    .map((r) => ({
      x: Number(r.offsetPx.y),
      y: Number(r.dTilt),
      index: r.index,
      pos: r.waypointNumber ?? '?',
      posSample: posSampleById.get(String(r.detectionId)) ?? r.index,
      detectionId: r.detectionId ? String(r.detectionId) : null
    }));
  const rotFit = linearFit(rotVsOffsetX);
  const tiltFit = linearFit(tiltVsOffsetY);
  // ΔFOV H vs |offsetX|, ΔFOV V vs |offsetY| (axis-specific reliability)
  const deltaHPoints = ok
    .map((r) => {
      const ox = Number(r.offsetPx?.x);
      const dH = Number(r.report?.fov?.delta?.h);
      if (!Number.isFinite(ox) || !Number.isFinite(dH)) return null;
      return {
        x: Math.abs(ox),
        y: dH,
        index: r.index,
        pos: r.waypointNumber ?? '?',
        posSample: posSampleById.get(String(r.detectionId)) ?? r.index,
        detectionId: r.detectionId ? String(r.detectionId) : null,
        axis: 'H'
      };
    })
    .filter(Boolean);
  const deltaVPoints = ok
    .map((r) => {
      const oy = Number(r.offsetPx?.y);
      const dV = Number(r.report?.fov?.delta?.v);
      if (!Number.isFinite(oy) || !Number.isFinite(dV)) return null;
      return {
        x: Math.abs(oy),
        y: dV,
        index: r.index,
        pos: r.waypointNumber ?? '?',
        posSample: posSampleById.get(String(r.detectionId)) ?? r.index,
        detectionId: r.detectionId ? String(r.detectionId) : null,
        axis: 'V'
      };
    })
    .filter(Boolean);

  const oMin = Math.min(offsetRange[0], offsetRange[1]);
  const oMax = Math.max(offsetRange[0], offsetRange[1]);
  const dAbs = Math.max(1, Number(deltaAbsMax) || dataDeltaAbsMax);
  const fovPointInFocus = (p) => (
    Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= oMin && p.x <= oMax
    && Math.abs(p.y) <= dAbs
  );
  const deltaHFocus = deltaHPoints.filter(fovPointInFocus);
  const deltaVFocus = deltaVPoints.filter(fovPointInFocus);
  const fovFocusCount = deltaHFocus.length + deltaVFocus.length;
  const fovTotalCount = deltaHPoints.length + deltaVPoints.length;
  const fovFocusActive = oMin > 0 || oMax < dataOffsetMax || dAbs < dataDeltaAbsMax;

  // Empfohlen: H nur wenn |x| im Fokus, V nur wenn |y| im Fokus → Median H∪V
  const focusH = [];
  const focusV = [];
  const focusSoll = [];
  ok.forEach((r) => {
    const ox = Number(r.offsetPx?.x);
    const oy = Number(r.offsetPx?.y);
    const dH = Number(r.report?.fov?.delta?.h);
    const dV = Number(r.report?.fov?.delta?.v);
    const h = Number(r.fovH);
    const v = Number(r.fovV);
    if (Number.isFinite(ox) && Number.isFinite(h)
      && Math.abs(ox) >= oMin && Math.abs(ox) <= oMax
      && (!Number.isFinite(dH) || Math.abs(dH) <= dAbs)) {
      focusH.push(h);
      const sh = Number(r.report?.fov?.soll?.h ?? r.report?.fov?.soll?.combined);
      if (Number.isFinite(sh)) focusSoll.push(sh);
    }
    if (Number.isFinite(oy) && Number.isFinite(v)
      && Math.abs(oy) >= oMin && Math.abs(oy) <= oMax
      && (!Number.isFinite(dV) || Math.abs(dV) <= dAbs)) {
      focusV.push(v);
      const sv = Number(r.report?.fov?.soll?.v ?? r.report?.fov?.soll?.combined);
      if (Number.isFinite(sv)) focusSoll.push(sv);
    }
  });
  const empFov = medianFinite([...focusH, ...focusV]);
  const empFovH = medianFinite(focusH);
  const empFovV = medianFinite(focusV);
  const sollMed = medianFinite(focusSoll, 1, 179);
  const medDeltaCombined = (empFov != null && sollMed != null) ? empFov - sollMed : null;
  const medDeltaH = statsFinite(deltaHFocus.map((p) => p.y)).median;
  const medDeltaV = statsFinite(deltaVFocus.map((p) => p.y)).median;

  const fovYDomain = (() => {
    const ys = [...deltaHFocus, ...deltaVFocus].map((p) => p.y).filter(Number.isFinite);
    if (!ys.length) return [-dAbs, dAbs];
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
    if (medDeltaCombined != null && Math.abs(medDeltaCombined) <= dAbs) {
      yMin = Math.min(yMin, medDeltaCombined);
      yMax = Math.max(yMax, medDeltaCombined);
    }
    if (medDeltaH != null && Math.abs(medDeltaH) <= dAbs) {
      yMin = Math.min(yMin, medDeltaH);
      yMax = Math.max(yMax, medDeltaH);
    }
    if (medDeltaV != null && Math.abs(medDeltaV) <= dAbs) {
      yMin = Math.min(yMin, medDeltaV);
      yMax = Math.max(yMax, medDeltaV);
    }
    const span = Math.max(yMax - yMin, 1);
    const pad = Math.max(span * 0.08, 0.5);
    yMin -= pad;
    yMax += pad;
    yMin = Math.max(yMin, -dAbs);
    yMax = Math.min(yMax, dAbs);
    if (!(yMax > yMin)) return [-dAbs, dAbs];
    return [Number(yMin.toFixed(2)), Number(yMax.toFixed(2))];
  })();

  const posKeys = [...new Set(ok.map((r) => r.waypointNumber).filter((n) => n != null))]
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const perPosRows = posKeys.map((wp) => {
    const rows = ok.filter((r) => Number(r.waypointNumber) === wp);
    const { fov: fovMed, h: fovHMed, v: fovVMed } = medianFovFromBatchRows(rows);
    const dH = statsFinite(rows.map((r) => r.report?.fov?.delta?.h));
    const dV = statsFinite(rows.map((r) => r.report?.fov?.delta?.v));
    const res = statsFinite(rows.map((r) => residualMag(r)));
    const soll = medianFinite(
      rows.flatMap((r) => [r.report?.fov?.soll?.h, r.report?.fov?.soll?.v, r.report?.fov?.soll?.combined]),
      1,
      179
    );
    const deltaMed = (fovMed != null && soll != null) ? fovMed - soll : null;
    return {
      pos: wp,
      label: `Pos ${wp}`,
      n: rows.length,
      fov: fovMed,
      fovH: fovHMed,
      fovV: fovVMed,
      delta: deltaMed,
      deltaH: dH.median,
      deltaV: dV.median,
      residual: res.median
    };
  });

  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    if (!p) return null;
    return (
      <Paper sx={{ p: 1 }} elevation={2}>
        <Typography variant="caption" display="block">
          {global
            ? (p.pos != null && p.pos !== '?'
              ? `Pos ${p.pos} · #${p.posSample ?? p.index}`
              : `#${p.index}`)
            : `#${p.index}`}
        </Typography>
        <Typography variant="caption" display="block">
          {p.axis
            ? `${p.axis} · |off|=${fmtNum(p.x, 1)} · Δ=${fmtNum(p.y, 2, true)}°`
            : `x=${fmtNum(p.x, 1, true)} · y=${fmtNum(p.y, 2, true)}`}
        </Typography>
      </Paper>
    );
  };

  const barTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    if (!p) return null;
    return (
      <Paper sx={{ p: 1 }} elevation={2}>
        <Typography variant="caption" display="block" fontWeight={700}>{p.label}</Typography>
        <Typography variant="caption" display="block">n={p.n}</Typography>
        {p.fov != null && (
          <Typography variant="caption" display="block">FOV {fmtNum(p.fov, 1)}°</Typography>
        )}
        {p.delta != null && (
          <Typography variant="caption" display="block">Δ {fmtNum(p.delta, 1, true)}°</Typography>
        )}
        {p.residual != null && (
          <Typography variant="caption" display="block">Res {fmtNum(p.residual, 1)} px</Typography>
        )}
      </Paper>
    );
  };

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>
          {global ? 'Auswertung alle Positionen' : 'Auswertung'}
          {' '}
          ({ok.length} Messungen
          {global && posKeys.length ? ` · ${posKeys.length} Pos` : ''}
          {excludedCount > 0 ? ` · ${excludedCount} manuell ungültig` : ''})
          {fromPrior ? ' — gespeicherte Kalibrierungen' : ''}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {global
            ? 'Gesamtstatistik über alle Wegpunkte. Punkte farbig nach Pos. Gerät-FOV wird hier nicht geschrieben.'
            : 'Statistik über ok-Samples (automatisch gültig; ohne manuell ungültige) + Abweichung vs. Taubenposition.'}
          {fromPrior && !global ? ' Geladen aus Detection.fovCalibration; Gerät-FOV wird nicht geschrieben.' : ''}
        </Typography>

        {global && posKeys.length > 0 && (
          <Box display="flex" flexWrap="wrap" gap={0.75} sx={{ mb: 2 }}>
            {posKeys.map((wp) => (
              <Chip
                key={wp}
                size="small"
                label={`Pos ${wp}`}
                sx={{ bgcolor: posColor(wp), color: '#fff' }}
              />
            ))}
          </Box>
        )}

        <Grid container spacing={2}>
          <Grid item xs={12} md={5}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Statistik</Typography>
              <Box sx={{ mb: 1 }}>
                <Typography variant="body2" fontWeight={700}>
                  FOV empfohlen
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    n={fovTruth.count} · Speichern (alle Samples)
                  </Typography>
                </Typography>
                <Typography variant="body1" fontWeight={800}>
                  {empFovAll != null ? `${fmtNum(empFovAll, 1)}°` : '—'}
                  {sollMedAll != null && medDeltaAll != null
                    ? `  (Soll ${fmtNum(sollMedAll, 1)}° · Δ ${fmtNum(medDeltaAll, 1, true)}°)`
                    : ''}
                </Typography>
              </Box>
              <StatsRow label="FOV H (Diagnose)" stats={fovHStats} />
              <StatsRow label="FOV V (Diagnose)" stats={fovVStats} />
              <StatsRow label="ΔFOV H (Ist−Soll)" stats={deltaHStats} />
              <StatsRow label="ΔFOV V (Ist−Soll)" stats={deltaVStats} />
              <StatsRow label="Pose ΔR" stats={dRotStats} />
              <StatsRow label="Pose ΔT" stats={dTiltStats} />
              <StatsRow label="Residual |px|" stats={residualMagStats} unit=" px" />
            </Paper>

            {global && perPosRows.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5, mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Pro Position</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '48px repeat(4, minmax(44px, 1fr))',
                    gap: '4px 8px',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12,
                    alignItems: 'center'
                  }}
                >
                  <Typography variant="caption" fontWeight={700} color="text.secondary">Pos</Typography>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" textAlign="right">n</Typography>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" textAlign="right">FOV</Typography>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" textAlign="right">Δ</Typography>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" textAlign="right">Res</Typography>
                  {perPosRows.map((row) => (
                    <React.Fragment key={row.pos}>
                      <Typography variant="caption" fontWeight={700} sx={{ color: posColor(row.pos) }}>
                        {row.pos}
                      </Typography>
                      <Typography variant="caption" textAlign="right">{row.n}</Typography>
                      <Typography variant="caption" textAlign="right">{fmtNum(row.fov, 1)}°</Typography>
                      <Typography variant="caption" textAlign="right">{fmtNum(row.delta, 1, true)}°</Typography>
                      <Typography variant="caption" textAlign="right">
                        {row.residual != null ? `${fmtNum(row.residual, 0)} px` : '—'}
                      </Typography>
                    </React.Fragment>
                  ))}
                </Box>
              </Paper>
            )}
          </Grid>

          <Grid item xs={12} md={7}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Pose-Korrektur vs. Offset (px vom Zentrum)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Ideal: näherungsweise linear. ΔR ~ Offset-X, ΔT ~ Offset-Y. Gestrichelte Linien = OLS-Fit.
              {global ? ' Farbe = Position · Kreis = ΔR · Dreieck = ΔT.' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
              {fmtLinearFitLabel('ΔR', rotFit)}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {fmtLinearFitLabel('ΔT', tiltFit)}
            </Typography>
            <Box sx={{ width: '100%', height: 220, mb: 2 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" name="Offset" unit=" px" tick={{ fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" name="Δ" unit="°" tick={{ fontSize: 11 }} />
                  <Tooltip content={tip} cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  <ReferenceLine x={0} stroke="#999" />
                  <ReferenceLine y={0} stroke="#999" />
                  {rotFit && (
                    <ReferenceLine
                      segment={rotFit.segment}
                      stroke="#1976d2"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      ifOverflow="extendDomain"
                    />
                  )}
                  {tiltFit && (
                    <ReferenceLine
                      segment={tiltFit.segment}
                      stroke="#ed6c02"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Scatter name="ΔR vs Offset-X" data={rotVsOffsetX} fill="#1976d2">
                    {global && rotVsOffsetX.map((p, i) => (
                      <Cell key={`rot-${i}`} fill={posColor(p.pos)} />
                    ))}
                  </Scatter>
                  <Scatter
                    name="ΔT vs Offset-Y"
                    data={tiltVsOffsetY}
                    fill="#ed6c02"
                    shape={global ? 'triangle' : 'circle'}
                  >
                    {global && tiltVsOffsetY.map((p, i) => (
                      <Cell key={`tilt-${i}`} fill={posColor(p.pos)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              FOV-Abweichung vs. Achsen-Offset
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              ΔFOV H über |Offset-X|, ΔFOV V über |Offset-Y| (wie die FOV-Formel). Gestrichelte Linien = Achsen-Median-Δ.
              Schwarze Linie = empfohlene Korrektur (ein FOV, quadratisch, Median H∪V im Fokus).
              {global ? ' Farbe = Position · Kreis = ΔFOV H · Dreieck = ΔFOV V.' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Empfohlen FOV
              {fovFocusActive ? ' (Fokus)' : ''}
              :&nbsp;
              {empFov != null ? `${fmtNum(empFov, 1)}°` : '—'}
              {sollMed != null && medDeltaCombined != null
                ? ` (Soll ${fmtNum(sollMed, 1)}° + Δ ${fmtNum(medDeltaCombined, 1, true)}°)`
                : ''}
              {empFovH != null || empFovV != null
                ? ` · Diagnose H ${fmtNum(empFovH, 1)}° (n=${focusH.length}) / V ${fmtNum(empFovV, 1)}° (n=${focusV.length})`
                : ''}
              {` · n=${focusH.length + focusV.length}`}
            </Typography>

            <Paper variant="outlined" sx={{ p: 1.25, mb: 1.5 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" fontWeight={700}>
                  Fokus Bereich
                  {fovFocusActive ? ` · ${fovFocusCount}/${fovTotalCount} Punkte` : ` · alle ${fovTotalCount} Punkte`}
                </Typography>
                {fovFocusActive && (
                  <Button
                    size="small"
                    onClick={() => {
                      setOffsetRange([0, dataOffsetMax]);
                      setDeltaAbsMax(dataDeltaAbsMax);
                    }}
                  >
                    Zurücksetzen
                  </Button>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block">
                |Offset| {oMin}–{oMax} px · H nutzt |x|, V nutzt |y|
              </Typography>
              <Slider
                size="small"
                value={[oMin, oMax]}
                min={0}
                max={dataOffsetMax}
                step={5}
                valueLabelDisplay="auto"
                onChange={(_e, v) => setOffsetRange(v)}
                sx={{ mt: 0.5, mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary" display="block">
                |ΔFOV| max {dAbs}°
              </Typography>
              <Slider
                size="small"
                value={dAbs}
                min={1}
                max={dataDeltaAbsMax}
                step={1}
                valueLabelDisplay="auto"
                onChange={(_e, v) => setDeltaAbsMax(v)}
                sx={{ mt: 0.5 }}
              />
            </Paper>

            <Box sx={{ width: '100%', height: 220, mb: global ? 2 : 0 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="|Offset|"
                    unit=" px"
                    tick={{ fontSize: 11 }}
                    domain={[oMin, oMax]}
                    allowDataOverflow
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="ΔFOV"
                    unit="°"
                    tick={{ fontSize: 11 }}
                    domain={fovYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={tip} cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  <ReferenceLine y={0} stroke="#999" />
                  {medDeltaCombined != null && Math.abs(medDeltaCombined) <= dAbs && (
                    <ReferenceLine
                      y={medDeltaCombined}
                      stroke="#212121"
                      strokeWidth={2}
                      strokeDasharray="2 2"
                      label={{
                        value: `Empf. Δ ${fmtNum(medDeltaCombined, 1, true)}°`,
                        fill: '#212121',
                        fontSize: 11,
                        position: 'insideTopLeft'
                      }}
                    />
                  )}
                  {medDeltaH != null && Math.abs(medDeltaH) <= dAbs && (
                    <ReferenceLine
                      y={medDeltaH}
                      stroke="#2e7d32"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      label={{
                        value: `Med ΔH ${fmtNum(medDeltaH, 1, true)}°`,
                        fill: '#2e7d32',
                        fontSize: 10,
                        position: 'insideTopRight'
                      }}
                    />
                  )}
                  {medDeltaV != null && Math.abs(medDeltaV) <= dAbs && (
                    <ReferenceLine
                      y={medDeltaV}
                      stroke="#9c27b0"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      label={{
                        value: `Med ΔV ${fmtNum(medDeltaV, 1, true)}°`,
                        fill: '#9c27b0',
                        fontSize: 10,
                        position: 'insideBottomRight'
                      }}
                    />
                  )}
                  <Scatter name="ΔFOV H (|x|)" data={deltaHFocus} fill="#2e7d32">
                    {global && deltaHFocus.map((p, i) => (
                      <Cell key={`dh-${i}`} fill={posColor(p.pos)} />
                    ))}
                  </Scatter>
                  <Scatter
                    name="ΔFOV V (|y|)"
                    data={deltaVFocus}
                    fill="#9c27b0"
                    shape={global ? 'triangle' : 'circle'}
                  >
                    {global && deltaVFocus.map((p, i) => (
                      <Cell key={`dv-${i}`} fill={posColor(p.pos)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </Box>

            {global && perPosRows.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Median-FOV und Residual pro Position
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  Balken = Median FOV (H∪V). Strichelte Referenz = Gesamt-Median
                  {empFovAll != null ? ` (${fmtNum(empFovAll, 1)}°)` : ''}.
                </Typography>
                <Box sx={{ width: '100%', height: 200, mb: 2 }}>
                  <ResponsiveContainer>
                    <BarChart data={perPosRows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        yAxisId="fov"
                        tick={{ fontSize: 11 }}
                        unit="°"
                        domain={['auto', 'auto']}
                      />
                      <YAxis
                        yAxisId="res"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                        unit=" px"
                        domain={[0, 'auto']}
                      />
                      <Tooltip content={barTip} />
                      <Legend />
                      {empFovAll != null && (
                        <ReferenceLine yAxisId="fov" y={empFovAll} stroke="#212121" strokeDasharray="4 4" />
                      )}
                      <Bar yAxisId="fov" dataKey="fov" name="Median FOV" radius={[4, 4, 0, 0]}>
                        {perPosRows.map((row) => (
                          <Cell key={`fov-${row.pos}`} fill={posColor(row.pos)} />
                        ))}
                      </Bar>
                      <Bar yAxisId="res" dataKey="residual" name="Median Residual" fill="#90a4ae" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>

                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  ΔFOV (Ist−Soll) pro Position
                </Typography>
                <Box sx={{ width: '100%', height: 180 }}>
                  <ResponsiveContainer>
                    <BarChart data={perPosRows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} unit="°" />
                      <Tooltip content={barTip} />
                      <Legend />
                      <ReferenceLine y={0} stroke="#999" />
                      {medDeltaAll != null && (
                        <ReferenceLine y={medDeltaAll} stroke="#212121" strokeDasharray="4 4" />
                      )}
                      <Bar dataKey="delta" name="Median ΔFOV" radius={[4, 4, 0, 0]}>
                        {perPosRows.map((row) => (
                          <Cell key={`d-${row.pos}`} fill={posColor(row.pos)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </>
            )}
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

function ResultTable({ title, hint, columns, rows }) {
  const colCount = columns?.length || 1;
  const valueMin = colCount >= 3 ? 56 : 48;
  const labelW = 40;
  return (
    <Box sx={{ flex: `1 1 ${colCount >= 3 ? 220 : 140}px`, minWidth: colCount >= 3 ? 200 : 140 }}>
      <Typography variant="caption" fontWeight={800} display="block" sx={{ mb: 0.25 }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75, lineHeight: 1.2 }}>
          {hint}
        </Typography>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `${labelW}px repeat(${colCount}, minmax(${valueMin}px, 1fr))`,
          gap: '4px 8px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          alignItems: 'center',
          width: '100%'
        }}
      >
        <Box />
        {columns.map((c) => (
          <Typography
            key={c}
            variant="caption"
            fontWeight={700}
            color="text.secondary"
            textAlign="right"
            sx={{ whiteSpace: 'nowrap' }}
          >
            {c}
          </Typography>
        ))}
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            <Typography variant="caption" fontWeight={row.emphasis ? 800 : 600} sx={{ whiteSpace: 'nowrap' }}>
              {row.label}
            </Typography>
            {row.values.map((v, i) => (
              <Typography
                key={`${row.label}-${i}`}
                variant="caption"
                fontWeight={row.emphasis ? 800 : 600}
                textAlign="right"
                sx={{
                  color: row.emphasis ? 'text.primary' : 'text.secondary',
                  whiteSpace: 'nowrap'
                }}
              >
                {v}
              </Typography>
            ))}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

/** Batch detail popup: images, validity, pos correction, replay */
function BatchDetailDialog({
  item,
  open,
  onClose,
  onToggleExcluded,
  onReplayCalibrated,
  replaying,
  routeThumbs = [],
  currentWaypoint = '',
  onAssignWaypoint,
  assigningPos = false,
  // Manual calibrate (Steuerkreuz) — wired from parent ShootTest
  manualMode = false,
  manualBusy = false,
  onStartManual,
  onCancelManual,
  onSaveManual,
  liveUrl = null,
  livePose = null,
  liveBoxRef = null,
  liveNaturalRef = null,
  onLiveAimClick,
  aiming = false,
  nudging = false,
  nudgeDegrees = 1,
  onNudgeDegreesChange,
  onNudge,
  onJumpPose,
  calibrateMeta = null,
  aimMarker = null
}) {
  if (!item) return null;
  const canToggle = item.status === 'ok' && !manualMode;
  const canReplay = item.status === 'ok'
    && !item.liveUrl
    && item.finalPose?.rotation != null
    && typeof onReplayCalibrated === 'function';
  const canAssign = !!item.detectionId
    && typeof onAssignWaypoint === 'function'
    && routeThumbs.length > 0
    && !manualMode;
  const canManual = !!item.detectionId
    && !!item.targetBird
    && typeof onStartManual === 'function'
    && !manualMode
    && !assigningPos
    && !replaying
    && !manualBusy;

  const jumpAutoAim = calibrateMeta?.autoAimPose?.rotation != null
    && calibrateMeta?.autoAimPose?.tilt != null
    ? calibrateMeta.autoAimPose
    : null;
  const jumpFinal = (item.finalPose?.rotation != null && item.finalPose?.tilt != null)
    ? item.finalPose
    : (calibrateMeta?.resumedManual && calibrateMeta?.aimPose?.rotation != null
      ? calibrateMeta.aimPose
      : null);

  const currentPosNum = (() => {
    if (!routeThumbs.length) return currentWaypoint ? Number(currentWaypoint) : null;
    const pos = item.cameraPosition;
    if (pos?.rotation != null && pos?.tilt != null) {
      const match = routeThumbs.find(
        (t) => Math.round(Number(t.rotation)) === Math.round(Number(pos.rotation))
          && Math.round(Number(t.tilt)) === Math.round(Number(pos.tilt))
      );
      if (match) return match.number;
    }
    return currentWaypoint ? Number(currentWaypoint) : null;
  })();

  const handleDialogClose = () => {
    if (manualBusy) return;
    if (manualMode && onCancelManual) onCancelManual();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleDialogClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <span>{manualMode ? `Manuell kalibrieren — #${item.index}` : `Messung #${item.index}`}</span>
        {item.status === 'ok' && !manualMode && (
          <Chip
            size="small"
            color={item.converged === false ? 'warning' : 'success'}
            label={item.converged === false ? 'ok (nicht konvergiert)' : 'ok'}
          />
        )}
        {item.status === 'fail' && !manualMode && (
          <Chip size="small" color="error" label="fehler" />
        )}
        {item.manual && !manualMode && (
          <Chip size="small" color="secondary" variant="outlined" label="manuell" />
        )}
        {item.calSource === 'post_shot' && !manualMode && (
          <Chip size="small" color="info" variant="outlined" label="nach Schuss" />
        )}
        {item.excluded && (
          <Chip size="small" color="default" label="manuell ungültig" />
        )}
        {currentPosNum != null && (
          <Chip size="small" color="primary" variant="outlined" label={`Pos ${currentPosNum}`} />
        )}
        {item.source === 'prior' && !manualMode && (
          <Chip size="small" variant="outlined" label="gespeicherte Messung" />
        )}
        {item.liveUrl && item.source === 'prior' && !manualMode && (
          <Chip size="small" variant="outlined" color="info" label="Kalibrierbild neu erzeugt" />
        )}
        {manualMode && (
          <Chip size="small" color="secondary" label="Steuerkreuz aktiv" />
        )}
      </DialogTitle>
      <DialogContent dividers>
        {manualMode ? (
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Alert severity="info">
                Links: Original mit Fadenkreuz auf der Taube. Rechts: Live-Bild (Mitte = Aim).
                Mit Steuerkreuz (oder Klick im Live-Bild) ausrichten, dann speichern.
              </Alert>
            </Grid>
            <Grid item xs={12} md={5}>
              <Typography variant="subtitle2" gutterBottom>
                Original (Ziel = Taube)
              </Typography>
              <BatchImagePane
                src={item.originalUrl}
                alt="Original"
                emptyLabel="kein Originalbild"
                mode="original"
                targetBird={item.targetBird}
                imageInfo={item.imageInfo}
                useZoomed={!!item.useZoomed}
                showBirdCrosshair
                large
              />
            </Grid>
            <Grid item xs={12} md={5}>
              <Typography variant="subtitle2" gutterBottom>
                Live-Bild <CrosshairIcon fontSize="inherit" sx={{ verticalAlign: 'middle' }} />
              </Typography>
              <Box
                ref={liveBoxRef}
                onClick={onLiveAimClick}
                sx={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '1',
                  bgcolor: '#000',
                  borderRadius: 1,
                  overflow: 'hidden',
                  cursor: livePose && !aiming && !nudging && !manualBusy ? 'crosshair' : 'default',
                  opacity: aiming || nudging || manualBusy ? 0.85 : 1
                }}
              >
                {liveUrl ? (
                  <Box
                    component="img"
                    src={liveUrl}
                    alt="Live"
                    onLoad={(e) => {
                      if (liveNaturalRef) {
                        liveNaturalRef.current = {
                          w: e.target.naturalWidth || 0,
                          h: e.target.naturalHeight || 0
                        };
                      }
                    }}
                    sx={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      pointerEvents: 'none',
                      display: 'block'
                    }}
                  />
                ) : (
                  <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                    <Typography variant="caption" color="grey.400">Live wird geladen…</Typography>
                  </Box>
                )}
                <CrosshairOverlay />
                {aimMarker && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: aimMarker.x,
                      top: aimMarker.y,
                      width: 14,
                      height: 14,
                      ml: '-7px',
                      mt: '-7px',
                      borderRadius: '50%',
                      border: '2px solid #ffeb3b',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
                      pointerEvents: 'none',
                      zIndex: 4
                    }}
                  />
                )}
                {(aiming || manualBusy) && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'rgba(0,0,0,0.25)',
                      zIndex: 5,
                      pointerEvents: 'none'
                    }}
                  >
                    <CircularProgress size={28} color="inherit" sx={{ color: '#fff' }} />
                  </Box>
                )}
              </Box>
              {livePose && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  Live-Pose R {livePose.rotation}° / T {livePose.tilt}°
                  {aiming ? ' — zielt…' : ''}
                  {nudging ? ' — bewegt…' : ''}
                </Typography>
              )}
            </Grid>
            <Grid item xs={12} md={2}>
              <Typography variant="subtitle2" gutterBottom align="center">
                Gerätesteuerung
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 0.5
                }}
              >
                <FormControl size="small" sx={{ minWidth: 88, mb: 0.5 }}>
                  <InputLabel id="batch-nudge-deg-label">Schritt</InputLabel>
                  <Select
                    labelId="batch-nudge-deg-label"
                    label="Schritt"
                    value={nudgeDegrees}
                    onChange={(e) => onNudgeDegreesChange?.(Number(e.target.value))}
                    disabled={aiming || nudging || manualBusy}
                  >
                    <MenuItem value={1}>1°</MenuItem>
                    <MenuItem value={5}>5°</MenuItem>
                    <MenuItem value={10}>10°</MenuItem>
                  </Select>
                </FormControl>
                <IconButton
                  size="small"
                  color="primary"
                  disabled={aiming || nudging || manualBusy}
                  onClick={() => onNudge?.('move_up')}
                  aria-label="Hoch"
                >
                  <ArrowUpIcon />
                </IconButton>
                <Box display="flex" gap={0.5} alignItems="center">
                  <IconButton
                    size="small"
                    color="primary"
                    disabled={aiming || nudging || manualBusy}
                    onClick={() => onNudge?.('rotate_left')}
                    aria-label="Links"
                  >
                    <ArrowLeftIcon />
                  </IconButton>
                  <Box sx={{ width: 36, height: 36 }} />
                  <IconButton
                    size="small"
                    color="primary"
                    disabled={aiming || nudging || manualBusy}
                    onClick={() => onNudge?.('rotate_right')}
                    aria-label="Rechts"
                  >
                    <ArrowRightIcon />
                  </IconButton>
                </Box>
                <IconButton
                  size="small"
                  color="primary"
                  disabled={aiming || nudging || manualBusy}
                  onClick={() => onNudge?.('move_down')}
                  aria-label="Runter"
                >
                  <ArrowDownIcon />
                </IconButton>
                <Box sx={{ mt: 1.5, width: '100%', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    fullWidth
                    disabled={!jumpAutoAim || aiming || nudging || manualBusy}
                    onClick={() => onJumpPose?.(jumpAutoAim, 'autoAim')}
                  >
                    Auto-Aim
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    fullWidth
                    disabled={!jumpFinal || aiming || nudging || manualBusy}
                    onClick={() => onJumpPose?.(jumpFinal, 'final')}
                  >
                    Final
                  </Button>
                </Box>
              </Box>
            </Grid>
          </Grid>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" gutterBottom>Original</Typography>
              <BatchImagePane
                src={item.originalUrl}
                alt="Original"
                emptyLabel="kein Originalbild"
                mode="original"
                targetBird={item.targetBird}
                imageInfo={item.imageInfo}
                useZoomed={!!item.useZoomed}
                showBirdCrosshair
                large
              />
              {(() => {
                const esp = espAimPoseFromItem(item);
                return (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                    An ESP (Taube): {fmtPoseShort(esp)}
                    {item.targetBird?.esp_rot != null ? '' : (esp ? ' · Auto-Aim' : '')}
                  </Typography>
                );
              })()}
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" gutterBottom>Kalibriert (Mitte = Aim)</Typography>
              <BatchImagePane
                src={item.liveUrl}
                alt="Kalibriert"
                emptyLabel={canReplay
                  ? 'nicht gespeichert — bei Bedarf neu erzeugen'
                  : (item.source === 'prior'
                    ? 'Kalibrierbild nur bei frischem Batch / Replay'
                    : 'kein Kalibrierbild')}
                mode="calibrated"
                loading={!!replaying}
                large
              />
              {(() => {
                const det = determinedPoseFromItem(item);
                return (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                    Ermittelt (Final): {fmtPoseShort(det)}
                  </Typography>
                );
              })()}
            </Grid>
            {(espAimPoseFromItem(item) || determinedPoseFromItem(item)) && (
              <Grid item xs={12}>
                <Typography
                  variant="body2"
                  align="center"
                  sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                >
                  {fmtPoseDelta(poseDelta(espAimPoseFromItem(item), determinedPoseFromItem(item)))}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    (Final − ESP)
                  </Typography>
                </Typography>
              </Grid>
            )}

            {canAssign && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Wegpunkt (Pos) korrigieren
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  Speichert die Kamera-Position der Detection auf den gewählten Routenpunkt (wie in Erkennungen).
                  Bei anderer Pos verschwindet der Eintrag aus dieser Batch-Liste.
                </Typography>
                <Box display="flex" gap={1} overflow="auto" pb={0.5}>
                  {routeThumbs.map((t) => {
                    const thumb = toImageSrc(t.image);
                    const selected = currentPosNum != null && Number(t.number) === Number(currentPosNum);
                    return (
                      <Paper
                        key={t.number}
                        elevation={selected ? 3 : 0}
                        variant={selected ? 'elevation' : 'outlined'}
                        onClick={() => {
                          if (assigningPos || selected) return;
                          onAssignWaypoint(item, t);
                        }}
                        sx={{
                          p: 0.75,
                          width: 96,
                          flexShrink: 0,
                          cursor: assigningPos || selected ? 'default' : 'pointer',
                          border: '2px solid',
                          borderColor: selected ? 'primary.main' : 'transparent',
                          opacity: assigningPos ? 0.6 : 1,
                          bgcolor: selected ? 'action.selected' : 'background.paper'
                        }}
                      >
                        <Box
                          sx={{
                            width: '100%',
                            height: 56,
                            bgcolor: '#000',
                            borderRadius: 0.5,
                            overflow: 'hidden',
                            mb: 0.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {thumb ? (
                            <Box
                              component="img"
                              src={thumb}
                              alt={`Pos ${t.number}`}
                              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Typography variant="caption" color="grey.500">kein Bild</Typography>
                          )}
                        </Box>
                        <Typography variant="caption" fontWeight={700} display="block">
                          Pos {t.number}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap>
                          R {t.rotation}° / T {t.tilt}°
                        </Typography>
                      </Paper>
                    );
                  })}
                </Box>
                {assigningPos && (
                  <Box display="flex" alignItems="center" gap={1} mt={1}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">speichere Pos…</Typography>
                  </Box>
                )}
              </Grid>
            )}

            <Grid item xs={12}>
              {item.status === 'ok' && (
                <Box>
                  <Typography variant="body2">
                    FOV Ist
                    {item.fovH != null ? ` H ${Number(item.fovH).toFixed(1)}°` : ' H —'}
                    {item.fovV != null ? ` / V ${Number(item.fovV).toFixed(1)}°` : ' / V —'}
                    {item.manual ? ' · manuell' : ''}
                    {item.calSource === 'post_shot' ? ' · nach Schuss' : ''}
                  </Typography>
                  {item.residualPx && (
                    <Typography variant="body2" color="text.secondary">
                      Residual {Number(item.residualPx.x).toFixed(1)} / {Number(item.residualPx.y).toFixed(1)} px
                    </Typography>
                  )}
                  {(item.dRot != null || item.dTilt != null) && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        Pose ΔR {item.dRot != null ? Number(item.dRot).toFixed(1) : '—'}°
                        {' / '}
                        ΔT {item.dTilt != null ? Number(item.dTilt).toFixed(1) : '—'}°
                        {' '}
                        <Typography component="span" variant="caption" color="text.secondary">
                          (Final − Wegpunkt)
                        </Typography>
                      </Typography>
                      {(scanPoseFromItem(item) || determinedPoseFromItem(item)) && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Wegpunkt {fmtPoseShort(scanPoseFromItem(item))}
                          {' → '}
                          Final {fmtPoseShort(determinedPoseFromItem(item))}
                          {item.offsetPx
                            ? ` · Offset ${fmtNum(item.offsetPx.x, 0, true)} / ${fmtNum(item.offsetPx.y, 0, true)} px`
                            : ''}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              )}
              {item.status === 'fail' && (
                <Typography variant="body2" color="error.main">
                  {item.error || 'fehlgeschlagen'}
                </Typography>
              )}
            </Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
        {manualMode ? (
          <>
            <Button
              onClick={onCancelManual}
              disabled={manualBusy}
            >
              Abbrechen
            </Button>
            {canReplay && (
              <Button
                variant="contained"
                color="secondary"
                disabled={!!replaying || assigningPos || manualBusy}
                startIcon={replaying ? <CircularProgress size={16} color="inherit" /> : null}
                onClick={() => onReplayCalibrated(item)}
              >
                {replaying ? 'Erzeuge…' : 'Kalibrierbild erzeugen'}
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              color="secondary"
              disabled={manualBusy || !livePose || aiming || nudging}
              startIcon={manualBusy ? <CircularProgress size={16} color="inherit" /> : null}
              onClick={onSaveManual}
            >
              {manualBusy ? 'Speichere…' : 'Ausrichtung speichern'}
            </Button>
          </>
        ) : (
          <>
            {canToggle && onToggleExcluded && (
              <Button
                variant={item.excluded ? 'contained' : 'outlined'}
                color={item.excluded ? 'success' : 'warning'}
                onClick={() => onToggleExcluded(item.key)}
                disabled={assigningPos}
              >
                {item.excluded ? 'Wieder gültig' : 'Als ungültig markieren'}
              </Button>
            )}
            {canManual && (
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => onStartManual(item)}
                disabled={assigningPos || replaying || manualBusy}
              >
                Manuell kalibrieren
              </Button>
            )}
            {canReplay && (
              <Button
                variant="contained"
                color="secondary"
                disabled={!!replaying || assigningPos || manualBusy}
                startIcon={replaying ? <CircularProgress size={16} color="inherit" /> : null}
                onClick={() => onReplayCalibrated(item)}
              >
                {replaying ? 'Erzeuge…' : 'Kalibrierbild erzeugen'}
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button onClick={handleDialogClose} disabled={assigningPos || replaying || manualBusy}>
              Schließen
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}


function BatchRunRow({ item, onOpen, onToggleExcluded }) {
  const clickable = item.status === 'ok' || item.status === 'fail';
  const canToggle = item.status === 'ok' && typeof onToggleExcluded === 'function';

  const statusColor = {
    pending: 'default',
    running: 'info',
    ok: item.converged === false ? 'warning' : 'success',
    fail: 'error'
  }[item.status] || 'default';
  const statusLabel = {
    pending: 'wartet',
    running: 'läuft…',
    ok: item.converged === false ? 'ok (nicht konvergiert)' : 'ok',
    fail: 'fehler'
  }[item.status] || item.status;

  return (
    <Paper
      variant="outlined"
      onClick={clickable && onOpen ? () => onOpen(item) : undefined}
      sx={{
        p: 1.25,
        mb: 1,
        cursor: clickable ? 'pointer' : 'default',
        borderWidth: item.status === 'ok' || item.status === 'fail' || item.status === 'running' ? 2 : 1,
        borderColor: item.excluded
          ? 'grey.500'
          : item.status === 'running'
            ? 'info.main'
            : item.status === 'fail'
              ? 'error.main'
              : item.status === 'ok' && item.converged === false
                ? 'warning.main'
                : item.status === 'ok'
                  ? 'success.main'
                  : 'divider',
        bgcolor: item.excluded
          ? 'action.hover'
          : item.status === 'running'
            ? 'rgba(2, 136, 209, 0.06)'
            : item.status === 'ok' && item.converged === false
              ? 'rgba(237, 108, 2, 0.06)'
              : item.status === 'ok'
                ? 'rgba(46, 125, 50, 0.05)'
                : item.status === 'fail'
                  ? 'rgba(211, 47, 47, 0.05)'
                  : 'transparent',
        opacity: item.excluded ? 0.72 : 1,
        '&:hover': clickable ? { boxShadow: 2 } : undefined
      }}
    >
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          #{item.index}
        </Typography>
        <Chip size="small" color={statusColor} label={statusLabel} />
        {item.excluded && (
          <Chip size="small" label="ungültig" />
        )}
        {item.manual && item.status === 'ok' && (
          <Chip size="small" color="secondary" variant="outlined" label="manuell" />
        )}
        {item.calSource === 'post_shot' && item.status === 'ok' && (
          <Chip size="small" color="info" variant="outlined" label="nach Schuss" />
        )}
        {item.source === 'prior' && (
          <Chip size="small" variant="outlined" label="gespeicherte Messung" />
        )}
        {item.source === 'batch' && item.status === 'ok' && (
          <Chip size="small" variant="outlined" color="secondary" label="dieser Batch" />
        )}
        {item.status === 'running' && <CircularProgress size={14} />}
        {canToggle && (
          <Button
            size="small"
            variant="outlined"
            color={item.excluded ? 'success' : 'warning'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExcluded(item.key);
            }}
            sx={{ ml: 'auto' }}
          >
            {item.excluded ? 'Gültig' : 'Ungültig'}
          </Button>
        )}
        {clickable && !canToggle && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            Klick: Großansicht
          </Typography>
        )}
      </Box>

      <Box display="flex" gap={1.5} flexWrap="wrap" alignItems="flex-start">
        <Box sx={{ width: 120 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            Original
          </Typography>
          <BatchImagePane
            src={item.originalUrl}
            alt="Original"
            loading={!item.originalUrl && item.status !== 'fail'}
            mode="original"
            targetBird={item.targetBird}
            imageInfo={item.imageInfo}
            useZoomed={!!item.useZoomed}
          />
        </Box>

        <Box sx={{ width: 120 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            Kalibriert
          </Typography>
          <BatchImagePane
            src={item.liveUrl}
            alt="Kalibriert"
            loading={item.status === 'running'}
            emptyLabel="—"
            mode="calibrated"
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            Ergebnis
          </Typography>
          {item.status === 'fail' && (
            <Typography variant="body2" color="error.main">
              {item.error || 'fehlgeschlagen'}
            </Typography>
          )}
          {item.status === 'pending' && (
            <Typography variant="body2" color="text.secondary">noch nicht gestartet</Typography>
          )}
          {item.status === 'running' && (
            <Typography variant="body2" color="text.secondary">Bildabgleich läuft…</Typography>
          )}
          {(item.status === 'ok') && (
            <>
              <Typography variant="body2">
                FOV Ist
                {item.fovH != null ? ` H ${Number(item.fovH).toFixed(1)}°` : ' H —'}
                {item.fovV != null ? ` / V ${Number(item.fovV).toFixed(1)}°` : ' / V —'}
              </Typography>
              {item.report?.fov?.soll && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Soll
                  {item.report.fov.soll.h != null ? ` H ${Number(item.report.fov.soll.h).toFixed(1)}°` : ''}
                  {item.report.fov.soll.v != null ? ` / V ${Number(item.report.fov.soll.v).toFixed(1)}°` : ''}
                  {item.report.fov.delta?.h != null
                    ? ` · ΔH ${Number(item.report.fov.delta.h).toFixed(1)}°`
                    : ''}
                  {item.report.fov.delta?.v != null
                    ? ` ΔV ${Number(item.report.fov.delta.v).toFixed(1)}°`
                    : ''}
                </Typography>
              )}
              {(item.dRot != null || item.dTilt != null) && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Pose ΔR {item.dRot != null ? Number(item.dRot).toFixed(1) : '—'}°
                  {' / '}
                  ΔT {item.dTilt != null ? Number(item.dTilt).toFixed(1) : '—'}°
                  {' · Final − Wegpunkt'}
                  {scanPoseFromItem(item)
                    ? ` (${fmtPoseShort(scanPoseFromItem(item))} → ${fmtPoseShort(determinedPoseFromItem(item))})`
                    : ''}
                </Typography>
              )}
              {item.residualPx && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Residual {Number(item.residualPx.x).toFixed(1)} / {Number(item.residualPx.y).toFixed(1)} px
                </Typography>
              )}
            </>
          )}
        </Box>
      </Box>
    </Paper>
  );
}

/** Compact Soll / Ist / Δ tables for pose + FOV */
function CalibrateResultBanner({ report, waypointNumber, converged, saved }) {
  if (!report?.pos || !report?.fov) return null;
  const { pos, fov } = report;
  const chips = [];
  if (waypointNumber != null) chips.push(`Pos ${waypointNumber}`);
  if (converged === true) chips.push('konvergiert');
  if (converged === false) chips.push('nicht konvergiert');
  if (saved) chips.push('FOV geschrieben');

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 1.5,
        p: 1.25,
        borderWidth: 2,
        borderColor: converged === false ? 'warning.main' : 'success.main',
        bgcolor: converged === false ? 'rgba(237, 108, 2, 0.06)' : 'rgba(46, 125, 50, 0.06)'
      }}
    >
      <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={800}>
          Kalibrier-Ergebnis
        </Typography>
        {chips.map((c) => (
          <Chip
            key={c}
            size="small"
            label={c}
            color={c === 'nicht konvergiert' ? 'warning' : c === 'FOV geschrieben' ? 'success' : 'default'}
            variant={c.startsWith('Pos') ? 'outlined' : 'filled'}
          />
        ))}
      </Box>

      <Box display="flex" gap={2.5} flexWrap="wrap">
        <ResultTable
          title="Pose (°)"
          hint="Soll = Bildabgleich · Ist = Auto-Aim"
          columns={['R', 'T']}
          rows={[
            {
              label: 'Soll',
              values: [fmtNum(pos.soll?.rotation, 0), fmtNum(pos.soll?.tilt, 0)]
            },
            {
              label: 'Ist',
              values: [fmtNum(pos.ist?.rotation, 0), fmtNum(pos.ist?.tilt, 0)]
            },
            {
              label: 'Δ',
              emphasis: true,
              values: [
                fmtNum(pos.delta?.rotation, 1, true),
                fmtNum(pos.delta?.tilt, 1, true)
              ]
            }
          ]}
        />
        <ResultTable
          title="FOV (°)"
          hint="FOV speichern · H/V Diagnose"
          columns={['FOV', 'H', 'V']}
          rows={[
            {
              label: 'Soll',
              values: [
                fmtNum(
                  fov.soll?.combined
                    ?? ((fov.soll?.h != null && fov.soll?.v != null)
                      ? (Number(fov.soll.h) + Number(fov.soll.v)) / 2
                      : (fov.soll?.h ?? fov.soll?.v ?? fov.soll?.horizontal ?? fov.soll?.vertical)),
                  1
                ),
                fmtNum(fov.soll?.h ?? fov.soll?.horizontal, 1),
                fmtNum(fov.soll?.v ?? fov.soll?.vertical, 1)
              ]
            },
            {
              label: 'Ist',
              values: [
                fmtNum(fov.fov ?? fov.ist?.h ?? fov.ist?.v ?? fov.ist?.fovH, 1),
                fmtNum(fov.axis?.h ?? fov.ist?.h ?? fov.ist?.fovH, 1),
                fmtNum(fov.axis?.v ?? fov.ist?.v ?? fov.ist?.fovV, 1)
              ]
            },
            {
              label: 'Δ',
              emphasis: true,
              values: [
                fmtNum(fov.delta?.h ?? fov.delta?.v, 1, true),
                fmtNum(
                  (fov.axis?.h ?? fov.ist?.h) != null && (fov.soll?.h ?? fov.soll?.horizontal) != null
                    ? Number(fov.axis?.h ?? fov.ist?.h) - Number(fov.soll?.h ?? fov.soll?.horizontal)
                    : null,
                  1,
                  true
                ),
                fmtNum(
                  (fov.axis?.v ?? fov.ist?.v) != null && (fov.soll?.v ?? fov.soll?.vertical) != null
                    ? Number(fov.axis?.v ?? fov.ist?.v) - Number(fov.soll?.v ?? fov.soll?.vertical)
                    : null,
                  1,
                  true
                )
              ]
            }
          ]}
        />
      </Box>
    </Paper>
  );
}

function DetectionThumb({ detection, selected, imageUrl, routeThumb, waypointNumber, onSelect, onNeedImage }) {
  useEffect(() => {
    if (detection?._id && imageUrl === undefined) onNeedImage(detection._id);
  }, [detection?._id, imageUrl, onNeedImage]);

  const pos = detection.camera_position;
  const posAngles = pos?.rotation != null && pos?.tilt != null
    ? `R ${pos.rotation}° / T ${pos.tilt}°`
    : 'ohne Position';
  const posLabel = waypointNumber != null
    ? `Pos ${waypointNumber} · ${posAngles}`
    : posAngles;

  return (
    <Paper
      elevation={selected ? 4 : 1}
      onClick={() => onSelect(detection)}
      sx={{
        p: 1,
        cursor: 'pointer',
        border: selected ? '2px solid' : '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        width: 140,
        flexShrink: 0
      }}
    >
      <Box
        sx={{
          width: 120,
          height: 120,
          bgcolor: '#000',
          borderRadius: 1,
          overflow: 'hidden',
          mb: 0.5,
          mx: 'auto'
        }}
      >
        {typeof imageUrl === 'string' && imageUrl ? (
          <Box component="img" src={imageUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <Typography variant="caption" color="grey.400">
              {imageUrl === null ? '—' : '…'}
            </Typography>
          </Box>
        )}
      </Box>
      <Typography variant="caption" display="block" noWrap title={posLabel}>
        {posLabel}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" noWrap>
        {detection.processedAt ? new Date(detection.processedAt).toLocaleString() : ''}
      </Typography>
      {routeThumb && (
        <Box
          component="img"
          src={toImageSrc(routeThumb)}
          alt="Wegpunkt"
          sx={{
            mt: 0.5,
            width: '100%',
            height: 48,
            objectFit: 'cover',
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: 'divider'
          }}
        />
      )}
    </Paper>
  );
}

const ShootTest = () => {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [device, setDevice] = useState(null);
  const [detections, setDetections] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState(null);
  const [zoneStatus, setZoneStatus] = useState(null);
  const [imageById, setImageById] = useState({});
  const imageByIdRef = useRef({});
  imageByIdRef.current = imageById;

  const [useWater, setUseWater] = useState(true);
  const [useLaser, setUseLaser] = useState(true);
  const [useAudio, setUseAudio] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [mode, setMode] = useState('return'); // return | stay
  const [executing, setExecuting] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [liveUrl, setLiveUrl] = useState(null);
  const [detectionLargeUrl, setDetectionLargeUrl] = useState(null);
  const [detectionUsesZoomed, setDetectionUsesZoomed] = useState(false);
  const [livePose, setLivePose] = useState(null); // motor pose { rotation, tilt }
  const [aiming, setAiming] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [nudgeDegrees, setNudgeDegrees] = useState(1); // 1 | 5 | 10
  const [aimMarker, setAimMarker] = useState(null); // { x, y } display px in live box
  const [calibrating, setCalibrating] = useState(false);
  const [calibrateBusy, setCalibrateBusy] = useState(false);
  const [calibrateMeta, setCalibrateMeta] = useState(null);
  const [calibrateSamples, setCalibrateSamples] = useState([]);
  const [calibrateRefineCount, setCalibrateRefineCount] = useState(0);
  const [calibrateReport, setCalibrateReport] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null); // { current, total, ok, fail, lastId }
  const [mainTab, setMainTab] = useState('single'); // 'single' | 'batch'
  const [batchWaypoint, setBatchWaypoint] = useState(''); // 1-based string
  const [batchRun, setBatchRun] = useState([]); // [{ detectionId, status, originalUrl, liveUrl, ... }]
  const [routeThumbs, setRouteThumbs] = useState([]); // [{ number, rotation, tilt, image }]
  const [batchDetailItem, setBatchDetailItem] = useState(null);
  const [batchReplayBusy, setBatchReplayBusy] = useState(false);
  const [batchAssignBusy, setBatchAssignBusy] = useState(false);
  const [batchStartOpen, setBatchStartOpen] = useState(false);
  const [batchStartCount, setBatchStartCount] = useState(10);
  const [batchStartPriorMode, setBatchStartPriorMode] = useState('overwrite'); // overwrite|skip|append
  const [batchStartBirdFilter, setBatchStartBirdFilter] = useState('pigeon_and_unknown'); // pigeon_and_unknown|confirmed_only|all
  const [batchManualMode, setBatchManualMode] = useState(false);
  const [allPosRun, setAllPosRun] = useState([]);
  const [allPosLoading, setAllPosLoading] = useState(false);
  const liveBoxRef = useRef(null);
  const calibrateBusyRef = useRef(false);
  calibrateBusyRef.current = calibrateBusy;
  const batchReplayBusyRef = useRef(false);
  batchReplayBusyRef.current = batchReplayBusy;
  const liveNaturalRef = useRef({ w: 0, h: 0 });
  const livePoseRef = useRef(null);
  livePoseRef.current = livePose;

  const deviceIdRef = useRef('');
  const sessionActiveRef = useRef(false);
  const prevDeviceIdRef = useRef('');
  deviceIdRef.current = deviceId;
  sessionActiveRef.current = sessionActive;

  const leaveSession = useCallback(async (id) => {
    const dId = id || deviceIdRef.current;
    if (!dId || !sessionActiveRef.current) return;
    try {
      await axios.post(`/api/devices/${dId}/shoot-test/leave`);
    } catch (e) {
      console.warn('Shoot-test leave failed', e);
    } finally {
      sessionActiveRef.current = false;
      setSessionActive(false);
    }
  }, []);

  const enterSession = useCallback(async (id) => {
    if (!id) return;
    try {
      await axios.post(`/api/devices/${id}/shoot-test/enter`);
      sessionActiveRef.current = true;
      setSessionActive(true);
      toast.info('Gerät pausiert für Shoot-Test (Status wird beim Verlassen wiederhergestellt)');
    } catch (e) {
      console.error(e);
      toast.error('Konnte Gerät nicht für Shoot-Test pausieren');
    }
  }, []);

  useEffect(() => {
    axios.get('/api/devices')
      .then((res) => setDevices(res.data || []))
      .catch(() => toast.error('Geräte laden fehlgeschlagen'));
  }, []);

  // Leave on unmount / device change / page hide
  useEffect(() => {
    const onPageHide = () => {
      const dId = deviceIdRef.current;
      if (!dId || !sessionActiveRef.current) return;
      const url = `/api/devices/${dId}/shoot-test/leave`;
      const token = localStorage.getItem('access_token');
      try {
        fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token || ''}`,
            'Content-Type': 'application/json'
          },
          body: '{}',
          keepalive: true
        });
        sessionActiveRef.current = false;
      } catch (_) { /* ignore */ }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      leaveSession();
    };
  }, [leaveSession]);

  useEffect(() => {
    let cancelled = false;
    const switchDevice = async () => {
      const prev = prevDeviceIdRef.current;
      if (prev && sessionActiveRef.current) {
        await leaveSession(prev);
      }
      prevDeviceIdRef.current = deviceId;
      setSelected(null);
      setZoneStatus(null);
      setDetections([]);
      setDetectionLargeUrl(null);
      setDetectionUsesZoomed(false);
      setLiveUrl(null);
      setLivePose(null);
      setAimMarker(null);
      if (!deviceId) {
        setDevice(null);
        return;
      }
      try {
        const res = await axios.get(`/api/devices/${deviceId}`);
        if (!cancelled) setDevice(res.data);
        await enterSession(deviceId);
        if (cancelled) return;
        setLoadingList(true);
        const detRes = await axios.get('/api/cv/detections', {
          params: { deviceId, page: 1, limit: 40, classificationStatus: 'confirmed_pigeon' }
        });
        // Fallback: also show all if few confirmed
        let list = detRes.data?.detections || [];
        if (!Array.isArray(list)) list = [];
        if (list.length < 10) {
          const allRes = await axios.get('/api/cv/detections', {
            params: { deviceId, page: 1, limit: 40 }
          });
          list = allRes.data?.detections || [];
          if (!Array.isArray(list)) list = [];
        }
        if (!cancelled) setDetections(list);
      } catch (e) {
        console.error(e);
        toast.error('Gerät/Erkennungen laden fehlgeschlagen');
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };
    switchDevice();
    return () => { cancelled = true; };
  }, [deviceId, enterSession, leaveSession]);

  const loadImage = useCallback(async (id) => {
    const idStr = String(id);
    if (imageByIdRef.current[idStr] !== undefined) return;
    setImageById((prev) => ({ ...prev, [idStr]: 'loading' }));
    try {
      const res = await axios.get(`/api/cv/detections/${idStr}/image`);
      const url = res.data.zoomed_image?.url || res.data.image?.url || null;
      setImageById((prev) => ({ ...prev, [idStr]: url }));
    } catch {
      setImageById((prev) => ({ ...prev, [idStr]: null }));
    }
  }, []);

  const openBatchDetail = useCallback(async (item) => {
    setBatchManualMode(false);
    setBatchDetailItem(item);
    if (!item?.detectionId) return;
    if (item.originalUrl && item.originalUrl !== 'loading') return;
    try {
      const imgRes = await axios.get(`/api/cv/detections/${item.detectionId}/image`);
      const useZoomed = Boolean(imgRes.data.zoomed_image?.url);
      const url = imgRes.data.zoomed_image?.url || imgRes.data.image?.url || null;
      setBatchRun((prev) => prev.map((row) => (
        row.key === item.key ? { ...row, originalUrl: url, useZoomed } : row
      )));
      setBatchDetailItem((prev) => (
        prev && prev.key === item.key ? { ...prev, originalUrl: url, useZoomed } : prev
      ));
    } catch {
      setBatchDetailItem((prev) => (
        prev && prev.key === item.key ? { ...prev, originalUrl: null } : prev
      ));
    }
  }, []);

  const startBatchManualCalibrate = useCallback(async (item) => {
    if (!deviceId || !item?.detectionId || calibrateBusy || aiming || executing || nudging || batchReplayBusy) {
      return;
    }
    // Enter manual UI immediately so the calibrated still is not mixed with live,
    // and clear stale live frames from replay / prior poll ticks.
    setCalibrateBusy(true);
    setBatchManualMode(true);
    setCalibrating(true);
    setLiveUrl(null);
    setAimMarker(null);
    setCalibrateRefineCount(0);
    setCalibrateMeta(null);
    try {
      // directAim: skip scan-home. resumeManual: use stored batch/manual finalPose
      // (matches Kalibrierbild) instead of recomputing fresh auto-aim.
      const resumeManual = !!(item.finalPose?.rotation != null && item.finalPose?.tilt != null);
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/calibrate-start`, {
        detectionId: item.detectionId,
        directAim: true,
        resumeManual
      }, { timeout: 120000 });
      setCalibrateMeta(res.data);
      const startPose = res.data?.aimPose || res.data?.autoAimPose;
      if (startPose) setLivePose(startPose);
      toast.info(
        res.data?.resumedManual
          ? 'Final-Pose vom Batch geladen — ggf. nachjustieren und speichern'
          : 'Auto-Aim fertig — mit Steuerkreuz oder Klick im Live-Bild ausrichten'
      );
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Manuelle Kalibrierung starten fehlgeschlagen');
      setBatchManualMode(false);
      setCalibrating(false);
      setCalibrateMeta(null);
      setCalibrateRefineCount(0);
      setAimMarker(null);
    } finally {
      setCalibrateBusy(false);
    }
  }, [deviceId, calibrateBusy, aiming, executing, nudging, batchReplayBusy]);

  const cancelBatchManualCalibrate = useCallback(() => {
    setBatchManualMode(false);
    setCalibrating(false);
    setCalibrateMeta(null);
    setCalibrateRefineCount(0);
    setAimMarker(null);
  }, []);

  const saveBatchManualCalibrate = useCallback(async () => {
    if (!deviceId || !batchDetailItem?.detectionId || !calibrateMeta || !livePose) {
      toast.warning('Keine Kalibrier-Daten');
      return;
    }
    setCalibrateBusy(true);
    try {
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/calibrate-save-manual`, {
        detectionId: batchDetailItem.detectionId,
        finalPose: livePose,
        scanPose: calibrateMeta.scanPose,
        autoAimPose: calibrateMeta.autoAimPose,
        offsetPx: calibrateMeta.offsetPx,
        zoomFactor: calibrateMeta.zoomFactor,
        imageSize: calibrateMeta.imageSize,
        waypointNumber: calibrateMeta.waypointNumber,
        captureLive: true
      }, { timeout: 120000 });

      const data = res.data || {};
      const liveCapture = data.liveImageBase64
        ? `data:image/jpeg;base64,${data.liveImageBase64}`
        : null;
      const patch = {
        status: 'ok',
        manual: true,
        converged: true,
        fovH: data.fov?.fovH ?? null,
        fovV: data.fov?.fovV ?? null,
        dRot: data.fov?.dRot ?? null,
        dTilt: data.fov?.dTilt ?? null,
        offsetPx: data.offsetPx || calibrateMeta.offsetPx || null,
        finalPose: data.finalPose || { ...livePose },
        autoAimPose: data.autoAimPose || calibrateMeta.autoAimPose || null,
        scanPose: data.scanPose || calibrateMeta.scanPose || null,
        report: data.report || null,
        residualPx: null,
        calibratedAt: new Date().toISOString(),
        zoomFactor: data.zoomFactor || calibrateMeta.zoomFactor || batchDetailItem.zoomFactor,
        ...(liveCapture ? { liveUrl: liveCapture } : {})
      };

      setBatchRun((prev) => prev.map((row) => (
        row.key === batchDetailItem.key ? { ...row, ...patch } : row
      )));
      setBatchDetailItem((prev) => (prev ? { ...prev, ...patch } : prev));

      // Also keep Einzelbild sample pool in sync for median-FOV
      setCalibrateSamples((prev) => [...prev, {
        id: `${Date.now()}`,
        detectionId: batchDetailItem.detectionId,
        waypointNumber: data.waypointNumber ?? calibrateMeta.waypointNumber,
        zoomFactor: patch.zoomFactor,
        offsetPx: patch.offsetPx,
        scanPose: data.scanPose || calibrateMeta.scanPose,
        autoAimPose: data.autoAimPose || calibrateMeta.autoAimPose,
        finalPose: patch.finalPose,
        refineClicks: calibrateRefineCount,
        auto: false,
        manual: true,
        batch: true,
        fovH: patch.fovH,
        fovV: patch.fovV,
        dRot: patch.dRot,
        dTilt: patch.dTilt
      }]);

      setBatchManualMode(false);
      setCalibrating(false);
      setCalibrateMeta(null);
      setCalibrateRefineCount(0);
      setAimMarker(null);

      toast.success(
        'Manuell ausgerichtet gespeichert'
        + (patch.fovH != null ? ` — H ${Number(patch.fovH).toFixed(1)}°` : '')
        + (patch.fovV != null ? ` / V ${Number(patch.fovV).toFixed(1)}°` : '')
      );
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Speichern fehlgeschlagen');
    } finally {
      setCalibrateBusy(false);
    }
  }, [
    deviceId,
    batchDetailItem,
    calibrateMeta,
    livePose,
    calibrateRefineCount
  ]);

  const toggleBatchExcluded = useCallback(async (key) => {
    const row = batchRun.find((r) => r.key === key);
    if (!row?.detectionId || !deviceId) return;
    if (row.status !== 'ok') {
      toast.warning('Nur ok-Messungen können ungültig gesetzt werden');
      return;
    }
    const next = !row.excluded;
    const updatedRun = batchRun.map((r) => (
      r.key === key ? { ...r, excluded: next } : r
    ));
    // Optimistic UI
    setBatchRun(updatedRun);
    setBatchDetailItem((prev) => (
      prev && prev.key === key ? { ...prev, excluded: next } : prev
    ));
    setCalibrateReport((prev) => {
      if (!prev?.fov?.soll) return prev;
      const fov = buildReportFovFromBatchRows(updatedRun, prev.fov.soll);
      if (fov) return { ...prev, fov };
      return {
        ...prev,
        fov: {
          ...prev.fov,
          ist: { h: null, v: null },
          delta: { h: null, v: null }
        }
      };
    });
    try {
      await axios.post(`/api/devices/${deviceId}/shoot-test/set-calibration-excluded`, {
        detectionId: row.detectionId,
        excluded: next
      });
      toast.success(next ? 'Als ungültig gespeichert' : 'Wieder gültig gespeichert');
    } catch (e) {
      console.error(e);
      // revert
      setBatchRun((prev) => prev.map((r) => (
        r.key === key ? { ...r, excluded: row.excluded } : r
      )));
      setBatchDetailItem((prev) => (
        prev && prev.key === key ? { ...prev, excluded: row.excluded } : prev
      ));
      toast.error(e.response?.data?.error || 'Ungültig-Status speichern fehlgeschlagen');
    }
  }, [batchRun, deviceId]);

  const replayCalibratedImage = useCallback(async (item) => {
    if (!deviceId || !item?.detectionId || batchReplayBusy || calibrateBusy || batchManualMode) return;
    setBatchReplayBusy(true);
    // Pause shared live pane so mid-move frames don't linger into manual mode.
    setLiveUrl(null);
    try {
      const res = await axios.post(
        `/api/devices/${deviceId}/shoot-test/replay-calibrated-image`,
        { detectionId: item.detectionId },
        { timeout: 120000 }
      );
      const capturedUrl = res.data?.liveImageBase64
        ? `data:image/jpeg;base64,${res.data.liveImageBase64}`
        : null;
      if (!capturedUrl) {
        toast.warning('Kein Bild zurückbekommen');
        return;
      }
      // Device stays at finalPose (by design). Only update batch item still + pose.
      if (res.data?.finalPose) setLivePose(res.data.finalPose);
      setBatchRun((prev) => prev.map((row) => (
        row.key === item.key ? { ...row, liveUrl: capturedUrl } : row
      )));
      setBatchDetailItem((prev) => (
        prev && prev.key === item.key ? { ...prev, liveUrl: capturedUrl } : prev
      ));
      toast.success('Kalibrierbild erzeugt (aktueller Capture an finalPose)');
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Replay fehlgeschlagen');
    } finally {
      setBatchReplayBusy(false);
    }
  }, [deviceId, batchReplayBusy, calibrateBusy, batchManualMode]);

  const assignBatchWaypoint = useCallback(async (item, thumb) => {
    if (!item?.detectionId || thumb?.rotation == null || thumb?.tilt == null || batchAssignBusy) return;
    const samePos = batchWaypoint !== '' && Number(thumb.number) === Number(batchWaypoint);
    setBatchAssignBusy(true);
    try {
      const response = await axios.patch(`/api/cv/detections/${item.detectionId}`, {
        camera_position: {
          rotation: Number(thumb.rotation),
          tilt: Number(thumb.tilt)
        }
      });
      const newPos = response.data?.camera_position || {
        rotation: Number(thumb.rotation),
        tilt: Number(thumb.tilt)
      };
      // Also keep Shoot-Test detections list in sync if present
      setDetections((prev) => prev.map((d) => (
        String(d._id) === String(item.detectionId)
          ? { ...d, camera_position: newPos }
          : d
      )));
      if (selected && String(selected._id) === String(item.detectionId)) {
        setSelected((prev) => (prev ? { ...prev, camera_position: newPos } : prev));
      }

      if (samePos) {
        setBatchRun((prev) => prev.map((row) => (
          row.key === item.key ? { ...row, cameraPosition: newPos } : row
        )));
        setBatchDetailItem((prev) => (
          prev && prev.key === item.key ? { ...prev, cameraPosition: newPos } : prev
        ));
        toast.success(`Pos ${thumb.number} bestätigt`);
      } else {
        setBatchRun((prev) => prev.filter((row) => row.key !== item.key));
        setBatchDetailItem(null);
        setBatchManualMode(false);
        setCalibrating(false);
        setCalibrateMeta(null);
        toast.success(`Auf Pos ${thumb.number} gesetzt — aus dieser Batch-Liste entfernt`);
      }
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Pos speichern fehlgeschlagen');
    } finally {
      setBatchAssignBusy(false);
    }
  }, [batchAssignBusy, batchWaypoint, selected]);

  const findRouteMatch = useCallback((det) => {
    if (!device || !det?.camera_position) return null;
    const coords = device.actions?.route?.coordinates || [];
    const r = Math.round(Number(det.camera_position.rotation));
    const t = Math.round(Number(det.camera_position.tilt));
    const index = coords.findIndex(
      (c) => Math.round(Number(c.rotation)) === r && Math.round(Number(c.tilt)) === t
    );
    if (index < 0) return null;
    return { coordinate: coords[index], index, number: index + 1 };
  }, [device]);

  const findRouteImage = useCallback((det) => {
    return findRouteMatch(det)?.coordinate?.image || null;
  }, [findRouteMatch]);

  const handleSelect = async (det) => {
    setSelected(det);
    setZoneStatus(null);
    setDetectionLargeUrl(null);
    setDetectionUsesZoomed(false);
    setLivePose(null);
    setAimMarker(null);
    setCalibrating(false);
    setCalibrateMeta(null);
    setCalibrateRefineCount(0);
    // keep last calibrateReport visible across selection changes unless cleared manually
    if (!deviceId || !det?._id) return;
    try {
      const [zoneRes, imgRes] = await Promise.all([
        axios.get(`/api/devices/${deviceId}/shoot-test/zone-status/${det._id}`),
        axios.get(`/api/cv/detections/${det._id}/image`)
      ]);
      setZoneStatus(zoneRes.data);
      const useZoomed = Boolean(imgRes.data.zoomed_image?.url);
      const url = imgRes.data.zoomed_image?.url || imgRes.data.image?.url || null;
      setDetectionUsesZoomed(useZoomed);
      setDetectionLargeUrl(url);
      // Default toggles to allowed actions
      const a = zoneRes.data.availability || {};
      setUseWater(true);
      setUseLaser(!!a.laser?.allowed);
      setUseAudio(!!a.audio?.allowed);

      // Drive device to detection scan pose so live view matches
      const pos = det.camera_position || zoneRes.data.camera_position;
      if (pos?.rotation != null && pos?.tilt != null) {
        try {
          const gotoRes = await axios.post(`/api/devices/${deviceId}/shoot-test/goto-pose`, {
            rotation: pos.rotation,
            tilt: pos.tilt
          });
          setLivePose(gotoRes.data.position);
        } catch (gotoErr) {
          console.warn('goto-pose failed', gotoErr);
          toast.warning('Gerät konnte nicht zur Detection-Position fahren');
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Zonenstatus laden fehlgeschlagen');
    }
  };

  const handleLiveAimClick = async (event) => {
    if (!deviceId || aiming || executing || nudging || calibrateBusy) return;
    const pose = livePoseRef.current;
    if (!pose) {
      toast.info('Warte auf Geräte-Position…');
      return;
    }
    const natural = liveNaturalRef.current;
    const mapped = clickToNormalized(event, liveBoxRef.current, natural.w, natural.h);
    if (!mapped) return;

    setAimMarker({ x: mapped.displayX, y: mapped.displayY });
    setAiming(true);
    try {
      const zoom = selected?.zoom_factor || zoneStatus?.zoom_factor || calibrateMeta?.zoomFactor || 1;
      const info = zoneStatus?.image_info || selected?.image_info;
      const imgW = calibrateMeta?.imageSize?.width
        || (zoom > 1 ? info?.zoomed_size?.width : info?.original_size?.width)
        || natural.w
        || 640;
      const imgH = calibrateMeta?.imageSize?.height
        || (zoom > 1 ? info?.zoomed_size?.height : info?.original_size?.height)
        || natural.h
        || 640;

      const trialFov = medianFinite(calibrateSamples.flatMap((s) => [s.fovH, s.fovV]))
        || calibrateMeta?.resolvedFov?.horizontal
        || calibrateMeta?.resolvedFov?.vertical
        || device?.camera?.raspberryPi?.fov
        || device?.camera?.raspberryPi?.fovH
        || device?.camera?.raspberryPi?.fovV;

      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/aim-click`, {
        rotation: pose.rotation,
        tilt: pose.tilt,
        normX: mapped.normX,
        normY: mapped.normY,
        zoomFactor: zoom,
        imageWidth: imgW,
        imageHeight: imgH,
        cameraSource: selected?.camera_source || device?.camera?.type,
        ...(Number(trialFov) > 0
          ? { fovH: trialFov, fovV: trialFov }
          : {})
      });
      if (res.data?.position) setLivePose(res.data.position);
      if (calibrating) {
        setCalibrateRefineCount((n) => n + 1);
        const nearCenter = Math.abs(mapped.normX - 0.5) < 0.03
          && Math.abs(mapped.normY - 0.5) < 0.03;
        if (nearCenter) {
          toast.success(
            batchManualMode
              ? 'Nahe Bildmitte — Ausrichtung speichern'
              : 'Nahe Bildmitte — Sample speichern'
          );
        } else {
          toast.info('Nachjustiert — bei Bedarf erneut auf den Taubenpunkt klicken');
        }
      }
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Zielen fehlgeschlagen');
    } finally {
      setAiming(false);
    }
  };

  const handleCalibrateAuto = async () => {
    if (!deviceId || !selected?._id || calibrating || executing || aiming || calibrateBusy) return;
    setCalibrateBusy(true);
    setCalibrating(true);
    try {
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/calibrate-auto`, {
        detectionId: selected._id,
        maxIterations: 8,
        pixelThreshold: 8,
        saveFov: false
      }, { timeout: 180000 });

      const data = res.data || {};
      if (data.finalPose) setLivePose(data.finalPose);
      setCalibrateMeta({
        detectionId: data.detectionId,
        waypointNumber: data.waypointNumber,
        zoomFactor: data.zoomFactor,
        imageSize: data.imageSize,
        offsetPx: data.offsetPx,
        scanPose: data.scanPose,
        autoAimPose: data.autoAimPose,
        resolvedFov: data.fov
      });

      const sample = {
        id: `${Date.now()}`,
        detectionId: data.detectionId,
        waypointNumber: data.waypointNumber,
        zoomFactor: data.zoomFactor,
        offsetPx: data.offsetPx,
        scanPose: data.scanPose,
        autoAimPose: data.autoAimPose,
        finalPose: data.finalPose,
        refineClicks: (data.iterations || []).length,
        auto: true,
        converged: !!data.converged,
        fovH: data.fov?.fovH,
        fovV: data.fov?.fovV,
        dRot: data.fov?.dRot,
        dTilt: data.fov?.dTilt
      };
      setCalibrateSamples((prev) => [...prev, sample]);

      if (data.report) {
        setCalibrateReport({
          ...data.report,
          waypointNumber: data.waypointNumber,
          converged: !!data.converged,
          saved: !!data.saved
        });
      }

      if (data.saved) {
        setDevice((prev) => (prev ? {
          ...prev,
          camera: {
            ...prev.camera,
            raspberryPi: { ...prev.camera?.raspberryPi, ...data.saved }
          }
        } : prev));
        toast.success(
          `${data.converged ? 'Konvergiert' : 'Beendet'} — FOV gespeichert `
          + `H ${data.saved.fovH}° / V ${data.saved.fovV}°`
          + ` (${(data.iterations || []).length} Iter.)`
        );
      } else if (data.fov?.fovH != null || data.fov?.fovV != null) {
        toast.info(
          `${data.converged ? 'Konvergiert' : 'Beendet'} — FOV gemessen `
          + `H ${Number(data.fov.fovH).toFixed(1)}° / V ${Number(data.fov.fovV).toFixed(1)}° `
          + '(auf Detection gespeichert; Gerät erst mit „FOV speichern“)'
        );
      } else {
        toast.warning('Kalibrierung fertig, aber FOV nicht berechenbar (Offset zu klein?)');
      }
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Auto-Kalibrierung fehlgeschlagen');
    } finally {
      setCalibrateBusy(false);
      setCalibrating(false);
    }
  };

  const openBatchStartDialog = () => {
    if (!deviceId || calibrating || executing || aiming || calibrateBusy) return;
    if (batchWaypoint === '') {
      toast.warning('Wegpunkt für Batch wählen');
      return;
    }
    setBatchStartCount(10);
    setBatchStartPriorMode('overwrite');
    setBatchStartBirdFilter('pigeon_and_unknown');
    setBatchStartOpen(true);
  };

  const handleCalibrateBatch = async (opts = {}) => {
    if (!deviceId || calibrating || executing || aiming || calibrateBusy) return;
    const limit = Math.min(30, Math.max(1, Number(opts.limit) || batchStartCount || 10));
    const priorMode = opts.priorMode || batchStartPriorMode || 'overwrite';
    const birdFilter = opts.birdFilter || batchStartBirdFilter || 'pigeon_and_unknown';
    setBatchStartOpen(false);

    const wp = batchWaypoint !== ''
      ? Number(batchWaypoint)
      : (zoneStatus?.waypointNumber || findRouteMatch(selected)?.number || null);
    const coords = device?.actions?.route?.coordinates || [];
    let rot = null;
    let tilt = null;
    if (wp != null && wp >= 1 && wp <= coords.length) {
      rot = coords[wp - 1]?.rotation;
      tilt = coords[wp - 1]?.tilt;
    } else {
      rot = selected?.camera_position?.rotation ?? zoneStatus?.camera_position?.rotation;
      tilt = selected?.camera_position?.tilt ?? zoneStatus?.camera_position?.tilt;
    }
    if (wp == null && (rot == null || tilt == null)) {
      toast.warning('Wegpunkt für Batch wählen');
      return;
    }

    setCalibrateBusy(true);
    setCalibrating(true);
    setBatchProgress({ current: 0, total: 0, ok: 0, fail: 0 });
    setBatchRun([]);
    try {
      const params = { limit, priorMode, birdFilter };
      if (wp != null) params.waypointNumber = wp;
      else {
        params.rotation = rot;
        params.tilt = tilt;
      }
      const candRes = await axios.get(`/api/devices/${deviceId}/shoot-test/calibrate-candidates`, { params });
      const candidates = candRes.data?.candidates || [];
      if (!candidates.length) {
        const birdHint = birdFilter === 'confirmed_only'
          ? 'Keine bestätigten Tauben'
          : birdFilter === 'all'
            ? 'Keine Bilder'
            : 'Keine Detections mit Taube (erkannt/unbekannt)';
        toast.warning(
          priorMode === 'overwrite'
            ? `${birdHint} für diese Pos gefunden`
            : `Keine unkalibrierten Treffer — ${birdHint.toLowerCase()}`
        );
        return;
      }

      const initialRun = candidates.map((c, i) => ({
        ...batchRowFromCandidate(c, i),
        key: `batch-${c.detectionId}-${i}`,
        status: 'pending',
        source: 'batch',
        waypointNumber: wp,
        manual: false,
        fovH: null,
        fovV: null,
        dRot: null,
        dTilt: null,
        offsetPx: null,
        converged: null,
        report: null,
        residualPx: null,
        liveUrl: null
      }));
      setBatchRun(initialRun);
      setBatchProgress({ current: 0, total: candidates.length, ok: 0, fail: 0 });

      // Preload originals in parallel
      await Promise.all(initialRun.map(async (item) => {
        try {
          const imgRes = await axios.get(`/api/cv/detections/${item.detectionId}/image`);
          const useZoomed = Boolean(imgRes.data.zoomed_image?.url);
          const url = imgRes.data.zoomed_image?.url || imgRes.data.image?.url || null;
          setBatchRun((prev) => prev.map((row) => (
            row.key === item.key ? { ...row, originalUrl: url, useZoomed } : row
          )));
        } catch {
          setBatchRun((prev) => prev.map((row) => (
            row.key === item.key ? { ...row, originalUrl: null } : row
          )));
        }
      }));

      const batchSamples = [];
      let ok = 0;
      let fail = 0;

      for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        const rowKey = initialRun[i].key;
        setBatchRun((prev) => prev.map((row) => (
          row.key === rowKey ? { ...row, status: 'running' } : row
        )));
        setBatchProgress({
          current: i + 1,
          total: candidates.length,
          ok,
          fail,
          lastId: c.detectionId
        });
        try {
          const res = await axios.post(`/api/devices/${deviceId}/shoot-test/calibrate-auto`, {
            detectionId: c.detectionId,
            maxIterations: 8,
            pixelThreshold: 8,
            saveFov: false
          }, { timeout: 180000 });
          const data = res.data || {};
          if (data.finalPose) setLivePose(data.finalPose);
          if (data.liveImageBase64) {
            setLiveUrl(`data:image/jpeg;base64,${data.liveImageBase64}`);
          }
          ok += 1;
          const sample = {
            id: `${Date.now()}-${i}`,
            detectionId: data.detectionId,
            waypointNumber: data.waypointNumber ?? wp,
            zoomFactor: data.zoomFactor,
            offsetPx: data.offsetPx,
            scanPose: data.scanPose,
            autoAimPose: data.autoAimPose,
            finalPose: data.finalPose,
            refineClicks: (data.iterations || []).length,
            auto: true,
            batch: true,
            converged: !!data.converged,
            fovH: data.fov?.fovH,
            fovV: data.fov?.fovV,
            dRot: data.fov?.dRot,
            dTilt: data.fov?.dTilt,
            report: data.report
          };
          batchSamples.push(sample);
          setBatchRun((prev) => prev.map((row) => (
            row.key === rowKey
              ? {
                ...row,
                status: 'ok',
                source: 'batch',
                manual: false,
                liveUrl: data.liveImageBase64
                  ? `data:image/jpeg;base64,${data.liveImageBase64}`
                  : row.liveUrl,
                fovH: data.fov?.fovH,
                fovV: data.fov?.fovV,
                dRot: data.fov?.dRot,
                dTilt: data.fov?.dTilt,
                offsetPx: data.offsetPx || null,
                converged: !!data.converged,
                report: data.report,
                residualPx: data.lastLocate?.residualPx || null,
                finalPose: data.finalPose || null,
                autoAimPose: data.autoAimPose || null,
                scanPose: data.scanPose || null,
                zoomFactor: data.zoomFactor ?? row.zoomFactor
              }
              : row
          )));
          if (data.report) {
            setCalibrateReport({
              ...data.report,
              waypointNumber: data.waypointNumber ?? wp,
              converged: !!data.converged,
              saved: false
            });
          }
        } catch (oneErr) {
          fail += 1;
          console.warn('Batch sample failed', c.detectionId, oneErr);
          setBatchRun((prev) => prev.map((row) => (
            row.key === rowKey
              ? {
                ...row,
                status: 'fail',
                error: oneErr.response?.data?.error
                  || oneErr.response?.data?.message
                  || oneErr.message
                  || 'fehlgeschlagen'
              }
              : row
          )));
        }
        setBatchProgress({
          current: i + 1,
          total: candidates.length,
          ok,
          fail,
          lastId: c.detectionId
        });
      }

      setCalibrateSamples((prev) => [...prev, ...batchSamples]);

      const batchOkRows = batchSamples.map((s) => ({
        status: 'ok',
        excluded: false,
        fovH: s.fovH,
        fovV: s.fovV
      }));
      const { h: medH, v: medV, fov: medFov } = medianFovFromBatchRows(batchOkRows);
      if (batchSamples.length && batchSamples[batchSamples.length - 1]?.report) {
        const last = batchSamples[batchSamples.length - 1];
        const soll = last.report.fov?.soll;
        const fov = buildReportFovFromBatchRows(batchOkRows, soll);
        setCalibrateReport({
          waypointNumber: wp,
          converged: fail === 0,
          saved: false,
          pos: last.report.pos,
          ...(fov ? { fov } : {})
        });
      }

      toast.success(
        `Batch Pos ${wp ?? '?'} fertig: ${ok} ok / ${fail} fehlgeschlagen`
        + (medFov != null ? ` · FOV ${medFov.toFixed(1)}°` : '')
        + (medH != null || medV != null
          ? ` (H ${medH != null ? medH.toFixed(1) : '—'} / V ${medV != null ? medV.toFixed(1) : '—'})`
          : '')
      );
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Batch fehlgeschlagen');
    } finally {
      setCalibrateBusy(false);
      setCalibrating(false);
      setBatchProgress(null);
    }
  };

  const handleCalibrateStart = async () => {
    if (!deviceId || !selected?._id || calibrating || executing || aiming) return;
    setCalibrateBusy(true);
    try {
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/calibrate-start`, {
        detectionId: selected._id
      });
      setCalibrateMeta(res.data);
      setCalibrateRefineCount(0);
      setCalibrating(true);
      if (res.data?.autoAimPose) setLivePose(res.data.autoAimPose);
      setAimMarker(null);
      toast.info('Auto-Aim fertig — im Live-Bild auf die Tauben-/Spike-Stelle klicken bis Mitte passt');
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Kalibrierung starten fehlgeschlagen');
    } finally {
      setCalibrateBusy(false);
    }
  };

  const handleCalibrateSaveSample = () => {
    if (!calibrateMeta || !livePose) {
      toast.warning('Keine Kalibrier-Daten');
      return;
    }
    const computed = computeFovFromSample({
      offsetPx: calibrateMeta.offsetPx,
      scanPose: calibrateMeta.scanPose,
      finalPose: livePose,
      imageSize: calibrateMeta.imageSize,
      zoomFactor: calibrateMeta.zoomFactor
    });
    if (computed.fovH == null && computed.fovV == null) {
      toast.warning('Offset zu klein für FOV (Taube zu nah an der Mitte)');
      return;
    }
    const sample = {
      id: `${Date.now()}`,
      detectionId: calibrateMeta.detectionId,
      waypointNumber: calibrateMeta.waypointNumber,
      zoomFactor: calibrateMeta.zoomFactor,
      offsetPx: calibrateMeta.offsetPx,
      scanPose: calibrateMeta.scanPose,
      autoAimPose: calibrateMeta.autoAimPose,
      finalPose: { ...livePose },
      refineClicks: calibrateRefineCount,
      ...computed
    };
    setCalibrateSamples((prev) => [...prev, sample]);

    const fovSollH = calibrateMeta.resolvedFov?.horizontal
      ?? device?.camera?.raspberryPi?.fovH
      ?? device?.camera?.raspberryPi?.fov
      ?? null;
    const fovSollV = calibrateMeta.resolvedFov?.vertical
      ?? device?.camera?.raspberryPi?.fovV
      ?? device?.camera?.raspberryPi?.fov
      ?? null;
    const sollCombined = (fovSollH != null && fovSollV != null)
      ? (Number(fovSollH) + Number(fovSollV)) / 2
      : (fovSollH ?? fovSollV);
    const istCombined = (computed.fovH != null && computed.fovV != null)
      ? (computed.fovH + computed.fovV) / 2
      : (computed.fovH ?? computed.fovV);
    setCalibrateReport({
      waypointNumber: calibrateMeta.waypointNumber,
      converged: true,
      saved: false,
      pos: {
        soll: { ...livePose },
        ist: calibrateMeta.autoAimPose,
        delta: {
          rotation: Number(livePose.rotation) - Number(calibrateMeta.autoAimPose?.rotation),
          tilt: Number(livePose.tilt) - Number(calibrateMeta.autoAimPose?.tilt)
        }
      },
      fov: {
        soll: { h: fovSollH, v: fovSollV, combined: sollCombined },
        ist: { h: istCombined, v: istCombined },
        delta: {
          h: istCombined != null && sollCombined != null ? istCombined - sollCombined : null,
          v: istCombined != null && sollCombined != null ? istCombined - sollCombined : null
        },
        fov: istCombined,
        axis: { h: computed.fovH, v: computed.fovV }
      }
    });

    toast.success(
      `Sample #${calibrateSamples.length + 1}: `
      + (istCombined != null ? `FOV ${istCombined.toFixed(1)}°` : '')
      + (computed.fovH != null || computed.fovV != null
        ? ` (H ${computed.fovH != null ? computed.fovH.toFixed(1) : '—'} / V ${computed.fovV != null ? computed.fovV.toFixed(1) : '—'})`
        : '')
    );
  };

  const handleCalibrateStop = () => {
    setCalibrating(false);
    setCalibrateMeta(null);
    setCalibrateRefineCount(0);
  };

  const handleCalibrateSaveFov = async () => {
    let usePool;
    if (mainTab === 'batch') {
      const fromRun = batchRun
        .filter((r) => r.status === 'ok' && !r.excluded)
        .map((r) => ({ status: 'ok', excluded: false, fovH: r.fovH, fovV: r.fovV }));
      usePool = fromRun.length
        ? fromRun
        : calibrateSamples
          .filter((s) => s.batch)
          .filter((s) => {
            const row = batchRun.find((r) => String(r.detectionId) === String(s.detectionId));
            return !row?.excluded;
          })
          .map((s) => ({ status: 'ok', excluded: false, fovH: s.fovH, fovV: s.fovV }));
    } else {
      const single = calibrateSamples.filter((s) => !s.batch);
      const src = single.length ? single : calibrateSamples;
      usePool = src.map((s) => ({ status: 'ok', excluded: false, fovH: s.fovH, fovV: s.fovV }));
    }
    const { fov } = medianFovFromBatchRows(usePool);
    if (fov == null) {
      toast.warning('Mindestens ein Sample mit nutzbarem Offset nötig');
      return;
    }
    if (!deviceId) return;
    setCalibrateBusy(true);
    try {
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/calibrate-save-fov`, {
        fov,
        fovH: fov,
        fovV: fov
      });
      toast.success(`FOV gespeichert: ${fov.toFixed(1)}° (H=V, quadratisch)`);
      if (res.data?.raspberryPi) {
        setDevice((prev) => (prev ? {
          ...prev,
          camera: {
            ...prev.camera,
            raspberryPi: { ...prev.camera?.raspberryPi, ...res.data.raspberryPi }
          }
        } : prev));
      }
      setCalibrateReport((prev) => (prev ? { ...prev, saved: true } : prev));
      setCalibrating(false);
      setCalibrateMeta(null);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'FOV speichern fehlgeschlagen');
    } finally {
      setCalibrateBusy(false);
    }
  };

  /** Impulse nudge via device-control (step from nudgeDegrees). */
  const handleNudge = async (action) => {
    if (!deviceId || aiming || executing || nudging) return;
    const step = nudgeDegrees;
    const deltas = {
      rotate_left: { rotation: -step, tilt: 0 },
      rotate_right: { rotation: step, tilt: 0 },
      move_up: { rotation: 0, tilt: step },
      move_down: { rotation: 0, tilt: -step }
    };
    const delta = deltas[action];
    if (!delta) return;

    setNudging(true);
    try {
      await axios.post(`/api/device-control/${deviceId}/control`, { action, degrees: step });
      setLivePose((prev) => {
        if (!prev) return prev;
        return {
          rotation: Math.round(Number(prev.rotation) + delta.rotation),
          tilt: Math.round(Number(prev.tilt) + delta.tilt)
        };
      });
      setAimMarker(null);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Steuerung fehlgeschlagen');
    } finally {
      setNudging(false);
    }
  };

  /** Jump to a known motor pose (autoAim / final) during manual calibrate. */
  const handleJumpPose = useCallback(async (pose, label) => {
    if (!deviceId || !pose || aiming || executing || nudging || calibrateBusy) return;
    if (pose.rotation == null || pose.tilt == null) return;
    setAiming(true);
    setAimMarker(null);
    try {
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/goto-pose`, {
        rotation: pose.rotation,
        tilt: pose.tilt,
        asMotor: true,
        wait: true
      }, { timeout: 60000 });
      const next = res.data?.position || {
        rotation: Math.round(Number(pose.rotation)),
        tilt: Math.round(Number(pose.tilt))
      };
      setLivePose(next);
      toast.info(label === 'final' ? 'Auf Final-Pose' : 'Auf Auto-Aim');
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Anfahren fehlgeschlagen');
    } finally {
      setAiming(false);
    }
  }, [deviceId, aiming, executing, nudging, calibrateBusy]);

  /** Fire shoot at current pose using Aktion-checkboxes from the mask. */
  const handleManualShoot = async () => {
    if (!deviceId || aiming || executing || nudging) return;
    if (!useWater && !useLaser && !useAudio) {
      toast.info('Keine Aktion ausgewählt (Wasser/Laser/Audio)');
      return;
    }
    setNudging(true);
    try {
      await axios.post(`/api/device-control/${deviceId}/control`, {
        action: 'shoot',
        useWater: !!useWater,
        useLaser: !!useLaser,
        useAudio: !!useAudio
      });
      const parts = [];
      if (useWater) parts.push('Wasser');
      if (useLaser) parts.push('Laser');
      if (useAudio) parts.push('Audio');
      toast.success(`Schuss gesendet (${parts.join(', ')})`);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Schuss fehlgeschlagen');
    } finally {
      setNudging(false);
    }
  };

  // Live camera poll: detection selected (Einzelbild) or batch tab with device.
  // Pause while replay / calibrate moves the gun so mid-move frames don't leak into the UI.
  useEffect(() => {
    const wantLive = !!deviceId && (!!selected || mainTab === 'batch');
    if (!wantLive) {
      setLiveUrl(null);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const tick = async () => {
      if (batchReplayBusyRef.current || calibrateBusyRef.current) {
        if (!cancelled) timer = setTimeout(tick, 400);
        return;
      }
      try {
        const zoom = (batchManualMode && calibrateMeta?.zoomFactor)
          || selected?.zoom_factor
          || zoneStatus?.zoom_factor
          || batchDetailItem?.zoomFactor
          || 1;
        const camType = device?.camera?.type;
        let source;
        if (selected?.camera_source === 'raspberry-pi' || selected?.camera_source === 'tapo') {
          source = selected.camera_source;
        } else if (camType === 'raspberry-pi') {
          source = 'raspberry-pi';
        } else if (camType === 'tapo') {
          source = 'tapo';
        } else if (camType === 'dual' && device?.camera?.raspberryPi?.ip) {
          // Dual: Pi carries flip/angle/square/resolution from Geräteinstellungen
          source = 'raspberry-pi';
        }
        const res = await axios.get(`/api/device-image/${deviceId}`, {
          params: {
            format: 'json',
            zoom,
            variant: zoom > 1 ? 'zoomed' : 'original',
            ...(source ? { source } : {}),
            t: Date.now()
          },
          responseType: 'json'
        });
        if (!cancelled && res.data?.imageBase64) {
          setLiveUrl(`data:image/jpeg;base64,${res.data.imageBase64}`);
        }
      } catch {
        // keep last frame
      }
      if (!cancelled) timer = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    deviceId,
    selected,
    mainTab,
    zoneStatus?.zoom_factor,
    device?.camera?.type,
    device?.camera?.raspberryPi?.ip,
    batchManualMode,
    calibrateMeta?.zoomFactor,
    batchDetailItem?.zoomFactor
  ]);

  const handleExecute = async () => {
    if (!deviceId || !selected?._id) return;
    setExecuting(true);
    try {
      // Move to scan pose → aim → optional shoot → return|stay
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/execute`, {
        detectionId: selected._id,
        mode,
        useWater,
        useLaser,
        useAudio
      });
      const applied = res.data?.applied || {};
      const didShoot = !!(applied.water || applied.laser || applied.audio);
      if (didShoot) {
        toast.success(
          mode === 'stay'
            ? 'Schuss ausgeführt — Gerät bleibt auf Zielposition'
            : 'Schuss ausgeführt — zurück zur Scan-Position'
        );
      } else {
        toast.success(
          mode === 'stay'
            ? 'Bewegt zur Zielposition (ohne Schuss) — bleibt'
            : 'Bewegt zur Zielposition (ohne Schuss) — zurück'
        );
      }
      console.log('Shoot-test steps', res.data.steps);
      const steps = res.data?.steps || [];
      const lastMove = [...steps].reverse().find((s) => s.position);
      if (lastMove?.position) setLivePose(lastMove.position);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Shoot-Test fehlgeschlagen');
    } finally {
      setExecuting(false);
    }
  };

  const avail = zoneStatus?.availability;
  const anyActionSelected = (useWater && avail?.water?.allowed)
    || (useLaser && avail?.laser?.allowed)
    || (useAudio && avail?.audio?.allowed);
  // Move-only is allowed when all actions are off
  const canExecute = selected && zoneStatus?.hasTargetBird;

  const routeCoords = device?.actions?.route?.coordinates || [];
  const selectedRouteCoord = batchWaypoint !== ''
    ? (routeThumbs.find((t) => String(t.number) === String(batchWaypoint))
      || routeCoords[Number(batchWaypoint) - 1]
      || null)
    : null;
  const selectedRouteThumb = toImageSrc(
    selectedRouteCoord?.image
    || routeThumbs.find((t) => String(t.number) === String(batchWaypoint))?.image
  );

  // Route-Miniaturen separat laden (liegen in RouteImage, oft nicht am Device)
  useEffect(() => {
    if (!deviceId) {
      setRouteThumbs([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`/api/devices/${deviceId}/shoot-test/route-thumbs`);
        if (!cancelled) setRouteThumbs(res.data?.thumbs || []);
      } catch (e) {
        console.warn('route-thumbs load failed', e);
        if (!cancelled) setRouteThumbs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId]);

  // Load candidates + prior fovCalibration when Pos is selected (no batch run needed)
  useEffect(() => {
    if (mainTab !== 'batch' || !deviceId || batchWaypoint === '' || calibrateBusy) return undefined;
    let cancelled = false;
    const wp = Number(batchWaypoint);
    (async () => {
      try {
        const candRes = await axios.get(`/api/devices/${deviceId}/shoot-test/calibrate-candidates`, {
          params: {
            waypointNumber: wp,
            limit: 50,
            calibratedOnly: true
          }
        });
        if (cancelled || calibrateBusyRef.current) return;
        const candidates = candRes.data?.candidates || [];
        const rows = candidates.map((c, i) => ({
          ...batchRowFromCandidate(c, i),
          // Force selected Pos — stored cal.waypointNumber can be stale/wrong
          waypointNumber: wp
        }));
        setBatchRun(rows);

        const priorSamples = rows
          .filter((r) => r.status === 'ok' && r.source === 'prior' && !r.excluded)
          .map((r) => ({
            id: `prior-${r.detectionId}`,
            detectionId: r.detectionId,
            waypointNumber: wp,
            batch: true,
            auto: true,
            source: 'prior',
            converged: r.converged,
            fovH: r.fovH,
            fovV: r.fovV,
            dRot: r.dRot,
            dTilt: r.dTilt,
            offsetPx: r.offsetPx,
            report: r.report
          }));
        setCalibrateSamples((prev) => [
          ...prev.filter((s) => !s.batch),
          ...priorSamples
        ]);

        const priorValidRows = rows.filter((r) => r.status === 'ok' && r.source === 'prior' && !r.excluded);
        if (priorValidRows.length && priorValidRows[priorValidRows.length - 1]?.report) {
          const last = priorValidRows[priorValidRows.length - 1];
          const soll = last.report.fov?.soll;
          const fov = buildReportFovFromBatchRows(priorValidRows, soll);
          setCalibrateReport({
            waypointNumber: wp,
            converged: priorValidRows.every((s) => s.converged),
            saved: false,
            fromPrior: true,
            pos: last.report.pos,
            ...(fov ? { fov } : {})
          });
        }

        await Promise.all(rows.map(async (item) => {
          try {
            const imgRes = await axios.get(`/api/cv/detections/${item.detectionId}/image`);
            const useZoomed = Boolean(imgRes.data.zoomed_image?.url);
            const url = imgRes.data.zoomed_image?.url || imgRes.data.image?.url || null;
            if (cancelled || calibrateBusyRef.current) return;
            setBatchRun((prev) => prev.map((row) => (
              row.key === item.key ? { ...row, originalUrl: url, useZoomed } : row
            )));
          } catch {
            if (!cancelled && !calibrateBusyRef.current) {
              setBatchRun((prev) => prev.map((row) => (
                row.key === item.key ? { ...row, originalUrl: null } : row
              )));
            }
          }
        }));
      } catch (e) {
        if (!cancelled) {
          console.warn('Prior candidates load failed', e);
          setBatchRun([]);
        }
      }
    })();
    return () => { cancelled = true; };
    // Omit calibrateBusy from deps so a finished live batch keeps its frames until Pos changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, deviceId, batchWaypoint]);

  // Load calibrated samples across all waypoints for global analysis (no images)
  useEffect(() => {
    if (mainTab !== 'batch' || !deviceId) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setAllPosLoading(true);
      try {
        const res = await axios.get(`/api/devices/${deviceId}/shoot-test/calibrate-candidates`, {
          params: {
            calibratedOnly: true,
            allPositions: true,
            limit: 200
          }
        });
        if (cancelled) return;
        const candidates = res.data?.candidates || [];
        const rows = candidates.map((c, i) => batchRowFromCandidate(c, i));
        setAllPosRun(rows);
      } catch (e) {
        if (!cancelled) {
          console.warn('All-positions analysis load failed', e);
          setAllPosRun([]);
        }
      } finally {
        if (!cancelled) setAllPosLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mainTab, deviceId]);

  const handleMainTab = (_e, v) => {
    if (v !== 'batch' && batchManualMode) {
      cancelBatchManualCalibrate();
      setBatchDetailItem(null);
    }
    setMainTab(v);
    if (v === 'batch' && batchWaypoint === '') {
      const n = zoneStatus?.waypointNumber || findRouteMatch(selected)?.number;
      if (n != null) setBatchWaypoint(String(n));
    }
  };

  const batchValidRows = validBatchRows(batchRun);
  const singleSamplesOnly = calibrateSamples.filter((s) => !s.batch);
  const batchOkCount = batchRun.filter((r) => r.status === 'ok').length;
  const showBatchAnalysis = !calibrateBusy && batchOkCount > 0;
  const batchFromPrior = batchRun.some((r) => r.source === 'prior' && r.status === 'ok')
    && !batchRun.some((r) => r.source === 'batch' && r.status === 'ok');

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Shoot-Test / FOV Kalibrierung
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Testet Aim + Schuss anhand einer gespeicherten Detection (nicht Live-CV).
        Beim Öffnen wird der Monitor pausiert; beim Verlassen der Seite wird der vorherige Zustand wiederhergestellt.
      </Typography>

      {sessionActive && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Shoot-Test aktiv — Gerät pausiert und entsichert (Monitor aus). Status wird beim Verlassen wiederhergestellt.
        </Alert>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <FormControl fullWidth size="small" sx={{ maxWidth: 360 }}>
            <InputLabel>Gerät</InputLabel>
            <Select
              label="Gerät"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              {devices.map((d) => (
                <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      <Tabs
        value={mainTab}
        onChange={handleMainTab}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="single" label="Einzelbild" />
        <Tab value="batch" label="Pos & Batch" />
      </Tabs>

      {loadingList && mainTab === 'single' && <LinearProgress sx={{ mb: 2 }} />}

      {mainTab === 'single' && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <FormLabel component="legend">Schuss-Modus</FormLabel>
              <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value)}>
                <FormControlLabel value="return" control={<Radio />} label="Bewegen (hin → shoot → zurück)" />
                <FormControlLabel value="stay" control={<Radio />} label="Bleiben (hin → shoot → stay)" />
              </RadioGroup>
            </CardContent>
          </Card>

          {deviceId && (
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Erkennungen wählen
                </Typography>
                <Box display="flex" gap={1.5} overflow="auto" pb={1}>
                  {detections.map((d) => (
                    <DetectionThumb
                      key={d._id}
                      detection={d}
                      selected={selected?._id === d._id}
                      imageUrl={imageById[d._id]}
                      routeThumb={findRouteImage(d)}
                      waypointNumber={findRouteMatch(d)?.number}
                      onSelect={handleSelect}
                      onNeedImage={loadImage}
                    />
                  ))}
                  {!loadingList && detections.length === 0 && (
                    <Typography variant="body2" color="text.secondary">Keine Erkennungen</Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          )}

          {selected && (
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} md={4}>
                <Card>
                  <CardContent>
                    <Typography variant="subtitle1" gutterBottom>
                      Aktionen
                    </Typography>
                    <FormGroup>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={useWater}
                            onChange={(e) => setUseWater(e.target.checked)}
                            disabled={!avail?.water?.allowed}
                          />
                        }
                        label="Wasser"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={useLaser && !!avail?.laser?.allowed}
                            onChange={(e) => setUseLaser(e.target.checked)}
                            disabled={!avail?.laser?.allowed}
                          />
                        }
                        label="Laser"
                      />
                      {!avail?.laser?.allowed && avail?.laser?.reason && (
                        <Alert severity="info" sx={{ mb: 1 }}>{avail.laser.reason}</Alert>
                      )}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={useAudio && !!avail?.audio?.allowed}
                            onChange={(e) => setUseAudio(e.target.checked)}
                            disabled={!avail?.audio?.allowed}
                          />
                        }
                        label="Audio"
                      />
                      {!avail?.audio?.allowed && avail?.audio?.reason && (
                        <Alert severity="info" sx={{ mb: 1 }}>{avail.audio.reason}</Alert>
                      )}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={showZones}
                            onChange={(e) => setShowZones(e.target.checked)}
                            disabled={
                              !avail?.routeCoordinate?.hasLaserZone
                              && !avail?.routeCoordinate?.audioEnabled
                            }
                          />
                        }
                        label="Laser-/Audio-Zone einblenden"
                      />
                    </FormGroup>

                    <Box mt={2} display="flex" flexWrap="wrap" gap={1} alignItems="center">
                      {zoneStatus?.camera_position && (
                        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                          {(zoneStatus.waypointNumber
                            || avail?.routeCoordinate?.waypointNumber
                            || findRouteMatch(selected)?.number) && (
                            <Chip
                              size="small"
                              color="primary"
                              label={`Wegpunkt ${
                                zoneStatus.waypointNumber
                                || avail?.routeCoordinate?.waypointNumber
                                || findRouteMatch(selected)?.number
                              }`}
                            />
                          )}
                          <Chip
                            size="small"
                            label={`Pos R ${zoneStatus.camera_position.rotation}° / T ${zoneStatus.camera_position.tilt}°`}
                          />
                          {(zoneStatus.routeImage || findRouteImage(selected)) && (
                            <Box
                              component="img"
                              src={(() => {
                                const img = zoneStatus.routeImage || findRouteImage(selected);
                                return img?.startsWith?.('data:') ? img : `data:image/jpeg;base64,${img}`;
                              })()}
                              alt="Wegpunkt-Vorschau"
                              title={`Wegpunkt ${
                                zoneStatus.waypointNumber
                                || avail?.routeCoordinate?.waypointNumber
                                || findRouteMatch(selected)?.number
                                || '?'
                              }`}
                              sx={{
                                width: 56,
                                height: 42,
                                objectFit: 'cover',
                                borderRadius: 0.5,
                                border: '1px solid',
                                borderColor: 'divider',
                                bgcolor: '#000'
                              }}
                            />
                          )}
                        </Box>
                      )}
                      {zoneStatus?.availability?.routeCoordinate ? (
                        <Chip
                          size="small"
                          color="success"
                          label={
                            zoneStatus.waypointNumber
                              ? `Wegpunkt ${zoneStatus.waypointNumber} gefunden`
                              : 'Wegpunkt gefunden'
                          }
                        />
                      ) : (
                        <Chip size="small" color="warning" label="Kein Wegpunkt-Match" />
                      )}
                      {!zoneStatus?.hasTargetBird && (
                        <Chip size="small" color="error" label="Keine Vogel-BBox" />
                      )}
                    </Box>

                    <Button
                      sx={{ mt: 2 }}
                      fullWidth
                      variant="contained"
                      color={anyActionSelected ? 'error' : 'primary'}
                      startIcon={executing ? <CircularProgress size={18} color="inherit" /> : <ShootIcon />}
                      disabled={!canExecute || executing || calibrating || calibrateBusy}
                      onClick={handleExecute}
                    >
                      {executing
                        ? 'Ausführung…'
                        : anyActionSelected
                          ? 'Shoot ausführen'
                          : 'Nur bewegen (ohne Schuss)'}
                    </Button>

                    <Button
                      sx={{ mt: 1 }}
                      fullWidth
                      variant="contained"
                      color="secondary"
                      disabled={!canExecute || executing || aiming || calibrateBusy}
                      onClick={handleCalibrateAuto}
                    >
                      {calibrateBusy && !batchProgress ? 'Auto-Kalibrierung…' : 'FOV auto-kalibrieren (1 Bild)'}
                    </Button>

                    {calibrateReport && !batchValidRows.length && (
                      <CalibrateResultBanner
                        report={calibrateReport}
                        waypointNumber={calibrateReport.waypointNumber}
                        converged={calibrateReport.converged}
                        saved={calibrateReport.saved}
                      />
                    )}

                    <Button
                      sx={{ mt: 1 }}
                      fullWidth
                      variant="outlined"
                      color="secondary"
                      disabled={!canExecute || executing || aiming || calibrateBusy}
                      onClick={calibrating ? handleCalibrateStop : handleCalibrateStart}
                    >
                      {calibrating && !calibrateBusy
                        ? 'Manuelle Kalibrierung abbrechen'
                        : 'FOV manuell nachklicken'}
                    </Button>

                    {calibrating && (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        Auto-Aim gelaufen
                        {calibrateMeta?.autoAimPose
                          ? ` → R ${calibrateMeta.autoAimPose.rotation}° / T ${calibrateMeta.autoAimPose.tilt}°`
                          : ''}
                        . Im Live-Bild auf die Stelle klicken, wo die Taube war, bis die Mitte passt.
                        Dann Sample speichern.
                        {calibrateRefineCount > 0 ? ` (Nachklicks: ${calibrateRefineCount})` : ''}
                      </Alert>
                    )}

                    {calibrating && (
                      <Button
                        sx={{ mt: 1 }}
                        fullWidth
                        variant="contained"
                        color="secondary"
                        disabled={calibrateBusy || !livePose}
                        onClick={handleCalibrateSaveSample}
                      >
                        Sample speichern (aktuelle Pose)
                      </Button>
                    )}

                    {singleSamplesOnly.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Samples: {singleSamplesOnly.length}
                          {(() => {
                            const { fov, h, v } = medianFovFromBatchRows(
                              singleSamplesOnly.map((s) => ({
                                status: 'ok',
                                excluded: false,
                                fovH: s.fovH,
                                fovV: s.fovV
                              }))
                            );
                            if (fov == null && h == null && v == null) return '';
                            return ` · FOV ${fov != null ? `${fov.toFixed(1)}°` : '—'}`
                              + ` (H ${h != null ? h.toFixed(1) : '—'} / V ${v != null ? v.toFixed(1) : '—'})`;
                          })()}
                        </Typography>
                        {singleSamplesOnly.slice(-5).map((s, i) => (
                          <Typography key={s.id} variant="caption" display="block" color="text.secondary">
                            #{singleSamplesOnly.length - Math.min(5, singleSamplesOnly.length) + i + 1}
                            {s.waypointNumber != null ? ` Pos ${s.waypointNumber}` : ''}
                            {': '}
                            {s.fovH != null ? `H ${s.fovH.toFixed(1)}°` : 'H —'}
                            {' / '}
                            {s.fovV != null ? `V ${s.fovV.toFixed(1)}°` : 'V —'}
                            {` (ΔR ${s.dRot?.toFixed?.(1) ?? s.dRot}° ΔT ${s.dTilt?.toFixed?.(1) ?? s.dTilt}°)`}
                          </Typography>
                        ))}
                        <Button
                          sx={{ mt: 1 }}
                          fullWidth
                          size="small"
                          variant="contained"
                          disabled={calibrateBusy}
                          onClick={handleCalibrateSaveFov}
                        >
                          Median-FOV speichern (H=V)
                        </Button>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={4}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="subtitle1" gutterBottom>
                      Detection-Bild (Aim-Quelle)
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mb: 1, minHeight: 20 }}
                    >
                      Aim-Quelle: Fadenkreuz Mitte + Taube
                    </Typography>
                    <Box
                      sx={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '1',
                        bgcolor: '#000',
                        borderRadius: 1,
                        overflow: 'hidden'
                      }}
                    >
                      {detectionLargeUrl ? (
                        <Box
                          component="img"
                          src={detectionLargeUrl}
                          alt="Detection"
                          sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                        />
                      ) : (
                        <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                          <CircularProgress size={28} />
                        </Box>
                      )}
                      <CrosshairOverlay />
                      <ContainFitLayer
                        imgW={
                          detectionUsesZoomed
                            ? (zoneStatus?.image_info?.zoomed_size?.width || zoneStatus?.image_info?.original_size?.width || selected?.image_info?.zoomed_size?.width)
                            : (zoneStatus?.image_info?.original_size?.width || selected?.image_info?.original_size?.width)
                        }
                        imgH={
                          detectionUsesZoomed
                            ? (zoneStatus?.image_info?.zoomed_size?.height || zoneStatus?.image_info?.original_size?.height || selected?.image_info?.zoomed_size?.height)
                            : (zoneStatus?.image_info?.original_size?.height || selected?.image_info?.original_size?.height)
                        }
                      >
                        <TargetBirdFrame
                          targetBird={zoneStatus?.targetBird || selected?.target_bird}
                          imageInfo={zoneStatus?.image_info || selected?.image_info}
                          useZoomed={detectionUsesZoomed}
                        />
                        <TargetBirdCrosshair
                          targetBird={zoneStatus?.targetBird || selected?.target_bird}
                          imageInfo={zoneStatus?.image_info || selected?.image_info}
                          useZoomed={detectionUsesZoomed}
                        />
                        {showZones && (
                          <ZoneOverlay
                            laserZone={avail?.routeCoordinate?.laserZone}
                            zoomFactor={zoneStatus?.zoom_factor || selected?.zoom_factor || 1}
                            showLaser={!!avail?.routeCoordinate?.hasLaserZone}
                            showAudio
                            audioEnabled={!!avail?.routeCoordinate?.audioEnabled}
                          />
                        )}
                      </ContainFitLayer>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={4}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="subtitle1" gutterBottom>
                      Live-Bild <CrosshairIcon fontSize="inherit" sx={{ verticalAlign: 'middle' }} />
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mb: 1, minHeight: 20 }}
                    >
                      Klick zum Zielen
                      {calibrating ? ' (Kalibrierung: Taubenpunkt anklicken)' : ' · Pfeile für Impulse'}.
                    </Typography>
                    <Box
                      ref={liveBoxRef}
                      onClick={handleLiveAimClick}
                      sx={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '1',
                        bgcolor: '#000',
                        borderRadius: 1,
                        overflow: 'hidden',
                        cursor: livePose && !aiming && !executing && !nudging && !calibrateBusy ? 'crosshair' : 'default',
                        opacity: aiming || nudging || calibrateBusy ? 0.85 : 1
                      }}
                    >
                      {liveUrl ? (
                        <Box
                          component="img"
                          src={liveUrl}
                          alt="Live"
                          onLoad={(e) => {
                            liveNaturalRef.current = {
                              w: e.target.naturalWidth || 0,
                              h: e.target.naturalHeight || 0
                            };
                          }}
                          sx={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', display: 'block' }}
                        />
                      ) : (
                        <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                          <Typography variant="caption" color="grey.400">Live wird geladen…</Typography>
                        </Box>
                      )}
                      <CrosshairOverlay />
                      {aimMarker && (
                        <Box
                          sx={{
                            position: 'absolute',
                            left: aimMarker.x,
                            top: aimMarker.y,
                            width: 14,
                            height: 14,
                            ml: '-7px',
                            mt: '-7px',
                            borderRadius: '50%',
                            border: '2px solid #ffeb3b',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
                            pointerEvents: 'none',
                            zIndex: 4
                          }}
                        />
                      )}
                      {aiming && (
                        <Box
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: 'rgba(0,0,0,0.25)',
                            zIndex: 5,
                            pointerEvents: 'none'
                          }}
                        >
                          <CircularProgress size={28} color="inherit" sx={{ color: '#fff' }} />
                        </Box>
                      )}
                      <ContainFitLayer
                        imgW={
                          liveNaturalRef.current?.w
                          || (detectionUsesZoomed
                            ? zoneStatus?.image_info?.zoomed_size?.width
                            : zoneStatus?.image_info?.original_size?.width)
                        }
                        imgH={
                          liveNaturalRef.current?.h
                          || (detectionUsesZoomed
                            ? zoneStatus?.image_info?.zoomed_size?.height
                            : zoneStatus?.image_info?.original_size?.height)
                        }
                      >
                        {showZones && (
                          <ZoneOverlay
                            laserZone={avail?.routeCoordinate?.laserZone}
                            zoomFactor={zoneStatus?.zoom_factor || selected?.zoom_factor || 1}
                            showLaser={!!avail?.routeCoordinate?.hasLaserZone}
                            showAudio
                            audioEnabled={!!avail?.routeCoordinate?.audioEnabled}
                          />
                        )}
                      </ContainFitLayer>
                    </Box>
                    {livePose && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        Live-Pose R {livePose.rotation}° / T {livePose.tilt}°
                        {aiming ? ' — zielt…' : ''}
                        {nudging ? ' — bewegt…' : ''}
                      </Typography>
                    )}
                    <Box
                      sx={{
                        mt: 1.5,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.5
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                        Gerätesteuerung
                      </Typography>
                      <FormControl size="small" sx={{ minWidth: 88, mb: 0.5 }}>
                        <InputLabel id="nudge-deg-label">Schritt</InputLabel>
                        <Select
                          labelId="nudge-deg-label"
                          label="Schritt"
                          value={nudgeDegrees}
                          onChange={(e) => setNudgeDegrees(Number(e.target.value))}
                          disabled={!deviceId || aiming || executing || nudging}
                        >
                          <MenuItem value={1}>1°</MenuItem>
                          <MenuItem value={5}>5°</MenuItem>
                          <MenuItem value={10}>10°</MenuItem>
                        </Select>
                      </FormControl>
                      <IconButton
                        size="small"
                        color="primary"
                        disabled={!deviceId || aiming || executing || nudging}
                        onClick={() => handleNudge('move_up')}
                        aria-label="Hoch"
                      >
                        <ArrowUpIcon />
                      </IconButton>
                      <Box display="flex" gap={0.5} alignItems="center">
                        <IconButton
                          size="small"
                          color="primary"
                          disabled={!deviceId || aiming || executing || nudging}
                          onClick={() => handleNudge('rotate_left')}
                          aria-label="Links"
                        >
                          <ArrowLeftIcon />
                        </IconButton>
                        <Box sx={{ width: 36, height: 36 }} />
                        <IconButton
                          size="small"
                          color="primary"
                          disabled={!deviceId || aiming || executing || nudging}
                          onClick={() => handleNudge('rotate_right')}
                          aria-label="Rechts"
                        >
                          <ArrowRightIcon />
                        </IconButton>
                      </Box>
                      <IconButton
                        size="small"
                        color="primary"
                        disabled={!deviceId || aiming || executing || nudging}
                        onClick={() => handleNudge('move_down')}
                        aria-label="Runter"
                      >
                        <ArrowDownIcon />
                      </IconButton>
                      <Button
                        sx={{ mt: 1 }}
                        size="small"
                        variant="contained"
                        color="error"
                        startIcon={nudging ? <CircularProgress size={14} color="inherit" /> : <ShootIcon />}
                        disabled={
                          !deviceId
                          || aiming
                          || executing
                          || nudging
                          || (!useWater && !useLaser && !useAudio)
                        }
                        onClick={handleManualShoot}
                      >
                        Shoot
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}
        </>
      )}

      {mainTab === 'batch' && (
        <>
        <Grid container spacing={2} alignItems="flex-start">
          <Grid item xs={12} md={5}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Pos & Batchbearbeitung
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Bis zu 10 Detections einer Wegpunkt-Position automatisch kalibrieren.
                  Ergebnisse landen auf den Detection-Dokumenten; Median erst bei Speichern ins Gerät.
                </Typography>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Wegpunkt wählen
                </Typography>
                <Box
                  display="flex"
                  gap={1.25}
                  overflow="auto"
                  pb={1}
                  mb={2}
                  sx={{ minHeight: 118 }}
                >
                  {(routeThumbs.length ? routeThumbs : routeCoords.map((c, idx) => ({
                    number: idx + 1,
                    rotation: c.rotation,
                    tilt: c.tilt,
                    image: c.image
                  }))).map((t) => {
                    const thumb = toImageSrc(t.image);
                    const selected = String(batchWaypoint) === String(t.number);
                    return (
                      <Paper
                        key={t.number}
                        elevation={selected ? 4 : 1}
                        onClick={() => !calibrateBusy && setBatchWaypoint(String(t.number))}
                        sx={{
                          p: 0.75,
                          width: 104,
                          flexShrink: 0,
                          cursor: calibrateBusy ? 'default' : 'pointer',
                          border: '2px solid',
                          borderColor: selected ? 'primary.main' : 'transparent',
                          opacity: calibrateBusy ? 0.6 : 1,
                          bgcolor: selected ? 'action.selected' : 'background.paper'
                        }}
                      >
                        <Box
                          sx={{
                            width: '100%',
                            height: 64,
                            bgcolor: '#000',
                            borderRadius: 0.5,
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mb: 0.5
                          }}
                        >
                          {thumb ? (
                            <Box
                              component="img"
                              src={thumb}
                              alt={`Pos ${t.number}`}
                              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Typography variant="caption" color="grey.500">kein Bild</Typography>
                          )}
                        </Box>
                        <Typography variant="caption" fontWeight={700} display="block">
                          Pos {t.number}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap>
                          R {t.rotation}° / T {t.tilt}°
                        </Typography>
                      </Paper>
                    );
                  })}
                  {!routeThumbs.length && !routeCoords.length && (
                    <Typography variant="body2" color="text.secondary">
                      Keine Route-Wegpunkte am Gerät
                    </Typography>
                  )}
                </Box>

                {batchWaypoint !== '' && selectedRouteCoord && (
                  <Box mb={2} display="flex" gap={1.5} flexWrap="wrap" alignItems="center">
                    <Chip
                      size="small"
                      color="primary"
                      label={`Pos ${batchWaypoint}`}
                    />
                    <Chip
                      size="small"
                      label={`R ${selectedRouteCoord.rotation}° / T ${selectedRouteCoord.tilt}°`}
                    />
                    {selectedRouteThumb ? (
                      <Box
                        component="img"
                        src={selectedRouteThumb}
                        alt={`Wegpunkt ${batchWaypoint}`}
                        title={`Wegpunkt ${batchWaypoint}`}
                        sx={{
                          width: 120,
                          height: 90,
                          objectFit: 'cover',
                          borderRadius: 0.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          bgcolor: '#000'
                        }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Kein Wegpunkt-Bild gespeichert
                      </Typography>
                    )}
                    {batchFromPrior && (
                      <Chip size="small" variant="outlined" label="geladen aus gespeicherten Messungen" />
                    )}
                  </Box>
                )}

                <Button
                  fullWidth
                  variant="contained"
                  color="secondary"
                  disabled={
                    !deviceId
                    || executing
                    || aiming
                    || calibrateBusy
                    || batchWaypoint === ''
                  }
                  onClick={openBatchStartDialog}
                >
                  {batchProgress
                    ? `Batch ${batchProgress.current}/${batchProgress.total}…`
                    : 'FOV Batch starten…'}
                </Button>

                {batchProgress && (
                  <Box sx={{ mt: 1.5 }}>
                    <LinearProgress
                      variant="determinate"
                      value={batchProgress.total
                        ? (100 * batchProgress.current) / batchProgress.total
                        : 0}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {batchProgress.current}/{batchProgress.total}
                      {` · ok ${batchProgress.ok} · fail ${batchProgress.fail}`}
                    </Typography>
                  </Box>
                )}

                {calibrateReport && (
                  <CalibrateResultBanner
                    report={calibrateReport}
                    waypointNumber={calibrateReport.waypointNumber}
                    converged={calibrateReport.converged}
                    saved={calibrateReport.saved}
                  />
                )}

                {batchValidRows.length > 0 && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      Median über {batchValidRows.length} gültige Samples
                      {(() => {
                        const { fov, h, v } = medianFovFromBatchRows(batchRun);
                        if (fov == null && h == null && v == null) return '';
                        return `: FOV ${fov != null ? `${fov.toFixed(1)}°` : '—'}`
                          + ` (H ${h != null ? h.toFixed(1) : '—'} / V ${v != null ? v.toFixed(1) : '—'})`;
                      })()}
                    </Typography>
                    <Button
                      fullWidth
                      size="small"
                      variant="contained"
                      disabled={calibrateBusy}
                      onClick={handleCalibrateSaveFov}
                    >
                      FOV ins Gerät speichern (H=V)
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={7}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Batch-Liste
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  Alle Bilder mit gespeicherten Messdaten an dieser Pos (Batch, manuell, nach Schuss).
                  ok = automatisch gültig. Mit „Ungültig“ aus Statistik/Median nehmen — im Popup ebenso.
                </Typography>
                {batchRun.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Nach Pos-Auswahl oder Batch-Start erscheinen hier die Kandidaten.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: '70vh', overflow: 'auto', pr: 0.5 }}>
                    {batchRun.map((item) => (
                      <BatchRunRow
                        key={item.key}
                        item={item}
                        onOpen={openBatchDetail}
                        onToggleExcluded={toggleBatchExcluded}
                      />
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {showBatchAnalysis && <BatchAnalysisPanel items={batchRun} fromPrior={batchFromPrior} />}

        {mainTab === 'batch' && (
          <Box sx={{ mt: 2 }}>
            {allPosLoading && <LinearProgress sx={{ mb: 1 }} />}
            {!allPosLoading && allPosRun.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Keine gespeicherten Kalibrierungen über alle Positionen gefunden.
              </Typography>
            )}
            {allPosRun.some((r) => r.status === 'ok') && (
              <BatchAnalysisPanel items={allPosRun} fromPrior global />
            )}
          </Box>
        )}

        <BatchDetailDialog
          item={batchDetailItem}
          open={!!batchDetailItem}
          onClose={() => {
            cancelBatchManualCalibrate();
            setBatchDetailItem(null);
          }}
          onToggleExcluded={toggleBatchExcluded}
          onReplayCalibrated={replayCalibratedImage}
          replaying={batchReplayBusy}
          routeThumbs={routeThumbs}
          currentWaypoint={batchWaypoint}
          onAssignWaypoint={assignBatchWaypoint}
          assigningPos={batchAssignBusy}
          manualMode={batchManualMode}
          manualBusy={calibrateBusy && batchManualMode}
          onStartManual={startBatchManualCalibrate}
          onCancelManual={cancelBatchManualCalibrate}
          onSaveManual={saveBatchManualCalibrate}
          liveUrl={liveUrl}
          livePose={livePose}
          liveBoxRef={liveBoxRef}
          liveNaturalRef={liveNaturalRef}
          onLiveAimClick={handleLiveAimClick}
          aiming={aiming}
          nudging={nudging}
          nudgeDegrees={nudgeDegrees}
          onNudgeDegreesChange={setNudgeDegrees}
          onNudge={handleNudge}
          onJumpPose={handleJumpPose}
          calibrateMeta={calibrateMeta}
          aimMarker={aimMarker}
        />

        <Dialog open={batchStartOpen} onClose={() => !calibrateBusy && setBatchStartOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>FOV Batch starten</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Pos {batchWaypoint || '—'} — Anzahl und Umgang mit bereits kalibrierten Bildern wählen.
            </Typography>

            <FormControl fullWidth size="small" sx={{ mb: 2.5 }}>
              <InputLabel id="batch-count-label">Anzahl Bilder</InputLabel>
              <Select
                labelId="batch-count-label"
                label="Anzahl Bilder"
                value={batchStartCount}
                onChange={(e) => setBatchStartCount(Number(e.target.value))}
              >
                {[1, 2, 3, 5, 8, 10, 15, 20, 30].map((n) => (
                  <MenuItem key={n} value={n}>{n}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormLabel component="legend" sx={{ mb: 1 }}>Bilder-Auswahl</FormLabel>
            <RadioGroup
              value={batchStartBirdFilter}
              onChange={(e) => setBatchStartBirdFilter(e.target.value)}
              sx={{ mb: 2.5 }}
            >
              <FormControlLabel
                value="pigeon_and_unknown"
                control={<Radio />}
                label="Taube erkannt + unbekannt — CV-Taube, nicht als „keine Taube“ markiert"
              />
              <FormControlLabel
                value="confirmed_only"
                control={<Radio />}
                label="Nur erkannte Tauben — nur bestätigte Tauben (Tauben-Tinder)"
              />
              <FormControlLabel
                value="all"
                control={<Radio />}
                label="Alle — jedes Bild an dieser Pos (auch ohne Taube)"
              />
            </RadioGroup>

            <FormLabel component="legend" sx={{ mb: 1 }}>Bereits kalibrierte Messungen</FormLabel>
            <RadioGroup
              value={batchStartPriorMode}
              onChange={(e) => setBatchStartPriorMode(e.target.value)}
            >
              <FormControlLabel
                value="overwrite"
                control={<Radio />}
                label="Überschreiben — neueste N erneut kalibrieren"
              />
              <FormControlLabel
                value="skip"
                control={<Radio />}
                label="Überspringen — unter den neuesten N nur unkalibrierte (kann weniger werden)"
              />
              <FormControlLabel
                value="append"
                control={<Radio />}
                label="Überspringen & hinten anhängen — ältere unkalibrierte nachziehen bis N voll"
              />
            </RadioGroup>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setBatchStartOpen(false)}>Abbrechen</Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={() => handleCalibrateBatch({
                limit: batchStartCount,
                priorMode: batchStartPriorMode,
                birdFilter: batchStartBirdFilter
              })}
            >
              Start ({batchStartCount})
            </Button>
          </DialogActions>
        </Dialog>
        </>
      )}
    </Box>
  );

};

export default ShootTest;
