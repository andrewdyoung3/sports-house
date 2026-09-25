/**
 * Post-match REPORT data — the event-keyed enrichment for AI reviews.
 *
 * One ESPN `summary?event=` read per review yields everything a match report
 * needs that the scoreline cannot show: venue and attendance, the full event
 * sequence (goals with HOW they were scored and who assisted, cards,
 * substitutions, injury stoppages, the half-time state) and the team-level
 * stats. Before this module the review route pulled goals through a
 * `type.text === "Goal"` filter (ESPN types a header "Goal - Header", so every
 * headed goal vanished — Brighton 3-0 Arsenal, 2026-09-19, was reviewed as 2-0)
 * and asked /api/match-stats to re-discover the same event by date scan, which
 * 404'd on soccer because ESPN's soccer boxscore has no player rows.
 *
 * Also here: SEASON FACTS — streaks and records computed from each team's
 * completed results this season. ESPN's `lastFiveGames` is a five-game window
 * across competitions; the model read its edge as the run's length ("five-match
 * winning run" for a side that had won nine straight in the league). Runs are
 * now derived and stated, and the review validator binds run claims to them.
 *
 * Per source (2026-09-25):
 *   soccer (ESPN)        keyEvents + boxscore.teams + gameInfo — full report
 *   rugby league / union ESPN summary carries venue + form only (no keyEvents,
 *                        no team stats post-match); the NRL timeline comes from
 *                        nrl.com (preview-fetchers.fetchNRLMatchTimeline)
 *   AFL                  Squiggle season games (venue + season facts) and the
 *                        CFS player stats already summed in afl-roster.ts
 */

import { fetchTimeout } from '@/lib/espn';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeamStatLine { label: string; value: string }

export interface MatchReport {
  venue?:      string;
  attendance?: number;
  homeTeam?:   string;
  awayTeam?:   string;
  /** ESPN team ids from the summary header — no per-league id map needed. */
  teamEspnId?: string;
  oppEspnId?:  string;
  /** Rendered event lines, chronological (goals, cards, subs, stoppages, HT). */
  events:      string[];
  /** Goal lines in the contributions format: `31' Name (Team)[ — own goal| — penalty]`. */
  scoringTimeline: string[];
  /** Assists in scoring order. */
  assists:     Array<{ name: string; team: string }>;
  /** Every individual named in the events — the review's player whitelist. */
  playerNames: string[];
  /** Team-level stats, same label set both sides (empty when ESPN has none). */
  teamStats?:  { team: TeamStatLine[]; opponent: TeamStatLine[] };
}

/** One completed result, as the season-facts derivation sees it. */
export interface SeasonResultLite {
  date:          string;
  teamScore:     number;
  opponentScore: number;
  /** True for the primary league; false for cups / Europe / other comps. */
  isLeague:      boolean;
}

// ─── ESPN summary → report ────────────────────────────────────────────────────

const SOCCER_TEAM_STATS: Array<{ key: string; label: string }> = [
  { key: 'possessionPct',  label: 'Possession %'    },
  { key: 'totalShots',     label: 'Shots'           },
  { key: 'shotsOnTarget',  label: 'Shots on target' },
  { key: 'wonCorners',     label: 'Corners'         },
  { key: 'foulsCommitted', label: 'Fouls'           },
  { key: 'yellowCards',    label: 'Yellow cards'    },
  { key: 'redCards',       label: 'Red cards'       },
  { key: 'saves',          label: 'Saves'           },
];

const nameMatch = (a: string, b: string): boolean => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x === y || x.includes(y) || y.includes(x)) return true;
  // "Brighton and Hove Albion" (ESPN prose) vs "Brighton & Hove Albion" (displayName).
  const norm = (s: string) => s.replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '');
  const nx = norm(x), ny = norm(y);
  return nx === ny || nx.includes(ny) || ny.includes(nx);
};

/**
 * Compress ESPN's goal prose to the part a report quotes. Input is the clause
 * after "Name (Team)": "right footed shot from outside the box to the centre
 * of the goal" → "right footed shot from outside the box".
 */
function goalMethod(clause: string): string {
  return clause
    .replace(/\s+to the (?:top|bottom|centre|center|left|right|high|low)\b[^.]*$/i, '')
    .replace(/\s+following .*$/i, '')
    .trim();
}

export async function fetchESPNMatchReport(
  sportPath: string,
  eventId:   string,
  teamName:  string,
  opponent:  string,
): Promise<MatchReport | undefined> {
  try {
    const res = await fetchTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${eventId}`,
      { next: { revalidate: 6 * 3600 }, timeoutMs: 8000 },
    );
    if (!res.ok) return undefined;
    const data = await res.json() as any;

    const report: MatchReport = { events: [], scoringTimeline: [], assists: [], playerNames: [] };

    // ── Header: sides, ids, final score ──────────────────────────────────────
    const comps: any[] = data.header?.competitions?.[0]?.competitors ?? [];
    const home = comps.find(c => c.homeAway === 'home');
    const away = comps.find(c => c.homeAway === 'away');
    report.homeTeam = home?.team?.displayName;
    report.awayTeam = away?.team?.displayName;
    for (const c of comps) {
      const nm = c.team?.displayName ?? '';
      if (nameMatch(nm, teamName))      report.teamEspnId = String(c.team?.id ?? '');
      else if (nameMatch(nm, opponent)) report.oppEspnId  = String(c.team?.id ?? '');
    }

    // ── Venue ────────────────────────────────────────────────────────────────
    const venue = data.gameInfo?.venue?.fullName;
    if (typeof venue === 'string' && venue.trim()) report.venue = venue.trim();
    const att = Number(data.gameInfo?.attendance);
    if (Number.isFinite(att) && att > 0) report.attendance = att;

    // ── Events (soccer keyEvents; rugby feeds carry none) ────────────────────
    const homeName = report.homeTeam ?? '';
    const awayName = report.awayTeam ?? '';
    let hs = 0, as = 0;
    const names = new Set<string>();
    const addName = (n?: string) => { if (n && n.trim().length > 1) names.add(n.trim()); };
    const seen = new Set<string>();

    for (const e of (data.keyEvents ?? []) as any[]) {
      const type  = String(e.type?.text ?? '');
      const clock = String(e.clock?.displayValue ?? '').trim();
      const team  = String(e.team?.displayName ?? '');
      const text  = String(e.text ?? '');
      const parts: string[] = ((e.participants ?? []) as any[]).map(p => String(p.athlete?.displayName ?? '')).filter(Boolean);

      const isGoal = /^goal\b/i.test(type) || /^penalty - scored$/i.test(type) || /^own goal$/i.test(type);
      if (isGoal) {
        const own = /own goal/i.test(type);
        const pen = /penalty/i.test(type);
        const scorer = parts[0] ?? '';
        if (!scorer || !team) continue;
        // Running score from ESPN's own text ("Goal! Brighton and Hove Albion 1, Arsenal 0.").
        const sc = text.match(/(?:Goal!|Own Goal by [^.]+\.)\s*(.+?) (\d+), (.+?) (\d+)\./);
        if (sc) {
          const firstIsHome = nameMatch(sc[1], homeName);
          hs = Number(firstIsHome ? sc[2] : sc[4]);
          as = Number(firstIsHome ? sc[4] : sc[2]);
        } else if (nameMatch(team, homeName)) hs++; else as++;
        // Method: the clause after "Name (Team)".
        const methodM = text.match(/\)\s+([^.]+)\./);
        const method  = methodM ? goalMethod(methodM[1]) : '';
        // Assist: participants[1] is the assister; the prose adds the build-up.
        const assistName = own ? '' : (parts[1] ?? '');
        const buildUp    = text.match(/following (?:a |an |the )?([a-z -]+?)\.?$/i)?.[1]?.trim();
        const withM      = text.match(/Assisted by [^.]*? with (?:a |an )?([a-z -]+?)(?: following| \.|\.|$)/i)?.[1]?.trim();

        const bits: string[] = [];
        if (pen) bits.push('penalty');
        if (method && !pen) bits.push(method);
        const assistBits: string[] = [];
        if (assistName) assistBits.push(`assist ${assistName}`);
        if (withM)   assistBits.push(withM);
        if (buildUp) assistBits.push(`following a ${buildUp}`);
        const detail = [bits.join(', '), assistBits.length ? `(${assistBits.join(', ')})` : ''].filter(Boolean).join(' ');

        report.events.push(`${clock} GOAL ${team} — ${scorer}${own ? ' (own goal)' : ''}${detail ? `, ${detail}` : ''} [${homeName} ${hs}–${as} ${awayName}]`);
        report.scoringTimeline.push(`${clock} ${scorer} (${team})${own ? ' — own goal' : pen ? ' — penalty' : ''}`);
        if (assistName) report.assists.push({ name: assistName, team });
        addName(scorer); addName(assistName);
        continue;
      }

      if (/card$/i.test(type)) {
        const who = parts[0]; if (!who) continue;
        const reason = text.match(/is shown the (?:yellow|red|second yellow) card(?: for (.+?))?\./i)?.[1];
        report.events.push(`${clock} ${type.replace(/ card$/i, ' card')} — ${who} (${team})${reason ? `, for ${reason}` : ''}`);
        addName(who);
        continue;
      }

      if (/^substitution$/i.test(type)) {
        const [on, off] = parts;
        if (!on) continue;
        report.events.push(`${clock} Substitution ${team} — ${on} on${off ? ` for ${off}` : ''}`);
        addName(on); addName(off);
        continue;
      }

      if (/^start delay$/i.test(type) && /injury/i.test(text)) {
        const who = text.match(/injury (.+?) \(/i)?.[1] ?? parts[0];
        const key = `delay-${clock}-${who ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        report.events.push(`${clock} Injury stoppage — ${who ? `${who} (${team})` : team}`);
        addName(who);
        continue;
      }

      if (/^halftime$/i.test(type)) {
        report.events.push(`HT — ${homeName} ${hs}–${as} ${awayName}`);
        continue;
      }
    }

    if (report.events.length > 0) {
      const fh = Number(home?.score), fa = Number(away?.score);
      if (Number.isFinite(fh) && Number.isFinite(fa)) report.events.push(`FT — ${homeName} ${fh}–${fa} ${awayName}`);
    }
    report.playerNames = [...names];

    // ── Team stats (boxscore.teams; soccer populates these, rugby does not) ──
    const bsTeams: any[] = data.boxscore?.teams ?? [];
    const statsFor = (id?: string): TeamStatLine[] => {
      if (!id) return [];
      const entry = bsTeams.find(t => String(t.team?.id) === id);
      const stats: any[] = entry?.statistics ?? [];
      const out: TeamStatLine[] = [];
      for (const { key, label } of SOCCER_TEAM_STATS) {
        const s = stats.find(x => x.name === key);
        const v = s?.displayValue;
        if (v === undefined || v === null || v === '') continue;
        out.push({ label, value: key === 'possessionPct' ? `${Math.round(Number(v))}` : String(v) });
      }
      // Passing accuracy: ESPN's passPct displayValue is a bare ratio ("0.8").
      const total = Number(stats.find(x => x.name === 'totalPasses')?.displayValue);
      const acc   = Number(stats.find(x => x.name === 'accuratePasses')?.displayValue);
      if (total > 0 && acc >= 0) out.push({ label: 'Pass accuracy %', value: String(Math.round((acc / total) * 100)) });
      return out;
    };
    const t = statsFor(report.teamEspnId), o = statsFor(report.oppEspnId);
    if (t.length > 0 && o.length > 0) report.teamStats = { team: t, opponent: o };

    return report;
  } catch {
    return undefined;
  }
}

// ─── ESPN team schedule → season results ─────────────────────────────────────

/** Extra soccer competitions whose schedules complete the all-competitions record. */
export const SOCCER_CUP_SLUGS = ['eng.charity', 'eng.fa', 'eng.league_cup', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf'];

/**
 * Completed results for a team this season, strictly before `beforeISO`,
 * chronological. `leagueSportPath` is the primary competition (`soccer/eng.1`);
 * `extraSportPaths` are cups whose games count in the all-competitions record.
 * Empty when ESPN has no schedule for the team (rugby feeds post-season).
 */
export async function fetchESPNSeasonResults(
  leagueSportPath:  string,
  extraSportPaths:  string[],
  teamEspnId:       string,
  beforeISO:        string,
): Promise<SeasonResultLite[]> {
  const cutoff = new Date(beforeISO).getTime();
  if (!Number.isFinite(cutoff)) return [];

  const readSchedule = async (sportPath: string, isLeague: boolean): Promise<SeasonResultLite[]> => {
    try {
      const res = await fetchTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamEspnId}/schedule`,
        { next: { revalidate: 3600 }, timeoutMs: 6000 },
      );
      if (!res.ok) return [];
      const data = await res.json() as any;
      const out: SeasonResultLite[] = [];
      const ids = new Set<string>();
      for (const e of (data.events ?? []) as any[]) {
        if (ids.has(String(e.id))) continue; // ESPN schedules repeat rows
        ids.add(String(e.id));
        const comp = e.competitions?.[0];
        if (!comp?.status?.type?.completed) continue;
        const when = new Date(e.date).getTime();
        if (!Number.isFinite(when) || when >= cutoff) continue;
        const mine  = (comp.competitors ?? []).find((c: any) => String(c.team?.id) === teamEspnId || String(c.id) === teamEspnId);
        const other = (comp.competitors ?? []).find((c: any) => c !== mine);
        if (!mine || !other) continue;
        const score = (c: any) => Number(typeof c.score === 'object' ? c.score?.value ?? c.score?.displayValue : c.score);
        const ts = score(mine), os = score(other);
        if (!Number.isFinite(ts) || !Number.isFinite(os)) continue;
        out.push({ date: String(e.date), teamScore: ts, opponentScore: os, isLeague });
      }
      return out;
    } catch { return []; }
  };

  const [league, ...cups] = await Promise.all([
    readSchedule(leagueSportPath, true),
    ...extraSportPaths.map(p => readSchedule(p, false)),
  ]);
  // Cup schedules run on their own season clocks (a Champions League schedule
  // still lists May's games in September), so bound them to THIS league
  // season: nothing earlier than a month before the league's first game.
  const leagueStart = league.length ? Math.min(...league.map(r => new Date(r.date).getTime())) : cutoff;
  const seasonFloor = leagueStart - 31 * 86_400_000;
  const inSeason = cups.flat().filter(r => new Date(r.date).getTime() >= seasonFloor);
  return [...league, ...inSeason].sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Season facts (pure) ─────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Brisbane Lions'" / "Arsenal's". */
const poss = (name: string) => /s$/i.test(name) ? `${name}'` : `${name}'s`;

/**
 * Human lines about how a side arrived and what this result did to that —
 * computed, never estimated. `results` are this season's completed games
 * BEFORE the reviewed match, chronological. Scoring unit: "goal" (soccer) or
 * "point" (the rugby codes, AFL).
 */
export function deriveSeasonFacts(
  name:        string,
  results:     SeasonResultLite[],
  thisMatch:   { teamScore: number; opponentScore: number },
  leagueLabel: string,
  unit:        'goal' | 'point',
): string[] {
  const league = results.filter(r => r.isLeague);
  if (league.length === 0 && results.length === 0) return [];
  const lines: string[] = [];

  const tally = (rs: SeasonResultLite[]) => ({
    w: rs.filter(r => r.teamScore > r.opponentScore).length,
    d: rs.filter(r => r.teamScore === r.opponentScore).length,
    l: rs.filter(r => r.teamScore < r.opponentScore).length,
  });
  const lg = tally(league), all = tally(results);
  const rec = (t: { w: number; d: number; l: number }) => t.d > 0 ? `${t.w}W ${t.d}D ${t.l}L` : `${t.w}W ${t.l}L`;

  if (league.length > 0) {
    const allNote = results.length > league.length ? ` (${rec(all)} in all competitions)` : '';
    lines.push(`${name} came in with ${rec(lg)} from ${plural(league.length, `${leagueLabel} game`)} this season${allNote}.`);
  }

  // Current league run coming in (this season's games only).
  const letter = (r: SeasonResultLite) => r.teamScore > r.opponentScore ? 'W' : r.teamScore < r.opponentScore ? 'L' : 'D';
  let run = 0;
  const last = league.length ? letter(league[league.length - 1]) : null;
  for (let i = league.length - 1; i >= 0 && letter(league[i]) === last; i--) run++;
  let unbeaten = 0;
  for (let i = league.length - 1; i >= 0 && letter(league[i]) !== 'L'; i--) unbeaten++;
  const runWord = last === 'W' ? 'wins' : last === 'L' ? 'defeats' : 'draws';

  const thisLetter = thisMatch.teamScore > thisMatch.opponentScore ? 'W' : thisMatch.teamScore < thisMatch.opponentScore ? 'L' : 'D';
  if (run >= 2 && last) {
    if (thisLetter === last) {
      lines.push(`This result extends ${poss(name)} ${leagueLabel} run to ${run + 1} straight ${runWord} (this season).`);
    } else {
      lines.push(`This result ends ${poss(name)} run of ${run} straight ${leagueLabel} ${runWord} (this season).`);
    }
  } else if (unbeaten >= 3 && thisLetter === 'L') {
    lines.push(`This defeat ends ${poss(name)} ${leagueLabel} unbeaten run at ${unbeaten} games (this season).`);
  }

  if (thisLetter === 'L') {
    if (results.length > 0 && all.l === 0) lines.push(`This was ${poss(name)} first defeat of the season in any competition.`);
    else if (league.length > 0 && lg.l === 0) lines.push(`This was ${poss(name)} first ${leagueLabel} defeat of the season.`);
  }

  // Scoring extremes — only once there is a season to compare against.
  if (results.length >= 3) {
    const maxConceded = Math.max(...results.map(r => r.opponentScore));
    if (thisMatch.opponentScore > maxConceded) {
      lines.push(`${thisMatch.opponentScore} is the most ${unit}s ${name} have conceded in a match this season (previous high ${maxConceded}).`);
    }
    const maxScored = Math.max(...results.map(r => r.teamScore));
    if (thisMatch.teamScore > maxScored) {
      lines.push(`${thisMatch.teamScore} is the most ${unit}s ${name} have scored in a match this season (previous high ${maxScored}).`);
    }
    if (thisMatch.teamScore === 0 && results.every(r => r.teamScore > 0)) {
      lines.push(`First time this season ${name} have failed to score.`);
    }
  }

  return lines;
}
