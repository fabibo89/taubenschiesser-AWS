const { spawn } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');

class HardwareMonitorService {
  constructor() {
    this.process = null;
    this.isRunning = false;
  }

  async start() {
    try {
      if (this.isRunning) {
        logger.info('Hardware Monitor already running');
        return;
      }

      const hardwareMonitorPath = path.join(__dirname, '../../hardware-monitor/main.py');
      
      logger.info('Starting Hardware Monitor service...');
      
      this.process = spawn('python3', [hardwareMonitorPath], {
        cwd: path.join(__dirname, '../../hardware-monitor'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.on('data', (data) => {
        logger.info(`Hardware Monitor: ${data.toString().trim()}`);
      });

      this.process.stderr.on('data', (data) => {
        logger.error(`Hardware Monitor Error: ${data.toString().trim()}`);
      });

      this.process.on('close', (code) => {
        logger.warning(`Hardware Monitor process exited with code ${code}`);
        this.isRunning = false;
      });

      this.process.on('error', (error) => {
        logger.error(`Hardware Monitor process error: ${error}`);
        this.isRunning = false;
      });

      this.isRunning = true;
      logger.info('Hardware Monitor service started successfully');
      
    } catch (error) {
      logger.error('Failed to start Hardware Monitor service:', error);
      throw error;
    }
  }

  async stop() {
    try {
      if (this.process && this.isRunning) {
        logger.info('Stopping Hardware Monitor service...');
        this.process.kill('SIGTERM');
        
        // Wait for graceful shutdown
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            this.process.kill('SIGKILL');
            resolve();
          }, 5000);
          
          this.process.on('close', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        
        this.isRunning = false;
        logger.info('Hardware Monitor service stopped');
      }
    } catch (error) {
      logger.error('Error stopping Hardware Monitor service:', error);
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      pid: this.process ? this.process.pid : null
    };
  }
}

module.exports = HardwareMonitorService;
