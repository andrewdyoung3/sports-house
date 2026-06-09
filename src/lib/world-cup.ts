/**
 * Static structure for the 2026 FIFA World Cup.
 *
 * Encodes ONLY the tournament format — the 12 group labels, knockout-round
 * sequence, and advancement rules. Live data (group assignments, fixtures,
 * results, standings) is fetched from ESPN `fifa.world` and must NOT be
 * hard-coded here.
 *
 * 2026 is the first 48-team World Cup. Key format facts:
 *   • 12 groups of 4 (Groups A–L), 104 matches total
 *   • Hosts: USA, Canada, Mexico
 *   • Group stage: Jun 11 – Jun 27, Final: Jul 19
 *   • Advancement: top 2 from each group (24) + best 8 third-placed teams = 32
 *   • Knockout: R32 → R16 → QF → SF → 3rd-place play-off + Final
 */

import type { WorldCupStage } from '@/types';

// ─── Group labels ─────────────────────────────────────────────────────────────

export const WC_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const;
export type WCGroup = (typeof WC_GROUPS)[number];

// ─── Knockout-round sequence ──────────────────────────────────────────────────

export interface KnockoutRound {
  stage: WorldCupStage;
  label: string;       // Display label
  shortLabel: string;  // Short badge label
  isSingleElim: true;
}

export const WC_KNOCKOUT_ROUNDS: KnockoutRound[] = [
  { stage: 'r32',   label: 'Round of 32',        shortLabel: 'R32',    isSingleElim: true },
  { stage: 'r16',   label: 'Round of 16',        shortLabel: 'R16',    isSingleElim: true },
  { stage: 'qf',    label: 'Quarter-finals',     shortLabel: 'QF',     isSingleElim: true },
  { stage: 'sf',    label: 'Semi-finals',        shortLabel: 'SF',     isSingleElim: true },
  { stage: 'third', label: 'Third-place play-off', shortLabel: '3rd',  isSingleElim: true },
  { stage: 'final', label: 'Final',              shortLabel: 'Final',  isSingleElim: true },
];

// ─── Stage display helpers ────────────────────────────────────────────────────

export function wcStageLabel(stage: WorldCupStage, group?: string): string {
  if (stage === 'group') return group ? `Group ${group}` : 'Group Stage';
  return WC_KNOCKOUT_ROUNDS.find(r => r.stage === stage)?.label ?? stage;
}

export function wcStageBadge(stage: WorldCupStage, group?: string): string {
  if (stage === 'group') return group ? `Grp ${group}` : 'Group';
  return WC_KNOCKOUT_ROUNDS.find(r => r.stage === stage)?.shortLabel ?? stage;
}

/** Returns a plain-English description of what's at stake in a knockout round. */
export function wcKnockoutStake(stage: WorldCupStage): string {
  switch (stage) {
    case 'r32':   return 'Win to advance to the Round of 16; lose and your World Cup is over.';
    case 'r16':   return 'Win to reach the quarter-finals; lose and your World Cup is over.';
    case 'qf':    return 'Win to reach the semi-finals; lose and your World Cup is over.';
    case 'sf':    return 'Win to reach the final; lose and you play in the third-place play-off.';
    case 'third': return 'Third-place play-off — a chance to finish the tournament with a medal.';
    case 'final': return 'THE FINAL — win and lift the FIFA World Cup.';
    default:      return 'Single-elimination knockout — lose and your World Cup is over.';
  }
}

// ─── Advancement rules ────────────────────────────────────────────────────────

/**
 * Group stage advancement criteria (per FIFA 2026 regulations):
 * 1. Points (W=3, D=1, L=0)
 * 2. Goal difference
 * 3. Goals scored
 * 4. Head-to-head: points among tied teams
 * 5. Head-to-head: goal difference among tied teams
 * 6. Head-to-head: goals scored among tied teams
 * 7. Fair-play disciplinary score (yellow=−1, red=−3, yellow+red=−4)
 * 8. FIFA ranking
 * 9. Drawing of lots
 */
export const WC_GROUP_TIEBREAKERS = [
  'Points',
  'Goal difference',
  'Goals scored',
  'Head-to-head points',
  'Head-to-head goal difference',
  'Head-to-head goals scored',
  'Disciplinary record (fair-play)',
  'FIFA ranking',
  'Drawing of lots',
] as const;

/**
 * Third-place ranking criteria (to select the best 8 third-placed teams):
 * 1. Points
 * 2. Goal difference
 * 3. Goals scored
 * 4. Disciplinary record
 * 5. FIFA ranking
 */
export const WC_THIRD_PLACE_CRITERIA = [
  'Points',
  'Goal difference',
  'Goals scored',
  'Disciplinary record',
  'FIFA ranking',
] as const;

export const WC_GROUPS_COUNT = 12;           // A–L
export const WC_TEAMS_PER_GROUP = 4;
export const WC_AUTO_ADVANCE_PER_GROUP = 2;  // top 2 qualify automatically
export const WC_BEST_THIRDS = 8;             // best 8 of 12 third-placed teams also qualify
export const WC_TOTAL_KO_TEAMS = WC_GROUPS_COUNT * WC_AUTO_ADVANCE_PER_GROUP + WC_BEST_THIRDS; // 32

// ─── ESPN round-name → stage mapping ─────────────────────────────────────────

/**
 * Maps ESPN's competition round/description strings to our WorldCupStage.
 * ESPN uses strings like "Group Stage", "Round of 32", "Quarter-finals", etc.
 * Keys are lowercase for case-insensitive matching.
 */
const ESPN_ROUND_MAP: Array<{ pattern: RegExp; stage: WorldCupStage }> = [
  { pattern: /group/i,              stage: 'group'  },
  { pattern: /round of 32|r32/i,    stage: 'r32'    },
  { pattern: /round of 16|r16/i,    stage: 'r16'    },
  { pattern: /quarter.?final|qf/i,  stage: 'qf'     },
  { pattern: /semi.?final|sf/i,     stage: 'sf'     },
  { pattern: /third.?place|3rd/i,   stage: 'third'  },
  { pattern: /\bfinal\b/i,          stage: 'final'  },
];

/**
 * Derives a WorldCupStage from an ESPN round/competition name string.
 * Falls back to 'group' when the stage cannot be determined (group stage
 * is by far the most common — this is a safe default during the tournament).
 */
export function espnRoundToStage(roundName: string | undefined): WorldCupStage {
  if (!roundName) return 'group';
  for (const { pattern, stage } of ESPN_ROUND_MAP) {
    if (pattern.test(roundName)) return stage;
  }
  return 'group';
}

/**
 * Extracts a group label (A–L) from an ESPN round/competition name, e.g.
 * "Group A", "FIFA World Cup — Group B", etc.
 */
export function espnRoundToGroup(roundName: string | undefined): string | undefined {
  if (!roundName) return undefined;
  const m = roundName.match(/[Gg]roup\s+([A-La-l])\b/);
  if (!m) return undefined;
  const g = m[1].toUpperCase() as WCGroup;
  return WC_GROUPS.includes(g) ? g : undefined;
}

// ─── Advancement scenario text ────────────────────────────────────────────────

/**
 * Computes a plain-English advancement scenario string for a followed team
 * in the group stage. Used in the AI preview data block.
 *
 * @param teamName - Display name of the followed team
 * @param teamPts  - Followed team's current group points
 * @param played   - Number of group games played
 * @param gamesRemaining - Group games left
 * @param groupTable - Full 4-team group table sorted by position
 */
export function computeGroupAdvancementScenario(
  teamName: string,
  teamPts: number,
  played: number,
  gamesRemaining: number,
  rankInGroup: number,
): string {
  // Tournament hasn't started — suppress scenario text entirely.
  if (played === 0) return '';

  if (gamesRemaining === 0) {
    // Group stage is done
    if (rankInGroup <= 2) {
      return `${teamName} have finished the group stage and advanced to the Round of 32 (finished ${ordinal(rankInGroup)} in their group).`;
    }
    return `${teamName} finished ${ordinal(rankInGroup)} in their group. They may still advance if they rank among the 8 best third-placed teams across all 12 groups.`;
  }

  const maxPossiblePts = teamPts + gamesRemaining * 3;

  if (rankInGroup === 1 && played >= 2) {
    return `${teamName} lead their group with ${teamPts} points from ${played} game${played === 1 ? '' : 's'} and are well-placed to advance from the group stage.`;
  }
  if (rankInGroup <= 2 && played >= 2) {
    return `${teamName} are currently in an automatic qualification spot (${ordinal(rankInGroup)} in their group, ${teamPts} pts from ${played} game${played === 1 ? '' : 's'}).`;
  }
  if (rankInGroup === 3) {
    return `${teamName} are third in their group (${teamPts} pts). They need to improve their position or finish among the best third-placed teams to advance.`;
  }
  if (rankInGroup === 4) {
    if (maxPossiblePts < 3) {
      return `${teamName} are fourth in their group (${teamPts} pts) and face an uphill battle to advance.`;
    }
    return `${teamName} are fourth in their group (${teamPts} pts) and must win remaining games to stay in contention.`;
  }

  // Generic fallback
  return `${teamName} have ${teamPts} points from ${played} game${played === 1 ? '' : 's'} with ${gamesRemaining} to play.`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── ESPN team display name → our internal wc-* id ───────────────────────────

/**
 * Maps ESPN displayNames to our internal `wc-*` team IDs.
 * ESPN uses official FIFA country names; some have variant spellings.
 * All 48 confirmed 2026 WC participants are listed.
 */
export const WC_ESPN_NAME_TO_ID: Record<string, string> = {
  // CONCACAF hosts
  'United States':          'wc-usa',
  'USA':                    'wc-usa',
  'Canada':                 'wc-canada',
  'Mexico':                 'wc-mexico',

  // CONMEBOL (6)
  'Argentina':              'wc-argentina',
  'Brazil':                 'wc-brazil',
  'Colombia':               'wc-colombia',
  'Ecuador':                'wc-ecuador',
  'Uruguay':                'wc-uruguay',
  'Paraguay':               'wc-paraguay',

  // CONCACAF non-hosts (3)
  'Panama':                 'wc-panama',
  'Curaçao':                'wc-curacao',
  'Curacao':                'wc-curacao',
  'Haiti':                  'wc-haiti',

  // UEFA (16)
  'France':                 'wc-france',
  'Spain':                  'wc-spain',
  'England':                'wc-england',
  'Germany':                'wc-germany',
  'Portugal':               'wc-portugal',
  'Netherlands':            'wc-netherlands',
  'Belgium':                'wc-belgium',
  'Croatia':                'wc-croatia',
  'Switzerland':            'wc-switzerland',
  'Austria':                'wc-austria',
  'Sweden':                 'wc-sweden',
  'Norway':                 'wc-norway',
  'Scotland':               'wc-scotland',
  'Turkey':                 'wc-turkey',
  'Türkiye':                'wc-turkey',
  'Czech Republic':         'wc-czechia',
  'Czechia':                'wc-czechia',
  'Bosnia & Herzegovina':   'wc-bosnia',
  'Bosnia and Herzegovina': 'wc-bosnia',

  // CAF — Africa (10)
  'Morocco':                'wc-morocco',
  'Senegal':                'wc-senegal',
  'Algeria':                'wc-algeria',
  'Egypt':                  'wc-egypt',
  'Tunisia':                'wc-tunisia',
  'South Africa':           'wc-southafrica',
  'DR Congo':               'wc-drcongo',
  'Congo DR':               'wc-drcongo',
  'Côte d\'Ivoire':         'wc-ivorycoast',
  'Ivory Coast':            'wc-ivorycoast',
  'Ghana':                  'wc-ghana',
  'Cape Verde':             'wc-capeverde',
  'Cabo Verde':             'wc-capeverde',

  // AFC — Asia (9)
  'Japan':                  'wc-japan',
  'IR Iran':                'wc-iran',
  'Iran':                   'wc-iran',
  'South Korea':            'wc-southkorea',
  'Korea Republic':         'wc-southkorea',
  'Australia':              'wc-australia',
  'Qatar':                  'wc-qatar',
  'Saudi Arabia':           'wc-saudiarabia',
  'Uzbekistan':             'wc-uzbekistan',
  'Jordan':                 'wc-jordan',
  'Iraq':                   'wc-iraq',

  // OFC — Oceania (1)
  'New Zealand':            'wc-newzealand',
};

/** Reverse map: our wc-* id → ESPN displayName (primary name). */
export const WC_ID_TO_ESPN_NAME: Record<string, string> = Object.fromEntries(
  // Use the longer/more canonical name when there are multiple entries for same id
  Object.entries(WC_ESPN_NAME_TO_ID)
    .filter(([espnName]) => !['USA', 'Türkiye', 'Korea Republic', 'Congo DR', 'Ivory Coast', 'IR Iran', 'Iran', 'Curacao', 'Czechia', 'Bosnia and Herzegovina', 'Cabo Verde'].includes(espnName))
    .map(([espnName, id]) => [id, espnName]),
);
