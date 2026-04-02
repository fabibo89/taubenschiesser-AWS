/** Hide sub-second flicker right after wait_started_at updates. */
export const WAIT_ELAPSED_HIDE_BELOW_SEC = 0.15;

/**
 * Chip line: elapsed vs threshold (optional trailing max from device settings).
 */
export function formatWaitChipLine(base, elapsedSec, threshold, extra = '') {
  const thr = Number(threshold);
  if (!Number.isFinite(thr)) return `${base}${extra}`;
  if (elapsedSec == null || Number.isNaN(elapsedSec)) {
    return `${base}: ${thr.toFixed(0)}s${extra}`;
  }
  if (elapsedSec < WAIT_ELAPSED_HIDE_BELOW_SEC) {
    return `${base}: ${thr.toFixed(0)}s${extra}`;
  }
  return `${base}: ${elapsedSec.toFixed(1)}s / ${thr.toFixed(0)}s${extra}`;
}
