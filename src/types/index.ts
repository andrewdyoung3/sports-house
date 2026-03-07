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
  odds?: {
    spread: string;
    overUnder: string;
  };
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface GameResult {
  opponent: string;
  opponentAbbr: string;
  isHome: boolean;
  isWin: boolean;
  teamScore: number;
  opponentScore: number;
  date: string;
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

// ─── User Preferences ────────────────────────────────────────────────────────

export interface UserPreferences {
  teams: Team[];
  savedAt: string;
}
