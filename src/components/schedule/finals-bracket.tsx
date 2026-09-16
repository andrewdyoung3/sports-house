'use client';

/**
 * FinalsBracket — a compact visual of the finals-series structure with THIS
 * fixture placed in it. Fills the information gap left by the voice rules
 * (previews no longer narrate "the winner advances / the loser is out"; the
 * bracket shows it instead). Pure client render from COMP_RULES — no fetch.
 */

import { COMP_RULES, finalsRoundForDate, type FinalsRound } from '@/lib/competition-rules';

/** Compact column label for a finals round. */
function shortLabel(r: FinalsRound): string {
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
    return `Qualifying winners rest, then host a Preliminary; qualifying losers get a second chance in the Semis. Elimination finals are knockout.`;
  }
  return `Knockout — the winner advances to the ${next}.`;
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
  const rounds = COMP_RULES[league]?.finalsSchedule;
  if (!rounds || rounds.length === 0) return null;
  const current = finalsRoundForDate(league, gameDate);
  if (!current) return null;
  const idx = rounds.findIndex(r => r.name === current.name);
  if (idx < 0) return null;

  const color = accent ?? 'var(--accent, #7c5cff)';

  return (
    <div className="sh-bracket" aria-label="Finals series bracket">
      <div className="sh-bracket-title">Finals series — where this game sits</div>
      <div className="sh-bracket-row">
        {rounds.map((r, i) => (
          <div key={r.name} className="sh-bracket-step">
            <div
              className={'sh-bracket-node' + (i === idx ? ' is-live' : '') + (i < idx ? ' is-past' : '')}
              style={i === idx ? { borderColor: color, boxShadow: `0 0 14px ${color}40` } : undefined}
            >
              <div className="sh-bracket-round">{shortLabel(r)}</div>
              {i === idx ? (
                <div className="sh-bracket-match">{teamName} v {opponentName}</div>
              ) : (
                <div className="sh-bracket-slot">{i < idx ? 'decided' : ' '}</div>
              )}
            </div>
            {i < rounds.length - 1 && <div className="sh-bracket-arrow">→</div>}
          </div>
        ))}
      </div>
      <div className="sh-bracket-caption">{consequenceCaption(rounds, idx)}</div>
    </div>
  );
}
