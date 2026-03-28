/**
 * English football tier lookup for cup opponent context.
 * Tier 1 = Premier League (not here — those are in EPL_TEAMS in league-fixtures)
 * Tier 2 = Championship
 * Tier 3 = League One
 * Tier 4 = League Two
 * Tier 5 = National League
 *
 * Used to identify what division a cup opponent comes from when they're
 * not found in the Premier League standings.
 *
 * Updated for 2025-26 season. Clubs move between tiers due to promotion/relegation —
 * this table reflects best-known positions for the current season.
 */

export interface EnglishClubEntry {
  tier: 2 | 3 | 4 | 5;
  division: string;  // human-readable label
  espnId?: string;   // ESPN soccer team ID for fetching standings
}

export const ENGLISH_FOOTBALL_DIVISIONS: Record<string, EnglishClubEntry> = {
  // ── Championship (Tier 2) ──────────────────────────────────────────────────
  // 2025-26: includes clubs relegated from PL 2024-25 + promoted from League One
  'Southampton':           { tier: 2, division: 'Championship', espnId: '376' },
  'Leicester City':        { tier: 2, division: 'Championship', espnId: '375' },
  'Ipswich Town':          { tier: 2, division: 'Championship', espnId: '373' },
  'Middlesbrough':         { tier: 2, division: 'Championship', espnId: '383' },
  'Coventry City':         { tier: 2, division: 'Championship', espnId: '390' },
  'Sheffield Wednesday':   { tier: 2, division: 'Championship', espnId: '350' },
  'Norwich City':          { tier: 2, division: 'Championship', espnId: '395' },
  'Queens Park Rangers':   { tier: 2, division: 'Championship', espnId: '348' },
  'QPR':                   { tier: 2, division: 'Championship', espnId: '348' },
  'Watford':               { tier: 2, division: 'Championship', espnId: '378' },
  'West Bromwich Albion':  { tier: 2, division: 'Championship', espnId: '355' },
  'West Brom':             { tier: 2, division: 'Championship', espnId: '355' },
  'Stoke City':            { tier: 2, division: 'Championship', espnId: '392' },
  'Swansea City':          { tier: 2, division: 'Championship', espnId: '385' },
  'Hull City':             { tier: 2, division: 'Championship', espnId: '346' },
  'Bristol City':          { tier: 2, division: 'Championship', espnId: '387' },
  'Luton Town':            { tier: 2, division: 'Championship', espnId: '377' },
  'Sheffield United':      { tier: 2, division: 'Championship', espnId: '358' },
  'Millwall':              { tier: 2, division: 'Championship', espnId: '388' },
  'Cardiff City':          { tier: 2, division: 'Championship', espnId: '386' },
  'Derby County':          { tier: 2, division: 'Championship', espnId: '344' },
  'Blackburn Rovers':      { tier: 2, division: 'Championship', espnId: '343' },
  'Preston North End':     { tier: 2, division: 'Championship', espnId: '336' },
  'Plymouth Argyle':       { tier: 2, division: 'Championship', espnId: '396' },
  'Oxford United':         { tier: 2, division: 'Championship', espnId: '352' },
  'Portsmouth':            { tier: 2, division: 'Championship', espnId: '335' },
  'Blackpool':             { tier: 2, division: 'Championship', espnId: '345' },
  'Barnsley':              { tier: 2, division: 'Championship', espnId: '381' },
  'Rotherham United':      { tier: 2, division: 'Championship' },
  'Birmingham City':       { tier: 2, division: 'Championship' },
  'Swansea':               { tier: 2, division: 'Championship', espnId: '385' },

  // ── League One (Tier 3) ───────────────────────────────────────────────────
  'Charlton Athletic':     { tier: 3, division: 'League One' },
  'Huddersfield Town':     { tier: 3, division: 'League One' },
  'Wigan Athletic':        { tier: 3, division: 'League One' },
  'Peterborough United':   { tier: 3, division: 'League One' },
  'Wycombe Wanderers':     { tier: 3, division: 'League One' },
  'Cambridge United':      { tier: 3, division: 'League One' },
  'Lincoln City':          { tier: 3, division: 'League One' },
  'Reading':               { tier: 3, division: 'League One' },
  'Exeter City':           { tier: 3, division: 'League One' },
  'Shrewsbury Town':       { tier: 3, division: 'League One' },
  'Stevenage':             { tier: 3, division: 'League One' },
  'Stockport County':      { tier: 3, division: 'League One' },
  'Wrexham':               { tier: 3, division: 'League One' },
  'Birmingham':            { tier: 3, division: 'League One' },
  'Burton Albion':         { tier: 3, division: 'League One' },
  'Northampton Town':      { tier: 3, division: 'League One' },
  'Leyton Orient':         { tier: 3, division: 'League One' },
  'Fleetwood Town':        { tier: 3, division: 'League One' },

  // ── League Two (Tier 4) ───────────────────────────────────────────────────
  'Wimbledon':             { tier: 4, division: 'League Two' },
  'AFC Wimbledon':         { tier: 4, division: 'League Two' },
  'Notts County':          { tier: 4, division: 'League Two' },
  'Morecambe':             { tier: 4, division: 'League Two' },
  'Bradford City':         { tier: 4, division: 'League Two' },
  'Gillingham':            { tier: 4, division: 'League Two' },
  'Grimsby Town':          { tier: 4, division: 'League Two' },
  'Tranmere Rovers':       { tier: 4, division: 'League Two' },
  'Harrogate Town':        { tier: 4, division: 'League Two' },
  'Salford City':          { tier: 4, division: 'League Two' },
  'Chesterfield':          { tier: 4, division: 'League Two' },
  'Swindon Town':          { tier: 4, division: 'League Two' },
  'Cheltenham Town':       { tier: 4, division: 'League Two' },
  'MK Dons':               { tier: 4, division: 'League Two' },
  'Colchester United':     { tier: 4, division: 'League Two' },
  'Accrington Stanley':    { tier: 4, division: 'League Two' },

  // ── National League (Tier 5) ──────────────────────────────────────────────
  'York City':             { tier: 5, division: 'National League' },
  'Oldham Athletic':       { tier: 5, division: 'National League' },
  'Boreham Wood':          { tier: 5, division: 'National League' },
  'Altrincham':            { tier: 5, division: 'National League' },
  'Eastleigh':             { tier: 5, division: 'National League' },
  'Woking':                { tier: 5, division: 'National League' },
  'Wealdstone':            { tier: 5, division: 'National League' },
  'Solihull Moors':        { tier: 5, division: 'National League' },
  'Gateshead':             { tier: 5, division: 'National League' },
  'Bromley':               { tier: 5, division: 'National League' },
};

/**
 * ESPN soccer competition slug for each English tier.
 * Used to fetch standings when we need the opponent's actual position.
 */
export const ENGLISH_TIER_SLUG: Record<number, string> = {
  1: 'eng.1',   // Premier League
  2: 'eng.2',   // Championship
  3: 'eng.3',   // League One
  4: 'eng.4',   // League Two
};

/**
 * Returns the division entry for an opponent name, trying both exact and
 * partial matching (e.g. "Southampton FC" matches "Southampton").
 */
export function lookupEnglishDivision(opponentName: string): EnglishClubEntry | undefined {
  // Exact match first
  if (ENGLISH_FOOTBALL_DIVISIONS[opponentName]) return ENGLISH_FOOTBALL_DIVISIONS[opponentName];
  // Partial match — opponent name contains or is contained by a key
  const lower = opponentName.toLowerCase();
  for (const [key, entry] of Object.entries(ENGLISH_FOOTBALL_DIVISIONS)) {
    const k = key.toLowerCase();
    if (lower.includes(k) || k.includes(lower)) return entry;
  }
  return undefined;
}
