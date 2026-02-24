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
  Popover
} from '@mui/material';
import axios from 'axios';
import { toast } from 'react-toastify';

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

function RoutePointCard({ coord, index, detections }) {
  const [imgSize, setImgSize] = useState({ w: 0, h: 0, naturalW: 0, naturalH: 0 });
  const [anchorEl, setAnchorEl] = useState(null);
  const [hoveredDetectionId, setHoveredDetectionId] = useState(null);
  const [hoveredBoxInfo, setHoveredBoxInfo] = useState(null); // { position } oder { bbox } der angehoverten Taube
  const [imageCache, setImageCache] = useState({});
  const [detectionMeta, setDetectionMeta] = useState({}); // { [id]: { createdAt, _id } }
  const closeTimeoutRef = useRef(null);
  const leaveDelayRef = useRef(null);

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
      allBoxes.push({ ...d.target_bird, ...meta });
    }
    (d.detections || []).forEach((det) => {
      if (det.class !== 'bird') return;
      if (!det.bbox && !det.position) return;
      allBoxes.push({ ...det, ...meta });
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
          Position {index + 1} — Rotation {rotation}°, Tilt {tilt}°
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
              paddingTop: '75%',
              backgroundColor: '#111',
              borderRadius: 1,
              overflow: 'hidden'
            }}
          >
            <Box
              component="img"
              src={imageUrl}
              alt={`Position ${index + 1}`}
              sx={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
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
                  return (
                    <Box
                      key={idx}
                      onMouseEnter={(e) => handleBoxMouseEnter(e, detectionId, { position: det.position, bbox: det.bbox })}
                      onMouseLeave={scheduleClose}
                      sx={{
                        position: 'absolute',
                        left: x,
                        top: y,
                        width: Math.max(w, 4),
                        height: Math.max(h, 4),
                        border: '3px solid #f44336',
                        boxSizing: 'border-box',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                        pointerEvents: 'auto',
                        cursor: 'pointer'
                      }}
                    />
                  );
                });
              })()}
            </Box>
            <Popover
              open={Boolean(anchorEl)}
              anchorEl={anchorEl}
              onClose={() => {
                setAnchorEl(null);
                setHoveredDetectionId(null);
                setHoveredBoxInfo(null);
              }}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              disableRestoreFocus
              slotProps={{
                paper: {
                  onMouseEnter: clearCloseTimers,
                  onMouseLeave: scheduleClose
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
                      <Typography variant="caption" display="block" color="text.secondary">
                        Pos: {hoveredBoxInfo.position
                          ? `(${Number(hoveredBoxInfo.position.center_x).toFixed(0)}, ${Number(hoveredBoxInfo.position.center_y).toFixed(0)}), ${Number(hoveredBoxInfo.position.width).toFixed(0)} × ${Number(hoveredBoxInfo.position.height).toFixed(0)} px`
                          : hoveredBoxInfo.bbox
                            ? `(${Number(hoveredBoxInfo.bbox.x).toFixed(0)}, ${Number(hoveredBoxInfo.bbox.y).toFixed(0)}), ${Number(hoveredBoxInfo.bbox.width).toFixed(0)} × ${Number(hoveredBoxInfo.bbox.height).toFixed(0)} px`
                            : null}
                      </Typography>
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
                  return (
                    <Box sx={{ position: 'relative', display: 'inline-block' }}>
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
                            border: '3px solid #f44336',
                            boxSizing: 'border-box',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
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
        {detections.length > 0 && (
          <Chip size="small" label={`${detections.length} Erkennung(en)`} sx={{ mt: 1 }} />
        )}
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
  const [loading, setLoading] = useState(true);
  const [allDetections, setAllDetections] = useState([]);
  const [loadingDetections, setLoadingDetections] = useState(false);

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

  const tableRows = [];
  allDetections.forEach((d) => {
    const rot = d.camera_position?.rotation ?? '-';
    const til = d.camera_position?.tilt ?? '-';
    const coordIndex = coordinates.findIndex(
      (c) => (c.rotation ?? null) === (d.camera_position?.rotation ?? null) && (c.tilt ?? null) === (d.camera_position?.tilt ?? null)
    );
    const posLabel = coordIndex >= 0 ? `Position ${coordIndex + 1}` : `${rot}°, ${til}°`;
    const info = d.image_info || {};
    const srcW = info.original_size?.width ?? info.zoomed_size?.width ?? '-';
    const srcH = info.original_size?.height ?? info.zoomed_size?.height ?? '-';
    const mapping = coordIndex >= 0 ? `→ Routenbild ${posLabel}` : '→ Kein passendes Routenbild';

    let birdIndex = 0;
    function rowFromBird(bird, isTargetBird, subId) {
      let drawPos = '-';
      if (bird.position) {
        const p = bird.position;
        drawPos = `center (${Math.round(p.center_x)}, ${Math.round(p.center_y)}), ${Math.round(p.width)}×${Math.round(p.height)}`;
      } else if (bird.bbox) {
        const b = bird.bbox;
        drawPos = `bbox (${Math.round(b.x)}, ${Math.round(b.y)}) ${Math.round(b.width)}×${Math.round(b.height)}`;
      }
      return {
        id: `${d._id}-${subId}`,
        routePosition: `${rot}°, ${til}°`,
        date: d.processedAt,
        drawPosition: drawPos,
        sourceImage: `${srcW} × ${srcH}`,
        mapping,
        isTargetBird
      };
    }

    if (d.target_bird && (d.target_bird.bbox || d.target_bird.position)) {
      tableRows.push(rowFromBird(d.target_bird, true, 'target'));
    }
    (d.detections || []).forEach((det) => {
      if (det.class !== 'bird' || (!det.bbox && !det.position)) return;
      tableRows.push(rowFromBird(det, false, `bird-${birdIndex++}`));
    });
  });

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Routen-Erkennungen</Typography>
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
          <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Tauben pro Detection (Zielvogel + alle Vögel, Position und Mapping)</Typography>
          <TableContainer component={Paper} sx={{ mb: 3, maxHeight: 360 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Zielvogel</TableCell>
                  <TableCell>Routenposition</TableCell>
                  <TableCell>Datum / Zeit</TableCell>
                  <TableCell>Position (Zeichnung)</TableCell>
                  <TableCell>Quellbild (Breite × Höhe)</TableCell>
                  <TableCell>Mapping</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loadingDetections ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <CircularProgress size={24} sx={{ my: 1 }} />
                    </TableCell>
                  </TableRow>
                ) : tableRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary' }}>
                      Keine Tauben im gewählten Zeitraum.
                    </TableCell>
                  </TableRow>
                ) : (
                  tableRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.isTargetBird ? 'Ja' : 'Nein'}</TableCell>
                      <TableCell>{row.routePosition}</TableCell>
                      <TableCell>{row.date ? new Date(row.date).toLocaleString('de-DE') : '-'}</TableCell>
                      <TableCell>{row.drawPosition}</TableCell>
                      <TableCell>{row.sourceImage}</TableCell>
                      <TableCell>{row.mapping}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Routenbilder mit eingezeichneten Tauben</Typography>
          <Grid container spacing={2}>
            {coordinates.map((coord, idx) => {
              const detectionsForCoord = allDetections.filter(
                (d) =>
                  (d.camera_position?.rotation ?? null) === (coord.rotation ?? null) &&
                  (d.camera_position?.tilt ?? null) === (coord.tilt ?? null)
              );
              return (
                <Grid item xs={12} sm={6} md={4} key={idx}>
                  <RoutePointCard coord={coord} index={idx} detections={detectionsForCoord} />
                </Grid>
              );
            })}
          </Grid>
        </>
      )}
    </Box>
  );
}
