/**
 * AFL.com (Telstra CFS) named team lists — the replacement for Squiggle squads,
 * which return null. AFL gates the feed behind a token: POST /cfs/afl/WMCTok
 * returns a short-lived token used as the `x-media-mis-token` header. The token is
 * fetched at RUNTIME (never stored); only the resulting data is cached.
 *
 * Path: WMCTok → /seasons (currentSeasonId, so the round id is discovered, not
 * hard-coded) → matchItems/round/<roundId> (find the match by team names) →
 * matchRoster/<matchId> (positions[] = the named 22–26; teamStatus FINAL_TEAM once
 * named ~Thursday, PROVISIONAL_TEAM before → empty, suppressed).
 *
 * Teams are named ~weekly, so responses are cached cross-run on /tmp (project
 * convention) to stay gentle on the source and avoid re-handshaking the token.
 *
 * NOT safe to import in client components — Node-only network fetch.
 */

import { readFileSync, writeFileSync, statSync } from 'fs';
import { fetchTimeout } from '@/lib/espn';
import type { MatchStats, PlayerStatLine } from '@/types';

const BASE = 'https://api.afl.com.au/cfs/afl';

// ─── Cross-run file cache (/tmp) ──────────────────────────────────────────────
function cacheFile(name: string): string { return `/tmp/sporthouse-afl-${name}.json`; }
function cacheGet<T>(name: string, ttlMs: number): T | null {
  try {
    const p = cacheFile(name);
    if (Date.now() - statSync(p).mtimeMs > ttlMs) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch { return null; }
}
function cacheSet(name: string, data: unknown): void {
  try { writeFileSync(cacheFile(name), JSON.stringify(data)); } catch { /* non-fatal */ }
}
const TTL_SEASON = 24 * 3600_000;
const TTL_ROUND  = 6 * 3600_000;
const TTL_ROSTER = 3 * 3600_000;   // teams named Thu; late changes game-day

// ─── Token (runtime handshake; in-process only, never persisted) ──────────────
let _token: string | null = null;
async function token(): Promise<string | null> {
  if (_token) return _token;
  try {
    const r = await fetchTimeout(`${BASE}/WMCTok`, {
      method: 'POST', headers: { 'Content-Length': '0' }, body: '', timeoutMs: 8000,
    });
    if (!r.ok) return null;
    const j = await r.json() as { token?: string };
    _token = j.token ?? null;
    return _token;
  } catch { return null; }
}

async function authedJson<T>(path: string): Promise<T | null> {
  const t = await token();
  if (!t) return null;
  try {
    const r = await fetchTimeout(`${BASE}/${path}`, {
      headers: { 'x-media-mis-token': t }, next: { revalidate: 1800 }, timeoutMs: 8000,
    });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

// ─── Discovery + data (each cached) ───────────────────────────────────────────
let _seasonId: string | null = null;
async function currentSeasonId(): Promise<string | null> {
  if (_seasonId) return _seasonId;
  const cached = cacheGet<string>('season', TTL_SEASON);
  if (cached) { _seasonId = cached; return cached; }
  const j = await authedJson<{ currentSeasonId?: string }>('seasons');
  const id = j?.currentSeasonId ?? null;
  if (id) { _seasonId = id; cacheSet('season', id); }
  return id;
}

interface AflPeriodScore { periodNumber?: number; score?: { totalScore?: number; goals?: number; behinds?: number } }
interface AflTeamScore { matchScore?: { totalScore?: number; goals?: number; behinds?: number }; periodScore?: AflPeriodScore[]; minutesInFront?: number }
interface AflMatchItem {
  match?: { matchId?: string; homeTeam?: { name?: string }; awayTeam?: { name?: string } };
  score?: { status?: string; homeTeamScore?: AflTeamScore; awayTeamScore?: AflTeamScore };
}
interface AflRoundResp { items?: AflMatchItem[] }
const _round = new Map<string, AflRoundResp | null>();
async function roundItems(roundId: string): Promise<AflRoundResp | null> {
  if (_round.has(roundId)) return _round.get(roundId)!;
  const cached = cacheGet<AflRoundResp>(`round-${roundId}`, TTL_ROUND);
  if (cached) { _round.set(roundId, cached); return cached; }
  const j = await authedJson<AflRoundResp>(`matchItems/round/${roundId}`);
  _round.set(roundId, j);
  if (j) cacheSet(`round-${roundId}`, j);
  return j;
}

interface AflPlayer { player?: { playerName?: { givenName?: string; surname?: string } } }
interface AflRosterTeam { teamName?: { teamName?: string }; positions?: AflPlayer[] }
interface AflRosterResp { homeTeam?: AflRosterTeam; awayTeam?: AflRosterTeam }
const _roster = new Map<string, AflRosterResp | null>();
async function matchRoster(matchId: string): Promise<AflRosterResp | null> {
  if (_roster.has(matchId)) return _roster.get(matchId)!;
  const cached = cacheGet<AflRosterResp>(`roster-${matchId}`, TTL_ROSTER);
  if (cached) { _roster.set(matchId, cached); return cached; }
  const j = await authedJson<AflRosterResp>(`matchRoster/${matchId}`);
  _roster.set(matchId, j);
  if (j) cacheSet(`roster-${matchId}`, j);
  return j;
}

// Exact / full-substring only — never a last-word fallback (the cricket "* Women"
// collision lesson; here it also avoids "Sydney" matching "Greater Western Sydney"
// unless the other side disambiguates).
function nameMatch(a: string, b: string): boolean {
  const x = (a || '').toLowerCase().trim();
  const y = (b || '').toLowerCase().trim();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
function playerNames(team: AflRosterTeam | undefined): string[] {
  return (team?.positions ?? []).map(p => {
    const pn = p?.player?.playerName;
    return pn ? `${pn.givenName ?? ''} ${pn.surname ?? ''}`.trim() : '';
  }).filter(Boolean);
}

/**
 * name(lowercase) → CFS position code (FB, CHB, HBFL, HFFR, WL, FPR, RK, INT…).
 * Kept SEPARATE from the name list: the squad-vs-last-lineup diff compares raw
 * name strings, so codes are applied at render time only. Side-encoded codes
 * (trailing L/R) ground left/right claims for validatePlayerSideClaims.
 */
function playerPositions(team: AflRosterTeam | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of team?.positions ?? []) {
    const pn = (p as any)?.player?.playerName;
    const name = pn ? `${pn.givenName ?? ''} ${pn.surname ?? ''}`.trim() : '';
    const pos  = ((p as any)?.position ?? '') as string;
    if (name && pos) out[name.toLowerCase()] = pos;
  }
  return out;
}

/**
 * Find the CFS matchId for a round + two team names (either order, Squiggle or
 * full AFL names). Shared by lineups (pre-match) and player stats (post-match).
 */
async function findMatch(
  roundNumber: number,
  teamName: string,
  opponentName: string,
): Promise<{ matchId: string; homeName: string; awayName: string; item: AflMatchItem } | null> {
  if (!roundNumber || !teamName) return null;
  const seasonId = await currentSeasonId();
  if (!seasonId) return null;
  const roundId = seasonId.replace('CD_S', 'CD_R') + String(roundNumber).padStart(2, '0');
  const round = await roundItems(roundId);
  if (!round?.items?.length) return null;
  const item = round.items.find(it => {
    const h = it.match?.homeTeam?.name ?? '';
    const a = it.match?.awayTeam?.name ?? '';
    return (nameMatch(h, teamName) && nameMatch(a, opponentName)) ||
           (nameMatch(a, teamName) && nameMatch(h, opponentName));
  });
  const matchId = item?.match?.matchId;
  if (!matchId || !item) return null;
  return { matchId, homeName: item.match?.homeTeam?.name ?? '', awayName: item.match?.awayTeam?.name ?? '', item };
}

/** Squiggle games feed → the round number for a completed match on a day. */
async function roundForMatch(teamName: string, opponentName: string, day: string): Promise<number | null> {
  const year = day.slice(0, 4);
  const res = await fetchTimeout(
    `https://api.squiggle.com.au/?q=games;year=${year}`,
    { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 1800 }, timeoutMs: 8000 },
  );
  if (!res.ok) return null;
  const { games = [] } = await res.json() as { games?: any[] };
  const game = games.find(g =>
    Number(g.complete) === 100 &&
    String(g.date).slice(0, 10) === day &&
    ((nameMatch(g.hteam, teamName) && nameMatch(g.ateam, opponentName)) ||
     (nameMatch(g.ateam, teamName) && nameMatch(g.hteam, opponentName))));
  return game?.round ? Number(game.round) : null;
}

/**
 * Quarter-by-quarter scores as MATCH EVENTS lines — the passage structure an
 * AFL report is written around ("trailed by 28 late in the third", "kicked
 * six of the last seven"). Cumulative after each term, home side first, with
 * an HT line in the canonical "HT — Home h–a Away" shape the review binders
 * read. Null when the feed has no period scores.
 */
export async function fetchAflQuarterScores(
  teamName: string,
  opponentName: string,
  matchDateISO: string,
): Promise<{ events: string[]; homeName: string; awayName: string } | null> {
  try {
    const round = await roundForMatch(teamName, opponentName, matchDateISO.slice(0, 10));
    if (!round) return null;
    const found = await findMatch(round, teamName, opponentName);
    const hs = found?.item.score?.homeTeamScore, as = found?.item.score?.awayTeamScore;
    if (!found || !hs?.periodScore?.length || !as?.periodScore?.length) return null;
    const home = found.homeName, away = found.awayName;
    const terms = ['Q1', 'Q2', 'Q3', 'Q4'];
    const events: string[] = [];
    let hG = 0, hB = 0, hT = 0, aG = 0, aB = 0, aT = 0;
    const periods = Math.max(hs.periodScore.length, as.periodScore.length);
    for (let i = 0; i < periods; i++) {
      const hp = hs.periodScore.find(p => p.periodNumber === i + 1)?.score ?? {};
      const ap = as.periodScore.find(p => p.periodNumber === i + 1)?.score ?? {};
      const hq = { g: hp.goals ?? 0, b: hp.behinds ?? 0, t: hp.totalScore ?? 0 };
      const aq = { g: ap.goals ?? 0, b: ap.behinds ?? 0, t: ap.totalScore ?? 0 };
      hG += hq.g; hB += hq.b; hT += hq.t; aG += aq.g; aB += aq.b; aT += aq.t;
      const lead = hT === aT ? 'scores level' : `${hT > aT ? home : away} lead by ${Math.abs(hT - aT)}`;
      events.push(`${terms[i] ?? `Q${i + 1}`} — ${home} ${hq.g}.${hq.b} (${hq.t}) v ${away} ${aq.g}.${aq.b} (${aq.t}) in the term; ${home} ${hG}.${hB} (${hT}) – ${aG}.${aB} (${aT}) ${away} after ${i + 1} term${i ? 's' : ''}; ${lead}`);
      if (i === 1) events.push(`HT — ${home} ${hT}–${aT} ${away}`);
    }
    if (typeof hs.minutesInFront === 'number' && typeof as.minutesInFront === 'number') {
      events.push(`Time in front: ${home} ${hs.minutesInFront} min, ${away} ${as.minutesInFront} min`);
    }
    events.push(`FT — ${home} ${hT}–${aT} ${away}`);
    return { events, homeName: home, awayName: away };
  } catch {
    return null;
  }
}

export interface AflLineups {
  teamSquad?: string[];
  opponentSquad?: string[];
  /** name(lowercase) → CFS position code, per side (render-time only). */
  teamSquadPositions?: Record<string, string>;
  opponentSquadPositions?: Record<string, string>;
}

/**
 * Named team lists for an AFL fixture, by round number + the two team names.
 * Returns {} (suppressed) until teams are named (~Thursday) or if anything is
 * unavailable. teamName/opponentName may be Squiggle or full AFL names.
 */
export async function fetchAflLineups(
  roundNumber: number,
  teamName: string,
  opponentName: string,
): Promise<AflLineups> {
  const found = await findMatch(roundNumber, teamName, opponentName);
  if (!found) return {};

  const roster = await matchRoster(found.matchId);
  if (!roster) return {};

  const homeNames = playerNames(roster.homeTeam);
  const awayNames = playerNames(roster.awayTeam);
  const homePos   = playerPositions(roster.homeTeam);
  const awayPos   = playerPositions(roster.awayTeam);
  const homeIsTeam = nameMatch(roster.homeTeam?.teamName?.teamName ?? '', teamName);

  const [mine, theirs]     = homeIsTeam ? [homeNames, awayNames] : [awayNames, homeNames];
  const [minePos, theirPos] = homeIsTeam ? [homePos, awayPos]   : [awayPos, homePos];
  return {
    teamSquad:              mine.length   > 0 ? mine   : undefined,
    opponentSquad:          theirs.length > 0 ? theirs : undefined,
    teamSquadPositions:     Object.keys(minePos).length  > 0 ? minePos  : undefined,
    opponentSquadPositions: Object.keys(theirPos).length > 0 ? theirPos : undefined,
  };
}

// ─── Post-match player stats (cfs/afl/playerStats/match/<matchId>) ────────────
// Full Champion Data lines per player: goals/behinds, disposals, marks, tackles,
// clearances, inside 50s, contested possessions, rating points. Discovered
// 2026-09-13 (same token as rosters). Concluded-match stats are immutable, so
// the cross-run cache TTL is long.

interface AflStatEntry {
  player?: { player?: { player?: { playerName?: { givenName?: string; surname?: string } }; position?: string } };
  playerStats?: {
    stats?: {
      goals?: number; behinds?: number; disposals?: number; marks?: number;
      tackles?: number; inside50s?: number; contestedPossessions?: number;
      hitouts?: number; goalAssists?: number; dreamTeamPoints?: number;
      clearances?: { totalClearances?: number };
    };
  };
}
interface AflPlayerStatsResp { homeTeamPlayerStats?: AflStatEntry[]; awayTeamPlayerStats?: AflStatEntry[] }

const TTL_STATS = 12 * 3600_000;
async function matchPlayerStats(matchId: string): Promise<AflPlayerStatsResp | null> {
  const cached = cacheGet<AflPlayerStatsResp>(`stats-${matchId}`, TTL_STATS);
  if (cached) return cached;
  const j = await authedJson<AflPlayerStatsResp>(`playerStats/match/${matchId}`);
  if (j) cacheSet(`stats-${matchId}`, j);
  return j;
}

function toSide(entries: AflStatEntry[], teamName: string): { teamName: string; aggStats: Array<{ label: string; value: string }>; players: PlayerStatLine[] } {
  const rows = entries.map(e => {
    const pn = e.player?.player?.player?.playerName;
    const s  = e.playerStats?.stats ?? {};
    return {
      name: pn ? `${pn.givenName ?? ''} ${pn.surname ?? ''}`.trim() : '',
      position: e.player?.player?.position || undefined,
      goals: s.goals ?? 0, behinds: s.behinds ?? 0, disposals: s.disposals ?? 0,
      marks: s.marks ?? 0, tackles: s.tackles ?? 0, inside50s: s.inside50s ?? 0,
      contested: s.contestedPossessions ?? 0, clearances: s.clearances?.totalClearances ?? 0,
      hitouts: s.hitouts ?? 0, dtp: s.dreamTeamPoints ?? 0,
    };
  }).filter(r => r.name);

  const sum = (k: 'disposals' | 'inside50s' | 'tackles' | 'contested' | 'clearances' | 'goals' | 'behinds') =>
    Math.round(rows.reduce((a, r) => a + r[k], 0));
  const aggStats = [
    { label: 'Disposals',             value: String(sum('disposals')) },
    { label: 'Inside 50s',            value: String(sum('inside50s')) },
    { label: 'Contested possessions', value: String(sum('contested')) },
    { label: 'Clearances',            value: String(sum('clearances')) },
    { label: 'Tackles',               value: String(sum('tackles')) },
    { label: 'Scoring shots',         value: `${sum('goals') + sum('behinds')} (${sum('goals')}.${sum('behinds')})` },
  ];

  // Key performers: leading goal-kickers + best-rated ball-winners (max 6).
  const byImpact = [...rows].sort((a, b) => (b.dtp || b.disposals + b.goals * 6) - (a.dtp || a.disposals + a.goals * 6));
  const picked: typeof rows = [];
  for (const r of [...rows].sort((a, b) => b.goals - a.goals).slice(0, 2)) {
    if (r.goals > 0 && !picked.includes(r)) picked.push(r);
  }
  for (const r of byImpact) {
    if (picked.length >= 6) break;
    if (!picked.includes(r)) picked.push(r);
  }
  const players: PlayerStatLine[] = picked.map(r => ({
    name: r.name,
    position: r.position,
    stats: [
      ...(r.goals > 0 || r.behinds > 0 ? [{ label: 'Goals', value: `${r.goals}.${r.behinds}` }] : []),
      { label: 'Disposals', value: String(Math.round(r.disposals)) },
      ...(r.marks >= 5 ? [{ label: 'Marks', value: String(Math.round(r.marks)) }] : []),
      ...(r.tackles >= 5 ? [{ label: 'Tackles', value: String(Math.round(r.tackles)) }] : []),
      ...(r.clearances >= 4 ? [{ label: 'Clearances', value: String(Math.round(r.clearances)) }] : []),
      ...(r.hitouts >= 20 ? [{ label: 'Hitouts', value: String(Math.round(r.hitouts)) }] : []),
    ],
  }));
  return { teamName, aggStats, players };
}

/**
 * Post-match player stats for an AFL game, shaped as MatchStats for the review
 * data block. Round is resolved from the Squiggle games feed by teams + date
 * (the caller has no round number post-match). Returns null when anything is
 * unavailable — the review then renders its NO IN-GAME MATCH STATS guard.
 */
export async function fetchAflMatchStats(
  teamName: string,
  opponentName: string,
  matchDateISO: string,
): Promise<MatchStats | null> {
  try {
    const day = matchDateISO.slice(0, 10);
    const year = day.slice(0, 4);
    const res = await fetchTimeout(
      `https://api.squiggle.com.au/?q=games;year=${year}`,
      { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 1800 }, timeoutMs: 8000 },
    );
    if (!res.ok) return null;
    const { games = [] } = await res.json() as { games?: any[] };
    const game = games.find(g =>
      Number(g.complete) === 100 &&
      String(g.date).slice(0, 10) === day &&
      ((nameMatch(g.hteam, teamName) && nameMatch(g.ateam, opponentName)) ||
       (nameMatch(g.ateam, teamName) && nameMatch(g.hteam, opponentName))));
    if (!game?.round) return null;

    const found = await findMatch(Number(game.round), teamName, opponentName);
    if (!found) return null;
    const stats = await matchPlayerStats(found.matchId);
    if (!stats?.homeTeamPlayerStats?.length || !stats?.awayTeamPlayerStats?.length) return null;

    const teamIsHome = nameMatch(found.homeName, teamName);
    const [mine, theirs] = teamIsHome
      ? [stats.homeTeamPlayerStats, stats.awayTeamPlayerStats]
      : [stats.awayTeamPlayerStats, stats.homeTeamPlayerStats];
    return { team: toSide(mine, teamName), opponent: toSide(theirs, opponentName) };
  } catch {
    return null;
  }
}
