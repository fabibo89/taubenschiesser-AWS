const { exec } = require('child_process');
const { promisify } = require('util');
const Device = require('../models/Device');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

class DeviceMonitor {
  constructor(io) {
    this.io = io;
    this.isRunning = false;
    this.intervalId = null;
    this.pingInterval = 60000; // 60 Sekunden um Rate Limiting zu vermeiden
  }

  async start() {
    if (this.isRunning) {
      logger.info('Device monitor already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting device monitor service');

    // Sofortiger Check beim Start
    await this.checkAllDevices();

    // Regelmäßige Checks
    this.intervalId = setInterval(async () => {
      await this.checkAllDevices();
    }, this.pingInterval);

    logger.info(`Device monitor started - checking every ${this.pingInterval / 1000} seconds`);
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('Device monitor stopped');
  }

  async checkAllDevices() {
    try {
      // Alle aktiven Geräte abrufen
      const allDevices = await Device.find({ isActive: true });
      
      // Nur Geräte prüfen, die im 'running' Status sind
      const runningDevices = allDevices.filter(device => device.monitorStatus === 'running');
      const pausedDevices = allDevices.filter(device => device.monitorStatus === 'paused');
      
      logger.info(`Device Monitor: ${runningDevices.length} running, ${pausedDevices.length} paused, ${allDevices.length} total devices`);
      
      if (pausedDevices.length > 0) {
        logger.info(`Paused devices: ${pausedDevices.map(d => d.name).join(', ')}`);
      }

      const checkPromises = runningDevices.map(device => this.checkDevice(device));
      await Promise.all(checkPromises);

    } catch (error) {
      logger.error('Error checking devices:', error);
    }
  }

  async checkDevice(device) {
    try {
      const taubenschiesserIp = device.getTaubenschiesserIp();
      const cameraIp = this.getCameraIp(device);
      
      // Check if using local image
      const useLocalImage = device.camera && device.camera.useLocalImage && device.camera.localImagePath;

      // Parallele Ping-Checks
      const [taubenschiesserStatus, cameraStatus] = await Promise.all([
        this.pingDevice(taubenschiesserIp, 'Taubenschiesser'),
        useLocalImage ? Promise.resolve('online') : (cameraIp ? this.pingDevice(cameraIp, 'Kamera') : Promise.resolve('offline'))
      ]);

      // Status-Updates nur wenn sich etwas geändert hat
      let needsUpdate = false;
      const updates = {};

      if (device.taubenschiesserStatus !== taubenschiesserStatus) {
        updates.taubenschiesserStatus = taubenschiesserStatus;
        needsUpdate = true;
        logger.info(`Device ${device.name}: Taubenschiesser status changed to ${taubenschiesserStatus}`);
        
        // Sofortige Socket.IO Benachrichtigung bei Status-Änderung
        if (this.io) {
          this.io.emit('device-status-change', {
            deviceId: device._id,
            component: 'taubenschiesser',
            status: taubenschiesserStatus,
            timestamp: new Date()
          });
        }
      }

      if (device.cameraStatus !== cameraStatus) {
        updates.cameraStatus = cameraStatus;
        needsUpdate = true;
        logger.info(`Device ${device.name}: Camera status changed to ${cameraStatus}`);
        
        // Sofortige Socket.IO Benachrichtigung bei Status-Änderung
        if (this.io) {
          this.io.emit('device-status-change', {
            deviceId: device._id,
            component: 'camera',
            status: cameraStatus,
            timestamp: new Date()
          });
        }
      }

      if (needsUpdate) {
        // Update lastSeen wenn Taubenschiesser online ist
        if (taubenschiesserStatus === 'online') {
          updates.lastSeen = new Date();
        }

        // Update overall status
        const overallStatus = this.calculateOverallStatus(taubenschiesserStatus, cameraStatus);
        updates.status = overallStatus;

        // Update device
        await Device.findByIdAndUpdate(device._id, updates);

        // Emit real-time update
        if (this.io) {
          const updatedDevice = await Device.findById(device._id);
          this.io.to(`device-${device._id}`).emit('device-update', updatedDevice);
        }

        logger.info(`Device ${device.name}: Overall status updated to ${overallStatus}`);
      }

    } catch (error) {
      logger.error(`Error checking device ${device.name}:`, error);
    }
  }

  async pingDevice(ip, deviceType) {
    if (!ip) {
      return 'offline';
    }

    try {
      // Ping-Befehl je nach Betriebssystem
      const isWindows = process.platform === 'win32';
      const pingCmd = isWindows 
        ? `ping -n 1 -w 5000 ${ip}` 
        : `ping -c 1 -W 5 ${ip}`;

      const { stdout, stderr } = await execAsync(pingCmd, { timeout: 10000 });
      
      if (stderr) {
        logger.debug(`${deviceType} ${ip}: Offline (${stderr})`);
        return 'offline';
      }

      // Prüfe auf erfolgreichen Ping
      const isOnline = isWindows 
        ? stdout.includes('TTL=') || stdout.includes('Zeit<1ms')
        : stdout.includes('1 received') || stdout.includes('1 packets received') || stdout.includes('0% packet loss');

      if (isOnline) {
        logger.debug(`${deviceType} ${ip}: Online`);
        return 'online';
      } else {
        logger.debug(`${deviceType} ${ip}: Offline`);
        return 'offline';
      }
    } catch (error) {
      logger.debug(`${deviceType} ${ip}: Offline (${error.message})`);
      return 'offline';
    }
  }

  getCameraIp(device) {
    if (device.camera.type === 'tapo' && device.camera.tapo && device.camera.tapo.ip) {
      return device.camera.tapo.ip;
    } else if (device.camera.directUrl) {
      // Extrahiere IP aus RTSP URL
      const match = device.camera.directUrl.match(/@([^:]+):/);
      return match ? match[1] : null;
    }
    return null;
  }

  calculateOverallStatus(taubenschiesserStatus, cameraStatus) {
    if (taubenschiesserStatus === 'online' && cameraStatus === 'online') {
      return 'online';
    } else if (taubenschiesserStatus === 'error' || cameraStatus === 'error') {
      return 'error';
    } else if (taubenschiesserStatus === 'maintenance' || cameraStatus === 'maintenance') {
      return 'maintenance';
    } else {
      return 'offline';
    }
  }

  // Manueller Check für ein spezifisches Gerät
  async checkDeviceById(deviceId) {
    try {
      const device = await Device.findById(deviceId);
      if (!device) {
        throw new Error('Device not found');
      }
      await this.checkDevice(device);
      return device;
    } catch (error) {
      logger.error(`Error checking device ${deviceId}:`, error);
      throw error;
    }
  }

  // Status für alle Geräte abrufen
  async getStatusSummary() {
    try {
      const devices = await Device.find({ isActive: true });
      const summary = {
        total: devices.length,
        online: 0,
        offline: 0,
        error: 0,
        maintenance: 0,
        devices: []
      };

      for (const device of devices) {
        const taubenschiesserIp = device.getTaubenschiesserIp();
        const cameraIp = this.getCameraIp(device);

        const [taubenschiesserStatus, cameraStatus] = await Promise.all([
          this.pingDevice(taubenschiesserIp, 'Taubenschiesser'),
          cameraIp ? this.pingDevice(cameraIp, 'Kamera') : Promise.resolve('offline')
        ]);

        const overallStatus = this.calculateOverallStatus(taubenschiesserStatus, cameraStatus);
        summary[overallStatus]++;
        summary.devices.push({
          id: device._id,
          name: device.name,
          taubenschiesserStatus,
          cameraStatus,
          overallStatus,
          taubenschiesserIp,
          cameraIp
        });
      }

      return summary;
    } catch (error) {
      logger.error('Error getting status summary:', error);
      throw error;
    }
  }
}

module.exports = DeviceMonitor;
