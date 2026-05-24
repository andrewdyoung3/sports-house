/**
 * GET /api/league-fixtures?league=afl
 *
 * Returns ALL upcoming fixtures for a given league — one entry per game.
 * Each game is rendered from the home team's perspective, except for EPL
 * European fixtures where we pick the EPL club as the perspective (even if away).
 *
 * Returns UpcomingGame[] compatible with the existing schedule display layer.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { UpcomingGame } from '@/types';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { TEAMS } from '@/lib/teams';
// mock-data intentionally NOT imported — this route only returns real API fixtures.
import { COUNTRY_TO_ABBR } from '@/lib/f1-data';

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function fetchTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = options;
  const ac    = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function aestDisplay(d: Date): string {
  const h   = d.getUTCHours();
  const m   = d.getUTCMinutes().toString().padStart(2, '0');
  const ap  = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ap} AEST`;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length >= 2 ? words.map(w => w[0]).join('') : name)
    .slice(0, 3).toUpperCase();
}

// Minimal team entry — logo resolved from TEAM_LOGOS or ESPN on the fly
interface TeamEntry { id: string; color: string; abbr: string }

// ─── AFL — Squiggle ───────────────────────────────────────────────────────────

const AFL_CDN = 'https://a.espncdn.com/i/teamlogos/afl/500';

const AFL_TEAMS: Record<string, TeamEntry & { logo: string }> = {
  'Adelaide':         { id: 'afl-crows',     color: '#013A6E', abbr: 'ADL', logo: `${AFL_CDN}/adel.png` },
  'Brisbane Lions':   { id: 'afl-lions',     color: '#A30046', abbr: 'BRI', logo: `${AFL_CDN}/bl.png`   },
  'Carlton':          { id: 'afl-blues',     color: '#0E1E2E', abbr: 'CAR', logo: `${AFL_CDN}/carl.png` },
  'Collingwood':      { id: 'afl-pies',      color: '#000000', abbr: 'COL', logo: `${AFL_CDN}/coll.png` },
  'Essendon':         { id: 'afl-bombers',   color: '#CC2031', abbr: 'ESS', logo: `${AFL_CDN}/ess.png`  },
  'Fremantle':        { id: 'afl-dockers',   color: '#2A1A5E', abbr: 'FRE', logo: `${AFL_CDN}/fre.png`  },
  'Geelong':          { id: 'afl-cats',      color: '#001F5B', abbr: 'GEE', logo: `${AFL_CDN}/geel.png` },
  'Gold Coast':       { id: 'afl-suns',      color: '#E8312D', abbr: 'GCS', logo: `${AFL_CDN}/suns.png` },
  'GWS Giants':       { id: 'afl-giants',    color: '#F47B20', abbr: 'GWS', logo: `${AFL_CDN}/gws.png`  },
  'Hawthorn':         { id: 'afl-hawks',     color: '#4D2004', abbr: 'HAW', logo: `${AFL_CDN}/haw.png`  },
  'Melbourne':        { id: 'afl-demons',    color: '#CC2031', abbr: 'MEL', logo: `${AFL_CDN}/melb.png` },
  'North Melbourne':  { id: 'afl-kangaroos', color: '#003088', abbr: 'NME', logo: `${AFL_CDN}/nmfc.png` },
  'Port Adelaide':    { id: 'afl-power',     color: '#000000', abbr: 'PAD', logo: `${AFL_CDN}/port.png` },
  'Richmond':         { id: 'afl-tigers',    color: '#FFD200', abbr: 'RIC', logo: `${AFL_CDN}/rich.png` },
  'St Kilda':         { id: 'afl-saints',    color: '#ED0F05', abbr: 'STK', logo: `${AFL_CDN}/stk.png`  },
  'Sydney':           { id: 'afl-swans',     color: '#ED171F', abbr: 'SYD', logo: `${AFL_CDN}/syd.png`  },
  'West Coast':       { id: 'afl-eagles',    color: '#003087', abbr: 'WCE', logo: `${AFL_CDN}/wce.png`  },
  'Western Bulldogs': { id: 'afl-dogs',      color: '#014896', abbr: 'WBD', logo: `${AFL_CDN}/wb.png`   },
};

async function fetchAFLLeague(): Promise<UpcomingGame[]> {
  const year = new Date().getFullYear();
  const res  = await fetchTimeout(
    `https://api.squiggle.com.au/?q=games;year=${year}`,
    { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const { games = [] } = await res.json();
  const now  = Date.now();
  const seen = new Set<string>();

  return (games as any[])
    .filter(g => g.complete < 100 && g.unixtime * 1000 > now)
    .reduce<UpcomingGame[]>((acc, g) => {
      const id = `afl-${g.id}`;
      if (seen.has(id)) return acc;
      seen.add(id);

      const home = AFL_TEAMS[g.hteam];
      const away = AFL_TEAMS[g.ateam];
      if (!home) return acc;

      const tz   = (g.tz as string) ?? '+10:00';
      const d    = new Date(g.date.replace(' ', 'T') + tz);
      const time = g.timestr ? `${g.timestr} AEST` : aestDisplay(d);

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

async function fetchNRLLeague(): Promise<UpcomingGame[]> {
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const seen = new Set<string>();

  return ((data.events ?? []) as any[])
    .filter(e => e.status?.type?.completed !== true)
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
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── EPL — ESPN (multiple competitions) ──────────────────────────────────────
//
// For each event we pick the EPL club as the perspective team.
// Home EPL club → isHome:true. Away EPL club → isHome:false.
// Games where NEITHER team is an EPL club (e.g. UCL tie between Bundesliga sides)
// are silently dropped.

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

async function fetchEPLLeague(): Promise<UpcomingGame[]> {
  const now   = new Date();
  const end   = new Date(now.getTime() + 150 * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  const now2 = Date.now();
  const twoHoursAgo = now2 - 2 * 3600 * 1000;

  const settled = await Promise.allSettled(
    EPL_COMPS.map(async ({ slug, label }) => {
      // For UEFA knockout rounds the dated scoreboard often returns nothing;
      // also try the undated endpoint (returns current/next round) and merge.
      const isUEFA = slug.startsWith('uefa.');
      const eventMap = new Map<string, any>();

      const urls: string[] = [
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}&limit=200`,
      ];
      if (isUEFA) {
        urls.push(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?limit=50`);
      }

      for (const url of urls) {
        try {
          const res = await fetchTimeout(url, { next: { revalidate: 3600 } });
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
        if (e.status?.type?.completed === true) return acc;
        if (new Date(e.date).getTime() < twoHoursAgo) return acc;
        const comp:  any   = e.competitions?.[0] ?? {};
        const comps: any[] = comp.competitors ?? [];
        const homeComp = comps.find((c: any) => c.homeAway === 'home');
        const awayComp = comps.find((c: any) => c.homeAway === 'away');
        const homeName = homeComp?.team?.displayName ?? '';
        const awayName = awayComp?.team?.displayName ?? '';
        const homeEPL  = EPL_TEAMS[homeName];
        const awayEPL  = EPL_TEAMS[awayName];

        // Drop events where neither team is an EPL club
        if (!homeEPL && !awayEPL) return acc;

        const utcDate  = new Date(e.date);
        const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);

        if (homeEPL) {
          // Home EPL club — normal home perspective
          const oppEPL    = awayEPL;
          const oppLogo   = (awayComp?.team?.logo as string | undefined)
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
          });
        } else {
          // Away EPL club — render from their perspective.
          // homeEPL is undefined here; look up homeName in EPL_TEAMS directly in case
          // it's a known club on the road.
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
            opponentId:      undefined, // non-EPL home team
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

async function fetchSRULeague(): Promise<UpcomingGame[]> {
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby/242041/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const seen = new Set<string>();

  return ((data.events ?? []) as any[])
    .filter(e => e.status?.type?.completed !== true)
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

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const espnLogo = (awayComp?.team?.logos?.[0]?.href ?? awayComp?.team?.logo) as string | undefined;

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
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── International Rugby — ESPN (three competition feeds) ─────────────────────

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
  '289234': undefined, // generic test matches
};

async function fetchRINTLeague(): Promise<UpcomingGame[]> {
  const now = new Date();
  const end = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  const settled = await Promise.allSettled(
    RINT_COMP_IDS.map(async (compId) => {
      const res = await fetchTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/rugby/${compId}/scoreboard?dates=${range}&limit=200`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [] as UpcomingGame[];
      const data  = await res.json();
      const label = RINT_COMP_LABELS[compId];

      return ((data.events ?? []) as any[])
        .filter((e: any) => e.status?.type?.completed !== true)
        .reduce<UpcomingGame[]>((acc, e) => {
          const comp:  any   = e.competitions?.[0] ?? {};
          const comps: any[] = comp.competitors ?? [];
          const homeComp = comps.find((c: any) => c.homeAway === 'home');
          const awayComp = comps.find((c: any) => c.homeAway === 'away');
          const homeName = homeComp?.team?.displayName ?? homeComp?.team?.name ?? '';
          const awayName = awayComp?.team?.displayName ?? awayComp?.team?.name ?? '';
          const home = RINT_TEAMS[homeName];
          const away = RINT_TEAMS[awayName];
          // Require a known home team with a valid internal ID
          if (!home || !home.id) return acc;

          const utcDate  = new Date(e.date);
          const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
          const espnLogo = (awayComp?.team?.logos?.[0]?.href ?? awayComp?.team?.logo) as string | undefined;
          const broadcast = home.id === 'rint-wallabies'
            ? ['Nine Network', 'Stan Sport']
            : ['Stan Sport'];

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

// NBA / NHL — no real fixture API implemented yet; return empty so the browse
// tab shows "No upcoming fixtures" rather than fabricated data.

// ─── F1 — Jolpi Ergast race calendar ──────────────────────────────────────────
//
// Returns one entry per SESSION per upcoming race weekend.
// All sessions use teamId: 'f1-championship' and store the circuitId in opponentId.

interface F1SessionDef {
  key: string;
  label: string;
  abbr: string;
  dateField?: string;
  timeField?: string;
}

const F1_SESSIONS: F1SessionDef[] = [
  { key: 'fp1',       label: 'Practice 1',       abbr: 'FP1',  dateField: 'FirstPractice' },
  { key: 'fp2',       label: 'Practice 2',       abbr: 'FP2',  dateField: 'SecondPractice' },
  { key: 'fp3',       label: 'Practice 3',       abbr: 'FP3',  dateField: 'ThirdPractice' },
  { key: 'sprintq',   label: 'Sprint Qualifying', abbr: 'SQ',   dateField: 'SprintQualifying' },
  { key: 'sprint',    label: 'Sprint',            abbr: 'SPR',  dateField: 'Sprint' },
  { key: 'qualifying',label: 'Qualifying',        abbr: 'QUAL', dateField: 'Qualifying' },
  { key: 'race',      label: 'Race',              abbr: 'RACE' },
];

async function fetchF1League(): Promise<UpcomingGame[]> {
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
    } catch {
      // try next
    }
  }
  if (races.length === 0) return [];

  const now          = Date.now();
  const twoHoursAgo  = now - 2 * 3600 * 1000;
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
        // Race itself
        const raceTime = race.time ?? '14:00:00Z';
        sessionDate = new Date(`${race.date}T${raceTime}`);
      }

      if (isNaN(sessionDate.getTime())) continue;
      if (sessionDate.getTime() <= twoHoursAgo) continue;

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
      });
    }
  }

  return fixtures.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── BBL — ESPN public API (league ID: 8044) ──────────────────────────────────

function parseCricketFormat(eventType: string): 'test' | 'odi' | 't20' {
  const t = (eventType ?? '').toLowerCase();
  if (t.includes('twenty') || t === 't20' || t.includes('t20')) return 't20';
  if (t.includes('one day') || t.includes('odi') || t.includes('list a')) return 'odi';
  if (t.includes('test') || t.includes('first class') || t.includes('first-class')) return 'test';
  return 't20';
}

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

async function fetchBBLLeague(): Promise<UpcomingGame[]> {
  const now = new Date();
  const end = new Date(now.getTime() + 150 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/cricket/8044/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const seen = new Set<string>();

  return ((data.events ?? []) as any[])
    .filter((e: any) => {
      const state = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state;
      return state !== 'post';
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

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const fmt2 = parseCricketFormat(comp.class?.eventType ?? comp.class?.name ?? '');

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
      });
      return acc;
    }, [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── International Cricket — aggregated across all configured series ───────────

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

// Generic ICC series — catch-all for bilateral tours not listed below.
const CRICKET_INT_GENERIC_SERIES = [8037];

// Per-team series IDs — mirrors fixtures/route.ts CRICKET_INT_TEAM_SERIES.
// Update both files together when new bilateral tours are confirmed.
const CRICKET_INT_TEAM_SERIES: Partial<Record<string, number[]>> = {
  'int-aus': [
    24231,    // Bangladesh tour of Australia 2026 (2 Tests, Aug)
    1530201,  // Australia tour of Zimbabwe 2026 (3 ODIs, Sep)
    24203,    // Australia tour of South Africa 2026/27 (3 ODIs + 1 Test, Sep-Oct)
  ],
  // Add entries here as bilateral tours for other nations are confirmed.
  // e.g. 'int-eng': [seriesId1, seriesId2],
};

// Derive the full union of series IDs at module load time so the league browse
// automatically covers every team's configured tours + the generic feed.
const CRICKET_INT_LEAGUE_SERIES: number[] = Array.from(
  new Set([
    ...CRICKET_INT_GENERIC_SERIES,
    ...(Object.values(CRICKET_INT_TEAM_SERIES).flat().filter((n): n is number => n !== undefined)),
  ]),
);

async function fetchCricketIntLeague(): Promise<UpcomingGame[]> {
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
      const id = String(e.id ?? '');
      if (seen.has(id)) return false;
      seen.add(id);
      const state = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state ?? '';
      return state !== 'post';
    })
    .map((e: any): UpcomingGame | null => {
      const comp:  any   = e.competitions?.[0] ?? {};
      const comps: any[] = comp.competitors ?? [];
      // Show from home team's perspective; fall back to first competitor
      const homeComp = comps.find((c: any) => c.homeAway === 'home') ?? comps[0];
      const awayComp = comps.find((c: any) => c.homeAway === 'away') ?? comps[1];
      if (!homeComp || !awayComp) return null;

      const homeName = homeComp.team?.displayName ?? '';
      const awayName = awayComp.team?.displayName ?? '';
      const home = CRICKET_INT_LEAGUE_TEAMS[homeName];
      if (!home) return null;
      const away = CRICKET_INT_LEAGUE_TEAMS[awayName];

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const fmt = parseCricketFormat(comp.class?.eventType ?? comp.class?.name ?? '');
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
      };
    })
    .filter((g): g is UpcomingGame => g !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED = new Set(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'nba', 'nhl', 'f1', 'bbl', 'cricket_int']);

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  if (!ALLOWED.has(league)) {
    return NextResponse.json({ error: 'Invalid league' }, { status: 400 });
  }
  try {
    let fixtures: UpcomingGame[] = [];
    if      (league === 'afl')         fixtures = await fetchAFLLeague();
    else if (league === 'epl')         fixtures = await fetchEPLLeague();
    else if (league === 'nrl')         fixtures = await fetchNRLLeague();
    else if (league === 'super_rugby') fixtures = await fetchSRULeague();
    else if (league === 'rugby_int')   fixtures = await fetchRINTLeague();
    else if (league === 'nba')         fixtures = []; // no real NBA fixture API yet
    else if (league === 'nhl')         fixtures = []; // no real NHL fixture API yet
    else if (league === 'f1')          fixtures = await fetchF1League();
    else if (league === 'bbl')         fixtures = await fetchBBLLeague();
    else if (league === 'cricket_int') fixtures = await fetchCricketIntLeague();
    return NextResponse.json(fixtures, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } });
  } catch (err) {
    console.error('[/api/league-fixtures]', err);
    return NextResponse.json([]);
  }
}
