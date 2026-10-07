import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Favorite as FavoriteIcon,
  Undo as UndoIcon
} from '@mui/icons-material';

const FLY_MS = 280;
const THRESHOLD = 100;
const CARD_IMAGE_MIN_H = 280;

function restoreScrollY(y) {
  if (!Number.isFinite(y)) return;
  const apply = () => {
    window.scrollTo({ top: y, left: window.scrollX, behavior: 'auto' });
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
  setTimeout(apply, 0);
  setTimeout(apply, FLY_MS + 40);
}

const MAIN_CASE_ORDER = ['A', 'B', 'C'];
const SIDE_CASE_ORDER = ['A', 'B'];
const NEW_CASE_ORDER = ['Neu'];

const MAIN_CASE_FALLBACK = {
  A: { label: 'War Taube — Modell findet sie nicht', color: '#ed6c02', bgcolor: '#fff3e0' },
  B: { label: 'Du: keine — Modell: doch', color: '#9c27b0', bgcolor: '#f3e5f5' },
  C: { label: 'Noch offen — Modell sieht eine', color: '#0288d1', bgcolor: '#e1f5fe' }
};

const SIDE_CASE_FALLBACK = {
  A: { label: 'Side — Modell trifft', color: '#2e7d32', bgcolor: '#e8f5e9' },
  B: { label: 'Side — Modell verfehlt', color: '#ed6c02', bgcolor: '#fff3e0' }
};

const NEW_CASE_FALLBACK = {
  Neu: { label: 'Neue Box vom Nebenmodell', color: '#0288d1', bgcolor: '#e1f5fe' }
};

function bboxFromBird(bird) {
  if (!bird) return null;
  if (bird.bbox) return bird.bbox;
  if (bird.position) {
    const { center_x, center_y, width, height } = bird.position;
    return {
      x: center_x - width / 2,
      y: center_y - height / 2,
      width,
      height
    };
  }
  return null;
}

const BOX_COLORS = {
  main: { color: '#4caf50', label: 'Main (Live)' },
  side: { color: '#ed6c02', label: 'Side (Live)' },
  model: { color: '#2196f3', label: 'Nebenmodell' }
};

function BoxColorLegend({ variant = 'main', modelName, sx }) {
  const modelEntry = { ...BOX_COLORS.model, label: modelName || BOX_COLORS.model.label };
  const entries = variant === 'side'
    ? [BOX_COLORS.side, modelEntry]
    : variant === 'new'
      ? [modelEntry]
      : [BOX_COLORS.main, modelEntry];
  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      sx={{ justifyContent: 'center', ...sx }}
    >
      {entries.map((entry) => (
        <Stack key={entry.label} direction="row" spacing={0.75} alignItems="center">
          <Box
            sx={{
              width: 14,
              height: 14,
              border: `2px solid ${entry.color}`,
              borderRadius: 0.5,
              boxSizing: 'border-box',
              flexShrink: 0
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {entry.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

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

function resolveImageSize(item, imageData) {
  const zoomed = imageData?.image_info?.zoomed_size || item?.image_info?.zoomed_size;
  const original = imageData?.image_info?.original_size || item?.image_info?.original_size;
  if (zoomed?.width && zoomed?.height) return { width: zoomed.width, height: zoomed.height };
  if (original?.width && original?.height) return { width: original.width, height: original.height };
  return { width: 640, height: 480 };
}

function displayImageUrl(imageData) {
  if (!imageData || imageData === 'loading') return null;
  return (
    imageData.zoomed_image?.url
    || imageData.image?.url
    || imageData.tapo_zoomed_image?.url
    || imageData.tapo_image?.url
    || imageData.raspberry_pi_zoomed_image?.url
    || imageData.raspberry_pi_image?.url
    || null
  );
}

function itemId(item) {
  if (item?.id) return item.id;
  if (item?.detectionId == null) return null;
  if (item.caseId === 'A' || item.boxIndex == null) return `${item.detectionId}:main`;
  return `${item.detectionId}:${item.boxIndex}`;
}

function detectionIdOf(item) {
  if (item?.detectionId) return item.detectionId;
  const id = item?.id || item?._id;
  if (!id) return null;
  const s = String(id);
  const colon = s.indexOf(':');
  return colon >= 0 ? s.slice(0, colon) : s;
}

/**
 * Main A: Main-Box. Main B/C + New: L-Box. Side: Side-Vogel (+ L-Match falls vorhanden).
 */
function collectBoxes(item, variant = 'main') {
  if (variant === 'side' || item?.sideBird) {
    const boxes = [];
    const sideBbox = bboxFromBird(item?.sideBird);
    if (sideBbox) {
      boxes.push({ key: 'side', bbox: sideBbox, color: '#ed6c02', label: null });
    }
    const lBox = item?.lBox || (item?.lBoxes || [])[0];
    if (lBox?.bbox) {
      boxes.push({ key: 'l', bbox: lBox.bbox, color: '#2196f3', label: null });
    }
    return boxes;
  }
  if (variant === 'new') {
    const box = item?.lBox || (item?.lBoxes || [])[0];
    if (!box?.bbox) return [];
    return [{ key: 'l', bbox: box.bbox, color: '#2196f3', label: null }];
  }
  if (item?.caseId === 'A') {
    const main = item?.mainBird?.bbox || item?.mainBird?.position
      ? item.mainBird
      : item?.target_bird;
    const bbox = bboxFromBird(main);
    if (bbox) {
      return [{ key: 'main', bbox, color: '#4caf50', label: null }];
    }
    return [];
  }
  const box = item?.lBox || (item?.lBoxes || [])[0];
  if (!box?.bbox) return [];
  return [{
    key: 'l',
    bbox: box.bbox,
    color: '#2196f3',
    label: null
  }];
}

/**
 * Layout für width:100% / height:auto — ohne getBoundingClientRect
 * (das springt während Transform/Swipe).
 */
function useImageLayout(imageRef, containerRef, depsKey) {
  const [rendered, setRendered] = useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    ready: false
  });

  const update = useCallback(() => {
    const img = imageRef.current;
    const box = containerRef.current;
    if (!img || !box) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const drawW = box.clientWidth || img.clientWidth;
    if (!drawW) return;
    const drawH = drawW * (nh / nw);
    setRendered({
      width: drawW,
      height: drawH,
      offsetX: 0,
      offsetY: 0,
      ready: true
    });
  }, [imageRef, containerRef]);

  useEffect(() => {
    setRendered({ width: 0, height: 0, offsetX: 0, offsetY: 0, ready: false });
    let cancelled = false;
    const run = () => {
      if (!cancelled) update();
    };
    run();
    const raf = requestAnimationFrame(() => requestAnimationFrame(run));
    window.addEventListener('resize', run);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', run);
    };
  }, [depsKey, update]);

  return { rendered, update };
}

function BoxOverlays({ item, imageData, rendered, variant = 'main' }) {
  if (!rendered?.ready || !rendered?.width) return null;
  const imgSize = resolveImageSize(item, imageData);
  return collectBoxes(item, variant).map((entry) => {
    const { x, y, width, height } = entry.bbox;
    const pixel = toPixelBBox(
      { left: x, top: y, width, height },
      imgSize.width,
      imgSize.height
    );
    const scaleX = rendered.width / imgSize.width;
    const scaleY = rendered.height / imgSize.height;
    const leftPx = pixel.left * scaleX + rendered.offsetX;
    const topPx = pixel.top * scaleY + rendered.offsetY;
    const widthPx = pixel.width * scaleX;
    const heightPx = pixel.height * scaleY;
    if (widthPx < 1 || heightPx < 1) return null;
    return (
      <Box
        key={entry.key}
        sx={{
          position: 'absolute',
          left: leftPx,
          top: topPx,
          width: widthPx,
          height: heightPx,
          border: `2px solid ${entry.color}`,
          borderRadius: 1,
          pointerEvents: 'none',
          boxShadow: `0 0 0 1px ${entry.color}55`,
          boxSizing: 'border-box'
        }}
      >
        {entry.label && (
          <Typography
            component="span"
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: 'translateY(-100%)',
              bgcolor: entry.color,
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1.2,
              px: 0.5,
              borderRadius: '2px 2px 0 0'
            }}
          >
            {entry.label}
          </Typography>
        )}
      </Box>
    );
  });
}

function ImageStage({ item, imageData, loading, height = 280, variant = 'main' }) {
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const url = displayImageUrl(imageData);
  const { rendered, update } = useImageLayout(imageRef, containerRef, url);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        bgcolor: '#111',
        borderRadius: 1,
        overflow: 'hidden',
        mb: 1.5,
        lineHeight: 0
      }}
    >
      {loading && (
        <Box display="flex" alignItems="center" justifyContent="center" sx={{ minHeight: height }}>
          <CircularProgress size={28} sx={{ color: 'white' }} />
        </Box>
      )}
      {!loading && url && (
        <>
          <Box
            ref={imageRef}
            component="img"
            src={url}
            alt=""
            onLoad={update}
            sx={{
              display: 'block',
              width: '100%',
              height: 'auto'
            }}
          />
          <BoxOverlays
            item={item}
            imageData={imageData === 'loading' ? null : imageData}
            rendered={rendered}
            variant={variant}
          />
        </>
      )}
      {!loading && !url && (
        <Box display="flex" alignItems="center" justifyContent="center" sx={{ minHeight: height }}>
          <Typography color="grey.400" variant="body2">Kein Bild</Typography>
        </Box>
      )}
    </Box>
  );
}

function AccordionRow({
  item,
  caseMeta,
  caseKey,
  expanded,
  onToggle,
  imageData,
  onNeedImage,
  busy,
  rowBusy,
  onDecide,
  variant = 'main'
}) {
  const rowId = itemId(item);
  const detId = detectionIdOf(item);

  useEffect(() => {
    if (expanded && detId) onNeedImage(detId);
  }, [expanded, onNeedImage, detId]);

  const loading = imageData === 'loading' || (expanded && imageData === undefined);

  return (
    <Box
      sx={{
        mb: 1,
        borderLeft: `4px solid ${caseMeta.color}`,
        borderRadius: 1,
        bgcolor: 'background.paper',
        overflow: 'hidden'
      }}
    >
      <Box
        onClick={() => onToggle(expanded ? false : rowId)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' }
        }}
      >
        <Typography variant="body2" sx={{ flex: 1 }}>
          {item.deviceName || 'Gerät'}
          {' · '}
          {item.processedAt
            ? new Date(item.processedAt).toLocaleString('de-DE')
            : '—'}
        </Typography>
        <Chip size="small" label={caseKey} sx={{ bgcolor: caseMeta.bgcolor, color: caseMeta.color }} />
        <ExpandMoreIcon
          sx={{
            color: 'text.secondary',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s'
          }}
        />
      </Box>
      <Collapse in={expanded} unmountOnExit={false}>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          {/* Gleiche Bildbreite wie Tinder-Karte */}
          <Box sx={{ maxWidth: 560, mx: 'auto' }}>
            <ImageStage item={item} imageData={imageData} loading={loading} height={240} variant={variant} />
          </Box>
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ maxWidth: 560, mx: 'auto' }}>
            <Button
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onDecide('no_pigeon', item);
              }}
            >
              {rowBusy ? '…' : 'Keine Taube'}
            </Button>
            <Button
              variant="contained"
              color="success"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onDecide('confirm_pigeon', item);
              }}
            >
              {rowBusy ? '…' : 'Taube'}
            </Button>
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * Tinder stack + Akkordeon-Liste.
 * variant "main" | "side" | "new". selectedCases: UND-Auswahl (Default oft A&B).
 */
const LReviewTinder = ({
  modelId,
  modelName,
  enabled = true,
  liveRefresh = false,
  onDecided,
  variant = 'main',
  defaultCases = ['A', 'B']
}) => {
  const isSide = variant === 'side';
  const isNew = variant === 'new';
  const apiPath = isNew
    ? '/api/models/dataset/new-review'
    : isSide
      ? '/api/models/dataset/side-review'
      : '/api/models/dataset/l-review';
  const caseOrder = isNew ? NEW_CASE_ORDER : isSide ? SIDE_CASE_ORDER : MAIN_CASE_ORDER;
  const caseFallback = isNew ? NEW_CASE_FALLBACK : isSide ? SIDE_CASE_FALLBACK : MAIN_CASE_FALLBACK;

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [caseTotals, setCaseTotals] = useState(() => (
    Object.fromEntries(caseOrder.map((key) => [key, 0]))
  ));
  const [caseMetaById, setCaseMetaById] = useState(caseFallback);
  const [selectedCases, setSelectedCases] = useState(() => (
    defaultCases.filter((key) => caseOrder.includes(key))
  ));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imageById, setImageById] = useState({});
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [swiping, setSwiping] = useState(false);
  const [flyAway, setFlyAway] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [lastUndo, setLastUndo] = useState(null);
  const [expandedId, setExpandedId] = useState(false);
  const [tinderOpen, setTinderOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(() => ({
    ...Object.fromEntries(caseOrder.map((key) => [key, false])),
    __list: false
  }));
  const startRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const tinderSectionRef = useRef(null);
  const tinderInViewRef = useRef(false);
  const scrollLockYRef = useRef(null);
  const triggerFlyRef = useRef(() => {});
  const undoLastRef = useRef(() => {});
  const loadingIdsRef = useRef(new Set());
  const itemsRef = useRef(items);
  const selectedCasesRef = useRef(selectedCases);
  itemsRef.current = items;
  selectedCasesRef.current = selectedCases;
  const [stageMinH, setStageMinH] = useState(CARD_IMAGE_MIN_H);

  const lockViewport = useCallback(() => {
    scrollLockYRef.current = window.scrollY;
    const active = document.activeElement;
    if (active && typeof active.blur === 'function' && active !== document.body) {
      active.blur();
    }
  }, []);

  const unlockViewport = useCallback(() => {
    const y = scrollLockYRef.current;
    restoreScrollY(y);
    const section = tinderSectionRef.current;
    if (section && typeof section.focus === 'function') {
      try {
        section.focus({ preventScroll: true });
      } catch {
        section.focus();
      }
    }
    // KPI-Refresh (loadStats) kommt oft etwas später — Scroll mehrfach absichern
    [50, 120, 250, 400].forEach((ms) => {
      setTimeout(() => restoreScrollY(y), ms);
    });
    setTimeout(() => {
      scrollLockYRef.current = null;
    }, 450);
  }, []);

  const selectedSet = useMemo(() => new Set(selectedCases), [selectedCases]);
  const tinderItems = useMemo(
    () => items.filter((row) => selectedSet.has(row.caseId)),
    [items, selectedSet]
  );
  const tinderTotal = useMemo(
    () => selectedCases.reduce((sum, key) => sum + (caseTotals[key] || 0), 0),
    [selectedCases, caseTotals]
  );
  const current = tinderItems.length ? tinderItems[tinderItems.length - 1] : null;
  const busy = Boolean(busyId);
  const currentId = itemId(current);
  const currentDetectionId = detectionIdOf(current);
  const currentImage = currentDetectionId ? imageById[currentDetectionId] : null;
  const { rendered, update } = useImageLayout(
    imageRef,
    containerRef,
    `${currentId || ''}|${currentDetectionId || ''}|${currentImage?.zoomed_image?.url || currentImage?.image?.url || ''}`
  );

  useEffect(() => {
    setStageMinH(CARD_IMAGE_MIN_H);
  }, [modelId, variant]);

  useEffect(() => {
    if (rendered?.ready && rendered.height > stageMinH) {
      setStageMinH(Math.ceil(rendered.height));
    }
  }, [rendered, stageMinH]);

  const loadQueue = useCallback(async ({ silent = false } = {}) => {
    if (!enabled || !modelId) {
      setItems([]);
      setTotal(0);
      setCaseTotals(Object.fromEntries(caseOrder.map((key) => [key, 0])));
      return;
    }
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const response = await axios.get(apiPath, {
        params: { modelId, limit: 40 }
      });
      const nextItems = response.data.items || [];
      if (response.data.cases) {
        setCaseMetaById((prev) => ({ ...prev, ...response.data.cases }));
      }
      setItems((prev) => {
        if (!silent) return nextItems;
        const selected = selectedCasesRef.current;
        const prevTinder = prev.filter((row) => selected.includes(row.caseId));
        const prevLastId = itemId(prevTinder[prevTinder.length - 1]);
        if (!prevLastId) return nextItems;
        const pinned = nextItems.find((row) => itemId(row) === prevLastId);
        if (!pinned) return nextItems;
        const withoutPinned = nextItems.filter((row) => itemId(row) !== prevLastId);
        return [...withoutPinned, pinned];
      });
      const totals = response.data.caseTotals || Object.fromEntries(
        caseOrder.map((key) => [key, nextItems.filter((row) => row.caseId === key).length])
      );
      setCaseTotals(totals);
      setTotal(response.data.total ?? caseOrder.reduce((sum, key) => sum + (totals[key] || 0), 0));
      setExpandedId((prev) => {
        if (!prev) return prev;
        return nextItems.some((item) => itemId(item) === prev) ? prev : false;
      });
    } catch (err) {
      if (!silent || itemsRef.current.length === 0) {
        setError(err.response?.data?.error || 'Review-Liste fehlgeschlagen');
      }
      if (!silent) {
        setItems([]);
        setTotal(0);
        setCaseTotals(Object.fromEntries(caseOrder.map((key) => [key, 0])));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiPath, caseOrder, enabled, modelId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!enabled || !modelId || !liveRefresh || busy) return undefined;
    const timer = setInterval(() => {
      loadQueue({ silent: true });
    }, 8000);
    return () => clearInterval(timer);
  }, [busy, enabled, liveRefresh, loadQueue, modelId]);

  const ensureImage = useCallback((detId) => {
    if (!detId || loadingIdsRef.current.has(detId)) return;
    setImageById((prev) => {
      const existing = prev[detId];
      if (existing === 'loading') return prev;
      if (existing && displayImageUrl(existing)) return prev;
      loadingIdsRef.current.add(detId);
      axios.get(`/api/cv/detections/${detId}/image`)
        .then((response) => {
          if (displayImageUrl(response.data)) {
            setImageById((p) => ({ ...p, [detId]: response.data }));
            return;
          }
          // Fallback: volle Detection (manchmal liegen URLs nur dort)
          return axios.get(`/api/cv/detections/${detId}`).then((full) => {
            setImageById((p) => ({
              ...p,
              [detId]: {
                image: full.data?.image || null,
                zoomed_image: full.data?.zoomed_image || null,
                tapo_image: full.data?.tapo_image || null,
                tapo_zoomed_image: full.data?.tapo_zoomed_image || null,
                raspberry_pi_image: full.data?.raspberry_pi_image || null,
                raspberry_pi_zoomed_image: full.data?.raspberry_pi_zoomed_image || null,
                image_info: full.data?.image_info || null
              }
            }));
          });
        })
        .catch(() => {
          setImageById((p) => ({ ...p, [detId]: null }));
        })
        .finally(() => {
          loadingIdsRef.current.delete(detId);
        });
      return { ...prev, [detId]: 'loading' };
    });
  }, []);

  useEffect(() => {
    if (currentDetectionId) ensureImage(currentDetectionId);
  }, [currentDetectionId, ensureImage]);

  const buildDecidePayload = useCallback((item, action) => {
    const id = itemId(item);
    const detId = detectionIdOf(item);
    if (!item || !id || !detId) return null;
    if (isSide) {
      const birdId = item.birdId || (String(id).includes(':') ? String(id).split(':').slice(1).join(':') : null);
      if (!birdId) return null;
      return { id, detId, payload: { action, modelId, birdId } };
    }
    if (isNew) {
      const boxIndex = Number.isInteger(item?.boxIndex)
        ? item.boxIndex
        : Number(String(id).split(':')[1]);
      if (!Number.isInteger(boxIndex)) return null;
      return { id, detId, payload: { action, modelId, boxIndex } };
    }
    const isMainOnly = item.caseId === 'A' || item.boxIndex == null;
    const boxIndex = isMainOnly
      ? null
      : (Number.isInteger(item?.boxIndex) ? item.boxIndex : Number(String(id).split(':')[1]));
    if (!isMainOnly && !Number.isInteger(boxIndex)) return null;
    return { id, detId, payload: { action, modelId, boxIndex } };
  }, [isNew, isSide, modelId]);

  const decide = async (action, targetItem) => {
    const item = targetItem || current;
    const built = buildDecidePayload(item, action);
    if (!built || busyId) return;
    const { id, detId, payload } = built;

    lockViewport();
    setBusyId(id);
    setError('');
    try {
      const response = await axios.post(`${apiPath}/${detId}`, payload);
      const removeWholeDetection = !isSide && !isNew && item.caseId !== 'A' && action === 'confirm_pigeon';
      const removedSiblings = removeWholeDetection
        ? itemsRef.current.filter((row) => detectionIdOf(row) === detId && itemId(row) !== id)
        : [];
      const removedCount = 1 + removedSiblings.length;
      setItems((prev) => {
        if (removeWholeDetection) {
          return prev.filter((row) => detectionIdOf(row) !== detId);
        }
        return prev.filter((row) => itemId(row) !== id);
      });
      setCaseTotals((prev) => {
        const next = { ...prev };
        const key = item.caseId;
        if (key && next[key] != null) next[key] = Math.max(0, (next[key] || 0) - removedCount);
        return next;
      });
      setTotal((n) => Math.max(0, n - removedCount));
      if (response.data?.undo) {
        setLastUndo({
          undo: response.data.undo,
          item,
          action,
          removeWholeDetection,
          removedSiblings
        });
      } else {
        setLastUndo(null);
      }
      setOffset({ x: 0, y: 0 });
      setFlyAway(null);
      if (expandedId === id) setExpandedId(false);
      if (typeof onDecided === 'function') {
        onDecided({ id, detectionId: detId, action, ...payload });
      }
      const remaining = itemsRef.current.filter((row) => {
        if (removeWholeDetection) return detectionIdOf(row) !== detId;
        return itemId(row) !== id;
      }).filter((row) => selectedCasesRef.current.includes(row.caseId)).length;
      if (remaining <= 4) {
        loadQueue({ silent: true });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen');
      setOffset({ x: 0, y: 0 });
      setFlyAway(null);
    } finally {
      setBusyId(null);
      unlockViewport();
    }
  };

  const undoLast = async () => {
    if (!lastUndo?.undo || busyId) return;
    const snapshot = lastUndo;
    lockViewport();
    setBusyId('__undo__');
    setError('');
    try {
      await axios.post(`${apiPath}/undo`, { modelId, undo: snapshot.undo });
      const restoreCount = 1 + (snapshot.removedSiblings?.length || 0);
      const restoreIds = new Set([
        itemId(snapshot.item),
        ...(snapshot.removedSiblings || []).map((row) => itemId(row))
      ]);
      setItems((prev) => {
        const without = prev.filter((row) => !restoreIds.has(itemId(row)));
        const siblings = (snapshot.removedSiblings || []).filter(
          (row) => itemId(row) !== itemId(snapshot.item)
        );
        // Entschiedene Karte wieder aktuell (oben im Stack)
        return [...without, ...siblings, snapshot.item];
      });
      setCaseTotals((prev) => {
        const next = { ...prev };
        const key = snapshot.item?.caseId;
        if (key) next[key] = (next[key] || 0) + restoreCount;
        return next;
      });
      setTotal((n) => n + restoreCount);
      setLastUndo(null);
      setOffset({ x: 0, y: 0 });
      setFlyAway(null);
      if (typeof onDecided === 'function') {
        onDecided({ action: 'undo', detectionId: snapshot.undo.detectionId, bulk: false });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Undo fehlgeschlagen');
    } finally {
      setBusyId(null);
      unlockViewport();
    }
  };
  undoLastRef.current = undoLast;

  const acceptAllForCase = async (caseKey) => {
    if (busyId) return;
    const expected = caseTotals[caseKey] || 0;
    if (expected === 0) return;
    const batchKey = `__all__${caseKey}`;
    setBusyId(batchKey);
    setError('');
    try {
      const response = await axios.post(
        `${apiPath}/accept-all`,
        { modelId, caseId: caseKey, action: 'confirm_pigeon' },
        { timeout: 15 * 60 * 1000 }
      );
      const accepted = response.data.accepted || 0;
      const errCount = response.data.errors || 0;
      setExpandedId(false);
      setLastUndo(null);
      if (errCount > 0) {
        setError(`${accepted.toLocaleString('de-DE')} akzeptiert, ${errCount} Fehler`);
      }
      if (typeof onDecided === 'function') {
        onDecided({ action: 'confirm_pigeon', caseKey, count: accepted, bulk: true });
      }
      await loadQueue({ silent: false });
    } catch (err) {
      setError(err.response?.data?.error || 'Massen-Akzeptieren fehlgeschlagen');
      await loadQueue({ silent: true });
    } finally {
      setBusyId(null);
    }
  };

  const onCaseFilterChange = (_event, next) => {
    if (!next || next.length === 0) return;
    setSelectedCases(next.filter((key) => caseOrder.includes(key)));
  };

  const triggerFly = (direction) => {
    if (busy || flyAway || !current) return;
    lockViewport();
    setFlyAway(direction);
    const dx = direction === 'right' ? 600 : -600;
    setOffset({ x: dx, y: -40 });
    setTimeout(() => {
      decide(direction === 'right' ? 'confirm_pigeon' : 'no_pigeon', current);
    }, FLY_MS);
  };
  triggerFlyRef.current = triggerFly;

  // Pfeiltasten nur wenn dieses Tinder offen und im Viewport ist
  useEffect(() => {
    if (!tinderOpen) {
      tinderInViewRef.current = false;
      return undefined;
    }
    const el = tinderSectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      tinderInViewRef.current = true;
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        tinderInViewRef.current = Boolean(entry?.isIntersecting);
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [tinderOpen]);

  useEffect(() => {
    if (!tinderOpen || !enabled) return undefined;
    const onKeyDown = (event) => {
      if (!tinderInViewRef.current) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        triggerFlyRef.current('left');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        triggerFlyRef.current('right');
      } else if (event.key === 'Backspace' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z')) {
        event.preventDefault();
        undoLastRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, tinderOpen]);

  const onPointerDown = (event) => {
    if (busy || flyAway) return;
    const point = event.touches ? event.touches[0] : event;
    startRef.current = { x: point.clientX, y: point.clientY };
    setSwiping(true);
  };

  const onPointerMove = (event) => {
    if (!swiping || !startRef.current || flyAway) return;
    const point = event.touches ? event.touches[0] : event;
    setOffset({
      x: point.clientX - startRef.current.x,
      y: point.clientY - startRef.current.y
    });
  };

  const onPointerUp = () => {
    if (!swiping || flyAway) return;
    setSwiping(false);
    startRef.current = null;
    if (offset.x > THRESHOLD) triggerFly('right');
    else if (offset.x < -THRESHOLD) triggerFly('left');
    else setOffset({ x: 0, y: 0 });
  };

  const grouped = useMemo(() => {
    const map = Object.fromEntries(caseOrder.map((key) => [key, []]));
    items.forEach((item) => {
      const key = item.caseId;
      if (map[key]) map[key].push(item);
    });
    return map;
  }, [caseOrder, items]);

  if (!enabled || !modelId) return null;

  if (loading && items.length === 0) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error && items.length === 0 && !lastUndo) {
    return (
      <Typography color="error" variant="body2">{error}</Typography>
    );
  }

  if (items.length === 0 && total === 0 && !lastUndo) {
    return (
      <Typography variant="body2" color="text.secondary">
        Keine offenen Abgleich-Fälle für {modelName || 'dieses Modell'}.
      </Typography>
    );
  }

  const imageLoading = currentImage === 'loading' || currentImage === undefined;
  const displayImage = displayImageUrl(currentImage);
  const caseMeta = current
    ? (current.case || caseMetaById[current.caseId] || caseFallback[current.caseId] || {})
    : {};
  const rotation = Math.max(-28, Math.min(28, offset.x / 12));
  const selectedLabel = selectedCases.join('&') || '—';

  return (
    <Box>
      {error && (
        <Typography color="error" variant="caption" display="block" sx={{ mb: 1 }}>{error}</Typography>
      )}

      <Box
        ref={tinderSectionRef}
        tabIndex={-1}
        sx={{ mb: 2, outline: 'none' }}
      >
      <Accordion
        disableGutters
        expanded={tinderOpen}
        onChange={(_, open) => setTinderOpen(open)}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', pr: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
              Tinder
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {tinderTotal.toLocaleString('de-DE')} offen ({selectedLabel}) · ← keine · → Taube
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          {caseOrder.length > 1 && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                Fälle (UND):
              </Typography>
              <ToggleButtonGroup
                size="small"
                value={selectedCases}
                onChange={onCaseFilterChange}
                aria-label="Fälle filtern"
              >
                {caseOrder.map((key) => {
                  const meta = caseMetaById[key] || caseFallback[key] || {};
                  return (
                    <ToggleButton
                      key={key}
                      value={key}
                      aria-label={`Fall ${key}`}
                      sx={{
                        px: 1.5,
                        '&.Mui-selected': {
                          bgcolor: meta.bgcolor,
                          color: meta.color,
                          fontWeight: 700,
                          borderColor: meta.color,
                          '&:hover': { bgcolor: meta.bgcolor }
                        }
                      }}
                    >
                      {key}
                      <Typography component="span" variant="caption" sx={{ ml: 0.75, opacity: 0.8 }}>
                        {(caseTotals[key] || 0).toLocaleString('de-DE')}
                      </Typography>
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>
            </Stack>
          )}

          {!current ? (
            <Box textAlign="center">
              <Typography variant="body2" color="text.secondary" sx={{ mb: lastUndo ? 1.5 : 0 }}>
                {lastUndo
                  ? 'Keine weiteren Karten — letzte Entscheidung kannst du noch rückgängig machen.'
                  : `Keine Fälle für ${selectedLabel}. Andere Kombination wählen oder Liste unten nutzen.`}
              </Typography>
              {lastUndo && (
                <Button
                  variant="outlined"
                  startIcon={<UndoIcon />}
                  onClick={undoLast}
                  disabled={busy}
                >
                  Undo — letzte Karte zurückholen
                </Button>
              )}
            </Box>
          ) : (
          <>
          <Box
            sx={{
              maxWidth: 560,
              mx: 'auto',
              touchAction: 'none',
              userSelect: 'none',
              cursor: busy ? 'default' : 'grab',
              transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`,
              transition: swiping && !flyAway ? 'none' : `transform ${FLY_MS}ms ease-out`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              borderRadius: 3,
              overflow: 'hidden',
              boxShadow: 8
            }}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={() => {
              if (swiping) onPointerUp();
            }}
          >
            {/* 1) Balken darüber */}
            <Box
              sx={{
                flex: '0 0 auto',
                px: 2,
                py: 1.25,
                bgcolor: offset.x > 40
                  ? '#e8f5e9'
                  : offset.x < -40
                    ? '#ffebee'
                    : (caseMeta.bgcolor || '#eee'),
                color: offset.x > 40
                  ? '#2e7d32'
                  : offset.x < -40
                    ? '#c62828'
                    : (caseMeta.color || '#333'),
                fontWeight: 700,
                fontSize: '0.95rem',
                minHeight: 44,
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {offset.x > 40
                ? 'TAUBE'
                : offset.x < -40
                  ? 'KEINE'
                  : (caseMeta.label || current.caseId)}
            </Box>

            {/* 2) Bild — stabile Mindesthöhe gegen Scroll-Sprünge */}
            <Box
              ref={containerRef}
              sx={{
                flex: '0 0 auto',
                position: 'relative',
                width: '100%',
                minHeight: stageMinH,
                lineHeight: 0,
                bgcolor: '#000'
              }}
            >
              {imageLoading && (
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  sx={{ minHeight: stageMinH, bgcolor: '#111' }}
                >
                  <CircularProgress sx={{ color: 'white' }} />
                </Box>
              )}
              {!imageLoading && displayImage && (
                <>
                  <Box
                    key={currentId}
                    ref={imageRef}
                    component="img"
                    src={displayImage}
                    alt=""
                    onLoad={update}
                    draggable={false}
                    sx={{
                      display: 'block',
                      width: '100%',
                      height: 'auto',
                      verticalAlign: 'top',
                      bgcolor: '#000'
                    }}
                  />
                  {!flyAway && !imageLoading && (
                    <BoxOverlays
                      key={`boxes-${currentId}`}
                      item={current}
                      imageData={currentImage === 'loading' ? null : currentImage}
                      rendered={rendered}
                      variant={variant}
                    />
                  )}
                </>
              )}
              {!imageLoading && !displayImage && (
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  sx={{ minHeight: stageMinH }}
                >
                  <Typography color="grey.400">Kein Bild</Typography>
                </Box>
              )}
            </Box>

            {/* 3) Balken darunter */}
            <Box
              sx={{
                flex: '0 0 auto',
                px: 2,
                py: 1.5,
                bgcolor: '#111',
                color: 'grey.200'
              }}
            >
              <Typography variant="body2">
                {current.deviceName} · {current.processedAt
                  ? new Date(current.processedAt).toLocaleString('de-DE')
                  : '—'}
              </Typography>
            </Box>
          </Box>

          <BoxColorLegend
            variant={variant}
            modelName={modelName}
            sx={{ mt: 1.5, mb: 0.5 }}
          />
          <Box display="flex" justifyContent="center" gap={3} mt={1.5} alignItems="center">
            <IconButton
              color="error"
              size="large"
              disabled={busy}
              onClick={() => triggerFly('left')}
              aria-label="Keine Taube"
              sx={{ bgcolor: 'error.light', color: 'white', '&:hover': { bgcolor: 'error.main' } }}
            >
              <CloseIcon fontSize="large" />
            </IconButton>
            <IconButton
              color="inherit"
              size="large"
              disabled={busy || !lastUndo}
              onClick={undoLast}
              aria-label="Letzte Entscheidung rückgängig"
              title={lastUndo ? 'Undo (⌫ / Ctrl+Z)' : 'Kein Undo verfügbar'}
              sx={{
                bgcolor: lastUndo ? 'grey.300' : 'grey.100',
                color: 'text.primary',
                '&:hover': { bgcolor: 'grey.400' }
              }}
            >
              <UndoIcon fontSize="large" />
            </IconButton>
            <IconButton
              color="success"
              size="large"
              disabled={busy}
              onClick={() => triggerFly('right')}
              aria-label="Taube"
              sx={{ bgcolor: 'success.light', color: 'white', '&:hover': { bgcolor: 'success.main' } }}
            >
              <FavoriteIcon fontSize="large" />
            </IconButton>
          </Box>
          <Box display="flex" justifyContent="center" mt={1} gap={2}>
            <Button size="small" onClick={() => loadQueue()} disabled={loading || busy}>
              Liste aktualisieren
            </Button>
            <Button
              size="small"
              startIcon={<UndoIcon />}
              onClick={undoLast}
              disabled={busy || !lastUndo}
            >
              Undo
            </Button>
          </Box>
          </>
          )}
        </AccordionDetails>
      </Accordion>
      </Box>

      <Accordion
        disableGutters
        expanded={Boolean(caseOpen.__list)}
        onChange={(_, open) => setCaseOpen((prev) => ({ ...prev, __list: open }))}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', pr: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
              Liste nach Fall
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {(total || 0).toLocaleString('de-DE')} gesamt · {items.length} geladen
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            {isNew
              ? 'Neue Boxen ohne Live-Match. → als Side-Vogel übernehmen · ← verwerfen. Liste lädt nur einen Ausschnitt.'
              : isSide
                ? 'Fall A = Side-Vogel vom Nebenmodell getroffen. Fall B = Side-Vogel verfehlt. Liste lädt nur einen Ausschnitt.'
                : `Kennzahl „verfehlt Main“ = bestätigte Main-Vögel ohne ${modelName || 'Modell'}-Match. Fall A = Bilder (nicht Summe B/C). Liste lädt nur einen Ausschnitt.`}
          </Typography>
          <BoxColorLegend variant={variant} modelName={modelName} sx={{ mb: 1.5, justifyContent: 'flex-start' }} />
          {caseOrder.map((caseKey) => {
            const caseItems = grouped[caseKey] || [];
            const meta = caseMetaById[caseKey] || caseFallback[caseKey] || {};
            const fullCount = caseTotals[caseKey] || 0;
            if (fullCount === 0 && caseItems.length === 0) return null;
            const open = caseOpen[caseKey] === true;
            return (
              <Accordion
                key={caseKey}
                disableGutters
                expanded={open}
                onChange={(_, isOpen) => setCaseOpen((prev) => ({ ...prev, [caseKey]: isOpen }))}
                sx={{
                  mb: 1,
                  bgcolor: meta.bgcolor,
                  borderRadius: 1,
                  '&:before': { display: 'none' }
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: meta.color }} />}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', pr: 1 }}>
                    <Chip
                      size="small"
                      label={isNew ? caseKey : `Fall ${caseKey}`}
                      sx={{ bgcolor: meta.color, color: '#fff', fontWeight: 700 }}
                    />
                    <Typography variant="body2" sx={{ color: meta.color, fontWeight: 700, flex: 1 }}>
                      {meta.label}
                    </Typography>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      disabled={busy || fullCount === 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        acceptAllForCase(caseKey);
                      }}
                      sx={{ textTransform: 'none', flexShrink: 0 }}
                    >
                      {busyId === `__all__${caseKey}`
                        ? '…'
                        : `Akzeptiere alle${fullCount ? ` (${fullCount.toLocaleString('de-DE')})` : ''}`}
                    </Button>
                    <Typography variant="caption" sx={{ color: meta.color }}>
                      {caseItems.length < fullCount
                        ? `${caseItems.length}/${fullCount.toLocaleString('de-DE')}`
                        : fullCount.toLocaleString('de-DE')}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ bgcolor: 'background.paper', pt: 1 }}>
                  {caseItems.map((item) => {
                    const rowId = itemId(item);
                    const detId = detectionIdOf(item);
                    return (
                      <AccordionRow
                        key={rowId}
                        item={item}
                        caseMeta={meta}
                        caseKey={caseKey}
                        expanded={expandedId === rowId}
                        onToggle={setExpandedId}
                        imageData={imageById[detId]}
                        onNeedImage={ensureImage}
                        busy={busy}
                        rowBusy={busyId === rowId}
                        onDecide={decide}
                        variant={variant}
                      />
                    );
                  })}
                </AccordionDetails>
              </Accordion>
            );
          })}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default LReviewTinder;
