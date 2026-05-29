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
    ui/                       — button, card, badge, input, skeleton, team-badge
    layout/navbar.tsx         — Fixed top navbar, active-link detection, mobile calendar trigger
    landing/hero-cta.tsx
    onboarding/team-selector-card.tsx
    dashboard/                — team-feed-card, game-card, news-item, recent-form
    schedule/                 — next-game-hero, schedule-calendar, game-expand-panel,
                                league-table, f1-starting-grid, sport-ball
    results/result-expand-panel.tsx
  lib/
    teams.ts                  — LEAGUES + TEAMS (160+ teams, colors, metadata)
    team-logos.ts             — TEAM_LOGOS (logo URLs) + TEAM_LOGO_FILTERS (CSS filters)
    mock-data.ts              — Deterministic mock generators (seed = team ID)
    user-prefs.ts             — localStorage CRUD for followed teams ('use client')
    utils.ts                  — cn(), date/timezone helpers, ordinal(), seededRandom(),
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

Baseline health: **type-check passes clean** (`tsc --noEmit` exit 0). The findings below
are quality/efficiency/UI, not correctness bugs.

### High impact — duplication across API routes
There is **no shared `lib/espn.ts` / `lib/afl.ts`**, so route files copy-paste:
- `fetchTimeout()` — duplicated in **7 route files**
- `parseCricketFormat()` — 3 files; `espnDateRange()`, `aestDisplay()`, `unknownTeam()` — 2–3 files
- `SQUIGGLE_NAME` (18-team map) — fixtures, results, preview
- `AFL_TEAM` color/abbr/logo map — fixtures, results, league-fixtures **and** colors
  already live in `teams.ts` → AFL colors now have **3+ sources of truth** that can drift.

**Plan:** extract `lib/espn.ts` (fetch + date/cricket helpers) and `lib/afl.ts` (single
Squiggle/team table sourced from `teams.ts`). Mechanical, no behavior change, ~300+ lines removed.

### High impact — `ordinal()` defined 2–3 times
- `lib/utils.ts:89` (exported) vs a divergent local copy in `schedule/page.tsx:575`
  (which already imports from utils but not `ordinal`). A third variant `ordinalSuffix`
  lives in `ai-preview/route.ts:533`. Consolidate to the shared one.

### Medium — quality
- `REAL_DATA_LEAGUES` set duplicated verbatim in `schedule/page.tsx:27` and
  `team-feed-card.tsx:20` → hoist to `lib/teams.ts`.
- `EmptyState` near-identical in `schedule/page.tsx:605` and `dashboard/page.tsx:128`
  → extract shared `<EmptyState>`.
- ~296 `any` / `as any` casts, almost all parsing ESPN JSON. Acceptable, but a few
  `EspnEvent`/`EspnCompetition` interfaces in `lib/espn.ts` would catch silent shape drift
  (routes currently swallow errors → return `[]`).

### Medium — UI / UX
- **Palette inconsistency:** dashboard uses legacy `zinc-*`; rest of app uses
  `white/xx` + glass. Migrate dashboard for a unified look (treat as a separate visual pass).
- **No `prefers-reduced-motion` support** (0 matches) despite heavy animation. Add a
  `@media (prefers-reduced-motion: reduce)` block in globals.css + guard `smoothScrollTo()`.
- Decorative watermark `<img>` lack intrinsic width/height (minor layout-shift).

### Large files to watch (navigability, not bugs)
`preview/route.ts` 1588 · `game-expand-panel.tsx` 1448 · `schedule/page.tsx` 1408 ·
`fixtures/route.ts` 1319 · `ai-preview/route.ts` 1108. The route extractions above shrink
several of these; `game-expand-panel` could split its stats/preview sub-sections.

### Recommended first refactor pass (low-risk, no behavior change)
1. Extract `lib/espn.ts` + `lib/afl.ts`; de-dupe `fetchTimeout` and the AFL/Squiggle tables.
2. Delete duplicate `ordinal()` in schedule; import from utils.
3. Hoist `REAL_DATA_LEAGUES` and `EmptyState` to shared modules.
4. Add `prefers-reduced-motion` CSS block.

Dashboard palette migration is a separate, more visual follow-up.

---

## 8. Upgrade path (priority order)

1. **Persistence** — swap localStorage in `user-prefs.ts` for Supabase.
2. **Auth** — add NextAuth; protect `/dashboard` with a session check.
3. **AI previews** — `src/lib/ai.ts` (OpenAI `gpt-4o-mini`) already partly realized via
   `api/ai-preview` and `api/ai-review`.
4. **More leagues** — Cricket expansion (BBL/Sheffield Shield + international) next, then
   NBA/NFL/NHL/MLB via official APIs to replace their mock data.

---

## 9. Agent notes / preferences (from memory)

- **AI previews:** don't acknowledge small sample size / early-season hedging — redirect
  to useful content instead.
- **AI preview cache:** two cache layers (server + localStorage) must **both** be bumped
  when the system prompt changes.
</content>
</invoke>
