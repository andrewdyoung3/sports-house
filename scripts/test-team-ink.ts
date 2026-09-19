#!/usr/bin/env tsx
/**
 * scripts/test-team-ink.ts — contrast guarantees for team brand colours.
 *
 * Asserts the two properties the UI depends on:
 *   1. Every team's derived ink clears WCAG AA (4.5:1) as TEXT on both themes'
 *      card backgrounds. Raw brand hexes clear neither reliably — the audit that
 *      prompted this found 0 of 255 teams passing both, with yellows unreadable
 *      on light (Richmond 1.39:1) and blacks/navies unreadable on dark (1.16:1).
 *   2. contrastColor() picks the genuinely more readable of black/white for text
 *      ON a brand fill (it used to mispick for 23 colours).
 *
 * Run: npx tsx scripts/test-team-ink.ts   (also part of `npm run test`)
 */

import { readFileSync } from 'fs';
import { TEAMS } from '@/lib/teams';
import { contrastColor } from '@/lib/utils';
import {
  accentVars, contrastRatio, readableInk,
  INK_BG_LIGHT, INK_BG_DARK, INK_TARGET_AA,
} from '@/lib/team-ink';

let passed = 0;
let failed = 0;
function expect(name: string, cond: boolean): void {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  ✗ ${name}`);
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const teams = TEAMS.filter(t => HEX_RE.test(t.primaryColor));

console.log(`\n── every team readable in both themes (${teams.length} teams) ──`);
{
  const failures: string[] = [];
  for (const t of teams) {
    const v = accentVars(t.primaryColor);
    const light = contrastRatio(v['--accent-ink-l'], INK_BG_LIGHT);
    const dark  = contrastRatio(v['--accent-ink-d'], INK_BG_DARK);
    if (light < INK_TARGET_AA || dark < INK_TARGET_AA) {
      failures.push(`${t.name} (${t.primaryColor}) light=${light.toFixed(2)} dark=${dark.toFixed(2)}`);
    }
  }
  expect(`all ${teams.length} teams clear AA in BOTH themes`, failures.length === 0);
  failures.slice(0, 8).forEach(f => console.log(`      ${f}`));
}

console.log('── the audited worst cases ──');
{
  // Light mode: the colours the user reported plus the rest of the <3:1 band.
  const lightCases: Array<[string, string]> = [
    ['Richmond yellow',        '#ffd200'],
    ['Wallabies/Hurricanes',   '#ffd700'],
    ['Leeds yellow',           '#ffcd00'],
    ['Mercedes cyan',          '#27f4d2'],
    ['Cricket Australia gold', '#f5c518'],
    ['Spurs silver',           '#c4ced4'],
    ['England white',          '#ffffff'],
    ['McLaren orange',         '#ff8000'],
  ];
  for (const [label, hex] of lightCases) {
    expect(`${label} unreadable raw on light (proves the bug)`, contrastRatio(hex, INK_BG_LIGHT) < 3);
    expect(`${label} → AA after ink`, contrastRatio(readableInk(hex, INK_BG_LIGHT), INK_BG_LIGHT) >= INK_TARGET_AA);
  }

  // Dark mode: the inverse problem, which is numerically the larger one.
  const darkCases: Array<[string, string]> = [
    ['Collingwood/All Blacks black', '#000000'],
    ['Carlton navy',                 '#0e1e2e'],
    ['Geelong navy',                 '#001f5b'],
    ['Chicago Bears navy',           '#0b162a'],
    ['Fremantle purple',             '#2a1a5e'],
    ['Brisbane Lions maroon',        '#a30046'],
  ];
  for (const [label, hex] of darkCases) {
    expect(`${label} unreadable raw on dark (proves the bug)`, contrastRatio(hex, INK_BG_DARK) < 3);
    expect(`${label} → AA after ink`, contrastRatio(readableInk(hex, INK_BG_DARK), INK_BG_DARK) >= INK_TARGET_AA);
  }
}

console.log('── ink leaves already-readable colours alone ──');
{
  // The correction must be a no-op where the brand colour already works, so the
  // app keeps its brand tone everywhere it legitimately can.
  expect('Richmond yellow untouched on dark', readableInk('#ffd200', INK_BG_DARK) === '#ffd200');
  expect('Carlton navy untouched on light',   readableInk('#0e1e2e', INK_BG_LIGHT) === '#0e1e2e');
  const untouchedLight = teams.filter(t => readableInk(t.primaryColor, INK_BG_LIGHT) === t.primaryColor.toLowerCase()).length;
  const untouchedDark  = teams.filter(t => readableInk(t.primaryColor, INK_BG_DARK)  === t.primaryColor.toLowerCase()).length;
  expect('most teams keep their exact brand tone on light', untouchedLight > teams.length * 0.6);
  expect('some teams keep their exact brand tone on dark',  untouchedDark > 20);
  console.log(`      brand tone kept as-is: ${untouchedLight}/${teams.length} light, ${untouchedDark}/${teams.length} dark`);
}

console.log('── hue is preserved (a yellow must not become a brown-grey) ──');
{
  // Hue drift is what separates an OKLCh lightness walk from a naive darken.
  const hueOf = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
  };
  const drift = (a: string, b: string) => { const d = Math.abs(hueOf(a) - hueOf(b)); return Math.min(d, 360 - d); };
  for (const [label, hex, bg] of [
    ['Richmond yellow', '#ffd200', INK_BG_LIGHT],
    ['Mercedes cyan',   '#27f4d2', INK_BG_LIGHT],
    ['McLaren orange',  '#ff8000', INK_BG_LIGHT],
    ['Geelong navy',    '#001f5b', INK_BG_DARK],
    ['Lions maroon',    '#a30046', INK_BG_DARK],
  ] as const) {
    expect(`${label} keeps its hue (±12°)`, drift(hex, readableInk(hex, bg)) <= 12);
  }
}

console.log('── contrastColor picks the better of black/white for FILLS ──');
{
  const hexes = [...new Set(teams.map(t => t.primaryColor.toLowerCase()))];
  const mispicks = hexes.filter(hex => {
    const picked = contrastColor(hex);
    const best = contrastRatio('#000000', hex) >= contrastRatio('#ffffff', hex) ? '#000000' : '#ffffff';
    return picked !== best;
  });
  expect(`no mispicks across ${hexes.length} distinct fills`, mispicks.length === 0);
  mispicks.slice(0, 5).forEach(h => console.log(`      ${h}`));
  // The regressions the old perceived-brightness threshold produced.
  expect('Melbourne Stars green takes black (was white at 2.85:1)', contrastColor('#00b140') === '#000000');
  expect('Miami Marlins blue takes black',                          contrastColor('#00a3e0') === '#000000');
  expect('Arsenal red takes black',                                 contrastColor('#ef0107') === '#000000');
  expect('deep navy still takes white',                             contrastColor('#0c2340') === '#ffffff');
  expect('bright yellow still takes black',                         contrastColor('#ffd200') === '#000000');
  expect('invalid hex falls back to white',                         contrastColor('not-a-hex') === '#ffffff');
}

console.log('── theme token parity in globals.css ──');
{
  // The bug this guards: `.sh-theme` re-declares the DARK palette locally, so any
  // token it sets beats the light value inherited from [data-theme='light'] on
  // <html>. A token added to .sh-theme without a matching reset in
  // [data-theme='light'] .sh-theme therefore keeps its dark value in light mode.
  // Found live via the mobile calendar sheet; the same gap had left W/L pips on
  // the dark green (1.96:1 on the light card) and the fallback accent at 3.40:1.
  const css = readFileSync('src/app/globals.css', 'utf8');
  const block = (re: RegExp) => css.match(re)?.[1] ?? '';
  const darkBlock  = block(/\n\.sh-theme \{([\s\S]*?)\n\}/);
  const lightBlock = block(/\[data-theme='light'\] \.sh-theme \{([\s\S]*?)\n\}/);
  expect('both .sh-theme blocks found', darkBlock.length > 0 && lightBlock.length > 0);

  const names = (b: string) => new Set([...b.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  // Exempt tokens that are theme-agnostic by nature: geometry, and values wholly
  // derived from other tokens (color-mix/var) which re-resolve per theme.
  const EXEMPT = new Set(['--radius', '--radius-lg', '--bg-grad']);
  const lightNames = names(lightBlock);
  const unreset = [...names(darkBlock)].filter(t =>
    !lightNames.has(t) && !EXEMPT.has(t)
    && !new RegExp(`${t}:\\s*(var|color-mix)`).test(darkBlock));
  expect('every literal .sh-theme token has a light reset', unreset.length === 0);
  unreset.forEach(t => console.log(`      missing light reset: ${t}`));

  // The specific values the gap was hiding.
  expect('light .sh-theme resets --win',  /--win:\s*#147a44/.test(lightBlock));
  expect('light .sh-theme resets --loss', /--loss:\s*#bb2c48/.test(lightBlock));
  expect('light .sh-theme resets the fallback --accent', /--accent:\s*#6d3ee0/.test(lightBlock));
  expect('light .sh-theme resets --modal-bg', /--modal-bg:\s*#f4f1f8/.test(lightBlock));

  // Overlay surfaces must come from a token, never an arbitrary Tailwind value:
  // [data-theme='light'] overrides match on class names (.bg-black\\/20) and can
  // never reach bg-[#0e0e18], which is how the calendar sheet stayed dark.
  const sheets = ['src/app/schedule/page.tsx', 'src/app/results/page.tsx'];
  for (const f of sheets) {
    const src = readFileSync(f, 'utf8');
    expect(`${f.split('/').slice(-2).join('/')} sheet uses .sh-sheet, not an arbitrary bg`,
      src.includes('sh-sheet') && !/bg-\[#[0-9a-f]{6}\]/i.test(src));
  }
}

console.log('── accentVars shape ──');
{
  const v = accentVars('#ffd200');
  expect('keeps the brand colour in --accent', v['--accent'] === '#ffd200');
  expect('emits a light ink', HEX_RE.test(v['--accent-ink-l']));
  expect('emits a dark ink', HEX_RE.test(v['--accent-ink-d']));
  expect('passes through a non-hex accent untouched', accentVars('var(--x)')['--accent-ink-l'] === 'var(--x)');
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
