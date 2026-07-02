const mongoose = require('mongoose');

// Stitched panorama result per device and stitching method (opencv | grid | hugin).
const frameMappingSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  rotation: { type: Number, required: true },
  tilt: { type: Number, required: true },
  image_size: {
    width: Number,
    height: Number
  },
  transformation_matrix: [[Number]],
  panorama_corners: [[Number]]
}, { _id: false });

const panoramaScanResultSchema = new mongoose.Schema({
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true
  },
  method: {
    type: String,
    enum: ['opencv', 'grid', 'hugin', 'cylindrical'],
    required: true
  },
  panorama: { type: String },
  panorama_size: {
    width: Number,
    height: Number
  },
  frames: [frameMappingSchema],
  statistics: { type: mongoose.Schema.Types.Mixed },
  grid_info: { type: mongoose.Schema.Types.Mixed },
  hugin_pto: { type: String }
}, {
  timestamps: true
});

panoramaScanResultSchema.index({ device: 1, method: 1 }, { unique: true });

module.exports = mongoose.model('PanoramaScanResult', panoramaScanResultSchema);
