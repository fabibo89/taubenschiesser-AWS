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
    detection_quality: String
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
  }
}, {
  timestamps: true
});

// Index for efficient queries
detectionSchema.index({ device: 1, processedAt: -1 });
detectionSchema.index({ processedAt: -1 });

module.exports = mongoose.model('Detection', detectionSchema);
