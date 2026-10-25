/**
 * Training artifacts: prefer NAS mount, fall back to local offline tree.
 * Layout (same under NAS_TRAINING_ROOT or LOCAL_TRAINING_ROOT):
 *   Trainingsdata/*.zip
 *   result/<run>/espdet_bird_{imgsz}_best.pt
 * Frozen val cache (always local, fast for Host-Val):
 *   server/exports/frozen-val/<zip-stem>/{images,labels}/val + data.yaml
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const logger = require('./logger');

const DEFAULT_NAS_TRAINING_ROOT = '/Volumes/photo/Uploads/GoogleDrive/taubentraining';
const DEFAULT_LOCAL_TRAINING_ROOT = path.join(
  process.env.HOME || '',
  'Documents',
  'Taubenschießer'
);
const FROZEN_VAL_ROOT = path.join(__dirname, '../exports/frozen-val');

function envPath(name, fallback) {
  const raw = process.env[name];
  if (raw && String(raw).trim()) return path.resolve(String(raw).trim());
  if (fallback && String(fallback).trim()) return path.resolve(String(fallback).trim());
  return null;
}

function dirExists(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Canonical NAS training tree (may be offline). */
function nasTrainingRoot() {
  return envPath('NAS_TRAINING_ROOT', DEFAULT_NAS_TRAINING_ROOT);
}

/** Offline / laptop copy when NAS is unavailable. */
function localTrainingRoot() {
  return envPath('LOCAL_TRAINING_ROOT', DEFAULT_LOCAL_TRAINING_ROOT);
}

/**
 * Active working root: NAS if present, else LOCAL_TRAINING_ROOT.
 */
function trainingRoot() {
  const nas = nasTrainingRoot();
  if (dirExists(nas)) return nas;
  const local = localTrainingRoot();
  if (dirExists(local)) return local;
  // Prefer NAS path for error messages / mkdir attempts when neither exists yet.
  return nas || local || DEFAULT_NAS_TRAINING_ROOT;
}

function trainingSource() {
  const nas = nasTrainingRoot();
  if (dirExists(nas)) return 'nas';
  if (dirExists(localTrainingRoot())) return 'local';
  return 'none';
}

/** True when an active training root (NAS or local) is usable. */
function isMounted() {
  return trainingSource() !== 'none';
}

function status() {
  const source = trainingSource();
  const root = trainingRoot();
  const mounted = source !== 'none';
  let datasets = 0;
  let results = 0;
  if (mounted) {
    try {
      datasets = listDatasetZips().length;
      results = listResultRuns().length;
    } catch {
      /* ignore */
    }
  }
  return {
    mounted,
    source,
    root,
    nasRoot: nasTrainingRoot(),
    localRoot: localTrainingRoot(),
    nasAvailable: dirExists(nasTrainingRoot()),
    localAvailable: dirExists(localTrainingRoot()),
    mountRoot: envPath('NAS_MOUNT_ROOT', '/Volumes/photo'),
    smbUrl: process.env.NAS_SMB_URL || 'smb://fabian@NAS._smb._tcp.local/photo',
    datasets,
    results
  };
}

function listDatasetZips() {
  const dir = path.join(trainingRoot(), 'Trainingsdata');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.zip'))
    .map((name) => {
      const full = path.join(dir, name);
      let bytes = null;
      try {
        bytes = fs.statSync(full).size;
      } catch {
        bytes = null;
      }
      return {
        stem: name.replace(/\.zip$/i, ''),
        file: name,
        path: full,
        bytes
      };
    })
    .sort((a, b) => String(b.file).localeCompare(String(a.file)));
}

function findDatasetZip(stemOrFile) {
  if (!stemOrFile) return null;
  const needle = String(stemOrFile).replace(/\.zip$/i, '');
  return listDatasetZips().find((z) => z.stem === needle) || null;
}

function parseImgszFromWeight(fileName) {
  const m = String(fileName).match(/espdet_bird_(\d+)_/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Scan result/<run>/ for espdet_bird_*_best.pt
 */
function listResultRuns() {
  const resultRoot = path.join(trainingRoot(), 'result');
  if (!fs.existsSync(resultRoot)) return [];
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(resultRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  for (const dirent of dirs) {
    const runDir = path.join(resultRoot, dirent.name);
    let files;
    try {
      files = fs.readdirSync(runDir);
    } catch {
      continue;
    }
    const best = files.find((f) => /^espdet_bird_\d+_best\.pt$/i.test(f))
      || files.find((f) => f === 'best.pt');
    if (!best) continue;
    const bestPath = path.join(runDir, best);
    const imgsz = parseImgszFromWeight(best) || 640;
    const lastName = best.replace(/_best\.pt$/i, '_last.pt');
    const lastPath = path.join(runDir, lastName);
    const zip = findDatasetZip(dirent.name);
    let bytes = null;
    try {
      bytes = fs.statSync(bestPath).size;
    } catch {
      bytes = null;
    }
    out.push({
      id: `nas-${dirent.name}`,
      label: `NAS · ${dirent.name} @${imgsz}`,
      runName: dirent.name,
      imgsz,
      architecture: 'espdet_pico',
      className: 'bird',
      source: 'NAS result/',
      nasPath: bestPath,
      path: bestPath,
      file: best,
      lastFile: fs.existsSync(lastPath) ? lastName : null,
      lastPresent: fs.existsSync(lastPath),
      present: true,
      bytes,
      datasetStem: zip ? zip.stem : dirent.name,
      datasetZip: zip ? zip.path : null,
      hasFrozenDataset: Boolean(zip)
    });
  }
  return out.sort((a, b) => String(b.runName).localeCompare(String(a.runName)));
}

function frozenValDir(stem) {
  return path.join(FROZEN_VAL_ROOT, stem);
}

function frozenValReady(stem) {
  const dir = frozenValDir(stem);
  const yaml = path.join(dir, 'data.yaml');
  const images = path.join(dir, 'images', 'val');
  return fs.existsSync(yaml) && fs.existsSync(images);
}

function writeFrozenYaml(runDir) {
  const abs = path.resolve(runDir);
  return [
    '# Taubenschießer Frozen Val (from NAS export ZIP)',
    `path: ${abs}`,
    'train: images/val',
    'val: images/val',
    'names:',
    '  0: bird',
    ''
  ].join('\n');
}

/**
 * Extract only val/images + val/labels from a YOLO export ZIP into local cache.
 * Returns { runDir, dataYaml, written, fromCache }.
 */
function ensureFrozenValFromZip(zipPath, { force = false } = {}) {
  if (!zipPath || !fs.existsSync(zipPath)) {
    const err = new Error(`Dataset-ZIP nicht gefunden: ${zipPath || '(leer)'}`);
    err.statusCode = 404;
    throw err;
  }
  const stem = path.basename(zipPath, path.extname(zipPath));
  const runDir = frozenValDir(stem);
  const dataYaml = path.join(runDir, 'data.yaml');
  const imagesDir = path.join(runDir, 'images', 'val');
  const labelsDir = path.join(runDir, 'labels', 'val');

  if (!force && frozenValReady(stem)) {
    const written = fs.readdirSync(imagesDir).length;
    return { runDir, dataYaml, written, fromCache: true, stem };
  }

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(labelsDir, { recursive: true });

  // Prefer unzip (handles nested zip layouts); falls back to throwing clearly.
  const tmp = path.join(runDir, '_extract');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  try {
    execFileSync('unzip', ['-q', '-o', zipPath, 'val/*', '*/val/*', '-d', tmp], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (err) {
    // unzip returns 11 if some patterns missing — check if we got files
    const msg = err.stderr ? String(err.stderr) : err.message;
    logger.warn(`unzip val from ${zipPath}: ${msg}`);
  }

  function findValRoot(base) {
    const direct = path.join(base, 'val');
    if (fs.existsSync(path.join(direct, 'images'))) return direct;
    let kids;
    try {
      kids = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      return null;
    }
    for (const kid of kids) {
      const nested = path.join(base, kid.name, 'val');
      if (fs.existsSync(path.join(nested, 'images'))) return nested;
      const deeper = findValRoot(path.join(base, kid.name));
      if (deeper) return deeper;
    }
    return null;
  }

  const valRoot = findValRoot(tmp);
  if (!valRoot) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`ZIP enthält kein val/images: ${path.basename(zipPath)}`);
  }

  const srcImages = path.join(valRoot, 'images');
  const srcLabels = path.join(valRoot, 'labels');
  fs.rmSync(imagesDir, { recursive: true, force: true });
  fs.rmSync(labelsDir, { recursive: true, force: true });
  fs.cpSync(srcImages, imagesDir, { recursive: true });
  if (fs.existsSync(srcLabels)) {
    fs.cpSync(srcLabels, labelsDir, { recursive: true });
  } else {
    fs.mkdirSync(labelsDir, { recursive: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const written = fs.readdirSync(imagesDir).length;
  fs.writeFileSync(dataYaml, writeFrozenYaml(runDir), 'utf8');
  logger.info(`Frozen val ready: ${stem} (${written} images) ← ${zipPath}`);
  return { runDir, dataYaml, written, fromCache: false, stem };
}

module.exports = {
  trainingRoot,
  nasTrainingRoot,
  localTrainingRoot,
  trainingSource,
  isMounted,
  status,
  listDatasetZips,
  findDatasetZip,
  listResultRuns,
  frozenValDir,
  frozenValReady,
  ensureFrozenValFromZip,
  FROZEN_VAL_ROOT
};
