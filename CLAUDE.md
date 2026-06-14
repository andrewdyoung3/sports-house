# CLAUDE.md — SportHouse

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
```bash
npm run dev       # Start dev server at http://localhost:3001
npm run build     # Production build (also type-checks)
npm start         # Serve production build
npx tsc --noEmit  # Type-check only, no output
```

## Project Structure
```
src/
  app/
    page.tsx              — Landing page (server component)
    onboarding/page.tsx   — Team selection wizard (client component, 2-step)
    dashboard/page.tsx    — Personalized feed (client component)
    layout.tsx            — Root layout with Inter font + Navbar
    globals.css           — Tailwind base + hero-gradient utility
  components/
    ui/                   — button, card, badge, input, skeleton
    layout/navbar.tsx     — Fixed top navbar with active-link detection
    onboarding/           — TeamSelectorCard (colored card with checkmark)
    dashboard/            — TeamFeedCard, GameCard, NewsCard, RecentForm
  lib/
    teams.ts              — LEAGUES + TEAMS constants (160+ teams, NFL/NBA/MLB/NHL/EPL)
    mock-data.ts          — Deterministic mock generators (seed = team ID string)
    user-prefs.ts         — localStorage CRUD for followed teams
    utils.ts              — cn(), formatGameDate(), seededRandom()
    league-fixtures.ts    — Live fixture lists per league (ESPN/Squiggle); fixture.id embeds the source event id
    preview-fetchers.ts   — SINGLE source of per-league preview data (standings/news/injuries/tips/F1/WC)
                            + fetchESPNMatchExtras(): form / head-to-head / lineups from ESPN summary?event=
    preview-context.ts    — buildPreviewContext(): canonical context builder used by ALL generation paths
    preview-prompt.ts     — System prompt + buildDataBlock()/buildBlocks() (block-decomposed twin for sandbox)
    preview-generator.ts  — Ollama call + output validators (player-name/points/finals) + Supabase upsert
    weather.ts            — fetchVenueWeather() (Open-Meteo, no key); shared by /api/weather + previews
    f1-data.ts, world-cup.ts, managers.ts, competition-*.ts — preview support data
  app/api/
    preview/route.ts      — Display panel data (thin wrapper over preview-fetchers)
    sandbox/              — Dev-only prompt sandbox: context (buildBlocks) / models / generate
    weather/route.ts      — Thin HTTP wrapper over lib/weather.ts
  app/sandbox/            — Dev-only UI to inspect/toggle prompt blocks and run generations
  types/index.ts          — All TypeScript interfaces
```

## Architecture
- **Data flow:** Onboarding → `localStorage` → Dashboard (no server, no DB in MVP)
- `seededRandom(seed, index)` in `utils.ts` drives consistent mock data per team across renders
- Team `primaryColor` / `secondaryColor` applied inline via `style` prop for branding
- Server components: `app/layout.tsx`, `app/page.tsx` (landing), all `ui/` components
- Client components (`'use client'`): all pages with state/localStorage, navbar, TeamFeedCard, TeamSelectorCard

## Real data sources (live)
| League | Results | Standings | News/Tips |
|--------|---------|-----------|-----------|
| AFL | Squiggle `?q=games;year=YEAR` (complete=100) | Squiggle `?q=standings` | Squiggle `?q=tips;game=ID` |
| NRL | ESPN `rugby-league/3/scoreboard?dates=RANGE` | ESPN `v2/rugby-league/3/standings` (children[0].standings.entries, stat names: gamesWon/gamesLost/gamesDrawn) | ESPN `rugby-league/3/teams/{id}/news` |
| EPL | ESPN `soccer/eng.1/scoreboard` (fan-out across 5 comps) | ESPN `v2/soccer/eng.1/standings` (children[0].standings.entries, stat names: wins/losses/ties) | ESPN `soccer/eng.1/teams/{id}/news` |

Standings/news are also live for **Super Rugby, Rugby Int'l, NBA, NHL** and the **World Cup** (ESPN), and **F1** (Jolpi/Ergast) — all via `preview-fetchers.ts`. Leagues with no fetcher (NFL, MLB, cricket) still use `src/lib/mock-data.ts`.

### AI match-preview enrichment (per fixture)
Beyond standings/news, each preview's data block is enriched by `buildPreviewContext` → `preview-fetchers.ts`:
- **Recent form + head-to-head + last lineups** — `fetchESPNMatchExtras()` reads ESPN's `summary?event=` goldmine (`lastFiveGames` / `headToHeadGames` / `rosters[].roster`) for NRL/EPL/SRU/RINT/NBA/NHL/WC. Name-driven; `eventId = fixture.id.split('-').pop()`. Lineups: `starter` flag for soccer/basketball, **jersey ≤13 (league) / ≤15 (union)** for rugby. AFL form+H2H come from the Squiggle `games` array.
- **Weather at kickoff** — `weather.ts` (Open-Meteo) for outdoor leagues; only shown when notable.

**Faithfulness invariant:** generation, the sandbox route, and `scripts/verify-sandbox-faithful.ts` all build context via `buildPreviewContext` and pass `[],[]` for positional results — so add new data to `PreviewContext`/`buildDataBlock`, never a parallel path, and prod/sandbox stay byte-identical.

## Planned future leagues
- **Cricket** — Australian (BBL/Sheffield Shield) + international. Best free source: Cricinfo API or ESPNcricinfo public endpoints. On radar, not yet started.

## Upgrade Path (in priority order)
1. **Persistence** — Supabase wired (`game_previews`, `preview_jobs`); see memory `project-preview-pipeline`
2. **Auth** — add NextAuth; protect `/dashboard` with a session check
3. ~~**AI previews**~~ — DONE: local Ollama pipeline (`preview-generator.ts`), not the originally-planned OpenAI
4. **More leagues** — Cricket next (sources are WAF-blocked server-side → keyed API/proxy); then NFL/MLB
5. **Preview data follow-ons** — AFL lineups (Squiggle squads only → AFL.com/FootyWire); NRL injuries (ESPN `{}` → nrl.com)
