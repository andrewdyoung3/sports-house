'use client';

/**
 * CompetitionFeedCard — the dashboard card for a whole-competition follow.
 *
 * The dashboard's unit was the team: one TeamFeedCard per followed team, with a
 * league appearing only as a sidebar heading. A competition follow has no team
 * to anchor a card to, so following F1 — where the championship is usually a
 * fan's ONLY follow — produced "No teams yet" and an empty feed.
 *
 * This is the competition's equivalent card, and it deliberately mirrors
 * TeamFeedCard's anatomy (header + crest, Next Up tiles, an unfollow control)
 * so the two read as one feed rather than two designs. What differs is what a
 * competition can actually say:
 *   - Next Up spans the whole competition, not one team's fixtures.
 *   - Latest Results replaces Recent Form — a W/L streak is a team's property,
 *     and a competition has no record of its own.
 *   - There is no news section: /api/news is per-team and covers four leagues,
 *     so a competition feed would be empty or, worse, one club's news passed
 *     off as the competition's.
 */

import { useState, useEffect } from 'react';
import { Calendar, Trophy, X } from 'lucide-react';

import { Card, CardHeader, CardBody, CardSection } from '@/components/ui/card';
import { TeamBadge } from '@/components/ui/team-badge';
import { GameCard } from '@/components/dashboard/game-card';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { LEAGUES, TEAMS, REAL_DATA_LEAGUES } from '@/lib/teams';
import { leagueBrandAccent, leagueLabel } from '@/lib/league-brand';
import { accentVars } from '@/lib/team-ink';
import type { UpcomingGame, GameResult } from '@/types';

interface CompetitionFeedCardProps {
  leagueId: string;
  onUnfollow: (leagueId: string) => void;
}

/** A competition-scoped result carries the perspective team id (see /api/results). */
type LeagueResult = GameResult & { teamId?: string };

export function CompetitionFeedCard({ leagueId, onUnfollow }: CompetitionFeedCardProps) {
  const [userTz,     setUserTz]     = useState('Australia/Brisbane');
  const [games,      setGames]      = useState<UpcomingGame[]>([]);
  const [results,    setResults]    = useState<LeagueResult[]>([]);
  const [dataLoaded, setDataLoaded] = useState(!REAL_DATA_LEAGUES.has(leagueId));
  const [loadError,  setLoadError]  = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const league = LEAGUES.find(l => l.id === leagueId);
  const name   = league?.fullName ?? leagueId.toUpperCase();
  const accent = leagueBrandAccent(leagueId);
  const label  = leagueLabel(leagueId);

  useEffect(() => {
    try { setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* keep default */ }
  }, []);

  useEffect(() => {
    if (!REAL_DATA_LEAGUES.has(leagueId)) return;
    setLoadError(false);

    Promise.all([
      fetch(`/api/league-fixtures?league=${leagueId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/results?league=${leagueId}&scope=league`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([fixtureData, resultData]: [UpcomingGame[] | null, LeagueResult[] | null]) => {
      if (Array.isArray(fixtureData)) {
        const now = Date.now();
        setGames(
          fixtureData
            .filter(g => !g.completed && new Date(g.date).getTime() > now)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 2),
        );
      }
      if (Array.isArray(resultData)) setResults(resultData.slice(0, 4));
      // Both null ⇒ both requests failed (not merely empty) ⇒ offer a retry.
      if (fixtureData === null && resultData === null) setLoadError(true);
      setDataLoaded(true);
    }).catch(() => { setLoadError(true); setDataLoaded(true); });
  }, [leagueId, refreshKey]);

  /** Team display for a result row — falls back to the raw id for ids outside TEAMS. */
  const sideOf = (id: string | undefined) => TEAMS.find(t => t.id === id);

  return (
    <Card accentColor={accent} className="animate-fade-in">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* The competition's own mark, in the crest slot a team card uses. */}
            <TeamBadge
              logoUrl={TEAM_LOGOS[`${leagueId}-championship`] ?? TEAM_LOGOS[leagueId]}
              abbreviation={label}
              primaryColor={accent}
              size={44}
              className="rounded-xl"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold leading-tight" style={{ color: 'var(--text)' }}>{name}</h2>
                <span className="sh-comptag text-[10px]" style={{ '--c': accent } as React.CSSProperties}>
                  Competition
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                {league?.sport ?? ''}{league?.country ? ` · ${league.country}` : ''} · Following every fixture
              </p>
            </div>
          </div>

          <button
            onClick={() => onUnfollow(leagueId)}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/[0.06] hover:text-white/80 shrink-0"
            style={{ color: 'var(--text-3)' }}
            title={`Unfollow ${name}`}
            aria-label={`Unfollow ${name}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>

      {loadError && (
        <CardSection>
          <div className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-3)' }}>
            <span>Couldn’t load this competition’s latest data.</span>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="px-2 py-1 rounded-lg font-semibold hover:bg-white/[0.06] transition-colors"
              style={{ color: 'var(--text-2)' }}
            >
              Retry
            </button>
          </div>
        </CardSection>
      )}

      {games.length > 0 && (
        <CardSection>
          <p className="sh-detail-head">
            <Calendar className="h-3 w-3" /> Next Up
          </p>
          <div className="sh-tile-grid">
            {games.map(game => {
              const home = sideOf(game.teamId);
              return (
                <GameCard
                  key={game.id}
                  game={game}
                  teamColor={home?.primaryColor ?? accent}
                  teamShortName={home?.shortName ?? game.teamId}
                  compLabel={game.competition ?? label}
                  userTz={userTz}
                />
              );
            })}
          </div>
        </CardSection>
      )}

      {/* Latest Results — a competition has no W/L record, so this shows the
          competition's most recent matches rather than a form streak. */}
      <CardBody>
        <p className="sh-detail-head">
          <Trophy className="h-3 w-3" /> Latest Results
        </p>
        {results.length > 0 ? (
          <div className="space-y-1">
            {results.map((r, i) => {
              const side = sideOf(r.teamId);
              // F1 rows carry the race name as the opponent and a finishing
              // position instead of a score line.
              const isF1 = leagueId === 'f1';
              return (
                <div
                  key={`${r.teamId ?? leagueId}-${r.date}-${i}`}
                  className="flex items-center gap-2 text-[11px]"
                  style={{ ...accentVars(side?.primaryColor ?? accent), borderLeft: `2px solid var(--accent-ink)`, paddingLeft: 7 }}
                >
                  <span className="font-bold truncate" style={{ color: 'var(--text-2)', maxWidth: '38%' }}>
                    {isF1 ? r.opponent : (side?.shortName ?? r.teamId ?? '')}
                  </span>
                  {!isF1 && (
                    <>
                      <span style={{ color: 'var(--text-3)' }}>{r.isHome ? 'vs' : 'at'}</span>
                      <span className="truncate flex-1 min-w-0" style={{ color: 'var(--text-3)' }}>{r.opponent}</span>
                    </>
                  )}
                  <span
                    className="font-black shrink-0 ml-auto"
                    style={{ color: r.isDraw ? 'var(--text-2)' : r.isWin ? 'var(--win)' : 'var(--loss)' }}
                  >
                    {r.f1Position ?? `${r.teamScore}–${r.opponentScore}`}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] italic" style={{ color: 'var(--text-3)' }}>
            {dataLoaded ? 'No recent results' : 'Loading…'}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
