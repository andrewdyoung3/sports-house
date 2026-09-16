#!/usr/bin/env tsx
/**
 * scripts/backtest-generate.ts — mock preview/review generation for HISTORICAL
 * fixtures of out-of-season sports, for register auditing against real archived
 * coverage of the same games.
 *
 * ESPN's summary?event= is archival: form, head-to-head, and lineups come back
 * AS OF that match. Standings-at-the-time are NOT retrievable from our sources,
 * so mocks run in reduced-data mode (no ladder facts) — sufficient for language
 * measurement, which is the point. Nothing is stored or cached.
 *
 * Usage:
 *   npx tsx scripts/backtest-generate.ts <sru|rint> <espnEventId> <preview|review>
 */
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const SPORT_PATH: Record<string, string> = { sru: 'rugby/242041', rint: 'rugby/180659' };
const LEAGUE: Record<string, string> = { sru: 'super_rugby', rint: 'rugby_int' };

async function main() {
  const [shortLeague, eventId, mode] = process.argv.slice(2);
  const sportPath = SPORT_PATH[shortLeague];
  const league = LEAGUE[shortLeague];
  if (!sportPath || !eventId || !['preview', 'review'].includes(mode)) {
    console.error('usage: backtest-generate <sru|rint> <eventId> <preview|review>'); process.exit(1);
  }

  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${eventId}`);
  const sum = await res.json() as any;
  const comp = sum.header?.competitions?.[0] ?? {};
  const cs: any[] = comp.competitors ?? [];
  const home = cs.find((c: any) => c.homeAway === 'home');
  const away = cs.find((c: any) => c.homeAway === 'away');
  const teamName = home?.team?.displayName ?? '?';
  const oppName  = away?.team?.displayName ?? '?';
  const date     = comp.date ?? sum.header?.date ?? '';
  const venue    = sum.gameInfo?.venue?.fullName ?? '';
  console.log(`FIXTURE: ${teamName} v ${oppName} | ${date} | ${venue} | score ${home?.score}-${away?.score}`);

  const { fetchESPNMatchExtras } = await import('@/lib/preview-fetchers');
  const extras = await fetchESPNMatchExtras(sportPath, eventId, teamName, oppName, 15);
  const day = String(date).slice(0, 10);
  const drop = (rs?: any[]) => rs?.filter(r => String(r.date).slice(0, 10) !== day);

  if (mode === 'preview') {
    const { buildDataBlock, SYSTEM_PROMPT } = await import('@/lib/preview-prompt');
    const { callOllamaValidated } = await import('@/lib/preview-generator');
    const ctx: any = {
      teamRecentForm: drop(extras.teamRecentForm), opponentRecentForm: drop(extras.opponentRecentForm),
      headToHead: extras.headToHead?.filter(h => String(h.date).slice(0, 10) !== day),
      teamLastLineup: extras.teamLastLineup, opponentLastLineup: extras.opponentLastLineup,
      fixtureDate: date,
    };
    const block = buildDataBlock(league, teamName, oppName, ctx, [], [], undefined, false, undefined, venue, true, '', undefined, undefined);
    void SYSTEM_PROMPT;
    const { preview, violations } = await callOllamaValidated(block, false);
    console.log('\n── VIOLATIONS:', violations.length ? violations : 'none');
    console.log(JSON.stringify(preview, null, 1).slice(0, 2600));
  } else {
    const { buildReviewDataBlock, REVIEW_SYSTEM_PROMPT } = await import('@/lib/review-prompt');
    const { validateReviewOutput } = await import('@/lib/review-validators');
    const OpenAI = (await import('openai')).default;
    const input: any = {
      league, teamName, opponent: oppName,
      teamScore: parseInt(home?.score ?? '0', 10), opponentScore: parseInt(away?.score ?? '0', 10),
      isHome: true, date,
      teamRecentForm: drop(extras.teamRecentForm), opponentRecentForm: drop(extras.opponentRecentForm),
      headToHead: extras.headToHead?.filter((h: any) => String(h.date).slice(0, 10) !== day),
    };
    const block = buildReviewDataBlock(input);
    const ollama = new OpenAI({ baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1', apiKey: 'ollama' });
    const msg = await ollama.chat.completions.create({
      model: 'qwen3:30b-a3b-instruct-2507-q4_K_M', max_tokens: 3000,
      messages: [{ role: 'system', content: REVIEW_SYSTEM_PROMPT }, { role: 'user', content: block }],
    });
    const raw = (msg.choices[0]?.message?.content ?? '{}').replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const review = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    console.log('\n── VIOLATIONS:', JSON.stringify(validateReviewOutput(review, block)));
    console.log(JSON.stringify(review, null, 1).slice(0, 2200));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
