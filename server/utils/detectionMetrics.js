/**
 * Single-class detection metrics (IoU match, P/R, VOC/COCO-style AP).
 * Boxes are compared in normalized xyxy [0,1].
 */

function readJpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 10) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (i + 3 >= buf.length) break;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    if (
      marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc
    ) {
      // SOF: [FF marker][len:2][precision:1][height:2][width:2]…
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    i += 2 + len;
  }
  return null;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function iouXyxy(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const inter = w * h;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const uni = areaA + areaB - inter;
  return uni > 0 ? inter / uni : 0;
}

/** YOLO label text → normalized xyxy boxes. */
function parseYoloLabelText(text) {
  const boxes = [];
  const raw = String(text || '').trim();
  if (!raw) return boxes;
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length < 5 || parts.some((n) => !Number.isFinite(n))) continue;
    const cx = parts[1];
    const cy = parts[2];
    const w = parts[3];
    const h = parts[4];
    if (w <= 0 || h <= 0) continue;
    boxes.push({
      x1: clamp01(cx - w / 2),
      y1: clamp01(cy - h / 2),
      x2: clamp01(cx + w / 2),
      y2: clamp01(cy + h / 2)
    });
  }
  return boxes;
}

function looksNormalizedBbox(bbox) {
  return (
    bbox.width <= 1.5
    && bbox.height <= 1.5
    && bbox.x <= 1.5
    && bbox.y <= 1.5
    && bbox.x >= -0.1
    && bbox.y >= -0.1
  );
}

/** DB-style {x,y,width,height} → normalized xyxy (x/y = top-left). */
function dbBboxesToXyxy(boxes, imgW, imgH) {
  const out = [];
  for (const bbox of boxes || []) {
    if (!bbox) continue;
    let x = Number(bbox.x);
    let y = Number(bbox.y);
    let w = Number(bbox.width);
    let h = Number(bbox.height);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    if (!looksNormalizedBbox({ x, y, width: w, height: h })) {
      if (!imgW || !imgH) continue;
      x /= imgW;
      y /= imgH;
      w /= imgW;
      h /= imgH;
    }
    out.push({
      x1: clamp01(x),
      y1: clamp01(y),
      x2: clamp01(x + w),
      y2: clamp01(y + h)
    });
  }
  return out;
}

/**
 * ESP /detect birds → normalized xyxy + score.
 * Pixel coords if any corner > 1.5, else already normalized.
 */
function espBirdsToXyxy(birds, imgW, imgH) {
  const out = [];
  for (const bird of birds || []) {
    let x1 = Number(bird.x1);
    let y1 = Number(bird.y1);
    let x2 = Number(bird.x2);
    let y2 = Number(bird.y2);
    const score = Number(bird.score);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    const looksPixel = x2 > 1.5 || y2 > 1.5 || x1 > 1.5 || y1 > 1.5;
    if (looksPixel) {
      if (!imgW || !imgH) continue;
      x1 /= imgW;
      x2 /= imgW;
      y1 /= imgH;
      y2 /= imgH;
    }
    out.push({
      x1: clamp01(x1),
      y1: clamp01(y1),
      x2: clamp01(x2),
      y2: clamp01(y2),
      score: Number.isFinite(score) ? score : 0
    });
  }
  return out;
}

/** Area under PR curve (COCO-style monotonic precision). */
function averagePrecision(recalls, precisions) {
  if (!recalls.length) return 0;
  const mrec = [0, ...recalls, 1];
  const mpre = [0, ...precisions, 0];
  for (let i = mpre.length - 2; i >= 0; i -= 1) {
    mpre[i] = Math.max(mpre[i], mpre[i + 1]);
  }
  let ap = 0;
  for (let i = 1; i < mrec.length; i += 1) {
    if (mrec[i] !== mrec[i - 1]) {
      ap += (mrec[i] - mrec[i - 1]) * mpre[i];
    }
  }
  return ap;
}

/**
 * @param {Array<{ gt: Array, preds: Array }>} images
 * @param {number} iouThr
 */
function computeApAtIou(images, iouThr) {
  let nGt = 0;
  const flat = [];
  images.forEach((img, imgIdx) => {
    nGt += (img.gt || []).length;
    (img.preds || []).forEach((p) => {
      flat.push({ ...p, imgIdx });
    });
  });
  if (nGt === 0) {
    return flat.length === 0 ? 1 : 0;
  }
  flat.sort((a, b) => (b.score || 0) - (a.score || 0));
  const matched = images.map((img) => new Array((img.gt || []).length).fill(false));
  const recalls = [];
  const precisions = [];
  let cumTp = 0;
  let cumFp = 0;
  for (const pred of flat) {
    const gts = images[pred.imgIdx].gt || [];
    let bestIou = 0;
    let bestJ = -1;
    for (let j = 0; j < gts.length; j += 1) {
      if (matched[pred.imgIdx][j]) continue;
      const v = iouXyxy(pred, gts[j]);
      if (v > bestIou) {
        bestIou = v;
        bestJ = j;
      }
    }
    if (bestIou >= iouThr && bestJ >= 0) {
      matched[pred.imgIdx][bestJ] = true;
      cumTp += 1;
    } else {
      cumFp += 1;
    }
    recalls.push(cumTp / nGt);
    precisions.push(cumTp / (cumTp + cumFp));
  }
  return averagePrecision(recalls, precisions);
}

/** Greedy per-image match at fixed IoU → micro P/R + TP/FP/FN. */
function operatingPointAtIou(images, iouThr = 0.5) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const img of images) {
    const gts = [...(img.gt || [])];
    const preds = [...(img.preds || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    const used = new Array(gts.length).fill(false);
    for (const pred of preds) {
      let bestIou = 0;
      let bestJ = -1;
      for (let j = 0; j < gts.length; j += 1) {
        if (used[j]) continue;
        const v = iouXyxy(pred, gts[j]);
        if (v > bestIou) {
          bestIou = v;
          bestJ = j;
        }
      }
      if (bestIou >= iouThr && bestJ >= 0) {
        used[bestJ] = true;
        tp += 1;
      } else {
        fp += 1;
      }
    }
    fn += used.filter((u) => !u).length;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  return { tp, fp, fn, precision, recall };
}

/**
 * @param {Array<{ gt: Array, preds: Array }>} images
 */
function summarizeDetectionMetrics(images) {
  const op = operatingPointAtIou(images, 0.5);
  const map50 = computeApAtIou(images, 0.5);
  const thrList = [];
  for (let t = 50; t <= 95; t += 5) thrList.push(t / 100);
  const aps = thrList.map(( thr) => computeApAtIou(images, thr));
  const map50_95 = aps.length
    ? aps.reduce((a, b) => a + b, 0) / aps.length
    : 0;
  return {
    map50,
    map50_95,
    precision: op.precision,
    recall: op.recall,
    tp: op.tp,
    fp: op.fp,
    fn: op.fn,
    gtBoxes: images.reduce((n, img) => n + (img.gt || []).length, 0),
    predBoxes: images.reduce((n, img) => n + (img.preds || []).length, 0),
    evalImages: images.length
  };
}

module.exports = {
  readJpegSize,
  parseYoloLabelText,
  dbBboxesToXyxy,
  espBirdsToXyxy,
  iouXyxy,
  computeApAtIou,
  operatingPointAtIou,
  summarizeDetectionMetrics
};
