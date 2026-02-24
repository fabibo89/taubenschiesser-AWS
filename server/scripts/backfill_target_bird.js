const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Detection = require('../models/Detection');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/taubenschiesser?authSource=admin';

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

    const withoutTargetBird = await Detection.find({
      $or: [
        { target_bird: null },
        { target_bird: { $exists: false } },
        { 'target_bird.bbox': { $exists: false }, 'target_bird.position': { $exists: false } }
      ],
      $and: [
        { detections: { $exists: true, $ne: [] } }
      ]
    }).lean();

    console.log(`Found ${withoutTargetBird.length} detections without target_bird but with detections[]`);

    let updated = 0;
    let skipped = 0;

    for (const doc of withoutTargetBird) {
      const chosen = pickTargetBird(doc.detections);
      if (!chosen) {
        skipped++;
        continue;
      }
      await Detection.updateOne(
        { _id: doc._id },
        { $set: { target_bird: chosen } }
      );
      updated++;
      if (updated <= 10 || updated % 100 === 0) {
        console.log(`  Updated ${updated}: ${doc._id} (class=${chosen.class}, confidence=${chosen.confidence != null ? (chosen.confidence * 100).toFixed(1) : '-'}%)`);
      }
    }

    console.log('\n=== Backfill Summary ===');
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
