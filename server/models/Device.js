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
    }
  },
  // Camera Configuration
  camera: {
    type: {
      type: String,
      enum: ['tapo', 'direct', 'local'],
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
      }]
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
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Method to get RTSP URL based on camera configuration
deviceSchema.methods.getRtspUrl = function() {
  if (this.camera.type === 'tapo') {
    const { ip, username, password, stream } = this.camera.tapo;
    if (!ip || !username || !password || !stream) {
      throw new Error('Tapo camera configuration incomplete');
    }
    return `rtsp://${username}:${password}@${ip}:554/${stream}`;
  } else if (this.camera.type === 'direct') {
    return this.camera.directUrl || this.camera.rtspUrl;
  } else {
    // Fallback to directUrl or rtspUrl
    return this.camera.directUrl || this.camera.rtspUrl;
  }
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
