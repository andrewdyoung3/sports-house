/**
 * Club honours — curated premiership records, surfaced ONLY for deciders.
 *
 * A Grand Final preview that cannot say "Fremantle have never won a flag" or
 * "Brisbane are chasing a third straight" is missing the story that every
 * newspaper leads with. Nothing in the live feeds carries this, so it is a
 * small hand-maintained table gated on `finalsRoundForDate(...).decider`.
 *
 * Counting convention (stated in the block so the model can't drift):
 *   - AFL: VFL/AFL premierships under the club's current identity. Predecessor
 *     clubs are NOT folded in (Fitzroy's 8 are not Brisbane's; Port Adelaide's
 *     SANFL flags are not AFL flags).
 *   - NRL: NSWRL/ARL/NRL premierships under the current identity. St George
 *     Illawarra's count is as the joint venture; Wests Tigers likewise.
 *
 * MAINTENANCE: bump `through` and the winning club's `titles` / `lastTitle` /
 * `lastDecider` after each decider. Records are as at the end of the `through`
 * season. `lastDecider` is the club's most recent decider appearance (won or
 * lost); `null` means the club has never played one.
 */

export interface ClubHonours {
  /** Premierships under the current club identity. */
  titles: number;
  /** Season of the most recent premiership; null if none. */
  lastTitle: number | null;
  /** Most recent decider appearance and its outcome. */
  lastDecider: { season: number; result: 'won' | 'lost'; opponent: string } | null;
  /** Consecutive titles entering this season, if the club is the reigning champion. */
  streak?: number;
  /** The club's own longest earlier run of consecutive titles, when one exists. Stated so the
   *  model has no reason to reach for "unprecedented" — it is told outright the feat has precedent. */
  priorRun?: { length: number; span: string };
  /** Clarifying note for identity/counting edge cases. */
  note?: string;
}

/** Latest completed season each league's table reflects. */
export const HONOURS_THROUGH: Record<string, number> = { afl: 2025, nrl: 2025 };

const AFL: Record<string, ClubHonours> = {
  'afl-crows':     { titles: 2,  lastTitle: 1998, lastDecider: { season: 2017, result: 'lost', opponent: 'Richmond' } },
  'afl-lions':     { titles: 5,  lastTitle: 2025, lastDecider: { season: 2025, result: 'won',  opponent: 'Geelong' }, streak: 2,
                     priorRun: { length: 3, span: '2001–03' },
                     note: 'counted as Brisbane Lions (2001–03, 2024, 2025); Fitzroy\'s 8 VFL flags are not included' },
  'afl-blues':     { titles: 16, lastTitle: 1995, lastDecider: { season: 1999, result: 'lost', opponent: 'North Melbourne' } },
  'afl-pies':      { titles: 16, lastTitle: 2023, lastDecider: { season: 2023, result: 'won',  opponent: 'Brisbane Lions' } },
  'afl-bombers':   { titles: 16, lastTitle: 2000, lastDecider: { season: 2001, result: 'lost', opponent: 'Brisbane Lions' } },
  'afl-dockers':   { titles: 0,  lastTitle: null, lastDecider: { season: 2013, result: 'lost', opponent: 'Hawthorn' },
                     note: 'one Grand Final appearance in club history' },
  'afl-cats':      { titles: 10, lastTitle: 2022, lastDecider: { season: 2025, result: 'lost', opponent: 'Brisbane Lions' } },
  'afl-suns':      { titles: 0,  lastTitle: null, lastDecider: null, note: 'never played in a Grand Final' },
  'afl-giants':    { titles: 0,  lastTitle: null, lastDecider: { season: 2019, result: 'lost', opponent: 'Richmond' } },
  'afl-hawks':     { titles: 13, lastTitle: 2015, lastDecider: { season: 2015, result: 'won',  opponent: 'West Coast' } },
  'afl-demons':    { titles: 13, lastTitle: 2021, lastDecider: { season: 2021, result: 'won',  opponent: 'Western Bulldogs' } },
  'afl-kangaroos': { titles: 4,  lastTitle: 1999, lastDecider: { season: 1999, result: 'won',  opponent: 'Carlton' } },
  'afl-power':     { titles: 1,  lastTitle: 2004, lastDecider: { season: 2007, result: 'lost', opponent: 'Geelong' },
                     note: 'AFL premierships only; SANFL flags are not counted' },
  'afl-tigers':    { titles: 13, lastTitle: 2020, lastDecider: { season: 2020, result: 'won',  opponent: 'Geelong' } },
  'afl-saints':    { titles: 1,  lastTitle: 1966, lastDecider: { season: 2010, result: 'lost', opponent: 'Collingwood' },
                     note: '2010 decider was drawn and replayed; the replay was lost' },
  'afl-swans':     { titles: 5,  lastTitle: 2012, lastDecider: { season: 2024, result: 'lost', opponent: 'Brisbane Lions' },
                     note: 'includes 3 as South Melbourne' },
  'afl-eagles':    { titles: 4,  lastTitle: 2018, lastDecider: { season: 2018, result: 'won',  opponent: 'Collingwood' } },
  'afl-dogs':      { titles: 2,  lastTitle: 2016, lastDecider: { season: 2021, result: 'lost', opponent: 'Melbourne' },
                     note: 'includes 1 as Footscray' },
};

const NRL: Record<string, ClubHonours> = {
  'nrl-broncos':   { titles: 7,  lastTitle: 2025, lastDecider: { season: 2025, result: 'won',  opponent: 'Melbourne Storm' }, streak: 1 },
  'nrl-raiders':   { titles: 3,  lastTitle: 1994, lastDecider: { season: 2019, result: 'lost', opponent: 'Sydney Roosters' } },
  'nrl-bulldogs':  { titles: 8,  lastTitle: 2004, lastDecider: { season: 2014, result: 'lost', opponent: 'South Sydney' } },
  'nrl-sharks':    { titles: 1,  lastTitle: 2016, lastDecider: { season: 2016, result: 'won',  opponent: 'Melbourne Storm' } },
  'nrl-dolphins':  { titles: 0,  lastTitle: null, lastDecider: null, note: 'never played in a Grand Final' },
  'nrl-titans':    { titles: 0,  lastTitle: null, lastDecider: null, note: 'never played in a Grand Final' },
  'nrl-eels':      { titles: 4,  lastTitle: 1986, lastDecider: { season: 2022, result: 'lost', opponent: 'Penrith' } },
  'nrl-panthers':  { titles: 6,  lastTitle: 2024, lastDecider: { season: 2024, result: 'won',  opponent: 'Melbourne Storm' },
                     priorRun: { length: 4, span: '2021–24' } },
  'nrl-seahawks':  { titles: 8,  lastTitle: 2011, lastDecider: { season: 2013, result: 'lost', opponent: 'Sydney Roosters' } },
  'nrl-storm':     { titles: 4,  lastTitle: 2020, lastDecider: { season: 2025, result: 'lost', opponent: 'Brisbane Broncos' },
                     note: 'the 2007 and 2009 titles were stripped and are not counted' },
  'nrl-knights':   { titles: 2,  lastTitle: 2001, lastDecider: { season: 2001, result: 'won',  opponent: 'Parramatta' } },
  'nrl-warriors':  { titles: 0,  lastTitle: null, lastDecider: { season: 2011, result: 'lost', opponent: 'Manly' },
                     note: 'two Grand Final appearances (2002, 2011)' },
  'nrl-cowboys':   { titles: 1,  lastTitle: 2015, lastDecider: { season: 2017, result: 'lost', opponent: 'Melbourne Storm' } },
  'nrl-rabbitohs': { titles: 21, lastTitle: 2014, lastDecider: { season: 2021, result: 'lost', opponent: 'Penrith' } },
  'nrl-dragons':   { titles: 1,  lastTitle: 2010, lastDecider: { season: 2010, result: 'won',  opponent: 'Sydney Roosters' },
                     note: 'as the St George Illawarra joint venture; St George\'s 15 pre-merger titles are not included' },
  'nrl-roosters':  { titles: 15, lastTitle: 2019, lastDecider: { season: 2019, result: 'won',  opponent: 'Canberra' } },
  'nrl-tigers':    { titles: 1,  lastTitle: 2005, lastDecider: { season: 2005, result: 'won',  opponent: 'North Queensland' },
                     note: 'as Wests Tigers; Balmain and Western Suburbs titles are not included' },
};

const BY_LEAGUE: Record<string, Record<string, ClubHonours>> = { afl: AFL, nrl: NRL };

export function clubHonours(league: string, teamId: string | undefined): ClubHonours | null {
  if (!teamId) return null;
  return BY_LEAGUE[league]?.[teamId] ?? null;
}

/**
 * One prose-ready line per club. Written as facts, not story — the prompt
 * tells the model which of these are worth surfacing.
 */
export function describeHonours(league: string, teamName: string, h: ClubHonours): string {
  const comp = league === 'afl' ? 'VFL/AFL' : 'NSWRL/ARL/NRL';
  const parts: string[] = [];
  if (h.titles === 0) {
    parts.push(`${teamName} have NEVER won a ${comp} premiership`);
    parts.push(h.lastDecider
      ? `their most recent decider was ${h.lastDecider.season} (lost to ${h.lastDecider.opponent})`
      : 'this is their first ever Grand Final');
  } else {
    parts.push(`${teamName}: ${h.titles} ${comp} premiership${h.titles === 1 ? '' : 's'}, the last in ${h.lastTitle}`);
    if (h.lastDecider && h.lastDecider.season !== h.lastTitle) {
      parts.push(`last decider ${h.lastDecider.season} (${h.lastDecider.result} v ${h.lastDecider.opponent})`);
    } else if (h.lastDecider) {
      parts.push(`won the ${h.lastDecider.season} decider v ${h.lastDecider.opponent}`);
    }
    if (h.streak && h.streak >= 1) {
      const next = h.streak + 1;
      const precedent = h.priorRun
        ? (h.priorRun.length >= next
          ? `, REPEATING the club's own ${h.priorRun.span} run of ${h.priorRun.length} — so it is NOT unprecedented and must never be called that; say "a third straight flag, as in ${h.priorRun.span}"`
          : ` — their longest run to date is ${h.priorRun.length} (${h.priorRun.span})`)
        : '';
      parts.push(h.streak >= 2
        ? `reigning champions on a run of ${h.streak} straight — a win here makes it ${next} in a row${precedent}`
        : `reigning champions — a win here makes it back-to-back${precedent}`);
    }
  }
  const line = parts.join('; ');
  return h.note ? `${line} (${h.note})` : line;
}
