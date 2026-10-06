const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const Detection = require('../models/Detection');
const logger = require('../utils/logger');
const { getModel, onnxPath } = require('../utils/modelCatalog');
const { appendReplayRun } = require('../utils/detectionBirds');

const PYTHON = fs.existsSync(path.join(__dirname, '../../cv-service/venv/bin/python'))
  ? path.join(__dirname, '../../cv-service/venv/bin/python')
  : 'python3';
const WORKER = path.join(__dirname, '../../cv-service/replay_worker.py');

let current = null;

function cameraSourceOf(doc) {
  const value = doc?.camera_source;
  return ['tapo', 'raspberry-pi', 'local', 'both', 'unknown', 'direct'].includes(value) ? value : 'unknown';
}

function addImage(jobs, doc, field, camera) {
  const url = doc?.[field]?.url;
  if (typeof url !== 'string' || url.length < 32) return false;
  jobs.push({ image: field, camera_source: camera, url });
  return true;
}

/** Zoomed frame the stored boxes belong to. One job per camera when both exist. */
function replayImages(doc) {
  const jobs = [];
  const sources = new Set((doc.detections || []).map((det) => det.camera_source).filter(Boolean));
  if (sources.has('tapo')) {
    addImage(jobs, doc, 'tapo_zoomed_image', 'tapo') || addImage(jobs, doc, 'tapo_image', 'tapo');
  }
  if (sources.has('raspberry-pi')) {
    addImage(jobs, doc, 'raspberry_pi_zoomed_image', 'raspberry-pi')
      || addImage(jobs, doc, 'raspberry_pi_image', 'raspberry-pi');
  }
  if (jobs.length) return jobs;
  const camera = cameraSourceOf(doc);
  if (addImage(jobs, doc, 'zoomed_image', camera)) return jobs;
  if (addImage(jobs, doc, 'tapo_zoomed_image', 'tapo')) return jobs;
  if (addImage(jobs, doc, 'raspberry_pi_zoomed_image', 'raspberry-pi')) return jobs;
  addImage(jobs, doc, 'image', camera);
  return jobs;
}

function publicState(state) {
  if (!state) return { status: 'idle' };
  return {
    status: state.status,
    modelId: state.modelId,
    modelName: state.modelName,
    processed: state.processed,
    updated: state.updated,
    skipped: state.skipped,
    errors: state.errors,
    total: state.total,
    message: state.message || '',
    startedAt: state.startedAt,
    finishedAt: state.finishedAt
  };
}

function getReplayStatus() {
  return publicState(current);
}

function requestReplayStop() {
  if (!current || current.status !== 'running') return publicState(current);
  current.stopRequested = true;
  current.message = 'Stopp angefordert';
  return publicState(current);
}

function startWorker(modelPath) {
  const child = spawn(PYTHON, [WORKER, modelPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const rl = readline.createInterface({ input: child.stdout });
  let pending = null;
  const queue = [];

  const pump = () => {
    if (pending || queue.length === 0) return;
    pending = queue.shift();
    child.stdin.write(`${JSON.stringify({ id: pending.id, image: pending.image })}\n`);
  };

  rl.on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      logger.warn(`Replay worker sent non-JSON: ${line.slice(0, 200)}`);
      return;
    }
    if (msg.ready === true && !pending) {
      child.emit('ready');
      return;
    }
    if (msg.ready === false) {
      child.emit('worker-error', new Error(msg.error || 'worker failed'));
      return;
    }
    if (!pending) return;
    const job = pending;
    pending = null;
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(msg.boxes || []);
    pump();
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) logger.info(`replay-worker: ${text.split('\n')[0]}`);
  });

  child.on('exit', () => {
    const error = new Error('Worker beendet');
    if (pending) pending.reject(error);
    queue.splice(0).forEach((job) => job.reject(error));
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Modell hat nicht rechtzeitig geladen')), 120000);
    const fail = (err) => {
      clearTimeout(timer);
      reject(err);
    };
    child.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('worker-error', fail);
    child.once('exit', (code) => fail(new Error(`Worker beendet (code ${code})`)));
  });

  return {
    child,
    ready,
    detect(image) {
      return new Promise((resolve, reject) => {
        queue.push({ id: `${Date.now()}-${queue.length}`, image, resolve, reject });
        pump();
      });
    },
    stop() {
      try {
        child.stdin.write(`${JSON.stringify({ cmd: 'stop' })}\n`);
        child.stdin.end();
      } catch (err) {
        child.kill();
      }
    }
  };
}

async function runReplay(modelId, state) {
  const model = getModel(modelId);
  if (!model) throw new Error('Modell nicht gefunden');
  const modelFile = onnxPath(model);
  if (!modelFile) throw new Error('ONNX-Datei fehlt');

  state.modelId = model.id;
  state.modelName = model.name;
  state.status = 'running';
  state.processed = 0;
  state.updated = 0;
  state.skipped = 0;
  state.errors = 0;
  state.message = 'Modell wird geladen';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.stopRequested = false;

  const filter = {
    model_runs: { $not: { $elemMatch: { 'model.name': model.name } } }
  };
  state.total = await Detection.countDocuments(filter);
  const worker = startWorker(modelFile);
  try {
    await worker.ready;
    state.message = 'Lauf läuft';
    const cursor = Detection.find(filter)
      .select('detections birds model_runs target_bird camera_source processedAt classification_status classifiedAt model image.url zoomed_image.url tapo_image.url tapo_zoomed_image.url raspberry_pi_image.url raspberry_pi_zoomed_image.url')
      .lean()
      .cursor({ batchSize: 1 });

    for await (const doc of cursor) {
      if (state.stopRequested) break;
      state.processed += 1;
      const images = replayImages(doc);
      if (!images.length) {
        state.skipped += 1;
        continue;
      }
      try {
        const boxes = [];
        for (const image of images) {
          const found = await worker.detect(image.url);
          found.forEach((box) => {
            boxes.push({ ...box, camera_source: image.camera_source });
          });
        }
        const imageField = images.length === 1 ? images[0].image : 'zoomed';
        const result = appendReplayRun(doc, {
          modelName: model.name,
          runId: `replay-${model.id}`,
          createsBirds: state.createsBirds === true,
          boxes,
          image: imageField,
          at: new Date()
        });
        if (result.skipped) {
          state.skipped += 1;
          continue;
        }
        const update = {
          birds: doc.birds || [],
          model_runs: doc.model_runs || [],
          detections: doc.detections || []
        };
        if (doc.target_bird) update.target_bird = doc.target_bird;
        await Detection.updateOne({ _id: doc._id }, { $set: update });
        state.updated += 1;
      } catch (err) {
        state.errors += 1;
        logger.error(`Replay ${model.name} on ${doc._id} failed: ${err.message}`);
      }
    }
    state.status = state.stopRequested ? 'stopped' : 'done';
    state.message = state.stopRequested ? 'Angehalten' : 'Fertig';
  } finally {
    worker.stop();
    state.finishedAt = new Date().toISOString();
  }
  return publicState(state);
}

function startReplay(modelId, options = {}) {
  if (current && current.status === 'running') {
    const err = new Error('Ein Modelllauf läuft bereits');
    err.statusCode = 409;
    throw err;
  }
  const model = getModel(modelId);
  if (!model) {
    const err = new Error('Modell nicht gefunden');
    err.statusCode = 404;
    throw err;
  }
  if (!onnxPath(model)) {
    const err = new Error('ONNX-Datei fehlt');
    err.statusCode = 400;
    throw err;
  }
  current = {
    status: 'running',
    modelId: model.id,
    modelName: model.name,
    createsBirds: options.createsBirds === true,
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    total: null,
    message: 'Startet',
    startedAt: new Date().toISOString(),
    finishedAt: null
  };
  runReplay(modelId, current).catch((err) => {
    logger.error('Replay failed:', err);
    if (current) {
      current.status = 'failed';
      current.message = err.message;
      current.finishedAt = new Date().toISOString();
    }
  });
  return publicState(current);
}

module.exports = {
  replayImages,
  getReplayStatus,
  requestReplayStop,
  startReplay,
  runReplay
};
