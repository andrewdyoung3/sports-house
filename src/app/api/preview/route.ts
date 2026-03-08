/**
 * GET /api/preview?league=afl&teamId=afl-lions&opponentName=Geelong&gameId=afl-1234
 *
 * Returns PreviewContext for the game expand panel.
 * AFL  → Squiggle (standings + model tips for the specific game)
 * EPL  → ESPN (eng.1 standings + team news for both sides)
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PreviewContext, TeamStanding, NewsHeadline, TipSummary } from '@/types';

// ─── Shared ───────────────────────────────────────────────────────────────────

async function fetchTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = options;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── AFL — Squiggle ───────────────────────────────────────────────────────────

const SQUIGGLE_NAME: Record<string, string> = {
  'afl-crows':     'Adelaide',
  'afl-lions':     'Brisbane Lions',
  'afl-blues':     'Carlton',
  'afl-pies':      'Collingwood',
  'afl-bombers':   'Essendon',
  'afl-dockers':   'Fremantle',
  'afl-cats':      'Geelong',
  'afl-suns':      'Gold Coast',
  'afl-giants':    'GWS Giants',
  'afl-hawks':     'Hawthorn',
  'afl-demons':    'Melbourne',
  'afl-kangaroos': 'North Melbourne',
  'afl-power':     'Port Adelaide',
  'afl-tigers':    'Richmond',
  'afl-saints':    'St Kilda',
  'afl-swans':     'Sydney',
  'afl-eagles':    'West Coast',
  'afl-dogs':      'Western Bulldogs',
};

async function fetchAFLPreview(
  teamId: string,
  opponentName: string,
  gameId: string,
): Promise<PreviewContext> {
  const sqTeam = SQUIGGLE_NAME[teamId];
  if (!sqTeam) return {};

  const year = new Date().getFullYear();

  // Fan out — standings + upcoming game tips in parallel
  const [standingsRes, gamesRes] = await Promise.allSettled([
    fetchTimeout(
      `https://api.squiggle.com.au/?q=standings;year=${year}`,
      { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
    ),
    fetchTimeout(
      `https://api.squiggle.com.au/?q=games;year=${year}`,
      { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
    ),
  ]);

  // ── Standings ──
  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;

  if (standingsRes.status === 'fulfilled' && standingsRes.value.ok) {
    const { standings = [] } = await standingsRes.value.json();
    for (const s of standings as any[]) {
      const entry: TeamStanding = {
        name:       s.name,
        position:   Number(s.rank),
        played:     Number(s.played ?? 0),
        wins:       Number(s.wins ?? 0),
        draws:      Number(s.draws ?? 0),
        losses:     Number(s.losses ?? 0),
        percentage: parseFloat(s.percentage ?? '0'),
      };
      if (s.name === sqTeam) teamStanding = entry;
      // Match opponent by squiggle name or display name
      const oppSqName = SQUIGGLE_NAME[Object.keys(SQUIGGLE_NAME).find(k => SQUIGGLE_NAME[k].toLowerCase() === opponentName.toLowerCase()) ?? ''];
      if (s.name === (oppSqName ?? opponentName)) opponentStanding = entry;
    }
  }

  // ── Tips for the specific upcoming game ──
  let tips: TipSummary | undefined;

  // gameId is like "afl-1234" or "afl-lions-vs-geelong-..." — extract numeric portion
  const numericId = gameId.replace(/^afl-/, '').match(/^\d+$/)?.[0];

  if (numericId && gamesRes.status === 'fulfilled' && gamesRes.value.ok) {
    const { games = [] } = await gamesRes.value.json();
    // Find the game matching our teams (may not have tips endpoint without numeric ID)
    const matchGame = (games as any[]).find(g =>
      Number(g.complete) < 100 &&
      ((g.hteam === sqTeam || g.ateam === sqTeam)),
    );

    if (matchGame) {
      const tipsRes = await fetchTimeout(
        `https://api.squiggle.com.au/?q=tips;game=${matchGame.id}`,
        { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
      ).catch(() => null);

      if (tipsRes?.ok) {
        const { tips: rawTips = [] } = await tipsRes.json();
        if (rawTips.length > 0) {
          const counts: Record<string, number> = {};
          let totalMargin = 0;

          for (const t of rawTips as any[]) {
            const tip = t.tip as string;
            counts[tip] = (counts[tip] ?? 0) + 1;
            totalMargin += Math.abs(Number(t.margin ?? 0));
          }

          const favourite = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          tips = {
            favouriteTeam: favourite[0],
            tipsFor:       favourite[1],
            tipsTotal:     rawTips.length,
            avgMargin:     Math.round(totalMargin / rawTips.length),
          };
        }
      }
    }
  }

  return { teamStanding, opponentStanding, tips };
}

// ─── EPL — ESPN ───────────────────────────────────────────────────────────────

const ESPN_TEAM_ID: Record<string, string> = {
  'epl-arsenal':       '359',
  'epl-astonvilla':    '362',
  'epl-bournemouth':   '349',
  'epl-brentford':     '337',
  'epl-brighton':      '331',
  'epl-chelsea':       '363',
  'epl-crystalpalace': '384',
  'epl-everton':       '368',
  'epl-fulham':        '370',
  'epl-liverpool':     '364',
  'epl-mancity':       '382',
  'epl-manutd':        '360',
  'epl-newcastle':     '361',
  'epl-forest':        '393',
  'epl-spurs':         '367',
  'epl-westham':       '371',
  'epl-wolves':        '380',
};

const ESPN_TEAM_NAME: Record<string, string> = {
  'epl-arsenal':       'Arsenal',
  'epl-astonvilla':    'Aston Villa',
  'epl-bournemouth':   'AFC Bournemouth',
  'epl-brentford':     'Brentford',
  'epl-brighton':      'Brighton & Hove Albion',
  'epl-chelsea':       'Chelsea',
  'epl-crystalpalace': 'Crystal Palace',
  'epl-everton':       'Everton',
  'epl-fulham':        'Fulham',
  'epl-liverpool':     'Liverpool',
  'epl-mancity':       'Manchester City',
  'epl-manutd':        'Manchester United',
  'epl-newcastle':     'Newcastle United',
  'epl-forest':        'Nottingham Forest',
  'epl-spurs':         'Tottenham Hotspur',
  'epl-westham':       'West Ham United',
  'epl-wolves':        'Wolverhampton Wanderers',
};

function statVal(stats: any[], name: string): number {
  return Number(stats.find((s: any) => s.name === name)?.value ?? 0);
}

function parseESPNStandings(entries: any[], displayName: string): TeamStanding | undefined {
  const e = entries.find((x: any) => x.team?.displayName === displayName);
  if (!e) return undefined;
  const stats = e.stats ?? [];
  return {
    name:         displayName,
    position:     statVal(stats, 'rank'),
    played:       statVal(stats, 'gamesPlayed'),
    wins:         statVal(stats, 'wins'),
    draws:        statVal(stats, 'ties'),
    losses:       statVal(stats, 'losses'),
    points:       statVal(stats, 'points'),
    goalsFor:     statVal(stats, 'pointsFor'),
    goalsAgainst: statVal(stats, 'pointsAgainst'),
  };
}

async function fetchEPLPreview(
  teamId: string,
  opponentName: string,
): Promise<PreviewContext> {
  const teamName   = ESPN_TEAM_NAME[teamId];
  const espnTeamId = ESPN_TEAM_ID[teamId];
  if (!teamName) return {};

  const [standingsRes, teamNewsRes, oppNewsRes] = await Promise.allSettled([
    fetchTimeout(
      'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings',
      { next: { revalidate: 3600 } },
    ),
    espnTeamId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/${espnTeamId}/news?limit=4`,
          { next: { revalidate: 1800 } },
        )
      : Promise.resolve(null),
    // For opponent: look up ESPN ID from display name
    (async () => {
      const oppId = Object.entries(ESPN_TEAM_NAME).find(([, v]) => v === opponentName)?.[0];
      const oppEspnId = oppId ? ESPN_TEAM_ID[oppId] : undefined;
      if (!oppEspnId) return null;
      return fetchTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/${oppEspnId}/news?limit=4`,
        { next: { revalidate: 1800 } },
      );
    })(),
  ]);

  // ── Standings ──
  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;

  if (standingsRes.status === 'fulfilled' && standingsRes.value?.ok) {
    const data = await standingsRes.value.json();
    const entries: any[] = data.standings?.[0]?.entries ?? [];
    teamStanding     = parseESPNStandings(entries, teamName);
    opponentStanding = parseESPNStandings(entries, opponentName);
  }

  // ── News ──
  function parseNews(res: Response | null): NewsHeadline[] {
    return []; // will be filled after await
  }

  const teamNews: NewsHeadline[] = [];
  const opponentNews: NewsHeadline[] = [];

  if (teamNewsRes.status === 'fulfilled' && teamNewsRes.value?.ok) {
    const data = await teamNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      teamNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }

  if (oppNewsRes.status === 'fulfilled' && oppNewsRes.value?.ok) {
    const data = await oppNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      opponentNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }

  return {
    teamStanding,
    opponentStanding,
    teamNews:     teamNews.length > 0 ? teamNews : undefined,
    opponentNews: opponentNews.length > 0 ? opponentNews : undefined,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'epl']);
const TEAMID_RE = /^[a-z]+-[a-z0-9]+$/;

export async function GET(req: NextRequest) {
  const league       = req.nextUrl.searchParams.get('league') ?? '';
  const teamId       = req.nextUrl.searchParams.get('teamId') ?? '';
  const opponentName = req.nextUrl.searchParams.get('opponentName') ?? '';
  const gameId       = req.nextUrl.searchParams.get('gameId') ?? '';

  if (!ALLOWED_LEAGUES.has(league) || !TEAMID_RE.test(teamId)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    let ctx: PreviewContext = {};
    if (league === 'afl') ctx = await fetchAFLPreview(teamId, opponentName, gameId);
    else if (league === 'epl') ctx = await fetchEPLPreview(teamId, opponentName);
    return NextResponse.json(ctx);
  } catch (err) {
    console.error('[/api/preview]', err);
    return NextResponse.json({});
  }
}
