#!/usr/bin/env tsx
/**
 * scripts/verify-sandbox-faithful.ts
 *
 * Proves the sandbox sends production's EXACT two-message payload. For each gameId
 * it compares both chat layers:
 *
 *   SYSTEM message:
 *     PROD    = SYSTEM_PROMPT (imported from preview-prompt.ts)
 *     SANDBOX = the `systemPrompt` the live /api/sandbox/context route returns
 *               (which seeds the sandbox's System-instructions pane default)
 *
 *   USER message (per-fixture data block):
 *     PROD    = buildPreviewContext -> buildDataBlock(...)
 *     SANDBOX = compose(blocks, footer) from the live /api/sandbox/context route,
 *               mirroring the page's composePrompt with all blocks enabled
 *
 * Both diffs must be EMPTY — that is the proof the sandbox runs under the same
 * instructions AND the same fixture data production does.
 *
 * Requires the dev server (default http://localhost:3001 — override with SANDBOX_BASE).
 *
 * Usage: npx tsx scripts/verify-sandbox-faithful.ts <gameId> [<gameId> ...]
 */

import { readFileSync } from 'fs';

try {
  const content = readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
} catch { /* env set externally */ }

import { fetchLeagueFixtures, fetchCricketFixtureById } from '@/lib/league-fixtures';
import { TEAMS } from '@/lib/teams';
import { buildDataBlock, SYSTEM_PROMPT } from '@/lib/preview-prompt';
import { buildPreviewContext } from '@/lib/preview-context';
import type { PreviewContext } from '@/types';

const BASE = process.env.SANDBOX_BASE ?? 'http://localhost:3001';

const PREFIX_TO_LEAGUE: Record<string, string> = {
  afl: 'afl', nrl: 'nrl', soo: 'nrl', epl: 'epl', sru: 'super_rugby',
  nba: 'nba', f1: 'f1', rint: 'rugby_int', bbl: 'bbl', cint: 'cricket_int',
};

interface SandboxContext {
  gameLabel: string;
  league: string;
  blocks: { id: string; text: string }[];
  systemPrompt: string;
  footer: string;
  error?: string;
}

// Mirror the sandbox client's composePrompt exactly (all blocks enabled).
function compose(blocks: { id: string; text: string }[], footer: string): string {
  const parts: string[] = [];
  for (const b of blocks) if (b.text) parts.push(b.text);
  if (footer) parts.push(footer);
  return parts.join('\n');
}

function firstDiff(a: string, b: string): string[] {
  const al = a.split('\n');
  const bl = b.split('\n');
  const out: string[] = [];
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max && out.length < 12; i++) {
    if (al[i] !== bl[i]) {
      out.push(`    L${i + 1}  PROD:    ${JSON.stringify(al[i] ?? '<none>')}`);
      out.push(`          SANDBOX: ${JSON.stringify(bl[i] ?? '<none>')}`);
    }
  }
  return out;
}

async function main() {
  if (typeof (globalThis as unknown as Record<string, unknown>).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as unknown as Record<string, unknown>).WebSocket = ws;
  }

  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('Usage: npx tsx scripts/verify-sandbox-faithful.ts <gameId> [...]');
    process.exit(1);
  }

  let anyFail = false;

  for (const gameId of ids) {
    const league = PREFIX_TO_LEAGUE[gameId.split('-')[0]];
    if (!league) { console.log(`\n${gameId}: unknown prefix — skip`); continue; }

    // ── PRODUCTION (in-process) ──────────────────────────────────────────────
    const fixtures = await fetchLeagueFixtures(league, 30);
    const now = Date.now();
    let fixture = fixtures.find(
      f => f.id === gameId && new Date(f.date).getTime() <= now + 60 * 86400_000,
    );
    let teamName = fixture ? (TEAMS.find(t => t.id === fixture!.teamId)?.name ?? fixture.teamId) : '';

    // Mirror the sandbox route: resolve cricket ids directly (dormant fixture lists).
    if (!fixture && (league === 'bbl' || league === 'cricket_int')) {
      const resolved = await fetchCricketFixtureById(gameId);
      if (resolved) { fixture = resolved.fixture; teamName = resolved.teamName; }
    }
    if (!fixture) { console.log(`\n${gameId}: fixture not found — skip`); continue; }

    const ctx = await buildPreviewContext(league, fixture, teamName);

    const prodUser   = buildDataBlock(
      league, teamName, fixture.opponent, ctx as PreviewContext, [], [],
      fixture.competition, false, undefined, fixture.venue, fixture.isHome,
      fixture.teamId, fixture.opponentId, fixture.seriesSummary,
    );
    const prodSystem = SYSTEM_PROMPT;

    // ── SANDBOX (live route — real wire bytes) ───────────────────────────────
    let sb: SandboxContext;
    try {
      const res = await fetch(`${BASE}/api/sandbox/context?gameId=${encodeURIComponent(gameId)}`);
      sb = await res.json() as SandboxContext;
      if (!res.ok || sb.error) { throw new Error(sb.error ?? `HTTP ${res.status}`); }
    } catch (err) {
      anyFail = true;
      console.log(`\n❌ ${gameId}: could not reach sandbox route at ${BASE} — ${err instanceof Error ? err.message : err}`);
      console.log('   (start the dev server, or set SANDBOX_BASE)');
      continue;
    }

    const sbUser   = compose(sb.blocks, sb.footer);
    const sbSystem = sb.systemPrompt;

    const tag = `${gameId}  (${teamName} vs ${fixture.opponent}, ${league})`;
    const sysOk  = prodSystem === sbSystem;
    const userOk = prodUser === sbUser;

    if (sysOk && userOk) {
      console.log(`\n✅ ${tag}`);
      console.log(`   SYSTEM identical — ${prodSystem.length} bytes`);
      console.log(`   USER   identical — ${prodUser.length} bytes (${sb.blocks.length} blocks)`);
    } else {
      anyFail = true;
      console.log(`\n❌ ${tag}`);
      if (!sysOk) {
        console.log(`   SYSTEM DIFFERS — prod ${prodSystem.length} vs sandbox ${sbSystem.length} bytes`);
        console.log(firstDiff(prodSystem, sbSystem).join('\n'));
      } else {
        console.log(`   SYSTEM identical — ${prodSystem.length} bytes`);
      }
      if (!userOk) {
        console.log(`   USER DIFFERS — prod ${prodUser.length} vs sandbox ${sbUser.length} bytes`);
        console.log(firstDiff(prodUser, sbUser).join('\n'));
      } else {
        console.log(`   USER identical — ${prodUser.length} bytes`);
      }
    }
  }

  console.log(anyFail
    ? '\n=== FAIL: at least one message diverged ==='
    : '\n=== PASS: system + user messages byte-identical for all fixtures ===');
  process.exit(anyFail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
