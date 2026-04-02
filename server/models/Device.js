const mongoose = require('mongoose');

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
    }
  },
  // Camera Configuration
  camera: {
    type: {
      type: String,
      enum: ['tapo', 'direct', 'local', 'raspberry-pi', 'dual'],
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
        default: 75  // Default diagonal FOV in degrees for Raspberry Pi Camera Module 3
      },
      angle: {
        type: Number,
        default: 0  // Optional Bilddrehung in Grad (0 = keine Drehung)
      },
      square: {
        type: Boolean,
        default: false  // Optional: quadratischer Ausschnitt (square=true)
      },
      resolution: {
        type: String  // Optional: Zielauflösung als "WIDTHxHEIGHT" oder einzelner Wert für Quadrate
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

// Method to get RTSP URL based on camera configuration
deviceSchema.methods.getRtspUrl = function() {
  if (this.camera.type === 'raspberry-pi') {
    // Raspberry Pi doesn't use RTSP, return null
    return null;
  } else if (this.camera.type === 'tapo' || this.camera.type === 'dual') {
    // Check for Tapo camera - works for both 'tapo' and 'dual' mode
    if (this.camera.tapo && this.camera.tapo.ip && this.camera.tapo.username && this.camera.tapo.password) {
      const { ip, username, password, stream } = this.camera.tapo;
      return `rtsp://${username}:${password}@${ip}:554/${stream || 'stream1'}`;
    }
    // If dual mode but no Tapo config, fall through to other options
  }
  
  if (this.camera.type === 'direct') {
    return this.camera.directUrl || this.camera.rtspUrl;
  }
  
  // Fallback to directUrl or rtspUrl
  return this.camera.directUrl || this.camera.rtspUrl;
};

// Method to get HTTP image URL for Raspberry Pi cameras
deviceSchema.methods.getImageUrl = function() {
  if (this.camera.type === 'raspberry-pi') {
    const pi = this.camera.raspberryPi;
    if (!pi || !pi.ip) {
      return null;
    }
    const port = pi.port || 8080;
    const endpoint = pi.endpoint || '/image.jpg';
    const flip = !!pi.flip;
    const angle = typeof pi.angle === 'number' ? pi.angle : 0;
    const square = !!pi.square;
    const resolution = pi.resolution;

    const params = [];
    if (flip) {
      params.push('flip=true');
    }
    if (angle && angle !== 0) {
      params.push(`angle=${angle}`);
    }
    if (square) {
      params.push('square=true');
    }
    if (resolution) {
      params.push(`resolution=${encodeURIComponent(resolution)}`);
    }

    const baseUrl = `http://${pi.ip}:${port}${endpoint}`;
    if (params.length === 0) {
      return baseUrl;
    }
    return `${baseUrl}?${params.join('&')}`;
  }
  return null;
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
