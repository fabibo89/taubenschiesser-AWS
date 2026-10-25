import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Slider,
  Stack,
  Typography
} from '@mui/material';
import {
  Close as CloseIcon,
  Favorite as FavoriteIcon,
  Undo as UndoIcon
} from '@mui/icons-material';

const FLY_MS = 280;
const THRESHOLD = 100;
const CARD_IMAGE_MIN_H = 280;
const BOX_COLOR = '#ed6c02';

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

function pctLabel(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)} %`;
}

function itemKey(item) {
  if (!item) return null;
  return `${item.detectionId}:${item.birdId}`;
}

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

/**
 * Schritt 5 — Tinder wie Schritte 2–4.
 * Links = Zu weit (too_far) · Rechts = Behalten (keep).
 */
function SizeFilterReview({ enabled = true, tooFarBirds = 0, onDecided }) {
  const [minPct, setMinPct] = useState(4);
  const [sliderPct, setSliderPct] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [lastUndo, setLastUndo] = useState(null);
  const [imageCache, setImageCache] = useState({});
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [swiping, setSwiping] = useState(false);
  const [flyAway, setFlyAway] = useState(null);
  const [stageMinH, setStageMinH] = useState(CARD_IMAGE_MIN_H);

  const startRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const tinderSectionRef = useRef(null);
  const tinderInViewRef = useRef(true);
  const scrollLockYRef = useRef(null);
  const triggerFlyRef = useRef(() => {});
  const undoLastRef = useRef(() => {});
  const loadingIdsRef = useRef(new Set());
  /** „Behalten“ bleibt confirmed_pigeon → Server liefert sie wieder; Session-Skip verhindert Zähler-/Karten-Sprung. */
  const keptSessionRef = useRef(new Set());
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const minShortSide = minPct / 100;
  // Stack: letzte Karte oben (wie LReviewTinder)
  const current = queue.length ? queue[queue.length - 1] : null;
  const currentKey = itemKey(current);

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
    [50, 120, 250, 400].forEach((ms) => {
      setTimeout(() => restoreScrollY(y), ms);
    });
    setTimeout(() => {
      scrollLockYRef.current = null;
    }, 450);
  }, []);

  const loadQueue = useCallback(async (pct, { silent = false, resetKept = false } = {}) => {
    const threshold = (Number.isFinite(pct) ? pct : minPct) / 100;
    if (resetKept) keptSessionRef.current.clear();
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const response = await axios.get('/api/models/dataset/size-filter', {
        params: { minShortSide: threshold, limit: 40 }
      });
      const rawItems = Array.isArray(response.data?.items) ? response.data.items : [];
      const kept = keptSessionRef.current;
      const nextItems = rawItems.filter((row) => !kept.has(itemKey(row)));
      const serverTotal = Number(response.data?.total) || 0;
      const adjustedTotal = Math.max(0, serverTotal - kept.size);
      if (silent) {
        // Nie wieder hochsetzen: Behalten bleibt serverseitig Kandidat
        setTotal((t) => Math.min(t, adjustedTotal));
      } else {
        setTotal(adjustedTotal);
      }
      setQueue((prev) => {
        if (!silent) return nextItems;
        const seen = new Set(prev.map((row) => itemKey(row)).filter(Boolean));
        const fresh = nextItems.filter((row) => {
          const key = itemKey(row);
          return key && !seen.has(key);
        });
        // Neue Kandidaten unten, aktuelle Karte (Ende) bleibt oben
        return [...fresh, ...prev];
      });
      if (!silent) {
        setImageCache({});
        setLastUndo(null);
        setOffset({ x: 0, y: 0 });
        setFlyAway(null);
      }
    } catch (err) {
      if (!silent || queueRef.current.length === 0) {
        setError(err.response?.data?.error || 'Liste konnte nicht geladen werden');
      }
      if (!silent) {
        setQueue([]);
        setTotal(0);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [minPct]);

  useEffect(() => {
    if (!enabled) return undefined;
    loadQueue(minPct, { resetKept: true });
    return undefined;
  }, [enabled, minPct, loadQueue]);

  const ensureImage = useCallback((detectionId) => {
    if (!detectionId || loadingIdsRef.current.has(detectionId)) return;
    setImageCache((prev) => {
      const existing = prev[detectionId];
      if (existing === 'loading') return prev;
      if (existing && displayImageUrl(existing)) return prev;
      loadingIdsRef.current.add(detectionId);
      axios.get(`/api/cv/detections/${detectionId}/image`)
        .then((response) => {
          if (displayImageUrl(response.data)) {
            setImageCache((p) => ({ ...p, [detectionId]: response.data }));
            return;
          }
          return axios.get(`/api/cv/detections/${detectionId}`).then((full) => {
            setImageCache((p) => ({
              ...p,
              [detectionId]: {
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
          setImageCache((p) => ({ ...p, [detectionId]: null }));
        })
        .finally(() => {
          loadingIdsRef.current.delete(detectionId);
        });
      return { ...prev, [detectionId]: 'loading' };
    });
  }, []);

  useEffect(() => {
    if (!current?.detectionId) return;
    ensureImage(current.detectionId);
    const prev = queue[queue.length - 2];
    if (prev?.detectionId) ensureImage(prev.detectionId);
  }, [current, queue, ensureImage]);

  const imageData = current ? imageCache[current.detectionId] : null;
  const imageUrl = displayImageUrl(imageData);
  const imageLoading = Boolean(current && (!imageData || imageData === 'loading'));

  const { rendered, update } = useImageLayout(
    imageRef,
    containerRef,
    `${currentKey || ''}|${imageUrl || ''}`
  );

  useEffect(() => {
    setStageMinH(CARD_IMAGE_MIN_H);
  }, [minPct]);

  useEffect(() => {
    if (rendered?.ready && rendered.height > stageMinH) {
      setStageMinH(Math.ceil(rendered.height));
    }
  }, [rendered, stageMinH]);

  const decide = async (action, targetItem) => {
    const item = targetItem || current;
    if (!item || busy) return;
    lockViewport();
    setBusy(true);
    setError('');
    try {
      const response = await axios.post(
        `/api/models/dataset/size-filter/${item.detectionId}`,
        { birdId: item.birdId, action }
      );
      const key = itemKey(item);
      if (action === 'keep' && key) {
        keptSessionRef.current.add(key);
      }
      setQueue((prev) => prev.filter((row) => itemKey(row) !== key));
      setTotal((t) => Math.max(0, t - 1));
      if (response.data?.undo) {
        setLastUndo({ undo: response.data.undo, item, action });
      } else if (action === 'keep') {
        // keep hat kein Server-Undo — Karte lokal zurückholbar
        setLastUndo({ undo: null, item, action: 'keep' });
      } else {
        setLastUndo(null);
      }
      setOffset({ x: 0, y: 0 });
      setFlyAway(null);
      if (typeof onDecided === 'function') onDecided({ action });
      const remaining = queueRef.current.filter((row) => itemKey(row) !== key).length;
      if (remaining <= 4) {
        loadQueue(minPct, { silent: true });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen');
      setOffset({ x: 0, y: 0 });
      setFlyAway(null);
    } finally {
      setBusy(false);
      unlockViewport();
    }
  };

  const undoLast = async () => {
    if (!lastUndo || busy) return;
    const snapshot = lastUndo;
    lockViewport();
    setBusy(true);
    setError('');
    try {
      if (snapshot.undo) {
        await axios.post('/api/models/dataset/size-filter/undo', { undo: snapshot.undo });
      }
      const key = itemKey(snapshot.item);
      if (snapshot.action === 'keep' && key) {
        keptSessionRef.current.delete(key);
      }
      setQueue((prev) => {
        const without = prev.filter((row) => itemKey(row) !== key);
        return [...without, snapshot.item];
      });
      setTotal((t) => t + 1);
      setLastUndo(null);
      setOffset({ x: 0, y: 0 });
      setFlyAway(null);
      if (typeof onDecided === 'function') onDecided({ action: 'undo' });
    } catch (err) {
      setError(err.response?.data?.error || 'Undo fehlgeschlagen');
    } finally {
      setBusy(false);
      unlockViewport();
    }
  };
  undoLastRef.current = undoLast;

  const markAll = async () => {
    if (markAllBusy || total === 0) return;
    if (!window.confirm(
      `Alle ${total} Kandidaten unter ${minPct.toFixed(1)} % kurze Seite als „zu weit“ markieren?`
    )) {
      return;
    }
    setMarkAllBusy(true);
    setError('');
    try {
      const response = await axios.post('/api/models/dataset/size-filter/mark-all', {
        minShortSide,
        limit: 200
      });
      const marked = response.data?.marked || 0;
      setLastUndo(null);
      await loadQueue(minPct, { resetKept: true });
      if (typeof onDecided === 'function') onDecided({ action: 'mark-all', marked });
    } catch (err) {
      setError(err.response?.data?.error || 'Massen-Markierung fehlgeschlagen');
    } finally {
      setMarkAllBusy(false);
    }
  };

  const triggerFly = (direction) => {
    if (busy || flyAway || !current) return;
    lockViewport();
    setFlyAway(direction);
    const dx = direction === 'right' ? 600 : -600;
    setOffset({ x: dx, y: -40 });
    setTimeout(() => {
      // Links = Zu weit · Rechts = Behalten (wie ← ablehnen · → behalten)
      decide(direction === 'right' ? 'keep' : 'too_far', current);
    }, FLY_MS);
  };
  triggerFlyRef.current = triggerFly;

  useEffect(() => {
    if (!enabled) {
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
  }, [enabled, currentKey]);

  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [enabled]);

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

  const bbox = bboxFromBird(current?.bird);
  let overlayStyle = null;
  if (current && bbox && rendered.ready && rendered.width) {
    const imgSize = resolveImageSize(current, imageData === 'loading' ? null : imageData);
    const pixel = toPixelBBox(
      { left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height },
      imgSize.width,
      imgSize.height
    );
    const scaleX = rendered.width / imgSize.width;
    const scaleY = rendered.height / imgSize.height;
    overlayStyle = {
      left: pixel.left * scaleX + rendered.offsetX,
      top: pixel.top * scaleY + rendered.offsetY,
      width: pixel.width * scaleX,
      height: pixel.height * scaleY
    };
  }

  const rotation = Math.max(-28, Math.min(28, offset.x / 12));
  const done = !loading && !current && total === 0;

  if (!enabled) return null;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip label={`${total} unter Schwelle`} color={total > 0 ? 'warning' : 'default'} size="small" />
        <Chip label={`${tooFarBirds} als zu weit`} size="small" variant="outlined" />
      </Stack>

      <Typography variant="body2" color="text.secondary" gutterBottom>
        Min. kurze Seite (relativ zur Bildseite)
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, maxWidth: 420 }}>
        <Slider
          value={sliderPct}
          min={0.5}
          max={20}
          step={0.5}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v} %`}
          onChange={(_, value) => setSliderPct(value)}
          onChangeCommitted={(_, value) => {
            setSliderPct(value);
            setMinPct(value);
          }}
          disabled={loading || busy || markAllBusy}
          sx={{ flex: 1 }}
        />
        <Typography variant="body2" sx={{ minWidth: 48 }}>{minPct.toFixed(1)} %</Typography>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
      )}

      {loading && queue.length === 0 ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress size={32} />
        </Box>
      ) : done && !lastUndo ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          Keine bestätigten Vögel unter {minPct.toFixed(1)} % kurze Seite.
        </Alert>
      ) : (
        <Box
          ref={tinderSectionRef}
          tabIndex={-1}
          sx={{ outline: 'none', mb: 1 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, textAlign: 'center' }}>
            {total.toLocaleString('de-DE')} offen · ← Zu weit · → Behalten
          </Typography>

          {!current ? (
            <Box textAlign="center" sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: lastUndo ? 1.5 : 0 }}>
                {lastUndo
                  ? 'Keine weiteren Karten — letzte Entscheidung kannst du noch rückgängig machen.'
                  : 'Warteschlange leer — Schwelle anpassen oder Liste aktualisieren.'}
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
                <Box
                  sx={{
                    flex: '0 0 auto',
                    px: 2,
                    py: 1.25,
                    bgcolor: offset.x > 40
                      ? '#e8f5e9'
                      : offset.x < -40
                        ? '#fff3e0'
                        : '#fff8e1',
                    color: offset.x > 40
                      ? '#2e7d32'
                      : offset.x < -40
                        ? '#e65100'
                        : '#f57c00',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    minHeight: 44,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  {offset.x > 40
                    ? 'BEHALTEN'
                    : offset.x < -40
                      ? 'ZU WEIT'
                      : `${current.role === 'side' ? 'Side' : 'Main'} · ${pctLabel(current.shortSideRatio)}`}
                </Box>

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
                  {!imageLoading && imageUrl && (
                    <>
                      <Box
                        key={currentKey}
                        ref={imageRef}
                        component="img"
                        src={imageUrl}
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
                      {!flyAway && overlayStyle && overlayStyle.width > 1 && overlayStyle.height > 1 && (
                        <Box
                          sx={{
                            position: 'absolute',
                            ...overlayStyle,
                            border: `2px solid ${BOX_COLOR}`,
                            borderRadius: 1,
                            pointerEvents: 'none',
                            boxShadow: `0 0 0 1px ${BOX_COLOR}55`,
                            boxSizing: 'border-box'
                          }}
                        />
                      )}
                    </>
                  )}
                  {!imageLoading && !imageUrl && (
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
                    {current.role === 'side' ? 'Side' : 'Main'}
                    {' · '}
                    kurze Seite {pctLabel(current.shortSideRatio)}
                    {' · '}
                    {queue.length}
                    {total > queue.length ? ` / ${total.toLocaleString('de-DE')}` : ''} geladen
                  </Typography>
                </Box>
              </Box>

              <Box display="flex" justifyContent="center" gap={3} mt={2} alignItems="center">
                <IconButton
                  color="warning"
                  size="large"
                  disabled={busy}
                  onClick={() => triggerFly('left')}
                  aria-label="Zu weit"
                  title="Zu weit (←)"
                  sx={{ bgcolor: 'warning.light', color: 'white', '&:hover': { bgcolor: 'warning.main' } }}
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
                  aria-label="Behalten"
                  title="Behalten (→)"
                  sx={{ bgcolor: 'success.light', color: 'white', '&:hover': { bgcolor: 'success.main' } }}
                >
                  <FavoriteIcon fontSize="large" />
                </IconButton>
              </Box>
            </>
          )}
        </Box>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap justifyContent="center">
        <Button size="small" onClick={() => loadQueue(minPct)} disabled={loading || busy || markAllBusy}>
          Liste aktualisieren
        </Button>
        <Button
          size="small"
          startIcon={<UndoIcon />}
          disabled={busy || !lastUndo}
          onClick={undoLast}
        >
          Undo
        </Button>
        <Button
          size="small"
          color="warning"
          disabled={markAllBusy || busy || loading || total === 0}
          onClick={markAll}
        >
          {markAllBusy ? 'Markiere…' : 'Alle als zu weit'}
        </Button>
      </Stack>
    </Box>
  );
}

export default SizeFilterReview;
