/**
 * Diagnose: Wo geht die Zeit beim Dashboard-Load hin?
 * Führt die gleichen DB-Operationen wie GET /api/devices und GET /api/cv/detections/statistics aus,
 * misst Laufzeiten und holt executionStats für die 30-Tage-Aggregation.
 *
 * Aufruf: MONGODB_URI='mongodb://...' node scripts/check-dashboard-perf.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('../models/Device');
const Detection = require('../models/Detection');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin';

// 30-Tage-Statistik-Pipeline (wie computerVision.js). _id: 0 nötig für Covering-Index (kein FETCH).
function statsPipeline(matchDevice, startDate) {
  return [
    { $match: { device: matchDevice, processedAt: { $gte: startDate } } },
    { $project: { _id: 0, device: 1, processedAt: 1, classification_status: 1, temperature: 1 } },
    { $addFields: { date: { $dateToString: { format: '%Y-%m-%d', date: '$processedAt' } }, classification: { $ifNull: ['$classification_status', 'unclassified'] } } },
    { $group: { _id: { device: '$device', date: '$date' }, unclassified: { $sum: { $cond: [{ $eq: ['$classification', 'unclassified'] }, 1, 0] } }, confirmed_pigeon: { $sum: { $cond: [{ $eq: ['$classification', 'confirmed_pigeon'] }, 1, 0] } }, no_pigeon: { $sum: { $cond: [{ $eq: ['$classification', 'no_pigeon'] }, 1, 0] } }, sum_temp_pigeon: { $sum: { $cond: [{ $and: [{ $eq: ['$classification', 'confirmed_pigeon'] }, { $ne: ['$temperature', null] }, { $in: [{ $type: '$temperature' }, ['double', 'int', 'long']] }] }, '$temperature', 0] } }, count_temp_pigeon: { $sum: { $cond: [{ $and: [{ $eq: ['$classification', 'confirmed_pigeon'] }, { $ne: ['$temperature', null] }, { $in: [{ $type: '$temperature' }, ['double', 'int', 'long']] }] }, 1, 0] } } } },
    { $sort: { '_id.device': 1, '_id.date': 1 } },
    { $group: { _id: '$_id.device', data: { $push: { date: '$_id.date', unclassified: '$unclassified', confirmed_pigeon: '$confirmed_pigeon', no_pigeon: '$no_pigeon', avg_temp_pigeon: { $cond: [{ $gt: ['$count_temp_pigeon', 0] }, { $round: [{ $divide: ['$sum_temp_pigeon', '$count_temp_pigeon'] }, 1] }, null] } } } } },
    { $project: { deviceId: { $toString: '$_id' }, data: 1 } }
  ];
}

// 2-Tage-Aggregation (wie devices.js)
function todayYesterdayPipeline(deviceIds, yesterday, tomorrow) {
  return [
    { $match: { device: { $in: deviceIds }, processedAt: { $gte: yesterday, $lt: tomorrow } } },
    { $project: { device: 1, processedAt: 1, date: { $dateToString: { format: '%Y-%m-%d', date: '$processedAt' } } } },
    { $group: { _id: { device: '$device', date: '$date' }, count: { $sum: 1 } } }
  ];
}

async function main() {
  console.log('Connecting to MongoDB...');
  const connStart = Date.now();
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected in ${Date.now() - connStart} ms\n`);

  // Einen Owner holen (wie beim echten Request – wir simulieren einen User mit Geräten)
  const sampleDevice = await Device.findOne({ isActive: true }).select('owner').lean();
  if (!sampleDevice || !sampleDevice.owner) {
    console.log('No active device with owner found. Exiting.');
    await mongoose.disconnect();
    process.exit(0);
  }
  const ownerId = sampleDevice.owner;
  console.log('Using owner (userId):', ownerId.toString());

  // Collection-Infos
  const detCount = await Detection.countDocuments();
  const deviceCount = await Device.countDocuments({ owner: ownerId, isActive: true });
  console.log(`Detections in DB: ${detCount}, Devices for owner: ${deviceCount}\n`);

  // ---- 1) Device.find (Statistics-Route)
  console.log('--- 1) Device.find (statistics route: owner + _id,name) ---');
  const t1 = Date.now();
  const devices = await Device.find({ owner: ownerId }).select('_id name');
  const deviceIds = devices.map(d => d._id);
  console.log(`  Time: ${Date.now() - t1} ms, devices: ${deviceIds.length}\n`);

  if (deviceIds.length === 0) {
    console.log('No devices, skipping aggregations.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ---- 2) 30-Tage-Aggregation (Statistics) – einmal ausführen, einmal explain
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  startDate.setHours(0, 0, 0, 0);
  const pipeline30 = statsPipeline({ $in: deviceIds }, startDate);

  const COVERING_INDEX = 'device_1_processedAt_-1_classification_status_1_temperature_1';
  console.log('--- 2) Detection.aggregate (30 days) – execution (hint: covering index) ---');
  const t2 = Date.now();
  const result30 = await Detection.aggregate(pipeline30).hint(COVERING_INDEX);
  console.log(`  Time: ${Date.now() - t2} ms`);
  const totalInResult = result30.reduce((s, r) => s + r.data.reduce((n, d) => n + (d.unclassified || 0) + (d.confirmed_pigeon || 0) + (d.no_pigeon || 0), 0), 0);
  console.log(`  Result: ${result30.length} devices, ${totalInResult} detections in aggregated result\n`);

  console.log('--- 3) Detection.aggregate (30 days) – explain executionStats (same hint) ---');
  const explain = await Detection.aggregate(pipeline30).hint(COVERING_INDEX).explain('executionStats');
  const stats = explain.stages ? explain : (explain.executionStats || explain);
  const execStats = stats.executionStats || stats;
  console.log('  executionTimeMillis:', execStats.executionTimeMillis);
  console.log('  totalDocsExamined:', execStats.totalDocsExamined);
  console.log('  totalKeysExamined:', execStats.totalKeysExamined);
  if (execStats.inputStage) {
    console.log('  inputStage.winningPlan.stage:', execStats.inputStage?.stage);
    console.log('  inputStage.winningPlan.inputStage?.indexName:', execStats.inputStage?.inputStage?.indexName || execStats.inputStage?.indexName);
  }
  if (explain.stages && explain.stages[0] && explain.stages[0].$cursor) {
    const cursor = explain.stages[0].$cursor;
    console.log('  cursor.executionStats.executionTimeMillis:', cursor.executionStats?.executionTimeMillis);
    console.log('  cursor.executionStats.totalDocsExamined:', cursor.executionStats?.totalDocsExamined);
    console.log('  cursor.queryPlanner.winningPlan.inputStage.indexName:', cursor.queryPlanner?.winningPlan?.inputStage?.indexName);
  }
  console.log('');

  // ---- 4) 2-Tage-Aggregation (Devices-Route)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  console.log('--- 4) Detection.aggregate (today/yesterday) – devices route ---');
  const t4 = Date.now();
  await Detection.aggregate(todayYesterdayPipeline(deviceIds, yesterday, tomorrow));
  console.log(`  Time: ${Date.now() - t4} ms\n`);

  // ---- 5) Device.find mit Full-Select wie GET /api/devices
  console.log('--- 5) Device.find (devices route: full list minus images) ---');
  const t5 = Date.now();
  const devicesFull = await Device.find({ owner: ownerId, isActive: true })
    .select('-actions.route.coordinates.image -actions.route.panorama -camera.tapo.password')
    .sort({ lastSeen: -1 });
  console.log(`  Time: ${Date.now() - t5} ms, devices: ${devicesFull.length}\n`);

  // Index-Liste
  console.log('--- 6) Detection collection indexes ---');
  const indexes = await Detection.collection.indexes();
  indexes.forEach(idx => console.log(' ', idx.name, JSON.stringify(idx.key)));
  console.log('');

  console.log('Done. Check executionTimeMillis and totalDocsExamined above for bottleneck.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
