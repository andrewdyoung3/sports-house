# Data-source enrichment audit — free sources per sport

*Audited 2026-09-16. Sources marked ✓probed were verified live that day; ✓June were
verified in the June 2026 investigation (see memory/PROJECT_CONTEXT); others are
well-known public feeds to confirm at wiring time. "Free" = no payment; "keyed-free"
= free tier requiring registration.*

## AFL

**Current:** Squiggle (games/standings/tips), AFL.com CFS (named squads + full player
stats, runtime token), Open-Meteo weather.

| Opportunity | What it adds | Notes |
|---|---|---|
| Squiggle `?q=pav` ✓probed | Player Approximate Value ratings (off/mid/def splits, per season) — grounded player-quality context for KEY PERFORMERS and playerSpotlight ("a top-50 midfielder by PAV") | Free, historical by year; join by name+team |
| Squiggle `?q=virtual` ✓probed (empty off-season) | Model-simulated projected ladder / finals probabilities in-season — a legitimate DERIVED-FACTS-style "finals odds" input, attributed to the models | Re-probe at 2027 season start |
| Squiggle `?q=sources` ✓probed | Names of the tipping models — lets MODEL TIP attribute "9 of 12 models incl. The Arc" | Trivial |
| CFS probe list | `/injuries` or club availability endpoints may exist behind the same WMCTok token; would replace editorial-only injury coverage | Probe with existing token flow |

## NRL

**Current:** ESPN (scoreboard/standings/news/summary extras/injuries endpoint), no odds
(ESPN carries none — probed 2026-09-13).

| Opportunity | What it adds | Notes |
|---|---|---|
| nrl.com match-centre `/draw/.../data` JSON ✓June | **Odds** (fills the unfillable-from-ESPN gap), plus form and teamPosition cross-checks | Unofficial but structured JSON; wire with the same attributed MARKET framing as EPL |
| nrl.com Tuesday team lists ✓June | Named 17s → derived "outs" by diffing vs prior week (team-list-based, not injury-labelled) — the closest thing to an NRL availability feed | Walled for injuries proper; this is the workaround identified in June |
| Jersey-number side convention | Upgrades side-claim enforcement from BAN to BIND mode (2/3/12 right; 4/5/11 left) | Pure code, no new source |

## EPL (+ English cups/Europe)

**Current:** ESPN full suite + core-API odds (DraftKings).

| Opportunity | What it adds | Notes |
|---|---|---|
| ESPN `summary` team `statistics` | Possession/shots/shots-on-target/corners — already flows to reviews via match-stats; previews could cite season-to-date shape qualitatively | Same feed, no new dependency |
| ESPN team leaders (`/teams/{id}/athletes` stats or scoreboard leaders) | Top scorer/assist names+counts → grounded KEY PERFORMERS for previews (whitelist + statline source) | Probe exact endpoint |
| football-data.org (keyed-free, 10 req/min) | Clean scorers table, head-to-head, referee | Only if ESPN leaders probe fails |
| xG (Understat/FBref) | Underlying-performance context | Scrape-only, fragile ToS — **not recommended**; note for completeness |

## Super Rugby / Rugby Internationals

**Current:** ESPN (standings/news/summary extras); injuries wired for NRL/EPL only.

| Opportunity | What it adds | Notes |
|---|---|---|
| ESPN injuries endpoint for rugby paths | Same `fetchESPNInjuries` pattern with `rugby/242041` etc. | Probe — pattern already in code |
| ESPN venue `address.country` | Feeds the international home-soil rule with authoritative venue country | Already parsed defensively (2026-09-16); confirm field presence at November internationals |

## F1

**Current:** Jolpi/Ergast (standings, calendar, grid).

| Opportunity | What it adds | Notes |
|---|---|---|
| OpenF1 (api.openf1.org) ✓probed | Free, keyless: session results, lap/stint/tyre data, session weather, circuit metadata — quali-gap derived facts ("Piastri out-qualified Norris by 0.3s"), sprint context, and the data spine if F1 reviews are ever added | The headline free source in all of sport; GA and current (2026 sessions live) |
| Open-Meteo at circuit | Race-day weather (wired for other outdoor sports; F1 not connected) | Reuse `weather.ts` |

## Cricket (BBL + internationals)

**Current:** cricketdata.org (100 hits/day quota, heavily cached).

| Opportunity | What it adds | Notes |
|---|---|---|
| cricsheet.org | Free bulk ball-by-ball archives (all internationals + BBL). Precompute OFFLINE venue derived facts — average first-innings score at the ground, chase success rate, spin vs pace share — zero quota cost, refreshed monthly | The best accuracy-per-effort add for cricket: pitch/venue context is exactly what the "smartest fan" mentions and models hallucinate |
| Venue gazetteer (below) | Hardens host detection beyond ", Country" string tails | |

## NBA / NHL / NFL / MLB

| Opportunity | What it adds | Notes |
|---|---|---|
| ESPN standings `clincher` flags (NBA/NHL) | Official clinched/eliminated markers → free deterministic stakes when seasons are built out | NHL deferred per direction |
| NHL official api-web.nhle.com | Free official standings/schedule/boxscores if/when NHL is built | Known-good; not probed (deferred) |
| ESPN NFL/MLB (same site.api pattern) + MLB StatsAPI (statsapi.mlb.com, free official) | The path off mock data — fixtures/standings/news with the existing fetcher shape | When NFL/MLB are prioritised |

## Cross-cutting

| Opportunity | What it adds | Notes |
|---|---|---|
| **Static venue gazetteer** (one-time from Wikidata/Wikipedia, checked into repo) | venue → city/country/altitude/capacity for every venue the app has ever seen. Hardens the international home-soil rule (no more string-tail parsing), enables travel/altitude notes (Ellis Park at 1,750m is real analysis) | Freely licensed; build once with a script, refresh rarely |
| The Odds API (keyed-free, ~500 req/mo) | AFL/NRL market lines where no free feed exists | Optional; nrl.com odds may make it unnecessary for NRL |
| ESPN news API descriptions | Already used; deeper article text exists per news id if editorial grounding ever needs more than headlines | Low priority |

## Build status (2026-09-16, same day)

All five shortlist items are WIRED (branch fix/claim-grounding):
1. ✅ nrl.com match-centre — market odds (decimal, current round) AND official named
   team lists with positions (22/side, named ~Tuesday) → SQUAD block + ins/outs diff.
2. ✅ cricsheet venue facts — `npm run venuefacts` precomputes 83 venue/format
   profiles (923 ODIs + 455 BBL games since 2018) into src/data/; VENUE PROFILE
   lines render in the cricket block (avg first-innings score, chase win %).
3. ✅ Squiggle PAV (+ model names on MODEL TIP) — attributed PLAYER RATINGS block.
4. ✅ NRL team-list outs — via the same match-centre lists diffed against last lineup.
5. ✅ OpenF1 — WEEKEND SO FAR block: latest completed session of the meeting with
   gaps (e.g. Madrid quali: Norris pole, Antonelli +0.011s).
Also: cricket previews RESTORED (route/generator unification + series search
discovery + ESPN bridge — see framework doc). Venue gazetteer remains roadmap.

## Priority shortlist (accuracy value ÷ effort)

1. **nrl.com match-centre odds** — fills a declared-unfillable gap, free (✓June verified structure).
2. **cricsheet venue facts** — offline, quota-free pitch/venue derived facts; big accuracy + colour win.
3. **Squiggle PAV + sources** — grounded AFL player quality and model attribution, trivial fetches.
4. **NRL Tuesday team-list outs** — availability signal for the sport where injuries are walled.
5. **OpenF1 quali/stint facts** — quali-gap derived facts for previews.
6. **ESPN rugby injuries probe + EPL team leaders probe** — same patterns as existing code.
7. **Venue gazetteer** — hardens internationals; unlocks altitude/travel facts.
8. **Squiggle virtual (in-season)** — projected-ladder stakes, re-probe March 2027.
