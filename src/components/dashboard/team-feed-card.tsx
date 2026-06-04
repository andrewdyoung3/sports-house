'use client';

// Step 9 — zinc-* replaced with .sh-* token system throughout. Section heads
// use .sh-detail-head (accent icon + label); game tiles use .sh-tile-grid.

import { useState, useEffect } from 'react';
import { Calendar, Newspaper, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Card, CardHeader, CardBody, CardSection } from '@/components/ui/card';
import { TeamBadge } from '@/components/ui/team-badge';
import { GameCard } from '@/components/dashboard/game-card';
import { NewsCard } from '@/components/dashboard/news-item';
import { RecentForm } from '@/components/dashboard/recent-form';

// mock-data intentionally NOT imported — this component never shows mock results.
import { TEAM_LOGOS } from '@/lib/team-logos';
import { REAL_DATA_LEAGUES } from '@/lib/teams';
import type { Team, UpcomingGame, GameResult, NewsItem } from '@/types';

interface TeamFeedCardProps {
  team: Team;
  onUnfollow: (teamId: string) => void;
}

export function TeamFeedCard({ team, onUnfollow }: TeamFeedCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [userTz,      setUserTz]      = useState('Australia/Brisbane');

  // Start empty — real data arrives from the API. Never pre-filled with mock data.
  const [games,      setGames]      = useState<UpcomingGame[]>([]);
  const [results,    setResults]    = useState<GameResult[]>([]);
  const [news,       setNews]       = useState<NewsItem[]>([]);
  const [dataLoaded, setDataLoaded] = useState(!REAL_DATA_LEAGUES.has(team.league));

  useEffect(() => {
    try { setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* keep default */ }
  }, []);

  useEffect(() => {
    if (!REAL_DATA_LEAGUES.has(team.league)) return;

    Promise.all([
      fetch(`/api/fixtures?league=${team.league}&teamId=${team.id}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/results?league=${team.league}&teamId=${team.id}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/news?league=${team.league}&teamId=${team.id}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([gamesData, resultsData, newsData]: [UpcomingGame[] | null, GameResult[] | null, NewsItem[] | null]) => {
      if (Array.isArray(gamesData)   && gamesData.length > 0)   setGames(gamesData.slice(0, 2));
      if (Array.isArray(resultsData) && resultsData.length > 0) setResults(resultsData);
      if (Array.isArray(newsData)    && newsData.length > 0)    setNews(newsData);
      setDataLoaded(true);
    });
  }, [team.id, team.league]);

  // W/L record from real recent form only
  const wins   = results.filter(r => r.isWin).length;
  const losses = results.length - wins;

  return (
    <Card accentColor={team.primaryColor} className="animate-fade-in">
      {/* ── Team Header ── */}
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Team crest */}
            <TeamBadge
              logoUrl={TEAM_LOGOS[team.id]}
              abbreviation={team.abbreviation}
              primaryColor={team.primaryColor}
              size={44}
              className="rounded-xl"
            />

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold leading-tight" style={{ color: 'var(--text)' }}>{team.name}</h2>
                {/* Competition/league badge — .sh-comptag, accent-coloured */}
                <span
                  className="sh-comptag text-[10px]"
                  style={{ '--c': team.primaryColor } as React.CSSProperties}
                >
                  {team.league.toUpperCase()}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                {team.division ?? team.league.toUpperCase()} · {team.venue}
              </p>
            </div>
          </div>

          {/* Quick record + unfollow */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right hidden sm:block">
              {dataLoaded && results.length > 0 ? (
                <>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-2)' }}>
                    <span style={{ color: 'var(--win)' }}>{wins}W</span>
                    {' – '}
                    <span style={{ color: 'var(--loss)' }}>{losses}L</span>
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Last 5</p>
                </>
              ) : dataLoaded ? (
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>No results</p>
              ) : (
                <p className="text-[10px] animate-pulse" style={{ color: 'var(--text-3)' }}>Loading…</p>
              )}
            </div>
            <button
              onClick={() => onUnfollow(team.id)}
              className="text-xs transition-colors px-1 py-1 rounded-lg hover:bg-white/[0.06]"
              style={{ color: 'var(--text-3)' }}
              title={`Unfollow ${team.name}`}
              aria-label={`Unfollow ${team.name}`}
            >
              ✕
            </button>
          </div>
        </div>
      </CardHeader>

      {/* ── Recent Form ── */}
      <CardSection>
        <div className="flex items-center justify-between">
          {/* .sh-detail-head with marginBottom:0 — sits inline with RecentForm pips */}
          <p className="sh-detail-head" style={{ marginBottom: 0 }}>
            <Trophy className="h-3 w-3" /> Recent Form
          </p>
          <RecentForm results={results} />
        </div>
      </CardSection>

      {/* ── Upcoming Games ── */}
      {games.length > 0 && (
        <CardSection>
          <p className="sh-detail-head">
            <Calendar className="h-3 w-3" /> Next Up
          </p>
          {/* .sh-tile-grid: 2-col grid, up to 2 tiles per team */}
          <div className="sh-tile-grid">
            {games.map(game => (
              <GameCard
                key={game.id}
                game={game}
                teamColor={team.primaryColor}
                teamShortName={team.shortName}
                compLabel={game.competition ?? team.league.toUpperCase()}
                userTz={userTz}
              />
            ))}
          </div>
        </CardSection>
      )}

      {/* ── Latest News ── */}
      <CardBody>
        <p className="sh-detail-head">
          <Newspaper className="h-3 w-3" /> Latest News
        </p>
        {news.length > 0 ? (
          <div className="space-y-0.5">
            {news.map(item => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] italic" style={{ color: 'var(--text-3)' }}>
            {dataLoaded ? 'No recent news available' : 'Loading…'}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
