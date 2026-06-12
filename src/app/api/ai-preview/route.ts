/**
 * POST /api/ai-preview
 *
 * Reads a pre-generated preview from Supabase and returns it. Returns
 * { preparing: true } on a miss so the client shows a graceful placeholder
 * while the standalone generator catches up.
 *
 * game_previews has SELECT using(true) + GRANT SELECT TO anon, so no session
 * is required. Auth state is logged for observability but never blocks the read.
 *
 * Generation is handled server-side by scripts/generate-previews.ts (Ollama →
 * Supabase). This route never calls Ollama directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { AIPreview } from '@/types';
import { getSupabaseServer } from '@/lib/supabase/server';
import { appendFileSync } from 'fs';

function aiLog(msg: string) {
  const line = `[${new Date().toISOString()}] [ai-preview] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

const NO_NEWLINES_RE = /[\n\r\0]/;

export async function POST(req: NextRequest) {
  const sb = getSupabaseServer();
  if (!sb) {
    aiLog('config-fail: supabase not configured');
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  // Log auth state for observability, but game_previews is publicly readable —
  // don't block on missing session so Vercel visitors without a cookie get previews.
  const { data: { user } } = await sb.auth.getUser();
  aiLog(user ? `auth-ok: uid=${user.id.slice(0, 8)}` : 'auth-none: reading as anon');

  try {
    const body   = await req.json() as { gameId?: string };
    const gameId = (body.gameId ?? '').trim();
    if (!gameId || gameId.length > 80 || NO_NEWLINES_RE.test(gameId)) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }

    const { data, error: dbError } = await sb
      .from('game_previews')
      .select('payload')
      .eq('game_id', gameId)
      .maybeSingle();

    if (!dbError && data?.payload) {
      aiLog(`supabase-hit gameId=${gameId}`);
      return NextResponse.json(data.payload as AIPreview);
    }
    aiLog(`supabase-miss gameId=${gameId}`);
    return NextResponse.json({ preparing: true });
  } catch {
    return NextResponse.json({ preparing: true });
  }
}
