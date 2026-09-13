/**
 * Static competition structure profiles — one per supported league.
 *
 * Each profile documents HOW the competition works: format, finals/playoff
 * structure (or explicit "NO playoffs"), qualification cutoffs, and the
 * concepts the model must not confuse with other leagues.
 *
 * These are injected into the prompt data block as COMPETITION PROFILE.
 * The system prompt instructs the model that all statements about season
 * structure, finals, qualification, and relegation MUST come from this
 * section — never from training knowledge.
 *
 * Update this file when format changes (e.g. expanded finals, new finals
 * structure, relegation rule changes). Keep entries to ~100-150 words.
 */

export interface CompetitionProfile {
  /** Full display name of the competition. */
  name: string;
  /** Combined prose covering format, finals, qualification, and key concepts. */
  profile: string;
}

export const COMPETITION_PROFILES: Record<string, CompetitionProfile> = {
  afl: {
    name: 'AFL Premiership Season',
    profile:
      `23 games of regular season (home-and-away). From 2026 the finals use a top-10 WILDCARD format (the first change since 2000): the top 6 qualify directly for the finals and get the opening week off; teams 7th–10th play a standalone Wildcard Round (7th v 10th, 8th v 9th) whose two winners take the last two places in the final eight. Finishing outside the top 10 means no finals. The final eight then plays the four-week final-eight system: week one — Qualifying Finals (1st v 4th, 2nd v 3rd; the LOSERS are NOT eliminated, they drop to a home semi-final) and Elimination Finals (5th v 8th, 6th v 7th; losers eliminated); week two — Semi-Finals (qualifying-final losers host elimination-final winners, knockout); week three — Preliminary Finals (qualifying-final winners host semi-final winners, knockout); week four — the Grand Final at the MCG (late September). Points: 4 for a win, 2 for a draw, 0 for a loss. Percentage (points for ÷ points against × 100) breaks ladder ties. NO relegation — all 18 clubs remain in the competition each season. "Wooden spoon" = 18th place finish. "Premiership window" = a team's competitive era when they are genuine flag contenders. The term "score" in AFL refers to goals and behinds kicked — never use it to mean ladder points or wins.`,
  },
  nrl: {
    name: 'NRL Telstra Premiership',
    profile:
      `27 rounds of regular season. Top 8 teams qualify for a four-week final-eight finals series: week one — Qualifying Finals (1st v 4th, 2nd v 3rd; the LOSERS are NOT eliminated — the double chance — they drop to a home semi-final) and Elimination Finals (5th v 8th, 6th v 7th; losers eliminated); week two — Semi-Finals (qualifying-final losers host elimination-final winners, knockout); week three — Preliminary Finals (qualifying-final winners host semi-final winners, knockout); week four — the Grand Final at Accor Stadium (traditionally the first Sunday in October). Points: 2 for a win, 1 for a draw, 0 for a loss. Points differential is used to separate teams equal on ladder points. NO relegation — all 17 clubs remain each season. Magic Round is a mid-season marquee weekend where all games are held in Brisbane — form there can be anomalous. State of Origin (June–July) removes ~25 players from NRL rosters across those rounds, distorting form for Origin-heavy clubs. "Wooden spoon" = 17th (last) place.`,
  },
  epl: {
    name: 'Premier League',
    profile:
      `38 rounds of a round-robin league. NO finals or playoffs — the championship, European spots, and relegation are all decided purely by final points tally after 38 games. Points: 3 for a win, 1 for a draw, 0 for a loss. European qualification (2025-26): the top 5 → Champions League (England earned a 5th place via UEFA's European Performance Spot / coefficient this cycle); the next places feed the Europa League and Conference League (subject to UEFA coefficient adjustments and domestic-cup winners). Relegation: the 3 clubs finishing 18th, 19th, and 20th are relegated to the Championship; the bottom 3 positions are the only ones that trigger relegation. NO concept of "making the playoffs" or "finals qualification" exists in this league — any language implying so is factually wrong for the Premier League.`,
  },
  super_rugby: {
    name: 'Super Rugby Pacific',
    profile:
      `14 rounds of regular season across 11 clubs (Australia, New Zealand, Fiji, Samoa). From 2025 the top 6 qualify for the finals (reduced from 8): qualifying finals (1st v 6th, 2nd v 5th, 3rd v 4th, higher seed hosts) → semi-finals → Grand Final. The highest-seeded losing qualifying-finalist advances to the semis as the 4th seed and plays the rest away. Points: 4 for a win, 2 for a draw, 0 for a loss; +1 bonus point for scoring 4 or more tries; +1 bonus point for losing by 7 or fewer. The bonus-point system means a losing side can still earn a competition point. NO relegation — all clubs are permanent members. The season runs February–June. Australian and New Zealand clubs historically dominate; Fijian Drua and Moana Pasifika are the Pacific sides.`,
  },
  rugby_int: {
    name: 'International Rugby Union Test Match',
    profile:
      `One-off Test matches between national teams — each game stands alone. Structured annual competitions include the Six Nations (6 teams, 5 rounds each, round-robin, no knockout) and The Rugby Championship (6 teams, home-and-away, bonus-point system). Outside these tournaments, bilateral Test series are typically 2–3 games. No playoffs exist within a single Test series — series winners are decided by aggregate Test wins. NO relegation from Test rugby. A "Grand Slam" in the Six Nations means beating all five other nations. Nations may play additional "Autumn Internationals" (northern hemisphere November window) and "Summer Tours". The Rugby World Cup (every 4 years) is the sport's premier event.`,
  },
  f1: {
    name: 'FIA Formula 1 World Championship',
    profile:
      `24 race weekends per season. NO playoffs — both the Drivers' Championship and the Constructors' Championship are decided by cumulative points across all rounds (25/18/15/12/10/8/6/4/2/1 for P1–P10). There is NO fastest-lap point (abolished from 2025). Two separate championships run in parallel: Drivers' (individual) and Constructors' (team aggregate of both drivers). A team can lead the Constructors' Championship while its drivers do not lead the Drivers' Championship, and vice versa. Six sprint weekends per season add a Saturday sprint race awarding 8-7-6-5-4-3-2-1 to the top eight. Qualifying determines race grid positions. NO concept of home ground, away fixture, or relegation. 2026 regulations: active aerodynamics replace DRS; Manual Override (MO) electrical boost; new power units (~50/50 ICE/electrical split).`,
  },
  bbl: {
    name: 'KFC BBL (Big Bash League)',
    profile:
      `Round-robin regular season followed by a four-match finals series. Each club plays 10 regular-season matches (40-game season). The TOP 4 qualify for finals (the top-5 era ended with BBL|13): The Qualifier (1st v 2nd — the winner advances directly to the Final and hosts it; the loser gets a second chance), The Knockout (3rd v 4th — the loser is eliminated), The Challenger (Qualifier loser v Knockout winner — the winner takes the second Final spot), and The Final. Points: 2 for a win, 1 for a no-result/tie, 0 for a loss; Net Run Rate breaks table ties. T20 format: 20 overs per side per innings; games last approximately 3.5 hours. NO relegation — all 8 BBL clubs are permanent. The BBL runs December–February in the Australian summer. "Batting Powerplay" (overs 1–6) restricts fielders outside the 30-metre circle.`,
  },
  cricket_int: {
    name: 'International Cricket',
    profile:
      `International cricket is played across three formats: Test matches (5 days, 2 innings per side — the game's highest form; results can be wins, losses, or draws), One Day Internationals (50 overs per side, one innings each), and T20 Internationals (20 overs per side). Series are typically 2–5 matches; series winners are decided by match wins within that series. NO single global points table for one-off bilateral series — the ICC World Test Championship (WTC) aggregates Test results, but bilateral ODI/T20 series are standalone. ICC knockout tournaments (World Cup, Champions Trophy) have group-stage and knockout phases. NO relegation from international cricket — teams' Test status is governed by ICC membership.`,
  },
  nba: {
    name: 'NBA (National Basketball Association)',
    profile:
      `82-game regular season; 30 teams, Eastern and Western Conferences. Top 6 teams per conference qualify directly for the playoffs. Teams 7th–10th play the Play-In Tournament to decide the 7th and 8th seeds. Playoffs are single-elimination best-of-7 series: the first team to win 4 games advances. Conference Quarterfinals (Round 1) → Conference Semifinals → Conference Finals → NBA Finals. The NBA Finals is the championship series between the Eastern and Western Conference champions; the first team to win 4 games becomes NBA Champion. Home court advantage in a series belongs to the higher seed (more regular-season wins). SERIES SCORE: take the SERIES SCORE line in this data block as the authoritative current state — never invent or assume it from game number alone. If the series score shows one team leads 3-1, the trailing team must win 3 consecutive games to claim the series; the leading team needs only 1 more win for the championship. NO relegation — all 30 NBA franchises are permanent members.`,
  },
  nhl: {
    name: 'NHL (National Hockey League)',
    profile:
      `82-game regular season; 32 teams across two conferences (Eastern, Western), each split into two divisions. Points: 2 for a win (regulation, overtime, or shootout), 1 for an overtime/shootout loss (the "loser point"), 0 for a regulation loss — so a team's points total can rise even in defeat. Playoffs: 16 teams — the top 3 in each division plus 2 wildcards per conference. ALL four playoff rounds are best-of-7 series (first to 4 wins advances): First Round and Second Round are division-based brackets, then the Conference Finals, then the Stanley Cup Final between the two conference champions. SERIES SCORE: take any SERIES SCORE line in this data block as the authoritative current state — never infer it from game number. The Presidents' Trophy goes to the best regular-season record — it is NOT the championship; only the Stanley Cup is. NO relegation — all 32 franchises are permanent.`,
  },
};

/** Returns the competition profile for a league, or null if not configured. */
export function getCompetitionProfile(league: string): CompetitionProfile | null {
  return COMPETITION_PROFILES[league] ?? null;
}
