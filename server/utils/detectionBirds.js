/**
 * Birds are the labeled objects in a detection (bird and pigeon are the same).
 * model_runs is an append-only list of model passes. The live pass uses run_id "live".
 * detections[] stays the live-run projection; each bird box gets a bird_id.
 * classification_status stays a mirror of the main bird's review.
 */

const LIVE_RUN_ID = 'live';

const BIRD_CLASSES = new Set([
  'bird',
  'birds',
  'vogel',
  'vögel',
  'voegel',
  'pigeon',
  'taube',
  'dove'
]);

const CAMERA_SOURCES = new Set([
  'tapo',
  'raspberry-pi',
  'local',
  'both',
  'unknown',
  'direct'
]);

const REVIEW_STATUSES = new Set(['confirmed_pigeon', 'no_pigeon']);

function plain(value) {
  if (value && typeof value.toObject === 'function') return value.toObject();
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isBirdClass(className) {
  if (className == null || className === '') return true;
  return BIRD_CLASSES.has(String(className).toLowerCase());
}

function cameraSourceOf(det, fallback) {
  const value = det?.camera_source || fallback;
  return CAMERA_SOURCES.has(value) ? value : (CAMERA_SOURCES.has(fallback) ? fallback : 'unknown');
}

function copyBbox(bbox) {
  if (!bbox || (bbox.x == null && bbox.width == null)) return undefined;
  return {
    x: num(bbox.x),
    y: num(bbox.y),
    width: num(bbox.width),
    height: num(bbox.height)
  };
}

function copyPosition(position) {
  if (!position || (position.center_x == null && position.width == null)) return undefined;
  return {
    center_x: num(position.center_x),
    center_y: num(position.center_y),
    width: num(position.width),
    height: num(position.height)
  };
}

function bboxFrom(det) {
  const bbox = copyBbox(det?.bbox);
  if (bbox) return bbox;
  const position = copyPosition(det?.position);
  if (!position) return undefined;
  return {
    x: position.center_x - position.width / 2,
    y: position.center_y - position.height / 2,
    width: position.width,
    height: position.height
  };
}

function sameBird(a, b) {
  if (!a || !b) return false;
  const aBox = copyBbox(a.bbox);
  const bBox = copyBbox(b.bbox);
  if (aBox && bBox && aBox.x != null && bBox.x != null) {
    return aBox.x === bBox.x && aBox.y === bBox.y;
  }
  const aPos = copyPosition(a.position);
  const bPos = copyPosition(b.position);
  if (aPos && bPos && aPos.center_x != null && bPos.center_x != null) {
    return aPos.center_x === bPos.center_x && aPos.center_y === bPos.center_y;
  }
  return false;
}

function emptyReview() {
  return { status: null, source: null, at: null };
}

function reviewFromDocument(doc) {
  const status = REVIEW_STATUSES.has(doc?.classification_status) ? doc.classification_status : null;
  if (!status) return emptyReview();
  return {
    status,
    source: 'tinder',
    at: doc.classifiedAt ? new Date(doc.classifiedAt) : null
  };
}

function hasLiveRun(doc) {
  return Array.isArray(doc?.model_runs) && doc.model_runs.some((run) => run && run.run_id === LIVE_RUN_ID);
}

function pickMainDetectionIndex(detections, targetBird) {
  if (targetBird) {
    const matched = detections.findIndex((det) => isBirdClass(det.class) && sameBird(det, targetBird));
    if (matched >= 0) return matched;
  }
  let best = -1;
  let bestConfidence = -Infinity;
  detections.forEach((det, index) => {
    if (!isBirdClass(det.class)) return;
    const confidence = num(det.confidence) ?? 0;
    if (confidence >= bestConfidence) {
      best = index;
      bestConfidence = confidence;
    }
  });
  return best;
}

/**
 * Build birds + the live model run from detections[] / target_bird.
 * Does nothing when a live run is already stored.
 * Copies an existing Tinder verdict onto the main bird.
 */
function attachLiveBirdLayer(doc, options = {}) {
  if (!doc || hasLiveRun(doc)) return doc;

  const fallbackCamera = doc.camera_source;
  const detections = Array.isArray(doc.detections) ? doc.detections.map((det) => plain(det)) : [];
  const targetBird = doc.target_bird ? plain(doc.target_bird) : null;
  const mainIndex = pickMainDetectionIndex(detections, targetBird);
  const mainReview = reviewFromDocument(doc);

  const birds = [];
  const boxes = [];
  let birdCount = 0;
  let mainBirdId = null;

  detections.forEach((det, index) => {
    const box = {
      class: det.class || 'bird',
      confidence: num(det.confidence),
      camera_source: cameraSourceOf(det, fallbackCamera)
    };
    const bbox = copyBbox(det.bbox) || bboxFrom(det);
    const position = copyPosition(det.position);
    if (bbox) box.bbox = bbox;
    if (position) box.position = position;

    if (isBirdClass(det.class)) {
      birdCount += 1;
      const birdId = `b${birdCount}`;
      const isMain = index === mainIndex;
      det.bird_id = birdId;
      box.bird_id = birdId;
      birds.push({
        bird_id: birdId,
        role: isMain ? 'main' : 'side',
        camera_source: box.camera_source,
        bbox: bbox || undefined,
        position: position || undefined,
        review: isMain ? mainReview : emptyReview(),
        origin_run_id: LIVE_RUN_ID
      });
      if (isMain) mainBirdId = birdId;
    }
    boxes.push(box);
  });

  if (!mainBirdId && targetBird && isBirdClass(targetBird.class)) {
    birdCount += 1;
    mainBirdId = `b${birdCount}`;
    const bbox = copyBbox(targetBird.bbox) || bboxFrom(targetBird);
    const position = copyPosition(targetBird.position);
    birds.unshift({
      bird_id: mainBirdId,
      role: 'main',
      camera_source: cameraSourceOf(targetBird, fallbackCamera),
      bbox,
      position,
      review: mainReview,
      origin_run_id: LIVE_RUN_ID
    });
    boxes.unshift({
      bird_id: mainBirdId,
      class: targetBird.class || 'bird',
      confidence: num(targetBird.confidence),
      camera_source: cameraSourceOf(targetBird, fallbackCamera),
      ...(bbox ? { bbox } : {}),
      ...(position ? { position } : {})
    });
  }

  const model = plain(doc.model) || {};
  const run = {
    run_id: LIVE_RUN_ID,
    kind: 'live',
    at: doc.processedAt ? new Date(doc.processedAt) : new Date(),
    image: options.image || 'zoomed_image',
    model: {
      name: model.name || options.modelName || 'YOLO',
      version: model.version || '1.0.0'
    },
    boxes
  };
  if (num(options.confidenceThreshold) != null) {
    run.model.confidence_threshold = num(options.confidenceThreshold);
  }
  if (num(options.iouThreshold) != null) {
    run.model.iou_threshold = num(options.iouThreshold);
  }

  doc.detections = detections;
  doc.birds = birds;
  doc.model_runs = [run, ...(Array.isArray(doc.model_runs) ? doc.model_runs : [])];

  if (mainBirdId) {
    const mainBird = birds.find((bird) => bird.bird_id === mainBirdId);
    const mainBox = boxes.find((box) => box.bird_id === mainBirdId);
    doc.target_bird = {
      ...(targetBird || {}),
      bird_id: mainBirdId,
      class: mainBox?.class || targetBird?.class || 'bird',
      confidence: mainBox?.confidence ?? num(targetBird?.confidence),
      bbox: mainBird?.bbox || copyBbox(targetBird?.bbox),
      position: mainBird?.position || copyPosition(targetBird?.position),
      camera_source: mainBird?.camera_source || cameraSourceOf(targetBird, fallbackCamera),
      is_target_bird: true
    };
  }

  return doc;
}

function positionFromBbox(bbox) {
  return {
    center_x: bbox.x + bbox.width / 2,
    center_y: bbox.y + bbox.height / 2,
    width: bbox.width,
    height: bbox.height
  };
}

function boxArea(bbox) {
  return Math.max(0, bbox.width) * Math.max(0, bbox.height);
}

function iou(a, b) {
  if (!a || !b) return 0;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = iw * ih;
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

function camerasCompatible(a, b) {
  if (!a || !b || a === 'unknown' || b === 'unknown' || a === 'both' || b === 'both') return true;
  return a === b;
}

function nextBirdId(birds) {
  let max = 0;
  (birds || []).forEach((bird) => {
    const match = /^b(\d+)$/.exec(bird?.bird_id || '');
    if (match) max = Math.max(max, Number(match[1]));
  });
  return () => {
    max += 1;
    return `b${max}`;
  };
}

function runExists(doc, modelName) {
  return (doc.model_runs || []).some((run) => run?.model?.name === modelName);
}

/**
 * Append one replay pass. Does not replace the live run or an existing main bird.
 * createsBirds stores unmatched boxes as new birds; otherwise they stay on the run only.
 * Returns { skipped: true } when this model name is already stored.
 */
function appendReplayRun(doc, options = {}) {
  const modelName = options.modelName;
  if (!doc || !modelName) throw new Error('modelName required');
  if (runExists(doc, modelName)) return { doc, skipped: true, created: 0 };

  if (!hasLiveRun(doc) && ((Array.isArray(doc.detections) && doc.detections.length) || doc.target_bird)) {
    attachLiveBirdLayer(doc);
  }
  if (!Array.isArray(doc.birds)) doc.birds = [];
  if (!Array.isArray(doc.model_runs)) doc.model_runs = [];

  const matchIou = num(options.matchIou) ?? 0.5;
  const createsBirds = options.createsBirds === true;
  const runId = options.runId || `replay-${modelName}`;
  const sorted = (Array.isArray(options.boxes) ? options.boxes : [])
    .map((box) => plain(box))
    .filter((box) => isBirdClass(box.class) && copyBbox(box.bbox))
    .sort((a, b) => (num(b.confidence) ?? 0) - (num(a.confidence) ?? 0));

  const used = new Set();
  const runBoxes = [];
  const created = [];
  const allocateId = nextBirdId(doc.birds);

  sorted.forEach((box) => {
    const bbox = copyBbox(box.bbox);
    const camera = cameraSourceOf(box, 'unknown');
    let best = null;
    let bestIou = 0;
    doc.birds.forEach((bird) => {
      if (used.has(bird.bird_id)) return;
      if (!camerasCompatible(camera, bird.camera_source)) return;
      const birdBox = copyBbox(bird.bbox) || bboxFrom(bird);
      const score = iou(bbox, birdBox);
      if (score > bestIou) {
        bestIou = score;
        best = bird;
      }
    });

    const runBox = {
      class: 'bird',
      confidence: num(box.confidence),
      bbox,
      position: positionFromBbox(bbox),
      camera_source: camera
    };

    if (best && bestIou >= matchIou) {
      used.add(best.bird_id);
      runBox.bird_id = best.bird_id;
      runBox.iou_to_bird = Math.round(bestIou * 1000) / 1000;
    } else if (createsBirds) {
      const birdId = allocateId();
      const bird = {
        bird_id: birdId,
        role: 'side',
        camera_source: camera,
        bbox,
        position: runBox.position,
        review: emptyReview(),
        origin_run_id: runId
      };
      doc.birds.push(bird);
      created.push(bird);
      runBox.bird_id = birdId;
    }
    runBoxes.push(runBox);
  });

  if (createsBirds && created.length && !doc.birds.some((bird) => bird.role === 'main')) {
    const confidenceOf = (bird) => num(runBoxes.find((box) => box.bird_id === bird.bird_id)?.confidence) ?? 0;
    const main = created.reduce((best, bird) => (confidenceOf(bird) > confidenceOf(best) ? bird : best));
    main.role = 'main';
    if (!doc.target_bird) {
      const box = runBoxes.find((entry) => entry.bird_id === main.bird_id);
      doc.target_bird = {
        bird_id: main.bird_id,
        class: 'bird',
        confidence: box?.confidence,
        bbox: main.bbox,
        position: main.position,
        camera_source: main.camera_source,
        is_target_bird: true
      };
    }
  }

  doc.model_runs.push({
    run_id: runId,
    kind: 'replay',
    at: options.at ? new Date(options.at) : new Date(),
    image: options.image || 'zoomed_image',
    model: {
      name: modelName,
      version: options.modelVersion || '1.0.0',
      confidence_threshold: num(options.confidenceThreshold) ?? 0.25,
      iou_threshold: num(options.iouThreshold) ?? 0.45
    },
    boxes: runBoxes
  });

  if (typeof doc.markModified === 'function') {
    doc.markModified('birds');
    doc.markModified('model_runs');
    doc.markModified('detections');
    doc.markModified('target_bird');
  }
  return { doc, skipped: false, created: created.length };
}

/**
 * Tinder writes the verdict on the main bird and mirrors it to classification_status.
 * Side birds stay untouched. Old documents grow a live run on first classify.
 */
function applyMainReview(doc, { status, source = 'tinder', at = new Date() } = {}) {
  if (!doc) return doc;
  attachLiveBirdLayer(doc);
  const normalized = REVIEW_STATUSES.has(status) ? status : null;
  const when = normalized ? (at ? new Date(at) : new Date()) : null;
  doc.classification_status = normalized;
  doc.classifiedAt = when;

  const main = (doc.birds || []).find((bird) => bird.role === 'main');
  if (main) {
    main.review = {
      status: normalized,
      source: normalized ? source : null,
      at: when
    };
    if (doc.target_bird) doc.target_bird.bird_id = main.bird_id;
  }

  if (typeof doc.markModified === 'function') {
    doc.markModified('birds');
    doc.markModified('model_runs');
    doc.markModified('detections');
    doc.markModified('target_bird');
  }
  return doc;
}

/**
 * Review a single side bird. Does not change classification_status / main.
 */
function applySideReview(doc, { birdId, status, source = 'side-review', at = new Date() } = {}) {
  if (!doc || !birdId) return null;
  attachLiveBirdLayer(doc);
  const bird = (doc.birds || []).find((entry) => entry.role === 'side' && entry.bird_id === birdId);
  if (!bird) return null;
  const normalized = REVIEW_STATUSES.has(status) ? status : null;
  const when = normalized ? (at ? new Date(at) : new Date()) : null;
  bird.review = {
    status: normalized,
    source: normalized ? source : null,
    at: when
  };
  if (typeof doc.markModified === 'function') {
    doc.markModified('birds');
  }
  return bird;
}

/**
 * Accept a replay box without bird_id as a new side bird, or reject it via box.review.
 * Returns { box, bird, created }.
 */
function applyNewBoxReview(doc, {
  modelName,
  boxIndex,
  action,
  source = 'new-review',
  at = new Date()
} = {}) {
  if (!doc || !modelName || !Number.isInteger(boxIndex) || boxIndex < 0) return null;
  attachLiveBirdLayer(doc);
  if (!Array.isArray(doc.birds)) doc.birds = [];
  const run = (doc.model_runs || []).find((entry) => entry?.model?.name === modelName);
  if (!run || !Array.isArray(run.boxes) || !run.boxes[boxIndex]) return null;
  const box = run.boxes[boxIndex];
  if (box.bird_id) return null;

  const status = action === 'confirm_pigeon' ? 'confirmed_pigeon' : 'no_pigeon';
  const when = at ? new Date(at) : new Date();
  let bird = null;
  let created = false;

  if (status === 'confirmed_pigeon') {
    const allocateId = nextBirdId(doc.birds);
    const birdId = allocateId();
    const bbox = copyBbox(box.bbox) || bboxFrom(box);
    const position = copyPosition(box.position) || (bbox ? positionFromBbox(bbox) : undefined);
    bird = {
      bird_id: birdId,
      role: 'side',
      camera_source: cameraSourceOf(box, 'unknown'),
      bbox: bbox || undefined,
      position,
      review: { status, source, at: when },
      origin_run_id: run.run_id || `replay-${modelName}`
    };
    doc.birds.push(bird);
    box.bird_id = birdId;
    created = true;
  }

  box.review = { status, source, at: when };

  if (typeof doc.markModified === 'function') {
    doc.markModified('birds');
    doc.markModified('model_runs');
  }
  return { box, bird, created, status };
}

/**
 * Undo applyNewBoxReview using a previous snapshot.
 */
function restoreNewBoxReview(doc, {
  modelName,
  boxIndex,
  previous = {}
} = {}) {
  if (!doc || !modelName || !Number.isInteger(boxIndex) || boxIndex < 0) return null;
  attachLiveBirdLayer(doc);
  const run = (doc.model_runs || []).find((entry) => entry?.model?.name === modelName);
  if (!run || !Array.isArray(run.boxes) || !run.boxes[boxIndex]) return null;
  const box = run.boxes[boxIndex];

  const createdBirdId = previous.createdBirdId || null;
  if (createdBirdId && Array.isArray(doc.birds)) {
    doc.birds = doc.birds.filter((bird) => bird.bird_id !== createdBirdId);
  }

  box.bird_id = previous.bird_id || undefined;
  if (previous.bird_id == null || previous.bird_id === '') {
    box.bird_id = undefined;
  }
  const prevReview = previous.boxReview || { status: null, source: null, at: null };
  box.review = {
    status: prevReview.status ?? null,
    source: prevReview.source ?? null,
    at: prevReview.at ? new Date(prevReview.at) : null
  };

  if (typeof doc.markModified === 'function') {
    doc.markModified('birds');
    doc.markModified('model_runs');
  }
  return box;
}

module.exports = {
  LIVE_RUN_ID,
  hasLiveRun,
  attachLiveBirdLayer,
  applyMainReview,
  applySideReview,
  applyNewBoxReview,
  restoreNewBoxReview,
  appendReplayRun,
  sameBird,
  isBirdClass
};
