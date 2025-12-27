const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Helper function to create access token (short-lived: 30 minutes)
const createAccessToken = (userId) => {
  return jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '30m' }
  );
};

// Helper function to create refresh token (long-lived: 7 days)
const createRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '7d' }
  );
};

// Register
router.post('/register', [
  body('username').isLength({ min: 3 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        error: 'User with this email or username already exists' 
      });
    }

    const user = new User({ username, email, password });
    await user.save();

    const access_token = createAccessToken(user._id);
    const refresh_token = createRefreshToken(user._id);

    res.status(201).json({
      message: 'User created successfully',
      access_token,
      refresh_token,
      user: user.toJSON()
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const access_token = createAccessToken(user._id);
    const refresh_token = createRefreshToken(user._id);

    res.json({
      message: 'Login successful',
      access_token,
      refresh_token,
      user: user.toJSON()
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Refresh token endpoint
router.post('/refresh', [
  body('refresh_token').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { refresh_token } = req.body;

    try {
      const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET || 'fallback-secret');
      
      // Verify token type
      if (decoded.type !== 'refresh') {
        return res.status(401).json({ error: 'Invalid token type' });
      }

      // Verify user still exists and is active
      const user = await User.findById(decoded.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      // Generate new tokens
      const access_token = createAccessToken(user._id);
      const new_refresh_token = createRefreshToken(user._id);

      res.json({
        access_token,
        refresh_token: new_refresh_token
      });
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Refresh token expired' });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('devices');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user.toJSON());
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout (client-side token removal)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logout successful' });
});

module.exports = router;
