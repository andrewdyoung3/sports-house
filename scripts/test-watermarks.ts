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

import { existsSync, readdirSync, readFileSync } from 'fs';
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
  // The marks are shaded greyscale renders; mono would flatten the 3D to one ink.
  expect('fallback is NOT mono (greyscale render serves both themes as-is)', SPORT_FALLBACK_SPEC.mono === false);
  expect('fallback needs no pad shift (tight viewBox)', SPORT_FALLBACK_SPEC.padRight === '0%');
  expect('fallback opacity sits in watermark range',
    SPORT_FALLBACK_SPEC.opacity > 0.05 && SPORT_FALLBACK_SPEC.opacity <= 0.45);
  // The mark files must be true greyscale — a colour would betray the theme trick.
  for (const f of readdirSync('public/watermarks').filter(f => f.endsWith('.svg'))) {
    const svg = readFileSync(`public/watermarks/${f}`, 'utf8');
    const colours = [...new Set(svg.match(/#[0-9a-f]{3,6}\b/gi) ?? [])];
    const chroma = colours.filter(c => {
      const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1);
      const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      return Math.max(r, g, b) - Math.min(r, g, b) > 48;
    });
    expect(`${f} is greyscale (found: ${chroma.join(', ') || 'none'})`, chroma.length === 0);
  }
}

console.log('── marks are sized by a clamped real height, not a transform ──');
{
  // A transform: scale() is invisible to the box model, so nothing could stop
  // it pushing a 140% mark past the card (seen: AFL/NBA/EPL marks rendered as
  // clipped slices on desktop). The size must be a real height under a cap.
  const css = readFileSync('src/app/globals.css', 'utf8');
  const rule = css.slice(css.indexOf('.sh-wm-comp {'), css.indexOf('}', css.indexOf('.sh-wm-comp {')));
  expect('.sh-wm-comp height is a clamped calc of --wm-h', /height:\s*min\(calc\(var\(--wm-h/.test(rule));
  expect('.sh-wm-comp transform carries no scale()', !/scale\(/.test(rule));
  expect('light theme drops the screen blend', /\[data-theme='light'\] \.sh-wm-screen\s*\{[^}]*mix-blend-mode:\s*normal/.test(css));
  for (const [k, v] of Object.entries(WATERMARKS)) {
    if (v.lightOpacity !== undefined) {
      expect(`${k} lightOpacity sits in watermark range`, v.lightOpacity > 0.05 && v.lightOpacity <= 0.45);
    }
  }
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
