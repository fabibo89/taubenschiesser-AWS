const mongoose = require('mongoose');

// Panorama scan images: one document per captured frame during a grid scan.
// Stored separately from the Device document to avoid the 16MB BSON limit.
const panoramaScanImageSchema = new mongoose.Schema({
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true
  },
  order: {
    type: Number,
    required: true
  },
  rotation: {
    type: Number,
    required: true
  },
  tilt: {
    type: Number,
    required: true
  },
  image: {
    type: String
  }
}, {
  timestamps: true
});

panoramaScanImageSchema.index({ device: 1, order: 1 }, { unique: true });

module.exports = mongoose.model('PanoramaScanImage', panoramaScanImageSchema);
