/**
 * scripts/audit-review-position.ts — one-shot pre-push audit.
 *
 * Builds the Carlton (13th) vs Brisbane Lions (8th) AFL review prompt,
 * calls the production Ollama model, and checks the output for:
 *   - any "8th" / "eighth" position reference for Carlton
 *   - any "both teams in 8th" / "remain in 8th" type conflation
 *
 * Run:
 *   npx tsx scripts/audit-review-position.ts
 */

import OpenAI from 'openai';
import { REVIEW_SYSTEM_PROMPT, buildReviewDataBlock } from '@/lib/review-prompt';
import type { LeagueTableRow } from '@/types';

function row(
  name: string, position: number, played: number,
  wins: number, draws: number, losses: number, points: number,
): LeagueTableRow {
  return { name, position, played, wins, draws, losses, points };
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
  row('Port Adelaide',    10, 12,  6, 0, 6, 24),
  row('GWS Giants',       11, 12,  6, 0, 6, 24),
  row('Collingwood',      12, 12,  5, 1, 6, 22),
  row('Carlton',          13, 12,  5, 0, 7, 20),
  row('St Kilda',         14, 12,  5, 0, 7, 20),
  row('West Coast',       15, 12,  4, 0, 8, 16),
  row('North Melbourne',  16, 12,  3, 0, 9, 12),
  row('Richmond',         17, 12,  2, 0, 10, 8),
  row('Essendon',         18, 12,  1, 0, 11, 4),
];

async function main(): Promise<void> {
  const dataBlock = buildReviewDataBlock({
    league:           'afl',
    teamName:         'Brisbane Lions',
    opponent:         'Carlton',
    teamScore:        104,
    opponentScore:    82,
    isHome:           true,
    date:             '2026-06-07',
    leagueTable:      AFL_TABLE,
    teamPosition:     8,
    teamPlayed:       13,
    teamPoints:       28,
    opponentPosition: 13,
    opponentPlayed:   12,
    opponentPoints:   20,
  });

  console.log('=== DATA BLOCK ===');
  console.log(dataBlock);
  console.log('=== END DATA BLOCK ===\n');

  // Verify CURRENT STANDINGS in the data block
  const carltonInStandings = /Carlton:\s*13th/.test(dataBlock);
  const brisbaneInStandings = /Brisbane Lions:\s*8th/.test(dataBlock);
  const derivedOutside = /Carlton.*8 points outside the top 8/.test(dataBlock);

  console.log('PROMPT AUDIT:');
  console.log(`  Carlton appears as 13th in CURRENT STANDINGS: ${carltonInStandings ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  Brisbane Lions appears as 8th in CURRENT STANDINGS: ${brisbaneInStandings ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  DERIVED FACTS says Carlton is N points outside the top 8: ${derivedOutside ? 'PASS ✓' : 'FAIL ✗'}`);

  if (!carltonInStandings || !brisbaneInStandings) {
    console.error('\nPrompt structure incorrect — aborting model call.');
    process.exit(1);
  }

  // Call Ollama
  console.log('\nCalling Ollama qwen3:30b-a3b-instruct-2507-q4_K_M...');
  const client = new OpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey:  'ollama',
    timeout: 5 * 60 * 1000,
  });

  const t0 = Date.now();
  const response = await client.chat.completions.create({
    model:      'qwen3:30b-a3b-instruct-2507-q4_K_M',
    max_tokens: 2000,
    messages: [
      { role: 'system', content: REVIEW_SYSTEM_PROMPT },
      { role: 'user',   content: dataBlock },
    ],
  });
  console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const raw = response.choices[0]?.message?.content ?? '';
  const withoutThink = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw;
  const cleaned = withoutThink.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  console.log('=== RAW OUTPUT ===');
  console.log(cleaned);
  console.log('=== END OUTPUT ===\n');

  // Audit for position hallucinations.
  // Bug pattern: model claims Carlton is IN 8th place (holds/is/in 8th).
  // Correct pattern: model says Carlton is "N points outside the top 8".
  // Brisbane IS 8th — so "8th" alone near "Carlton" is fine if Carlton is described as outside.
  const output = cleaned.toLowerCase();

  // Carlton is described as HOLDING / SITTING IN 8th place (wrong)
  const carltonHolds8th = /carlton\b[^.]{0,80}\b(?:in|holds?|sits?|placed?|sitting|placed?|occupy)\b[^.]{0,30}\b8th/.test(output);
  // Explicit "both teams in 8th" pattern (original bug)
  const bothIn8th = /both teams.*\b8th\b|\b8th\b.*both teams|remain in 8th|sit(?:s|ting)? in 8th/.test(output);
  // Carlton is said to hold/be in "8th place" (direct conflation)
  const carltonIs8thPlace = /carlton\b[^.]{0,60}\b8th place/.test(output);

  // Carlton correctly described as outside/below the top 8 (positive signal)
  const carltonOutside = /carlton[^.]*outside the top 8|carlton[^.]*outside finals|carlton[^.]*below the top 8/.test(output);

  console.log('MODEL OUTPUT AUDIT:');
  console.log(`  Carlton wrongly described as holding 8th: ${carltonHolds8th ? 'FAIL ✗  HALLUCINATION' : 'PASS ✓'}`);
  console.log(`  "both teams in 8th" conflation: ${bothIn8th ? 'FAIL ✗  HALLUCINATION' : 'PASS ✓'}`);
  console.log(`  Carlton directly called "8th place": ${carltonIs8thPlace ? 'FAIL ✗  HALLUCINATION' : 'PASS ✓'}`);
  console.log(`  Carlton correctly framed as outside/below top 8: ${carltonOutside ? 'PASS ✓' : 'WARN — not explicit (check output)'}`);

  const thirteenthCount = (output.match(/13th/g) ?? []).length;
  console.log(`  "13th" appears ${thirteenthCount} time(s) in output (Carlton's actual position).`);

  if (carltonHolds8th || bothIn8th || carltonIs8thPlace) {
    console.error('\nAudit FAILED — ladder-position hallucination persists.');
    process.exit(1);
  } else {
    console.log('\nAudit PASSED — no ladder-position hallucinations detected.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
