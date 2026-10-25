import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  FormControl,
  Select,
  MenuItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  LinearProgress,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  Tabs,
  Tab,
  Paper
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as DetectionIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Favorite as FavoriteIcon,
  Cancel as CancelIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Thermostat as ThermostatIcon,
  DeleteSweep as DeleteSweepIcon,
  ExpandMore as ExpandMoreIcon,
  WaterDrop as WaterDropIcon,
  FlashOn as FlashOnIcon,
  VolumeUp as VolumeUpIcon,
  Block as BlockIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import axios from 'axios';
import { toast } from 'react-toastify';
import { detectionSourceLabels } from '../utils/detectionSources';

function DetectionSourceChips({ detection, size = 'small' }) {
  const labels = detectionSourceLabels(detection);
  if (!labels.length) {
    return (
      <Typography variant="caption" color="text.secondary">—</Typography>
    );
  }
  return (
    <Box display="inline-flex" flexWrap="wrap" gap={0.5} alignItems="center">
      {labels.map((item) => (
        <Tooltip key={item.key} title={item.title}>
          <Chip
            size={size}
            label={item.label}
            color={item.key === 'master' ? 'primary' : 'secondary'}
            variant={item.key === 'master' ? 'filled' : 'outlined'}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

function formatDeltaSeconds(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  if (n < 60) return `${n} Sek`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m} Min ${s} Sek` : `${m} Min`;
}

function hasFovCalibration(cal) {
  return !!(cal && (
    cal.at
    || cal.fovH != null
    || cal.fovV != null
    || cal.finalPose?.rotation != null
  ));
}

function fovCalibrationChipProps(cal) {
  if (!hasFovCalibration(cal)) {
    return { label: '—', color: 'default', variant: 'outlined' };
  }
  if (cal.excluded) {
    return { label: 'ungültig', color: 'warning', variant: 'outlined' };
  }
  if (cal.manual || cal.method === 'manual' || cal.source === 'manual') {
    return { label: 'manuell', color: 'secondary', variant: 'filled' };
  }
  if (cal.source === 'post_shot') {
    return { label: 'nach Schuss', color: 'info', variant: 'outlined' };
  }
  if (cal.source === 'on_detection') {
    return { label: 'bei Erkennung', color: 'info', variant: 'outlined' };
  }
  if (cal.converged === false) {
    return { label: 'ja (offen)', color: 'warning', variant: 'filled' };
  }
  return { label: 'ja', color: 'success', variant: 'filled' };
}

function fmtPoseDeg(pose) {
  if (!pose || pose.rotation == null || pose.tilt == null) return null;
  return `R ${Number(pose.rotation).toFixed(0)}° / T ${Number(pose.tilt).toFixed(0)}°`;
}

function DuplicateThumb({ detectionId, birdBoxes, imageInfo, imageUrl, onLoadRequest, onOpen, caption, subcaption, borderColor }) {
  const rootRef = useRef(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!detectionId || imageUrl !== undefined || requestedRef.current) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      requestedRef.current = true;
      onLoadRequest(detectionId);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (requestedRef.current) return;
        requestedRef.current = true;
        onLoadRequest(detectionId);
        obs.disconnect();
      },
      { root: null, rootMargin: '120px', threshold: 0.01 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [detectionId, imageUrl, onLoadRequest]);

  const imgW = imageInfo?.zoomed_size?.width || imageInfo?.original_size?.width || 640;
  const imgH = imageInfo?.zoomed_size?.height || imageInfo?.original_size?.height || 640;

  return (
    <Box ref={rootRef} sx={{ width: 160, flexShrink: 0 }}>
      <Typography variant="caption" display="block" fontWeight={600} noWrap title={caption}>
        {caption}
      </Typography>
      {subcaption && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          {subcaption}
        </Typography>
      )}
      <Box
        onClick={() => onOpen?.(detectionId)}
        title="Große Ansicht öffnen"
        sx={{
          position: 'relative',
          width: 160,
          height: 160,
          bgcolor: '#000',
          borderRadius: 1,
          border: `2px solid ${borderColor || '#90a4ae'}`,
          overflow: 'hidden',
          cursor: onOpen ? 'pointer' : 'default'
        }}
      >
        {typeof imageUrl === 'string' && imageUrl ? (
          <>
            <Box
              component="img"
              src={imageUrl}
              alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
            {(birdBoxes || []).map((b, i) => {
              const left = (b.x1 / imgW) * 100;
              const top = (b.y1 / imgH) * 100;
              const width = ((b.x2 - b.x1) / imgW) * 100;
              const height = ((b.y2 - b.y1) / imgH) * 100;
              return (
                <Box
                  key={i}
                  sx={{
                    position: 'absolute',
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    border: '2px solid #ff1744',
                    boxSizing: 'border-box',
                    pointerEvents: 'none'
                  }}
                />
              );
            })}
          </>
        ) : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <Typography variant="caption" color="grey.400">
              {imageUrl === null ? 'Kein Bild' : 'Lädt…'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function formatTimeDiffAtPosition(seconds, direction) {
  if (seconds < 60) {
    const text = `${seconds} Sek`;
    return direction === 'before' ? `Vor ${text} an dieser Position erkannt` : `${text} danach erkannt`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const text = secs > 0 ? `${minutes} Min ${secs} Sek` : `${minutes} Min`;
  return direction === 'before' ? `Vor ${text} an dieser Position erkannt` : `${text} danach erkannt`;
}

function resolveShootActive(detection) {
  const active = detection?.shootActive;
  if (active && typeof active === 'object') {
    return {
      water: active.water === true,
      laser: active.laser === true,
      audio: active.audio === true,
      known: true
    };
  }
  if (detection?.shotFired === true) {
    return { water: true, laser: false, audio: false, known: true };
  }
  if (detection?.shotFired === false) {
    return { water: false, laser: false, audio: false, known: true };
  }
  return { water: false, laser: false, audio: false, known: false };
}

/** Compact icons for water / laser / audio (or „kein Schuss“). */
function ShootActiveIcons({ detection, size = 'small', sx }) {
  const flags = resolveShootActive(detection);
  if (!flags.known) {
    return (
      <Typography variant="caption" color="text.secondary" sx={sx}>—</Typography>
    );
  }

  const fontSize = size === 'small' ? 'small' : 'medium';
  const anyActive = flags.water || flags.laser || flags.audio;
  if (!anyActive) {
    return (
      <Box display="flex" alignItems="center" gap={0.25} sx={sx}>
        <Tooltip title="Kein Schuss">
          <BlockIcon fontSize={fontSize} color="disabled" />
        </Tooltip>
      </Box>
    );
  }

  const tankEmpty = flags.water && detection?.watertank === false;
  const waterTitle = tankEmpty
    ? 'Wasser geplant — Wassertank war leer'
    : detection?.watertank === true
      ? 'Wasser (Tank OK)'
      : 'Wasser';

  return (
    <Box display="flex" alignItems="center" gap={0.25} sx={sx}>
      {flags.water && (
        <Tooltip title={waterTitle}>
          <WaterDropIcon
            fontSize={fontSize}
            color={tankEmpty ? 'error' : 'info'}
            sx={tankEmpty ? { opacity: 0.95 } : undefined}
          />
        </Tooltip>
      )}
      {flags.laser && (
        <Tooltip title="Laser">
          <FlashOnIcon fontSize={fontSize} color="success" />
        </Tooltip>
      )}
      {flags.audio && (
        <Tooltip title="Audio">
          <VolumeUpIcon fontSize={fontSize} color="primary" />
        </Tooltip>
      )}
    </Box>
  );
}

// Renders thumbnail for a detection row; triggers load via onLoadRequest when imageUrl not yet loaded
function ThumbnailCell({ detectionId, imageUrl, onLoadRequest, onOpenDialog }) {
  useEffect(() => {
    if (detectionId && imageUrl === undefined) onLoadRequest(detectionId);
  }, [detectionId, imageUrl, onLoadRequest]);

  if (imageUrl === 'loading' || imageUrl === undefined) {
    return <Typography variant="caption" color="text.secondary">Lädt…</Typography>;
  }
  if (imageUrl === null || imageUrl === '') {
    return <Typography variant="caption" color="text.secondary">Kein Bild</Typography>;
  }
  if (typeof imageUrl === 'string') {
    return (
      <Box
        component="img"
        src={imageUrl}
        alt="Detection Thumbnail"
        sx={{
          width: 80,
          height: 80,
          objectFit: 'contain',
          display: 'block',
          borderRadius: 1,
          border: '1px solid #e0e0e0',
          cursor: 'pointer'
        }}
        onClick={onOpenDialog}
      />
    );
  }
  return <Typography variant="caption" color="text.secondary">Kein Bild</Typography>;
}

function CompanionPhotoCard({ photo, titlePrefix, cardKey }) {
  const src = photo?.image?.url;
  if (!src) return null;
  const titleParts = [
    titlePrefix,
    photo.cameraName || photo.cameraType,
    photo.role === 'master' ? 'Master' : photo.role === 'slave' ? 'Slave' : null
  ].filter(Boolean);
  return (
    <Card key={cardKey} sx={{ mb: 1.5 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="subtitle2" gutterBottom>
          {titleParts.join(' · ')}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Box
            component="img"
            src={src}
            alt={photo.cameraName || titlePrefix || 'Foto'}
            sx={{
              display: 'block',
              maxWidth: '100%',
              height: 'auto',
              border: '1px solid #e0e0e0',
              borderRadius: 1,
              backgroundColor: '#000'
            }}
          />
        </Box>
        {(photo.pose?.rotation != null || photo.pose?.tilt != null) && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
            Pose: Rot {photo.pose?.rotation ?? '–'}° / Tilt {photo.pose?.tilt ?? '–'}°
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

const MODEL_RUN_BOX_COLORS = ['#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', '#e91e63'];

/** Master/Slave scan + pre-shoot companions (mirrors Original as Master·Scan when needed). */
function buildCompanionPhotoGroups(detection) {
  const pre = Array.isArray(detection?.preShootPhotos) ? detection.preShootPhotos : [];
  const scan = Array.isArray(detection?.scanPhotos) ? detection.scanPhotos : [];
  const masterScanStored = scan.filter((p) => p?.role === 'master' && p?.image?.url);
  const masterPre = pre.filter((p) => p?.role === 'master' && p?.image?.url);
  const slavePhotos = [
    ...scan.filter((p) => p?.role !== 'master' && p?.image?.url).map((p) => ({ ...p, _kind: 'scan' })),
    ...pre.filter((p) => p?.role !== 'master' && p?.image?.url).map((p) => ({ ...p, _kind: 'pre' }))
  ];
  const masterPhotos = [
    ...masterScanStored.map((p) => ({ ...p, _kind: 'scan' })),
    ...masterPre.map((p) => ({ ...p, _kind: 'pre' }))
  ];
  const hasCompanions = slavePhotos.length > 0 || masterPre.length > 0 || masterScanStored.length > 0;
  if (hasCompanions && !masterScanStored.length && detection?.image?.url) {
    masterPhotos.unshift({
      _kind: 'scan',
      role: 'master',
      cameraName: detection.camera_source || 'Master',
      cameraType: detection.camera_source || 'master',
      image: { url: detection.image.url },
      pose: detection.camera_position
        ? {
            rotation: detection.camera_position.rotation,
            tilt: detection.camera_position.tilt
          }
        : undefined
    });
  }
  return { masterPhotos, slavePhotos };
}

/** All model runs for the Modelle tab (live + replay). */
function getModelRunsForTab(detection) {
  return (Array.isArray(detection?.model_runs) ? detection.model_runs : []).filter(Boolean);
}

const OVERVIEW_BOX = {
  confirmed: '#00e676',
  rejected: '#ff1744',
  unknown: '#9e9e9e'
};

/** Border style for Übersicht overlays: Main thicker; color by bird review / classification. */
function getOverviewDetectionBoxStyle(doc, det) {
  const mainBirdId =
    doc?.birds?.find((b) => b?.role === 'main')?.bird_id
    || doc?.target_bird?.bird_id
    || null;
  const isMain = Boolean(
    det?.is_target_bird
    || (mainBirdId && det?.bird_id && det.bird_id === mainBirdId)
  );

  let reviewStatus = null;
  if (det?.bird_id && Array.isArray(doc?.birds)) {
    const bird = doc.birds.find((b) => b && b.bird_id === det.bird_id);
    reviewStatus = bird?.review?.status || null;
  }
  if (!reviewStatus && isMain) {
    const cs = doc?.classification_status;
    if (cs === 'confirmed_pigeon' || cs === 'no_pigeon') reviewStatus = cs;
  }

  let color = OVERVIEW_BOX.unknown;
  if (reviewStatus === 'confirmed_pigeon') color = OVERVIEW_BOX.confirmed;
  else if (reviewStatus === 'no_pigeon') color = OVERVIEW_BOX.rejected;

  return {
    border: `${isMain ? 4 : 2}px solid ${color}`,
    pointerEvents: 'none',
    boxSizing: 'border-box'
  };
}

function birdReviewStatus(bird, doc) {
  const fromBird = bird?.review?.status;
  if (fromBird === 'confirmed_pigeon' || fromBird === 'no_pigeon') return fromBird;
  if (bird?.role === 'main') {
    const cs = doc?.classification_status;
    if (cs === 'confirmed_pigeon' || cs === 'no_pigeon') return cs;
  }
  return null;
}

function birdBoxForOverlay(bird, detection) {
  if (bird?.bbox && bird.bbox.x != null) return bird.bbox;
  const det = (detection?.detections || []).find((d) => d && d.bird_id && d.bird_id === bird?.bird_id);
  if (det?.bbox && det.bbox.x != null) return det.bbox;
  return null;
}

function birdOverlayPercents(bbox, detection) {
  if (!bbox || !detection?.image_info?.original_size) return null;
  const imgWidth = detection.image_info.original_size.width || 1;
  const imgHeight = detection.image_info.original_size.height || 1;
  let adjX = bbox.x;
  let adjY = bbox.y;
  if (detection.zoomed_image?.url && detection.image_info?.zoomed_size) {
    const zoomWidth = detection.image_info.zoomed_size.width || imgWidth;
    const zoomHeight = detection.image_info.zoomed_size.height || imgHeight;
    adjX = (imgWidth - zoomWidth) / 2 + bbox.x;
    adjY = (imgHeight - zoomHeight) / 2 + bbox.y;
  }
  return {
    left: (adjX / imgWidth) * 100,
    top: (adjY / imgHeight) * 100,
    width: ((bbox.width || 0) / imgWidth) * 100,
    height: ((bbox.height || 0) / imgHeight) * 100
  };
}

function BirdsReviewPanel({ detection, onUpdated, savingBirdId, setSavingBirdId }) {
  const birds = Array.isArray(detection?.birds) ? detection.birds.filter(Boolean) : [];
  const sorted = [...birds].sort((a, b) => {
    if (a.role === 'main' && b.role !== 'main') return -1;
    if (b.role === 'main' && a.role !== 'main') return 1;
    return String(a.bird_id || '').localeCompare(String(b.bird_id || ''));
  });

  const setStatus = async (birdId, status) => {
    if (!detection?._id || !birdId) return;
    setSavingBirdId(birdId);
    try {
      const response = await axios.patch(`/api/cv/detections/${detection._id}/bird-review`, {
        birdId,
        status
      });
      if (response.data?.detection) onUpdated(response.data.detection);
      toast.success(status === 'confirmed_pigeon' ? 'Als Taube gespeichert' : status === 'no_pigeon' ? 'Als keine Taube gespeichert' : 'Review zurückgesetzt');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSavingBirdId(null);
    }
  };

  if (!sorted.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        Noch keine Vogel-Einträge. Nach dem ersten Speichern (oder Tinder) erscheinen Main/Side hier.
      </Typography>
    );
  }

  const imgUrl = detection?.image?.url;
  const hasSize = Boolean(detection?.image_info?.original_size);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Nummern auf dem Foto entsprechen der Tabelle. Abgelehnte Nebentauben bleiben in der Liste —
        sie fallen nicht aus den Vögeln raus.
      </Typography>

      {imgUrl && (
        <Box
          sx={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            mb: 2.5,
            border: '1px solid #e0e0e0',
            borderRadius: 1,
            overflow: 'hidden',
            backgroundColor: '#000',
            lineHeight: 0
          }}
        >
          <Box
            component="img"
            src={imgUrl}
            alt="Vögel"
            sx={{ display: 'block', maxWidth: '100%', height: 'auto' }}
          />
          {hasSize && sorted.map((bird, index) => {
            const n = index + 1;
            const bbox = birdBoxForOverlay(bird, detection);
            const pct = birdOverlayPercents(bbox, detection);
            if (!pct) return null;
            const status = birdReviewStatus(bird, detection);
            const isMain = bird.role === 'main';
            const color = status === 'confirmed_pigeon'
              ? OVERVIEW_BOX.confirmed
              : status === 'no_pigeon'
                ? OVERVIEW_BOX.rejected
                : OVERVIEW_BOX.unknown;
            return (
              <Box
                key={`bird-overlay-${bird.bird_id}`}
                sx={{
                  position: 'absolute',
                  left: `${pct.left}%`,
                  top: `${pct.top}%`,
                  width: `${pct.width}%`,
                  height: `${pct.height}%`,
                  border: `${isMain ? 4 : 2}px solid ${color}`,
                  pointerEvents: 'none',
                  boxSizing: 'border-box'
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: 'translate(-15%, -15%)',
                    minWidth: 22,
                    height: 22,
                    px: 0.5,
                    borderRadius: '50%',
                    bgcolor: color,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: '22px',
                    textAlign: 'center',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.45)'
                  }}
                >
                  {n}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <Grid container spacing={2}>
        {sorted.map((bird, index) => {
          const n = index + 1;
          const status = birdReviewStatus(bird, detection);
          const isMain = bird.role === 'main';
          const busy = savingBirdId === bird.bird_id;
          const color = status === 'confirmed_pigeon'
            ? OVERVIEW_BOX.confirmed
            : status === 'no_pigeon'
              ? OVERVIEW_BOX.rejected
              : OVERVIEW_BOX.unknown;
          return (
            <Grid item xs={12} md={6} key={bird.bird_id}>
              <Paper variant="outlined" sx={{ p: 2, borderColor: color, borderWidth: isMain ? 2 : 1 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1.5 }}>
                  <Box
                    sx={{
                      minWidth: 28,
                      height: 28,
                      borderRadius: '50%',
                      bgcolor: color,
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 700,
                      lineHeight: '28px',
                      textAlign: 'center',
                      flexShrink: 0
                    }}
                  >
                    {n}
                  </Box>
                  <Chip
                    size="small"
                    label={isMain ? 'Main' : 'Side'}
                    color={isMain ? 'primary' : 'default'}
                    variant={isMain ? 'filled' : 'outlined'}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {bird.bird_id}
                  </Typography>
                  <Chip
                    size="small"
                    label={
                      status === 'confirmed_pigeon'
                        ? 'Taube'
                        : status === 'no_pigeon'
                          ? 'Keine Taube'
                          : 'Offen'
                    }
                    sx={{
                      bgcolor: status === 'confirmed_pigeon'
                        ? 'rgba(0,230,118,0.15)'
                        : status === 'no_pigeon'
                          ? 'rgba(255,23,68,0.12)'
                          : undefined,
                      borderColor: color
                    }}
                    variant="outlined"
                  />
                </Box>
                {bird.bbox && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                    BBox {Math.round(bird.bbox.x)},{Math.round(bird.bbox.y)} · {Math.round(bird.bbox.width)}×{Math.round(bird.bbox.height)}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  <Button
                    size="small"
                    variant={status === 'confirmed_pigeon' ? 'contained' : 'outlined'}
                    color="success"
                    disabled={busy}
                    startIcon={<FavoriteIcon />}
                    onClick={() => setStatus(bird.bird_id, 'confirmed_pigeon')}
                  >
                    Taube
                  </Button>
                  <Button
                    size="small"
                    variant={status === 'no_pigeon' ? 'contained' : 'outlined'}
                    color="error"
                    disabled={busy}
                    startIcon={<CancelIcon />}
                    onClick={() => setStatus(bird.bird_id, 'no_pigeon')}
                  >
                    Keine Taube
                  </Button>
                  <Button
                    size="small"
                    variant={status == null ? 'contained' : 'outlined'}
                    disabled={busy}
                    onClick={() => setStatus(bird.bird_id, null)}
                  >
                    Offen
                  </Button>
                  {busy && <CircularProgress size={20} sx={{ ml: 1 }} />}
                </Box>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

function ModelRunOverlayCard({ detection, run, color }) {
  const preferZoomed = run?.image === 'zoomed_image' && detection?.zoomed_image?.url;
  const imgSrc = preferZoomed
    ? detection.zoomed_image.url
    : (detection?.image?.url || detection?.zoomed_image?.url);
  const size = preferZoomed
    ? detection?.image_info?.zoomed_size
    : detection?.image_info?.original_size;
  const boxes = Array.isArray(run?.boxes) ? run.boxes : [];
  const modelName = run?.model?.name || run?.run_id || 'Modell';
  const imgW = size?.width || 1;
  const imgH = size?.height || 1;
  const mainBirdId =
    detection?.birds?.find((b) => b?.role === 'main')?.bird_id
    || detection?.target_bird?.bird_id
    || null;
  const MAIN_BIRD_COLOR = '#00e676';

  const confLabel = (box) => {
    if (box?.confidence == null) return '';
    const conf = Number(box.confidence);
    if (!Number.isFinite(conf)) return '';
    return ` ${(conf <= 1 ? conf * 100 : conf).toFixed(0)}%`;
  };

  const isMainBox = (box) => {
    if (mainBirdId && box?.bird_id && box.bird_id === mainBirdId) return true;
    if (!mainBirdId && box?.is_target_bird) return true;
    return false;
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {modelName}
          </Typography>
          <Chip size="small" label={run.kind || 'replay'} variant="outlined" />
          <Chip size="small" label={`${boxes.length} Box(en)`} />
          {run.at && (
            <Typography variant="caption" color="text.secondary">
              {new Date(run.at).toLocaleString()}
            </Typography>
          )}
        </Box>
        {!imgSrc ? (
          <Typography variant="body2" color="text.secondary">
            Kein Bild für diesen Lauf vorhanden.
          </Typography>
        ) : (
          <Box
            sx={{
              position: 'relative',
              display: 'inline-block',
              maxWidth: '100%',
              border: '1px solid #e0e0e0',
              borderRadius: 1,
              overflow: 'hidden',
              backgroundColor: '#000',
              lineHeight: 0
            }}
          >
            <Box
              component="img"
              src={imgSrc}
              alt={modelName}
              sx={{ display: 'block', maxWidth: '100%', height: 'auto' }}
            />
            {size && boxes.map((box, idx) => {
              const b = box?.bbox;
              if (!b || b.x == null || b.y == null) return null;
              const main = isMainBox(box);
              const boxColor = main ? MAIN_BIRD_COLOR : color;
              return (
                <Box
                  key={`${run.run_id}-box-${idx}`}
                  sx={{
                    position: 'absolute',
                    left: `${(b.x / imgW) * 100}%`,
                    top: `${(b.y / imgH) * 100}%`,
                    width: `${((b.width || 0) / imgW) * 100}%`,
                    height: `${((b.height || 0) / imgH) * 100}%`,
                    border: `2px solid ${boxColor}`,
                    pointerEvents: 'none',
                    boxSizing: 'border-box'
                  }}
                  title={`${main ? 'Main · ' : ''}${box.class || 'bird'}${confLabel(box)}`}
                />
              );
            })}
          </Box>
        )}
        {boxes.length > 0 && (
          <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {boxes.map((box, idx) => {
              const main = isMainBox(box);
              const boxColor = main ? MAIN_BIRD_COLOR : color;
              return (
                <Chip
                  key={`${run.run_id}-chip-${idx}`}
                  size="small"
                  sx={{
                    borderColor: boxColor,
                    ...(main
                      ? {
                          backgroundColor: 'rgba(0, 230, 118, 0.2)',
                          color: '#1b5e20',
                          fontWeight: 600,
                          border: `1px solid ${MAIN_BIRD_COLOR}`
                        }
                      : {})
                  }}
                  variant="outlined"
                  label={`${main ? 'Main · ' : ''}${box.class || 'bird'}${confLabel(box)}`}
                />
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

const Detections = () => {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    deviceId: '',
    dateFrom: '',
    dateTo: '',
    classificationStatus: '',
    cameraPosition: '' // Format: "rotation,tilt" z.B. "90,45"
  });
  // Positions from device routes: { device: { _id, name }, coordinates: [ { rotation, tilt, zoom, index } ] }
  const [positionsByDevice, setPositionsByDevice] = useState([]);
  const [classificationDialogOpen, setClassificationDialogOpen] = useState(false);
  const [detectionToClassify, setDetectionToClassify] = useState(null);
  const [pagination, setPagination] = useState({
    page: 0,
    pageSize: 20,
    total: 0
  });
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [selectedDetectionLoading, setSelectedDetectionLoading] = useState(false);
  const [detailTab, setDetailTab] = useState(0);
  const [birdReviewSavingId, setBirdReviewSavingId] = useState(null);
  const [deviceRouteCoordinates, setDeviceRouteCoordinates] = useState([]);
  const [cameraPositionSaving, setCameraPositionSaving] = useState(false);
  const [nearestAtPosition, setNearestAtPosition] = useState({ before: null, after: null });
  // Thumbnails loaded per row (id -> url string, or 'loading', or null for no image)
  const [imageByDetectionId, setImageByDetectionId] = useState({});
  const imageByDetectionIdRef = useRef({});
  imageByDetectionIdRef.current = imageByDetectionId;

  const [dupDialogOpen, setDupDialogOpen] = useState(false);
  const [dupWindowMinutes, setDupWindowMinutes] = useState(5);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupDeleting, setDupDeleting] = useState(false);
  const [dupPreview, setDupPreview] = useState(null);
  const imageLoadQueueRef = useRef({ pending: [], active: 0, maxConcurrent: 3 });

  const loadImageForDetection = useCallback((id) => {
    const idStr = typeof id === 'string' ? id : id?.toString?.();
    if (!idStr) return;
    if (imageByDetectionIdRef.current[idStr] !== undefined) return;

    const q = imageLoadQueueRef.current;
    if (q.pending.includes(idStr)) return;
    q.pending.push(idStr);

    const pump = () => {
      while (q.active < q.maxConcurrent && q.pending.length > 0) {
        const nextId = q.pending.shift();
        if (!nextId) break;
        if (imageByDetectionIdRef.current[nextId] !== undefined) continue;

        q.active += 1;
        setImageByDetectionId((prev) => {
          if (prev[nextId] !== undefined) return prev;
          return { ...prev, [nextId]: 'loading' };
        });

        axios
          .get(`/api/cv/detections/${nextId}/image`)
          .then((response) => {
            const url = response.data.zoomed_image?.url || response.data.image?.url || null;
            setImageByDetectionId((prev) => ({ ...prev, [nextId]: url }));
          })
          .catch(() => {
            setImageByDetectionId((prev) => ({ ...prev, [nextId]: null }));
          })
          .finally(() => {
            q.active = Math.max(0, q.active - 1);
            pump();
          });
      }
    };

    pump();
  }, []);

  useEffect(() => {
    if (!selectedDetection?.device?._id) {
      setDeviceRouteCoordinates([]);
      return;
    }
    let cancelled = false;
    axios.get(`/api/devices/${selectedDetection.device._id}`)
      .then((res) => {
        if (!cancelled) {
          const coords = res.data?.actions?.route?.coordinates || [];
          setDeviceRouteCoordinates(Array.isArray(coords) ? coords : []);
        }
      })
      .catch(() => {
        if (!cancelled) setDeviceRouteCoordinates([]);
      });
    return () => { cancelled = true; };
  }, [selectedDetection?.device?._id]);

  // Fetch nearest detection at same position (before/after) for "X min davor/danach" in dialog
  useEffect(() => {
    if (!selectedDetection) {
      setNearestAtPosition({ before: null, after: null });
      return;
    }
    const d = selectedDetection;
    const deviceId = d.device?._id ?? d.device;
    const pos = d.camera_position;
    if (!deviceId || pos?.rotation == null || pos?.tilt == null || !d.processedAt) {
      setNearestAtPosition({ before: null, after: null });
      return;
    }
    const processedAt = typeof d.processedAt === 'string' ? d.processedAt : d.processedAt?.toISO?.() ?? new Date(d.processedAt).toISOString();
    axios.get('/api/cv/detections/nearest-at-position', {
      params: { deviceId: String(deviceId), rotation: pos.rotation, tilt: pos.tilt, processedAt }
    })
      .then((res) => setNearestAtPosition({ before: res.data.before || null, after: res.data.after || null }))
      .catch(() => setNearestAtPosition({ before: null, after: null }));
  }, [selectedDetection]);

  const fetchPositionsFromRoutes = async () => {
    try {
      const response = await axios.get('/api/devices');
      const devices = response.data.devices || response.data || [];
      const byDevice = [];
      for (const dev of devices) {
        const coords = dev.actions?.route?.coordinates || [];
        const positions = coords
          .map((c, index) => ({ rotation: c.rotation, tilt: c.tilt, zoom: c.zoom, index }))
          .filter((c) => c.rotation !== undefined || c.tilt !== undefined);
        if (positions.length > 0) {
          byDevice.push({
            device: { _id: dev._id, name: dev.name || 'Unbekannt' },
            coordinates: positions
          });
        }
      }
      setPositionsByDevice(byDevice);
    } catch (error) {
      console.error('Error fetching positions from routes:', error);
    }
  };

  const detectionsFetchSeqRef = useRef(0);

  const fetchDetections = useCallback(async () => {
    const seq = ++detectionsFetchSeqRef.current;

    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(pagination.page + 1),
        limit: String(pagination.pageSize)
      });

      const deviceId = (filters.deviceId || '').trim();
      if (deviceId) params.append('deviceId', deviceId);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      if (filters.classificationStatus) params.append('classificationStatus', filters.classificationStatus);
      if (filters.cameraPosition) {
        const [rotation, tilt] = filters.cameraPosition.split(',');
        if (rotation) params.append('rotation', rotation);
        if (tilt) params.append('tilt', tilt);
      }

      const response = await axios.get(`/api/cv/detections?${params}`);
      // Ignore stale responses (date/filter changed while request was in flight)
      if (seq !== detectionsFetchSeqRef.current) return;

      setDetections(response.data.detections || []);
      setPagination(prev => ({
        ...prev,
        total: response.data.pagination?.total || 0
      }));
      setImageByDetectionId({});
    } catch (error) {
      if (seq !== detectionsFetchSeqRef.current) return;
      console.error('Error fetching detections:', error);
      const status = error.response?.status;
      // Don't spam for empty/not-found filter edge cases
      if (status && status < 500) {
        setDetections([]);
        setPagination(prev => ({ ...prev, total: 0 }));
        return;
      }
      toast.error(error.response?.data?.error || 'Fehler beim Laden der Erkennungen');
    } finally {
      if (seq === detectionsFetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [filters, pagination.page, pagination.pageSize]);

  useEffect(() => {
    fetchDetections();
    fetchPositionsFromRoutes();
  }, [fetchDetections]);

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
    setPagination(prev => ({
      ...prev,
      page: 0
    }));
  };

  const handleOpenImageDialog = async (detection) => {
    setImageDialogOpen(true);
    setDetailTab(0);
    setSelectedDetectionLoading(true);
    setSelectedDetection(null);
    try {
      const response = await axios.get(`/api/cv/detections/${detection._id}`);
      setSelectedDetection(response.data);
    } catch (error) {
      console.error('Error fetching detection detail:', error);
      toast.error('Fehler beim Laden der Erkennung');
      setImageDialogOpen(false);
    } finally {
      setSelectedDetectionLoading(false);
    }
  };

  const handleCloseImageDialog = () => {
    setImageDialogOpen(false);
    setSelectedDetection(null);
    setSelectedDetectionLoading(false);
    setDeviceRouteCoordinates([]);
    setDetailTab(0);
  };

  const handleCameraPositionChange = async (e) => {
    const value = e.target.value;
    if (value === '' || value === 'current' || !selectedDetection?._id) return;
    const index = Number(value);
    const coord = deviceRouteCoordinates[index];
    if (!coord || (coord.rotation === undefined && coord.tilt === undefined)) return;
    const rotation = coord.rotation ?? selectedDetection.camera_position?.rotation ?? 0;
    const tilt = coord.tilt ?? selectedDetection.camera_position?.tilt ?? 0;
    setCameraPositionSaving(true);
    try {
      const response = await axios.patch(`/api/cv/detections/${selectedDetection._id}`, {
        camera_position: { rotation, tilt }
      });
      setSelectedDetection((prev) => prev ? { ...prev, camera_position: response.data.camera_position } : null);
      setDetections((prev) => prev.map((d) => d._id === selectedDetection._id ? { ...d, camera_position: response.data.camera_position } : d));
      toast.success('Kamera-Position aktualisiert');
    } catch (err) {
      toast.error('Fehler beim Speichern der Kamera-Position');
    } finally {
      setCameraPositionSaving(false);
    }
  };

  const loadDetectionByIndex = useCallback(async (index) => {
    if (index < 0 || index >= detections.length) return;
    const lean = detections[index];
    setSelectedDetectionLoading(true);
    try {
      const response = await axios.get(`/api/cv/detections/${lean._id}`);
      setSelectedDetection(response.data);
    } catch (error) {
      console.error('Error fetching detection detail:', error);
      toast.error('Fehler beim Laden der Erkennung');
    } finally {
      setSelectedDetectionLoading(false);
    }
  }, [detections]);

  const handlePreviousDetection = useCallback(() => {
    if (!selectedDetection || detections.length === 0 || selectedDetectionLoading) return;
    const currentIndex = detections.findIndex((d) => d._id === selectedDetection._id);
    if (currentIndex > 0) {
      loadDetectionByIndex(currentIndex - 1);
    }
  }, [selectedDetection, detections, selectedDetectionLoading, loadDetectionByIndex]);

  const handleNextDetection = useCallback(() => {
    if (!selectedDetection || detections.length === 0 || selectedDetectionLoading) return;
    const currentIndex = detections.findIndex((d) => d._id === selectedDetection._id);
    if (currentIndex >= 0 && currentIndex < detections.length - 1) {
      loadDetectionByIndex(currentIndex + 1);
    }
  }, [selectedDetection, detections, selectedDetectionLoading, loadDetectionByIndex]);

  useEffect(() => {
    if (!imageDialogOpen) return undefined;

    const onKeyDown = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePreviousDetection();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextDetection();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageDialogOpen, handlePreviousDetection, handleNextDetection]);

  const currentDetectionIndex = selectedDetection 
    ? detections.findIndex(d => d._id === selectedDetection._id)
    : -1;

  const handleDeleteDetection = async (detection) => {
    if (!detection) return;

    const confirmDelete = window.confirm('Erkennung und zugehörige Bilder wirklich löschen?');
    if (!confirmDelete) return;

    try {
      await axios.delete(`/api/cv/detections/${detection._id}`);

      // Entferne lokal aus der Liste
      setDetections((prev) => prev.filter((d) => d._id !== detection._id));
      setPagination((prev) => ({
        ...prev,
        total: Math.max(0, (prev.total || 0) - 1)
      }));

      // Falls die aktuelle Detailansicht diese Erkennung zeigt, schließen
      if (selectedDetection && selectedDetection._id === detection._id) {
        handleCloseImageDialog();
      }
    } catch (error) {
      console.error('Error deleting detection:', error);
      alert('Fehler beim Löschen der Erkennung');
    }
  };

  const handleOpenDupDialog = () => {
    setDupPreview(null);
    setDupDialogOpen(true);
  };

  const handleCloseDupDialog = () => {
    if (dupDeleting) return;
    setDupDialogOpen(false);
  };

  const handleScanDuplicates = async () => {
    setDupLoading(true);
    setDupPreview(null);
    imageLoadQueueRef.current.pending = [];
    try {
      const params = new URLSearchParams();
      params.set('windowMinutes', String(dupWindowMinutes || 5));
      if (filters.deviceId) params.set('deviceId', filters.deviceId);
      const res = await axios.get(`/api/cv/detections/duplicates/preview?${params}`);
      setDupPreview(res.data);
      if (!res.data.groups?.length) {
        toast.info('Keine Duplikate gefunden');
      }
    } catch (error) {
      console.error('Duplicate preview error:', error);
      toast.error('Duplikat-Scan fehlgeschlagen');
    } finally {
      setDupLoading(false);
    }
  };

  const handleDeleteDuplicates = async () => {
    const ids = dupPreview?.duplicateIds || [];
    if (!ids.length) return;
    const ok = window.confirm(
      `${ids.length} doppelte Erkennung(en) wirklich löschen? Die jeweils erste („führende“) bleibt erhalten.`
    );
    if (!ok) return;
    setDupDeleting(true);
    try {
      const res = await axios.post('/api/cv/detections/duplicates/delete', { ids });
      toast.success(`${res.data.deleted} Duplikate gelöscht`);
      setDupDialogOpen(false);
      setDupPreview(null);
      await fetchDetections();
    } catch (error) {
      console.error('Duplicate delete error:', error);
      toast.error('Löschen der Duplikate fehlgeschlagen');
    } finally {
      setDupDeleting(false);
    }
  };

  const handleOpenClassificationDialog = (detection) => {
    setDetectionToClassify(detection);
    setClassificationDialogOpen(true);
  };

  const handleCloseClassificationDialog = () => {
    setClassificationDialogOpen(false);
    setDetectionToClassify(null);
  };

  const handleClassifyDetection = async (action) => {
    if (!detectionToClassify) return;

    try {
      if (action === 'delete') {
        await axios.delete(`/api/cv/detections/${detectionToClassify._id}`);
        toast.error('Erkennung gelöscht');
      } else {
        await axios.patch(`/api/cv/detections/${detectionToClassify._id}/classify`, {
          action: action
        });
        if (action === 'confirm_pigeon') {
          toast.success('Als Taube klassifiziert');
        } else {
          toast.warning('Als "Keine Taube" klassifiziert');
        }
      }
      
      // Aktualisiere die Liste
      await fetchDetections();
      handleCloseClassificationDialog();
      
      // Falls die aktuelle Detailansicht diese Erkennung zeigt, aktualisiere sie
      if (selectedDetection && selectedDetection._id === detectionToClassify._id) {
        await fetchDetections();
      }
    } catch (error) {
      console.error('Error classifying detection:', error);
      toast.error('Fehler beim Klassifizieren der Erkennung');
    }
  };

  const columns = [
    {
      field: 'image',
      headerName: 'Bild',
      width: 100,
      sortable: false,
      renderCell: (params) => {
        const idKey = params.row._id == null ? '' : (typeof params.row._id === 'string' ? params.row._id : params.row._id.toString?.() ?? String(params.row._id));
        return (
          <Box>
            <ThumbnailCell
              detectionId={idKey}
              imageUrl={imageByDetectionId[idKey]}
              onLoadRequest={loadImageForDetection}
              onOpenDialog={() => handleOpenImageDialog(params.row)}
            />
          </Box>
        );
      }
    },
    {
      field: 'device',
      headerName: 'Gerät',
      width: 200,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value?.name || 'Unbekannt'}
        </Typography>
      )
    },
    {
      field: 'shootActive',
      headerName: 'Schuss',
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <ShootActiveIcons detection={params.row} />
      )
    },
    {
      field: 'detection_authority',
      headerName: 'Erkennung',
      width: 140,
      sortable: false,
      renderCell: (params) => <DetectionSourceChips detection={params.row} />
    },
    {
      field: 'detections',
      headerName: 'Erkannte Objekte',
      width: 200,
      renderCell: (params) => (
        <Box>
          {params.value?.map((detection, index) => (
            <Chip
              key={index}
              label={`${detection.class} (${(detection.confidence * 100).toFixed(1)}%)`}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ mr: 0.5, mb: 0.5 }}
            />
          ))}
        </Box>
      )
    },
    {
      field: 'detection_count',
      headerName: 'Anzahl',
      width: 100,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.row.detections?.length || 0}
        </Typography>
      )
    },
    {
      field: 'processingTime',
      headerName: 'Verarbeitungszeit',
      width: 150,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value != null && params.value !== '' ? `${(Number(params.value) / 1000).toFixed(2)} s` : 'N/A'}
        </Typography>
      )
    },
    {
      field: 'processedAt',
      headerName: 'Zeitstempel',
      width: 180,
      renderCell: (params) => (
        <Typography variant="body2">
          {new Date(params.value).toLocaleString()}
        </Typography>
      )
    },
    {
      field: 'temperature',
      headerName: 'Temperatur',
      width: 120,
      renderCell: (params) => (
        <Box display="flex" alignItems="center" gap={0.5}>
          {params.value !== null && params.value !== undefined ? (
            <>
              <ThermostatIcon fontSize="small" color="action" />
              <Typography variant="body2">
                {params.value.toFixed(1)}°C
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              N/A
            </Typography>
          )}
        </Box>
      )
    },
    {
      field: 'camera_position',
      headerName: 'Kamera-Position',
      width: 200,
      renderHeader: () => (
        <Box display="flex" alignItems="center" gap={1} width="100%">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Kamera-Position
          </Typography>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <Select
              value={filters.deviceId && filters.cameraPosition ? `${filters.deviceId}:${filters.cameraPosition}` : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  // Clearing position also clears deviceId set by this dropdown
                  setFilters((prev) => ({ ...prev, cameraPosition: '', deviceId: '' }));
                  setPagination((prev) => ({ ...prev, page: 0 }));
                  return;
                }
                const colon = v.indexOf(':');
                const deviceId = colon >= 0 ? v.slice(0, colon) : '';
                const pos = colon >= 0 ? v.slice(colon + 1) : '';
                if (deviceId && pos) {
                  setFilters((prev) => ({ ...prev, deviceId, cameraPosition: pos }));
                  setPagination((prev) => ({ ...prev, page: 0 }));
                }
              }}
              displayEmpty
              sx={{ height: '32px', fontSize: '0.75rem' }}
              renderValue={(selected) => {
                if (!selected) return 'Alle Positionen';
                const [deviceId, pos] = selected.split(':');
                const [rotation, tilt] = (pos || '').split(',');
                const group = positionsByDevice.find((g) => String(g.device._id) === String(deviceId));
                const coord = group?.coordinates.find(
                  (c) => String(c.rotation) === String(rotation) && String(c.tilt) === String(tilt)
                );
                const num = coord ? coord.index + 1 : '';
                const deviceName = group?.device?.name || '';
                return deviceName && num ? `${deviceName} – Routenpunkt ${num}` : selected;
              }}
            >
              <MenuItem value="">Alle Positionen</MenuItem>
              {positionsByDevice.map((group) => [
                <ListSubheader key={`sh-${group.device._id}`} sx={{ lineHeight: 2 }}>
                  {group.device.name}
                </ListSubheader>,
                ...group.coordinates.map((coord) => {
                  const value = `${group.device._id}:${coord.rotation ?? ''},${coord.tilt ?? ''}`;
                  const label = `Routenpunkt ${coord.index + 1}`;
                  const zoomStr = coord.zoom != null ? ` (Zoom: ${coord.zoom}x)` : '';
                  return (
                    <MenuItem key={value} value={value} sx={{ pl: 3 }}>
                      {label}: R: {coord.rotation ?? '-'}° / T: {coord.tilt ?? '-'}°{zoomStr}
                    </MenuItem>
                  );
                })
              ])}
            </Select>
          </FormControl>
        </Box>
      ),
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value && params.value.rotation !== undefined && params.value.tilt !== undefined ? (
            `R: ${params.value.rotation}° / T: ${params.value.tilt}°`
          ) : (
            <span style={{ color: 'rgba(0, 0, 0, 0.6)' }}>N/A</span>
          )}
        </Typography>
      )
    },
    {
      field: 'model',
      headerName: 'Modell',
      width: 120,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value?.name || 'N/A'}
        </Typography>
      )
    },
    {
      field: 'classification_status',
      headerName: 'Klassifizierung',
      width: 150,
      renderCell: (params) => {
        const status = params.value;
        const handleClick = (e) => {
          e.stopPropagation();
          handleOpenClassificationDialog(params.row);
        };
        
        if (!status || status === 'unclassified') {
          return (
            <Chip 
              label="Unkategorisiert" 
              size="small" 
              variant="outlined" 
              onClick={handleClick}
              sx={{ cursor: 'pointer' }}
            />
          );
        } else if (status === 'confirmed_pigeon') {
          return (
            <Chip 
              label="Taube" 
              size="small" 
              color="success" 
              icon={<FavoriteIcon />}
              onClick={handleClick}
              sx={{ cursor: 'pointer' }}
            />
          );
        } else if (status === 'no_pigeon') {
          return (
            <Chip 
              label="Keine Taube" 
              size="small" 
              color="error" 
              icon={<CancelIcon />}
              onClick={handleClick}
              sx={{ cursor: 'pointer' }}
            />
          );
        }
        return (
          <Chip 
            label={status} 
            size="small" 
            variant="outlined"
            onClick={handleClick}
            sx={{ cursor: 'pointer' }}
          />
        );
      }
    },
    {
      field: 'fovCalibration',
      headerName: 'Kalibrierung',
      width: 130,
      sortable: false,
      renderCell: (params) => {
        const chip = fovCalibrationChipProps(params.row.fovCalibration);
        return <Chip size="small" {...chip} />;
      }
    },
    {
      field: 'actions',
      headerName: 'Aktionen',
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton
            size="small"
            onClick={() => handleOpenImageDialog(params.row)}
            color="primary"
            title="Details anzeigen"
          >
            <DetectionIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleDeleteDetection(params.row)}
            color="error"
            title="Erkennung löschen"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      )
    }
  ];

  return (
    <Box>
      {loading && <LinearProgress />}
      <Typography variant="h4" gutterBottom>
        Erkennungen
      </Typography>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Geräte-ID"
                value={filters.deviceId}
                onChange={(e) => handleFilterChange('deviceId', e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  )
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Von Datum"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Bis Datum"
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Button
                variant="outlined"
                startIcon={<FilterIcon />}
                onClick={fetchDetections}
                fullWidth
              >
                Filter anwenden
              </Button>
            </Grid>
            {(filters.dateFrom || filters.dateTo) && (
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Zeitraum: {filters.dateFrom || '…'} → {filters.dateTo || '…'}
                  {pagination.total != null ? ` · ${pagination.total.toLocaleString('de-DE')} Treffer` : ''}
                </Typography>
              </Grid>
            )}
            <Grid item xs={12} sm={6} md={3}>
              <Button
                variant="outlined"
                color="warning"
                startIcon={<DeleteSweepIcon />}
                onClick={handleOpenDupDialog}
                fullWidth
              >
                Duplikate prüfen
              </Button>
            </Grid>
            {/* Classification Status Filter Buttons */}
            <Grid item xs={12}>
              <Box display="flex" gap={1} flexWrap="wrap">
                <Button
                  variant={filters.classificationStatus === '' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', '')}
                  size="small"
                >
                  Alle
                </Button>
                <Button
                  variant={filters.classificationStatus === 'unclassified' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', 'unclassified')}
                  size="small"
                >
                  Unkategorisiert
                </Button>
                <Button
                  variant={filters.classificationStatus === 'confirmed_pigeon' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', 'confirmed_pigeon')}
                  size="small"
                  color="success"
                  startIcon={<FavoriteIcon />}
                >
                  Taube
                </Button>
                <Button
                  variant={filters.classificationStatus === 'no_pigeon' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', 'no_pigeon')}
                  size="small"
                  color="error"
                  startIcon={<CancelIcon />}
                >
                  Keine Taube
                </Button>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Detections Table */}
      <Card>
        <CardContent>
          <DataGrid
            rows={detections}
            columns={columns}
            loading={loading}
            getRowId={(row) => row._id}
            rowHeight={96}
            pageSizeOptions={[10, 20, 50]}
            paginationModel={{
              page: pagination.page,
              pageSize: pagination.pageSize
            }}
            onPaginationModelChange={(model) => {
              setPagination(prev => ({
                ...prev,
                page: model.page,
                pageSize: model.pageSize
              }));
            }}
            rowCount={pagination.total}
            paginationMode="server"
            disableRowSelectionOnClick
            initialState={{
              pagination: {
                paginationModel: { pageSize: 20 }
              }
            }}
          />
        </CardContent>
      </Card>

      {/* Image Dialog */}
      <Dialog
        open={imageDialogOpen}
        onClose={handleCloseImageDialog}
        maxWidth="lg"
        fullWidth
        sx={{ zIndex: (theme) => theme.zIndex.modal + 2 }}
      >
        <DialogTitle>
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={2}>
                <IconButton
                  onClick={handlePreviousDetection}
                  disabled={currentDetectionIndex <= 0}
                  size="small"
                  title="Vorheriges Bild"
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="h6">
                  Erkennungs-Bilder {selectedDetection && `(${currentDetectionIndex + 1} / ${detections.length})`}
                </Typography>
                <IconButton
                  onClick={handleNextDetection}
                  disabled={currentDetectionIndex >= detections.length - 1}
                  size="small"
                  title="Nächstes Bild"
                >
                  <ArrowForwardIcon />
                </IconButton>
              </Box>
              <IconButton onClick={handleCloseImageDialog} size="small">
                <CloseIcon />
              </IconButton>
            </Box>
            {selectedDetection && !selectedDetectionLoading && (
              <ShootActiveIcons detection={selectedDetection} size="medium" sx={{ mt: 1 }} />
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {/* Spinner only on initial open — keep content mounted while paging so scroll stays */}
          {selectedDetectionLoading && !selectedDetection ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
              <CircularProgress />
            </Box>
          ) : selectedDetection && (
            <Box
              sx={{
                opacity: selectedDetectionLoading ? 0.55 : 1,
                pointerEvents: selectedDetectionLoading ? 'none' : 'auto',
                transition: 'opacity 0.15s ease'
              }}
            >
              {(() => {
                const companions = buildCompanionPhotoGroups(selectedDetection);
                const cameraCount = companions.masterPhotos.length + companions.slavePhotos.length;
                const modelRuns = getModelRunsForTab(selectedDetection);
                const birdCount = Array.isArray(selectedDetection.birds) ? selectedDetection.birds.length : 0;
                return (
                  <Tabs
                    value={detailTab}
                    onChange={(_, v) => setDetailTab(v)}
                    sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Tab label="Übersicht" />
                    <Tab label={birdCount > 0 ? `Vögel (${birdCount})` : 'Vögel'} />
                    <Tab label={cameraCount > 0 ? `Kameras (${cameraCount})` : 'Kameras'} />
                    <Tab label={modelRuns.length > 0 ? `Modelle (${modelRuns.length})` : 'Modelle'} />
                  </Tabs>
                );
              })()}

              {detailTab === 0 && (
            <Grid
              container
              spacing={2}
            >
              {/* Top block: in-flow image defines height; details panel pinned to image edges on md+ */}
              <Grid item xs={12}>
                {selectedDetection.image?.url && (
                  <Typography variant="subtitle1" sx={{ mb: 0.75 }}>
                    Original-Bild
                  </Typography>
                )}
                <Box
                  sx={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' },
                    gap: { xs: 2, md: 0 }
                  }}
                >
                  {/* In-flow image only — its bottom edge is the row bottom */}
                  {selectedDetection.image?.url && (
                    <Box
                      sx={{
                        width: { xs: '100%', md: '58%' },
                        pr: { md: 2 },
                        lineHeight: 0,
                        boxSizing: 'border-box'
                      }}
                    >
                      <Box
                        sx={{
                          position: 'relative',
                          display: 'block',
                          width: '100%',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1,
                          overflow: 'visible',
                          backgroundColor: '#000'
                        }}
                      >
                        <Box
                          component="img"
                          src={selectedDetection.image.url}
                          alt="Original Detection"
                          sx={{
                            display: 'block',
                            width: '100%',
                            height: 'auto'
                          }}
                        />
                        {selectedDetection.image_info?.original_size &&
                          Array.isArray(selectedDetection.detections) &&
                          selectedDetection.detections.map((detection, index) => {
                            if (!detection.bbox) return null;

                            const { x, y, width, height } = detection.bbox;
                            const imgWidth = selectedDetection.image_info.original_size.width || 1;
                            const imgHeight = selectedDetection.image_info.original_size.height || 1;

                            let adjX = x;
                            let adjY = y;

                            if (selectedDetection.zoomed_image?.url && selectedDetection.image_info?.zoomed_size) {
                              const zoomWidth = selectedDetection.image_info.zoomed_size.width || imgWidth;
                              const zoomHeight = selectedDetection.image_info.zoomed_size.height || imgHeight;

                              const offsetX = (imgWidth - zoomWidth) / 2;
                              const offsetY = (imgHeight - zoomHeight) / 2;

                              adjX = offsetX + x;
                              adjY = offsetY + y;
                            }

                            const leftPct = (adjX / imgWidth) * 100;
                            const topPct = (adjY / imgHeight) * 100;
                            const widthPct = (width / imgWidth) * 100;
                            const heightPct = (height / imgHeight) * 100;

                            return (
                              <Box
                                key={`orig-bbox-${index}`}
                                sx={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${widthPct}%`,
                                  height: `${heightPct}%`,
                                  ...getOverviewDetectionBoxStyle(selectedDetection, detection)
                                }}
                              />
                            );
                          })}
                      </Box>
                    </Box>
                  )}

                  {/* md+: absolute top/right/bottom = flush with image edges */}
                  <Box
                    sx={{
                      position: { xs: 'relative', md: selectedDetection.image?.url ? 'absolute' : 'relative' },
                      top: { md: 0 },
                      right: { md: 0 },
                      bottom: { md: 0 },
                      width: {
                        xs: '100%',
                        md: selectedDetection.image?.url ? '42%' : '100%'
                      },
                      display: 'flex',
                      minHeight: 0
                    }}
                  >
                <Card
                  sx={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    overflow: 'hidden'
                  }}
                >
                  <CardContent
                    sx={{
                      pt: 1.5,
                      px: 1.5,
                      pb: 0,
                      '&:last-child': { pb: 0 },
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                      height: '100%',
                      boxSizing: 'border-box',
                      overflow: 'hidden'
                    }}
                  >
                    <Typography variant="subtitle1" sx={{ mb: 0.75, flexShrink: 0 }}>
                      Erkennungs-Details
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, mb: 1.25, flexShrink: 0 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                        Gerät: <strong>{selectedDetection.device?.name || 'Unbekannt'}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                        Zeitstempel: <strong>{new Date(selectedDetection.processedAt).toLocaleString()}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                        Verarbeitungszeit: <strong>{selectedDetection.processingTime != null && selectedDetection.processingTime !== '' ? `${(Number(selectedDetection.processingTime) / 1000).toFixed(2)} s` : 'N/A'}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                        Modell: <strong>{selectedDetection.model?.name || 'N/A'}</strong>
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                          Erkennung:
                        </Typography>
                        <DetectionSourceChips detection={selectedDetection} />
                      </Box>
                      {selectedDetection.temperature !== null && selectedDetection.temperature !== undefined && (
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                          Temperatur: <strong>{selectedDetection.temperature.toFixed(1)}°C</strong>
                        </Typography>
                      )}
                    </Box>

                    {resolveShootActive(selectedDetection).known && (
                      <Box sx={{ mb: 1.25, flexShrink: 0 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25, lineHeight: 1.35 }}>
                          Schuss-Aktionen
                        </Typography>
                        <ShootActiveIcons detection={selectedDetection} size="medium" />
                        {selectedDetection.shootActive?.water && selectedDetection.watertank === false && (
                          <Typography variant="caption" color="error" display="block" sx={{ mt: 0.25 }}>
                            Wassertank war leer — Wasser-Schuss vermutlich wirkungslos
                          </Typography>
                        )}
                        {selectedDetection.shootActive?.water && selectedDetection.watertank === true && (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                            Wassertank OK
                          </Typography>
                        )}
                      </Box>
                    )}

                    {(nearestAtPosition.before || nearestAtPosition.after) && (
                      <Box display="flex" flexWrap="wrap" gap={1} sx={{ mb: 1.25, flexShrink: 0 }}>
                        {nearestAtPosition.before && (
                          <Chip
                            icon={<ArrowBackIcon />}
                            label={formatTimeDiffAtPosition(nearestAtPosition.before.diffSeconds, 'before')}
                            size="small"
                            variant="outlined"
                            color="info"
                          />
                        )}
                        {nearestAtPosition.after && (
                          <Chip
                            icon={<ArrowForwardIcon />}
                            label={formatTimeDiffAtPosition(nearestAtPosition.after.diffSeconds, 'after')}
                            size="small"
                            variant="outlined"
                            color="info"
                          />
                        )}
                      </Box>
                    )}

                    {selectedDetection.camera_position && selectedDetection.camera_position.rotation !== undefined && selectedDetection.camera_position.tilt !== undefined && (
                      <Box sx={{ mb: 1.25, flexShrink: 0 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.35, lineHeight: 1.35 }}>
                          Kamera-Position (Routenpunkt, Zoom)
                        </Typography>
                        <FormControl size="small" fullWidth disabled={cameraPositionSaving}>
                          <Select
                            value={(() => {
                              const rot = selectedDetection.camera_position.rotation;
                              const tilt = selectedDetection.camera_position.tilt;
                              const idx = deviceRouteCoordinates.findIndex(
                                (c) => (c.rotation == null ? rot == null : c.rotation === rot) &&
                                  (c.tilt == null ? tilt == null : c.tilt === tilt)
                              );
                              return idx >= 0 ? idx : 'current';
                            })()}
                            onChange={handleCameraPositionChange}
                            displayEmpty
                            MenuProps={{
                              PaperProps: { sx: { maxHeight: 400 } }
                            }}
                            renderValue={(v) => {
                              if (v === 'current') {
                                const r = selectedDetection.camera_position.rotation;
                                const t = selectedDetection.camera_position.tilt;
                                const z = selectedDetection.zoom_factor ?? 1;
                                return `Aktuell: R: ${r}° / T: ${t}° / Zoom: ${z}x`;
                              }
                              const c = deviceRouteCoordinates[v];
                              if (!c) return '';
                              const imgSrc = c.image
                                ? (c.image.startsWith('data:') ? c.image : `data:image/jpeg;base64,${c.image}`)
                                : null;
                              const zoomStr = c.zoom != null ? ` / Zoom: ${c.zoom}x` : '';
                              return (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  {imgSrc && (
                                    <Box
                                      component="img"
                                      src={imgSrc}
                                      alt=""
                                      sx={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 0.5 }}
                                    />
                                  )}
                                  <span>Position {Number(v) + 1}: R: {c.rotation ?? '-'}° / T: {c.tilt ?? '-'}°{zoomStr}</span>
                                </Box>
                              );
                            }}
                          >
                            <MenuItem value="current">
                              Aktuell: R: {selectedDetection.camera_position.rotation}° / T: {selectedDetection.camera_position.tilt}° / Zoom: {(selectedDetection.zoom_factor ?? 1)}x
                            </MenuItem>
                            {deviceRouteCoordinates.map((coord, idx) => {
                              const imgSrc = coord.image
                                ? (coord.image.startsWith('data:') ? coord.image : `data:image/jpeg;base64,${coord.image}`)
                                : null;
                              const zoomStr = coord.zoom != null ? ` / Zoom: ${coord.zoom}x` : '';
                              return (
                                <MenuItem key={idx} value={idx}>
                                  <ListItemIcon sx={{ minWidth: 56 }}>
                                    {imgSrc ? (
                                      <Box
                                        component="img"
                                        src={imgSrc}
                                        alt=""
                                        sx={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 0.5 }}
                                      />
                                    ) : (
                                      <Box sx={{ width: 48, height: 36, bgcolor: 'action.hover', borderRadius: 0.5 }} />
                                    )}
                                  </ListItemIcon>
                                  <ListItemText
                                    primary={`Position ${idx + 1}: R: ${coord.rotation ?? '-'}° / T: ${coord.tilt ?? '-'}°${zoomStr}`}
                                  />
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </FormControl>
                      </Box>
                    )}

                    <Box sx={{ mb: 1.25, flexShrink: 0 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.35, lineHeight: 1.35 }}>
                        FOV-Kalibrierung
                      </Typography>
                      {(() => {
                        const cal = selectedDetection.fovCalibration;
                        if (!hasFovCalibration(cal)) {
                          return (
                            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                              Keine Kalibrierung gespeichert
                            </Typography>
                          );
                        }
                        const chip = fovCalibrationChipProps(cal);
                        const dRot = (cal.finalPose && cal.scanPose)
                          ? Number(cal.finalPose.rotation) - Number(cal.scanPose.rotation)
                          : null;
                        const dTilt = (cal.finalPose && cal.scanPose)
                          ? Number(cal.finalPose.tilt) - Number(cal.scanPose.tilt)
                          : null;
                        const dH = (cal.fovH != null && cal.fovSollH != null)
                          ? Number(cal.fovH) - Number(cal.fovSollH)
                          : null;
                        const dV = (cal.fovV != null && cal.fovSollV != null)
                          ? Number(cal.fovV) - Number(cal.fovSollV)
                          : null;
                        return (
                          <Box>
                            <Box display="flex" flexWrap="wrap" gap={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                              <Chip size="small" {...chip} />
                              {cal.converged === true && (
                                <Chip size="small" label="konvergiert" color="success" variant="outlined" />
                              )}
                              {cal.converged === false && (
                                <Chip size="small" label="nicht konvergiert" color="warning" variant="outlined" />
                              )}
                              {cal.waypointNumber != null && (
                                <Chip size="small" label={`Pos ${cal.waypointNumber}`} variant="outlined" />
                              )}
                            </Box>
                            <Typography variant="body2" sx={{ lineHeight: 1.35 }}>
                              FOV Ist
                              {cal.fovH != null ? ` H ${Number(cal.fovH).toFixed(1)}°` : ' H —'}
                              {cal.fovV != null ? ` / V ${Number(cal.fovV).toFixed(1)}°` : ' / V —'}
                            </Typography>
                            {(cal.fovSollH != null || cal.fovSollV != null) && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.35 }}>
                                Soll
                                {cal.fovSollH != null ? ` H ${Number(cal.fovSollH).toFixed(1)}°` : ''}
                                {cal.fovSollV != null ? ` / V ${Number(cal.fovSollV).toFixed(1)}°` : ''}
                                {dH != null ? ` · ΔH ${dH.toFixed(1)}°` : ''}
                                {dV != null ? ` ΔV ${dV.toFixed(1)}°` : ''}
                              </Typography>
                            )}
                            {(fmtPoseDeg(cal.scanPose) || fmtPoseDeg(cal.finalPose)) && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.35 }}>
                                Pose
                                {fmtPoseDeg(cal.scanPose) ? ` ${fmtPoseDeg(cal.scanPose)}` : ''}
                                {fmtPoseDeg(cal.finalPose) ? ` → ${fmtPoseDeg(cal.finalPose)}` : ''}
                                {(dRot != null || dTilt != null)
                                  ? ` · ΔR ${dRot != null ? dRot.toFixed(1) : '—'}° / ΔT ${dTilt != null ? dTilt.toFixed(1) : '—'}°`
                                  : ''}
                              </Typography>
                            )}
                            {cal.offsetPx && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.35 }}>
                                Offset {Number(cal.offsetPx.x).toFixed(1)} / {Number(cal.offsetPx.y).toFixed(1)} px
                              </Typography>
                            )}
                            {cal.residualPx && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.35 }}>
                                Residual {Number(cal.residualPx.x).toFixed(1)} / {Number(cal.residualPx.y).toFixed(1)} px
                              </Typography>
                            )}
                            {cal.at && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.35 }}>
                                Kalibriert: {new Date(cal.at).toLocaleString()}
                              </Typography>
                            )}
                          </Box>
                        );
                      })()}
                    </Box>

                    <Box
                      sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0
                      }}
                    >
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5, lineHeight: 1.35, flexShrink: 0 }}>
                        Erkannte Objekte
                      </Typography>
                      <Box
                        sx={{
                          flex: 1,
                          minHeight: 72,
                          overflowY: 'auto',
                          pr: 0.5,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1
                        }}
                      >
                        {selectedDetection.detections?.map((detection, index) => (
                          <Card
                            key={index}
                            variant="outlined"
                            sx={{
                              p: 1.25,
                              flexShrink: 0,
                              borderWidth: detection.is_target_bird ? 2 : 1,
                              borderColor: detection.is_target_bird ? 'primary.main' : 'divider'
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" sx={{ mb: 0.5 }}>
                              <Chip label={`${detection.class}`} size="small" color="primary" />
                              <Chip
                                label={`${(detection.confidence * 100).toFixed(1)}%`}
                                size="small"
                                color="success"
                                variant="outlined"
                              />
                              {detection.is_target_bird && (
                                <Chip label="Zielvogel" size="small" color="primary" />
                              )}
                              {detection.size_category && (
                                <Chip label={detection.size_category} size="small" variant="outlined" />
                              )}
                            </Box>
                            {(detection.esp_rot != null || detection.esp_tilt != null) && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>
                                Move: Rot {detection.esp_rot ?? '–'}°, Tilt {detection.esp_tilt ?? '–'}°
                              </Typography>
                            )}
                            {detection.bbox && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>
                                BBox: {detection.bbox.x},{detection.bbox.y} · {detection.bbox.width}×{detection.bbox.height} px
                              </Typography>
                            )}
                            {detection.position && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>
                                Zentrum: ({detection.position.center_x?.toFixed(1)}, {detection.position.center_y?.toFixed(1)})
                                {' · '}
                                Rel: {(detection.position.width * 100)?.toFixed(1)}% × {(detection.position.height * 100)?.toFixed(1)}%
                              </Typography>
                            )}
                          </Card>
                        ))}
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
                  </Box>
                </Box>
                {selectedDetection.image?.url && selectedDetection.image_info?.original_size && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mt: 1 }}
                  >
                    Größe: {selectedDetection.image_info.original_size.width} x{' '}
                    {selectedDetection.image_info.original_size.height}
                  </Typography>
                )}
              </Grid>

              {/* Zoomed image below the Original | Details row */}
              {selectedDetection.zoomed_image?.url && ((Number(selectedDetection.zoom_factor) || 1) > 1) && (
                <Grid item xs={12} md={7}>
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Gezoomtes Bild {selectedDetection.zoom_factor && `(${selectedDetection.zoom_factor}x)`}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <Box
                        sx={{
                          position: 'relative',
                          display: 'inline-block',
                          maxWidth: '100%',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1,
                          overflow: 'visible',
                          backgroundColor: '#000'
                        }}
                      >
                        <Box
                          component="img"
                          src={selectedDetection.zoomed_image.url}
                          alt="Zoomed Detection"
                          sx={{
                            display: 'block',
                            maxWidth: '100%',
                            height: 'auto',
                            verticalAlign: 'middle'
                          }}
                        />
                        {selectedDetection.image_info?.zoomed_size &&
                          Array.isArray(selectedDetection.detections) &&
                          selectedDetection.detections.map((detection, index) => {
                            if (!detection.position) return null;

                            const { center_x, center_y, width, height } = detection.position;

                            const imgWidth = selectedDetection.image_info.zoomed_size.width || 1;
                            const imgHeight = selectedDetection.image_info.zoomed_size.height || 1;

                            const bboxWidth = width || 0;
                            const bboxHeight = height || 0;
                            const bboxLeft = (center_x || 0) - bboxWidth / 2;
                            const bboxTop = (center_y || 0) - bboxHeight / 2;

                            const leftPct = (bboxLeft / imgWidth) * 100;
                            const topPct = (bboxTop / imgHeight) * 100;
                            const wPct = (bboxWidth / imgWidth) * 100;
                            const hPct = (bboxHeight / imgHeight) * 100;

                            return (
                              <Box
                                key={`zoom-bbox-${index}`}
                                sx={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${wPct}%`,
                                  height: `${hPct}%`,
                                  ...getOverviewDetectionBoxStyle(selectedDetection, detection)
                                }}
                              />
                            );
                          })}
                      </Box>
                      </Box>
                      {selectedDetection.image_info?.zoomed_size && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mt: 1 }}
                        >
                          Größe: {selectedDetection.image_info.zoomed_size.width} x{' '}
                          {selectedDetection.image_info.zoomed_size.height}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              )}

              {/* Bottom companions moved to Kameras tab */}
            </Grid>
              )}

              {detailTab === 1 && (
                <BirdsReviewPanel
                  detection={selectedDetection}
                  savingBirdId={birdReviewSavingId}
                  setSavingBirdId={setBirdReviewSavingId}
                  onUpdated={(next) => {
                    setSelectedDetection(next);
                    setDetections((prev) => prev.map((d) => (
                      d._id === next._id
                        ? {
                          ...d,
                          classification_status: next.classification_status,
                          classifiedAt: next.classifiedAt,
                          birds: next.birds,
                          target_bird: next.target_bird
                        }
                        : d
                    )));
                  }}
                />
              )}

              {detailTab === 2 && (() => {
                const { masterPhotos, slavePhotos } = buildCompanionPhotoGroups(selectedDetection);
                if (!masterPhotos.length && !slavePhotos.length) {
                  return (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      Keine zusätzlichen Kamera-Fotos (Scan / vor Vertreibung) für diese Erkennung.
                    </Typography>
                  );
                }
                return (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        Master
                      </Typography>
                      {masterPhotos.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          Keine zusätzlichen Master-Fotos
                        </Typography>
                      ) : (
                        masterPhotos.map((photo, idx) => (
                          <CompanionPhotoCard
                            key={`master-${photo.cameraId || idx}-${photo._kind}`}
                            photo={photo}
                            titlePrefix={photo._kind === 'scan' ? 'Scan' : 'Foto vor Vertreibung'}
                            cardKey={`master-${idx}`}
                          />
                        ))
                      )}
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        Slave
                      </Typography>
                      {slavePhotos.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          Keine Slave-Fotos
                        </Typography>
                      ) : (
                        slavePhotos.map((photo, idx) => (
                          <CompanionPhotoCard
                            key={`slave-${photo.cameraId || idx}-${photo._kind}`}
                            photo={photo}
                            titlePrefix={photo._kind === 'scan' ? 'Scan' : 'Foto vor Vertreibung'}
                            cardKey={`slave-${idx}`}
                          />
                        ))
                      )}
                    </Grid>
                  </Grid>
                );
              })()}

              {detailTab === 3 && (() => {
                const modelRuns = getModelRunsForTab(selectedDetection);
                if (!modelRuns.length) {
                  return (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      Noch keine Modell-Läufe für diese Erkennung.
                    </Typography>
                  );
                }
                return (
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Live- und Replay-Läufe mit Boxen auf dem jeweiligen Bild.
                    </Typography>
                    {modelRuns.map((run, idx) => (
                      <ModelRunOverlayCard
                        key={run.run_id || `run-${idx}`}
                        detection={selectedDetection}
                        run={run}
                        color={MODEL_RUN_BOX_COLORS[idx % MODEL_RUN_BOX_COLORS.length]}
                      />
                    ))}
                  </Box>
                );
              })()}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseImageDialog}>
            Schließen
          </Button>
          {selectedDetection && (
            <Button
              color="error"
              onClick={() => handleDeleteDetection(selectedDetection)}
            >
              Erkennung löschen
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Duplicate cleanup dialog (dry-run + delete) */}
      <Dialog
        open={dupDialogOpen}
        onClose={handleCloseDupDialog}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>Doppelte Erkennungen</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" paragraph>
            Gleiche Position (Rot/Tilt), innerhalb des Zeitfensters, überlappende Vogel-Bounding-Box.
            Die erste Erkennung bleibt; spätere werden als Duplikat vorgeschlagen.
            {filters.deviceId ? ' Filter: aktuelles Gerät.' : ''}
          </Typography>
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" mb={2}>
            <TextField
              label="Fenster (Minuten)"
              type="number"
              size="small"
              value={dupWindowMinutes}
              onChange={(e) => setDupWindowMinutes(Math.max(0.5, Number(e.target.value) || 5))}
              inputProps={{ min: 0.5, max: 60, step: 0.5 }}
              sx={{ width: 160 }}
            />
            <Button
              variant="contained"
              onClick={handleScanDuplicates}
              disabled={dupLoading || dupDeleting}
              startIcon={dupLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
            >
              Dry-Run starten
            </Button>
          </Box>

          {dupPreview && (
            <Box mb={2}>
              <Typography variant="body2">
                Gescannt: {dupPreview.scanned} · Gruppen: {dupPreview.groups?.length || 0} · zu löschen:{' '}
                <strong>{dupPreview.totalDuplicates || 0}</strong>
              </Typography>
            </Box>
          )}

          {dupPreview?.groups?.length > 0 && (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="caption" color="text.secondary">
                Gruppen aufklappen, um Vorschaubilder zu laden (max. 3 parallel — vermeidet 429).
              </Typography>
              {dupPreview.groups.map((group, groupIndex) => {
                const keepId = group.keep?._id?.toString?.() || group.keep?._id;
                return (
                  <Accordion
                    key={keepId}
                    disableGutters
                    defaultExpanded={groupIndex < 2}
                    TransitionProps={{ unmountOnExit: true }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">
                        {group.deviceName || 'Gerät'} · R: {group.rotation}° / T: {group.tilt}° ·{' '}
                        {group.duplicates.length} Duplikat{group.duplicates.length === 1 ? '' : 'e'}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box display="flex" gap={2} flexWrap="wrap" alignItems="flex-start">
                        <DuplicateThumb
                          detectionId={keepId}
                          birdBoxes={group.keep.birdBoxes}
                          imageInfo={group.keep.image_info}
                          imageUrl={imageByDetectionId[keepId]}
                          onLoadRequest={loadImageForDetection}
                          onOpen={(id) => handleOpenImageDialog({ _id: id })}
                          caption="Behalten (führend)"
                          subcaption={
                            group.keep.processedAt
                              ? new Date(group.keep.processedAt).toLocaleString()
                              : ''
                          }
                          borderColor="#2e7d32"
                        />
                        {group.duplicates.map((dup) => {
                          const dupId = dup._id?.toString?.() || dup._id;
                          return (
                            <DuplicateThumb
                              key={dupId}
                              detectionId={dupId}
                              birdBoxes={dup.birdBoxes}
                              imageInfo={dup.image_info}
                              imageUrl={imageByDetectionId[dupId]}
                              onLoadRequest={loadImageForDetection}
                              onOpen={(id) => handleOpenImageDialog({ _id: id })}
                              caption={`Löschen · Δt ${formatDeltaSeconds(dup.deltaSeconds)}`}
                              subcaption={
                                dup.processedAt
                                  ? new Date(dup.processedAt).toLocaleString()
                                  : ''
                              }
                              borderColor="#c62828"
                            />
                          );
                        })}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDupDialog} disabled={dupDeleting}>
            Schließen
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!dupPreview?.duplicateIds?.length || dupLoading || dupDeleting}
            onClick={handleDeleteDuplicates}
            startIcon={dupDeleting ? <CircularProgress size={16} color="inherit" /> : <DeleteSweepIcon />}
          >
            {dupPreview?.totalDuplicates || 0} Duplikate löschen
          </Button>
        </DialogActions>
      </Dialog>

      {/* Classification Dialog */}
      <Dialog
        open={classificationDialogOpen}
        onClose={handleCloseClassificationDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Zuordnung anpassen
        </DialogTitle>
        <DialogContent>
          {detectionToClassify && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Aktuelle Zuordnung:
              </Typography>
              <Box mb={3}>
                {!detectionToClassify.classification_status || detectionToClassify.classification_status === 'unclassified' ? (
                  <Chip label="Unkategorisiert" variant="outlined" />
                ) : detectionToClassify.classification_status === 'confirmed_pigeon' ? (
                  <Chip label="Taube" color="success" icon={<FavoriteIcon />} />
                ) : (
                  <Chip label="Keine Taube" color="error" icon={<CancelIcon />} />
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Neue Zuordnung wählen:
              </Typography>
              <Box display="flex" flexDirection="column" gap={2} mt={2}>
                <Button
                  variant={detectionToClassify.classification_status === 'confirmed_pigeon' ? 'contained' : 'outlined'}
                  color="success"
                  startIcon={<FavoriteIcon />}
                  onClick={() => handleClassifyDetection('confirm_pigeon')}
                  fullWidth
                >
                  Taube
                </Button>
                <Button
                  variant={detectionToClassify.classification_status === 'no_pigeon' ? 'contained' : 'outlined'}
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={() => handleClassifyDetection('no_pigeon')}
                  fullWidth
                >
                  Keine Taube
                </Button>
                <Button
                  variant={!detectionToClassify.classification_status || detectionToClassify.classification_status === 'unclassified' ? 'contained' : 'outlined'}
                  onClick={() => handleClassifyDetection('unclassified')}
                  fullWidth
                >
                  Unkategorisiert
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => handleClassifyDetection('delete')}
                  fullWidth
                >
                  Erkennung löschen
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseClassificationDialog}>
            Abbrechen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Detections;
