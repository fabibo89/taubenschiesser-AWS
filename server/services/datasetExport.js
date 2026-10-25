const fs = require('fs');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
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
  temporalSplit,
  dataYamlContent
} = require('../utils/yoloDataset');
const {
  isS3Configured,
  s3Config,
  uploadZipForColab
} = require('./colabDatasetUpload');
const {
  driveConfig,
  uploadZipToDrive
} = require('./googleDriveUpload');

const EXPORT_DIR = path.join(__dirname, '../exports');

let current = null;

function drivePublicMeta() {
  const cfg = driveConfig();
  return {
    driveConfigured: cfg.enabled,
    driveCredentialsReady: cfg.credentialsReady,
    driveFolderId: cfg.folderId || null,
    driveClientEmail: cfg.clientEmail || null,
    driveAutoUpload: cfg.autoUpload,
    driveColabPathPrefix: cfg.colabPathPrefix
  };
}

function isUploadingSideChannel(state) {
  return state.colabUploadStatus === 'uploading'
    || state.driveUploadStatus === 'uploading';
}

function publicState(state) {
  if (!state) {
    return {
      status: 'idle',
      s3Configured: isS3Configured(),
      colabAutoUpload: s3Config().autoUpload,
      ...drivePublicMeta()
    };
  }
  return {
    status: state.status,
    processed: state.processed || 0,
    total: state.total || 0,
    written: state.written || 0,
    skipped: state.skipped || 0,
    errors: state.errors || 0,
    message: state.message || '',
    downloadName: state.downloadName || null,
    ready: Boolean(state.zipPath) && (
      state.status === 'done'
      || (state.status === 'running' && isUploadingSideChannel(state))
    ),
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    preview: state.preview || null,
    error: state.error || null,
    s3Configured: isS3Configured(),
    colabAutoUpload: s3Config().autoUpload,
    colabDatasetUrl: state.colabDatasetUrl || null,
    colabUrlType: state.colabUrlType || null,
    colabUrlExpiresIn: state.colabUrlExpiresIn || null,
    colabUploadStatus: state.colabUploadStatus || null,
    colabUploadError: state.colabUploadError || null,
    ...drivePublicMeta(),
    driveFileId: state.driveFileId || null,
    driveWebViewLink: state.driveWebViewLink || null,
    driveColabPath: state.driveColabPath || null,
    driveUploadStatus: state.driveUploadStatus || null,
    driveUploadError: state.driveUploadError || null
  };
}

function getExportStatus() {
  return publicState(current);
}

function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

function cleanupOldExports() {
  try {
    if (!fs.existsSync(EXPORT_DIR)) return;
    for (const name of fs.readdirSync(EXPORT_DIR)) {
      if (!name.startsWith('yolo-') || !name.endsWith('.zip')) continue;
      try {
        fs.unlinkSync(path.join(EXPORT_DIR, name));
      } catch (err) {
        logger.warn(`Could not remove old export ${name}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.warn(`Export cleanup failed: ${err.message}`);
  }
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

async function deviceIdsForUser(userId) {
  const devices = await Device.find({ owner: userId }).select('_id');
  return devices.map((d) => d._id);
}

function urlPresent(field) {
  return {
    $and: [
      { $eq: [{ $type: field }, 'string'] },
      { $gt: [{ $strLenCP: field }, 32] }
    ]
  };
}

/** Candidate rows without image payloads (aggregation). */
async function fetchCandidateRows(deviceIds) {
  return Detection.aggregate([
    { $match: { device: { $in: deviceIds } } },
    {
      $project: {
        processedAt: 1,
        classification_status: 1,
        birds: { $ifNull: ['$birds', []] },
        target_bird: 1,
        hasImage: {
          $or: [
            urlPresent('$zoomed_image.url'),
            urlPresent('$image.url'),
            urlPresent('$tapo_zoomed_image.url'),
            urlPresent('$raspberry_pi_zoomed_image.url'),
            urlPresent('$tapo_image.url'),
            urlPresent('$raspberry_pi_image.url')
          ]
        },
        positiveBoxes: {
          $filter: {
            input: { $ifNull: ['$birds', []] },
            as: 'bird',
            cond: {
              $and: [
                { $eq: ['$$bird.review.status', 'confirmed_pigeon'] },
                {
                  $or: [
                    { $gt: [{ $ifNull: ['$$bird.bbox.width', 0] }, 0] },
                    { $gt: [{ $ifNull: ['$$bird.position.width', 0] }, 0] }
                  ]
                }
              ]
            }
          }
        },
        nonTrainBirds: {
          $filter: {
            input: { $ifNull: ['$birds', []] },
            as: 'bird',
            cond: {
              $in: ['$$bird.review.status', ['no_pigeon', 'too_far']]
            }
          }
        },
        birdCount: { $size: { $ifNull: ['$birds', []] } }
      }
    },
    {
      $addFields: {
        positiveBoxCount: { $size: '$positiveBoxes' },
        legacyPositive: {
          $and: [
            { $eq: [{ $size: '$positiveBoxes' }, 0] },
            { $eq: ['$classification_status', 'confirmed_pigeon'] },
            {
              $or: [
                { $gt: [{ $ifNull: ['$target_bird.bbox.width', 0] }, 0] },
                { $gt: [{ $ifNull: ['$target_bird.position.width', 0] }, 0] }
              ]
            }
          ]
        },
        allNonTrain: {
          $and: [
            { $gt: ['$birdCount', 0] },
            { $eq: ['$birdCount', { $size: '$nonTrainBirds' }] }
          ]
        }
      }
    },
    {
      $addFields: {
        boxCount: {
          $cond: ['$legacyPositive', 1, '$positiveBoxCount']
        },
        kind: {
          $cond: [
            { $not: ['$hasImage'] },
            'skip',
            {
              $cond: [
                { $or: [{ $gt: ['$positiveBoxCount', 0] }, '$legacyPositive'] },
                'positive',
                {
                  $cond: [
                    {
                      $or: [
                        '$allNonTrain',
                        {
                          $and: [
                            { $eq: ['$birdCount', 0] },
                            {
                              $in: [
                                '$classification_status',
                                ['no_pigeon', 'too_far']
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    'negative',
                    'skip'
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    { $match: { kind: { $in: ['positive', 'negative'] } } },
    { $project: { processedAt: 1, kind: 1, boxCount: 1 } },
    { $sort: { processedAt: 1, _id: 1 } }
  ]).allowDiskUse(true);
}

function summarizeSplit(list) {
  let positiveImages = 0;
  let negativeImages = 0;
  let boxes = 0;
  for (const item of list) {
    if (item.kind === 'positive') {
      positiveImages += 1;
      boxes += item.boxCount || 0;
    } else {
      negativeImages += 1;
    }
  }
  return {
    images: list.length,
    positiveImages,
    negativeImages,
    boxes
  };
}

async function buildPreview(userId, valRatio) {
  const ratio = clampValRatio(valRatio);
  const empty = {
    valRatio: ratio,
    images: 0,
    positiveImages: 0,
    negativeImages: 0,
    positiveBoxes: 0,
    train: { images: 0, positiveImages: 0, negativeImages: 0, boxes: 0 },
    val: { images: 0, positiveImages: 0, negativeImages: 0, boxes: 0 }
  };
  const deviceIds = await deviceIdsForUser(userId);
  if (!deviceIds.length) return empty;

  const rows = await fetchCandidateRows(deviceIds);
  const items = rows.map((row) => ({
    id: String(row._id),
    processedAt: row.processedAt || null,
    kind: row.kind,
    boxCount: row.boxCount || 0
  }));
  const { train, val, valRatio: usedRatio } = temporalSplit(items, ratio);
  const trainStats = summarizeSplit(train);
  const valStats = summarizeSplit(val);
  return {
    valRatio: usedRatio,
    images: items.length,
    positiveImages: trainStats.positiveImages + valStats.positiveImages,
    negativeImages: trainStats.negativeImages + valStats.negativeImages,
    positiveBoxes: trainStats.boxes + valStats.boxes,
    train: trainStats,
    val: valStats
  };
}

async function runExport(userId, state) {
  ensureExportDir();
  const ratio = clampValRatio(state.valRatio);
  state.status = 'running';
  state.message = 'Kandidaten laden';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.processed = 0;
  state.written = 0;
  state.skipped = 0;
  state.errors = 0;
  state.zipPath = null;
  state.downloadName = null;
  state.colabDatasetUrl = null;
  state.colabUrlType = null;
  state.colabUrlExpiresIn = null;
  state.colabUploadStatus = null;
  state.colabUploadError = null;
  state.driveFileId = null;
  state.driveWebViewLink = null;
  state.driveColabPath = null;
  state.driveUploadStatus = null;
  state.driveUploadError = null;

  const deviceIds = await deviceIdsForUser(userId);
  const rows = deviceIds.length ? await fetchCandidateRows(deviceIds) : [];
  const items = rows.map((row) => ({
    id: String(row._id),
    processedAt: row.processedAt || null,
    kind: row.kind,
    boxCount: row.boxCount || 0
  }));
  const { train, val, valRatio: usedRatio } = temporalSplit(items, ratio);
  const plan = [...train, ...val];
  const trainStats = summarizeSplit(train);
  const valStats = summarizeSplit(val);
  state.preview = {
    valRatio: usedRatio,
    images: items.length,
    positiveImages: trainStats.positiveImages + valStats.positiveImages,
    negativeImages: trainStats.negativeImages + valStats.negativeImages,
    positiveBoxes: trainStats.boxes + valStats.boxes,
    train: trainStats,
    val: valStats
  };
  state.total = plan.length;

  if (plan.length === 0) {
    state.status = 'done';
    state.message = 'Keine exportierbaren Bilder';
    state.finishedAt = new Date().toISOString();
    return publicState(state);
  }

  state.message = 'ZIP wird geschrieben';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const downloadName = `yolo-dataset-${stamp}.zip`;
  const zipPath = path.join(EXPORT_DIR, downloadName);
  cleanupOldExports();

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 1 } });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    output.on('close', ok);
    output.on('error', fail);
    archive.on('error', fail);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') logger.warn(`archiver warning: ${err.message}`);
    });
    archive.pipe(output);
    archive.append(dataYamlContent(), { name: 'data.yaml' });

    (async () => {
      try {
        for (const item of plan) {
          if (state.stopRequested) break;
          state.processed += 1;
          try {
            const doc = await Detection.findById(item.id)
              .select(
                'processedAt classification_status birds target_bird image_info '
                + 'image.url zoomed_image.url tapo_image.url tapo_zoomed_image.url '
                + 'raspberry_pi_image.url raspberry_pi_zoomed_image.url'
              )
              .lean();
            if (!doc) {
              state.skipped += 1;
              continue;
            }
            const classified = classifyExportDoc(doc);
            if (classified.kind === 'skip') {
              state.skipped += 1;
              continue;
            }
            const picked = pickImageUrl(doc);
            if (!picked) {
              state.skipped += 1;
              continue;
            }
            const buffer = await loadImageBuffer(picked.url);
            if (!buffer || buffer.length < 100) {
              state.skipped += 1;
              continue;
            }
            const size = resolveImageSize(doc, buffer);
            if (!size?.width || !size?.height) {
              state.skipped += 1;
              continue;
            }
            const labelText = labelsFromBoxes(classified.boxes, size.width, size.height);
            if (classified.kind === 'positive' && !labelText.trim()) {
              state.skipped += 1;
              continue;
            }
            const ext = imageExtension(buffer, picked.url);
            const base = String(doc._id);
            const split = item.split;
            archive.append(buffer, { name: `${split}/images/${base}.${ext}` });
            archive.append(labelText, { name: `${split}/labels/${base}.txt` });
            state.written += 1;
          } catch (err) {
            state.errors += 1;
            logger.error(`YOLO export ${item.id}: ${err.message}`);
          }
        }
        await archive.finalize();
      } catch (err) {
        fail(err);
      }
    })();
  });

  if (state.stopRequested) {
    state.status = 'stopped';
    state.message = 'Angehalten';
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
  } else {
    state.zipPath = zipPath;
    state.downloadName = downloadName;

    const wantS3 = state.uploadToColab || s3Config().autoUpload;
    const wantDrive = state.uploadToDrive || driveConfig().autoUpload;
    let message = 'Fertig';

    if (wantDrive) {
      if (!driveConfig().credentialsReady) {
        state.driveUploadStatus = 'failed';
        state.driveUploadError = 'Google Drive Credentials fehlen (GOOGLE_DRIVE_CREDENTIALS_JSON)';
        message = 'Fertig (Drive nicht konfiguriert)';
      } else {
        state.driveUploadStatus = 'uploading';
        state.message = 'Google-Drive-Upload…';
        try {
          const uploaded = await uploadZipToDrive(zipPath, downloadName, {
            folderUrl: state.driveFolderUrl
          });
          state.driveFileId = uploaded.fileId;
          state.driveWebViewLink = uploaded.webViewLink;
          state.driveColabPath = uploaded.colabPath;
          state.driveUploadStatus = 'done';
          message = 'Fertig (Drive-Datei bereit)';
        } catch (err) {
          logger.error(`Drive upload failed: ${err.message}`);
          state.driveUploadStatus = 'failed';
          state.driveUploadError = err.message || 'Drive-Upload fehlgeschlagen';
          message = 'Fertig (Drive-Upload fehlgeschlagen)';
        }
      }
    }

    if (wantS3 && isS3Configured()) {
      // Stay "running" so the UI keeps polling until the URL is ready.
      state.colabUploadStatus = 'uploading';
      state.message = 'S3-Upload für Colab…';
      try {
        const uploaded = await uploadZipForColab(zipPath, downloadName);
        state.colabDatasetUrl = uploaded.url;
        state.colabUrlType = uploaded.urlType;
        state.colabUrlExpiresIn = uploaded.expiresIn;
        state.colabUploadStatus = 'done';
        message = state.driveFileId
          ? 'Fertig (Drive + Colab-URL bereit)'
          : 'Fertig (Colab-URL bereit)';
      } catch (err) {
        logger.error(`Colab S3 upload failed: ${err.message}`);
        state.colabUploadStatus = 'failed';
        state.colabUploadError = err.message || 'S3-Upload fehlgeschlagen';
        message = state.driveFileId
          ? 'Fertig (Drive ok, S3 fehlgeschlagen)'
          : 'Fertig (S3-Upload fehlgeschlagen)';
      }
    }

    state.message = message;
    state.status = 'done';
  }
  state.finishedAt = new Date().toISOString();
  return publicState(state);
}

function startExport(userId, options = {}) {
  if (current && current.status === 'running') {
    const err = new Error('Ein Export läuft bereits');
    err.statusCode = 409;
    throw err;
  }
  const state = {
    status: 'running',
    userId: String(userId),
    valRatio: clampValRatio(options.valRatio),
    uploadToColab: Boolean(options.uploadToColab),
    uploadToDrive: Boolean(options.uploadToDrive),
    driveFolderUrl: typeof options.driveFolderUrl === 'string'
      ? options.driveFolderUrl.trim()
      : '',
    processed: 0,
    total: 0,
    written: 0,
    skipped: 0,
    errors: 0,
    message: 'Startet',
    stopRequested: false,
    zipPath: null,
    downloadName: null,
    preview: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    colabDatasetUrl: null,
    colabUrlType: null,
    colabUrlExpiresIn: null,
    colabUploadStatus: null,
    colabUploadError: null,
    driveFileId: null,
    driveWebViewLink: null,
    driveColabPath: null,
    driveUploadStatus: null,
    driveUploadError: null
  };
  current = state;
  setImmediate(() => {
    runExport(userId, state).catch((err) => {
      logger.error(`YOLO export failed: ${err.message}`);
      state.status = 'failed';
      state.error = err.message || 'Export fehlgeschlagen';
      state.message = state.error;
      state.finishedAt = new Date().toISOString();
    });
  });
  return publicState(state);
}

/**
 * Upload the current ready export zip to S3 for Colab.
 */
async function uploadCurrentExportForColab(userId) {
  const file = getDownloadPath(userId);
  if (!file) {
    const err = new Error('Kein Export zum Upload bereit');
    err.statusCode = 404;
    throw err;
  }
  if (!current) {
    const err = new Error('Kein Export-Status');
    err.statusCode = 404;
    throw err;
  }
  current.colabUploadStatus = 'uploading';
  current.colabUploadError = null;
  try {
    const uploaded = await uploadZipForColab(file.path, file.name);
    current.colabDatasetUrl = uploaded.url;
    current.colabUrlType = uploaded.urlType;
    current.colabUrlExpiresIn = uploaded.expiresIn;
    current.colabUploadStatus = 'done';
    return publicState(current);
  } catch (err) {
    current.colabUploadStatus = 'failed';
    current.colabUploadError = err.message || 'S3-Upload fehlgeschlagen';
    throw err;
  }
}

/**
 * Upload the current ready export zip to Google Drive for Colab.
 */
async function uploadCurrentExportToDrive(userId, options = {}) {
  const file = getDownloadPath(userId);
  if (!file) {
    const err = new Error('Kein Export zum Upload bereit');
    err.statusCode = 404;
    throw err;
  }
  if (!current) {
    const err = new Error('Kein Export-Status');
    err.statusCode = 404;
    throw err;
  }
  const cfg = driveConfig();
  if (!cfg.credentialsReady) {
    const err = new Error(
      'Google Drive Credentials fehlen (GOOGLE_DRIVE_CREDENTIALS_JSON in server/.env)'
    );
    err.statusCode = 503;
    throw err;
  }
  current.driveUploadStatus = 'uploading';
  current.driveUploadError = null;
  try {
    const uploaded = await uploadZipToDrive(file.path, file.name, {
      folderUrl: options.folderUrl || options.driveFolderUrl,
      folderId: options.folderId
    });
    current.driveFileId = uploaded.fileId;
    current.driveWebViewLink = uploaded.webViewLink;
    current.driveColabPath = uploaded.colabPath;
    current.driveUploadStatus = 'done';
    return publicState(current);
  } catch (err) {
    current.driveUploadStatus = 'failed';
    current.driveUploadError = err.message || 'Drive-Upload fehlgeschlagen';
    throw err;
  }
}

function requestExportStop() {
  if (!current || current.status !== 'running') return publicState(current);
  current.stopRequested = true;
  current.message = 'Stopp angefordert';
  return publicState(current);
}

function getDownloadPath(userId) {
  if (!current || !current.zipPath) return null;
  const zipReady = current.status === 'done'
    || (current.status === 'running' && isUploadingSideChannel(current));
  if (!zipReady) return null;
  if (String(current.userId) !== String(userId)) return null;
  if (!fs.existsSync(current.zipPath)) return null;
  return {
    path: current.zipPath,
    name: current.downloadName || path.basename(current.zipPath)
  };
}

module.exports = {
  getExportStatus,
  startExport,
  requestExportStop,
  getDownloadPath,
  uploadCurrentExportForColab,
  uploadCurrentExportToDrive,
  buildPreview,
  fetchCandidateRows,
  EXPORT_DIR
};
