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
import { WC_ESPN_NAME_TO_ID, WC_TEAM_GROUPS, espnRoundToStage, espnRoundToGroup } from '@/lib/world-cup';

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

  return ((data.events ?? []) as any[])
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
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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

export async function fetchBBLFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowDate    = new Date();
  const lookbackMs = lookbackDays * 86400_000;
  const start      = lookbackDays > 0 ? new Date(nowDate.getTime() - lookbackMs) : nowDate;
  const end        = new Date(nowDate.getTime() + 150 * 86400_000);
  const fmt        = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/cricket/8044/scoreboard?dates=${fmt(start)}-${fmt(end)}&limit=200`,
    { cache: 'no-store' },
  );
  if (!res.ok) return [];

  const data     = await res.json();
  const nowMs    = nowDate.getTime();
  const cutoff   = nowMs - lookbackMs;
  const seen     = new Set<string>();

  return ((data.events ?? []) as any[])
    .filter((e: any) => {
      const state      = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state;
      const isComplete = state === 'post';
      if (isComplete) return lookbackDays > 0 && new Date(e.date).getTime() >= cutoff;
      return true;
    })
    .reduce<UpcomingGame[]>((acc, e: any) => {
      const id = `bbl-${e.id}`;
      if (seen.has(id)) return acc;
      seen.add(id);

      const comp:  any   = e.competitions?.[0] ?? {};
      const comps: any[] = comp.competitors ?? [];
      const homeComp = comps.find((c: any) => c.homeAway === 'home');
      const awayComp = comps.find((c: any) => c.homeAway === 'away');
      const homeName = homeComp?.team?.displayName ?? '';
      const awayName = awayComp?.team?.displayName ?? '';

      const home = BBL_LEAGUE_TEAMS[homeName];
      if (!home) return acc;
      const away = BBL_LEAGUE_TEAMS[awayName];

      const utcDate    = new Date(e.date);
      const aestDate   = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const fmt2       = parseCricketFormat(comp.class?.eventType ?? comp.class?.name ?? '');
      const state      = comp.status?.type?.state ?? e.status?.type?.state;
      const isComplete = state === 'post';

      acc.push({
        id,
        teamId:          home.id,
        opponent:        awayName,
        opponentAbbr:    away?.abbr  ?? initials(awayName),
        opponentColor:   away?.color ?? '#6B7280',
        opponentLogoUrl: TEAM_LOGOS[away?.id ?? ''] ?? (awayComp?.team?.logo as string | undefined),
        isHome:          true,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Fox Cricket', 'Channel 7'],
        streaming:       ['Kayo Sports', '7plus'],
        opponentId:      away?.id,
        cricketFormat:   fmt2,
        completed:       isComplete || undefined,
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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

const CRICKET_INT_GENERIC_SERIES = [8037];

// Each team's series IDs, organised by format where separate ESPN series exist
// per format. IDs verified against ESPN cricket scoreboard API June 2026.
// Event-level deduplication in fetchCricketIntFixtures handles any series that
// share events (e.g. tour-wrapper + format-specific IDs).
const CRICKET_INT_TEAM_SERIES: Partial<Record<string, number[]>> = {
  'int-aus': [
    24323,    // Australia in Bangladesh ODI Series 2026 (Jun 11)
    24322,    // Australia in Bangladesh T20I Series 2026 (Jun 17)
    24230,    // Bangladesh in Australia Test Series 2026 (Aug 13)
    24302,    // Australia in Zimbabwe ODI Series 2026 (Sep 15)
    24202,    // Australia in South Africa ODI Series 2026/27 (Sep 24)
    24201,    // Australia in South Africa Test Series 2026/27 (Oct 9)
    24272,    // England in Australia ODI Series 2026/27 (Nov 13)
    24271,    // England in Australia T20I Series 2026/27 (Nov 21)
    24269,    // Trans-Tasman Trophy 2026/27 — NZ in Australia (Dec 9)
    24280,    // Border-Gavaskar Trophy 2026/27 — Australia in India (Jan 21)
  ],
  'int-ban': [
    24323,    // Australia in Bangladesh ODI Series 2026 (Jun 11)
    24322,    // Australia in Bangladesh T20I Series 2026 (Jun 17)
    24419,    // Bangladesh in Zimbabwe Test Match 2026 (Jun 28)
    24418,    // Bangladesh in Zimbabwe ODI Series 2026 (Jul 6)
    24417,    // Bangladesh in Zimbabwe T20I Series 2026 (Jul 15)
    24230,    // Bangladesh in Australia Test Series 2026 (Aug 13)
    24200,    // Bangladesh in South Africa Test Series 2026/27 (Nov 15)
  ],
  'int-ind': [
    24226,    // Afghanistan in India Test Match 2026 (Jun 6)
    24225,    // Afghanistan in India ODI Series 2026 (Jun 13)
    24257,    // India in Ireland T20I Series 2026 (Jun 26)
    24300,    // India in Zimbabwe T20I Series 2026 (Jul 23)
    24288,    // West Indies in India ODI Series 2026/27 (Sep 27)
    24287,    // West Indies in India T20I Series 2026/27 (Oct 6)
    24468,    // India in New Zealand T20I Series 2026/27 (Oct 22)
    24467,    // India in New Zealand ODI Series 2026/27 (Nov 4)
    24466,    // India in New Zealand Test Series 2026/27 (Nov 18)
    24285,    // Sri Lanka in India ODI Series 2026/27 (Dec 13)
    24284,    // Sri Lanka in India T20I Series 2026/27 (Dec 22)
    24282,    // Zimbabwe in India ODI Series 2026/27 (Jan 3)
    24280,    // Border-Gavaskar Trophy 2026/27 — Australia in India (Jan 21)
  ],
  'int-pak': [
    24378,    // Australia in Pakistan ODI Series 2026 (Jun 4)
    24435,    // Pakistan in West Indies Test Series 2026 (Jul 25)
  ],
  'int-nz': [
    24437,    // New Zealand in West Indies ODI Series 2026 (Jul 11)
    24468,    // India in New Zealand T20I Series 2026/27 (Oct 22)
    24467,    // India in New Zealand ODI Series 2026/27 (Nov 4)
    24466,    // India in New Zealand Test Series 2026/27 (Nov 18)
    24269,    // Trans-Tasman Trophy 2026/27 — NZ in Australia (Dec 9)
    24461,    // Sri Lanka in New Zealand ODI Series 2026/27 (Jan 15)
    24460,    // Sri Lanka in New Zealand T20I Series 2026/27 (Jan 26)
    24459,    // Sri Lanka in New Zealand Test Series 2026/27 (Feb 3)
  ],
  'int-sl': [
    24422,    // Sri Lanka in West Indies ODI Series 2026 (Jun 8)
    24421,    // Sri Lanka in West Indies T20I Series 2026 (Jun 12)
    24285,    // Sri Lanka in India ODI Series 2026/27 (Dec 13)
    24284,    // Sri Lanka in India T20I Series 2026/27 (Dec 22)
    24461,    // Sri Lanka in New Zealand ODI Series 2026/27 (Jan 15)
    24460,    // Sri Lanka in New Zealand T20I Series 2026/27 (Jan 26)
    24459,    // Sri Lanka in New Zealand Test Series 2026/27 (Feb 3)
  ],
  'int-wi': [
    24422,    // Sri Lanka in West Indies ODI Series 2026 (Jun 8)
    24421,    // Sri Lanka in West Indies T20I Series 2026 (Jun 12)
    24437,    // New Zealand in West Indies ODI Series 2026 (Jul 11)
    24435,    // Pakistan in West Indies Test Series 2026 (Jul 25)
    24288,    // West Indies in India ODI Series 2026/27 (Sep 27)
    24287,    // West Indies in India T20I Series 2026/27 (Oct 6)
  ],
  'int-zim': [
    24419,    // Bangladesh in Zimbabwe Test Match 2026 (Jun 28)
    24418,    // Bangladesh in Zimbabwe ODI Series 2026 (Jul 6)
    24417,    // Bangladesh in Zimbabwe T20I Series 2026 (Jul 15)
    24300,    // India in Zimbabwe T20I Series 2026 (Jul 23)
    24302,    // Australia in Zimbabwe ODI Series 2026 (Sep 15)
    24282,    // Zimbabwe in India ODI Series 2026/27 (Jan 3)
  ],
  'int-sa': [
    24202,    // Australia in South Africa ODI Series 2026/27 (Sep 24)
    24201,    // Australia in South Africa Test Series 2026/27 (Oct 9)
    24200,    // Bangladesh in South Africa Test Series 2026/27 (Nov 15)
  ],
  'int-eng': [
    24272,    // England in Australia ODI Series 2026/27 (Nov 13)
    24271,    // England in Australia T20I Series 2026/27 (Nov 21)
    24264,    // 150th Anniversary Test Match 2026/27 — AUS vs ENG (Mar 2027)
  ],
  'int-ire': [
    24257,    // India in Ireland T20I Series 2026 (Jun 26)
    24262,    // Afghanistan in Ireland ODI Series 2026 (Aug 5)
  ],
  'int-afg': [
    24226,    // Afghanistan in India Test Match 2026 (Jun 6)
    24225,    // Afghanistan in India ODI Series 2026 (Jun 13)
    24262,    // Afghanistan in Ireland ODI Series 2026 (Aug 5)
  ],
};

const CRICKET_INT_LEAGUE_SERIES: number[] = Array.from(
  new Set([
    ...CRICKET_INT_GENERIC_SERIES,
    ...(Object.values(CRICKET_INT_TEAM_SERIES).flat().filter((n): n is number => n !== undefined)),
  ]),
);

export async function fetchCricketIntFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowMs    = Date.now();
  const cutoff   = nowMs - lookbackDays * 86400_000;

  const settled = await Promise.allSettled(
    CRICKET_INT_LEAGUE_SERIES.map(async (seriesId) => {
      const res = await fetchTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/scoreboard`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [] as any[];
      const data = await res.json();
      return (data.events ?? []) as any[];
    }),
  );

  const allEvents: any[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') allEvents.push(...r.value);
  }

  const seen = new Set<string>();
  return allEvents
    .filter((e: any) => {
      const id    = String(e.id ?? '');
      if (seen.has(id)) return false;
      seen.add(id);
      const state      = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state ?? '';
      const isComplete = state === 'post';
      if (isComplete) return lookbackDays > 0 && new Date(e.date).getTime() >= cutoff;
      return true;
    })
    .map((e: any): UpcomingGame | null => {
      const comp:  any   = e.competitions?.[0] ?? {};
      const comps: any[] = comp.competitors ?? [];
      const homeComp = comps.find((c: any) => c.homeAway === 'home') ?? comps[0];
      const awayComp = comps.find((c: any) => c.homeAway === 'away') ?? comps[1];
      if (!homeComp || !awayComp) return null;

      const homeName = homeComp.team?.displayName ?? '';
      const awayName = awayComp.team?.displayName ?? '';
      const home = CRICKET_INT_LEAGUE_TEAMS[homeName];
      if (!home) return null;
      const away = CRICKET_INT_LEAGUE_TEAMS[awayName];

      const state      = comp.status?.type?.state ?? e.status?.type?.state ?? '';
      const isComplete = state === 'post';
      const utcDate    = new Date(e.date);
      const aestDate   = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const fmt        = parseCricketFormat(comp.class?.eventType ?? comp.class?.name ?? '');
      const seriesName = e.name ?? comp.description ?? '';

      return {
        id:              `cint-${e.id}`,
        teamId:          home.id,
        opponent:        awayName,
        opponentAbbr:    away?.abbr ?? awayName.slice(0, 3).toUpperCase(),
        opponentColor:   away?.color ?? '#888888',
        opponentLogoUrl: TEAM_LOGOS[away?.id ?? ''],
        isHome:          true,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Fox Cricket'],
        streaming:       ['Kayo Sports'],
        opponentId:      away?.id,
        cricketFormat:   fmt,
        matchDays:       fmt === 'test' ? 5 : undefined,
        competition:     seriesName || undefined,
        completed:       isComplete || undefined,
      };
    })
    .filter((g): g is UpcomingGame => g !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── World Cup ────────────────────────────────────────────────────────────────

const WC_BROADCAST = { broadcast: ['SBS'], streaming: ['Paramount+'] };

export async function fetchWorldCupFixtures(lookbackDays = 0): Promise<UpcomingGame[]> {
  const nowMs      = Date.now();
  const lookbackMs = lookbackDays * 86400_000;
  const cutoff     = nowMs - lookbackMs;

  const nowDate = new Date(nowMs);
  const end     = new Date(nowMs + 35 * 86400_000);
  const start   = lookbackDays > 0 ? new Date(nowMs - lookbackMs) : nowDate;
  const fmt     = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${fmt(start)}-${fmt(end)}&limit=200`,
    { cache: 'no-store' },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const seen = new Set<string>();

  return ((data.events ?? []) as any[])
    .filter((e: any) => {
      const isComplete = e.status?.type?.completed === true;
      if (isComplete) return lookbackDays > 0 && new Date(e.date).getTime() >= cutoff;
      return true;
    })
    .reduce<UpcomingGame[]>((acc, e: any) => {
      if (seen.has(e.id)) return acc;
      seen.add(e.id);

      const comp: any        = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const homeComp = competitors.find((c: any) => c.homeAway === 'home') ?? competitors[0];
      const awayComp = competitors.find((c: any) => c.homeAway === 'away') ?? competitors[1];
      if (!homeComp) return acc;

      const homeName: string = homeComp.team?.displayName ?? '';
      const awayName: string = awayComp?.team?.displayName ?? '';
      const homeId = WC_ESPN_NAME_TO_ID[homeName];
      if (!homeId) return acc;

      const roundHints = [e.name ?? '', comp.notes?.[0]?.headline ?? '', comp.type?.text ?? ''].join(' ');
      const stage      = espnRoundToStage(roundHints);
      const group      = espnRoundToGroup(roundHints);
      const isComplete = e.status?.type?.completed === true;

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);

      acc.push({
        id:              `wc-${e.id}`,
        teamId:          homeId,
        opponent:        awayName || 'TBD',
        opponentAbbr:    awayComp?.team?.abbreviation ?? (awayName ? awayName.slice(0, 3).toUpperCase() : 'TBD'),
        opponentColor:   '#6B7280',
        isHome:          true,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       WC_BROADCAST.broadcast,
        streaming:       WC_BROADCAST.streaming,
        opponentLogoUrl: awayName === 'Australia'
          ? TEAM_LOGOS['wc-australia']
          : (awayComp?.team?.logo as string | undefined),
        opponentId:      WC_ESPN_NAME_TO_ID[awayName],
        worldCupStage:   stage,
        worldCupGroup:   WC_TEAM_GROUPS[homeId] ?? group,
        completed:       isComplete || undefined,
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
  else if (league === 'world_cup')   return fetchWorldCupFixtures(lookbackDays);
  else if (league === 'nba')         return fetchNBAFixtures(lookbackDays);
  return [];
}
