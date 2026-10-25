import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import ShootProgressBar from './ShootProgressBar';
import LReviewTinder from './LReviewTinder';
import SizeFilterReview from './SizeFilterReview';

const LIVE_VAL = '__live__';

const HOST_METRIC_CARDS = [
  {
    key: 'map50',
    label: 'mAP50',
    hint: 'Mittlere Erkennungsqualität bei IoU ≥ 0,5. „Treffer“, wenn die Box grob stimmt. 0–1, höher = besser.'
  },
  {
    key: 'map50_95',
    label: 'mAP50–95',
    hint: 'Strenger: Mittel über IoU 0,5…0,95. Misst, wie präzise die Box sitzt — nicht nur ob der Vogel gefunden wurde.'
  },
  {
    key: 'precision',
    label: 'Precision',
    hint: 'Anteil korrekter Meldungen. Hoch = wenige Fehlalarme (kein Vogel, aber Modell meldet einen).'
  },
  {
    key: 'recall',
    label: 'Recall',
    hint: 'Anteil gefundener echter Vögel. Hoch = wenige Verpasste. Oft Trade-off zu Precision.'
  }
];

function formatMetric(value, digits = 3) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

function HostMetricCard({ label, value, hint }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        height: '100%',
        bgcolor: 'action.hover',
        borderColor: 'divider'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Tooltip title={hint} arrow placement="top">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
          >
            {label}
          </Typography>
        </Tooltip>
        <Typography variant="h5" component="div" sx={{ fontWeight: 600, lineHeight: 1.1 }}>
          {value}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, lineHeight: 1.35 }}>
        {hint}
      </Typography>
    </Paper>
  );
}

/** Fields from ESP GET /health (detect_*). */
function EspOnboardModelInfo({ health, loading, error, dense = false }) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: dense ? 0.5 : 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Modell vom ESP lesen…
        </Typography>
      </Box>
    );
  }
  if (error && !health) {
    return (
      <Typography variant="body2" color="error" sx={{ py: dense ? 0.5 : 1 }}>
        {error}
      </Typography>
    );
  }
  if (!health) return null;

  const model = health.detect_model || '—';
  const backend = health.detect_backend || '—';
  const imgsz = health.detect_imgsz != null && Number(health.detect_imgsz) > 0
    ? Number(health.detect_imgsz)
    : null;
  const ready = Boolean(health.detect_ready);
  const weights = health.detect_weights && health.detect_weights !== '-'
    ? health.detect_weights
    : null;
  const dataset = health.detect_dataset && health.detect_dataset !== '-'
    ? health.detect_dataset
    : null;

  return (
    <Box sx={{ py: dense ? 0.5 : 0 }}>
      <Typography variant={dense ? 'body2' : 'subtitle2'} sx={{ fontWeight: 600 }}>
        Auf dem ESP: <Box component="code" sx={{ fontWeight: 600 }}>{model}</Box>
        {!ready && (
          <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 1 }}>
            (nicht bereit)
          </Typography>
        )}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
        Backend {backend}
        {imgsz != null ? ` · ${imgsz}px` : ''}
        {weights ? ` · Weights ${weights}` : ''}
        {dataset ? ` · Dataset ${dataset}` : ''}
      </Typography>
    </Box>
  );
}

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
    text: 'Firmware-.bin mit eingebettetem Modell per OTA auf den ESP-P4.'
  },
  {
    id: 'benchmark',
    label: 'Benchmark',
    title: 'Benchmark',
    text: 'Host-mAP (ESPDet) und ESP-mAP/Latenz auf dem Val-Set.'
  }
];

const STATS = [
  { key: 'images', label: 'Bilder' },
  { key: 'birds', label: 'Vögel' },
  { key: 'confirmedBirds', label: 'Bestätigte Vögel' },
  { key: 'tooFarBirds', label: 'Zu weit' }
];

/** Colab: Script unter Meine Ablage/taubentraining, ZIPs in …/Trainingsdata */
const COLAB_DRIVE_MOUNT = '/content/drive';
const COLAB_SCRIPT_PATH = '/content/drive/MyDrive/taubentraining/colab_train.py';
const COLAB_START_SNIPPET = [
  'from google.colab import drive',
  `drive.mount("${COLAB_DRIVE_MOUNT}")`,
  '',
  `%run ${COLAB_SCRIPT_PATH} --imgsz 224 --no-shutdown`,
  `%run ${COLAB_SCRIPT_PATH} --imgsz 640`,
  '',
  '# 640 nutzt default batch=16; bei OOM: --batch 8 · optional schneller: --batch 32'
].join('\n');

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
  const [uploadToColab, setUploadToColab] = useState(false);
  const [colabUploading, setColabUploading] = useState(false);
  const [colabUrlCopied, setColabUrlCopied] = useState(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState(() => {
    try {
      return sessionStorage.getItem('ts_drive_folder_url') || '';
    } catch {
      return '';
    }
  });
  const [uploadToDrive, setUploadToDrive] = useState(false);
  const [driveUploading, setDriveUploading] = useState(false);
  const [drivePathCopied, setDrivePathCopied] = useState(false);
  const [colabSnippetCopied, setColabSnippetCopied] = useState(false);
  const [espTargets, setEspTargets] = useState([]);
  const [espTargetId, setEspTargetId] = useState('');
  const [espHealth, setEspHealth] = useState(null);
  const [espHealthLoading, setEspHealthLoading] = useState(false);
  const [espError, setEspError] = useState('');
  const [otaFile, setOtaFile] = useState(null);
  const [otaUploading, setOtaUploading] = useState(false);
  const [otaResult, setOtaResult] = useState(null);
  const [espExportJob, setEspExportJob] = useState({ status: 'idle' });
  const [espExportStarting, setEspExportStarting] = useState(false);
  const [espExportError, setEspExportError] = useState('');
  const [benchLimit, setBenchLimit] = useState(20);
  const [benchJob, setBenchJob] = useState({ status: 'idle' });
  const [benchError, setBenchError] = useState('');
  const [benchStarting, setBenchStarting] = useState(false);
  const [baselines, setBaselines] = useState([]);
  const [baselineId, setBaselineId] = useState('');
  const [datasets, setDatasets] = useState([]);
  const [datasetStem, setDatasetStem] = useState('');
  const [nasStatus, setNasStatus] = useState(null);
  const [benchHistory, setBenchHistory] = useState([]);
  const [viewedHostResult, setViewedHostResult] = useState(null);
  const [historyFile, setHistoryFile] = useState(null);
  const isLiveVal = datasetStem === LIVE_VAL || datasetStem === '';
  const current = TABS.find((item) => item.id === tab) || TABS[0];
  const selectedEspTarget = espTargets.find((t) => t.id === espTargetId) || espTargets[0] || null;
  const selectedBaseline = baselines.find((b) => b.id === baselineId) || null;
  const modelZipMatch = Boolean(
    selectedBaseline?.runName
    && !isLiveVal
    && datasetStem
    && selectedBaseline.runName === datasetStem
  );

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

  const espExportRunning = espExportJob.status === 'running';

  useEffect(() => {
    const benchIsRunning = benchJob.status === 'running';
    if (!jobRunning && !espExportRunning && !benchIsRunning) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobRunning, espExportRunning, benchJob.status]);

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

  const persistDriveFolderUrl = (value) => {
    setDriveFolderUrl(value);
    try {
      if (value) sessionStorage.setItem('ts_drive_folder_url', value);
      else sessionStorage.removeItem('ts_drive_folder_url');
    } catch {
      /* ignore */
    }
  };

  const startExport = async () => {
    setExportStarting(true);
    setExportError('');
    setColabUrlCopied(false);
    setDrivePathCopied(false);
    try {
      const driveReady = Boolean(
        exportJob.driveCredentialsReady
        && (exportJob.driveConfigured || driveFolderUrl.trim())
      );
      const response = await axios.post('/api/models/dataset/export', {
        valRatio,
        uploadToColab: Boolean(uploadToColab && exportJob.s3Configured),
        uploadToDrive: Boolean(
          (uploadToDrive || exportJob.driveAutoUpload) && driveReady
        ),
        driveFolderUrl: driveFolderUrl.trim() || undefined
      });
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

  const uploadExportForColab = async () => {
    setColabUploading(true);
    setExportError('');
    setColabUrlCopied(false);
    try {
      const response = await axios.post('/api/models/dataset/export/colab-upload');
      setExportJob(response.data);
    } catch (err) {
      if (err.response?.data?.status) {
        setExportJob(err.response.data);
      }
      setExportError(err.response?.data?.error || 'Colab-Upload fehlgeschlagen');
    } finally {
      setColabUploading(false);
    }
  };

  const uploadExportToDrive = async () => {
    setDriveUploading(true);
    setExportError('');
    setDrivePathCopied(false);
    try {
      const response = await axios.post('/api/models/dataset/export/drive-upload', {
        folderUrl: driveFolderUrl.trim() || undefined
      });
      setExportJob(response.data);
    } catch (err) {
      if (err.response?.data?.status) {
        setExportJob(err.response.data);
      }
      setExportError(err.response?.data?.error || 'Drive-Upload fehlgeschlagen');
    } finally {
      setDriveUploading(false);
    }
  };

  const copyColabDatasetUrl = async () => {
    if (!exportJob.colabDatasetUrl) return;
    try {
      await navigator.clipboard.writeText(exportJob.colabDatasetUrl);
      setColabUrlCopied(true);
      setTimeout(() => setColabUrlCopied(false), 2000);
    } catch {
      setExportError('URL konnte nicht kopiert werden');
    }
  };

  const copyColabStartSnippet = async () => {
    try {
      await navigator.clipboard.writeText(COLAB_START_SNIPPET);
      setColabSnippetCopied(true);
      setTimeout(() => setColabSnippetCopied(false), 2000);
    } catch {
      setExportError('Zwischenablage nicht verfügbar');
    }
  };

  const copyDriveColabPath = async () => {
    if (!exportJob.driveColabPath) return;
    try {
      await navigator.clipboard.writeText(exportJob.driveColabPath);
      setDrivePathCopied(true);
      setTimeout(() => setDrivePathCopied(false), 2000);
    } catch {
      setExportError('Pfad konnte nicht kopiert werden');
    }
  };

  const exportRunning = exportJob.status === 'running';
  const exportProgressValue = exportJob.processed || 0;
  const exportProgressMax = Math.max(1, exportJob.total || 0);
  const colabUploadBusy = colabUploading || exportJob.colabUploadStatus === 'uploading';
  const driveUploadBusy = driveUploading || exportJob.driveUploadStatus === 'uploading';
  const driveCanUpload = Boolean(
    exportJob.driveCredentialsReady
    && (exportJob.driveConfigured || driveFolderUrl.trim())
  );

  const loadEspTargets = useCallback(async () => {
    setEspError('');
    try {
      const response = await axios.get('/api/models/dataset/esp-targets');
      const targets = response.data?.targets || [];
      setEspTargets(targets);
      setEspTargetId((prev) => {
        if (prev && targets.some((t) => t.id === prev)) return prev;
        return targets[0]?.id || '';
      });
    } catch (err) {
      setEspError(err.response?.data?.error || 'ESP-P4-Ziele nicht verfügbar');
    }
  }, []);

  useEffect(() => {
    if (tab !== 'esp' && tab !== 'benchmark') return undefined;
    loadEspTargets();
    return undefined;
  }, [tab, loadEspTargets]);

  const checkEspHealth = useCallback(async () => {
    if (!selectedEspTarget) return;
    setEspHealthLoading(true);
    setEspError('');
    try {
      const response = await axios.get(
        `/api/models/dataset/esp-targets/${selectedEspTarget.deviceId}/health`,
        { params: { cameraId: selectedEspTarget.cameraId } }
      );
      setEspHealth(response.data);
    } catch (err) {
      setEspHealth(null);
      setEspError(err.response?.data?.error || 'Health-Check fehlgeschlagen');
    } finally {
      setEspHealthLoading(false);
    }
  }, [selectedEspTarget]);

  useEffect(() => {
    if (tab !== 'esp' && tab !== 'benchmark') return undefined;
    if (!selectedEspTarget) {
      setEspHealth(null);
      return undefined;
    }
    checkEspHealth();
    return undefined;
  }, [tab, selectedEspTarget, checkEspHealth]);

  const uploadOta = async () => {
    if (!selectedEspTarget || !otaFile) return;
    setOtaUploading(true);
    setEspError('');
    setOtaResult(null);
    try {
      const form = new FormData();
      form.append('firmware', otaFile);
      const response = await axios.post(
        `/api/models/dataset/esp-targets/${selectedEspTarget.deviceId}/ota`,
        form,
        {
          params: { cameraId: selectedEspTarget.cameraId },
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 320000
        }
      );
      setOtaResult(response.data);
    } catch (err) {
      setEspError(err.response?.data?.error || 'OTA fehlgeschlagen');
    } finally {
      setOtaUploading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'benchmark') return undefined;
    let timer;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await axios.get('/api/models/dataset/benchmark');
        if (cancelled) return;
        const next = response.data || { status: 'idle' };
        setBenchJob(next);
        if (next.status === 'running') timer = setTimeout(poll, 1500);
      } catch (err) {
        if (!cancelled) {
          setBenchError(err.response?.data?.error || 'Benchmark-Status nicht verfügbar');
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, benchJob.status]);

  const startEspBench = async () => {
    if (!selectedEspTarget) return;
    setBenchStarting(true);
    setBenchError('');
    try {
      const response = await axios.post('/api/models/dataset/benchmark/esp', {
        deviceId: selectedEspTarget.deviceId,
        cameraId: selectedEspTarget.cameraId,
        valRatio,
        limit: benchLimit,
        datasetStem: isLiveVal ? undefined : datasetStem,
        valSource: isLiveVal ? 'live' : 'frozen'
      });
      setBenchJob(response.data);
    } catch (err) {
      setBenchError(err.response?.data?.error || 'ESP-Benchmark fehlgeschlagen');
    } finally {
      setBenchStarting(false);
    }
  };

  const loadBaselines = useCallback(async () => {
    try {
      const response = await axios.get('/api/models/dataset/benchmark/baselines');
      const list = Array.isArray(response.data?.baselines) ? response.data.baselines : [];
      const zips = Array.isArray(response.data?.datasets) ? response.data.datasets : [];
      setBaselines(list);
      setDatasets(zips);
      setNasStatus(response.data?.nas || null);
      setBaselineId((prev) => {
        if (prev && list.some((b) => b.id === prev && b.present)) return prev;
        const first = list.find((b) => b.present);
        return first?.id || '';
      });
      setDatasetStem((prev) => {
        if (prev === LIVE_VAL) return prev;
        if (prev && zips.some((z) => z.stem === prev)) return prev;
        return zips[0]?.stem || LIVE_VAL;
      });
    } catch {
      setBaselines([]);
      setDatasets([]);
      setNasStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!datasetStem || datasetStem === LIVE_VAL) return;
    const match = baselines.find((b) => b.present && b.runName === datasetStem);
    if (match) {
      setBaselineId(match.id);
      return;
    }
    setBaselineId((prev) => {
      if (prev && baselines.some((b) => b.id === prev && b.present)) return prev;
      const first = baselines.find((b) => b.present);
      return first?.id || '';
    });
  }, [datasetStem, baselines]);

  useEffect(() => {
    if (tab !== 'benchmark' && tab !== 'esp') return undefined;
    loadBaselines();
    return undefined;
  }, [tab, loadBaselines]);

  const startEspExport = async () => {
    setEspExportStarting(true);
    setEspExportError('');
    try {
      const response = await axios.post('/api/models/dataset/esp-export', {
        baselineId,
        datasetStem: isLiveVal ? undefined : datasetStem,
        target: 'esp32p4'
      });
      setEspExportJob(response.data);
    } catch (err) {
      setEspExportError(err.response?.data?.error || 'ESP-Export fehlgeschlagen');
    } finally {
      setEspExportStarting(false);
    }
  };

  const stopEspExport = async () => {
    setEspExportError('');
    try {
      const response = await axios.post('/api/models/dataset/esp-export/stop');
      setEspExportJob(response.data);
    } catch (err) {
      setEspExportError(err.response?.data?.error || 'Stopp fehlgeschlagen');
    }
  };

  const clearEspExport = async () => {
    setEspExportError('');
    try {
      const response = await axios.delete('/api/models/dataset/esp-export');
      setEspExportJob(response.data || { status: 'idle' });
    } catch (err) {
      setEspExportError(err.response?.data?.error || 'Löschen fehlgeschlagen');
    }
  };

  useEffect(() => {
    if (tab !== 'esp') return undefined;
    let cancelled = false;
    let failStreak = 0;
    const poll = async () => {
      try {
        const response = await axios.get('/api/models/dataset/esp-export');
        if (cancelled) return;
        failStreak = 0;
        const next = response.data || { status: 'idle' };
        setEspExportJob((prev) => {
          // Server restarted mid-job → RAM idle, but UI still had "running".
          if (prev?.status === 'running' && next.status === 'idle') {
            return {
              ...prev,
              status: 'stopped',
              message: 'Abgebrochen (Server-Neustart)',
              detail: 'Export-Status am Server ist weg — bitte erneut starten.',
              finishedAt: new Date().toISOString()
            };
          }
          return next;
        });
      } catch {
        failStreak += 1;
        if (!cancelled && failStreak >= 3) {
          setEspExportJob((prev) => {
            if (prev?.status !== 'running') return prev;
            return {
              ...prev,
              status: 'stopped',
              message: 'Abgebrochen (Server nicht erreichbar)',
              detail: 'Polling fehlgeschlagen — Export vermutlich durch Neustart beendet.',
              finishedAt: new Date().toISOString()
            };
          });
        }
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tab]);

  const loadBenchHistory = useCallback(async (runName) => {
    if (!runName) {
      setBenchHistory([]);
      setViewedHostResult(null);
      setHistoryFile(null);
      return;
    }
    try {
      const response = await axios.get('/api/models/dataset/benchmark/history', {
        params: { runName, limit: 8 }
      });
      setBenchHistory(Array.isArray(response.data?.history) ? response.data.history : []);
    } catch {
      setBenchHistory([]);
    }
  }, []);

  const openHostHistory = async (row) => {
    const runName = selectedBaseline?.runName;
    if (!runName || !row?.file) return;
    setBenchError('');
    try {
      const response = await axios.get('/api/models/dataset/benchmark/history', {
        params: { runName, file: row.file }
      });
      const detail = response.data?.result;
      if (!detail) {
        setBenchError('Benchmark-Datei leer');
        return;
      }
      setViewedHostResult(detail);
      setHistoryFile(row.file);
    } catch (err) {
      setBenchError(err.response?.data?.error || 'Benchmark konnte nicht geladen werden');
    }
  };

  useEffect(() => {
    if (tab !== 'benchmark') return undefined;
    setViewedHostResult(null);
    setHistoryFile(null);
    loadBenchHistory(selectedBaseline?.runName || null);
    return undefined;
  }, [tab, selectedBaseline?.runName, loadBenchHistory]);

  useEffect(() => {
    if (tab !== 'benchmark') return undefined;
    if (benchJob.status === 'done' && benchJob.mode === 'host') {
      setViewedHostResult(null);
      setHistoryFile(null);
      loadBenchHistory(selectedBaseline?.runName || null);
    }
    return undefined;
  }, [tab, benchJob.status, benchJob.mode, selectedBaseline?.runName, loadBenchHistory]);

  const startHostBench = async () => {
    setBenchStarting(true);
    setBenchError('');
    setViewedHostResult(null);
    setHistoryFile(null);
    try {
      const response = await axios.post('/api/models/dataset/benchmark/host', {
        valRatio,
        limit: Math.max(benchLimit, 50),
        baselineId,
        datasetStem: isLiveVal ? undefined : datasetStem,
        valSource: isLiveVal ? 'live' : 'frozen'
      });
      setBenchJob(response.data);
    } catch (err) {
      setBenchError(err.response?.data?.error || 'Host-Benchmark fehlgeschlagen');
    } finally {
      setBenchStarting(false);
    }
  };

  const stopBench = async () => {
    setBenchError('');
    try {
      const response = await axios.post('/api/models/dataset/benchmark/stop');
      setBenchJob(response.data);
    } catch (err) {
      setBenchError(err.response?.data?.error || 'Stopp fehlgeschlagen');
    }
  };

  const benchRunning = benchJob.status === 'running';
  const benchResult = viewedHostResult || benchJob.result;

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
              <Grid item xs={6} sm={3} key={item.key}>
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

          <Paper sx={{ p: 3, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              5. Zu weit / zu klein
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Bestätigte Vögel mit sehr kleiner Box (kurze Seite relativ zur Bildseite).
              Die Box bleibt erhalten, der Status wird <code>too_far</code> — sie fällt aus dem Training-Export.
              {' '}Links = Zu weit · Rechts = Behalten.
            </Typography>
            <SizeFilterReview
              enabled={tab === 'data'}
              tooFarBirds={stats?.tooFarBirds || 0}
              onDecided={() => loadStats(selectedModelId || undefined, { quiet: true })}
            />
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

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Google Drive (empfohlen für Colab)
              </Typography>
              <TextField
                size="small"
                fullWidth
                label="Drive-Ordner-Link"
                placeholder="https://drive.google.com/drive/folders/…"
                value={driveFolderUrl}
                onChange={(event) => persistDriveFolderUrl(event.target.value)}
                disabled={exportRunning || driveUploadBusy}
                sx={{ mb: 1, maxWidth: 640 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Optional: Ordner mit der Service-Account-Mail teilen (Bearbeiter), dann Upload aus der App.
                {exportJob.driveClientEmail ? (
                  <>
                    {' '}Mail:&nbsp;<code>{exportJob.driveClientEmail}</code>
                  </>
                ) : (
                  <>
                    {' '}Oder ZIP manuell nach{' '}
                    <code>Meine Ablage/taubentraining/Trainingsdata/</code> legen.
                  </>
                )}
              </Typography>
              {exportJob.driveCredentialsReady && (
                <FormControlLabel
                  sx={{ display: 'block' }}
                  control={(
                    <Checkbox
                      checked={uploadToDrive || Boolean(exportJob.driveAutoUpload)}
                      onChange={(event) => setUploadToDrive(event.target.checked)}
                      disabled={
                        exportRunning
                        || Boolean(exportJob.driveAutoUpload)
                        || !driveCanUpload
                      }
                    />
                  )}
                  label={
                    exportJob.driveAutoUpload
                      ? 'Nach Export automatisch zu Google Drive (GOOGLE_DRIVE_AUTO_UPLOAD)'
                      : 'Nach Export zu Google Drive hochladen'
                  }
                />
              )}
            </Box>

            {exportJob.s3Configured && (
              <FormControlLabel
                sx={{ mb: 1, display: 'block' }}
                control={(
                  <Checkbox
                    checked={uploadToColab || Boolean(exportJob.colabAutoUpload)}
                    onChange={(event) => setUploadToColab(event.target.checked)}
                    disabled={exportRunning || Boolean(exportJob.colabAutoUpload)}
                  />
                )}
                label={
                  exportJob.colabAutoUpload
                    ? 'Nach Export automatisch zu S3 für Colab (DATASET_S3_AUTO_UPLOAD)'
                    : 'Optional: Nach Export zu S3 für Colab hochladen'
                }
              />
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
              {exportJob.ready && exportJob.driveCredentialsReady && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={uploadExportToDrive}
                  disabled={driveUploadBusy || !driveCanUpload}
                >
                  {driveUploadBusy ? 'Drive-Upload…' : 'Zu Google Drive hochladen'}
                </Button>
              )}
              {exportJob.ready && exportJob.s3Configured && !exportJob.colabDatasetUrl && (
                <Button
                  variant="outlined"
                  onClick={uploadExportForColab}
                  disabled={colabUploadBusy}
                >
                  {colabUploadBusy ? 'S3-Upload…' : 'Zu Colab hochladen (S3)'}
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

            {exportJob.driveUploadError && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Drive-Upload: {exportJob.driveUploadError}
              </Alert>
            )}

            {exportJob.driveWebViewLink && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Datei in Google Drive
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <a href={exportJob.driveWebViewLink} target="_blank" rel="noreferrer">
                    {exportJob.driveWebViewLink}
                  </a>
                </Typography>
                {exportJob.driveColabPath && (
                  <>
                    <Typography variant="subtitle2" gutterBottom>
                      Colab <code>DRIVE_ZIP_PATH</code>
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <TextField
                        size="small"
                        fullWidth
                        value={exportJob.driveColabPath}
                        InputProps={{ readOnly: true }}
                        sx={{ flex: '1 1 280px', maxWidth: 640 }}
                      />
                      <Button variant="contained" onClick={copyDriveColabPath}>
                        {drivePathCopied ? 'Kopiert' : 'Pfad kopieren'}
                      </Button>
                    </Box>
                  </>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Colab startet mit dem Snippet unten (Script nimmt die neueste ZIP im Trainingsdata-Ordner).
                </Typography>
              </Box>
            )}

            <Paper variant="outlined" sx={{ p: 2, mt: 3, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle1" gutterBottom>
                Colab (T4) starten
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                1. Runtime → Change runtime type → <strong>T4 GPU</strong>
                <br />
                2. Script einmal nach Drive legen:{' '}
                <code>Meine Ablage/taubentraining/colab_train.py</code>
                {' '}(aus dem Repo: <code>notebooks/colab_train.py</code>)
                <br />
                3. YOLO-ZIP nach{' '}
                <code>Meine Ablage/taubentraining/Trainingsdata/</code>
                {' '}(manuell oder App-Upload)
                <br />
                4. In Colab eine neue Zelle öffnen, dieses Kommando einfügen und ausführen
                (Google-Login beim Mount; „Meine Ablage“ ={' '}
                <code>/content/drive/MyDrive/…</code>):
              </Typography>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Kommando
              </Typography>
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={6}
                value={COLAB_START_SNIPPET}
                InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } }}
                sx={{ mb: 1, maxWidth: 720 }}
              />
              <Button variant="contained" size="small" onClick={copyColabStartSnippet}>
                {colabSnippetCopied ? 'Kopiert' : 'Kommando kopieren'}
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Trainiert nur <strong>ESPDet Pico</strong> (kein YOLO26). Auflösung per{' '}
                <code>--imgsz</code> (224 Baseline, dann 640). Batch passt sich an.
                Nach dem Lauf trennt das Script die Runtime automatisch (
                <code>runtime.unassign()</code>
                ) — T4-Quota. Mit <code>--no-shutdown</code> offen lassen.
                Weights unter{' '}
                <code>Meine Ablage/taubentraining/result/&lt;zip-name&gt;/</code>
                {' '}z. B.{' '}
                <code>…/result/yolo-dataset-…/espdet_bird_224_best.pt</code>
              </Typography>
            </Paper>

            {exportJob.colabUploadError && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                S3-Upload: {exportJob.colabUploadError}
              </Alert>
            )}

            {exportJob.colabDatasetUrl && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Dataset-URL für Colab (S3)
                  {exportJob.colabUrlType === 'presigned' && exportJob.colabUrlExpiresIn
                    ? ` (presigned, ~${Math.round(exportJob.colabUrlExpiresIn / 3600)}h)`
                    : ''}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={exportJob.colabDatasetUrl}
                    InputProps={{ readOnly: true }}
                    sx={{ flex: '1 1 280px', maxWidth: 640 }}
                  />
                  <Button variant="contained" onClick={copyColabDatasetUrl}>
                    {colabUrlCopied ? 'Kopiert' : 'URL kopieren'}
                  </Button>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Alternativ zu Drive: In Colab <code>DATASET_URL</code> setzen.
                </Typography>
              </Box>
            )}

            {!exportJob.driveCredentialsReady && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Empfohlen: Service-Account-JSON als <code>GOOGLE_DRIVE_CREDENTIALS_JSON</code> und
                Ordner-ID als <code>GOOGLE_DRIVE_FOLDER_ID</code> in <code>server/.env</code> setzen
                — dann kannst du die YOLO-ZIP direkt nach Drive für Colab hochladen.
              </Typography>
            )}
          </Paper>
        </Box>
      ) : tab === 'esp' ? (
        <Box>
          {(espError || espExportError) && (
            <Alert severity="error" sx={{ mb: 2 }}>{espError || espExportError}</Alert>
          )}
          {espExportJob?.result?.ok && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Export ok
              {espExportJob.result.espdlRelative
                ? `: ${espExportJob.result.espdlRelative}`
                : ''}
              {espExportJob.result.bytes
                ? ` (${numberFormat.format(espExportJob.result.bytes)} Bytes)`
                : ''}
              {espExportJob.result.manifestRelative
                ? ` · Manifest: ${espExportJob.result.manifestRelative}`
                : ' · detect_manifest.json'}
              {' '}→ beide nach <code>phase1-camera/main/models/p4/</code>, dann Build/OTA.
            </Alert>
          )}
          {otaResult?.ok && (
            <Alert severity="success" sx={{ mb: 2 }}>
              OTA ok ({numberFormat.format(otaResult.bytes || 0)} Bytes) — Gerät startet neu.
            </Alert>
          )}

          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              ESP-Export (.pt → .espdl)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Quantisiert das gewählte ESPDet-<code>.pt</code> zu INT8-<code>.espdl</code>
              (Kalibrierung aus Frozen Val) und schreibt daneben{' '}
              <code>detect_manifest.json</code> (backend/imgsz/score/nms) — wie die P4-Firmware
              unter <code>main/models/p4/</code> erwartet. Build/OTA bleibt separat.
            </Typography>

            {nasStatus && !nasStatus.mounted && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Weder NAS noch Lokal-Training-Root verfügbar
                {nasStatus.nasRoot || nasStatus.localRoot
                  ? ` (NAS: ${nasStatus.nasRoot || '—'} · Lokal: ${nasStatus.localRoot || '—'})`
                  : ''}. Export braucht Weights + ZIP unter Trainingsdata/result.
              </Alert>
            )}

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel id="esp-export-dataset-label">Trainingsdata (Kalibrierung)</InputLabel>
                  <Select
                    labelId="esp-export-dataset-label"
                    label="Trainingsdata (Kalibrierung)"
                    value={isLiveVal ? '' : datasetStem}
                    onChange={(event) => setDatasetStem(event.target.value)}
                    disabled={espExportJob.status === 'running'}
                  >
                    {datasets.map((z) => (
                      <MenuItem key={z.stem} value={z.stem}>
                        {z.file || z.stem}
                        {selectedBaseline?.runName === z.stem ? ' · match' : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel id="esp-export-model-label">Modell (.pt)</InputLabel>
                  <Select
                    labelId="esp-export-model-label"
                    label="Modell (.pt)"
                    value={baselineId}
                    onChange={(event) => setBaselineId(event.target.value)}
                    disabled={espExportJob.status === 'running'}
                  >
                    {baselines.filter((b) => b.present).map((b) => (
                      <MenuItem key={b.id} value={b.id}>
                        {b.label || b.runName || b.id}
                        {b.imgsz ? ` · ${b.imgsz}` : ''}
                        {datasetStem && b.runName === datasetStem ? ' · match' : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {selectedBaseline?.present && !isLiveVal && datasetStem && (
              <Typography
                variant="caption"
                color={modelZipMatch || !selectedBaseline.runName ? 'success.main' : 'warning.main'}
                display="block"
                sx={{ mb: 1.5 }}
              >
                {modelZipMatch || !selectedBaseline.runName
                  ? `Namen passen · Kalibrierung aus Frozen Val (${datasetStem})`
                  : `Namen weichen ab — Modell: ${selectedBaseline.runName}, ZIP: ${datasetStem}. Für Quantisierung besser denselben Run wählen.`}
                {selectedBaseline.imgsz ? ` · imgsz=${selectedBaseline.imgsz}` : ''}
              </Typography>
            )}

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
              <Button
                variant="contained"
                onClick={startEspExport}
                disabled={
                  espExportStarting
                  || espExportJob.status === 'running'
                  || !baselineId
                  || isLiveVal
                  || !datasetStem
                }
              >
                {espExportJob.status === 'running' ? 'Export läuft…' : 'ESP-Export starten'}
              </Button>
              {espExportJob.status === 'running' && (
                <Button size="small" onClick={stopEspExport}>Stopp</Button>
              )}
              {(espExportJob.status === 'done'
                || espExportJob.status === 'failed'
                || espExportJob.status === 'stopped') && (
                <Button size="small" onClick={clearEspExport}>Ausblenden</Button>
              )}
            </Box>
            {isLiveVal && (
              <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 1 }}>
                Bitte eine Trainingsdata-ZIP wählen (nicht Live-DB) — Kalibrierung braucht Frozen Val.
              </Typography>
            )}

            {(espExportJob.status === 'running'
              || espExportJob.status === 'done'
              || espExportJob.status === 'failed'
              || espExportJob.status === 'stopped') && (
              <Box sx={{ mt: 1 }}>
                <ShootProgressBar
                  value={espExportJob.processed || 0}
                  max={Math.max(1, espExportJob.total || 100)}
                />
                {(() => {
                  const t = jobTiming(espExportJob, nowMs);
                  const pct = Math.round(
                    ((espExportJob.processed || 0) / Math.max(1, espExportJob.total || 100)) * 100
                  );
                  return (
                    <Box sx={{ mt: 1, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        {espExportJob.phaseLabel || espExportJob.phase || 'Export'}
                        {Number.isFinite(pct) ? ` · ${pct}%` : ''}
                        {espExportJob.imgsz ? ` · imgsz ${espExportJob.imgsz}` : ''}
                        {espExportJob.calibImages != null
                          ? ` · ${espExportJob.calibImages} Kalibrier-Bilder`
                          : ''}
                        {espExportJob.target ? ` · ${espExportJob.target}` : ''}
                      </Typography>
                      {espExportJob.detail && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mt: 0.5, px: 1, wordBreak: 'break-word' }}
                        >
                          {espExportJob.detail}
                        </Typography>
                      )}
                      {t && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          Dauer: {formatDuration(t.elapsedMs)}
                          {espExportJob.status === 'running' && t.etaMs != null && (
                            <> · ETA: ~{formatDuration(t.etaMs)}</>
                          )}
                          {espExportJob.status === 'running'
                            && t.etaMs == null
                            && (espExportJob.processed || 0) < 5 && (
                            <> · ETA wird berechnet…</>
                          )}
                          {espExportJob.status === 'done'
                            && espExportJob.result?.elapsedSec != null && (
                            <> · Gesamt {Math.round(espExportJob.result.elapsedSec)}s</>
                          )}
                        </Typography>
                      )}
                      {espExportJob.status === 'failed' && (
                        <Typography
                          variant="caption"
                          color="error.main"
                          display="block"
                          sx={{
                            mt: 0.5,
                            maxHeight: 100,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                          }}
                        >
                          {espExportJob.error || espExportJob.message}
                        </Typography>
                      )}
                    </Box>
                  );
                })()}
              </Box>
            )}
          </Paper>

          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              Firmware mit Modell aufspielen
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Das `.espdl` steckt in der App-Firmware. Hier lädst du die gebaute{' '}
              <strong>.bin</strong> per OTA (`POST /ota`) auf den ESP-P4.
            </Typography>

            {espTargets.length === 0 ? (
              <Alert severity="warning">
                Kein ESP-P4 mit IP konfiguriert. Unter Geräte eine Kamera vom Typ ESP-P4 anlegen.
              </Alert>
            ) : (
              <FormControl fullWidth size="small" sx={{ mb: 2, maxWidth: 480 }}>
                <InputLabel id="esp-target-label">ESP-P4</InputLabel>
                <Select
                  labelId="esp-target-label"
                  label="ESP-P4"
                  value={selectedEspTarget?.id || ''}
                  onChange={(event) => setEspTargetId(event.target.value)}
                >
                  {espTargets.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.deviceName} · {t.cameraName} ({t.baseUrl})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <Button
                variant="outlined"
                onClick={checkEspHealth}
                disabled={!selectedEspTarget || espHealthLoading}
              >
                {espHealthLoading ? 'Prüfe…' : 'Health prüfen'}
              </Button>
              <Button variant="text" onClick={loadEspTargets}>
                Ziele neu laden
              </Button>
            </Box>

            {(espHealthLoading || espHealth?.health || espError) && (
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Health / Modell</Typography>
                <EspOnboardModelInfo
                  health={espHealth?.health}
                  loading={espHealthLoading}
                  error={espError}
                />
                {espHealth?.health && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Kamera: {espHealth.health.camera || '—'} ·{' '}
                    Sensor: {espHealth.health.sensor || '—'} ·{' '}
                    OTA-Slot: {espHealth.health.ota_next || '—'} ·{' '}
                    Slot-Größe: {espHealth.health.ota_slot_size
                      ? `${Math.round(espHealth.health.ota_slot_size / (1024 * 1024))} MB`
                      : '—'}
                  </Typography>
                )}
              </Paper>
            )}

            <Typography variant="body2" sx={{ mb: 1 }}>
              Firmware-.bin (ESP-IDF Build)
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="outlined" component="label" disabled={otaUploading}>
                Datei wählen
                <input
                  hidden
                  type="file"
                  accept=".bin,application/octet-stream"
                  onChange={(event) => {
                    setOtaFile(event.target.files?.[0] || null);
                    setOtaResult(null);
                  }}
                />
              </Button>
              <Typography variant="body2" color="text.secondary">
                {otaFile ? otaFile.name : 'keine Datei'}
              </Typography>
              <Button
                variant="contained"
                onClick={uploadOta}
                disabled={!selectedEspTarget || !otaFile || otaUploading}
              >
                {otaUploading ? 'OTA läuft…' : 'OTA starten'}
              </Button>
            </Box>
          </Paper>
        </Box>
      ) : tab === 'benchmark' ? (
        <Box>
          {(benchError || espError) && (
            <Alert severity="error" sx={{ mb: 2 }}>{benchError || espError}</Alert>
          )}

          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              Benchmark
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Host = ESPDet mAP auf dem Val-Split (.pt). ESP = IoU-mAP/P/R + Latenz auf dem P4.
            </Typography>

            {nasStatus && (
              <Typography
                variant="caption"
                color={nasStatus.mounted ? 'success.main' : 'warning.main'}
                display="block"
                sx={{ mb: 1 }}
              >
                {nasStatus.source === 'nas'
                  ? 'NAS verbunden'
                  : nasStatus.source === 'local'
                    ? 'Lokal (NAS offline)'
                    : 'Training-Root fehlt'}
                {nasStatus.mounted
                  ? ` · ${nasStatus.results} Runs · ${nasStatus.datasets} ZIPs · ${nasStatus.root || ''}`
                  : ' — NAS mounten oder LOCAL_TRAINING_ROOT setzen'}
              </Typography>
            )}

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={isLiveVal ? 6 : 12}>
                <FormControl fullWidth size="small" disabled={benchRunning}>
                  <InputLabel id="bench-dataset-label">Trainingsdata</InputLabel>
                  <Select
                    labelId="bench-dataset-label"
                    label="Trainingsdata"
                    value={datasetStem || LIVE_VAL}
                    onChange={(event) => setDatasetStem(event.target.value)}
                    renderValue={(value) => {
                      if (value === LIVE_VAL || !value) return 'Live-DB Val';
                      const zip = datasets.find((z) => z.stem === value);
                      return zip?.file || value;
                    }}
                  >
                    <MenuItem value={LIVE_VAL}>Live-DB Val</MenuItem>
                    {datasets.map((z) => (
                      <MenuItem key={z.stem} value={z.stem}>
                        {z.file}
                        {z.bytes != null ? ` · ${Math.round(z.bytes / (1024 * 1024))} MB` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              {isLiveVal && (
                <>
                  <Grid item xs={12} sm={3}>
                    <FormControl fullWidth size="small" disabled={benchRunning}>
                      <InputLabel id="bench-val-label">Val-Anteil</InputLabel>
                      <Select
                        labelId="bench-val-label"
                        label="Val-Anteil"
                        value={valRatio}
                        onChange={(event) => setValRatio(Number(event.target.value))}
                      >
                        <MenuItem value={0.1}>10 %</MenuItem>
                        <MenuItem value={0.2}>20 %</MenuItem>
                        <MenuItem value={0.3}>30 %</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <FormControl fullWidth size="small" disabled={benchRunning}>
                      <InputLabel id="bench-limit-label">Max. Bilder</InputLabel>
                      <Select
                        labelId="bench-limit-label"
                        label="Max. Bilder"
                        value={benchLimit}
                        onChange={(event) => setBenchLimit(Number(event.target.value))}
                      >
                        <MenuItem value={10}>10</MenuItem>
                        <MenuItem value={20}>20</MenuItem>
                        <MenuItem value={50}>50</MenuItem>
                        <MenuItem value={100}>100</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </>
              )}
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                  <Typography variant="subtitle1" gutterBottom>1. Host</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Modell aus `result/` auf dem gewählten Trainingsdata-Val (Frozen ZIP oder Live-DB).
                  </Typography>
                  {baselines.length > 0 && (
                    <FormControl
                      fullWidth
                      size="small"
                      sx={{ mb: 1 }}
                      disabled={benchRunning}
                    >
                      <InputLabel id="bench-baseline-label">Modell (result/)</InputLabel>
                      <Select
                        labelId="bench-baseline-label"
                        label="Modell (result/)"
                        value={baselineId}
                        onChange={(event) => setBaselineId(event.target.value)}
                      >
                        {baselines.map((b) => (
                          <MenuItem key={b.id} value={b.id} disabled={!b.present}>
                            {b.label}
                            {b.location === 'nas' ? ' · NAS' : ''}
                            {datasetStem && b.runName === datasetStem ? ' · match' : ''}
                            {!b.present ? ' (fehlt)' : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  {selectedBaseline?.present && (
                    <Typography
                      variant="caption"
                      color={!isLiveVal && !modelZipMatch && selectedBaseline.runName ? 'warning.main' : 'text.secondary'}
                      display="block"
                      sx={{ mb: 1.5 }}
                    >
                      imgsz={selectedBaseline.imgsz}
                      {!isLiveVal
                        ? (modelZipMatch || !selectedBaseline.runName
                          ? ' · Namen passen / Frozen Val'
                          : ` · Namen weichen ab (Modell: ${selectedBaseline.runName})`)
                        : ' · Live-DB Val'}
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    onClick={startHostBench}
                    disabled={
                      benchStarting
                      || benchRunning
                      || !selectedBaseline?.present
                    }
                  >
                    Host-Val starten
                  </Button>
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                  <Typography variant="subtitle1" gutterBottom>2. ESP-P4</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Dieselben Val-Bilder (ZIP oder Live-DB) an `POST /detect` —
                    Latenz + GT vs. Pred (Bild-Ebene).
                  </Typography>
                  {espTargets.length > 0 ? (
                    <FormControl fullWidth size="small" sx={{ mb: 1.5 }} disabled={benchRunning}>
                      <InputLabel id="bench-esp-label">ESP-P4</InputLabel>
                      <Select
                        labelId="bench-esp-label"
                        label="ESP-P4"
                        value={selectedEspTarget?.id || ''}
                        onChange={(event) => setEspTargetId(event.target.value)}
                      >
                        {espTargets.map((t) => (
                          <MenuItem key={t.id} value={t.id}>
                            {t.deviceName} · {t.baseUrl}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 1.5 }}>
                      Kein ESP-P4-Ziel gefunden
                    </Typography>
                  )}
                  <Box sx={{ mb: 1.5 }}>
                    <EspOnboardModelInfo
                      health={espHealth?.health}
                      loading={espHealthLoading}
                      error={selectedEspTarget ? espError : null}
                      dense
                    />
                    {selectedEspTarget && (
                      <Button size="small" onClick={checkEspHealth} disabled={espHealthLoading} sx={{ mt: 0.5 }}>
                        Modell aktualisieren
                      </Button>
                    )}
                  </Box>
                  <Button
                    variant="contained"
                    onClick={startEspBench}
                    disabled={benchStarting || benchRunning || !selectedEspTarget}
                  >
                    ESP-Benchmark starten
                  </Button>
                </Paper>
              </Grid>
            </Grid>

            {(benchRunning || benchJob.status === 'done' || benchJob.status === 'failed' || benchJob.status === 'stopped') && (
              <Box sx={{ mt: 3 }}>
                <ShootProgressBar
                  value={benchJob.processed || 0}
                  max={Math.max(1, benchJob.total || 0)}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                  {benchJob.message || benchJob.status}
                  {benchJob.mode ? ` · ${benchJob.mode}` : ''}
                </Typography>
                {(() => {
                  const t = jobTiming(benchJob, nowMs);
                  if (!t) return null;
                  return (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, textAlign: 'center' }}>
                      Dauer: {formatDuration(t.elapsedMs)}
                      {benchRunning && t.etaMs != null && (
                        <> · ETA: ~{formatDuration(t.etaMs)}</>
                      )}
                      {benchRunning && t.etaMs == null && (benchJob.processed || 0) < 1 && (
                        <> · ETA wird berechnet…</>
                      )}
                    </Typography>
                  );
                })()}
                {benchRunning && (
                  <Box sx={{ textAlign: 'center', mt: 1 }}>
                    <Button size="small" onClick={stopBench}>Stopp</Button>
                  </Box>
                )}
              </Box>
            )}

            {benchResult && (
              <Paper variant="outlined" sx={{ p: 2.5, mt: 2 }}>
                <Typography variant="subtitle1" gutterBottom>
                  {benchResult.partial && benchRunning ? 'Zwischenergebnis' : 'Ergebnis'}
                  {benchResult.mode === 'host' ? ' · Host-Val' : benchResult.mode === 'esp' ? ' · ESP' : ''}
                  {benchResult.partial && benchRunning ? ' · live' : ''}
                  {benchResult.fromHistory ? ' · gespeichert' : ''}
                </Typography>
                {benchResult.mode === 'esp' ? (
                  <Box>
                    <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                      {HOST_METRIC_CARDS.map((card) => (
                        <Grid item xs={6} sm={3} key={`esp-${card.key}`}>
                          <HostMetricCard
                            label={card.label}
                            value={formatMetric(benchResult[card.key])}
                            hint={card.hint}
                          />
                        </Grid>
                      ))}
                      <Grid item xs={6} sm={3}>
                        <HostMetricCard
                          label="Ø Latenz"
                          value={
                            benchResult.avgLatencyMs != null
                              ? `${Math.round(benchResult.avgLatencyMs)} ms`
                              : '—'
                          }
                          hint="Mittlere total_ms vom ESP-P4 pro Bild (Decode+Infer+Post)."
                        />
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <HostMetricCard
                          label="Ø Infer"
                          value={
                            benchResult.avgInferenceMs != null
                              ? `${Math.round(benchResult.avgInferenceMs)} ms`
                              : '—'
                          }
                          hint="Mittlere inference_ms (nur Modell-Lauf auf dem ESP)."
                        />
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <HostMetricCard
                          label="TP / FP / FN"
                          value={`${benchResult.tp ?? '—'} / ${benchResult.fp ?? '—'} / ${benchResult.fn ?? '—'}`}
                          hint="IoU≥0.5 greedy Match: True Positives / False Positives / False Negatives."
                        />
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <HostMetricCard
                          label="Bilder ok"
                          value={`${benchResult.ok ?? 0}/${benchResult.images ?? 0}`}
                          hint="Erfolgreiche Detect-Antworten von allen Val-Bildern."
                        />
                      </Grid>
                    </Grid>
                    <Typography variant="body2" color="text.secondary">
                      Ziel: {benchResult.target?.baseUrl || '—'}
                      {benchResult.errors ? ` · Fehler ${benchResult.errors}` : ''}
                      {benchResult.skipped ? ` · übersprungen ${benchResult.skipped}` : ''}
                      {benchResult.datasetStem ? ` · ${benchResult.datasetStem}` : ''}
                      {benchResult.gtBirds != null
                        ? ` · GT/Pred ${benchResult.gtBirds}/${benchResult.predBirds}`
                        : ''}
                    </Typography>
                    {benchResult.saved && benchResult.savedPath && (
                      <Typography variant="caption" color="success.main" display="block" sx={{ mt: 0.5 }}>
                        Gespeichert: {benchResult.savedPath}
                      </Typography>
                    )}
                    {benchResult.note && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        {benchResult.note}
                      </Typography>
                    )}
                  </Box>
                ) : benchResult.ready ? (
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {(benchResult.baselineLabel || benchResult.weightsName || 'Modell')}
                      {benchResult.imgsz != null ? ` · imgsz ${benchResult.imgsz}` : ''}
                      {benchResult.datasetStem ? ` · ${benchResult.datasetStem}` : ''}
                      {benchResult.valImages != null ? ` · ${benchResult.valImages} Val-Bilder` : ''}
                      {benchResult.durationMs != null
                        ? ` · ${Math.round(benchResult.durationMs / 1000)} s`
                        : ''}
                      {benchResult.speedMsPerImg != null
                        ? ` · ~${Math.round(benchResult.speedMsPerImg)} ms/img`
                        : ''}
                    </Typography>
                    <Grid container spacing={1.5}>
                      {HOST_METRIC_CARDS.map((card) => (
                        <Grid item xs={12} sm={6} md={3} key={card.key}>
                          <HostMetricCard
                            label={card.label}
                            value={formatMetric(benchResult[card.key])}
                            hint={card.hint}
                          />
                        </Grid>
                      ))}
                    </Grid>
                    <Alert severity="info" sx={{ mt: 2 }} icon={false}>
                      <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600 }}>
                        Kurz gelesen
                      </Typography>
                      <Typography variant="body2" component="div">
                        <div>
                          <strong>mAP50</strong> — findet das Modell die Vögel überhaupt (lockere Box)?
                        </div>
                        <div>
                          <strong>mAP50–95</strong> — sitzt die Box auch genau genug?
                        </div>
                        <div>
                          <strong>Precision</strong> — wenn es meldet, stimmt es? (weniger Fehlalarme)
                        </div>
                        <div>
                          <strong>Recall</strong> — findet es die echten Vögel? (weniger Verpasste)
                        </div>
                      </Typography>
                    </Alert>
                    {benchResult.saved && benchResult.savedPath && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                        Gespeichert: {benchResult.savedPath}
                      </Typography>
                    )}
                    {!benchResult.saved && benchResult.saveError && (
                      <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1.5 }}>
                        Nicht gespeichert: {benchResult.saveError}
                      </Typography>
                    )}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary" component="div">
                    <div>Val-Bilder: {benchResult.valImages ?? '—'}</div>
                    <div>{benchResult.note || 'Host-Val noch nicht bereit'}</div>
                    {(benchResult.nextSteps || []).map((step) => (
                      <div key={step}>· {step}</div>
                    ))}
                  </Typography>
                )}
              </Paper>
            )}

            {benchHistory.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Gespeicherte Host-Vals
                  {selectedBaseline?.runName ? ` · ${selectedBaseline.runName}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  Eintrag anklicken → Detailansicht
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {benchHistory.map((row) => {
                    const selected = historyFile === row.file;
                    return (
                      <Box
                        key={row.file}
                        component="button"
                        type="button"
                        onClick={() => openHostHistory(row)}
                        sx={{
                          textAlign: 'left',
                          border: '1px solid',
                          borderColor: selected ? 'primary.main' : 'divider',
                          bgcolor: selected ? 'action.selected' : 'background.paper',
                          borderRadius: 1,
                          px: 1.5,
                          py: 1,
                          cursor: 'pointer',
                          font: 'inherit',
                          color: 'text.secondary',
                          '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' }
                        }}
                      >
                        <Typography variant="body2" color="text.primary">
                          {row.finishedAt
                            ? new Date(row.finishedAt).toLocaleString('de-DE')
                            : row.file}
                          {' · '}
                          mAP50 {row.map50 != null ? Number(row.map50).toFixed(3) : '—'}
                          {' / '}
                          mAP50-95 {row.map50_95 != null ? Number(row.map50_95).toFixed(3) : '—'}
                          {row.datasetStem ? ` · ${row.datasetStem}` : ''}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Paper>
            )}
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
