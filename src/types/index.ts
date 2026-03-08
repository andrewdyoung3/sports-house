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
  | 'nhl';

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
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface GameResult {
  opponent: string;
  opponentAbbr: string;
  opponentLogoUrl?: string;  // ESPN CDN / team logo when available
  isHome: boolean;
  isWin: boolean;
  isDraw?: boolean;           // Football/soccer draws (score level at FT)
  teamScore: number;
  opponentScore: number;
  date: string;
  competition?: string;       // Non-primary cup/CL competition label
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
}

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

export interface PreviewContext {
  teamStanding?: TeamStanding;
  opponentStanding?: TeamStanding;
  teamNews?: NewsHeadline[];
  opponentNews?: NewsHeadline[];
  tips?: TipSummary;
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
}

// ─── User Preferences ────────────────────────────────────────────────────────

export interface UserPreferences {
  teams: Team[];
  savedAt: string;
}
