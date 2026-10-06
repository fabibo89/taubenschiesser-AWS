/**
 * Run one catalog model over detections that do not yet have that pass.
 * Separate process from the live CV service. The model is released when this exits.
 *
 * Aufruf: node -r dotenv/config scripts/replay_model.js yolov8l
 */
const { connectDB } = require('../config/database');
const { runReplay } = require('../services/modelReplay');

const modelId = process.argv[2];

async function main() {
  if (!modelId) {
    console.error('Usage: node scripts/replay_model.js <modelId>');
    process.exit(1);
  }
  await connectDB();
  const state = {};
  const timer = setInterval(() => {
    if (!state.modelName) return;
    console.log(
      `${state.modelName}: ${state.processed || 0}/${state.total ?? '?'} `
      + `gespeichert ${state.updated || 0}, übersprungen ${state.skipped || 0}, fehler ${state.errors || 0}`
    );
  }, 10000);
  try {
    const result = await runReplay(modelId, state);
    console.log(JSON.stringify(result));
  } finally {
    clearInterval(timer);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
