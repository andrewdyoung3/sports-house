# Derived-Facts Framework — per-sport audit & roadmap

*Last full audit: 2026-09-13.*

## Goal

> "An accurate and interesting information summary of the important facts and context, spoken as if by the **smartest sports fan in the room**, using plain language in an engaging way."

The local LLM (qwen3:30b via Ollama) supplies the *phrasing*. It must never supply the *facts, arithmetic, or competition logic*. Every number, position, stake, and structural claim is pre-computed deterministically and handed to the model as a DERIVED FACTS-style block it is instructed to use verbatim; validators then reject any output that contradicts those facts before it can be stored.

## Design principles

1. **The LLM never derives.** Standings gaps, cutoff maths, series scores, finals paths, hosting reasons, and phase labels are computed in TypeScript. If a fact isn't derivable deterministically, the model is told to stay qualitative.
2. **Wrong-confident is worse than absent.** Stakes labels (ELIMINATED, DEAD RUBBER, GRAND FINAL…) are emitted only when mathematically or structurally certain; when data is inconsistent the deriver emits nothing (see the prelim host-seed guard in `buildFinalsPathFacts`).
3. **Prose binds to facts; validators enforce.** Every class of past hallucination has a validator in `preview-generator.ts` that rejects storage. A preview that fails twice is not stored (`refuse-store`).
4. **Single sources of truth.** Per-season rules live in `competition-rules.ts` (COMP_RULES) with `season` + `source` fields and a start-of-season re-check discipline; structure prose lives in `competition-context.ts` (COMPETITION_PROFILES); phase/stakes resolution in `competition-structure.ts`. Never a literal in a prompt builder.
5. **Faithfulness invariant.** Prod, sandbox, and `verify-sandbox-faithful` all build context via `buildPreviewContext` → `buildDataBlock`. New data goes into that path, never a parallel one.

## Failure-mode catalogue (from the incident history)

| Failure mode | Example incident | Countermeasure |
|---|---|---|
| Arithmetic errors | "121-point lead" when the gap was 173 (F1) | `buildF1DerivedFacts` per-rival gaps + `validateF1ChampionshipClaims` |
| Internal contradictions | Host called "the higher-seeded side (2nd)" over the 1st-placed visitor (afl-38728, 2026-09-13) | `buildFinalsPathFacts` (bracket-derived hosting/seeding/path) + `validateFinalsSeeding` |
| Position confusion | Prose places a team 2nd when the table says 1st; round number read as points total | LADDER POSITION fact + `validateLadderPosition`; round-number-trap rule |
| Overstating early stakes | "Finals are looming" in round 6; "season on the brink" in April | SEASONAL DYNAMICS rules + `validateFinalsImminence`; review SEASON PHASE calibration line |
| Understating finals stakes | Knockout final described as a dead rubber / "no bearing" | FIXTURE CONTEXT stakes + `validatePhaseStakes`; FINALS PATH consequences ("loser is eliminated") |
| Stale competition rules | AFL top-8 → top-10 wildcard, SRU top-8 → 6, EPL 4 → 5 CL spots all went silently stale as literals | COMP_RULES config + per-season re-check; all prose parametric on config |
| Invented players/stats/years | Training-data names not in provided squads; fabricated statlines | whitelists + `validatePlayerNames`, `validateInventedStatlines`, `validateInventedYears` |
| Group/record conflation (historical, WC) | All-competitions form restated as group record | group-facts block + suppressed form; feature since removed |
| Classification from absence | Arsenal at Portman Road called "neutral ground" — Ipswich (not a followable team) had no registered venue, and the string-match miss was read as neutrality (2026-09-16) | Neutrality requires POSITIVE evidence: ESPN `neutralSite` flag plumbed fixture→context; unknown → plain venue line, never "neutral" |
| Unsourced player attributes | "Saka plays off the left" (he plays right) — the name whitelist checks WHO exists, nothing checked what was SAID about them (2026-09-16) | Lineups carry position codes (soccer `RW`/`CD-L`, AFL `HFFL`/`WR`); `validatePlayerSideClaims` rejects side claims contradicting the code AND side claims with no coded side (unsourced = banned, same as statlines) |

## The stack, per fixture

```
COMP_RULES (per-season config: cutoffs, points, finals schedule + bracket flags)
  → buildPreviewContext (live standings, form, H2H, lineups, weather, news)
  → resolveCompetitionContext (phase + stakes label, finals round via date+seed)
  → buildFinalsPathFacts (bracket logic: hosting reason, path, consequences)
  → buildDataBlock / buildReviewDataBlock (DERIVED FACTS the model must echo)
  → Ollama (phrasing only)
  → validators (reject-and-retry; refuse-store on second failure)
```

## Per-sport audit

### AFL
- **Sources:** Squiggle (`games`, `standings`, `tips` — includes finals games with round names), AFL.com/Telstra CFS (named squads, runtime token), Open-Meteo (weather).
- **Derived facts:** ladder tiers (top-6 direct / 7–10 wildcard / out), percentage tiebreaker fact, level-on-points shared figure, finals cutoff gaps, FIXTURE CONTEXT stakes, finals round by date (full 2026 schedule), FINALS PATH (hosting reason, double chance, wildcard road), model-tip margin.
- **Validators:** ladder position, phase stakes, finals seeding, finals imminence, points claims, player names (squad whitelist), statlines, years, margin-vs-tip.
- **Review player stats — WIRED (2026-09-13):** `fetchAflMatchStats` in `afl-roster.ts` reads the CFS `playerStats/match/<matchId>` endpoint (same runtime WMCTok token as rosters; round resolved from Squiggle by teams+date; concluded stats cached 12h). Full Champion Data lines → team aggregates (disposals, inside 50s, contested, clearances, tackles, scoring shots) + curated KEY PERFORMERS (leading goal-kickers AND best-rated ball-winners) → review data block + player-name whitelist.
- **Named finals paths — WIRED (2026-09-13):** `finalsPathSoFar` names each side's completed finals results with scores ("lost the Qualifying Final to Sydney 88–141, then beat Geelong 101–76 in the Semi-Final") from the form data both paths already carry; week-one round labelled from the team's own seed.
- **Gaps / roadmap:** wildcard-era `played` can exceed 23 for wildcard participants — watched, handled by `>=` comparisons.

### NRL
- **Sources:** ESPN scoreboard/standings/news + `summary?event=` (form, H2H, lineups by jersey ≤13). Injuries walled (nrl.com is editorial-only) — team-news headlines carry injury colour.
- **Derived facts:** top-8 cutoff gaps, FIXTURE CONTEXT stakes, finals round by date (full 2026 schedule), FINALS PATH (QF/EF split by seeds, double chance, hosting reasons), SEASON PHASE calibration in reviews.
- **Validators:** same suite as AFL (whitelist from ESPN rosters).
- **Named finals paths — WIRED (2026-09-13):** derived from the ESPN form data already in context via `finalsPathSoFar` (no new fetch needed).
- **Odds:** NRL carries NO odds anywhere in ESPN's feed (scoreboard + summary probed live 2026-09-13) — a keyed bookmaker API would be a new dependency; not wired.
- **Gaps / roadmap:** Origin-window form distortion is profile prose only — could become a derived flag on affected rounds. Side-claim enforcement runs in BAN mode (ESPN rugby rosters carry no side codes); the NRL jersey-number convention (2/3/12 right, 4/5/11 left) could upgrade it to BIND mode.

### EPL
- **Sources:** ESPN scoreboard (5-competition fan-out), standings, news, `summary?event=` extras.
- **Derived facts:** CL cutoff gaps (parametric on `clSpots` = 5 for 2025-26), relegation gaps (parametric on `relegationFrom`), title/CL/relegation clinch notes, TITLE RACE / TOP-5 RACE / RELEGATION BATTLE / SAFE stakes (races now outrank SAFE).
- **Validators:** full suite; no finals machinery by design (profile states NO playoffs — validator-enforced language).
- **Market odds — WIRED (2026-09-13):** ESPN core odds API (`.../events/<id>/competitions/<id>/odds`, event id alone; DraftKings) → `PreviewContext.marketOdds` → attributed MARKET line in the FROM THE MEDIA block (cited as "the market", never the model's own prediction).
- **Gaps / roadmap:** cup competitions (League Cup/FA Cup/Europe) get competition-stage context but no cup-specific derived stakes (e.g. "a semi-final first leg — aggregate decides"); two-leg aggregate facts are the next deriver. xG/shot data exists in ESPN summaries — unused; would enrich reviews with grounded performance stats.

### Super Rugby Pacific
- **Sources:** ESPN (standings, news, summary extras; lineups by jersey ≤15).
- **Derived facts:** top-6 cutoff gaps, bonus-point-aware maxPpg maths, finals round by date (2026 schedule with structure details, incl. lucky-loser semis note).
- **Validators:** full suite.
- **Gaps / roadmap:** 2027 finals schedule re-check at season start; SRU finals hosting rules differ from the final-eight system, so `buildFinalsPathFacts` deliberately stays silent — a small SRU-specific deriver (1v6/2v5/3v4, highest-seeded-loser) is the template to add.

### Rugby Internationals
- **Sources:** ESPN per-competition (comp-id candidates fallback).
- **Derived facts:** series-context via SERIES SCORE computation from completed results; short-competition rule (every game consequential from round 1).
- **Gaps / roadmap:** Six Nations / Rugby Championship table stakes (Grand Slam / title arithmetic) are profile prose only — derivable from standings; candidate for a table-stakes deriver at next tournament window.

### F1
- **Sources:** Jolpi/Ergast (standings, calendar).
- **Derived facts:** CHAMPIONSHIP DERIVED FACTS — per-rival gaps to the leader stated separately, exact win counts, conservative points-still-available (24 races + 6 sprints, no fastest-lap point).
- **Validators:** `validateF1ChampionshipClaims` (every cited gap must appear in the block).
- **Gaps / roadmap:** clinch/elimination arithmetic (champion mathematically decided) mirrors the EPL clinch pattern — straightforward add late in the season.

### Cricket (BBL + internationals)
- **Sources:** cricketdata.org (quota-managed: 100 hits/day, file-cached), dedicated data block (toss, scores, named squads → whitelist, series form, qualitative H2H).
- **Config:** BBL|15 confirmed — 10 games each, top 4, Qualifier/Knockout/Challenger/Final (profile + COMP_RULES both updated 2026-09-13). **Re-confirm at BBL|16 launch ~Dec 2026.**
- **Gaps / roadmap:** BBL ladder computation (NRR tiebreaker) is a config stub — wire the ladder-finals-style facts when BBL|16 starts; finals-path deriver for the BBL bracket (Qualifier loser gets the second chance — same double-chance shape as the final-eight system).

### NBA / NHL
- **Sources:** ESPN standings + news + summary extras (form, H2H, starters). Series score derived from completed results ("X lead 2–1").
- **Profiles:** both teach the full playoff structure (NBA play-in + best-of-7 rounds; NHL division top-3 + wildcards, loser point, Presidents' Trophy ≠ championship — added 2026-09-13).
- **Gaps / roadmap:** ladder computation deferred by design (win-% tables don't fit points maths). Next season: playoff-odds-free conservative facts (clinched/eliminated flags come directly from ESPN standings stats — `clincher` fields) + best-of-7 series-state deriver keyed on SERIES SCORE (template: SOO).

### State of Origin
- **Sources/derived:** `soo.ts` — single source for series state; one canonical fixture mirrored to both team perspectives; SERIES STATE block instead of ladder; neutral-venue classification.
- **Gaps:** none open; template for future rep/series entities.

### NFL / MLB
- Mock data only (`mock-data.ts`); no generation, no derived facts. Roadmap: official APIs, then the NBA/NHL pattern.

## Review-path specifics (post-match)

The review builder (`review-prompt.ts`) shares COMP_RULES and the finals machinery:
- **Finals matches:** FINALS CONTEXT block (round, structure, bracket facts), ladder derived-facts suppressed, standings demoted to REGULAR-SEASON SEEDING.
- **Regular season:** SEASON PHASE calibration line (early/mid/run-home/season-complete) so consequence language is proportionate — the "early-season loss ≠ season on the brink" rule is now data, not vibes. A LADDER POSITION (authoritative) line binds every positional ordinal.
- **Form + head-to-head coming in** (added 2026-09-13): `fetchReviewFormAndH2H` — ESPN `summary?event=` for NRL/EPL/SRU (event id from the gameId; EPL cup ids carry their competition slug), the Squiggle games array for AFL. Entries dated on match day are dropped so "form coming in" can never include the reviewed game.
- **Validation (ported 2026-09-13, closing the gap):** `review-validators.ts` → `validateReviewOutput` runs on every generation inside the cached generator: shared validators (finals seeding, ladder position, points claims, player names — whitelist now reads the review block's SCORERS sections) plus review-specific `validateReviewPhase` (finals ≠ dead rubber; early season ≠ must-win) and `validateReviewStatlines` (no invented in-game numbers when the block declares NO IN-GAME MATCH STATS). Contract mirrors previews: violations → one retry → refuse via **throw**, so the Next data cache never stores a bad (or null-from-validation) review.
- **Residual known issue:** a *transient* generation error (Ollama down, parse failure twice) still returns `null` inside `unstable_cache`, which caches it for that exact (cacheKey, dataBlock) pair — pre-existing behavior, self-healing when standings change the dataBlock, but worth converting to a throw in a hygiene pass.

## Claim-type source coverage (the meta-rule: every claim type has a designated source, or is forbidden)

| Claim type | Source | Coverage |
|---|---|---|
| Player existence | Lineup/squad/stats whitelists | All leagues with player data (F1 via standings) |
| Numbers/gaps/positions | DERIVED FACTS blocks | All computed leagues |
| Finals structure/hosting | FINALS PATH bracket facts | AFL, NRL (SRU via round details) |
| Venue neutrality | Feed `neutralSite` flag (ESPN) / domain rule (SOO) / conservative silence (AFL, unknown) | No league can emit a false "neutral" — positive evidence or nothing |
| International home soil | `international.ts`: home = ANY ground in the nation's country (venue country from feed address or ", Country" venue suffix vs TEAMS country); UK venues undecidable for UK-vs-UK; West Indies = Caribbean member soil; third country + both sides known = neutral | rugby_int + cricket_int fixtures |
| Player side (left/right) | Position codes: ESPN soccer (RW/CD-L), CFS AFL (HBFL/WR) → BIND; rugby/NBA/cricket have no codes → unsourced side claims BANNED | All previews + reviews |

## Re-check calendar

| When | What |
|---|---|
| ~Dec 2026 (BBL|16 launch) | BBL finals format + games count (`COMP_RULES.bbl`, profile) |
| Feb 2027 (SRU season start) | SRU finals teams + 2027 finals schedule dates |
| Mar 2027 (AFL season start) | AFL wildcard format continuation + 2027 finals schedule |
| Mar 2027 (NRL season start) | NRL 2027 finals schedule dates |
| Aug 2027 (EPL 2027-28) | England's CL spot count (coefficient-dependent), relegation unchanged |
| F1 2027 | calendar counts + points system |
