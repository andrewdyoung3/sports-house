/**
 * International home/away/neutral resolution — for national teams, "home"
 * means ANY ground in the team's country, not a registered stadium string
 * (rule set 2026-09-16). Pure logic over three inputs: the two teams'
 * countries (from TEAMS) and the venue's country (from the feed's venue
 * address, or the venue string's trailing ", Country" segment).
 *
 * Positive-evidence discipline applies: a decision is returned only when the
 * venue country is confidently known and unambiguous; otherwise {} and the
 * caller keeps whatever the feed said. Special cases:
 *   - "United Kingdom" venues match England/Scotland/Wales ONLY when exactly
 *     one side is a UK nation (England v Scotland at a UK venue is undecidable
 *     from country alone).
 *   - West Indies is a multi-nation side: Caribbean member countries count as
 *     West Indies home soil.
 */

import { TEAMS } from '@/lib/teams';

/** teamId → country, for international leagues (rugby_int, cricket_int). */
export const INTL_TEAM_COUNTRY: Record<string, string> = Object.fromEntries(
  TEAMS.filter(t => (t.league === 'rugby_int' || t.league === 'cricket_int') && t.country)
    .map(t => [t.id, t.country as string]),
);

const UK_NATIONS = new Set(['England', 'Scotland', 'Wales', 'Northern Ireland']);

/** Caribbean nations that count as West Indies home soil. */
const WEST_INDIES_SOIL = new Set([
  'Barbados', 'Jamaica', 'Trinidad and Tobago', 'Guyana', 'Antigua and Barbuda',
  'Antigua', 'Saint Lucia', 'St Lucia', 'Grenada', 'Dominica',
  'Saint Kitts and Nevis', 'St Kitts and Nevis', 'Saint Vincent and the Grenadines',
]);

/** Countries we recognise in venue strings (team countries + common hosts). */
const KNOWN_COUNTRIES = new Set<string>([
  ...Object.values(INTL_TEAM_COUNTRY),
  ...WEST_INDIES_SOIL,
  'United Kingdom', 'Ireland', 'Australia', 'New Zealand', 'South Africa',
  'India', 'Pakistan', 'Sri Lanka', 'Bangladesh', 'Afghanistan', 'Zimbabwe',
  'United Arab Emirates', 'UAE', 'Oman', 'Qatar', 'United States', 'USA',
  'France', 'Italy', 'Japan', 'Argentina', 'Fiji', 'Samoa', 'Tonga',
]);

/** Canonicalise a raw venue country to the space our team countries live in. */
function canonCountry(raw: string): string {
  const c = raw.trim();
  if (c === 'UAE') return 'United Arab Emirates';
  if (c === 'USA') return 'United States';
  if (c === 'St Lucia') return 'Saint Lucia';
  if (c === 'St Kitts and Nevis') return 'Saint Kitts and Nevis';
  if (c === 'Antigua') return 'Antigua and Barbuda';
  return c;
}

/**
 * Extract a country from a venue string's trailing comma segment
 * ("Kensington Oval, Bridgetown, Barbados" → "Barbados"). Returns undefined
 * unless the segment is a KNOWN country — city names never match.
 */
export function countryFromVenueString(venue: string | undefined): string | undefined {
  if (!venue || !venue.includes(',')) return undefined;
  const last = venue.split(',').pop()!.trim();
  return KNOWN_COUNTRIES.has(last) ? canonCountry(last) : undefined;
}

export interface IntlVenueStatus {
  /** true = the team's country hosts; false = the opponent's country hosts. */
  isHome?: boolean;
  /** true = third-country venue (genuinely neutral); false = someone hosts. */
  neutralSite?: boolean;
}

/** Does this side call the venue country home soil? */
function isHomeSoil(teamCountry: string, venueCountry: string): boolean {
  if (teamCountry === venueCountry) return true;
  if (teamCountry === 'West Indies' && WEST_INDIES_SOIL.has(venueCountry)) return true;
  return false;
}

export function resolveIntlVenueStatus(
  teamCountry: string | undefined,
  oppCountry: string | undefined,
  venueCountryRaw: string | undefined,
): IntlVenueStatus {
  if (!venueCountryRaw || !teamCountry) return {};
  const venueCountry = canonCountry(venueCountryRaw);

  // UK venues: only decidable when exactly one side is a UK nation.
  if (venueCountry === 'United Kingdom') {
    const teamUK = UK_NATIONS.has(teamCountry);
    const oppUK  = oppCountry !== undefined && UK_NATIONS.has(oppCountry);
    if (teamUK && !oppUK) return { isHome: true, neutralSite: false };
    if (!teamUK && oppUK) return { isHome: false, neutralSite: false };
    return {};
  }

  if (isHomeSoil(teamCountry, venueCountry)) return { isHome: true, neutralSite: false };
  if (oppCountry !== undefined && isHomeSoil(oppCountry, venueCountry)) {
    return { isHome: false, neutralSite: false };
  }
  // Known venue country, belongs to neither side — POSITIVE evidence of
  // neutrality (only when we know both sides; with the opponent's country
  // unknown, the venue could still be theirs, so stay silent).
  if (oppCountry !== undefined) return { neutralSite: true };
  return {};
}
