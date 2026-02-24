/**
 * Backfill target_bird für Detections mit detections[] aber ohne target_bird.
 * Nur nativer mongodb-Treiber, Batch=1 für minimalen Speicher.
 *
 * Aufruf: MONGODB_URI='...' node scripts/backfill_target_bird.js
 * Im Container bei "heap out of memory":
 *   docker exec -it taubenschiesser-api-prod node --max-old-space-size=4096 scripts/backfill_target_bird.js
 */
const { MongoClient } = require('mongodb');

const uri = process.argv[2] || process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin';
const BATCH_SIZE = 1;

const FILTER = {
  $or: [
    { target_bird: null },
    { target_bird: { $exists: false } },
    { 'target_bird.bbox': { $exists: false }, 'target_bird.position': { $exists: false } }
  ],
  detections: { $exists: true, $ne: [] }
};

function hasBboxOrPosition(d) {
  return (d.bbox && (d.bbox.x != null || d.bbox.width != null)) ||
    (d.position && (d.position.center_x != null || d.position.width != null));
}

function pickTargetBird(detections) {
  const candidates = (detections || []).filter(hasBboxOrPosition);
  if (candidates.length === 0) return null;
  const birds = candidates.filter((d) => d.class === 'bird');
  const pool = birds.length > 0 ? birds : candidates;
  const best = pool.reduce((a, b) =>
    ((b.confidence ?? 0) > (a.confidence ?? 0) ? b : a)
  );
  return { class: best.class, confidence: best.confidence, bbox: best.bbox, position: best.position };
}

async function main() {
  const client = new MongoClient(uri);
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Connected.');

    const coll = client.db().collection('detections');
    await coll.createIndex({ target_bird: 1, detections: 1 }, { background: true });
    console.log('Processing (batch size', BATCH_SIZE, ')...');

    let updated = 0, skipped = 0, total = 0, lastId = null;

    while (true) {
      const query = { ...FILTER };
      if (lastId) query._id = { $gt: lastId };

      const docs = await coll
        .find(query)
        .project({ _id: 1, detections: 1 })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .toArray();

      if (docs.length === 0) break;

      const doc = docs[0];
      const chosen = pickTargetBird(doc.detections);
      if (chosen) {
        await coll.updateOne({ _id: doc._id }, { $set: { target_bird: chosen } });
        updated++;
      } else {
        skipped++;
      }
      total++;
      lastId = doc._id;

      if (total % 100 === 0) console.log('  Processed', total, '| updated', updated, '| skipped', skipped);

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
