'use client';

/**
 * FinalsBracket — a BUTTON in the expand panel that opens a popup containing a
 * graphical (SVG) tournament bracket of the whole finals series with live
 * results: round columns, match boxes, winner emphasis, data-driven connector
 * lines (a team's box links to its next appearance, which naturally draws the
 * AFL double-chance drop-to-semi and skip-to-prelim paths), and this fixture
 * highlighted in the team's colour. One inline line keeps the round's
 * consequence caption — the "winner advances / loser out" info the voice rules
 * removed from preview prose lives HERE, visually.
 *
 * Structure: COMP_RULES.finalsSchedule (client-safe constants).
 * Results:   /api/finals-bracket (Squiggle/ESPN, 5-min server cache).
 * Applies to any league whose COMP_RULES entry carries a finalsSchedule.
 */

import { useEffect, useState } from 'react';
import { COMP_RULES, finalsRoundForDate, type FinalsRound } from '@/lib/competition-rules';

interface BracketGame {
  home: string; away: string;
  homeScore?: number; awayScore?: number;
  complete: boolean; date: string; venue?: string;
}
interface BracketRound {
  name: string; decider?: boolean; finalEightWeek1?: boolean; games: BracketGame[];
}

// Module-level cache — every expanded finals panel on the page shares one fetch.
const bracketCache = new Map<string, BracketRound[]>();

const LEAGUE_LABEL: Record<string, string> = {
  afl: 'AFL', nrl: 'NRL', super_rugby: 'Super Rugby Pacific', bbl: 'Big Bash League',
};

/** Compact column label for a finals round. */
function shortLabel(r: FinalsRound | BracketRound): string {
  if ('decider' in r && r.decider) return 'Grand Final';
  return r.name
    .replace('Qualifying/Elimination Final', 'Qualifying & Elimination')
    .replace('Preliminary Final', 'Preliminary Finals')
    .replace('Semi-Final', 'Semi-Finals')
    .replace(' Round', '');
}

/** What this round means for winner/loser — the inline caption. */
function consequenceCaption(rounds: FinalsRound[], idx: number): string {
  const r = rounds[idx];
  if (r.decider) return 'The premiership is decided here.';
  const next = rounds[idx + 1] ? shortLabel(rounds[idx + 1]) : 'the next round';
  if (r.finalEightWeek1) {
    return 'Qualifying winners rest, then host a Preliminary; qualifying losers get a second chance in the Semis. Elimination finals are knockout.';
  }
  return `Knockout — the winner advances to the ${next}.`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const sameTeam = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
};

/** Expected match slots per round (placeholders for rounds not yet drawn). */
function expectedGames(r: BracketRound, league: string): number {
  if (r.decider) return 1;
  if (r.finalEightWeek1) return 4;
  if (/wildcard/i.test(r.name)) return 2;
  return 2; // semis + prelims in both AFL and NRL final-eight systems
}

// ── SVG layout constants ────────────────────────────────────────────────────
const COL_W = 178, BOX_W = 150, BOX_H = 48, V_GAP = 16, HEAD_H = 30, PAD = 14;

interface Slot { round: number; idx: number; game?: BracketGame; x: number; y: number }

export function FinalsBracket({
  league, gameDate, teamName, opponentName, accent,
}: {
  league: string;
  gameDate: string;
  teamName: string;
  opponentName: string;
  accent?: string;
}) {
  const schedule = COMP_RULES[league]?.finalsSchedule;
  const current  = finalsRoundForDate(league, gameDate);
  const [rounds, setRounds] = useState<BracketRound[] | null>(bracketCache.get(league) ?? null);
  const [open, setOpen] = useState(false);

  const active = !!schedule && schedule.length > 0 && !!current;

  useEffect(() => {
    if (!active || bracketCache.has(league)) return;
    fetch(`/api/finals-bracket?league=${league}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.rounds) {
          bracketCache.set(league, data.rounds);
          setRounds(data.rounds);
        }
      })
      .catch(() => {});
  }, [league, active]);

  // Close on Escape while the popup is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!active) return null;
  const idx = schedule!.findIndex(r => r.name === current!.name);
  if (idx < 0) return null;

  const color = accent && /^#/.test(accent) ? accent : '#7c5cff';

  // ── Build slot grid ──────────────────────────────────────────────────────
  const cols: Slot[][] = (rounds ?? []).map((r, ri) => {
    const n = Math.max(r.games.length, r.games.length === 0 ? expectedGames(r, league) : r.games.length);
    return Array.from({ length: n }, (_, gi): Slot => ({
      round: ri, idx: gi, game: r.games[gi], x: 0, y: 0,
    }));
  });
  const maxRows = Math.max(1, ...cols.map(c => c.length));
  const svgH = HEAD_H + maxRows * (BOX_H + V_GAP) + PAD;
  const svgW = cols.length * COL_W + PAD;
  for (const col of cols) {
    const total = col.length * BOX_H + (col.length - 1) * V_GAP;
    const top = HEAD_H + (svgH - HEAD_H - PAD - total) / 2;
    col.forEach((s, i) => {
      s.x = PAD / 2 + s.round * COL_W;
      s.y = top + i * (BOX_H + V_GAP);
    });
  }

  // ── Data-driven connectors: a completed game's box links to each later box
  //    where one of its teams reappears (first appearance only). ────────────
  const edges: Array<{ from: Slot; to: Slot }> = [];
  for (const col of cols) {
    for (const s of col) {
      if (!s.game) continue;
      for (const team of [s.game.home, s.game.away]) {
        let found: Slot | null = null;
        for (let r = s.round + 1; r < cols.length && !found; r++) {
          found = cols[r].find(t => t.game && (sameTeam(t.game.home, team) || sameTeam(t.game.away, team))) ?? null;
        }
        if (found && !edges.some(e => e.from === s && e.to === found)) {
          edges.push({ from: s, to: found });
        }
      }
    }
  }

  const isThisFixture = (g?: BracketGame) => !!g && (
    (sameTeam(g.home, teamName) && sameTeam(g.away, opponentName)) ||
    (sameTeam(g.home, opponentName) && sameTeam(g.away, teamName))
  );

  return (
    <div className="sh-bracket">
      <div className="sh-bracket-bar">
        <button className="sh-bracket-open" onClick={() => setOpen(true)}>
          <span aria-hidden>🏆</span> View finals bracket
        </button>
        <span className="sh-bracket-caption">{consequenceCaption(schedule!, idx)}</span>
      </div>

      {open && (
        <div className="sh-bracket-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Finals bracket">
          <div className="sh-bracket-modal" onClick={e => e.stopPropagation()}>
            <div className="sh-bracket-modal-head">
              <span>{LEAGUE_LABEL[league] ?? league.toUpperCase()} — Finals series</span>
              <button className="sh-bracket-close" onClick={() => setOpen(false)} aria-label="Close bracket">✕</button>
            </div>
            {!rounds ? (
              <div className="sh-bracket-loading">Loading bracket…</div>
            ) : (
              <div className="sh-bracket-scroll">
                <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block' }}>
                  {/* Round headers */}
                  {rounds.map((r, ri) => (
                    <text key={r.name} x={PAD / 2 + ri * COL_W + BOX_W / 2} y={16}
                      textAnchor="middle" fill="rgba(255,255,255,0.5)"
                      fontSize="9.5" fontWeight="800" letterSpacing="1.2" style={{ textTransform: 'uppercase' } as never}>
                      {shortLabel(r).toUpperCase()}
                    </text>
                  ))}
                  {/* Connectors under boxes */}
                  {edges.map((e, i) => {
                    const x1 = e.from.x + BOX_W, y1 = e.from.y + BOX_H / 2;
                    const x2 = e.to.x,           y2 = e.to.y + BOX_H / 2;
                    const mx = x1 + (x2 - x1) / 2;
                    return (
                      <path key={i} d={`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`}
                        fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
                    );
                  })}
                  {/* Match boxes */}
                  {cols.flat().map((s, i) => {
                    const g = s.game;
                    const live = isThisFixture(g);
                    const played  = !!g && g.homeScore !== undefined && g.awayScore !== undefined;
                    const homeWin = !!g && g.complete && played && g.homeScore! > g.awayScore!;
                    const awayWin = !!g && g.complete && played && g.awayScore! > g.homeScore!;
                    const rowFill = (win: boolean, lose: boolean) =>
                      win ? '#ffffff' : lose ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.78)';
                    return (
                      <g key={i}>
                        <rect x={s.x} y={s.y} width={BOX_W} height={BOX_H} rx={9}
                          fill={live ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)'}
                          stroke={live ? color : 'rgba(255,255,255,0.14)'}
                          strokeWidth={live ? 2 : 1} />
                        {g ? (
                          <>
                            <text x={s.x + 10} y={s.y + 19} fontSize="10.5" fontWeight={homeWin ? 800 : 600} fill={rowFill(homeWin, !!g.complete && !homeWin)}>
                              {g.home.length > 16 ? g.home.slice(0, 15) + '…' : g.home}
                            </text>
                            <text x={s.x + BOX_W - 10} y={s.y + 19} fontSize="10.5" fontWeight={homeWin ? 800 : 600} textAnchor="end" fill={rowFill(homeWin, !!g.complete && !homeWin)}>
                              {played ? g.homeScore : ''}
                            </text>
                            <text x={s.x + 10} y={s.y + 37} fontSize="10.5" fontWeight={awayWin ? 800 : 600} fill={rowFill(awayWin, !!g.complete && !awayWin)}>
                              {g.away.length > 16 ? g.away.slice(0, 15) + '…' : g.away}
                            </text>
                            <text x={s.x + BOX_W - 10} y={s.y + 37} fontSize="10.5" fontWeight={awayWin ? 800 : 600} textAnchor="end" fill={rowFill(awayWin, !!g.complete && !awayWin)}>
                              {played ? g.awayScore : ''}
                            </text>
                            {!g.complete && !played && (
                              <text x={s.x + BOX_W - 10} y={s.y + 19} fontSize="8.5" textAnchor="end" fill="rgba(255,255,255,0.35)">
                                {new Date(g.date).toLocaleDateString(undefined, { weekday: 'short' })}
                              </text>
                            )}
                            {played && !g.complete && (
                              <text x={s.x + BOX_W / 2} y={s.y + BOX_H - 4} fontSize="8" textAnchor="middle" fill="#4ade80" fontWeight={800}>LIVE</text>
                            )}
                          </>
                        ) : (
                          <text x={s.x + BOX_W / 2} y={s.y + BOX_H / 2 + 3} fontSize="9.5" textAnchor="middle" fill="rgba(255,255,255,0.28)" fontStyle="italic">
                            to be decided
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
