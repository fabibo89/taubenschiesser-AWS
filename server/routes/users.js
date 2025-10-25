const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get user settings for service (no auth required for specific user)
router.get('/:userId/settings', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      settings: user.settings || {}
    });
  } catch (error) {
    logger.error('Get user settings for service error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('devices');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user.toJSON());
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user settings
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      mqtt: user.settings?.mqtt || {},
      notifications: user.settings?.notifications || {},
      system: user.settings?.system || {}
    });
  } catch (error) {
    logger.error('Get settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user settings
router.put('/settings', authenticateToken, [
  body('mqtt.broker').optional().isString().trim(),
  body('mqtt.port').optional().isInt({ min: 1, max: 65535 }),
  body('mqtt.username').optional().isString().trim(),
  body('mqtt.password').optional().isString(),
  body('mqtt.enabled').optional().isBoolean(),
  body('notifications.email').optional().isBoolean(),
  body('notifications.push').optional().isBoolean(),
  body('notifications.detectionAlerts').optional().isBoolean(),
  body('system.autoRefresh').optional().isInt({ min: 5, max: 60 }),
  body('system.theme').optional().isIn(['light', 'dark', 'auto'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update settings
    if (req.body.mqtt) {
      user.settings.mqtt = { ...user.settings.mqtt, ...req.body.mqtt };
    }
    if (req.body.notifications) {
      user.settings.notifications = { ...user.settings.notifications, ...req.body.notifications };
    }
    if (req.body.system) {
      user.settings.system = { ...user.settings.system, ...req.body.system };
    }

    await user.save();

    logger.info(`User ${user.username} updated settings`);
    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: {
        mqtt: user.settings.mqtt,
        notifications: user.settings.notifications,
        system: user.settings.system
      }
    });

  } catch (error) {
    logger.error('Update settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Test MQTT connection
router.post('/settings/mqtt/test', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const mqttSettings = user.settings?.mqtt;
    if (!mqttSettings) {
      return res.status(400).json({ error: 'MQTT settings not found' });
    }

    if (!mqttSettings.enabled) {
      return res.status(400).json({ error: 'MQTT is not enabled' });
    }

    // Validate required fields
    if (!mqttSettings.broker || !mqttSettings.port) {
      return res.status(400).json({ 
        error: 'MQTT broker and port are required',
        details: {
          broker: mqttSettings.broker || 'missing',
          port: mqttSettings.port || 'missing'
        }
      });
    }

    // Debug logging
    logger.info('Testing MQTT connection:', {
      broker: mqttSettings.broker,
      port: mqttSettings.port,
      username: mqttSettings.username ? '***' : 'none',
      enabled: mqttSettings.enabled,
      serverProfile: mqttSettings.serverProfile
    });

    // Test MQTT connection
    const mqtt = require('mqtt');
    const client = mqtt.connect(`mqtt://${mqttSettings.broker}:${mqttSettings.port}`, {
      username: mqttSettings.username || undefined,
      password: mqttSettings.password || undefined,
      connectTimeout: 5000,
      keepalive: 60
    });

    const testResult = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        client.end();
        resolve({ success: false, error: 'Connection timeout' });
      }, 5000);

      client.on('connect', () => {
        clearTimeout(timeout);
        client.end();
        resolve({ success: true, message: 'MQTT connection successful' });
      });

      client.on('error', (error) => {
        clearTimeout(timeout);
        client.end();
        resolve({ success: false, error: error.message });
      });
    });

    res.json(testResult);

  } catch (error) {
    logger.error('MQTT test error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, [
  body('username').optional().isLength({ min: 3 }).trim().escape(),
  body('email').optional().isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email } = req.body;
    const updateData = {};

    if (username) updateData.username = username;
    if (email) updateData.email = email;

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user.toJSON());
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change password
router.put('/password', authenticateToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
