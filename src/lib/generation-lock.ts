import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, constants } from 'fs';

const LOCK_PATH = '/tmp/sporthouse-generation.lock';
// Longer than the 15-min Ollama timeout so a real in-progress run is never evicted.
const STALE_MS  = 20 * 60 * 1000;

interface LockData {
  pid:       number;
  timestamp: number;
}

function readLockData(): LockData | null {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as LockData;
  } catch {
    return null;
  }
}

/**
 * Attempts to acquire the generation lock atomically (O_CREAT | O_EXCL).
 * Returns true if acquired; false if another fresh lock is held.
 * A lock older than STALE_MS (20 min) is treated as abandoned and reclaimed.
 */
export function acquireLock(): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Atomic create — throws EEXIST if the file already exists.
      const fd = openSync(LOCK_PATH, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      closeSync(fd);
      writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
      return true;
    } catch {
      if (attempt > 0) return false; // two attempts exhausted

      // First attempt failed — check if the existing lock is stale.
      const data = readLockData();
      if (data && Date.now() - data.timestamp <= STALE_MS) {
        // Fresh lock held by another process.
        return false;
      }
      // Stale (or unreadable) — remove and retry once.
      try { unlinkSync(LOCK_PATH); } catch { /* already gone */ }
    }
  }
  return false;
}

/**
 * Releases the lock by removing the lockfile.
 * Safe to call even if the lock was never acquired (no-op).
 */
export function releaseLock(): void {
  try { unlinkSync(LOCK_PATH); } catch { /* already gone — no-op */ }
}
