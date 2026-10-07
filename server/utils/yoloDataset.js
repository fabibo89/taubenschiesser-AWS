/**
 * Helpers for YOLO training export from Detection docs.
 * Positives = confirmed_pigeon boxes; negatives = empty-label background images.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function copyBbox(bbox) {
  if (!bbox || (bbox.x == null && bbox.width == null)) return undefined;
  const x = num(bbox.x);
  const y = num(bbox.y);
  const width = num(bbox.width);
  const height = num(bbox.height);
  if (x == null || y == null || width == null || height == null) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function bboxFromBird(bird) {
  const direct = copyBbox(bird?.bbox);
  if (direct) return direct;
  const position = bird?.position;
  if (!position) return undefined;
  const cx = num(position.center_x);
  const cy = num(position.center_y);
  const width = num(position.width);
  const height = num(position.height);
  if (cx == null || cy == null || width == null || height == null) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

function hasStoredUrl(url) {
  return typeof url === 'string' && url.length > 32;
}

/** Prefer zoomed frame (boxes belong there), then camera-specific, then original. */
function pickImageUrl(doc) {
  const fields = [
    'zoomed_image',
    'tapo_zoomed_image',
    'raspberry_pi_zoomed_image',
    'image',
    'tapo_image',
    'raspberry_pi_image'
  ];
  for (const field of fields) {
    const url = doc?.[field]?.url;
    if (hasStoredUrl(url)) return { field, url };
  }
  return null;
}

function positiveBoxesFromDoc(doc) {
  const birds = Array.isArray(doc?.birds) ? doc.birds : [];
  const boxes = [];
  for (const bird of birds) {
    if (bird?.review?.status !== 'confirmed_pigeon') continue;
    const bbox = bboxFromBird(bird);
    if (bbox) boxes.push(bbox);
  }
  if (boxes.length) return boxes;

  // Legacy: no birds[], but doc classified as pigeon with a target box
  if (doc?.classification_status === 'confirmed_pigeon') {
    const bbox = bboxFromBird(doc.target_bird) || copyBbox(doc.target_bird?.bbox);
    if (bbox) return [bbox];
  }
  return [];
}

function isNegativeDoc(doc, positiveCount) {
  if (positiveCount > 0) return false;
  const birds = Array.isArray(doc?.birds) ? doc.birds : [];
  if (birds.length > 0) {
    return birds.every((bird) => bird?.review?.status === 'no_pigeon');
  }
  return doc?.classification_status === 'no_pigeon';
}

function classifyExportDoc(doc) {
  if (!pickImageUrl(doc)) {
    return { kind: 'skip', reason: 'no_image', boxes: [] };
  }
  const boxes = positiveBoxesFromDoc(doc);
  if (boxes.length > 0) {
    return { kind: 'positive', boxes, reason: null };
  }
  if (isNegativeDoc(doc, 0)) {
    return { kind: 'negative', boxes: [], reason: null };
  }
  return { kind: 'skip', reason: 'unreviewed', boxes: [] };
}

function looksNormalized(bbox) {
  return (
    bbox.width <= 1.5
    && bbox.height <= 1.5
    && bbox.x <= 1.5
    && bbox.y <= 1.5
    && bbox.x >= -0.1
    && bbox.y >= -0.1
  );
}

/** YOLO line: class cx cy w h (all normalized 0–1). */
function bboxToYoloLine(bbox, imgWidth, imgHeight, classId = 0) {
  if (!bbox || !imgWidth || !imgHeight) return null;
  let x = bbox.x;
  let y = bbox.y;
  let w = bbox.width;
  let h = bbox.height;
  if (!looksNormalized(bbox)) {
    x /= imgWidth;
    y /= imgHeight;
    w /= imgWidth;
    h /= imgHeight;
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return `${classId} ${clamp(cx).toFixed(6)} ${clamp(cy).toFixed(6)} ${clamp(w).toFixed(6)} ${clamp(h).toFixed(6)}`;
}

function labelsFromBoxes(boxes, imgWidth, imgHeight) {
  const lines = [];
  for (const bbox of boxes) {
    const line = bboxToYoloLine(bbox, imgWidth, imgHeight, 0);
    if (line) lines.push(line);
  }
  return `${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

function resolveImageSize(doc, buffer) {
  const zoomed = doc?.image_info?.zoomed_size;
  if (zoomed?.width && zoomed?.height) {
    return { width: zoomed.width, height: zoomed.height };
  }
  const original = doc?.image_info?.original_size;
  if (original?.width && original?.height) {
    return { width: original.width, height: original.height };
  }
  return imageSizeFromBuffer(buffer);
}

function imageSizeFromBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7)
        };
      }
      i += 2 + len;
    }
    return null;
  }
  // PNG
  if (
    buf[0] === 0x89
    && buf[1] === 0x50
    && buf[2] === 0x4e
    && buf[3] === 0x47
  ) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20)
    };
  }
  return null;
}

function decodeImageBuffer(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:') && url.includes(',')) {
    const raw = url.slice(url.indexOf(',') + 1);
    try {
      return Buffer.from(raw, 'base64');
    } catch {
      return null;
    }
  }
  // Raw base64 (no data: prefix)
  if (url.length > 200 && !url.startsWith('http') && !url.startsWith('/')) {
    try {
      return Buffer.from(url, 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

function imageExtension(buffer, url) {
  if (Buffer.isBuffer(buffer)) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
    if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'webp';
  }
  if (typeof url === 'string') {
    if (url.includes('image/png')) return 'png';
    if (url.includes('image/webp')) return 'webp';
  }
  return 'jpg';
}

function clampValRatio(value, fallback = 0.2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.5, Math.max(0.05, n));
}

/** Last valRatio of chronologically sorted items → val. */
function temporalSplit(items, valRatio) {
  const ratio = clampValRatio(valRatio);
  const sorted = [...items].sort((a, b) => {
    const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0;
    const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
  const n = sorted.length;
  let valCount = n === 0 ? 0 : Math.max(1, Math.round(n * ratio));
  if (valCount >= n && n > 1) valCount = n - 1;
  if (n <= 1) valCount = 0;
  const splitAt = n - valCount;
  return {
    train: sorted.slice(0, splitAt).map((item) => ({ ...item, split: 'train' })),
    val: sorted.slice(splitAt).map((item) => ({ ...item, split: 'val' })),
    valRatio: ratio
  };
}

function dataYamlContent() {
  return [
    '# Taubenschießer YOLO export',
    'path: .',
    'train: train/images',
    'val: val/images',
    'names:',
    '  0: pigeon',
    ''
  ].join('\n');
}

module.exports = {
  pickImageUrl,
  positiveBoxesFromDoc,
  classifyExportDoc,
  bboxToYoloLine,
  labelsFromBoxes,
  resolveImageSize,
  decodeImageBuffer,
  imageExtension,
  clampValRatio,
  temporalSplit,
  dataYamlContent,
  hasStoredUrl
};
