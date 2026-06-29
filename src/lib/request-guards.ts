/**
 * Lightweight request-security helpers (SEC-1/SEC-2/SEC-3).
 *
 * Per-IP rate limiting uses an in-memory fixed window. This is MVP-appropriate:
 * the app runs as a single host (see CFG-2) and on Vercel Fluid Compute instances
 * are reused, so the counter survives across requests. For a true multi-instance
 * deployment, swap the Map for a shared store (Upstash/Vercel KV) or move the
 * limits to the Vercel WAF — the call sites do not change.
 *
 * Limits are deliberately generous: they are abuse ceilings, not throttles for
 * normal use. The data GET routes are hit once per followed team on page load, so
 * the ceiling must sit well above a heavy-but-legitimate burst.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** Best-effort client IP from proxy headers (first hop of x-forwarded-for). */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export interface RateLimitResult { ok: boolean; retryAfterSec: number; }

/**
 * Fixed-window per-key limiter. `key` is typically `${bucket}:${ip}`.
 * Returns ok=false with a Retry-After hint once `limit` is exceeded in `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  // Opportunistic sweep so the Map can't grow unbounded under many distinct IPs.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count++;
  return { ok: true, retryAfterSec: 0 };
}

/** Standard 429 response with a Retry-After header. */
export function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: 'Rate limit exceeded — please slow down.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  );
}

/**
 * Apply a rate limit to a request in one call. Returns a 429 NextResponse when the
 * limit is exceeded, or null to proceed.
 */
export function enforceRateLimit(
  req: NextRequest,
  bucket: string,
  limit: number,
  windowMs = 60_000,
): NextResponse | null {
  const { ok, retryAfterSec } = rateLimit(`${bucket}:${clientIp(req)}`, limit, windowMs);
  return ok ? null : tooManyRequests(retryAfterSec);
}

/**
 * Constant-time secret comparison (SEC-3). Returns false for any nullish input or
 * length mismatch before the timing-safe compare. Use for shared-secret headers
 * like CRON_SECRET instead of `===`.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
