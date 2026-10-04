const mongoose = require('mongoose');
const {
  syncDeviceCameras,
  getMasterCamera,
  getEnabledCameras,
  getHttpStillConfig,
  isHttpStillType
} = require('../utils/deviceCameras');

const deviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['taubenschiesser'],
    default: 'taubenschiesser'
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'maintenance', 'error'],
    default: 'offline'
  },
  // Separate status for Taubenschiesser hardware
  taubenschiesserStatus: {
    type: String,
    enum: ['online', 'offline', 'maintenance', 'error'],
    default: 'offline'
  },
  // Separate status for camera
  cameraStatus: {
    type: String,
    enum: ['online', 'offline', 'maintenance', 'error'],
    default: 'offline'
  },
  location: {
    name: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  hardware: {
    firmware: String,
    version: String,
    lastUpdate: Date
  },
  // Taubenschiesser Hardware Configuration
  taubenschiesser: {
    ip: {
      type: String,
      required: true,
      trim: true
    },
    invertRotation: {
      type: Boolean,
      default: false
    },
    invertTilt: {
      type: Boolean,
      default: false
    },
    // Schussdauer in ms (ESP shake), wird von UI, HA und Hardware-Monitor genutzt
    shootingTimeMs: {
      type: Number,
      default: 500
    },
    // Wartezeit nach Bewegung, bevor Bilder analysiert werden (ms)
    stabilizeTimeMs: {
      type: Number,
      default: 500
    },
    // Max. Wartezeit zwischen Bewegungen (Sekunden) für dynamischen Timer im Hardware-Monitor
    // (ehemals actions.waitBetweenMovesSeconds)
    maxWaitBetweenMovesSeconds: {
      type: Number,
      default: 20,
      min: 5,
      max: 300
    },
    // Laser beim Schuss: false = durchgehend an, true = blinkend
    shootLaserBlink: {
      type: Boolean,
      default: false
    },
    // Blink-Intervall in ms (nur wenn shootLaserBlink true)
    shootLaserBlinkMs: {
      type: Number,
      default: 100,
      min: 20,
      max: 500
    },
    // Laser beim Schuss aktivieren
    shootUseLaser: {
      type: Boolean,
      default: true
    },
    // Akustisches Signal beim Schuss (ESP Audio-Stack)
    shootUseAudio: {
      type: Boolean,
      default: false
    },
    // Bei Erkennung (ggf. nach Schuss): FOV-Sample per Bildabgleich auf Detection speichern (kein Gerät-FOV-Write)
    postShotFovCalibrate: {
      type: Boolean,
      default: false
    }
  },
  // Camera Configuration
  camera: {
    type: {
      type: String,
      enum: ['tapo', 'direct', 'local', 'raspberry-pi', 'esp32-p4', 'dual'],
      default: 'tapo'
    },
    // For Tapo cameras
    tapo: {
      ip: String,
      username: String,
      password: String,
      stream: {
        type: String,
        enum: ['stream1', 'stream2'],
        default: 'stream1'
      },
      fov: {
        type: Number,
        default: 110  // Default diagonal FOV in degrees for Tapo cameras
      }
    },
    // For Raspberry Pi cameras
    raspberryPi: {
      ip: String,
      port: {
        type: Number,
        default: 8080
      },
      endpoint: {
        type: String,
        default: '/image.jpg'
      },
      streamEndpoint: {
        type: String,
        default: '/stream.mjpeg'
      },
      flip: {
        type: Boolean,
        default: false
      },
      fov: {
        type: Number,
        default: 75  // Per-axis FOV when square; else diagonal FOV (degrees)
      },
      fovH: {
        type: Number  // Optional calibrated horizontal FOV (degrees)
      },
      fovV: {
        type: Number  // Optional calibrated vertical FOV (degrees)
      },
      angle: {
        type: Number,
        default: 0  // Optional Bilddrehung in Grad (0 = keine Drehung)
      },
      square: {
        type: Boolean,
        default: true  // Optional: quadratischer Ausschnitt (square=true)
      },
      resolution: {
        type: String,
        default: '640'  // Zielauflösung als "WIDTHxHEIGHT" oder einzelner Wert für Quadrate
      }
    },
    // ESP32-P4 Cam — same HTTP still API as Raspberry Pi camera_server
    esp32P4: {
      ip: String,
      port: {
        type: Number,
        default: 8080
      },
      endpoint: {
        type: String,
        default: '/image.jpg'
      },
      streamEndpoint: {
        type: String,
        default: '/stream.mjpeg'
      },
      flip: {
        type: Boolean,
        default: false
      },
      fov: {
        type: Number,
        default: 75
      },
      fovH: Number,
      fovV: Number,
      angle: {
        type: Number,
        default: 0
      },
      square: {
        type: Boolean,
        default: true
      },
      resolution: {
        type: String,
        default: '640'
      }
    },
    // For direct RTSP or other cameras
    directUrl: String,
    // Legacy field for backward compatibility
    rtspUrl: String,
    // For local image testing
    useLocalImage: {
      type: Boolean,
      default: false
    },
    localImagePath: String,
    isStreaming: {
      type: Boolean,
      default: false
    },
    lastImage: String,
    lastDetection: Date
  },
  /**
   * Multi-camera list (master/slave). Source of truth going forward.
   * Legacy `camera` is kept in sync for older monitor/UI paths.
   */
  cameras: [{
    id: { type: String, required: true },
    name: { type: String, default: '' },
    type: {
      type: String,
      enum: ['tapo', 'raspberry-pi', 'esp32-p4', 'direct', 'local'],
      required: true
    },
    role: {
      type: String,
      enum: ['master', 'slave'],
      default: 'slave'
    },
    enabled: {
      type: Boolean,
      default: true
    },
    /** Capture a still at aim pose after aim, before shoot/deterrence */
    photoBeforeDeterrence: {
      type: Boolean,
      default: false
    },
    tapo: {
      ip: String,
      username: String,
      password: String,
      stream: {
        type: String,
        enum: ['stream1', 'stream2'],
        default: 'stream1'
      },
      fov: {
        type: Number,
        default: 110
      }
    },
    raspberryPi: {
      ip: String,
      port: {
        type: Number,
        default: 8080
      },
      endpoint: {
        type: String,
        default: '/image.jpg'
      },
      streamEndpoint: {
        type: String,
        default: '/stream.mjpeg'
      },
      flip: {
        type: Boolean,
        default: false
      },
      fov: {
        type: Number,
        default: 75
      },
      fovH: Number,
      fovV: Number,
      angle: {
        type: Number,
        default: 0
      },
      square: {
        type: Boolean,
        default: true
      },
      resolution: {
        type: String,
        default: '640'
      }
    },
    esp32P4: {
      ip: String,
      port: {
        type: Number,
        default: 8080
      },
      endpoint: {
        type: String,
        default: '/image.jpg'
      },
      streamEndpoint: {
        type: String,
        default: '/stream.mjpeg'
      },
      flip: {
        type: Boolean,
        default: false
      },
      fov: {
        type: Number,
        default: 75
      },
      fovH: Number,
      fovV: Number,
      angle: {
        type: Number,
        default: 0
      },
      square: {
        type: Boolean,
        default: true
      },
      resolution: {
        type: String,
        default: '640'
      }
    },
    directUrl: String,
    useLocalImage: {
      type: Boolean,
      default: false
    },
    localImagePath: String
  }],
  // Route Configuration
  actions: {
    mode: {
      type: String,
      enum: ['impulse', 'route'],
      default: 'impulse'
    },
    // Sekunden Pause zwischen Ende einer Bewegung und nächster Bewegung (Hardware-Monitor)
    waitBetweenMovesSeconds: {
      type: Number,
      default: 20,
      min: 5,
      max: 300
    },
    route: {
      coordinates: [{
        rotation: {
          type: Number
          // Temporarily remove min/max for debugging
          // min: 0,
          // max: 360
        },
        tilt: {
          type: Number
          // Temporarily remove min/max for debugging
          // min: -180,
          // max: 180
        },
        order: {
          type: Number,
          default: 0
        },
        zoom: {
          type: Number,
          min: 1,
          max: 3,
          default: 1
        },
        image: {
          type: String  // Base64 encoded image
        },
        audioEnabled: {
          type: Boolean,
          default: false
        },
        laserZone: {
          enabled: { type: Boolean, default: false },
          laserEnabled: { type: Boolean, default: false },
          shape: { type: String, enum: ['rect', 'quad', 'polygon'], default: 'polygon' },
          x: { type: Number, min: 0, max: 1 },
          y: { type: Number, min: 0, max: 1 },
          width: { type: Number, min: 0.01, max: 1 },
          height: { type: Number, min: 0.01, max: 1 },
          points: [{
            x: { type: Number, min: 0, max: 1 },
            y: { type: Number, min: 0, max: 1 }
          }]
        }
      }],
      panorama: {
        image: {
          type: String  // Base64 encoded panorama image
        },
        transformation_matrices: [{
          type: [[Number]]  // Array of 3x3 matrices
        }],
        image_sizes: [{
          width: Number,
          height: Number
        }],
        statistics: {
          total_requested: Number,
          total_loaded: Number,
          total_failed: Number,
          total_used: Number
        },
        created_at: {
          type: Date,
          default: Date.now
        }
      }
    }
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Geräte-Status für Hardware Monitor
  monitorStatus: {
    type: String,
    enum: ['running', 'paused', 'stopped'],
    default: 'paused'
  },
  // Last live event from hardware-monitor (persisted so HA can show attributes)
  hardwareMonitor: {
    lastEventType: String,
    lastEventData: mongoose.Schema.Types.Mixed,
    lastEventAt: Date,
    // Last device_waiting payload (kept even if later events are birds_detected, etc.)
    lastWaitingData: mongoose.Schema.Types.Mixed,
    lastWaitingAt: Date
  },
  // Last known servo angles from ESP MQTT (for dashboard on page load)
  lastKnownPosition: {
    rot: { type: Number },
    tilt: { type: Number },
    updatedAt: { type: Date }
  },
  // Monitor scharf: bei Taubenerkennung schießen (true) oder nur Detection speichern (false)
  monitorArmed: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

deviceSchema.pre('save', function syncCamerasHook(next) {
  try {
    syncDeviceCameras(this);
    next();
  } catch (err) {
    next(err);
  }
});

deviceSchema.methods.getMasterCamera = function() {
  return getMasterCamera(this);
};

deviceSchema.methods.getEnabledCameras = function() {
  return getEnabledCameras(this);
};

// Method to get RTSP URL based on camera configuration (master preferred)
deviceSchema.methods.getRtspUrl = function() {
  const master = getMasterCamera(this);
  if (master?.type === 'tapo' && master.tapo?.ip && master.tapo?.username && master.tapo?.password) {
    const { ip, username, password, stream } = master.tapo;
    return `rtsp://${username}:${password}@${ip}:554/${stream || 'stream1'}`;
  }
  if (master?.type === 'direct') {
    return master.directUrl || this.camera?.directUrl || this.camera?.rtspUrl || null;
  }

  if (this.camera?.type === 'raspberry-pi') {
    return null;
  }
  if (this.camera?.type === 'tapo' || this.camera?.type === 'dual') {
    if (this.camera.tapo && this.camera.tapo.ip && this.camera.tapo.username && this.camera.tapo.password) {
      const { ip, username, password, stream } = this.camera.tapo;
      return `rtsp://${username}:${password}@${ip}:554/${stream || 'stream1'}`;
    }
  }

  if (this.camera?.type === 'direct') {
    return this.camera.directUrl || this.camera.rtspUrl;
  }

  return this.camera?.directUrl || this.camera?.rtspUrl || null;
};

// Method to get HTTP image URL for PiCam / ESP-P4 Cam (master preferred)
deviceSchema.methods.getImageUrl = function() {
  const master = getMasterCamera(this);
  const httpCfg = (master && isHttpStillType(master.type) ? getHttpStillConfig(master) : null)
    || getHttpStillConfig(this.camera)
    || null;
  if (!httpCfg || !httpCfg.ip) {
    return null;
  }
  const port = httpCfg.port || 8080;
  const endpoint = httpCfg.endpoint || '/image.jpg';
  const flip = !!httpCfg.flip;
  const angle = typeof httpCfg.angle === 'number' ? httpCfg.angle : 0;
  const square = httpCfg.square == null ? true : !!httpCfg.square;
  const resolution = httpCfg.resolution != null && String(httpCfg.resolution).trim() !== ''
    ? String(httpCfg.resolution)
    : '640';

  const params = [];
  if (flip) params.push('flip=true');
  if (angle && angle !== 0) params.push(`angle=${angle}`);
  params.push(square ? 'square=true' : 'square=false');
  params.push(`resolution=${encodeURIComponent(resolution)}`);

  const baseUrl = `http://${httpCfg.ip}:${port}${endpoint}`;
  return params.length === 0 ? baseUrl : `${baseUrl}?${params.join('&')}`;
};

// Method to get Taubenschiesser IP
deviceSchema.methods.getTaubenschiesserIp = function() {
  if (this.taubenschiesser && this.taubenschiesser.ip) {
    return this.taubenschiesser.ip;
  }
  return null;
};

// Method to update Taubenschiesser status
deviceSchema.methods.updateTaubenschiesserStatus = function(status) {
  this.taubenschiesserStatus = status;
  this.lastSeen = new Date();
  return this.save();
};

// Method to update camera status
deviceSchema.methods.updateCameraStatus = function(status) {
  this.cameraStatus = status;
  return this.save();
};

// Method to check if camera should be considered online (including local image)
deviceSchema.methods.getEffectiveCameraStatus = function() {
  // If using local image, camera is considered online
  if (this.camera && this.camera.useLocalImage && this.camera.localImagePath) {
    return 'online';
  }
  return this.cameraStatus;
};

// Method to get overall device status
deviceSchema.methods.getOverallStatus = function() {
  const effectiveCameraStatus = this.getEffectiveCameraStatus();
  
  if (this.taubenschiesserStatus === 'online' && effectiveCameraStatus === 'online') {
    return 'online';
  } else if (this.taubenschiesserStatus === 'error' || effectiveCameraStatus === 'error') {
    return 'error';
  } else if (this.taubenschiesserStatus === 'maintenance' || effectiveCameraStatus === 'maintenance') {
    return 'maintenance';
  } else {
    return 'offline';
  }
};

// Index for efficient queries
deviceSchema.index({ owner: 1 });
deviceSchema.index({ status: 1 });
deviceSchema.index({ lastSeen: -1 });

module.exports = mongoose.model('Device', deviceSchema);
