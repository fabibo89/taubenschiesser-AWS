const mongoose = require('mongoose');

const detectionSchema = new mongoose.Schema({
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true
  },
  image: {
    url: String,
    filename: String,
    size: Number
  },
  zoomed_image: {
    url: String,
    filename: String,
    size: Number
  },
  // Dual camera support - images from both cameras
  tapo_image: {
    url: String,
    filename: String,
    size: Number
  },
  tapo_zoomed_image: {
    url: String,
    filename: String,
    size: Number
  },
  raspberry_pi_image: {
    url: String,
    filename: String,
    size: Number
  },
  raspberry_pi_zoomed_image: {
    url: String,
    filename: String,
    size: Number
  },
  detections: [{
    class: String,
    confidence: Number,
    bbox: {
      x: Number,
      y: Number,
      width: Number,
      height: Number
    },
    position: {
      center_x: Number,
      center_y: Number,
      width: Number,
      height: Number
    },
    size_category: String,
    detection_quality: String,
    camera_source: {
      type: String,
      enum: ['tapo', 'raspberry-pi', 'both', 'unknown'],
      default: 'unknown'
    }
  }],
  target_bird: {
    class: String,
    confidence: Number,
    bbox: {
      x: Number,
      y: Number,
      width: Number,
      height: Number
    },
    position: {
      center_x: Number,
      center_y: Number,
      width: Number,
      height: Number
    }
  },
  processedAt: {
    type: Date,
    default: Date.now
  },
  processingTime: Number, // in milliseconds
  zoom_factor: {
    type: Number,
    default: 1.0
  },
  image_info: {
    original_size: {
      width: Number,
      height: Number
    },
    zoomed_size: {
      width: Number,
      height: Number
    }
  },
  model: {
    name: String,
    version: String
  },
  camera_source: {
    type: String,
    enum: ['tapo', 'raspberry-pi', 'direct', 'local', 'unknown'],
    default: 'unknown'
  },
  classification_status: {
    type: String,
    enum: ['unclassified', 'confirmed_pigeon', 'no_pigeon', null],
    default: null
  },
  classifiedAt: {
    type: Date
  },
  temperature: {
    type: Number  // Temperatur in °C zum Zeitpunkt der Detection
  },
  camera_position: {
    rotation: {
      type: Number  // Rotation (0-360 Grad)
    },
    tilt: {
      type: Number  // Tilt (-180 bis 180 Grad)
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
detectionSchema.index({ device: 1, processedAt: -1 });
detectionSchema.index({ processedAt: -1 });
// For unclassified list (Tauben-Tinder): find by device + classification_status + sort by date
detectionSchema.index({ device: 1, classification_status: 1, processedAt: -1 });
// Covering index for GET /detections/statistics (30-day dashboard) – avoids reading full ~3MB docs
detectionSchema.index({ device: 1, processedAt: -1, classification_status: 1, temperature: 1 });

module.exports = mongoose.model('Detection', detectionSchema);
