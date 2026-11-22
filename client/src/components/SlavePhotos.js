import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Button,
  IconButton,
  Checkbox,
  FormControlLabel,
  CircularProgress,
  LinearProgress,
  Chip,
  Stack,
  Alert
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';

function formatWhen(iso) {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function ComparePane({ title, url, subtitle, sensor }) {
  const meta = [subtitle, sensor].filter(Boolean).join(' · ');
  return (
    <Paper
      variant="outlined"
      sx={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'stretch'
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 52,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}
      >
        <Typography variant="subtitle2" lineHeight={1.2}>{title}</Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={meta || undefined}
          sx={{ minHeight: 18 }}
        >
          {meta || '\u00a0'}
        </Typography>
      </Box>
      <Box
        sx={{
          width: '100%',
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default'
        }}
      >
        {url ? (
          <Box
            component="img"
            src={url}
            alt={title}
            sx={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: 'center'
            }}
          />
        ) : (
          <Typography color="text.secondary" variant="body2">Kein Bild</Typography>
        )}
      </Box>
    </Paper>
  );
}

export default function SlavePhotos() {
  const [tab, setTab] = useState(0);
  const [days, setDays] = useState(14);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [clusters, setClusters] = useState([]);
  const [scanned, setScanned] = useState(0);
  const [selectedHash, setSelectedHash] = useState(null);
  const [flipIndex, setFlipIndex] = useState(0);
  const [compare, setCompare] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [marked, setMarked] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  /** null | { done, total, photosRemoved } */
  const [deleteProgress, setDeleteProgress] = useState(null);

  const [pairs, setPairs] = useState([]);
  const [pairsTotal, setPairsTotal] = useState(0);
  const [pairsPage, setPairsPage] = useState(1);
  const [pairsLoading, setPairsLoading] = useState(false);
  const [pairIndex, setPairIndex] = useState(0);

  const activeCluster = useMemo(
    () => clusters.find((c) => c.hash === selectedHash) || null,
    [clusters, selectedHash]
  );

  const loadClusters = useCallback(async () => {
    setLoadingClusters(true);
    try {
      const res = await axios.get('/api/cv/slave-duplicates', { params: { days, limit: 800 } });
      setClusters(res.data.clusters || []);
      setScanned(res.data.scanned || 0);
      const first = res.data.clusters?.[0];
      if (first) {
        setSelectedHash(first.hash);
        setFlipIndex(0);
      } else {
        setSelectedHash(null);
        setCompare(null);
      }
      setMarked(new Set());
    } catch (err) {
      console.error(err);
      toast.error('Duplikate laden fehlgeschlagen');
    } finally {
      setLoadingClusters(false);
    }
  }, [days]);

  const loadPairs = useCallback(async (page = 1) => {
    setPairsLoading(true);
    try {
      const res = await axios.get('/api/cv/slave-pairs', { params: { days, limit: 40, page } });
      setPairs(res.data.items || []);
      setPairsTotal(res.data.total || 0);
      setPairsPage(page);
      setPairIndex(0);
    } catch (err) {
      console.error(err);
      toast.error('Paare laden fehlgeschlagen');
    } finally {
      setPairsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (tab === 1) loadClusters();
    else loadPairs(1);
  }, [tab, loadClusters, loadPairs]);

  const loadCompare = useCallback(async (detectionId, hash) => {
    if (!detectionId) {
      setCompare(null);
      return;
    }
    setCompareLoading(true);
    try {
      const res = await axios.get(`/api/cv/detections/${detectionId}/slave-compare`, {
        params: hash ? { hash } : undefined
      });
      setCompare(res.data);
    } catch (err) {
      console.error(err);
      setCompare(null);
      toast.error('Vergleich laden fehlgeschlagen');
    } finally {
      setCompareLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 1 || !activeCluster?.detections?.length) return;
    const det = activeCluster.detections[flipIndex];
    if (!det) return;
    loadCompare(det.id, activeCluster.hash);
  }, [tab, activeCluster, flipIndex, loadCompare]);

  useEffect(() => {
    if (tab !== 0 || !pairs.length) {
      if (tab === 0 && !pairs.length) setCompare(null);
      return;
    }
    const det = pairs[pairIndex];
    if (!det) return;
    loadCompare(det.id);
  }, [tab, pairs, pairIndex, loadCompare]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (tab === 1) setFlipIndex((i) => Math.max(0, i - 1));
        else setPairIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (tab === 1) {
          setFlipIndex((i) => Math.min((activeCluster?.detections?.length || 1) - 1, i + 1));
        } else {
          setPairIndex((i) => Math.min(pairs.length - 1, i + 1));
        }
      } else if (e.key === ' ' && tab === 1) {
        e.preventDefault();
        const id = activeCluster?.detections?.[flipIndex]?.id;
        if (!id) return;
        setMarked((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, activeCluster, flipIndex, pairs.length]);

  const currentId = tab === 1
    ? activeCluster?.detections?.[flipIndex]?.id
    : pairs[pairIndex]?.id;
  const isMarked = currentId ? marked.has(currentId) : false;

  const toggleMarkCurrent = () => {
    if (!currentId) return;
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(currentId)) next.delete(currentId);
      else next.add(currentId);
      return next;
    });
  };

  const markAllInCluster = () => {
    if (!activeCluster) return;
    setMarked((prev) => {
      const next = new Set(prev);
      activeCluster.detections.forEach((d) => next.add(d.id));
      return next;
    });
  };

  const clearMarksInCluster = () => {
    if (!activeCluster) return;
    setMarked((prev) => {
      const next = new Set(prev);
      activeCluster.detections.forEach((d) => next.delete(d.id));
      return next;
    });
  };

  const hashByDetectionId = useMemo(() => {
    const map = new Map();
    clusters.forEach((c) => {
      (c.detections || []).forEach((d) => {
        if (d?.id) map.set(d.id, c.hash);
      });
    });
    return map;
  }, [clusters]);

  const deleteMarked = async () => {
    const ids = [...marked];
    if (!ids.length) {
      toast.info('Nichts markiert');
      return;
    }
    if (!window.confirm(`${ids.length} Slave-Foto(s) von markierten Erkennungen entfernen? (Detection bleibt)`)) {
      return;
    }
    const total = ids.length;
    setDeleting(true);
    setDeleteProgress({ done: 0, total, photosRemoved: 0 });
    let photosRemoved = 0;
    let fail = 0;
    try {
      for (let i = 0; i < ids.length; i += 1) {
        try {
          const id = ids[i];
          // Per detection: use its own cluster hash (multi-cluster delete must not
          // filter everything against the currently selected cluster).
          const hash = tab === 1 ? (hashByDetectionId.get(id) || selectedHash) : undefined;
          const res = await axios.post('/api/cv/slave-photos/delete', {
            detectionIds: [id],
            hash
          });
          photosRemoved += res.data.photosRemoved || 0;
        } catch {
          fail += 1;
        }
        setDeleteProgress({ done: i + 1, total, photosRemoved });
      }
      if (photosRemoved) toast.success(`${photosRemoved} Slave-Foto(s) gelöscht`);
      if (fail) toast.error(`${fail} fehlgeschlagen`);
      setMarked(new Set());
      if (tab === 1) await loadClusters();
      else await loadPairs(pairsPage);
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

  const flipMax = tab === 1
    ? (activeCluster?.detections?.length || 0)
    : pairs.length;
  const flipPos = tab === 1 ? flipIndex + 1 : pairIndex + 1;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Slave-Bilder
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Master/Slave gegenüberstellen und identische Slave-Stills finden. Leerzeichen = markieren, ←/→ = blättern.
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36 }} disabled={deleting}>
          <Tab label="Gegenüberstellung" />
          <Tab label={`Gleich (Duplikate)${clusters.length ? ` · ${clusters.length}` : ''}`} />
        </Tabs>
        <Box sx={{ flex: 1 }} />
        {[7, 14, 30].map((d) => (
          <Chip
            key={d}
            size="small"
            label={`${d} Tage`}
            color={days === d ? 'primary' : 'default'}
            onClick={() => !deleting && setDays(d)}
            variant={days === d ? 'filled' : 'outlined'}
            disabled={deleting}
          />
        ))}
        <IconButton
          size="small"
          onClick={() => (tab === 1 ? loadClusters() : loadPairs(1))}
          disabled={loadingClusters || pairsLoading || deleting}
        >
          <RefreshIcon />
        </IconButton>
      </Stack>

      {deleteProgress && (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" fontWeight={600}>
              Lösche Slave-Fotos {deleteProgress.done} / {deleteProgress.total}…
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {deletePct}% · {deleteProgress.photosRemoved} entfernt
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={deletePct} />
        </Box>
      )}

      {(loadingClusters || pairsLoading) && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <CircularProgress />
        </Box>
      )}

      {tab === 1 && !loadingClusters && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            gap: 2,
            alignItems: 'stretch'
          }}
        >
          <Paper
            variant="outlined"
            sx={{
              width: { xs: '100%', md: 300 },
              flexShrink: 0,
              maxHeight: { md: '70vh' },
              overflow: 'auto'
            }}
          >
            <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2">
                {clusters.length} Cluster · {scanned} gescannt
              </Typography>
            </Box>
            {!clusters.length ? (
              <Alert severity="info" sx={{ m: 1.5 }}>Keine identischen Slave-Bilder im Zeitraum.</Alert>
            ) : (
              clusters.map((c) => (
                <Box
                  key={c.hash}
                  onClick={() => {
                    setSelectedHash(c.hash);
                    setFlipIndex(0);
                  }}
                  sx={{
                    px: 1.5,
                    py: 1.25,
                    cursor: 'pointer',
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: selectedHash === c.hash ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                >
                  <Typography variant="body2" fontWeight={600}>
                    {c.count}× gleich
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {c.cameraName || 'Slave'}
                    {c.sensor ? ` · ${c.sensor}` : ''}
                    {' · '}
                    {formatWhen(c.firstAt)} – {formatWhen(c.lastAt)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {c.hash.slice(0, 12)}…
                  </Typography>
                </Box>
              ))
            )}
          </Paper>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {activeCluster && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap">
                <IconButton
                  disabled={flipIndex <= 0}
                  onClick={() => setFlipIndex((i) => i - 1)}
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="body2">
                  {flipPos} / {flipMax}
                </Typography>
                <IconButton
                  disabled={flipIndex >= flipMax - 1}
                  onClick={() => setFlipIndex((i) => i + 1)}
                >
                  <ArrowForwardIcon />
                </IconButton>
                <FormControlLabel
                  control={<Checkbox checked={isMarked} onChange={toggleMarkCurrent} />}
                  label="Slave markieren"
                />
                <Button size="small" startIcon={<CheckBoxIcon />} onClick={markAllInCluster}>
                  Alle im Cluster
                </Button>
                <Button size="small" startIcon={<CheckBoxOutlineBlankIcon />} onClick={clearMarksInCluster}>
                  Cluster abwählen
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="contained"
                  startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteIcon />}
                  disabled={!marked.size || deleting}
                  onClick={deleteMarked}
                >
                  {deleteProgress
                    ? `${deleteProgress.done} / ${deleteProgress.total}`
                    : `Markierte löschen (${marked.size})`}
                </Button>
              </Stack>
            )}

            {compareLoading && (
              <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box>
            )}
            {!compareLoading && compare && (
              <>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {compare.device?.name} · {formatWhen(compare.processedAt)}
                  {compare.slave?.kind ? ` · ${compare.slave.kind === 'pre' ? 'Foto vor Vertreibung' : 'Scan'}` : ''}
                  {compare.slave?.sensor ? ` · Sensor ${compare.slave.sensor}` : ''}
                </Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  alignItems="stretch"
                  sx={{ width: '100%' }}
                >
                  <ComparePane
                    title="Master"
                    url={compare.master?.url}
                    subtitle={compare.device?.name}
                  />
                  <ComparePane
                    title="Slave"
                    url={compare.slave?.url}
                    subtitle={compare.slave?.cameraName || 'ESP'}
                    sensor={compare.slave?.sensor}
                  />
                </Stack>
              </>
            )}
          </Box>
        </Box>
      )}

      {tab === 0 && !pairsLoading && (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap">
            <IconButton disabled={pairIndex <= 0 || deleting} onClick={() => setPairIndex((i) => i - 1)}>
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="body2">
              {pairs.length ? `${pairIndex + 1} / ${pairs.length}` : '0'}
              {pairsTotal ? ` (Seite ${pairsPage}, gesamt ~${pairsTotal})` : ''}
            </Typography>
            <IconButton
              disabled={pairIndex >= pairs.length - 1 || deleting}
              onClick={() => setPairIndex((i) => i + 1)}
            >
              <ArrowForwardIcon />
            </IconButton>
            <FormControlLabel
              control={<Checkbox checked={isMarked} onChange={toggleMarkCurrent} disabled={!currentId || deleting} />}
              label="Slave markieren"
            />
            <Button
              size="small"
              color="error"
              variant="contained"
              startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteIcon />}
              disabled={!marked.size || deleting}
              onClick={deleteMarked}
            >
              {deleteProgress
                ? `${deleteProgress.done} / ${deleteProgress.total}`
                : `Markierte löschen (${marked.size})`}
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button size="small" disabled={pairsPage <= 1} onClick={() => loadPairs(pairsPage - 1)}>
              Neuere
            </Button>
            <Button
              size="small"
              disabled={pairsPage * 40 >= pairsTotal}
              onClick={() => loadPairs(pairsPage + 1)}
            >
              Ältere
            </Button>
          </Stack>

          {!pairs.length ? (
            <Alert severity="info">Keine Slave-Paare im Zeitraum.</Alert>
          ) : compareLoading ? (
            <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box>
          ) : compare ? (
            <>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                {compare.device?.name} · {formatWhen(compare.processedAt)}
                {compare.slave?.sensor ? ` · Sensor ${compare.slave.sensor}` : ''}
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems="stretch"
                sx={{ width: '100%' }}
              >
                <ComparePane title="Master" url={compare.master?.url} subtitle={compare.device?.name} />
                <ComparePane
                  title="Slave"
                  url={compare.slave?.url}
                  subtitle={compare.slave?.cameraName}
                  sensor={compare.slave?.sensor}
                />
              </Stack>
            </>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
