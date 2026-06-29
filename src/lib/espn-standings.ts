/**
 * Shared ESPN standings helpers (CQ-2).
 *
 * ESPN's standings payloads were parsed by ~13 copy-pasted snippets across
 * preview-fetchers.ts and api/standings/route.ts. The two error-prone parts —
 * locating the entries array and deriving rank/position — are centralised here so a
 * feed-shape change is a one-line fix and rank handling (COR-1) can't drift between
 * the generation path and the display path.
 *
 * Stat-name aliasing stays at the call sites: leagues legitimately differ
 * (gamesWon vs wins, otLosses, pointsFor…), and a single forced parser there would
 * be riskier than the duplication it removes.
 */

/** Minimal shape of an ESPN standings entry (only the fields we read). */
export interface EspnStandingsEntry {
  team?: { displayName?: string; name?: string };
  stats?: { name: string; value: number }[];
  previousRank?: number;
}

/**
 * Locate the standings entries array. ESPN returns either a single flat table
 * (`standings.entries`) or conference/division children (`children[0].standings`).
 * Children take precedence; falls back to the flat table, then empty.
 */
export function espnEntries(data: unknown): EspnStandingsEntry[] {
  const d = data as { children?: { standings?: { entries?: EspnStandingsEntry[] } }[]; standings?: { entries?: EspnStandingsEntry[] } } | null;
  return d?.children?.[0]?.standings?.entries ?? d?.standings?.entries ?? [];
}

/**
 * COR-1: ESPN entries are not guaranteed to be returned in rank order (ties,
 * conference/division splits, alphabetical). Each entry carries a `rank` stat;
 * prefer it for `position`, falling back to the 1-based array index only when the
 * feed omits it — so out-of-order feeds still yield correct finals-cutoff / Nth-place
 * facts and the team's own "Nth place" claim.
 */
export function entryRank(entry: unknown, fallbackIndex: number): number {
  const e = entry as EspnStandingsEntry | null;
  const r = Number(e?.stats?.find(s => s.name === 'rank')?.value);
  return Number.isFinite(r) && r > 0 ? r : fallbackIndex + 1;
}

/** Order ESPN standings entries by their true rank (rank stat, fallback to feed order). */
export function sortByEntryRank<T>(entries: T[]): T[] {
  return entries
    .map((e, i) => ({ e, r: entryRank(e, i) }))
    .sort((a, b) => a.r - b.r)
    .map(x => x.e);
}
