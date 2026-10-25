const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const logger = require('../utils/logger');
const { resolveEspP4Target } = require('../utils/espP4Targets');
const {
  pickImageUrl,
  classifyExportDoc,
  decodeImageBuffer,
  clampValRatio,
  temporalSplit
} = require('../utils/yoloDataset');
const { fetchCandidateRows } = require('./datasetExport');
const {
  materializeHostValSet,
  cleanupHostValDir,
  resolveUltralyticsPython,
  resolveEspDetectionRoot
} = require('./hostVal');
const {
  resolveRunNameFromWeights,
  saveHostValResult,
  saveEspBenchResult
} = require('../utils/benchmarkStore');
const { ensureFrozenValFromZip } = require('../utils/nasTraining');
const {
  readJpegSize,
  parseYoloLabelText,
  dbBboxesToXyxy,
  espBirdsToXyxy,
  summarizeDetectionMetrics
} = require('../utils/detectionMetrics');

const YOLO_VAL_SCRIPT = path.join(__dirname, '../scripts/yolo_val.py');

let current = null;

function publicState(state) {
  if (!state) return { status: 'idle', mode: null };
  return {
    status: state.status,
    mode: state.mode || null,
    processed: state.processed || 0,
    total: state.total || 0,
    message: state.message || '',
    error: state.error || null,
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    result: state.result || null
  };
}

function avgOrNull(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Partial ESP metrics for live UI (recomputed on evaluated images so far). */
function buildEspLiveResult(state, ctx) {
  const metrics = summarizeDetectionMetrics(ctx.evalImages);
  const mapPct = metrics.map50 != null ? (metrics.map50 * 100).toFixed(1) : '—';
  return {
    mode: 'esp',
    ready: true,
    partial: Boolean(ctx.partial),
    target: ctx.target,
    images: state.total || 0,
    ok: ctx.ok,
    errors: ctx.errors,
    skipped: ctx.skipped,
    gtBirds: ctx.gtBirds,
    predBirds: ctx.predBirds,
    imagesWithGt: ctx.imagesWithGt,
    imagesWithPred: ctx.imagesWithPred,
    imagesBoth: ctx.imagesBoth,
    avgLatencyMs: avgOrNull(ctx.latencies),
    avgInferenceMs: avgOrNull(ctx.inferLatencies),
    map50: metrics.map50,
    map50_95: metrics.map50_95,
    precision: metrics.precision,
    recall: metrics.recall,
    tp: metrics.tp,
    fp: metrics.fp,
    fn: metrics.fn,
    iouThr: 0.5,
    datasetStem: state.datasetStem || null,
    valSource: state.datasetZipPath ? 'nas-zip' : 'db-live',
    valImages: ctx.evalImages.length,
    note: ctx.partial
      ? `Zwischenergebnis nach ${ctx.evalImages.length}/${state.total || '?'} Bildern · IoU@0.5 · mAP50 ${mapPct}%`
      : ctx.note
  };
}

function getBenchmarkStatus() {
  return publicState(current);
}

async function loadJpegBuffer(doc) {
  const picked = pickImageUrl(doc);
  if (!picked) return null;
  const buf = decodeImageBuffer(picked.url);
  if (buf) return buf;
  if (picked.url.startsWith('http://') || picked.url.startsWith('https://')) {
    const response = await axios.get(picked.url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 40 * 1024 * 1024
    });
    return Buffer.from(response.data);
  }
  return null;
}

async function listValImageIds(userId, valRatio, limit) {
  const devices = await Device.find({ owner: userId }).select('_id');
  const deviceIds = devices.map((d) => d._id);
  if (!deviceIds.length) return [];
  const rows = await fetchCandidateRows(deviceIds);
  const items = rows.map((row) => ({
    id: String(row._id),
    processedAt: row.processedAt || null,
    kind: row.kind,
    boxCount: row.boxCount || 0
  }));
  const { val } = temporalSplit(items, clampValRatio(valRatio));
  const capped = Math.max(1, Math.min(Number(limit) || 20, 100));
  return val.slice(0, capped).map((item) => ({
    source: 'db',
    id: item.id
  }));
}

function countYoloLabelBoxes(labelPath) {
  if (!fs.existsSync(labelPath)) return 0;
  try {
    const text = fs.readFileSync(labelPath, 'utf8').trim();
    if (!text) return 0;
    return text.split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

/** Frozen Val images from NAS export ZIP (same set as Host-Val). */
function listFrozenValSamples(zipPath, limit) {
  const frozen = ensureFrozenValFromZip(zipPath);
  const imagesDir = path.join(frozen.runDir, 'images', 'val');
  const labelsDir = path.join(frozen.runDir, 'labels', 'val');
  if (!fs.existsSync(imagesDir)) return [];
  let files = fs.readdirSync(imagesDir)
    .filter((name) => /\.(jpe?g|png|bmp|webp)$/i.test(name))
    .sort();
  const cap = Number(limit);
  if (Number.isFinite(cap) && cap > 0) {
    files = files.slice(0, Math.min(cap, 500));
  }
  return files.map((file) => {
    const base = path.basename(file, path.extname(file));
    const labelPath = path.join(labelsDir, `${base}.txt`);
    return {
      source: 'file',
      id: base,
      imagePath: path.join(imagesDir, file),
      labelPath,
      gtCount: countYoloLabelBoxes(labelPath)
    };
  });
}

async function postDetect(baseUrl, jpegBuffer) {
  const form = new FormData();
  form.append('image', jpegBuffer, {
    filename: 'frame.jpg',
    contentType: 'image/jpeg'
  });
  const response = await axios.post(`${baseUrl}/detect`, form, {
    headers: form.getHeaders(),
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });
  return { status: response.status, data: response.data };
}

async function runEspBenchmark(userId, state) {
  state.status = 'running';
  state.mode = 'esp';
  state.message = 'Val-Bilder laden';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.processed = 0;
  state.result = null;

  const target = await resolveEspP4Target(userId, state.deviceId, state.cameraId);
  if (!target) {
    state.status = 'failed';
    state.error = 'Kein ESP-P4-Ziel gefunden';
    state.message = state.error;
    state.finishedAt = new Date().toISOString();
    return publicState(state);
  }

  let samples;
  let valNote;
  if (state.datasetZipPath) {
    state.message = 'Frozen Val von NAS-ZIP…';
    samples = listFrozenValSamples(state.datasetZipPath, null);
    valNote = `Frozen Val ZIP${state.datasetStem ? `: ${state.datasetStem}` : ''}`;
  } else {
    samples = await listValImageIds(userId, state.valRatio, state.limit);
    valNote = 'Live-DB Val-Split';
  }
  state.total = samples.length;
  if (!samples.length) {
    state.status = 'done';
    state.message = 'Keine Val-Bilder';
    state.result = { images: 0, datasetStem: state.datasetStem || null };
    state.finishedAt = new Date().toISOString();
    return publicState(state);
  }

  const targetInfo = {
    deviceName: target.deviceName,
    cameraName: target.cameraName,
    baseUrl: target.baseUrl
  };
  state.message = `Detect auf ${target.baseUrl}`;
  const ctx = {
    ok: 0,
    errors: 0,
    skipped: 0,
    gtBirds: 0,
    predBirds: 0,
    imagesWithGt: 0,
    imagesWithPred: 0,
    imagesBoth: 0,
    latencies: [],
    inferLatencies: [],
    evalImages: [],
    target: targetInfo,
    partial: true,
    note: null
  };

  const publishLive = () => {
    if (!ctx.evalImages.length) return;
    // Full AP every image is fine for 1-class; refresh UI via state.result.
    state.result = buildEspLiveResult(state, ctx);
    const mapPct = state.result.map50 != null
      ? (state.result.map50 * 100).toFixed(1)
      : '—';
    state.message = `${state.processed}/${state.total} · mAP50 ${mapPct}% · P ${
      state.result.precision != null ? state.result.precision.toFixed(2) : '—'
    } · R ${
      state.result.recall != null ? state.result.recall.toFixed(2) : '—'
    }`;
  };

  for (const sample of samples) {
    if (state.stopRequested) break;
    state.processed += 1;
    try {
      let jpeg = null;
      let gtXyxy = [];
      if (sample.source === 'file') {
        jpeg = fs.readFileSync(sample.imagePath);
        if (sample.labelPath && fs.existsSync(sample.labelPath)) {
          gtXyxy = parseYoloLabelText(fs.readFileSync(sample.labelPath, 'utf8'));
        }
      } else {
        const doc = await Detection.findById(sample.id)
          .select(
            'birds classification_status target_bird image_info '
            + 'image.url zoomed_image.url tapo_image.url tapo_zoomed_image.url '
            + 'raspberry_pi_image.url raspberry_pi_zoomed_image.url'
          )
          .lean();
        if (!doc) {
          ctx.skipped += 1;
          continue;
        }
        const classified = classifyExportDoc(doc);
        jpeg = await loadJpegBuffer(doc);
        if (!jpeg) {
          ctx.skipped += 1;
          continue;
        }
        const size = readJpegSize(jpeg);
        if (classified.kind === 'positive') {
          gtXyxy = dbBboxesToXyxy(
            classified.boxes,
            size?.width,
            size?.height
          );
        } else if (classified.kind === 'skip') {
          ctx.skipped += 1;
          continue;
        }
      }
      if (!jpeg) {
        ctx.skipped += 1;
        continue;
      }
      const imgSize = readJpegSize(jpeg);
      const gtCount = gtXyxy.length;
      if (gtCount > 0) ctx.imagesWithGt += 1;
      ctx.gtBirds += gtCount;

      const { status, data } = await postDetect(target.baseUrl, jpeg);
      if (status >= 400 || !data || data.ok === false) {
        ctx.errors += 1;
        continue;
      }
      ctx.ok += 1;
      const birds = Array.isArray(data.birds) ? data.birds : [];
      const preds = espBirdsToXyxy(birds, imgSize?.width, imgSize?.height);
      const predCount = preds.length;
      ctx.predBirds += predCount;
      if (predCount > 0) ctx.imagesWithPred += 1;
      if (gtCount > 0 && predCount > 0) ctx.imagesBoth += 1;
      if (Number.isFinite(data.total_ms)) ctx.latencies.push(Number(data.total_ms));
      if (Number.isFinite(data.inference_ms)) {
        ctx.inferLatencies.push(Number(data.inference_ms));
      }
      ctx.evalImages.push({ gt: gtXyxy, preds });
      // Live metrics every image; cheap enough for bird-only Val.
      publishLive();
    } catch (err) {
      ctx.errors += 1;
      logger.error(`ESP benchmark ${sample.id}: ${err.message}`);
    }
  }

  ctx.partial = false;
  ctx.note = `${valNote}. IoU-Match @0.5 (P/R) · mAP50 / mAP50-95 (AP über Score-Ranking).`;
  state.result = buildEspLiveResult(state, ctx);

  if (state.datasetStem && !state.stopRequested) {
    const saved = saveEspBenchResult({
      userId,
      runName: state.datasetStem,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      result: state.result
    });
    state.result.saved = saved.saved;
    state.result.savedPath = saved.relativePath || null;
    state.result.saveError = saved.error || null;
  }

  state.status = state.stopRequested ? 'stopped' : 'done';
  state.message = state.stopRequested
    ? 'Angehalten'
    : (state.result.map50 != null
      ? `Fertig · mAP50 ${(state.result.map50 * 100).toFixed(1)}%`
      : 'Fertig');
  state.finishedAt = new Date().toISOString();
  return publicState(state);
}

function parseYoloValJson(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* try previous line */
    }
  }
  return null;
}

/** Parse Ultralytics tqdm lines like "655/1105 33.2it/s" from a stderr chunk. */
function parseYoloValProgress(chunk, expectedTotal) {
  const text = String(chunk || '');
  if (!text) return null;
  const re = /(\d+)\s*\/\s*(\d+)/g;
  let match;
  let best = null;
  while ((match = re.exec(text)) !== null) {
    const cur = Number(match[1]);
    const tot = Number(match[2]);
    if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot <= 0 || cur > tot) continue;
    // Prefer matches that agree with known val size (skip e.g. "1/1" noise).
    if (expectedTotal > 1 && tot === expectedTotal) {
      best = { processed: cur, total: tot };
      continue;
    }
    if (expectedTotal <= 1 && tot >= 2) {
      best = { processed: cur, total: tot };
    }
  }
  return best;
}

function runYoloValProcess({
  pythonBin,
  weightsPath,
  dataYaml,
  imgsz,
  projectDir,
  espDetectionRoot,
  onProgress
}) {
  return new Promise((resolve, reject) => {
    const args = [
      YOLO_VAL_SCRIPT,
      '--weights', weightsPath,
      '--data', dataYaml,
      '--imgsz', String(imgsz),
      '--device', process.env.HOST_VAL_DEVICE || 'cpu',
      '--project', projectDir,
      '--name', 'host-val'
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
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let lastProcessed = -1;
    let expectedTotal = 0;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 20000) stderr = stderr.slice(-16000);
      if (typeof onProgress !== 'function') return;
      const prog = parseYoloValProgress(text, expectedTotal);
      if (!prog) return;
      if (prog.total > expectedTotal) expectedTotal = prog.total;
      if (prog.processed === lastProcessed && prog.total === expectedTotal) return;
      lastProcessed = prog.processed;
      try {
        onProgress(prog);
      } catch (err) {
        logger.warn(`Host-Val progress callback: ${err.message}`);
      }
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code, signal) => {
      // Prefer JSON even on crash: val often finishes, then macOS aborts on teardown.
      const metrics = parseYoloValJson(stdout);
      if (metrics && (metrics.map50 != null || metrics.map50_95 != null)) {
        if (code !== 0 && code != null) {
          logger.warn(
            `Host-Val: Prozess exit ${code}${signal ? `/${signal}` : ''}, `
            + 'Metriken trotzdem aus stdout übernommen'
          );
        }
        resolve({ metrics, stderr });
        return;
      }
      if (code === 0) {
        reject(new Error('Ultralytics Val lieferte kein JSON'));
        return;
      }
      const hint = stderr.trim().split('\n').slice(-8).join('\n');
      const err = new Error(
        code === 3
          ? (hint || 'ultralytics fehlt — ULTRALYTICS_PYTHON setzen')
          : (hint || `yolo_val.py exit ${code}`)
      );
      err.code = code;
      err.stderr = stderr;
      reject(err);
    });
  });
}

async function runHostBenchmark(userId, state) {
  state.status = 'running';
  state.mode = 'host';
  state.message = 'Host-Val starten';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.processed = 0;
  state.total = 0;
  state.result = null;

  const startedMs = Date.now();
  const imgsz = state.imgsz || 224;
  let runDir = null;
  let shouldCleanup = true;

  try {
    const weightsPath = state.weightsPath;
    if (!weightsPath || !fs.existsSync(weightsPath)) {
      throw new Error(
        'Weights fehlen — Modell aus NAS result/ wählen '
        + `(${state.weightsPath || 'kein Pfad'}).`
      );
    }

    const pythonBin = resolveUltralyticsPython();
    if (pythonBin.includes(path.sep) && !fs.existsSync(pythonBin)) {
      throw new Error(
        `Python-Interpreter nicht gefunden: ${pythonBin}. `
        + 'ULTRALYTICS_PYTHON oder HOST_VAL_PYTHON setzen.'
      );
    }

    const materialized = await materializeHostValSet(userId, state);
    runDir = materialized.runDir;
    shouldCleanup = materialized.cleanup !== false;

    if (state.stopRequested) {
      state.status = 'stopped';
      state.message = 'Angehalten';
      state.finishedAt = new Date().toISOString();
      return publicState(state);
    }

    const valTotal = Math.max(1, Number(materialized.written) || 0);
    state.total = valTotal;
    state.processed = 0;
    state.message = `ESPDet Host-Val · 0/${valTotal} (imgsz=${imgsz})`;
    const projectDir = path.join(runDir, 'ultralytics-runs');
    const espDetectionRoot = resolveEspDetectionRoot();
    const { metrics } = await runYoloValProcess({
      pythonBin,
      weightsPath,
      dataYaml: materialized.dataYaml,
      imgsz,
      projectDir,
      espDetectionRoot,
      onProgress: ({ processed, total }) => {
        if (state.stopRequested) return;
        const tot = total > 0 ? total : valTotal;
        state.total = tot;
        state.processed = Math.min(processed, tot);
        state.message = `ESPDet Host-Val · ${state.processed}/${tot} (imgsz=${imgsz})`;
      }
    });
    state.processed = state.total;

    const valImages = metrics.images != null ? metrics.images : materialized.written;
    const sourceNote = materialized.source === 'db-live'
      ? 'ESPDet Host-Val auf Live-DB Val-Split'
      : `ESPDet Host-Val auf Frozen Val (ZIP${materialized.datasetStem ? `: ${materialized.datasetStem}` : ''})`;
    state.finishedAt = new Date().toISOString();
    state.result = {
      mode: 'host',
      ready: true,
      map50: metrics.map50,
      map50_95: metrics.map50_95,
      precision: metrics.precision,
      recall: metrics.recall,
      fitness: metrics.fitness != null ? metrics.fitness : null,
      valImages,
      imgsz,
      weightsName: state.weightsName || path.basename(weightsPath),
      baselineId: state.baselineId || null,
      baselineLabel: state.baselineLabel || null,
      weightsPath,
      valSource: materialized.source,
      datasetStem: materialized.datasetStem || state.datasetStem || null,
      durationMs: Date.now() - startedMs,
      speedMsPerImg: metrics.speed?.ms_per_img ?? null,
      skipped: materialized.skipped,
      errors: materialized.errors,
      note: sourceNote
    };

    const runName = state.runName || resolveRunNameFromWeights(weightsPath);
    const saved = saveHostValResult({
      runName,
      userId,
      result: state.result,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt
    });
    state.result.saved = saved.saved;
    state.result.savedPath = saved.relativePath || saved.path || null;
    state.result.saveError = saved.error || null;
    if (saved.saved) {
      state.result.note = `${sourceNote} · gespeichert: ${saved.relativePath}`;
    }

    state.status = 'done';
    state.message = state.baselineLabel
      ? `Host-Val · ${state.baselineLabel}`
      : 'Host-Val fertig';
    return publicState(state);
  } catch (err) {
    if (err.code === 'STOPPED' || state.stopRequested) {
      state.status = 'stopped';
      state.message = 'Angehalten';
      state.error = null;
      state.finishedAt = new Date().toISOString();
      return publicState(state);
    }
    logger.error(`Host benchmark failed: ${err.message}`);
    state.status = 'failed';
    state.error = err.message || 'Host-Val fehlgeschlagen';
    state.message = state.error;
    state.result = {
      mode: 'host',
      ready: false,
      valImages: state.processed || 0,
      weightsName: state.weightsName || null,
      baselineId: state.baselineId || null,
      baselineLabel: state.baselineLabel || null,
      imgsz,
      weightsPath: state.weightsPath || null,
      durationMs: Date.now() - startedMs,
      note: state.error
    };
    state.finishedAt = new Date().toISOString();
    return publicState(state);
  } finally {
    if (shouldCleanup) cleanupHostValDir(runDir);
  }
}

function startEspBenchmark(userId, options = {}) {
  if (current && current.status === 'running') {
    const err = new Error('Ein Benchmark läuft bereits');
    err.statusCode = 409;
    throw err;
  }
  const state = {
    status: 'running',
    mode: 'esp',
    userId: String(userId),
    deviceId: options.deviceId || null,
    cameraId: options.cameraId || null,
    valRatio: clampValRatio(options.valRatio),
    limit: Math.max(1, Math.min(Number(options.limit) || 20, 100)),
    datasetZipPath: options.datasetZipPath || null,
    datasetStem: options.datasetStem || null,
    processed: 0,
    total: 0,
    message: 'Startet',
    stopRequested: false,
    error: null,
    result: null,
    startedAt: null,
    finishedAt: null
  };
  current = state;
  setImmediate(() => {
    runEspBenchmark(userId, state).catch((err) => {
      logger.error(`ESP benchmark failed: ${err.message}`);
      state.status = 'failed';
      state.error = err.message || 'Benchmark fehlgeschlagen';
      state.message = state.error;
      state.finishedAt = new Date().toISOString();
    });
  });
  return publicState(state);
}

function startHostBenchmark(userId, options = {}) {
  if (current && current.status === 'running') {
    const err = new Error('Ein Benchmark läuft bereits');
    err.statusCode = 409;
    throw err;
  }
  const state = {
    status: 'running',
    mode: 'host',
    userId: String(userId),
    valRatio: clampValRatio(options.valRatio),
    limit: Math.max(1, Math.min(Number(options.limit) || 50, 200)),
    weightsName: options.weightsName || null,
    baselineId: options.baselineId || null,
    baselineLabel: options.baselineLabel || null,
    runName: options.runName || null,
    imgsz: options.imgsz || null,
    weightsPath: options.weightsPath || null,
    datasetZipPath: options.datasetZipPath || null,
    datasetStem: options.datasetStem || null,
    processed: 0,
    total: 1,
    message: 'Startet',
    stopRequested: false,
    error: null,
    result: null,
    startedAt: null,
    finishedAt: null
  };
  current = state;
  setImmediate(() => {
    runHostBenchmark(userId, state).catch((err) => {
      logger.error(`Host benchmark failed: ${err.message}`);
      state.status = 'failed';
      state.error = err.message || 'Benchmark fehlgeschlagen';
      state.message = state.error;
      state.finishedAt = new Date().toISOString();
    });
  });
  return publicState(state);
}

function requestBenchmarkStop() {
  if (!current || current.status !== 'running') return publicState(current);
  current.stopRequested = true;
  current.message = 'Stopp angefordert';
  return publicState(current);
}

module.exports = {
  getBenchmarkStatus,
  startEspBenchmark,
  startHostBenchmark,
  requestBenchmarkStop
};
