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
    fixture-stage.ts      — Key-match tagging (UpcomingGame.stage/decider) from each feed's OWN stage signal:
                            Squiggle is_final/is_grand_final, ESPN NRL season.type===2 + COMP_RULES windows,
                            ESPN cup season.slug, Origin game 3 at 1–1. Shared by BOTH fixture builders; never name-guessed
    preview-fetchers.ts   — SINGLE source of per-league preview data (standings/news/injuries/tips/F1/WC)
                            + fetchESPNMatchExtras(): form / head-to-head / lineups from ESPN summary?event=
    preview-context.ts    — buildPreviewContext(): canonical context builder used by ALL generation paths
    preview-prompt.ts     — System prompt + buildDataBlock()/buildBlocks() (block-decomposed twin for sandbox)
    preview-generator.ts  — Ollama call + output validators (player-names/points/finals-imminence/
                            statlines/years/phase-stakes/ladder-position/WC group-record/WC group-letter/F1)
                            + Supabase upsert
    weather.ts            — fetchVenueWeather() (Open-Meteo, no key); shared by /api/weather + previews
    review-store.ts       — Supabase game_reviews read/upsert; REVIEW_REGIME ('v10') + reviewStoreKey()
    match-report.ts       — Review enrichment keyed by the SOURCE EVENT: fetchESPNMatchReport() (soccer keyEvents →
                            goals w/ method+assist+running score, cards, subs, HT/FT; venue; team stats),
                            fetchESPNSeasonResults() + deriveSeasonFacts() (computed runs/records — the only
                            streak figures the model may cite). NRL equivalents live in fetchNRLMatchTimeline (nrl.com)
    review-prompt.ts      — Review system prompt + buildReviewDataBlock() (VENUE/PERSPECTIVE/NAMES, SEASON CONTEXT,
                            MATCH EVENTS, paired TEAM STATS, PLAYERS NAMED whitelist line)
    review-contributions.ts — Server-derived strip (scorers/assists/tries) + buildKeyFactors() (HT state, 2nd-half
                            split, goal method counts, sub reactions, stat gaps) — the panel's Key Factors are
                            derived, never LLM, whenever ≥2 can be derived
    review-validators.ts  — Review validators incl. validateRelativePosition (ahead/behind bound to the points-gap
                            fact), validateReviewFormRuns (run claims bound to SEASON CONTEXT), validateScorerCounts
                            ("twice"/"hat-trick" bound to the events), validateScoreStates (quoted X–Y / "X-all" /
                            half-time scores must exist in the block), validateStatClaims ("won the clearances" bound
                            to TEAM STATS presence + direction), validateStatValues ("45 tackle breaks", "N more X"
                            bound to the named side's figure / the gap), validateHalfCounts (goals/tries per half,
                            "N tries to M"), validateScoringOrder (who scored first, per half; "posted N points"),
                            validateSeasonClaims (season-high / first-time claims need a SEASON CONTEXT line),
                            validateVerdicts (one verdict per club, each naming its club). Policy: factual violations
                            refuse (2 feedback rounds, then 3 refusals → 6 h rest); style-only residue is accepted.
                            Numbers equal to a TEAM STATS gap/sum count as sourced.
    result-match-key.ts   — makeResultId(): the results page's render id AND the review store key
    f1-data.ts, world-cup.ts, managers.ts, competition-*.ts — preview support data
                            (competition-rules.ts = COMP_RULES, the per-season single source of truth)
  app/api/
    preview/route.ts      — Display panel data (thin wrapper over preview-fetchers)
    sandbox/              — Dev-only prompt sandbox: context (buildBlocks) / models / generate
    weather/route.ts      — Thin HTTP wrapper over lib/weather.ts
    ai-review/route.ts    — Post-match review: read-through game_reviews → {preparing:true} where no
                            generator (Vercel) → Ollama generate + upsert. Key = perspective id.
    cron/poll-reviews/    — Pre-generates reviews for followed teams/comps; discovers via /api/results
                            (same ids the page renders), skips ids already stored, stops if store missing
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

Standings/news are also live for **Super Rugby, Rugby Int'l, NBA, NHL** and the **World Cup** (ESPN), **F1** (Jolpi/Ergast), and **cricket — BBL + internationals** via **cricketdata.org / CricAPI** (`src/lib/cricketdata.ts`; ESPN/cricinfo cricket is WAF-blocked server-side). Leagues with no fetcher (NFL, MLB) still use `src/lib/mock-data.ts`.

**Cricket (cricketdata.org)** — `CRICKETDATA_API_KEY` required. Free tier = **100 hits/DAY** (not feature-gated), so the client caches every call per process: one shared `currentMatches` fetch drives both BBL + international fixtures, `series_info`/`match_info`/`match_squad` are cached per id, and a quota signal trips a circuit breaker. Fixtures: `buildCricketFixtures` (currentMatches + bounded series_info expansion). Preview data: `fetchCricketPreview` (match context, toss, scores, named squads → whitelist, series form, H2H) rendered by a dedicated cricket data block (F1-style early return). Cricket fixture ids are `cint-<uuid>` / `bbl-<uuid>` where the uuid is the cricketdata match id.

### AI match-preview enrichment (per fixture)
Beyond standings/news, each preview's data block is enriched by `buildPreviewContext` → `preview-fetchers.ts`:
- **Recent form + head-to-head + last lineups** — `fetchESPNMatchExtras()` reads ESPN's `summary?event=` goldmine (`lastFiveGames` / `headToHeadGames` / `rosters[].roster`) for NRL/EPL/SRU/RINT/NBA/NHL/WC. Name-driven; `eventId = fixture.id.split('-').pop()`. Lineups: `starter` flag for soccer/basketball, **jersey ≤13 (league) / ≤15 (union)** for rugby. AFL form+H2H come from the Squiggle `games` array. **WC name caveat:** ESPN uses endonyms (e.g. "Türkiye", not our "Turkey") — the WC group context locates the group by LETTER (`WC_TEAM_GROUPS`) and canonicalises ESPN names to our TEAMS names (`_canonicalWCName`), and `WC_ID_TO_ESPN_NAME` must keep the variant ESPN actually returns; a mismatch silently drops the whole group block.
- **AFL squads/lineups** — `afl-roster.ts` (AFL.com / Telstra CFS; runtime `WMCTok` token, never stored; cached on `/tmp`). Named team lists once selected (~Thu); suppressed pre-naming. Flows into the SQUAD block + whitelist.
- **Weather at kickoff** — `weather.ts` (Open-Meteo) for outdoor leagues; only shown when notable.

**Representative teams (State of Origin)** — `nrl-maroons` / `nrl-blues` are followable rep teams with no club ladder. `src/lib/soo.ts` is the single source for `SOO_META` + series-state derivation (shared by `/api/fixtures` and the generation path). The generator emits ONE canonical fixture (`soo-<homeRepId>-<eventId>`) and `generateAndStorePreview` upserts the payload under both display perspective keys via `fixture.mirrorGameIds` (one generation, both `soo-nrl-blues-…` and `soo-nrl-maroons-…`). Preview shows SERIES STATE instead of a ladder; venue classified neutral at neutral grounds. Same pattern is the template for any future rep entity — **mirror that entity's own display id scheme**.

**Recurrence guard** — `scripts/check-team-coverage.ts` (`npx tsx`) asserts every followable team in `teams.ts` resolves to a generation identity (club map OR rep map OR cricket-dynamic); mock leagues (NFL/MLB) are reported as intentionally unsupported. Run it after adding teams/maps; 0 GAPS required.

**Faithfulness invariant:** generation, the sandbox route, and `scripts/verify-sandbox-faithful.ts` all build context via `buildPreviewContext` and pass `[],[]` for positional results — so add new data to `PreviewContext`/`buildDataBlock`, never a parallel path, and prod/sandbox stay byte-identical.

### AI post-match reviews (results page)
Persisted in Supabase `game_reviews` (migration 0006), the results-side twin of `game_previews`. **Store key = `v11:<perspective id>`** where the perspective id is `makeResultId(teamId, result)` = `<teamId>-<YYYY-MM-DD>-vs-<opponent-slug>` — the exact id the results page renders. **Since v11 the review is NEUTRAL and generated ONCE per match**: the model returns `verdicts` (one "Going forward" line per club); the route stores the same body under the requesting side's key AND the opponent's key (`resolveMirrorKey` reads the opponent's own `/api/results` row by `sourceId`, so the mirror is exactly what that row requests) with each key's own `verdict`. Generation/in-flight/refusal-backoff are keyed by the source event, so two followers of the same match cost one model run. `opponentId` is resolved from `TEAMS` by name when the results feed omits it (NRL). `GameResult.sourceId` (`afl-<squiggle id>`, `nrl-<espn id>`, `soccer-<slug>-<espn id>`, `sru-`/`rint-<id>`) is the *event* key the review enrichers parse for form/H2H/goal timeline — never use it as the store key. `/api/ai-review` is read-through: store hit → payload; no generator (`VERCEL` without a non-loopback `OLLAMA_HOST`) → `{preparing:true}` and the panel says "Match report on its way."; else generate (validators may refuse; refusals are not stored) and upsert. A cron-secret POST with `debugBlock:true` returns the exact data block + derived contributions/key factors without generating — use it to audit a match before spending a model run.

**Passages (v12):** all event arithmetic lives in `src/lib/review-passages.ts` — runs of unanswered scores with scorers and the state before/after, gaps between consecutive scores, substitutions per side, half-time / second-half splits, biggest lead, and the AFL term-by-term story. The prompt makes these the only score states, runs and gaps the model may cite; the model quotes, never computes (rejection-sampling a 27B model against ~30 exact facts did not converge). Generation is serialised in-process; the poller heartbeats the generation lock; style-only residue is accepted, factual violations refuse (2 feedback rounds, 3 refusals → 6 h rest — note the rest map and serial queue are process-local and reset when a route/validator module hot-reloads).

**Report craft (v12, 2026-09-26):** the system prompt teaches the professional shape (lede = consequence + protagonist + decisive passage; chronological how-it-unfolded from MATCH EVENTS; one line per standout with its figure; the why + consequence; three `\n\n` paragraphs) with per-sport idiom in `SPORT_CONTEXT`. The block carries what reporters write from: `<TEAM> KEY PERFORMERS` for NRL (nrl.com per-player rows), soccer (ESPN roster stats) and AFL (CFS), and AFL quarter-by-quarter scores (`fetchAflQuarterScores`) as MATCH EVENTS. Key moments are the model's (validated); derived factors are the fallback. The panel renders summary paragraphs.

**Per-sport review data (2026-09-25 overhaul — see `match-report.ts`):** EPL gets the full ESPN event feed (every `Goal*` type incl. headers, assists, method, cards, subs, HT/FT, venue, attendance, team stats) plus season facts from the league + cup schedules (`SOCCER_CUP_SLUGS`; a completeness guard against ESPN's recent-games window drops all-comps claims when a cup is missing). NRL gets nrl.com's match centre (scoring timeline with sides, HT line, team stats groups, tries per side, venue) — ESPN's NRL summary has no events/stats. AFL gets Squiggle (venue, full-season results incl. finals → season facts) + CFS player/team stats. Super Rugby / Rugby Int'l get ESPN venue + form only. Cricket gets the scorecard chart + `match_info` venue. Do not add a per-sport parallel path: extend `ReviewInput`/`buildReviewDataBlock` and the fetchers. `poll-reviews` runs from the launchd chain every 60 s, discovers via `/api/results` (`teamId=` for followed teams, `scope=league` for followed comps, 8-day lookback), and **stops with "review store unavailable"** if the admin client or table is missing — do not "fix" that by generating anyway. AFL form/H2H needs Squiggle's exact names: the route maps `teamId → SQUIGGLE_NAME`.

## Planned future leagues
- **Cricket** — DONE (BBL + internationals via cricketdata.org). Will populate tracked-team fixtures in-season (BBL summer; men's bilateral series); currently dormant like EPL/NBA off-season.
- **NFL / MLB** — still mock; would use their official APIs.

## Upgrade Path (in priority order)
1. **Persistence** — Supabase wired (`game_previews`, `preview_jobs`, `game_reviews`); see memory `project-preview-pipeline`
2. **Auth** — add NextAuth; protect `/dashboard` with a session check
3. ~~**AI previews**~~ — DONE: local Ollama pipeline (`preview-generator.ts`), not the originally-planned OpenAI
4. **More leagues** — Cricket next (sources are WAF-blocked server-side → keyed API/proxy); then NFL/MLB
5. **Preview data follow-ons** — AFL lineups DONE (`afl-roster.ts`, AFL.com). NRL injuries investigated → **walled** (nrl.com casualty ward is editorial; no structured injury endpoint) — not wired; team-news headlines cover injuries editorially.
