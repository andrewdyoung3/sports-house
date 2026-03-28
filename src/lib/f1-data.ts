/**
 * F1 2025 Season — driver data for SportHouse.
 *
 * F1_CHAMPIONSHIP_TEAM is the single entity followed by users.
 * F1_DRIVERS is kept for standings display only.
 * Constructor name stored in the `division` field.
 * Colors are the 2025 constructor livery primaries.
 */

import type { Team } from '@/types';

// ─── F1 Championship Team (single followable entity) ──────────────────────────

export const F1_CHAMPIONSHIP_TEAM: Team = {
  id: 'f1-championship',
  name: 'Formula 1',
  shortName: 'Formula 1',
  abbreviation: 'F1',
  league: 'f1',
  sport: 'other',
  city: 'Worldwide',
  country: 'International',
  primaryColor: '#E8002D',
  secondaryColor: '#15151E',
  venue: '',
  division: 'World Championship',
};

// ─── Circuit data ──────────────────────────────────────────────────────────────

export interface F1Circuit {
  name: string;
  country: string;
  locality: string;
  length: string;
  laps: number;
  lapRecord: string;
  drsZones: number;
  drsDescription: string;
  mapUrl: string;
  description: string;
}

const F1_MAP_BASE = 'https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9';

export const F1_CIRCUITS: Record<string, F1Circuit> = {
  albert_park: {
    name: 'Albert Park Circuit',
    country: 'Australia',
    locality: 'Melbourne',
    length: '5.278 km',
    laps: 58,
    lapRecord: '1:20.235 – C. Leclerc (2022)',
    drsZones: 4,
    drsDescription: 'Four DRS zones: back straight, main straight, and two further sections',
    mapUrl: `${F1_MAP_BASE}/Australia_Circuit.png`,
    description: 'A semi-permanent street circuit around Melbourne\'s Albert Park lake. Fast and flowing, the track rewards commitment through its long sweeping corners. Changes in 2022 improved overtaking opportunities significantly.',
  },
  bahrain: {
    name: 'Bahrain International Circuit',
    country: 'Bahrain',
    locality: 'Sakhir',
    length: '5.412 km',
    laps: 57,
    lapRecord: '1:31.447 – P. de la Rosa (2005)',
    drsZones: 3,
    drsDescription: 'Three DRS zones: main straight, back straight, and start/finish straight',
    mapUrl: `${F1_MAP_BASE}/Bahrain_Circuit.png`,
    description: 'The season-opener under the floodlights of the Bahrain desert. A technical layout with multiple overtaking opportunities, high tyre degradation, and significant sandstorm risk. Braking zones into Turn 1 and Turn 4 are prime passing spots.',
  },
  jeddah: {
    name: 'Jeddah Corniche Circuit',
    country: 'Saudi Arabia',
    locality: 'Jeddah',
    length: '6.174 km',
    laps: 50,
    lapRecord: '1:30.734 – L. Hamilton (2021)',
    drsZones: 3,
    drsDescription: 'Three DRS zones running along the long straights of this high-speed street circuit',
    mapUrl: `${F1_MAP_BASE}/Saudi_Arabia_Circuit.png`,
    description: 'One of the fastest street circuits on the calendar, featuring high-speed walls and minimal run-off. The narrow layout and multiple blind apexes make for intense qualifying battles. Restarts under safety car often produce dramatic final laps.',
  },
  suzuka: {
    name: 'Suzuka International Racing Course',
    country: 'Japan',
    locality: 'Suzuka',
    length: '5.807 km',
    laps: 53,
    lapRecord: '1:30.983 – M. Schumacher (2004)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and the approach to the chicane',
    mapUrl: `${F1_MAP_BASE}/Japan_Circuit.png`,
    description: 'Widely considered the greatest circuit on the calendar. The figure-of-eight layout featuring the iconic 130R, the Esses, and Degner Corners tests every aspect of a car\'s performance. Fast, technical and beloved by drivers.',
  },
  shanghai: {
    name: 'Shanghai International Circuit',
    country: 'China',
    locality: 'Shanghai',
    length: '5.451 km',
    laps: 56,
    lapRecord: '1:32.238 – M. Schumacher (2004)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: the back straight and the long main straight',
    mapUrl: `${F1_MAP_BASE}/China_Circuit.png`,
    description: 'A purpose-built circuit with high tyre degradation and two long straights ideal for DRS attacks. The hairpin complex in sector 2 often sees dramatic overtaking. The track layout places heavy demands on rear tyres.',
  },
  miami: {
    name: 'Miami International Autodrome',
    country: 'United States',
    locality: 'Miami',
    length: '5.412 km',
    laps: 57,
    lapRecord: '1:29.708 – M. Verstappen (2023)',
    drsZones: 3,
    drsDescription: 'Three DRS zones around the Hard Rock Stadium complex',
    mapUrl: `${F1_MAP_BASE}/Miami_Circuit.png`,
    description: 'A street-style circuit built around the Miami Dolphins\' stadium complex. The track features long straights separated by tight, technical sections. Tyre management is critical given the high-energy nature of the layout.',
  },
  imola: {
    name: 'Autodromo Enzo e Dino Ferrari',
    country: 'Italy',
    locality: 'Imola',
    length: '4.909 km',
    laps: 63,
    lapRecord: '1:15.484 – M. Verstappen (2022)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and the back section past Tamburello',
    mapUrl: `${F1_MAP_BASE}/Emilia_Romagna_Circuit.png`,
    description: 'A classic Italian circuit steeped in history, home to the San Marino and Emilia Romagna Grands Prix. The narrow, old-school layout rewards mechanical grip and penalises mistakes. Limited overtaking opportunities make qualifying crucial.',
  },
  monaco: {
    name: 'Circuit de Monaco',
    country: 'Monaco',
    locality: 'Monte Carlo',
    length: '3.337 km',
    laps: 78,
    lapRecord: '1:12.909 – L. Hamilton (2021)',
    drsZones: 1,
    drsDescription: 'One DRS zone on the pit straight',
    mapUrl: `${F1_MAP_BASE}/Monaco_Circuit.png`,
    description: 'The jewel of the Formula 1 calendar, threading through the principality\'s streets at the foot of the Maritime Alps. Incredibly slow average speed masked by inches of clearance at each barrier. Strategy and qualifying position dominate the outcome.',
  },
  catalunya: {
    name: 'Circuit de Barcelona-Catalunya',
    country: 'Spain',
    locality: 'Barcelona',
    length: '4.675 km',
    laps: 66,
    lapRecord: '1:18.149 – M. Verstappen (2021)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and the back straight',
    mapUrl: `${F1_MAP_BASE}/Spain_Circuit.png`,
    description: 'A comprehensive test of car performance used for pre-season testing each year. Teams know every corner intimately. High-energy sector 3 through the banked final turn puts big demands on front tyres.',
  },
  gilles_villeneuve: {
    name: 'Circuit Gilles Villeneuve',
    country: 'Canada',
    locality: 'Montreal',
    length: '4.361 km',
    laps: 70,
    lapRecord: '1:13.078 – R. Barrichello (2004)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and back straight past the chicane',
    mapUrl: `${F1_MAP_BASE}/Canada_Circuit.png`,
    description: 'Set on the Île Notre-Dame, this stop-start circuit is famous for the Wall of Champions at the final chicane. Heavy braking zones and fast straights put severe stress on brakes. Safety car periods are common, creating dramatic late-race situations.',
  },
  silverstone: {
    name: 'Silverstone Circuit',
    country: 'Great Britain',
    locality: 'Silverstone',
    length: '5.891 km',
    laps: 52,
    lapRecord: '1:27.097 – M. Verstappen (2020)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: Wellington Straight and Hangar Straight',
    mapUrl: `${F1_MAP_BASE}/Great_Britain_Circuit.png`,
    description: 'Home of the British Grand Prix and the birthplace of Formula 1. High-speed corners like Maggotts, Becketts and Chapel define the layout. Weather variability makes strategy unpredictable. Passionate crowds create an unmatched atmosphere.',
  },
  hungaroring: {
    name: 'Hungaroring',
    country: 'Hungary',
    locality: 'Budapest',
    length: '4.381 km',
    laps: 70,
    lapRecord: '1:16.627 – L. Hamilton (2020)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and after Turn 3',
    mapUrl: `${F1_MAP_BASE}/Hungary_Circuit.png`,
    description: 'A tight, twisty circuit that has been compared to Monaco without the walls. Low-speed corners and limited overtaking make qualifying vital. Summer heat leads to high tyre degradation and strategic variety.',
  },
  spa: {
    name: 'Circuit de Spa-Francorchamps',
    country: 'Belgium',
    locality: 'Spa',
    length: '7.004 km',
    laps: 44,
    lapRecord: '1:46.286 – V. Bottas (2018)',
    drsZones: 3,
    drsDescription: 'Three DRS zones: Kemmel Straight, Blanchimont area, and pit straight',
    mapUrl: `${F1_MAP_BASE}/Belgium_Circuit.png`,
    description: 'The longest and most challenging circuit on the calendar, nestled in the Ardennes forest. Iconic Eau Rouge/Raidillon complex, Pouhon double-left, and Blanchimont require enormous bravery. Weather can differ dramatically across sections of the circuit.',
  },
  zandvoort: {
    name: 'Circuit Zandvoort',
    country: 'Netherlands',
    locality: 'Zandvoort',
    length: '4.259 km',
    laps: 72,
    lapRecord: '1:11.097 – M. Verstappen (2021)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and turn 3 area',
    mapUrl: `${F1_MAP_BASE}/Netherlands_Circuit.png`,
    description: 'A tight circuit with banked corners reminiscent of 1950s Grand Prix racing. The banked final turn and Hugenholtz corner provide technical challenges. Limited overtaking spots make strategy and qualifying position decisive.',
  },
  monza: {
    name: 'Autodromo Nazionale Monza',
    country: 'Italy',
    locality: 'Monza',
    length: '5.793 km',
    laps: 51,
    lapRecord: '1:21.046 – R. Barrichello (2004)',
    drsZones: 3,
    drsDescription: 'Three DRS zones: main straight, back straight, and Ascari chicane exit',
    mapUrl: `${F1_MAP_BASE}/Italy_Circuit.png`,
    description: 'The Temple of Speed. Monza\'s high-speed layout demands extreme low-downforce setup, producing the fastest average speeds of the season. The Lesmo complex and Parabolica are iconic. The passionate Tifosi make the Italian Grand Prix unmissable.',
  },
  baku: {
    name: 'Baku City Circuit',
    country: 'Azerbaijan',
    locality: 'Baku',
    length: '6.003 km',
    laps: 51,
    lapRecord: '1:43.009 – C. Leclerc (2019)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and the back section along the castle walls',
    mapUrl: `${F1_MAP_BASE}/Azerbaijan_Circuit.png`,
    description: 'A high-speed street circuit combining a 2.2 km flat-out blast down the main straight with a medieval castle section of extreme narrowness. Safety car periods are almost guaranteed. Power units take enormous stress from the full-throttle sections.',
  },
  marina_bay: {
    name: 'Marina Bay Street Circuit',
    country: 'Singapore',
    locality: 'Singapore',
    length: '4.940 km',
    laps: 62,
    lapRecord: '1:35.867 – L. Hamilton (2023)',
    drsZones: 3,
    drsDescription: 'Three DRS zones around the night race circuit',
    mapUrl: `${F1_MAP_BASE}/Singapore_Circuit.png`,
    description: 'Formula 1\'s first night race, illuminated by thousands of lights against the Singapore skyline. A punishing, slow-average-speed street circuit demanding exceptional braking and downforce levels. High humidity and heat make driver fitness crucial.',
  },
  americas: {
    name: 'Circuit of the Americas',
    country: 'United States',
    locality: 'Austin',
    length: '5.513 km',
    laps: 56,
    lapRecord: '1:36.169 – C. Leclerc (2019)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and the back section through turns 11–12',
    mapUrl: `${F1_MAP_BASE}/United_States_Circuit.png`,
    description: 'The only purpose-built US Grand Prix venue, inspired by the best corners from circuits around the world. The uphill run to Turn 1 is iconic. The sweeping esses in sector 1 and the complex back section demand a balanced setup.',
  },
  rodriguez: {
    name: 'Autodromo Hermanos Rodriguez',
    country: 'Mexico',
    locality: 'Mexico City',
    length: '4.304 km',
    laps: 71,
    lapRecord: '1:17.774 – V. Bottas (2021)',
    drsZones: 3,
    drsDescription: 'Three DRS zones: main straight, back straight, and stadium section',
    mapUrl: `${F1_MAP_BASE}/Mexico_Circuit.png`,
    description: 'High altitude (2,285m) means thin air reduces engine power and aerodynamic downforce, creating unique setup challenges. The stadium section through the old baseball arena creates a spectacular spectator experience. Traction zones are critical.',
  },
  interlagos: {
    name: 'Autodromo Jose Carlos Pace',
    country: 'Brazil',
    locality: 'São Paulo',
    length: '4.309 km',
    laps: 71,
    lapRecord: '1:10.540 – V. Bottas (2018)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and the back section after Mergulho',
    mapUrl: `${F1_MAP_BASE}/Brazil_Circuit.png`,
    description: 'Interlagos runs anti-clockwise and demands an unusual setup balance. Unpredictable weather creates strategic chaos. The Senna S complex at the start and the high-speed Curva do Sol are defining features. One of the greatest tracks for overtaking.',
  },
  las_vegas: {
    name: 'Las Vegas Strip Circuit',
    country: 'United States',
    locality: 'Las Vegas',
    length: '6.201 km',
    laps: 50,
    lapRecord: '1:35.490 – O. Piastri (2024)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main Strip straight and the back section',
    mapUrl: `${F1_MAP_BASE}/Las_Vegas_Circuit.png`,
    description: 'A night race along the Las Vegas Strip delivering maximum spectacle. Three long straights and tight chicanes create a demanding layout. Cold night temperatures challenge tyre warm-up and setup. One of the longest laps on the calendar.',
  },
  losail: {
    name: 'Lusail International Circuit',
    country: 'Qatar',
    locality: 'Lusail',
    length: '5.419 km',
    laps: 57,
    lapRecord: '1:24.319 – M. Verstappen (2023)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and back straight',
    mapUrl: `${F1_MAP_BASE}/Qatar_Circuit.png`,
    description: 'Originally a motorcycle circuit, Lusail\'s fast and flowing layout suits aerodynamic downforce. Extreme heat and humidity create dramatic tyre degradation, requiring careful management. Night lighting gives the circuit a unique visual identity.',
  },
  yas_marina: {
    name: 'Yas Marina Circuit',
    country: 'Abu Dhabi',
    locality: 'Abu Dhabi',
    length: '5.281 km',
    laps: 58,
    lapRecord: '1:26.103 – J. Button (2009)',
    drsZones: 2,
    drsDescription: 'Two DRS zones: main straight and sector 2 back straight',
    mapUrl: `${F1_MAP_BASE}/Abu_Dhabi_Circuit.png`,
    description: 'The season finale venue under the lights of Abu Dhabi. The 2021 circuit changes opened up significant overtaking opportunities. The yacht marina setting and floodlit backdrop create iconic imagery. Championship deciders have been decided here multiple times.',
  },
};

// ─── Constructor colors ───────────────────────────────────────────────────────

const CONSTRUCTOR_COLORS: Record<string, { primary: string; secondary: string }> = {
  'Red Bull Racing': { primary: '#3671C6', secondary: '#CC1E4A' },
  'Ferrari':         { primary: '#E8002D', secondary: '#FFFFFF' },
  'Mercedes':        { primary: '#27F4D2', secondary: '#222222' },
  'McLaren':         { primary: '#FF8000', secondary: '#000000' },
  'Aston Martin':    { primary: '#229971', secondary: '#FFFFFF' },
  'Alpine':          { primary: '#FF87BC', secondary: '#0093CC' },
  'Williams':        { primary: '#64C4FF', secondary: '#041E42' },
  'Racing Bulls':    { primary: '#6692FF', secondary: '#CC1E4A' },
  'Haas':            { primary: '#B6BABD', secondary: '#E8002D' },
  'Kick Sauber':     { primary: '#52E252', secondary: '#000000' },
};

// ─── 2025 F1 Driver Grid ──────────────────────────────────────────────────────

export const F1_DRIVERS: Team[] = [
  {
    id: 'f1_ver', name: 'Max Verstappen',    shortName: 'Verstappen', abbreviation: 'VER',
    league: 'f1', sport: 'other', city: 'Milton Keynes', country: 'Netherlands',
    primaryColor: CONSTRUCTOR_COLORS['Red Bull Racing'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Red Bull Racing'].secondary,
    venue: '', division: 'Red Bull Racing',
  },
  {
    id: 'f1_law', name: 'Liam Lawson',       shortName: 'Lawson',     abbreviation: 'LAW',
    league: 'f1', sport: 'other', city: 'Milton Keynes', country: 'New Zealand',
    primaryColor: CONSTRUCTOR_COLORS['Red Bull Racing'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Red Bull Racing'].secondary,
    venue: '', division: 'Red Bull Racing',
  },
  {
    id: 'f1_lec', name: 'Charles Leclerc',   shortName: 'Leclerc',    abbreviation: 'LEC',
    league: 'f1', sport: 'other', city: 'Maranello', country: 'Monaco',
    primaryColor: CONSTRUCTOR_COLORS['Ferrari'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Ferrari'].secondary,
    venue: '', division: 'Ferrari',
  },
  {
    id: 'f1_ham', name: 'Lewis Hamilton',    shortName: 'Hamilton',   abbreviation: 'HAM',
    league: 'f1', sport: 'other', city: 'Maranello', country: 'United Kingdom',
    primaryColor: CONSTRUCTOR_COLORS['Ferrari'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Ferrari'].secondary,
    venue: '', division: 'Ferrari',
  },
  {
    id: 'f1_rus', name: 'George Russell',    shortName: 'Russell',    abbreviation: 'RUS',
    league: 'f1', sport: 'other', city: 'Brackley', country: 'United Kingdom',
    primaryColor: CONSTRUCTOR_COLORS['Mercedes'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Mercedes'].secondary,
    venue: '', division: 'Mercedes',
  },
  {
    id: 'f1_ant', name: 'Kimi Antonelli',    shortName: 'Antonelli',  abbreviation: 'ANT',
    league: 'f1', sport: 'other', city: 'Brackley', country: 'Italy',
    primaryColor: CONSTRUCTOR_COLORS['Mercedes'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Mercedes'].secondary,
    venue: '', division: 'Mercedes',
  },
  {
    id: 'f1_nor', name: 'Lando Norris',      shortName: 'Norris',     abbreviation: 'NOR',
    league: 'f1', sport: 'other', city: 'Woking', country: 'United Kingdom',
    primaryColor: CONSTRUCTOR_COLORS['McLaren'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['McLaren'].secondary,
    venue: '', division: 'McLaren',
  },
  {
    id: 'f1_pia', name: 'Oscar Piastri',     shortName: 'Piastri',    abbreviation: 'PIA',
    league: 'f1', sport: 'other', city: 'Woking', country: 'Australia',
    primaryColor: CONSTRUCTOR_COLORS['McLaren'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['McLaren'].secondary,
    venue: '', division: 'McLaren',
  },
  {
    id: 'f1_alo', name: 'Fernando Alonso',   shortName: 'Alonso',     abbreviation: 'ALO',
    league: 'f1', sport: 'other', city: 'Silverstone', country: 'Spain',
    primaryColor: CONSTRUCTOR_COLORS['Aston Martin'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Aston Martin'].secondary,
    venue: '', division: 'Aston Martin',
  },
  {
    id: 'f1_str', name: 'Lance Stroll',      shortName: 'Stroll',     abbreviation: 'STR',
    league: 'f1', sport: 'other', city: 'Silverstone', country: 'Canada',
    primaryColor: CONSTRUCTOR_COLORS['Aston Martin'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Aston Martin'].secondary,
    venue: '', division: 'Aston Martin',
  },
  {
    id: 'f1_gas', name: 'Pierre Gasly',      shortName: 'Gasly',      abbreviation: 'GAS',
    league: 'f1', sport: 'other', city: 'Enstone', country: 'France',
    primaryColor: CONSTRUCTOR_COLORS['Alpine'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Alpine'].secondary,
    venue: '', division: 'Alpine',
  },
  {
    id: 'f1_doo', name: 'Jack Doohan',       shortName: 'Doohan',     abbreviation: 'DOO',
    league: 'f1', sport: 'other', city: 'Enstone', country: 'Australia',
    primaryColor: CONSTRUCTOR_COLORS['Alpine'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Alpine'].secondary,
    venue: '', division: 'Alpine',
  },
  {
    id: 'f1_alb', name: 'Alexander Albon',   shortName: 'Albon',      abbreviation: 'ALB',
    league: 'f1', sport: 'other', city: 'Grove', country: 'Thailand',
    primaryColor: CONSTRUCTOR_COLORS['Williams'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Williams'].secondary,
    venue: '', division: 'Williams',
  },
  {
    id: 'f1_sai', name: 'Carlos Sainz',      shortName: 'Sainz',      abbreviation: 'SAI',
    league: 'f1', sport: 'other', city: 'Grove', country: 'Spain',
    primaryColor: CONSTRUCTOR_COLORS['Williams'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Williams'].secondary,
    venue: '', division: 'Williams',
  },
  {
    id: 'f1_tsu', name: 'Yuki Tsunoda',      shortName: 'Tsunoda',    abbreviation: 'TSU',
    league: 'f1', sport: 'other', city: 'Faenza', country: 'Japan',
    primaryColor: CONSTRUCTOR_COLORS['Racing Bulls'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Racing Bulls'].secondary,
    venue: '', division: 'Racing Bulls',
  },
  {
    id: 'f1_had', name: 'Isack Hadjar',      shortName: 'Hadjar',     abbreviation: 'HAD',
    league: 'f1', sport: 'other', city: 'Faenza', country: 'France',
    primaryColor: CONSTRUCTOR_COLORS['Racing Bulls'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Racing Bulls'].secondary,
    venue: '', division: 'Racing Bulls',
  },
  {
    id: 'f1_oco', name: 'Esteban Ocon',      shortName: 'Ocon',       abbreviation: 'OCO',
    league: 'f1', sport: 'other', city: 'Kannapolis', country: 'France',
    primaryColor: CONSTRUCTOR_COLORS['Haas'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Haas'].secondary,
    venue: '', division: 'Haas',
  },
  {
    id: 'f1_bea', name: 'Oliver Bearman',    shortName: 'Bearman',    abbreviation: 'BEA',
    league: 'f1', sport: 'other', city: 'Kannapolis', country: 'United Kingdom',
    primaryColor: CONSTRUCTOR_COLORS['Haas'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Haas'].secondary,
    venue: '', division: 'Haas',
  },
  {
    id: 'f1_hul', name: 'Nico Hülkenberg',   shortName: 'Hülkenberg', abbreviation: 'HUL',
    league: 'f1', sport: 'other', city: 'Hinwil', country: 'Germany',
    primaryColor: CONSTRUCTOR_COLORS['Kick Sauber'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Kick Sauber'].secondary,
    venue: '', division: 'Kick Sauber',
  },
  {
    id: 'f1_bor', name: 'Gabriel Bortoleto', shortName: 'Bortoleto',  abbreviation: 'BOR',
    league: 'f1', sport: 'other', city: 'Hinwil', country: 'Brazil',
    primaryColor: CONSTRUCTOR_COLORS['Kick Sauber'].primary,
    secondaryColor: CONSTRUCTOR_COLORS['Kick Sauber'].secondary,
    venue: '', division: 'Kick Sauber',
  },
];

// ─── Ergast driverId lookup ───────────────────────────────────────────────────

export const F1_DRIVER_IDS: Record<string, string> = {
  f1_ver: 'max_verstappen',
  f1_law: 'liam_lawson',
  f1_lec: 'leclerc',
  f1_ham: 'hamilton',
  f1_rus: 'russell',
  f1_ant: 'antonelli',
  f1_nor: 'norris',
  f1_pia: 'piastri',
  f1_alo: 'alonso',
  f1_str: 'stroll',
  f1_gas: 'gasly',
  f1_doo: 'jack_doohan',
  f1_alb: 'albon',
  f1_sai: 'sainz',
  f1_tsu: 'tsunoda',
  f1_had: 'isack_hadjar',
  f1_oco: 'ocon',
  f1_bea: 'bearman',
  f1_hul: 'hulkenberg',
  f1_bor: 'bortoleto',
};

// ─── Constructor logo URLs ────────────────────────────────────────────────────
// ESPN CDN — F1 team logos (path: /f1/500/{slug}.png)

export const F1_CONSTRUCTOR_LOGOS: Record<string, string> = {
  'Red Bull Racing': 'https://a.espncdn.com/i/teamlogos/f1/500/red_bull.png',
  'Ferrari':         'https://a.espncdn.com/i/teamlogos/f1/500/ferrari.png',
  'Mercedes':        'https://a.espncdn.com/i/teamlogos/f1/500/mercedes.png',
  'McLaren':         'https://a.espncdn.com/i/teamlogos/f1/500/mclaren.png',
  'Aston Martin':    'https://a.espncdn.com/i/teamlogos/f1/500/aston_martin.png',
  'Alpine':          'https://a.espncdn.com/i/teamlogos/f1/500/alpine.png',
  'Williams':        'https://a.espncdn.com/i/teamlogos/f1/500/williams.png',
  'Racing Bulls':    'https://a.espncdn.com/i/teamlogos/f1/500/racing_bulls.png',
  'Haas':            'https://a.espncdn.com/i/teamlogos/f1/500/haas.png',
  'Kick Sauber':     'https://a.espncdn.com/i/teamlogos/f1/500/sauber.png',
};

// ─── Ergast constructorId lookup ─────────────────────────────────────────────

export const F1_CONSTRUCTOR_IDS: Record<string, string> = {
  'Red Bull Racing': 'red_bull',
  'Ferrari':         'ferrari',
  'Mercedes':        'mercedes',
  'McLaren':         'mclaren',
  'Aston Martin':    'aston_martin',
  'Alpine':          'alpine',
  'Williams':        'williams',
  'Racing Bulls':    'rb',
  'Haas':            'haas',
  'Kick Sauber':     'sauber',
};

// ─── 2025 F1 Constructor Teams ─────────────────────────────────────────────────

export const F1_CONSTRUCTOR_TEAMS: Team[] = [
  { id: 'f1-team-redbull',     name: 'Red Bull Racing',  shortName: 'Red Bull',    abbreviation: 'RBR', league: 'f1', sport: 'other', city: 'Milton Keynes', country: 'United Kingdom', primaryColor: '#3671C6', secondaryColor: '#CC1E4A', venue: '', division: 'Red Bull Racing' },
  { id: 'f1-team-ferrari',     name: 'Ferrari',          shortName: 'Ferrari',     abbreviation: 'FER', league: 'f1', sport: 'other', city: 'Maranello',      country: 'Italy',          primaryColor: '#E8002D', secondaryColor: '#FFFFFF', venue: '', division: 'Ferrari' },
  { id: 'f1-team-mercedes',    name: 'Mercedes',         shortName: 'Mercedes',    abbreviation: 'MER', league: 'f1', sport: 'other', city: 'Brackley',       country: 'United Kingdom', primaryColor: '#27F4D2', secondaryColor: '#222222', venue: '', division: 'Mercedes' },
  { id: 'f1-team-mclaren',     name: 'McLaren',          shortName: 'McLaren',     abbreviation: 'MCL', league: 'f1', sport: 'other', city: 'Woking',         country: 'United Kingdom', primaryColor: '#FF8000', secondaryColor: '#000000', venue: '', division: 'McLaren' },
  { id: 'f1-team-astonmartin', name: 'Aston Martin',     shortName: 'Aston Martin',abbreviation: 'AMR', league: 'f1', sport: 'other', city: 'Silverstone',    country: 'United Kingdom', primaryColor: '#229971', secondaryColor: '#FFFFFF', venue: '', division: 'Aston Martin' },
  { id: 'f1-team-alpine',      name: 'Alpine',           shortName: 'Alpine',      abbreviation: 'ALP', league: 'f1', sport: 'other', city: 'Enstone',        country: 'United Kingdom', primaryColor: '#FF87BC', secondaryColor: '#0093CC', venue: '', division: 'Alpine' },
  { id: 'f1-team-williams',    name: 'Williams',         shortName: 'Williams',    abbreviation: 'WIL', league: 'f1', sport: 'other', city: 'Grove',          country: 'United Kingdom', primaryColor: '#64C4FF', secondaryColor: '#041E42', venue: '', division: 'Williams' },
  { id: 'f1-team-racingbulls', name: 'Racing Bulls',     shortName: 'Racing Bulls',abbreviation: 'RCB', league: 'f1', sport: 'other', city: 'Faenza',         country: 'Italy',          primaryColor: '#6692FF', secondaryColor: '#CC1E4A', venue: '', division: 'Racing Bulls' },
  { id: 'f1-team-haas',        name: 'Haas F1 Team',    shortName: 'Haas',        abbreviation: 'HAS', league: 'f1', sport: 'other', city: 'Kannapolis',     country: 'United States',  primaryColor: '#B6BABD', secondaryColor: '#E8002D', venue: '', division: 'Haas' },
  { id: 'f1-team-sauber',      name: 'Kick Sauber',      shortName: 'Kick Sauber', abbreviation: 'SAU', league: 'f1', sport: 'other', city: 'Hinwil',         country: 'Switzerland',    primaryColor: '#52E252', secondaryColor: '#000000', venue: '', division: 'Kick Sauber' },
];

/** Returns the constructor name from a team entity (works for both driver and constructor teams) */
export function getF1ConstructorName(team: Team): string | undefined {
  return team.division; // both F1_DRIVERS and F1_CONSTRUCTOR_TEAMS store constructor name in division
}

/** True if this team is a constructor entry (not an individual driver) */
export function isF1ConstructorTeam(teamId: string): boolean {
  return teamId.startsWith('f1-team-');
}

// ─── Reverse lookup: ergastDriverId → our team ID ─────────────────────────────

export const ERGAST_ID_TO_TEAM_ID: Record<string, string> = Object.fromEntries(
  Object.entries(F1_DRIVER_IDS).map(([teamId, ergastId]) => [ergastId, teamId]),
);

// ─── Country → 3-char abbreviation for race opponents ────────────────────────

export const COUNTRY_TO_ABBR: Record<string, string> = {
  'Australia':            'AUS',
  'China':                'CHN',
  'Japan':                'JPN',
  'Bahrain':              'BHR',
  'Saudi Arabia':         'KSA',
  'USA':                  'USA',
  'United States':        'USA',
  'Italy':                'ITA',
  'Monaco':               'MCO',
  'Canada':               'CAN',
  'Spain':                'ESP',
  'Austria':              'AUT',
  'United Kingdom':       'GBR',
  'UK':                   'GBR',
  'Hungary':              'HUN',
  'Belgium':              'BEL',
  'Netherlands':          'NED',
  'Singapore':            'SGP',
  'Azerbaijan':           'AZE',
  'Mexico':               'MEX',
  'Brazil':               'BRA',
  'Las Vegas':            'LVS',
  'Qatar':                'QAT',
  'Abu Dhabi':            'UAE',
  'United Arab Emirates': 'UAE',
  'Emilia-Romagna':       'ITA',
  'Styria':               'AUT',
  'Tuscan':               'ITA',
  'Turkish':              'TUR',
  'Turkey':               'TUR',
  'Portugal':             'POR',
  'Sakhir':               'BHR',
};
