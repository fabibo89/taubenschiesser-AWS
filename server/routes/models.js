const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { listModels } = require('../utils/modelCatalog');
const { getReplayStatus, requestReplayStop, startReplay } = require('../services/modelReplay');
const logger = require('../utils/logger');

const router = express.Router();

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
