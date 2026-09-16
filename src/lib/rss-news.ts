/**
 * RSS standfirst layer — free attributed editorial from outlet RSS feeds
 * (headline + first-paragraph standfirst), merged into the same FROM THE MEDIA
 * machinery the ESPN team-news headlines already flow through. The breadth
 * complement to the (keyed, full-text) Guardian Open Platform source: every
 * league gets attributed editorial with no API key at all.
 *
 * Feeds verified live 2026-09-16:
 *   ABC Sport (feed 45924)      — AFL / NRL / cricket / Australian sport
 *   BBC Sport football/rugby-union/rugby-league/cricket — EPL / SRU / RINT / NRL
 *   Sky Sports news (12040)     — EPL secondary (headline-only items)
 *
 * Team matching is deliberately conservative: the full team name always
 * matches; the nickname (last word) only when it is ≥4 chars and not in the
 * generic-word blocklist — league-wide feeds mean "Heat"/"Power"/"Blues" alone
 * would drag in the wrong sport's stories. Single-word international team
 * names ("Australia", "England") are only trusted on sport-scoped feeds
 * (BBC cricket / rugby), never on the all-sport ABC feed.
 */

import { fetchTimeout } from '@/lib/espn';
import type { NewsHeadline } from '@/types';

interface Feed {
  url: string;
  source: string;
  /** Sport-scoped feeds are safe for single-word (country) team names. */
  sportScoped: boolean;
}

const ABC_SPORT: Feed = { url: 'https://www.abc.net.au/news/feed/45924/rss.xml', source: 'ABC Sport', sportScoped: false };
const BBC_FOOTBALL: Feed = { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport', sportScoped: true };
const BBC_RUGBY_UNION: Feed = { url: 'https://feeds.bbci.co.uk/sport/rugby-union/rss.xml', source: 'BBC Sport', sportScoped: true };
const BBC_RUGBY_LEAGUE: Feed = { url: 'https://feeds.bbci.co.uk/sport/rugby-league/rss.xml', source: 'BBC Sport', sportScoped: true };
const BBC_CRICKET: Feed = { url: 'https://feeds.bbci.co.uk/sport/cricket/rss.xml', source: 'BBC Sport', sportScoped: true };
const SKY_NEWS: Feed = { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', sportScoped: false };

const LEAGUE_FEEDS: Record<string, Feed[]> = {
  afl:         [ABC_SPORT],
  nrl:         [ABC_SPORT, BBC_RUGBY_LEAGUE],
  epl:         [BBC_FOOTBALL, SKY_NEWS],
  super_rugby: [BBC_RUGBY_UNION, ABC_SPORT],
  rugby_int:   [BBC_RUGBY_UNION, ABC_SPORT],
  cricket_int: [BBC_CRICKET, ABC_SPORT],
  bbl:         [ABC_SPORT, BBC_CRICKET],
};

/** Nicknames too generic to match alone on a league-wide feed. */
const GENERIC_NICKNAMES = new Set([
  'heat', 'power', 'blues', 'reds', 'kings', 'stars', 'sixers', 'city',
  'united', 'giants', 'suns', 'wanderers', 'rovers', 'town', 'county',
]);

interface RssItem {
  title: string;
  description?: string;
  pubDate?: string;
}

const stripCdata = (s: string) =>
  s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').replace(/<[^>]+>/g, '').trim();

/** Minimal RSS item parser (title / description / pubDate; CDATA-aware). */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag: string) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return mm ? stripCdata(mm[1]) : undefined;
    };
    const title = pick('title');
    if (!title) continue;
    items.push({ title, description: pick('description') || undefined, pubDate: pick('pubDate') });
  }
  return items;
}

// In-process feed cache — feeds update slowly; 30 min TTL keeps us polite.
const feedCache = new Map<string, { at: number; items: RssItem[] }>();
const FEED_TTL_MS = 30 * 60_000;

async function fetchFeed(feed: Feed): Promise<RssItem[]> {
  const hit = feedCache.get(feed.url);
  if (hit && Date.now() - hit.at < FEED_TTL_MS) return hit.items;
  try {
    const res = await fetchTimeout(feed.url, {
      headers: { 'User-Agent': 'SportsHouseMVP/1.0' },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return hit?.items ?? [];
    const items = parseRssItems(await res.text());
    feedCache.set(feed.url, { at: Date.now(), items });
    return items;
  } catch {
    return hit?.items ?? [];
  }
}

/** Match tokens for one team name, per the conservative rules above. */
export function teamMatchTokens(teamName: string, sportScopedFeed: boolean): string[] {
  const name = teamName.trim();
  const words = name.split(/\s+/);
  if (words.length === 1) return sportScopedFeed ? [name] : [];
  const tokens = [name];
  const nick = words[words.length - 1];
  if (nick.length >= 4 && !GENERIC_NICKNAMES.has(nick.toLowerCase())) tokens.push(nick);
  return tokens;
}

const matchesTeam = (item: RssItem, tokens: string[]): boolean => {
  if (tokens.length === 0) return false;
  const text = `${item.title} ${item.description ?? ''}`;
  return tokens.some(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
};

const MAX_AGE_MS = 7 * 86400_000;
const fresh = (item: RssItem): boolean => {
  if (!item.pubDate) return true;
  const t = Date.parse(item.pubDate);
  return !Number.isFinite(t) || Date.now() - t < MAX_AGE_MS;
};

const toHeadline = (item: RssItem, source: string): NewsHeadline => ({
  headline: item.title,
  description: item.description,
  published: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
  source,
});

/**
 * Fetch RSS editorial for both fixture teams. Returns at most `cap` headlines
 * per side, newest feeds first. Fails soft (empty arrays) on any error —
 * this layer must never break preview generation.
 */
export async function fetchRssTeamNews(
  league: string,
  teamName: string,
  opponentName: string,
  cap = 2,
): Promise<{ team: NewsHeadline[]; opponent: NewsHeadline[] }> {
  const feeds = LEAGUE_FEEDS[league] ?? [];
  const team: NewsHeadline[] = [];
  const opponent: NewsHeadline[] = [];
  for (const feed of feeds) {
    if (team.length >= cap && opponent.length >= cap) break;
    const items = await fetchFeed(feed);
    const tTokens = teamMatchTokens(teamName, feed.sportScoped);
    const oTokens = teamMatchTokens(opponentName, feed.sportScoped);
    for (const item of items) {
      if (!fresh(item)) continue;
      if (team.length < cap && matchesTeam(item, tTokens)) team.push(toHeadline(item, feed.source));
      else if (opponent.length < cap && matchesTeam(item, oTokens)) opponent.push(toHeadline(item, feed.source));
    }
  }
  return { team, opponent };
}
