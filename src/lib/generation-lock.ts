import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, constants } from 'fs';

const LOCK_PATH = '/tmp/sporthouse-generation.lock';
// Longer than the 15-min Ollama timeout so a real in-progress run is never evicted.
const STALE_MS  = 20 * 60 * 1000;

interface LockData {
  pid:       number;
  timestamp: number;
}

/**
 * Is the lock's holder still running? A dev-server restart mid-generation
 * leaves the file behind with a dead pid, and waiting out STALE_MS parked the
 * poller for 20 minutes each time (seen 2026-09-22). Signal 0 probes without
 * sending anything; EPERM means alive-but-not-ours, which still counts as held.
 */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
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
      if (data && Date.now() - data.timestamp <= STALE_MS && pidAlive(data.pid)) {
        // Fresh lock held by a live process.
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
/**
 * Re-stamp a lock this process holds. A backlog run of several reviews now
 * outlasts STALE_MS, and the next tick was reclaiming the lock mid-run — two
 * runs, two model calls on one GPU, both timing out (2026-09-26). Call
 * between jobs.
 */
export function refreshLock(): void {
  try {
    const data = readLockData();
    if (data && data.pid === process.pid) writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
  } catch { /* best effort */ }
}

export function releaseLock(): void {
  try { unlinkSync(LOCK_PATH); } catch { /* already gone — no-op */ }
}
