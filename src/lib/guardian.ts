/**
 * Guardian Open Platform — the keyed full-text layer of the media stack
 * (the RSS standfirst layer in rss-news.ts is the keyless breadth layer).
 *
 * The Guardian is the only major outlet with a free full-text API, so this is
 * where PRESS ANALYSIS excerpts come from: headline + byline + standfirst +
 * a short body excerpt per article, rendered inside the FROM THE MEDIA block
 * (attributed editorial; the system prompt requires paraphrase-with-attribution
 * and the whitelist machinery already collects names from that block).
 *
 * Free developer tier: 500 calls/day, 1/sec — every query is cached in-process
 * for 30 minutes and the layer is skipped entirely without GUARDIAN_API_KEY.
 * The key travels only in the request URL and is never logged.
 */

import { fetchTimeout } from '@/lib/espn';

export interface GuardianNote {
  headline: string;
  byline?: string;
  standfirst?: string;
  /** First sentences of the article body, clipped ≤320 chars. */
  excerpt?: string;
  published?: string;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** First ~2 sentences of a body text, clipped to `max` chars at a boundary. */
export function excerptFromBody(body: string | undefined, max = 320): string | undefined {
  if (!body) return undefined;
  const text = strip(body);
  if (!text) return undefined;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [text];
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > max) break;
    out += s;
    if (out.length >= max * 0.6 && out.trim().length > 0) break;
  }
  out = out.trim();
  if (out.length > max) out = out.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return out || undefined;
}

/** Parse a Guardian search response into notes (pure — unit-testable). */
export function parseGuardianResults(json: unknown): GuardianNote[] {
  const results = (json as { response?: { results?: unknown[] } })?.response?.results;
  if (!Array.isArray(results)) return [];
  const notes: GuardianNote[] = [];
  for (const r of results as Array<Record<string, unknown>>) {
    const fields = (r.fields ?? {}) as Record<string, string>;
    const headline = strip(String(fields.headline ?? r.webTitle ?? ''));
    if (!headline) continue;
    notes.push({
      headline,
      byline: fields.byline ? strip(fields.byline) : undefined,
      standfirst: fields.standfirst ? strip(fields.standfirst) : undefined,
      excerpt: excerptFromBody(fields.bodyText),
      published: typeof r.webPublicationDate === 'string' ? r.webPublicationDate : undefined,
    });
  }
  return notes;
}

const queryCache = new Map<string, { at: number; notes: GuardianNote[] }>();
const CACHE_TTL_MS = 30 * 60_000;
const MAX_AGE_MS = 10 * 86400_000;

async function guardianSearch(query: string): Promise<GuardianNote[]> {
  const key = process.env.GUARDIAN_API_KEY;
  if (!key) return [];
  const hit = queryCache.get(query);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.notes;
  try {
    const fromDate = new Date(Date.now() - MAX_AGE_MS).toISOString().slice(0, 10);
    const url = 'https://content.guardianapis.com/search'
      + `?q=${encodeURIComponent(query)}`
      // Full-text search surfaces liveblogs that mention a team incidentally —
      // constrain matching to headline/standfirst and to standard articles,
      // and enforce freshness server-side (result ordering is not reliable).
      + '&query-fields=headline,standfirst&type=article'
      + `&from-date=${fromDate}`
      // NB: the Guardian files football under its own "football" section —
      // "sport" EXCLUDES it. The pipe is a section OR.
      + '&section=football%7Csport&order-by=newest&page-size=5'
      + '&show-fields=headline,byline,standfirst,bodyText'
      + `&api-key=${encodeURIComponent(key)}`;
    const res = await fetchTimeout(url, { next: { revalidate: 1800 } });
    if (!res.ok) return hit?.notes ?? [];
    const notes = parseGuardianResults(await res.json()).filter(n => {
      if (!n.published) return true;
      const t = Date.parse(n.published);
      return !Number.isFinite(t) || Date.now() - t < MAX_AGE_MS;
    });
    queryCache.set(query, { at: Date.now(), notes });
    return notes;
  } catch {
    return hit?.notes ?? [];
  }
}

/**
 * Press analysis for both fixture teams: up to `cap` recent sport-section
 * articles per side. Quoted-phrase search keeps relevance high; a team whose
 * name yields nothing simply gets no lines (absent data goes unmentioned).
 */
export async function fetchGuardianAnalysis(
  teamName: string,
  opponentName: string,
  cap = 2,
): Promise<{ team: GuardianNote[]; opponent: GuardianNote[] }> {
  if (!process.env.GUARDIAN_API_KEY) return { team: [], opponent: [] };
  const [team, opponent] = await Promise.all([
    guardianSearch(`"${teamName}"`),
    guardianSearch(`"${opponentName}"`),
  ]);
  // Belt and braces: the team must actually be named in headline or standfirst.
  const relevant = (notes: GuardianNote[], name: string) => {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return notes.filter(n => re.test(`${n.headline} ${n.standfirst ?? ''}`)).slice(0, cap);
  };
  return { team: relevant(team, teamName), opponent: relevant(opponent, opponentName) };
}
