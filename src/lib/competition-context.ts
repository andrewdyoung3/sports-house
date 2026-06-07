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
      `23 rounds of regular season (home-and-away). Top 8 teams qualify for a 4-week finals series using the McIntyre Final 8 system: teams 1st–4th receive a double-chance (losers get a second chance in week 2; winners advance directly to the Preliminary Final). Teams 5th–8th face single-elimination from week one. Points: 4 for a win, 2 for a draw, 0 for a loss. Percentage (points for ÷ points against × 100) breaks ladder ties. NO relegation — all 18 clubs remain in the competition each season. "Wooden spoon" = 18th place finish. "Premiership window" = a team's competitive era when they are genuine flag contenders. The term "score" in AFL refers to goals and behinds kicked — never use it to mean ladder points or wins.`,
  },
  nrl: {
    name: 'NRL Telstra Premiership',
    profile:
      `27 rounds of regular season. Top 8 teams qualify for a finals series: teams 1st–4th receive a double-chance in weeks one and two (losers play again; winners advance). Teams 5th–8th face immediate elimination. Points: 2 for a win, 1 for a draw, 0 for a loss. Points differential is used to separate teams equal on ladder points. NO relegation — all 17 clubs remain each season. Magic Round is a mid-season marquee weekend where all games are held in Brisbane — form there can be anomalous. State of Origin (June–July) removes ~25 players from NRL rosters across those rounds, distorting form for Origin-heavy clubs. "Wooden spoon" = 17th (last) place.`,
  },
  epl: {
    name: 'Premier League',
    profile:
      `38 rounds of a round-robin league. NO finals or playoffs — the championship, European spots, and relegation are all decided purely by final points tally after 38 games. Points: 3 for a win, 1 for a draw, 0 for a loss. European qualification: top 4 → Champions League; 5th → Europa League; 6th → Conference League (subject to UEFA co-efficient adjustments). Relegation: the 3 clubs finishing 18th, 19th, and 20th are relegated to the Championship; the bottom 3 positions are the only ones that trigger relegation. NO concept of "making the playoffs" or "finals qualification" exists in this league — any language implying so is factually wrong for the Premier League.`,
  },
  super_rugby: {
    name: 'Super Rugby Pacific',
    profile:
      `14 rounds of regular season across 12 clubs (Australia, New Zealand, Fiji, Samoa). Top 8 teams qualify for the finals: quarter-finals, semi-finals, and a grand final. Points: 4 for a win, 2 for a draw, 0 for a loss; +1 bonus point for scoring 4 or more tries; +1 bonus point for losing by 7 or fewer. The bonus-point system means a losing side can still earn a competition point. NO relegation — all 12 clubs are permanent members. The season runs February–June in the Southern Hemisphere summer. Australian and New Zealand clubs historically dominate; Fijian Drua and Moana Pasifika are the Pacific expansion sides.`,
  },
  rugby_int: {
    name: 'International Rugby Union Test Match',
    profile:
      `One-off Test matches between national teams — each game stands alone. Structured annual competitions include the Six Nations (6 teams, 5 rounds each, round-robin, no knockout) and The Rugby Championship (6 teams, home-and-away, bonus-point system). Outside these tournaments, bilateral Test series are typically 2–3 games. No playoffs exist within a single Test series — series winners are decided by aggregate Test wins. NO relegation from Test rugby. A "Grand Slam" in the Six Nations means beating all five other nations. Nations may play additional "Autumn Internationals" (northern hemisphere November window) and "Summer Tours". The Rugby World Cup (every 4 years) is the sport's premier event.`,
  },
  f1: {
    name: 'FIA Formula 1 World Championship',
    profile:
      `~24 race weekends per season. NO playoffs — both the Drivers' Championship and the Constructors' Championship are decided by cumulative points across all rounds (25/18/15/12/10/8/6/4/2/1 for P1–P10, plus 1 point for fastest lap). Two separate championships run in parallel: Drivers' (individual) and Constructors' (team aggregate of both drivers). A team can lead the Constructors' Championship while its drivers do not lead the Drivers' Championship, and vice versa. Six sprint weekends per season add a Saturday mini-race awarding half-points. Qualifying determines race grid positions. NO concept of home ground, away fixture, or relegation. 2026 regulations: active aerodynamics replace DRS; Manual Override (MO) electrical boost; new power units (~50/50 ICE/electrical split).`,
  },
  bbl: {
    name: 'KFC BBL (Big Bash League)',
    profile:
      `Round-robin regular season followed by a finals series. Each club plays 14 matches in the regular season. Top 5 teams qualify for finals: the Challenger (2nd vs 3rd), Eliminator (4th vs 5th), Knockout (winner of Eliminator vs loser of Challenger), and The Final (1st vs winner of Knockout). Points: 2 for a win, 1 for a no-result/tie, 0 for a loss. T20 format: 20 overs per side per innings; games last approximately 3.5 hours. NO relegation — all 8 BBL clubs are permanent. The BBL runs December–February in the Australian summer. "Batting Powerplay" (overs 1–6) restricts fielders outside the 30-metre circle.`,
  },
  cricket_int: {
    name: 'International Cricket',
    profile:
      `International cricket is played across three formats: Test matches (5 days, 2 innings per side — the game's highest form; results can be wins, losses, or draws), One Day Internationals (50 overs per side, one innings each), and T20 Internationals (20 overs per side). Series are typically 2–5 matches; series winners are decided by match wins within that series. NO single global points table for one-off bilateral series — the ICC World Test Championship (WTC) aggregates Test results, but bilateral ODI/T20 series are standalone. ICC knockout tournaments (World Cup, Champions Trophy) have group-stage and knockout phases. NO relegation from international cricket — teams' Test status is governed by ICC membership.`,
  },
};

/** Returns the competition profile for a league, or null if not configured. */
export function getCompetitionProfile(league: string): CompetitionProfile | null {
  return COMPETITION_PROFILES[league] ?? null;
}
