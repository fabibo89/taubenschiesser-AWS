const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const cvRoutes = require('./routes/computerVision');
const userRoutes = require('./routes/users');
const { connectDB } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const DeviceMonitor = require('./services/deviceMonitor');
// StreamService entfernt - direkte RTSP-Streams im Frontend

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Trust proxy - required when behind Nginx
// Only trust local connections (Docker network, localhost)
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Security middleware
app.use(helmet());
app.use(cors({
  origin: "*",
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting - more permissive for hardware monitor
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for hardware monitor)
  skip: (req) => {
    // Skip rate limiting for service tokens
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.includes('hardware-monitor-service-token')) {
      return true;
    }
    return false;
  }
});
app.use(limiter);

// Body parsing middleware - erhöhtes Limit für Bildanalyse
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/device-control', require('./routes/deviceControl'));
app.use('/api/device-image', require('./routes/deviceImage'));
app.use('/api/stream', require('./routes/stream'));
app.use('/api/cv', cvRoutes);
app.use('/api/users', userRoutes);
app.use('/api/hardware', require('./routes/hardware'));
app.use('/api/iot', require('./routes/iot'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('join-device', (deviceId) => {
    socket.join(`device-${deviceId}`);
    logger.info(`Client ${socket.id} joined device room: ${deviceId}`);
  });
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set('io', io);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5001;

// Initialize device monitor
const deviceMonitor = new DeviceMonitor(io);

// Make services available to routes
app.set('io', io);
app.set('deviceMonitor', deviceMonitor);

// Note: Hardware Monitor runs as separate service
// Device control uses direct MQTT connection

// Start server
const startServer = async () => {
  try {
    await connectDB();
    
    // Start device monitoring
    await deviceMonitor.start();
    
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Accessible at: http://localhost:${PORT} or http://192.168.10.156:${PORT}`);
      logger.info('Device monitoring started');
      logger.info('Device control via MQTT available');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');
  await deviceMonitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down server...');
  await deviceMonitor.stop();
  process.exit(0);
});

startServer();

module.exports = { app, io };
