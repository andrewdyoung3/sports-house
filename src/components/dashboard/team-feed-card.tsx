'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Calendar, Newspaper, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Card, CardHeader, CardBody, CardSection } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TeamBadge } from '@/components/ui/team-badge';
import { GameCard } from '@/components/dashboard/game-card';
import { NewsCard } from '@/components/dashboard/news-item';
import { RecentForm } from '@/components/dashboard/recent-form';

import { getUpcomingGames, getRecentResults, getRecentNews, getAIPreview } from '@/lib/mock-data';
import { TEAM_LOGOS } from '@/lib/team-logos';
import type { Team, UpcomingGame, GameResult, NewsItem } from '@/types';

/** Leagues with real API backends. */
const REAL_DATA_LEAGUES = new Set(['afl', 'epl', 'nrl', 'super_rugby', 'f1']);

interface TeamFeedCardProps {
  team: Team;
  onUnfollow: (teamId: string) => void;
}

export function TeamFeedCard({ team, onUnfollow }: TeamFeedCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [userTz,      setUserTz]      = useState('Australia/Brisbane');

  // Initialise with mock data for instant render; real data replaces on fetch.
  const [games,   setGames]   = useState<UpcomingGame[]>(() => getUpcomingGames(team, 2));
  const [results, setResults] = useState<GameResult[]>(() => getRecentResults(team, 5));
  const [news,    setNews]    = useState<NewsItem[]>(() => getRecentNews(team, 3));

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
    });
  }, [team.id, team.league]);

  const preview = useMemo(
    () => games[0] ? getAIPreview(team, games[0].opponent, results) : null,
    [team, games, results],
  );

  // W/L record from recent form
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
                <h2 className="text-base font-bold text-white leading-tight">{team.name}</h2>
                <Badge variant="default" className="text-[10px]">{team.league.toUpperCase()}</Badge>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                {team.division ?? team.league.toUpperCase()} · {team.venue}
              </p>
            </div>
          </div>

          {/* Quick record + unfollow */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-zinc-200">
                <span className="text-emerald-400">{wins}W</span>
                {' – '}
                <span className="text-red-400">{losses}L</span>
              </p>
              <p className="text-[10px] text-zinc-600">Last 5</p>
            </div>
            <button
              onClick={() => onUnfollow(team.id)}
              className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors px-1 py-1 rounded-lg hover:bg-zinc-800"
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
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
            <Trophy className="h-3 w-3" /> Recent Form
          </p>
          <RecentForm results={results} />
        </div>
      </CardSection>

      {/* ── Upcoming Games ── */}
      {games.length > 0 && (
        <CardSection>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5 mb-3">
            <Calendar className="h-3 w-3" /> Next Up
          </p>
          <div className="space-y-4">
            {games.map(game => (
              <GameCard key={game.id} game={game} teamColor={team.primaryColor} userTz={userTz} />
            ))}
          </div>
        </CardSection>
      )}

      {/* ── AI Matchup Preview ── */}
      {preview && games[0] && (
        <CardSection>
          <button
            onClick={() => setPreviewOpen(v => !v)}
            className="w-full flex items-center justify-between group"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-indigo-400" />
              <span className="text-indigo-400">AI Preview</span>
              <span className="text-zinc-600">vs {games[0].opponentAbbr}</span>
            </p>
            <span className="text-zinc-600 group-hover:text-zinc-400 transition-colors">
              {previewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </button>

          {previewOpen && (
            <div className="mt-3 space-y-3 animate-fade-in">
              <p className="text-sm text-zinc-300 leading-relaxed">{preview.content}</p>
              <ul className="space-y-1.5">
                {preview.keyInsights.map((insight, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-zinc-400">
                    <span className="text-indigo-400 mt-0.5 shrink-0">→</span>
                    {insight}
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-zinc-700 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Generated by AI · For entertainment only
              </p>
            </div>
          )}
        </CardSection>
      )}

      {/* ── Latest News ── */}
      <CardBody>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5 mb-2">
          <Newspaper className="h-3 w-3" /> Latest News
        </p>
        <div className="space-y-0.5">
          {news.map(item => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
