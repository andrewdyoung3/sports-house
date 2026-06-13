#!/usr/bin/env tsx
/**
 * scripts/regen-preview.ts — on-demand single-game preview regeneration.
 *
 * Wipes and regenerates one match preview immediately, overwriting the
 * Supabase row regardless of freshness. Also fetches live standings so the
 * FIXTURE CONTEXT block (phase + stakes label) is injected into the prompt.
 *
 * Usage:
 *   npm run regen -- <gameId>            e.g. npm run regen -- afl-38612
 *   npx tsx scripts/regen-preview.ts <gameId>
 *
 * Reuses the shared generation lock so it cannot run concurrently with the
 * heartbeat or poller.
 */

import { readFileSync } from 'fs';
import { acquireLock, releaseLock } from '@/lib/generation-lock';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { generateAndStorePreview } from '@/lib/preview-generator';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { TEAMS } from '@/lib/teams';
import { resolveCompetitionContext } from '@/lib/competition-structure';
import { WC_TEAM_GROUPS, computeGroupAdvancementScenario } from '@/lib/world-cup';
import { MANAGER } from '@/lib/managers';
import type { LeagueTableRow, PreviewContext, WorldCupGroupRow, WorldCupMatchContext } from '@/types';

// ─── Env loading (mirrors generate-previews.ts) ───────────────────────────────

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
} catch { /* .env.local absent — env must be set externally */ }

// ─── Game-ID prefix → league mapping ─────────────────────────────────────────

const PREFIX_TO_LEAGUE: Record<string, string> = {
  afl:  'afl',
  nrl:  'nrl',
  epl:  'epl',
  sru:  'super_rugby',
  wc:   'world_cup',
  nba:  'nba',
  f1:   'f1',
  rint: 'rugby_int',
  bbl:  'bbl',
  cint: 'cricket_int',
};

function deriveLeague(gameId: string): string | null {
  const prefix = gameId.split('-')[0];
  return PREFIX_TO_LEAGUE[prefix] ?? null;
}

// ─── Ollama reachability ──────────────────────────────────────────────────────

async function isOllamaReachable(): Promise<boolean> {
  const base = (process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Standings fetchers (subset — AFL, NRL, EPL, Super Rugby, World Cup) ──────
// Fetched so the FIXTURE CONTEXT block is populated during regen. Other
// leagues pass an empty context (same as the heartbeat currently does).

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'SportsHouseMVP/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchAFLTable(): Promise<LeagueTableRow[]> {
  const year = new Date().getFullYear();
  const data = await fetchJson(`https://api.squiggle.com.au/?q=standings;year=${year}`);
  return (data.standings ?? []).map((s: any, i: number): LeagueTableRow => ({
    name: s.name, position: s.rank ?? i + 1,
    played: s.played ?? 0, wins: s.wins ?? 0, draws: s.draws ?? 0,
    losses: s.losses ?? 0, points: s.points ?? 0,
  }));
}

async function fetchNRLTable(): Promise<LeagueTableRow[]> {
  const data = await fetchJson('https://site.api.espn.com/apis/v2/sports/rugby-league/3/standings');
  const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
  const stat = (e: any, n: string) => (e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0;
  return entries.map((e: any, i: number): LeagueTableRow => ({
    name: e.team?.displayName ?? '', position: i + 1,
    played: stat(e, 'gamesPlayed'), wins: stat(e, 'gamesWon'),
    draws: stat(e, 'gamesDrawn'), losses: stat(e, 'gamesLost'), points: stat(e, 'points'),
  }));
}

async function fetchEPLTable(): Promise<LeagueTableRow[]> {
  const data = await fetchJson('https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings');
  const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
  const stat = (e: any, n: string) => (e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0;
  return entries.map((e: any, i: number): LeagueTableRow => ({
    name: e.team?.displayName ?? '', position: i + 1,
    played: stat(e, 'gamesPlayed'), wins: stat(e, 'wins'),
    draws: stat(e, 'ties'), losses: stat(e, 'losses'), points: stat(e, 'points'),
  }));
}

async function fetchSRUTable(): Promise<LeagueTableRow[]> {
  const data = await fetchJson('https://site.api.espn.com/apis/v2/sports/rugby/242041/standings');
  const entries: any[] = data.children?.[0]?.standings?.entries ?? data.standings?.entries ?? [];
  const stat = (e: any, ...ns: string[]) =>
    ns.reduce((v: number, n: string) => v || ((e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0), 0 as number);
  return entries.map((e: any, i: number): LeagueTableRow => ({
    name: e.team?.displayName ?? e.team?.name ?? '', position: i + 1,
    played: stat(e, 'gamesPlayed'), wins: stat(e, 'wins', 'gamesWon'),
    draws: stat(e, 'ties', 'gamesDrawn'), losses: stat(e, 'losses', 'gamesLost'),
    points: stat(e, 'points'),
  }));
}

interface WCGroupData {
  table: LeagueTableRow[];
  wcRows: WorldCupGroupRow[];
}

async function fetchWCGroupTable(teamName: string): Promise<WCGroupData> {
  const data = await fetchJson('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings');
  const groups: any[] = data.children ?? [];
  const stat = (e: any, ...ns: string[]) =>
    ns.reduce((v: number, n: string) => v || ((e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0), 0 as number);
  for (let i = 0; i < groups.length; i++) {
    const entries: any[] = groups[i].standings?.entries ?? [];
    if (!entries.some((e: any) => e.team?.displayName === teamName)) continue;
    const table: LeagueTableRow[] = entries.map((e: any, j: number): LeagueTableRow => ({
      name: e.team?.displayName ?? '', position: j + 1,
      played: stat(e, 'gamesPlayed', 'played'), wins: stat(e, 'wins'),
      draws: stat(e, 'ties', 'draws'), losses: stat(e, 'losses'),
      points: stat(e, 'points'),
    }));
    const wcRows: WorldCupGroupRow[] = entries.map((e: any, j: number): WorldCupGroupRow => {
      const gf = stat(e, 'pointsFor', 'goalsFor');
      const ga = stat(e, 'pointsAgainst', 'goalsAgainst');
      return {
        teamName:       e.team?.displayName ?? '',
        position:       j + 1,
        played:         stat(e, 'gamesPlayed', 'played'),
        wins:           stat(e, 'wins'),
        draws:          stat(e, 'ties', 'draws'),
        losses:         stat(e, 'losses'),
        goalsFor:       gf,
        goalsAgainst:   ga,
        goalDifference: gf - ga,
        points:         stat(e, 'points'),
      };
    });
    return { table, wcRows };
  }
  return { table: [], wcRows: [] };
}

async function fetchLeagueTable(league: string, teamName: string): Promise<LeagueTableRow[]> {
  try {
    switch (league) {
      case 'afl':         return await fetchAFLTable();
      case 'nrl':         return await fetchNRLTable();
      case 'epl':         return await fetchEPLTable();
      case 'super_rugby': return await fetchSRUTable();
      case 'world_cup':   return (await fetchWCGroupTable(teamName)).table;
      default:            return [];
    }
  } catch (err) {
    console.warn(`  [standings fetch failed for ${league}: ${err instanceof Error ? err.message : err}]`);
    return [];
  }
}

async function fetchWCMatchContext(
  teamName: string,
  teamId: string,
  worldCupStage: string | undefined,
): Promise<WorldCupMatchContext | undefined> {
  try {
    const { wcRows } = await fetchWCGroupTable(teamName);
    if (wcRows.length === 0) return undefined;
    const group = WC_TEAM_GROUPS[teamId];
    const ourRow = wcRows.find(r => r.teamName === teamName || teamName.includes(r.teamName.split(' ')[0]));
    const played = ourRow?.played ?? 0;
    const gamesRemaining = Math.max(0, 3 - played);
    return {
      stage:               (worldCupStage ?? 'group') as import('@/types').WorldCupStage,
      group,
      groupTable:          wcRows,
      gamesPlayed:         played,
      gamesRemaining,
      advancementScenario: ourRow
        ? computeGroupAdvancementScenario(teamName, ourRow.points, played, gamesRemaining, ourRow.position)
        : '',
    };
  } catch (err) {
    console.warn(`  [WC match context fetch failed: ${err instanceof Error ? err.message : err}]`);
    return undefined;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Polyfill WebSocket for Node < 22 (Supabase Realtime needs it at createClient time)
  if (typeof (globalThis as any).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as any).WebSocket = ws;
  }

  const gameId = process.argv[2]?.trim();
  if (!gameId) {
    console.error('Usage: npm run regen -- <gameId>   e.g. npm run regen -- afl-38612');
    process.exit(1);
  }

  const league = deriveLeague(gameId);
  if (!league) {
    console.error(`Unknown gameId prefix: "${gameId}". Expected e.g. afl-38612, nrl-603376, wc-760421`);
    process.exit(1);
  }

  console.log(`regen  gameId=${gameId}  league=${league}`);

  // Lock — prevent concurrent heartbeat/poller runs
  if (!acquireLock()) {
    console.error('skipped — another generate-previews job holds the lock. Wait for it to finish and retry.');
    process.exit(1);
  }

  // All early exits from here are via `throw` so the finally block always
  // releases the lock. process.exit() bypasses finally in Node.js.
  let exitCode = 0;
  try {
    if (!await isOllamaReachable()) {
      throw new Error('Ollama not reachable — is it running?');
    }

    // Fetch fixtures with generous window (30 days back, 60 days forward)
    // so the target is found even if it's outside the normal 14-day lookahead.
    const GENEROUS_LOOKBACK = 30;
    const GENEROUS_LOOKAHEAD_MS = 60 * 86400_000;

    let fixtures;
    try {
      fixtures = await fetchLeagueFixtures(league, GENEROUS_LOOKBACK);
    } catch (err) {
      throw new Error(`Failed to fetch ${league} fixtures: ${err instanceof Error ? err.message : err}`);
    }

    const now = Date.now();
    const fixture = fixtures.find(
      f => f.id === gameId && new Date(f.date).getTime() <= now + GENEROUS_LOOKAHEAD_MS,
    );

    if (!fixture) {
      const sample = fixtures.slice(0, 10).map(f => `    ${f.id}  (${f.date})`).join('\n');
      throw new Error(
        `Fixture not found: ${gameId}\n  Fetched ${fixtures.length} ${league} fixtures. IDs available:\n${sample}`,
      );
    }

    const teamEntry = TEAMS.find(t => t.id === fixture.teamId);
    const teamName  = teamEntry?.name ?? fixture.teamId;
    console.log(`  fixture  ${teamName} vs ${fixture.opponent}  (${fixture.date})`);

    // Fetch live standings so FIXTURE CONTEXT is injected into the prompt.
    // This is the key difference from the heartbeat (which passes empty context).
    const leagueTable = await fetchLeagueTable(league, teamName);

    // For WC fixtures, also fetch the full WorldCupMatchContext (group, groupTable,
    // advancement scenario). This drives the GROUP D STANDINGS block in the prompt.
    const wcMatchCtx = league === 'world_cup'
      ? await fetchWCMatchContext(teamName, fixture.teamId, fixture.worldCupStage)
      : undefined;

    let previewContext: Partial<PreviewContext> = {};
    if (leagueTable.length > 0) {
      const sorted = [...leagueTable].sort((a, b) => a.position - b.position);
      const teamRow = sorted.find(r => r.name === teamName || teamName.includes(r.name.split(' ')[0]));
      const oppRow  = sorted.find(r => r.name === fixture.opponent || fixture.opponent.includes(r.name.split(' ')[0]));
      previewContext = {
        leagueTable,
        teamStanding:     teamRow     ? { name: teamRow.name,     position: teamRow.position,     played: teamRow.played,     wins: teamRow.wins,     draws: teamRow.draws,     losses: teamRow.losses,     points: teamRow.points }     : undefined,
        opponentStanding: oppRow      ? { name: oppRow.name,      position: oppRow.position,      played: oppRow.played,      wins: oppRow.wins,      draws: oppRow.draws,      losses: oppRow.losses,      points: oppRow.points }      : undefined,
      };
    }
    if (wcMatchCtx) {
      previewContext.worldCup = wcMatchCtx;
    }

    // Wire verified coaches — feeds HEAD COACHES into the prompt so the model
    // names real people instead of hallucinating from training knowledge.
    previewContext.teamManager     = MANAGER[fixture.teamId];
    previewContext.opponentManager = fixture.opponentId ? MANAGER[fixture.opponentId] : undefined;
    if (previewContext.teamManager || previewContext.opponentManager) {
      console.log(`  coaches  ${previewContext.teamManager ?? '?'} vs ${previewContext.opponentManager ?? '(unknown)'}`);
    }

    // Compute and print the FIXTURE CONTEXT label (diagnostic — helps verify the
    // label logic before inspecting the full generated preview).
    const fixtureCtxPlayed = (previewContext.teamStanding?.played ?? previewContext.opponentStanding?.played);
    const fixtureCtx = resolveCompetitionContext(
      league,
      leagueTable,
      teamName,
      fixture.opponent,
      fixtureCtxPlayed,
      wcMatchCtx,
    );

    console.log(`  FIXTURE CONTEXT:`);
    console.log(`    Phase:  ${fixtureCtx.phase}`);
    console.log(`    Stakes: ${fixtureCtx.stakes}${fixtureCtx.explanation ? ` — ${fixtureCtx.explanation}` : ''}`);
    if (fixtureCtx.stakes === 'STANDARD') {
      console.log(`    (STANDARD → block suppressed in prompt)`);
    }

    console.log(`  generating…`);
    const t0 = Date.now();
    const result = await generateAndStorePreview(league, fixture, teamName, previewContext);
    const elapsed = Date.now() - t0;

    if (!result.ok) {
      throw new Error(`generate failed: ${result.error ?? 'unknown'}`);
    }

    // Fetch the new row from Supabase to confirm updated_at
    const admin = getSupabaseAdmin();
    let updatedAt = '(unknown)';
    if (admin) {
      const { data } = await admin
        .from('game_previews')
        .select('updated_at, model')
        .eq('game_id', gameId)
        .maybeSingle();
      if (data) {
        updatedAt = data.updated_at as string;
        console.log(`  done    elapsed=${elapsed}ms  model=${data.model}  updated_at=${updatedAt}`);
      }
    } else {
      console.log(`  done    elapsed=${elapsed}ms  updated_at=${updatedAt}`);
    }

  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    releaseLock();
  }
  if (exitCode) process.exit(exitCode);
}

main().catch(err => { console.error(err); releaseLock(); process.exit(1); });
