const PanoramaScanImage = require('../models/PanoramaScanImage');

async function listByDevice(deviceId) {
  return PanoramaScanImage.find({ device: deviceId })
    .select('order rotation tilt image createdAt')
    .sort({ order: 1 })
    .lean();
}

async function replaceAll(deviceId, frames) {
  await PanoramaScanImage.deleteMany({ device: deviceId });

  if (!frames || frames.length === 0) {
    return [];
  }

  const docs = frames.map((frame, i) => ({
    device: deviceId,
    order: frame.order ?? i,
    rotation: frame.rotation,
    tilt: frame.tilt,
    image: frame.image
  }));

  await PanoramaScanImage.insertMany(docs);
  return docs.length;
}

async function clear(deviceId) {
  const result = await PanoramaScanImage.deleteMany({ device: deviceId });
  return result.deletedCount;
}

module.exports = {
  listByDevice,
  replaceAll,
  clear
};
