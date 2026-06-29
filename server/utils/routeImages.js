const RouteImage = require('../models/RouteImage');
const logger = require('./logger');

/**
 * Load all route coordinate images for a device as a Map (index -> image string).
 */
async function loadRouteImageMap(deviceId) {
  const docs = await RouteImage.find({ device: deviceId }).select('index image').lean();
  const map = new Map();
  for (const doc of docs) {
    map.set(doc.index, doc.image);
  }
  return map;
}

/**
 * Mutate a plain device object so each route coordinate carries its `image`,
 * loaded from the RouteImage collection. Keeps API responses backward compatible
 * with clients that read `coordinates[i].image`.
 */
async function attachRouteImages(deviceObj) {
  const coordinates = deviceObj?.actions?.route?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return deviceObj;
  const map = await loadRouteImageMap(deviceObj._id);
  coordinates.forEach((coord, index) => {
    if (map.has(index)) {
      coord.image = map.get(index);
    }
  });
  return deviceObj;
}

/**
 * Return the coordinate images for a device as an array aligned with coordinate
 * indexes. Falls back to any image still embedded in the passed coordinates.
 */
async function getCoordinatesWithImages(deviceId, coordinates) {
  const map = await loadRouteImageMap(deviceId);
  return (coordinates || []).map((coord, index) => ({
    ...(coord.toObject ? coord.toObject() : coord),
    image: map.has(index) ? map.get(index) : (coord.image || null)
  }));
}

/**
 * Upsert a single route coordinate image.
 */
async function setRouteImage(deviceId, index, image) {
  await RouteImage.findOneAndUpdate(
    { device: deviceId, index },
    { device: deviceId, index, image },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Get a single route coordinate image (or null).
 */
async function getRouteImage(deviceId, index) {
  const doc = await RouteImage.findOne({ device: deviceId, index }).select('image').lean();
  return doc ? doc.image : null;
}

/**
 * Persist any images embedded in the given coordinates into the RouteImage
 * collection, then strip the `image` field from the coordinates so the device
 * document stays small. Also removes RouteImage docs whose index is now out of
 * range (e.g. after route points were removed).
 *
 * Mutates the coordinates array in place.
 */
async function persistAndStripCoordinateImages(deviceId, coordinates) {
  if (!Array.isArray(coordinates)) return;

  for (let index = 0; index < coordinates.length; index += 1) {
    const coord = coordinates[index];
    if (coord && coord.image) {
      try {
        await setRouteImage(deviceId, index, coord.image);
      } catch (err) {
        logger.error(`Failed to persist route image (device ${deviceId}, index ${index}):`, err.message);
      }
      coord.image = undefined;
    }
  }

  try {
    await RouteImage.deleteMany({ device: deviceId, index: { $gte: coordinates.length } });
  } catch (err) {
    logger.error(`Failed to prune route images for device ${deviceId}:`, err.message);
  }
}

/**
 * Remove the `image` field from every coordinate of a device document so that
 * device.save() never writes large base64 blobs back into the device document.
 * Mutates the Mongoose document in place.
 */
function stripCoordinateImagesFromDoc(device) {
  const coordinates = device?.actions?.route?.coordinates;
  if (!Array.isArray(coordinates)) return;
  coordinates.forEach((coord) => {
    if (coord && coord.image) {
      coord.image = undefined;
    }
  });
}

module.exports = {
  loadRouteImageMap,
  attachRouteImages,
  getCoordinatesWithImages,
  setRouteImage,
  getRouteImage,
  persistAndStripCoordinateImages,
  stripCoordinateImagesFromDoc
};
