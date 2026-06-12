/**
 * Pure lifecycle-decision logic for the standalone preview generator.
 *
 * Extracted into its own module so it can be unit-tested without importing
 * the script's env-loading, Supabase, or Ollama side-effects.
 *
 * Imported by: scripts/generate-previews.ts, scripts/test-preview-lifecycle.ts
 */

import type { UpcomingGame } from '@/types';

export const SETTLE_BUFFER_HOURS = 4;
export const REGEN_MARKS_HOURS   = [48, 24] as const;
export const LOOKAHEAD_DAYS      = 14;
export const LOOKBACK_DAYS       = 3;

export interface TaggedFixture extends UpcomingGame {
  league: string;
}

/**
 * Decide what (if anything) to generate for a single followed team this
 * heartbeat. Pure — no I/O.
 *
 * Rules (in order):
 *   1. Find the team's next upcoming fixture within LOOKAHEAD_DAYS.
 *   2. No preview row → initial gen (gated by settle buffer; season openers skip gate).
 *   3. Preview exists → regen at 48 h and 24 h marks before kickoff (each fires once).
 *   4. Otherwise → null (nothing to do).
 *
 * @param teamId      - Internal team slug being evaluated.
 * @param allFixtures - Full fixture list (completed + upcoming) with league tag.
 * @param existingRows - Supabase rows: gameId → updated_at ISO string.
 * @param now         - Current epoch ms (injectable for deterministic tests).
 */
export function decideForTeam(
  teamId: string,
  allFixtures: TaggedFixture[],
  existingRows: Map<string, string>,
  now: number,
): { fixture: TaggedFixture; action: 'initial' | 'regen-48' | 'regen-24' } | null {
  const teamFixtures = allFixtures.filter(
    f => f.teamId === teamId || f.opponentId === teamId,
  );

  // Next upcoming fixture (not yet completed, kickoff still in the future)
  const next = teamFixtures
    .filter(f => !f.completed && new Date(f.date).getTime() > now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

  if (!next) return null;

  const kickoffMs = new Date(next.date).getTime();
  // Outside lookahead window — nothing to do yet
  if (kickoffMs > now + LOOKAHEAD_DAYS * 86400_000) return null;

  const updatedAt = existingRows.get(next.id);

  if (!updatedAt) {
    // No preview exists yet — check settle buffer
    const prior = teamFixtures
      .filter(f => f.completed && new Date(f.date).getTime() <= now)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    // Season opener or no prior completed fixture found — generate immediately
    if (!prior) return { fixture: next, action: 'initial' };

    // Wait for SETTLE_BUFFER_HOURS after the prior fixture's kickoff time
    if (now >= new Date(prior.date).getTime() + SETTLE_BUFFER_HOURS * 3600_000)
      return { fixture: next, action: 'initial' };

    return null; // still inside settle window
  }

  // Preview exists — fire regen marks (each fires exactly once)
  const rowTs = new Date(updatedAt).getTime();
  for (const markHours of REGEN_MARKS_HOURS) {
    const markMs = kickoffMs - markHours * 3600_000;
    if (now >= markMs && rowTs < markMs)
      return { fixture: next, action: markHours === 48 ? 'regen-48' : 'regen-24' };
  }
  return null; // up to date
}
