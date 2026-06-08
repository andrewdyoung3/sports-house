/**
 * scripts/audit-player-names.ts — player-name grounding audit.
 *
 * Tests 4 fixtures:
 *   1. AFL — no player data  → playerSpotlight must have zero player names
 *   2. NRL — no player data  → same
 *   3. EPL — no player data  → same
 *   4. AFL — with squad data → may name only players in the provided squad
 *
 * Run:
 *   npx tsx scripts/audit-player-names.ts
 */

import OpenAI from 'openai';
import { buildPreviewPrompt, SYSTEM_PROMPT, collectPlayerWhitelist } from '@/lib/preview-prompt';
import type { LeagueTableRow, TeamStanding, PreviewContext } from '@/types';

// ── Shared helpers ────────────────────────────────────────────────────────────

function row(
  name: string, position: number, played: number,
  wins: number, draws: number, losses: number, points: number,
): LeagueTableRow {
  return { name, position, played, wins, draws, losses, points };
}

function standing(
  name: string, position: number, played: number,
  wins: number, draws: number, losses: number, points: number,
  extra: Partial<TeamStanding> = {},
): TeamStanding {
  return { name, position, played, wins, draws, losses, points, ...extra };
}

const AFL_TABLE: LeagueTableRow[] = [
  row('Fremantle',        1,  13, 12, 0, 1, 48),
  row('Sydney',           2,  13, 11, 0, 2, 44),
  row('Hawthorn',         3,  13,  8, 1, 4, 34),
  row('Geelong',          4,  13,  8, 0, 5, 32),
  row('Western Bulldogs', 5,  13,  8, 0, 5, 32),
  row('Gold Coast',       6,  12,  7, 0, 5, 28),
  row('Adelaide',         7,  12,  7, 0, 5, 28),
  row('Brisbane Lions',   8,  13,  7, 0, 6, 28),
  row('Melbourne',        9,  12,  7, 0, 5, 28),
  row('Port Adelaide',   10,  12,  6, 0, 6, 24),
  row('GWS Giants',      11,  12,  6, 0, 6, 24),
  row('Collingwood',     12,  12,  5, 1, 6, 22),
  row('Carlton',         13,  12,  5, 0, 7, 20),
  row('St Kilda',        14,  12,  5, 0, 7, 20),
  row('West Coast',      15,  12,  4, 0, 8, 16),
  row('North Melbourne', 16,  12,  3, 0, 9, 12),
  row('Richmond',        17,  12,  2, 0, 10, 8),
  row('Essendon',        18,  12,  1, 0, 11, 4),
];

const NRL_TABLE: LeagueTableRow[] = [
  row('Panthers',   1,  13, 12, 0, 1, 26),
  row('Warriors',   2,  12,  9, 0, 3, 22),
  row('Roosters',   3,  12,  8, 0, 4, 20),
  row('Sea Eagles', 4,  13,  8, 0, 5, 18),
  row('Dolphins',   5,  12,  7, 0, 5, 18),
  row('Sharks',     6,  12,  7, 0, 5, 18),
  row('Knights',    7,  13,  8, 0, 5, 18),
  row('Rabbitohs',  8,  12,  6, 0, 6, 16),
  row('Cowboys',    9,  14,  8, 0, 6, 16),
  row('Storm',     10,  12,  6, 0, 6, 16),
  row('Raiders',   11,  12,  5, 0, 7, 14),
  row('Broncos',   12,  13,  5, 0, 8, 12),
  row('Bulldogs',  13,  12,  4, 0, 8, 12),
  row('Titans',    14,  12,  4, 0, 8, 12),
  row('Tigers',    15,  12,  4, 0, 8, 12),
  row('Eels',      16,  12,  4, 0, 8, 10),
  row('Dragons',   17,  13,  1, 0, 12, 4),
];

const EPL_TABLE: LeagueTableRow[] = [
  row('Arsenal',         1,  34, 25, 5, 4, 80),
  row('Manchester City', 2,  34, 23, 6, 5, 75),
  row('Liverpool',       3,  34, 22, 6, 6, 72),
  row('Chelsea',         4,  34, 20, 7, 7, 67),
  row('Tottenham',       5,  34, 18, 6, 10, 60),
  row('Newcastle',       6,  34, 16, 7, 11, 55),
  row('Aston Villa',     7,  34, 15, 8, 11, 53),
  row('Brighton',        8,  34, 14, 7, 13, 49),
];

// ── Ollama client ─────────────────────────────────────────────────────────────

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey:  'ollama',
  timeout: 10 * 60 * 1000,
});

const MODEL = 'qwen3:30b-a3b-instruct-2507-q4_K_M';

async function callModel(prompt: string): Promise<string> {
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model:      MODEL,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ],
  });
  process.stdout.write(`  (${((Date.now() - t0) / 1000).toFixed(1)}s) `);
  const raw = resp.choices[0]?.message?.content ?? '{}';
  const clean = (raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw)
    .replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return clean;
}

// ── Person-name detector (mirrors the route validator logic) ──────────────────

const SAFE_WORDS = new Set([
  'premier', 'league', 'champions', 'europa', 'conference', 'cup', 'final',
  'finals', 'series', 'grand', 'super', 'rugby', 'football', 'soccer',
  'cricket', 'season', 'round', 'phase', 'preliminary', 'semi', 'quarter',
  'trophy', 'stage', 'world', 'national', 'international', 'premiership',
  'championship', 'division', 'competition', 'association', 'pacific',
  'magic', 'regular', 'origin', 'state',
  'north', 'south', 'east', 'west', 'central', 'united', 'city', 'town',
  'park', 'ground', 'stadium', 'arena', 'oval', 'field', 'harbour',
  'harbor', 'bay', 'lake', 'river',
  'australian', 'american', 'english', 'british', 'french', 'spanish',
  'irish', 'welsh', 'scottish', 'zealand', 'african', 'european', 'asian',
  'home', 'away', 'neutral', 'match', 'game', 'fixture',
  // Common English words that appear Title-Case at sentence starts — NOT names
  'if', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'when', 'but', 'and',
  'or', 'as', 'by', 'of', 'to', 'that', 'this', 'there', 'their', 'his',
  'her', 'its', 'while', 'although', 'despite', 'with', 'without', 'both',
  'these', 'those', 'what', 'which', 'who', 'whose', 'how', 'whether',
  'once', 'since', 'given', 'against', 'throughout', 'across',
  'between', 'within', 'beyond', 'before', 'after', 'during', 'through',
]);

function detectPlayerNames(
  text: string,
  teamName: string,
  opponentName: string,
  whitelist: Set<string>,
  hasPlayerData: boolean,
  competition = '',
): string[] {
  const excluded = new Set(SAFE_WORDS);
  for (const w of `${teamName} ${opponentName} ${competition}`.toLowerCase().split(/\s+/)) {
    if (w) excluded.add(w);
  }
  for (const n of whitelist) for (const w of n.split(/\s+/)) excluded.add(w);

  // Individual whitelist words for partial-match check (e.g. surname "Postecoglou")
  const whitelistWords = new Set<string>();
  for (const entry of whitelist) {
    for (const w of entry.split(/\s+/)) {
      if (w.length >= 3) whitelistWords.add(w);
    }
  }

  const found: string[] = [];
  const seen = new Set<string>();
  const nameRe = /\b([A-Z][a-zÀ-ÿ'\-]{1,}(?:\s+[A-Z][a-zÀ-ÿ'\-]{1,})+)\b/g;
  for (const m of text.matchAll(nameRe)) {
    const candidate = m[1];
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const stripped = candidate.replace(/'s\b/gi, '').trim();
    const lower    = stripped.toLowerCase();
    const words    = lower.split(/\s+/);

    if (words.every(w => excluded.has(w))) continue;
    if (teamName.toLowerCase().includes(lower) || opponentName.toLowerCase().includes(lower)) continue;
    if (competition.toLowerCase().includes(lower)) continue;
    if (whitelist.has(lower)) continue;
    if ([...whitelist].some(e => e.includes(lower) || lower.includes(e))) continue;
    const nonSafe = words.filter(w => !excluded.has(w));
    if (!hasPlayerData) {
      // No-data case: need 2+ non-safe words (Firstname + Lastname pattern).
      if (nonSafe.length < 2) continue;
    } else {
      // Has-data case: all non-safe words must appear individually in the whitelist.
      if (nonSafe.every(w => whitelistWords.has(w))) continue;
    }
    found.push(candidate);
  }
  return found;
}

// ── Audit runner ──────────────────────────────────────────────────────────────

interface AuditResult {
  label: string;
  passed: boolean;
  playerSpotlight: string;
  namesFound: string[];
  whitelistSize: number;
  hasPlayerData: boolean;
}

async function runAudit(
  label: string,
  teamName: string,
  opponentName: string,
  context: PreviewContext,
  league: string,
  extraArgs: {
    teamId?: string;
    competition?: string;
    venue?: string;
    isHome?: boolean;
  } = {},
): Promise<AuditResult> {
  console.log(`\n── ${label}`);

  const { user: prompt } = buildPreviewPrompt({
    league,
    teamId:       extraArgs.teamId ?? `${league}-test`,
    teamName,
    opponentName,
    venue:        extraArgs.venue ?? 'Home Ground',
    isHome:       extraArgs.isHome ?? true,
    teamResults:  [],
    oppResults:   [],
    context,
    competition:  extraArgs.competition,
  });

  // Show what player data sentinel was injected
  const hasNoPlayerDataSentinel = prompt.includes('NO PLAYER DATA:');
  const hasConstraintSentinel   = prompt.includes('PLAYER NAMING CONSTRAINT:');
  console.log(`  Data sentinel: ${hasNoPlayerDataSentinel ? 'NO PLAYER DATA ✓' : hasConstraintSentinel ? 'PLAYER NAMING CONSTRAINT ✓' : 'NONE ✗'}`);

  process.stdout.write('  Calling model... ');
  const raw = await callModel(prompt);
  console.log('done');

  let parsed: { playerSpotlight?: string } = {};
  try { parsed = JSON.parse(raw); } catch { /* raw output */ }

  const spotlight = parsed.playerSpotlight ?? raw;
  const { whitelist, hasPlayerData } = collectPlayerWhitelist(prompt);

  // Detect names in playerSpotlight only (the field that always had the bug)
  const compM = prompt.match(/^COMPETITION:\s*(.+)$/m);
  const competition = compM?.[1]?.trim() ?? '';
  const foundNames = detectPlayerNames(spotlight, teamName, opponentName, whitelist, hasPlayerData, competition);

  const passed = foundNames.length === 0;
  const status = passed ? 'PASS ✓' : `FAIL ✗ — invented names: ${foundNames.join(', ')}`;

  console.log(`  playerSpotlight: "${spotlight.slice(0, 120)}${spotlight.length > 120 ? '...' : ''}"`);
  console.log(`  Player names found: ${foundNames.length === 0 ? 'none' : foundNames.join(', ')}`);
  console.log(`  Whitelist size: ${whitelist.size} | hasPlayerData: ${hasPlayerData}`);
  console.log(`  Result: ${status}`);

  return { label, passed, playerSpotlight: spotlight, namesFound: foundNames, whitelistSize: whitelist.size, hasPlayerData };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results: AuditResult[] = [];

  // 1. AFL — no player data
  results.push(await runAudit(
    'AFL — Geelong vs Melbourne (NO player data)',
    'Geelong Cats', 'Melbourne Demons',
    {
      teamStanding:     standing('Geelong', 4, 13, 8, 0, 5, 32),
      opponentStanding: standing('Melbourne', 9, 12, 7, 0, 5, 28),
      leagueTable:      AFL_TABLE,
      teamManager:      'Chris Scott',
      opponentManager:  'Simon Goodwin',
    },
    'afl', { teamId: 'afl-cats', isHome: true, venue: 'GMHBA Stadium' },
  ));

  // 2. NRL — no player data
  results.push(await runAudit(
    'NRL — Panthers vs Roosters (NO player data)',
    'Penrith Panthers', 'Sydney Roosters',
    {
      teamStanding:     standing('Panthers', 1, 13, 12, 0, 1, 26),
      opponentStanding: standing('Roosters', 3, 12, 8, 0, 4, 20),
      leagueTable:      NRL_TABLE,
      teamManager:      'Ivan Cleary',
      opponentManager:  'Trent Robinson',
    },
    'nrl', { teamId: 'nrl-panthers', isHome: true, venue: 'BlueBet Stadium' },
  ));

  // 3. EPL — no player data (the bug that gave us "Bukayo Saka at Tottenham")
  results.push(await runAudit(
    'EPL — Tottenham vs Newcastle (NO player data)',
    'Tottenham', 'Newcastle',
    {
      teamStanding:     standing('Tottenham', 5, 34, 18, 6, 10, 60),
      opponentStanding: standing('Newcastle', 6, 34, 16, 7, 11, 55),
      leagueTable:      EPL_TABLE,
      teamManager:      'Ange Postecoglou',
      opponentManager:  'Eddie Howe',
    },
    'epl', { teamId: 'epl-tottenham', isHome: true, venue: 'Tottenham Hotspur Stadium' },
  ));

  // 4. AFL — WITH squad data (should name only listed players)
  const BRISBANE_SQUAD = [
    'Charlie Cameron', 'Joe Daniher', 'Zac Bailey', 'Lachie Neale',
    'Dayne Zorko', 'Hugh McCluggage', 'Lincoln McCarthy', 'Cam Rayner',
    'Eric Hipwood', 'Callum Ah Chee', 'Tom Fullarton', 'Oscar McInerney',
    'Daniel Rich', 'Brandon Starcevich', 'Jack Payne', 'Ryan Lester',
    'Darcy Gardiner', 'Harris Andrews', 'Blake Coleman', 'Deven Robertson',
    'Tom Berry', 'Josh Dunkley', 'Will Ashcroft', 'Shadeau Brain',
    'Conor McKenna', 'Henry Smith',
  ];
  const CARLTON_SQUAD = [
    'Harry McKay', 'Charlie Curnow', 'Patrick Cripps', 'Sam Walsh',
    'George Hewett', 'Adam Cerra', 'Liam Jones', 'Paddy Dow',
    'Tom De Koning', 'Marc Pittonet', 'Zac Fisher', 'Corey Durdin',
    'Jordan Boyd', 'Ed Curnow', 'Matt Kennedy', 'Luke Parks',
    'Nic Newman', 'Jacob Weitering', 'Lewis Young', 'Jesse Motlop',
    'Elijah Hollands', 'Matthew Owies', 'Brodie Kemp', 'Tom Williamson',
    'Liam Stocker', 'Jack Carroll',
  ];

  results.push(await runAudit(
    'AFL — Brisbane Lions vs Carlton (WITH squad data)',
    'Brisbane Lions', 'Carlton',
    {
      teamStanding:     standing('Brisbane Lions', 8, 13, 7, 0, 6, 28),
      opponentStanding: standing('Carlton', 13, 12, 5, 0, 7, 20),
      leagueTable:      AFL_TABLE,
      teamSquad:        BRISBANE_SQUAD,
      opponentSquad:    CARLTON_SQUAD,
      teamManager:      'Chris Fagan',
      opponentManager:  'Michael Voss',
    },
    'afl', { teamId: 'afl-lions', isHome: true, venue: 'The Gabba' },
  ));

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log('PLAYER NAME GROUNDING AUDIT — SUMMARY');
  console.log('═══════════════════════════════════════════════');
  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`  ${icon} ${r.label}`);
    if (!r.passed) {
      console.log(`      Invented names: ${r.namesFound.join(', ')}`);
      allPassed = false;
    }
  }
  console.log('───────────────────────────────────────────────');
  console.log(`  Overall: ${allPassed ? 'ALL PASSED ✓' : 'FAILURES ✗'}`);

  if (!allPassed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
