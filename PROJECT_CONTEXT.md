# SportHouse — Project Context

> A living architecture reference for SportHouse. Complements `CLAUDE.md` (agent-facing
> build/run instructions). This doc is the "why and how it fits together" overview plus a
> running log of decisions, the next build, and known limitations.
>
> Last updated: 2026-08-14

---

## 1. What it is

SportHouse is a personalized sports dashboard. A user picks the teams they follow (across
AFL, NRL, EPL, Super Rugby, Test Rugby, F1, BBL, International Cricket, and NBA), and the
app builds a tailored feed of fixtures, results, standings, news, and AI match previews.

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
      weather/route.ts        — Venue weather for fixtures (thin wrapper over lib/weather.ts)
      sandbox/                — DEV-ONLY: context (buildBlocks per-block) / models / generate —
                                powers the /sandbox prompt inspector
  components/
    ui/                       — button, card, badge, input, skeleton, team-badge, empty-state
    layout/navbar.tsx         — Fixed top navbar; active-link detection; mounts <AccountMenu/>
    auth/auth-modal.tsx       — Glass sign-in modal (Google + email magic-link), portaled to <body>
    auth/account-menu.tsx     — Navbar account entry: "Sign in" pill ↔ email + Sign out
    landing/hero-cta.tsx
    onboarding/team-selector-card.tsx
    dashboard/                — team-feed-card, game-card, news-item, recent-form
    schedule/                 — next-game-hero(+ -sh), schedule-calendar, game-expand-panel,
                                league-table(+ -sh), f1-starting-grid, sport-ball. The `-sh`
                                variants are the active `.sh-*` design-system skins (hero + sidebar
                                ladder); WcGroupBrowser (in game-expand-panel) renders WC groups
    results/result-expand-panel.tsx
    providers/prefs-sync.tsx  — invisible auth-state wiring: serialized per-identity reload on
                                INITIAL_SESSION/SIGNED_IN; guest restore + re-anon on SIGNED_OUT
  lib/
    teams.ts                  — LEAGUES + TEAMS (160+ teams, colors, metadata) +
                                REAL_DATA_LEAGUES (afl/epl/nrl/super_rugby/rugby_int/f1/bbl/
                                cricket_int/nba — NHL/MLB are NOT in this set)
    team-logos.ts             — TEAM_LOGOS (logo URLs) + TEAM_LOGO_FILTERS (CSS filters)
    espn.ts                   — shared ESPN/Squiggle helpers + ESPN response interfaces
    afl.ts                    — AFL Squiggle-name map + team table derived from teams.ts
    league-fixtures.ts        — fetchAFLFixtures / fetchNRLFixtures / fetchEPLFixtures /
                                fetchSRUFixtures / fetchRINTFixtures / fetchNBAFixtures /
                                fetchF1Fixtures / fetchBBLFixtures / fetchCricketIntFixtures;
                                unified dispatch fetchLeagueFixtures(league,
                                lookbackDays). lookbackDays > 0 includes recently-completed
                                fixtures so the generator can check the settle buffer.
    ai-model.ts               — AI_MODEL = process.env.OLLAMA_MODEL ??
                                'qwen3:30b-a3b-instruct-2507-q4_K_M'
    preview-lifecycle.ts      — Pure decideForTeam() logic; exports SETTLE_BUFFER_HOURS=4,
                                REGEN_MARKS_HOURS=[48,24], LOOKAHEAD_DAYS=14, LOOKBACK_DAYS=3
    preview-generator.ts      — generateAndStorePreview(), callOllama(), upsertPreview(),
                                isValidPreview(); validators (points / names / finals-imminence /
                                statlines / years / phase-stakes / ladder-position / F1 championship)
                                — retried once on violation; each validator carries an incident
                                comment linking it to the failure class that prompted it
    preview-prompt.ts         — prompt assembly: SYSTEM_PROMPT + buildDataBlock() + buildBlocks()
                                (sandbox twin) + collectPlayerWhitelist(); + DERIVED FACTS builders
                                (buildDerivedFacts / buildF1DerivedFacts). ~2.0k lines (see §10)
    competition-rules.ts      — SINGLE SOURCE OF TRUTH for per-comp, per-SEASON rules: COMP_RULES
                                (archetype, cutoffs, points, finals schedules) each tagged season +
                                source; finalsRoundForDate() names finals by date window (no feed stage)
    competition-structure.ts  — STRUCTURE (per-league structure type) + stakes/standings derivation;
                                reads cutoffs/points from competition-rules.ts (no scattered literals)
    competition-context.ts    — per-competition profile prose for the data block
    managers.ts               — current managers/coaches map (injected into the data block)
    preview-context.ts        — buildPreviewContext(): THE single context builder for all generation
                                paths; delegates to preview-fetchers; adds weather + managers +
                                derived facts
    preview-fetchers.ts       — shared per-league fetchers + fetchESPNMatchExtras() (form/H2H/lineups
                                from ESPN summary) + fetchCricketPreview() + fetchSOOPreview()
    cricketdata.ts            — cricketdata.org/CricAPI client (token-free; daily-quota cache, §5a)
    afl-roster.ts             — AFL.com named team lists (runtime WMCTok token; /tmp cache)
    weather.ts                — Open-Meteo kickoff weather (shared by /api/weather + generation)
    soo.ts                    — State of Origin: SOO_META + series-state derivation (shared)
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
                                'nba','cricket_int','bbl']. --force bypasses lifecycle.
  poll-jobs.ts                — On-follow poller: BATCH=5, STALE_MINUTES=10, MAX_ATTEMPTS=3.
                                Atomic claim → fixture lookup → existence-check dedup → generate.
  coverage-report.ts          — Read-only: classifies each followed team as covered / missing /
                                no-upcoming. No writes, no generation.
  check-team-coverage.ts      — Recurrence guard: every followable team resolves to a generation
                                identity (club/rep/dynamic); 0 GAPS required. NFL/MLB = unsupported.
  verify-sandbox-faithful.ts  — Proves the sandbox (buildBlocks) == prod (buildDataBlock) byte-for-
                                byte per fixture; covers afl/nrl/soo/epl/sru/rint/nba/f1/cricket.
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
const LEAGUES = ['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1', 'nba',
                 'cricket_int', 'bbl'];
```

`npm run warm:force` — bypasses `decideForTeam`, regenerates every followed team's next
fixture regardless of freshness. Use after significant prompt changes (see §13).

### Preview data block — the rich context (post-2026-06-12 enrichment)

The data block fed to the model is no longer the thin standings+news prompt. `buildPreviewContext`
(`src/lib/preview-context.ts`) is the **single context builder** used by all generation entry points,
delegating to the shared fetchers in `src/lib/preview-fetchers.ts`. Each preview now carries, where
available:

- **Recent form, head-to-head, last lineups** — `fetchESPNMatchExtras()` reads ESPN's `summary?event=`
  goldmine (`lastFiveGames` / `headToHeadGames` / `rosters[].roster`) for NRL/EPL/SRU/RINT/NBA/NHL.
  Lineups: `starter` flag for soccer/basketball, **jersey ≤13 (league) / ≤15 (union)** for rugby. AFL
  form+H2H from the Squiggle `games` array.
- **AFL squads/lineups** — `afl-roster.ts` (AFL.com / Telstra CFS; runtime `WMCTok` token, never
  stored; `/tmp` cache). Named team lists once selected (~Thu); suppressed pre-naming.
- **Cricket (BBL + internationals)** — `cricketdata.ts` (cricketdata.org / CricAPI); see §5.
- **Weather at kickoff** — `weather.ts` (Open-Meteo, no key); outdoor leagues, only when notable.
- **State of Origin** — rep teams `nrl-maroons`/`nrl-blues`; series state instead of a club ladder; see §5.

**Output validators** (`preview-generator.ts`, retried once on violation): points-claim,
finals-imminence, invented player names (whitelist from the data block), invented per-player
statlines, invented calendar years, **plus the derived-facts binders** — phase-stakes,
ladder-position, F1 championship (see "Derived-facts framework" below). Each validator
carries an incident comment in source.

**Faithfulness invariant (non-negotiable):** generation, the dev sandbox route (`/api/sandbox/context`
→ `buildBlocks`), and `scripts/verify-sandbox-faithful.ts` all build context via `buildPreviewContext`
and pass `[],[]` for positional results. Add new data to `PreviewContext`/`buildDataBlock` only — never
a parallel path — so prod and the sandbox stay **byte-identical** (verified per fixture).

**Dev prompt sandbox** — `/sandbox` page + `/api/sandbox/*` routes let you inspect/toggle the exact
per-block prompt and run generations; `buildBlocks` decomposes `buildDataBlock` into the same blocks.

**Recurrence guard** — `scripts/check-team-coverage.ts` asserts every followable team in `teams.ts`
resolves to a generation identity (club map OR rep map OR cricket-dynamic); NFL/MLB reported as
intentionally unsupported. Run after adding teams/maps; **0 GAPS required**.

### Derived-facts framework — pre-computed stakes/standings (post-2026-06-18, PR #12)

The model used to *derive* table positions, points-still-available, and finals stakes itself — the
root of the WC group-record conflation, F1 championship-gap, and Super Rugby "dead rubber" errors.
It now receives **PRE-COMPUTED "DERIVED FACTS"** blocks in the prompt and is told to bind prose to
them; validators reject any contradiction.

- **Single source of truth for rules** — `src/lib/competition-rules.ts` (`COMP_RULES`, keyed by
  league). Cutoffs, points systems, and finals schedules are **config, not literals** — each entry
  carries the `season` it was confirmed for and the `source`. This exists because AFL (8 → top-10
  wildcard) and Super Rugby (8 → 6) both changed format for 2026 and went **silently stale** under
  the old hardcoded literals in `preview-prompt.ts`/`competition-structure.ts`. **RE-CHECK each
  entry at its competition's season start.** `competition-structure.ts` (STRUCTURE) and the prompt
  builders read cutoffs/points from here.
- **Per structure-type computation** (builders in `preview-prompt.ts`):
  - **LEAGUE LADDER** — `buildDerivedFacts` (AFL tiers: top-6 direct / 7–10 wildcard / outside-10;
    NRL top 8; SRU top 6). **Phase-aware:** a finals decider resolves to GRAND FINAL stakes via
    `finalsRoundForDate` (date windows — the feed has NO stage label) and the regular-season ladder
    collapses to a seeding note.
    - **ONE canonical ladder order — the feed's own `position`.** `buildDerivedFacts`,
      `buildTableSection`, AND `computeCompetitionStatus` all sort by `position` (the live feed order,
      including the league's official tiebreakers). Do **NOT** re-derive the order from points +
      hardcoded tiebreakers — that reintroduces "rules from memory" staleness and could replace a
      correct feed order with a wrong one. **Rule: trust the feed's `position` for league ladders.**
    - **Authoritative `LADDER POSITION` fact (the 8→7 "occupy 7th" fix, 2026-06-28).** The first
      derived fact emits each fixture team's position verbatim — `LADDER POSITION … : Brisbane Lions
      — 8th of 18; Geelong — 4th of 18.` — so the model never infers the ordinal from a gap or a
      zone range. The ordinal LEADS its line (the AFL wildcard-band clause is phrased as a separate
      sentence) so an adjacent "7th–10th" band can't be read as the team's own position.
      `validateLadderPosition` binds the prose to it (below). Emitted for every ladder league
      (afl/nrl/epl/super_rugby/rugby_int/nba/nhl); the zero-points guard suppresses it pre-season.
  - **CHAMPIONSHIP POINTS (F1)** — `buildF1DerivedFacts`: per-rival gaps to the leader, exact win
    counts, conservative points-still-available.
  - **SERIES (State of Origin)** — `soo.ts` series-state. **Cricket / NBA / NHL** are commented
    `TODO` stubs in `COMP_RULES` (config present, no computation yet — §10).
- **Prose binds to facts; validators reject contradictions** (`preview-generator.ts`):
  `validatePointsClaims`, `validatePhaseStakes` (a Grand Final can't be a dead rubber),
  `validateLadderPosition` (prose ordinal for a fixture team must match the authoritative LADDER
  POSITION fact — tightly scoped to positional context, so "4-point lead"/"top 10"/"fourth straight
  win"/"third quarter" never fire; both-direction unit tests in `scripts/test-validators.ts`),
  `validateF1ChampionshipClaims`.
- **Faithfulness invariant preserved** — derived facts are added to `PreviewContext`/`buildDataBlock`,
  never a parallel path; `verify-sandbox-faithful` must stay byte-identical prod vs sandbox.

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

| League | Fixtures / Results | Standings | News / Extras + preview enrichment |
|--------|-------------------|-----------|----|
| AFL | Squiggle `?q=games;year=YEAR` | Squiggle `?q=standings` | Squiggle tips; **squads/lineups via AFL.com** (`afl-roster.ts`); form+H2H from Squiggle games |
| NRL | ESPN rugby-league scoreboard | ESPN v2 rugby-league standings | ESPN news + injuries; form/H2H/lineups via ESPN `summary` |
| **State of Origin** | ESPN rugby-league (NSW/QLD) | — (no club ladder) | rep teams `nrl-maroons`/`nrl-blues`; **series state** + form/H2H/lineups; `soo.ts` |
| EPL | ESPN soccer scoreboard (5 comps fan-out) | ESPN v2 soccer standings | ESPN news + injuries; form/H2H/lineups via ESPN `summary` |
| Super Rugby / Test Rugby | ESPN | ESPN | injuries + form/H2H/lineups via ESPN `summary` |
| F1 | Jolpi Ergast calendar | Jolpi Ergast results | grid / recent races (own data block) |
| **BBL / Cricket Int** | **cricketdata.org / CricAPI** (`cricketdata.ts`) | series state | match context, toss, named squads, series form/H2H (ESPN/cricinfo cricket is WAF-blocked → keyed API) |
| NBA | ESPN basketball/nba scoreboard | ESPN | news + injuries + key performers; form/H2H |
| NHL | ESPN hockey/nhl (offseason) | ESPN | form/H2H/lineups via ESPN `summary` |
| MLB | **mock-data.ts** | mock | mock |
| Weather | Open-Meteo (`weather.ts`) — outdoor leagues, kickoff hour, shown only when notable |

- **AFL/Squiggle** matches by exact team name (`afl-giants` = "Greater Western Sydney"). AFL **squads**
  now come from AFL.com (Squiggle's squad feed returns null) — runtime token, named ~Thursday.
- **Cricket = cricketdata.org**, not ESPN (every ESPN/cricinfo cricket endpoint is WAF-blocked
  server-side). Free tier = 100 hits/DAY → aggressive in-process + cross-run `/tmp` caching + a
  daily-quota circuit breaker. See §5a.
- **ESPN `summary?event=`** is the shared enrichment source (form/H2H/lineups) across all ESPN sports.
- **NBA / NHL** are real ESPN data and in the generator's `LEAGUES`. Only **MLB** (and
  effectively NFL, which has no fetcher) remain mock.
- Caching: results routes set `Cache-Control: public, max-age=300, stale-while-revalidate=3600`
  and `next: { revalidate }` on upstream fetches. Scoreboard pre-warming runs at server startup
  via `instrumentation.ts` (same `revalidate: 3600` — shares cache entries with the results route).
- **AI previews** are pre-generated by Ollama on the Mac mini, stored in `game_previews`, and
  read by Vercel via `/api/ai-preview` (no generation cost at read time).
- **AI reviews** are generated on-read by Ollama on Vercel (the review panel triggers generation;
  indefinitely cached per game key).

### 5a. Cricket via cricketdata.org (CricAPI)

`CRICKETDATA_API_KEY` required. Free tier = **100 hits/DAY** (not feature-gated). `cricketdata.ts`
caches every call in-process **and** cross-run on `/tmp` (currentMatches 3h, series_info 6h, match_info
30m, squad 6h); a non-success quota status trips a circuit breaker. Fixtures: `buildCricketFixtures`
(one shared `currentMatches` + bounded `series_info` expansion). Preview: `fetchCricketPreview`
(match_info + match_squad + series_info) → dedicated cricket data block (F1-style early return). IDs:
`cint-<matchId>` / `bbl-<matchId>` (cricketdata UUID). `fetchCricketFixtureById` resolves a single match
for the sandbox/verifier. **Dormant for tracked teams off-season** (men's between series, BBL summer) —
same as EPL/NBA/NHL off-season; the path is verified against live matches.

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

The auth roadmap (Phase 1 → Phase 2 → AI-route gating) is shipped. The preview generation
**infrastructure** (local Ollama + Supabase + launchd) is shipped and running — but it is **not
"done"**: a substantial **preview-data enrichment cycle** landed on top of it (recent form,
head-to-head, lineups, weather, cricket via cricketdata.org, AFL squads via AFL.com, State of Origin
rep teams, the prompt sandbox + faithfulness invariant, and the team-coverage recurrence guard),
**followed by the derived-facts framework** (config-driven per-season rules + pre-computed
stakes/standings + prose-binding validators — PR #12) and a **World Cup head-to-head / group-record
correctness cycle** (see §4, §5, §12). Enrichment + derived-facts are ongoing per-sport (cricket /
NBA / NHL stakes are still `TODO` stubs — §10). The other current focus is a **design / QoL pass**
(the schedule sidebar-ladder fixes in §12 are part of it):

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
- **Derived facts not yet computed for cricket / NBA / NHL** — they are commented `TODO` stubs in
  `COMP_RULES` (`competition-rules.ts`): the rule scaffolding is named (BBL 2pts/win + NRR; NBA
  top-6-direct + play-in; NHL division-top-3 + wildcards) but no stakes/standings are computed for
  them yet. Previews for these still generate; they just don't get a DERIVED FACTS block. Wire each
  at its season start (re-confirm the cutoffs then).
- **Round-complete lifecycle gate deferred** — the settle buffer (`SETTLE_BUFFER_HOURS=4`)
  approximates "prior match has settled" by waiting N hours after the prior kickoff. A more
  precise gate would check `completed: true` on the prior fixture row. Not yet implemented.
- **Date-window phase inference is brittle for AFL/NRL finals.** `finalsRoundForDate`
  (`competition-rules.ts`) maps a fixture to a finals round by date window — clean for Super Rugby
  (one finals game per week) but **ambiguous for AFL/NRL finals** (multiple games per week, and
  reschedules can push a game out of its window). The feed carries no stage label, so there's no
  authoritative fallback. **Revisit before the September finals** (e.g. tighten the windows, or
  find a per-fixture stage signal).
- **`verify-sandbox-faithful` proves byte-identical only at the same fetch instant.** It rebuilds
  prod and sandbox context back-to-back, but **live-data races** (the F1 Squiggle model tip,
  Open-Meteo wind) can make two fetches differ, producing a transient sandbox≠prod diff that clears
  on re-run. A real regression could in principle co-occur with such a race. **Re-run before
  treating a single diff as a regression** — only a diff that persists across runs is real.
- **Cricket coverage is quota-bounded** — cricketdata.org free tier is 100 hits/day; the client
  caches hard (`/tmp`, per-type TTL) and a circuit breaker stops calls if the quota trips. Tracked
  men's/BBL teams are dormant off-season (women's WC isn't a tracked team). Data/season limitation,
  not a wiring bug — the path is verified against live matches.
- **NRL injuries not wired (walled)** — nrl.com casualty ward is an editorial article; the
  match-centre `/data` carries no injury fields and `/teamlist/data` returns the SPA shell. No clean
  structured endpoint, so no scraper was shipped; team-news headlines surface injuries editorially.
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
- **Large files to watch** (navigability, not bugs): `preview-prompt.ts` ~2.0k ·
  `preview-fetchers.ts` ~2.2k · `game-expand-panel.tsx` ~1.8k · `schedule/page.tsx` ~1.6k ·
  `fixtures/route.ts` ~1.4k. (`preview-prompt.ts` still holds per-structure-type derived-facts
  builders — a future split into engine modules is planned as part of the derived-facts rebuild.)
- **EPL all-comps form label — fixed (2026-08-16).** ESPN's `lastFiveGames` for EPL teams
  mixes PL + FA Cup + EFL Cup + European results. `preview-prompt.ts` now labels EPL league
  fixture form as `RECENT FORM — all competitions …` (same path as `isOffLeague`). The deeper
  fix — league-filtered form as default with an all-competitions toggle — requires
  `mapEspnGame` in `preview-fetchers.ts` to extract competition context per result (`GameResult
  .competition` field already exists but is unpopulated). See §11 roadmap.

---

## 11. Roadmap

1. **Derived-facts framework rebuild** *(in design — see `DERIVED_FACTS_FRAMEWORK.md`)* —
   root-and-branch rebuild: `CompetitionSpec` type system, `deriveFacts` engine, `FactSet`
   persistence, sectioned generation, generic validators, evaluation harness. AFL end-to-end
   first; then NRL/SRU, EPL, F1/SOO; then NBA/BBL/cricket. Phase 0 (corpus + baseline)
   running now.
2. **Competition-tagged form (EPL)** — extend `mapEspnGame` in `preview-fetchers.ts` to
   extract competition context per `lastFiveGames` entry into `GameResult.competition`
   (field already typed, not yet populated). Then: AI prompt emits league-only form as
   primary, all-comps as secondary; UI game-expand panel gets a subtle toggle between the
   two views. EPL label fix already shipped (2026-08-16) as an interim measure. Note: Super
   Rugby franchises are club-only entities (never Test nations) so their form feed is
   SRU-only and needs no equivalent treatment.
3. **Design / QoL pass** *(§9)* — dashboard palette unification, navbar `<img>`→`next/image`.
4. **NHL/MLB real data** — add fixture fetchers; add to `REAL_DATA_LEAGUES` and generator
   `LEAGUES` (same path as NBA).
5. **Round-complete lifecycle gate** — replace the settle-buffer approximation with a check
   on `completed: true` from the fixture list.
6. **Derived facts for cricket / NBA / NHL** — promote the `COMP_RULES` `TODO` stubs to live
   computation (BBL NRR + finals; NBA play-in; NHL wildcards), each at its season start.

- **[LOW PRIORITY] Configure custom SMTP** to enable email magic-link sign-in in production.
  Currently Google OAuth covers all sign-ins. Work involved: pick an email provider (Resend /
  SendGrid / Postmark / SES), add SMTP credentials to Supabase Auth settings, verify a
  sending domain. No app code changes — pure config.

---

## 12. Resolved this cycle (done — not carried as debt)

### World Cup feature removed (2026-08-14, commit 158b97f)
- **Full deletion** — not moth-balled. Removed: `world-cup.ts`, `WcGroupBrowser`,
  `WC_TEAM_GROUPS`, `WC_ID_TO_ESPN_NAME`, all WC-specific derived-facts builders
  (`buildWorldCupGroupFacts`, `rankWorldCupGroup`, `makeWCH2H`), validators
  (`validateWCKnockoutStakes`, `validateWorldCupGroupRecord`, `validateWorldCupGroupLetter`),
  `worldCupCtx` param from `resolveCompetitionContext`, `world_cup` from `LEAGUES` and
  `BROWSABLE_LEAGUE_IDS`. TypeScript build clean post-removal. 39 files changed, −3,184 lines.
- **Lesson preserved, not deleted:** the all-comps form conflation error (mixing
  all-competitions form with competition-specific record) is live in EPL today — logged in
  §10 as a live defect. The `ArithmeticSanity` and `ScopeViolation` generic contracts in the
  derived-facts rebuild subsume the WC-specific validators.

### Derived-facts framework (2026-06-18, PR #12 — Phases A–C)
- **Config-driven per-season rules** — `competition-rules.ts` (`COMP_RULES`) became the single
  source of truth for cutoffs/points/finals schedules, each tagged `season` + `source`. Caught the
  silently-stale AFL (8 → top-10 wildcard) and Super Rugby (8 → 6) 2026 format changes.
- **Pre-computed DERIVED FACTS in the prompt** — per structure type: LEAGUE LADDER (phase-aware,
  finals-by-date), GROUP TOURNAMENT (WC re-rank + H2H), CHAMPIONSHIP POINTS (F1 gaps), SERIES (SOO).
  Replaces model self-derivation — the root cause of group-record / championship-gap / dead-rubber
  errors. (See §4 "Derived-facts framework".)
- **Prose-binding validators** — `validatePhaseStakes`, `validateWorldCupGroupRecord`,
  `validateF1ChampionshipClaims` join the existing points/name/year/statline validators; each
  retried once. Faithfulness invariant preserved (sandbox == prod byte-for-byte).

### World Cup head-to-head + group-record cycle (2026-06-18 → 22, on `main`)
- **2026 H2H-first tiebreaker activated** — completed intra-group results sourced from the ESPN
  `/scoreboard` endpoint (`_wcGroupResults`) feed `makeWCH2H`; not-met pairs fall back to GD.
  **Wired + unit-proven, but the live override is unexercised:** the natural path (two teams level
  on points who have met decisively) cannot occur until matchday 2, so it has not yet flipped a
  real fixture's order — only a synthetic test (`scripts/test-validators.ts`).
- **Group-record conflation fixed at the source** — an earlier fix wrongly *suppressed* the
  all-competitions RECENT FORM for WC group games; that was **reverted** (46596ed). Form is **kept**
  and **relabelled "RECENT FORM — ACROSS ALL COMPETITIONS"** (momentum/context only); every
  group-record/qualification claim binds to GROUP DERIVED FACTS, backstopped by the group-record
  **arithmetic validator** (results-claimed ≤ games-played).
- **Group standings sorted for display** — leader on top (points → GD → goals), since the feed's
  `position` is draw/seeding order, not the live standing.

### Loose-end cleanup: group-letter binding + name-validator precision (2026-06-24, branch `fix/wc-group-binding`)
- **WC group-letter binding (Fix 1)** — wc-760443 (Turkey v Paraguay, Group D) had previewed as
  "Group F". Investigation showed the letter was **absent**, not mis-bound: a **name-variant
  mismatch** dropped the *entire* WC group context. ESPN's WC feeds return **"Türkiye"** while our
  TEAMS name is **"Turkey"**, so `_wcGroupForTeam` (which matched the group by exact ESPN
  `displayName`) found nothing → `ctx.worldCup` came back `undefined` → the whole group block
  (standings, GROUP DERIVED FACTS, **and** the H2H results) was omitted and the model invented the
  group. Fix:
  - **`preview-context.ts`** — locate the group by its **letter** (deterministic from
    `WC_TEAM_GROUPS`, name-independent) and **normalise every ESPN name to our canonical TEAMS
    name** (`_canonicalWCName`) across group rows AND completed group results, so the rows, the
    H2H provider, the `groupTeams` set, and the downstream `teamName`/`opponentName` comparisons
    all key on one convention. This also restored the previously-empty `worldCup.groupResults`
    (H2H) for Turkey.
  - **`world-cup.ts`** — `WC_ID_TO_ESPN_NAME['wc-turkey']` now keeps **"Türkiye"** (the exclusion
    list wrongly kept "Turkey"), so the ESPN `summary` extras path (form/H2H/lineups) also resolves.
  - **`preview-prompt.ts`** — an emphatic `THIS FIXTURE IS IN GROUP D` line at the top of the WC
    block (belt-and-suspenders for the binding-gap case), plus the conservative
    **`validateWorldCupGroupLetter`** backstop (rejects a different group letter for this fixture;
    allows the correct one and best-third cross-group references).
  Verified by an 8× generation spread (see report).
- **`validatePlayerNames` precision (Fix 2)** — stopped two false positives that burned retries:
  the possessive "Group D's" (added `group` to the safe-word set + treat single-letter tokens like
  the group letter as non-evidence) and F1 driver/constructor names (already seeded from the
  standings whitelist in 97d93da — confirmed working, no change needed). A genuinely invented
  player name is still rejected — both directions covered by `scripts/test-validators.ts`.

### Schedule sidebar / ladder UI (2026-06-22 → 23, branch `fix/wc-group-binding` — browser-verified, committed, NOT yet merged/deployed)
- **Hero-open now reveals the league table** — on the desktop "all teams" view, opening the next-game
  hero resolves standings to the hero game's league and shows the sidebar ladder (`standingsLeague`
  + `standingsTableLeague` + the visibility gate now account for `heroExpanded`; the standings hooks
  moved below the `heroGame` memo to satisfy declaration order). WC heroes still hide the sidebar
  duplicate (the in-panel group table shows instead).
- **`LeagueTableSh` fits any sport without a scrollbar** — switched to `table-layout: fixed`: the
  team column flexes/truncates, numeric columns get defined widths, rank↔team gap and a small `%`/
  `Pts` edge inset restored (the base `.sh-standings td` padding shorthand had been outranking the
  single-class rules).
- **Status:** browser-verified this cycle (dev server, AFL ladder) and committed on the branch
  (`4c78d6d`); **not yet merged to `main` or deployed** — ships with this branch.

### Preview-data enrichment cycle (2026-06-14 → 17, branch `feat/preview-data-wiring`)
- **Rich context wired** — recent form, head-to-head, last lineups via one shared ESPN `summary`
  extractor (NRL/EPL/SRU/RINT/NBA/NHL/WC); + kickoff weather (Open-Meteo). Replaced the thin
  standings+news prompt. `preview-context.ts` is the single builder.
- **Cricket (BBL + internationals)** — via cricketdata.org/CricAPI (ESPN cricket WAF-blocked);
  daily-quota-aware caching; dedicated cricket data block.
- **AFL squads/lineups** — via AFL.com (Telstra CFS) runtime token; Squiggle squads were null.
- **State of Origin** — rep teams generate previews (series state, one generation mirrored to both
  perspective keys); shared `soo.ts`; fixed the `wc-iran` mapping bug surfaced by the guard.
- **Output guardrails** — invented-statline + invented-year validators; player-name whitelist
  extended to lineups/squads/key-performers; prompt guidance for diversity + no-redundancy.
- **Prompt sandbox + faithfulness** — `/sandbox` + `verify-sandbox-faithful.ts` prove sandbox ==
  prod byte-for-byte; **recurrence guard** `check-team-coverage.ts` (0 GAPS) prevents followable
  teams from silently lacking a generation identity.

### Earlier this cycle
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

- **This file is the canonical "project context".** When asked to "update project context", update
  THIS file (`PROJECT_CONTEXT.md`) fully — all affected sections — and bump the `Last updated:` date.
  Keep `CLAUDE.md` (build/run instructions) in sync too, but this doc is the one meant.
- **World Cup feature is deleted** (2026-08-14) — no `world_cup` league, no WC teams, no WC
  validators, no `world-cup.ts`. Do not re-add or reference WC infrastructure.
- **AI previews — sample-size note (rescoped):** the "don't acknowledge small sample size"
  guidance is specifically about **season-aggregate stats** (ladder position, for/against trends,
  win rates) early in a season — don't hedge those into uselessness; redirect to useful content.
  It is **not a blanket ban on hedging** — couched, well-grounded speculation about the fixture
  ("if X starts, expect…") is fine and often the point.
- **AI preview cache — two layers with different mechanics:**
  - **Server-side (previews):** none — `game_previews` is a live Supabase read on every
    request. Freshness is controlled by the Mac generator (lifecycle marks). No Next.js
    `unstable_cache` on the preview read path.
  - **Server-side (reviews):** `unstable_cache(['ai-review-v4'], { revalidate: false })` in
    `api/ai-review/route.ts`. Indefinite — once generated, the review never re-runs unless
    the cache key string `'ai-review-v4'` is bumped in the route file.
  - **Client-side (both):** `localStorage` key `ai-preview-v45:{gameId}` (14-day TTL, hits
    only — misses are never cached). Bump the version suffix to flush stale client entries.
- **Bumping prompt / refreshing previews:**
  - Preview content change → run `npm run warm:force` (regenerates all followed next-fixtures
    ignoring lifecycle marks).
  - Review content change → bump `'ai-review-v4'` → `'ai-review-v5'` in `ai-review/route.ts`
    and bump the localStorage version suffix, then redeploy.
