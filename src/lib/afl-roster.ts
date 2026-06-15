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

interface AflMatchItem { match?: { matchId?: string; homeTeam?: { name?: string }; awayTeam?: { name?: string } } }
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

export interface AflLineups { teamSquad?: string[]; opponentSquad?: string[] }

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
  if (!roundNumber || !teamName) return {};
  const seasonId = await currentSeasonId();
  if (!seasonId) return {};
  const roundId = seasonId.replace('CD_S', 'CD_R') + String(roundNumber).padStart(2, '0');

  const round = await roundItems(roundId);
  if (!round?.items?.length) return {};

  const item = round.items.find(it => {
    const h = it.match?.homeTeam?.name ?? '';
    const a = it.match?.awayTeam?.name ?? '';
    return (nameMatch(h, teamName) && nameMatch(a, opponentName)) ||
           (nameMatch(a, teamName) && nameMatch(h, opponentName));
  });
  const matchId = item?.match?.matchId;
  if (!matchId) return {};

  const roster = await matchRoster(matchId);
  if (!roster) return {};

  const homeNames = playerNames(roster.homeTeam);
  const awayNames = playerNames(roster.awayTeam);
  const homeIsTeam = nameMatch(roster.homeTeam?.teamName?.teamName ?? '', teamName);

  const [mine, theirs] = homeIsTeam ? [homeNames, awayNames] : [awayNames, homeNames];
  return {
    teamSquad:     mine.length   > 0 ? mine   : undefined,
    opponentSquad: theirs.length > 0 ? theirs : undefined,
  };
}
