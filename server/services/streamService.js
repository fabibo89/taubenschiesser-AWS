const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('../utils/logger');

class StreamService {
  constructor() {
    this.activeStreams = new Map();
    this.streamPort = 8080; // Basis-Port für Streams
    this.httpServer = null;
    this.app = express();
    this.setupHttpServer();
  }

  setupHttpServer() {
    // CORS-Middleware für alle Stream-Routen
    this.app.use('/streams', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });
    
    // Spezielle Route für .m3u8 Dateien (muss vor statischer Auslieferung kommen)
    this.app.get('/streams/:deviceId.m3u8', (req, res) => {
      const deviceId = req.params.deviceId;
      const m3u8Path = path.join(__dirname, '../../streams', `${deviceId}.m3u8`);
      
      // Prüfe ob die m3u8-Datei existiert
      if (fs.existsSync(m3u8Path)) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(m3u8Path);
      } else {
        res.status(404).json({ error: 'HLS file not found' });
      }
    });
    
    // Statische Datei-Auslieferung für .ts Dateien und andere Stream-Dateien
    this.app.use('/streams', express.static(path.join(__dirname, '../../streams')));
  }

  startHttpServer() {
    if (!this.httpServer) {
      this.httpServer = this.app.listen(this.streamPort, () => {
        logger.info(`Stream HTTP server started on port ${this.streamPort}`);
      });
    }
  }

  async startStream(deviceId, rtspUrl) {
    try {
      // HTTP-Server starten falls nicht aktiv
      this.startHttpServer();
      
      // Prüfen ob Stream bereits aktiv
      if (this.activeStreams.has(deviceId)) {
        logger.info(`Stream for device ${deviceId} already active`);
        return this.getStreamUrl(deviceId);
      }

      // Alte Stream-Dateien löschen
      const streamsDir = path.join(__dirname, '../../streams');
      if (fs.existsSync(streamsDir)) {
        const files = fs.readdirSync(streamsDir);
        files.forEach(file => {
          if (file.startsWith(deviceId)) {
            try {
              fs.unlinkSync(path.join(streamsDir, file));
              logger.debug(`Deleted old stream file: ${file}`);
            } catch (error) {
              logger.error(`Error deleting stream file ${file}:`, error);
            }
          }
        });
      }

      logger.info(`Starting stream for device ${deviceId}: ${rtspUrl}`);

      const streamUrl = `http://localhost:${this.streamPort}/streams/${deviceId}.m3u8`;

      // Stream-Verzeichnis erstellen
      if (!fs.existsSync(streamsDir)) {
        fs.mkdirSync(streamsDir, { recursive: true });
      }

      // FFmpeg-Befehl für RTSP zu HLS Konvertierung
      const ffmpegArgs = [
        '-i', rtspUrl,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '3',
        '-hls_flags', 'delete_segments',
        '-hls_segment_filename', path.join(streamsDir, `${deviceId}_%03d.ts`),
        path.join(streamsDir, `${deviceId}.m3u8`)
      ];

      // Alte HLS-Dateien löschen für echten Live-Stream
      const m3u8Path = path.join(streamsDir, `${deviceId}.m3u8`);
      if (fs.existsSync(m3u8Path)) {
        fs.unlinkSync(m3u8Path);
        logger.info(`Deleted old HLS file for device ${deviceId}`);
      }

      // FFmpeg-Prozess starten mit stdin verfügbar
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe'], // stdin jetzt verfügbar
        detached: false,
        cwd: path.join(__dirname, '../../')
      });

      // Stream-Info speichern
      this.activeStreams.set(deviceId, {
        process: ffmpegProcess,
        rtspUrl,
        streamUrl,
        port: this.streamPort,
        startTime: new Date(),
        active: true
      });

      // FFmpeg-Logs
      ffmpegProcess.stdout.on('data', (data) => {
        logger.debug(`FFmpeg stdout for device ${deviceId}: ${data}`);
      });

      ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();
        logger.info(`FFmpeg stderr for device ${deviceId}: ${output}`);
        
        // Prüfe auf Verbindungsfehler
        if (output.includes('Connection refused') || output.includes('Authentication failed') || output.includes('Connection timed out')) {
          logger.error(`RTSP connection failed for device ${deviceId}: ${output}`);
          this.activeStreams.delete(deviceId);
        }
        
        // Prüfe auf erfolgreiche Verbindung
        if (output.includes('Input #0, rtsp')) {
          logger.info(`RTSP connection established for device ${deviceId}`);
        }
        
        // Prüfe auf HLS-spezifische Fehler
        if (output.includes('Invalid data found when processing input') || output.includes('End of file')) {
          logger.error(`HLS processing error for device ${deviceId}: ${output}`);
        }
      });

      ffmpegProcess.on('close', (code) => {
        logger.info(`FFmpeg process for device ${deviceId} exited with code ${code}`);
        if (code !== 0) {
          logger.error(`FFmpeg process failed for device ${deviceId} with exit code ${code}`);
          // Exit Code 254 bedeutet oft RTSP-Verbindungsprobleme
          if (code === 254) {
            logger.error(`RTSP connection failed for device ${deviceId} - check credentials and network`);
          }
        }
        this.activeStreams.delete(deviceId);
      });

      ffmpegProcess.on('error', (error) => {
        logger.error(`FFmpeg error for device ${deviceId}:`, error);
        this.activeStreams.delete(deviceId);
      });

      logger.info(`Stream started for device ${deviceId}: ${rtspUrl} -> ${streamUrl}`);
      return streamUrl;

    } catch (error) {
      logger.error(`Error starting stream for device ${deviceId}:`, error);
      throw error;
    }
  }

  async stopStream(deviceId) {
    try {
      const streamInfo = this.activeStreams.get(deviceId);
      if (!streamInfo) {
        logger.info(`No active stream found for device ${deviceId}`);
        return;
      }

      // SOFORT aus activeStreams entfernen um Status zu korrigieren
      this.activeStreams.delete(deviceId);

      // DEFINITIVE STOP-METHODE - FFmpeg stdin 'q' senden
      logger.info(`🛑 DEFINITIVE STOP-METHODE für Device ${deviceId}`);
      
      if (streamInfo.process && !streamInfo.process.killed) {
        const process = streamInfo.process;
        
        // METHODE 1: FFmpeg stdin 'q' senden (sauberes Beenden)
        try {
          if (process.stdin && !process.stdin.destroyed) {
            process.stdin.write('q');
            logger.info(`✅ FFmpeg stdin 'q' gesendet für Device ${deviceId}`);
          }
        } catch (error) {
          logger.error(`❌ FFmpeg stdin 'q' fehlgeschlagen:`, error);
        }
        
        // METHODE 2: SIGTERM senden
        try {
          process.kill('SIGTERM');
          logger.info(`✅ SIGTERM gesendet für Device ${deviceId}`);
        } catch (error) {
          logger.error(`❌ SIGTERM fehlgeschlagen:`, error);
        }
        
        // METHODE 3: SIGKILL nach 2 Sekunden
        setTimeout(() => {
          try {
            process.kill('SIGKILL');
            logger.info(`✅ SIGKILL gesendet für Device ${deviceId}`);
          } catch (error) {
            logger.error(`❌ SIGKILL fehlgeschlagen:`, error);
          }
        }, 2000);
      }
      
      // METHODE 4: System-basierte Kill-Befehle als Fallback
      const { exec } = require('child_process');
      const killCommands = [
        `pkill -f "ffmpeg.*${deviceId}"`,
        `pkill -9 -f "ffmpeg.*${deviceId}"`
      ];
      
      killCommands.forEach(cmd => {
        exec(cmd, (error) => {
          if (error) {
            logger.debug(`❌ ${cmd} fehlgeschlagen: ${error.message}`);
          } else {
            logger.info(`✅ ${cmd} erfolgreich`);
          }
        });
      });

      // Stream-Dateien löschen - verbesserte Methode
      try {
        const streamsDir = path.join(__dirname, '../../streams');
        if (fs.existsSync(streamsDir)) {
          const files = fs.readdirSync(streamsDir);
          files.forEach(file => {
            if (file.startsWith(deviceId)) {
              try {
                fs.unlinkSync(path.join(streamsDir, file));
                logger.debug(`Deleted stream file: ${file}`);
              } catch (error) {
                logger.error(`Error deleting stream file ${file}:`, error);
              }
            }
          });
        }
      } catch (error) {
        logger.error(`Error cleaning up stream files for device ${deviceId}:`, error);
      }

      // Fallback: Force kill falls normale Methode nicht funktioniert
      setTimeout(async () => {
        const stillActive = this.isStreamActive(deviceId);
        if (stillActive) {
          logger.warn(`Stream still active after stop attempt, force killing for device ${deviceId}`);
          await this.forceKillFFmpegProcesses(deviceId);
        }
      }, 5000);

      logger.info(`Stream stopped for device ${deviceId}`);
    } catch (error) {
      logger.error(`Error stopping stream for device ${deviceId}:`, error);
      throw error;
    }
  }

  getStreamUrl(deviceId) {
    const streamInfo = this.activeStreams.get(deviceId);
    return streamInfo ? streamInfo.streamUrl : null;
  }

  isStreamActive(deviceId) {
    // Einfache Prüfung: Nur schauen ob in activeStreams vorhanden
    return this.activeStreams.has(deviceId);
  }

  getAllActiveStreams() {
    const streams = [];
    for (const [deviceId, streamInfo] of this.activeStreams) {
      streams.push({
        deviceId,
        rtspUrl: streamInfo.rtspUrl,
        streamUrl: streamInfo.streamUrl,
        startTime: streamInfo.startTime
      });
    }
    return streams;
  }

  // Alle FFmpeg-Prozesse für ein Gerät beenden (Fallback-Methode)
  async forceKillFFmpegProcesses(deviceId) {
    try {
      const { exec } = require('child_process');
      
      logger.info(`Force killing all FFmpeg processes for device ${deviceId}`);
      
      // Alle FFmpeg-Prozesse finden die zu diesem Gerät gehören
      exec(`ps aux | grep ffmpeg | grep ${deviceId}`, (error, stdout) => {
        if (!error && stdout.trim()) {
          const lines = stdout.trim().split('\n');
          lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 1) {
              const pid = parts[1];
              logger.info(`Force killing FFmpeg process ${pid} for device ${deviceId}`);
              
              // Mehrfache Kill-Versuche
              exec(`kill -TERM ${pid}`, (termError) => {
                if (termError) {
                  logger.debug(`TERM failed for PID ${pid}:`, termError.message);
                }
              });
              
              setTimeout(() => {
                exec(`kill -KILL ${pid}`, (killError) => {
                  if (killError) {
                    logger.debug(`KILL failed for PID ${pid}:`, killError.message);
                  } else {
                    logger.info(`Successfully killed PID ${pid}`);
                  }
                });
              }, 500);
            }
          });
        } else {
          logger.info(`No FFmpeg processes found for device ${deviceId}`);
        }
      });
    } catch (error) {
      logger.error(`Error force killing FFmpeg processes for device ${deviceId}:`, error);
    }
  }

  async cleanup() {
    logger.info('Cleaning up all streams...');
    for (const [deviceId] of this.activeStreams) {
      await this.stopStream(deviceId);
    }
    
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  // Alternative: WebRTC-Stream (für bessere Browser-Kompatibilität)
  async startWebRTCStream(deviceId, rtspUrl) {
    try {
      // Hier würde WebRTC-Implementierung stehen
      // Für jetzt verwenden wir HLS als Fallback
      return await this.startStream(deviceId, rtspUrl);
    } catch (error) {
      logger.error(`Error starting WebRTC stream for device ${deviceId}:`, error);
      throw error;
    }
  }

  // Stream-Status abrufen
  getStreamStatus(deviceId) {
    const streamInfo = this.activeStreams.get(deviceId);
    if (!streamInfo) {
      return { active: false };
    }

    return {
      active: true,
      rtspUrl: streamInfo.rtspUrl,
      streamUrl: streamInfo.streamUrl,
      startTime: streamInfo.startTime,
      uptime: Date.now() - streamInfo.startTime.getTime()
    };
  }

  // Prüfen ob Stream aktiv ist
  isStreamActive(deviceId) {
    // Prüfe ob HLS-Datei existiert und aktuell ist
    const streamsDir = path.join(__dirname, '../../streams');
    const m3u8Path = path.join(streamsDir, `${deviceId}.m3u8`);
    
    if (!fs.existsSync(m3u8Path)) {
      return false;
    }
    
    // Prüfe ob die Datei in den letzten 10 Sekunden modifiziert wurde
    const stats = fs.statSync(m3u8Path);
    const now = Date.now();
    const fileAge = now - stats.mtime.getTime();
    
    return fileAge < 30000; // Datei ist jünger als 30 Sekunden
  }
}

module.exports = StreamService;
