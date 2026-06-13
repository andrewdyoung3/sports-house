# Match-Preview Logic Audit

**Purpose:** Map how previews are generated today, identify where the model is left to infer
things it can misread, and propose a deterministic "league structure" reference.
**Scope:** Read-only audit of the code at the time of writing. No code changes.
**Format:** `file:line` citations on every "today" claim. Observed behaviour and proposal are kept strictly separate.

---

## Section 1 — How a Preview Is Generated Today

### 1.1 The two trigger paths

There are two ways a preview gets created:

**Path A — Scheduled generator** (`scripts/generate-previews.ts:52–150`)
A launchd agent runs the standalone script on a schedule. It loops over every league in a hardcoded list, fetches upcoming fixtures, and calls `generateAndStorePreview()` for each followed team's next game. The loop is:

```
LEAGUES = ['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1', 'world_cup', 'nba']
```

`cricket_int` and `bbl` are **not in this list** — their fetchers exist but previews are never auto-generated. `scripts/generate-previews.ts:52`.

**Path B — API route on demand** (`src/app/api/ai-preview/route.ts:28–62`)
A client requests `POST /api/ai-preview?gameId=…`. If a fresh preview exists in Supabase it is returned immediately. If not, the route returns `{ preparing: true }` and queues generation in the background. The same `generateAndStorePreview()` function is called.

### 1.2 The generation pipeline (function by function)

| Step | Function | File:line | What it does |
|------|----------|-----------|--------------|
| 1 | `fetchLeagueFixtures(league, lookback)` | `src/lib/league-fixtures.ts:1109` | Calls the per-league fetcher; returns `UpcomingGame[]` |
| 2 | `decideForTeam()` | `src/lib/preview-lifecycle.ts` | Decides whether generation is needed (48 h / 24 h freshness gates) |
| 3 | `buildDataBlock(…)` | `src/lib/preview-prompt.ts:962` | Assembles the plain-text context block handed to the model |
| 4 | `callOllama(prompt, compact, maxTokens)` | `src/lib/preview-generator.ts:173` | Sends system prompt + data block to Ollama; strips `<think>` tags and code fences from response |
| 5 | `validatePointsClaims()` | `src/lib/preview-generator.ts:28` | Flags any gap figures in the output not pre-computed in DERIVED FACTS |
| 6 | `validateFinalsImminence()` | `src/lib/preview-generator.ts:63` | Flags "finals are near" language outside a "run home"/"finals series" phase |
| 7 | `validatePlayerNames()` | `src/lib/preview-generator.ts:99` | Flags any player name not present in the input data (hallucination guard) |
| 8 | `upsertPreview(gameId, payload, model, fingerprint)` | `src/lib/preview-generator.ts:256` | Writes to Supabase `game_previews` on `onConflict: 'game_id'` |

If a validator fires, the pipeline retries once and then accepts whichever output is less bad.

### 1.3 The two prompt components

**System prompt** (`src/lib/preview-prompt.ts:565–795`) — a ~6,000-word document handed as the `system` role. It covers tone, language rules, venue awareness, grounding rules, seasonal-dynamics definitions, coaching/lineup analysis, weather integration, and two sport-specific subsections (F1 and World Cup). It does not vary by league.

**User prompt (data block)** — built by `buildDataBlock()` and described in full in §1.4 below.

**Model:** `qwen3:30b-a3b-instruct-2507-q4_K_M` (the instruct variant, not the thinking/reasoning variant). Configurable via `OLLAMA_MODEL` env var. `src/lib/ai-model.ts:1`. Token budget: 4,000 for most leagues, 5,000 for F1, 2,500 in compact mode. `src/lib/preview-generator.ts:182,289`.

### 1.4 Every field the model receives

The following table lists every section that can appear in the data block, in the order they appear in `buildDataBlock()`. "Conditional" means the section is omitted when its data is absent.

| Section in prompt | What it is | Source of value | Present |
|-------------------|-----------|-----------------|---------|
| `FIXTURE` | Home vs away team names | `teamName`, `opponentName` params | Always |
| `VENUE` | Venue name + HOME/AWAY/NEUTRAL classification | `classifyVenue()` at `preview-prompt.ts:34` using `TEAM_HOME_VENUE` map | Conditional |
| `COMPETITION` | Competition label (e.g. "NBA Finals – Game 5") | `competition` param or `LEAGUE_LABELS[league]` | Always |
| `PRIMARY LEAGUE` | Background league note for cup/off-league games | `LEAGUE_LABELS[league]` | Only when `isOffLeague` (`preview-prompt.ts:1011`) |
| `SERIES SCORE` | Official ESPN series score string | `seriesSummary` param (ESPN `comp.series.summary`) | Only when `seriesSummary` is set |
| `SERIES STATE` | Unambiguous leader/trailer + wins-needed in full team names | `deriveSeriesState()` at `preview-prompt.ts:913` | Only when `seriesSummary` is set |
| `TOURNAMENT STAGE` | World Cup stage label + plain-English stakes | `wcStageLabel()`, `wcKnockoutStake()` from `world-cup.ts:44,55` | World Cup only |
| `NOTE: Opponent TBD` | Instruction not to fabricate bracket placeholder opponents | `context.worldCup.opponentTBD` | World Cup knockout, TBD bracket only |
| `GROUP STANDINGS` | 4-team group table (P W D L Pts GD GF GA) | `context.worldCup.groupTable` | World Cup group stage only |
| `ADVANCEMENT SCENARIO` | Plain-English path to advancing from the group | `computeGroupAdvancementScenario()` from `world-cup.ts:169` | World Cup group stage only |
| `COMPETITION STAGE` | Cup/knockout round name | `context.competitionStage.roundName` | Off-league cup/European games only |
| `TIE AGGREGATE` | First-leg score for two-legged knockout ties | `context.firstLegResult` | Two-legged ties only (not finals) |
| `OPPONENT LEAGUE` | Opponent's division (used in lower-league cup upsets) | `context.opponentLeague` | Conditional |
| `DOMESTIC COMPETITION STATUS` | Mathematically confirmed outcomes (title, relegation, locked) | `computeCompetitionStatus()` at `preview-prompt.ts:147` | Finals/cup with standings present |
| `COMPETITION PROFILE` | Full format description (rounds, finals, relegation, rules) | `getCompetitionProfile(league)` from `competition-context.ts` | Only when `!isOffLeague` (`preview-prompt.ts:1112`) |
| `SPORT CONTEXT` | Sport-specific terminology dictionary | `SPORT_CONTEXT[league]` at `preview-prompt.ts:64` | Always |
| `SEASON STATE` | "Round X of Y — Z rounds left, phase: {early/mid/run home/finals}" | Computed from `LEAGUE_TOTAL_ROUNDS` and `context.teamStanding.played` | Regular-season leagues only (`preview-prompt.ts:1124`) |
| `HEAD COACHES` | Coach names for both teams | `context.teamManager`, `context.opponentManager` | Conditional |
| `LEAGUE TABLE` | Standings rows (condensed: top positions + bubble + bottom + fixture teams) | `buildTableSection()` at `preview-prompt.ts:259` | Regular-season leagues with standings |
| `COMPETITION STATUS` | Mathematically confirmed status (title clinched, relegated, finals locked) | `computeCompetitionStatus()` | Conditional on standings presence |
| `DERIVED FACTS` | Pre-computed points gaps: gap to top-4/8, relegation gap, rounds until finals | `buildDerivedFacts()` at `preview-prompt.ts:338` | Conditional on standings presence |
| `TEAM NEWS` | Top 3 news headlines for each team | `context.teamNews`, `context.opponentNews` | Conditional |
| `MOST RECENT STARTING LINEUP` | Player names from last game | `context.teamLastLineup`, `context.opponentLastLineup` | Conditional |
| `SQUAD SUBMISSION` | 26-man AFL squad + absent/return list | `context.teamSquad`, `context.opponentSquad` | AFL only |
| `INJURY REPORT` | Player name + status per team | `context.teamInjuryReport`, `context.opponentInjuryReport` | Conditional |
| `KEY PERFORMERS` | Player name + stats from most recent game | `context.teamKeyPlayers`, `context.opponentKeyPlayers` | NBA primarily |
| `RECENT FORM` | W/D/L result string + per-game details (most recent first) | `teamResults`, `oppResults` (live from ESPN/Squiggle) | Conditional |
| `EXPERT MODEL PREDICTIONS` | Tip count, favourite team, average predicted margin | `context.tips` (AFL Squiggle tips only) | AFL only |
| `WEATHER AT KICKOFF` | Conditions, temp, precipitation, wind | `weather` param — only when `isNotable=true` | Conditional |
| `BREVITY MODE` | Token/length constraints | Meta-instruction | Only when `compact=true` |

**F1 exception:** When `league === 'f1'`, `buildDataBlock()` returns a completely different block built by `buildF1DataBlock()` at `preview-prompt.ts:818`. It contains a race-specific structure (circuit, sessions, qualifying grid, championship standings) with no overlap with the standard block.

### 1.5 Is the prompt uniform across leagues?

No. There are over 15 explicit `league ===` or `isOffLeague` branches in `buildDataBlock()` alone:

| Condition | File:line | Controls |
|-----------|-----------|----------|
| `league === 'f1'` | `preview-prompt.ts:979` | Redirect to entirely separate F1 data block |
| `league === 'world_cup'` | `preview-prompt.ts:1004` | Override `isHome` for non-host nations |
| `league === 'world_cup'` | `preview-prompt.ts:1048–1197` | Inject group standings, advancement scenario, tournament stage |
| `league !== 'nba'` | `preview-prompt.ts:989` | Set `isOffLeague = true` for cup competitions (NBA exempt) |
| `!isOffLeague` | `preview-prompt.ts:1112` | Include competition profile |
| `!isOffLeague && totalRounds && played !== undefined && league !== 'world_cup'` | `preview-prompt.ts:1124` | Compute and inject SEASON STATE |
| `(isOffLeague && league !== 'f1') \|\| isKnockoutTie \|\| league === 'world_cup'` | `preview-prompt.ts:1220` | Suppress league table |
| `league === 'f1'` | `preview-prompt.ts:1222–1230` | Show DRIVERS' CHAMPIONSHIP STANDING instead of table |
| `league === 'afl'` | `preview-prompt.ts:290,369` | Add percentage column, percentage tiebreaker fact |
| `league === 'epl'` | `preview-prompt.ts:273,442` | Show top-5 + bottom-4; CL/relegation zone facts |
| `league === 'nrl' \|\| league === 'afl'` | `preview-prompt.ts:277` | Show top-9 + bottom-2 (finals bubble context) |
| `isF1` | `preview-prompt.ts:1286` | Format form as `P{position} — {race}` |
| `isFinal` | `preview-prompt.ts:1066` | Inject THE FINAL stage text + multi-trophy narrative |

---

## Section 2 — Per-Competition Structure

One row per competition that either generates previews (marked **generated**) or has a fetcher but no generator (marked **fetcher only**).

| Competition | Format / phases | How "season state" is known today | What makes a fixture important | Data SportHouse has | What's missing |
|---|---|---|---|---|---|
| **AFL** *(generated)* | 23 home-and-away rounds → top-8 finals (McIntyre system: weeks 1–2 have second chances, weeks 3–4 are single-elim) → Grand Final | Round X of 23 from `played` field in Squiggle standings. Phase auto-detected at 65% threshold. `preview-prompt.ts:1124` | Top-8 finals spot; percentage tiebreaker at cutoff; elimination finals from week 3; Grand Final | Live Squiggle standings (position, W-D-L, points, percentage). Pre-computed gap to 8th (`buildDerivedFacts`). AFL squad submissions. | Percentage margin to 8th (gap in `%` not just `pts`). Whether the game is a final (type: QF, EF, SF, PF, GF) — not distinguished in current prompt. "Dead rubber" detection when finals mathematically locked for both teams. |
| **NRL** *(generated)* | 27 home-and-away rounds → top-8 finals (weeks 1–2: second chance, weeks 3–4: single-elim) → Grand Final. State of Origin disrupts rounds ~10–17 | Round X of 27 from ESPN standings `played` field. Phase at 65% threshold. `preview-prompt.ts:1124` | Top-8 finals spot; being above or below the cutoff with few rounds left; elimination finals | Live ESPN standings (position, W-D-L, points, points-differential). Derived gap to 8th. | Finals type (EF/SF/PF/GF) not distinguished. SOO disruption context: code notes it in the competition profile but does not flag which NRL round coincides with Origin. State of Origin sides (Maroons/Blues) have no standings at all — ladder section is silently omitted. |
| **EPL** *(generated)* | 38 rounds, no finals. Three separate tension axes: title, top-4 Champions League, bottom-3 relegation | Matchday X of 38 from ESPN standings. Phase at 65% threshold. `preview-prompt.ts:1124` | Title race; top-4 CL qualification; 5th (UEL) and 6th (UECL) spots; relegation zone (18th–20th); local derbies; six-pointers | Live ESPN standings (position, W-D-L-D, points). Separate top-4/relegation derived facts for EPL. `preview-prompt.ts:442–461`. | European competition night (mid-week CL/UEL games affect squad rotation — not tracked). Title, CL, relegation zone are derived from the live table but not flagged as explicitly "this team is in/out of the zone" in a boolean field — model reads from the derived facts text. |
| **Super Rugby** *(generated)* | 14 rounds, 12 teams, top-8 finals (complex cross-conference bracket), one-leg knockouts → Final. Southern hemisphere Feb–Jun. | Round X of 14 from ESPN standings. Phase at 65% threshold. `preview-prompt.ts:1124` | Top-8 finals qualification; bonus-point culture (4W + 1 try bonus + 1 losing bonus) affects ladder in unusual ways | Live ESPN standings (position, W-D-L, points). `LEAGUE_TOTAL_ROUNDS['super_rugby'] = 14`. | Conference structure (NZ/Australian/Pacific conferences determine bracket seeding) not captured. Bonus point count per team not separated from total points — model can't reason about how a losing bonus changes standings. |
| **Rugby Int** *(generated)* | One-off Tests, Six Nations (5 rounds, 6 teams, no knockout), Rugby Championship (home/away series), bilateral 2–3 match series | No round-of-M logic. No `totalRounds` for rugby_int. Fixtures are standalone or multi-game series with no persistent table | Winning a bilateral series; Grand Slam in Six Nations; series scoreline (e.g. 1–0 lead, dead rubber at 2–0) | Three hardcoded ESPN competition IDs (Rugby Championship 244293, Six Nations 180659, bilateral 289234). `league-fixtures.ts:459–569`. Competition label (e.g. "Rugby Championship") passed to prompt. | **No series score tracking** — equivalent of the NBA `seriesSummary` field doesn't exist for rugby series. No standings for Six Nations or Rugby Championship injected into prompt. Model must infer series state entirely from competition label and news. |
| **F1** *(generated)* | ~24 race weekends (practice → qualifying → race). No playoffs. Season-long cumulative points championship (Drivers + Constructors). | No season-state phase logic (F1 exempt from `isOffLeague` branching). Race weekend round number from Ergast. | Championship gap at current round; home-country races (driver nationality vs circuit location); must-win rounds when points deficit is too large to recover | Ergast race data (circuit, dates, session schedule). Championship standings from ESPN. Per-driver stats injected. `preview-prompt.ts:1222–1230`. | Remaining races count (implied by round N of ~24, but not explicitly computed). Points-gap-to-title fact not pre-computed — model must read standings and infer math. Constructor championship state not injected separately. |
| **World Cup** *(generated)* | 12 groups (A–L) of 4 → top 2 auto-advance + best 8 third-placed (32 total) → R32 → R16 → QF → SF → 3rd-place → Final | Stage derived from ESPN round hints via `espnRoundToStage()`. Group letter from static `WC_TEAM_GROUPS` map. `world-cup.ts:137–245`. | In group stage: win/draw/loss changes advancement scenario. Points to secure top-2 vs third-place. In knockout: win or go home. | Live ESPN group standings (P W D L GF GA Pts). Computed advancement scenario text. `world-cup.ts:169`. Hardcoded `WC_TEAM_GROUPS` for group identity. | Knockout bracket state (who is in each bracket slot). Tiebreaker ordering (head-to-head before goal difference) not exposed as explicit facts — model relies on competition profile text. Whether a team is already eliminated/qualified is computed in `computeGroupAdvancementScenario` but only at a high level. |
| **NBA** *(generated)* | 82-game regular season → Play-In (7th–10th seeds) → best-of-7 Playoffs (first round, conference semis, conference finals, NBA Finals). | No explicit phase logic. `competition` label (e.g. "NBA Finals – Game 5") signals playoff context. `isOffLeague` is forced `false` for NBA. `preview-prompt.ts:989`. | Series scoreline (must-win, on verge of elimination, clinch opportunity). Regular season: playoff seeding, Play-In race. | ESPN `comp.series.summary` (e.g. "NY leads series 3-1") captured as `seriesSummary`. `league-fixtures.ts:570–669`. `deriveSeriesState()` translates it to full team names. | Regular-season standings not fetched for NBA — no table, no DERIVED FACTS, no gap-to-playoffs calculation. Play-In bubble context (games back from 8th seed) not available. Clinch scenarios for regular season not computed. |
| **Cricket Int** *(fetcher only — not auto-generated)* | Bilateral series: 2–5 match Tests, ODIs, or T20s. No persistent table (ICC WTC aggregates Tests separately). Three distinct formats per tour. | No round or phase logic. Competition label = series name. `cricketFormat` field (`test`/`odi`/`t20`) passed on the fixture. | Series scoreline (1–0 lead, dead rubber, decider); format (Tests are 5-day multi-session, T20 is a standalone 3.5h match) | Hardcoded ESPN series IDs in `CRICKET_INT_TEAM_SERIES` (12 teams, all active series Jun 2026–Mar 2027). `league-fixtures.ts:845–940`. `cricketFormat` parsed from ESPN. | Not in the generation loop. No series score tracking equivalent to NBA `seriesSummary`. Format-specific tactics (Test declared innings, power plays, Duckworth-Lewis) not injected — model infers from format label alone. |
| **BBL** *(fetcher only — not auto-generated)* | Round-robin 14 games per club → top-5 finals (Challenger, Eliminator, Knockout, Final). T20 format, Dec–Feb Australian summer. | Not computed. Fixture label only. | Finals qualification (top 5); net run rate tiebreaker at cutoff | ESPN cricket/8044 scoreboard. `cricketFormat = 't20'` on every fixture. | Not in generation loop. Standings not fetched. Net run rate (T20 tiebreaker) not tracked. |

**Structural oddballs worth noting:**

- **NRL Maroons / NSW Blues** — registered as followable teams (`division: 'State of Origin'` in `teams.ts`) but are representative sides, not clubs. They have no NRL ladder row. During State of Origin, the fixture appears from ESPN but the standings section is silently omitted in the prompt because `context.leagueTable` is empty. The AI must deduce from the competition label alone that these are Origin games.
- **Rugby Int** — three distinct competition formats (bilateral Tests, Six Nations round-robin, Rugby Championship) share one fetcher and one competition label string. There is no series-score field; the model has to infer series state from news only.
- **Cricket Int** — three formats (Test/ODI/T20) are structurally as different from each other as AFL is from NBA. They share a fetcher but the `cricketFormat` field lets the model know which format it's previewing.

---

## Section 3 — Deterministic vs Inferred (The Crux)

The matrix below marks each key structural fact per competition as either:
- **Fed as fact** — the code computes it and puts it in the data block; model doesn't have to infer.
- **Left to model** — the model receives raw data (or nothing) and must infer the answer. This is where misreads are possible.
- **N/A** — the concept doesn't apply to this competition.

| Structural fact | AFL | NRL | EPL | Super Rugby | Rugby Int | F1 | World Cup | NBA | Cricket Int | BBL |
|---|---|---|---|---|---|---|---|---|---|---|
| **Current round / matchday** | Fed (Squiggle played count) | Fed (ESPN played count) | Fed (ESPN played count) | Fed (ESPN played count) | Left to model (series round inferred from news) | Fed (Ergast round number) | N/A (stage-based) | Left to model (only playoff game number in label) | Left to model | Left to model |
| **Total rounds in season** | Fed (hardcoded 23) | Fed (hardcoded 27) | Fed (hardcoded 38) | Fed (hardcoded 14) | N/A | N/A | N/A | N/A | N/A | N/A |
| **Season phase** | Fed (computed thirds + finals flag) | Fed | Fed | Fed | Left to model | N/A | Fed (stage enum from ESPN + static map) | Left to model | Left to model | Left to model |
| **Ladder position and its meaning** | Fed (table + DERIVED FACTS: gap to 8th, to relegation zone) | Fed | Fed (CL / UEL / UECL / relegation zones explicitly) | Fed | N/A | N/A | Fed (group standings + advancement scenario) | N/A (no season standings) | N/A | N/A |
| **Fixture stakes / importance label** | Left to model (infers from gap facts + phase) | Left to model | Left to model | Left to model | Left to model | Left to model (championship gap not pre-computed) | Left to model (model reads advancement scenario + group table) | Left to model | Left to model | Left to model |
| **Finals qualification status** | Fed (mathematically confirmed via `computeCompetitionStatus`) | Fed | N/A (no finals) | Fed | N/A | N/A | Fed (advancement scenario from `computeGroupAdvancementScenario`) | Left to model (no standings) | N/A | Left to model |
| **Relegation status** | N/A | N/A | Fed (mathematically confirmed via `computeCompetitionStatus`) | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| **Series / bracket state** | N/A | N/A | N/A (for cup: first-leg fed; for finals: N/A) | N/A | Left to model (no series score field) | N/A | Fed (knockout stage + advancement scenario) | Fed (since `seriesSummary` + `deriveSeriesState` added) | Left to model | N/A |
| **Format / rules for this competition** | Fed (competition profile) | Fed | Fed | Fed | Fed | Fed (F1 data block) | Fed (competition profile) | Fed (competition profile) | Left to model (profile exists but not auto-generated) | Left to model |
| **Dead rubber / meaningless game** | Left to model | Left to model | Left to model | Left to model | Left to model | N/A | Fed (group eliminated/qualified scenario, partially) | N/A | Left to model | Left to model |

**Reading the matrix:** The "left to model" cells in the top-right half of the table (Rugby Int, NBA regular season, cricket, BBL) are sparsely fed. For NBA that's acceptable because the regular season isn't generated; for cricket and BBL, it reflects the fetcher-but-no-generator gap.

The **fixture stakes / importance label** row is "left to model" across every competition. This is the single largest systematic gap: the code never explicitly tells the model "this game is an elimination final" or "this is a dead rubber." The model infers it from the DERIVED FACTS numbers and the phase label — which is reliable for the AFL/NRL/EPL ladder story but fragile for anything that requires bracket awareness or series state.

---

## Section 4 — The Case-by-Case Fixes and Their Shared Root

Each fix below patches a specific symptom. The right column names the underlying §3 gap it was really compensating for.

| Fix | Commit | Symptom patched | Underlying §3 gap |
|-----|--------|-----------------|-------------------|
| **NBA competition profile added** | `ae74cf5` | Model treated NBA playoffs as a generic competition; couldn't describe finals structure, clinch math, or series format correctly | No competition profile → model fell back on training knowledge, which was incomplete. Same gap as for NHL, MLB, NFL (still not profiled). |
| **`isOffLeague` set to `false` for NBA** | `ae74cf5` | NBA competition profile was being suppressed because `competition = "NBA Finals – Game 5"` triggered the off-league flag (meant for FA Cup, CL, etc.) | Season-phase and competition-profile logic was not distinguishing "off-league cup" from "primary-league playoff" — a structural gap in how the code defines "off-league." |
| **`seriesSummary` threaded through the pipeline** | `ae74cf5` | Model had no authoritative series score; it guessed from the game-number label ("Game 5" → "must be close") and was wrong | Series/bracket state left to model. The ESPN field existed but wasn't passed through. |
| **`deriveSeriesState()` added** | `b95bb95` | Even after `seriesSummary` was present, the model received ESPN's abbreviated form ("NY leads series 3-1") and mis-identified which team was the leader, producing sentences like "after being down 3-1" about the leading team | The abbreviated ESPN string is ambiguous without a mapping to the full fixture team names. A "fed as fact" data point was still being left partly to model interpretation because it wasn't in a form the model could unambiguously parse. |
| **`WC_TEAM_GROUPS` static map added** | `38e9369` | World Cup expand panel defaulted to Group A regardless of which team's game was open. Model was handed `worldCupGroup = undefined` | ESPN's scoreboard API omits the group letter from round-hint strings. `espnRoundToGroup()` always returned `undefined`. The group assignment was left to inference from data that didn't contain it. |
| **`CRICKET_INT_TEAM_SERIES` expanded** | `9ade00f` | Following Australia didn't surface the Bangladesh ODI or T20I series — only the Test series from August were hardcoded | Cricket series coverage is entirely determined by a hardcoded ID map. Any series not explicitly listed is invisible to the system. The underlying gap: ESPN cricket has no single "all upcoming series" endpoint — coverage requires manual curation of series IDs. |

**The shared root:** Four of the six fixes are the same concept expressed differently — the model was asked to infer a fact that the code had the data to compute but didn't deliver in an unambiguous form:

- The NBA series state (who leads, what's at stake) was knowable from ESPN's `comp.series.summary` but needed to be reformatted into plain English before the model could act on it reliably.
- The World Cup group letter was determinable from ESPN's standings endpoint but was being derived from a scoreboard field that doesn't contain it.
- The NBA competition profile described a generic case ("the trailing team must win 3 straight") which was accurate but required the model to apply it to the right team — which it got wrong under the pressure of historical narrative patterns about 3-1 comebacks.

The pattern: **the problem is never missing raw data — it's raw data that the model must parse, interpret, or apply before it can use it correctly.** The fix in every case was to pre-compute the interpretation and inject it as an explicit, labelled fact.

The **fixture stakes / importance label** gap (§3, row 5) has not been addressed by any fix yet. No fix has explicitly told the model "this is an elimination final" or "this is a dead rubber." The model infers it from the DERIVED FACTS numbers and the phase label — which works well when the gap-to-finals numbers are clean, but can fail for bracket games, State of Origin (where no standings exist), or the first game of a cricket/rugby series.

---

## Section 5 — Proposed "League Structure" Reference (Skeleton — Do Not Build)

The §3 matrix shows that "left to model" cells cluster around three concepts:
1. What **phase** of the competition is this fixture in?
2. What are the **stakes** — does winning/losing change something material?
3. What is the **series or bracket state** right now?

A declarative per-competition structure reference would pre-compute all three and inject them as explicit labelled facts, turning "left to model" cells into "fed as fact."

### What it would encode per competition

A `CompetitionStructure` object (one per league) with:

- **Format** — season length (rounds or race weekends), whether finals/playoffs exist, number of teams advancing, any secondary axes (relegation, European spots, bonus points).
- **Phases** — named phases with their boundaries (e.g. "early: rounds 1–6, mid: 7–15, run-home: 16–23, finals: post-23" for AFL). These are already partially in `LEAGUE_TOTAL_ROUNDS` and the 65% threshold but scattered across `buildDataBlock`.
- **Importance rules** — declarative predicates that evaluate to a `stakes` string: e.g. "if rank ≤ 8 and gap-to-9th ≤ 3 and roundsRemaining ≤ 5 → FINALS CONTENTION"; "if rank ≥ 18 and roundsRemaining ≤ 8 → RELEGATION BATTLE"; "if series score is 3-1 and thisGame is Game 5 → CLINCH OPPORTUNITY / ELIMINATION GAME".
- **Series/bracket rules** — for best-of-N competitions: total games, clinch threshold, comeback threshold.
- **Structural notes** — the one-liner exceptions like "NRL Maroons: representative side, no ladder"; "World Cup group: top-2 auto + best-8 thirds = 32"; "EPL: no playoffs, just the table."

### What would be computed from it and injected

Given a fixture (team, opponent, competition, date, series score if any, standings row), the reference would compute:

- `phase`: the named phase string, deterministically, replacing the scattered 65% logic.
- `stakes`: a short, explicit label: `ELIMINATION`, `CLINCH OPPORTUNITY`, `DEAD RUBBER`, `FINALS RACE`, `RELEGATION BATTLE`, `TOP-OF-TABLE`, `SERIES DECIDER`, `STANDARD`.
- `seriesState`: for playoff/series competitions, the unambiguous "{leader} leads {A}–{B}; needs {N} more win(s)" line (already partially done by `deriveSeriesState()` for NBA; would generalise to rugby series, cricket series).
- `advancementScenario`: already done for World Cup via `computeGroupAdvancementScenario()` — would extend to AFL/NRL finals bubble and EPL zones.

These three fields would appear as a new `FIXTURE CONTEXT` block in the data block, sitting between `COMPETITION` and `COMPETITION PROFILE`:

```
FIXTURE CONTEXT:
  Phase: run home (Round 21 of 23)
  Stakes: FINALS RACE — followed team sits 9th, 1 point outside the top 8 with 2 rounds left
  Clinch note: A win keeps them in contention; a loss eliminates them if 8th-placed team wins
```

### Where it plugs into the §1 path

The reference would be consumed during step 3 (`buildDataBlock`), before the SEASON STATE and DERIVED FACTS sections are assembled:

1. `resolveCompetitionContext(league, competition, teamStanding, opponentStanding, seriesSummary, played)` → returns `{ phase, stakes, seriesState, advancementScenario }`.
2. These fields are injected as the `FIXTURE CONTEXT` block.
3. Existing `SEASON STATE`, `DERIVED FACTS`, and `ADVANCEMENT SCENARIO` sections continue to provide supporting numbers — the new block gives the label, the existing blocks give the evidence.

### Scope and limits

- This is one definition file per competition (≈10 entries), plus one `resolveCompetitionContext()` function.
- The hardest part is the **importance-rule predicates** — they require access to the live standings at build time and must handle edge cases (team has played more games than opponent, multi-team ties at the cutoff). The DERIVED FACTS infrastructure already does most of this arithmetic; the new layer just needs to classify it.
- It does **not** solve the cricket-series-ID curation problem (§4, last row) — that remains a data-availability gap, not a structural one.
- Rugby Int and State of Origin remain special cases: no standings means importance can only be inferred from the series scoreline (rugby) or the Origin context label (NRL). A series-score field for rugby equivalent to NBA's `seriesSummary` would be needed first.

---

## Follow-ons: remaining data gaps the classifier cannot paper over

These are prerequisite **data** gaps, not structural ones. `resolveCompetitionContext` cannot close them without the underlying data being available first.

| Gap | What's missing | What it blocks |
|-----|----------------|----------------|
| **NBA regular-season standings** | `fetchNBAFixtures` returns no league table — only playoff series data. | FINALS RACE / PLAY-IN RACE stakes for regular-season NBA games. The playoffs path already works via `deriveSeriesState`. |
| **Rugby Int series-score field** | No `seriesSummary`-equivalent for Test/Rugby Championship/Six Nations series. The model infers series state from the competition label and news only. | SERIES DECIDER / dead-rubber labels for bilateral rugby series. Add an ESPN `comp.series.summary` capture to `fetchRINTFixtures` first. |
| **Cricket Int series-score field** | Same gap as rugby_int. `fetchCricketIntFixtures` captures `cricketFormat` but not the current series score. | Format-aware stakes (Test series decider, T20 dead rubber). |
| **AFL / NRL finals type distinction** | The fixture `competition` label doesn't distinguish Qualifying Final, Elimination Final, Semi-Final, Preliminary Final, or Grand Final. `isFinalsPhase` fires but the specific round is unknown. | "ELIMINATION FINAL" vs "QUALIFYING FINAL" labels. Currently FINALS LOCKED / ELIMINATED is the best we can do once the regular season is over. |
| **F1 championship-gap-to-title** | Driver and constructor championship gaps are not pre-computed in the data block — the model reads the standings table and does arithmetic. | TITLE CONTENDER / MATHEMATICALLY ELIMINATED labels for F1. |
| **cricket_int and bbl not in generator loop** | `LEAGUES` in `scripts/generate-previews.ts:52` omits both. Fetchers and competition profiles exist; `resolveCompetitionContext` would return STANDARD for them in any case (no structure defined). | Auto-generated previews for any cricket or BBL fixture. Must add to LEAGUES and define a `StructureDef` for BBL (14-game round-robin, top-5 finals). |

*Implementation status as of this section: `resolveCompetitionContext` covers `afl`, `nrl`, `super_rugby`, `epl`, `world_cup` (first wave). All other leagues return `{ phase: 'standard', stakes: 'STANDARD' }` and emit no FIXTURE CONTEXT block.*

---

*Audit compiled from source as of commit `b95bb95` (§1–§5). Follow-ons section added after first-wave implementation.*
