# SportHouse — Project Context

> A living architecture reference for SportHouse. Complements `CLAUDE.md` (agent-facing
> build/run instructions). This doc is the "why and how it fits together" overview plus a
> running log of decisions, the next build, and known limitations.
>
> Last updated: 2026-06-12

---

## 1. What it is

SportHouse is a personalized sports dashboard. A user picks the teams they follow (across
AFL, NRL, EPL, Super Rugby, Test Rugby, F1, BBL, International Cricket, NBA, and FIFA World
Cup), and the app builds a tailored feed of fixtures, results, standings, news, and AI match
previews.

It began as a localStorage-only MVP with deterministic mock data and has since grown a real
backend layer: Next.js API routes proxying free public sports APIs (ESPN, Squiggle), AI
previews pre-generated on the Mac mini via Ollama and served from Supabase, and a Supabase
identity/persistence layer with **real login (shipped, live in prod)**.

---

## 2. Stack

- **Next.js 14** (App Router) + **TypeScript**
- **TailwindCSS v3** — custom "glass / obsidian" dark design system
- **lucide-react** — icon set
- **Supabase** — Postgres + Auth. Holds the per-identity followed-teams row (`user_prefs`,
  RLS-protected) and the pre-generated preview store (`game_previews`, public-readable) and
  the on-follow job queue (`preview_jobs`, service-role only). Auth: **anonymous identities**
  (zero-friction default) + **real login via Google OAuth and email magic-link**
  (`@supabase/ssr`, cookie sessions).
- **localStorage** — synchronous read-through cache for the active identity's followed teams
  (Supabase is the durable source of truth).
- **API routes** — thin server layer: fetch upstream sports APIs, normalize to internal
  types, cache, serve.
- **AI text (previews)** — **Ollama** running locally on the Mac mini. Model:
  `qwen3:30b-a3b-instruct-2507-q4_K_M` (default; configurable via `OLLAMA_MODEL` env var —
  `src/lib/ai-model.ts` exports the `AI_MODEL` constant). Previews are **pre-generated** by
  `scripts/generate-previews.ts`, written to Supabase, and read by Vercel — no generation
  happens on Vercel for previews.
- **AI text (reviews)** — also **Ollama**, model hardcoded to `qwen3:30b-a3b-instruct-2507-q4_K_M`
  in `api/ai-review/route.ts`. Reviews are generated **on-read** (the review panel triggers
  generation, result cached indefinitely via `unstable_cache`). Still auth-gated — see §7.
- **Anthropic SDK** — present only in `scripts/eval-previews.ts`, a dev-only offline
  evaluation harness for comparing Anthropic models against local Ollama outputs. **Not used
  in any production route.**
- Dev server runs on **http://localhost:3001**.

### Commands
```bash
npm run dev         # dev server at :3001 (hot reload)
npm run build       # production build (also type-checks)
npm start           # serve production build
npx tsc --noEmit   # type-check only
npm run warm        # preview heartbeat: lifecycle-aware generation (used by launchd)
npm run warm:force  # force-regenerate every followed team's next fixture (manual lever)
npm run poll        # on-follow job poller (used by launchd)
npm run coverage    # read-only preview coverage diagnostic (covered / missing / no-upcoming)
```

**Baseline health:** `tsc --noEmit` and `npm run build` both exit 0 on `main`.

---

## 3. Directory structure

```
src/
  middleware.ts               — Phase-2 session REFRESH (@supabase/ssr); refresh-only, never
                                mints anon server-side; matcher excludes static assets
  instrumentation.ts          — Next.js server startup hook: pre-warms fetch cache for all
                                results-route upstream URLs (next: { revalidate: 3600 })
  app/
    page.tsx                  — Landing page (server component)
    onboarding/page.tsx       — Team selection wizard (client, 2-step)
    dashboard/page.tsx        — Personalized per-team feed (client)
    schedule/page.tsx         — Fixtures timeline + calendar + league browse (client)
    results/page.tsx          — Past results feed (client)
    layout.tsx                — Root layout (Inter font + Navbar + <PrefsSync/>)
    error.tsx                 — Error boundary
    globals.css               — Tailwind base + glass utilities + keyframes
    auth/callback/route.ts    — OAuth/magic-link PKCE exchangeCodeForSession → redirect /schedule
    api/
      fixtures/route.ts       — Upcoming fixtures for a followed team
      results/route.ts        — Past results for a followed team
      league-fixtures/route.ts— All fixtures for a whole competition (league browse)
      standings/route.ts      — League tables
      news/route.ts           — Team news headlines
      match-stats/route.ts    — Per-match statistics (typed against the lib/espn ESPN interfaces)
      preview/route.ts        — Match preview data assembly (context block for AI)
      ai-preview/route.ts     — PUBLIC: reads pre-generated preview from game_previews in
                                Supabase; no auth gate (game_previews is anon-readable);
                                returns payload or { preparing: true } on miss
      ai-review/route.ts      — GATED: Ollama on-read post-match review; requires valid
                                session or CRON_SECRET header; indefinite unstable_cache
                                (key 'ai-review-v4'); ALLOWED_LEAGUES = afl/nrl/epl/
                                super_rugby/rugby_int
      warm-team/route.ts      — GATED: enqueues a preview_jobs row (service-role insert)
                                on team follow; returns 202; best-effort, hourly heartbeat
                                is the backstop
      weather/route.ts        — Venue weather for fixtures
  components/
    ui/                       — button, card, badge, input, skeleton, team-badge, empty-state
    layout/navbar.tsx         — Fixed top navbar; active-link detection; mounts <AccountMenu/>
    auth/auth-modal.tsx       — Glass sign-in modal (Google + email magic-link), portaled to <body>
    auth/account-menu.tsx     — Navbar account entry: "Sign in" pill ↔ email + Sign out
    landing/hero-cta.tsx
    onboarding/team-selector-card.tsx
    dashboard/                — team-feed-card, game-card, news-item, recent-form
    schedule/                 — next-game-hero, schedule-calendar, game-expand-panel,
                                league-table, f1-starting-grid, sport-ball
    results/result-expand-panel.tsx
    providers/prefs-sync.tsx  — invisible auth-state wiring: serialized per-identity reload on
                                INITIAL_SESSION/SIGNED_IN; guest restore + re-anon on SIGNED_OUT
  lib/
    teams.ts                  — LEAGUES + TEAMS (160+ teams, colors, metadata) +
                                REAL_DATA_LEAGUES (afl/epl/nrl/super_rugby/rugby_int/f1/bbl/
                                cricket_int/world_cup/nba — NHL/MLB are NOT in this set)
    team-logos.ts             — TEAM_LOGOS (logo URLs) + TEAM_LOGO_FILTERS (CSS filters)
    espn.ts                   — shared ESPN/Squiggle helpers + ESPN response interfaces
    afl.ts                    — AFL Squiggle-name map + team table derived from teams.ts
    league-fixtures.ts        — fetchAFLFixtures / fetchNRLFixtures / fetchEPLFixtures /
                                fetchSRUFixtures / fetchRINTFixtures / fetchNBAFixtures /
                                fetchF1Fixtures / fetchBBLFixtures / fetchCricketIntFixtures /
                                fetchWorldCupFixtures; unified dispatch fetchLeagueFixtures(league,
                                lookbackDays). lookbackDays > 0 includes recently-completed
                                fixtures so the generator can check the settle buffer.
    ai-model.ts               — AI_MODEL = process.env.OLLAMA_MODEL ??
                                'qwen3:30b-a3b-instruct-2507-q4_K_M'
    preview-lifecycle.ts      — Pure decideForTeam() logic; exports SETTLE_BUFFER_HOURS=4,
                                REGEN_MARKS_HOURS=[48,24], LOOKAHEAD_DAYS=14, LOOKBACK_DAYS=3
    preview-generator.ts      — generateAndStorePreview(), callOllama(), upsertPreview(),
                                isValidPreview(), validation (points/names/finals-imminence)
    preview-prompt.ts         — shared AI-preview prompt assembly (used by route AND the eval)
    generation-lock.ts        — acquireLock() / releaseLock() via /tmp/sporthouse-generation.lock;
                                shared by heartbeat + poller to prevent concurrent Ollama calls
    followed-teams-server.ts  — getDistinctFollowedTeamIds(): admin client, unions ALL user_prefs
                                rows (all identities including orphaned anon rows)
    mock-data.ts              — Deterministic mock generators (seed = team ID); used for NHL/MLB
    auth.ts                   — client auth: continueWithGoogle/continueWithEmail (sign-in only),
                                getAuthState, signOutToAnon, callbackUrl
    user-prefs.ts             — followed-teams store ('use client'): synchronous localStorage cache
                                + per-identity Supabase row; reconcileActiveIdentity (reload-on-
                                identity-change), restoreGuestSession (sign-out), usePrefsVersion,
                                GUEST_BACKUP + active-identity markers
    supabase/client.ts        — SSR browser client (@supabase/ssr, dynamically imported)
    supabase/server.ts        — SSR server client (anon key + session cookies)
    supabase/admin.ts         — service-role client (bypasses RLS); used by scripts + warm-team
    supabase/middleware.ts    — writable SSR client for middleware/route-handler cookie writes
    utils.ts                  — cn(), date/timezone helpers, seededRandom(), contrastColor(), …
    f1-data.ts                — F1 calendar, country→abbr, grid data
    english-football-divisions.ts — EPL/EFL division metadata
  types/index.ts              — All shared TS interfaces
scripts/
  generate-previews.ts        — Hourly heartbeat: fetches fixtures for all LEAGUES, runs
                                decideForTeam per followed team, calls generateAndStorePreview.
                                LEAGUES = ['afl','nrl','epl','super_rugby','rugby_int','f1',
                                'world_cup','nba']. --force flag bypasses lifecycle.
  poll-jobs.ts                — On-follow poller: BATCH=5, STALE_MINUTES=10, MAX_ATTEMPTS=3.
                                Atomic claim → fixture lookup → existence-check dedup → generate.
  coverage-report.ts          — Read-only: classifies each followed team as covered / missing /
                                no-upcoming. No writes, no generation.
  eval-previews.ts            — DEV-ONLY: offline model comparison harness (Anthropic + Ollama).
                                Not built or bundled.
  launchd/
    com.sporthouse.previews.plist     — hourly heartbeat LaunchAgent
    com.sporthouse.previewjobs.plist  — 60-second poller LaunchAgent
supabase/
  migrations/
    0001_user_prefs.sql       — user_prefs: user_id (uuid PK), team_ids (text[]),
                                updated_at; RLS: each user sees only their own row
    0002_game_previews.sql    — game_previews: game_id (text PK), payload (jsonb NOT NULL),
                                model (text NOT NULL), news_fingerprint (text nullable),
                                updated_at (timestamptz); RLS SELECT using(true) + GRANT
                                SELECT to anon/authenticated; no write policies (service-role only)
    0003_preview_jobs.sql     — preview_jobs: id (bigint identity PK), team_id (text NOT NULL),
                                status (text, default 'pending'; values: pending/processing/done/
                                failed), attempts (int, default 0), error (text nullable),
                                created_at/updated_at (timestamptz); partial unique index
                                (team_id) WHERE status='pending' prevents duplicate queuing;
                                RLS enabled, no policies — browser client excluded entirely
```

---

## 4. Core data flow

```
Auth identity (anon or signed-in) ─owns─▶ user_prefs row (Supabase, RLS) ◀─sync─ localStorage cache
                                                                                      │
Onboarding ─saveFollowedTeams()─▶ writes localStorage + CURRENT identity's row        │ getFollowedTeams()
                                                                                      ▼
                              Dashboard / Schedule / Results ─per-team fetch─▶ /api/* ─▶ ESPN/Squiggle
                                                               │
                                                        /api/ai-preview ─▶ Supabase game_previews read
                                                        /api/ai-review  ─▶ Ollama (on-read, cached)
```

### Preview generation pipeline (Mac mini → Supabase → Vercel)

Pre-generated previews are the primary AI-preview path. No Ollama runs on Vercel.

**Two triggers:**

| Trigger | Script | launchd agent | Interval | Log (stdout) |
|---------|--------|--------------|----------|-----|
| Hourly heartbeat | `npm run warm` | `com.sporthouse.previews` | 3600 s | `/tmp/sporthouse-previews.log` |
| On-follow ping | `npm run poll` | `com.sporthouse.previewjobs` | 60 s | `/tmp/sporthouse-previewjobs.log` |

Both agents also write generation detail to `/tmp/sporthouse-ai.log` via `aiLog()`.
Both share the file lock `/tmp/sporthouse-generation.lock` (from `lib/generation-lock.ts`)
to prevent concurrent Ollama calls — whichever acquires the lock first runs; the other
exits cleanly and retries next tick.

**Lifecycle (heartbeat path — `src/lib/preview-lifecycle.ts`):**

`decideForTeam(teamId, allFixtures, existingRows, now)` — pure, no I/O.
Returns `{ fixture, action: 'initial' | 'regen-48' | 'regen-24' } | null`.

Constants (all from `preview-lifecycle.ts`):
- `SETTLE_BUFFER_HOURS = 4` — wait this long after the prior fixture's kickoff before
  generating the initial preview for the next one (prevents previewing while a just-finished
  match is still settling). Season openers (no prior fixture) skip the buffer.
- `REGEN_MARKS_HOURS = [48, 24]` — regen fires once per mark: when `now ≥ kickoff − mark`
  AND `row.updated_at < kickoff − mark`. Stateless — determined purely from `updated_at`.
- `LOOKAHEAD_DAYS = 14` — only fixtures within this window are candidates.
- `LOOKBACK_DAYS = 3` — completed fixtures within this window are fetched so the settle
  buffer can check the prior result date.

**Candidate roster:**

`getDistinctFollowedTeamIds()` (in `lib/followed-teams-server.ts`) queries ALL `user_prefs`
rows via the admin client and unions their `team_ids` arrays. This includes every identity
that has ever followed a team — permanent accounts, active anon sessions, and orphaned anon
rows (see §10). The generator's candidate set is therefore **the whole user base's follows
pooled**, not per-user. This is intentional: generate what any real user might want to see.

**Leagues generated (heartbeat):**

```typescript
// scripts/generate-previews.ts
const LEAGUES = ['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1', 'world_cup', 'nba'];
```

`npm run warm:force` — bypasses `decideForTeam`, regenerates every followed team's next
fixture regardless of freshness. Use after significant prompt changes (see §13).

**On-follow ping:**

When a user follows a team, `POST /api/warm-team` (auth-gated, returns 202 immediately):
- Inserts `{ team_id, status: 'pending' }` via service-role admin client.
- The partial unique index on `(team_id) WHERE status='pending'` silently swallows
  duplicate follows (23505 unique_violation swallowed at the route level).

`scripts/poll-jobs.ts` (`npm run poll`) picks up the job within one 60-second tick:
- BATCH=5, STALE_MINUTES=10 (reclaim stale `processing` rows), MAX_ATTEMPTS=3.
- Flow: Ollama reachable? → acquire lock → reclaim stale → fetch pending (oldest first) →
  atomic claim → find next fixture → check `game_previews` (skip if fresh) → generate →
  mark done or failed.
- Expected latency from follow to preview: **~1–1.5 minutes** (not instant; one tick plus
  generation time).

**launchd gotcha (nvm + working directory):**

launchd starts agents in a minimal bash environment — no login shell, no `.zshrc`, no nvm
in PATH. Both plists use this pattern in `ProgramArguments`:
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" \
  || export PATH="/Users/andreasjenkins/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /Users/andreasjenkins/Documents/SportHouse && npm run <warm|poll>
```
And set `WorkingDirectory` to the project root (required for `.env.local` loading and
`@/` path aliases to resolve). Exit code 127 = npm/node not found; check the nvm path.

---

## 5. Real data sources (live)

| League | Fixtures / Results | Standings | News / Extras |
|--------|-------------------|-----------|----|
| AFL | Squiggle `?q=games;year=YEAR` | Squiggle `?q=standings` | Squiggle `?q=tips;game=ID` |
| NRL | ESPN rugby-league scoreboard | ESPN v2 rugby-league standings | ESPN team news |
| EPL | ESPN soccer scoreboard (5 comps fan-out) | ESPN v2 soccer standings | ESPN team news |
| Super Rugby | ESPN | ESPN | ESPN |
| Test Rugby | ESPN | — | — |
| F1 | Jolpi Ergast calendar | Jolpi Ergast results | grid data |
| BBL / Cricket Int | ESPN cricket | — | — |
| **NBA** | **ESPN basketball/nba scoreboard** (`fetchNBAFixtures`) | mock | mock |
| **FIFA World Cup** | **ESPN soccer/fifa.world scoreboard** (`fetchWorldCupFixtures`) | group table in context | — |
| NHL / MLB | **mock-data.ts** | mock | mock |

- **AFL/Squiggle** matches by exact team name. All 18 names verified; `afl-giants` = "Greater
  Western Sydney" (was wrongly "GWS Giants" → returned nothing; fixed previously).
- **ESPN public API** — no key; EPL routes fan out across 5 competitions.
- **NBA** is real ESPN data — `fetchNBAFixtures` exists in `league-fixtures.ts`, `nba` is in
  `REAL_DATA_LEAGUES` and in the generator's `LEAGUES`. NHL/MLB have no fetcher and remain mock.
- **World Cup** is real ESPN data — `fetchWorldCupFixtures` fetches from `soccer/fifa.world`
  scoreboard; `world_cup` is in `REAL_DATA_LEAGUES` and the generator's `LEAGUES`.
- Caching: results routes set `Cache-Control: public, max-age=300, stale-while-revalidate=3600`
  and `next: { revalidate }` on upstream fetches. Scoreboard pre-warming runs at server startup
  via `instrumentation.ts` (same `revalidate: 3600` — shares cache entries with the results route).
- **AI previews** are pre-generated by Ollama on the Mac mini, stored in `game_previews`, and
  read by Vercel via `/api/ai-preview` (no generation cost at read time).
- **AI reviews** are generated on-read by Ollama on Vercel (the review panel triggers generation;
  indefinitely cached per game key).

---

## 6. Design system / UI conventions

- **Obsidian base** (`#080809`) with layered radial-gradient washes in `body` (globals.css).
  Left wash is team-adaptive via `--bg-left-color`.
- **Glass surfaces:** `.glass`, `.glass-strong`, `.glass-hero` — translucent white + backdrop
  blur + cool-amethyst borders. (Note: a `backdrop-filter` ancestor becomes the containing
  block for `position:fixed` descendants — the auth modal is `createPortal`ed to `<body>` to
  escape the navbar's blur for correct full-screen centering.)
- **Team theming:** each team's `primaryColor`/`secondaryColor` drives borders/glows/tints
  **inline via `style`** (no CSS-in-JS).
- **Color convention:** newer pages (schedule, results) use `white/xx` opacity tokens; the
  dashboard still uses the older `zinc-*` palette (see §10).
- **Animations:** `drift`, `drift-slow`, `pulse-ring`, `slideDown`; `float-hover`;
  `smoothScrollTo()`. `prefers-reduced-motion` collapses these to ~0ms at their final frame.

---

## 7. Auth & persistence

### Phase 1 — foundation (live)
Anonymous Supabase identity + RLS. Every visitor gets a real `auth.uid()` (minted client-side
on first load); their followed teams persist to a per-identity `user_prefs` row behind the
unchanged synchronous `user-prefs.ts` interface. Degrades to localStorage-only when Supabase
env vars are unset.

### Phase 2 — real login (SHIPPED, live in prod)
Real login via **Google OAuth** and **email magic-link** — `signInWithOAuth` /
`signInWithOtp`, **not `linkIdentity`**. Server session plumbing: `middleware.ts` refreshes
the cookie session (refresh-only — never mints anon server-side), `auth/callback/route.ts`
does the PKCE `exchangeCodeForSession`.

**TWO INDEPENDENT TEAM SPACES** (the defining model):
- **Guest (anonymous):** device-local picks, zero-friction, no forced login, no gated content.
- **Account (signed-in):** the user's team list in Supabase, **synced across devices**.

The active followed-teams cache is **owned by the current identity** and **RELOADED (replace,
never merge)** on any auth change (`reconcileActiveIdentity` in `user-prefs.ts`, serialized in
`<PrefsSync/>` via `reconcileInFlight` to absorb the `INITIAL_SESSION`+`SIGNED_IN` double-fire):
- **Sign in →** LOAD the account's row into the cache (empty account → empty list).
- **Sign out →** RESTORE the device-local guest picks (`restoreGuestSession`) + re-mint a fresh
  anon session.
- Each identity writes **only its own** `user_prefs` row — **no cross-identity push**, so one
  identity's set can never clobber another's.

**No anon→account merge.** An earlier iteration merged guest picks into the account on sign-in;
it required a `linkIdentity` conversion that hit `identity_already_exists` and a race-prone
cross-identity reconcile that could clobber/blank rows. We **removed the merge**: cross-device
sync is preserved (the real feature); one-time guest→account carryover is dropped as a
deliberate simplification. Trade-off: signing in doesn't preserve the anon UUID (the anon row
is orphaned — see §10).

**UI:** navbar shows a "Sign in to sync across devices" pill when anonymous, or the account
email + Sign out when signed in (reacts to auth changes with no reload). Sign-in is a glass
modal, opt-in only.

### AI-route gating (current state)

| Route | Gate | Notes |
|-------|------|-------|
| `/api/ai-preview` | **None** | `game_previews` has `SELECT using(true)` + `GRANT SELECT to anon`; auth gate was removed because the route no longer generates (Ollama runs on the Mac, not Vercel). Removing the gate fixed "Preview being prepared…" for Vercel visitors whose session cookie had expired. |
| `/api/ai-review` | **Session or CRON_SECRET** | Still gates because reviews are generated on-read by Ollama on Vercel — any valid session (anon included) passes; `x-cron-secret` header bypasses for the cron poller path. |
| `/api/warm-team` | **Session required** | Enqueues preview jobs; gated to prevent open abuse. |

---

## 8. Key decisions & gotchas

- **OAuth/magic-link `redirectTo` MUST stay query-less** (`${origin}/auth/callback`, no
  `?next=`). Supabase matches `redirectTo` against its allow-list by **exact URL**; a query
  string fails to match and silently **falls back to the Site URL** (prod domain), bouncing
  localhost/preview sign-ins away unauthenticated. The post-sign-in landing (`/schedule`) is
  chosen server-side in the callback, not carried in the URL.
- **Supabase URL config:** Site URL = prod domain. Redirect allow-list = `/auth/callback` for
  **localhost:3001 + prod + the preview wildcard** (`https://*-<scope>.vercel.app/auth/callback`).
- **Sign-in, never link:** using `signInWithOAuth`/`signInWithOtp` (not `linkIdentity`) means
  the `identity_already_exists` class cannot occur and new/existing accounts share one path.
  ("Allow manual linking" in Supabase is now irrelevant.)
- **AI cost model — Ollama is free at generation time.** Previews are generated locally on the
  Mac mini (no Anthropic token cost). Reviews are also generated via Ollama. The only
  Anthropic usage is `scripts/eval-previews.ts`, a dev-only offline harness that requires
  `ANTHROPIC_API_KEY` and is never deployed. Cost protection for the review route (which does
  run Ollama on Vercel) is two-layer: (1) **Vercel WAF rate-limit** (Fixed Window, per-IP,
  100 req / 60s, `429`, matching `^/api/ai-(preview|review)$`) and (2) the **auth gate** on
  `ai-review` (session-less callers get `401` before any Ollama call).
- **One Supabase project for prod + local** (for now) — local/test writes share the prod DB.
  Consider a separate prod project later.
- **NRL fetch-cache overflow** — the rugby-league scoreboard payload (~3.5–6.2 MB) exceeds
  Next's 2 MB fetch-cache limit, so NRL data is fetched fresh each load. Fix: narrow the date
  window/limit, trim the payload before caching, or use a custom cache for NRL.

---

## 9. Next build — design / QoL pass

The auth roadmap (Phase 1 → Phase 2 → AI-route gating) is **complete**. The preview
generation pipeline (local Ollama + Supabase + launchd) is **complete and running**. The next
focus is a **design / QoL pass**:

- **Dashboard palette unification** — migrate the dashboard's legacy `zinc-*` palette to the
  app's `white/glass` system (§10).
- **Navbar account avatar `<img>` → `next/image`** (§10).
- Other small polish surfaced along the way.

---

## 10. Known limitations / outstanding setup

- **Prod email magic-link sign-in is disabled** — custom SMTP is not configured in Supabase,
  so the email login option doesn't work on the live site (Google OAuth covers prod sign-in).
  Tracked as low-priority — see §11.
- **Orphan anonymous `user_prefs` rows accumulate** — signing in starts a separate account
  identity, so each anon row is abandoned; cross-device sign-ins also leave throwaway anon
  rows. Relevant to the generator: `getDistinctFollowedTeamIds` unions ALL rows including
  orphans, so the generation roster can include teams no active user currently follows. This
  is a feature (belt-and-suspenders coverage) but causes mild over-generation. Cleanup
  deferred — run Supabase's orphaned-anonymous-user SQL via pg_cron on a schedule.
- **Follow-persistence gap (diagnosed, not a bug).** `getDistinctFollowedTeamIds` is correct
  — it returns exactly the union of all rows. If a user perceives a "missing" team in their
  dashboard that doesn't appear in the generator's roster, it was followed in a pure-
  localStorage session that was never synced to Supabase (anon session expired before
  reconciling, or on a different device that never uploaded). The gap is at the client-sync
  layer, not the aggregation layer.
- **NHL/MLB still mock** — no fixture fetchers exist for these leagues; they use
  `mock-data.ts`. `REAL_DATA_LEAGUES` does not include `nhl` or `mlb`.
- **Round-complete lifecycle gate deferred** — the settle buffer (`SETTLE_BUFFER_HOURS=4`)
  approximates "prior match has settled" by waiting N hours after the prior kickoff. A more
  precise gate would check `completed: true` on the prior fixture row. Not yet implemented.
- **International cricket coverage** — `cricket_int` fixtures are series-ID-driven; only
  `int-aus` has configured tours, so other national teams show little until ESPN series IDs
  are added as bilateral tours are announced. Data-coverage limitation, not a mapping bug.
- **AI review 500 on non-JSON model output** — `ai-review/route.ts` parses the model's text;
  a malformed reply throws → 500 → "Review unavailable". Mitigated by a single retry in the
  route. Fix via structured output or assistant-prefill (`{`).
- **ESPN `as any` rollout** — the `match-stats` typing pilot proved the pattern; ~270 casts
  remain across the larger routes. Roll out to the less-defensive ones first.
- **Dashboard palette** — still legacy `zinc-*` vs the app's `white/glass` system.
- **Navbar account avatar `<img>` → `next/image`** — cosmetic lint.
- **Double `getUser()` per ai-review request** (low priority) — the gated `ai-review` route
  calls `getUser()` at the route level in addition to the middleware's `getUser()` on `/api/*`.
  Fine at this scale.
- **Large files to watch** (navigability, not bugs): `preview/route.ts` ~1.6k ·
  `game-expand-panel.tsx` ~1.4k · `schedule/page.tsx` ~1.4k · `fixtures/route.ts` ~1.3k.

---

## 11. Roadmap

1. **Design / QoL pass** *(next build — §9)* — dashboard palette unification, navbar
   `<img>`→`next/image`, etc.
2. **NHL/MLB real data** — add fixture fetchers to `league-fixtures.ts`; add to
   `REAL_DATA_LEAGUES` and the generator `LEAGUES` (same path as NBA).
3. **Round-complete lifecycle gate** — replace the settle-buffer approximation with a check
   on `completed: true` from the fixture list.

- **[LOW PRIORITY] Configure custom SMTP** to enable email magic-link sign-in in production.
  Currently Google OAuth covers all sign-ins. Work involved: pick an email provider (Resend /
  SendGrid / Postmark / SES), add SMTP credentials to Supabase Auth settings, verify a
  sending domain. No app code changes — pure config.

---

## 12. Resolved this cycle (done — not carried as debt)

- **Auth Phase 2 shipped** — Google OAuth + email magic-link; two-team-spaces model (no merge);
  query-less redirect; navbar account state + sign-out; modal portaled to body. Live in prod.
- **AI-route gating shipped for reviews** — `/api/ai-review` gated behind any valid Supabase
  session (anon included) or CRON_SECRET, fail-closed. Vercel WAF rate-limit covers both AI
  routes. Completes two-layer cost protection for review generation.
- **`/api/ai-preview` auth gate removed** — route is now a public Supabase read (no session
  required). Removed because the route does no generation (Ollama runs on the Mac, not Vercel)
  and `game_previews` is explicitly anon-readable. Fix resolves "Preview being prepared…" for
  Vercel visitors with expired or absent session cookies.
- **Local Ollama preview pipeline shipped** — `scripts/generate-previews.ts` + `poll-jobs.ts`
  running under launchd on the Mac mini. Replaces on-read Claude with pre-generated previews
  served from Supabase. Lifecycle constants, settle buffer, and regen marks all verified.
- **On-follow ping shipped** — `preview_jobs` table + `/api/warm-team` + `scripts/poll-jobs.ts`
  + `com.sporthouse.previewjobs` launchd agent. ~1–1.5 min follow-to-preview latency.
- **NBA real data shipped** — `fetchNBAFixtures` (ESPN basketball/nba scoreboard) wired into
  `REAL_DATA_LEAGUES` and the generator `LEAGUES`. NBA Finals Game 6 preview generated on day
  of shipping.
- **FIFA World Cup integration shipped** — `fetchWorldCupFixtures` (ESPN soccer/fifa.world),
  48-team roster, group table in context panel, stage/group detection.
- **Coverage diagnostic shipped** — `npm run coverage` classifies every followed team as
  covered / missing / no-upcoming. Read-only, no writes.
- **AFL GWS mapping fixed** — `afl-giants` → "Greater Western Sydney".
- **My Teams pill-row stretch fixed** — `min-w-0` on the schedule/results left grid column.

---

## 13. Agent notes / preferences (from memory)

- **AI previews:** don't acknowledge small sample size / early-season hedging — redirect to
  useful content instead.
- **AI preview cache — two layers with different mechanics:**
  - **Server-side (previews):** none — `game_previews` is a live Supabase read on every
    request. Freshness is controlled by the Mac generator (lifecycle marks). No Next.js
    `unstable_cache` on the preview read path.
  - **Server-side (reviews):** `unstable_cache(['ai-review-v4'], { revalidate: false })` in
    `api/ai-review/route.ts`. Indefinite — once generated, the review never re-runs unless
    the cache key string `'ai-review-v4'` is bumped in the route file.
  - **Client-side (both):** `localStorage` key `ai-preview-v44:{gameId}` (14-day TTL, hits
    only — misses are never cached). Bump the version suffix to flush stale client entries.
- **Bumping prompt / refreshing previews:**
  - Preview content change → run `npm run warm:force` (regenerates all followed next-fixtures
    ignoring lifecycle marks).
  - Review content change → bump `'ai-review-v4'` → `'ai-review-v5'` in `ai-review/route.ts`
    and bump the localStorage version suffix, then redeploy.
