import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Bookmark as BookmarkIcon,
  BookmarkBorder as BookmarkBorderIcon,
  Delete as DeleteIcon,
  OpenInNew as OpenInNewIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import DetectionDetailDialog from './DetectionDetailDialog';

function formatWhen(iso) {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function formatPose(pos) {
  if (!pos || (pos.rotation == null && pos.tilt == null)) return null;
  const rot = pos.rotation != null && Number.isFinite(Number(pos.rotation))
    ? `R ${Number(pos.rotation).toFixed(0)}°`
    : null;
  const tilt = pos.tilt != null && Number.isFinite(Number(pos.tilt))
    ? `T ${Number(pos.tilt).toFixed(0)}°`
    : null;
  return [rot, tilt].filter(Boolean).join(' / ') || null;
}

function boxStatusStyle(status) {
  if (status === 'too_far') {
    return { color: '#9c27b0', label: 'zu weit' };
  }
  if (status === 'no_pigeon') {
    return { color: '#ed6c02', label: 'keine Taube' };
  }
  return { color: '#0288d1', label: 'unreviewed' };
}

function memberKeyOf(det) {
  if (!det) return null;
  return String(det.memberKey || det.id || '');
}

function formatCurrentMeta(det, { imageField, boxes, modeLabel }) {
  const list = Array.isArray(boxes) ? boxes : [];
  const neg = list.filter((b) => b.status === 'no_pigeon' || b.status === 'too_far').length;
  const open = list.filter((b) => !b.status || b.status === 'unreviewed').length;
  const boxParts = [];
  if (neg > 0) boxParts.push(`${neg}× keine Taube/zu weit`);
  if (open > 0) boxParts.push(`${open}× unreviewed`);
  const focusStyle = det?.focusStatus ? boxStatusStyle(det.focusStatus) : null;
  const focusPart = focusStyle
    ? `Fokus: ${focusStyle.label}${det?.birdId ? ` (${det.birdId})` : ''}`
    : null;
  const parts = [
    modeLabel || 'Ähnliche Box',
    det?.processedAt ? formatWhen(det.processedAt) : null,
    formatPose(det?.camera_position),
    det?.cam || null,
    imageField || null,
    focusPart,
    boxParts.length ? boxParts.join(', ') : null
  ];
  return parts.filter(Boolean).join(' · ');
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

function resolveImageSize(det, imageData) {
  const zoomed = imageData?.image_info?.zoomed_size || det?.image_info?.zoomed_size;
  const original = imageData?.image_info?.original_size || det?.image_info?.original_size;
  if (zoomed?.width && zoomed?.height) return { width: zoomed.width, height: zoomed.height };
  if (original?.width && original?.height) return { width: original.width, height: original.height };
  return { width: 640, height: 480 };
}

/**
 * variant:
 * - classic: strict export-negative, 1 hash/doc (primary box)
 * - objects: loose filter, per-box aHash
 * Both: similar + detection crop, full history (no days/limit cap).
 */
export default function NegativeDupesReview({
  enabled = true,
  onChanged,
  variant = 'objects'
}) {
  const isClassic = variant === 'classic';
  const [loading, setLoading] = useState(false);
  const [clusters, setClusters] = useState([]);
  const [scanned, setScanned] = useState(0);
  const [negatives, setNegatives] = useState(0);
  const [selectedHash, setSelectedHash] = useState(null);
  const [flipIndex, setFlipIndex] = useState(0);
  const [keepIds, setKeepIds] = useState(() => new Set());
  const [thumbUrl, setThumbUrl] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null);
  const [rendered, setRendered] = useState({ ready: false, width: 0, height: 0, offsetX: 0, offsetY: 0 });
  const [detailDetectionId, setDetailDetectionId] = useState(null);
  const containerRef = useRef(null);
  const imageRef = useRef(null);

  const active = useMemo(
    () => clusters.find((c) => c.hash === selectedHash) || null,
    [clusters, selectedHash]
  );

  const detailNeighborIds = useMemo(
    () => (active?.detections || []).map((d) => d.id).filter(Boolean),
    [active]
  );

  const loadClusters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/models/dataset/negative-duplicates', {
        params: {
          days: 0,
          limit: 0,
          minCount: 2,
          mode: 'similar',
          scope: 'detection',
          unit: isClassic ? 'doc' : 'box',
          strict: isClassic ? 1 : 0,
          maxDistance: 8
        },
        timeout: 900000
      });
      const list = res.data.clusters || [];
      setClusters(list);
      setScanned(res.data.scanned || 0);
      setNegatives(res.data.negatives || 0);
      if (list.length) {
        setSelectedHash(list[0].hash);
        setFlipIndex(0);
        const seed = list[0].keepId
          || memberKeyOf(list[0].detections?.[0]);
        setKeepIds(seed ? new Set([String(seed)]) : new Set());
      } else {
        setSelectedHash(null);
        setKeepIds(new Set());
        setThumbUrl(null);
        setImageData(null);
      }
    } catch (err) {
      console.error(err);
      toast.error('Negativ-Cluster konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [isClassic]);

  useEffect(() => {
    if (!enabled) return undefined;
    loadClusters();
    return undefined;
  }, [enabled, loadClusters]);

  const currentDet = active?.detections?.[flipIndex] || null;
  const currentId = currentDet?.id || null;
  const currentMemberKey = memberKeyOf(currentDet);
  const currentKept = Boolean(currentMemberKey && keepIds.has(currentMemberKey));
  const keepCount = keepIds.size;
  const clusterSize = active?.detections?.length || 0;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (deleting || detailDetectionId) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) {
        return;
      }
      if (!clusterSize) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setFlipIndex((i) => Math.max(0, i - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setFlipIndex((i) => Math.min(clusterSize - 1, i + 1));
      } else if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        if (!currentMemberKey) return;
        setKeepIds((prev) => {
          const next = new Set(prev);
          if (next.has(currentMemberKey)) next.delete(currentMemberKey);
          else next.add(currentMemberKey);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, deleting, detailDetectionId, clusterSize, currentMemberKey]);

  // Seed / reset keep marks when switching cluster.
  useEffect(() => {
    if (!selectedHash) {
      setKeepIds(new Set());
      return;
    }
    const cluster = clusters.find((c) => c.hash === selectedHash);
    const seed = cluster?.keepId || memberKeyOf(cluster?.detections?.[0]);
    setKeepIds(seed ? new Set([String(seed)]) : new Set());
  }, [selectedHash]); // eslint-disable-line react-hooks/exhaustive-deps -- only reset on cluster switch

  const toggleKeepCurrent = () => {
    if (!currentMemberKey || deleting) return;
    setKeepIds((prev) => {
      const next = new Set(prev);
      if (next.has(currentMemberKey)) next.delete(currentMemberKey);
      else next.add(currentMemberKey);
      return next;
    });
  };

  const openCurrentDetail = () => {
    if (!currentId || deleting) return;
    setDetailDetectionId(String(currentId));
  };

  /** Local list update — no full re-hash of all negatives. */
  const removeIdsFromClusters = useCallback((idsToRemove) => {
    const removeSet = new Set((idsToRemove || []).map((id) => String(id)));
    if (!removeSet.size) return;
    setClusters((prev) => {
      const next = prev
        .map((c) => {
          const detections = (c.detections || []).filter((d) => !removeSet.has(String(d.id)));
          if (detections.length === (c.detections || []).length) return c;
          return {
            ...c,
            detections,
            count: detections.length,
            keepId: detections[0]?.id || null,
            sampleDetectionId: detections[0]?.id || null,
            thumbUrl: detections[0]?.thumbUrl || c.thumbUrl || null
          };
        })
        .filter((c) => c.count >= 2);
      setSelectedHash((prevHash) => {
        if (prevHash && next.some((c) => c.hash === prevHash)) return prevHash;
        return next[0]?.hash || null;
      });
      return next;
    });
    setNegatives((n) => Math.max(0, n - removeSet.size));
    setKeepIds((prev) => {
      const next = new Set([...prev].filter((id) => !removeSet.has(String(id))));
      return next;
    });
    setFlipIndex(0);
  }, []);

  const handleDetailDeleted = (id) => {
    removeIdsFromClusters([id]);
    setDetailDetectionId(null);
    if (typeof onChanged === 'function') onChanged();
  };

  useEffect(() => {
    // Large pane = full frame only (list thumbs stay as box crops).
    setThumbUrl(null);
    setImageData(null);
    setRendered({ ready: false, width: 0, height: 0, offsetX: 0, offsetY: 0 });

    if (!currentId) {
      setThumbLoading(false);
      return undefined;
    }

    let cancelled = false;
    setThumbLoading(true);
    (async () => {
      try {
        const res = await axios.get(`/api/cv/detections/${currentId}/image`, {
          timeout: 90000
        });
        if (cancelled) return;
        setImageData(res.data || null);
        // Prefer the stored frame used for boxes (zoomed), then original.
        // Never use the tiny list crop here — that was the pixelated “Ausschnitt” bug.
        const url =
          res.data?.zoomed_image?.url
          || res.data?.image?.url
          || res.data?.tapo_zoomed_image?.url
          || res.data?.tapo_image?.url
          || res.data?.raspberry_pi_zoomed_image?.url
          || res.data?.raspberry_pi_image?.url
          || null;
        setThumbUrl(url);
        if (!url) toast.warn('Kein Vollbild in der Detection gespeichert');
      } catch (err) {
        if (cancelled) return;
        setThumbUrl(null);
        setImageData(null);
        const status = err.response?.status;
        const msg = err.response?.data?.error
          || (err.code === 'ECONNABORTED' ? 'Bild-Timeout' : null)
          || 'Vollbild konnte nicht geladen werden';
        toast.warn(status ? `${msg} (${status})` : msg);
      } finally {
        if (!cancelled) setThumbLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const updateLayout = useCallback(() => {
    const img = imageRef.current;
    const box = containerRef.current;
    if (!img || !box || !img.naturalWidth) {
      setRendered({ ready: false, width: 0, height: 0, offsetX: 0, offsetY: 0 });
      return;
    }
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    setRendered({
      ready: true,
      width,
      height,
      offsetX: (cw - width) / 2,
      offsetY: (ch - height) / 2
    });
  }, []);

  useEffect(() => {
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, [updateLayout, thumbUrl]);

  const overlayBoxes = useMemo(() => {
    const boxes = currentDet?.boxes || [];
    // Overlay only on full-frame image (crop preview has different coordinate space)
    const hasFullFrame = Boolean(
      imageData?.zoomed_image?.url || imageData?.image?.url
    );
    if (!hasFullFrame || !boxes.length || !rendered.ready || !rendered.width) return [];
    const imgSize = resolveImageSize(currentDet, imageData);
    return boxes.map((bbox, i) => {
      const pixel = toPixelBBox(
        { left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height },
        imgSize.width,
        imgSize.height
      );
      const scaleX = rendered.width / imgSize.width;
      const scaleY = rendered.height / imgSize.height;
      const style = boxStatusStyle(bbox.status);
      const focused = Boolean(bbox.focused);
      return {
        key: `box-${i}-${bbox.birdId || bbox.status || 'open'}`,
        left: pixel.left * scaleX + rendered.offsetX,
        top: pixel.top * scaleY + rendered.offsetY,
        width: pixel.width * scaleX,
        height: pixel.height * scaleY,
        color: style.color,
        label: focused ? `${style.label} · Fokus` : style.label,
        focused
      };
    }).filter((b) => b.width > 1 && b.height > 1);
  }, [currentDet, imageData, rendered]);

  const pruneCluster = async ({ keepMarked }) => {
    if (!active) return;
    const members = active.detections || [];
    if (members.length < (keepMarked ? 2 : 1)) {
      toast.info('Nichts zu löschen');
      return;
    }
    let keepMemberKeys = new Set();
    if (keepMarked) {
      const validKeys = new Set(members.map((m) => memberKeyOf(m)).filter(Boolean));
      keepMemberKeys = new Set([...keepIds].map(String).filter((k) => validKeys.has(k)));
      if (!keepMemberKeys.size && currentMemberKey) keepMemberKeys.add(currentMemberKey);
      if (!keepMemberKeys.size) {
        const first = memberKeyOf(members[0]);
        if (first) keepMemberKeys.add(first);
      }
    }
    // Delete whole detection docs for non-kept members (unique ids).
    const deleteIds = [
      ...new Set(
        (keepMarked
          ? members.filter((m) => !keepMemberKeys.has(memberKeyOf(m)))
          : members
        ).map((m) => String(m.id)).filter(Boolean)
      )
    ];
    if (!deleteIds.length) {
      toast.info('Nichts zu löschen — alle sind als behalten markiert');
      return;
    }
    const msg = keepMarked
      ? `${deleteIds.length} Detections löschen (${keepMemberKeys.size} Boxen behalten)?`
      : `ganzen Cluster (${members.length} Boxen / ${deleteIds.length} Detections) löschen?`;
    if (!window.confirm(msg)) return;

    setDeleting(true);
    setDeleteProgress({ done: 0, total: deleteIds.length });
    let deleted = 0;
    let fail = 0;
    try {
      const chunk = 80;
      for (let i = 0; i < deleteIds.length; i += chunk) {
        const slice = deleteIds.slice(i, i + chunk);
        try {
          const res = await axios.post('/api/models/dataset/negative-duplicates/delete', {
            ids: slice
          });
          deleted += res.data.deleted || 0;
        } catch {
          fail += slice.length;
        }
        setDeleteProgress({
          done: Math.min(i + slice.length, deleteIds.length),
          total: deleteIds.length
        });
      }
      if (deleted) toast.success(`${deleted} gelöscht`);
      if (fail) toast.error(`${fail} fehlgeschlagen`);
      if (deleted && !fail) {
        // Keep UI snappy: patch cluster list locally instead of re-hashing everything.
        removeIdsFromClusters(deleteIds);
      } else if (deleted && fail) {
        await loadClusters();
      }
      if (typeof onChanged === 'function') onChanged();
    } catch (err) {
      console.error(err);
      toast.error('Löschen fehlgeschlagen');
    } finally {
      setDeleting(false);
      setDeleteProgress(null);
    }
  };

  const deletePct = deleteProgress && deleteProgress.total > 0
    ? Math.round((deleteProgress.done / deleteProgress.total) * 100)
    : 0;

  if (!enabled) return null;

  const modeLabel = 'Ähnliche Box';

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
          onClick={loadClusters}
          disabled={loading || deleting}
        >
          Aktualisieren
        </Button>
        <Typography variant="body2" color="text.secondary">
          {clusters.length} Cluster · {negatives} Negativ · {scanned} gescannt (alle)
          {isClassic ? ' · aHash · 1 Box/Doc · strikt' : ' · Box-Objekte'}
        </Typography>
      </Stack>

      <Alert severity="info" sx={{ mb: 1.5 }}>
        {isClassic
          ? 'Klassisch: ähnliche Detection-Box (größte Negativ-Box), 1 Hash pro Doc, strikt alle Birds negativ — volle Historie, kein Limit.'
          : 'Jede Finding-Box einzeln (z.B. Schaufel- und Eimer-Cluster getrennt). Liste = Box-Ausschnitt; Löschen entfernt die ganze Detection.'}
      </Alert>

      {deleteProgress && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Lösche {deleteProgress.done} / {deleteProgress.total}…
          </Typography>
          <LinearProgress variant="determinate" value={deletePct} sx={{ mt: 0.5 }} />
        </Box>
      )}

      {loading && !clusters.length ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <CircularProgress />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {isClassic
              ? 'Negatives werden gescannt — kann etwas dauern…'
              : 'Alle Negatives werden gescannt (Boxen schneiden & hashen) — kann einige Minuten dauern…'}
          </Typography>
        </Box>
      ) : !clusters.length ? (
        <Alert severity="success">
          {isClassic
            ? 'Keine Duplikat-Cluster gefunden (mind. 2×).'
            : 'Keine ähnlichen Detection-Ausschnitte (mind. 2×, Box nötig).'}
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
          <Paper
            variant="outlined"
            sx={{
              width: { md: 300 },
              maxHeight: 420,
              overflow: 'auto',
              flexShrink: 0
            }}
          >
            {clusters.map((c) => (
              <Box
                key={c.hash}
                onClick={() => {
                  if (deleting) return;
                  setSelectedHash(c.hash);
                  setFlipIndex(0);
                  // keepIds reset via selectedHash effect
                }}
                sx={{
                  px: 1.25,
                  py: 1,
                  cursor: deleting ? 'default' : 'pointer',
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: selectedHash === c.hash ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: deleting ? undefined : 'action.hover' },
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25
                }}
              >
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    flexShrink: 0,
                    borderRadius: 1,
                    overflow: 'hidden',
                    bgcolor: 'action.hover',
                    border: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {c.thumbUrl ? (
                    <Box
                      component="img"
                      src={c.thumbUrl}
                      alt="Detection-Ausschnitt"
                      sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Typography variant="caption" color="text.disabled">–</Typography>
                  )}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {c.count}× ähnlich · Box{!isClassic ? ' · Objekt' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    {formatWhen(c.firstAt)} – {formatWhen(c.lastAt)}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Paper>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {active && (
              <>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                  <IconButton
                    disabled={flipIndex <= 0 || deleting}
                    onClick={() => setFlipIndex((i) => i - 1)}
                  >
                    <ArrowBackIcon />
                  </IconButton>
                  <Typography variant="body2">
                    {flipIndex + 1} / {active.count}
                  </Typography>
                  <IconButton
                    disabled={flipIndex >= active.count - 1 || deleting}
                    onClick={() => setFlipIndex((i) => i + 1)}
                  >
                    <ArrowForwardIcon />
                  </IconButton>
                  <Button
                    size="small"
                    variant={currentKept ? 'contained' : 'outlined'}
                    color="success"
                    startIcon={currentKept ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                    disabled={deleting || !currentId}
                    onClick={toggleKeepCurrent}
                  >
                    {currentKept ? 'Behalten' : 'Behalten markieren'}
                  </Button>
                  <Chip
                    size="small"
                    color={keepCount > 0 ? 'success' : 'default'}
                    label={`${keepCount} behalten`}
                    variant={keepCount > 0 ? 'filled' : 'outlined'}
                  />
                  <Button
                    size="small"
                    color="warning"
                    variant="contained"
                    startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteIcon />}
                    disabled={deleting || active.count < 2 || keepCount >= active.count}
                    onClick={() => pruneCluster({ keepMarked: true })}
                  >
                    {deleteProgress
                      ? `${deleteProgress.done} / ${deleteProgress.total}`
                      : `Extras löschen (${Math.max(keepCount, 1)} behalten)`}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    disabled={deleting}
                    onClick={() => pruneCluster({ keepMarked: false })}
                  >
                    Cluster löschen
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<OpenInNewIcon />}
                    disabled={deleting || !currentId}
                    onClick={openCurrentDetail}
                  >
                    Details
                  </Button>
                </Stack>

                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {formatCurrentMeta(currentDet, {
                    imageField: active.imageField || 'image',
                    boxes: currentDet?.boxes || [],
                    modeLabel
                  })}
                </Typography>

                <Paper
                  ref={containerRef}
                  variant="outlined"
                  onClick={openCurrentDetail}
                  title={currentId ? 'Klicken → Detection-Details' : undefined}
                  sx={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: 480,
                    aspectRatio: '1 / 1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    bgcolor: 'background.default',
                    cursor: currentId && !deleting ? 'pointer' : 'default',
                    outline: currentKept ? '2px solid' : 'none',
                    outlineColor: 'success.main',
                    outlineOffset: -1
                  }}
                >
                  {currentKept && (
                    <Chip
                      size="small"
                      color="success"
                      icon={<BookmarkIcon />}
                      label="behalten"
                      sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleKeepCurrent();
                      }}
                    />
                  )}
                  {thumbLoading ? (
                    <CircularProgress size={28} />
                  ) : thumbUrl ? (
                    <>
                      <Box
                        component="img"
                        ref={imageRef}
                        src={thumbUrl}
                        alt="Negativ"
                        onLoad={updateLayout}
                        sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                      {overlayBoxes.map((box) => (
                        <Box
                          key={box.key}
                          sx={{
                            position: 'absolute',
                            left: box.left,
                            top: box.top,
                            width: box.width,
                            height: box.height,
                            border: `${box.focused ? 3 : 2}px solid ${box.color}`,
                            borderRadius: 1,
                            pointerEvents: 'none',
                            boxShadow: box.focused
                              ? `0 0 0 2px ${box.color}aa`
                              : `0 0 0 1px ${box.color}55`,
                            boxSizing: 'border-box',
                            zIndex: box.focused ? 2 : 1
                          }}
                        >
                          <Typography
                            component="span"
                            sx={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              transform: 'translateY(-100%)',
                              bgcolor: box.color,
                              color: '#fff',
                              fontSize: 10,
                              fontWeight: 700,
                              lineHeight: 1.2,
                              px: 0.5,
                              borderRadius: '2px 2px 0 0',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {box.label}
                          </Typography>
                        </Box>
                      ))}
                    </>
                  ) : (
                    <Typography color="text.secondary" variant="body2">Kein Bild</Typography>
                  )}
                </Paper>

                {active.count > 1 && (
                  <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', maxWidth: 480 }} useFlexGap>
                    {(active.detections || []).map((d, i) => {
                      const key = memberKeyOf(d) || String(i);
                      const kept = keepIds.has(key);
                      const selected = i === flipIndex;
                      return (
                        <Box
                          key={key}
                          onClick={() => !deleting && setFlipIndex(i)}
                          title={kept ? `Box ${i + 1} · behalten` : `Box ${i + 1}`}
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            cursor: deleting ? 'default' : 'pointer',
                            bgcolor: kept ? 'success.main' : selected ? 'primary.main' : 'action.disabled',
                            outline: selected ? '2px solid' : 'none',
                            outlineColor: 'text.primary',
                            outlineOffset: 1,
                            flexShrink: 0
                          }}
                        />
                      );
                    })}
                  </Stack>
                )}
              </>
            )}
          </Box>
        </Box>
      )}

      <DetectionDetailDialog
        open={Boolean(detailDetectionId)}
        detectionId={detailDetectionId}
        neighborIds={detailNeighborIds}
        onClose={() => setDetailDetectionId(null)}
        onDeleted={handleDetailDeleted}
      />
    </Box>
  );
}

/** Two tabs under ModelCreate step 6: classic rules + box-object clusters. */
export function NegativeDupesTabs({ enabled = true, onChanged }) {
  const [subTab, setSubTab] = useState(0);
  return (
    <Box>
      <Tabs
        value={subTab}
        onChange={(_, value) => setSubTab(value)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Klassisch" />
        <Tab label="Box-Objekte" />
      </Tabs>
      {subTab === 0 ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Ursprüngliche Regel: ähnlich · Detection, strikt export-negativ, 1 Hash pro Doc — volle Historie.
          </Typography>
          <NegativeDupesReview variant="classic" enabled={enabled} onChanged={onChanged} />
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Aktuell: jede Finding-Box einzeln (aHash), volle Historie, auch mit unreviewed Zweit-Box.
            Multi-Keep; Löschen entfernt die ganze Detection.
          </Typography>
          <NegativeDupesReview variant="objects" enabled={enabled} onChanged={onChanged} />
        </>
      )}
    </Box>
  );
}
