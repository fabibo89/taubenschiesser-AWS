const PanoramaScanResult = require('../models/PanoramaScanResult');

async function listByDevice(deviceId) {
  return PanoramaScanResult.find({ device: deviceId })
    .select('-panorama -hugin_pto')
    .lean();
}

async function getByDeviceAndMethod(deviceId, method, includePanorama = false) {
  const select = includePanorama ? undefined : '-panorama';
  return PanoramaScanResult.findOne({ device: deviceId, method })
    .select(select)
    .lean();
}

async function getPanorama(deviceId, method) {
  const doc = await PanoramaScanResult.findOne({ device: deviceId, method })
    .select('panorama panorama_size method frames statistics grid_info hugin_pto createdAt updatedAt')
    .lean();
  return doc;
}

async function upsert(deviceId, method, data) {
  return PanoramaScanResult.findOneAndUpdate(
    { device: deviceId, method },
    {
      device: deviceId,
      method,
      panorama: data.panorama,
      panorama_size: data.panorama_size,
      frames: data.frames || [],
      statistics: data.statistics || null,
      grid_info: data.grid_info || null,
      hugin_pto: data.hugin_pto || null
    },
    { upsert: true, new: true }
  );
}

async function clear(deviceId, method = null) {
  const filter = { device: deviceId };
  if (method) filter.method = method;
  const result = await PanoramaScanResult.deleteMany(filter);
  return result.deletedCount;
}

module.exports = {
  listByDevice,
  getByDeviceAndMethod,
  getPanorama,
  upsert,
  clear
};
