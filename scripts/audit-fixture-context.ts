/**
 * scripts/audit-fixture-context.ts
 *
 * Prints the FIXTURE CONTEXT block that resolveCompetitionContext produces for:
 *   1. The first upcoming AFL or NRL fixture in the current round
 *   2. Australia v Türkiye (World Cup, game wc-760421)
 *
 * Also fetches and prints the stored Supabase preview text for each.
 *
 * Run:
 *   npx tsx scripts/audit-fixture-context.ts
 */

import { resolveCompetitionContext } from '@/lib/competition-structure';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { LeagueTableRow, WorldCupGroupRow } from '@/types';

// ─── Fetch helpers (inline — same logic as /api/standings/route.ts) ───────────

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'SportsHouseMVP/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchAFLStandings(): Promise<LeagueTableRow[]> {
  const year = new Date().getFullYear();
  const data = await fetchJson(`https://api.squiggle.com.au/?q=standings;year=${year}`);
  return (data.standings ?? []).map((s: any, i: number): LeagueTableRow => ({
    name:     s.name,
    position: s.rank ?? i + 1,
    played:   s.played  ?? 0,
    wins:     s.wins    ?? 0,
    draws:    s.draws   ?? 0,
    losses:   s.losses  ?? 0,
    points:   s.points  ?? 0,
  }));
}

async function fetchNRLStandings(): Promise<LeagueTableRow[]> {
  const data    = await fetchJson('https://site.api.espn.com/apis/v2/sports/rugby-league/3/standings');
  const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
  const stat = (e: any, n: string) =>
    (e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0;
  return entries.map((e: any, i: number): LeagueTableRow => ({
    name:     e.team?.displayName ?? '',
    position: i + 1,
    played:   stat(e, 'gamesPlayed'),
    wins:     stat(e, 'gamesWon'),
    draws:    stat(e, 'gamesDrawn'),
    losses:   stat(e, 'gamesLost'),
    points:   stat(e, 'points'),
  }));
}

// ─── AFL — current round fixtures ─────────────────────────────────────────────

async function fetchAFLCurrentRound(): Promise<{ team: string; opp: string; played: number } | null> {
  const year = new Date().getFullYear();
  // Get all games this year, filter to incomplete (complete < 100) and upcoming
  const data = await fetchJson(`https://api.squiggle.com.au/?q=games;year=${year}`);
  const games: any[] = data.games ?? [];
  const now = Date.now();

  // Find games not yet complete, sort by date ascending
  const upcoming = games
    .filter((g: any) => g.complete < 100 && new Date(g.date).getTime() > now - 2 * 3600 * 1000)
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (upcoming.length === 0) return null;

  const g = upcoming[0];
  // Figure out how many rounds have been played — use the round of this game
  return { team: g.hteam, opp: g.ateam, played: Math.max(0, (g.round ?? 1) - 1) };
}

// ─── NRL — current round fixtures via ESPN ─────────────────────────────────────

async function fetchNRLCurrentGame(): Promise<{ team: string; opp: string; played: number } | null> {
  const now = new Date();
  const pad  = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  // Fetch a 7-day window
  const d2 = new Date(now.getTime() + 7 * 86400000);
  const dateStr2 = `${d2.getFullYear()}${pad(d2.getMonth() + 1)}${pad(d2.getDate())}`;
  const data = await fetchJson(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${dateStr}-${dateStr2}`,
  );
  const events: any[] = data.events ?? [];
  if (events.length === 0) return null;
  const e = events[0];
  const comps: any[] = e.competitions ?? [];
  const c = comps[0];
  const competitors: any[] = c?.competitors ?? [];
  const home = competitors.find((x: any) => x.homeAway === 'home');
  const away = competitors.find((x: any) => x.homeAway === 'away');
  if (!home || !away) return null;
  // Approximate rounds played from current standings (use first entry's gamesPlayed)
  const standings = await fetchNRLStandings();
  const played = standings[0]?.played ?? 14;
  return { team: home.team?.displayName ?? home.team?.name ?? '', opp: away.team?.displayName ?? away.team?.name ?? '', played };
}

// ─── World Cup — Australia group standings ─────────────────────────────────────

async function fetchAUSGroupStandings(): Promise<{ table: LeagueTableRow[]; wcRows: WorldCupGroupRow[] }> {
  const data = await fetchJson(
    'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings',
  );
  const groups: any[] = data.children ?? [];

  const stat = (e: any, ...names: string[]) =>
    names.reduce((v: number, n: string) =>
      v || ((e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0), 0 as number);

  const groupLabel = (g: any, idx: number): string => {
    const nameStr: string = g.name ?? g.abbreviation ?? '';
    const m = nameStr.match(/[Gg]roup\s+([A-La-l])\b/);
    if (m) return m[1].toUpperCase();
    return String.fromCharCode(65 + idx);
  };

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const entries: any[] = g.standings?.entries ?? [];
    const hasAus = entries.some((e: any) => e.team?.displayName === 'Australia');
    if (!hasAus) continue;

    const label = groupLabel(g, i);
    const table: LeagueTableRow[] = entries.map((e: any, j: number): LeagueTableRow => ({
      name:     e.team?.displayName ?? '',
      position: j + 1,
      played:   stat(e, 'gamesPlayed', 'played'),
      wins:     stat(e, 'wins'),
      draws:    stat(e, 'ties', 'draws'),
      losses:   stat(e, 'losses'),
      points:   stat(e, 'points'),
    }));

    const wcRows: WorldCupGroupRow[] = entries.map((e: any, j: number): WorldCupGroupRow => ({
      teamName:       e.team?.displayName ?? '',
      played:         stat(e, 'gamesPlayed', 'played'),
      wins:           stat(e, 'wins'),
      draws:          stat(e, 'ties', 'draws'),
      losses:         stat(e, 'losses'),
      goalsFor:       stat(e, 'pointsFor', 'goalsFor'),
      goalsAgainst:   stat(e, 'pointsAgainst', 'goalsAgainst'),
      goalDifference: stat(e, 'pointsFor', 'goalsFor') - stat(e, 'pointsAgainst', 'goalsAgainst'),
      points:         stat(e, 'points'),
      position:       j + 1,
    }));

    return { table, wcRows };
  }
  return { table: [], wcRows: [] };
}

// ─── Supabase preview fetch ───────────────────────────────────────────────────

async function fetchPreview(gameId: string): Promise<any | null> {
  const admin = getSupabaseAdmin();
  if (!admin) { console.error('No Supabase admin client'); return null; }
  const { data, error } = await admin
    .from('game_previews')
    .select('game_id, payload, model, updated_at')
    .eq('game_id', gameId)
    .maybeSingle();
  if (error) { console.error('Supabase error:', error.message); return null; }
  return data;
}

// ─── Print helpers ────────────────────────────────────────────────────────────

function printFixtureContext(league: string, table: LeagueTableRow[], teamName: string, oppName: string, played: number | undefined, wcCtx?: any) {
  const ctx = resolveCompetitionContext(league, table, teamName, oppName, played, wcCtx);
  console.log('  FIXTURE CONTEXT (authoritative — derived from live standings):');
  console.log(`    Phase:  ${ctx.phase}`);
  const stakesLine = ctx.explanation
    ? `${ctx.stakes} — ${ctx.explanation}`
    : ctx.stakes;
  console.log(`    Stakes: ${stakesLine}`);
  return ctx;
}

function printPreview(row: any) {
  if (!row) { console.log('  [no preview in Supabase]'); return; }
  const preview = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  console.log(`  [model: ${row.model ?? '?'} | updated: ${row.updated_at?.slice(0, 16) ?? '?'}]`);
  console.log();

  const fields: [string, string][] = [
    ['headline',       'Headline'],
    ['teaser',         'Teaser'],
    ['matchupAnalysis','Matchup Analysis'],
    ['tacticalBattle', 'Tactical Battle'],
    ['keyPlayer',      'Key Player'],
    ['prediction',     'Prediction'],
    ['verdict',        'Verdict'],
  ];
  for (const [key, label] of fields) {
    const val = preview?.[key];
    if (val) console.log(`  ${label}:\n    ${String(val).replace(/\n/g, '\n    ')}\n`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Polyfill WebSocket for Node < 22 (Supabase Realtime needs it at createClient() time)
  if (typeof (globalThis as any).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as any).WebSocket = ws;
  }

  // ── 1. AFL current round game ────────────────────────────────────────────────

  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE 1 — AFL current round');
  console.log('═══════════════════════════════════════════════════════════');

  let aflDone = false;
  try {
    const [aflStandings, aflGame] = await Promise.all([fetchAFLStandings(), fetchAFLCurrentRound()]);

    if (!aflGame) {
      console.log('  [no upcoming AFL fixture found — trying NRL instead]');
    } else {
      console.log(`  Game:  ${aflGame.team} vs ${aflGame.opp}`);
      console.log(`  Rounds played (approx): ${aflGame.played}`);
      console.log();
      printFixtureContext('afl', aflStandings, aflGame.team, aflGame.opp, aflGame.played);
      aflDone = true;

      // Try to find a stored Supabase preview for this fixture
      // The game ID format is afl-{squiggle_id}; we'll search by team names instead
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data: rows } = await admin
          .from('game_previews')
          .select('game_id, payload, model, updated_at')
          .like('game_id', 'afl-%')
          .order('updated_at', { ascending: false })
          .limit(20);
        // Find one whose preview mentions both teams
        const match = (rows ?? []).find((r: any) => {
          const p = typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload ?? '');
          return p.toLowerCase().includes(aflGame.team.split(' ')[1]?.toLowerCase() ?? '') &&
                 p.toLowerCase().includes(aflGame.opp.split(' ')[1]?.toLowerCase() ?? '');
        });
        if (match) {
          console.log();
          console.log(`  Supabase preview (${match.game_id}):`);
          printPreview(match);
        } else {
          console.log();
          console.log('  [no exact Supabase preview match found for this fixture]');
          // Print first AFL preview as a fallback example
          if (rows && rows.length > 0) {
            console.log(`  (showing most-recent AFL preview: ${rows[0].game_id})`);
            printPreview(rows[0]);
          }
        }
      }
    }
  } catch (err: any) {
    console.log(`  [AFL fetch error: ${err.message}]`);
  }

  // If AFL had no upcoming fixture, try NRL
  if (!aflDone) {
    console.log();
    console.log('─── NRL fallback ────────────────────────────────────────');
    try {
      const [nrlStandings, nrlGame] = await Promise.all([fetchNRLStandings(), fetchNRLCurrentGame()]);
      if (!nrlGame) {
        console.log('  [no upcoming NRL fixture found either]');
      } else {
        console.log(`  Game:  ${nrlGame.team} vs ${nrlGame.opp}`);
        console.log(`  Rounds played (approx): ${nrlGame.played}`);
        console.log();
        printFixtureContext('nrl', nrlStandings, nrlGame.team, nrlGame.opp, nrlGame.played);

        const admin = getSupabaseAdmin();
        if (admin) {
          const { data: rows } = await admin
            .from('game_previews')
            .select('game_id, payload, model, updated_at')
            .like('game_id', 'nrl-%')
            .order('updated_at', { ascending: false })
            .limit(5);
          if (rows && rows.length > 0) {
            console.log();
            console.log(`  Supabase preview (${rows[0].game_id}):`);
            printPreview(rows[0]);
          }
        }
      }
    } catch (err: any) {
      console.log(`  [NRL fetch error: ${err.message}]`);
    }
  }

  // ── 2. Australia v Türkiye (World Cup) ─────────────────────────────────────

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE 2 — Australia v Türkiye (World Cup, wc-760421)');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    const { table: wcTable, wcRows } = await fetchAUSGroupStandings();

    if (wcTable.length === 0) {
      console.log('  [no World Cup group standings returned]');
    } else {
      const group = wcRows[0] ? 'D' : '?'; // group label tracked in wcRows via fetchAUSGroupStandings
      console.log(`  Group standings:`);
      for (const r of wcTable) {
        console.log(`    ${r.position}. ${r.name.padEnd(20)} P${r.played} W${r.wins} D${r.draws} L${r.losses}  Pts ${r.points}`);
      }
      console.log();

      // Build WorldCupMatchContext for Australia vs Türkiye
      const ausRow = wcRows.find(r => r.teamName === 'Australia');
      const turRow = wcRows.find(r => r.teamName === 'Türkiye' || r.teamName === 'Turkey');
      const ausPlayed = ausRow?.played ?? 0;

      const wcCtx = {
        group,
        teamGroupRow:     ausRow ?? null,
        opponentGroupRow: turRow ?? null,
        groupStandings:   wcRows,
        matchNumber:      ausPlayed + 1,
        totalGroupGames:  3,
        stage:            'group' as const,
      };

      printFixtureContext('world_cup', wcTable, 'Australia', turRow?.teamName ?? 'Türkiye', ausPlayed, wcCtx);
    }

    console.log();
    const preview = await fetchPreview('wc-760421');
    if (preview) {
      console.log('  Supabase preview (wc-760421):');
      printPreview(preview);
    } else {
      console.log('  [no Supabase preview for wc-760421]');
    }
  } catch (err: any) {
    console.log(`  [WC fetch error: ${err.message}]`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
