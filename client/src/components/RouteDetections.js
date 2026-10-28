import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  CircularProgress,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Popover,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Button
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon } from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import { resolveDetectionSources, detectionSourceLabels } from '../utils/detectionSources';
import { normalizeIgnoreZones, hasActiveIgnoreZones, detectionHitsIgnoreZones } from '../utils/ignoreZone';
import { normalizeLaserZone, hasActiveLaserZone } from '../utils/laserZone';
import DetectionDetailDialog from './DetectionDetailDialog';
import IgnoreZoneEditor from './IgnoreZoneEditor';
import IgnoreZoneAffectedDialog from './IgnoreZoneAffectedDialog';

const TIME_RANGES = [
  { value: '1', label: '1 Tag' },
  { value: '7', label: '7 Tage' },
  { value: '30', label: '30 Tage' },
  { value: '100', label: '100 Tage' },
  { value: '365', label: '1 Jahr' },
  { value: 'all', label: 'Alle' }
];

const PIGEON_FILTER = [
  { value: 'confirmed_pigeon', label: 'Taube' },
  { value: 'no_pigeon', label: 'Keine Taube' }
];

/** Zielvogel vs. Nebentaube — nicht Rot (das wäre „keine Taube“). */
const ROUTE_BOX = {
  target: '#00e676',
  side: '#29b6f6',
  ignore: 'rgba(198, 40, 40, 0.85)',
  laser: 'rgba(76, 175, 80, 0.9)'
};

function RouteBoxLegend({ dense = false }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: dense ? 1.5 : 2, alignItems: 'center' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          sx={{
            width: dense ? 18 : 22,
            height: dense ? 14 : 16,
            border: `3px solid ${ROUTE_BOX.target}`,
            borderRadius: 0.5,
            boxSizing: 'border-box',
            flexShrink: 0
          }}
        />
        <Typography variant="caption" color="text.secondary">
          Zielvogel (Main)
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          sx={{
            width: dense ? 18 : 22,
            height: dense ? 14 : 16,
            border: `3px solid ${ROUTE_BOX.side}`,
            borderRadius: 0.5,
            boxSizing: 'border-box',
            flexShrink: 0
          }}
        />
        <Typography variant="caption" color="text.secondary">
          Nebentaube (Side)
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          sx={{
            width: dense ? 18 : 22,
            height: dense ? 14 : 16,
            bgcolor: 'rgba(244, 67, 54, 0.35)',
            border: `2px solid ${ROUTE_BOX.ignore}`,
            borderRadius: 0.5,
            boxSizing: 'border-box',
            flexShrink: 0
          }}
        />
        <Typography variant="caption" color="text.secondary">
          Ignore-Zone
        </Typography>
      </Box>
    </Box>
  );
}

function toLocalDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDateRange(days) {
  if (days === 'all') return { dateFrom: null, dateTo: null };
  const to = new Date();
  const from = new Date();
  const n = parseInt(days, 10);
  from.setDate(from.getDate() - (n - 1));
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return {
    dateFrom: toLocalDateString(from),
    dateTo: toLocalDateString(to)
  };
}

/** Filter by Cloud-YOLO (Master) / ESP-P4 (Slave) source chips. Legacy → Master. */
function detectionMatchesSourceFilter(detection, sourceFilter) {
  const wantMaster = sourceFilter.includes('master');
  const wantSlave = sourceFilter.includes('slave');
  if (!wantMaster && !wantSlave) return false;

  const src = resolveDetectionSources(detection);
  if (!src.known) return wantMaster;

  if (src.master && wantMaster) return true;
  if (src.slave && wantSlave) return true;
  return false;
}

function RoutePointCard({ coord, index, detections, onOpenDetectionDetail, onEditIgnoreZones }) {
  const [imgSize, setImgSize] = useState({ w: 0, h: 0, naturalW: 0, naturalH: 0 });
  const [anchorEl, setAnchorEl] = useState(null);
  const [hoveredDetectionId, setHoveredDetectionId] = useState(null);
  const [hoveredBoxInfo, setHoveredBoxInfo] = useState(null); // { position } oder { bbox } der angehoverten Taube
  const [imageCache, setImageCache] = useState({});
  const [detectionMeta, setDetectionMeta] = useState({}); // { [id]: { createdAt, _id } }
  const closeTimeoutRef = useRef(null);
  const leaveDelayRef = useRef(null);
  const ignoreZones = normalizeIgnoreZones(coord?.ignoreZones);
  const laserZone = normalizeLaserZone(coord?.laserZone);
  const showLaser = hasActiveLaserZone(laserZone);

  const clearCloseTimers = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (leaveDelayRef.current) {
      clearTimeout(leaveDelayRef.current);
      leaveDelayRef.current = null;
    }
  };

  const rotation = coord.rotation ?? 0;
  const tilt = coord.tilt ?? 0;
  const zoom = coord.zoom ?? 1;

  const hoveredDetection = hoveredDetectionId
    ? detections.find((d) => d._id === hoveredDetectionId)
    : null;
  const displayMeta = hoveredDetectionId
    ? (detectionMeta[hoveredDetectionId] ?? {
        createdAt: hoveredDetection?.createdAt,
        _id: hoveredDetection?._id ?? hoveredDetectionId
      })
    : null;

  const backgroundImage = coord.image
    ? (coord.image.startsWith('data:') ? coord.image : `data:image/jpeg;base64,${coord.image}`)
    : null;
  const firstDetectionImage = detections[0]?.zoomed_image?.url || detections[0]?.image?.url;
  const imageUrl = backgroundImage || firstDetectionImage;

  const allBoxes = [];
  detections.forEach((d) => {
    const info = d.image_info || {};
    const imgW = info.original_size?.width || info.zoomed_size?.width || 1;
    const imgH = info.original_size?.height || info.zoomed_size?.height || 1;
    const meta = { _imgW: imgW, _imgH: imgH, _imageInfo: info, _detectionId: d._id };
    if (d.target_bird && (d.target_bird.bbox || d.target_bird.position)) {
      allBoxes.push({ ...d.target_bird, ...meta, isTargetBird: true });
    }
    (d.detections || []).forEach((det) => {
      if (det.class !== 'bird') return;
      if (!det.bbox && !det.position) return;
      allBoxes.push({ ...det, ...meta, isTargetBird: !!det.is_target_bird });
    });
  });

  const handleBoxMouseEnter = (e, detectionId, boxInfo) => {
    clearCloseTimers();
    setAnchorEl(e.currentTarget);
    setHoveredDetectionId(detectionId);
    setHoveredBoxInfo(boxInfo);
    if (detectionId && !imageCache[detectionId]) {
      setImageCache((prev) => ({ ...prev, [detectionId]: 'loading' }));
      axios
        .get(`/api/cv/detections/${detectionId}`)
        .then((res) => {
          const url = res.data?.zoomed_image?.url || res.data?.image?.url;
          if (url) {
            setImageCache((prev) => ({ ...prev, [detectionId]: url }));
          } else {
            setImageCache((prev) => ({ ...prev, [detectionId]: null }));
          }
          setDetectionMeta((prev) => ({
            ...prev,
            [detectionId]: {
              createdAt: res.data?.createdAt,
              _id: res.data?._id
            }
          }));
        })
        .catch(() => {
          setImageCache((prev) => ({ ...prev, [detectionId]: null }));
        });
    }
  };

  const closePopover = () => {
    clearCloseTimers();
    setAnchorEl(null);
    setHoveredDetectionId(null);
    setHoveredBoxInfo(null);
  };

  const openDetail = (detectionId) => {
    if (!detectionId) return;
    closePopover();
    onOpenDetectionDetail?.(detectionId);
  };

  const scheduleClose = () => {
    clearCloseTimers();
    leaveDelayRef.current = setTimeout(() => {
      leaveDelayRef.current = null;
      closeTimeoutRef.current = setTimeout(() => {
        setAnchorEl(null);
        setHoveredDetectionId(null);
        setHoveredBoxInfo(null);
        closeTimeoutRef.current = null;
      }, 800);
    }, 200);
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>
          Position {index + 1} — Rotation {rotation}°, Tilt {tilt}°, Zoom {zoom}x
        </Typography>
        {!imageUrl && (
          <Typography variant="body2" color="text.secondary">
            Kein Bild und keine Erkennungen für diese Position.
          </Typography>
        )}
        {imageUrl && (
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              borderRadius: 1,
              overflow: 'hidden',
              lineHeight: 0
            }}
          >
            <Box
              component="img"
              src={imageUrl}
              alt={`Position ${index + 1}`}
              sx={{
                display: 'block',
                width: '100%',
                height: 'auto',
                zIndex: 0
              }}
              onLoad={(e) => {
                const el = e.target;
                if (el) setImgSize({
                  w: el.offsetWidth,
                  h: el.offsetHeight,
                  naturalW: el.naturalWidth || el.offsetWidth,
                  naturalH: el.naturalHeight || el.offsetHeight
                });
              }}
            />
            {/* Overlay: Boxen über dem Bild, gleiche Größe wie Container */}
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                zIndex: 1,
                pointerEvents: 'none'
              }}
            >
              {imgSize.w > 0 && allBoxes.length > 0 && (() => {
                const cw = imgSize.w;
                const ch = imgSize.h;
                const nw = imgSize.naturalW || cw;
                const nh = imgSize.naturalH || ch;
                const scale = Math.min(cw / nw, ch / nh) || 1;
                const dw = nw * scale;
                const dh = nh * scale;
                const offsetX = (cw - dw) / 2;
                const offsetY = (ch - dh) / 2;
                return allBoxes.map((det, idx) => {
                  const inf = det._imageInfo || {};
                  const iw = inf.original_size?.width || inf.zoomed_size?.width || det._imgW || 1;
                  const ih = inf.original_size?.height || inf.zoomed_size?.height || det._imgH || 1;
                  const sx = dw / iw;
                  const sy = dh / ih;
                  let x, y, w, h;
                  if (det.position) {
                    const { center_x, center_y, width, height } = det.position;
                    x = offsetX + (center_x - width / 2) * sx;
                    y = offsetY + (center_y - height / 2) * sy;
                    w = width * sx;
                    h = height * sy;
                  } else if (det.bbox) {
                    x = offsetX + det.bbox.x * sx;
                    y = offsetY + det.bbox.y * sy;
                    w = det.bbox.width * sx;
                    h = det.bbox.height * sy;
                  } else return null;
                  const detectionId = det._detectionId;
                  const isTarget = det.isTargetBird || det.is_target_bird;
                  return (
                    <Box
                      key={idx}
                      onMouseEnter={(e) => handleBoxMouseEnter(e, detectionId, { position: det.position, bbox: det.bbox, esp_rot: det.esp_rot, esp_tilt: det.esp_tilt, isTargetBird: isTarget })}
                      onMouseLeave={scheduleClose}
                      onClick={() => openDetail(detectionId)}
                      sx={{
                        position: 'absolute',
                        left: x,
                        top: y,
                        width: Math.max(w, 4),
                        height: Math.max(h, 4),
                        border: `${isTarget ? 4 : 2}px solid ${isTarget ? ROUTE_BOX.target : ROUTE_BOX.side}`,
                        boxSizing: 'border-box',
                        boxShadow: isTarget
                          ? '0 0 0 2px rgba(0,230,118,0.45)'
                          : '0 0 0 1px rgba(0,0,0,0.45)',
                        pointerEvents: 'auto',
                        cursor: 'pointer'
                      }}
                    />
                  );
                });
              })()}
            </Box>
            {/* Zone overlays (ignore + laser) aligned to rendered image box */}
            {imgSize.w > 0 && (ignoreZones.length > 0 || showLaser) && (() => {
              const cw = imgSize.w;
              const ch = imgSize.h;
              const nw = imgSize.naturalW || cw;
              const nh = imgSize.naturalH || ch;
              const scale = Math.min(cw / nw, ch / nh) || 1;
              const dw = nw * scale;
              const dh = nh * scale;
              const offsetX = (cw - dw) / 2;
              const offsetY = (ch - dh) / 2;
              return (
                <Box
                  component="svg"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  sx={{
                    position: 'absolute',
                    left: offsetX,
                    top: offsetY,
                    width: dw,
                    height: dh,
                    pointerEvents: 'none',
                    zIndex: 2
                  }}
                >
                  {showLaser && (
                    <polygon
                      points={laserZone.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                      fill="rgba(76, 175, 80, 0.12)"
                      stroke={ROUTE_BOX.laser}
                      strokeWidth="1.2"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {ignoreZones.map((z, zi) => (
                    <polygon
                      key={`ign-${zi}`}
                      points={z.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                      fill="rgba(244, 67, 54, 0.28)"
                      stroke={ROUTE_BOX.ignore}
                      strokeWidth="1.8"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </Box>
              );
            })()}
            <Popover
              open={Boolean(anchorEl)}
              anchorEl={anchorEl}
              onClose={closePopover}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              disableRestoreFocus
              // Root lets clicks through to the overlay boxes; only the paper is interactive
              sx={{ pointerEvents: 'none' }}
              slotProps={{
                paper: {
                  onMouseEnter: clearCloseTimers,
                  onMouseLeave: scheduleClose,
                  sx: { pointerEvents: 'auto' }
                }
              }}
            >
              <Box sx={{ p: 1, maxWidth: 400 }}>
                {/* Infos: Datum, ID, Taube (Position, Größe) */}
                {hoveredDetectionId && (
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" display="block" color="text.secondary">
                      {displayMeta?.createdAt
                        ? new Date(displayMeta.createdAt).toLocaleString('de-DE', {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })
                        : '…'}
                    </Typography>
                    {hoveredBoxInfo && (hoveredBoxInfo.position || hoveredBoxInfo.bbox) && (
                      <>
                        <Typography variant="caption" display="block" color="text.secondary">
                          Pos: {hoveredBoxInfo.position
                            ? `(${Number(hoveredBoxInfo.position.center_x).toFixed(0)}, ${Number(hoveredBoxInfo.position.center_y).toFixed(0)}), ${Number(hoveredBoxInfo.position.width).toFixed(0)} × ${Number(hoveredBoxInfo.position.height).toFixed(0)} px`
                            : hoveredBoxInfo.bbox
                              ? `(${Number(hoveredBoxInfo.bbox.x).toFixed(0)}, ${Number(hoveredBoxInfo.bbox.y).toFixed(0)}), ${Number(hoveredBoxInfo.bbox.width).toFixed(0)} × ${Number(hoveredBoxInfo.bbox.height).toFixed(0)} px`
                              : null}
                        </Typography>
                        {(hoveredBoxInfo.esp_rot != null || hoveredBoxInfo.esp_tilt != null) && (
                          <Typography variant="caption" display="block" color="text.secondary">
                            ESP: Rot {hoveredBoxInfo.esp_rot ?? '–'}°, Tilt {hoveredBoxInfo.esp_tilt ?? '–'}°
                          </Typography>
                        )}
                        <Chip
                          label={hoveredBoxInfo.isTargetBird ? 'Zielvogel (Main)' : 'Nebentaube (Side)'}
                          size="small"
                          sx={{
                            mt: 0.5,
                            borderColor: hoveredBoxInfo.isTargetBird ? ROUTE_BOX.target : ROUTE_BOX.side,
                            color: hoveredBoxInfo.isTargetBird ? '#1b5e20' : '#01579b',
                            bgcolor: hoveredBoxInfo.isTargetBird
                              ? 'rgba(0,230,118,0.15)'
                              : 'rgba(41,182,246,0.12)'
                          }}
                          variant="outlined"
                        />
                      </>
                    )}
                  </Box>
                )}
                {hoveredDetectionId && imageCache[hoveredDetectionId] === 'loading' && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minWidth: 200, minHeight: 150 }}>
                    <CircularProgress size={32} />
                  </Box>
                )}
                {hoveredDetectionId && imageCache[hoveredDetectionId] && imageCache[hoveredDetectionId] !== 'loading' && (() => {
                  const info = hoveredDetection?.image_info || {};
                  const imgW = info.original_size?.width || info.zoomed_size?.width || 1;
                  const imgH = info.original_size?.height || info.zoomed_size?.height || 1;
                  let left = 0, top = 0, w = 0, h = 0;
                  if (hoveredBoxInfo?.position) {
                    const { center_x, center_y, width, height } = hoveredBoxInfo.position;
                    left = (center_x - width / 2) / imgW * 100;
                    top = (center_y - height / 2) / imgH * 100;
                    w = (width / imgW) * 100;
                    h = (height / imgH) * 100;
                  } else if (hoveredBoxInfo?.bbox) {
                    left = (hoveredBoxInfo.bbox.x / imgW) * 100;
                    top = (hoveredBoxInfo.bbox.y / imgH) * 100;
                    w = (hoveredBoxInfo.bbox.width / imgW) * 100;
                    h = (hoveredBoxInfo.bbox.height / imgH) * 100;
                  }
                  const showBox = (hoveredBoxInfo?.position || hoveredBoxInfo?.bbox) && imgW > 1 && imgH > 1;
                  const isTarget = Boolean(hoveredBoxInfo?.isTargetBird);
                  const boxColor = isTarget ? ROUTE_BOX.target : ROUTE_BOX.side;
                  return (
                    <Box
                      onClick={() => openDetail(hoveredDetectionId)}
                      title="Erkennungs-Details öffnen"
                      sx={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}
                    >
                      <img
                        src={imageCache[hoveredDetectionId]}
                        alt="Detection"
                        style={{ maxWidth: '100%', maxHeight: 380, display: 'block', verticalAlign: 'top' }}
                      />
                      {showBox && (
                        <Box
                          sx={{
                            position: 'absolute',
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${w}%`,
                            height: `${h}%`,
                            border: `${isTarget ? 4 : 2}px solid ${boxColor}`,
                            boxSizing: 'border-box',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
                            pointerEvents: 'none'
                          }}
                        />
                      )}
                    </Box>
                  );
                })()}
                {hoveredDetectionId && imageCache[hoveredDetectionId] === null && (
                  <Typography variant="body2" color="text.secondary">
                    Bild nicht verfügbar
                  </Typography>
                )}
              </Box>
            </Popover>
          </Box>
        )}
        <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          {detections.length > 0 && (
            <Chip size="small" label={`${detections.length} Erkennung(en)`} />
          )}
          {hasActiveIgnoreZones(coord?.ignoreZones) && (
            <Chip size="small" color="error" variant="outlined" label={`${ignoreZones.length} Ignore-Zone(n)`} />
          )}
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={() => onEditIgnoreZones?.(index, detections)}
          >
            Ignore-Zonen
          </Button>
          <RouteBoxLegend dense />
        </Box>
      </CardContent>
    </Card>
  );
}

export default function RouteDetections() {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [device, setDevice] = useState(null);
  const [timeRange, setTimeRange] = useState('30');
  const [classificationStatus, setClassificationStatus] = useState('confirmed_pigeon');
  /** Which Erkennung-Quellen in Liste/Routenbilder: master = Cloud-YOLO, slave = ESP-P4 */
  const [sourceFilter, setSourceFilter] = useState(['master', 'slave']);
  const [loading, setLoading] = useState(true);
  const [allDetections, setAllDetections] = useState([]);
  const [loadingDetections, setLoadingDetections] = useState(false);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [detailDetectionId, setDetailDetectionId] = useState(null);
  const [ignoreEditor, setIgnoreEditor] = useState(null); // { index, birdBoxes }
  const [ignoreSaving, setIgnoreSaving] = useState(false);
  const [affectedDialog, setAffectedDialog] = useState(null); // { detections, ignoreZones }

  const fetchDevices = useCallback(async () => {
    try {
      const res = await axios.get('/api/devices');
      setDevices(res.data || []);
    } catch (err) {
      toast.error('Geräte konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  useEffect(() => {
    if (!selectedDeviceId) {
      setDevice(null);
      return;
    }
    axios
      .get(`/api/devices/${selectedDeviceId}`)
      .then((res) => setDevice(res.data))
      .catch(() => {
        setDevice(null);
        toast.error('Gerät konnte nicht geladen werden');
      });
  }, [selectedDeviceId]);

  const coordinates = device?.actions?.route?.coordinates || [];
  const { dateFrom, dateTo } = getDateRange(timeRange);

  const openIgnoreEditor = useCallback((index, detectionsForCoord = []) => {
    const birdBoxes = [];
    detectionsForCoord.forEach((d, di) => {
      const info = d.image_info || {};
      const imageSize = info.original_size || info.zoomed_size || null;
      if (!imageSize?.width) return;
      const push = (bird, label) => {
        if (!bird || (!bird.bbox && !bird.position)) return;
        birdBoxes.push({ bird, imageSize, label });
      };
      if (d.target_bird) push(d.target_bird, `Ziel #${di + 1}`);
      (d.detections || []).forEach((det, j) => {
        if (det.class !== 'bird') return;
        push(det, `Box #${di + 1}.${j + 1}`);
      });
    });
    setIgnoreEditor({ index, birdBoxes });
  }, []);

  const saveIgnoreZones = useCallback(async (zones) => {
    if (!selectedDeviceId || ignoreEditor == null) return;
    const index = ignoreEditor.index;
    setIgnoreSaving(true);
    try {
      const actionsRes = await axios.get(`/api/devices/${selectedDeviceId}/actions`);
      const mode = actionsRes.data?.mode || device?.actions?.mode || 'route';
      const route = actionsRes.data?.route || { coordinates: [] };
      const coords = [...(route.coordinates || [])];
      if (!coords[index]) {
        toast.error('Routenpunkt nicht gefunden');
        return;
      }
      const next = { ...coords[index] };
      if (zones && zones.length) {
        next.ignoreZones = zones;
      } else {
        delete next.ignoreZones;
      }
      coords[index] = next;
      await axios.put(`/api/devices/${selectedDeviceId}/actions`, {
        mode,
        route: { ...route, coordinates: coords }
      });
      setDevice((prev) => {
        if (!prev) return prev;
        const prevCoords = prev.actions?.route?.coordinates || [];
        const updated = prevCoords.map((c, i) => (i === index
          ? { ...c, ignoreZones: zones?.length ? zones : undefined }
          : c));
        return {
          ...prev,
          actions: {
            ...prev.actions,
            route: {
              ...(prev.actions?.route || {}),
              coordinates: updated
            }
          }
        };
      });
      toast.success(zones?.length ? 'Ignore-Zonen gespeichert' : 'Ignore-Zonen entfernt');
      setIgnoreEditor(null);

      // Offer to update detections in the selected time range (all classifications, not UI filter)
      if (zones?.length) {
        const coord = coords[index];
        const params = new URLSearchParams({
          deviceId: selectedDeviceId,
          limit: '2000'
        });
        if (dateFrom) params.append('dateFrom', dateFrom);
        if (dateTo) params.append('dateTo', dateTo);
        // no classificationStatus → Taube + Keine Taube + unklassifiziert
        const listRes = await axios.get(`/api/cv/detections?${params}`);
        const pool = listRes.data?.detections || [];
        const atPoint = pool.filter(
          (d) =>
            (d.camera_position?.rotation ?? null) === (coord.rotation ?? null)
            && (d.camera_position?.tilt ?? null) === (coord.tilt ?? null)
        );
        const affected = atPoint.filter((d) => detectionHitsIgnoreZones(d, zones));
        if (affected.length > 0) {
          const ask = window.confirm(
            `${affected.length} Erkennung(en) im gewählten Zeitraum fallen in die Ignore-Zonen `
            + '(alle Klassifizierungen).\n\n'
            + 'Betroffene Erkennungen jetzt aktualisieren?'
          );
          if (ask) {
            setAffectedDialog({ detections: affected, ignoreZones: zones });
          }
        } else {
          toast.info('Keine Erkennungen im Zeitraum liegen in den Ignore-Zonen.');
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setIgnoreSaving(false);
    }
  }, [selectedDeviceId, ignoreEditor, device?.actions?.mode, dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedDeviceId) {
      setAllDetections([]);
      return;
    }
    let cancelled = false;
    setLoadingDetections(true);
    const params = new URLSearchParams({
      deviceId: selectedDeviceId,
      limit: '1000'
    });
    if (classificationStatus) params.append('classificationStatus', classificationStatus);
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    axios
      .get(`/api/cv/detections?${params}`)
      .then((res) => {
        if (!cancelled) setAllDetections(res.data.detections || []);
      })
      .catch(() => {
        if (!cancelled) setAllDetections([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetections(false);
      });
    return () => { cancelled = true; };
  }, [selectedDeviceId, timeRange, classificationStatus, dateFrom, dateTo]);

  const filteredDetections = allDetections.filter((d) =>
    detectionMatchesSourceFilter(d, sourceFilter)
  );

  const clusteredDetections = [];
  filteredDetections.forEach((d) => {
    const rot = d.camera_position?.rotation ?? '-';
    const til = d.camera_position?.tilt ?? '-';
    const coordIndex = coordinates.findIndex(
      (c) => (c.rotation ?? null) === (d.camera_position?.rotation ?? null) && (c.tilt ?? null) === (d.camera_position?.tilt ?? null)
    );
    const zoomVal = d.zoom_factor ?? (coordIndex >= 0 ? coordinates[coordIndex]?.zoom : null) ?? 1;
    const posLabel = coordIndex >= 0 ? `Position ${coordIndex + 1}` : `${rot}°, ${til}°`;
    const posLabelWithZoom = coordIndex >= 0 ? `${posLabel}, Zoom ${zoomVal}x` : `${rot}°, ${til}° / Zoom ${zoomVal}x`;
    const info = d.image_info || {};
    const srcW = info.original_size?.width ?? info.zoomed_size?.width ?? '-';
    const srcH = info.original_size?.height ?? info.zoomed_size?.height ?? '-';
    const mapping = coordIndex >= 0 ? `→ Routenbild ${posLabelWithZoom}` : '→ Kein passendes Routenbild';

    const birds = [];
    function addBird(bird, isTargetBird) {
      let drawPos = '-';
      if (bird.position) {
        const p = bird.position;
        drawPos = `center (${Math.round(p.center_x)}, ${Math.round(p.center_y)}), ${Math.round(p.width)}×${Math.round(p.height)}`;
      } else if (bird.bbox) {
        const b = bird.bbox;
        drawPos = `bbox (${Math.round(b.x)}, ${Math.round(b.y)}) ${Math.round(b.width)}×${Math.round(b.height)}`;
      }
      const isTarget = bird.is_target_bird ?? isTargetBird;
      birds.push({
        drawPosition: drawPos,
        isTargetBird: isTarget,
        esp_rot: bird.esp_rot,
        esp_tilt: bird.esp_tilt
      });
    }
    if (d.target_bird && (d.target_bird.bbox || d.target_bird.position)) {
      addBird(d.target_bird, true);
    }
    (d.detections || []).forEach((det) => {
      if (det.class !== 'bird' || (!det.bbox && !det.position)) return;
      addBird(det, false);
    });

    const hasTargetBird = !!(d.target_bird && (d.target_bird.bbox || d.target_bird.position));
    clusteredDetections.push({
      detectionId: d._id,
      routePosition: `${rot}°, ${til}°${zoomVal !== 1 ? ` / Zoom ${zoomVal}x` : ''}`,
      date: d.processedAt,
      sourceImage: `${srcW} × ${srcH}`,
      mapping,
      hasTargetBird,
      birds,
      sourceLabels: detectionSourceLabels(d)
    });
  });

  const toggleRow = (id) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Tauben auf der Route</Typography>
      </Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Gerät</InputLabel>
                <Select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  label="Gerät"
                >
                  <MenuItem value=""><em>Kein Gerät</em></MenuItem>
                  {devices.map((d) => (
                    <MenuItem key={d._id} value={d._id}>{d.name || d.deviceId || d._id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Zeitraum</InputLabel>
                <Select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  label="Zeitraum"
                >
                  {TIME_RANGES.map((r) => (
                    <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Anzeige</InputLabel>
                <Select
                  value={classificationStatus}
                  onChange={(e) => setClassificationStatus(e.target.value)}
                  label="Anzeige"
                >
                  {PIGEON_FILTER.map((f) => (
                    <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Erkennung
              </Typography>
              <ToggleButtonGroup
                size="small"
                value={sourceFilter}
                onChange={(_e, next) => {
                  if (!next || next.length === 0) return;
                  setSourceFilter(next);
                }}
                aria-label="Master/Slave Erkennung filtern"
              >
                <ToggleButton value="master" aria-label="Master (Cloud-YOLO)">
                  <Tooltip title="Cloud-YOLO (Master)">
                    <span>Master</span>
                  </Tooltip>
                </ToggleButton>
                <ToggleButton value="slave" aria-label="Slave (ESP-P4)">
                  <Tooltip title="ESP-P4 parallel (Slave)">
                    <span>Slave</span>
                  </Tooltip>
                </ToggleButton>
              </ToggleButtonGroup>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {loading && (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      )}

      {!loading && !selectedDeviceId && (
        <Alert severity="info">Bitte ein Gerät auswählen.</Alert>
      )}

      {!loading && selectedDeviceId && coordinates.length === 0 && (
        <Alert severity="warning">Dieses Gerät hat keine Route mit Positionen. Route unter Geräte anlegen.</Alert>
      )}

      {!loading && selectedDeviceId && coordinates.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Detections mit Tauben (eine Zeile pro Detection, Subzeilen pro Taube)</Typography>
          <TableContainer component={Paper} sx={{ mb: 3, maxHeight: 360 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="none" sx={{ width: 48 }} />
                  <TableCell>Datum / Zeit</TableCell>
                  <TableCell>Erkennung</TableCell>
                  <TableCell>Zielvogel</TableCell>
                  <TableCell>Routenposition</TableCell>
                  <TableCell>Position (Zeichnung) / Anzahl Tauben</TableCell>
                  <TableCell>ESP Rot / Tilt</TableCell>
                  <TableCell>Quellbild (Breite × Höhe)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loadingDetections ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <CircularProgress size={24} sx={{ my: 1 }} />
                    </TableCell>
                  </TableRow>
                ) : clusteredDetections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ color: 'text.secondary' }}>
                      Keine Tauben im gewählten Zeitraum.
                    </TableCell>
                  </TableRow>
                ) : (
                  clusteredDetections.map((cluster) => {
                    const isExpanded = expandedRows.has(cluster.detectionId);
                    const hasBirds = cluster.birds.length > 0;
                    return (
                      <React.Fragment key={cluster.detectionId}>
                        <TableRow sx={{ '& > *': { borderBottom: hasBirds && !isExpanded ? 'none' : undefined } }}>
                          <TableCell padding="none" sx={{ width: 48, verticalAlign: 'middle' }}>
                            {hasBirds ? (
                              <IconButton
                                size="small"
                                onClick={() => toggleRow(cluster.detectionId)}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                              </IconButton>
                            ) : null}
                          </TableCell>
                          <TableCell>{cluster.date ? new Date(cluster.date).toLocaleString('de-DE') : '-'}</TableCell>
                          <TableCell>
                            {(cluster.sourceLabels || []).length > 0 ? (
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {cluster.sourceLabels.map((s) => (
                                  <Tooltip key={s.key} title={s.title}>
                                    <Chip
                                      size="small"
                                      label={s.label}
                                      color={s.key === 'master' ? 'primary' : 'secondary'}
                                      variant="outlined"
                                    />
                                  </Tooltip>
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                          <TableCell>{cluster.hasTargetBird ? 'Ja' : 'Nein'}</TableCell>
                          <TableCell>{cluster.routePosition} {cluster.mapping}</TableCell>
                          <TableCell>
                            {hasBirds ? (
                              <Box
                                component="span"
                                onClick={() => setDetailDetectionId(cluster.detectionId)}
                                sx={{ cursor: 'pointer', textDecoration: 'underline', '&:hover': { color: 'primary.main' } }}
                              >
                                {cluster.birds.length} Taube(n)
                              </Box>
                            ) : '-'}
                          </TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>{cluster.sourceImage}</TableCell>
                        </TableRow>
                        {hasBirds && isExpanded && cluster.birds.map((bird, idx) => (
                          <TableRow key={`${cluster.detectionId}-bird-${idx}`} sx={{ bgcolor: bird.isTargetBird ? 'action.selected' : 'action.hover' }}>
                            <TableCell sx={{ width: 48 }} />
                            <TableCell />
                            <TableCell />
                            <TableCell>{bird.isTargetBird ? 'Ja (Ziel)' : 'Nein'}</TableCell>
                            <TableCell sx={{ pl: 3 }} />
                            <TableCell>{bird.drawPosition}</TableCell>
                            <TableCell>
                              {bird.esp_rot != null || bird.esp_tilt != null
                                ? `Rot ${bird.esp_rot ?? '–'}°, Tilt ${bird.esp_tilt ?? '–'}°`
                                : '–'}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        ))}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ mt: 2, mb: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6" sx={{ m: 0 }}>Routenbilder mit eingezeichneten Tauben</Typography>
            <RouteBoxLegend />
          </Box>
          <Grid container spacing={2}>
            {coordinates.map((coord, idx) => {
              const detectionsForCoord = filteredDetections.filter(
                (d) =>
                  (d.camera_position?.rotation ?? null) === (coord.rotation ?? null) &&
                  (d.camera_position?.tilt ?? null) === (coord.tilt ?? null)
              );
              return (
                <Grid item xs={12} sm={6} md={4} key={idx}>
                  <RoutePointCard
                    coord={coord}
                    index={idx}
                    detections={detectionsForCoord}
                    onOpenDetectionDetail={setDetailDetectionId}
                    onEditIgnoreZones={openIgnoreEditor}
                  />
                </Grid>
              );
            })}
          </Grid>
        </>
      )}

      <DetectionDetailDialog
        open={Boolean(detailDetectionId)}
        detectionId={detailDetectionId}
        neighborIds={filteredDetections.map((d) => d._id)}
        onClose={() => setDetailDetectionId(null)}
        onDeleted={(id) => setAllDetections((prev) => prev.filter((d) => d._id !== id))}
        onUpdated={(next) => setAllDetections((prev) => prev.map((d) => (
          d._id === next._id
            ? {
                ...d,
                classification_status: next.classification_status,
                classifiedAt: next.classifiedAt,
                birds: next.birds,
                target_bird: next.target_bird,
                ...(next.camera_position ? { camera_position: next.camera_position } : {})
              }
            : d
        )))}
      />

      {ignoreEditor != null && coordinates[ignoreEditor.index] && (
        <IgnoreZoneEditor
          open
          onClose={() => !ignoreSaving && setIgnoreEditor(null)}
          image={(() => {
            const img = coordinates[ignoreEditor.index]?.image;
            if (!img) return null;
            return img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
          })()}
          ignoreZones={coordinates[ignoreEditor.index]?.ignoreZones}
          routePointIndex={ignoreEditor.index}
          birdBoxes={ignoreEditor.birdBoxes}
          onSave={saveIgnoreZones}
        />
      )}

      {affectedDialog && (
        <IgnoreZoneAffectedDialog
          open
          detections={affectedDialog.detections}
          ignoreZones={affectedDialog.ignoreZones}
          onClose={() => setAffectedDialog(null)}
          onApplied={({ action, ids }) => {
            const idSet = new Set((ids || []).map((id) => String(id)));
            if (action === 'delete' || (action === 'no_pigeon' && classificationStatus === 'confirmed_pigeon')) {
              setAllDetections((prev) => prev.filter((d) => !idSet.has(String(d._id))));
            } else if (action === 'no_pigeon') {
              setAllDetections((prev) => prev.map((d) => (
                idSet.has(String(d._id))
                  ? { ...d, classification_status: 'no_pigeon' }
                  : d
              )));
            }
            setAffectedDialog(null);
          }}
        />
      )}
    </Box>
  );
}
