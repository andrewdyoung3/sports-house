#!/usr/bin/env tsx
/**
 * scripts/test-watermarks.ts — card background art.
 *
 * Two failures this guards, both seen live:
 *   - the Europa League and Conference League badges 404, and the renderers
 *     hid the image on error, so those cards had no art at all;
 *   - a league with no mark at all fell through to nothing.
 * Every league must therefore resolve to a sport-ball fallback that EXISTS on
 * disk, and each mark must be positioned by its visible art.
 */

import { existsSync } from 'fs';
import { LEAGUES } from '@/lib/teams';
import {
  WATERMARKS, competitionWatermark, sportFallbackMark,
  SPORT_FALLBACK_SPEC, WM_RIGHT_INSET,
} from '@/lib/watermarks';

let passed = 0, failed = 0;
function expect(name: string, cond: boolean): void {
  if (cond) { passed++; return; }
  failed++; console.log(`  ✗ ${name}`);
}

console.log('\n── every league has a sport fallback, and it exists ──');
{
  for (const l of LEAGUES) {
    const mark = sportFallbackMark(l.id);
    expect(`${l.id} has a fallback mark`, !!mark);
    if (mark) {
      expect(`${l.id} fallback file exists (${mark})`, existsSync(`public${mark}`));
      expect(`${l.id} fallback is local, not a CDN`, mark.startsWith('/watermarks/'));
    }
  }
}

console.log('── the fallback presentation is sane ──');
{
  expect('fallback is mono, so it adapts to both themes', SPORT_FALLBACK_SPEC.mono === true);
  expect('fallback needs no pad shift (tight viewBox)', SPORT_FALLBACK_SPEC.padRight === '0%');
  expect('fallback opacity sits in watermark range',
    SPORT_FALLBACK_SPEC.opacity > 0.05 && SPORT_FALLBACK_SPEC.opacity < 0.35);
}

console.log('── competition marks are positioned by visible art ──');
{
  for (const [key, spec] of Object.entries(WATERMARKS)) {
    expect(`${key} declares padRight (measured transparent padding)`, spec.padRight !== undefined);
    if (spec.padRight) {
      const n = parseFloat(spec.padRight);
      expect(`${key} padRight is a sane percentage`, spec.padRight.endsWith('%') && n >= 0 && n < 50);
    }
  }
  expect('the default inset is a px value', /^\d+px$/.test(WM_RIGHT_INSET));
}

console.log('── lookup precedence ──');
{
  expect('a named competition beats the league mark',
    competitionWatermark('Champions League', 'epl')?.url === WATERMARKS['comp:Champions League'].url);
  expect('no competition falls to the league mark',
    competitionWatermark(undefined, 'epl')?.url === WATERMARKS['league:epl'].url);
  expect('an unknown competition falls to the league mark',
    competitionWatermark('Some Friendly Cup', 'epl')?.url === WATERMARKS['league:epl'].url);
  expect('a league with no mark resolves to undefined (the ball then covers it)',
    competitionWatermark(undefined, 'mlb') === undefined);
  expect('...and that league still has a ball', !!sportFallbackMark('mlb'));
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
