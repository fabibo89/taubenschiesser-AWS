/**
 * One-time migration: move route coordinate images that are embedded in the
 * Device document into the dedicated RouteImage collection, then clear them from
 * the device so the document drops back under MongoDB's 16MB BSON limit.
 *
 * Usage:
 *   MONGODB_URI='mongodb://...' node scripts/migrate-route-images.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('../models/Device');
const routeImages = require('../utils/routeImages');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected. Scanning devices...');

  const devices = await Device.find({});
  let migratedDevices = 0;
  let migratedImages = 0;

  for (const device of devices) {
    const coordinates = device.actions?.route?.coordinates || [];
    const embedded = coordinates.filter((c) => c && c.image).length;
    if (embedded === 0) continue;

    await routeImages.persistAndStripCoordinateImages(device._id, coordinates);
    routeImages.stripCoordinateImagesFromDoc(device);
    await device.save();

    migratedDevices += 1;
    migratedImages += embedded;
    console.log(`✓ ${device.name}: moved ${embedded} image(s) to RouteImage collection`);
  }

  console.log(`Done. Migrated ${migratedImages} image(s) across ${migratedDevices} device(s).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
