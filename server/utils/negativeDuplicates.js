/**
 * Cluster export-negative detections (no_pigeon / too_far, no positive boxes)
 * - exact: SHA-256 of image bytes (full frame or detection crop)
 * - similar: 64-bit average hash (aHash) via sharp, union-find by Hamming distance
 * - scope image: compare full frame
 * - scope detection: compare cropped „keine Taube“ box
 */
const crypto = require('crypto');
const sharp = require('sharp');
const {
  pickImageUrl,
  positiveBoxesFromDoc,
  classifyExportDoc,
  decodeImageBuffer,
  bboxFromBird,
  isNonTrainStatus,
  looksNormalized
} = require('./yoloDataset');

/**
 * Looser than classifyExportDoc (export requires ALL birds reviewed negative).
 * Dup-scan should include doc-level no_pigeon/too_far even if a second bird
 * is still unclassified — those are exactly the burst duplicates we want.
 */
function isNegativeDuplicateCandidate(doc) {
  if (!pickImageUrl(doc)) return false;
  if (positiveBoxesFromDoc(doc).length > 0) return false;
  if (isNonTrainStatus(doc?.classification_status)) return true;
  const birds = Array.isArray(doc?.birds) ? doc.birds : [];
  return birds.some((bird) => isNonTrainStatus(bird?.review?.status));
}

function passesNegativeFilter(doc, strict) {
  if (strict) return classifyExportDoc(doc).kind === 'negative';
  return isNegativeDuplicateCandidate(doc);
}

function normalizeUnit(unit) {
  return String(unit || 'box').toLowerCase() === 'doc' ? 'doc' : 'box';
}

function hashBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return crypto.createHash('sha256').update(url).digest('hex');
}

/** Tiny JPEG data-URL for cluster list previews (~64px). */
async function makeThumbDataUrl(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 32) return null;
  try {
    const out = await sharp(imageBuffer)
      .rotate()
      .resize(72, 72, { fit: 'cover' })
      .jpeg({ quality: 55, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

function boxArea(bbox) {
  if (!bbox) return 0;
  const w = Number(bbox.width) || 0;
  const h = Number(bbox.height) || 0;
  return Math.abs(w * h);
}

/** Normalize bird review for overlay: negative statuses vs still open. */
function birdOverlayStatus(bird) {
  const status = bird?.review?.status;
  if (isNonTrainStatus(status)) return status;
  if (status === 'confirmed_pigeon') return 'confirmed_pigeon';
  return 'unreviewed';
}

/**
 * Boxes for UI overlay / per-box hashing: no_pigeon / too_far AND unreviewed.
 * Confirmed pigeons are skipped (those docs are not negative-dup candidates).
 */
function overlayBirdBoxes(doc) {
  const birds = Array.isArray(doc?.birds) ? doc.birds : [];
  const boxes = [];
  for (let i = 0; i < birds.length; i += 1) {
    const bird = birds[i];
    const status = birdOverlayStatus(bird);
    if (status === 'confirmed_pigeon') continue;
    const bbox = bboxFromBird(bird);
    if (!bbox) continue;
    const birdId = bird?.bird_id || (bird?._id != null ? String(bird._id) : `idx-${i}`);
    boxes.push({
      ...bbox,
      status,
      boxIndex: i,
      birdId: String(birdId),
      role: bird?.role || null
    });
  }
  if (boxes.length) return boxes;
  if (isNonTrainStatus(doc?.classification_status)) {
    const bbox = bboxFromBird(doc.target_bird);
    if (bbox) {
      return [{
        ...bbox,
        status: doc.classification_status,
        boxIndex: 0,
        birdId: 'target',
        role: 'target'
      }];
    }
  }
  return [];
}

function pickPrimaryBox(boxes) {
  if (!Array.isArray(boxes) || !boxes.length) return null;
  // Crop/hash prefers a reviewed negative box; fall back to any overlay box.
  const preferred = boxes.filter((b) => isNonTrainStatus(b?.status));
  const pool = preferred.length ? preferred : boxes;
  let best = pool[0];
  let bestArea = boxArea(best);
  for (let i = 1; i < pool.length; i += 1) {
    const a = boxArea(pool[i]);
    if (a > bestArea) {
      best = pool[i];
      bestArea = a;
    }
  }
  return best;
}

function toPixelRect(bbox, imgW, imgH) {
  if (!bbox || !imgW || !imgH) return null;
  let x = Number(bbox.x);
  let y = Number(bbox.y);
  let w = Number(bbox.width);
  let h = Number(bbox.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  if (looksNormalized(bbox)) {
    x *= imgW;
    y *= imgH;
    w *= imgW;
    h *= imgH;
  }
  // Small pad so tiny boxes stay visible in thumbs
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.08));
  let left = Math.floor(x - pad);
  let top = Math.floor(y - pad);
  let width = Math.ceil(w + pad * 2);
  let height = Math.ceil(h + pad * 2);
  left = Math.max(0, Math.min(left, imgW - 1));
  top = Math.max(0, Math.min(top, imgH - 1));
  width = Math.max(1, Math.min(width, imgW - left));
  height = Math.max(1, Math.min(height, imgH - top));
  return { left, top, width, height };
}

/**
 * Prepare rotated full frame + optional detection crop.
 * @returns {{ fullBuf: Buffer, compareBuf: Buffer, thumbBuf: Buffer, natural: {width,height} }|null}
 */
async function prepareImageBuffers(item, scope) {
  const raw = decodeImageBuffer(item.url);
  if (!raw) return null;
  try {
    const rotated = sharp(raw).rotate();
    const meta = await rotated.metadata();
    const naturalW = meta.width || 0;
    const naturalH = meta.height || 0;
    if (!naturalW || !naturalH) return null;

    const fullBuf = await rotated.toBuffer();
    const infoW = item.image_info?.zoomed_size?.width
      || item.image_info?.original_size?.width
      || naturalW;
    const infoH = item.image_info?.zoomed_size?.height
      || item.image_info?.original_size?.height
      || naturalH;

    // Per-box clustering passes focusBox; legacy path falls back to largest negative.
    const primary = item.focusBox || pickPrimaryBox(item.boxes);
    let cropBuf = null;
    if (primary) {
      // Map bbox from image_info coords onto actual pixel buffer
      const scaleX = naturalW / infoW;
      const scaleY = naturalH / infoH;
      const rect = toPixelRect(primary, infoW, infoH);
      if (rect) {
        const extract = {
          left: Math.max(0, Math.min(naturalW - 1, Math.floor(rect.left * scaleX))),
          top: Math.max(0, Math.min(naturalH - 1, Math.floor(rect.top * scaleY))),
          width: Math.max(1, Math.min(naturalW, Math.ceil(rect.width * scaleX))),
          height: Math.max(1, Math.min(naturalH, Math.ceil(rect.height * scaleY)))
        };
        extract.width = Math.min(extract.width, naturalW - extract.left);
        extract.height = Math.min(extract.height, naturalH - extract.top);
        if (extract.width >= 2 && extract.height >= 2) {
          cropBuf = await sharp(fullBuf).extract(extract).toBuffer();
        }
      }
    }

    if (scope === 'detection' && !cropBuf) {
      return null; // detection-mode needs a box crop
    }

    const compareBuf = scope === 'detection' ? cropBuf : fullBuf;
    const thumbBuf = cropBuf || fullBuf;
    return {
      fullBuf,
      compareBuf,
      thumbBuf,
      natural: { width: naturalW, height: naturalH }
    };
  } catch {
    return null;
  }
}

function hamming64(a, b) {
  let x = (BigInt(a) ^ BigInt(b));
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * 8×8 greyscale average hash → BigInt (64 bits).
 */
async function averageHash64(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 32) return null;
  const { data } = await sharp(imageBuffer)
    .rotate()
    .greyscale()
    .resize(8, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!data || data.length < 64) return null;
  let sum = 0;
  for (let i = 0; i < 64; i += 1) sum += data[i];
  const mean = sum / 64;
  let bits = 0n;
  for (let i = 0; i < 64; i += 1) {
    if (data[i] >= mean) bits |= (1n << BigInt(i));
  }
  return bits;
}

function espParallelHasHit(espParallel) {
  if (!Array.isArray(espParallel)) return false;
  return espParallel.some((ep) => {
    if (!ep || typeof ep !== 'object' || ep.pending) return false;
    const count = Number(ep.count);
    if (Number.isFinite(count) && count > 0) return true;
    return Array.isArray(ep.birds) && ep.birds.length > 0;
  });
}

/** Compact Master/Slave label for UI (no bulky esp_parallel payload). */
function resolveCamLabel(det) {
  const authority = det?.detection_authority;
  const slaveHit = espParallelHasHit(det?.esp_parallel);
  if (authority === 'esp') return 'Slave';
  if (authority === 'cloud') return slaveHit ? 'Master+Slave' : 'Master';
  const src = det?.camera_source;
  if (src === 'tapo' || src === 'direct') return 'Master';
  if (src === 'raspberry-pi' || src === 'local') return 'Slave';
  return null;
}

function serializeDetectionMeta(item) {
  const boxes = (item.boxes || []).map((b) => ({
    ...b,
    focused: Boolean(
      item.focusBox
      && (
        (item.focusBox.birdId && b.birdId === item.focusBox.birdId)
        || (Number.isInteger(item.focusBox.boxIndex) && b.boxIndex === item.focusBox.boxIndex)
      )
    )
  }));
  return {
    id: item.id,
    memberKey: item.memberKey || item.id,
    boxIndex: Number.isInteger(item.boxIndex) ? item.boxIndex : null,
    birdId: item.birdId || null,
    focusStatus: item.focusStatus || null,
    processedAt: item.processedAt,
    device: item.device,
    classification_status: item.classification_status,
    boxes,
    image_info: item.image_info || null,
    thumbUrl: item.thumbUrl || null,
    camera_source: item.camera_source || null,
    camera_position: item.camera_position
      ? {
          rotation: item.camera_position.rotation,
          tilt: item.camera_position.tilt
        }
      : null,
    cam: item.cam || resolveCamLabel(item)
  };
}

/**
 * Build hash candidates.
 * - unit=box + scope detection: one candidate per bird box (Schaufel/Eimer)
 * - unit=doc: one candidate per detection (classic; crop = primary box if scope=detection)
 * - scope image: always one candidate per detection (full frame)
 */
function collectNegatives(detections, opts = {}) {
  const scope = normalizeScope(opts.scope);
  const unit = normalizeUnit(opts.unit);
  const strict = Boolean(opts.strict);
  const out = [];
  const perBox = unit === 'box' && scope === 'detection';

  for (const det of detections || []) {
    if (!det) continue;
    if (!passesNegativeFilter(det, strict)) continue;
    const picked = pickImageUrl(det);
    if (!picked?.url) continue;
    const boxes = overlayBirdBoxes(det);
    const base = {
      id: String(det._id),
      processedAt: det.processedAt,
      device: det.device,
      classification_status: det.classification_status || null,
      url: picked.url,
      imageField: picked.field,
      size: picked.url.length,
      boxes,
      image_info: det.image_info || null,
      camera_source: det.camera_source || null,
      camera_position: det.camera_position || null,
      detection_authority: det.detection_authority || null,
      esp_parallel: det.esp_parallel || null
    };

    if (!perBox) {
      const primary = scope === 'detection' ? pickPrimaryBox(boxes) : null;
      // Classic detection scope needs a crop; skip docs without usable box.
      if (scope === 'detection' && !primary) continue;
      out.push({
        ...base,
        memberKey: String(det._id),
        boxIndex: Number.isInteger(primary?.boxIndex) ? primary.boxIndex : null,
        birdId: primary?.birdId || null,
        focusStatus: primary?.status || null,
        focusBox: primary
      });
      continue;
    }

    if (!boxes.length) continue;
    for (const box of boxes) {
      const birdId = box.birdId || `idx-${box.boxIndex}`;
      out.push({
        ...base,
        memberKey: `${det._id}:${birdId}`,
        boxIndex: Number.isInteger(box.boxIndex) ? box.boxIndex : null,
        birdId,
        focusStatus: box.status || null,
        focusBox: box
      });
    }
  }
  return out;
}

function finalizeClusters(clusters, minCount) {
  return clusters
    .filter((c) => c.count >= minCount)
    .map((c) => {
      c.detections.sort((a, b) => {
        const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0;
        const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0;
        return ta - tb;
      });
      return c;
    })
    .sort((a, b) => b.count - a.count || (b.lastAt || 0) - (a.lastAt || 0));
}

function normalizeScope(scope) {
  return String(scope || 'image').toLowerCase() === 'detection' ? 'detection' : 'image';
}

class UnionFind {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
    this.r = Array(n).fill(0);
  }

  find(i) {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }

  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.r[ra] < this.r[rb]) {
      const t = ra;
      ra = rb;
      rb = t;
    }
    this.p[rb] = ra;
    if (this.r[ra] === this.r[rb]) this.r[ra] += 1;
  }
}

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await mapper(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** Lightweight meta after hashing — no base64 payload retained. */
function toHashedMeta(item, extra) {
  return {
    id: item.id,
    memberKey: item.memberKey || item.id,
    boxIndex: Number.isInteger(item.boxIndex) ? item.boxIndex : null,
    birdId: item.birdId || null,
    focusStatus: item.focusStatus || null,
    focusBox: item.focusBox || null,
    processedAt: item.processedAt,
    device: item.device,
    classification_status: item.classification_status,
    boxes: item.boxes || [],
    image_info: item.image_info || null,
    camera_source: item.camera_source || null,
    camera_position: item.camera_position || null,
    cam: resolveCamLabel(item),
    size: item.size,
    imageField: item.imageField,
    thumbUrl: extra.thumbUrl || null,
    hash: extra.hash || null,
    ahash: extra.ahash != null ? extra.ahash : null
  };
}

async function hashExactItem(item, scope) {
  const bufs = await prepareImageBuffers(item, scope);
  if (!bufs) return null;
  const hash = scope === 'detection'
    ? hashBytes(bufs.compareBuf)
    : (hashImageUrl(item.url) || hashBytes(bufs.compareBuf));
  if (!hash) return null;
  const thumbUrl = await makeThumbDataUrl(bufs.thumbBuf);
  return toHashedMeta(item, { hash, thumbUrl });
}

async function hashSimilarItem(item, scope) {
  const bufs = await prepareImageBuffers(item, scope);
  if (!bufs) return null;
  try {
    const [ahash, thumbUrl] = await Promise.all([
      averageHash64(bufs.compareBuf),
      makeThumbDataUrl(bufs.thumbBuf)
    ]);
    if (ahash == null) return null;
    return toHashedMeta(item, { ahash, thumbUrl });
  } catch {
    return null;
  }
}

/**
 * Hash negatives from a Mongo cursor/async iterable in small batches so full
 * base64 frames are not held for the entire dataset.
 * @returns {{ hashed: object[], scanned: number, negatives: number }}
 */
async function hashNegativesFromDocs(docIterable, opts = {}) {
  const scope = normalizeScope(opts.scope);
  const unit = normalizeUnit(opts.unit);
  const strict = Boolean(opts.strict);
  const mode = String(opts.mode || 'exact').toLowerCase() === 'similar' ? 'similar' : 'exact';
  const concurrency = Math.min(8, Math.max(1, Number(opts.concurrency) || 4));
  const batchSize = Math.min(64, Math.max(4, Number(opts.batchSize) || 24));
  const hashed = [];
  let scanned = 0;
  let negatives = 0;
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const docs = batch;
    batch = [];
    const items = collectNegatives(docs, { scope, unit, strict });
    // Count unique detection docs that contributed at least one box/item.
    const docIds = new Set(items.map((it) => it.id));
    negatives += docIds.size;
    const mapper = mode === 'similar'
      ? (item) => hashSimilarItem(item, scope)
      : (item) => hashExactItem(item, scope);
    const prepared = await mapPool(items, concurrency, mapper);
    for (const row of prepared) {
      if (row) hashed.push(row);
    }
  };

  for await (const doc of docIterable) {
    scanned += 1;
    batch.push(doc);
    if (batch.length >= batchSize) await flush();
  }
  await flush();

  return { hashed, scanned, negatives };
}

function clusterExactFromHashed(hashed, { minCount, scope }) {
  const byHash = new Map();
  for (const item of hashed) {
    if (!item?.hash) continue;
    if (!byHash.has(item.hash)) {
      byHash.set(item.hash, {
        hash: item.hash,
        kind: 'exact',
        scope,
        count: 0,
        size: item.size,
        imageField: item.imageField,
        firstAt: item.processedAt,
        lastAt: item.processedAt,
        thumbUrl: item.thumbUrl || null,
        detections: []
      });
    }
    const cluster = byHash.get(item.hash);
    cluster.count += 1;
    if (!cluster.thumbUrl && item.thumbUrl) cluster.thumbUrl = item.thumbUrl;
    cluster.detections.push(serializeDetectionMeta(item));
    if (item.processedAt && (!cluster.firstAt || item.processedAt < cluster.firstAt)) {
      cluster.firstAt = item.processedAt;
    }
    if (item.processedAt && (!cluster.lastAt || item.processedAt > cluster.lastAt)) {
      cluster.lastAt = item.processedAt;
    }
  }
  return finalizeClusters([...byHash.values()], minCount);
}

function clusterSimilarFromHashed(hashed, { minCount, maxDistance, scope }) {
  const usable = (hashed || []).filter((h) => h.ahash != null);
  const n = usable.length;
  if (n < 2) return [];

  const uf = new UnionFind(n);
  // Full pairwise for the whole set (no artificial 1200 cap).
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (hamming64(usable[i].ahash, usable[j].ahash) <= maxDistance) {
        uf.union(i, j);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(usable[i]);
  }

  const clusters = [];
  for (const members of groups.values()) {
    if (members.length < minCount) continue;
    const hash = `sim-${scope}-${members[0].ahash.toString(16).padStart(16, '0')}-${members.length}`;
    let firstAt = members[0].processedAt;
    let lastAt = members[0].processedAt;
    for (const m of members) {
      if (m.processedAt && (!firstAt || m.processedAt < firstAt)) firstAt = m.processedAt;
      if (m.processedAt && (!lastAt || m.processedAt > lastAt)) lastAt = m.processedAt;
    }
    clusters.push({
      hash,
      kind: 'similar',
      scope,
      count: members.length,
      size: members[0].size,
      imageField: members[0].imageField,
      maxDistance,
      firstAt,
      lastAt,
      thumbUrl: members.find((m) => m.thumbUrl)?.thumbUrl || null,
      detections: members.map((m) => serializeDetectionMeta(m))
    });
  }

  return finalizeClusters(clusters, minCount);
}

/**
 * Exact clusters (byte-identical full frame or detection crop).
 * @param {{ minCount?: number, scope?: 'image'|'detection', concurrency?: number }} opts
 */
async function buildNegativeDuplicateClusters(detections, opts = {}) {
  const minCount = Math.max(2, Number(opts.minCount) || 2);
  const scope = normalizeScope(opts.scope);
  const { hashed } = await hashNegativesFromDocs(detections || [], {
    ...opts,
    mode: 'exact',
    scope
  });
  return clusterExactFromHashed(hashed, { minCount, scope });
}

/**
 * Similar clusters via aHash + Hamming distance.
 * @param {{ minCount?: number, maxDistance?: number, concurrency?: number, scope?: 'image'|'detection' }} opts
 */
async function buildNegativeSimilarClusters(detections, opts = {}) {
  const minCount = Math.max(2, Number(opts.minCount) || 2);
  const maxDistance = Math.min(32, Math.max(1, Number(opts.maxDistance) || 8));
  const scope = normalizeScope(opts.scope);
  const { hashed } = await hashNegativesFromDocs(detections || [], {
    ...opts,
    mode: 'similar',
    scope
  });
  return clusterSimilarFromHashed(hashed, { minCount, maxDistance, scope });
}

/**
 * Stream Mongo docs → hash → cluster. Prefer this for full-history scans.
 */
async function buildNegativeClustersFromDocs(docIterable, opts = {}) {
  const mode = String(opts.mode || 'exact').toLowerCase() === 'similar' ? 'similar' : 'exact';
  const scope = normalizeScope(opts.scope);
  const unit = normalizeUnit(opts.unit);
  const strict = Boolean(opts.strict);
  const minCount = Math.max(2, Number(opts.minCount) || 2);
  const maxDistance = Math.min(32, Math.max(1, Number(opts.maxDistance) || 8));
  const { hashed, scanned, negatives } = await hashNegativesFromDocs(docIterable, {
    ...opts,
    mode,
    scope,
    unit,
    strict
  });
  const clusters = mode === 'similar'
    ? clusterSimilarFromHashed(hashed, { minCount, maxDistance, scope })
    : clusterExactFromHashed(hashed, { minCount, scope });
  return {
    clusters,
    scanned,
    negatives,
    hashedCount: hashed.length,
    unit,
    strict,
    uniqueDetectionsInClusters: new Set(
      clusters.flatMap((c) => (c.detections || []).map((d) => d.id))
    ).size
  };
}

module.exports = {
  hashImageUrl,
  hashBytes,
  hamming64,
  averageHash64,
  buildNegativeDuplicateClusters,
  buildNegativeSimilarClusters,
  buildNegativeClustersFromDocs
};
