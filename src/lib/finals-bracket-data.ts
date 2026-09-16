/**
 * League-wide finals bracket data — every game in the finals series with live
 * results, grouped into COMP_RULES finalsSchedule rounds by date window.
 * Powers the FinalsBracket component's results + full-bracket view. Applies to
 * any league whose COMP_RULES entry has a finalsSchedule; per-league sources:
 *   AFL — Squiggle games (year query, complete/scores fields)
 *   NRL — ESPN rugby-league/3 scoreboard (range URL via the month-shim)
 *   SRU — ESPN rugby/242041 scoreboard
 */

import { COMP_RULES, finalsRoundForDate } from '@/lib/competition-rules';
import { fetchTimeout, fetchESPNScoreboard } from '@/lib/espn';

export interface BracketGame {
  home: string;
  away: string;
  homeScore?: number;
  awayScore?: number;
  complete: boolean;
  date: string;
  venue?: string;
}

export interface BracketRound {
  name: string;
  decider?: boolean;
  finalEightWeek1?: boolean;
  games: BracketGame[];
}

const ESPN_PATH: Record<string, string> = {
  nrl:         'rugby-league/3',
  super_rugby: 'rugby/242041',
};

const cache = new Map<string, { at: number; rounds: BracketRound[] | null }>();
const TTL_MS = 5 * 60_000;

async function fetchAflFinalsGames(fromISO: string, toISO: string): Promise<BracketGame[]> {
  const year = fromISO.slice(0, 4);
  const res = await fetchTimeout(
    `https://api.squiggle.com.au/?q=games;year=${year}`,
    { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 300 } },
  );
  if (!res.ok) return [];
  const { games = [] } = await res.json();
  return (games as Array<Record<string, unknown>>)
    .filter(g => {
      const d = String(g.date ?? '');
      return d >= fromISO && d <= `${toISO}T23:59:59`;
    })
    .map((g): BracketGame => {
      const complete = Number(g.complete) === 100;
      return {
        home: String(g.hteam ?? ''),
        away: String(g.ateam ?? ''),
        homeScore: complete || Number(g.complete) > 0 ? Number(g.hscore ?? 0) : undefined,
        awayScore: complete || Number(g.complete) > 0 ? Number(g.ascore ?? 0) : undefined,
        complete,
        date: String(g.date ?? ''),
        venue: g.venue ? String(g.venue) : undefined,
      };
    })
    .filter(g => g.home && g.away);
}

async function fetchEspnFinalsGames(path: string, fromISO: string, toISO: string): Promise<BracketGame[]> {
  const fmt = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
  const res = await fetchESPNScoreboard(
    `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${fmt(fromISO)}-${fmt(toISO)}&limit=200`,
    { next: { revalidate: 300 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const out: BracketGame[] = [];
  for (const ev of (data.events ?? []) as Array<Record<string, any>>) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const homeC = (comp.competitors ?? []).find((c: any) => c.homeAway === 'home');
    const awayC = (comp.competitors ?? []).find((c: any) => c.homeAway === 'away');
    if (!homeC || !awayC) continue;
    const complete = !!(ev.status?.type?.completed ?? comp.status?.type?.completed);
    const started  = complete || !!(ev.status?.type?.state && ev.status.type.state !== 'pre');
    out.push({
      home: String(homeC.team?.displayName ?? homeC.team?.name ?? ''),
      away: String(awayC.team?.displayName ?? awayC.team?.name ?? ''),
      homeScore: started ? Number(homeC.score ?? 0) : undefined,
      awayScore: started ? Number(awayC.score ?? 0) : undefined,
      complete,
      date: String(ev.date ?? ''),
      venue: comp.venue?.fullName ? String(comp.venue.fullName) : undefined,
    });
  }
  return out.filter(g => g.home && g.away);
}

/**
 * Full finals bracket for a league, or null when the league has no finals
 * schedule or no fetchable source. Rounds come back in schedule order; games
 * within a round are date-ordered.
 */
export async function fetchFinalsBracket(league: string): Promise<BracketRound[] | null> {
  const schedule = COMP_RULES[league]?.finalsSchedule;
  if (!schedule || schedule.length === 0) return null;

  const hit = cache.get(league);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rounds;

  const fromISO = schedule[0].from;
  const toISO   = schedule[schedule.length - 1].to;

  let games: BracketGame[] = [];
  try {
    if (league === 'afl') games = await fetchAflFinalsGames(fromISO, toISO);
    else if (ESPN_PATH[league]) games = await fetchEspnFinalsGames(ESPN_PATH[league], fromISO, toISO);
    else { cache.set(league, { at: Date.now(), rounds: null }); return null; }
  } catch {
    return hit?.rounds ?? null;
  }

  const rounds: BracketRound[] = schedule.map(r => ({
    name: r.name,
    decider: r.decider,
    finalEightWeek1: r.finalEightWeek1,
    games: [],
  }));
  for (const g of games) {
    const round = finalsRoundForDate(league, g.date);
    if (!round) continue;
    rounds.find(r => r.name === round.name)?.games.push(g);
  }
  for (const r of rounds) r.games.sort((a, b) => a.date.localeCompare(b.date));

  cache.set(league, { at: Date.now(), rounds });
  return rounds;
}
