# SportHouse — Project Context

> A living architecture reference for SportHouse. Complements `CLAUDE.md` (which holds
> agent-facing build/run instructions). This doc is the "why and how it fits together"
> overview plus a running log of tech-debt and decisions discussed during review.
>
> Last updated: 2026-05-29

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
      match-stats/route.ts    — Per-match statistics
      preview/route.ts        — Match preview data assembly
      ai-preview/route.ts     — AI-generated match preview text
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
  lib/
    teams.ts                  — LEAGUES + TEAMS (160+ teams, colors, metadata) + REAL_DATA_LEAGUES set
    team-logos.ts             — TEAM_LOGOS (logo URLs) + TEAM_LOGO_FILTERS (CSS filters)
    espn.ts                   — shared ESPN/Squiggle helpers (fetchTimeout, espnDateRange,
                                aestDisplay, parseCricketFormat, unknownTeam)
    afl.ts                    — AFL Squiggle-name map + team table derived from teams.ts/team-logos.ts
    mock-data.ts              — Deterministic mock generators (seed = team ID)
    user-prefs.ts             — localStorage CRUD for followed teams ('use client')
    utils.ts                  — cn(), date/timezone helpers, ordinal() (shared), seededRandom(),
                                contrastColor(), smoothScrollTo()
    f1-data.ts                — F1 calendar, country→abbr, grid data
    english-football-divisions.ts — EPL/EFL division metadata
  types/index.ts              — All shared TS interfaces (Team, UpcomingGame, GameResult,
                                NewsItem, StandingRow, etc.)
  instrumentation.ts          — Next.js instrumentation hook
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

### ✅ Shipped separately — accessibility (behavior change)
- **`prefers-reduced-motion` support** — a `globals.css` `@media (prefers-reduced-motion:
  reduce)` block collapses animations/transitions to ~0ms (entrances resolve to their final
  visible frame — *not* `animation: none`), and `smoothScrollTo()` jumps instantly. Lives on
  the `a11y/reduced-motion` branch (PR #3); a deliberate behavior change, kept out of the
  behavior-neutral pass above.

### Outstanding
- **~296 `any` / `as any` casts**, almost all parsing ESPN JSON. A few `EspnEvent` /
  `EspnCompetition` interfaces in `lib/espn.ts` would catch silent shape drift (routes
  swallow errors → return `[]`).
- **Palette inconsistency:** dashboard uses legacy `zinc-*`; rest of app uses `white/xx` +
  glass. Migrate the dashboard for a unified look (separate visual pass).
- **Decorative watermark `<img>`** lack intrinsic width/height (minor layout-shift).
- **Large files to watch** (navigability, not bugs): `preview/route.ts` ~1.6k ·
  `game-expand-panel.tsx` ~1.4k · `schedule/page.tsx` ~1.4k · `fixtures/route.ts` ~1.3k ·
  `ai-preview/route.ts` ~1.1k. `game-expand-panel` could split its stats/preview sub-sections.

---

## 8. Upgrade path (priority order)

1. **Persistence** — swap localStorage in `user-prefs.ts` for Supabase.
2. **Auth** — add NextAuth; protect `/dashboard` with a session check.
3. **AI previews/reviews** — *already live.* `api/ai-preview` + `api/ai-review` call the
   Anthropic SDK directly (`claude-sonnet-4-6`); there is **no `src/lib/ai.ts`** — the logic
   lives in the routes. Output is cached server-side (`unstable_cache`) **and** in
   `localStorage`. Remaining: spend-limit + rate-limit guards; longer-term, the self-hosted
   option in §10.
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
the Anthropic API (`claude-sonnet-4-6`). Marginal cost ≈ electricity only — the Mac is
already running.

**Core idea — pre-generation (the whole point of the design):** a scheduled job *on the
Mac* generates previews for upcoming fixtures ahead of time and writes them to a shared
store; Vercel only ever *reads* cached results, never calls the model synchronously. This
makes model speed invisible to users and removes the public inference endpoint + tunnel
from the request path — neutralizing latency, per-token cost, and the §7 exposure concern
in one move. The shared store can be the Supabase from upgrade-path #1, so this dovetails
with persistence.

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

**Tradeoff:** a local 7–8B won't match Sonnet 4.6's polish — acceptable for short,
pre-generated previews, but benchmark before committing.

**Rough sequence when tackled:** prototype model + prompt locally → build the pre-gen job
+ shared store → point Vercel reads at the store → keep the Anthropic API as fallback.
