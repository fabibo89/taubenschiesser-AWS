/**
 * Backfill target_bird for detections that have detections[] but no target_bird.
 * Memory-safe: loads only small batches (BATCH_SIZE) at a time, paginated by _id.
 */
const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Detection = require('../models/Detection');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin';

const BATCH_SIZE = 200;

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
  return {
    class: best.class,
    confidence: best.confidence,
    bbox: best.bbox,
    position: best.position
  };
}

async function backfillTargetBird() {
  try {
    console.log('Connecting to MongoDB...');
    console.log('MongoDB URI:', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    console.log(`Processing in batches of ${BATCH_SIZE} (paginated by _id, low memory)...`);

    let updated = 0;
    let skipped = 0;
    let totalProcessed = 0;
    let lastId = null;

    while (true) {
      const query = { ...FILTER };
      if (lastId) query._id = { $gt: lastId };

      const docs = await Detection.find(query)
        .select('_id detections')
        .lean()
        .sort({ _id: 1 })
        .limit(BATCH_SIZE);

      if (docs.length === 0) break;

      const bulkOps = [];
      for (const doc of docs) {
        const chosen = pickTargetBird(doc.detections);
        if (!chosen) {
          skipped++;
        } else {
          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: { target_bird: chosen } }
            }
          });
        }
      }
      if (bulkOps.length > 0) {
        await Detection.bulkWrite(bulkOps);
        updated += bulkOps.length;
      }

      totalProcessed += docs.length;
      lastId = docs[docs.length - 1]._id;

      console.log(`  Processed ${totalProcessed} docs, updated ${updated}, skipped ${skipped}`);

      if (docs.length < BATCH_SIZE) break;
    }

    console.log('\n=== Backfill Summary ===');
    console.log(`Total processed: ${totalProcessed}`);
    console.log(`Detections updated: ${updated}`);
    console.log(`Skipped (no valid candidate): ${skipped}`);
    console.log('Backfill completed successfully.');
  } catch (error) {
    console.error('Error during backfill:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

backfillTargetBird();
