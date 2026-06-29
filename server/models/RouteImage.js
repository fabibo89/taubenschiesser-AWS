const mongoose = require('mongoose');

// Route coordinate images are stored in their own collection instead of being
// embedded in the Device document. Embedding base64 images quickly pushed the
// device document past MongoDB's hard 16MB BSON limit, which broke every
// device.save(). Keyed by (device, index) to match the index-based route API.
const routeImageSchema = new mongoose.Schema({
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true
  },
  index: {
    type: Number,
    required: true
  },
  image: {
    type: String // Base64 (data URL) encoded image
  }
}, {
  timestamps: true
});

routeImageSchema.index({ device: 1, index: 1 }, { unique: true });

module.exports = mongoose.model('RouteImage', routeImageSchema);
