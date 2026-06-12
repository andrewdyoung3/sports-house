#!/usr/bin/env tsx
/**
 * Unit tests for decideForTeam() in src/lib/preview-lifecycle.ts.
 * No network, no Supabase, no Ollama. Run with: npx tsx scripts/test-preview-lifecycle.ts
 * Exits 0 on all pass, non-zero on first failure.
 */

import {
  decideForTeam,
  SETTLE_BUFFER_HOURS,
  LOOKAHEAD_DAYS,
  type TaggedFixture,
} from '@/lib/preview-lifecycle';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEAM = 'afl-swans';
const H    = 3600_000;
const D    = 86400_000;

function fix(id: string, offsetMs: number, completed?: boolean): TaggedFixture {
  return {
    id,
    teamId:        TEAM,
    opponentId:    'afl-eagles',
    opponent:      'West Coast Eagles',
    opponentAbbr:  'WCE',
    opponentColor: '#002B5C',
    isHome:        true,
    date:          new Date(NOW + offsetMs).toISOString(),
    time:          '7:00 PM AEST',
    venue:         'SCG',
    broadcast:     [],
    streaming:     [],
    league:        'afl',
    completed:     completed,
  };
}

let failures = 0;
const NOW = Date.now();

function assert(
  label: string,
  result: ReturnType<typeof decideForTeam>,
  expected: 'initial' | 'regen-48' | 'regen-24' | null,
) {
  const got = result?.action ?? null;
  if (got === expected) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    console.error(`        expected=${String(expected)}  got=${String(got)}`);
    failures++;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\ndecideForTeam() — 7 cases\n');

// 1. Prior completed SETTLE_BUFFER + 1h ago, no preview → initial
{
  const prior  = fix('prior-1', -(SETTLE_BUFFER_HOURS + 1) * H, true);
  const next   = fix('next-1',  3 * D);
  assert(
    '1. buffer elapsed → initial',
    decideForTeam(TEAM, [prior, next], new Map(), NOW),
    'initial',
  );
}

// 2. Prior completed SETTLE_BUFFER − 1h ago, no preview → null
{
  const prior = fix('prior-2', -(SETTLE_BUFFER_HOURS - 1) * H, true);
  const next  = fix('next-2',  3 * D);
  assert(
    '2. inside buffer → null',
    decideForTeam(TEAM, [prior, next], new Map(), NOW),
    null,
  );
}

// 3. No prior fixture (season opener), no preview → initial
{
  const next = fix('next-3', 3 * D);
  assert(
    '3. season opener → initial',
    decideForTeam(TEAM, [next], new Map(), NOW),
    'initial',
  );
}

// 4. Existing preview, kickoff 40h out, updated_at before kickoff−48h → regen-48
// kickoff = now + 40h   kickoff−48h = now − 8h   updated_at = now − 10h (before mark)
{
  const next    = fix('next-4', 40 * H);
  const rows    = new Map([['next-4', new Date(NOW - 10 * H).toISOString()]]);
  assert(
    '4. past 48h mark, row predates mark → regen-48',
    decideForTeam(TEAM, [next], rows, NOW),
    'regen-48',
  );
}

// 5. Same fixture, updated_at AFTER kickoff−48h (already regen'd) → null
// updated_at = now − 4h (after mark at now − 8h)
{
  const next = fix('next-5', 40 * H);
  const rows = new Map([['next-5', new Date(NOW - 4 * H).toISOString()]]);
  assert(
    '5. 48h mark already fired → null',
    decideForTeam(TEAM, [next], rows, NOW),
    null,
  );
}

// 6. Kickoff 20h out, row between kickoff−48h and kickoff−24h → regen-24
// kickoff = now + 20h   kickoff−48h = now − 28h   kickoff−24h = now − 4h
// updated_at = now − 10h  (after 48h mark, before 24h mark)
{
  const next = fix('next-6', 20 * H);
  const rows = new Map([['next-6', new Date(NOW - 10 * H).toISOString()]]);
  assert(
    '6. past 24h mark, row between marks → regen-24',
    decideForTeam(TEAM, [next], rows, NOW),
    'regen-24',
  );
}

// 7. Fresh preview, kickoff 7 days out, well inside lookahead, no mark passed → null
// kickoff−48h = now + 5d   now < now + 5d → neither mark fires
{
  const next = fix('next-7', 7 * D);
  const rows = new Map([['next-7', new Date(NOW - 1 * H).toISOString()]]);
  assert(
    '7. no mark due, fresh row → null',
    decideForTeam(TEAM, [next], rows, NOW),
    null,
  );
}

// ─── Bonus: beyond lookahead window → null (not asked but easy to verify) ─────
{
  const next = fix('next-beyond', (LOOKAHEAD_DAYS + 1) * D);
  assert(
    '8. beyond LOOKAHEAD_DAYS → null',
    decideForTeam(TEAM, [next], new Map(), NOW),
    null,
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
if (failures === 0) {
  console.log('All tests passed.');
} else {
  console.error(`${failures} test(s) failed.`);
  process.exit(1);
}
