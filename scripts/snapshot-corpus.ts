#!/usr/bin/env tsx
/**
 * scripts/snapshot-corpus.ts — Phase 0 corpus snapshot.
 *
 * Freezes the exact prompt the current system sends to the model for one or
 * more fixtures, writing each to corpus/<gameId>.json. The evaluation harness
 * reads these files to run reproducible baseline measurements without live data.
 *
 * Each entry captures:
 *   • The preview system + data prompt (what the model sees today)
 *   • A review system + data prompt (when --team-score and --opp-score are given)
 *   • A context summary (for harness display and future FactSet delta tracking)
 *
 * Usage:
 *   npx tsx scripts/snapshot-corpus.ts <gameId> [<gameId> ...] [options]
 *
 * Options:
 *   --scenario <label>   Human label for the test scenario (default: unclassified)
 *                        e.g. mid-table | band-boundary | finals | no-lineup |
 *                             dead-rubber | epl-form-split | name-variant
 *   --team-score <n>     Team score for completed fixture (enables review prompt)
 *   --opp-score  <n>     Opponent score for completed fixture (enables review prompt)
 *
 * Examples:
 *   npx tsx scripts/snapshot-corpus.ts afl-38612 --scenario band-boundary
 *   npx tsx scripts/snapshot-corpus.ts epl-705123 --scenario epl-form-split \
 *     --team-score 1 --opp-score 3
 *   npx tsx scripts/snapshot-corpus.ts afl-38612 afl-38799 nrl-603376
 *
 * Corpus files are written to corpus/ at the project root (gitignored).
 * Re-running overwrites, so snapshots can be refreshed when the prompt changes.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Env loading ──────────────────────────────────────────────────────────────

try {
  const content = readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
} catch { /* env set externally */ }

import { fetchLeagueFixtures, fetchCricketFixtureById } from '@/lib/league-fixtures';
import { TEAMS } from '@/lib/teams';
import { buildDataBlock, SYSTEM_PROMPT } from '@/lib/preview-prompt';
import { buildPreviewContext } from '@/lib/preview-context';
import { buildReviewDataBlock, REVIEW_SYSTEM_PROMPT } from '@/lib/review-prompt';
import type { PreviewContext, UpcomingGame } from '@/types';

// ─── Game-ID prefix → league ──────────────────────────────────────────────────

const PREFIX_TO_LEAGUE: Record<string, string> = {
  afl:    'afl',
  nrl:    'nrl',
  soo:    'nrl',
  epl:    'epl',
  soccer: 'epl',   // EPL/cup fixture IDs: soccer-eng.1-… and soccer-eng.league_cup-…
  sru:    'super_rugby',
  nba:    'nba',
  f1:     'f1',
  rint:   'rugby_int',
  bbl:    'bbl',
  cint:   'cricket_int',
};

// ─── Corpus entry schema ──────────────────────────────────────────────────────

interface ContextSummary {
  teamPosition?:      number;
  teamPoints?:        number;
  teamPercentage?:    number;
  opponentPosition?:  number;
  opponentPoints?:    number;
  opponentPercentage?: number;
  tableLength:        number;
  hasTeamForm:        boolean;
  hasOpponentForm:    boolean;
  hasHeadToHead:      boolean;
  hasTeamLineup:      boolean;
  hasOpponentLineup:  boolean;
  hasWeather:         boolean;
  hasCricketContext:  boolean;
  hasSeriesState:     boolean;
  teamManager?:       string;
  opponentManager?:   string;
}

interface CorpusEntry {
  // Identity
  id:           string;
  league:       string;
  teamName:     string;
  opponent:     string;
  date:         string;
  venue:        string;
  isHome:       boolean;
  competition?: string;
  completed:    boolean;
  scenario:     string;
  snapshotAt:   string;

  // Preview path (always present)
  systemPrompt:  string;
  previewPrompt: string;

  // Review path (only when --team-score + --opp-score supplied)
  reviewSystemPrompt?: string;
  reviewPrompt?:       string;
  scores?: { team: number; opponent: number };

  // Context diagnostics
  contextSummary: ContextSummary;
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(): {
  gameIds:   string[];
  scenario:  string;
  teamScore: number | null;
  oppScore:  number | null;
} {
  const args = process.argv.slice(2);
  const gameIds: string[] = [];
  let scenario  = 'unclassified';
  let teamScore: number | null = null;
  let oppScore:  number | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--scenario' && args[i + 1]) { scenario = args[++i]; }
    else if (a === '--team-score' && args[i + 1]) { teamScore = parseInt(args[++i], 10); }
    else if (a === '--opp-score'  && args[i + 1]) { oppScore  = parseInt(args[++i], 10); }
    else if (!a.startsWith('-')) { gameIds.push(a); }
  }
  return { gameIds, scenario, teamScore, oppScore };
}

// ─── Context summary builder ──────────────────────────────────────────────────

function summariseContext(ctx: PreviewContext): ContextSummary {
  return {
    teamPosition:       ctx.teamStanding?.position,
    teamPoints:         ctx.teamStanding?.points,
    teamPercentage:     ctx.teamStanding?.percentage,
    opponentPosition:   ctx.opponentStanding?.position,
    opponentPoints:     ctx.opponentStanding?.points,
    opponentPercentage: ctx.opponentStanding?.percentage,
    tableLength:        ctx.leagueTable?.length ?? 0,
    hasTeamForm:        (ctx.teamRecentForm?.length ?? 0) > 0,
    hasOpponentForm:    (ctx.opponentRecentForm?.length ?? 0) > 0,
    hasHeadToHead:      (ctx.headToHead?.length ?? 0) > 0,
    hasTeamLineup:      (ctx.teamLastLineup?.length ?? ctx.teamSquad?.length ?? 0) > 0,
    hasOpponentLineup:  (ctx.opponentLastLineup?.length ?? ctx.opponentSquad?.length ?? 0) > 0,
    hasWeather:         ctx.weather !== undefined,
    hasCricketContext:  ctx.cricketContext !== undefined,
    hasSeriesState:     ctx.seriesState !== undefined,
    teamManager:        ctx.teamManager,
    opponentManager:    ctx.opponentManager,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (typeof (globalThis as unknown as Record<string, unknown>).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as unknown as Record<string, unknown>).WebSocket = ws;
  }

  const { gameIds, scenario, teamScore, oppScore } = parseArgs();

  if (gameIds.length === 0) {
    console.error('Usage: npx tsx scripts/snapshot-corpus.ts <gameId> [<gameId> ...] [options]');
    console.error('       --scenario <label>   e.g. band-boundary, mid-table, no-lineup');
    console.error('       --team-score <n>     enables review prompt for completed fixture');
    console.error('       --opp-score  <n>     enables review prompt for completed fixture');
    process.exit(1);
  }

  const corpusDir = join(process.cwd(), 'corpus');
  if (!existsSync(corpusDir)) mkdirSync(corpusDir);

  const hasScores = teamScore !== null && oppScore !== null;
  let written = 0;
  let failed  = 0;

  for (const gameId of gameIds) {
    const prefix = gameId.split('-')[0];
    const league = PREFIX_TO_LEAGUE[prefix];
    if (!league) {
      console.error(`  skip ${gameId} — unknown prefix "${prefix}"`);
      failed++;
      continue;
    }

    console.log(`\nsnapshot  ${gameId}  (${league})  scenario=${scenario}`);

    try {
      // ── Fixture lookup ──────────────────────────────────────────────────────
      const fixtures = await fetchLeagueFixtures(league, 30);
      const now      = Date.now();
      let fixture: UpcomingGame | undefined = fixtures.find(
        f => f.id === gameId && new Date(f.date).getTime() <= now + 60 * 86400_000,
      );
      let teamName = fixture
        ? (TEAMS.find(t => t.id === fixture!.teamId)?.name ?? fixture.teamId)
        : '';

      // Cricket: dormant fixture lists — resolve by ID directly
      if (!fixture && (league === 'bbl' || league === 'cricket_int')) {
        const resolved = await fetchCricketFixtureById(gameId);
        if (resolved) { fixture = resolved.fixture; teamName = resolved.teamName; }
      }

      if (!fixture) {
        const sample = fixtures.slice(0, 5).map(f => `  ${f.id} (${f.date})`).join('\n');
        throw new Error(
          `Fixture not found: ${gameId}\n  Fetched ${fixtures.length} fixtures. Sample:\n${sample}`,
        );
      }

      console.log(`  ${teamName} vs ${fixture.opponent}  (${fixture.date})`);

      // ── Build context + preview prompt ──────────────────────────────────────
      const ctx = await buildPreviewContext(league, fixture, teamName);

      const previewPrompt = buildDataBlock(
        league, teamName, fixture.opponent, ctx as PreviewContext, [], [],
        fixture.competition, false, undefined, fixture.venue, fixture.isHome,
        fixture.teamId, fixture.opponentId, fixture.seriesSummary,
      );

      // ── Build review prompt (optional — requires scores) ────────────────────
      let reviewSystemPrompt: string | undefined;
      let reviewPrompt: string | undefined;

      if (hasScores) {
        const input = {
          league,
          teamName,
          opponent:      fixture.opponent,
          teamScore:     teamScore!,
          opponentScore: oppScore!,
          isHome:        fixture.isHome,
          date:          fixture.date,
          competition:   fixture.competition,
          teamId:        fixture.teamId,
          opponentId:    fixture.opponentId,
          teamPosition:     ctx.teamStanding?.position,
          teamPlayed:       ctx.teamStanding?.played,
          teamPoints:       ctx.teamStanding?.points,
          teamPercentage:   ctx.teamStanding?.percentage,
          opponentPosition: ctx.opponentStanding?.position,
          opponentPlayed:   ctx.opponentStanding?.played,
          opponentPoints:   ctx.opponentStanding?.points,
          opponentPercentage: ctx.opponentStanding?.percentage,
          leagueTable:   ctx.leagueTable,
        };
        reviewSystemPrompt = REVIEW_SYSTEM_PROMPT;
        reviewPrompt = buildReviewDataBlock(input);
        console.log(`  review   ${teamScore} – ${oppScore}`);
      }

      // ── Assemble + write corpus entry ───────────────────────────────────────
      const entry: CorpusEntry = {
        id:          gameId,
        league,
        teamName,
        opponent:    fixture.opponent,
        date:        fixture.date,
        venue:       fixture.venue,
        isHome:      fixture.isHome,
        competition: fixture.competition,
        completed:   fixture.completed ?? false,
        scenario,
        snapshotAt:  new Date().toISOString(),

        systemPrompt: SYSTEM_PROMPT,
        previewPrompt,

        ...(hasScores && {
          reviewSystemPrompt,
          reviewPrompt,
          scores: { team: teamScore!, opponent: oppScore! },
        }),

        contextSummary: summariseContext(ctx as PreviewContext),
      };

      const outPath = join(corpusDir, `${gameId}.json`);
      writeFileSync(outPath, JSON.stringify(entry, null, 2));

      const summary = entry.contextSummary;
      const flags = [
        summary.hasTeamForm      && 'form',
        summary.hasHeadToHead    && 'h2h',
        summary.hasTeamLineup    && 'lineup',
        summary.hasWeather       && 'weather',
        summary.hasCricketContext && 'cricket',
        summary.hasSeriesState   && 'series',
      ].filter(Boolean).join(' ');
      console.log(`  pos      ${summary.teamPosition ?? '?'} vs ${summary.opponentPosition ?? '?'}  (table: ${summary.tableLength} rows)`);
      console.log(`  data     ${flags || 'none'}`);
      console.log(`  prompt   ${previewPrompt.length} chars${reviewPrompt ? `  review ${reviewPrompt.length} chars` : ''}`);
      console.log(`  written  corpus/${gameId}.json`);
      written++;

    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`  written ${written}  failed ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
