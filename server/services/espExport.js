/**
 * ESPDet .pt → INT8 .espdl export job (esp-detection deploy/export + quantize).
 * Writes .espdl next to the .pt under NAS result/<run>/ (or local work copy).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');
const {
  ensureFrozenValFromZip,
  findDatasetZip,
  trainingRoot,
  isMounted
} = require('../utils/nasTraining');
const {
  resolveUltralyticsPython,
  resolveEspDetectionRoot
} = require('./hostVal');

const EXPORT_SCRIPT = path.join(__dirname, '../scripts/espdet_export_espdl.py');
// Outside server/ so nodemon never sees calib/status/.espdl scratch writes.
const WORK_ROOT = process.env.ESP_EXPORT_WORK
  || path.join(os.tmpdir(), 'taubenschiesser-esp-export');
const STATUS_FILE = path.join(WORK_ROOT, 'status.json');

const PHASE_LABELS = {
  prepare: 'Vorbereitung',
  onnx: 'ONNX-Export',
  quantize: 'INT8-Quantisierung',
  save: 'Speichern auf NAS',
  done: 'Fertig'
};

let current = null;
/** @type {import('child_process').ChildProcess | null} */
let activeChild = null;

function publicState(state) {
  if (!state) return { status: 'idle' };
  return {
    status: state.status,
    processed: state.processed || 0,
    total: state.total || 100,
    message: state.message || '',
    phase: state.phase || null,
    phaseLabel: state.phaseLabel || null,
    detail: state.detail || null,
    imgsz: state.imgsz || null,
    target: state.target || null,
    calibImages: state.calibImages || null,
    weightsName: state.weightsName || null,
    error: state.error || null,
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    result: state.result || null
  };
}

function persistStatus() {
  try {
    ensureDir(WORK_ROOT);
    if (!current) {
      if (fs.existsSync(STATUS_FILE)) fs.unlinkSync(STATUS_FILE);
      return;
    }
    fs.writeFileSync(STATUS_FILE, `${JSON.stringify(publicState(current), null, 2)}\n`, 'utf8');
  } catch (err) {
    logger.warn(`ESP export status persist: ${err.message}`);
  }
}

function loadPersistedStatus() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

/** After nodemon/crash: in-memory job is gone — recover last status from disk. */
function recoverAfterRestart() {
  const saved = loadPersistedStatus();
  if (!saved) return;
  if (saved.status === 'running') {
    current = {
      ...saved,
      status: 'stopped',
      message: 'Abgebrochen (Server-Neustart)',
      detail: saved.detail
        || 'Export wurde durch Server-Neustart beendet (z.B. nodemon). Bitte erneut starten.',
      error: null,
      finishedAt: new Date().toISOString(),
      stopRequested: false
    };
    persistStatus();
    logger.warn('ESP export recovered as stopped after server restart');
    return;
  }
  // Keep last terminal state so UI can show done/failed/stopped after reload.
  current = {
    ...saved,
    stopRequested: false
  };
}

recoverAfterRestart();

function childAlive() {
  return Boolean(activeChild && activeChild.exitCode == null && !activeChild.killed);
}

/** If UI still shows "running" but Python is gone (external kill / crash), reconcile. */
function reconcileRunningState() {
  if (!current || current.status !== 'running') return;
  if (childAlive()) return;
  // Job claims running but no child — stale after kill/nodemon/restart.
  current.status = 'stopped';
  current.message = 'Abgebrochen (Prozess beendet)';
  current.detail = current.detail || 'Export-Prozess läuft nicht mehr';
  current.error = null;
  current.finishedAt = current.finishedAt || new Date().toISOString();
  activeChild = null;
  persistStatus();
}

function getEspExportStatus() {
  reconcileRunningState();
  return publicState(current);
}

function clearEspExportStatus() {
  if (current && current.status === 'running' && childAlive()) {
    const err = new Error('Export läuft noch — zuerst Stopp');
    err.statusCode = 409;
    throw err;
  }
  if (activeChild) {
    try {
      activeChild.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    activeChild = null;
  }
  current = null;
  persistStatus();
  return publicState(current);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function setProgress(state, pct, phase, detail) {
  if (!state || state.stopRequested) return;
  const next = Math.max(state.processed || 0, Math.min(100, Math.round(pct)));
  state.processed = next;
  state.total = 100;
  if (phase) {
    state.phase = phase;
    state.phaseLabel = PHASE_LABELS[phase] || phase;
  }
  if (detail != null && String(detail).trim()) {
    state.detail = String(detail).trim();
  }
  const label = state.phaseLabel || state.phase || 'Export';
  const extra = state.detail ? ` · ${state.detail}` : '';
  state.message = `${label} · ${next}%${extra}`;
  if (state === current) persistStatus();
}

function parseJsonLine(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* continue */
    }
  }
  return null;
}

/** Parse "PROGRESS 30 quantize | detail" or "PHASE quantize" from stderr chunk. */
function parseProgressLines(chunk) {
  const text = String(chunk || '');
  const events = [];
  const reProgress = /PROGRESS\s+(\d+)\s+(\w+)(?:\s*\|\s*(.+))?/gi;
  let m;
  while ((m = reProgress.exec(text)) !== null) {
    events.push({
      type: 'progress',
      pct: Number(m[1]),
      phase: m[2].toLowerCase(),
      detail: (m[3] || '').trim()
    });
  }
  const rePhase = /(?:^|\n)PHASE\s+(\w+)/gi;
  while ((m = rePhase.exec(text)) !== null) {
    events.push({ type: 'phase', phase: m[1].toLowerCase() });
  }
  return events;
}

/**
 * Copy up to `limit` images from frozen val into a flat calib folder.
 */
function materializeCalibDir(imagesDir, destDir, limit = 64) {
  ensureDir(destDir);
  const names = fs
    .readdirSync(imagesDir)
    .filter((n) => /\.(jpe?g|png|bmp)$/i.test(n))
    .sort();
  const take = names.slice(0, Math.max(8, Math.min(limit, names.length)));
  take.forEach((name) => {
    fs.copyFileSync(path.join(imagesDir, name), path.join(destDir, name));
  });
  return take.length;
}

function artifactProgress(outPath) {
  const base = outPath.replace(/\.espdl$/i, '');
  const jsonPath = `${base}.json`;
  const infoPath = `${base}.info`;
  if (fs.existsSync(outPath)) {
    let bytes = 0;
    try {
      bytes = fs.statSync(outPath).size;
    } catch {
      bytes = 0;
    }
    return { pct: 90, detail: bytes > 0 ? `.espdl geschrieben (${Math.round(bytes / 1024)} KB)` : '.espdl vorhanden' };
  }
  if (fs.existsSync(infoPath)) {
    return { pct: 70, detail: 'Quantize-Zwischenstand (.info)' };
  }
  if (fs.existsSync(jsonPath)) {
    let bytes = 0;
    try {
      bytes = fs.statSync(jsonPath).size;
    } catch {
      bytes = 0;
    }
    return {
      pct: 55,
      detail: bytes > 0
        ? `Kalibrierung läuft (.json ${Math.round(bytes / 1024)} KB)`
        : 'Kalibrierung läuft (.json)'
    };
  }
  return null;
}

function runExportProcess({
  pythonBin,
  weightsPath,
  outPath,
  calibDir,
  imgsz,
  target,
  espDetectionRoot,
  onProgress
}) {
  return new Promise((resolve, reject) => {
    const args = [
      EXPORT_SCRIPT,
      '--weights', weightsPath,
      '--out', outPath,
      '--calib-dir', calibDir,
      '--imgsz', String(imgsz),
      '--target', target || 'esp32p4',
      '--batch', String(process.env.ESP_EXPORT_BATCH || 8),
      '--device', process.env.ESP_EXPORT_DEVICE || 'cpu'
    ];
    if (espDetectionRoot) {
      args.push('--esp-detection-root', espDetectionRoot);
    }
    const env = { ...process.env, YOLO_AUTOINSTALL: 'False' };
    if (espDetectionRoot) {
      env.ESP_DETECTION_ROOT = espDetectionRoot;
      const prev = env.PYTHONPATH || '';
      env.PYTHONPATH = prev
        ? `${espDetectionRoot}${path.delimiter}${prev}`
        : espDetectionRoot;
    }
    const child = spawn(pythonBin, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: espDetectionRoot || process.cwd()
    });
    activeChild = child;
    let stdout = '';
    let stderr = '';
    const notify = (pct, phase, detail) => {
      if (typeof onProgress === 'function') {
        try {
          onProgress({ pct, phase, detail });
        } catch (err) {
          logger.warn(`ESP export progress cb: ${err.message}`);
        }
      }
    };

    const pollArtifacts = setInterval(() => {
      const art = artifactProgress(outPath);
      if (art) notify(art.pct, 'quantize', art.detail);
    }, 2000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 40000) stderr = stderr.slice(-30000);
      const events = parseProgressLines(text);
      events.forEach((ev) => {
        if (ev.type === 'progress') {
          notify(ev.pct, ev.phase, ev.detail);
        } else if (ev.type === 'phase') {
          notify(null, ev.phase, null);
        }
      });
    });
    child.on('error', (err) => {
      clearInterval(pollArtifacts);
      if (activeChild === child) activeChild = null;
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearInterval(pollArtifacts);
      if (activeChild === child) activeChild = null;
      const payload = parseJsonLine(stdout);
      if (payload?.ok && payload.espdl) {
        resolve({ payload, stderr, code });
        return;
      }
      if (signal === 'SIGTERM' || signal === 'SIGKILL' || code === 143 || code === 137) {
        const err = new Error('Export abgebrochen');
        err.code = 'STOPPED';
        err.stderr = stderr;
        reject(err);
        return;
      }
      const lines = stderr.trim().split('\n').filter(Boolean);
      const lastUseful = [...lines].reverse().find((l) =>
        /ESP export failed:|Error|Exception|FileNotFoundError|TypeError/i.test(l)
      );
      const hint = lastUseful
        || lines.slice(-6).join('\n')
        || `espdet_export_espdl.py exit ${code}`;
      const err = new Error(hint);
      err.code = code;
      err.stderr = stderr;
      reject(err);
    });
  });
}

async function runEspExport(userId, state) {
  state.status = 'running';
  state.message = 'ESP-Export starten';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.processed = 0;
  state.total = 100;
  state.phase = 'prepare';
  state.phaseLabel = PHASE_LABELS.prepare;
  state.detail = null;
  state.result = null;

  const workId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = path.join(WORK_ROOT, workId);
  let cleanup = true;

  try {
    const weightsPath = state.weightsPath;
    if (!weightsPath || !fs.existsSync(weightsPath)) {
      throw new Error(`Weights fehlen: ${weightsPath || '(leer)'}`);
    }

    const pythonBin = resolveUltralyticsPython();
    if (pythonBin.includes(path.sep) && !fs.existsSync(pythonBin)) {
      throw new Error(`Python nicht gefunden: ${pythonBin}`);
    }
    const espDetectionRoot = resolveEspDetectionRoot();
    if (!espDetectionRoot) {
      throw new Error(
        'ESP_DETECTION_ROOT fehlt — esp-detection Repo mit deploy/quantize.py nötig'
      );
    }

    const imgsz = Number(state.imgsz) || 224;
    state.imgsz = imgsz;
    const target = state.target || 'esp32p4';

    setProgress(state, 2, 'prepare', 'Frozen Val / Kalibrier-Bilder…');
    let imagesDir = state.calibImagesDir || null;
    if (!imagesDir) {
      const zipPath = state.datasetZipPath
        || (state.datasetStem ? findDatasetZip(state.datasetStem)?.path : null);
      if (!zipPath) {
        throw new Error(
          'Trainingsdata-ZIP für Kalibrierung wählen (Frozen Val-Bilder)'
        );
      }
      const frozen = ensureFrozenValFromZip(zipPath);
      imagesDir = path.join(frozen.runDir, 'images', 'val');
      state.datasetStem = frozen.stem;
    }
    if (!fs.existsSync(imagesDir)) {
      throw new Error(`Kalibrier-Ordner fehlt: ${imagesDir}`);
    }

    ensureDir(workDir);
    const calibDir = path.join(workDir, 'calib');
    const nCalib = materializeCalibDir(imagesDir, calibDir, state.calibLimit || 64);
    state.calibImages = nCalib;
    if (nCalib < 8) {
      throw new Error(`Zu wenige Kalibrier-Bilder (${nCalib})`);
    }

    const localPt = path.join(workDir, path.basename(weightsPath));
    fs.copyFileSync(weightsPath, localPt);
    const chipTag = target === 'esp32s3' ? 's3' : 'p4';
    const espdlFileName = `espdet_bird_${imgsz}_s8_${chipTag}.espdl`;
    const localEspdl = path.join(workDir, espdlFileName);

    setProgress(
      state,
      8,
      'prepare',
      `${nCalib} Kalibrier-Bilder · imgsz=${imgsz} · ${target}`
    );

    const { payload } = await runExportProcess({
      pythonBin,
      weightsPath: localPt,
      outPath: localEspdl,
      calibDir,
      imgsz,
      target,
      espDetectionRoot,
      onProgress: ({ pct, phase, detail }) => {
        if (state.stopRequested) return;
        if (pct == null && phase) {
          state.phase = phase;
          state.phaseLabel = PHASE_LABELS[phase] || phase;
          return;
        }
        if (pct != null) setProgress(state, pct, phase, detail);
      }
    });

    if (state.stopRequested) {
      state.status = 'stopped';
      state.message = 'Angehalten';
      state.finishedAt = new Date().toISOString();
      return publicState(state);
    }

    setProgress(state, 94, 'save', 'Kopiere .espdl + Manifest auf NAS…');
    const weightsDir = path.dirname(weightsPath);
    const nasRoot = isMounted() ? trainingRoot() : null;
    const fileName = path.basename(localEspdl);
    const destEspdl = path.join(weightsDir, fileName);
    fs.copyFileSync(localEspdl, destEspdl);

    const scoreThr = Number(state.scoreThr);
    const nmsThr = Number(state.nmsThr);
    const manifest = {
      backend: 'espdet',
      espdl: fileName,
      imgsz,
      score_thr: Number.isFinite(scoreThr) ? scoreThr : 0.25,
      nms_thr: Number.isFinite(nmsThr) ? nmsThr : 0.7,
      target,
      class_name: 'bird',
      weights: state.weightsName || path.basename(weightsPath),
      dataset_stem: state.datasetStem || null,
      note:
        'Copy .espdl + this file into phase1-camera/main/models/p4/ as detect_manifest.json'
    };
    const destManifest = path.join(weightsDir, 'detect_manifest.json');
    fs.writeFileSync(destManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    let destBytes = null;
    try {
      destBytes = fs.statSync(destEspdl).size;
    } catch {
      destBytes = payload.bytes || null;
    }

    const elapsedSec = payload.elapsedSec != null
      ? payload.elapsedSec
      : (state.startedAt
        ? Math.round((Date.now() - Date.parse(state.startedAt)) / 1000)
        : null);

    setProgress(state, 100, 'done', fileName);
    state.status = 'done';
    state.message = `ESP-Export fertig · ${fileName} + detect_manifest.json`
      + (elapsedSec != null ? ` · ${elapsedSec}s` : '');
    state.finishedAt = new Date().toISOString();
    state.result = {
      ok: true,
      espdlPath: destEspdl,
      espdlRelative: nasRoot && destEspdl.startsWith(nasRoot)
        ? path.relative(nasRoot, destEspdl)
        : destEspdl,
      manifestPath: destManifest,
      manifestRelative: nasRoot && destManifest.startsWith(nasRoot)
        ? path.relative(nasRoot, destManifest)
        : destManifest,
      bytes: destBytes,
      imgsz,
      target,
      score_thr: manifest.score_thr,
      nms_thr: manifest.nms_thr,
      calibImages: nCalib,
      elapsedSec,
      weightsName: state.weightsName || path.basename(weightsPath),
      baselineId: state.baselineId || null,
      baselineLabel: state.baselineLabel || null,
      runName: state.runName || null,
      datasetStem: state.datasetStem || null,
      note:
        'Beide Dateien nach phase1-camera/main/models/p4/ kopieren, dann idf.py build + OTA.'
    };
    cleanup = process.env.ESP_EXPORT_KEEP_WORK !== '1';
    persistStatus();
    return publicState(state);
  } catch (err) {
    if (state.stopRequested || err.code === 'STOPPED') {
      state.status = 'stopped';
      state.message = 'Angehalten';
      state.detail = err.message || 'Export abgebrochen';
      state.error = null;
      state.finishedAt = new Date().toISOString();
      persistStatus();
      return publicState(state);
    }
    logger.error(`ESP export failed: ${err.message}`);
    state.status = 'failed';
    state.error = err.message || 'ESP-Export fehlgeschlagen';
    state.message = state.error;
    state.finishedAt = new Date().toISOString();
    persistStatus();
    return publicState(state);
  } finally {
    if (cleanup && workDir && fs.existsSync(workDir)) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn(`ESP export cleanup: ${err.message}`);
      }
    }
  }
}

function startEspExport(userId, options = {}) {
  reconcileRunningState();
  if (current && current.status === 'running') {
    const err = new Error('ESP-Export läuft bereits');
    err.statusCode = 409;
    throw err;
  }
  const state = {
    status: 'running',
    userId: String(userId),
    weightsPath: options.weightsPath || null,
    weightsName: options.weightsName || null,
    baselineId: options.baselineId || null,
    baselineLabel: options.baselineLabel || null,
    runName: options.runName || null,
    imgsz: options.imgsz || null,
    target: options.target || 'esp32p4',
    datasetZipPath: options.datasetZipPath || null,
    datasetStem: options.datasetStem || null,
    calibImagesDir: options.calibImagesDir || null,
    calibLimit: options.calibLimit || 64,
    calibImages: null,
    phase: 'prepare',
    phaseLabel: PHASE_LABELS.prepare,
    detail: null,
    processed: 0,
    total: 100,
    message: 'Startet',
    stopRequested: false,
    error: null,
    result: null,
    startedAt: null,
    finishedAt: null
  };
  current = state;
  persistStatus();
  setImmediate(() => {
    runEspExport(userId, state).catch((err) => {
      logger.error(`ESP export failed: ${err.message}`);
      state.status = 'failed';
      state.error = err.message || 'ESP-Export fehlgeschlagen';
      state.message = state.error;
      state.finishedAt = new Date().toISOString();
      persistStatus();
    });
  });
  return publicState(state);
}

function requestEspExportStop() {
  if (!current || current.status !== 'running') {
    reconcileRunningState();
    return publicState(current);
  }
  current.stopRequested = true;
  current.message = 'Stopp — beende Prozess…';
  persistStatus();
  if (activeChild) {
    try {
      activeChild.kill('SIGTERM');
    } catch (err) {
      logger.warn(`ESP export kill: ${err.message}`);
    }
  } else {
    // Already dead — flip state immediately so UI does not stay on "running".
    current.status = 'stopped';
    current.message = 'Angehalten';
    current.finishedAt = new Date().toISOString();
    persistStatus();
  }
  return publicState(current);
}

module.exports = {
  getEspExportStatus,
  startEspExport,
  requestEspExportStop,
  clearEspExportStatus
};
