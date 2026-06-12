/**
 * POST /api/warm-team
 * Body: { teamId: string; league: string }
 *
 * Enqueues a preview_jobs row for the newly-followed team so the Mac-side
 * poll-jobs poller picks it up within ~1 minute instead of waiting for the
 * next hourly heartbeat.
 *
 * Returns 202 immediately; the enqueue is best-effort. If it fails (Supabase
 * not configured, network error) we log and swallow — the hourly heartbeat is
 * the backstop and the follow itself must never be broken.
 *
 * Requires a valid Supabase session (anonymous sessions are fine) to prevent
 * open abuse. The service-role insert bypasses RLS; the browser client never
 * writes preview_jobs directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  // ── Auth gate ───────────────────────────────────────────────────────────────
  const sb = getSupabaseServer();
  if (sb) {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let teamId: string;
  try {
    const body = await req.json() as { teamId?: unknown; league?: unknown };
    if (typeof body.teamId !== 'string') {
      return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    }
    teamId = body.teamId;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Enqueue (best-effort) ────────────────────────────────────────────────────
  // Insert a pending job. The partial unique index on (team_id) where status =
  // 'pending' prevents duplicate queuing for the same team — on conflict do nothing.
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      // Insert with throwOnError so constraint violations surface as exceptions.
      // The partial unique index on (team_id) where status='pending' throws 23505
      // for duplicate follows — that's expected and swallowed below.
      await admin
        .from('preview_jobs')
        .insert({ team_id: teamId, status: 'pending' })
        .throwOnError();
    }
  } catch (err) {
    // Best-effort: log and swallow. The hourly heartbeat is the backstop.
    // 23505 = unique_violation (duplicate pending for same team) — expected, silent.
    const code = (err as any)?.code ?? (err as any)?.details?.code;
    if (code !== '23505') {
      console.error('[warm-team] enqueue error', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, status: 'queued' }, { status: 202 });
}
