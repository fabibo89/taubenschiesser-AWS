import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  CircularProgress,
  Tooltip,
  Tabs,
  Tab,
  Paper
} from '@mui/material';
import {
  Close as CloseIcon,
  Favorite as FavoriteIcon,
  Cancel as CancelIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  WaterDrop as WaterDropIcon,
  FlashOn as FlashOnIcon,
  VolumeUp as VolumeUpIcon,
  Block as BlockIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import { detectionSourceLabels } from '../utils/detectionSources';

export function DetectionSourceChips({ detection, size = 'small' }) {
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

export function hasFovCalibration(cal) {
  return !!(cal && (
    cal.at
    || cal.fovH != null
    || cal.fovV != null
    || cal.finalPose?.rotation != null
  ));
}

export function fovCalibrationChipProps(cal) {
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
export function ShootActiveIcons({ detection, size = 'small', sx }) {
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

/**
 * Detail dialog „Erkennungs-Bilder“ (Übersicht / Vögel / Kameras / Modelle).
 * Loads the full detection via GET /api/cv/detections/:id.
 */
function DetectionDetailDialog({ open, detectionId, neighborIds, onClose, onDeleted, onUpdated }) {
  // Prev/next navigation overrides detectionId only for the id it was started from.
  const [navState, setNavState] = useState({ forId: null, id: null });
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [selectedDetectionLoading, setSelectedDetectionLoading] = useState(false);
  const [detailTab, setDetailTab] = useState(0);
  const [birdReviewSavingId, setBirdReviewSavingId] = useState(null);
  const [deviceRouteCoordinates, setDeviceRouteCoordinates] = useState([]);
  const [cameraPositionSaving, setCameraPositionSaving] = useState(false);
  const [nearestAtPosition, setNearestAtPosition] = useState({ before: null, after: null });

  const selectedRef = useRef(null);
  selectedRef.current = selectedDetection;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const idKey = detectionId == null || detectionId === '' ? null : String(detectionId);
  const currentId = navState.forId === idKey && navState.id ? navState.id : idKey;
  const ids = useMemo(
    () => (Array.isArray(neighborIds) ? neighborIds.filter((v) => v != null).map(String) : []),
    [neighborIds]
  );
  const currentIndex = currentId ? ids.indexOf(currentId) : -1;

  // Reset on open / close / different detection
  useEffect(() => {
    setNavState({ forId: null, id: null });
    setDetailTab(0);
    if (!open) {
      setSelectedDetection(null);
      setSelectedDetectionLoading(false);
      setDeviceRouteCoordinates([]);
      setNearestAtPosition({ before: null, after: null });
      setBirdReviewSavingId(null);
    }
  }, [open, idKey]);

  // Load full detection
  useEffect(() => {
    if (!open || !currentId) return undefined;
    let cancelled = false;
    setSelectedDetectionLoading(true);
    axios
      .get(`/api/cv/detections/${currentId}`)
      .then((response) => {
        if (!cancelled) setSelectedDetection(response.data);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Error fetching detection detail:', error);
        toast.error('Fehler beim Laden der Erkennung');
        if (selectedRef.current?._id) {
          // Paging failed: stay on the detection that is still shown
          setNavState({ forId: idKey, id: String(selectedRef.current._id) });
        } else {
          onCloseRef.current?.();
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedDetectionLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentId]);

  useEffect(() => {
    if (!selectedDetection?.device?._id) {
      setDeviceRouteCoordinates([]);
      return undefined;
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

  // Nearest detection at same position (before/after) for "X min davor/danach"
  useEffect(() => {
    if (!selectedDetection) {
      setNearestAtPosition({ before: null, after: null });
      return undefined;
    }
    const d = selectedDetection;
    const deviceId = d.device?._id ?? d.device;
    const pos = d.camera_position;
    if (!deviceId || pos?.rotation == null || pos?.tilt == null || !d.processedAt) {
      setNearestAtPosition({ before: null, after: null });
      return undefined;
    }
    let cancelled = false;
    const processedAt = typeof d.processedAt === 'string' ? d.processedAt : d.processedAt?.toISO?.() ?? new Date(d.processedAt).toISOString();
    axios.get('/api/cv/detections/nearest-at-position', {
      params: { deviceId: String(deviceId), rotation: pos.rotation, tilt: pos.tilt, processedAt }
    })
      .then((res) => {
        if (!cancelled) setNearestAtPosition({ before: res.data.before || null, after: res.data.after || null });
      })
      .catch(() => {
        if (!cancelled) setNearestAtPosition({ before: null, after: null });
      });
    return () => { cancelled = true; };
  }, [selectedDetection]);

  const handleBirdReviewUpdated = (next) => {
    setSelectedDetection(next);
    onUpdated?.(next);
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
      const next = { ...selectedDetection, camera_position: response.data.camera_position };
      setSelectedDetection(next);
      onUpdated?.(next);
      toast.success('Kamera-Position aktualisiert');
    } catch (err) {
      toast.error('Fehler beim Speichern der Kamera-Position');
    } finally {
      setCameraPositionSaving(false);
    }
  };

  const goToIndex = useCallback((index) => {
    if (index < 0 || index >= ids.length) return;
    setNavState({ forId: idKey, id: ids[index] });
  }, [ids, idKey]);

  const handlePreviousDetection = useCallback(() => {
    if (!selectedDetection || selectedDetectionLoading || currentIndex <= 0) return;
    goToIndex(currentIndex - 1);
  }, [selectedDetection, selectedDetectionLoading, currentIndex, goToIndex]);

  const handleNextDetection = useCallback(() => {
    if (!selectedDetection || selectedDetectionLoading) return;
    if (currentIndex >= 0 && currentIndex < ids.length - 1) {
      goToIndex(currentIndex + 1);
    }
  }, [selectedDetection, selectedDetectionLoading, currentIndex, ids.length, goToIndex]);

  useEffect(() => {
    if (!open) return undefined;

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
  }, [open, handlePreviousDetection, handleNextDetection]);

  const handleDeleteDetection = async () => {
    if (!selectedDetection?._id) return;
    const confirmDelete = window.confirm('Erkennung und zugehörige Bilder wirklich löschen?');
    if (!confirmDelete) return;

    const id = selectedDetection._id;
    try {
      await axios.delete(`/api/cv/detections/${id}`);
      onDeleted?.(id);
      onClose?.();
    } catch (error) {
      console.error('Error deleting detection:', error);
      toast.error('Fehler beim Löschen der Erkennung');
    }
  };

  return (
    <Dialog
      open={Boolean(open)}
      onClose={onClose}
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
                disabled={currentIndex <= 0}
                size="small"
                title="Vorheriges Bild"
              >
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="h6">
                Erkennungs-Bilder {selectedDetection && currentIndex >= 0 && `(${currentIndex + 1} / ${ids.length})`}
              </Typography>
              <IconButton
                onClick={handleNextDetection}
                disabled={currentIndex < 0 || currentIndex >= ids.length - 1}
                size="small"
                title="Nächstes Bild"
              >
                <ArrowForwardIcon />
              </IconButton>
            </Box>
            <IconButton onClick={onClose} size="small">
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
                            // Dialog uses modal+2; Select menu defaults to modal and would render behind it
                            sx: { zIndex: (theme) => theme.zIndex.modal + 3 },
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
                onUpdated={handleBirdReviewUpdated}
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
        <Button onClick={onClose}>
          Schließen
        </Button>
        {selectedDetection && (
          <Button
            color="error"
            onClick={handleDeleteDetection}
          >
            Erkennung löschen
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default DetectionDetailDialog;
