const express = require('express');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const Detection = require('../models/Detection');
const Device = require('../models/Device');
const { listModels } = require('../utils/modelCatalog');
const { getReplayStatus, requestReplayStop, startReplay } = require('../services/modelReplay');
const {
  getExportStatus,
  startExport,
  requestExportStop,
  getDownloadPath,
  uploadCurrentExportForColab,
  uploadCurrentExportToDrive,
  buildPreview
} = require('../services/datasetExport');
const { isS3Configured } = require('../services/colabDatasetUpload');
const { driveConfig } = require('../services/googleDriveUpload');
const { listBaselines, getBaseline } = require('../utils/modelBaselines');
const {
  status: nasTrainingStatus,
  listDatasetZips,
  findDatasetZip
} = require('../utils/nasTraining');
const {
  getLatestHostVal,
  listHostValHistory,
  getHostValDetail
} = require('../utils/benchmarkStore');
const {
  getBenchmarkStatus,
  startEspBenchmark,
  startHostBenchmark,
  requestBenchmarkStop
} = require('../services/espBenchmark');
const {
  getEspExportStatus,
  startEspExport,
  requestEspExportStop,
  clearEspExportStatus
} = require('../services/espExport');
const { listEspP4Targets, resolveEspP4Target } = require('../utils/espP4Targets');
const {
  applyMainReview,
  applySideReview,
  applyBirdReview,
  restoreBirdReview,
  applyNewBoxReview,
  restoreNewBoxReview
} = require('../utils/detectionBirds');
const {
  bboxFromBird,
  shortSideRatio,
  clampMinShortSide
} = require('../utils/yoloDataset');
const logger = require('../utils/logger');

const router = express.Router();
const otaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }
});
const BIRD_CLASSES = ['bird', 'birds', 'vogel', 'vögel', 'voegel', 'pigeon', 'taube', 'dove'];

function hasStoredImage(field) {
  return {
    $and: [
      { $eq: [{ $type: field }, 'string'] },
      { $gt: [{ $strLenCP: field }, 0] }
    ]
  };
}

router.get('/dataset', authenticateToken, async (req, res) => {
  try {
    const devices = await Device.find({ owner: req.user.userId }).select('_id');
    const deviceIds = devices.map((device) => device._id);

    const replayModels = listModels()
      .filter((model) => model.role !== 'live')
      .map((model) => {
        const onnx = (model.artifacts || []).find((a) => a.runtime === 'onnx');
        return {
          id: model.id,
          name: model.name,
          role: model.role,
          present: Boolean(onnx?.present),
          file: onnx?.file || null,
          input: onnx?.input || null
        };
      });

    const requestedId = typeof req.query.modelId === 'string' ? req.query.modelId.trim() : '';
    const preferred = replayModels.find((m) => m.id === requestedId && m.present)
      || replayModels.find((m) => m.id === 'yolo26l' && m.present)
      || replayModels.find((m) => m.id === 'yolov8l' && m.present)
      || replayModels.find((m) => m.present)
      || null;

    const empty = {
      images: 0,
      birds: 0,
      confirmedBirds: 0,
      tooFarBirds: 0,
      sideBirds: 0,
      replayModels,
      selectedModel: preferred,
      lModel: preferred,
      lReplay: {
        done: 0,
        pending: 0,
        confirmedMainMatched: 0,
        confirmedMainMissed: 0,
        confirmedMainPendingL: 0,
        sideMatched: 0,
        sideUnmatched: 0,
        newLBoxes: 0
      }
    };
    if (deviceIds.length === 0) {
      return res.json(empty);
    }

    const lName = preferred?.name || '';
    if (!lName) {
      return res.json(empty);
    }

    const [row] = await Detection.aggregate([
      { $match: { device: { $in: deviceIds } } },
      {
        $project: {
          classification_status: 1,
          birds: { $ifNull: ['$birds', []] },
          detections: { $ifNull: ['$detections', []] },
          model_runs: { $ifNull: ['$model_runs', []] },
          hasImage: {
            $or: [
              hasStoredImage('$image.url'),
              hasStoredImage('$zoomed_image.url'),
              hasStoredImage('$tapo_image.url'),
              hasStoredImage('$tapo_zoomed_image.url'),
              hasStoredImage('$raspberry_pi_image.url'),
              hasStoredImage('$raspberry_pi_zoomed_image.url')
            ]
          }
        }
      },
      {
        $addFields: {
          lRun: {
            $first: {
              $filter: {
                input: '$model_runs',
                as: 'run',
                cond: { $eq: ['$$run.model.name', lName] }
              }
            }
          },
          confirmedBirdsList: {
            $filter: {
              input: '$birds',
              as: 'bird',
              cond: { $eq: ['$$bird.review.status', 'confirmed_pigeon'] }
            }
          },
          tooFarBirdsList: {
            $filter: {
              input: '$birds',
              as: 'bird',
              cond: { $eq: ['$$bird.review.status', 'too_far'] }
            }
          },
          // Main-Kennzahlen (trifft/verfehlt): nur role=main
          confirmedMainBirdsList: {
            $filter: {
              input: '$birds',
              as: 'bird',
              cond: {
                $and: [
                  { $eq: ['$$bird.review.status', 'confirmed_pigeon'] },
                  { $eq: ['$$bird.role', 'main'] }
                ]
              }
            }
          },
          sideBirdsList: {
            $filter: {
              input: '$birds',
              as: 'bird',
              cond: { $eq: ['$$bird.role', 'side'] }
            }
          }
        }
      },
      {
        $addFields: {
          hasLRun: { $cond: [{ $ifNull: ['$lRun', false] }, true, false] },
          lBoxes: { $ifNull: ['$lRun.boxes', []] },
          // „Vögel“: confirmed + noch offen — keine no_pigeon
          birdCount: {
            $cond: [
              { $gt: [{ $size: '$birds' }, 0] },
              {
                $size: {
                  $filter: {
                    input: '$birds',
                    as: 'bird',
                    cond: { $ne: ['$$bird.review.status', 'no_pigeon'] }
                  }
                }
              },
              {
                $cond: [
                  { $eq: ['$classification_status', 'no_pigeon'] },
                  0,
                  {
                    $size: {
                      $filter: {
                        input: '$detections',
                        as: 'det',
                        cond: {
                          $in: [
                            { $toLower: { $ifNull: ['$$det.class', ''] } },
                            BIRD_CLASSES
                          ]
                        }
                      }
                    }
                  }
                ]
              }
            ]
          },
          confirmedCount: {
            $cond: [
              { $gt: [{ $size: '$birds' }, 0] },
              { $size: '$confirmedBirdsList' },
              { $cond: [{ $eq: ['$classification_status', 'confirmed_pigeon'] }, 1, 0] }
            ]
          },
          tooFarCount: { $size: '$tooFarBirdsList' },
          sideCount: { $size: '$sideBirdsList' }
        }
      },
      {
        $addFields: {
          lMatchedIds: {
            $setUnion: [
              {
                $map: {
                  input: {
                    $filter: {
                      input: '$lBoxes',
                      as: 'box',
                      cond: {
                        $and: [
                          { $ne: ['$$box.bird_id', null] },
                          { $ne: ['$$box.bird_id', ''] }
                        ]
                      }
                    }
                  },
                  as: 'box',
                  in: '$$box.bird_id'
                }
              },
              []
            ]
          },
          openNewLBoxes: {
            $filter: {
              input: '$lBoxes',
              as: 'box',
              cond: {
                $and: [
                  {
                    $or: [
                      { $eq: ['$$box.bird_id', null] },
                      { $eq: ['$$box.bird_id', ''] },
                      { $not: [{ $ifNull: ['$$box.bird_id', false] }] }
                    ]
                  },
                  {
                    $not: {
                      $in: [
                        { $ifNull: ['$$box.review.status', null] },
                        ['confirmed_pigeon', 'no_pigeon']
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          newLBoxCount: { $size: '$openNewLBoxes' },
          confirmedMatched: {
            $size: {
              $filter: {
                input: '$confirmedMainBirdsList',
                as: 'bird',
                cond: { $in: ['$$bird.bird_id', '$lMatchedIds'] }
              }
            }
          },
          confirmedMissed: {
            $cond: [
              '$hasLRun',
              {
                $size: {
                  $filter: {
                    input: '$confirmedMainBirdsList',
                    as: 'bird',
                    cond: { $not: [{ $in: ['$$bird.bird_id', '$lMatchedIds'] }] }
                  }
                }
              },
              0
            ]
          },
          confirmedPending: {
            $cond: [
              '$hasLRun',
              0,
              {
                $cond: [
                  { $gt: [{ $size: '$birds' }, 0] },
                  { $size: '$confirmedMainBirdsList' },
                  { $cond: [{ $eq: ['$classification_status', 'confirmed_pigeon'] }, 1, 0] }
                ]
              }
            ]
          },
          sideMatched: {
            $cond: [
              '$hasLRun',
              {
                $size: {
                  $filter: {
                    input: '$sideBirdsList',
                    as: 'bird',
                    cond: { $in: ['$$bird.bird_id', '$lMatchedIds'] }
                  }
                }
              },
              0
            ]
          },
          sideUnmatched: {
            $cond: [
              '$hasLRun',
              {
                $size: {
                  $filter: {
                    input: '$sideBirdsList',
                    as: 'bird',
                    cond: { $not: [{ $in: ['$$bird.bird_id', '$lMatchedIds'] }] }
                  }
                }
              },
              0
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          images: { $sum: { $cond: ['$hasImage', 1, 0] } },
          birds: { $sum: '$birdCount' },
          confirmedBirds: { $sum: '$confirmedCount' },
          tooFarBirds: { $sum: '$tooFarCount' },
          sideBirds: { $sum: '$sideCount' },
          lDone: { $sum: { $cond: ['$hasLRun', 1, 0] } },
          lPending: { $sum: { $cond: ['$hasLRun', 0, 1] } },
          confirmedMainMatched: { $sum: '$confirmedMatched' },
          confirmedMainMissed: { $sum: '$confirmedMissed' },
          confirmedMainPendingL: { $sum: '$confirmedPending' },
          sideMatched: { $sum: '$sideMatched' },
          sideUnmatched: { $sum: '$sideUnmatched' },
          newLBoxes: { $sum: { $cond: ['$hasLRun', '$newLBoxCount', 0] } }
        }
      }
    ]).allowDiskUse(true);

    res.json({
      images: row?.images || 0,
      birds: row?.birds || 0,
      confirmedBirds: row?.confirmedBirds || 0,
      tooFarBirds: row?.tooFarBirds || 0,
      sideBirds: row?.sideBirds || 0,
      replayModels,
      selectedModel: preferred,
      lModel: preferred,
      lReplay: {
        done: row?.lDone || 0,
        pending: row?.lPending || 0,
        confirmedMainMatched: row?.confirmedMainMatched || 0,
        confirmedMainMissed: row?.confirmedMainMissed || 0,
        confirmedMainPendingL: row?.confirmedMainPendingL || 0,
        sideMatched: row?.sideMatched || 0,
        sideUnmatched: row?.sideUnmatched || 0,
        newLBoxes: row?.newLBoxes || 0
      }
    });
  } catch (error) {
    logger.error('Dataset stats error:', error);
    res.status(500).json({ error: 'Kennzahlen konnten nicht geladen werden' });
  }
});

router.get('/dataset/export-preview', authenticateToken, async (req, res) => {
  try {
    const preview = await buildPreview(req.user.userId, req.query.valRatio);
    res.json(preview);
  } catch (error) {
    logger.error('Export preview error:', error);
    res.status(500).json({ error: 'Export-Vorschau fehlgeschlagen' });
  }
});

router.get('/dataset/export', authenticateToken, (req, res) => {
  res.json(getExportStatus());
});

router.post('/dataset/export', authenticateToken, (req, res) => {
  try {
    res.status(202).json(startExport(req.user.userId, {
      valRatio: req.body?.valRatio ?? req.query.valRatio,
      uploadToColab: Boolean(req.body?.uploadToColab),
      uploadToDrive: Boolean(req.body?.uploadToDrive),
      driveFolderUrl: req.body?.driveFolderUrl || req.body?.folderUrl || ''
    }));
  } catch (error) {
    logger.error('Start export error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

router.post('/dataset/export/stop', authenticateToken, (req, res) => {
  res.json(requestExportStop());
});

router.get('/dataset/export/download', authenticateToken, (req, res) => {
  const file = getDownloadPath(req.user.userId);
  if (!file) {
    return res.status(404).json({ error: 'Kein Export zum Download bereit' });
  }
  res.download(file.path, file.name);
});

router.post('/dataset/export/colab-upload', authenticateToken, async (req, res) => {
  try {
    if (!isS3Configured()) {
      return res.status(503).json({
        error: 'S3 nicht konfiguriert (DATASET_S3_BUCKET in server/.env setzen)'
      });
    }
    const state = await uploadCurrentExportForColab(req.user.userId);
    res.json(state);
  } catch (error) {
    logger.error('Colab upload error:', error);
    res.status(error.statusCode || 500).json({
      ...getExportStatus(),
      error: error.message || 'Colab-Upload fehlgeschlagen'
    });
  }
});

router.post('/dataset/export/drive-upload', authenticateToken, async (req, res) => {
  try {
    const cfg = driveConfig();
    if (!cfg.credentialsReady) {
      return res.status(503).json({
        error: 'Google Drive Credentials fehlen (GOOGLE_DRIVE_CREDENTIALS_JSON in server/.env setzen)'
      });
    }
    const state = await uploadCurrentExportToDrive(req.user.userId, {
      folderUrl: req.body?.folderUrl || req.body?.driveFolderUrl || '',
      folderId: req.body?.folderId || ''
    });
    res.json(state);
  } catch (error) {
    logger.error('Drive upload error:', error);
    res.status(error.statusCode || 500).json({
      ...getExportStatus(),
      error: error.message || 'Drive-Upload fehlgeschlagen'
    });
  }
});

router.get('/dataset/esp-targets', authenticateToken, async (req, res) => {
  try {
    const targets = await listEspP4Targets(req.user.userId);
    res.json({ targets });
  } catch (error) {
    logger.error('ESP targets error:', error);
    res.status(500).json({ error: 'ESP-P4-Ziele konnten nicht geladen werden' });
  }
});

router.get('/dataset/esp-targets/:deviceId/health', authenticateToken, async (req, res) => {
  try {
    const target = await resolveEspP4Target(
      req.user.userId,
      req.params.deviceId,
      req.query.cameraId
    );
    if (!target) {
      return res.status(404).json({ error: 'ESP-P4-Ziel nicht gefunden' });
    }
    const response = await axios.get(`${target.baseUrl}/health`, {
      timeout: 8000,
      validateStatus: () => true
    });
    res.status(response.status >= 400 ? 502 : 200).json({
      target,
      httpStatus: response.status,
      health: response.data
    });
  } catch (error) {
    logger.error('ESP health proxy error:', error.message);
    res.status(502).json({ error: error.message || 'ESP-P4 nicht erreichbar' });
  }
});

router.post(
  '/dataset/esp-targets/:deviceId/ota',
  authenticateToken,
  otaUpload.single('firmware'),
  async (req, res) => {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Firmware-.bin fehlt (Feld firmware)' });
      }
      if (req.file.buffer[0] !== 0xE9) {
        return res.status(400).json({ error: 'Keine ESP-App-Image (Magic 0xE9 erwartet)' });
      }
      const target = await resolveEspP4Target(
        req.user.userId,
        req.params.deviceId,
        req.query.cameraId || req.body?.cameraId
      );
      if (!target) {
        return res.status(404).json({ error: 'ESP-P4-Ziel nicht gefunden' });
      }
      const response = await axios.post(`${target.baseUrl}/ota`, req.file.buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': req.file.buffer.length
        },
        timeout: 300000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
      });
      if (response.status >= 400) {
        const detail = typeof response.data === 'string'
          ? response.data
          : (response.data?.error || `HTTP ${response.status}`);
        return res.status(502).json({ error: `OTA fehlgeschlagen: ${detail}`, target });
      }
      res.json({
        ok: true,
        target,
        bytes: req.file.buffer.length,
        device: response.data
      });
    } catch (error) {
      logger.error('ESP OTA proxy error:', error.message);
      res.status(502).json({ error: error.message || 'OTA fehlgeschlagen' });
    }
  }
);

router.get('/dataset/benchmark', authenticateToken, (req, res) => {
  res.json(getBenchmarkStatus());
});

router.get('/dataset/benchmark/baselines', authenticateToken, (req, res) => {
  res.json({
    baselines: listBaselines(),
    datasets: listDatasetZips().map((z) => ({
      stem: z.stem,
      file: z.file,
      bytes: z.bytes
    })),
    nas: nasTrainingStatus()
  });
});

router.get('/dataset/benchmark/nas', authenticateToken, (req, res) => {
  res.json({
    ...nasTrainingStatus(),
    datasets: listDatasetZips().map((z) => ({
      stem: z.stem,
      file: z.file,
      bytes: z.bytes
    }))
  });
});

router.get('/dataset/benchmark/history', authenticateToken, (req, res) => {
  const runName = typeof req.query?.runName === 'string' ? req.query.runName.trim() : '';
  if (!runName) {
    return res.status(400).json({ error: 'runName erforderlich' });
  }
  const limit = Number(req.query?.limit) || 10;
  const file = typeof req.query?.file === 'string' ? req.query.file.trim() : '';
  if (file) {
    const detail = getHostValDetail(runName, file);
    if (!detail) {
      return res.status(404).json({ error: 'Benchmark-Datei nicht gefunden' });
    }
    return res.json({ runName, result: detail });
  }
  res.json({
    runName,
    latest: getLatestHostVal(runName),
    history: listHostValHistory(runName, { limit })
  });
});

router.post('/dataset/benchmark/stop', authenticateToken, (req, res) => {
  res.json(requestBenchmarkStop());
});

router.post('/dataset/benchmark/esp', authenticateToken, (req, res) => {
  try {
    const valSource = String(req.body?.valSource || 'frozen').toLowerCase();
    const preferLive = valSource === 'live';
    const datasetStemRaw = typeof req.body?.datasetStem === 'string'
      ? req.body.datasetStem.trim()
      : '';
    const datasetStem = preferLive ? null : (datasetStemRaw || null);
    const zip = datasetStem ? findDatasetZip(datasetStem) : null;
    if (!preferLive && datasetStem && !zip) {
      return res.status(404).json({
        error: `Trainingsdata-ZIP nicht auf NAS: ${datasetStem}`
      });
    }
    res.status(202).json(startEspBenchmark(req.user.userId, {
      deviceId: req.body?.deviceId,
      cameraId: req.body?.cameraId,
      valRatio: req.body?.valRatio,
      limit: req.body?.limit,
      datasetZipPath: preferLive ? null : (zip?.path || null),
      datasetStem: preferLive ? null : (zip?.stem || null)
    }));
  } catch (error) {
    logger.error('Start ESP benchmark error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

router.post('/dataset/benchmark/host', authenticateToken, (req, res) => {
  try {
    const baselineId = typeof req.body?.baselineId === 'string' ? req.body.baselineId.trim() : '';
    const baseline = baselineId ? getBaseline(baselineId) : null;
    if (!baseline || !baseline.present) {
      return res.status(404).json({
        error: 'Modell nicht gefunden — Trainingsdata + result/ auf der NAS wählen'
      });
    }
    const valSource = String(req.body?.valSource || 'frozen').toLowerCase();
    const preferLive = valSource === 'live';
    const datasetStemRaw = typeof req.body?.datasetStem === 'string'
      ? req.body.datasetStem.trim()
      : '';
    const datasetStem = preferLive
      ? null
      : (datasetStemRaw || baseline.datasetStem || null);
    const zip = datasetStem ? findDatasetZip(datasetStem) : null;
    if (!preferLive && datasetStem && !zip) {
      return res.status(404).json({
        error: `Trainingsdata-ZIP nicht auf NAS: ${datasetStem}`
      });
    }
    res.status(202).json(startHostBenchmark(req.user.userId, {
      valRatio: req.body?.valRatio,
      limit: req.body?.limit,
      weightsName: baseline.file || null,
      baselineId: baseline.id,
      baselineLabel: baseline.label || null,
      runName: baseline.runName || null,
      imgsz: baseline.imgsz || Number(req.body?.imgsz) || null,
      weightsPath: baseline.path,
      datasetZipPath: preferLive ? null : (zip?.path || null),
      datasetStem: preferLive ? null : (zip?.stem || null)
    }));
  } catch (error) {
    logger.error('Start host benchmark error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

router.get('/dataset/esp-export', authenticateToken, (req, res) => {
  res.json(getEspExportStatus());
});

router.post('/dataset/esp-export/stop', authenticateToken, (req, res) => {
  res.json(requestEspExportStop());
});

router.delete('/dataset/esp-export', authenticateToken, (req, res) => {
  try {
    res.json(clearEspExportStatus());
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Clear failed' });
  }
});

router.post('/dataset/esp-export', authenticateToken, (req, res) => {
  try {
    const baselineId = typeof req.body?.baselineId === 'string' ? req.body.baselineId.trim() : '';
    const baseline = baselineId ? getBaseline(baselineId) : null;
    if (!baseline || !baseline.present) {
      return res.status(404).json({
        error: 'Modell nicht gefunden — Trainingsdata + result/ auf der NAS wählen'
      });
    }
    const datasetStemRaw = typeof req.body?.datasetStem === 'string'
      ? req.body.datasetStem.trim()
      : '';
    const datasetStem = datasetStemRaw || baseline.datasetStem || null;
    const zip = datasetStem ? findDatasetZip(datasetStem) : null;
    if (!zip) {
      return res.status(404).json({
        error: datasetStem
          ? `Trainingsdata-ZIP nicht auf NAS: ${datasetStem}`
          : 'Trainingsdata-ZIP für Kalibrierung wählen'
      });
    }
    const targetRaw = String(req.body?.target || 'esp32p4').toLowerCase();
    const target = targetRaw === 'esp32s3' ? 'esp32s3' : 'esp32p4';
    res.status(202).json(startEspExport(req.user.userId, {
      weightsName: baseline.file || null,
      baselineId: baseline.id,
      baselineLabel: baseline.label || null,
      runName: baseline.runName || null,
      imgsz: baseline.imgsz || Number(req.body?.imgsz) || null,
      weightsPath: baseline.path,
      datasetZipPath: zip.path,
      datasetStem: zip.stem,
      target,
      calibLimit: req.body?.calibLimit
    }));
  } catch (error) {
    logger.error('Start ESP export error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

const L_REVIEW_CASES = {
  A: {
    id: 'A',
    label: 'War Taube — Modell findet sie nicht',
    color: '#ed6c02',
    bgcolor: '#fff3e0'
  },
  B: {
    id: 'B',
    label: 'Du: keine — Modell: doch',
    color: '#9c27b0',
    bgcolor: '#f3e5f5'
  },
  C: {
    id: 'C',
    label: 'Noch offen — Modell sieht eine',
    color: '#0288d1',
    bgcolor: '#e1f5fe'
  }
};

const SIDE_REVIEW_CASES = {
  A: {
    id: 'A',
    label: 'Side — Modell trifft',
    color: '#2e7d32',
    bgcolor: '#e8f5e9'
  },
  B: {
    id: 'B',
    label: 'Side — Modell verfehlt',
    color: '#ed6c02',
    bgcolor: '#fff3e0'
  }
};

const NEW_REVIEW_CASES = {
  Neu: {
    id: 'Neu',
    label: 'Neue Box vom Nebenmodell',
    color: '#0288d1',
    bgcolor: '#e1f5fe'
  }
};

function resolveReplayModel(modelId) {
  const replayModels = listModels()
    .filter((model) => model.role !== 'live')
    .map((model) => {
      const onnx = (model.artifacts || []).find((a) => a.runtime === 'onnx');
      return {
        id: model.id,
        name: model.name,
        present: Boolean(onnx?.present)
      };
    });
  const requestedId = typeof modelId === 'string' ? modelId.trim() : '';
  return replayModels.find((m) => m.id === requestedId && m.present)
    || replayModels.find((m) => m.id === 'yolo26l' && m.present)
    || replayModels.find((m) => m.id === 'yolov8l' && m.present)
    || replayModels.find((m) => m.present)
    || null;
}

async function userDeviceIds(userId) {
  const devices = await Device.find({ owner: userId }).select('_id');
  return devices.map((d) => d._id);
}

/** confirmed_pigeon birds whose relative short side is below minShortSide */
function sizeFilterCandidatesFromDoc(doc, minShortSide) {
  const items = [];
  if (!doc) return items;
  const imageInfo = doc.image_info || null;
  const birds = Array.isArray(doc.birds) ? doc.birds : [];

  for (const bird of birds) {
    if (bird?.review?.status !== 'confirmed_pigeon') continue;
    if (!bird.bird_id) continue;
    const bbox = bboxFromBird(bird);
    const ratio = shortSideRatio(bbox, imageInfo);
    if (ratio == null || ratio >= minShortSide) continue;
    items.push({
      detectionId: String(doc._id),
      birdId: bird.bird_id,
      role: bird.role || null,
      bird,
      shortSideRatio: ratio,
      image_info: imageInfo,
      processedAt: doc.processedAt || null
    });
  }
  return items;
}

async function loadSizeFilterCandidates(deviceIds, minShortSide, { limit = null, maxScan = 5000 } = {}) {
  if (!deviceIds.length) return { total: 0, items: [] };

  const query = {
    device: { $in: deviceIds },
    $or: [
      { 'birds.review.status': 'confirmed_pigeon' },
      { classification_status: 'confirmed_pigeon' }
    ]
  };

  const cursor = Detection.find(query)
    .select('_id birds image_info processedAt classification_status target_bird')
    .sort({ processedAt: -1 })
    .limit(maxScan)
    .lean()
    .cursor();

  const all = [];
  for await (const doc of cursor) {
    const found = sizeFilterCandidatesFromDoc(doc, minShortSide);
    for (const item of found) all.push(item);
  }

  all.sort((a, b) => {
    const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0;
    const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0;
    return tb - ta;
  });

  const total = all.length;
  const items = limit != null ? all.slice(0, limit) : all;
  return { total, items };
}

function cloneReview(review) {
  if (!review) return { status: null, source: null, at: null };
  return {
    status: review.status ?? null,
    source: review.source ?? null,
    at: review.at ? new Date(review.at) : null
  };
}

function applyLReviewToDoc(detection, { preferred, boxIndex, action }) {
  const reviewSource = `l-review:${preferred.name}`;
  const status = action === 'confirm_pigeon' ? 'confirmed_pigeon' : 'no_pigeon';
  const main = (detection.birds || []).find((bird) => bird.role === 'main');
  const undo = {
    kind: 'l-review',
    detectionId: String(detection._id),
    modelName: preferred.name,
    boxIndex,
    previous: {
      classification_status: detection.classification_status ?? null,
      classifiedAt: detection.classifiedAt || null,
      mainReview: cloneReview(main?.review),
      boxReview: null
    }
  };

  if (boxIndex === null) {
    applyMainReview(detection, { status, source: reviewSource, at: new Date() });
    return { reviewSource, status, boxIndex: null, undo };
  }
  const run = (detection.model_runs || []).find((entry) => entry?.model?.name === preferred.name);
  if (!run || !Array.isArray(run.boxes) || !run.boxes[boxIndex]) {
    throw Object.assign(new Error('L-Box nicht gefunden'), { statusCode: 400 });
  }
  undo.previous.boxReview = cloneReview(run.boxes[boxIndex].review);
  run.boxes[boxIndex].review = { status, source: reviewSource, at: new Date() };
  if (status === 'confirmed_pigeon') {
    applyMainReview(detection, { status, source: reviewSource, at: new Date() });
  } else {
    const allBoxesReviewedNo = run.boxes.every((box) => (
      box?.review?.source === reviewSource && box?.review?.status === 'no_pigeon'
    ));
    if (allBoxesReviewedNo) {
      applyMainReview(detection, { status: 'no_pigeon', source: reviewSource, at: new Date() });
    }
  }
  if (typeof detection.markModified === 'function') {
    detection.markModified('model_runs');
  }
  return { reviewSource, status, boxIndex, undo };
}

function restoreLReviewUndo(detection, undo) {
  const prev = undo?.previous || {};
  const mainReview = cloneReview(prev.mainReview);
  applyMainReview(detection, {
    status: mainReview.status,
    source: mainReview.source || 'tinder',
    at: mainReview.at
  });
  detection.classification_status = prev.classification_status ?? null;
  detection.classifiedAt = prev.classifiedAt ? new Date(prev.classifiedAt) : null;
  const main = (detection.birds || []).find((bird) => bird.role === 'main');
  if (main) {
    main.review = cloneReview(prev.mainReview);
  }

  if (undo.boxIndex !== null && undo.boxIndex !== undefined) {
    const run = (detection.model_runs || []).find((entry) => entry?.model?.name === undo.modelName);
    if (!run || !Array.isArray(run.boxes) || !run.boxes[undo.boxIndex]) {
      throw Object.assign(new Error('L-Box nicht gefunden'), { statusCode: 400 });
    }
    run.boxes[undo.boxIndex].review = cloneReview(prev.boxReview);
    if (typeof detection.markModified === 'function') {
      detection.markModified('model_runs');
    }
  }
}

function applySideReviewWithUndo(detection, { preferred, birdId, action }) {
  const reviewSource = `side-review:${preferred.name}`;
  const status = action === 'confirm_pigeon' ? 'confirmed_pigeon' : 'no_pigeon';
  const bird = (detection.birds || []).find((entry) => entry.role === 'side' && entry.bird_id === birdId);
  if (!bird) {
    throw Object.assign(new Error('Side-Vogel nicht gefunden'), { statusCode: 400 });
  }
  const undo = {
    kind: 'side-review',
    detectionId: String(detection._id),
    modelName: preferred.name,
    birdId,
    previous: { sideReview: cloneReview(bird.review) }
  };
  applySideReview(detection, { birdId, status, source: reviewSource, at: new Date() });
  return { reviewSource, status, birdId, bird, undo };
}

function restoreSideReviewUndo(detection, undo) {
  const birdId = undo?.birdId;
  const prev = cloneReview(undo?.previous?.sideReview);
  const bird = applySideReview(detection, {
    birdId,
    status: prev.status,
    source: prev.source || 'side-review',
    at: prev.at
  });
  if (!bird) {
    throw Object.assign(new Error('Side-Vogel nicht gefunden'), { statusCode: 400 });
  }
  // applySideReview mit null-status setzt source auf null — passt für „noch offen“
  if (!prev.status) {
    bird.review = { status: null, source: null, at: null };
  }
  return bird;
}

async function fetchLReviewTargets({ deviceIds, modelName, reviewSource, caseId, limit }) {
  const pipeline = [
    {
      $match: {
        device: { $in: deviceIds },
        model_runs: { $elemMatch: { 'model.name': modelName } }
      }
    },
    {
      $project: {
        birds: { $ifNull: ['$birds', []] },
        classification_status: 1,
        model_runs: {
          $filter: {
            input: { $ifNull: ['$model_runs', []] },
            as: 'run',
            cond: { $eq: ['$$run.model.name', modelName] }
          }
        }
      }
    },
    {
      $addFields: {
        lRun: { $arrayElemAt: ['$model_runs', 0] },
        mainBird: {
          $first: {
            $filter: {
              input: '$birds',
              as: 'bird',
              cond: { $eq: ['$$bird.role', 'main'] }
            }
          }
        }
      }
    },
    {
      $addFields: {
        mainStatus: { $ifNull: ['$mainBird.review.status', '$classification_status'] },
        lBoxCount: { $size: { $ifNull: ['$lRun.boxes', []] } },
        lMatchedIds: {
          $setUnion: [
            {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ['$lRun.boxes', []] },
                    as: 'box',
                    cond: {
                      $and: [
                        { $ne: ['$$box.bird_id', null] },
                        { $ne: ['$$box.bird_id', ''] }
                      ]
                    }
                  }
                },
                as: 'box',
                in: '$$box.bird_id'
              }
            },
            []
          ]
        }
      }
    },
    {
      $addFields: {
        mainMatched: {
          $cond: [
            { $and: [{ $ne: ['$mainBird.bird_id', null] }, { $in: ['$mainBird.bird_id', '$lMatchedIds'] }] },
            true,
            false
          ]
        }
      }
    },
    {
      $addFields: {
        caseId: {
          $switch: {
            branches: [
              {
                case: {
                  $and: [
                    { $eq: ['$mainStatus', 'confirmed_pigeon'] },
                    { $eq: ['$mainMatched', false] }
                  ]
                },
                then: 'A'
              },
              {
                case: {
                  $and: [
                    { $eq: ['$mainStatus', 'no_pigeon'] },
                    { $gt: ['$lBoxCount', 0] }
                  ]
                },
                then: 'B'
              },
              {
                case: {
                  $and: [
                    {
                      $or: [
                        { $eq: ['$mainStatus', null] },
                        { $eq: ['$mainStatus', 'unclassified'] },
                        { $not: [{ $ifNull: ['$mainStatus', false] }] }
                      ]
                    },
                    { $gt: ['$lBoxCount', 0] }
                  ]
                },
                then: 'C'
              }
            ],
            default: null
          }
        }
      }
    },
    { $match: { caseId } }
  ];

  if (caseId === 'A') {
    pipeline.push(
      {
        $match: {
          $expr: { $ne: [{ $ifNull: ['$mainBird.review.source', ''] }, reviewSource] }
        }
      },
      { $limit: limit },
      { $project: { _id: 1, boxIndex: { $literal: null } } }
    );
  } else {
    pipeline.push(
      { $unwind: { path: '$lRun.boxes', includeArrayIndex: 'boxIndex' } },
      {
        $match: {
          'lRun.boxes.bbox': { $exists: true },
          $expr: { $ne: [{ $ifNull: ['$lRun.boxes.review.source', ''] }, reviewSource] }
        }
      },
      { $limit: limit },
      { $project: { _id: 1, boxIndex: 1 } }
    );
  }

  return Detection.aggregate(pipeline).allowDiskUse(true);
}

async function fetchSideReviewTargets({ deviceIds, modelName, reviewSource, caseId, limit }) {
  return Detection.aggregate([
    {
      $match: {
        device: { $in: deviceIds },
        model_runs: { $elemMatch: { 'model.name': modelName } },
        'birds.role': 'side'
      }
    },
    {
      $project: {
        birds: { $ifNull: ['$birds', []] },
        model_runs: {
          $filter: {
            input: { $ifNull: ['$model_runs', []] },
            as: 'run',
            cond: { $eq: ['$$run.model.name', modelName] }
          }
        }
      }
    },
    {
      $addFields: {
        lRun: { $arrayElemAt: ['$model_runs', 0] },
        sideBirdsList: {
          $filter: {
            input: '$birds',
            as: 'bird',
            cond: { $eq: ['$$bird.role', 'side'] }
          }
        }
      }
    },
    {
      $addFields: {
        lMatchedIds: {
          $setUnion: [
            {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ['$lRun.boxes', []] },
                    as: 'box',
                    cond: {
                      $and: [
                        { $ne: ['$$box.bird_id', null] },
                        { $ne: ['$$box.bird_id', ''] }
                      ]
                    }
                  }
                },
                as: 'box',
                in: '$$box.bird_id'
              }
            },
            []
          ]
        }
      }
    },
    { $unwind: '$sideBirdsList' },
    {
      $addFields: {
        caseId: {
          $cond: [
            { $in: ['$sideBirdsList.bird_id', '$lMatchedIds'] },
            'A',
            'B'
          ]
        },
        alreadyReviewed: {
          $or: [
            { $eq: [{ $ifNull: ['$sideBirdsList.review.source', ''] }, reviewSource] },
            {
              $in: [
                { $ifNull: ['$sideBirdsList.review.status', null] },
                ['confirmed_pigeon', 'no_pigeon']
              ]
            }
          ]
        }
      }
    },
    {
      $match: {
        alreadyReviewed: false,
        caseId
      }
    },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        birdId: '$sideBirdsList.bird_id'
      }
    }
  ]).allowDiskUse(true);
}

router.get('/dataset/l-review', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.query.modelId);
    if (!preferred) {
      return res.json({ model: null, total: 0, items: [], cases: L_REVIEW_CASES });
    }

    const devices = await Device.find({ owner: req.user.userId }).select('_id name');
    const deviceIds = devices.map((d) => d._id);
    const deviceNameById = new Map(devices.map((d) => [d._id.toString(), d.name || 'Gerät']));
    if (deviceIds.length === 0) {
      return res.json({ model: preferred, total: 0, items: [], cases: L_REVIEW_CASES });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const reviewSource = `l-review:${preferred.name}`;
    const modelName = preferred.name;

    const rows = await Detection.aggregate([
      {
        $match: {
          device: { $in: deviceIds },
          model_runs: { $elemMatch: { 'model.name': modelName } }
        }
      },
      {
        $project: {
          device: 1,
          processedAt: 1,
          classification_status: 1,
          image_info: 1,
          birds: { $ifNull: ['$birds', []] },
          detections: { $ifNull: ['$detections', []] },
          target_bird: 1,
          model_runs: {
            $filter: {
              input: { $ifNull: ['$model_runs', []] },
              as: 'run',
              cond: { $eq: ['$$run.model.name', modelName] }
            }
          }
        }
      },
      {
        $addFields: {
          lRun: { $arrayElemAt: ['$model_runs', 0] },
          mainBird: {
            $first: {
              $filter: {
                input: '$birds',
                as: 'bird',
                cond: { $eq: ['$$bird.role', 'main'] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          mainStatus: {
            $ifNull: ['$mainBird.review.status', '$classification_status']
          },
          lBoxCount: { $size: { $ifNull: ['$lRun.boxes', []] } },
          lMatchedIds: {
            $setUnion: [
              {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ['$lRun.boxes', []] },
                      as: 'box',
                      cond: {
                        $and: [
                          { $ne: ['$$box.bird_id', null] },
                          { $ne: ['$$box.bird_id', ''] }
                        ]
                      }
                    }
                  },
                  as: 'box',
                  in: '$$box.bird_id'
                }
              },
              []
            ]
          }
        }
      },
      {
        $addFields: {
          mainMatched: {
            $cond: [
              { $and: [{ $ne: ['$mainBird.bird_id', null] }, { $in: ['$mainBird.bird_id', '$lMatchedIds'] }] },
              true,
              false
            ]
          }
        }
      },
      {
        $addFields: {
          caseId: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      { $eq: ['$mainStatus', 'confirmed_pigeon'] },
                      { $eq: ['$mainMatched', false] }
                    ]
                  },
                  then: 'A'
                },
                {
                  case: {
                    $and: [
                      { $eq: ['$mainStatus', 'no_pigeon'] },
                      { $gt: ['$lBoxCount', 0] }
                    ]
                  },
                  then: 'B'
                },
                {
                  case: {
                    $and: [
                      {
                        $or: [
                          { $eq: ['$mainStatus', null] },
                          { $eq: ['$mainStatus', 'unclassified'] },
                          { $not: [{ $ifNull: ['$mainStatus', false] }] }
                        ]
                      },
                      { $gt: ['$lBoxCount', 0] }
                    ]
                  },
                  then: 'C'
                }
              ],
              default: null
            }
          }
        }
      },
      { $match: { caseId: { $in: ['A', 'B', 'C'] } } },
      {
        $facet: {
          aCount: [
            {
              $match: {
                caseId: 'A',
                $expr: {
                  $ne: [{ $ifNull: ['$mainBird.review.source', ''] }, reviewSource]
                }
              }
            },
            { $count: 'n' }
          ],
          a: [
            {
              $match: {
                caseId: 'A',
                $expr: {
                  $ne: [{ $ifNull: ['$mainBird.review.source', ''] }, reviewSource]
                }
              }
            },
            { $sort: { processedAt: -1 } },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                device: 1,
                processedAt: 1,
                classification_status: 1,
                image_info: 1,
                birds: 1,
                detections: 1,
                target_bird: 1,
                caseId: 1,
                mainBird: 1
              }
            }
          ],
          bCount: [
            { $match: { caseId: 'B' } },
            { $unwind: { path: '$lRun.boxes', includeArrayIndex: 'boxIndex' } },
            {
              $match: {
                'lRun.boxes.bbox': { $exists: true },
                $expr: {
                  $ne: [{ $ifNull: ['$lRun.boxes.review.source', ''] }, reviewSource]
                }
              }
            },
            { $count: 'n' }
          ],
          cCount: [
            { $match: { caseId: 'C' } },
            { $unwind: { path: '$lRun.boxes', includeArrayIndex: 'boxIndex' } },
            {
              $match: {
                'lRun.boxes.bbox': { $exists: true },
                $expr: {
                  $ne: [{ $ifNull: ['$lRun.boxes.review.source', ''] }, reviewSource]
                }
              }
            },
            { $count: 'n' }
          ],
          bcItems: [
            { $match: { caseId: { $in: ['B', 'C'] } } },
            { $unwind: { path: '$lRun.boxes', includeArrayIndex: 'boxIndex' } },
            {
              $match: {
                'lRun.boxes.bbox': { $exists: true },
                $expr: {
                  $ne: [{ $ifNull: ['$lRun.boxes.review.source', ''] }, reviewSource]
                }
              }
            },
            {
              $addFields: {
                caseOrder: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$caseId', 'B'] }, then: 1 },
                      { case: { $eq: ['$caseId', 'C'] }, then: 2 }
                    ],
                    default: 9
                  }
                }
              }
            },
            { $sort: { caseOrder: 1, processedAt: -1, boxIndex: 1 } },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                device: 1,
                processedAt: 1,
                classification_status: 1,
                image_info: 1,
                birds: 1,
                detections: 1,
                target_bird: 1,
                caseId: 1,
                boxIndex: 1,
                lBox: '$lRun.boxes',
                mainBird: 1
              }
            }
          ]
        }
      }
    ]).allowDiskUse(true);

    const facet = rows[0] || { aCount: [], a: [], bCount: [], cCount: [], bcItems: [] };

    const caseTotals = {
      A: facet.aCount?.[0]?.n || 0,
      B: facet.bCount?.[0]?.n || 0,
      C: facet.cCount?.[0]?.n || 0
    };

    const mapA = (facet.a || []).map((doc) => {
      const detectionId = String(doc._id);
      return {
        id: `${detectionId}:main`,
        detectionId,
        boxIndex: null,
        tinder: false,
        caseId: 'A',
        case: L_REVIEW_CASES.A,
        processedAt: doc.processedAt,
        deviceName: deviceNameById.get(String(doc.device)) || 'Gerät',
        classification_status: doc.classification_status ?? null,
        image_info: doc.image_info || null,
        mainBird: doc.mainBird || null,
        target_bird: doc.target_bird || null,
        detections: doc.detections || [],
        lBox: null,
        lBoxes: []
      };
    });

    const mapBc = (facet.bcItems || []).map((doc) => {
      const detectionId = String(doc._id);
      const boxIndex = Number(doc.boxIndex) || 0;
      return {
        id: `${detectionId}:${boxIndex}`,
        detectionId,
        boxIndex,
        tinder: true,
        caseId: doc.caseId,
        case: L_REVIEW_CASES[doc.caseId],
        processedAt: doc.processedAt,
        deviceName: deviceNameById.get(String(doc.device)) || 'Gerät',
        classification_status: doc.classification_status ?? null,
        image_info: doc.image_info || null,
        mainBird: doc.mainBird || null,
        target_bird: doc.target_bird || null,
        detections: doc.detections || [],
        lBox: doc.lBox || null,
        lBoxes: doc.lBox ? [doc.lBox] : []
      };
    });

    const items = [...mapA, ...mapBc];
    const total = caseTotals.A + caseTotals.B + caseTotals.C;
    const tinderTotal = caseTotals.B + caseTotals.C;

    res.json({
      model: preferred,
      total,
      tinderTotal,
      caseTotals,
      loaded: { A: mapA.length, B: mapBc.filter((i) => i.caseId === 'B').length, C: mapBc.filter((i) => i.caseId === 'C').length },
      items,
      cases: L_REVIEW_CASES
    });
  } catch (error) {
    logger.error('L-review queue error:', error);
    res.status(500).json({ error: 'Review-Liste konnte nicht geladen werden' });
  }
});

router.post('/dataset/l-review/accept-all', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }
    const caseId = String(req.body?.caseId || '').toUpperCase();
    if (!['A', 'B', 'C'].includes(caseId)) {
      return res.status(400).json({ error: 'caseId muss A, B oder C sein' });
    }
    const action = req.body?.action || 'confirm_pigeon';
    if (!['confirm_pigeon', 'no_pigeon'].includes(action)) {
      return res.status(400).json({ error: 'action muss confirm_pigeon oder no_pigeon sein' });
    }

    const deviceIds = await userDeviceIds(req.user.userId);
    if (deviceIds.length === 0) {
      return res.json({ ok: true, accepted: 0, errors: 0, caseId });
    }

    const reviewSource = `l-review:${preferred.name}`;
    const batchSize = 100;
    let accepted = 0;
    let errors = 0;

    for (;;) {
      const targets = await fetchLReviewTargets({
        deviceIds,
        modelName: preferred.name,
        reviewSource,
        caseId,
        limit: batchSize
      });
      if (!targets.length) break;

      for (const target of targets) {
        try {
          const detection = await Detection.findById(target._id).populate('device', 'owner');
          if (!detection?.device || detection.device.owner.toString() !== req.user.userId) {
            errors += 1;
            continue;
          }
          const boxIndex = caseId === 'A' ? null : Number(target.boxIndex);
          if (caseId !== 'A' && !Number.isInteger(boxIndex)) {
            errors += 1;
            continue;
          }
          applyLReviewToDoc(detection, { preferred, boxIndex, action });
          await detection.save();
          accepted += 1;
        } catch (err) {
          errors += 1;
          logger.warn('L-review accept-all item failed:', err.message);
        }
      }
      if (targets.length < batchSize) break;
    }

    res.json({ ok: true, accepted, errors, caseId, action });
  } catch (error) {
    logger.error('L-review accept-all error:', error);
    res.status(500).json({ error: 'Massen-Akzeptieren fehlgeschlagen' });
  }
});

router.post('/dataset/l-review/undo', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }
    const undo = req.body?.undo;
    if (!undo || undo.kind !== 'l-review' || !undo.detectionId) {
      return res.status(400).json({ error: 'undo-Payload ungültig' });
    }
    if (undo.modelName && undo.modelName !== preferred.name) {
      return res.status(400).json({ error: 'Undo gehört zu einem anderen Modell' });
    }

    const detection = await Detection.findById(undo.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    restoreLReviewUndo(detection, { ...undo, modelName: preferred.name });
    await detection.save();
    res.json({
      ok: true,
      detectionId: String(detection._id),
      classification_status: detection.classification_status
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('L-review undo error:', error);
    res.status(500).json({ error: 'Undo fehlgeschlagen' });
  }
});

router.post('/dataset/l-review/:detectionId', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }

    const action = req.body?.action;
    if (!['confirm_pigeon', 'no_pigeon'].includes(action)) {
      return res.status(400).json({ error: 'action muss confirm_pigeon oder no_pigeon sein' });
    }

    const boxIndexRaw = req.body?.boxIndex;
    const boxIndex = boxIndexRaw === null || boxIndexRaw === undefined || boxIndexRaw === ''
      ? null
      : Number(boxIndexRaw);
    if (boxIndex !== null && (!Number.isInteger(boxIndex) || boxIndex < 0)) {
      return res.status(400).json({ error: 'boxIndex ungültig' });
    }

    const detection = await Detection.findById(req.params.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = applyLReviewToDoc(detection, { preferred, boxIndex, action });
    await detection.save();

    res.json({
      ok: true,
      detectionId: String(detection._id),
      boxIndex: result.boxIndex,
      classification_status: detection.classification_status,
      source: result.reviewSource,
      undo: result.undo
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('L-review decide error:', error);
    res.status(500).json({ error: 'Entscheidung konnte nicht gespeichert werden' });
  }
});

router.get('/dataset/side-review', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.query.modelId);
    if (!preferred) {
      return res.json({ model: null, total: 0, items: [], cases: SIDE_REVIEW_CASES });
    }

    const devices = await Device.find({ owner: req.user.userId }).select('_id name');
    const deviceIds = devices.map((d) => d._id);
    const deviceNameById = new Map(devices.map((d) => [d._id.toString(), d.name || 'Gerät']));
    if (deviceIds.length === 0) {
      return res.json({ model: preferred, total: 0, items: [], cases: SIDE_REVIEW_CASES });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const reviewSource = `side-review:${preferred.name}`;
    const modelName = preferred.name;

    const rows = await Detection.aggregate([
      {
        $match: {
          device: { $in: deviceIds },
          model_runs: { $elemMatch: { 'model.name': modelName } },
          'birds.role': 'side'
        }
      },
      {
        $project: {
          device: 1,
          processedAt: 1,
          classification_status: 1,
          image_info: 1,
          birds: { $ifNull: ['$birds', []] },
          detections: { $ifNull: ['$detections', []] },
          target_bird: 1,
          model_runs: {
            $filter: {
              input: { $ifNull: ['$model_runs', []] },
              as: 'run',
              cond: { $eq: ['$$run.model.name', modelName] }
            }
          }
        }
      },
      {
        $addFields: {
          lRun: { $arrayElemAt: ['$model_runs', 0] },
          sideBirdsList: {
            $filter: {
              input: '$birds',
              as: 'bird',
              cond: { $eq: ['$$bird.role', 'side'] }
            }
          }
        }
      },
      {
        $addFields: {
          lMatchedIds: {
            $setUnion: [
              {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ['$lRun.boxes', []] },
                      as: 'box',
                      cond: {
                        $and: [
                          { $ne: ['$$box.bird_id', null] },
                          { $ne: ['$$box.bird_id', ''] }
                        ]
                      }
                    }
                  },
                  as: 'box',
                  in: '$$box.bird_id'
                }
              },
              []
            ]
          }
        }
      },
      { $unwind: '$sideBirdsList' },
      {
        $addFields: {
          sideMatched: { $in: ['$sideBirdsList.bird_id', '$lMatchedIds'] },
          caseId: {
            $cond: [
              { $in: ['$sideBirdsList.bird_id', '$lMatchedIds'] },
              'A',
              'B'
            ]
          },
          alreadyReviewed: {
            $or: [
              { $eq: [{ $ifNull: ['$sideBirdsList.review.source', ''] }, reviewSource] },
              {
                $in: [
                  { $ifNull: ['$sideBirdsList.review.status', null] },
                  ['confirmed_pigeon', 'no_pigeon']
                ]
              }
            ]
          },
          lBox: {
            $first: {
              $filter: {
                input: { $ifNull: ['$lRun.boxes', []] },
                as: 'box',
                cond: { $eq: ['$$box.bird_id', '$sideBirdsList.bird_id'] }
              }
            }
          }
        }
      },
      {
        $match: {
          alreadyReviewed: false,
          caseId: { $in: ['A', 'B'] }
        }
      },
      {
        $facet: {
          aCount: [{ $match: { caseId: 'A' } }, { $count: 'n' }],
          bCount: [{ $match: { caseId: 'B' } }, { $count: 'n' }],
          aItems: [
            { $match: { caseId: 'A' } },
            { $sort: { processedAt: -1 } },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                device: 1,
                processedAt: 1,
                classification_status: 1,
                image_info: 1,
                detections: 1,
                target_bird: 1,
                caseId: 1,
                sideBird: '$sideBirdsList',
                lBox: 1
              }
            }
          ],
          bItems: [
            { $match: { caseId: 'B' } },
            { $sort: { processedAt: -1 } },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                device: 1,
                processedAt: 1,
                classification_status: 1,
                image_info: 1,
                detections: 1,
                target_bird: 1,
                caseId: 1,
                sideBird: '$sideBirdsList',
                lBox: 1
              }
            }
          ]
        }
      }
    ]).allowDiskUse(true);

    const facet = rows[0] || { aCount: [], bCount: [], aItems: [], bItems: [] };
    const caseTotals = {
      A: facet.aCount?.[0]?.n || 0,
      B: facet.bCount?.[0]?.n || 0
    };

    const mapItem = (doc) => {
      const detectionId = String(doc._id);
      const birdId = doc.sideBird?.bird_id || 'side';
      return {
        id: `${detectionId}:${birdId}`,
        detectionId,
        birdId,
        boxIndex: null,
        tinder: true,
        caseId: doc.caseId,
        case: SIDE_REVIEW_CASES[doc.caseId],
        processedAt: doc.processedAt,
        deviceName: deviceNameById.get(String(doc.device)) || 'Gerät',
        classification_status: doc.classification_status ?? null,
        image_info: doc.image_info || null,
        sideBird: doc.sideBird || null,
        target_bird: doc.target_bird || null,
        detections: doc.detections || [],
        lBox: doc.lBox || null,
        lBoxes: doc.lBox ? [doc.lBox] : []
      };
    };

    const mapA = (facet.aItems || []).map(mapItem);
    const mapB = (facet.bItems || []).map(mapItem);
    const items = [...mapA, ...mapB];
    const total = caseTotals.A + caseTotals.B;

    res.json({
      model: preferred,
      total,
      tinderTotal: total,
      caseTotals,
      loaded: { A: mapA.length, B: mapB.length },
      items,
      cases: SIDE_REVIEW_CASES
    });
  } catch (error) {
    logger.error('Side-review queue error:', error);
    res.status(500).json({ error: 'Side-Review-Liste konnte nicht geladen werden' });
  }
});

router.post('/dataset/side-review/accept-all', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }
    const caseId = String(req.body?.caseId || '').toUpperCase();
    if (!['A', 'B'].includes(caseId)) {
      return res.status(400).json({ error: 'caseId muss A oder B sein' });
    }
    const action = req.body?.action || 'confirm_pigeon';
    if (!['confirm_pigeon', 'no_pigeon'].includes(action)) {
      return res.status(400).json({ error: 'action muss confirm_pigeon oder no_pigeon sein' });
    }

    const deviceIds = await userDeviceIds(req.user.userId);
    if (deviceIds.length === 0) {
      return res.json({ ok: true, accepted: 0, errors: 0, caseId });
    }

    const reviewSource = `side-review:${preferred.name}`;
    const status = action === 'confirm_pigeon' ? 'confirmed_pigeon' : 'no_pigeon';
    const batchSize = 100;
    let accepted = 0;
    let errors = 0;

    for (;;) {
      const targets = await fetchSideReviewTargets({
        deviceIds,
        modelName: preferred.name,
        reviewSource,
        caseId,
        limit: batchSize
      });
      if (!targets.length) break;

      for (const target of targets) {
        try {
          const birdId = target.birdId;
          if (!birdId) {
            errors += 1;
            continue;
          }
          const detection = await Detection.findById(target._id).populate('device', 'owner');
          if (!detection?.device || detection.device.owner.toString() !== req.user.userId) {
            errors += 1;
            continue;
          }
          const bird = applySideReview(detection, {
            birdId,
            status,
            source: reviewSource,
            at: new Date()
          });
          if (!bird) {
            errors += 1;
            continue;
          }
          await detection.save();
          accepted += 1;
        } catch (err) {
          errors += 1;
          logger.warn('Side-review accept-all item failed:', err.message);
        }
      }
      if (targets.length < batchSize) break;
    }

    res.json({ ok: true, accepted, errors, caseId, action });
  } catch (error) {
    logger.error('Side-review accept-all error:', error);
    res.status(500).json({ error: 'Massen-Akzeptieren fehlgeschlagen' });
  }
});

router.post('/dataset/side-review/undo', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }
    const undo = req.body?.undo;
    if (!undo || undo.kind !== 'side-review' || !undo.detectionId || !undo.birdId) {
      return res.status(400).json({ error: 'undo-Payload ungültig' });
    }
    if (undo.modelName && undo.modelName !== preferred.name) {
      return res.status(400).json({ error: 'Undo gehört zu einem anderen Modell' });
    }

    const detection = await Detection.findById(undo.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    restoreSideReviewUndo(detection, { ...undo, modelName: preferred.name });
    await detection.save();
    res.json({ ok: true, detectionId: String(detection._id), birdId: undo.birdId });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('Side-review undo error:', error);
    res.status(500).json({ error: 'Undo fehlgeschlagen' });
  }
});

router.post('/dataset/side-review/:detectionId', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }

    const action = req.body?.action;
    if (!['confirm_pigeon', 'no_pigeon'].includes(action)) {
      return res.status(400).json({ error: 'action muss confirm_pigeon oder no_pigeon sein' });
    }

    const birdId = typeof req.body?.birdId === 'string' ? req.body.birdId.trim() : '';
    if (!birdId) {
      return res.status(400).json({ error: 'birdId fehlt' });
    }

    const detection = await Detection.findById(req.params.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = applySideReviewWithUndo(detection, { preferred, birdId, action });
    await detection.save();
    res.json({
      ok: true,
      detectionId: String(detection._id),
      birdId,
      review: result.bird.review,
      source: result.reviewSource,
      undo: result.undo
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('Side-review decide error:', error);
    res.status(500).json({ error: 'Entscheidung konnte nicht gespeichert werden' });
  }
});

async function fetchNewReviewTargets({ deviceIds, modelName, limit }) {
  return Detection.aggregate([
    {
      $match: {
        device: { $in: deviceIds },
        model_runs: { $elemMatch: { 'model.name': modelName } }
      }
    },
    {
      $project: {
        device: 1,
        processedAt: 1,
        classification_status: 1,
        image_info: 1,
        birds: { $ifNull: ['$birds', []] },
        detections: { $ifNull: ['$detections', []] },
        target_bird: 1,
        model_runs: {
          $filter: {
            input: { $ifNull: ['$model_runs', []] },
            as: 'run',
            cond: { $eq: ['$$run.model.name', modelName] }
          }
        }
      }
    },
    {
      $addFields: {
        lRun: { $arrayElemAt: ['$model_runs', 0] }
      }
    },
    { $unwind: { path: '$lRun.boxes', includeArrayIndex: 'boxIndex' } },
    {
      $addFields: {
        isNewBox: {
          $or: [
            { $eq: ['$lRun.boxes.bird_id', null] },
            { $eq: ['$lRun.boxes.bird_id', ''] },
            { $not: [{ $ifNull: ['$lRun.boxes.bird_id', false] }] }
          ]
        },
        alreadyReviewed: {
          $in: [
            { $ifNull: ['$lRun.boxes.review.status', null] },
            ['confirmed_pigeon', 'no_pigeon']
          ]
        },
        caseId: { $literal: 'Neu' }
      }
    },
    {
      $match: {
        isNewBox: true,
        alreadyReviewed: false,
        'lRun.boxes.bbox': { $exists: true }
      }
    },
    { $sort: { processedAt: -1, boxIndex: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        device: 1,
        processedAt: 1,
        classification_status: 1,
        image_info: 1,
        detections: 1,
        target_bird: 1,
        birds: 1,
        caseId: 1,
        boxIndex: 1,
        lBox: '$lRun.boxes'
      }
    }
  ]).allowDiskUse(true);
}

router.get('/dataset/new-review', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.query.modelId);
    if (!preferred) {
      return res.json({ model: null, total: 0, items: [], cases: NEW_REVIEW_CASES });
    }

    const devices = await Device.find({ owner: req.user.userId }).select('_id name');
    const deviceIds = devices.map((d) => d._id);
    const deviceNameById = new Map(devices.map((d) => [d._id.toString(), d.name || 'Gerät']));
    if (deviceIds.length === 0) {
      return res.json({ model: preferred, total: 0, items: [], cases: NEW_REVIEW_CASES });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const modelName = preferred.name;

    const [itemsRaw, countRows] = await Promise.all([
      fetchNewReviewTargets({ deviceIds, modelName, limit }),
      Detection.aggregate([
        {
          $match: {
            device: { $in: deviceIds },
            model_runs: { $elemMatch: { 'model.name': modelName } }
          }
        },
        {
          $project: {
            model_runs: {
              $filter: {
                input: { $ifNull: ['$model_runs', []] },
                as: 'run',
                cond: { $eq: ['$$run.model.name', modelName] }
              }
            }
          }
        },
        { $addFields: { lRun: { $arrayElemAt: ['$model_runs', 0] } } },
        { $unwind: { path: '$lRun.boxes', includeArrayIndex: 'boxIndex' } },
        {
          $match: {
            'lRun.boxes.bbox': { $exists: true },
            $expr: {
              $and: [
                {
                  $or: [
                    { $eq: ['$lRun.boxes.bird_id', null] },
                    { $eq: ['$lRun.boxes.bird_id', ''] },
                    { $not: [{ $ifNull: ['$lRun.boxes.bird_id', false] }] }
                  ]
                },
                {
                  $not: {
                    $in: [
                      { $ifNull: ['$lRun.boxes.review.status', null] },
                      ['confirmed_pigeon', 'no_pigeon']
                    ]
                  }
                }
              ]
            }
          }
        },
        { $count: 'n' }
      ]).allowDiskUse(true)
    ]);

    const total = countRows[0]?.n || 0;
    const caseTotals = { Neu: total };

    const items = (itemsRaw || []).map((doc) => {
      const detectionId = String(doc._id);
      const boxIndex = Number(doc.boxIndex) || 0;
      return {
        id: `${detectionId}:${boxIndex}`,
        detectionId,
        boxIndex,
        tinder: true,
        caseId: 'Neu',
        case: NEW_REVIEW_CASES.Neu,
        processedAt: doc.processedAt,
        deviceName: deviceNameById.get(String(doc.device)) || 'Gerät',
        classification_status: doc.classification_status ?? null,
        image_info: doc.image_info || null,
        birds: doc.birds || [],
        target_bird: doc.target_bird || null,
        detections: doc.detections || [],
        lBox: doc.lBox || null,
        lBoxes: doc.lBox ? [doc.lBox] : []
      };
    });

    res.json({
      model: preferred,
      total,
      tinderTotal: total,
      caseTotals,
      loaded: { Neu: items.length },
      items,
      cases: NEW_REVIEW_CASES
    });
  } catch (error) {
    logger.error('New-review queue error:', error);
    res.status(500).json({ error: 'New-Review-Liste konnte nicht geladen werden' });
  }
});

router.post('/dataset/new-review/accept-all', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }
    const caseId = String(req.body?.caseId || 'Neu');
    if (caseId !== 'Neu') {
      return res.status(400).json({ error: 'caseId muss Neu sein' });
    }
    const action = req.body?.action || 'confirm_pigeon';
    if (!['confirm_pigeon', 'no_pigeon'].includes(action)) {
      return res.status(400).json({ error: 'action muss confirm_pigeon oder no_pigeon sein' });
    }

    const deviceIds = await userDeviceIds(req.user.userId);
    if (deviceIds.length === 0) {
      return res.json({ ok: true, accepted: 0, errors: 0, caseId });
    }

    const reviewSource = `new-review:${preferred.name}`;
    const batchSize = 100;
    let accepted = 0;
    let errors = 0;

    for (;;) {
      const targets = await fetchNewReviewTargets({
        deviceIds,
        modelName: preferred.name,
        limit: batchSize
      });
      if (!targets.length) break;

      for (const target of targets) {
        try {
          const boxIndex = Number(target.boxIndex);
          if (!Number.isInteger(boxIndex)) {
            errors += 1;
            continue;
          }
          const detection = await Detection.findById(target._id).populate('device', 'owner');
          if (!detection?.device || detection.device.owner.toString() !== req.user.userId) {
            errors += 1;
            continue;
          }
          const result = applyNewBoxReview(detection, {
            modelName: preferred.name,
            boxIndex,
            action,
            source: reviewSource,
            at: new Date()
          });
          if (!result) {
            errors += 1;
            continue;
          }
          await detection.save();
          accepted += 1;
        } catch (err) {
          errors += 1;
          logger.warn('New-review accept-all item failed:', err.message);
        }
      }
      if (targets.length < batchSize) break;
    }

    res.json({ ok: true, accepted, errors, caseId, action });
  } catch (error) {
    logger.error('New-review accept-all error:', error);
    res.status(500).json({ error: 'Massen-Akzeptieren fehlgeschlagen' });
  }
});

router.post('/dataset/new-review/undo', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }
    const undo = req.body?.undo;
    if (!undo || undo.kind !== 'new-review' || !undo.detectionId || !Number.isInteger(undo.boxIndex)) {
      return res.status(400).json({ error: 'undo-Payload ungültig' });
    }
    if (undo.modelName && undo.modelName !== preferred.name) {
      return res.status(400).json({ error: 'Undo gehört zu einem anderen Modell' });
    }

    const detection = await Detection.findById(undo.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const box = restoreNewBoxReview(detection, {
      modelName: preferred.name,
      boxIndex: undo.boxIndex,
      previous: undo.previous || {}
    });
    if (!box) {
      return res.status(400).json({ error: 'Box nicht gefunden' });
    }
    await detection.save();
    res.json({ ok: true, detectionId: String(detection._id), boxIndex: undo.boxIndex });
  } catch (error) {
    logger.error('New-review undo error:', error);
    res.status(500).json({ error: 'Undo fehlgeschlagen' });
  }
});

router.post('/dataset/new-review/:detectionId', authenticateToken, async (req, res) => {
  try {
    const preferred = resolveReplayModel(req.body?.modelId || req.query.modelId);
    if (!preferred) {
      return res.status(400).json({ error: 'Kein Nebenmodell gewählt' });
    }

    const action = req.body?.action;
    if (!['confirm_pigeon', 'no_pigeon'].includes(action)) {
      return res.status(400).json({ error: 'action muss confirm_pigeon oder no_pigeon sein' });
    }

    const boxIndex = Number(req.body?.boxIndex);
    if (!Number.isInteger(boxIndex) || boxIndex < 0) {
      return res.status(400).json({ error: 'boxIndex ungültig' });
    }

    const detection = await Detection.findById(req.params.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const run = (detection.model_runs || []).find((entry) => entry?.model?.name === preferred.name);
    const boxBefore = run?.boxes?.[boxIndex];
    if (!boxBefore) {
      return res.status(400).json({ error: 'L-Box nicht gefunden' });
    }

    const undo = {
      kind: 'new-review',
      detectionId: String(detection._id),
      modelName: preferred.name,
      boxIndex,
      previous: {
        bird_id: boxBefore.bird_id || null,
        boxReview: cloneReview(boxBefore.review),
        createdBirdId: null
      }
    };

    const reviewSource = `new-review:${preferred.name}`;
    const result = applyNewBoxReview(detection, {
      modelName: preferred.name,
      boxIndex,
      action,
      source: reviewSource,
      at: new Date()
    });
    if (!result) {
      return res.status(400).json({ error: 'Box konnte nicht bewertet werden (bereits verknüpft?)' });
    }
    if (result.created && result.bird?.bird_id) {
      undo.previous.createdBirdId = result.bird.bird_id;
    }

    await detection.save();
    res.json({
      ok: true,
      detectionId: String(detection._id),
      boxIndex,
      created: result.created,
      birdId: result.bird?.bird_id || null,
      source: reviewSource,
      undo
    });
  } catch (error) {
    logger.error('New-review decide error:', error);
    res.status(500).json({ error: 'Entscheidung konnte nicht gespeichert werden' });
  }
});

router.get('/dataset/size-filter', authenticateToken, async (req, res) => {
  try {
    const minShortSide = clampMinShortSide(req.query.minShortSide, 0.04);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const deviceIds = await userDeviceIds(req.user.userId);
    if (deviceIds.length === 0) {
      return res.json({ minShortSide, total: 0, items: [] });
    }

    const { total, items } = await loadSizeFilterCandidates(deviceIds, minShortSide, { limit });
    res.json({
      minShortSide,
      total,
      items: items.map(({ detectionId, birdId, role, bird, shortSideRatio: ratio, image_info }) => ({
        detectionId,
        birdId,
        role,
        bird,
        shortSideRatio: ratio,
        image_info
      }))
    });
  } catch (error) {
    logger.error('Size-filter queue error:', error);
    res.status(500).json({ error: 'Zu-weit-Liste konnte nicht geladen werden' });
  }
});

router.post('/dataset/size-filter/undo', authenticateToken, async (req, res) => {
  try {
    const undo = req.body?.undo;
    if (!undo || undo.kind !== 'size-filter' || !undo.detectionId || !undo.birdId) {
      return res.status(400).json({ error: 'undo-Payload ungültig' });
    }

    const detection = await Detection.findById(undo.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const bird = restoreBirdReview(detection, {
      birdId: undo.birdId,
      previous: undo.previous || {}
    });
    if (!bird) {
      return res.status(404).json({ error: 'Vogel nicht gefunden' });
    }

    await detection.save();
    res.json({ ok: true, detectionId: String(detection._id), birdId: undo.birdId });
  } catch (error) {
    logger.error('Size-filter undo error:', error);
    res.status(500).json({ error: 'Undo fehlgeschlagen' });
  }
});

router.post('/dataset/size-filter/mark-all', authenticateToken, async (req, res) => {
  try {
    const minShortSide = clampMinShortSide(req.body?.minShortSide ?? req.query.minShortSide, 0.04);
    const maxMark = Math.min(500, Math.max(1, parseInt(req.body?.limit, 10) || 200));
    const deviceIds = await userDeviceIds(req.user.userId);
    if (deviceIds.length === 0) {
      return res.json({ ok: true, minShortSide, marked: 0, errors: 0, total: 0 });
    }

    const { total, items } = await loadSizeFilterCandidates(deviceIds, minShortSide, {
      limit: maxMark,
      maxScan: 8000
    });

    let marked = 0;
    let errors = 0;
    const byDetection = new Map();
    for (const item of items) {
      if (!byDetection.has(item.detectionId)) byDetection.set(item.detectionId, []);
      byDetection.get(item.detectionId).push(item.birdId);
    }

    for (const [detectionId, birdIds] of byDetection) {
      try {
        const detection = await Detection.findById(detectionId).populate('device', 'owner');
        if (!detection?.device || detection.device.owner.toString() !== req.user.userId) {
          errors += birdIds.length;
          continue;
        }
        let changed = false;
        for (const birdId of birdIds) {
          const result = applyBirdReview(detection, {
            birdId,
            status: 'too_far',
            source: 'size-filter',
            at: new Date()
          });
          if (!result) {
            errors += 1;
            continue;
          }
          marked += 1;
          changed = true;
        }
        if (changed) await detection.save();
      } catch (err) {
        errors += birdIds.length;
        logger.warn('Size-filter mark-all item failed:', err.message);
      }
    }

    res.json({ ok: true, minShortSide, marked, errors, total, capped: total > maxMark });
  } catch (error) {
    logger.error('Size-filter mark-all error:', error);
    res.status(500).json({ error: 'Massen-Markierung fehlgeschlagen' });
  }
});

router.post('/dataset/size-filter/:detectionId', authenticateToken, async (req, res) => {
  try {
    const birdId = typeof req.body?.birdId === 'string' ? req.body.birdId.trim() : '';
    const action = req.body?.action;
    if (!birdId) {
      return res.status(400).json({ error: 'birdId fehlt' });
    }
    if (!['too_far', 'keep'].includes(action)) {
      return res.status(400).json({ error: 'action muss too_far oder keep sein' });
    }

    const detection = await Detection.findById(req.params.detectionId).populate('device', 'owner');
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }
    if (!detection.device || detection.device.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (action === 'keep') {
      return res.json({
        ok: true,
        detectionId: String(detection._id),
        birdId,
        action: 'keep',
        undo: null
      });
    }

    const result = applyBirdReview(detection, {
      birdId,
      status: 'too_far',
      source: 'size-filter',
      at: new Date()
    });
    if (!result) {
      return res.status(404).json({ error: 'Vogel nicht gefunden' });
    }

    await detection.save();
    res.json({
      ok: true,
      detectionId: String(detection._id),
      birdId,
      action: 'too_far',
      undo: {
        kind: 'size-filter',
        detectionId: String(detection._id),
        birdId,
        previous: result.previous
      }
    });
  } catch (error) {
    logger.error('Size-filter decide error:', error);
    res.status(500).json({ error: 'Entscheidung konnte nicht gespeichert werden' });
  }
});

router.get('/replay', authenticateToken, (req, res) => {
  res.json(getReplayStatus());
});

router.post('/replay/stop', authenticateToken, (req, res) => {
  res.json(requestReplayStop());
});

router.post('/:id/replay', authenticateToken, (req, res) => {
  try {
    const createsBirds = req.body?.createsBirds === true;
    res.status(202).json(startReplay(req.params.id, { createsBirds }));
  } catch (error) {
    logger.error('Start replay error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    res.json({ models: listModels() });
  } catch (error) {
    logger.error('List models error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
