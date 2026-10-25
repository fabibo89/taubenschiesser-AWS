/**
 * Known training baselines for Model Create → Benchmark.
 * Prefers NAS (NAS_TRAINING_ROOT/result/…), falls back to local copies
 * under server/exports/benchmark-weights/ (gitignored).
 */

const fs = require('fs');
const path = require('path');
const {
  isMounted,
  listResultRuns,
  findDatasetZip,
  trainingRoot
} = require('./nasTraining');

const WEIGHTS_DIR = path.join(__dirname, '../exports/benchmark-weights');

/** Static catalog — resolved against NAS then local WEIGHTS_DIR. */
const CATALOG = [
  {
    id: 'espdet-bird-224-colab-t4-2026-10-08',
    label: 'ESPDet bird @224 — Colab T4 Baseline (08.10.2026)',
    file: 'espdet_bird_224_baseline_best.pt',
    lastFile: 'espdet_bird_224_baseline_last.pt',
    nasRelativeBest: 'result/colab-t4-baseline-espdet-224/espdet_bird_224_best.pt',
    nasRelativeLast: 'result/colab-t4-baseline-espdet-224/espdet_bird_224_last.pt',
    imgsz: 224,
    architecture: 'espdet_pico',
    className: 'bird',
    source: 'Colab T4 · Baseline',
    drivePath: 'taubentraining/result/colab-t4-baseline-espdet-224/',
    /** Prefer matching export ZIP on NAS Trainingsdata/ when present */
    datasetStemHint: 'yolo-dataset-2026-10-08T17-15-42-759Z'
  }
];

function weightsDir() {
  return WEIGHTS_DIR;
}

function resolveWeightPath(fileName) {
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return null;
  }
  const full = path.join(WEIGHTS_DIR, fileName);
  if (!full.startsWith(WEIGHTS_DIR)) return null;
  return fs.existsSync(full) ? full : null;
}

function resolveNasFile(relativePath) {
  if (!relativePath || !isMounted()) return null;
  const full = path.join(trainingRoot(), relativePath);
  const root = trainingRoot();
  if (!full.startsWith(root)) return null;
  return fs.existsSync(full) ? full : null;
}

function resolveCatalogEntry(entry) {
  const nasBest = resolveNasFile(entry.nasRelativeBest);
  const localBest = resolveWeightPath(entry.file);
  const bestPath = nasBest || localBest;
  const nasLast = resolveNasFile(entry.nasRelativeLast);
  const localLast = entry.lastFile ? resolveWeightPath(entry.lastFile) : null;
  const lastPath = nasLast || localLast;

  let bytes = null;
  if (bestPath) {
    try {
      bytes = fs.statSync(bestPath).size;
    } catch {
      bytes = null;
    }
  }

  const zip = entry.datasetStemHint ? findDatasetZip(entry.datasetStemHint) : null;
  const runName = entry.nasRelativeBest
    ? entry.nasRelativeBest.split('/')[1] || null
    : null;

  return {
    ...entry,
    present: Boolean(bestPath),
    lastPresent: Boolean(lastPath),
    bytes,
    path: bestPath,
    location: nasBest ? 'nas' : localBest ? 'local' : null,
    runName,
    datasetStem: zip ? zip.stem : entry.datasetStemHint || null,
    datasetZip: zip ? zip.path : null,
    hasFrozenDataset: Boolean(zip)
  };
}

function listBaselines() {
  const catalog = CATALOG.map(resolveCatalogEntry);
  const catalogIds = new Set(catalog.map((b) => b.id));
  const catalogNasPaths = new Set(
    catalog.map((b) => b.path).filter(Boolean)
  );

  const fromNas = listResultRuns()
    .filter((run) => !catalogNasPaths.has(run.path))
    .map((run) => ({
      ...run,
      location: 'nas'
    }))
    // avoid dup if static id somehow matches
    .filter((run) => !catalogIds.has(run.id));

  return [...catalog, ...fromNas];
}

function getBaseline(id) {
  return listBaselines().find((b) => b.id === id) || null;
}

module.exports = {
  CATALOG,
  weightsDir,
  resolveWeightPath,
  listBaselines,
  getBaseline
};
