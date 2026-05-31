# SportHouse — Project Context

> A living architecture reference for SportHouse. Complements `CLAUDE.md` (which holds
> agent-facing build/run instructions). This doc is the "why and how it fits together"
> overview plus a running log of tech-debt and decisions discussed during review.
>
> Last updated: 2026-05-31

---

## 1. What it is

SportHouse is a personalized sports dashboard. A user picks the teams they follow
(across AFL, NRL, EPL, Super Rugby, Test Rugby, F1, BBL, international cricket, plus
mock-only NBA/NHL/MLB), and the app builds a tailored feed of fixtures, results,
standings, news, and AI match previews.

It began as a localStorage-only MVP with deterministic mock data and has since grown a
real backend layer: a suite of Next.js API routes that proxy free public sports APIs
(ESPN, Squiggle) and generate AI previews.

---

## 2. Stack

- **Next.js 14** (App Router) + **TypeScript**
- **TailwindCSS v3** — custom "glass / obsidian" dark design system
- **lucide-react** — icon set
- **No database, no auth** — all user state lives in `localStorage`
- **API routes** act as a thin server layer: fetch upstream sports APIs, normalize to
  internal types, cache, and serve to the client
- **AI text** — Anthropic Claude (**Haiku 4.5** by default) via `@anthropic-ai/sdk` in the
  `ai-preview` / `ai-review` routes; model is configurable through `ANTHROPIC_AI_MODEL`
  (`src/lib/ai-model.ts`)
- Dev server runs on **http://localhost:3001**

### Commands
```bash
npm run dev       # dev server at :3001 (hot reload)
npm run build     # production build (also type-checks)
npm start         # serve production build
npx tsc --noEmit  # type-check only
```

---

## 3. Directory structure

```
src/
  app/
    page.tsx                  — Landing page (server component)
    onboarding/page.tsx       — Team selection wizard (client, 2-step)
    dashboard/page.tsx        — Personalized per-team feed (client)
    schedule/page.tsx         — Fixtures timeline + calendar + league browse (client)
    results/page.tsx          — Past results feed (client)
    layout.tsx                — Root layout (Inter font + Navbar)
    error.tsx                 — Error boundary
    globals.css               — Tailwind base + glass utilities + keyframes
    api/
      fixtures/route.ts       — Upcoming fixtures for a followed team
      results/route.ts        — Past results for a followed team
      league-fixtures/route.ts— All fixtures for a whole competition (league browse)
      standings/route.ts      — League tables
      news/route.ts           — Team news headlines
      match-stats/route.ts    — Per-match statistics (typed against the lib/espn ESPN interfaces)
      preview/route.ts        — Match preview data assembly
      ai-preview/route.ts     — AI-generated match preview text (slim — prompt assembly
                                lives in lib/preview-prompt.ts)
      ai-review/route.ts      — AI-generated post-match review text
      weather/route.ts        — Venue weather for fixtures
  components/
    ui/                       — button, card, badge, input, skeleton, team-badge, empty-state
    layout/navbar.tsx         — Fixed top navbar, active-link detection, mobile calendar trigger
    landing/hero-cta.tsx
    onboarding/team-selector-card.tsx
    dashboard/                — team-feed-card, game-card, news-item, recent-form
    schedule/                 — next-game-hero, schedule-calendar, game-expand-panel,
                                league-table, f1-starting-grid, sport-ball
    results/result-expand-panel.tsx
    providers/prefs-sync.tsx  — invisible app-load bootstrap (anon Supabase session +
                                one-time localStorage→Supabase sync)
  lib/
    teams.ts                  — LEAGUES + TEAMS (160+ teams, colors, metadata) + REAL_DATA_LEAGUES set
    team-logos.ts             — TEAM_LOGOS (logo URLs) + TEAM_LOGO_FILTERS (CSS filters)
    espn.ts                   — shared ESPN/Squiggle helpers (fetchTimeout, espnDateRange,
                                aestDisplay, parseCricketFormat, unknownTeam) + ESPN response
                                interfaces (scoreboard/summary; typing pilot, see §7)
    afl.ts                    — AFL Squiggle-name map + team table derived from teams.ts/team-logos.ts
    ai-model.ts               — AI_MODEL constant (ANTHROPIC_AI_MODEL env, default Haiku 4.5),
                                shared by both AI routes
    preview-prompt.ts         — shared AI-preview prompt assembly (SYSTEM_PROMPT + buildDataBlock +
                                buildUpdatePrompt + buildPreviewPrompt); used by the route AND the eval
    mock-data.ts              — Deterministic mock generators (seed = team ID)
    user-prefs.ts             — followed-teams store ('use client'): synchronous localStorage
                                read-through cache + Supabase write-through (durable source of truth)
    supabase/client.ts        — SSR browser client (@supabase/ssr, dynamically imported so it
                                stays out of First Load JS); null when unconfigured
    supabase/server.ts        — SSR server client (Phase-2 scaffold)
    utils.ts                  — cn(), date/timezone helpers, ordinal() (shared), seededRandom(),
                                contrastColor(), smoothScrollTo()
    f1-data.ts                — F1 calendar, country→abbr, grid data
    english-football-divisions.ts — EPL/EFL division metadata
  types/index.ts              — All shared TS interfaces (Team, UpcomingGame, GameResult,
                                NewsItem, StandingRow, etc.)
  instrumentation.ts          — Next.js instrumentation hook
scripts/
  eval-previews.ts            — DEV-ONLY model-comparison harness (not built/bundled, not
                                imported by any route); writes blind A/B artifacts to
                                eval-output/ (gitignored). Run: npx tsx scripts/eval-previews.ts
supabase/
  migrations/0001_user_prefs.sql — user_prefs table + RLS (each user sees only their own row)
```

---

## 4. Core data flow

```
Onboarding ──saveFollowedTeams()──▶ localStorage ──getFollowedTeams()──▶ Dashboard / Schedule / Results
                                                                              │
                                                          per-team fetch ─────┘
                                                                              ▼
                                              /api/* routes ──▶ ESPN / Squiggle / AI ──▶ normalized types
```

- **Onboarding → localStorage → pages** is the entire user-state pipeline. No server
  persistence, no auth.
- Client pages read followed teams on mount (after hydration, to avoid SSR mismatch),
  then fan out one fetch per team to the relevant API routes.
- API routes normalize every upstream response into the **internal types in
  `types/index.ts`** so the display layer never sees raw ESPN/Squiggle shapes.
- **Mock fallback:** leagues without a real backend use deterministic mock data keyed by
  `seededRandom(teamId)` — same team always renders the same mock data.

### Key client-state patterns (schedule/page.tsx)
- **Ref-backed caches** (`leagueCacheRef`, `standingsCacheRef`) read synchronously in the
  same render as the trigger state changes — deliberately avoids a one-render flash when
  switching league pills. A `cacheVersion` counter state forces re-render on cache writes.
- **Adaptive background:** the page sets a CSS custom property `--bg-left-color` from the
  active team's primary color (`teamColorToBgStop`), giving each team an ambient wash.
- **Auto-inject QLD Maroons** for State of Origin whenever any NRL club is followed.

---

## 5. Real data sources (live)

| League        | Fixtures / Results            | Standings                          | News / Extras                |
|---------------|-------------------------------|------------------------------------|------------------------------|
| AFL           | Squiggle `?q=games;year=YEAR` | Squiggle `?q=standings`            | Squiggle `?q=tips;game=ID`   |
| NRL           | ESPN rugby-league scoreboard  | ESPN v2 rugby-league standings     | ESPN team news               |
| EPL           | ESPN soccer scoreboard (5 comps fan-out) | ESPN v2 soccer standings | ESPN team news               |
| Super Rugby   | ESPN                          | ESPN                               | ESPN                         |
| Test Rugby    | ESPN                          | —                                  | —                            |
| F1            | ESPN / f1-data                | ESPN / f1-data                     | grid data                    |
| BBL / Cricket Int | ESPN cricket                | —                                  | —                            |
| **NBA/NHL/MLB** | **mock-data.ts**            | mock                               | mock                         |

- **Squiggle** (AFL) — free, no key. The `?team=` filter is unreliable for the current
  season, so routes fetch the full year and filter server-side. Next.js dedupes the URL
  across all AFL team requests within the revalidation window.
- **ESPN public API** — no key. Routes fan out across competitions for EPL (league + cups
  + European comps).
- Caching: routes set `Cache-Control: public, max-age=300, stale-while-revalidate=3600`
  and use `next: { revalidate }` on upstream fetches.
- **AI previews/reviews are *generated*, not fetched** — produced by Anthropic Claude
  Haiku 4.5 (see §3 `lib/ai-model.ts` / `lib/preview-prompt.ts` and §8), then cached.

---

## 6. Design system / UI conventions

- **Obsidian base** (`#080809`) with layered radial-gradient washes in `body`
  (globals.css). Left wash is team-adaptive via `--bg-left-color`.
- **Glass surfaces:** `.glass`, `.glass-strong`, `.glass-hero` utilities — translucent
  white + backdrop blur + cool-amethyst borders.
- **Team theming:** each team's `primaryColor` / `secondaryColor` drives borders, glows,
  ambient tints, and badge drop-shadows **inline via `style`** (no CSS-in-JS).
- **Color convention:** newer pages (schedule, results) use `white/xx` opacity tokens.
  The dashboard still uses the older `zinc-*` palette — see tech debt below.
- **Fixture badges:** `LEAGUE_BADGE` / `COMPETITION_BADGE` maps in `schedule/page.tsx`
  encode brand colors + Unicode glyphs (with `︎` to force text rendering) + optional
  watermark logos — so league badges need no image assets.
- **Animations:** `drift`, `drift-slow`, `pulse-ring`, `slideDown` keyframes;
  `float-hover`; custom `smoothScrollTo()` (ease-in-out cubic).

---

## 7. Known tech debt / review findings (2026-05-29)

Baseline health: **type-check + production build pass clean** (`tsc --noEmit` and
`npm run build` both exit 0). The findings below are quality/efficiency/UI, not bugs.

### ✅ Completed in the May 2026 cleanup pass (behavior-neutral)
- **`lib/espn.ts`** — extracted `fetchTimeout`, `parseCricketFormat`, `espnDateRange`,
  `aestDisplay`, `unknownTeam` (were copy-pasted across 7 routes; all copies byte-identical).
- **`lib/afl.ts`** — single source of truth for AFL data: `SQUIGGLE_NAME` + an `AFL_TEAM`
  table *derived* from `teams.ts`/`team-logos.ts`, replacing 3 hardcoded copies. No drift found.
- **`REAL_DATA_LEAGUES`** hoisted to `lib/teams.ts`; the 4 identical copies now import it
  (the divergent 5-member set in `result-expand-panel` is a different concept — left alone).
- **Shared `<EmptyState>`** (`components/ui/empty-state.tsx`) replaces 3 near-identical
  inline blocks (schedule, dashboard, results) with byte-equivalent output.
- **`ordinal()`** consolidated to the `lib/utils.ts` version (removed the schedule duplicate).
- **Build hygiene:** stopped tracking `tsconfig.tsbuildinfo`; added `*.tsbuildinfo` to `.gitignore`.
- **UI:** date text bumped +2px across the schedule/results lists + the Next Game hero.

### ✅ Accessibility & UI
- **`prefers-reduced-motion` support** — a `globals.css` `@media (prefers-reduced-motion:
  reduce)` block collapses animations/transitions to ~0ms (entrances resolve to their final
  visible frame — *not* `animation: none`), and `smoothScrollTo()` jumps instantly.
- **Watermark `<img>` intrinsic dimensions** — added `width`/`height` to the decorative
  watermark/logo imgs in `schedule/page.tsx`, `results/page.tsx`, `next-game-hero.tsx` so the
  browser reserves space. Visually neutral: CSS height + `w-auto` still govern displayed size,
  and the UA-mapped `aspect-ratio: auto` defers to each logo's natural ratio (no distortion).

### ✅ AI previews — tooling & model
- **Prompt assembly extracted** to `lib/preview-prompt.ts` (`SYSTEM_PROMPT` + `buildDataBlock`
  + `buildUpdatePrompt` + a `buildPreviewPrompt` wrapper), moved verbatim out of the route;
  `ai-preview/route.ts` is now slim and imports it.
- **Model-comparison eval harness** (`scripts/eval-previews.ts`, dev-only) — runs curated
  fixtures across a model registry on the production prompt and writes a blind, order-randomized
  A/B artifact + cost/latency summary. `eval-output/` is gitignored.
- **Production model switched to Claude Haiku 4.5** (from Sonnet 4.6) via `lib/ai-model.ts`
  (`ANTHROPIC_AI_MODEL`, default Haiku), shared by both AI routes — ~3× cheaper / ~2× faster;
  a blind eval showed only a slight Sonnet edge in polish, not worth the cost.

### ✅ Persistence (Phase 1)
- **Followed teams now persist to Supabase** (anonymous identity + RLS) behind the unchanged
  `user-prefs.ts` interface, at UX parity (no login). Design (a): synchronous localStorage
  read-through cache + Supabase write-through as the durable source of truth — so all five
  callers are unchanged; the only wiring is `<PrefsSync/>` in the root layout. First-run
  localStorage→Supabase migration is idempotent; `@supabase/ssr` is dynamically imported
  (out of First Load JS); degrades to localStorage-only when env vars are unset. RLS verified
  (each user reads only their own row). **Live in prod — verified 2026-05-31** (writes land in
  the `user_prefs` table from the Vercel build). **Phase 2 (real login) is the next step — see §8.**

### ✅ Type safety — ESPN interface pilot
- **Typed the ESPN JSON boundary in `match-stats`** — added minimal, all-optional ESPN
  response interfaces to `lib/espn.ts` (scoreboard: `EspnScoreboardResponse`/`Event`/
  `Competition`/`Competitor`; summary: `EspnSummaryResponse`/`Boxscore`/…) and converted
  `match-stats/route.ts` to cast once per boundary + typed access, removing all **19**
  `as any`/`: any`. Behaviour-neutral (same `?.`/`??` guards; still returns `[]`/4xx on miss).
  Chosen as the pilot because it's the only ESPN route with no AFL/Squiggle mixing.
- **Two latent silent-failure risks the typing surfaced** (left as-is — graceful degradation,
  but recorded so they're not lost):
  (a) `event.id` is optional yet consumed unguarded via `String(event.id)` → a missing id
  becomes the literal `"undefined"`, the summary query becomes `?event=undefined`, and the
  route 404s — a silent miss, never logged.
  (b) Event matching hinges on optional `competitor.score` / `team.id` → a partial/absent
  score or shape change makes the score-equality match silently fail → "event not found".
- **Rollout guidance:** the remaining casts live in the larger, **less-defensive** routes
  (`fixtures`/`results`/`standings`/`league-fixtures`/`preview`). Target those next — there,
  typing is more likely to surface a real bug than just document graceful degradation
  (match-stats was already fully `?.`-guarded, so typing only documented its behaviour).

### Outstanding
- **Broader `as any` rollout** — the ESPN typing pilot (above) proved the pattern;
  ~270 casts remain across the larger ESPN routes (`fixtures`/`results`/`standings`/
  `league-fixtures`/`preview`). Roll out to the less-defensive ones first (see the pilot's
  rollout guidance).
- **Palette inconsistency:** dashboard uses legacy `zinc-*`; rest of app uses `white/xx` +
  glass. A deliberate visual pass — migrate the dashboard for a unified look.
- **AI routes 500 on non-JSON model output** — `callClaude`/`generateReview` do
  `JSON.parse` on the model's text; a conversational/malformed reply throws → 500 → the
  client shows "Preview unavailable". More likely now that a smaller model is in play. Fix
  properly via tool-use / a response schema or assistant-prefill (`{`) — **not** a retry hack.
- **Large files to watch** (navigability, not bugs): `preview/route.ts` ~1.6k ·
  `game-expand-panel.tsx` ~1.4k · `schedule/page.tsx` ~1.4k · `fixtures/route.ts` ~1.3k.
  `game-expand-panel` could split its stats/preview sub-sections. (`ai-preview/route.ts` is
  now ~140 lines post-extraction; `lib/preview-prompt.ts` ~1k is almost entirely the system-
  prompt string — large by design, not a concern.) Deferred.

### Decisions logged
- **Cost control — chose Haiku over an app-side token counter.** Switched to Haiku 4.5
  (~3× cheaper) and decided AGAINST building a daily token-budget counter in the app:
  serverless functions have no shared state to track a budget reliably, and Haiku + the
  planned §10 pre-generation both shrink the spend problem. Relying instead on the monthly
  Anthropic **Console spend cap** + Haiku + eventual pre-gen. *(The Console cap can't be
  verified from code — recommended/assumed set; confirm in the Anthropic Console.)*
- **Prompt caching — deferred to §10.** Marking the ~9k-token preview system prompt with
  `cache_control` works (a cache hit was verified), but under current traffic — on-demand
  generation with results cached 6h server-side + 14 days in `localStorage` — model calls
  are sparse, so the ~5-min prompt cache is usually cold and the cache-write premium makes
  it net slightly negative. It becomes a real ~90% input-cost win under **batch
  pre-generation**, so it's folded into the §10 build. (`ai-review`'s ~441-token system
  prompt is below the 2048-token cache minimum regardless.) Not on `main`.
- **One Supabase project for prod + local (for now).** Fine at this stage, but local/test
  writes and real prod data share a database — consider a separate prod Supabase project
  later so they don't mix.

---

## 8. Upgrade path (priority order)

1. **Persistence** — ✅ *Phase 1 done, merged, and LIVE in prod* (see §7): followed teams
   persist to Supabase via an anonymous identity + RLS, behind the unchanged `user-prefs.ts`
   interface. **Verified 2026-05-31** — production writes land in the `user_prefs` table from
   the Vercel deployment (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set
   in Vercel Production; the code still degrades to localStorage-only if unset — see
   `.env.local.example`).
2. **Auth — Phase 2 (the clear next build, on the Supabase foundation just shipped).** Add a
   real login/signup (email + OAuth) and **link the existing anonymous identity to the
   permanent account** on sign-up, so a user's followed teams carry over and sync **across
   devices** (Phase 1 is per-browser). This is also the durable **gate for the public, paid
   AI routes** (`api/ai-preview` / `api/ai-review` are currently unauthenticated). The
   `lib/supabase/server.ts` SSR client + cookie sessions are the scaffold already in place.
3. **AI previews/reviews** — *already live.* `api/ai-preview` + `api/ai-review` call the
   Anthropic SDK on **Claude Haiku 4.5** (from `lib/ai-model.ts`; `ANTHROPIC_AI_MODEL`,
   default Haiku — switched from Sonnet 4.6). There is **no `src/lib/ai.ts`** — the logic
   lives in the routes. Output is cached server-side (`unstable_cache`) **and** in
   `localStorage`. Remaining: spend guardrails (see §7 *Decisions logged*); longer-term,
   the self-hosted option in §10.
4. **More leagues** — Cricket expansion (BBL/Sheffield Shield + international) next, then
   NBA/NFL/NHL/MLB via official APIs to replace their mock data.
5. **Self-hosted LLM for AI text** *(exploratory — see §10)* — pre-generate previews/reviews
   on the always-on Mac mini and have Vercel read them from a shared store, instead of (or
   alongside) the Anthropic API.

---

## 9. Agent notes / preferences (from memory)

- **AI previews:** don't acknowledge small sample size / early-season hedging — redirect
  to useful content instead.
- **AI preview cache:** two cache layers (server + localStorage) must **both** be bumped
  when the system prompt changes.

---

## 10. Future exploration — self-hosted LLM on the Mac mini

**Status: exploratory, not near-term** — a "fun build", not a committed milestone. The
§7 spend-limit + rate-limit mitigations are independent and worth doing regardless.

**What:** run a small open model (Llama 3.1 8B / Qwen 2.5 7B via Ollama or MLX) on the
existing always-on Mac mini to produce the AI previews/reviews, replacing or supplementing
the Anthropic API (now **Claude Haiku 4.5**). Marginal cost ≈ electricity only — the Mac is
already running. The model-agnostic eval harness (`scripts/eval-previews.ts`) is reusable
here to benchmark the local model against Haiku before switching.

**Core idea — pre-generation (the whole point of the design):** a scheduled job *on the
Mac* generates previews for upcoming fixtures ahead of time and writes them to a shared
store; Vercel only ever *reads* cached results, never calls the model synchronously. This
makes model speed invisible to users and removes the public inference endpoint + tunnel
from the request path — neutralizing latency, per-token cost, and the §7 exposure concern
in one move. The shared store can be the Supabase from upgrade-path #1, so this dovetails
with persistence.

**Cadence:** generate previews ~7 days out, refresh at ~3 days (form/news/lineups firm up),
and a final pass ~1 day before kickoff. **Add prompt caching here** — batch generation shares
the constant ~9k-token system prefix, so `cache_control` becomes a real ~90% input-cost win
(it's net-negative under today's sparse on-demand traffic — see §7 *Decisions logged*).

**Latency context:** a synchronous home-model call would be ~5–15s on a cache miss
(Apple-Silicon prompt-eval + generation) vs ~2–6s on the API. Pre-generation means no user
ever waits on it.

**Optimizations** (for the gen job, or any on-demand fallback):
- Pre-summarize / trim the prompt — prompt-eval is the hidden cost on Apple Silicon.
- Cap output tokens; keep the model resident (Ollama keep-alive).
- Prefer MLX over llama.cpp; right-size the model (7–8B or smaller).
- Stream if ever generating on-request.
- Connectivity for any sync path that remains: Cloudflare Tunnel / Tailscale; pin the
  Vercel function to `syd1`.

**Tradeoff:** a local 7–8B won't match Claude Haiku 4.5's polish — but the bar to clear
dropped from Sonnet 4.6 to Haiku when the model switched, which makes a local model more
viable. Acceptable for short, pre-generated previews; benchmark (via the eval harness)
before committing.

**Rough sequence when tackled:** prototype model + prompt locally → build the pre-gen job
+ shared store → point Vercel reads at the store → keep the Anthropic API as fallback.
