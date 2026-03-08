# CLAUDE.md — Sports House

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

**All other leagues use mock data** — see `src/lib/mock-data.ts`.

## Planned future leagues
- **Cricket** — Australian (BBL/Sheffield Shield) + international. Best free source: Cricinfo API or ESPNcricinfo public endpoints. On radar, not yet started.

## Upgrade Path (in priority order)
1. **Persistence** — swap `localStorage` in `user-prefs.ts` with Supabase client calls
2. **Auth** — add NextAuth; protect `/dashboard` with a session check
3. **AI previews** — add `src/lib/ai.ts` calling OpenAI `gpt-4o-mini` to replace mock preview text
4. **More leagues** — Cricket next; then NBA/NFL/NHL/MLB via their official APIs
