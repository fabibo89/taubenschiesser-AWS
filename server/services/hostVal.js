const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const logger = require('../utils/logger');
const {
  pickImageUrl,
  classifyExportDoc,
  labelsFromBoxes,
  resolveImageSize,
  decodeImageBuffer,
  imageExtension,
  clampValRatio,
  temporalSplit
} = require('../utils/yoloDataset');
const { fetchCandidateRows } = require('./datasetExport');
const { ensureFrozenValFromZip, findDatasetZip } = require('../utils/nasTraining');

const HOST_VAL_ROOT = path.join(__dirname, '../exports/host-val');
const DEFAULT_VENV_PYTHON = '/Users/fabianbosch/Documents/GitHub/esp-detection/.venv/bin/python';
const DEFAULT_ESP_DETECTION_ROOT = '/Users/fabianbosch/Documents/GitHub/esp-detection';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hostValYamlContent(runDir) {
  // Absolute path — Ultralytics resolves relative path against process cwd, not yaml location.
  const abs = path.resolve(runDir);
  return [
    '# Taubenschießer Host Val (YOLO)',
    `path: ${abs}`,
    'train: images/val',
    'val: images/val',
    'names:',
    '  0: bird',
    ''
  ].join('\n');
}

async function loadImageBuffer(url) {
  const local = decodeImageBuffer(url);
  if (local) return local;
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 40 * 1024 * 1024
    });
    return Buffer.from(response.data);
  }
  return null;
}

async function listValCandidates(userId, valRatio, limit) {
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
  const capped = Math.max(1, Math.min(Number(limit) || 50, 200));
  return val.slice(0, capped);
}

/**
 * Prefer frozen Val from NAS export ZIP (same ZIP the model was trained on).
 * Falls back to live DB temporal split when no ZIP is linked.
 * @returns {{ runDir: string, dataYaml: string, written: number, skipped: number, errors: number, source: string, cleanup: boolean }}
 */
async function materializeHostValSet(userId, state) {
  const zipPath = state.datasetZipPath
    || (state.datasetStem ? findDatasetZip(state.datasetStem)?.path : null);

  if (zipPath) {
    state.message = 'Frozen Val von NAS-ZIP…';
    state.total = 1;
    state.processed = 0;
    const frozen = ensureFrozenValFromZip(zipPath);
    state.processed = 1;
    state.message = frozen.fromCache
      ? `Frozen Val (Cache): ${frozen.written} Bilder`
      : `Frozen Val extrahiert: ${frozen.written} Bilder`;
    return {
      runDir: frozen.runDir,
      dataYaml: frozen.dataYaml,
      written: frozen.written,
      skipped: 0,
      errors: 0,
      source: frozen.fromCache ? 'nas-zip-cache' : 'nas-zip',
      datasetStem: frozen.stem,
      cleanup: false
    };
  }

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = path.join(HOST_VAL_ROOT, runId);
  const imagesDir = path.join(runDir, 'images', 'val');
  const labelsDir = path.join(runDir, 'labels', 'val');
  ensureDir(imagesDir);
  ensureDir(labelsDir);

  state.message = 'Val-Kandidaten laden';
  const samples = await listValCandidates(userId, state.valRatio, state.limit);
  state.total = samples.length;
  state.processed = 0;

  if (!samples.length) {
    const err = new Error('Keine Val-Bilder für Host-Val (Export-Split leer)');
    err.code = 'EMPTY_VAL';
    throw err;
  }

  let written = 0;
  let skipped = 0;
  let errors = 0;

  state.message = 'Val-Set materialisieren';
  for (const sample of samples) {
    if (state.stopRequested) break;
    state.processed += 1;
    try {
      const doc = await Detection.findById(sample.id)
        .select(
          'processedAt classification_status birds target_bird image_info '
          + 'image.url zoomed_image.url tapo_image.url tapo_zoomed_image.url '
          + 'raspberry_pi_image.url raspberry_pi_zoomed_image.url'
        )
        .lean();
      if (!doc) {
        skipped += 1;
        continue;
      }
      const classified = classifyExportDoc(doc);
      if (classified.kind === 'skip') {
        skipped += 1;
        continue;
      }
      const picked = pickImageUrl(doc);
      if (!picked) {
        skipped += 1;
        continue;
      }
      const buffer = await loadImageBuffer(picked.url);
      if (!buffer || buffer.length < 100) {
        skipped += 1;
        continue;
      }
      const size = resolveImageSize(doc, buffer);
      if (!size?.width || !size?.height) {
        skipped += 1;
        continue;
      }
      const labelText = labelsFromBoxes(classified.boxes, size.width, size.height);
      if (classified.kind === 'positive' && !labelText.trim()) {
        skipped += 1;
        continue;
      }
      const ext = imageExtension(buffer, picked.url);
      const base = String(doc._id);
      fs.writeFileSync(path.join(imagesDir, `${base}.${ext}`), buffer);
      fs.writeFileSync(path.join(labelsDir, `${base}.txt`), labelText);
      written += 1;
    } catch (err) {
      errors += 1;
      logger.error(`Host val materialize ${sample.id}: ${err.message}`);
    }
  }

  if (state.stopRequested) {
    const err = new Error('Host-Val gestoppt');
    err.code = 'STOPPED';
    throw err;
  }

  if (written === 0) {
    const err = new Error('Keine Val-Bilder geschrieben (alle übersprungen oder Fehler)');
    err.code = 'EMPTY_VAL';
    throw err;
  }

  const dataYaml = path.join(runDir, 'data.yaml');
  fs.writeFileSync(dataYaml, hostValYamlContent(runDir), 'utf8');

  return {
    runDir,
    dataYaml,
    written,
    skipped,
    errors,
    source: 'db-live',
    datasetStem: null,
    cleanup: true
  };
}

function cleanupHostValDir(runDir) {
  if (!runDir) return;
  try {
    const resolved = path.resolve(runDir);
    if (!resolved.startsWith(path.resolve(HOST_VAL_ROOT))) return;
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`Host val cleanup failed: ${err.message}`);
  }
}

function resolveUltralyticsPython() {
  const fromEnv = process.env.ULTRALYTICS_PYTHON || process.env.HOST_VAL_PYTHON;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    const candidate = fromEnv.trim();
    if (fs.existsSync(candidate)) return candidate;
    return candidate; // may be on PATH; spawn will fail clearly
  }
  if (fs.existsSync(DEFAULT_VENV_PYTHON)) return DEFAULT_VENV_PYTHON;
  return 'python3';
}

function resolveEspDetectionRoot() {
  const fromEnv = process.env.ESP_DETECTION_ROOT;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    const candidate = path.resolve(fromEnv.trim());
    if (fs.existsSync(path.join(candidate, 'nn'))) return candidate;
  }
  if (fs.existsSync(path.join(DEFAULT_ESP_DETECTION_ROOT, 'nn'))) {
    return DEFAULT_ESP_DETECTION_ROOT;
  }
  return null;
}

module.exports = {
  HOST_VAL_ROOT,
  DEFAULT_VENV_PYTHON,
  DEFAULT_ESP_DETECTION_ROOT,
  materializeHostValSet,
  cleanupHostValDir,
  resolveUltralyticsPython,
  resolveEspDetectionRoot,
  listValCandidates
};
