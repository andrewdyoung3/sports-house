/**
 * Unit tests for the RSS standfirst layer (src/lib/rss-news.ts).
 * Run: npx tsx scripts/test-rss.ts
 */
import { parseRssItems, teamMatchTokens } from '../src/lib/rss-news';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const SAMPLE = `<?xml version="1.0"?><rss><channel><title>Sport</title>
<item><title><![CDATA[Arsenal latest: panel verdict on Gabriel]]></title>
<description><![CDATA[]]></description>
<pubDate>Wed, 16 Sep 2026 11:15:00 BST</pubDate></item>
<item><title>Hawks name unchanged side for preliminary final</title>
<description><![CDATA[Hawthorn have resisted the temptation to tinker, <b>naming</b> an unchanged 22.]]></description>
<pubDate>Tue, 15 Sep 2026 22:00:00 +0000</pubDate></item>
<item><description>orphan description, no title</description></item>
</channel></rss>`;

console.log('parseRssItems');
const items = parseRssItems(SAMPLE);
check('parses two titled items, skips the titleless one', items.length === 2);
check('CDATA title unwrapped', items[0].title === 'Arsenal latest: panel verdict on Gabriel');
check('empty CDATA description → undefined', items[0].description === undefined);
check('inline HTML stripped from description', items[1].description === 'Hawthorn have resisted the temptation to tinker, naming an unchanged 22.');
check('pubDate captured', !!items[1].pubDate && items[1].pubDate.includes('15 Sep 2026'));

console.log('teamMatchTokens');
check('multi-word club: full name + nickname', teamMatchTokens('Hawthorn Hawks', false).join('|') === 'Hawthorn Hawks|Hawks');
check('generic nickname suppressed ("Heat")', teamMatchTokens('Brisbane Heat', false).join('|') === 'Brisbane Heat');
check('single-word team on sport-scoped feed passes', teamMatchTokens('Australia', true).join('|') === 'Australia');
check('single-word team on all-sport feed suppressed', teamMatchTokens('Australia', false).length === 0);
check('short nickname suppressed (<4 chars)', !teamMatchTokens('Sydney FC', false).includes('FC'));

import { parseGuardianResults, excerptFromBody } from '../src/lib/guardian';

console.log('parseGuardianResults');
const GJSON = { response: { results: [
  { webTitle: 'Fallback title', webPublicationDate: '2026-09-15T10:00:00Z',
    fields: { headline: 'Arteta&apos;s Arsenal find a new gear', byline: 'Jonathan Liew',
      standfirst: '<p>A statement win at the Emirates</p>',
      bodyText: 'Arsenal were relentless from the first whistle. Their press suffocated the visitors, and the crowd sensed it early. The rest of the half followed the same pattern with wave after wave of pressure that eventually told on the scoreboard and beyond.' } },
  { fields: {} },
] } };
const notes = parseGuardianResults(GJSON);
check('one note parsed, empty result skipped', notes.length === 1);
check('byline captured', notes[0].byline === 'Jonathan Liew');
check('standfirst HTML stripped', notes[0].standfirst === 'A statement win at the Emirates');
check('excerpt is leading sentences, ≤320 chars', !!notes[0].excerpt && notes[0].excerpt.startsWith('Arsenal were relentless') && notes[0].excerpt.length <= 320);
check('malformed json → empty', parseGuardianResults({ oops: true }).length === 0);
check('excerptFromBody clips long single sentence with ellipsis',
  (excerptFromBody('word '.repeat(200)) ?? '').endsWith('…'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
