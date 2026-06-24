'use client';

/**
 * Phase B · Step 3 (2B) — sidebar standings, design `.sh-card.sh-standings` skin.
 *
 * NET-NEW (mirrors the Step-1 hero pattern): the existing `LeagueTable` is shared with the
 * off-limits expand panels AND the results page (which renders outside any `.sh-theme`),
 * so it can't be reskinned in place. This component is used ONLY at the schedule sidebar
 * call site and consumes the SAME props (presentational — no refetch). Per-league columns
 * mirror `LeagueTable` exactly (F1 Driver/Pts, AFL %, others W/D/L). Returns null for
 * non-ladder leagues (Test/cricket) just like today — absorbing §2D.
 *
 * Colour: the "my team" row sets `--accent` inline to THAT team's primaryColor (so
 * `.sh-standings tr.is-mine` tints + the added left-border read in the team's own colour);
 * a hue-independent 3px left border marks it for dark brands. The card-head comp tag carries
 * the competition colour + short code, like the feed pills.
 */

import { TEAMS } from '@/lib/teams';
import type { SportKey, StandingRow } from '@/types';

interface LeagueTableShProps {
  league: SportKey;
  rows: StandingRow[];
  followedTeamIds: Set<string>;
  /** Competition brand colour + short code for the card-head comp tag (from the call site). */
  compColor?: string;
  compShort?: string;
}

export function LeagueTableSh({ league, rows, followedTeamIds, compColor, compShort }: LeagueTableShProps) {
  if (rows.length === 0) return null; // non-ladder (Test/cricket) → no table, as today

  const isF1      = league === 'f1';
  const showPct   = league === 'afl';           // AFL ranks on percentage
  const showDraws = !showPct && !isF1;           // NRL occasional / EPL regular draws

  // Per-row "mine" accent = that team's own colour (looked up from the canonical list).
  const mineAccent = (teamId?: string) => {
    const c = teamId ? TEAMS.find(t => t.id === teamId)?.primaryColor : undefined;
    return c ? ({ '--accent': c } as React.CSSProperties) : undefined;
  };

  return (
    <div className="sh-card sh-standings">
      <div className="sh-card-head">
        {compShort && (
          <span className="sh-comptag" style={{ '--c': compColor ?? 'rgba(255,255,255,0.7)' } as React.CSSProperties}>
            {compShort}
          </span>
        )}
        <span className="sh-card-head-label">{isF1 ? 'Standings' : 'Ladder'}</span>
      </div>

      <div style={{ overflowY: 'auto', overflowX: 'hidden', maxHeight: '260px' }}>
        <table>
          <thead>
            <tr>
              <th className="num sh-rank">#</th>
              <th className="sh-stand-team">{isF1 ? 'Driver' : 'Team'}</th>
              {isF1 ? (
                <th className="num pct">Pts</th>
              ) : (
                <>
                  <th className="num">W</th>
                  {showDraws && <th className="num">D</th>}
                  <th className="num">L</th>
                  <th className="num pct">{showPct ? '%' : 'Pts'}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isMine = !!row.teamId && followedTeamIds.has(row.teamId);
              return (
                <tr key={row.position} className={isMine ? 'is-mine' : ''} style={isMine ? mineAccent(row.teamId) : undefined}>
                  <td className="num sh-rank">{row.position}</td>
                  <td className="sh-stand-team">
                    {row.name}
                    {row.constructorName && (
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)' }}>
                        {row.constructorName}
                      </span>
                    )}
                  </td>
                  {isF1 ? (
                    <td className="num pct">{row.points ?? 0}</td>
                  ) : (
                    <>
                      <td className="num">{row.wins}</td>
                      {showDraws && <td className="num">{row.draws}</td>}
                      <td className="num">{row.losses}</td>
                      <td className="num pct">{showPct ? (row.percentage?.toFixed(1) ?? '—') : (row.points ?? 0)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
