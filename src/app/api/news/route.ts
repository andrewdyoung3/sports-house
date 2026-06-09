/**
 * GET /api/news?league=nrl&teamId=nrl-broncos
 *
 * Returns recent team news as NewsItem[] for real-data leagues.
 * NRL  → ESPN rugby-league/3 team news
 * EPL  → ESPN soccer/eng.1 team news
 * SRU  → ESPN rugby/242041 team news
 * AFL  → returns [] (no free news source)
 *
 * Converts ESPN article shape to our NewsItem type.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { NewsItem } from '@/types';
import { fetchTimeout } from '@/lib/espn';

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' };

function detectCategory(headline: string): NewsItem['category'] {
  const h = headline.toLowerCase();
  if (/injur|ruled out|out for|hamstring|knee|ankle|shoulder|concuss/.test(h)) return 'injury';
  if (/transfer|sign|deal|contract|join|depart|leave|recruit/.test(h)) return 'trade';
  if (/preview|how to watch|who wins|tips|match guide/.test(h)) return 'preview';
  if (/recap|report|highlights|result|final|win|beat|defeat|loss|draw|review/.test(h)) return 'recap';
  return 'general';
}

function parseArticles(articles: any[], teamId: string): NewsItem[] {
  return articles.slice(0, 4).map((a: any, i: number): NewsItem => ({
    id:          a.id?.toString() ?? `${teamId}-news-${i}`,
    title:       a.headline ?? '',
    summary:     a.description ?? a.story?.slice(0, 120) ?? '',
    source:      'ESPN',
    publishedAt: a.published ?? new Date().toISOString(),
    url:         a.links?.web?.href ?? a.link ?? '',
    category:    detectCategory(a.headline ?? ''),
  })).filter(n => n.title && n.url);
}

// ─── NRL ─────────────────────────────────────────────────────────────────────

const NRL_ESPN_ID: Record<string, string> = {
  'nrl-broncos':   '289195',
  'nrl-raiders':   '289198',
  'nrl-bulldogs':  '289197',
  'nrl-sharks':    '289203',
  'nrl-dolphins':  '289346',
  'nrl-titans':    '289206',
  'nrl-eels':      '289194',
  'nrl-panthers':  '289199',
  'nrl-seahawks':  '289196',
  'nrl-storm':     '289208',
  'nrl-knights':   '289207',
  'nrl-warriors':  '289201',
  'nrl-cowboys':   '289202',
  'nrl-rabbitohs': '289205',
  'nrl-dragons':   '289209',
  'nrl-roosters':  '289204',
  'nrl-tigers':    '289200',
};

async function fetchNRLNews(teamId: string): Promise<NewsItem[]> {
  const espnId = NRL_ESPN_ID[teamId];
  if (!espnId) return [];
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/teams/${espnId}/news?limit=4`,
    { next: { revalidate: 1800 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return parseArticles(data.articles ?? [], teamId);
}

// ─── EPL ─────────────────────────────────────────────────────────────────────

const EPL_ESPN_ID: Record<string, string> = {
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

async function fetchEPLNews(teamId: string): Promise<NewsItem[]> {
  const espnId = EPL_ESPN_ID[teamId];
  if (!espnId) return [];
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/${espnId}/news?limit=4`,
    { next: { revalidate: 1800 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return parseArticles(data.articles ?? [], teamId);
}

// ─── Super Rugby ──────────────────────────────────────────────────────────────

/** ESPN numeric team IDs — extracted from logo CDN URLs (verified March 2026). */
const SRU_ESPN_ID: Record<string, string> = {
  'sru-brumbies':    '25889',
  'sru-reds':        '182',
  'sru-waratahs':    '227',
  'sru-force':       '25893',
  'sru-blues':       '25932',
  'sru-chiefs':      '25934',
  'sru-crusaders':   '25936',
  'sru-highlanders': '25938',
  'sru-hurricanes':  '25939',
  'sru-drua':        '289338',
  'sru-moana':       '289319',
};

async function fetchSRUNews(teamId: string): Promise<NewsItem[]> {
  const espnId = SRU_ESPN_ID[teamId];
  if (!espnId) return [];
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby/242041/teams/${espnId}/news?limit=4`,
    { next: { revalidate: 1800 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return parseArticles(data.articles ?? [], teamId);
}

// ─── International Rugby ──────────────────────────────────────────────────────

/** ESPN numeric team IDs — verified from ESPN rugby teams endpoints (March 2026). */
const RINT_ESPN_ID_N: Record<string, string> = {
  'rint-wallabies': '6',
  'rint-allblacks': '8',
  'rint-boks':      '5',
  'rint-england':   '1',
  'rint-ireland':   '3',
  'rint-france':    '9',
  'rint-scotland':  '2',
  'rint-wales':     '4',
  'rint-argentina': '10',
  'rint-fiji':      '14',
  'rint-samoa':     '15',
  'rint-tonga':     '16',
};

/** Which ESPN competition endpoint to query for each team's news. */
const RINT_NEWS_COMP: Record<string, string> = {
  'rint-wallabies': '244293', // Rugby Championship
  'rint-allblacks': '244293',
  'rint-boks':      '244293',
  'rint-argentina': '244293',
  'rint-england':   '180659', // Six Nations
  'rint-ireland':   '180659',
  'rint-france':    '180659',
  'rint-scotland':  '180659',
  'rint-wales':     '180659',
  'rint-fiji':      '289234', // International Tests
  'rint-samoa':     '289234',
  'rint-tonga':     '289234',
};

async function fetchRINTNews(teamId: string): Promise<NewsItem[]> {
  const espnId = RINT_ESPN_ID_N[teamId];
  const compId = RINT_NEWS_COMP[teamId] ?? '289234';
  if (!espnId) return [];
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby/${compId}/teams/${espnId}/news?limit=4`,
    { next: { revalidate: 1800 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return parseArticles(data.articles ?? [], teamId);
}

// ─── World Cup ────────────────────────────────────────────────────────────────
//
// ESPN's team-specific news endpoint requires a numeric team ID. Rather than
// hard-coding IDs that may change, we fetch the competition-level WC news feed
// (max 6 items). All WC teams share this feed since it covers the tournament.

async function fetchWorldCupNews(teamId: string): Promise<NewsItem[]> {
  const res = await fetchTimeout(
    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/news?limit=6',
    { next: { revalidate: 1800 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return parseArticles(data.articles ?? [], teamId);
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED = new Set(['nrl', 'epl', 'super_rugby', 'rugby_int', 'world_cup']);
const TEAMID_RE = /^[a-z]+-[a-z0-9-]+$/;

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  const teamId = req.nextUrl.searchParams.get('teamId') ?? '';

  if (!ALLOWED.has(league) || !TEAMID_RE.test(teamId)) {
    return NextResponse.json([]);
  }

  try {
    let news: NewsItem[] = [];
    if      (league === 'nrl')         news = await fetchNRLNews(teamId);
    else if (league === 'epl')         news = await fetchEPLNews(teamId);
    else if (league === 'super_rugby') news = await fetchSRUNews(teamId);
    else if (league === 'rugby_int')   news = await fetchRINTNews(teamId);
    else if (league === 'world_cup')   news = await fetchWorldCupNews(teamId);
    return NextResponse.json(news, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[/api/news]', err);
    return NextResponse.json([]);
  }
}
