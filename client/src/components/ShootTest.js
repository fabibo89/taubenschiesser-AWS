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
  IconButton
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
import { hasActiveLaserZone, normalizeLaserZone } from '../utils/laserZone';

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

function CrosshairOverlay() {
  const line = 'rgba(255, 0, 0, 0.9)';
  const gap = 40; // half of 80px circle — lines stop outside the circle

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1
      }}
    >
      {/* Horizontal mid lines (outside circle) */}
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: 0,
          width: `calc(50% - ${gap}px)`,
          height: 2,
          bgcolor: line,
          transform: 'translateY(-50%)'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          right: 0,
          width: `calc(50% - ${gap}px)`,
          height: 2,
          bgcolor: line,
          transform: 'translateY(-50%)'
        }}
      />
      {/* Vertical mid lines (outside circle) */}
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: 0,
          height: `calc(50% - ${gap}px)`,
          width: 2,
          bgcolor: line,
          transform: 'translateX(-50%)'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          bottom: 0,
          height: `calc(50% - ${gap}px)`,
          width: 2,
          bgcolor: line,
          transform: 'translateX(-50%)'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
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

/** Frame the shoot-target bird on the detection preview (zoomed or original). */
function TargetBirdFrame({ targetBird, imageInfo, useZoomed }) {
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

  if (!(width > 0 && height > 0)) return null;

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

function DetectionThumb({ detection, selected, imageUrl, routeThumb, onSelect, onNeedImage }) {
  useEffect(() => {
    if (detection?._id && imageUrl === undefined) onNeedImage(detection._id);
  }, [detection?._id, imageUrl, onNeedImage]);

  const pos = detection.camera_position;
  const posLabel = pos?.rotation != null && pos?.tilt != null
    ? `R ${pos.rotation}° / T ${pos.tilt}°`
    : 'ohne Position';

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
          src={routeThumb.startsWith('data:') ? routeThumb : `data:image/jpeg;base64,${routeThumb}`}
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
  const [aimMarker, setAimMarker] = useState(null); // { x, y } display px in live box
  const liveBoxRef = useRef(null);
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
    if (!deviceId || aiming || executing || nudging) return;
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
      const zoom = selected?.zoom_factor || zoneStatus?.zoom_factor || 1;
      const info = zoneStatus?.image_info || selected?.image_info;
      const imgW = (zoom > 1 ? info?.zoomed_size?.width : info?.original_size?.width)
        || natural.w
        || 640;
      const imgH = (zoom > 1 ? info?.zoomed_size?.height : info?.original_size?.height)
        || natural.h
        || 640;
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/aim-click`, {
        rotation: pose.rotation,
        tilt: pose.tilt,
        normX: mapped.normX,
        normY: mapped.normY,
        zoomFactor: zoom,
        imageWidth: imgW,
        imageHeight: imgH,
        cameraSource: selected?.camera_source || device?.camera?.type
      });
      if (res.data?.position) setLivePose(res.data.position);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Zielen fehlgeschlagen');
    } finally {
      setAiming(false);
    }
  };

  /** Impulse nudge via device-control (±10°), same as Dashboard. */
  const handleNudge = async (action) => {
    if (!deviceId || aiming || executing || nudging) return;
    const deltas = {
      rotate_left: { rotation: -10, tilt: 0 },
      rotate_right: { rotation: 10, tilt: 0 },
      move_up: { rotation: 0, tilt: 10 },
      move_down: { rotation: 0, tilt: -10 }
    };
    const delta = deltas[action];
    if (!delta) return;

    setNudging(true);
    try {
      await axios.post(`/api/device-control/${deviceId}/control`, { action });
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

  // Live camera poll while a detection is selected
  useEffect(() => {
    if (!deviceId || !selected) {
      setLiveUrl(null);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const tick = async () => {
      try {
        const zoom = selected.zoom_factor || zoneStatus?.zoom_factor || 1;
        const camType = device?.camera?.type;
        let source;
        if (selected.camera_source === 'raspberry-pi' || selected.camera_source === 'tapo') {
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
  }, [deviceId, selected, zoneStatus?.zoom_factor, device?.camera?.type, device?.camera?.raspberryPi?.ip]);

  const handleExecute = async () => {
    if (!deviceId || !selected?._id) return;
    setExecuting(true);
    try {
      // Move to scan pose first so live view updates at position, then shoot
      const res = await axios.post(`/api/devices/${deviceId}/shoot-test/execute`, {
        detectionId: selected._id,
        mode,
        useWater,
        useLaser,
        useAudio
      });
      toast.success(
        mode === 'stay'
          ? 'Schuss ausgeführt — Gerät bleibt auf Zielposition'
          : 'Schuss ausgeführt — zurück zur Scan-Position'
      );
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
  const canShoot = selected
    && zoneStatus?.hasTargetBird
    && ((useWater && avail?.water?.allowed) || (useLaser && avail?.laser?.allowed) || (useAudio && avail?.audio?.allowed));

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Shoot-Test
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
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth size="small">
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
            </Grid>
            <Grid item xs={12} sm={6} md={8}>
              <FormLabel component="legend">Schuss-Modus</FormLabel>
              <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value)}>
                <FormControlLabel value="return" control={<Radio />} label="Bewegen (hin → shoot → zurück)" />
                <FormControlLabel value="stay" control={<Radio />} label="Bleiben (hin → shoot → stay)" />
              </RadioGroup>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {loadingList && <LinearProgress sx={{ mb: 2 }} />}

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
                  color="error"
                  startIcon={executing ? <CircularProgress size={18} color="inherit" /> : <ShootIcon />}
                  disabled={!canShoot || executing}
                  onClick={handleExecute}
                >
                  {executing ? 'Ausführung…' : 'Shoot ausführen'}
                </Button>
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
                  Aim-Quelle mit Ziel-Frame
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
                  Klick zum Zielen · Pfeile für ±10° Impulse.
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
                    cursor: livePose && !aiming && !executing && !nudging ? 'crosshair' : 'default',
                    opacity: aiming || nudging ? 0.85 : 1
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
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default ShootTest;
