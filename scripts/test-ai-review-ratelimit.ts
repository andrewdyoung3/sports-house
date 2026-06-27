#!/usr/bin/env tsx
/**
 * SEC-2 regression test: the per-IP rate limit on /api/ai-review must NEVER apply to
 * a request bearing a valid CRON_SECRET — otherwise a generation burst from the
 * cron poller (poll-reviews → ai-review over loopback, all one IP) would get 429'd
 * and silently stop generating once it exceeds 30/min.
 *
 * Deterministic: no network, no Ollama, no Supabase. We unset the Supabase env so
 * the public path short-circuits to 503 before any network call, and use an invalid
 * league so the cron path short-circuits to 400 before reaching Ollama. The only
 * status that proves rate-limiting is 429.
 *
 * Run: npx tsx scripts/test-ai-review-ratelimit.ts
 */

// Read at call time by the route, so setting before the calls is sufficient.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
process.env.CRON_SECRET = 'unit-test-cron-secret';

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/ai-review/route';

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.error(`  ✗ ${name}`); failed++; }
}

async function call(headers: Record<string, string>, body: unknown): Promise<number> {
  const req = new NextRequest('http://localhost:3001/api/ai-review', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return (await POST(req)).status;
}

(async () => {
  // The route limit is 30/min/IP. Fire well past it.
  const BURST = 40;

  console.log('\n── valid CRON_SECRET is never rate-limited ─────────────────');
  const cronStatuses: number[] = [];
  for (let i = 0; i < BURST; i++) {
    cronStatuses.push(await call({ 'x-cron-secret': 'unit-test-cron-secret' }, { league: 'INVALID' }));
  }
  assert(`no 429 across ${BURST} valid-secret requests`, !cronStatuses.includes(429));
  assert('valid-secret requests reach handler logic (400 invalid league)', cronStatuses.every(s => s === 400));

  console.log('\n── public (no secret) limit still trips (control) ─────────');
  // Distinct IP so this bucket is independent of any other.
  const ip = { 'x-forwarded-for': '198.51.100.77' };
  const publicStatuses: number[] = [];
  for (let i = 0; i < 35; i++) {
    publicStatuses.push(await call(ip, { league: 'INVALID' }));
  }
  const first30 = publicStatuses.slice(0, 30);
  const after   = publicStatuses.slice(30);
  assert('first 30 public requests are not rate-limited', !first30.includes(429));
  assert('public requests are 429-limited past the ceiling', after.every(s => s === 429));

  console.log('\n── wrong secret is treated as public (limited) ────────────');
  const wrong = { 'x-cron-secret': 'WRONG', 'x-forwarded-for': '203.0.113.5' };
  let saw429 = false;
  for (let i = 0; i < 35; i++) {
    if (await call(wrong, { league: 'INVALID' }) === 429) { saw429 = true; break; }
  }
  assert('an INVALID secret does NOT bypass the limiter', saw429);

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
