// ─── League / Sport ───────────────────────────────────────────────────────────

// Australian sports listed first — reflects product priority
export type SportKey =
  | 'afl'
  | 'nrl'
  | 'super_rugby'
  | 'rugby_int'
  | 'epl'
  | 'nba'
  | 'nfl'
  | 'mlb'
  | 'nhl'
  | 'f1'
  | 'cricket_int'
  | 'bbl'
  | 'world_cup';

// ─── World Cup ────────────────────────────────────────────────────────────────

/** Stage of a 2026 FIFA World Cup match. */
export type WorldCupStage =
  | 'group'   // Group stage match (Groups A–L)
  | 'r32'     // Round of 32
  | 'r16'     // Round of 16
  | 'qf'      // Quarter-finals
  | 'sf'      // Semi-finals
  | 'third'   // Third-place play-off
  | 'final';  // Final

/** Structural context for a World Cup match, passed to the AI preview. */
export interface WorldCupMatchContext {
  stage: WorldCupStage;
  /** Group label (A–L) — only present for group-stage matches. */
  group?: string;
  /** Full group standings table (4 entries) — only for group-stage matches. */
  groupTable?: WorldCupGroupRow[];
  /** Completed GROUP-STAGE results among this group's teams (who-beat-whom), for
   *  the 2026 head-to-head-first tiebreaker. Only finished matches; a scheduled
   *  meeting is absent (⇒ "not met"). Scores are from each listed team's view. */
  groupResults?: Array<{ teamA: string; teamB: string; goalsA: number; goalsB: number }>;
  /** How many group games the followed team has played (0–3). */
  gamesPlayed?: number;
  /** How many group games remain for the followed team (0–3). */
  gamesRemaining?: number;
  /** Plain-English advancement scenario for the followed team. Computed server-side. */
  advancementScenario?: string;
  /** True when the opponent is still TBD (placeholder in the bracket). */
  opponentTBD?: boolean;
  /** Placeholder label for TBD opponent, e.g. "Winner Group A" */
  opponentPlaceholder?: string;
}

export interface League {
  id: SportKey;
  name: string;       // Short label, e.g. "AFL"
  fullName: string;   // e.g. "Australian Football League"
  sport: string;      // e.g. "Australian Rules Football"
  icon: string;       // Emoji icon used in UI
  country: string;
}

// ─── Team ─────────────────────────────────────────────────────────────────────

export interface Team {
  id: string;             // Unique slug, e.g. 'afl-swans'
  name: string;           // Full name, e.g. 'Sydney Swans'
  shortName: string;      // e.g. 'Swans'
  abbreviation: string;   // e.g. 'SYD'
  league: SportKey;
  sport: string;
  city: string;
  country: string;
  primaryColor: string;   // Hex
  secondaryColor: string; // Hex
  venue: string;
  division?: string;      // Conference / division if applicable
}

/** One row of a World Cup group table. */
export interface WorldCupGroupRow {
  teamName: string;
  teamId?: string;        // our internal wc-* id when resolvable
  position: number;       // 1–4 within the group
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

// ─── Games / Schedule ─────────────────────────────────────────────────────────

export interface UpcomingGame {
  id: string;
  teamId: string;
  opponent: string;
  opponentAbbr: string;
  opponentColor: string;
  isHome: boolean;
  date: string;       // ISO date string
  time: string;       // Display time with timezone, e.g. "7:40 PM AEST"
  venue: string;
  broadcast: string[];    // TV channels
  streaming: string[];    // Streaming platforms
  competition?: string;    // e.g. "FA Cup", "Champions League" (omitted for regular season)
  opponentLogoUrl?: string; // Official logo URL (from ESPN CDN when available)
  opponentId?: string;      // Our internal team slug for the opponent (when resolvable)
  odds?: {
    spread: string;
    overUnder: string;
  };
  /** Cricket only — match format */
  cricketFormat?: 'test' | 'odi' | 't20';
  /** Test cricket only — match can span this many days (always 5) */
  matchDays?: number;
  /** World Cup only — tournament stage */
  worldCupStage?: WorldCupStage;
  /** World Cup only — group label for group-stage matches (e.g. "A") */
  worldCupGroup?: string;
  /** World Cup only — true when opponent is still TBD (bracket placeholder) */
  worldCupOpponentTBD?: boolean;
  /** World Cup only — placeholder label for TBD opponent */
  worldCupOpponentPlaceholder?: string;
  /** Set by fetchLeagueFixtures when lookbackDays > 0 — true for recently-completed games */
  completed?: boolean;
  /** NBA playoffs — official series score from ESPN (e.g. "NY leads series 3-1") */
  seriesSummary?: string;
  /** Extra game_previews keys to upsert the SAME generated payload under.
   *  Used for representative games (State of Origin) whose display layer keys per
   *  perspective (soo-nrl-blues-… AND soo-nrl-maroons-…) — one generation, both keys. */
  mirrorGameIds?: string[];
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface GameResult {
  opponent: string;
  opponentAbbr: string;
  opponentLogoUrl?: string;  // ESPN CDN / team logo when available
  opponentId?: string;       // Our internal team slug for the opponent (when resolvable)
  isHome: boolean;
  isWin: boolean;
  isDraw?: boolean;           // Football/soccer draws (score level at FT)
  teamScore: number;
  opponentScore: number;
  date: string;
  competition?: string;       // Non-primary cup/CL competition label
  /** F1 only — finishing position label: "P1", "P3", "DNF", "DSQ", "NC" etc. */
  f1Position?: string;
  /** Cricket only — our team's batting score, e.g. "287/6 (50 ov)" */
  cricketScore?: string;
  /** Cricket only — opponent's batting score */
  cricketOppScore?: string;
  /** Cricket only — full result description, e.g. "Won by 45 runs", "Match drawn" */
  cricketResult?: string;
  /** Cricket only — match format */
  cricketFormat?: 'test' | 'odi' | 't20';
  /** Test cricket only — structured innings array [{team, score, overs}] */
  cricketInnings?: Array<{ team: string; score: string; overs?: number }>;
  /** World Cup only — tournament stage */
  worldCupStage?: WorldCupStage;
  /** World Cup only — group label for group-stage matches */
  worldCupGroup?: string;
}

// ─── News ─────────────────────────────────────────────────────────────────────

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string; // ISO string
  url: string;
  category: 'injury' | 'trade' | 'recap' | 'preview' | 'general';
}

// ─── Match Preview (rule-based, no LLM cost) ─────────────────────────────────

export interface GamePreview {
  gameId: string;
  content: string;
  keyInsights: string[];
  predictedEdge: 'home' | 'away' | 'even';
  confidenceScore: number; // 0–1
  generatedAt: string;
}

// ─── Season State / Preview Context ──────────────────────────────────────────

export interface TeamStanding {
  name: string;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points?: number;         // EPL: points; AFL: percentage used instead
  goalsFor?: number;
  goalsAgainst?: number;
  percentage?: number;     // AFL: for/against percentage
  rankChange?: number;     // +ve = moved up, -ve = moved down, 0 = same (from ESPN previousRank)
  constructorName?: string; // F1: constructor/team name for the driver
  group?: string;          // World Cup: group label 'A'–'L'
}

export type StandingRow = TeamStanding & { teamId?: string };

export interface NewsHeadline {
  headline: string;
  description?: string;
  published?: string;      // ISO string
}

export interface TipSummary {
  favouriteTeam: string;
  tipsFor: number;
  tipsTotal: number;
  avgMargin: number;
}

/** One past meeting between the two fixture teams, from the followed team's perspective. */
export interface HeadToHeadMeeting {
  /** ISO date of the meeting. Kept for ordering only — NEVER surfaced as a year in the prompt. */
  date: string;
  /** Followed team's score. */
  teamScore: number;
  /** Opponent's score. */
  opponentScore: number;
  /** Result from the followed team's perspective. */
  result: 'W' | 'L' | 'D';
  /** Whether the followed team was at home for this meeting (best-effort from ESPN's atVs). */
  teamWasHome?: boolean;
}

export interface CompetitionStage {
  /** Human-readable stage label — e.g. "Round of 16", "Quarter-finals", "Group A" */
  roundName: string;
  /** True for group/league phases that have a standings table; false for knockout. */
  isGroupPhase: boolean;
  /** Group or conference name during a group phase — e.g. "Group B" */
  groupName?: string;
  /** Team's position within this competition phase (group/league phase only) */
  teamStanding?: TeamStanding;
  opponentStanding?: TeamStanding;
}

/** Minimal table row used for mathematical standings analysis. */
export interface LeagueTableRow {
  name: string;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Competition points (e.g. EPL: 3/win; AFL: 4/win; NRL: 2/win). */
  points: number;
  /**
   * AFL only: for/against percentage (points scored ÷ points conceded × 100).
   * The official ladder tiebreaker when teams are level on competition points.
   * Omitted for all other leagues — do not populate if not a genuine tiebreaker.
   */
  percentage?: number;
}

export interface PreviewContext {
  teamStanding?: TeamStanding;
  opponentStanding?: TeamStanding;
  /** Fixture kickoff (ISO) — used to infer the finals round (the feed carries no
   *  stage label for finals games). Set by buildPreviewContext for every fixture. */
  fixtureDate?: string;
  /**
   * Full league table — used server-side to compute mathematical clinching /
   * elimination facts before they reach Claude. Populated for EPL, NRL, AFL,
   * Super Rugby; absent for cup / European fixtures and F1.
   */
  leagueTable?: LeagueTableRow[];
  teamNews?: NewsHeadline[];
  opponentNews?: NewsHeadline[];
  tips?: TipSummary;
  /**
   * Each side's recent results (most recent first), sourced from ESPN's
   * `lastFiveGames` summary block. When present, the RECENT FORM block reads from
   * here; otherwise it falls back to the positional results passed to buildDataBlock.
   */
  teamRecentForm?: GameResult[];
  opponentRecentForm?: GameResult[];
  /** Recent meetings between the two fixture teams (most recent first), team perspective. */
  headToHead?: HeadToHeadMeeting[];
  /**
   * Forecast at kickoff for outdoor fixtures (Open-Meteo). When present, the WEATHER
   * block reads from here; otherwise it falls back to the positional weather arg.
   */
  weather?: WeatherData;
  /** Cup/European competitions — current stage info and optional group standings. */
  competitionStage?: CompetitionStage;
  /** Head coach / manager name, used to inform tactical analysis. */
  teamManager?: string;
  opponentManager?: string;
  /** Starting players from each team's most recent game, used to infer likely lineup. */
  teamLastLineup?: string[];
  opponentLastLineup?: string[];
  /** AFL: 26-player Squiggle squad submission for the upcoming game.
   *  Cross-reference with teamLastLineup to identify ins (possible returns) and outs (likely absent). */
  teamSquad?: string[];
  opponentSquad?: string[];
  /** Players confirmed or likely unavailable for the upcoming fixture.
   *  Populated from ESPN injury reports (NRL, EPL, Super Rugby). */
  teamInjuryReport?: Array<{ name: string; status: string }>;
  opponentInjuryReport?: Array<{ name: string; status: string }>;
  /** Key performers from the most recent completed game — name + formatted stat line.
   *  Used for basketball (NBA) where player stats are the primary narrative hook. */
  teamKeyPlayers?: Array<{ name: string; stats: string }>;
  opponentKeyPlayers?: Array<{ name: string; stats: string }>;
  /** Label for the game these key-player stats came from, e.g. "NBA Finals - Game 3". */
  keyPlayersGameLabel?: string;
  /** For two-legged knockout ties: score from the first leg (team's perspective). */
  firstLegResult?: { teamScore: number; opponentScore: number };
  /** Representative-series state (State of Origin) — replaces the club ladder.
   *  e.g. "Game 2 of 3 — New South Wales lead the series 1-0; a win here clinches it." */
  seriesState?: string;
  /** For English cup fixtures: the division the opponent currently plays in (e.g. "Championship", "League One") — only set when they are not in the top flight. */
  opponentLeague?: string;

  // ── F1-specific preview data ──────────────────────────────────────────────
  f1DriverStandings?: Array<{
    position: number;
    driverName: string;
    teamId?: string;
    constructorName: string;
    points: number;
    wins: number;
    ergastDriverId: string;
  }>;
  f1ConstructorStandings?: Array<{
    position: number;
    constructorName: string;
    points: number;
    wins: number;
  }>;
  f1RecentRaceResults?: Array<{
    round: number;
    raceName: string;
    /** Top-10 finishers for this race */
    results: Array<{
      position: number;
      driverName: string;
      constructorName: string;
      ergastDriverId: string;
    }>;
  }>;
  f1FollowedType?: 'driver' | 'constructor';
  /** Full name of followed driver (e.g. "Max Verstappen") or constructor (e.g. "McLaren") */
  f1FollowedName?: string;
  /** Constructor name for the followed driver (same as f1FollowedName if following constructor) */
  f1FollowedConstructorName?: string;
  /** World Cup structural context — assembled by /api/preview for world_cup league. */
  worldCup?: WorldCupMatchContext;

  /** Cricket (BBL / internationals) — match + series context from cricketdata.org.
   *  Rendered by the dedicated cricket data block. Squads use teamSquad/opponentSquad. */
  cricketContext?: {
    format?: string;          // "T20" | "ODI" | "Test"
    seriesName?: string;
    matchDesc?: string;       // e.g. "18th Match, Group A"
    venue?: string;
    status?: string;          // cricketdata status line (started/result/"not started")
    started?: boolean;
    ended?: boolean;
    toss?: string;            // e.g. "India won the toss and chose to bat"
    teamScoreLine?: string;   // followed team's innings, e.g. "170/6 (20 ov)" — only if started
    opponentScoreLine?: string;
    /** Qualitative recent results for the followed team in this series (most recent first). */
    teamRecentResults?: string[];
    /** Qualitative head-to-head note between the two sides in this series. */
    h2hNote?: string;
  };

  f1SessionType?: string;   // "Race", "Qualifying", "Practice 1", etc.
  f1RaceName?: string;      // "Japanese Grand Prix"
  f1CircuitName?: string;   // "Suzuka Circuit"
  f1RoundNumber?: number;
  /** Full starting grid populated once qualifying is complete. */
  f1QualifyingGrid?: Array<{
    position: number;
    driverName: string;
    constructorName: string;
    ergastDriverId: string;
    q1?: string;
    q2?: string;
    q3?: string;
  }>;
}

// ─── Match Stats (live/completed game player + team data) ────────────────────

export interface PlayerStatLine {
  name: string;
  position?: string;
  /** e.g. [{ label: 'G', value: '2' }, { label: 'A', value: '1' }] */
  stats: Array<{ label: string; value: string }>;
}

export interface TeamMatchStats {
  teamName: string;
  /** Aggregate team-level stats (possession, shots, etc.) */
  aggStats: Array<{ label: string; value: string }>;
  players: PlayerStatLine[];
}

export interface MatchStats {
  team: TeamMatchStats;
  opponent: TeamMatchStats;
}

// ─── AI Match Review (post-match, retrospective) ─────────────────────────────

export interface AIReview {
  /** 2–3 sentences explaining what happened tactically and why. */
  summary: string;
  /** 2–3 specific, grounded factors that determined the match. */
  keyMoments: string[];
  /** What this result means for the team going forward. */
  verdict: string;
}

// ─── AI Match Preview ────────────────────────────────────────────────────────

export interface AIPreview {
  /** Big-picture season story — positions, stakes, narrative weight. */
  context: string;
  /** The tactical clash where the fixture will be won or lost. */
  tacticalBattle: string;
  /** Player or position that is the pivotal storyline. */
  playerSpotlight: string;
  /** Authoritative narrative outcome and what could flip the result. */
  verdict: string;
  /** 3–4 short punchy tactical or contextual insights. */
  keyInsights: string[];
  /**
   * "From the media" — attributed editorial talking points sourced from the
   * fetched news headlines, model tips, and expected-lineup framing. Every entry
   * is presented as reporting or opinion ("[Outlet] reports…", "The tipsters
   * lean…"), never as the model's own factual claim. Omitted when there is no
   * editorial data for the fixture.
   */
  mediaWatch?: string[];
}

// ─── Weather ─────────────────────────────────────────────────────────────────

export interface WeatherData {
  /** Broad condition bucket: 'clear' | 'cloud' | 'drizzle' | 'rain' | 'snow' | 'fog' | 'storm' */
  condition: string;
  /** Display emoji icon */
  icon: string;
  /** Short human-readable description, e.g. "Heavy rain" */
  description: string;
  /** Temperature at kickoff in °C */
  tempC: number;
  /** Precipitation in mm for the kickoff hour */
  precipMm: number;
  /** Precipitation probability 0–100 */
  precipProbability: number;
  /** Wind speed in km/h */
  windKmh: number;
  /** Raw WMO weather code from Open-Meteo */
  weatherCode: number;
  /** True when conditions meaningfully affect play (rain/wind/extreme temp) */
  isNotable: boolean;
}

// ─── User Preferences ────────────────────────────────────────────────────────

export interface UserPreferences {
  teams: Team[];
  savedAt: string;
}
