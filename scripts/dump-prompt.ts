#!/usr/bin/env tsx
/**
 * scripts/dump-prompt.ts — print the exact LLM input for a given gameId.
 *
 * After the context-unification, all generation entry points (heartbeat,
 * poller, regen) produce byte-identical prompts — there is no longer a thin
 * "heartbeat" path vs a rich "regen" path.  This script prints the single
 * unified prompt (system message + user message) using buildPreviewContext,
 * which is the same builder generateAndStorePreview calls.
 *
 * Usage:
 *   npx tsx scripts/dump-prompt.ts <gameId>
 *   npm run dump-prompt -- <gameId>
 */

import { readFileSync } from 'fs';

// ─── Env ──────────────────────────────────────────────────────────────────────
try {
  const content = readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
} catch { /* absent — env set externally */ }

import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { TEAMS } from '@/lib/teams';
import { SYSTEM_PROMPT, buildDataBlock } from '@/lib/preview-prompt';
import { buildPreviewContext } from '@/lib/preview-context';
import type { PreviewContext } from '@/types';

// ─── Game-ID prefix → league ──────────────────────────────────────────────────
const PREFIX_TO_LEAGUE: Record<string, string> = {
  afl:  'afl',
  nrl:  'nrl',
  epl:  'epl',
  sru:  'super_rugby',
  wc:   'world_cup',
  nba:  'nba',
  f1:   'f1',
  rint: 'rugby_int',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const DIVIDER = '═'.repeat(100);
const THIN    = '─'.repeat(100);

function printPrompt(label: string, userMsg: string): void {
  console.log(`\n${DIVIDER}`);
  console.log(`  ${label}`);
  console.log(DIVIDER);
  console.log('\n[SYSTEM MESSAGE]\n');
  console.log(SYSTEM_PROMPT);
  console.log(`\n${THIN}\n[USER MESSAGE — ${label}]\n${THIN}\n`);
  console.log(userMsg);
  console.log(`\n${THIN}  END  ${THIN}\n`);
}

async function main() {
  if (typeof (globalThis as unknown as Record<string, unknown>).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as unknown as Record<string, unknown>).WebSocket = ws;
  }

  const gameId = process.argv[2]?.trim();
  if (!gameId) {
    console.error('Usage: npx tsx scripts/dump-prompt.ts <gameId>');
    process.exit(1);
  }

  const league = PREFIX_TO_LEAGUE[gameId.split('-')[0]];
  if (!league) {
    console.error(`Unknown prefix for "${gameId}"`);
    process.exit(1);
  }

  console.log(`\ndump-prompt  gameId=${gameId}  league=${league}`);

  const LOOKBACK       = 30;
  const LOOKAHEAD_MS   = 60 * 86400_000;
  const fixtures       = await fetchLeagueFixtures(league, LOOKBACK);
  const now            = Date.now();
  const fixture        = fixtures.find(
    f => f.id === gameId && new Date(f.date).getTime() <= now + LOOKAHEAD_MS,
  );
  if (!fixture) {
    console.error(`Fixture ${gameId} not found. Available:\n` +
      fixtures.slice(0, 10).map(f => `  ${f.id}  ${f.date}`).join('\n'));
    process.exit(1);
  }

  const teamEntry = TEAMS.find(t => t.id === fixture.teamId);
  const teamName  = teamEntry?.name ?? fixture.teamId;
  console.log(`  fixture  ${teamName} vs ${fixture.opponent}  (${fixture.date})`);
  console.log(`  venue    ${fixture.venue ?? '(none)'}`);
  console.log(`  competition  ${fixture.competition ?? '(none)'}`);

  // Build the unified rich context (same as what every generation entry point uses)
  const ctx = await buildPreviewContext(league, fixture, teamName);

  console.log(`  standings  ${ctx.leagueTable?.length ?? 0} rows`);
  if (ctx.worldCup) {
    console.log(`  wc-group  ${ctx.worldCup.group}  played=${ctx.worldCup.gamesPlayed}  remaining=${ctx.worldCup.gamesRemaining}  rows=${ctx.worldCup.groupTable?.length}`);
  }
  if (ctx.teamManager || ctx.opponentManager) {
    console.log(`  coaches  ${ctx.teamManager ?? '?'} vs ${ctx.opponentManager ?? '(unknown)'}`);
  }

  const prompt = buildDataBlock(
    league, teamName, fixture.opponent,
    ctx as PreviewContext, [], [],
    fixture.competition, false, undefined, fixture.venue, fixture.isHome,
    fixture.teamId, fixture.opponentId, fixture.seriesSummary,
  );

  printPrompt(`UNIFIED PATH — ${gameId} (${teamName} vs ${fixture.opponent})`, prompt);
}

main().catch(err => { console.error(err); process.exit(1); });
