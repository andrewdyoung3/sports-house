/**
 * review-store.ts — Supabase persistence for AI post-match reviews
 * (public.game_reviews, migration 0006). Mirrors the preview store in
 * preview-generator.ts: admin client writes, public-readable rows.
 *
 * Keyed by the result's PERSPECTIVE id (makeResultId in result-match-key.ts),
 * which is exactly the id the results page renders and asks /api/ai-review
 * for — so what the poller generates is what the page reads.
 */

import type { AIReview } from '@/types';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * Prompt-regime tag baked into every store key. Bump it when the prompt or
 * validators change enough that older reviews should be regenerated: rows are
 * keyed `<regime>:<perspective id>`, so a bump makes every existing row a miss
 * without a table sweep.
 *   v6: date-window-first finals classification (2026-09-13).
 *   v7: editorial register regime (2026-09-16) — crutch ban, overlap guard.
 *   v8: last data-cache generation.
 *   v9: Supabase-persisted, keyed by perspective id (2026-09-22).
 */
export const REVIEW_REGIME = 'v11'; // v11 (2026-09-25): one neutral generation per match, two verdicts, mirrored to both perspective keys
export const reviewStoreKey = (gameId: string): string => `${REVIEW_REGIME}:${gameId}`;

export interface StoredReview {
  payload: AIReview;
  updatedAt: string | undefined;
}

/** One review by perspective id, via the request-scoped (anon-capable) client. */
export async function readReview(gameId: string): Promise<StoredReview | null> {
  const sb = getSupabaseServer();
  if (!sb) return null;
  const { data, error } = await sb
    .from('game_reviews')
    .select('payload, updated_at')
    .eq('game_id', gameId)
    .maybeSingle();
  if (error || !data?.payload) return null;
  return { payload: data.payload as AIReview, updatedAt: data.updated_at as string | undefined };
}

/**
 * Which of these ids already have a review. Admin client — used by the poller
 * to skip work before it costs a minute of model time each.
 *
 * Returns null when the store cannot answer (admin client unconfigured, table
 * missing — migration 0006 not applied, network). Pre-generation into a store
 * that cannot hold the result is pure model time, so the poller treats null as
 * "stop", not as "nothing exists yet".
 */
export async function existingReviewIds(gameIds: string[]): Promise<Set<string> | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  if (gameIds.length === 0) return new Set();
  const { data, error } = await admin.from('game_reviews').select('game_id').in('game_id', gameIds);
  if (error) return null;
  return new Set((data ?? []).map(r => r.game_id as string));
}

export async function upsertReview(
  gameId: string,
  payload: AIReview,
  model: string,
  log: (msg: string) => void,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) { log('upsert-skip: admin client not configured'); return; }
  const { error } = await admin.from('game_reviews').upsert(
    { game_id: gameId, payload, model, updated_at: new Date().toISOString() },
    { onConflict: 'game_id' },
  );
  if (error) log(`upsert-fail gameId=${gameId} err=${error.message}`);
  else       log(`upsert-ok   gameId=${gameId} model=${model}`);
}
