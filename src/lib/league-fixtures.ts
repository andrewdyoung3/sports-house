/**
 * Core fixture fetchers for all supported leagues.
 *
 * Shared between `src/app/api/league-fixtures/route.ts` (which may wrap
 * individual fetchers with `unstable_cache`) and `scripts/generate-previews.ts`
 * (which calls them directly, no caching needed).
 *
 * lookbackDays (default 0)
 *   When > 0, the fetchers also return recently-completed fixtures so the
 *   standalone generator can determine each team's prior fixture for the
 *   settle-buffer gate. Completed fixtures are marked with `completed: true`.
 *   The route always calls with the default (0 = upcoming only).
 */

import type { UpcomingGame } from '@/types';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { TEAMS } from '@/lib/teams';
import { COUNTRY_TO_ABBR } from '@/lib/f1-data';
import { fetchTimeout, aestDisplay, parseCricketFormat } from '@/lib/espn';
import { AFL_TEAM_BY_SQUIGGLE as AFL_TEAMS } from '@/lib/afl';
import { cricketConfigured, cricCurrentMatches, cricMatchInfo, cricSeriesInfo, type CricMatch } from '@/lib/cricketdata';
import { SOO_META, isSOOEvent, tallySeries, seriesLabelSuffix } from '@/lib/soo';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length >= 2 ? words.map(w => w[0]).join('') : name)
    .slice(0, 3).toUpperCase();
}

interface TeamEntry { id: string; color: string; abbr: string }

// ─── AFL — Squiggle ───────────────────────────────────────────────────────────

export async function fetchAFLFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const year = new Date().getFullYear();
  const res  = await fetchTimeout(
    `https://api.squiggle.com.au/?q=games;year=${year}`,
    { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const { games = [] } = await res.json();
  const now        = Date.now();
  const lookbackMs = lookbackDays * 86400_000;
  const seen       = new Set<string>();

  return (games as any[])
    .filter(g => {
      const t         = g.unixtime * 1000;
      const isComplete = Number(g.complete) >= 100;
      if (isComplete) return lookbackDays > 0 && t > now - lookbackMs;
      return t > now; // upcoming
    })
    .reduce<UpcomingGame[]>((acc, g) => {
      const id = `afl-${g.id}`;
      if (seen.has(id)) return acc;
      seen.add(id);

      const home = AFL_TEAMS[g.hteam];
      const away = AFL_TEAMS[g.ateam];
      if (!home) return acc;

      const tz         = (g.tz as string) ?? '+10:00';
      const d          = new Date(g.date.replace(' ', 'T') + tz);
      const time       = g.timestr ? `${g.timestr} AEST` : aestDisplay(d);
      const isComplete = Number(g.complete) >= 100;

      acc.push({
        id,
        teamId:          home.id,
        opponent:        g.ateam,
        opponentAbbr:    away?.abbr  ?? initials(g.ateam),
        opponentColor:   away?.color ?? '#6B7280',
        opponentLogoUrl: away ? (TEAM_LOGOS[away.id] ?? away.logo) : undefined,
        isHome:          true,
        date:            d.toISOString(),
        time,
        venue:           g.venue ?? '',
        broadcast:       ['Seven Network', 'Fox Footy'],
        streaming:       ['Kayo Sports'],
        opponentId:      away?.id,
        completed:       isComplete || undefined,
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── NRL — ESPN ───────────────────────────────────────────────────────────────

const NRL_TEAMS: Record<string, TeamEntry> = {
  'Broncos':      { id: 'nrl-broncos',   color: '#6F1C2B', abbr: 'BRI' },
  'Raiders':      { id: 'nrl-raiders',   color: '#69BE28', abbr: 'CAN' },
  'Bulldogs':     { id: 'nrl-bulldogs',  color: '#003C94', abbr: 'CBY' },
  'Sharks':       { id: 'nrl-sharks',    color: '#009EDB', abbr: 'CRO' },
  'Dolphins':     { id: 'nrl-dolphins',  color: '#DF2626', abbr: 'DOL' },
  'Titans':       { id: 'nrl-titans',    color: '#009FDF', abbr: 'GCT' },
  'Eels':         { id: 'nrl-eels',      color: '#003B8E', abbr: 'PAR' },
  'Panthers':     { id: 'nrl-panthers',  color: '#001F5C', abbr: 'PEN' },
  'Sea Eagles':   { id: 'nrl-seahawks',  color: '#B82837', abbr: 'MAN' },
  'Storm':        { id: 'nrl-storm',     color: '#4F2D7F', abbr: 'MEL' },
  'Knights':      { id: 'nrl-knights',   color: '#00204E', abbr: 'NEW' },
  'Warriors':     { id: 'nrl-warriors',  color: '#808080', abbr: 'WAR' },
  'Cowboys':      { id: 'nrl-cowboys',   color: '#002B5C', abbr: 'COW' },
  'Rabbitohs':    { id: 'nrl-rabbitohs', color: '#007B3F', abbr: 'SOU' },
  'Dragons':      { id: 'nrl-dragons',   color: '#CD0000', abbr: 'DRA' },
  'Roosters':     { id: 'nrl-roosters',  color: '#012B5C', abbr: 'SYD' },
  'Wests Tigers': { id: 'nrl-tigers',    color: '#F47920', abbr: 'WTI' },
};

export async function fetchNRLFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowDate    = new Date();
  const lookbackMs = lookbackDays * 86400_000;
  const start      = lookbackDays > 0 ? new Date(nowDate.getTime() - lookbackMs) : nowDate;
  const end        = new Date(nowDate.getTime() + 90 * 86400_000);
  const fmt        = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${fmt(start)}-${fmt(end)}&limit=200`,
    { cache: 'no-store' },
  );
  if (!res.ok) return [];

  const data     = await res.json();
  const nowMs    = nowDate.getTime();
  const cutoff   = nowMs - lookbackMs;
  const seen     = new Set<string>();

  const clubFixtures = ((data.events ?? []) as any[])
    .filter(e => {
      const isComplete = e.status?.type?.completed === true;
      if (isComplete) return lookbackDays > 0 && new Date(e.date).getTime() >= cutoff;
      return true;
    })
    .reduce<UpcomingGame[]>((acc, e) => {
      const id = `nrl-${e.id}`;
      if (seen.has(id)) return acc;
      seen.add(id);

      const comp:  any   = e.competitions?.[0] ?? {};
      const comps: any[] = comp.competitors ?? [];
      const homeComp = comps.find((c: any) => c.homeAway === 'home');
      const awayComp = comps.find((c: any) => c.homeAway === 'away');
      const homeName = homeComp?.team?.displayName ?? '';
      const awayName = awayComp?.team?.displayName ?? '';
      const home = NRL_TEAMS[homeName];
      if (!home) return acc;
      const away = NRL_TEAMS[awayName];

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const espnLogo = awayComp?.team?.logos?.[0]?.href as string | undefined;
      const isComplete = e.status?.type?.completed === true;

      acc.push({
        id,
        teamId:          home.id,
        opponent:        awayName,
        opponentAbbr:    away?.abbr  ?? initials(awayName),
        opponentColor:   away?.color ?? '#6B7280',
        opponentLogoUrl: espnLogo ?? (away ? TEAM_LOGOS[away.id] : undefined),
        isHome:          true,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Nine Network', 'Fox Sports'],
        streaming:       ['Kayo Sports'],
        opponentId:      away?.id,
        completed:       isComplete || undefined,
      });
      return acc;
    }, []);

  // State of Origin (NSW vs QLD) is in the same rugby-league/3 feed but its teams
  // aren't clubs, so it's dropped above. Append it via the rep-team path so the
  // GENERATION pipeline queues it (the display route does this separately).
  const soo = await fetchSOOGenerationFixtures(lookbackDays);

  return [...clubFixtures, ...soo]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ESPN rep displayName → our internal rep team id.
const SOO_ESPN_TO_REPID: Record<string, string> = {
  'Queensland':      'nrl-maroons',
  'New South Wales': 'nrl-blues',
};

/**
 * Canonical State of Origin fixtures for the generation pipeline. ONE fixture per
 * physical game (id `soo-<homeRepId>-<eventId>`, teamId = home rep, opponentId =
 * away rep) so both rep followers' decideForTeam resolve to it → a single
 * generation (the loop dedupes by fixture.id). mirrorGameIds carries the other
 * perspective key (`soo-<awayRepId>-<eventId>`) so the one payload is upserted
 * under both display keys. Series state/label derived via the shared soo.ts.
 */
async function fetchSOOGenerationFixtures(lookbackDays: number): Promise<UpcomingGame[]> {
  const year   = new Date().getFullYear();
  const cutoff = Date.now() - lookbackDays * 86400_000;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${year}0415-${year}0901&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const allSOO = ((data.events ?? []) as any[])
    .filter(isSOOEvent)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const out: UpcomingGame[] = [];
  allSOO.forEach((e: any, idx: number) => {
    const completed = e.status?.type?.completed === true;
    const startMs   = new Date(e.date).getTime();
    if (completed) {
      if (!(lookbackDays > 0 && startMs >= cutoff)) return; // skip old completed games
    }

    const comp:  any   = e.competitions?.[0] ?? {};
    const comps: any[] = comp.competitors ?? [];
    const homeName = (comps.find(c => c.homeAway === 'home') ?? comps[0])?.team?.displayName ?? '';
    const awayName = (comps.find(c => c.homeAway === 'away') ?? comps[1])?.team?.displayName ?? '';
    const homeId = SOO_ESPN_TO_REPID[homeName];
    const awayId = SOO_ESPN_TO_REPID[awayName];
    if (!homeId || !awayId) return;

    const meta  = SOO_META[homeId];            // home-team perspective
    const tally = tallySeries(allSOO, meta);   // shared derivation (C2)
    const gameNumber = idx + 1;

    const utc  = new Date(e.date);
    const aest = new Date(utc.getTime() + 10 * 3600 * 1000);

    out.push({
      id:              `soo-${homeId}-${e.id}`,
      teamId:          homeId,
      opponent:        TEAMS.find(t => t.id === awayId)?.name ?? awayName,
      opponentAbbr:    meta.oppAbbr,
      opponentColor:   meta.oppColor,
      opponentLogoUrl: meta.oppLogoUrl,
      opponentId:      awayId,
      // ESPN's "home" flag for Origin is nominal (jersey/last-change rights), not
      // venue advantage — Origin rotates through neutral venues (MCG, Perth…).
      // Leave isHome=false so the prompt's venue classifier decides from the
      // registered ground: neutral at the MCG, genuine home only at Accor/Suncorp.
      isHome:          false,
      date:            utc.toISOString(),
      time:            aestDisplay(aest),
      venue:           comp.venue?.fullName ?? '',
      broadcast:       ['Nine Network', 'Fox Sports'],
      streaming:       ['Kayo Sports', '9Now'],
      competition:     `State of Origin — Game ${gameNumber}${seriesLabelSuffix(tally, meta)}`,
      mirrorGameIds:   [`soo-${awayId}-${e.id}`],
      completed:       completed || undefined,
    });
  });

  return out;
}

// ─── EPL — ESPN (multiple competitions) ──────────────────────────────────────

const EPL_TEAMS: Record<string, TeamEntry> = {
  'Arsenal':                    { id: 'epl-arsenal',      color: '#EF0107', abbr: 'ARS' },
  'Aston Villa':                { id: 'epl-astonvilla',   color: '#670E36', abbr: 'AVL' },
  'AFC Bournemouth':            { id: 'epl-bournemouth',  color: '#DA291C', abbr: 'BOU' },
  'Brentford':                  { id: 'epl-brentford',    color: '#E30613', abbr: 'BRE' },
  'Brighton & Hove Albion':     { id: 'epl-brighton',     color: '#0057B8', abbr: 'BHA' },
  'Burnley':                    { id: 'epl-burnley',      color: '#6C1D45', abbr: 'BUR' },
  'Chelsea':                    { id: 'epl-chelsea',      color: '#034694', abbr: 'CHE' },
  'Crystal Palace':             { id: 'epl-crystalpalace',color: '#1B458F', abbr: 'CRY' },
  'Everton':                    { id: 'epl-everton',      color: '#003399', abbr: 'EVE' },
  'Fulham':                     { id: 'epl-fulham',       color: '#000000', abbr: 'FUL' },
  'Leeds United':               { id: 'epl-leeds',        color: '#FFCD00', abbr: 'LEE' },
  'Liverpool':                  { id: 'epl-liverpool',    color: '#C8102E', abbr: 'LIV' },
  'Manchester City':            { id: 'epl-mancity',      color: '#6CABDD', abbr: 'MCI' },
  'Manchester United':          { id: 'epl-manutd',       color: '#DA291C', abbr: 'MUN' },
  'Newcastle United':           { id: 'epl-newcastle',    color: '#241F20', abbr: 'NEW' },
  'Nottingham Forest':          { id: 'epl-forest',       color: '#DD0000', abbr: 'NFO' },
  'Sunderland':                 { id: 'epl-sunderland',   color: '#EB172B', abbr: 'SUN' },
  'Tottenham Hotspur':          { id: 'epl-spurs',        color: '#132257', abbr: 'TOT' },
  'West Ham United':            { id: 'epl-westham',      color: '#7A263A', abbr: 'WHU' },
  'Wolverhampton Wanderers':    { id: 'epl-wolves',       color: '#FDB913', abbr: 'WOL' },
};

const EPL_COMPS: { slug: string; label: string }[] = [
  { slug: 'eng.1',           label: 'Premier League'  },
  { slug: 'eng.fa',          label: 'FA Cup'           },
  { slug: 'eng.league_cup',  label: 'EFL Cup'          },
  { slug: 'uefa.champions',  label: 'Champions League' },
  { slug: 'uefa.europa',     label: 'Europa League'    },
];

const EPL_RIGHTS: Record<string, { broadcast: string[]; streaming: string[] }> = {
  'eng.1':          { broadcast: ['Stan Sport'], streaming: ['Stan Sport'] },
  'eng.fa':         { broadcast: ['Stan Sport'], streaming: ['Stan Sport'] },
  'eng.league_cup': { broadcast: ['Stan Sport'], streaming: ['Stan Sport'] },
  'uefa.champions': { broadcast: ['Stan Sport'], streaming: ['Stan Sport'] },
  'uefa.europa':    { broadcast: ['Stan Sport'], streaming: ['Stan Sport'] },
};

export async function fetchEPLFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowMs      = Date.now();
  const lookbackMs = lookbackDays * 86400_000;
  const eventCutoff = nowMs - lookbackMs; // oldest event timestamp to include

  const nowDate = new Date(nowMs);
  const end     = new Date(nowMs + 150 * 86400_000);
  const start   = lookbackDays > 0 ? new Date(nowMs - lookbackMs) : nowDate;
  const fmt     = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range   = `${fmt(start)}-${fmt(end)}`;

  const settled = await Promise.allSettled(
    EPL_COMPS.map(async ({ slug, label }) => {
      const isUEFA   = slug.startsWith('uefa.');
      const eventMap = new Map<string, any>();

      const urls: string[] = [
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}&limit=200`,
      ];
      if (isUEFA) {
        urls.push(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?limit=50`);
      }

      for (const url of urls) {
        try {
          const res = await fetchTimeout(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const data = await res.json();
          for (const e of (data.events ?? []) as any[]) {
            if (!eventMap.has(e.id)) eventMap.set(e.id, e);
          }
        } catch { /* skip */ }
      }

      if (eventMap.size === 0) return [] as UpcomingGame[];
      const rights = EPL_RIGHTS[slug] ?? { broadcast: ['Stan Sport'], streaming: ['Stan Sport'] };

      return Array.from(eventMap.values()).reduce<UpcomingGame[]>((acc, e) => {
        const isComplete = e.status?.type?.completed === true;
        const eventTime  = new Date(e.date).getTime();
        if (isComplete) {
          // Include completed only within lookback window
          if (!lookbackDays || eventTime < eventCutoff) return acc;
        } else {
          // Exclude upcoming events older than our cutoff (avoids very old in-progress stubs)
          if (eventTime < eventCutoff) return acc;
        }

        const comp:  any   = e.competitions?.[0] ?? {};
        const comps: any[] = comp.competitors ?? [];
        const homeComp = comps.find((c: any) => c.homeAway === 'home');
        const awayComp = comps.find((c: any) => c.homeAway === 'away');
        const homeName = homeComp?.team?.displayName ?? '';
        const awayName = awayComp?.team?.displayName ?? '';
        const homeEPL  = EPL_TEAMS[homeName];
        const awayEPL  = EPL_TEAMS[awayName];

        if (!homeEPL && !awayEPL) return acc;

        const utcDate  = new Date(e.date);
        const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);

        if (homeEPL) {
          const oppEPL  = awayEPL;
          const oppLogo = (awayComp?.team?.logo as string | undefined)
                       ?? (oppEPL ? TEAM_LOGOS[oppEPL.id] : undefined);
          acc.push({
            id:              `soccer-${slug}-${e.id}`,
            teamId:          homeEPL.id,
            opponent:        awayName,
            opponentAbbr:    oppEPL?.abbr  ?? initials(awayName),
            opponentColor:   oppEPL?.color ?? '#6B7280',
            opponentLogoUrl: oppLogo,
            isHome:          true,
            date:            utcDate.toISOString(),
            time:            aestDisplay(aestDate),
            venue:           comp.venue?.fullName ?? '',
            broadcast:       rights.broadcast,
            streaming:       rights.streaming,
            competition:     label === 'Premier League' ? undefined : label,
            opponentId:      oppEPL?.id,
            completed:       isComplete || undefined,
          });
        } else {
          const homeAsEPL = EPL_TEAMS[homeName];
          const homeLogo  = (homeComp?.team?.logo as string | undefined)
                         ?? (homeAsEPL ? TEAM_LOGOS[homeAsEPL.id] : undefined);
          acc.push({
            id:              `soccer-${slug}-${e.id}`,
            teamId:          awayEPL!.id,
            opponent:        homeName,
            opponentAbbr:    homeAsEPL?.abbr  ?? initials(homeName),
            opponentColor:   homeAsEPL?.color ?? '#6B7280',
            opponentLogoUrl: homeLogo,
            isHome:          false,
            date:            utcDate.toISOString(),
            time:            aestDisplay(aestDate),
            venue:           comp.venue?.fullName ?? '',
            broadcast:       rights.broadcast,
            streaming:       rights.streaming,
            competition:     label === 'Premier League' ? undefined : label,
            opponentId:      undefined,
            completed:       isComplete || undefined,
          });
        }
        return acc;
      }, []);
    }),
  );

  const all  = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const seen = new Set<string>();
  const unique = all.filter(g => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });
  return unique.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── Super Rugby Pacific — ESPN ───────────────────────────────────────────────

const SRU_LOG = 'https://a.espncdn.com/i/teamlogos/rugby/teams/500';

const SRU_TEAMS: Record<string, TeamEntry & { logo: string }> = {
  'Brumbies':                { id: 'sru-brumbies',    color: '#003399', abbr: 'BRU', logo: `${SRU_LOG}/25889.png`  },
  'ACT Brumbies':            { id: 'sru-brumbies',    color: '#003399', abbr: 'BRU', logo: `${SRU_LOG}/25889.png`  },
  'Queensland Reds':         { id: 'sru-reds',        color: '#8B0000', abbr: 'RED', logo: `${SRU_LOG}/182.png`    },
  'Reds':                    { id: 'sru-reds',        color: '#8B0000', abbr: 'RED', logo: `${SRU_LOG}/182.png`    },
  'New South Wales Waratahs':{ id: 'sru-waratahs',    color: '#003087', abbr: 'WAR', logo: `${SRU_LOG}/227.png`    },
  'Waratahs':                { id: 'sru-waratahs',    color: '#003087', abbr: 'WAR', logo: `${SRU_LOG}/227.png`    },
  'NSW Waratahs':            { id: 'sru-waratahs',    color: '#003087', abbr: 'WAR', logo: `${SRU_LOG}/227.png`    },
  'Western Force':           { id: 'sru-force',       color: '#003087', abbr: 'FOR', logo: `${SRU_LOG}/25893.png`  },
  'Force':                   { id: 'sru-force',       color: '#003087', abbr: 'FOR', logo: `${SRU_LOG}/25893.png`  },
  'Blues':                   { id: 'sru-blues',       color: '#003087', abbr: 'BLU', logo: `${SRU_LOG}/25932.png`  },
  'Chiefs':                  { id: 'sru-chiefs',      color: '#BA0020', abbr: 'CHI', logo: `${SRU_LOG}/25934.png`  },
  'Crusaders':               { id: 'sru-crusaders',   color: '#CC0000', abbr: 'CRU', logo: `${SRU_LOG}/25936.png`  },
  'Highlanders':             { id: 'sru-highlanders', color: '#003087', abbr: 'HIG', logo: `${SRU_LOG}/25938.png`  },
  'Hurricanes':              { id: 'sru-hurricanes',  color: '#FFD700', abbr: 'HUR', logo: `${SRU_LOG}/25939.png`  },
  'Fijian Drua':             { id: 'sru-drua',        color: '#00A3DE', abbr: 'DRU', logo: `${SRU_LOG}/289338.png` },
  'Drua':                    { id: 'sru-drua',        color: '#00A3DE', abbr: 'DRU', logo: `${SRU_LOG}/289338.png` },
  'Moana Pasifika':          { id: 'sru-moana',       color: '#003087', abbr: 'MOA', logo: `${SRU_LOG}/289319.png` },
};

export async function fetchSRUFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowDate    = new Date();
  const lookbackMs = lookbackDays * 86400_000;
  const start      = lookbackDays > 0 ? new Date(nowDate.getTime() - lookbackMs) : nowDate;
  const end        = new Date(nowDate.getTime() + 90 * 86400_000);
  const fmt        = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby/242041/scoreboard?dates=${fmt(start)}-${fmt(end)}&limit=200`,
    { cache: 'no-store' },
  );
  if (!res.ok) return [];

  const data     = await res.json();
  const nowMs    = nowDate.getTime();
  const cutoff   = nowMs - lookbackMs;
  const seen     = new Set<string>();

  return ((data.events ?? []) as any[])
    .filter(e => {
      const isComplete = e.status?.type?.completed === true;
      if (isComplete) return lookbackDays > 0 && new Date(e.date).getTime() >= cutoff;
      return true;
    })
    .reduce<UpcomingGame[]>((acc, e) => {
      const id = `sru-${e.id}`;
      if (seen.has(id)) return acc;
      seen.add(id);

      const comp:  any   = e.competitions?.[0] ?? {};
      const comps: any[] = comp.competitors ?? [];
      const homeComp = comps.find((c: any) => c.homeAway === 'home');
      const awayComp = comps.find((c: any) => c.homeAway === 'away');
      const homeName = homeComp?.team?.displayName ?? homeComp?.team?.name ?? '';
      const awayName = awayComp?.team?.displayName ?? awayComp?.team?.name ?? '';
      const home = SRU_TEAMS[homeName];
      if (!home) return acc;
      const away = SRU_TEAMS[awayName];

      const utcDate    = new Date(e.date);
      const aestDate   = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const espnLogo   = (awayComp?.team?.logos?.[0]?.href ?? awayComp?.team?.logo) as string | undefined;
      const isComplete = e.status?.type?.completed === true;

      acc.push({
        id,
        teamId:          home.id,
        opponent:        awayName,
        opponentAbbr:    away?.abbr  ?? initials(awayName),
        opponentColor:   away?.color ?? '#6B7280',
        opponentLogoUrl: espnLogo ?? (away ? (TEAM_LOGOS[away.id] ?? away.logo) : undefined),
        isHome:          true,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Stan Sport'],
        streaming:       ['Stan Sport'],
        opponentId:      away?.id,
        completed:       isComplete || undefined,
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── International Rugby — ESPN ───────────────────────────────────────────────

const RINT_LOG = 'https://a.espncdn.com/i/teamlogos/rugby/teams/500';

const RINT_TEAMS: Record<string, TeamEntry & { logo: string }> = {
  'Australia':     { id: 'rint-wallabies', color: '#FFD700', abbr: 'AUS', logo: `${RINT_LOG}/6.png`  },
  'New Zealand':   { id: 'rint-allblacks', color: '#000000', abbr: 'NZL', logo: `${RINT_LOG}/8.png`  },
  'South Africa':  { id: 'rint-boks',      color: '#006847', abbr: 'RSA', logo: `${RINT_LOG}/5.png`  },
  'England':       { id: 'rint-england',   color: '#CC0000', abbr: 'ENG', logo: `${RINT_LOG}/1.png`  },
  'Ireland':       { id: 'rint-ireland',   color: '#009A44', abbr: 'IRE', logo: `${RINT_LOG}/3.png`  },
  'France':        { id: 'rint-france',    color: '#003087', abbr: 'FRA', logo: `${RINT_LOG}/9.png`  },
  'Scotland':      { id: 'rint-scotland',  color: '#003087', abbr: 'SCO', logo: `${RINT_LOG}/2.png`  },
  'Wales':         { id: 'rint-wales',     color: '#CC0000', abbr: 'WAL', logo: `${RINT_LOG}/4.png`  },
  'Argentina':     { id: 'rint-argentina', color: '#74ACDF', abbr: 'ARG', logo: `${RINT_LOG}/10.png` },
  'Fiji':          { id: 'rint-fiji',      color: '#00A3DE', abbr: 'FIJ', logo: `${RINT_LOG}/14.png` },
  'Samoa':         { id: 'rint-samoa',     color: '#003087', abbr: 'SAM', logo: `${RINT_LOG}/15.png` },
  'Tonga':         { id: 'rint-tonga',     color: '#CC0000', abbr: 'TON', logo: `${RINT_LOG}/16.png` },
  'Italy':         { id: 'rint-italy',     color: '#003087', abbr: 'ITA', logo: `${RINT_LOG}/20.png` },
  'Japan':         { id: '',               color: '#CC0000', abbr: 'JPN', logo: `${RINT_LOG}/23.png` },
  'United States': { id: '',               color: '#002868', abbr: 'USA', logo: `${RINT_LOG}/11.png` },
  'Portugal':      { id: '',               color: '#006600', abbr: 'POR', logo: `${RINT_LOG}/27.png` },
  'Georgia':       { id: '',               color: '#CC0000', abbr: 'GEO', logo: `${RINT_LOG}/81.png` },
  'Namibia':       { id: '',               color: '#003087', abbr: 'NAM', logo: `${RINT_LOG}/82.png` },
};

const RINT_COMP_IDS = ['244293', '180659', '289234'] as const;
const RINT_COMP_LABELS: Record<string, string | undefined> = {
  '244293': 'Rugby Championship',
  '180659': 'Six Nations',
  '289234': undefined,
};

export async function fetchRINTFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowDate    = new Date();
  const lookbackMs = lookbackDays * 86400_000;
  const start      = lookbackDays > 0 ? new Date(nowDate.getTime() - lookbackMs) : nowDate;
  const end        = new Date(nowDate.getTime() + 180 * 86400_000);
  const fmt        = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const nowMs      = nowDate.getTime();
  const cutoff     = nowMs - lookbackMs;

  const settled = await Promise.allSettled(
    RINT_COMP_IDS.map(async (compId) => {
      const res = await fetchTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/rugby/${compId}/scoreboard?dates=${fmt(start)}-${fmt(end)}&limit=200`,
        { cache: 'no-store' },
      );
      if (!res.ok) return [] as UpcomingGame[];
      const data  = await res.json();
      const label = RINT_COMP_LABELS[compId];

      return ((data.events ?? []) as any[])
        .filter((e: any) => {
          const isComplete = e.status?.type?.completed === true;
          if (isComplete) return lookbackDays > 0 && new Date(e.date).getTime() >= cutoff;
          return true;
        })
        .reduce<UpcomingGame[]>((acc, e) => {
          const comp:  any   = e.competitions?.[0] ?? {};
          const comps: any[] = comp.competitors ?? [];
          const homeComp = comps.find((c: any) => c.homeAway === 'home');
          const awayComp = comps.find((c: any) => c.homeAway === 'away');
          const homeName = homeComp?.team?.displayName ?? homeComp?.team?.name ?? '';
          const awayName = awayComp?.team?.displayName ?? awayComp?.team?.name ?? '';
          const home = RINT_TEAMS[homeName];
          const away = RINT_TEAMS[awayName];
          if (!home || !home.id) return acc;

          const utcDate    = new Date(e.date);
          const aestDate   = new Date(utcDate.getTime() + 10 * 3600 * 1000);
          const espnLogo   = (awayComp?.team?.logos?.[0]?.href ?? awayComp?.team?.logo) as string | undefined;
          const broadcast  = home.id === 'rint-wallabies'
            ? ['Nine Network', 'Stan Sport']
            : ['Stan Sport'];
          const isComplete = e.status?.type?.completed === true;

          acc.push({
            id:              `rint-${e.id}`,
            teamId:          home.id,
            opponent:        awayName,
            opponentAbbr:    awayComp?.team?.abbreviation ?? away?.abbr ?? initials(awayName),
            opponentColor:   away?.color ?? '#6B7280',
            opponentLogoUrl: espnLogo ?? (away?.id ? (TEAM_LOGOS[away.id] ?? away.logo) : away?.logo),
            isHome:          true,
            date:            utcDate.toISOString(),
            time:            aestDisplay(aestDate),
            venue:           comp.venue?.fullName ?? '',
            broadcast,
            streaming:       ['Stan Sport'],
            competition:     label,
            opponentId:      away?.id || undefined,
            completed:       isComplete || undefined,
          });
          return acc;
        }, []);
    }),
  );

  const all  = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const seen = new Set<string>();
  const unique = all.filter(g => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });
  return unique.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── NBA — ESPN scoreboard ────────────────────────────────────────────────────

const NBA_TEAMS_LF: Record<string, TeamEntry> = {
  'Boston Celtics':         { id: 'nba-celtics',      color: '#007A33', abbr: 'BOS' },
  'Brooklyn Nets':          { id: 'nba-nets',         color: '#000000', abbr: 'BKN' },
  'New York Knicks':        { id: 'nba-knicks',       color: '#006BB6', abbr: 'NYK' },
  'Philadelphia 76ers':     { id: 'nba-76ers',        color: '#006BB6', abbr: 'PHI' },
  'Toronto Raptors':        { id: 'nba-raptors',      color: '#CE1141', abbr: 'TOR' },
  'Chicago Bulls':          { id: 'nba-bulls',        color: '#CE1141', abbr: 'CHI' },
  'Cleveland Cavaliers':    { id: 'nba-cavaliers',    color: '#860038', abbr: 'CLE' },
  'Detroit Pistons':        { id: 'nba-pistons',      color: '#C8102E', abbr: 'DET' },
  'Indiana Pacers':         { id: 'nba-pacers',       color: '#002D62', abbr: 'IND' },
  'Milwaukee Bucks':        { id: 'nba-bucks',        color: '#00471B', abbr: 'MIL' },
  'Atlanta Hawks':          { id: 'nba-hawks',        color: '#E03A3E', abbr: 'ATL' },
  'Charlotte Hornets':      { id: 'nba-hornets',      color: '#1D1160', abbr: 'CHA' },
  'Miami Heat':             { id: 'nba-heat',         color: '#98002E', abbr: 'MIA' },
  'Orlando Magic':          { id: 'nba-magic',        color: '#0077C0', abbr: 'ORL' },
  'Washington Wizards':     { id: 'nba-wizards',      color: '#002B5C', abbr: 'WAS' },
  'Denver Nuggets':         { id: 'nba-nuggets',      color: '#0E2240', abbr: 'DEN' },
  'Minnesota Timberwolves': { id: 'nba-timberwolves', color: '#0C2340', abbr: 'MIN' },
  'Oklahoma City Thunder':  { id: 'nba-thunder',      color: '#007AC1', abbr: 'OKC' },
  'Portland Trail Blazers': { id: 'nba-blazers',      color: '#E03A3E', abbr: 'POR' },
  'Utah Jazz':              { id: 'nba-jazz',         color: '#002B5C', abbr: 'UTA' },
  'Golden State Warriors':  { id: 'nba-warriors',     color: '#1D428A', abbr: 'GSW' },
  'Los Angeles Clippers':   { id: 'nba-clippers',     color: '#C8102E', abbr: 'LAC' },
  'Los Angeles Lakers':     { id: 'nba-lakers',       color: '#552583', abbr: 'LAL' },
  'Phoenix Suns':           { id: 'nba-suns',         color: '#1D1160', abbr: 'PHX' },
  'Sacramento Kings':       { id: 'nba-kings',        color: '#5A2D81', abbr: 'SAC' },
  'Dallas Mavericks':       { id: 'nba-mavericks',    color: '#00538C', abbr: 'DAL' },
  'Houston Rockets':        { id: 'nba-rockets',      color: '#CE1141', abbr: 'HOU' },
  'Memphis Grizzlies':      { id: 'nba-grizzlies',    color: '#5D76A9', abbr: 'MEM' },
  'New Orleans Pelicans':   { id: 'nba-pelicans',     color: '#0C2340', abbr: 'NOP' },
  'San Antonio Spurs':      { id: 'nba-spurs',        color: '#C4CED4', abbr: 'SAS' },
};

export async function fetchNBAFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowDate    = new Date();
  const lookbackMs = lookbackDays * 86400_000;
  const start      = lookbackDays > 0 ? new Date(nowDate.getTime() - lookbackMs) : nowDate;
  const end        = new Date(nowDate.getTime() + 60 * 86400_000);
  const fmt        = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${fmt(start)}-${fmt(end)}&limit=100`,
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`,
  ];

  const nowMs  = nowDate.getTime();
  const cutoff = nowMs - lookbackMs;
  const eventMap = new Map<string, any>();

  await Promise.allSettled(
    urls.map(url =>
      fetchTimeout(url, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          for (const e of (data.events ?? []) as any[]) {
            if (!eventMap.has(e.id)) eventMap.set(e.id, e);
          }
        })
        .catch(() => {}),
    ),
  );

  const seen = new Set<string>();
  return Array.from(eventMap.values())
    .filter((e: any) => {
      const isComplete = e.status?.type?.completed === true;
      if (isComplete) return lookbackDays > 0 && new Date(e.date).getTime() >= cutoff;
      return true;
    })
    .reduce<UpcomingGame[]>((acc, e) => {
      const id = `nba-${e.id}`;
      if (seen.has(id)) return acc;
      seen.add(id);

      const comp:  any   = e.competitions?.[0] ?? {};
      const comps: any[] = comp.competitors ?? [];
      const homeComp = comps.find((c: any) => c.homeAway === 'home');
      const awayComp = comps.find((c: any) => c.homeAway === 'away');
      const homeName = homeComp?.team?.displayName ?? '';
      const awayName = awayComp?.team?.displayName ?? '';
      const home = NBA_TEAMS_LF[homeName];
      if (!home) return acc;
      const away       = NBA_TEAMS_LF[awayName];
      const isComplete = e.status?.type?.completed === true;

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);

      acc.push({
        id,
        teamId:          home.id,
        opponent:        awayName,
        opponentAbbr:    away?.abbr  ?? initials(awayName),
        opponentColor:   away?.color ?? '#6B7280',
        opponentLogoUrl: (awayComp?.team?.logo as string | undefined)
          ?? (away ? TEAM_LOGOS[away.id] : undefined),
        isHome:          true,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['ESPN', 'ABC'],
        streaming:       ['NBA League Pass', 'Kayo Sports'],
        competition:     (comp.notes?.[0]?.headline as string | undefined),
        seriesSummary:   (comp.series as any)?.summary as string | undefined,
        opponentId:      away?.id,
        completed:       isComplete || undefined,
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── F1 — Jolpi Ergast race calendar ─────────────────────────────────────────

interface F1SessionDef {
  key: string;
  label: string;
  abbr: string;
  dateField?: string;
}

const F1_SESSIONS: F1SessionDef[] = [
  { key: 'fp1',        label: 'Practice 1',        abbr: 'FP1',  dateField: 'FirstPractice'    },
  { key: 'fp2',        label: 'Practice 2',        abbr: 'FP2',  dateField: 'SecondPractice'   },
  { key: 'fp3',        label: 'Practice 3',        abbr: 'FP3',  dateField: 'ThirdPractice'    },
  { key: 'sprintq',    label: 'Sprint Qualifying',  abbr: 'SQ',   dateField: 'SprintQualifying' },
  { key: 'sprint',     label: 'Sprint',             abbr: 'SPR',  dateField: 'Sprint'           },
  { key: 'qualifying', label: 'Qualifying',         abbr: 'QUAL', dateField: 'Qualifying'       },
  { key: 'race',       label: 'Race',               abbr: 'RACE'                                },
];

export async function fetchF1Fixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const tryUrls = [
    'https://api.jolpi.ca/ergast/f1/current.json',
    'https://api.jolpi.ca/ergast/f1/2025.json',
  ];

  let races: any[] = [];
  for (const url of tryUrls) {
    try {
      const res = await fetchTimeout(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();
      races = data?.MRData?.RaceTable?.Races ?? [];
      if (races.length > 0) break;
    } catch { /* try next */ }
  }
  if (races.length === 0) return [];

  const now        = Date.now();
  const lookbackMs = lookbackDays * 86400_000;
  // With lookback: include sessions from lookbackDays ago. Without: same 2h trailing buffer.
  const cutoff     = lookbackDays > 0 ? now - lookbackMs : now - 2 * 3600_000;
  const fixtures: UpcomingGame[] = [];

  for (const race of races) {
    const raceName  = race.raceName as string;
    const country   = (race.Circuit?.Location?.country as string) ?? '';
    const abbr      = COUNTRY_TO_ABBR[country] ?? country.slice(0, 3).toUpperCase();
    const circuitId = race.Circuit?.circuitId ?? '';

    for (const session of F1_SESSIONS) {
      let sessionDate: Date;
      if (session.dateField) {
        const sessionData = race[session.dateField];
        if (!sessionData?.date) continue;
        const sessionTime = sessionData.time ?? '12:00:00Z';
        sessionDate = new Date(`${sessionData.date}T${sessionTime}`);
      } else {
        const raceTime = race.time ?? '14:00:00Z';
        sessionDate = new Date(`${race.date}T${raceTime}`);
      }

      if (isNaN(sessionDate.getTime())) continue;
      const sessionMs  = sessionDate.getTime();
      if (sessionMs <= cutoff) continue; // too old even for lookback window

      const isCompleted = sessionMs < now;

      fixtures.push({
        id:              `f1-${race.round}-${session.key}`,
        teamId:          'f1-championship',
        opponent:        raceName,
        opponentAbbr:    abbr,
        opponentColor:   '#E8002D',
        opponentLogoUrl: undefined,
        isHome:          false,
        date:            sessionDate.toISOString(),
        time:            aestDisplay(sessionDate),
        venue:           race.Circuit?.circuitName ?? '',
        broadcast:       ['Fox Sports', 'Kayo Sports'],
        streaming:       ['Kayo Sports'],
        competition:     session.label,
        opponentId:      circuitId,
        completed:       isCompleted || undefined,
      });
    }
  }

  return fixtures.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── BBL — ESPN ───────────────────────────────────────────────────────────────

const BBL_LEAGUE_TEAMS: Record<string, TeamEntry> = {
  'Perth Scorchers':     { id: 'bbl-scorchers',  color: '#ef660b', abbr: 'PS'  },
  'Sydney Sixers':       { id: 'bbl-sixers',     color: '#d917a5', abbr: 'SS'  },
  'Hobart Hurricanes':   { id: 'bbl-hurricanes', color: '#5b0db7', abbr: 'HH'  },
  'Brisbane Heat':       { id: 'bbl-heat',       color: '#c8102e', abbr: 'BH'  },
  'Adelaide Strikers':   { id: 'bbl-strikers',   color: '#005aab', abbr: 'AS'  },
  'Melbourne Stars':     { id: 'bbl-stars',      color: '#00b140', abbr: 'MS'  },
  'Melbourne Renegades': { id: 'bbl-renegades',  color: '#c8102e', abbr: 'MR'  },
  'Sydney Thunder':      { id: 'bbl-thunder',    color: '#8dc63f', abbr: 'ST'  },
};

// ─── Shared cricket fixtures (cricketdata.org) ────────────────────────────────
// ESPN/cricinfo cricket endpoints are WAF-blocked server-side, so cricket fixtures
// come from cricketdata.org via the cached client. Quota is daily (100 hits), so
// currentMatches is fetched once per process and shared by BBL + internationals;
// series_info is only pulled for series that already contain a tracked-team match,
// and capped, so a heartbeat across both cricket leagues costs ~1 hit when nothing
// tracked is live. Emits ONE fixture per match (teamId = first tracked side), as
// the ESPN path did — avoids duplicate game ids.

async function buildCricketFixtures(
  prefix: 'cint' | 'bbl',
  teamMap: Record<string, TeamEntry & { abbr: string }>,
  broadcast: string[],
  streaming: string[],
  lookbackDays: number,
): Promise<UpcomingGame[]> {
  if (!cricketConfigured()) return [];

  const now          = Date.now();
  const cutoff       = now - lookbackDays * 86400_000;
  const lookaheadEnd = now + 30 * 86400_000;

  const norm    = (s: string) => s.toLowerCase().trim();
  const byNorm: Record<string, TeamEntry & { abbr: string }> = {};
  for (const [k, v] of Object.entries(teamMap)) byNorm[norm(k)] = v;
  const lookup = (name: string) => byNorm[norm(name)];

  // Discovery: one shared currentMatches fetch (cached), then expand any series
  // that already shows a tracked-team match — bounded to protect the daily quota.
  const current = await cricCurrentMatches();
  const candidates = new Map<string, CricMatch>();
  for (const m of current) if (m.id) candidates.set(m.id, m);

  const trackedSeries = new Set<string>();
  for (const m of current) {
    if (m.series_id && (m.teams ?? []).some(t => lookup(t))) trackedSeries.add(m.series_id);
  }
  let budget = 6;
  for (const sid of trackedSeries) {
    if (budget-- <= 0) break;
    const s = await cricSeriesInfo(sid);
    for (const m of (s?.matchList ?? [])) {
      if (m.id && !candidates.has(m.id)) candidates.set(m.id, m);
    }
  }

  const out: UpcomingGame[] = [];
  for (const m of candidates.values()) {
    const teams = m.teams ?? [];
    if (teams.length < 2) continue;

    // teamId = first tracked side; skip matches with no tracked team.
    const homeIdx = teams.findIndex(t => lookup(t));
    if (homeIdx < 0) continue;
    const me      = lookup(teams[homeIdx])!;
    const oppName = teams[1 - homeIdx] ?? '';
    const opp     = lookup(oppName);

    const ended  = !!m.matchEnded;
    const dateMs = new Date(m.dateTimeGMT ?? m.date ?? 0).getTime();
    if (ended) {
      if (!(lookbackDays > 0 && dateMs >= cutoff)) continue;
    } else if (dateMs && dateMs > lookaheadEnd) {
      continue; // too far out — decideForTeam only looks ~14 days ahead anyway
    }

    const fmtRaw = (m.matchType ?? '').toLowerCase();
    const fmt: 'test' | 'odi' | 't20' = fmtRaw === 'test' ? 'test' : fmtRaw === 'odi' ? 'odi' : 't20';
    const utc = new Date(m.dateTimeGMT ?? m.date ?? now);

    out.push({
      id:              `${prefix}-${m.id}`,
      teamId:          me.id,
      opponent:        oppName,
      opponentAbbr:    opp?.abbr ?? initials(oppName),
      opponentColor:   opp?.color ?? '#6B7280',
      opponentLogoUrl: TEAM_LOGOS[opp?.id ?? ''],
      isHome:          false, // cricketdata gives no reliable host flag — treat as neutral
      date:            utc.toISOString(),
      time:            aestDisplay(new Date(utc.getTime() + 10 * 3600 * 1000)),
      venue:           m.venue ?? '',
      broadcast,
      streaming,
      opponentId:      opp?.id,
      cricketFormat:   fmt,
      matchDays:       fmt === 'test' ? 5 : undefined,
      completed:       ended || undefined,
    });
  }

  return out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function fetchBBLFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  return buildCricketFixtures(
    'bbl', BBL_LEAGUE_TEAMS, ['Fox Cricket', 'Channel 7'], ['Kayo Sports', '7plus'], lookbackDays,
  );
}


// ─── International Cricket ─────────────────────────────────────────────────────

const CRICKET_INT_LEAGUE_TEAMS: Record<string, TeamEntry & { abbr: string }> = {
  'Australia':    { id: 'int-aus', color: '#f5c518', abbr: 'AUS' },
  'England':      { id: 'int-eng', color: '#003082', abbr: 'ENG' },
  'India':        { id: 'int-ind', color: '#003082', abbr: 'IND' },
  'Pakistan':     { id: 'int-pak', color: '#01411c', abbr: 'PAK' },
  'New Zealand':  { id: 'int-nz',  color: '#000000', abbr: 'NZ'  },
  'South Africa': { id: 'int-sa',  color: '#007a4d', abbr: 'SA'  },
  'Sri Lanka':    { id: 'int-sl',  color: '#003478', abbr: 'SL'  },
  'West Indies':  { id: 'int-wi',  color: '#7b0041', abbr: 'WI'  },
  'Bangladesh':   { id: 'int-ban', color: '#006a4e', abbr: 'BAN' },
  'Zimbabwe':     { id: 'int-zim', color: '#007a3d', abbr: 'ZIM' },
  'Ireland':      { id: 'int-ire', color: '#169b62', abbr: 'IRE' },
  'Afghanistan':  { id: 'int-afg', color: '#000000', abbr: 'AFG' },
};


export async function fetchCricketIntFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  return buildCricketFixtures(
    'cint', CRICKET_INT_LEAGUE_TEAMS, ['Fox Cricket'], ['Kayo Sports'], lookbackDays,
  );
}

/**
 * Resolve a single cricket fixture by game id (`cint-<matchId>` / `bbl-<matchId>`)
 * directly from cricketdata match_info — works even for matches not surfaced by the
 * dormant fixture lists. Returns the fixture AND the team display name (teams[0]),
 * since untracked sides (e.g. women's WC) have no TEAMS entry to derive a name from.
 * Used by the dev sandbox route + faithfulness verifier so cricket can be proven
 * sandbox==prod. Returns null for non-cricket ids or when unavailable.
 */
export async function fetchCricketFixtureById(
  gameId: string,
): Promise<{ fixture: UpcomingGame; teamName: string } | null> {
  const prefix = gameId.startsWith('bbl-') ? 'bbl' : gameId.startsWith('cint-') ? 'cint' : null;
  if (!prefix || !cricketConfigured()) return null;

  const m = await cricMatchInfo(gameId.replace(/^(cint|bbl)-/, ''));
  const teams = m?.teams ?? [];
  if (!m || teams.length < 2) return null;

  const map = prefix === 'bbl' ? BBL_LEAGUE_TEAMS : CRICKET_INT_LEAGUE_TEAMS;
  const norm = (s: string) => s.toLowerCase().trim();
  const byNorm: Record<string, TeamEntry & { abbr: string }> = {};
  for (const [k, v] of Object.entries(map)) byNorm[norm(k)] = v;

  const teamName = teams[0];
  const oppName  = teams[1];
  const me  = byNorm[norm(teamName)];
  const opp = byNorm[norm(oppName)];

  const fmtRaw = (m.matchType ?? '').toLowerCase();
  const fmt: 'test' | 'odi' | 't20' = fmtRaw === 'test' ? 'test' : fmtRaw === 'odi' ? 'odi' : 't20';
  const utc = new Date(m.dateTimeGMT ?? m.date ?? Date.now());

  const fixture: UpcomingGame = {
    id:              gameId,
    teamId:          me?.id ?? `${prefix}-${norm(teamName).replace(/\s+/g, '-')}`,
    opponent:        oppName,
    opponentAbbr:    opp?.abbr ?? initials(oppName),
    opponentColor:   opp?.color ?? '#6B7280',
    opponentLogoUrl: TEAM_LOGOS[opp?.id ?? ''],
    isHome:          false,
    date:            utc.toISOString(),
    time:            aestDisplay(new Date(utc.getTime() + 10 * 3600 * 1000)),
    venue:           m.venue ?? '',
    broadcast:       prefix === 'bbl' ? ['Fox Cricket', 'Channel 7'] : ['Fox Cricket'],
    streaming:       prefix === 'bbl' ? ['Kayo Sports', '7plus'] : ['Kayo Sports'],
    opponentId:      opp?.id,
    cricketFormat:   fmt,
    matchDays:       fmt === 'test' ? 5 : undefined,
    completed:       m.matchEnded || undefined,
  };
  return { fixture, teamName };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Single entry point used by the standalone generator script.
 * When lookbackDays > 0, completed fixtures within that window are included
 * with `completed: true` so the generator can determine each team's prior fixture.
 */
export async function fetchLeagueFixtures(league: string, lookbackDays = 0): Promise<UpcomingGame[]> {
  if      (league === 'afl')         return fetchAFLFixtures(lookbackDays);
  else if (league === 'nrl')         return fetchNRLFixtures(lookbackDays);
  else if (league === 'epl')         return fetchEPLFixtures(lookbackDays);
  else if (league === 'super_rugby') return fetchSRUFixtures(lookbackDays);
  else if (league === 'rugby_int')   return fetchRINTFixtures(lookbackDays);
  else if (league === 'f1')          return fetchF1Fixtures(lookbackDays);
  else if (league === 'bbl')         return fetchBBLFixtures(lookbackDays);
  else if (league === 'cricket_int') return fetchCricketIntFixtures(lookbackDays);
  else if (league === 'nba')         return fetchNBAFixtures(lookbackDays);
  return [];
}
