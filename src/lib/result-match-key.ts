/**
 * result-match-key.ts — one perspective-independent identity for a completed match.
 *
 * A match reaches the results page from two directions: the followed TEAM's
 * fetch (their perspective) and the followed COMPETITION's fetch (canonical
 * home perspective). The two carry different `teamId`s, different `opponent`
 * names and therefore different render ids, so the same match lists twice
 * unless both are reduced to a shared key.
 *
 * Team ids are not usable for this: only the two cricket fetchers populate
 * GameResult.opponentId, so for AFL the two copies read
 * (afl-lions, "Hawthorn") and (afl-hawks, "Brisbane Lions") — no overlap.
 * Abbreviations ARE present on both sides of every fetcher (opponentAbbr is
 * required on GameResult), and resolve to the same pair from either
 * perspective: [BRI, HAW] both ways.
 *
 * Lives in its own module so the API route and the page cannot drift into two
 * definitions of "the same match".
 */

/**
 * Identity of one side. ABBREVIATION FIRST, and the same order for both sides —
 * the two perspectives must be described in one vocabulary or they never meet.
 * (Preferring ids here would key the Lions copy as "afl-lions|haw" and the
 * Hawks copy as "afl-hawks|bri": still two rows.)
 */
function side(abbr: string | undefined, id: string | undefined, name: string): string {
  return (abbr || id || name).toLowerCase().trim();
}

/**
 * Key for a completed match, identical from either side's perspective.
 *
 * F1 has no team pair — a race is a single event — so it keys on the race
 * itself: same race name, same day, one row.
 */
export function resultMatchKey(input: {
  league: string;
  teamId: string;
  teamAbbr?: string;
  opponent: string;
  opponentId?: string;
  opponentAbbr?: string;
  date: string;
}): string {
  const day = input.date.slice(0, 10);
  if (input.league === 'f1') return `f1·${input.opponent.toLowerCase().trim()}·${day}`;
  const a = side(input.opponentAbbr, input.opponentId, input.opponent);
  const b = side(input.teamAbbr, input.teamId, input.teamId);
  return [a, b].sort().join('|') + '·' + day;
}
