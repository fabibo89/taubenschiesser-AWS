const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '../../models');
const CATALOG_PATH = path.join(MODELS_DIR, 'catalog.json');

const ROLES = new Set(['live', 'replay', 'esp']);
const RUNTIMES = new Set(['onnx', 'esp-p4']);

function liveOnnxFile() {
  if (process.env.MODEL_PATH) return path.basename(process.env.MODEL_PATH);
  try {
    const envPath = path.join(__dirname, '../../cv-service/.env');
    const line = fs.readFileSync(envPath, 'utf8')
      .split('\n')
      .find((entry) => entry.startsWith('MODEL_PATH='));
    if (line) {
      const value = line.slice('MODEL_PATH='.length).trim().replace(/^['"]|['"]$/g, '');
      if (value) return path.basename(value);
    }
  } catch {
    // cv-service env is optional; the catalog default remains yolo26m.onnx
  }
  return 'yolo26m.onnx';
}

function readCatalog() {
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.models)) {
    throw new Error('models/catalog.json has no models array');
  }
  return parsed;
}

function readVarint(buf, index) {
  let value = 0;
  let shift = 0;
  let i = index;
  while (i < buf.length && shift <= 28) {
    const byte = buf[i];
    i += 1;
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return [value, i];
    shift += 7;
  }
  return null;
}

/** ONNX graph input "images" is NCHW. The shape sits at the end of the file. */
function onnxInputShape(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const tail = Math.min(stat.size, 262144);
  const buf = Buffer.alloc(tail);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, tail, stat.size - tail);
  } finally {
    fs.closeSync(fd);
  }
  const marker = Buffer.from('\n\x06images\x12', 'latin1');
  const at = buf.lastIndexOf(marker);
  if (at < 0) return null;
  const window = buf.subarray(at, Math.min(buf.length, at + 96));
  const dims = [];
  for (let i = 0; i < window.length - 3 && dims.length < 4; i += 1) {
    const len = window[i + 1];
    if (window[i] !== 0x0a || window[i + 2] !== 0x08 || (len !== 2 && len !== 3)) continue;
    const parsed = readVarint(window, i + 3);
    if (!parsed) continue;
    dims.push(parsed[0]);
    i += len;
  }
  if (dims.length < 4) return null;
  return { batch: dims[0], channels: dims[1], height: dims[2], width: dims[3] };
}

function artifactStatus(artifact) {
  const file = path.basename(artifact.file || '');
  const runtime = RUNTIMES.has(artifact.runtime) ? artifact.runtime : 'onnx';
  const full = path.join(MODELS_DIR, file);
  let present = false;
  let bytes = null;
  let input = null;
  if (file) {
    try {
      const stat = fs.statSync(full);
      present = stat.isFile();
      bytes = stat.size;
      if (present && runtime === 'onnx') input = onnxInputShape(full);
    } catch {
      present = false;
    }
  }
  return { runtime, file, present, bytes, input };
}

function presentModel(model, liveFile) {
  const artifacts = (model.artifacts || []).map(artifactStatus);
  return {
    id: model.id,
    name: model.name,
    role: ROLES.has(model.role) ? model.role : 'replay',
    artifacts,
    tests: Array.isArray(model.tests) ? model.tests : [],
    isLiveFile: artifacts.some((artifact) => artifact.runtime === 'onnx' && artifact.file === liveFile)
  };
}

function listModels() {
  const liveFile = liveOnnxFile();
  return readCatalog().models.map((model) => presentModel(model, liveFile));
}

function getModel(id) {
  return listModels().find((model) => model.id === id) || null;
}

function onnxPath(model) {
  const artifact = (model?.artifacts || []).find((entry) => entry.runtime === 'onnx' && entry.present);
  if (!artifact) return null;
  return path.join(MODELS_DIR, artifact.file);
}

module.exports = {
  listModels,
  getModel,
  onnxPath
};
