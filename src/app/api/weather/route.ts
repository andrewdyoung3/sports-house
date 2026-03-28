/**
 * GET /api/weather?venue=...&date=...
 *
 * Returns weather conditions at kickoff time for a given venue.
 * Uses Open-Meteo (free, no API key) with a hard-coded venue → coordinates
 * lookup table for common stadiums, and a geocoding fallback.
 *
 * Only called for outdoor sports (AFL, NRL, EPL, Super Rugby, Rugby Int'l)
 * within 24 hours of kickoff.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { WeatherData } from '@/types';

// ─── Venue → [lat, lon] lookup ────────────────────────────────────────────────

const VENUE_COORDS: Record<string, [number, number]> = {
  // ── AFL ───────────────────────────────────────────────────────────────────
  'mcg':                              [-37.8200, 144.9836],
  'melbourne cricket ground':         [-37.8200, 144.9836],
  'marvel stadium':                   [-37.8166, 144.9473],
  'docklands stadium':                [-37.8166, 144.9473],
  'etihad stadium':                   [-37.8166, 144.9473],
  'adelaide oval':                    [-34.9158, 138.5960],
  'optus stadium':                    [-31.9505, 115.8851],
  'perth stadium':                    [-31.9505, 115.8851],
  'gabba':                            [-27.4858, 153.0381],
  'the gabba':                        [-27.4858, 153.0381],
  'brisbane cricket ground':          [-27.4858, 153.0381],
  'metricon stadium':                 [-28.0079, 153.4014],
  'people first stadium':             [-28.0079, 153.4014],
  'utas stadium':                     [-41.4389, 147.1389],
  'university of tasmania stadium':   [-41.4389, 147.1389],
  'gio stadium':                      [-35.2809, 149.1282],
  'canberra stadium':                 [-35.2809, 149.1282],
  'cazalys stadium':                  [-16.9186, 145.7721],
  'manuka oval':                      [-35.3120, 149.1292],
  'engie stadium':                    [-33.8150, 150.9941],
  'giants stadium':                   [-33.8150, 150.9941],
  'sydney showground stadium':        [-33.8150, 150.9941],
  'blundstone arena':                 [-42.8756, 147.3298],
  'bellerive oval':                   [-42.8756, 147.3298],
  'traeger park':                     [-23.6980, 133.8807],
  'norwood oval':                     [-34.9213, 138.6351],

  // ── NRL ───────────────────────────────────────────────────────────────────
  'accor stadium':                    [-33.8469, 151.0629],
  'stadium australia':                [-33.8469, 151.0629],
  'anz stadium':                      [-33.8469, 151.0629],
  'allianz stadium':                  [-33.8914, 151.2253],
  'sydney cricket ground':            [-33.8914, 151.2253],
  'scg':                              [-33.8914, 151.2253],
  'commbank stadium':                 [-33.8133, 150.9884],
  'parramatta stadium':               [-33.8133, 150.9884],
  'mcdonald jones stadium':           [-32.9266, 151.7576],
  'hunter stadium':                   [-32.9266, 151.7576],
  'bluebet stadium':                  [-33.7569, 150.7074],
  'penrith stadium':                  [-33.7569, 150.7074],
  'central coast stadium':            [-33.4334, 151.3558],
  'win stadium':                      [-34.4244, 150.9113],
  'wollongong':                       [-34.4244, 150.9113],
  '4 pines park':                     [-33.7965, 151.2857],
  'brookvale oval':                   [-33.7965, 151.2857],
  'leichhardt oval':                  [-33.8822, 151.1523],
  'netstrata jubilee stadium':        [-33.9505, 150.9907],
  'jubilee stadium':                  [-33.9505, 150.9907],
  'pointsbet stadium':                [-30.9010, 153.0274],
  'coffs harbour':                    [-30.2963, 153.1135],
  'cbus super stadium':               [-27.9718, 153.3984],
  'sunshine coast stadium':           [-26.6521, 153.0594],
  'qld country bank stadium':         [-19.2590, 146.8027],
  'townsville':                       [-19.2590, 146.8027],
  'suncorp stadium':                  [-27.4648, 153.0095],
  'lang park':                        [-27.4648, 153.0095],
  'go media stadium':                 [-36.9217, 174.8024],
  'mt smart stadium':                 [-36.9217, 174.8024],

  // ── EPL ───────────────────────────────────────────────────────────────────
  'anfield':                          [53.4308,  -2.9608],
  'old trafford':                     [53.4631,  -2.2913],
  'city of manchester stadium':       [53.4831,  -2.2004],
  'etihad':                           [53.4831,  -2.2004],
  'emirates stadium':                 [51.5549,  -0.1084],
  'stamford bridge':                  [51.4816,  -0.1909],
  'tottenham hotspur stadium':        [51.6040,  -0.0667],
  'london stadium':                   [51.5386,  -0.0165],
  'selhurst park':                    [51.3983,  -0.0855],
  'villa park':                       [52.5092,  -1.8847],
  "st james' park":                   [54.9756,  -1.6218],
  'st james park':                    [54.9756,  -1.6218],
  'elland road':                      [53.7777,  -1.5720],
  'the hawthorns':                    [52.5092,  -1.9637],
  'king power stadium':               [52.6204,  -1.1423],
  'goodison park':                    [53.4388,  -2.9666],
  'molineux':                         [52.5900,  -2.1302],
  'carrow road':                      [52.6220,   1.3087],
  'craven cottage':                   [51.4749,  -0.2217],
  'vitality stadium':                 [51.1813,  -1.8382],
  "st mary's stadium":                [50.9058,  -1.3914],
  "st mary's":                        [50.9058,  -1.3914],
  'amex stadium':                     [50.8616,  -0.0861],
  'american express community stadium': [50.8616, -0.0861],
  'gtech community stadium':          [51.4882,  -0.2889],
  'brentford community stadium':      [51.4882,  -0.2889],
  'bramall lane':                      [53.3703,  -1.4706],
  'portman road':                     [52.0545,   1.1455],
  'dean court':                       [50.7352,  -1.8383],
  'wembley stadium':                  [51.5560,  -0.2796],

  // ── European / UCL neutral venues ─────────────────────────────────────────
  'allianz arena':                    [48.2188,  11.6247],
  'santiago bernabeu':                [40.4531,  -3.6883],
  'camp nou':                         [41.3809,   2.1228],
  'san siro':                         [45.4781,   9.1240],
  'stade de france':                  [48.9244,   2.3601],
  'puskas arena':                     [47.5016,  19.0612],

  // ── Super Rugby ───────────────────────────────────────────────────────────
  'sky stadium':                      [-41.2865, 174.7762],
  'westpac stadium':                  [-41.2865, 174.7762],
  'eden park':                        [-36.8734, 174.7431],
  'forsyth barr stadium':             [-45.8736, 170.4786],
  'orangetheory stadium':             [-43.5321, 172.6362],
  'apollo projects stadium':          [-43.5321, 172.6362],
  'dunedin stadium':                  [-45.8736, 170.4786],
  'nib stadium':                      [-31.9479, 115.8355],
  'hfc bank stadium':                 [-36.9217, 174.8024],
  'leichhardt':                       [-33.8822, 151.1523],
  'suncorp (sr)':                     [-27.4648, 153.0095],
  'dhl newlands':                     [-33.9340,  18.4717],
  'cape town stadium':                [-33.9071,  18.4134],
  'loftus versfeld':                  [-25.7528,  28.2245],
  'ellis park':                       [-26.1943,  28.0560],
};

function lookupCoords(venue: string): [number, number] | null {
  const key = venue.toLowerCase().trim();
  if (VENUE_COORDS[key]) return VENUE_COORDS[key];
  // Partial match: the stored name is contained in the venue string or vice-versa
  for (const [name, coords] of Object.entries(VENUE_COORDS)) {
    if (key.includes(name) || name.includes(key)) return coords;
  }
  return null;
}

async function geocodeVenue(venue: string): Promise<[number, number] | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(venue)}&count=1&language=en&format=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json() as { results?: { latitude: number; longitude: number }[] };
    if (data.results && data.results.length > 0) {
      return [data.results[0].latitude, data.results[0].longitude];
    }
  } catch { /* geocoding failed */ }
  return null;
}

// ─── WMO weather code → display ───────────────────────────────────────────────

function interpretCode(code: number): { condition: string; icon: string; description: string } {
  if (code === 0)                    return { condition: 'clear',   icon: '☀️',  description: 'Clear sky'       };
  if (code === 1)                    return { condition: 'clear',   icon: '🌤️',  description: 'Mainly clear'    };
  if (code === 2)                    return { condition: 'cloud',   icon: '⛅',  description: 'Partly cloudy'   };
  if (code === 3)                    return { condition: 'cloud',   icon: '☁️',  description: 'Overcast'        };
  if (code === 45 || code === 48)    return { condition: 'fog',     icon: '🌫️',  description: 'Fog'             };
  if (code >= 51 && code <= 55)      return { condition: 'drizzle', icon: '🌦️',  description: 'Drizzle'         };
  if (code >= 56 && code <= 57)      return { condition: 'drizzle', icon: '🌧️',  description: 'Freezing drizzle' };
  if (code >= 61 && code <= 62)      return { condition: 'rain',    icon: '🌧️',  description: 'Light rain'      };
  if (code >= 63 && code <= 65)      return { condition: 'rain',    icon: '🌧️',  description: 'Heavy rain'      };
  if (code >= 71 && code <= 77)      return { condition: 'snow',    icon: '❄️',  description: 'Snow'            };
  if (code >= 80 && code <= 82)      return { condition: 'rain',    icon: '🌦️',  description: 'Rain showers'    };
  if (code >= 85 && code <= 86)      return { condition: 'snow',    icon: '🌨️',  description: 'Snow showers'    };
  if (code === 95)                   return { condition: 'storm',   icon: '⛈️',  description: 'Thunderstorm'    };
  if (code === 96 || code === 99)    return { condition: 'storm',   icon: '⛈️',  description: 'Heavy thunderstorm' };
  return { condition: 'cloud', icon: '☁️', description: 'Cloudy' };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const venue = searchParams.get('venue');
  const date  = searchParams.get('date');

  if (!venue || !date) {
    return NextResponse.json({ error: 'venue and date required' }, { status: 400 });
  }

  const kickoff = new Date(date);
  if (isNaN(kickoff.getTime())) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  // Resolve coordinates — hard-coded lookup first, geocoding fallback
  let coords = lookupCoords(venue);
  if (!coords) coords = await geocodeVenue(venue);
  if (!coords) {
    return NextResponse.json({ error: 'venue coordinates not found' }, { status: 404 });
  }

  const [lat, lon] = coords;

  // Fetch hourly forecast from Open-Meteo (free, no key required)
  const forecastUrl = [
    `https://api.open-meteo.com/v1/forecast`,
    `?latitude=${lat}&longitude=${lon}`,
    `&hourly=temperature_2m,precipitation,precipitation_probability,windspeed_10m,weathercode`,
    `&timezone=auto&forecast_days=3`,
  ].join('');

  try {
    const res = await fetch(forecastUrl, {
      signal: AbortSignal.timeout(6000),
      // Cache the upstream Open-Meteo response for 30 minutes
      next: { revalidate: 1800 },
    });
    if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);

    const data = await res.json() as {
      hourly: {
        time:                     string[];
        temperature_2m:           number[];
        precipitation:            number[];
        precipitation_probability: number[];
        windspeed_10m:            number[];
        weathercode:              number[];
      };
    };

    // Find the hourly slot closest to kickoff time
    const kickoffMs = kickoff.getTime();
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < data.hourly.time.length; i++) {
      const diff = Math.abs(new Date(data.hourly.time[i]).getTime() - kickoffMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }

    const code      = data.hourly.weathercode[bestIdx];
    const tempC     = Math.round(data.hourly.temperature_2m[bestIdx]);
    const precipMm  = Math.round(data.hourly.precipitation[bestIdx] * 10) / 10;
    const precipProb = data.hourly.precipitation_probability[bestIdx] ?? 0;
    const windKmh   = Math.round(data.hourly.windspeed_10m[bestIdx]);

    const { condition, icon, description } = interpretCode(code);

    const isNotable = precipMm > 0.5 || precipProb > 40 || windKmh > 25 || tempC < 5 || tempC > 32;

    const weather: WeatherData = {
      condition, icon, description,
      tempC, precipMm, precipProbability: precipProb,
      windKmh, weatherCode: code, isNotable,
    };

    return NextResponse.json(weather, {
      headers: { 'Cache-Control': 'public, max-age=1800, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[/api/weather]', err);
    return NextResponse.json({ error: 'Weather fetch failed' }, { status: 500 });
  }
}
