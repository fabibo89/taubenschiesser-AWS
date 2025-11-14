const { spawn } = require('child_process');
const EventEmitter = require('events');
const logger = require('./logger');

const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

class RtspFrameManager {
  constructor() {
    this.streams = new Map();
    this.INACTIVITY_MS = 5 * 60 * 1000;
  }

  async getFrame(deviceId, rtspUrl, timeoutMs = 4000) {
    const info = this._getOrCreateStream(deviceId, rtspUrl);
    info.lastRequest = Date.now();
    this._scheduleCleanup(deviceId, info);

    if (info.lastFrame && Date.now() - info.lastUpdated < 1000) {
      return info.lastFrame;
    }

    return new Promise((resolve, reject) => {
      let done = false;

      const onFrame = (frame) => {
        done = true;
        cleanup();
        resolve(frame);
      };

      const onError = (err) => {
        if (!done) {
          done = true;
          cleanup();
          reject(err);
        }
      };

      const cleanup = () => {
        info.emitter.removeListener('frame', onFrame);
        info.emitter.removeListener('error', onError);
        clearTimeout(timer);
      };

      info.emitter.once('frame', onFrame);
      info.emitter.once('error', onError);

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          cleanup();
          reject(new Error('RTSP frame timeout'));
        }
      }, timeoutMs);
    });
  }

  _getOrCreateStream(deviceId, rtspUrl) {
    if (this.streams.has(deviceId)) {
      const existing = this.streams.get(deviceId);
      if (existing.url === rtspUrl) {
        return existing;
      }
      this._dispose(deviceId);
    }

    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-f', 'image2pipe',
      '-q:v', '2',
      '-pix_fmt', 'yuvj422p',
      '-vcodec', 'mjpeg',
      '-'
    ];

    logger.info(`Starting persistent RTSP stream for ${deviceId}`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const info = {
      ffmpeg,
      url: rtspUrl,
      buffer: Buffer.alloc(0),
      lastFrame: null,
      lastUpdated: 0,
      lastRequest: Date.now(),
      inactivityTimer: null,
      emitter: new EventEmitter()
    };

    ffmpeg.stdout.on('data', (chunk) => {
      info.buffer = Buffer.concat([info.buffer, chunk]);
      this._extractFrames(info);
    });

    ffmpeg.stderr.on('data', (data) => {
      logger.debug(`FFmpeg stderr [${deviceId}]: ${data}`);
    });

    ffmpeg.on('error', (error) => {
      logger.warn(`FFmpeg process error for device ${deviceId}: ${error.message}`);
      info.emitter.emit('error', error);
      this._dispose(deviceId);
    });

    ffmpeg.on('close', (code) => {
      logger.info(`FFmpeg process for device ${deviceId} exited with code ${code}`);
      info.emitter.emit('error', new Error(`ffmpeg exited with code ${code}`));
      this._dispose(deviceId);
    });

    this.streams.set(deviceId, info);
    return info;
  }

  _extractFrames(info) {
    let start = info.buffer.indexOf(JPEG_START);
    while (start !== -1) {
      const end = info.buffer.indexOf(JPEG_END, start + 2);
      if (end === -1) {
        break;
      }

      const frame = info.buffer.slice(start, end + 2);
      info.buffer = info.buffer.slice(end + 2);
      info.lastFrame = frame;
      info.lastUpdated = Date.now();
      info.emitter.emit('frame', frame);

      start = info.buffer.indexOf(JPEG_START);
    }
  }

  _scheduleCleanup(deviceId, info) {
    if (info.inactivityTimer) {
      clearTimeout(info.inactivityTimer);
    }
    info.inactivityTimer = setTimeout(() => {
      const entry = this.streams.get(deviceId);
      if (entry && Date.now() - entry.lastRequest >= this.INACTIVITY_MS) {
        this._dispose(deviceId);
      }
    }, this.INACTIVITY_MS);
  }

  _dispose(deviceId) {
    const info = this.streams.get(deviceId);
    if (!info) return;
    if (info.inactivityTimer) {
      clearTimeout(info.inactivityTimer);
    }
    try {
      info.ffmpeg.kill('SIGKILL');
    } catch (error) {
      logger.warn(`Error stopping ffmpeg for ${deviceId}: ${error.message}`);
    }
    this.streams.delete(deviceId);
  }
}

module.exports = new RtspFrameManager();

