/**
 * Backfill birds[] and the live model_run for detections that predate that layer.
 * Copies classification_status onto the main bird. Does not load image fields.
 *
 * Aufruf: MONGODB_URI='...' node scripts/backfill_birds.js
 * Im Container bei "heap out of memory":
 *   docker exec -it taubenschiesser-api-prod node --max-old-space-size=4096 scripts/backfill_birds.js
 */
const { MongoClient } = require('mongodb');
const { attachLiveBirdLayer, hasLiveRun } = require('../utils/detectionBirds');

const uri = process.argv[2] || process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin';
const BATCH_SIZE = 50;

const FILTER = {
  model_runs: { $not: { $elemMatch: { run_id: 'live' } } }
};

const PROJECTION = {
  _id: 1,
  detections: 1,
  target_bird: 1,
  model: 1,
  processedAt: 1,
  classification_status: 1,
  classifiedAt: 1,
  camera_source: 1
};

async function main() {
  const client = new MongoClient(uri);
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Connected.');

    const coll = client.db().collection('detections');
    let updated = 0;
    let skipped = 0;
    let total = 0;
    let lastId = null;

    while (true) {
      const query = { ...FILTER };
      if (lastId) query._id = { $gt: lastId };

      const docs = await coll
        .find(query)
        .project(PROJECTION)
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .toArray();

      if (docs.length === 0) break;

      for (const doc of docs) {
        lastId = doc._id;
        total++;
        if (hasLiveRun(doc)) {
          skipped++;
          continue;
        }
        attachLiveBirdLayer(doc);
        await coll.updateOne(
          { _id: doc._id },
          {
            $set: {
              detections: doc.detections || [],
              birds: doc.birds || [],
              model_runs: doc.model_runs || [],
              ...(doc.target_bird ? { target_bird: doc.target_bird } : {})
            }
          }
        );
        updated++;
      }

      console.log('  Processed', total, '| updated', updated, '| skipped', skipped);
      if (docs.length < BATCH_SIZE) break;
    }

    console.log('Done. Total:', total, 'Updated:', updated, 'Skipped:', skipped);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Disconnected.');
  }
}

main();
