/**
 * Server-side Supabase ADMIN client.
 *
 * Uses the service_role key to bypass RLS — only used server-side for aggregate
 * queries (e.g. reading all user_prefs rows to build the followed-teams set).
 *
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY to the client: it must not appear in any
 * NEXT_PUBLIC_ variable, and this module must never be imported from client code.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    _client = null;
    return null;
  }
  _client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _client;
}
