import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  CardContent,
  CircularProgress,
  Chip,
  IconButton,
  Paper,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tooltip,
  FormControlLabel,
  Switch
} from '@mui/material';
import {
  Favorite as FavoriteIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  WaterDrop as WaterDropIcon,
  FlashOn as FlashOnIcon,
  VolumeUp as VolumeUpIcon,
  Block as BlockIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Undo as UndoIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import { detectionSourceLabels } from '../utils/detectionSources';

function DetectionSourceChips({ detection }) {
  const labels = detectionSourceLabels(detection);
  if (!labels.length) return null;
  return (
    <>
      {labels.map((item) => (
        <Tooltip key={item.key} title={item.title}>
          <Chip
            size="small"
            label={item.label}
            color={item.key === 'master' ? 'primary' : 'secondary'}
            variant={item.key === 'master' ? 'filled' : 'outlined'}
          />
        </Tooltip>
      ))}
    </>
  );
}

function formatTimeDiff(seconds, direction) {
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

function ShootActiveIcons({ detection }) {
  const flags = resolveShootActive(detection);
  if (!flags.known) return null;
  const any = flags.water || flags.laser || flags.audio;
  if (!any) {
    return (
      <Tooltip title="Kein Schuss">
        <BlockIcon fontSize="small" color="disabled" />
      </Tooltip>
    );
  }
  const tankEmpty = flags.water && detection?.watertank === false;
  const waterTitle = tankEmpty
    ? 'Wasser geplant — Wassertank war leer'
    : detection?.watertank === true
      ? 'Wasser (Tank OK)'
      : 'Wasser';
  return (
    <Box display="inline-flex" alignItems="center" gap={0.25}>
      {flags.water && (
        <Tooltip title={waterTitle}>
          <WaterDropIcon fontSize="small" color={tankEmpty ? 'error' : 'info'} />
        </Tooltip>
      )}
      {flags.laser && (
        <Tooltip title="Laser"><FlashOnIcon fontSize="small" color="success" /></Tooltip>
      )}
      {flags.audio && (
        <Tooltip title="Audio"><VolumeUpIcon fontSize="small" color="primary" /></Tooltip>
      )}
    </Box>
  );
}

/** YOLO stores pixels; Rekognition stores 0–1. Detect which and return pixel box. */
function toPixelBBox({ left, top, width, height }, imgWidth, imgHeight) {
  const looksNormalized =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width <= 1.5 &&
    height <= 1.5 &&
    (left == null || left <= 1.5) &&
    (top == null || top <= 1.5);
  if (looksNormalized) {
    return {
      left: (left || 0) * imgWidth,
      top: (top || 0) * imgHeight,
      width: width * imgWidth,
      height: height * imgHeight
    };
  }
  return { left: left || 0, top: top || 0, width: width || 0, height: height || 0 };
}

function computeContainLayout(containerWidth, containerHeight, imgNaturalWidth, imgNaturalHeight) {
  if (!containerWidth || !containerHeight || !imgNaturalWidth || !imgNaturalHeight) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  }
  const containerAspect = containerWidth / containerHeight;
  const imageAspect = imgNaturalWidth / imgNaturalHeight;
  if (imageAspect > containerAspect) {
    const renderedWidth = containerWidth;
    const renderedHeight = containerWidth / imageAspect;
    return {
      width: renderedWidth,
      height: renderedHeight,
      offsetX: 0,
      offsetY: (containerHeight - renderedHeight) / 2
    };
  }
  const renderedHeight = containerHeight;
  const renderedWidth = containerHeight * imageAspect;
  return {
    width: renderedWidth,
    height: renderedHeight,
    offsetX: (containerWidth - renderedWidth) / 2,
    offsetY: 0
  };
}

/** Pick target bird box in natural image pixels (prefer is_target_bird). */
function resolveTargetPixelBox(detectionDoc, imageData, imageInfo) {
  if (!detectionDoc || !imageInfo?.width || !imageInfo?.height) return null;
  const list = Array.isArray(detectionDoc.detections) ? detectionDoc.detections : [];
  if (!list.length) return null;
  const target = list.find((d) => d?.is_target_bird === true) || list[0];
  if (!target) return null;

  const imgWidth = imageInfo.width;
  const imgHeight = imageInfo.height;
  let rawLeft;
  let rawTop;
  let rawWidth;
  let rawHeight;

  if (imageData?.zoomed_image?.url && target.position) {
    const { center_x, center_y, width, height } = target.position;
    rawLeft = center_x - width / 2;
    rawTop = center_y - height / 2;
    rawWidth = width;
    rawHeight = height;
  } else if (target.bbox) {
    rawLeft = target.bbox.x;
    rawTop = target.bbox.y;
    rawWidth = target.bbox.width;
    rawHeight = target.bbox.height;
  } else {
    return null;
  }

  return toPixelBBox(
    { left: rawLeft, top: rawTop, width: rawWidth, height: rawHeight },
    imgWidth,
    imgHeight
  );
}

/** Expand box with padding, clamped to image bounds. */
function paddedCropBox(box, imgWidth, imgHeight, padRatio = 0.35) {
  if (!box) return null;
  const pad = Math.max(box.width, box.height) * padRatio;
  const left = Math.max(0, box.left - pad);
  const top = Math.max(0, box.top - pad);
  const right = Math.min(imgWidth, box.left + box.width + pad);
  const bottom = Math.min(imgHeight, box.top + box.height + pad);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function rectsOverlap(a, b, pad = 6) {
  if (!a || !b) return false;
  return !(
    a.left + a.width + pad <= b.left
    || b.left + b.width + pad <= a.left
    || a.top + a.height + pad <= b.top
    || b.top + b.height + pad <= a.top
  );
}

function measureZoomView(zoomCrop, maxSide) {
  if (!zoomCrop?.width || !zoomCrop?.height) {
    return { width: maxSide, height: maxSide, scale: 1 };
  }
  const scale = Math.min(maxSide / zoomCrop.width, maxSide / zoomCrop.height);
  return {
    width: Math.max(1, Math.round(zoomCrop.width * scale)),
    height: Math.max(1, Math.round(zoomCrop.height * scale)),
    scale
  };
}

/**
 * Place PiP: prefer bottom-left in the rendered image area.
 * If it overlaps the target bird, try other corners still inside the visible image.
 */
function computePipPlacement({
  rendered,
  imageInfo,
  targetPixelBox,
  pipW,
  pipH,
  margin = 8
}) {
  if (!rendered?.width || !pipW || !pipH) {
    return { left: margin, top: null, bottom: margin, right: null };
  }

  const areaLeft = rendered.offsetX;
  const areaTop = rendered.offsetY;
  const areaRight = rendered.offsetX + rendered.width;
  const areaBottom = rendered.offsetY + rendered.height;
  const containerW = rendered.width + 2 * rendered.offsetX;
  const containerH = rendered.height + 2 * rendered.offsetY;

  let bird = null;
  if (targetPixelBox && imageInfo?.width && imageInfo?.height) {
    const sx = rendered.width / imageInfo.width;
    const sy = rendered.height / imageInfo.height;
    bird = {
      left: targetPixelBox.left * sx + rendered.offsetX,
      top: targetPixelBox.top * sy + rendered.offsetY,
      width: targetPixelBox.width * sx,
      height: targetPixelBox.height * sy
    };
  }

  const clamp = (left, top) => ({
    left: Math.max(margin, Math.min(left, Math.max(margin, containerW - pipW - margin))),
    top: Math.max(margin, Math.min(top, Math.max(margin, containerH - pipH - margin)))
  });

  // Order: bottom-left first, then other corners in visible image area
  const candidates = [
    clamp(areaLeft + margin, areaBottom - pipH - margin),
    clamp(areaRight - pipW - margin, areaBottom - pipH - margin),
    clamp(areaLeft + margin, areaTop + margin),
    clamp(areaRight - pipW - margin, areaTop + margin)
  ];

  for (const pos of candidates) {
    const pip = { left: pos.left, top: pos.top, width: pipW, height: pipH };
    if (!bird || !rectsOverlap(pip, bird)) {
      return { left: pos.left, top: pos.top, bottom: null, right: null };
    }
  }

  return { left: candidates[0].left, top: candidates[0].top, bottom: null, right: null };
}

const TaubenTinder = () => {
  const [detections, setDetections] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [renderedImageSize, setRenderedImageSize] = useState({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  const [flyAwayDirection, setFlyAwayDirection] = useState(null);
  const [loadingNext, setLoadingNext] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteDetection, setPendingDeleteDetection] = useState(null);
  const [nearestAtPosition, setNearestAtPosition] = useState({ before: null, after: null });
  const [imageByDetectionId, setImageByDetectionId] = useState({});
  const [totalUnclassified, setTotalUnclassified] = useState(0);
  const [sessionBase, setSessionBase] = useState(0);
  const [showBoxes, setShowBoxes] = useState(true);
  /** Main image area: false = full frame, true = target zoom crop. */
  const [mainShowsZoom, setMainShowsZoom] = useState(false);
  /** Last classify action that can be undone (delete cannot). */
  const [lastUndo, setLastUndo] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const imageByDetectionIdRef = useRef({});
  imageByDetectionIdRef.current = imageByDetectionId;

  const cardRef = useRef(null);
  const touchStartRef = useRef(null);
  const mouseStartRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const actionPromiseRef = useRef(null);
  const didSwipeRef = useRef(false);
  const zoomCropRef = useRef(null);
  const FLY_AWAY_DURATION_MS = 350;
  const CLICK_MOVE_PX = 12;

  useEffect(() => {
    fetchUnclassifiedDetections();
  }, []);

  const loadImageForDetection = useCallback(async (id) => {
    const idStr = typeof id === 'string' ? id : id?.toString?.();
    if (!idStr || imageByDetectionIdRef.current[idStr] !== undefined) return;
    setImageByDetectionId((prev) => {
      if (prev[idStr] !== undefined) return prev;
      return { ...prev, [idStr]: 'loading' };
    });
    try {
      const response = await axios.get(`/api/cv/detections/${idStr}/image`);
      setImageByDetectionId((prev) => ({ ...prev, [idStr]: response.data }));
    } catch {
      setImageByDetectionId((prev) => ({ ...prev, [idStr]: null }));
    }
  }, []);

  // Load current card image and preload the next two
  useEffect(() => {
    if (detections.length === 0 || currentIndex >= detections.length) return;
    loadImageForDetection(detections[currentIndex]._id);
    for (let offset = 1; offset <= 2; offset += 1) {
      const next = detections[currentIndex + offset];
      if (next) loadImageForDetection(next._id);
    }
  }, [detections, currentIndex, loadImageForDetection]);

  // Reset card position when detection changes (image layout recalculated separately)
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setNearestAtPosition({ before: null, after: null });
  }, [currentIndex]);

  // Fetch nearest detection at same position (before/after) for "X min davor/danach" tag
  useEffect(() => {
    if (detections.length === 0 || currentIndex >= detections.length) return;
    const d = detections[currentIndex];
    const deviceId = d.device?._id ?? d.device;
    const pos = d.camera_position;
    if (!deviceId || pos?.rotation == null || pos?.tilt == null || !d.processedAt) {
      setNearestAtPosition({ before: null, after: null });
      return;
    }
    const processedAt = typeof d.processedAt === 'string' ? d.processedAt : d.processedAt?.toISO?.() ?? new Date(d.processedAt).toISOString();
    axios.get('/api/cv/detections/nearest-at-position', {
      params: { deviceId, rotation: pos.rotation, tilt: pos.tilt, processedAt }
    })
      .then((res) => setNearestAtPosition({ before: res.data.before || null, after: res.data.after || null }))
      .catch(() => setNearestAtPosition({ before: null, after: null }));
  }, [detections, currentIndex]);

  const resolveImageInfo = useCallback((detection, imageData) => {
    const info = imageData?.image_info || detection?.image_info;
    if (!info) return null;
    const preferZoomed = Boolean(imageData?.zoomed_image?.url);
    if (preferZoomed) {
      return info.zoomed_size || info.original_size || null;
    }
    return info.original_size || info.zoomed_size || null;
  }, []);

  const currentDetectionId = detections[currentIndex]?._id;
  const currentImageEntry = currentDetectionId != null
    ? imageByDetectionId[currentDetectionId]
    : undefined;

  const updateRenderedImageSize = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img) return;

    const detection = detections[currentIndex];
    const imageData = detection ? imageByDetectionIdRef.current[detection._id] : null;
    const info = resolveImageInfo(detection, imageData);
    const imgNaturalWidth = info?.width || img.naturalWidth;
    const imgNaturalHeight = info?.height || img.naturalHeight;
    if (!imgNaturalWidth || !imgNaturalHeight) return;

    setRenderedImageSize(
      computeContainLayout(
        container.clientWidth,
        container.clientHeight,
        imgNaturalWidth,
        imgNaturalHeight
      )
    );
  }, [detections, currentIndex, resolveImageInfo]);

  // Recalculate layout when card/image changes (fixes missing boxes when onLoad does not re-fire)
  useEffect(() => {
    setRenderedImageSize({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
    const id = requestAnimationFrame(() => updateRenderedImageSize());
    return () => cancelAnimationFrame(id);
  }, [currentIndex, currentImageEntry, updateRenderedImageSize]);

  useEffect(() => {
    window.addEventListener('resize', updateRenderedImageSize);
    return () => window.removeEventListener('resize', updateRenderedImageSize);
  }, [updateRenderedImageSize]);

  const fetchUnclassifiedDetections = async ({ appendSession = false, previousBatchSize = 0 } = {}) => {
    try {
      setLoading(true);
      setImageByDetectionId({});
      if (appendSession && previousBatchSize > 0) {
        setSessionBase((prev) => prev + previousBatchSize);
      } else if (!appendSession) {
        setSessionBase(0);
      }
      const response = await axios.get('/api/cv/detections/unclassified?limit=50');
      setDetections(response.data.detections);
      setTotalUnclassified(response.data.total ?? response.data.detections.length);
      setCurrentIndex(0);
    } catch (error) {
      console.error('Error fetching detections:', error);
      toast.error('Fehler beim Laden der Erkennungen');
    } finally {
      setLoading(false);
    }
  };

  /** Only performs API call + toast. Does not advance index. Returns promise. */
  const performSwipeAction = async (action) => {
    if (detections.length === 0 || currentIndex >= detections.length) return;

    const detection = detections[currentIndex];
    const imageData = imageByDetectionIdRef.current[detection._id];

    if (action === 'delete') {
      await axios.delete(`/api/cv/detections/${detection._id}`);
      setLastUndo(null);
      toast.error('Erkennung gelöscht');
    } else {
      const actionMap = {
        'confirm_pigeon': 'confirm_pigeon',
        'no_pigeon': 'no_pigeon'
      };
      await axios.patch(`/api/cv/detections/${detection._id}/classify`, {
        action: actionMap[action]
      });
      setLastUndo({
        detection,
        action,
        imageData: imageData && imageData !== 'loading' ? imageData : undefined
      });
      if (action === 'confirm_pigeon') {
        toast.success('Als Taube bestätigt');
      } else {
        toast.warning('Keine Taube');
      }
    }
  };

  const undoLast = async () => {
    if (!lastUndo || undoBusy || loadingNext || flyAwayDirection) return;
    if (lastUndo.action === 'delete') {
      toast.info('Löschen kann nicht rückgängig gemacht werden');
      setLastUndo(null);
      return;
    }

    setUndoBusy(true);
    try {
      await axios.patch(`/api/cv/detections/${lastUndo.detection._id}/classify`, {
        action: 'unclassified'
      });

      const idStr = String(lastUndo.detection._id);
      const existingIdx = detections.findIndex((d) => String(d._id) === idStr);
      if (existingIdx >= 0) {
        setCurrentIndex(existingIdx);
      } else {
        setDetections((prev) => [lastUndo.detection, ...prev]);
        setCurrentIndex(0);
      }
      if (lastUndo.imageData) {
        setImageByDetectionId((prev) => ({
          ...prev,
          [idStr]: lastUndo.imageData
        }));
      }
      setLastUndo(null);
      setOffset({ x: 0, y: 0 });
      setSwipeDirection(null);
      setFlyAwayDirection(null);
      toast.info('Rückgängig — Karte wieder da');
    } catch (error) {
      console.error('Undo failed:', error);
      toast.error('Rückgängig fehlgeschlagen');
    } finally {
      setUndoBusy(false);
    }
  };

  const undoLastRef = useRef(undoLast);
  undoLastRef.current = undoLast;

  const advanceToNext = async () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= detections.length) {
      await fetchUnclassifiedDetections({ appendSession: true, previousBatchSize: detections.length });
    } else {
      setCurrentIndex(nextIndex);
    }
  };

  const isPointInImageArea = (clientX, clientY) => {
    const el = containerRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    );
  };

  const toggleMainZoom = (clientX, clientY) => {
    if (clientX != null && clientY != null && !isPointInImageArea(clientX, clientY)) {
      return;
    }
    setMainShowsZoom((v) => {
      if (!v && !zoomCropRef.current) return false;
      return !v;
    });
  };

  const requestDelete = () => {
    if (detections.length === 0 || currentIndex >= detections.length) return;
    setPendingDeleteDetection(detections[currentIndex]);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteDetection) return;
    setDeleteConfirmOpen(false);
    try {
      await axios.delete(`/api/cv/detections/${pendingDeleteDetection._id}`);
      setLastUndo(null);
      toast.success('Erkennung gelöscht');
      await advanceToNext();
    } catch (error) {
      console.error('Error deleting detection:', error);
      toast.error('Fehler beim Löschen der Erkennung');
    } finally {
      setPendingDeleteDetection(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmOpen(false);
    setPendingDeleteDetection(null);
    setOffset({ x: 0, y: 0 });
    setFlyAwayDirection(null);
    setSwipeDirection(null);
    setLoadingNext(false);
  };

  const handleSwipeAction = (action) => {
    if (detections.length === 0 || currentIndex >= detections.length || flyAwayDirection || loadingNext) return;
    const direction = action === 'delete' ? 'up' : action === 'confirm_pigeon' ? 'right' : 'left';
    setFlyAwayDirection(direction);
    setSwipeDirection(direction);
    setOffset(getFlyAwayTarget(direction));
    actionPromiseRef.current = action === 'delete' ? 'pending_delete' : performSwipeAction(action);
  };

  const handleSwipeActionRef = useRef(handleSwipeAction);
  handleSwipeActionRef.current = handleSwipeAction;

  // Arrow keys: ← keine Taube, → Taube, ↑ löschen; Ctrl/Cmd+Z oder U = Undo
  useEffect(() => {
    const onKeyDown = (e) => {
      if (deleteConfirmOpen) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undoLastRef.current();
        return;
      }
      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        undoLastRef.current();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSwipeActionRef.current('no_pigeon');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSwipeActionRef.current('confirm_pigeon');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleSwipeActionRef.current('delete');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteConfirmOpen]);

  const getFlyAwayTarget = (direction) => {
    const el = cardRef.current;
    const w = el?.clientWidth ?? 600;
    const h = el?.clientHeight ?? 600;
    const margin = 80;
    if (direction === 'right') return { x: w + margin, y: 0 };
    if (direction === 'left') return { x: -(w + margin), y: 0 };
    if (direction === 'up') return { x: 0, y: -(h + margin) };
    return { x: 0, y: 0 };
  };

  const handleFlyAwayComplete = () => {
    const promise = actionPromiseRef.current;
    actionPromiseRef.current = null;

    if (promise === 'pending_delete') {
      requestDelete();
      return;
    }

    setLoadingNext(true);
    setFlyAwayDirection(null);
    setSwipeDirection(null);
    if (promise) {
      promise
        .then(() => advanceToNext())
        .catch((err) => {
          console.error('Error processing swipe action:', err);
          toast.error('Fehler beim Verarbeiten der Aktion');
        })
        .finally(() => setLoadingNext(false));
    } else {
      setLoadingNext(false);
    }
  };

  // Touch handlers for mobile swipe
  const handleTouchStart = (e) => {
    if (flyAwayDirection || loadingNext) return;
    const touch = e.touches[0];
    didSwipeRef.current = false;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
  };

  const handleTouchMove = (e) => {
    if (!touchStartRef.current || flyAwayDirection || loadingNext) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    if (Math.abs(deltaX) > CLICK_MOVE_PX || Math.abs(deltaY) > CLICK_MOVE_PX) {
      didSwipeRef.current = true;
      setSwiping(true);
      setOffset({ x: deltaX, y: deltaY });

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setSwipeDirection(deltaX > 0 ? 'right' : 'left');
      } else if (deltaY < -50) {
        setSwipeDirection('up');
      } else {
        setSwipeDirection(null);
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchStartRef.current || flyAwayDirection || loadingNext) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Math.max(1, Date.now() - touchStartRef.current.time);

    const threshold = 100;
    const velocityThreshold = 0.3;
    const velocity = Math.sqrt(deltaX ** 2 + deltaY ** 2) / deltaTime;

    setSwiping(false);

    const committed = didSwipeRef.current
      && (velocity > velocityThreshold || Math.abs(deltaX) > threshold || deltaY < -threshold);
    let action = null;
    if (committed) {
      if (deltaY < -threshold) action = 'delete';
      else if (deltaX > threshold) action = 'confirm_pigeon';
      else if (deltaX < -threshold) action = 'no_pigeon';
    }

    if (committed && action) {
      const direction = action === 'delete' ? 'up' : action === 'confirm_pigeon' ? 'right' : 'left';
      setFlyAwayDirection(direction);
      setSwipeDirection(direction);
      setOffset(getFlyAwayTarget(direction));
      actionPromiseRef.current = action === 'delete' ? 'pending_delete' : performSwipeAction(action);
    } else {
      setOffset({ x: 0, y: 0 });
      setSwipeDirection(null);
      if (!didSwipeRef.current) {
        toggleMainZoom(touch.clientX, touch.clientY);
      }
    }
    touchStartRef.current = null;
    didSwipeRef.current = false;
  };

  // Mouse drag to swipe (left button only); click on image toggles full ↔ zoom
  const handleMouseDown = (e) => {
    if (flyAwayDirection || loadingNext || e.button !== 0) return;
    didSwipeRef.current = false;
    mouseStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now()
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!mouseStartRef.current || flyAwayDirection || loadingNext) return;

    const deltaX = e.clientX - mouseStartRef.current.x;
    const deltaY = e.clientY - mouseStartRef.current.y;

    if (Math.abs(deltaX) > CLICK_MOVE_PX || Math.abs(deltaY) > CLICK_MOVE_PX) {
      didSwipeRef.current = true;
      setSwiping(true);
      setOffset({ x: deltaX, y: deltaY });

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setSwipeDirection(deltaX > 0 ? 'right' : 'left');
      } else if (deltaY < -50) {
        setSwipeDirection('up');
      }
    }
  };

  const handleMouseUp = (e) => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    if (!mouseStartRef.current || flyAwayDirection || loadingNext) {
      mouseStartRef.current = null;
      return;
    }

    const deltaX = e.clientX - mouseStartRef.current.x;
    const deltaY = e.clientY - mouseStartRef.current.y;
    const threshold = 100;

    setSwiping(false);

    const committed = didSwipeRef.current
      && (Math.abs(deltaX) > threshold || deltaY < -threshold);
    let action = null;
    if (committed) {
      if (deltaY < -threshold) action = 'delete';
      else if (deltaX > threshold) action = 'confirm_pigeon';
      else if (deltaX < -threshold) action = 'no_pigeon';
    }

    if (committed && action) {
      const direction = action === 'delete' ? 'up' : action === 'confirm_pigeon' ? 'right' : 'left';
      setFlyAwayDirection(direction);
      setSwipeDirection(direction);
      setOffset(getFlyAwayTarget(direction));
      actionPromiseRef.current = action === 'delete' ? 'pending_delete' : performSwipeAction(action);
    } else {
      setOffset({ x: 0, y: 0 });
      setSwipeDirection(null);
      if (!didSwipeRef.current) {
        toggleMainZoom(e.clientX, e.clientY);
      }
    }
    mouseStartRef.current = null;
    didSwipeRef.current = false;
  };

  const getRotation = () => {
    if (!swipeDirection && !flyAwayDirection) return 0;
    const rot = offset.x / 10;
    return Math.max(-30, Math.min(30, rot));
  };

  const getOpacity = () => {
    if (flyAwayDirection) return 1;
    if (!swiping) return 1;
    const dist = Math.sqrt(offset.x ** 2 + offset.y ** 2);
    return Math.max(0.3, 1 - dist / 500);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (detections.length === 0 || currentIndex >= detections.length) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Tauben-Tinder
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          Keine unklassifizierten Erkennungen vorhanden. Alle Erkennungen wurden bereits klassifiziert!
        </Alert>
        {lastUndo && (
          <Button
            variant="outlined"
            startIcon={undoBusy ? <CircularProgress size={16} /> : <UndoIcon />}
            onClick={undoLast}
            disabled={undoBusy}
          >
            Letzte Entscheidung rückgängig
          </Button>
        )}
      </Box>
    );
  }

  const currentDetection = detections[currentIndex];
  const displayPosition = sessionBase + currentIndex + 1;
  const displayTotal = sessionBase + totalUnclassified;
  const currentImageData = imageByDetectionId[currentDetection._id];
  const currentImageLoading = currentImageData === 'loading' || currentImageData === undefined;
  const displayImage = currentImageData?.zoomed_image?.url || currentImageData?.image?.url;
  const imageInfo = resolveImageInfo(currentDetection, currentImageData);
  const targetPixelBox = resolveTargetPixelBox(currentDetection, currentImageData, imageInfo);
  const zoomCrop = imageInfo
    ? paddedCropBox(targetPixelBox, imageInfo.width, imageInfo.height)
    : null;
  zoomCropRef.current = zoomCrop;
  const mobilePipMax = 128;
  const mobilePipSize = measureZoomView(zoomCrop, mobilePipMax);
  const mobilePipPos = computePipPlacement({
    rendered: renderedImageSize,
    imageInfo,
    targetPixelBox,
    pipW: mobilePipSize.width,
    pipH: mobilePipSize.height,
    margin: 8
  });

  const renderTargetZoom = (maxSide, { showLabel = false } = {}) => {
    if (currentImageLoading) {
      return <CircularProgress size={22} sx={{ color: 'white' }} />;
    }
    if (!displayImage || !zoomCrop || !imageInfo) {
      return showLabel ? (
        <Typography variant="caption" color="grey.500">Kein Ziel</Typography>
      ) : null;
    }
    const { width: viewW, height: viewH, scale } = measureZoomView(zoomCrop, maxSide);
    return (
      <Box
        sx={{
          width: viewW,
          height: viewH,
          maxWidth: '100%',
          overflow: 'hidden',
          bgcolor: '#000',
          borderRadius: 1,
          position: 'relative',
          border: '1px solid rgba(255,255,255,0.35)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
          pointerEvents: 'none'
        }}
      >
        <Box
          component="img"
          src={displayImage}
          alt="Zielbereich"
          draggable={false}
          sx={{
            position: 'absolute',
            left: `${-zoomCrop.left * scale}px`,
            top: `${-zoomCrop.top * scale}px`,
            width: `${imageInfo.width * scale}px`,
            height: `${imageInfo.height * scale}px`,
            maxWidth: 'none',
            display: 'block',
            pointerEvents: 'none',
            userSelect: 'none'
          }}
        />
        {showBoxes && targetPixelBox && (
          <Box
            sx={{
              position: 'absolute',
              left: `${(targetPixelBox.left - zoomCrop.left) * scale}px`,
              top: `${(targetPixelBox.top - zoomCrop.top) * scale}px`,
              width: `${targetPixelBox.width * scale}px`,
              height: `${targetPixelBox.height * scale}px`,
              border: '2px solid #00e676',
              boxSizing: 'border-box',
              pointerEvents: 'none'
            }}
          />
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>
        Tauben-Tinder
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom sx={{ display: { xs: 'none', sm: 'block' } }}>
        {displayPosition} / {displayTotal} unklassifiziert — ← Keine Taube ✗ · → Taube ✓ · ↑ Löschen · U / ⌘Z Undo
      </Typography>
      <Typography variant="caption" color="text.secondary" display={{ xs: 'block', sm: 'none' }} sx={{ mb: 0.5 }}>
        {displayPosition}/{displayTotal} — Tippen: Bild/Zoom · Swipe ← ✗ · → ✓ · ↑ Löschen
      </Typography>
      <Box display="flex" flexWrap="wrap" alignItems="center" gap={1} sx={{ mb: 1 }}>
        <FormControlLabel
          control={(
            <Switch
              size="small"
              checked={showBoxes}
              onChange={(e) => setShowBoxes(e.target.checked)}
              color="success"
            />
          )}
          label={showBoxes ? 'Boxen anzeigen' : 'Boxen aus'}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={undoBusy ? <CircularProgress size={14} /> : <UndoIcon />}
          onClick={undoLast}
          disabled={!lastUndo || undoBusy || loadingNext || Boolean(flyAwayDirection)}
          title={lastUndo ? 'Letzte Klassifizierung rückgängig (U / Ctrl+Z)' : 'Nichts zum Rückgängigmachen'}
        >
          Undo
        </Button>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 2,
          maxWidth: { xs: 600, md: 920 },
          mx: 'auto'
        }}
      >
        {/* Desktop: zoom panel left */}
        <Paper
          elevation={4}
          sx={{
            display: { xs: 'none', md: 'block' },
            width: 280,
            flexShrink: 0,
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: '#111',
            alignSelf: 'stretch'
          }}
        >
          <Typography
            variant="caption"
            sx={{ display: 'block', px: 1.5, pt: 1, pb: 0.5, color: 'grey.400' }}
          >
            Ziel (Zoom)
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 420,
              px: 1,
              pb: 1.5
            }}
          >
            {renderTargetZoom(280, { showLabel: true })}
          </Box>
        </Paper>

      <Box
        sx={{
          position: 'relative',
          flex: 1,
          width: '100%',
          maxWidth: '600px',
          height: { xs: 'min(72vh, 560px)', sm: '600px' },
          touchAction: 'none',
          userSelect: 'none'
        }}
      >
        {loadingNext && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
              borderRadius: 3
            }}
          >
            <CircularProgress sx={{ color: 'white' }} size={56} />
          </Box>
        )}
        <Paper
          ref={cardRef}
          elevation={8}
          sx={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: 3,
            overflow: 'hidden',
            transform: `translate(${offset.x}px, ${offset.y}px) rotate(${getRotation()}deg)`,
            opacity: getOpacity(),
            transition: swiping && !flyAwayDirection ? 'none' : `transform ${FLY_AWAY_DURATION_MS}ms ease-out, opacity ${FLY_AWAY_DURATION_MS}ms ease-out`,
            cursor: flyAwayDirection || loadingNext ? 'default' : 'grab',
            pointerEvents: loadingNext ? 'none' : 'auto',
            '&:active': {
              cursor: flyAwayDirection || loadingNext ? 'default' : 'grabbing'
            },
            backgroundColor: '#000'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'transform' && flyAwayDirection) {
              handleFlyAwayComplete();
            }
          }}
        >
          {/* Image with bounding boxes */}
          <Box
            ref={containerRef}
            sx={{
              position: 'relative',
              width: '100%',
              height: '70%',
              backgroundColor: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {currentImageLoading && (
              <CircularProgress sx={{ color: 'white' }} />
            )}
            {!currentImageLoading && displayImage && (
              <>
              {!mainShowsZoom && (
              <Box
                ref={imageRef}
                component="img"
                src={displayImage}
                alt="Detection"
                onLoad={() => {
                  updateRenderedImageSize();
                }}
                sx={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />
              )}

              {mainShowsZoom && (
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: 1
                  }}
                >
                  {renderTargetZoom(Math.min(
                    (containerRef.current?.clientWidth || 360) - 16,
                    (containerRef.current?.clientHeight || 360) - 16
                  ))}
                </Box>
              )}

              <Tooltip title={showBoxes ? 'Boxen ausblenden' : 'Boxen einblenden'}>
                <IconButton
                  size="small"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowBoxes((v) => !v);
                  }}
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 5,
                    bgcolor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }
                  }}
                >
                  {showBoxes ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                </IconButton>
              </Tooltip>

              {/* Mobile PiP only while full frame is shown */}
              {!mainShowsZoom && (
              <Box
                sx={{
                  display: { xs: 'block', md: 'none' },
                  position: 'absolute',
                  left: mobilePipPos.left,
                  top: mobilePipPos.top,
                  bottom: mobilePipPos.bottom,
                  right: mobilePipPos.right,
                  zIndex: 4,
                  pointerEvents: 'none'
                }}
              >
                {renderTargetZoom(mobilePipMax)}
              </Box>
              )}

              {/* Draw bounding boxes */}
              {!mainShowsZoom && showBoxes && imageInfo && renderedImageSize.width > 0 && currentDetection.detections?.map((detection, index) => {
                if (!detection.bbox && !detection.position) return null;

                const imgWidth = imageInfo.width || 1;
                const imgHeight = imageInfo.height || 1;

                let rawLeft;
                let rawTop;
                let rawWidth;
                let rawHeight;

                if (currentImageData?.zoomed_image?.url && detection.position) {
                  const { center_x, center_y, width, height } = detection.position;
                  rawLeft = center_x - width / 2;
                  rawTop = center_y - height / 2;
                  rawWidth = width;
                  rawHeight = height;
                } else if (detection.bbox) {
                  const { x, y, width, height } = detection.bbox;
                  rawLeft = x;
                  rawTop = y;
                  rawWidth = width;
                  rawHeight = height;
                } else {
                  return null;
                }

                const { left: bboxLeft, top: bboxTop, width: bboxWidth, height: bboxHeight } = toPixelBBox(
                  { left: rawLeft, top: rawTop, width: rawWidth, height: rawHeight },
                  imgWidth,
                  imgHeight
                );

                const scaleX = renderedImageSize.width / imgWidth;
                const scaleY = renderedImageSize.height / imgHeight;

                const leftPx = bboxLeft * scaleX + renderedImageSize.offsetX;
                const topPx = bboxTop * scaleY + renderedImageSize.offsetY;
                const widthPx = bboxWidth * scaleX;
                const heightPx = bboxHeight * scaleY;

                if (widthPx < 1 || heightPx < 1) return null;

                const isTarget = detection.is_target_bird === true;

                return (
                  <Box
                    key={index}
                    sx={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      width: `${widthPx}px`,
                      height: `${heightPx}px`,
                      border: isTarget ? '4px solid #00e676' : '3px solid #ff1744',
                      pointerEvents: 'none',
                      boxSizing: 'border-box',
                      zIndex: isTarget ? 2 : 1
                    }}
                  />
                );
              })}
              </>
            )}
          </Box>

          {/* Detection Info */}
          <CardContent sx={{ height: '30%', overflow: 'auto', backgroundColor: '#fff' }}>
            <Typography variant="h6" gutterBottom>
              Erkennung {displayPosition} von {displayTotal}
            </Typography>
            
            <Box display="flex" flexWrap="wrap" gap={1} mb={2} alignItems="center">
              <Chip
                label={`Gerät: ${currentDetection.device?.name || 'Unbekannt'}`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={`${new Date(currentDetection.processedAt).toLocaleString()}`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={`${currentDetection.detections?.length || 0} Objekte`}
                size="small"
                variant="outlined"
                color="primary"
              />
              <DetectionSourceChips detection={currentDetection} />
              <ShootActiveIcons detection={currentDetection} />
              {(nearestAtPosition.before || nearestAtPosition.after) && (
                <>
                  {nearestAtPosition.before && (
                    <Chip
                      icon={<ArrowBackIcon />}
                      label={formatTimeDiff(nearestAtPosition.before.diffSeconds, 'before')}
                      size="small"
                      variant="outlined"
                      color="info"
                    />
                  )}
                  {nearestAtPosition.after && (
                    <Chip
                      icon={<ArrowForwardIcon />}
                      label={formatTimeDiff(nearestAtPosition.after.diffSeconds, 'after')}
                      size="small"
                      variant="outlined"
                      color="info"
                    />
                  )}
                </>
              )}
            </Box>

            <Typography variant="subtitle2" gutterBottom>
              Erkannte Objekte:
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {currentDetection.detections?.map((detection, index) => (
                <Chip
                  key={index}
                  label={`${detection.class} (${(detection.confidence * 100).toFixed(1)}%)`}
                  size="small"
                  color="primary"
                />
              ))}
            </Box>

            {(currentDetection.processingTime != null && currentDetection.processingTime !== '') && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Verarbeitungszeit: {(Number(currentDetection.processingTime) / 1000).toFixed(2)} s
              </Typography>
            )}
          </CardContent>

          {/* Swipe direction indicator (while dragging or flying away) */}
          {(swiping || flyAwayDirection) && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 10,
                pointerEvents: 'none'
              }}
            >
              {(swipeDirection || flyAwayDirection) === 'right' && (
                <FavoriteIcon sx={{ fontSize: 80, color: '#4caf50', opacity: 0.8 }} />
              )}
              {(swipeDirection || flyAwayDirection) === 'left' && (
                <CloseIcon sx={{ fontSize: 80, color: '#ff9800', opacity: 0.8 }} />
              )}
              {(swipeDirection || flyAwayDirection) === 'up' && (
                <DeleteIcon sx={{ fontSize: 80, color: '#f44336', opacity: 0.8 }} />
              )}
            </Box>
          )}
        </Paper>

        {/* Action Buttons */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            gap: { xs: 1.5, sm: 2 },
            mt: { xs: 2, sm: 4 },
            pb: { xs: 2, sm: 0 }
          }}
        >
          <IconButton
            size="large"
            color="warning"
            disabled={loadingNext || undoBusy}
            onClick={() => handleSwipeAction('no_pigeon')}
            sx={{ width: 64, height: 64 }}
            title="Keine Taube (← / Links swipen)"
          >
            <CloseIcon fontSize="large" />
          </IconButton>
          <IconButton
            size="large"
            color="error"
            disabled={loadingNext || undoBusy}
            onClick={() => handleSwipeAction('delete')}
            sx={{ width: 64, height: 64 }}
            title="Löschen (↑ / Hoch swipen)"
          >
            <DeleteIcon fontSize="large" />
          </IconButton>
          <IconButton
            size="large"
            color="success"
            disabled={loadingNext || undoBusy}
            onClick={() => handleSwipeAction('confirm_pigeon')}
            sx={{ width: 64, height: 64 }}
            title="Taube bestätigen (→ / Rechts swipen)"
          >
            <FavoriteIcon fontSize="large" />
          </IconButton>
          <IconButton
            size="large"
            disabled={!lastUndo || loadingNext || undoBusy || Boolean(flyAwayDirection)}
            onClick={undoLast}
            sx={{ width: 64, height: 64 }}
            title="Rückgängig (U / Ctrl+Z)"
          >
            <UndoIcon fontSize="large" />
          </IconButton>
        </Box>
      </Box>
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={cancelDelete}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmDelete();
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Erkennung löschen?</DialogTitle>
        <DialogContent>
          <Typography>
            Soll diese Erkennung wirklich gelöscht werden? Dies kann nicht rückgängig gemacht werden.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelDelete}>
            Abbrechen
          </Button>
          <Button onClick={confirmDelete} color="error" variant="contained" autoFocus>
            Löschen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TaubenTinder;
