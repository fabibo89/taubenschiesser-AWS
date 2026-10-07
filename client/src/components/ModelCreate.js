import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import ShootProgressBar from './ShootProgressBar';
import LReviewTinder from './LReviewTinder';

const TABS = [
  {
    id: 'data',
    label: 'Daten',
    title: 'Daten vorbereiten',
    text: 'Hier kommen die Erkennungen raus, aus denen das neue Modell lernt.'
  },
  {
    id: 'training',
    label: 'Training',
    title: 'Modell trainieren',
    text: 'Hier wird aus den vorbereiteten Daten das Modell gebaut.'
  },
  {
    id: 'esp',
    label: 'ESP-P4',
    title: 'Auf dem ESP-P4',
    text: 'Hier landet das fertige Modell auf dem ESP-P4.'
  },
  {
    id: 'benchmark',
    label: 'Benchmark',
    title: 'Benchmark',
    text: 'Hier wird das Modell auf dem Gerät mit den anderen Läufen verglichen.'
  }
];

const STATS = [
  { key: 'images', label: 'Bilder' },
  { key: 'birds', label: 'Vögel' },
  { key: 'confirmedBirds', label: 'Bestätigte Vögel' }
];

const numberFormat = new Intl.NumberFormat('de-DE');

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function jobTiming(job, nowMs = Date.now()) {
  if (!job?.startedAt) return null;
  const start = Date.parse(job.startedAt);
  if (!Number.isFinite(start)) return null;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : nowMs;
  const elapsedMs = Math.max(0, end - start);
  const processed = Number(job.processed) || 0;
  const total = Number(job.total) || 0;
  const remaining = Math.max(0, total - processed);
  let etaMs = null;
  if (job.status === 'running' && processed > 0 && remaining > 0 && elapsedMs > 0) {
    etaMs = (elapsedMs / processed) * remaining;
  }
  return { elapsedMs, etaMs, remaining };
}

const ModelCreate = () => {
  const [tab, setTab] = useState(TABS[0].id);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState('');
  const [statsLoading, setStatsLoading] = useState(true);
  const [job, setJob] = useState({ status: 'idle' });
  const [actionError, setActionError] = useState('');
  const [starting, setStarting] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const [valRatio, setValRatio] = useState(0.2);
  const [exportPreview, setExportPreview] = useState(null);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const [exportPreviewError, setExportPreviewError] = useState('');
  const [exportJob, setExportJob] = useState({ status: 'idle' });
  const [exportError, setExportError] = useState('');
  const [exportStarting, setExportStarting] = useState(false);
  const current = TABS.find((item) => item.id === tab) || TABS[0];

  const replayModels = stats?.replayModels || [];
  const availableModels = replayModels.filter((model) => model.present);
  const selectedModel = availableModels.find((model) => model.id === selectedModelId)
    || stats?.selectedModel
    || null;
  const lReplay = stats?.lReplay || {};

  const jobRunning = job.status === 'running';
  const timing = jobTiming(job, nowMs);
  const overallDone = lReplay.done || 0;
  const overallPending = lReplay.pending || 0;
  const overallTotal = overallDone + overallPending;
  const progressValue = jobRunning ? (job.processed || 0) : overallDone;
  const progressMax = jobRunning
    ? Math.max(1, job.total || 0)
    : Math.max(1, overallTotal || 1);

  const loadStats = useCallback(async (modelId, options = {}) => {
    const quiet = options.quiet === true;
    if (!quiet) setStatsError('');
    try {
      const params = modelId ? { modelId } : undefined;
      const response = await axios.get('/api/models/dataset', { params });
      setStats(response.data);
      const present = (response.data.replayModels || []).filter((model) => model.present);
      const nextId = response.data.selectedModel?.id
        || (present.length === 1 ? present[0].id : '')
        || present[0]?.id
        || '';
      setSelectedModelId((prev) => {
        if (prev && present.some((model) => model.id === prev)) return prev;
        return nextId;
      });
    } catch (err) {
      if (!quiet) {
        setStatsError(err.response?.data?.error || 'Kennzahlen konnten nicht geladen werden');
      }
    } finally {
      if (!quiet) setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats(selectedModelId || undefined);
  }, [loadStats, selectedModelId]);

  useEffect(() => {
    if (!jobRunning) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobRunning]);

  useEffect(() => {
    let timer;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await axios.get('/api/models/replay');
        if (cancelled) return;
        const next = response.data || { status: 'idle' };
        setJob(next);
        if (next.status === 'running') {
          await loadStats(selectedModelId || undefined, { quiet: true });
          if (!cancelled) timer = setTimeout(poll, 2000);
        } else if (next.status === 'done' || next.status === 'stopped') {
          await loadStats(selectedModelId || undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setActionError(err.response?.data?.error || 'Laufstatus nicht verfügbar');
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job.status, loadStats, selectedModelId]);

  const startReplay = async () => {
    if (!selectedModel?.id) return;
    setStarting(true);
    setActionError('');
    try {
      const response = await axios.post(`/api/models/${selectedModel.id}/replay`, { createsBirds: false });
      setJob(response.data);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Lauf konnte nicht gestartet werden');
    } finally {
      setStarting(false);
    }
  };

  const stopReplay = async () => {
    setActionError('');
    try {
      const response = await axios.post('/api/models/replay/stop');
      setJob(response.data);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Lauf konnte nicht gestoppt werden');
    }
  };

  const modelLabel = selectedModel?.name || 'Modell';

  const loadExportPreview = useCallback(async (ratio) => {
    setExportPreviewError('');
    setExportPreviewLoading(true);
    try {
      const response = await axios.get('/api/models/dataset/export-preview', {
        params: { valRatio: ratio }
      });
      setExportPreview(response.data);
    } catch (err) {
      setExportPreviewError(err.response?.data?.error || 'Export-Vorschau fehlgeschlagen');
    } finally {
      setExportPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'training') return undefined;
    loadExportPreview(valRatio);
    return undefined;
  }, [tab, valRatio, loadExportPreview]);

  useEffect(() => {
    if (tab !== 'training') return undefined;
    let timer;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await axios.get('/api/models/dataset/export');
        if (cancelled) return;
        const next = response.data || { status: 'idle' };
        setExportJob(next);
        if (next.status === 'running') {
          timer = setTimeout(poll, 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setExportError(err.response?.data?.error || 'Export-Status nicht verfügbar');
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, exportJob.status]);

  const startExport = async () => {
    setExportStarting(true);
    setExportError('');
    try {
      const response = await axios.post('/api/models/dataset/export', { valRatio });
      setExportJob(response.data);
    } catch (err) {
      setExportError(err.response?.data?.error || 'Export konnte nicht gestartet werden');
    } finally {
      setExportStarting(false);
    }
  };

  const stopExport = async () => {
    setExportError('');
    try {
      const response = await axios.post('/api/models/dataset/export/stop');
      setExportJob(response.data);
    } catch (err) {
      setExportError(err.response?.data?.error || 'Export konnte nicht gestoppt werden');
    }
  };

  const downloadExport = async () => {
    setExportError('');
    try {
      const response = await axios.get('/api/models/dataset/export/download', {
        responseType: 'blob'
      });
      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportJob.downloadName || 'yolo-dataset.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.response?.data?.error || 'Download fehlgeschlagen');
    }
  };

  const exportRunning = exportJob.status === 'running';
  const exportProgressValue = exportJob.processed || 0;
  const exportProgressMax = Math.max(1, exportJob.total || 0);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Modell erstellen
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Neues Modell aus den Erkennungen bauen, auf den ESP-P4 bringen und dort messen.
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(event, value) => setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {TABS.map((item) => (
            <Tab key={item.id} value={item.id} label={item.label} />
          ))}
        </Tabs>
      </Box>

      {tab === 'data' ? (
        <Box>
          {(statsError || actionError) && (
            <Alert severity="error" sx={{ mb: 2 }}>{statsError || actionError}</Alert>
          )}

          <Grid container spacing={2} sx={{ mb: 3 }}>
            {STATS.map((item) => (
              <Grid item xs={12} sm={4} key={item.key}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  {statsLoading ? (
                    <CircularProgress size={28} />
                  ) : (
                    <Typography variant="h3">
                      {numberFormat.format(stats?.[item.key] || 0)}
                    </Typography>
                  )}
                  <Typography color="text.secondary">{item.label}</Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              1. Alle Bilder durch ein Nebenmodell
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Läuft getrennt vom Produktivmodell. Es werden keine neuen Vögel angelegt — nur der Lauf wird gespeichert und an bestehende Vögel gematcht.
            </Typography>

            {availableModels.length === 0 ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Kein Nebenmodell mit ONNX-Datei verfügbar. Lege z. B. `yolo26l.onnx` unter `models/` ab oder trage ein Replay-Modell im Katalog ein.
              </Alert>
            ) : (
              <FormControl fullWidth size="small" sx={{ mb: 2, maxWidth: 420 }} disabled={jobRunning}>
                <InputLabel id="replay-model-label">Modell</InputLabel>
                <Select
                  labelId="replay-model-label"
                  label="Modell"
                  value={selectedModelId || availableModels[0]?.id || ''}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {availableModels.map((model) => (
                    <MenuItem key={model.id} value={model.id}>
                      {model.name}
                      {model.file ? ` (${model.file})` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <Box sx={{ mb: 2 }}>
              <ShootProgressBar value={progressValue} max={progressMax} />
              {timing && (jobRunning || job.status === 'done' || job.status === 'stopped') && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                  Dauer: {formatDuration(timing.elapsedMs)}
                  {jobRunning && timing.etaMs != null && (
                    <> · ETA: {formatDuration(timing.etaMs)}</>
                  )}
                  {jobRunning && timing.etaMs == null && (job.processed || 0) === 0 && (
                    <> · ETA: wird berechnet…</>
                  )}
                </Typography>
              )}
            </Box>

            {job.status !== 'idle' && (
              <Alert
                severity={job.status === 'failed' ? 'error' : jobRunning ? 'info' : 'success'}
                sx={{ mb: 2 }}
                action={jobRunning ? (
                  <Button color="inherit" size="small" onClick={stopReplay}>Stopp</Button>
                ) : null}
              >
                {job.modelName || modelLabel}: {job.message || job.status}
                {` — gespeichert ${job.updated || 0}, übersprungen ${job.skipped || 0}, Fehler ${job.errors || 0}`}
              </Alert>
            )}

            <Button
              variant="contained"
              onClick={startReplay}
              disabled={starting || jobRunning || !selectedModel?.id || overallPending === 0}
            >
              {jobRunning ? 'Läuft…' : `${modelLabel} starten`}
            </Button>
          </Paper>

          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              2. Mensch ↔ {modelLabel} abgleichen
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Tinder mit Fall-Filter (Default A&B). C optional dazuwählen.
            </Typography>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={4}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4">{numberFormat.format(lReplay.confirmedMainMatched || 0)}</Typography>
                  <Typography variant="body2" color="text.secondary">{modelLabel} trifft Main</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4">{numberFormat.format(lReplay.confirmedMainMissed || 0)}</Typography>
                  <Typography variant="body2" color="text.secondary">bestätigte Vögel ohne L-Match</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4">{numberFormat.format(lReplay.confirmedMainPendingL || 0)}</Typography>
                  <Typography variant="body2" color="text.secondary">noch ohne {modelLabel}-Lauf</Typography>
                </Paper>
              </Grid>
            </Grid>

            {selectedModel?.id ? (
              <LReviewTinder
                modelId={selectedModel.id}
                modelName={selectedModel.name || modelLabel}
                variant="main"
                defaultCases={['A', 'B']}
                enabled={tab === 'data'}
                liveRefresh={jobRunning}
                onDecided={() => loadStats(selectedModelId || undefined, { quiet: true })}
              />
            ) : (
              <Alert severity="info">
                Wähle oben ein Nebenmodell, dann erscheinen die Abgleich-Fälle.
              </Alert>
            )}
          </Paper>

          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              3. Übrige Vögel (schon da)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Side-Vögel aus dem Live-Lauf. Fall A: Nebenmodell trifft · Fall B: Nebenmodell verfehlt.
              Tinder-Default A&B.
            </Typography>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={4}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4">{numberFormat.format(stats?.sideBirds || 0)}</Typography>
                  <Typography variant="body2" color="text.secondary">Side gesamt</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4">{numberFormat.format(lReplay.sideMatched || 0)}</Typography>
                  <Typography variant="body2" color="text.secondary">Fall A · trifft Side</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4">{numberFormat.format(lReplay.sideUnmatched || 0)}</Typography>
                  <Typography variant="body2" color="text.secondary">Fall B · verfehlt Side</Typography>
                </Paper>
              </Grid>
            </Grid>

            {selectedModel?.id ? (
              <LReviewTinder
                modelId={selectedModel.id}
                modelName={selectedModel.name || modelLabel}
                variant="side"
                defaultCases={['A', 'B']}
                enabled={tab === 'data'}
                liveRefresh={jobRunning}
                onDecided={() => loadStats(selectedModelId || undefined, { quiet: true })}
              />
            ) : (
              <Alert severity="info">
                Wähle oben ein Nebenmodell, dann erscheinen die Side-Fälle.
              </Alert>
            )}
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              4. Neue Vögel vom Nebenmodell
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Boxen ohne Live-Match — neu ist neu. Rechts = als Side-Vogel übernehmen · Links = verwerfen.
            </Typography>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={4}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4">{numberFormat.format(lReplay.newLBoxes || 0)}</Typography>
                  <Typography variant="body2" color="text.secondary">Neue Boxen offen</Typography>
                </Paper>
              </Grid>
            </Grid>

            {selectedModel?.id ? (
              <LReviewTinder
                modelId={selectedModel.id}
                modelName={selectedModel.name || modelLabel}
                variant="new"
                defaultCases={['Neu']}
                enabled={tab === 'data'}
                liveRefresh={jobRunning}
                onDecided={() => loadStats(selectedModelId || undefined, { quiet: true })}
              />
            ) : (
              <Alert severity="info">
                Wähle oben ein Nebenmodell, dann erscheinen die neuen Boxen.
              </Alert>
            )}
          </Paper>
        </Box>
      ) : tab === 'training' ? (
        <Box>
          {(exportPreviewError || exportError) && (
            <Alert severity="error" sx={{ mb: 2 }}>{exportPreviewError || exportError}</Alert>
          )}

          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              YOLO-Dataset exportieren
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Bestätigte Vögel als Positiv-Boxen, reine Negativ-Bilder als leere Labels.
              Train/Val zeitlich (neueste → Val). Kein Dedup.
            </Typography>

            <FormControl size="small" sx={{ mb: 2, minWidth: 200 }} disabled={exportRunning}>
              <InputLabel id="val-ratio-label">Val-Anteil</InputLabel>
              <Select
                labelId="val-ratio-label"
                label="Val-Anteil"
                value={valRatio}
                onChange={(event) => setValRatio(Number(event.target.value))}
              >
                <MenuItem value={0.1}>10 %</MenuItem>
                <MenuItem value={0.2}>20 %</MenuItem>
                <MenuItem value={0.3}>30 %</MenuItem>
              </Select>
            </FormControl>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              {[
                { label: 'Bilder gesamt', value: exportPreview?.images },
                { label: 'Positiv-Bilder', value: exportPreview?.positiveImages },
                { label: 'Positiv-Boxen', value: exportPreview?.positiveBoxes },
                { label: 'Negativ-Bilder', value: exportPreview?.negativeImages }
              ].map((item) => (
                <Grid item xs={6} sm={3} key={item.label}>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    {exportPreviewLoading ? (
                      <CircularProgress size={28} />
                    ) : (
                      <Typography variant="h4">
                        {numberFormat.format(item.value || 0)}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">{item.label}</Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Train</Typography>
                  {exportPreviewLoading ? (
                    <CircularProgress size={22} />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {numberFormat.format(exportPreview?.train?.images || 0)} Bilder ·{' '}
                      {numberFormat.format(exportPreview?.train?.boxes || 0)} Boxen ·{' '}
                      {numberFormat.format(exportPreview?.train?.negativeImages || 0)} Negativ
                    </Typography>
                  )}
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Val (zeitlich neueste)</Typography>
                  {exportPreviewLoading ? (
                    <CircularProgress size={22} />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {numberFormat.format(exportPreview?.val?.images || 0)} Bilder ·{' '}
                      {numberFormat.format(exportPreview?.val?.boxes || 0)} Boxen ·{' '}
                      {numberFormat.format(exportPreview?.val?.negativeImages || 0)} Negativ
                    </Typography>
                  )}
                </Paper>
              </Grid>
            </Grid>

            {(exportRunning || exportJob.status === 'done' || exportJob.status === 'stopped' || exportJob.status === 'failed') && (
              <Box sx={{ mb: 2 }}>
                <ShootProgressBar value={exportProgressValue} max={exportProgressMax} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                  {exportJob.message || exportJob.status}
                  {` — geschrieben ${exportJob.written || 0}, übersprungen ${exportJob.skipped || 0}, Fehler ${exportJob.errors || 0}`}
                </Typography>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                onClick={startExport}
                disabled={exportStarting || exportRunning || exportPreviewLoading || !(exportPreview?.images > 0)}
              >
                {exportRunning ? 'Export läuft…' : 'YOLO-ZIP erzeugen'}
              </Button>
              {exportRunning && (
                <Button variant="outlined" color="inherit" onClick={stopExport}>
                  Stopp
                </Button>
              )}
              {exportJob.ready && (
                <Button variant="outlined" onClick={downloadExport}>
                  ZIP herunterladen
                </Button>
              )}
              <Button
                variant="text"
                onClick={() => loadExportPreview(valRatio)}
                disabled={exportPreviewLoading || exportRunning}
              >
                Vorschau neu laden
              </Button>
            </Box>
          </Paper>
        </Box>
      ) : (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {current.title}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {current.text}
          </Typography>
        </Paper>
      )}
    </Container>
  );
};

export default ModelCreate;
