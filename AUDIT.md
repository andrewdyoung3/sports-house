# SportHouse — Codebase Audit

**Date:** 2026-06-27
**Scope:** Full-stack read-only audit (correctness, security, data integrity, performance, code quality, reliability, testing, dependencies, UX/a11y, configuration/DX).
**Method:** Direct reading of source, type-check (`tsc --noEmit` — passes clean), `npm audit`, `npm run lint`, dependency inspection, and git-history checks. No files were modified. Key high-severity findings were independently re-verified against source.

---

## 1. System Overview

**What it is.** SportHouse is a personalized sports companion web app. A user picks teams during onboarding; their selections are stored in `localStorage`; the dashboard, schedule, and results pages then render a personalized feed of fixtures, standings, news, and **AI-generated match previews**. The differentiating feature is a faithfulness-focused LLM preview pipeline that enriches each fixture with standings, recent form, head-to-head, lineups, weather, and competition-stakes context, then validates the generated prose against the underlying data.

**Stack & runtime.** Next.js 14.2.35 (App Router) + React 18 + TypeScript 5 (`strict: true`) + Tailwind 3. Server: Next route handlers under `src/app/api/*`. Persistence: Supabase (`game_previews`, `preview_jobs` tables) via `@supabase/ssr` and a service-role admin client. Auth: Supabase (session refresh in middleware; anonymous sessions allowed). LLM: a **local Ollama** instance reached through the `openai` SDK's OpenAI-compatible transport (the `@anthropic-ai/sdk` dependency is used only in a dev eval script). Generation is driven off-platform by **macOS LaunchAgents** on the author's Mac (hourly `npm run warm` + a job poller), not by a hosted cron.

**Architecture & data flow.**
- *Read path:* pages (client components) → `/api/{fixtures,results,standings,news,preview,match-stats,weather}` → live upstreams (ESPN, Squiggle, Jolpi/Ergast, cricketdata.org, Open-Meteo) with hard-coded ID maps; some leagues (NFL/MLB) still use `src/lib/mock-data.ts`.
- *Write path (previews):* `buildPreviewContext()` assembles a canonical `PreviewContext` → `buildDataBlock()` renders the prompt → Ollama generates → validators check the prose → `upsertPreview()` writes to Supabase `game_previews`. A "faithfulness invariant" requires generation, the dev sandbox, and `verify-sandbox-faithful.ts` to all build context the same way.
- *Lifecycle:* following a team enqueues a `preview_jobs` row; a poller and an hourly heartbeat decide what to (re)generate via `decideForTeam()` at fixed 48h/24h pre-kickoff marks.

**Who it's for.** Sports fans (the data sources skew Australian — AFL/NRL/cricket/Super Rugby — plus EPL, NBA, NHL, F1, and the World Cup). It is an MVP: no per-user server-side data, preferences are device-local, and all served content is effectively public.

**Overall health.** The code is thoughtfully built and unusually well-documented, type-checks cleanly, and the AI pipeline's faithfulness design is genuinely strong. The material risks cluster in four areas: (1) **no automated test gate / CI** despite real test scripts existing; (2) **a data-integrity bug where standings positions are taken from array order, not rank**, feeding wrong "facts" the validators trust blindly; (3) **the validator results are discarded at the storage boundary**, so known-hallucinated previews can still be persisted; and (4) **the paid/expensive LLM endpoints have no rate limiting and accept anonymous sessions**.

---

## 2. Findings by Dimension

Severity = Critical / High / Medium / Low. Effort = S / M / L. Risk = risk that the fix breaks something.

### 2.1 Correctness & Functionality

#### COR-1 — Standings positions assigned by array index, not the `rank` stat
- **Severity:** Critical · **Effort:** S · **Risk:** Low
- **Where:** `src/lib/preview-fetchers.ts:410-422` (NRL `leagueTable`, `position: i + 1`); same index pattern for EPL (~`:1050`) and cup standings (`:586-596`, `:612-613`). Verified: line 415 is `position: i + 1`.
- **Problem & impact:** ESPN's `children[0].standings.entries` array is **not guaranteed to be in rank order** — the per-entry `rank` stat exists precisely because ordering can vary (ties, alphabetical, conference splits). `parseNRLStandings` reads the real `rank` for a single team, but the full table stamps `position = i + 1`. Downstream, `buildDerivedFacts` / `computeCompetitionStatus` / `buildTableSection` compute finals-cutoff gaps, "Nth place is X", title-clinched, and relegation from that index. If ESPN returns entries out of order, the model is fed authoritative-looking but **wrong** standings facts that the validators cannot catch (validators bind prose to DERIVED FACTS; they trust DERIVED FACTS itself).
- **Fix:** In each table builder set `position` from the `rank` stat when present (`statVal(stats,'rank') || i+1`) and sort by it; make `buildTableSection`/`buildDerivedFacts` sort by real rank.

#### COR-2 — Daylight-saving ignored: fixed `+10h` AEST offset for displayed kickoff times
- **Severity:** Medium · **Effort:** S · **Risk:** Low
- **Where:** every non-AFL fixtures fetcher, e.g. `src/app/api/fixtures/route.ts:252,396,470,605,714,835,938` (`new Date(utc + 10*3600*1000)`).
- **Problem & impact:** Sydney/Melbourne are UTC+11 under daylight saving (Oct–Apr). NRL/SRU/BBL/SOO/RINT hard-code +10, so displayed local times are **1 hour early** for the whole summer window — and BBL runs entirely in AEDT, so its times are always wrong. (Stored UTC `date` is correct, so lifecycle math is unaffected; only the user-facing `time` string is wrong. AFL is fine — it uses Squiggle's `tz`/`timestr`.)
- **Fix:** Format with `Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney' })` instead of a fixed offset.

#### COR-3 — Draws can be mislabelled as losses in recent-form data
- **Severity:** Low · **Effort:** S · **Risk:** Low
- **Where:** `src/lib/preview-fetchers.ts:745-760` (`mapEspnGame`); draws inferred from `gameResult === 'D'`.
- **Problem & impact:** Some ESPN soccer/WC summaries report only 'W'/'L'; an equal-score draw is then recorded `isWin=false, isDraw=false` and reasoned about as a loss in form context.
- **Fix:** Fall back to `isDraw = teamScore === opponentScore` when `gameResult` isn't 'D'.

#### COR-4 — Dead / half-implemented code
- **Severity:** Low · **Effort:** S · **Risk:** Low
- **Where:** Unused exports verified to have zero external references: `preview-prompt.ts` `assemblePrompt` (`:2155`), `buildUpdatePrompt` (`:2279`); `mock-data.ts` `getUpcomingGames`/`getRecentNews`/`getAIPreview`; `preview-context.ts` `clearPreviewContextCache` (only used by tests); `teams.ts` `getTeamById`; `user-prefs.ts` `isFollowing`/`clearFollowedTeams`; `utils.ts` `hexAlpha`/`safeHex`.
- **Problem & impact:** Inflates API surface and misleads maintainers about real dependencies.
- **Fix:** Delete the grep-verified dead exports. (Note: `isValidPreview`, `upsertPreview`, `validateF1ChampionshipClaims`, `COMPETITION_PROFILES`, and several `WC_*` constants are false positives — used in-file or re-exported. Do not remove.)

### 2.2 Security

#### SEC-1 — LLM endpoint `/api/ai-review` is effectively open (accepts anonymous sessions) and unauthenticated if Supabase is unconfigured
- **Severity:** High · **Effort:** S · **Risk:** Low
- **Where:** `src/app/api/ai-review/route.ts:143-154`. Verified: the route's own comment says "all other callers require a valid session (**anonymous included**)."
- **Problem & impact:** Any web visitor receives an anonymous Supabase cookie, which satisfies the gate. So in practice **any anonymous visitor can POST arbitrary match data and trigger a full Ollama generation** (long timeout, `max_tokens: 3000`) and poison `unstable_cache` keyed on attacker-supplied `gameId`. It's an open, expensive endpoint behind a free cookie. (The `?? { user: null }` makes it fail *closed* when Supabase is unset — good — but the anonymous-session acceptance is the real hole.)
- **Fix:** Require a non-anonymous session (`user.is_anonymous === false`) for this route, treat "Supabase unconfigured" as 503, and add rate limiting (SEC-2).

#### SEC-2 — No rate limiting anywhere, including LLM and high-fan-out routes
- **Severity:** High · **Effort:** M · **Risk:** Low
- **Where:** `src/app/api/ai-review/route.ts`, `src/app/api/sandbox/generate/route.ts`, `src/app/api/results/route.ts` (EPL fans out to 5 ESPN scoreboards; cross-league soccer at `:1183-1196` fans out to **13** endpoints per request), `src/app/api/fixtures/route.ts`.
- **Problem & impact:** No throttle/WAF anywhere (grep for `rate.?limit|throttle|upstash` is empty). A single client amplifies each request into dozens of upstream calls and can saturate the single Ollama box — cheap DoS, plus risk of the app's IP being WAF-banned by ESPN.
- **Fix:** Per-IP rate limiting (Vercel WAF rate rules / Upstash) on the LLM and fan-out routes; cap the cross-league fan-out width.

#### SEC-3 — `CRON_SECRET` compared with `!==` (not timing-safe); secret forwarded in a self-call
- **Severity:** Medium · **Effort:** S · **Risk:** Low
- **Where:** `src/app/api/cron/poll-reviews/route.ts:223-226`; `src/app/api/ai-review/route.ts:146-147`.
- **Problem & impact:** Non-constant-time comparison is a theoretical timing side-channel on the shared cron secret. The poller also forwards the inbound secret to `/api/ai-review` over `BASE` (`:200-204`); if `NEXT_PUBLIC_SITE_URL` were misconfigured, the secret would leak to that host.
- **Fix:** Use `crypto.timingSafeEqual` (with a length guard) for both checks; pin/validate `BASE` to an https same-origin value in production.

#### SEC-4 — External feed text flows into LLM prompts with no input sanitization (prompt injection)
- **Severity:** Low · **Effort:** M · **Risk:** Med
- **Where:** `src/lib/preview-prompt.ts` (`buildDataBlock`), `src/lib/preview-generator.ts:364-439`; news from `src/app/api/news/route.ts:28-37`.
- **Problem & impact:** ESPN headlines/descriptions and team/player names are concatenated verbatim into the prompt with no filtering for injection markers. The existing validators guard *output* faithfulness, not *input*. Exploitability is low (reputable upstreams; output is non-executable — no `dangerouslySetInnerHTML`/`eval` anywhere), but a compromised feed could steer generated prose.
- **Fix:** Strip control characters / known injection markers from external text before prompt assembly and clearly delimit external data in the prompt; keep the output validators.

#### SEC-5 — Cricket id from query param reaches a keyed CricAPI URL unencoded (dev-only)
- **Severity:** Low · **Effort:** S · **Risk:** Low
- **Where:** `src/app/api/sandbox/context/route.ts:30-49` → `league-fixtures.ts:973-1016` → `cricketdata.ts:95-103`.
- **Problem & impact:** `gameId` is passed into `match_info?apikey=…&id=<value>` without `encodeURIComponent` or uuid validation — query-param injection and quota burn. Mitigated: all `/api/sandbox/*` routes 404 in production, so this is dev-only.
- **Fix:** Validate the id as `[a-z0-9-]+` and `encodeURIComponent` it; keep the prod 404 guard.

#### SEC-6 — `.env.local.save` (real secrets) present in working tree; one placeholder env file was once committed
- **Severity:** Low · **Effort:** S · **Risk:** Low
- **Where:** repo root `.env.local.save` (mode `-rw-------`); git history commit `2732493` (removed in `3d79bfc`).
- **Problem & impact:** The committed file contained **placeholders only** (verified: `CRON_SECRET=local-cron-secret-change-me`, empty Supabase values) — no live secret ever entered git history (confirmed via `git log -S 'SUPABASE_SERVICE_ROLE'`). But a real-secret backup sitting in the working tree is a footgun (one `git add -f` from a leak), and the placeholder is a reminder to confirm prod `CRON_SECRET` was actually rotated.
- **Fix:** Delete `.env.local.save`; broaden `.gitignore` to `.env*`; confirm prod `CRON_SECRET` is a real random value.

> **Checked and OK:** service-role key is server-only (never `NEXT_PUBLIC_`); all public data routes validate `league` against an allowlist and `teamId` against a regex before building hard-coded upstream URLs (no host-controllable SSRF); weather `venue` is length-capped and `encodeURIComponent`-ed; no `eval`/`child_process`/`dangerouslySetInnerHTML`; OAuth callback redirects to a fixed internal path (no open redirect).

### 2.3 Data Integrity

#### DAT-1 — `game_previews` upsert is unconditional last-write-wins; concurrent writers can clobber a newer row
- **Severity:** Critical · **Effort:** M · **Risk:** Low
- **Where:** `src/lib/preview-generator.ts:575-589` (`upsertPreview` — verified: plain `upsert` with `onConflict: 'game_id'`, no precondition). Orchestrated by `scripts/poll-jobs.ts` + `scripts/generate-previews.ts`.
- **Problem & impact:** The only thing serializing the poller and heartbeat is a single-host `/tmp` lock (`generation-lock.ts`). The upsert has no optimistic-concurrency guard (no `updated_at` precondition, no version/`context_hash` column). The moment generation runs off that one host (a Vercel function, a second machine, or `npm run warm:force` racing the poller after the stale window), two generations of the same `game_id` race and the later `updated_at` silently clobbers the other — a stale or lower-quality preview can overwrite a newer one with no detection.
- **Fix:** Add a monotonic guard (a `generation_seq`/`context_hash` column with a conditional update, or a `.gte` precondition on `updated_at`); keep the file lock as best-effort throttle only.

#### DAT-2 — `preview_jobs` stale-reclaim window is shorter than the Ollama timeout → duplicate generation; table grows unbounded
- **Severity:** Medium · **Effort:** S · **Risk:** Low
- **Where:** `supabase/.../0003_preview_jobs.sql`; `scripts/poll-jobs.ts:103-109,137-147`.
- **Problem & impact:** Stale reclaim flips `processing` rows older than **10 min** back to `pending`, but the Ollama timeout is **15 min**. A job legitimately processing for 11 minutes gets reclaimed, re-claimed by a second tick, and the same fixture is generated twice → double upsert (compounds DAT-1). Separately, `done`/`failed` rows are never purged, so the table grows one row per follow event forever.
- **Fix:** Set the job-stale threshold above the Ollama timeout (≥16 min, ideally 20 to match the lock); add a periodic purge of old terminal rows.

#### DAT-3 — `news_fingerprint` staleness detection is half-implemented (column always NULL)
- **Severity:** High · **Effort:** M · **Risk:** Med
- **Where:** `generateAndStorePreview` always calls `upsertPreview(..., null)` (`preview-generator.ts:640,644`); column exists (`0002_game_previews.sql:9`); the client computes and compares a fingerprint (`game-expand-panel.tsx:1132,1159`) but the server never stores one.
- **Problem & impact:** Regeneration fires only at fixed 48h/24h time marks — never when underlying news/injuries change, even though the schema + client were built for exactly that. The column is permanently `NULL`, so the client's `cached.newsFingerprint === fingerprint` logic is inert. Previews go stale w.r.t. breaking news between the time marks.
- **Fix:** Compute and persist `news_fingerprint` from the context (headlines + injuries) and add a fingerprint-change regen trigger in `decideForTeam` — or remove the half-feature so it doesn't imply it works.

### 2.4 Reliability & Resilience

#### REL-1 — Caught hallucinations are still persisted: validator results are discarded at the storage boundary
- **Severity:** High · **Effort:** M · **Risk:** Med
- **Where:** `src/lib/preview-generator.ts:545-558` (verified: on retry violations it logs "returning first attempt" and returns it), `:563-573` (`isValidPreview` checks string lengths only), `:639-647` (upsert gated only by `isValidPreview`).
- **Problem & impact:** If both the first attempt and the retry have violations (hallucinated player names, wrong WC group letter, invented year, wrong F1 gap), `callOllama` returns the first attempt anyway, and `generateAndStorePreview` upserts it because `isValidPreview` only verifies fields are non-empty. **The entire validator framework becomes advisory logging after two attempts** — known-bad content is stored and served.
- **Fix:** Thread the violation list out of `callOllama` (or re-run `allViolations` before upsert) and refuse to store when violations remain after the retry; mark the job failed so the poller retries later.

#### REL-2 — Transient upstream failures poison process-global caches with empty data, no retry
- **Severity:** High · **Effort:** S · **Risk:** Low
- **Where:** `src/lib/cricketdata.ts:122-131` (`_current.fetched = true` is set **before** the `await`, so one failed `currentMatches` call zeroes all cricket fixtures for the whole run); `src/lib/preview-context.ts:121-137` (`cachedRichContext` stores `{}` on any throw, blanking a fixture's entire context for the run — a near-empty preview can then pass `isValidPreview` and be upserted).
- **Problem & impact:** A single transient ESPN/CricAPI blip silently degrades or empties data for an entire generation run, with the failure looking like "no fixtures"/"no data."
- **Fix:** Only mark caches populated after a *successful* fetch; use a short negative-cache instead of permanent poisoning; skip upsert when core context is empty for a league that should have standings.

#### REL-3 — Pervasive silent catch blocks mask upstream schema drift
- **Severity:** Low · **Effort:** S · **Risk:** Low
- **Where:** e.g. `preview-fetchers.ts:717-719,893-895,924-926`; `fixtures/route.ts:221,1059,1074`; `weather.ts:192,300`; `soo.ts:351`; plus `.catch(() => {})` in several routes/components.
- **Problem & impact:** `catch { return [] }` with no log means ESPN JSON-shape changes (which have happened before per the `.roster` vs `.entries` history) fail silently — the only symptom is thinner previews, with no signal to investigate.
- **Fix:** Add a `console.warn(context, err)` in catches wrapping external-response parsing; reserve truly silent catches for optional enrichment and comment why.

#### REL-4 — World Cup form/H2H/lineups silently vanish on ESPN name-variant mismatch
- **Severity:** High · **Effort:** S · **Risk:** Low
- **Where:** `src/lib/preview-context.ts:223-227,336-345`; depends on `WC_ID_TO_ESPN_NAME` / `WC_ESPN_NAME_TO_ID` holding the exact endonym ESPN currently returns (e.g. "Türkiye" vs "Turkey").
- **Problem & impact:** The group *table* lookup is now robust (by letter), but `fetchESPNMatchExtras` and the H2H provider still key on the name variant. An unmapped/changed name drops form/H2H/lineups (and can flip the group tiebreaker order) with no warning for a followed team.
- **Fix:** Extend `scripts/check-team-coverage.ts` to assert every WC id round-trips through both name maps; warn when a WC fixture yields zero group rows or zero form for a followed team.

### 2.5 Performance

#### PERF-1 — The ~1,800-line expand panel + hero are statically imported into the schedule bundle
- **Severity:** Critical · **Effort:** M · **Risk:** Low
- **Where:** `src/components/schedule/game-expand-panel.tsx` (1,792 lines) imported eagerly at `src/app/schedule/page.tsx:17` and inside the hero (`next-game-hero.tsx:7`). The schedule page itself is 1,588 lines, fully `'use client'`.
- **Problem & impact:** The panel (plus `WcGroupBrowser`, `F1ExpandPanel`, table/AI/cache logic) ships in the first-load JS of the most-used page even though a panel only renders after a click. Large TTI/hydration cost, worst on mobile.
- **Fix:** `dynamic(() => import(...), { ssr: false })` for the panel and hero variants; panels are already gated behind `everExpandedIds`, so the chunk loads only on first expand.

#### PERF-2 — `ScheduleRow` is unmemoized with unstable inline props; whole list re-renders on hover
- **Severity:** Medium · **Effort:** M · **Risk:** Med
- **Where:** `src/app/schedule/page.tsx:1434-1444` (new `onToggle` closure per render), inline `boxShadow`/gradient style objects (`:1425-1432`, `:508-517`); parent re-renders on `hoveredDateKey`/`clickedDateKey`/glow timer.
- **Problem & impact:** Hovering one date or the 2.5s glow timer re-runs the entire fixture list (each row does name-length math, TZ parsing, badge lookups). Janky hover/scroll with many fixtures and panels mounted.
- **Fix:** `React.memo(ScheduleRow)`, pass a stable `onToggle`, move static style into CSS classes/vars and drive the glow via a class toggle.

#### PERF-3 — Per-team request fan-out with no batching or concurrency cap
- **Severity:** Medium · **Effort:** L · **Risk:** Med
- **Where:** `src/app/schedule/page.tsx:1032-1061` (per-team `loadFixtures` then chained `loadResults`); `team-feed-card.tsx:43-46` (3 requests per card). Server-side EPL preview fan-out at `preview-fetchers.ts:1016-1127` (~12 ESPN calls per preview, partly serial) with no circuit breaker (unlike cricket).
- **Problem & impact:** Following 10 teams → 10 fixtures + 10 results client requests; dashboard fires 3×N parallel. Server EPL previews can be throttled by ESPN mid-run, degrading silently.
- **Fix:** Batched `/api/fixtures?teams=...` (or cap concurrency); issue fixtures+results in parallel per team; add a shared ESPN concurrency limiter + soft circuit breaker and cache the standings fetch once per league per run.

#### PERF-4 — Process-global in-memory caches never expire in long-lived processes
- **Severity:** Medium · **Effort:** M · **Risk:** Low
- **Where:** `_richCache`/`_weatherCache`/`_wcRaw`/`_wcScoreboard` (`preview-context.ts:40-47,142-161`); per-process maps in `cricketdata.ts:60-64`.
- **Problem & impact:** Correct for a short-lived heartbeat, but in the dev server / any persistent host the sandbox and preview context serve hours/days-old standings (`_wcRaw` never expires). `clearPreviewContextCache()` exists but is test-only.
- **Fix:** Add TTLs to the in-memory caches (mirror the cricket file-cache TTL) or scope them to request lifetime in server contexts.

#### PERF-5 — Raw `<img>` throughout + decorative animated blur layers
- **Severity:** Low · **Effort:** M · **Risk:** Low
- **Where:** ~26 `@next/next/no-img-element` lint warnings (schedule/results/panel/hero/navbar logos); `team-badge.tsx:82` uses `next/image` but with `unoptimized`; `layout.tsx:53-70` renders multiple animated 280–500px `blur(56–80px)` orbs + pervasive `backdrop-filter` glass.
- **Problem & impact:** Unoptimized remote logos (no WebP/resize), some CLS risk, and GPU-heavy blur/animation causing scroll jank and battery drain on low-end mobile (`prefers-reduced-motion` is handled, but blur cost remains).
- **Fix:** Configure `images.remotePatterns` for the logo CDNs and use `next/image` (drop `unoptimized`); add `loading="lazy"`/`decoding="async"` to decorative imgs; reduce orb count/blur on small viewports.

### 2.6 Code Quality & Maintainability

#### CQ-1 — God files concentrate constants, parsing, business logic, and prompt text
- **Severity:** High · **Effort:** L · **Risk:** Med
- **Where:** `preview-prompt.ts` (2,354 lines — lookup tables + `buildDerivedFacts` + WC ranking + F1 facts + ~270-line system prompt + ~670-line `buildDataBlock` at `:1487-2154`); `preview-fetchers.ts` (2,190); `game-expand-panel.tsx` (1,792); `schedule/page.tsx` (1,588); `api/fixtures/route.ts` (1,418); `api/results/route.ts` (1,221).
- **Problem & impact:** Every prompt tweak risks the validators and vice-versa; a 670-line function can't be unit-tested in isolation, yet the faithfulness invariant depends on it being correct per league. Hard to review and navigate.
- **Fix:** Split `preview-prompt.ts` into prompt/assembly, `preview-blocks.ts`, `derived-facts.ts`, `league-tables.ts`; extract per-section builders from `buildDataBlock`.

#### CQ-2 — Copy-pasted per-league ESPN parsers (the silent-drift class of bug)
- **Severity:** High · **Effort:** L · **Risk:** Med
- **Where:** `preview-fetchers.ts` — the `sv()` stat helper appears 5× (`:1229,1294,1342,1459,1689`); the `data.children?.[0]?.standings?.entries ?? …` walk appears ~13×; `parseRintStanding` (`:1223-1240`) and `parseSRUStandings` (`:1288-1305`) are structurally identical. The same walk is re-implemented in `api/standings/route.ts` (`:97,149,202-203,246-247,409,481,490`).
- **Problem & impact:** Adding a league means cloning ~150 lines; a fix to the ESPN shape must be applied in a dozen places. This is exactly where a field-name drift (`gamesWon` vs `wins`) breaks one league while others pass — and nothing catches it (see TEST-3).
- **Fix:** Extract `lib/espn-standings.ts` with `parseESPNStandingsEntries(data)` + `parseESPNTeamStanding(...)` and a single stat-alias table; import from both the route and the fetchers.

#### CQ-3 — `if/else-if` league dispatch ladders that should be table-driven
- **Severity:** Medium · **Effort:** M · **Risk:** Low
- **Where:** `api/fixtures/route.ts:1401-1411` (11 arms, SOO inlined); mirrored in `api/results/route.ts`; 22 league branches in `preview-prompt.ts`; 10 in `schedule/page.tsx`.
- **Problem & impact:** The two big routes drift apart over time; the codebase already proves the table approach works (`COMP_RULES`, `LEAGUE_LABELS`, `MAX_PTS_PER_GAME`) — these ladders are the holdouts.
- **Fix:** Replace with a `Record<League, (teamId) => Promise<Fixture[]>>` dispatch map; SOO becomes an entry, not an inline special-case.

#### CQ-4 — `strict` defeated at API boundaries: 382 `any` casts
- **Severity:** Medium · **Effort:** L · **Risk:** Med
- **Where:** `preview-fetchers.ts` (~130), `api/results` (~77), `api/fixtures` (~72), `league-fixtures.ts` (~35). `tsconfig.json` also lacks `noUnusedLocals`/`noUnusedParameters`.
- **Problem & impact:** Type safety is absent exactly where third-party shapes change — the most error-prone code and where CQ-2's silent drift hides.
- **Fix:** Define minimal `interface`s for the ESPN/Squiggle fields actually read; replace `any` at parse boundaries; add `noUnusedLocals`.

#### CQ-5 — Oversized client components with incorrect effect deps
- **Severity:** Medium · **Effort:** L · **Risk:** Med
- **Where:** `game-expand-panel.tsx:1227` (`useEffect` with ~11 missing deps); `schedule/page.tsx:1092,1109` and `results/page.tsx:437` (`useMemo`/effect dep warnings).
- **Problem & impact:** Large stateful components with wrong dep arrays are the classic source of stale-render bugs; the exhaustive-deps warnings are genuine stale-closure risks.
- **Fix:** Extract data-fetching into hooks (`useGamePreview`, `useStandings`), split presentational subcomponents, and correct the dep arrays.

### 2.7 Testing

#### TEST-1 — No automated test gate: no `npm test`, no CI, no coverage
- **Severity:** Critical · **Effort:** M · **Risk:** Low
- **Where:** `package.json:5-17` (no `test` script); no `.github/` directory; no coverage tooling.
- **Problem & impact:** A 26k-line app whose correctness backbone is a set of prose-binding validators has **zero gate** preventing a regression from merging. The validators can silently break.
- **Fix:** Add `"test"` wiring the existing scripts and a minimal GitHub Actions workflow running `npm ci && npm run build && npm test`.

#### TEST-2 — Real tests exist but are unaliased and unrun
- **Severity:** High · **Effort:** S · **Risk:** Low
- **Where:** `scripts/test-validators.ts`, `test-competition-structure.ts`, `test-preview-lifecycle.ts`, `verify-sandbox-faithful.ts`, `check-team-coverage.ts` — all genuine assertions with `process.exit(1)` on failure, but none are in `package.json` scripts (only `regen`/`warm`/`poll`/`coverage`/`dump-prompt` are).
- **Problem & impact:** Tests that aren't aliased and aren't in CI rot and won't be run by contributors.
- **Fix:** Alias each as an npm script; they already have correct exit codes.

#### TEST-3 — Critical paths untested
- **Severity:** High · **Effort:** L · **Risk:** Low
- **Where:** the per-league ESPN/Squiggle parsers (`preview-fetchers.ts`), the API routes (`fixtures`/`results`/`standings`), and all React components have no tests; `scripts/audit-*.ts` and `eval-previews.ts` need live Ollama/network/keys (not deterministic).
- **Problem & impact:** The copy-pasted parsers (CQ-2) are precisely where silent field-name drift breaks one league while others pass, with nothing to catch it.
- **Fix:** Add fixture-based unit tests using captured ESPN/Squiggle JSON snapshots; assert each league's standings mapping.

### 2.8 Dependencies & Supply Chain

#### DEP-1 — Next.js 14.2.35 has 10 known advisories (6 high)
- **Severity:** High · **Effort:** M · **Risk:** Med
- **Where:** `package.json` `next: 14.2.35`; `npm audit` reports DoS (Server Components, Image Optimization), cache-poisoning, XSS (CSP nonce / beforeInteractive), middleware bypass, SSRF via WebSocket upgrades, plus `postcss`/`picomatch` transitive issues.
- **Problem & impact:** Several are remotely triggerable on a deployed Next app. `npm audit fix --force` wants `next@16` (a breaking major).
- **Fix:** Upgrade to the latest patched Next 14.2.x first (non-breaking) to clear most advisories, then plan the Next 15/16 + React 19 migration separately. Run `npm audit fix` for the picomatch ReDoS.

#### DEP-2 — `@anthropic-ai/sdk` is a prod dependency but used only in a dev script
- **Severity:** Medium · **Effort:** S · **Risk:** Low
- **Where:** `package.json:19`; only import is `scripts/eval-previews.ts:21`. The live AI path uses Ollama via the `openai` SDK (`preview-generator.ts:12`, `ai-review/route.ts:14`).
- **Problem & impact:** Ships in prod for nothing and misleads readers into thinking Claude is in the runtime path. (`openai` is genuinely the Ollama transport — keep it, but it's confusing without a note.)
- **Fix:** Move `@anthropic-ai/sdk` to `devDependencies`; add a one-line note that `openai` is the Ollama transport.

#### DEP-3 — Several dependencies multiple majors behind; eslint 8 is EOL
- **Severity:** Medium · **Effort:** M · **Risk:** Med
- **Where:** `npm outdated`: `react 18→19`, `tailwindcss 3.4→4`, `eslint 8→10` (8.x end-of-life), `lucide-react 0.454→1.21`, `@types/node 20→26`, `@anthropic-ai/sdk 0.78→0.106`.
- **Problem & impact:** Security patches and ecosystem support lag; eslint 8 no longer receives fixes.
- **Fix:** Schedule a bump; prioritize eslint and the Anthropic SDK; treat React/Tailwind/Next majors as separate planned migrations.

### 2.9 UX & Accessibility

#### UX-1 — Expandable fixture rows are `role="button"` `<article>`s containing nested interactive content, with no `aria-controls`
- **Severity:** Critical · **Effort:** L · **Risk:** Med
- **Where:** `src/app/schedule/page.tsx:409-419` (and the F1 fallback `:502-524`).
- **Problem & impact:** ARIA forbids interactive children inside `role="button"`; the expanded panel renders as a sibling with no `aria-controls` link, so screen-reader users get a button whose `aria-expanded` toggles content they can't locate. The core interaction is broken for keyboard/SR users.
- **Fix:** Make the clickable header a real `<button aria-expanded aria-controls={panelId}>` with only non-interactive content; give the panel `id={panelId} role="region"`.

#### UX-2 — No focus management for panels, the mobile calendar sheet, or popups
- **Severity:** High · **Effort:** M · **Risk:** Low
- **Where:** expand panel (`schedule/page.tsx:1445-1459`), mobile calendar bottom sheet (`:1530-1585` — a `fixed z-50` overlay with no `role="dialog"`/`aria-modal`/focus trap/Escape), `FollowedTeamsWidget` popup (`:848-870`), hero toggle (`next-game-hero-sh.tsx:175`).
- **Problem & impact:** Keyboard users can't reach or escape the calendar sheet; focus stays on the now-hidden trigger; SR never announces the opened dialog.
- **Fix:** Add `role="dialog" aria-modal="true"` + Escape + focus trap + focus-restore to the sheet; move focus to the panel region on expand; add `aria-expanded`/`aria-haspopup` + Escape to the popup.

#### UX-3 — Fetch failures render as "empty," not errors; no error boundaries
- **Severity:** High · **Effort:** M · **Risk:** Low
- **Where:** `schedule/page.tsx:77-95` (`loadFixtures`/`loadResults` swallow errors → `[]`); `team-feed-card.tsx:43-53` (no `.catch`, shows "No recent news" on failure). No `app/*/error.tsx`.
- **Problem & impact:** During an API outage the whole product silently looks empty, with no retry affordance and no way for users to know.
- **Fix:** Track an error state distinct from empty; render "Couldn't load — retry"; add route `error.tsx` boundaries; attach `.catch` in `TeamFeedCard`.

#### UX-4 — Team colors used as text backgrounds with hardcoded white/black — contrast failures
- **Severity:** High · **Effort:** S · **Risk:** Low
- **Where:** onboarding chips (`onboarding/page.tsx:147-148`), dashboard sidebar badge (`dashboard/page.tsx:99-103`), hero countdown pill (`next-game-hero.tsx:227-230`).
- **Problem & impact:** Many team primaries are light (gold, sky, near-white); forcing white text yields contrast well below 4.5:1, making labels unreadable. The codebase already has `contrastColor()` (used correctly in `team-badge.tsx:52`) — these sites bypass it.
- **Fix:** Replace hardcoded `text-white`/`#fff` with `color: contrastColor(team.primaryColor)` at these sites.

#### UX-5 — Search input has no accessible label; broken heading hierarchy; hard navigation
- **Severity:** Medium · **Effort:** M · **Risk:** Low
- **Where:** `ui/input.tsx:15-25` used at `onboarding/page.tsx:101-106` (placeholder only, no label); multiple `<h1>` / non-semantic `<p>` "headings" across dashboard/schedule (`empty-state.tsx:27`, `schedule/page.tsx:1402`); `window.location.href = '/results#…'` full reload at `schedule/page.tsx:1210`.
- **Problem & impact:** SR users hear "edit text" with no purpose; no skimmable document outline; the past-day click does a hard SPA-busting reload that refetches everything.
- **Fix:** Add `aria-label="Search teams"`; normalize one `<h1>` per page with semantic `<h2>/<h3>` section headings; use `router.push()` instead of `window.location.href`.

#### UX-6 — Hydration flashes from localStorage-only prefs; minor a11y nits
- **Severity:** Medium · **Effort:** M · **Risk:** Med
- **Where:** `dashboard/page.tsx:24-30`, `hero-cta.tsx:14-19` (renders new-visitor CTA first, then flips), `navbar.tsx:46,60` (mobile logo link + icon-only nav have no accessible name), onboarding unsaved-changes loss (`onboarding/page.tsx:56-59`), `AILoadingCard` interval runs while panel is `display:none` (`game-expand-panel.tsx:344-352`).
- **Problem & impact:** Returning users see a flash of the wrong CTA/empty dashboard each load; icon-only mobile nav/logo lack accessible names; navigating away from onboarding silently discards selections; off-screen timers accumulate.
- **Fix:** Render a neutral skeleton until prefs resolve (or SSR prefs from the session cookie); add `aria-label`s to the mobile logo/nav links; warn on unsaved onboarding changes; unmount or pause hidden panel timers.

### 2.10 Configuration & DX

#### CFG-1 — `.env.local.example` omits required vars (notably `CRICKETDATA_API_KEY`)
- **Severity:** High · **Effort:** S · **Risk:** Low
- **Where:** `.env.local.example` documents only Supabase + `OLLAMA_HOST` + `CRON_SECRET` + `ANTHROPIC_API_KEY`. Code also reads `CRICKETDATA_API_KEY`, `SANDBOX_BASE`, `EVAL_SAMPLES`, `OLLAMA_MODEL`, `NEXT_PUBLIC_SITE_URL`.
- **Problem & impact:** A new dev copying the example gets a silently broken cricket feature (a shipped feature) and no clue the sandbox/eval vars exist.
- **Fix:** Add `CRICKETDATA_API_KEY` (required for cricket), `SANDBOX_BASE`, `EVAL_SAMPLES`, `OLLAMA_MODEL`, `NEXT_PUBLIC_SITE_URL` with comments.

#### CFG-2 — Generation pipeline is host-pinned to one Mac (bus factor of one)
- **Severity:** Medium · **Effort:** M · **Risk:** Low
- **Where:** `scripts/launchd/*.plist` hard-code `/Users/andreasjenkins/...` and an absolute nvm node path; hourly `npm run warm` + poller run only on the author's machine; the generation lock is a single-host `/tmp` file.
- **Problem & impact:** The whole preview pipeline depends on one laptop being awake and online; no documented failover. Acceptable for an MVP but a real single point of failure (and it underpins DAT-1's single-host assumption).
- **Fix:** Document the host-binding; template the paths; plan a move to a cloud cron + hosted model when scaling past MVP.

#### CFG-3 — Minimal ESLint config; 26 lint warnings including 3 real exhaustive-deps
- **Severity:** Medium · **Effort:** M · **Risk:** Low
- **Where:** `.eslintrc.json` is `{ "extends": "next/core-web-vitals" }` only; `npm run lint` → 0 errors, ~26 warnings (mostly `no-img-element`, plus real `react-hooks/exhaustive-deps` at `game-expand-panel.tsx:1227`, `schedule/page.tsx:1092,1109`, `results/page.tsx:437`).
- **Problem & impact:** Lint won't catch the `any` proliferation, dead exports, or oversized functions; the exhaustive-deps warnings are genuine stale-closure bug risks (overlaps CQ-5).
- **Fix:** Add `next/typescript` to extends; enable `@typescript-eslint/no-unused-vars` and `no-explicit-any` (as `warn`); fix the 3 hooks-deps warnings.

> **Strengths worth preserving:** unusually thorough docs (`CLAUDE.md`, `PROJECT_CONTEXT.md`, per-plist runbooks); `tsc --noEmit` passes clean; the `buildPreviewContext` "single source" + faithfulness-invariant design; consistent `fetchTimeout` usage with `next: { revalidate }`; correct `prefers-reduced-motion` handling; an existing `contrastColor()` helper.

---

## 3. Prioritized Action Plan

Ranked by impact ÷ effort. The top tier is high-impact and low-effort/low-risk — do these first.

| # | Action | Findings | Sev | Effort | Risk | Why it's high-leverage |
|---|--------|----------|-----|--------|------|------------------------|
| 1 | **Block storage of validator-failing previews** — re-run `allViolations` before upsert and fail the job instead of returning the first attempt | REL-1 | High | M | Med | The entire validator framework — the product's correctness backbone — is currently bypassed at the storage boundary. Highest correctness payoff. |
| 2 | **Fix standings position to use the `rank` stat, not array index** | COR-1 | Critical | S | Low | One-line-per-league change that stops feeding wrong, unverifiable "facts" into every derived-stakes statement. |
| 3 | **Add `npm test` + CI** wiring the existing (already exit-coded) test scripts | TEST-1, TEST-2 | Critical | M | Low | Creates the regression gate the project lacks; near-zero effort since real tests already exist. |
| 4 | **Lock down `/api/ai-review`** (require non-anonymous session, fail-closed) **and add rate limiting** to LLM + fan-out routes | SEC-1, SEC-2 | High | S/M | Low | Closes an open, expensive, abusable endpoint and prevents upstream-amplification DoS / ESPN bans. |
| 5 | **Patch Next.js to latest 14.2.x** + `npm audit fix` for picomatch | DEP-1 | High | M | Med | Clears most of 10 advisories (incl. remotely triggerable DoS/cache-poisoning) without a breaking major. |
| 6 | **Stop poisoning caches on transient failures** + warn-log silent catches | REL-2, REL-3 | High | S | Low | Eliminates whole-run silent data loss from single upstream blips and makes upstream drift visible. |
| 7 | **Concurrency-guard the `game_previews` upsert** + raise `preview_jobs` stale window above the Ollama timeout + purge terminal rows | DAT-1, DAT-2 | Critical/Med | M/S | Low | Prevents stale-overwrite and duplicate generation as soon as anything runs off the single host. |
| 8 | **Fix the 3 real `react-hooks/exhaustive-deps` warnings** + tighten ESLint | CQ-5, CFG-3 | Med | M | Med | Genuine stale-closure bugs in the biggest interactive components. |
| 9 | **Route team-color text through `contrastColor()`** + add input `aria-label` + make the fixture row a real `<button>` with `aria-controls` | UX-4, UX-1, UX-5 | High/Crit | S/L | Low/Med | Fixes readability and the core a11y-broken interaction; UX-4 is a quick high-value win. |
| 10 | **Dynamic-import the expand panel + hero**; memoize `ScheduleRow` | PERF-1, PERF-2 | Crit/Med | M | Low/Med | Big bundle/TTI win on the most-used page; kills list-wide re-render jank. |
| 11 | **Complete or remove `news_fingerprint`** staleness detection | DAT-3 | High | M | Med | Either deliver the designed freshness feature or stop implying it works. |
| 12 | **Fix the AEST/AEDT timezone display** | COR-2 | Med | S | Low | Correct kickoff times for ~half the year and all of BBL. |
| 13 | **Extract a shared `espn-standings.ts` parser** + replace `any` at parse boundaries | CQ-2, CQ-4 | High/Med | L | Med | Removes ~20 copies and the entire silent-field-drift bug class; do alongside TEST-3 snapshot tests. |
| 14 | **Add error UI + route `error.tsx`** so outages aren't shown as "empty" | UX-3 | High | M | Low | Distinguishes failure from no-data across the product. |
| 15 | **Cleanup:** delete dead exports, `.env.local.save`, complete `.env.local.example`, demote `@anthropic-ai/sdk` to dev | COR-4, SEC-6, CFG-1, DEP-2 | Low/Med | S | Low | Cheap hygiene that reduces confusion and footguns. |

**Sequencing note:** items 1–4 are the "do this week" set (correctness + safety, mostly small). Items 13/TEST-3 should be done together (refactor under test). The big file-splitting refactors (CQ-1, CQ-3, UX-1) and dependency majors (DEP-3) are worthwhile but should be scheduled as deliberate passes, not bundled with bug fixes.

---

## 4. Open Questions / Needs Human Input

1. **Hosting model.** Is the macOS-LaunchAgent generation pipeline (CFG-2) the intended long-term setup, or is a cloud cron + hosted model planned? This determines whether DAT-1 (concurrency guard) is urgent now or merely prudent, and whether the single-host `/tmp` lock is acceptable.
2. **LLM provider direction.** `@anthropic-ai/sdk`, `openai` (as Ollama transport), and `OLLAMA_*` env all coexist. Is local Ollama the permanent runtime, or is a hosted provider (Claude via the SDK, or AI Gateway) the target? Affects DEP-2 and how SEC-2 rate limiting / cost controls should be sized.
3. **Auth intent.** Is the app meant to stay fully public (anonymous sessions everywhere), or is real per-user auth (the documented NextAuth/Supabase upgrade) coming? This decides whether SEC-1 should require real accounts or just throttle anonymous use.
4. **Season currency for F1.** `f1-data.ts` is the 2025 grid and the fixture fallback hard-codes 2025, while the prompt asserts a 2026 season (flagged by the correctness agent as H3). Is a 2026 data refresh pending, or is 2025 intentionally current? Needs a product/data decision before "fixing."
5. **Acceptable staleness window.** Should previews regenerate on news changes (DAT-3) or are the fixed 48h/24h marks sufficient by design?
6. **Supabase RLS posture.** Previews use `SELECT using(true)` + anon GRANT (public by design). Confirm this is intended and that no future table will inherit that permissiveness.
7. **Mock leagues.** NFL/MLB are still `mock-data.ts` but appear in metadata/onboarding. Is shipping mock data to users for those leagues acceptable for now, or should they be hidden until real sources land?

---

*End of audit. No files were modified during this pass. Line numbers reference the working tree at commit `ac5c46c`.*
