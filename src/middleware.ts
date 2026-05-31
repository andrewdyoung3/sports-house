import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Global session-refresh middleware (@supabase/ssr pattern).
 *
 * Its ONLY job is to keep an already-established auth cookie fresh on navigation
 * (and write the rotated tokens back via the response). It does not gate anything,
 * does not mint anonymous sessions, and adds no work to static assets — the matcher
 * below excludes them, so asset latency is unchanged.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every path EXCEPT:
     *  - _next/static, _next/image (build output / optimised images)
     *  - favicon.ico
     *  - any request ending in a static asset extension (svg/png/jpg/css/js/fonts…)
     * This keeps the middleware off the hot path for assets entirely.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|otf|map)$).*)',
  ],
};
