/**
 * GET /api/cron/poll-reviews
 *
 * Pre-generates AI post-match reviews for every result the results page would
 * show a followed team or competition, so the page (and the deployed site,
 * which cannot generate) reads them from Supabase instead of waiting a minute
 * on the model. Called every 60 s by scripts/poll-reviews.ts (launchd chain);
 * the shared generation lock keeps it polite.
 *
 * Discovery is deliberately NOT its own scan of Squiggle/ESPN. It asks
 * /api/results — the same endpoint, same perspective, same fields the page
 * renders — and keys each job with the same makeResultId the page uses. The
 * old poller kept a private copy of the team maps and keyed `afl-<squiggle id>`
 * from the home side, so nothing it generated was ever what the page asked for.
 *
 * Protected by x-cron-secret header — no Supabase session required.
 * Logs each job start/end to /tmp/sporthouse-ai.log for latency verification.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import type { GameResult } from '@/types';
import { TEAMS } from '@/lib/teams';
import { makeResultId } from '@/lib/result-match-key';
import { existingReviewIds, reviewStoreKey } from '@/lib/review-store';
import { getDistinctFollowed, followsNothing } from '@/lib/followed-teams-server';
import { acquireLock, refreshLock, releaseLock } from '@/lib/generation-lock';
import { secretsMatch } from '@/lib/request-guards';

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [poll-reviews] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

// SEC-3: the cron secret is forwarded on the self-call to /api/ai-review. Never send
// it to a non-loopback, non-https origin — a misconfigured NEXT_PUBLIC_SITE_URL would
// otherwise exfiltrate it. Fall back to loopback (safe) if BASE looks unsafe.
function resolveSafeBase(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001';
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(raw);
  if (isLoopback || raw.startsWith('https://')) return raw;
  console.error(`[poll-reviews] refusing unsafe BASE "${raw}" — falling back to loopback`);
  return 'http://localhost:3001';
}

const BASE = resolveSafeBase();

/** Leagues the results panel requests a review for (result-expand-panel REAL_DATA_LEAGUES). */
const REVIEW_LEAGUES = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);

/**
 * How far back a result still gets a review. The page shows each team's last
 * five results, so this is a backfill horizon, not a "just finished" window:
 * eight days is the previous round in every league (AFL Thu–Sun, EPL Sat–Mon,
 * a Test window) so a fresh box, or one that was asleep over a weekend,
 * catches up. Already-stored ids are skipped before any model time is spent,
 * so the horizon costs one Supabase `in` query per poll, not regenerations.
 */
const LOOKBACK_MS = 8 * 24 * 3600 * 1000;

interface ReviewJob {
  gameId: string;
  sourceId?: string;
  league: string;
  teamId: string;
  teamName: string;
  opponent: string;
  opponentId?: string;
  teamScore: number;
  opponentScore: number;
  isHome: boolean;
  date: string;
  competition?: string;
}

async function fetchResults(query: string): Promise<Array<GameResult & { teamId?: string }>> {
  try {
    const res = await fetch(`${BASE}/api/results?${query}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    log(`results-fail ${query} err=${e}`);
    return [];
  }
}

function toJob(teamId: string, r: GameResult): ReviewJob | null {
  const team = TEAMS.find(t => t.id === teamId);
  if (!team || !REVIEW_LEAGUES.has(team.league)) return null;
  return {
    gameId:        makeResultId(teamId, r),
    sourceId:      r.sourceId,
    league:        team.league,
    teamId,
    teamName:      team.name,
    opponent:      r.opponent,
    opponentId:    r.opponentId,
    teamScore:     r.teamScore,
    opponentScore: r.opponentScore,
    isHome:        r.isHome,
    date:          r.date,
    competition:   r.competition,
  };
}

/**
 * Every result row the page would render for these follows, from the side it
 * renders it: a followed TEAM's results from that team's perspective, a
 * followed COMPETITION's round from the home side (what scope=league returns).
 * A team followed both ways is deduped by id, team perspective first — the
 * same precedence the page's merge applies.
 */
async function discoverJobs(teamIds: Set<string>, leagueIds: Set<string>): Promise<ReviewJob[]> {
  const cutoff = Date.now() - LOOKBACK_MS;
  const jobs = new Map<string, ReviewJob>();
  const add = (teamId: string | undefined, r: GameResult) => {
    if (!teamId || new Date(r.date).getTime() < cutoff) return;
    const job = toJob(teamId, r);
    if (job && !jobs.has(job.gameId)) jobs.set(job.gameId, job);
  };

  const teams = TEAMS.filter(t => teamIds.has(t.id) && REVIEW_LEAGUES.has(t.league));
  const teamRows = await Promise.all(
    teams.map(async t => ({ id: t.id, rows: await fetchResults(`league=${t.league}&teamId=${t.id}`) })),
  );
  for (const { id, rows } of teamRows) for (const r of rows) add(id, r);

  const leagues = Array.from(leagueIds).filter(l => REVIEW_LEAGUES.has(l));
  const leagueRows = await Promise.all(leagues.map(l => fetchResults(`league=${l}&scope=league`)));
  for (const rows of leagueRows) for (const r of rows) add(r.teamId, r);

  return Array.from(jobs.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ── POST one review job ────────────────────────────────────────────────────────

async function postReview(job: ReviewJob, secret: string): Promise<'ok' | 'cached' | 'error'> {
  const t0 = Date.now();
  log(`start gameId=${job.gameId} ${job.teamName} vs ${job.opponent}`);
  try {
    const res = await fetch(`${BASE}/api/ai-review`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
      body:    JSON.stringify(job),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      log(`error gameId=${job.gameId} status=${res.status} elapsed=${elapsed}ms`);
      return 'error';
    }
    // A store hit answers in well under 2 s; generation takes a minute or more.
    const outcome = elapsed < 2000 ? 'cached' : 'ok';
    log(`${outcome} gameId=${job.gameId} elapsed=${elapsed}ms`);
    return outcome;
  } catch (e) {
    log(`error gameId=${job.gameId} err=${e} elapsed=${Date.now() - t0}ms`);
    return 'error';
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!secretsMatch(req.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!acquireLock()) {
    log('generation already in progress — skipping this run');
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock held' });
  }

  log('poll start');
  const t0 = Date.now();

  try {
    const followed = await getDistinctFollowed();
    if (followsNothing(followed)) {
      // Unlike previews there is no "everything" to fall open to: a review is
      // per followed perspective, and with no follows there are none.
      log('no follows (or admin client unconfigured) — nothing to review');
      return NextResponse.json({ ok: true, gamesFound: 0, gamesProcessed: 0, generated: 0, cached: 0, errors: 0 });
    }

    const jobs = await discoverJobs(followed.teamIds, followed.leagueIds);
    const done = await existingReviewIds(jobs.map(j => reviewStoreKey(j.gameId)));
    if (!done) {
      // Nothing generated here could be kept, and the same jobs would come
      // back next minute: that is the model running flat out for no one.
      log(`found ${jobs.length} results in window but the review store is unavailable (admin client / game_reviews table, migration 0006) — not generating`);
      return NextResponse.json({ ok: false, error: 'review store unavailable', gamesFound: jobs.length, gamesProcessed: 0 });
    }
    const pending = jobs.filter(j => !done.has(reviewStoreKey(j.gameId)));
    log(`found ${jobs.length} results in window, ${pending.length} without a review`);

    const counts = { generated: 0, cached: 0, errors: 0 };
    const cronSecret = process.env.CRON_SECRET ?? '';
    for (const job of pending) {
      refreshLock(); // a long run must not look stale to the next tick
      const outcome = await postReview(job, cronSecret);
      if (outcome === 'ok')     counts.generated++;
      if (outcome === 'cached') counts.cached++;
      if (outcome === 'error')  counts.errors++;
    }

    const elapsed = Date.now() - t0;
    log(`poll done elapsed=${elapsed}ms generated=${counts.generated} cached=${counts.cached} errors=${counts.errors}`);

    return NextResponse.json({
      ok: true,
      timestamp:      new Date().toISOString(),
      gamesFound:     jobs.length,
      gamesProcessed: pending.length,
      gamesSkipped:   jobs.length - pending.length,
      ...counts,
      elapsedMs:      elapsed,
    });
  } finally {
    releaseLock();
  }
}
