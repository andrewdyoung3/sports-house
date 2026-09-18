/**
 * Angle engine — derives and RANKS the candidate story angles for a fixture,
 * deterministically, from data already in the preview context (form, H2H,
 * positions, absences, market, venue profile). The top angle is handed to the
 * model as the mandated opening material: with a derived angle the opener
 * quality is a floor, not a sampling accident.
 *
 * Design rules:
 *  - Every detector is pure arithmetic over provided data — no memory, no
 *    fetches, nothing the validators can't defend.
 *  - Salience scores are static weights + specificity bonuses; ties break by
 *    detector order (most game-specific first).
 *  - THIRDS COMPLIANCE: placement-flavoured angles (table collision) are only
 *    emitted in the final third; form/H2H/rest/absence/market angles are
 *    phase-free.
 */

import type { GameResult, HeadToHeadMeeting, VenueRecord } from '@/types';

export interface AngleInput {
  teamName: string;
  opponentName: string;
  isHome?: boolean;
  fixtureDateISO?: string;
  teamForm?: GameResult[];       // most recent first
  opponentForm?: GameResult[];
  headToHead?: HeadToHeadMeeting[]; // team perspective, most recent first
  teamPosition?: number;
  opponentPosition?: number;
  teamAbsenceCount?: number;     // listed outs/injuries
  opponentAbsenceCount?: number;
  marketFavouriteIsTeam?: boolean; // from marketOdds when present
  /** Cricket: venue chase-win % from the venue profile (58+/42- = biased). */
  venueChaseWinPct?: number;
  /** Season records at THIS fixture's venue (AFL: Squiggle-derived). */
  teamVenueRecord?: VenueRecord;
  opponentVenueRecord?: VenueRecord;
  /** 1 | 2 | 3 per the season-thirds policy; undefined = no table (finals/cup). */
  seasonThird?: number;
}

export interface RankedAngle {
  kind: string;
  score: number;
  line: string;
}

const streakOf = (form: GameResult[] | undefined): { kind: 'W' | 'L'; n: number } | null => {
  if (!form?.length) return null;
  const first = form[0].isDraw ? null : form[0].isWin ? 'W' : 'L';
  if (!first) return null;
  let n = 0;
  for (const g of form) {
    const k = g.isDraw ? null : g.isWin ? 'W' : 'L';
    if (k !== first) break;
    n++;
  }
  return n >= 3 ? { kind: first, n } : null;
};

const daysBetween = (aISO?: string, bISO?: string): number | undefined => {
  if (!aISO || !bISO) return undefined;
  const d = (Date.parse(aISO) - Date.parse(bISO)) / 86400_000;
  return Number.isFinite(d) ? Math.round(d) : undefined;
};

export function deriveAngles(i: AngleInput): RankedAngle[] {
  const out: RankedAngle[] = [];
  const t = i.teamName, o = i.opponentName;

  // 1. STREAK-VS-SLAYER: an active streak, and the streaking side's most recent
  //    H2H result went the other way — the sharpest single-game angle there is.
  const tStreak = streakOf(i.teamForm);
  const oStreak = streakOf(i.opponentForm);
  const lastH2H = i.headToHead?.[0];
  if (tStreak?.kind === 'W' && lastH2H?.result === 'L') {
    out.push({ kind: 'streak-vs-slayer', score: 95, line: `${t} bring a ${tStreak.n}-game winning run into a meeting with the side that beat them last time these two met.` });
  }
  if (oStreak?.kind === 'W' && lastH2H?.result === 'W') {
    out.push({ kind: 'streak-vs-slayer', score: 93, line: `${o} arrive on a ${oStreak.n}-game winning run — but ${t} won the most recent meeting.` });
  }

  // 2. REST-VS-RUN: layoff differential from form dates (≥6-day gap difference).
  //    Suppressed when BOTH sides are >21 days out — that's an off-season or
  //    rep-window break for everyone, not a freshness edge (the NBA opener
  //    generated "a substantial break of 172 days": sourced, but not a story).
  const tRest = daysBetween(i.fixtureDateISO, i.teamForm?.[0]?.date);
  const oRest = daysBetween(i.fixtureDateISO, i.opponentForm?.[0]?.date);
  if (tRest !== undefined && oRest !== undefined && Math.abs(tRest - oRest) >= 6
      && Math.min(tRest, oRest) <= 21) {
    const [fresh, freshD, busy, busyD] = tRest > oRest ? [t, tRest, o, oRest] : [o, oRest, t, tRest];
    out.push({ kind: 'rest-vs-run', score: 90, line: `${fresh} have had ${freshD} days between games; ${busy} back up after ${busyD} — freshness against momentum.` });
  }

  // 3. PLAIN STREAKS.
  if (tStreak) out.push({ kind: 'streak', score: 60 + tStreak.n * 4, line: tStreak.kind === 'W' ? `${t} have won ${tStreak.n} straight.` : `${t} have lost ${tStreak.n} straight.` });
  if (oStreak) out.push({ kind: 'streak', score: 58 + oStreak.n * 4, line: oStreak.kind === 'W' ? `${o} have won ${oStreak.n} straight.` : `${o} have lost ${oStreak.n} straight.` });

  // 4. H2H DOMINANCE: one side has won the last 3+ meetings.
  const h = i.headToHead ?? [];
  if (h.length >= 3) {
    const firstRes = h[0].result;
    if (firstRes !== 'D') {
      let run = 0;
      for (const m of h) { if (m.result !== firstRes) break; run++; }
      if (run >= 3) {
        out.push({ kind: 'h2h-dominance', score: 70 + run * 3, line: firstRes === 'W' ? `${t} have won the last ${run} meetings between these sides.` : `${o} have won the last ${run} meetings between these sides.` });
      }
    }
  }

  // 5. ABSENCE CLUSTER: a lopsided availability picture (≥3 outs, ≥2 more than the other side).
  const ta = i.teamAbsenceCount ?? 0, oa = i.opponentAbsenceCount ?? 0;
  if (Math.max(ta, oa) >= 3 && Math.abs(ta - oa) >= 2) {
    const [hit, n] = ta > oa ? [t, ta] : [o, oa];
    out.push({ kind: 'absence-cluster', score: 82, line: `${hit} are without ${n} listed players — the availability gap is the story of the week.` });
  }

  // 6. MARKET UPSET: the market backs the side the table doesn't (or the away side).
  if (i.marketFavouriteIsTeam !== undefined && i.teamPosition !== undefined && i.opponentPosition !== undefined) {
    const favIsLower = i.marketFavouriteIsTeam ? i.teamPosition > i.opponentPosition : i.opponentPosition > i.teamPosition;
    if (favIsLower) {
      const fav = i.marketFavouriteIsTeam ? t : o;
      out.push({ kind: 'market-upset', score: 78, line: `The market backs ${fav} despite the table saying otherwise.` });
    }
  }

  // 7. VENUE BIAS (cricket): a real chase/defend skew at the ground.
  if (i.venueChaseWinPct !== undefined) {
    if (i.venueChaseWinPct >= 58) out.push({ kind: 'venue-bias', score: 66, line: `This is a chasing ground — sides batting second win ${i.venueChaseWinPct}% of decided games here.` });
    else if (i.venueChaseWinPct <= 42) out.push({ kind: 'venue-bias', score: 66, line: `Totals defend well here — the side batting first wins ${100 - i.venueChaseWinPct}% of decided games.` });
  }

  // 8. VENUE FORTRESS / GRAVEYARD: a strong or dire season record at this
  //    ground (≥4 completed games, ≥75% won or ≥75% lost; draws count neither).
  for (const [side, rec, score] of [[t, i.teamVenueRecord, 68], [o, i.opponentVenueRecord, 66]] as const) {
    if (!rec) continue;
    const n = rec.wins + rec.draws + rec.losses;
    if (n < 4) continue;
    if (rec.wins / n >= 0.75) {
      out.push({ kind: 'venue-fortress', score, line: `${side} have won ${rec.wins} of ${n} at ${rec.venue} this season.` });
    } else if (rec.losses / n >= 0.75) {
      out.push({ kind: 'venue-graveyard', score, line: `${side} have lost ${rec.losses} of ${n} at ${rec.venue} this season.` });
    }
  }

  // 9. TABLE COLLISION — final third only (thirds policy).
  if (i.seasonThird === 3 && i.teamPosition !== undefined && i.opponentPosition !== undefined) {
    if (Math.max(i.teamPosition, i.opponentPosition) <= 2) {
      out.push({ kind: 'table-collision', score: 88, line: `First plays second with the run-in under way.` });
    } else if (Math.abs(i.teamPosition - i.opponentPosition) === 1) {
      out.push({ kind: 'table-collision', score: 64, line: `Direct table rivals — ${t} and ${o} sit a single place apart in the run-in.` });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}
