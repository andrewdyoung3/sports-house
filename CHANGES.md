# SportHouse — Audit Execution Changes

**Date:** 2026-06-27
**Branch:** `audit/execution-pass` (19 commits, branched from `main`)
**Source plan:** `AUDIT.md` §3 action plan + the execution prompt's waves.

This pass executed the audit's prioritized fixes while preserving preview faithfulness and app smoothness. Every change kept `tsc --noEmit`, `npm test`, `npm run build`, and `npm run lint` (0 errors) green. Where a recommendation proved unhelpful or risky on inspection, I deviated and documented why — see **Deviations** and **Deferred**.

---

## 1. What changed (by wave)

### Wave 0 — Test gate first (TEST-1, TEST-2)
- Added an `npm test` target wiring the existing exit-coded assertion scripts: `test:validators`, `test:structure`, `test:lifecycle`, `test:espn` (new), `test:team-coverage`. Network/Ollama scripts stay out of the default target (`test:integration` holds the live-server `verify-sandbox-faithful`).
- Added `.github/workflows/ci.yml` (lint + `tsc` + build + test on push/PR).
- **Surfaced + fixed 5 pre-existing failures** in `test-competition-structure.ts`: the fixtures encoded the obsolete 2025 structure (8 AFL finals teams / 4 EPL CL spots) while `COMP_RULES` is correct for 2026 (10 finals via the Wildcard Round; 5 CL spots). The **implementation was right**; the stale fixtures were rebuilt to the 2026 structure (and a fixture name collision `Adelaide`↔`Port Adelaide` fixed). No production code changed.

### Wave 1 — Correctness & safety
- **REL-1** *(highest-value)* — Previews that still fail the validators after the retry are **no longer stored**. `collectViolations()` is now the single validator source; `callOllamaValidated()` surfaces remaining violations; `generateAndStorePreview` refuses to upsert and returns `ok:false` (poller retries, then marks the job `failed`). Validators are unchanged — only their result is no longer discarded at the storage boundary.
- **COR-1** — Standings `position` now derives from ESPN's `rank` stat (sorted by it), not array order, across NRL/EPL/SRU tables and the cup/RINT/NBA/NHL per-team standings. New `scripts/test-espn-standings.ts` proves out-of-order feeds yield correct positions.
- **SEC-1 / SEC-2** — New `src/lib/request-guards.ts` (in-memory per-IP limiter + timing-safe `secretsMatch`). `/api/ai-review` rate-limited (30/min/IP), **fails closed (503)** when Supabase is unconfigured, and gains an optional `REQUIRE_AUTH_FOR_AI_REVIEW` flag. `/api/sandbox/generate` (20/min), `/api/results` and `/api/fixtures` (300/min abuse ceiling).
- **DEP-1 (non-breaking)** — `npm audit fix` cleared the picomatch ReDoS (10→5 vulns); `eslint-config-next` aligned to 14.2.35. (Next is already on the latest 14.2.x; the remaining 5 advisories need next@16 — deferred.)
- **REL-2 / REL-3** — Transient upstream failures no longer poison process caches (`cricketdata.cricCurrentMatches` only caches success + 60s negative-cache; `preview-context.cachedRichContext` no longer caches `{}` on throw). Added `console.warn` to previously-silent external-parse catches.

### Wave 2 — Data integrity & reliability
- **DAT-1** — `supabase/migrations/0004_game_previews_monotonic_guard.sql`: a `BEFORE UPDATE` trigger skips any write whose `updated_at` is not strictly newer, so an older/concurrent generation can't clobber a fresher row (regardless of host). **Must be applied** (see §3).
- **DAT-2** — `poll-jobs` stale-reclaim window 10→20 min (was *shorter* than the 15-min Ollama timeout → double-generation); added a 7-day purge of terminal job rows.
- **DAT-3** — `news_fingerprint` is now persisted (headlines + injuries + squad) instead of `null`; the staleness **regen trigger stays deferred** (a product decision).
- **REL-4** — `check-team-coverage` now asserts every World Cup id round-trips through both ESPN name maps and has a group letter; runtime warn when a WC fixture yields an empty group table.
- **SEC-3** — Timing-safe `CRON_SECRET` checks in `ai-review` + `poll-reviews`; the cron self-call `BASE` is pinned to loopback/https so a misconfigured `NEXT_PUBLIC_SITE_URL` can't leak the secret off-host.

### Wave 3 — UX / accessibility + performance
- **COR-2** — DST-aware Sydney kickoff times: `aestDisplay` computes the real offset (AEST/AEDT) instead of a fixed `+10h`; fixes BBL/NRL/SRU/cricket summer times.
- **UX-4** — Onboarding chips, dashboard sidebar badge, and the hero countdown pill route team-color text through the existing `contrastColor()` (light-branded teams were unreadable).
- **UX-3** — `ErrorState` component + `app/{schedule,dashboard,results}/error.tsx` boundaries; `TeamFeedCard` shows a "Couldn't load — Retry" row when all feeds fail (vs. looking empty).
- **UX-5 / UX-6** — Navbar logo + icon-only mobile links and the onboarding search input get `aria-label`s; the past-day calendar click uses `router.push` (SPA) with a new hash-scroll effect on the results page (replacing a full reload).
- **UX-1 / UX-2 (partial)** — Fixture rows expose `aria-controls` → their panel `role="region"`; the mobile calendar sheet is now `role="dialog" aria-modal` with Escape-to-close and focus move/restore. (Full `<button>` row restructure + Tab focus-trap deferred — see Deferred.)
- **PERF-1** — Lazy-loaded the ~1,800-line expand panel (and `WcGroupBrowser`) from the schedule page **and both heroes** (the heroes' static import was defeating the split). Schedule First Load JS **162 → 153 kB**.
- **PERF-2** — `ScheduleRow` memoized with a stable `onToggle(id)`, so a hover/glow change re-renders only the affected row, not the whole list.
- **PERF-4** — 30-min TTL on the process-global preview-context caches (`_wcRaw` etc. never expired on long-running servers).

### Wave 4 — The one refactor (CQ-2 / TEST-3) + lint
- **CQ-2 / TEST-3** — New `src/lib/espn-standings.ts` centralizes the ~13 copy-pasted ESPN entries-walks (`espnEntries`) and the rank logic (`entryRank`/`sortByEntryRank`), typed with a minimal `EspnStandingsEntry` interface (**CQ-4** at the boundary). Both `preview-fetchers.ts` and `api/standings/route.ts` import it — and the **display ladder now gets COR-1 too** (position from rank, sorted), so generation and display can't drift. Tests extended for `espnEntries`.
- **CQ-5 / CFG-3** — Investigated all 3 `react-hooks/exhaustive-deps` warnings: 2 are deliberate ref+version recompute triggers, 1 is a deliberate fetch-once-per-fixture effect — mechanically "fixing" them would have caused re-fetch loops / broken cache refresh, so they're documented + suppressed; the one genuine issue (`ResultsCalendar` render-created `now`) was fixed properly. ESLint now extends `next/typescript` with `no-explicit-any` / `no-unused-vars` as **warnings** (surfaces 441 warnings of type debt without failing lint).

### Wave 5 — Hygiene + hardening
- **COR-4** — Removed 10 grep-verified dead exports (kept the do-not-remove list; `clearPreviewContextCache` retained — now used by PERF-4).
- **SEC-6** — Deleted the local `.env.local.save` secret backup; broadened `.gitignore` to `.env.*` (keeping `*.example`).
- **CFG-1** — `.env.local.example` completed (`CRICKETDATA_API_KEY`, `REQUIRE_AUTH_FOR_AI_REVIEW`, `NEXT_PUBLIC_SITE_URL`, `SANDBOX_BASE`, `EVAL_SAMPLES`; clarified `openai` = Ollama transport).
- **DEP-2** — `@anthropic-ai/sdk` moved to `devDependencies` (only the eval harness uses it).
- **COR-3** — `mapEspnGame` infers a draw from an equal score line when ESPN reports only W/L.
- **SEC-4** — `sanitizeFeedText()` strips control chars / neutralizes prompt-injection markers in news headlines before prompt assembly (inside `buildDataBlock`, so the sandbox twin stays consistent).
- **SEC-5** — `encodeURIComponent` on the cricket match/series id in CricAPI calls.

---

## 2. Verification

Run after every change; final state on `audit/execution-pass`:

| Check | Command | Result |
|-------|---------|--------|
| Type-check | `npx tsc --noEmit` | ✅ clean |
| Tests | `npm test` (validators, structure, lifecycle, espn, team-coverage) | ✅ all pass |
| Build | `npm run build` | ✅ succeeds |
| Lint | `npm run lint` | ✅ 0 errors (441 warnings — intentional `any`/unused-var debt surfaced by CFG-3) |
| Dep audit | `npm audit` | 10 → 5 (remaining are next@16-only) |

**Faithfulness invariant — upheld.** All context changes live in the shared builders (`buildPreviewContext`, `buildDataBlock`, `espn-standings`); no parallel path was introduced. The sandbox's `buildBlocks` derives its blocks by diffing `buildDataBlock` output, so the SEC-4 sanitization and COR-1 changes flow into both prod and sandbox automatically. **`scripts/verify-sandbox-faithful.ts` could not be run here** (it needs a live dev server + network to ESPN); it should be run once in that environment before shipping. The invariant holds by construction, not just by test.

---

## 3. Behavior changes & migration notes

1. **DB migration required (DAT-1):** apply `supabase/migrations/0004_game_previews_monotonic_guard.sql` in the Supabase SQL editor (same as 0001–0003). Without it, nothing breaks — you just don't get the concurrent-write guard.
2. **New env vars (all optional unless noted):**
   - `CRICKETDATA_API_KEY` — **required for cricket** (already needed; now documented).
   - `REQUIRE_AUTH_FOR_AI_REVIEW` — default off; set `true` to require a signed-in (non-anonymous) session for `/api/ai-review`.
   - `NEXT_PUBLIC_SITE_URL` — in production must be `https://…` (or loopback) or the cron self-call falls back to loopback (SEC-3).
3. **`/api/ai-review` now fails closed (503)** if Supabase env is unset (previously 401). Rate limits (429) now apply to `ai-review`/`results`/`fixtures`/`sandbox-generate` — generous ceilings tuned not to affect normal use; for multi-instance deployments move the limiter to Upstash/Vercel WAF (call sites unchanged).
4. **Fewer-but-cleaner previews:** REL-1 means a fixture whose generation persistently violates the validators now gets **no stored preview** (retried later) instead of a wrong one. This is intentional (accuracy > coverage) but is a visible behavior change worth monitoring.
5. **Kickoff times** for summer (AEDT) fixtures now display correctly (1h later than before). Stored UTC dates unchanged.
6. **Brief "Loading…"** on the *first* expand of a fixture/hero per session (PERF-1 lazy chunk).

---

## 3a. Post-pass review (3 follow-up checks)

1. **Rate limiter vs internal generation (SEC-2) — verified, no fix needed, test added.**
   The cron poller forwards `CRON_SECRET` to `/api/ai-review` over loopback (one IP) to
   drive generation. The per-IP limiter sits *inside* `if (!isCron)`, and `isCron` is the
   timing-safe `secretsMatch(x-cron-secret, CRON_SECRET)` check that runs first — so a
   valid-secret request bypasses the limiter (and auth) entirely and a generation burst is
   never 429'd. New `scripts/test-ai-review-ratelimit.ts` (wired into `npm test` as
   `test:ratelimit`) asserts: 40 valid-secret requests never return 429; the public
   (no-secret) path is 429-limited past the 30/min ceiling; and an *invalid* secret does
   NOT bypass the limiter. The public, no-secret limit is unchanged.

2. **DAT-1 trigger correctness — verified.**
   `upsertPreview` sets `updated_at: new Date().toISOString()` explicitly on **every**
   write, so the trigger's `new.updated_at <= old.updated_at` comparison is always
   meaningful and a legitimately newer write (strictly greater timestamp) is never
   dropped. The trigger is `BEFORE UPDATE … FOR EACH ROW` only, so the first `INSERT` of a
   `game_id` (no conflict) never fires it and always succeeds; the guard applies only to
   the `ON CONFLICT DO UPDATE` path. **By design, a guard-skipped write is silent**
   (`RETURN NULL` cancels just that row's update; the statement still reports success and
   `upsertPreview` logs `upsert-ok`) — an older/concurrent generation is dropped without
   error, which is the intended last-writer-loses-if-older behavior. The only theoretical
   drop of a "newer" write is two writes within the same millisecond (`new == old` →
   skipped); content would be near-identical and this is acceptable.

3. **Rate-limiter IP source — best-effort by design (single-host MVP), no code change.**
   `clientIp` reads the first hop of `x-forwarded-for` (then `x-real-ip`, then
   `'unknown'`). The first hop is client-spoofable behind an arbitrary proxy; on Vercel the
   platform prepends the real client IP so the leftmost entry is trustworthy. Consistent
   with the single-host/MVP stance and the limiter's documented role as an abuse ceiling
   (not a security boundary), this is left as best-effort. For a multi-instance or
   untrusted-proxy deployment, move rate limiting to the Vercel WAF (which derives the IP
   trustworthily) or read the correct hop for that proxy depth — the call sites don't
   change.

## 4. Needs a decision (the 7 open questions — defaults applied)

| # | Question | Default applied | What a human must confirm |
|---|----------|-----------------|---------------------------|
| 1 | Hosting model | Assumed single-host MVP; still added the DAT-1 guard (low-risk). | Whether to move generation to a cloud cron / hosted model. |
| 2 | LLM provider | Kept Ollama-via-`openai`; demoted `@anthropic-ai/sdk` to dev. | Long-term provider (local Ollama vs hosted/AI Gateway). |
| 3 | Auth (SEC-1) | App stays public (anonymous allowed); rate-limit unconditional; `REQUIRE_AUTH_FOR_AI_REVIEW` flag (default off). | Whether `/api/ai-review` should require real accounts. |
| 4 | F1 2025 vs 2026 | **Untouched** — flagged only. `f1-data.ts` is the 2025 grid and the fixture fallback hard-codes 2025 while the prompt asserts 2026. | Whether a 2026 data refresh is pending or 2025 is intentional. |
| 5 | Staleness / `news_fingerprint` | Persisted the fingerprint only; **regen trigger deferred**. | Acceptable staleness window before adding a news-change regen trigger. |
| 6 | Supabase RLS (`SELECT using(true)` + anon GRANT) | Assumed intentional (public previews); no change. | Confirm public-read is intended and no future table inherits it. |
| 7 | Mock leagues (NFL/MLB) | **Untouched** — still shipped as mock. | Whether to hide them until real sources land. |

---

## 5. Deferred (with reason)

**From the plan's explicit defer list (Section 5):**
- God-file splits (CQ-1) and the `game-expand-panel`/`schedule` decomposition — deliberate high-churn passes.
- CQ-3 league-dispatch ladders → table-driven (beyond trivially-safe cases).
- DEP-3 / breaking DEP-1: React 19, Tailwind 4, Next 15/16, eslint 10, lucide major.
- All product decisions in §4.

**Deferred during execution (judgment calls):**
- **Full UX-1 row restructure** (`role="button"` `<article>` → real `<button>` with only non-interactive children) and a **Tab focus-trap** for the mobile calendar — too risky in the 1,588-line schedule file this pass; the high-value subset (`aria-controls`/`role=region`, dialog semantics + Escape + focus move/restore) landed.
- **PERF-5** (`next/image` migration + ambient-orb reduction) — `next/image` on the CSS-sized logos risks layout shift; lazy-loading decorative logos is a minor bandwidth win. Low severity; deferred to avoid scattered risky edits.
- **Heading-hierarchy semantic pass** (UX-6 `<p>`-as-heading) — high churn across the design-token system, low marginal value.
- **Orphaned mock-data consts** — removing `getUpcomingGames/getRecentNews/getAIPreview` (COR-4) left a few private helper consts unused (`BROADCAST_POOLS`, `STREAMING_POOLS`, `GAME_TIMES_UTC`, `NEWS_TEMPLATES`, `AFL_BROADCASTS`, `AFL_STREAMING`) — now `no-unused-vars` warnings; safe to drop in a follow-up (left to avoid a deletion cascade).
- **Per-league ESPN stat-name unification** — CQ-2 centralized the entries-walk + rank; the per-league stat mappings (`gamesWon` vs `wins`, `otLosses`, …) stay at call sites (rewriting them is riskier than the duplication removed).
- **The 441 `any`/unused warnings** are now visible (CFG-3) but not resolved — a typed-boundary pass is the natural follow-up.

---

## 6. Recommended next steps (review order before shipping)

1. **Apply migration 0004** and **run `npm run test:integration` (verify-sandbox-faithful)** against a live dev server — the one verification I couldn't run here.
2. **Smoke-test the LLM path** end-to-end on the generation host (Ollama up): confirm REL-1's refuse-to-store doesn't reject a meaningful share of fixtures (watch `/tmp/sporthouse-ai.log` for `refuse-store`). If it does, that points to an over-eager validator worth examining (do **not** relax REL-1).
3. Decide the §4 items, especially **F1 2025→2026 data** (#4) and **hosting** (#1).
4. Confirm prod `CRON_SECRET` is a real `openssl rand` value (the old placeholder was `local-cron-secret-change-me`).
5. Then schedule the deferred refactors in this order: typed ESPN boundaries (CQ-4 full) → god-file splits (CQ-1) → the Next 16 / React 19 migration (DEP-3) as one deliberate project.
