/**
 * Persist Host-Val (and later ESP) results next to NAS model runs:
 *   result/<runName>/benchmarks/host-val-<iso>.json
 *   result/<runName>/benchmarks/latest.json
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { trainingRoot, isMounted } = require('./nasTraining');

function safeRunName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return null;
  }
  return trimmed;
}

function resultRunDir(runName) {
  const safe = safeRunName(runName);
  if (!safe || !isMounted()) return null;
  const dir = path.join(trainingRoot(), 'result', safe);
  const root = path.join(trainingRoot(), 'result');
  if (!dir.startsWith(root)) return null;
  return fs.existsSync(dir) ? dir : null;
}

/** Like resultRunDir, but creates result/<run>/ if missing (for saving benchmarks). */
function ensureResultRunDir(runName) {
  const safe = safeRunName(runName);
  if (!safe || !isMounted()) return null;
  const root = path.join(trainingRoot(), 'result');
  const dir = path.join(root, safe);
  if (!dir.startsWith(root)) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (err) {
    logger.warn(`result/${safe} anlegen fehlgeschlagen: ${err.message}`);
    return null;
  }
}

function benchmarksDir(runName) {
  const runDir = resultRunDir(runName);
  if (!runDir) return null;
  return path.join(runDir, 'benchmarks');
}

function resolveRunNameFromWeights(weightsPath, baseline) {
  if (baseline?.runName) return safeRunName(baseline.runName);
  if (!weightsPath) return null;
  try {
    const resultRoot = path.join(trainingRoot(), 'result');
    const resolved = path.resolve(weightsPath);
    if (!resolved.startsWith(resultRoot + path.sep) && resolved !== resultRoot) {
      return null;
    }
    const rel = path.relative(resultRoot, resolved);
    const top = rel.split(path.sep)[0];
    return safeRunName(top);
  } catch {
    return null;
  }
}

/**
 * @returns {{ saved: boolean, path?: string, latestPath?: string, runName?: string, error?: string }}
 */
function saveHostValResult({
  runName,
  userId,
  result,
  startedAt,
  finishedAt
}) {
  const safe = safeRunName(runName);
  if (!safe) {
    return { saved: false, error: 'Kein result/-Ordner (runName fehlt)' };
  }
  if (!isMounted()) {
    return { saved: false, error: 'Training-Root nicht erreichbar' };
  }
  const runDir = ensureResultRunDir(safe);
  if (!runDir) {
    return { saved: false, error: `result/${safe} konnte nicht angelegt werden` };
  }

  const dir = path.join(runDir, 'benchmarks');
  fs.mkdirSync(dir, { recursive: true });

  const ts = (finishedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  const fileName = `host-val-${ts}.json`;
  const filePath = path.join(dir, fileName);
  const latestPath = path.join(dir, 'latest.json');

  const payload = {
    kind: 'host-val',
    version: 1,
    runName: safe,
    userId: userId ? String(userId) : null,
    startedAt: startedAt || null,
    finishedAt: finishedAt || new Date().toISOString(),
    savedAt: new Date().toISOString(),
    datasetStem: result?.datasetStem || null,
    weightsPath: result?.weightsPath || null,
    weightsName: result?.weightsName || null,
    baselineId: result?.baselineId || null,
    baselineLabel: result?.baselineLabel || null,
    imgsz: result?.imgsz ?? null,
    valSource: result?.valSource || null,
    metrics: {
      map50: result?.map50 ?? null,
      map50_95: result?.map50_95 ?? null,
      precision: result?.precision ?? null,
      recall: result?.recall ?? null,
      fitness: result?.fitness ?? null,
      valImages: result?.valImages ?? null,
      durationMs: result?.durationMs ?? null,
      speedMsPerImg: result?.speedMsPerImg ?? null
    },
    note: result?.note || null
  };

  try {
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    fs.writeFileSync(filePath, json, 'utf8');
    fs.writeFileSync(latestPath, json, 'utf8');
    logger.info(`Host-Val gespeichert: ${filePath}`);
    return {
      saved: true,
      path: filePath,
      latestPath,
      runName: safe,
      relativePath: path.join('result', safe, 'benchmarks', fileName)
    };
  } catch (err) {
    logger.error(`Host-Val speichern fehlgeschlagen: ${err.message}`);
    return { saved: false, error: err.message };
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveEspBenchResult({
  userId,
  runName,
  result,
  startedAt,
  finishedAt
} = {}) {
  const safe = safeRunName(runName);
  if (!safe) {
    return { saved: false, error: 'Kein runName' };
  }
  if (!isMounted()) {
    return { saved: false, error: 'Training-Root nicht erreichbar' };
  }
  const runDir = ensureResultRunDir(safe);
  if (!runDir) {
    return { saved: false, error: `result/${safe} konnte nicht angelegt werden` };
  }

  const dir = path.join(runDir, 'benchmarks');
  fs.mkdirSync(dir, { recursive: true });

  const ts = (finishedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  const fileName = `esp-bench-${ts}.json`;
  const filePath = path.join(dir, fileName);
  const latestPath = path.join(dir, 'esp-latest.json');

  const payload = {
    kind: 'esp-bench',
    version: 1,
    runName: safe,
    userId: userId ? String(userId) : null,
    startedAt: startedAt || null,
    finishedAt: finishedAt || new Date().toISOString(),
    savedAt: new Date().toISOString(),
    datasetStem: result?.datasetStem || null,
    valSource: result?.valSource || null,
    target: result?.target || null,
    metrics: {
      map50: result?.map50 ?? null,
      map50_95: result?.map50_95 ?? null,
      precision: result?.precision ?? null,
      recall: result?.recall ?? null,
      tp: result?.tp ?? null,
      fp: result?.fp ?? null,
      fn: result?.fn ?? null,
      iouThr: result?.iouThr ?? 0.5,
      valImages: result?.valImages ?? result?.ok ?? null,
      avgLatencyMs: result?.avgLatencyMs ?? null,
      avgInferenceMs: result?.avgInferenceMs ?? null,
      gtBirds: result?.gtBirds ?? null,
      predBirds: result?.predBirds ?? null,
      imagesBoth: result?.imagesBoth ?? null,
      imagesWithGt: result?.imagesWithGt ?? null,
      ok: result?.ok ?? null,
      errors: result?.errors ?? null,
      skipped: result?.skipped ?? null
    },
    note: result?.note || null
  };

  try {
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    fs.writeFileSync(filePath, json, 'utf8');
    fs.writeFileSync(latestPath, json, 'utf8');
    logger.info(`ESP-Bench gespeichert: ${filePath}`);
    return {
      saved: true,
      path: filePath,
      latestPath,
      runName: safe,
      relativePath: path.join('result', safe, 'benchmarks', fileName)
    };
  } catch (err) {
    logger.error(`ESP-Bench speichern fehlgeschlagen: ${err.message}`);
    return { saved: false, error: err.message };
  }
}

function getLatestHostVal(runName) {
  const dir = benchmarksDir(runName);
  if (!dir) return null;
  const latest = path.join(dir, 'latest.json');
  if (!fs.existsSync(latest)) return null;
  const data = readJsonSafe(latest);
  if (!data) return null;
  return { ...data, path: latest };
}

function listHostValHistory(runName, { limit = 10 } = {}) {
  const dir = benchmarksDir(runName);
  if (!dir || !fs.existsSync(dir)) return [];
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter((f) => /^host-val-.*\.json$/i.test(f))
      .sort()
      .reverse();
  } catch {
    return [];
  }
  const capped = Math.max(1, Math.min(Number(limit) || 10, 50));
  return files.slice(0, capped).map((file) => {
    const full = path.join(dir, file);
    const data = readJsonSafe(full) || {};
    return {
      file,
      path: full,
      relativePath: path.join('result', safeRunName(runName) || '', 'benchmarks', file),
      finishedAt: data.finishedAt || null,
      datasetStem: data.datasetStem || null,
      imgsz: data.imgsz ?? null,
      map50: data.metrics?.map50 ?? null,
      map50_95: data.metrics?.map50_95 ?? null,
      precision: data.metrics?.precision ?? null,
      recall: data.metrics?.recall ?? null,
      valImages: data.metrics?.valImages ?? null,
      valSource: data.valSource || null
    };
  });
}

function safeBenchmarkFile(file) {
  if (!file || typeof file !== 'string') return null;
  const base = path.basename(file);
  if (!/^host-val-[\w.\-]+\.json$/i.test(base) && base !== 'latest.json') return null;
  return base;
}

/** Full saved host-val JSON shaped for the Benchmark UI. */
function getHostValDetail(runName, file) {
  const safe = safeRunName(runName);
  const safeFile = safeBenchmarkFile(file);
  if (!safe || !safeFile) return null;
  const dir = benchmarksDir(safe);
  if (!dir) return null;
  const full = path.join(dir, safeFile);
  if (!full.startsWith(dir) || !fs.existsSync(full)) return null;
  const data = readJsonSafe(full);
  if (!data) return null;
  const relativePath = path.join('result', safe, 'benchmarks', safeFile);
  const m = data.metrics || {};
  return {
    mode: 'host',
    ready: true,
    fromHistory: true,
    map50: m.map50 ?? null,
    map50_95: m.map50_95 ?? null,
    precision: m.precision ?? null,
    recall: m.recall ?? null,
    fitness: m.fitness ?? null,
    valImages: m.valImages ?? null,
    durationMs: m.durationMs ?? null,
    speedMsPerImg: m.speedMsPerImg ?? null,
    imgsz: data.imgsz ?? null,
    weightsName: data.weightsName || null,
    baselineId: data.baselineId || null,
    baselineLabel: data.baselineLabel || null,
    weightsPath: data.weightsPath || null,
    valSource: data.valSource || null,
    datasetStem: data.datasetStem || null,
    note: data.note || null,
    saved: true,
    savedPath: relativePath,
    finishedAt: data.finishedAt || null,
    runName: data.runName || safe,
    historyFile: safeFile
  };
}

module.exports = {
  resolveRunNameFromWeights,
  saveHostValResult,
  saveEspBenchResult,
  getLatestHostVal,
  listHostValHistory,
  getHostValDetail,
  benchmarksDir
};
