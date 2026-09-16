'use client';

/**
 * FinalsBracket — a compact visual of the finals-series structure with THIS
 * fixture placed in it, live results in every round, and a "full bracket"
 * expansion showing every game in the series. Fills the information gap left
 * by the voice rules (previews no longer narrate "the winner advances / the
 * loser is out"; the bracket shows it instead).
 *
 * Structure renders instantly from COMP_RULES (client-safe constants); the
 * results layer arrives from /api/finals-bracket (5-min server cache).
 * Applies to any league whose COMP_RULES entry carries a finalsSchedule.
 */

import { useEffect, useState } from 'react';
import { COMP_RULES, finalsRoundForDate, type FinalsRound } from '@/lib/competition-rules';
import { TEAMS } from '@/lib/teams';

interface BracketGame {
  home: string; away: string;
  homeScore?: number; awayScore?: number;
  complete: boolean; date: string; venue?: string;
}
interface BracketRound {
  name: string; decider?: boolean; finalEightWeek1?: boolean; games: BracketGame[];
}

// Module-level cache — every expanded finals panel on the page shares one fetch.
const bracketCache = new Map<string, BracketRound[]>();

/** Compact column label for a finals round. */
function shortLabel(r: FinalsRound | BracketRound): string {
  if (r.decider) return 'Grand Final';
  return r.name
    .replace('Qualifying/Elimination Final', 'Qualifying & Elimination')
    .replace('Preliminary Final', 'Preliminary')
    .replace('Semi-Final', 'Semi')
    .replace(' Round', '');
}

/** What this round means for winner/loser — the caption under the live node. */
function consequenceCaption(rounds: FinalsRound[], idx: number): string {
  const r = rounds[idx];
  if (r.decider) return 'The premiership is decided here.';
  const next = rounds[idx + 1] ? shortLabel(rounds[idx + 1]) : 'the next round';
  if (r.finalEightWeek1) {
    return 'Qualifying winners rest, then host a Preliminary; qualifying losers get a second chance in the Semis. Elimination finals are knockout.';
  }
  return `Knockout — the winner advances to the ${next}.`;
}

/** Team display: abbreviation when we know the team, else a trimmed name. */
function abbr(name: string): string {
  const t = TEAMS.find(x => x.name.toLowerCase() === name.toLowerCase()
    || name.toLowerCase().includes(x.name.toLowerCase())
    || x.name.toLowerCase().includes(name.toLowerCase()));
  if (t) return t.abbreviation;
  const words = name.split(/\s+/);
  return words.length > 1 ? words[words.length - 1].slice(0, 4).toUpperCase() : name.slice(0, 4).toUpperCase();
}

function ResultLine({ g }: { g: BracketGame }) {
  const played = g.homeScore !== undefined && g.awayScore !== undefined;
  const homeWin = g.complete && played && g.homeScore! > g.awayScore!;
  const awayWin = g.complete && played && g.awayScore! > g.homeScore!;
  return (
    <div className="sh-bracket-result">
      <span className={homeWin ? 'is-winner' : g.complete ? 'is-loser' : ''}>{abbr(g.home)}</span>
      {played ? (
        <span className="sh-bracket-score">{g.homeScore}–{g.awayScore}{!g.complete && <em> live</em>}</span>
      ) : (
        <span className="sh-bracket-score is-upcoming">
          {new Date(g.date).toLocaleDateString(undefined, { weekday: 'short' })}
        </span>
      )}
      <span className={awayWin ? 'is-winner' : g.complete ? 'is-loser' : ''}>{abbr(g.away)}</span>
    </div>
  );
}

export function FinalsBracket({
  league, gameDate, teamName, opponentName, accent,
}: {
  league: string;
  gameDate: string;
  teamName: string;
  opponentName: string;
  accent?: string;
}) {
  const schedule = COMP_RULES[league]?.finalsSchedule;
  const current  = finalsRoundForDate(league, gameDate);
  const [rounds, setRounds] = useState<BracketRound[] | null>(bracketCache.get(league) ?? null);
  const [showFull, setShowFull] = useState(false);

  const active = !!schedule && schedule.length > 0 && !!current;

  // Results layer — structure renders without it; hooks run unconditionally.
  useEffect(() => {
    if (!active || bracketCache.has(league)) return;
    fetch(`/api/finals-bracket?league=${league}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.rounds) {
          bracketCache.set(league, data.rounds);
          setRounds(data.rounds);
        }
      })
      .catch(() => {});
  }, [league, active]);

  if (!active) return null;
  const idx = schedule!.findIndex(r => r.name === current!.name);
  if (idx < 0) return null;

  const color = accent ?? 'var(--accent, #7c5cff)';
  const resultsFor = (name: string) => rounds?.find(r => r.name === name)?.games ?? [];

  return (
    <div className="sh-bracket" aria-label="Finals series bracket">
      <div className="sh-bracket-title">
        Finals series — where this game sits
        <button className="sh-bracket-toggle" onClick={() => setShowFull(v => !v)}>
          {showFull ? 'Hide full bracket' : 'Show full bracket'}
        </button>
      </div>

      <div className="sh-bracket-row">
        {schedule!.map((r, i) => {
          const games = resultsFor(r.name);
          return (
            <div key={r.name} className="sh-bracket-step">
              <div
                className={'sh-bracket-node' + (i === idx ? ' is-live' : '') + (i < idx ? ' is-past' : '')}
                style={i === idx ? { borderColor: color, boxShadow: `0 0 14px ${color}40` } : undefined}
              >
                <div className="sh-bracket-round">{shortLabel(r)}</div>
                {i === idx ? (
                  <div className="sh-bracket-match">{teamName} v {opponentName}</div>
                ) : games.length > 0 ? (
                  <div>{games.map((g, k) => <ResultLine key={k} g={g} />)}</div>
                ) : (
                  <div className="sh-bracket-slot">{i < idx ? 'decided' : ' '}</div>
                )}
              </div>
              {i < schedule!.length - 1 && <div className="sh-bracket-arrow">→</div>}
            </div>
          );
        })}
      </div>
      <div className="sh-bracket-caption">{consequenceCaption(schedule!, idx)}</div>

      {/* Full bracket — every game in the series, full names + scores + venues. */}
      {showFull && rounds && (
        <div className="sh-bracket-full">
          {rounds.map(r => (
            <div key={r.name} className="sh-bracket-full-round">
              <div className="sh-bracket-full-head">{shortLabel(r)}</div>
              {r.games.length === 0 ? (
                <div className="sh-bracket-full-tbd">Matchups to be decided</div>
              ) : r.games.map((g, k) => {
                const played  = g.homeScore !== undefined && g.awayScore !== undefined;
                const homeWin = g.complete && played && g.homeScore! > g.awayScore!;
                const awayWin = g.complete && played && g.awayScore! > g.homeScore!;
                return (
                  <div key={k} className="sh-bracket-full-game">
                    <span className={'sh-bfg-team' + (homeWin ? ' is-winner' : g.complete ? ' is-loser' : '')}>{g.home}</span>
                    <span className="sh-bfg-score">
                      {played ? `${g.homeScore} – ${g.awayScore}` :
                        new Date(g.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                      {played && !g.complete && <em> live</em>}
                    </span>
                    <span className={'sh-bfg-team is-away' + (awayWin ? ' is-winner' : g.complete ? ' is-loser' : '')}>{g.away}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
