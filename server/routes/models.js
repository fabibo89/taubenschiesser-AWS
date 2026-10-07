const express = require('express');
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
  buildPreview
} = require('../services/datasetExport');
const {
  applyMainReview,
  applySideReview,
  applyNewBoxReview,
  restoreNewBoxReview
} = require('../utils/detectionBirds');
const logger = require('../utils/logger');

const router = express.Router();

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
      valRatio: req.body?.valRatio ?? req.query.valRatio
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
