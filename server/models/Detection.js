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
      enum: ['tapo', 'raspberry-pi','local', 'both', 'unknown'],
      default: 'unknown'
    },
    esp_rot: Number,
    esp_tilt: Number,
    is_target_bird: Boolean,
    bird_id: String
  }],
  target_bird: {
    bird_id: String,
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
    camera_source: {
      type: String,
      enum: ['tapo', 'raspberry-pi', 'local', 'both', 'unknown', 'direct', null],
      default: undefined
    },
    esp_rot: Number,
    esp_tilt: Number,
    is_target_bird: Boolean
  },
  // One entry per bird in the image. Tinder reviews only role "main".
  birds: [{
    bird_id: { type: String, required: true },
    role: { type: String, enum: ['main', 'side'], required: true },
    camera_source: {
      type: String,
      enum: ['tapo', 'raspberry-pi', 'local', 'both', 'unknown', 'direct'],
      default: 'unknown'
    },
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
    review: {
      status: {
        type: String,
        enum: ['confirmed_pigeon', 'no_pigeon', null],
        default: null
      },
      source: String,
      at: Date
    },
    origin_run_id: String
  }],
  // Append-only model passes. The capture-time pass has run_id "live".
  model_runs: [{
    run_id: { type: String, required: true },
    kind: { type: String, enum: ['live', 'replay'], default: 'live' },
    at: Date,
    image: { type: String, default: 'zoomed_image' },
    model: {
      name: String,
      version: String,
      confidence_threshold: Number,
      iou_threshold: Number
    },
    boxes: [{
      bird_id: String,
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
      camera_source: {
        type: String,
        enum: ['tapo', 'raspberry-pi', 'local', 'both', 'unknown', 'direct', null]
      },
      iou_to_bird: Number,
      review: {
        status: {
          type: String,
          enum: ['confirmed_pigeon', 'no_pigeon', null],
          default: null
        },
        source: String,
        at: Date
      }
    }]
  }],
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
  },
  // Bei Hardware-Monitor: ob bei dieser Detection geschossen wurde (Monitor war scharf)
  shotFired: {
    type: Boolean,
    default: false
  },
  // Welche Schuss-Aktionen bei dieser Detection aktiv waren (beim Speichern berechnet)
  shootActive: {
    water: { type: Boolean, default: false },
    laser: { type: Boolean, default: false },
    audio: { type: Boolean, default: false }
  },
  // Wassertank-Sensor zum Schusszeitpunkt (true=OK, false=leer). Nur gesetzt wenn Wasser geplant war.
  watertank: {
    type: Boolean,
    default: undefined
  },
  // Slave (etc.) stills at scan/route pose when detection was saved (no YOLO)
  scanPhotos: [{
    cameraId: String,
    cameraName: String,
    cameraType: String,
    role: String,
    image: {
      url: String,
      filename: String,
      size: Number
    },
    pose: {
      rotation: Number,
      tilt: Number
    },
    capturedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Stills at aim pose, before shoot/deterrence (Foto vor Vertreibung)
  preShootPhotos: [{
    cameraId: String,
    cameraName: String,
    cameraType: String,
    role: String,
    image: {
      url: String,
      filename: String,
      size: Number
    },
    pose: {
      rotation: Number,
      tilt: Number
    },
    capturedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // FOV-Kalibrierung (Shoot-Test): ein Sample pro Detection/Bild
  fovCalibration: {
    at: Date,
    converged: Boolean,
    error: String,
    scanPose: {
      rotation: Number,
      tilt: Number
    },
    autoAimPose: {
      rotation: Number,
      tilt: Number
    },
    finalPose: {
      rotation: Number,
      tilt: Number
    },
    offsetPx: {
      x: Number,
      y: Number
    },
    zoomFactor: Number,
    fovH: Number,
    fovV: Number,
    fovSollH: Number,
    fovSollV: Number,
    residualPx: {
      x: Number,
      y: Number
    },
    method: String,
    confidence: Number,
    iterations: Number,
    waypointNumber: Number,
    // true = manuell ausgerichtet (Steuerkreuz / Nachklicken), false/absent = Auto
    manual: Boolean,
    // Herkunft: auto | manual | post_shot | on_detection
    source: String,
    // Manuell aus Statistik/Median ausgeschlossen (Shoot-Test Batch)
    excluded: Boolean,
    excludedAt: Date
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
