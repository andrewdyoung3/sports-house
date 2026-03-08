'use client';

import type { TeamStanding, SportKey } from '@/types';

export type StandingRow = TeamStanding & { teamId?: string };

interface LeagueTableProps {
  league: SportKey;
  rows: StandingRow[];
  followedTeamIds: Set<string>;
}

const LEAGUE_LABEL: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby',
};

export function LeagueTable({ league, rows, followedTeamIds }: LeagueTableProps) {
  if (rows.length === 0) return null;

  // AFL uses percentage instead of points; EPL and rugby have draws worth tracking
  const showPct   = league === 'afl';
  const showDraws = !showPct; // NRL has occasional draws, EPL regularly does

  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">
        {LEAGUE_LABEL[league] ?? league} Table
      </p>

      <div className="overflow-y-auto max-h-[260px]">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr className="text-white/30 text-[10px]">
              <th className="text-left font-medium w-5 pb-2">#</th>
              <th className="text-left font-medium pb-2">Team</th>
              <th className="text-right font-medium pb-2 w-6">W</th>
              {showDraws && <th className="text-right font-medium pb-2 w-6">D</th>}
              <th className="text-right font-medium pb-2 w-6">L</th>
              {showPct
                ? <th className="text-right font-medium pb-2 w-12">%</th>
                : <th className="text-right font-medium pb-2 w-7">Pts</th>
              }
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const highlighted = !!row.teamId && followedTeamIds.has(row.teamId);
              return (
                <tr
                  key={row.position}
                  className={highlighted ? 'bg-white/8 rounded' : ''}
                >
                  <td className={`py-1 pr-2 rounded-l ${highlighted ? 'text-white font-bold' : 'text-white/35'}`}>
                    {row.position}
                  </td>
                  <td
                    className={`py-1 pr-2 max-w-[90px] truncate ${highlighted ? 'text-white font-bold' : 'text-white/60'}`}
                    title={row.name}
                  >
                    {row.name}
                  </td>
                  <td className={`py-1 text-right tabular-nums ${highlighted ? 'text-white' : 'text-white/50'}`}>
                    {row.wins}
                  </td>
                  {showDraws && (
                    <td className={`py-1 text-right tabular-nums ${highlighted ? 'text-white' : 'text-white/50'}`}>
                      {row.draws}
                    </td>
                  )}
                  <td className={`py-1 text-right tabular-nums ${highlighted ? 'text-white' : 'text-white/50'}`}>
                    {row.losses}
                  </td>
                  {showPct
                    ? (
                      <td className={`py-1 text-right tabular-nums rounded-r ${highlighted ? 'text-white font-semibold' : 'text-white/50'}`}>
                        {row.percentage?.toFixed(1) ?? '—'}
                      </td>
                    )
                    : (
                      <td className={`py-1 text-right tabular-nums font-semibold rounded-r ${highlighted ? 'text-indigo-300' : 'text-white/50'}`}>
                        {row.points ?? 0}
                      </td>
                    )
                  }
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
