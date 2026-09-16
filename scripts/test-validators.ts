/**
 * Pure-function unit tests for the preview output validators.
 * No Ollama, no Supabase, no network — fast and deterministic.
 *
 * Covers:
 *   • validatePlayerNames — F1 driver-constructor false positives PASS; invented names rejected.
 *   • validateLadderPosition — rejects wrong positional ordinals, allows non-positional numbers.
 *   • validatePointsClaims — level-on-points figure is emitted and validated.
 *
 * Run: npx tsx scripts/test-validators.ts
 */

import {
  validatePlayerNames,
  validateLadderPosition,
  validatePointsClaims,
  validateFinalsSeeding,
  validateNarrativeOpener,
  validatePlayerSideClaims,
  validateFinalsRedundancy,
  validateAbsenceNarration,
  validateCricketRegister,
} from '@/lib/preview-generator';
import { buildDataBlock } from '@/lib/preview-prompt';
import { buildReviewDataBlock } from '@/lib/review-prompt';
import { validateReviewOutput } from '@/lib/review-validators';
import { resolveIntlVenueStatus, countryFromVenueString } from '@/lib/international';
import type { AIReview } from '@/types';
import type { LeagueTableRow, PreviewContext } from '@/types';
import type { AIPreview } from '@/types';

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(name: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.error(`  ✗ ${name}`); failed++; }
}

/** Build a complete AIPreview from partial fields (validators read several). */
function preview(p: Partial<AIPreview>): AIPreview {
  return {
    context: '', tacticalBattle: '', playerSpotlight: '', verdict: '',
    keyInsights: [], ...p,
  };
}

// ─── Prompt fixtures (only the markers the validators read) ─────────────────────

// F1 fixture — no LINEUP (hasPlayerData stays false); whitelist is seeded from the
// championship standings (driver + constructor names).
const F1_PROMPT = [
  'COMPETITION: Formula 1',
  '',
  "DRIVERS' CHAMPIONSHIP (after Round 11):",
  '  P1. Oscar Piastri [McLaren] — 234pts, 5 wins',
  '  P2. Lando Norris [McLaren] — 226pts, 4 wins',
  '  P3. Max Verstappen [Red Bull] — 165pts, 2 wins',
  '',
  "CONSTRUCTORS' CHAMPIONSHIP:",
  '  P1. McLaren — 460pts',
  '  P2. Ferrari — 222pts',
  '  P3. Red Bull — 180pts',
  '',
  '', // terminate the last section with a blank line
].join('\n');

// ─── validatePlayerNames — false positives must now PASS ────────────────────────

console.log('validatePlayerNames (should PASS — no violation):');
expect('F1 driver + constructor names (from standings) pass',
  validatePlayerNames(
    preview({ playerSpotlight: 'Max Verstappen hunts Oscar Piastri; Red Bull chase McLaren.' }), F1_PROMPT).length === 0);

// ─── validatePlayerNames — invented names must STILL be rejected ────────────────

console.log('validatePlayerNames (should REJECT — invented):');
expect('invented F1 driver in spotlight is rejected',
  validatePlayerNames(
    preview({ playerSpotlight: 'Rookie Bartholomew Quickly stunned the paddock.' }), F1_PROMPT).length >= 1);

// ─── validateLadderPosition (the 8→7 "occupy 7th" class) ────────────────────────
// Authoritative fact: Brisbane 8th, Geelong 4th. The prose must not state a
// different positional ordinal for either team; positional context only (so
// "4-point lead", "top 10", "fourth straight win", "third quarter" never fire).
{
  const LADDER_PROMPT = [
    'DERIVED FACTS — pre-computed from the table above. Use these numbers verbatim; do NOT recalculate:',
    '  • LADDER POSITION (use this exact ordinal for each team; do not restate it as any other number): Brisbane Lions — 8th of 18; Geelong — 4th of 18.',
    '  • Geelong leads Brisbane Lions by 4 competition points on the table.',
  ].join('\n');

  const fired = (context: string): boolean =>
    validateLadderPosition(preview({ context }), LADDER_PROMPT).length > 0;

  // REJECT — wrong positional ordinal for a fixture team
  expect('rejects "Brisbane Lions, who occupy 7th" (table says 8th)',
    fired('Geelong sit 4th with a lead over Brisbane Lions, who occupy 7th — just inside the wildcard zone.'));
  expect('rejects "Geelong sit 5th" (table says 4th)',
    fired('Geelong sit 5th on the table this week.'));
  expect('rejects word-ordinal mismatch "Brisbane Lions are seventh"',
    fired('Brisbane Lions are seventh on the ladder.'));

  // PASS — correct ordinals (must NOT fire)
  expect('allows correct "Brisbane Lions occupy 8th, Geelong sit 4th"',
    !fired('Geelong sit 4th on the ladder; Brisbane Lions occupy 8th.'));
  expect('allows correct word ordinals "eighth"/"fourth"',
    !fired('Brisbane Lions are eighth in the standings while Geelong are fourth.'));

  // PASS — false-positive traps (non-positional numbers/ordinals; must NOT fire)
  expect('trap: "4-point lead" does not fire',          !fired('Geelong hold a 4-point lead over Brisbane Lions.'));
  expect('trap: "top 10" does not fire',                !fired('Brisbane Lions are scrapping to stay in the top 10.'));
  expect('trap: "fourth straight win" does not fire',   !fired('Brisbane Lions chase a fourth straight win.'));
  expect('trap: "third quarter" does not fire',         !fired('Geelong owned the third quarter last start.'));
  expect('trap: "first half" does not fire',            !fired('Geelong started fast in the first half.'));
  expect('trap: no positional ordinal does not fire',   !fired('A crucial clash in the run home for both clubs.'));

  // No LADDER POSITION fact in the prompt → validator is inert
  expect('inert when no LADDER POSITION fact present',
    validateLadderPosition(preview({ context: 'Brisbane Lions occupy 7th.' }), 'DERIVED FACTS:\n  • nothing here').length === 0);
}

// ─── Level-on-points figure is emitted + sourced (fix a) ────────────────────────
// buildDerivedFacts must emit the SHARED points figure for teams level on points so
// a correct "level on N points" prose validates (and a wrong N is still rejected).
{
  const r = (name: string, position: number, points: number, percentage: number): LeagueTableRow =>
    ({ name, position, played: 15, wins: points / 4, draws: 0, losses: 15 - points / 4, points, percentage });
  // Geelong (4th) and Brisbane (5th) level on 36 pts; percentage splits them.
  const table: LeagueTableRow[] = [
    r('Fremantle', 1, 52, 144), r('Sydney', 2, 48, 135), r('Hawthorn', 3, 40, 113),
    r('Geelong Cats', 4, 36, 120.6), r('Brisbane Lions', 5, 36, 111.0), r('Adelaide', 6, 36, 110),
    r('Melbourne', 7, 36, 104), r('Western Bulldogs', 8, 32, 92), r('Gold Coast', 9, 28, 105),
    r('Collingwood', 10, 28, 99), r('Carlton', 11, 24, 95), r('Richmond', 12, 16, 78),
  ];
  const ctx = {
    leagueTable: table,
    teamStanding: table.find(t => t.name === 'Geelong Cats'),
    opponentStanding: table.find(t => t.name === 'Brisbane Lions'),
    fixtureDate: '2026-07-02T09:30:00Z',
  } as PreviewContext;
  const block = buildDataBlock('afl', 'Geelong Cats', 'Brisbane Lions', ctx, [], [], undefined, false, undefined, 'Kardinia Park', true, 'afl-cats', 'afl-lions', undefined);

  expect('derived fact emits the shared points figure ("level on 36 competition points")',
    /level on 36 competition points/.test(block));

  const sourced = (context: string) => validatePointsClaims(preview({ context }), block);
  expect('correct "level on 36 competition points" validates (now sourced)',
    sourced('Geelong and Brisbane are level on 36 competition points.').length === 0);
  expect('wrong "level on 30 competition points" is still rejected',
    sourced('Geelong and Brisbane are level on 30 competition points.').length > 0);
}

// ─── validateFinalsSeeding — seeding/bracket logic binding ──────────────────────

{
  console.log('\n── validateFinalsSeeding ──');
  const SEEDING_PROMPT = [
    'REGULAR-SEASON SEEDING (context only — this is a finals fixture; the ladder no longer applies):',
    '  Sydney Swans finished 2nd; Fremantle finished 1st in the regular season.',
    '',
  ].join('\n');
  const v = (context: string) => validateFinalsSeeding(preview({ context }), SEEDING_PROMPT);

  expect('incident string caught: host called "higher-seeded" while 2nd vs 1st',
    v('Sydney Swans, as the higher-seeded side, host Fremantle at the SCG.').length > 0);
  expect('correct higher-seed attribution passes',
    v('Fremantle, the higher seed, travel to face Sydney Swans.').length === 0);
  expect('minor premiership misattribution caught',
    v('Sydney Swans claimed the minor premiership before this final.').length > 0);
  expect('minor premiership correctly attributed passes',
    v('Fremantle, the minor premiers, must win away from home.').length === 0);
  expect('wrong "finished 3rd" caught',
    v('Sydney Swans finished 3rd and now host a final.').length > 0);
  expect('correct "finished 2nd" passes',
    v('Sydney Swans finished 2nd and won through to host this final.').length === 0);
  expect('inert without a REGULAR-SEASON SEEDING line',
    validateFinalsSeeding(preview({ context: 'Sydney Swans, the higher-seeded side, host.' }), 'LEAGUE TABLE:\n  1. Fremantle').length === 0);
}

// ─── Review pipeline: buildReviewDataBlock → validateReviewOutput ───────────────

{
  console.log('\n── review validators (end-to-end through buildReviewDataBlock) ──');
  const nrlTable: LeagueTableRow[] = Array.from({ length: 17 }, (_, i) => ({
    position: i + 1, name: `Team${i + 1}`, played: 18,
    wins: 0, losses: 0, draws: 0, points: 30 - i,
  } as unknown as LeagueTableRow));

  // (a) Grand Final review — seeding contradiction caught end-to-end.
  const gfBlock = buildReviewDataBlock({
    league: 'nrl', teamName: 'Team1', opponent: 'Team3',
    teamScore: 24, opponentScore: 12, isHome: false, date: '2026-10-04',
    teamPosition: 1, teamPlayed: 27, opponentPosition: 3, opponentPlayed: 27,
    leagueTable: nrlTable.map(r => ({ ...r, played: 27 })),
  });
  const gfReview = (summary: string): AIReview => ({ summary, keyMoments: ['grounded factor'], verdict: 'Forward look.' });
  expect('GF review: "higher-seeded" misattribution refused',
    validateReviewOutput(gfReview('Team3, the higher-seeded side, fell short in the decider.'), gfBlock).length > 0);
  expect('GF review: correct seeding passes',
    validateReviewOutput(gfReview('Team1, the higher seed, controlled the decider throughout.'), gfBlock).length === 0);
  expect('GF review: dead-rubber framing refused',
    validateReviewOutput(gfReview('A dead rubber in the end, with nothing at stake.'), gfBlock).length > 0);

  // (b) Regular season — LADDER POSITION binding + early-season calibration.
  const earlyBlock = buildReviewDataBlock({
    league: 'nrl', teamName: 'Team7', opponent: 'Team9',
    teamScore: 12, opponentScore: 24, isHome: true, date: '2026-04-04',
    teamPosition: 7, teamPlayed: 5, teamPoints: 6,
    opponentPosition: 9, opponentPlayed: 5, opponentPoints: 4,
    leagueTable: nrlTable.map(r => ({ ...r, played: 5 })),
  });
  expect('early block carries SEASON PHASE early season', /SEASON PHASE: early season/.test(earlyBlock));
  expect('early block carries LADDER POSITION line', /LADDER POSITION \(authoritative\)/.test(earlyBlock));
  expect('review: wrong ladder ordinal refused',
    validateReviewOutput(gfReview('Team7 sit 3rd after this loss.'), earlyBlock).length > 0);
  expect('review: early-season "must-win" overstatement refused',
    validateReviewOutput(gfReview('Team7 now face a must-win run of games.'), earlyBlock).length > 0);
  expect('review: proportionate early-season framing passes',
    validateReviewOutput(gfReview('An early stumble for Team7, but the structural signs remain sound.'), earlyBlock).length === 0);

  // (c) No match stats → invented in-game statistics refused.
  expect('review: invented completion-rate stat refused (no stats provided)',
    validateReviewOutput(gfReview('Team7 managed only a completion rate of 68% under pressure.'), earlyBlock).length > 0);

  // (d) Scorers whitelist: listed scorer passes, invented name refused.
  const statsBlock = buildReviewDataBlock({
    league: 'nrl', teamName: 'Team7', opponent: 'Team9',
    teamScore: 24, opponentScore: 12, isHome: true, date: '2026-04-04',
    teamPosition: 7, teamPlayed: 5, opponentPosition: 9, opponentPlayed: 5,
    leagueTable: nrlTable.map(r => ({ ...r, played: 5 })),
    matchStats: {
      team: { teamName: 'Team7', aggStats: [{ label: 'Possession', value: '54%' }],
        players: [{ name: 'Jake Halloway', position: 'FB', stats: [{ label: 'T', value: '2' }] }] },
      opponent: { teamName: 'Team9', aggStats: [], players: [] },
    },
  });
  expect('review: listed scorer name passes',
    validateReviewOutput(gfReview('Jake Halloway finished twice out wide.'), statsBlock).length === 0);
  expect('review: invented player name refused',
    validateReviewOutput(gfReview('Marcus Delaney controlled the middle third.'), statsBlock).length > 0);

  // (e) Form section renders when provided.
  const formBlock = buildReviewDataBlock({
    league: 'nrl', teamName: 'Team7', opponent: 'Team9',
    teamScore: 24, opponentScore: 12, isHome: true, date: '2026-06-04',
    teamRecentForm: [{ opponent: 'Team2', opponentAbbr: '', isHome: true, isWin: true, teamScore: 20, opponentScore: 10, date: '2026-05-28' }],
    headToHead: [{ date: '2025-08-01', teamScore: 18, opponentScore: 12, result: 'W', teamWasHome: true }],
  });
  expect('form coming in renders', /FORM COMING INTO THIS MATCH/.test(formBlock) && /W 20–10 v Team2/.test(formBlock));
  expect('head-to-head renders', /HEAD-TO-HEAD/.test(formBlock) && /W 18–12 \(home\)/.test(formBlock));
}

// ─── Narrative-opener guards (finals mode) ─────────────────────────────────────

{
  console.log('\n── narrative openers ──');
  const FINALS_PROMPT = 'FINALS PATH (authoritative...):\n  • Seeding: A finished 2nd; B finished 1st.\n';
  expect('preview: "This is a Preliminary Final…" opener rejected',
    validateNarrativeOpener(preview({ context: 'This is a Preliminary Final in the AFL finals series — a knockout match.' }), FINALS_PROMPT).length > 0);
  expect('preview: angle-led opener passes',
    validateNarrativeOpener(preview({ context: "Fremantle's double chance is spent, and the reward is a trip to a rested Swans side." }), FINALS_PROMPT).length === 0);
  expect('preview: opener guard inert outside finals mode',
    validateNarrativeOpener(preview({ context: 'This is a big one.' }), 'LEAGUE TABLE:\n 1. X').length === 0);

  const gfBlockForOpener = buildReviewDataBlock({
    league: 'nrl', teamName: 'Team1', opponent: 'Team3',
    teamScore: 24, opponentScore: 12, isHome: false, date: '2026-10-04',
    teamPosition: 1, teamPlayed: 27, opponentPosition: 3, opponentPlayed: 27,
  });
  const rv = (summary: string): AIReview => ({ summary, keyMoments: ['x'], verdict: 'y' });
  expect('review: "In the Grand Final…" opener rejected',
    validateReviewOutput(rv('In the Grand Final, Team1 controlled the tempo throughout.'), gfBlockForOpener).length > 0);
  expect('review: why-led opener passes',
    validateReviewOutput(rv('Relentless middle control decided the premiership — Team1 never let Team3 into the game.'), gfBlockForOpener).length === 0);
}

// ─── validatePlayerSideClaims — side-of-pitch binding ───────────────────────────

{
  console.log('\n── validatePlayerSideClaims ──');
  const LINEUP_PROMPT = [
    'FIXTURE: Arsenal vs Ipswich Town',
    '',
    'MOST RECENT STARTING LINEUP:',
    '  Arsenal: Bukayo Saka (RW), Gabriel Martinelli, Ben White (RB), Riccardo Calafiori (CD-L)',
    '',
    '', // section parser requires a terminating blank line
  ].join('\n');
  const v = (context: string) => validatePlayerSideClaims(preview({ context }), LINEUP_PROMPT);

  expect('incident: "Saka … off the left" contradicts (RW)',
    v('Bukayo Saka is at his most dangerous cutting in off the left.').length > 0);
  expect('correct: "Saka … off the right" passes',
    v('Bukayo Saka will attack off the right against a makeshift full-back.').length === 0);
  expect('hyphen code: Calafiori left channel passes (CD-L)',
    v('Riccardo Calafiori stepping into the left channel is the buildup key.').length === 0);
  expect('unsourced: Martinelli (no code) side claim rejected',
    v('Gabriel Martinelli stretches teams down the left wing.').length > 0);
  expect('team-level side talk with no nearby name passes',
    v('Arsenal will look to overload down the left in wide rotations.').length === 0);
  expect('inert without player data',
    validatePlayerSideClaims(preview({ context: 'Dangerous off the left.' }), 'LEAGUE TABLE:\n 1. X').length === 0);

  // AFL codes: trailing L/R is a side; RR (ruck-rover) is not.
  const AFL_PROMPT = 'FIXTURE: A vs B\n\nHAWTHORN KEY PERFORMERS:\n  Jai Newcombe (RR) — Disposals: 30\n  Connor Macdonald (HFFL) — Goals: 2.1, Disposals: 18\n\n';
  const va = (context: string) => validatePlayerSideClaims(preview({ context }), AFL_PROMPT);
  expect('AFL: HFFL right-side claim rejected',
    va('Connor Macdonald keeps drifting to the right flank.').length > 0);
  expect('AFL: HFFL left-side claim passes',
    va('Connor Macdonald works the left flank hard.').length === 0);
  expect('AFL: RR is not a side — unsourced right-edge claim rejected as unsourced',
    va('Jai Newcombe bursts down the right edge from stoppages.').length > 0);
}

// ─── Venue classification — neutrality needs positive evidence ──────────────────

{
  console.log('\n── venue classification ──');
  const venueLine = (venueNeutral: boolean | undefined) => buildDataBlock(
    'epl', 'Arsenal', 'Ipswich Town', { venueNeutral } as PreviewContext,
    [], [], 'League Cup', false, undefined, 'Portman Road', false, 'epl-arsenal', undefined, undefined,
  ).split('\n').find(l => l.startsWith('VENUE:')) ?? '';

  expect('feed says not-neutral + away → opponent home ground (the Portman Road fix)',
    /IPSWICH TOWN HOME GROUND/.test(venueLine(false)));
  expect('unknown neutrality → no advantage claim, never "neutral"',
    venueLine(undefined) === 'VENUE: Portman Road');
  expect('flagged neutral → neutral ground',
    /NEUTRAL GROUND \(flagged neutral/.test(venueLine(true)));
}

// ─── International home/away/neutral (home = any ground in the country) ────────

{
  console.log('\n── international venue resolution ──');
  const r = resolveIntlVenueStatus;
  expect('Test in own country → home (any ground, not just the registered one)',
    JSON.stringify(r('Australia', 'India', 'Australia')) === '{"isHome":true,"neutralSite":false}');
  expect('touring side → opponent hosts',
    JSON.stringify(r('India', 'Australia', 'Australia')) === '{"isHome":false,"neutralSite":false}');
  expect('third country + both sides known → genuinely neutral',
    JSON.stringify(r('Australia', 'Argentina', 'England')) === '{"neutralSite":true}');
  expect('third country but opponent unknown → undecided (could be theirs)',
    JSON.stringify(r('Australia', undefined, 'England')) === '{}');
  expect('UK venue, one UK nation → that nation hosts',
    JSON.stringify(r('England', 'Australia', 'United Kingdom')) === '{"isHome":true,"neutralSite":false}');
  expect('UK venue, England v Scotland → undecidable from country alone',
    JSON.stringify(r('England', 'Scotland', 'United Kingdom')) === '{}');
  expect('West Indies at Bridgetown (Barbados) → home soil',
    JSON.stringify(r('West Indies', 'England', 'Barbados')) === '{"isHome":true,"neutralSite":false}');
  expect('UAE venue for India v Pakistan → neutral',
    JSON.stringify(r('India', 'Pakistan', 'UAE')) === '{"neutralSite":true}');
  expect('venue string country extraction ("Kensington Oval, Bridgetown, Barbados")',
    countryFromVenueString('Kensington Oval, Bridgetown, Barbados') === 'Barbados');
  expect('venue string with city-only tail extracts nothing',
    countryFromVenueString('Perth Stadium, Perth') === undefined);
}

// ─── validateFinalsRedundancy — default consequences go unsaid ──────────────────

{
  console.log('\n── validateFinalsRedundancy ──');
  const KO_PROMPT = 'FINALS PATH (authoritative...):\n  • The winner advances to the Grand Final.\n';
  const v = (context: string) => validateFinalsRedundancy(preview({ context }), KO_PROMPT);
  expect('flat "the loser is eliminated" rejected', v('The winner advances; the loser is eliminated.').length > 0);
  expect('paraphrase "lose and your premiership campaign ends" rejected',
    v('Win and you are in the Grand Final; lose and your premiership campaign ends.').length > 0);
  expect('informative counter-case passes',
    v('Their double chance is spent after the qualifying-final loss.').length === 0);
  expect('tension idiom "season on the line" passes',
    v('With the season on the line, the midfield battle decides it.').length === 0);
  expect('inert on double-chance (Qualifying Final) rounds',
    validateFinalsRedundancy(preview({ context: 'The loser is eliminated.' }),
      'FINALS PATH:\n  • NEITHER side can be eliminated in this game...\n').length === 0);
  expect('inert outside finals mode',
    validateFinalsRedundancy(preview({ context: 'The loser is eliminated.' }), 'LEAGUE TABLE:').length === 0);
}

// ─── validateAbsenceNarration — data gaps are never content ─────────────────────

{
  console.log('\n── validateAbsenceNarration ──');
  const v = (context: string) => validateAbsenceNarration(preview({ context }), '');
  expect('incident: "No specific stakes … are available" rejected',
    v('No specific stakes from the series standings are available, but experience will matter.').length > 0);
  expect('"no injury news provided" rejected',
    v('There is no injury news provided for either side.').length > 0);
  expect('"statistics are unavailable" rejected',
    v('Detailed statistics are unavailable at this stage of the tour.').length > 0);
  expect('analytical negative "no injury concerns" passes',
    v('Australia carry no injury concerns into the series opener.').length === 0);
  expect('analytical negative "no clear favourite" passes',
    v('There is no clear favourite in the middle overs battle.').length === 0);
  expect('normal grounded prose passes',
    v('Australia arrive with a settled top order and a rested pace attack.').length === 0);
}

// ─── validateCricketRegister — cricket speaks cricket ───────────────────────────

{
  console.log('\n── validateCricketRegister ──');
  const C = 'CRICKET MATCH CONTEXT:\n  Format: ODI\n';
  const CV = C + 'VENUE PROFILE (derived...):\n  • Average first-innings ODI score at X: 248.\n';
  const v = (context: string, p = C) => validateCricketRegister(preview({ context }), p);
  expect('incident: "structural edge … across all phases" rejected',
    v('Australia holds a structural edge, with greater depth across all phases of the game.').length > 0);
  expect('footy "gainline" rejected in cricket',
    v('Zimbabwe must win the gainline battle early.').length > 0);
  expect('cricket vocabulary passes',
    v('Australia\'s new-ball spells and spin through the middle overs should squeeze the run rate.').length === 0);
  expect('unsourced "flat wicket" speculation rejected without VENUE PROFILE',
    v('The toss matters on what could be a flat wicket favouring batting.').length > 0);
  expect('pitch talk passes WITH a VENUE PROFILE grounding it',
    v('On a flat wicket where first innings average 248, the toss winner bats.', CV).length === 0);
  expect('inert outside cricket',
    validateCricketRegister(preview({ context: 'A structural edge in midfield.' }), 'LEAGUE TABLE:').length === 0);
}

// ─── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
