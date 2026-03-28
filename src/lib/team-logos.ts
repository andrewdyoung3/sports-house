/**
 * Official team logo URLs. Keyed by our internal team ID.
 *
 * ESPN CDN patterns (verified March 2026):
 *   AFL        → https://a.espncdn.com/i/teamlogos/afl/500/{slug}.png
 *   NRL        → https://a.espncdn.com/i/teamlogos/rugby/teams/500/{numericId}.png
 *   EPL        → https://a.espncdn.com/i/teamlogos/soccer/500/{numericId}.png
 *   NFL        → https://a.espncdn.com/i/teamlogos/nfl/500/{abbr}.png
 *   NBA        → https://a.espncdn.com/i/teamlogos/nba/500/{abbr}.png
 *   MLB        → https://a.espncdn.com/i/teamlogos/mlb/500/{abbr}.png
 *   NHL        → https://a.espncdn.com/i/teamlogos/nhl/500/{abbr}.png
 *   Super Rugby → https://a.espncdn.com/i/teamlogos/rugby/teams/500/{numericId}.png
 */

const ESPN = 'https://a.espncdn.com/i/teamlogos';

export const TEAM_LOGOS: Record<string, string> = {

  // ── AFL ────────────────────────────────────────────────────────────────────
  'afl-crows':     `${ESPN}/afl/500/adel.png`,
  'afl-lions':     `${ESPN}/afl/500/bl.png`,
  'afl-blues':     `${ESPN}/afl/500/carl.png`,
  'afl-pies':      `${ESPN}/afl/500/coll.png`,
  'afl-bombers':   `${ESPN}/afl/500/ess.png`,
  'afl-dockers':   `${ESPN}/afl/500/fre.png`,
  'afl-cats':      `${ESPN}/afl/500/geel.png`,
  'afl-suns':      `${ESPN}/afl/500/suns.png`,
  'afl-giants':    `${ESPN}/afl/500/gws.png`,
  'afl-hawks':     `${ESPN}/afl/500/haw.png`,
  'afl-demons':    `${ESPN}/afl/500/melb.png`,
  'afl-kangaroos': `${ESPN}/afl/500/nmfc.png`,
  'afl-power':     `${ESPN}/afl/500/port.png`,
  'afl-tigers':    `${ESPN}/afl/500/rich.png`,
  'afl-saints':    `${ESPN}/afl/500/stk.png`,
  'afl-swans':     `${ESPN}/afl/500/syd.png`,
  'afl-eagles':    `${ESPN}/afl/500/wce.png`,
  'afl-dogs':      `${ESPN}/afl/500/wb.png`,

  // ── NRL ────────────────────────────────────────────────────────────────────
  // ESPN CDN: rugby/teams/500/{numericId}.png (IDs from ESPN rugby-league/3 teams endpoint)
  'nrl-broncos':   `${ESPN}/rugby/teams/500/289195.png`,
  'nrl-raiders':   `${ESPN}/rugby/teams/500/289198.png`,
  'nrl-bulldogs':  `${ESPN}/rugby/teams/500/289197.png`,
  'nrl-sharks':    `${ESPN}/rugby/teams/500/289203.png`,
  'nrl-dolphins':  `${ESPN}/rugby/teams/500/289346.png`,
  'nrl-titans':    `${ESPN}/rugby/teams/500/289206.png`,
  'nrl-eels':      `${ESPN}/rugby/teams/500/289194.png`,
  'nrl-panthers':  `${ESPN}/rugby/teams/500/289199.png`,
  'nrl-seahawks':  `${ESPN}/rugby/teams/500/289196.png`,
  'nrl-storm':     `${ESPN}/rugby/teams/500/289208.png`,
  'nrl-knights':   `${ESPN}/rugby/teams/500/289207.png`,
  'nrl-warriors':  `${ESPN}/rugby/teams/500/289201.png`,
  'nrl-cowboys':   `${ESPN}/rugby/teams/500/289202.png`,
  'nrl-rabbitohs': `${ESPN}/rugby/teams/500/289205.png`,
  'nrl-dragons':   `${ESPN}/rugby/teams/500/289209.png`,
  'nrl-roosters':  `${ESPN}/rugby/teams/500/289204.png`,
  'nrl-tigers':    `${ESPN}/rugby/teams/500/289200.png`,

  // ── International Rugby ─────────────────────────────────────────────────────
  // ESPN CDN — numeric IDs verified from ESPN rugby teams endpoints (March 2026)
  // Path pattern: /rugby/teams/500/{id}.png (same CDN as NRL/SRU)
  'rint-wallabies': `${ESPN}/rugby/teams/500/6.png`,
  'rint-allblacks': `${ESPN}/rugby/teams/500/8.png`,
  'rint-boks':      `${ESPN}/rugby/teams/500/5.png`,
  'rint-england':   `${ESPN}/rugby/teams/500/1.png`,
  'rint-ireland':   `${ESPN}/rugby/teams/500/3.png`,
  'rint-france':    `${ESPN}/rugby/teams/500/9.png`,
  'rint-scotland':  `${ESPN}/rugby/teams/500/2.png`,
  'rint-wales':     `${ESPN}/rugby/teams/500/4.png`,
  'rint-argentina': `${ESPN}/rugby/teams/500/10.png`,
  'rint-fiji':      `${ESPN}/rugby/teams/500/14.png`,
  'rint-samoa':     `${ESPN}/rugby/teams/500/15.png`,
  'rint-tonga':     `${ESPN}/rugby/teams/500/16.png`,

  // ── Super Rugby Pacific ─────────────────────────────────────────────────────
  // ESPN CDN — numeric IDs verified from ESPN rugby/242041/teams endpoint (March 2026)
  'sru-brumbies':    `${ESPN}/rugby/teams/500/25889.png`,
  'sru-reds':        `${ESPN}/rugby/teams/500/182.png`,
  'sru-waratahs':    `${ESPN}/rugby/teams/500/227.png`,
  'sru-force':       `${ESPN}/rugby/teams/500/25893.png`,
  'sru-blues':       `${ESPN}/rugby/teams/500/25932.png`,
  'sru-chiefs':      `${ESPN}/rugby/teams/500/25934.png`,
  'sru-crusaders':   `${ESPN}/rugby/teams/500/25936.png`,
  'sru-highlanders': `${ESPN}/rugby/teams/500/25938.png`,
  'sru-hurricanes':  `${ESPN}/rugby/teams/500/25939.png`,
  'sru-drua':        `${ESPN}/rugby/teams/500/289338.png`,
  'sru-moana':       `${ESPN}/rugby/teams/500/289319.png`,

  // ── EPL ────────────────────────────────────────────────────────────────────
  'epl-arsenal':       `${ESPN}/soccer/500/359.png`,
  'epl-astonvilla':    `${ESPN}/soccer/500/362.png`,
  'epl-bournemouth':   `${ESPN}/soccer/500/349.png`,
  'epl-brentford':     `${ESPN}/soccer/500/337.png`,
  'epl-brighton':      `${ESPN}/soccer/500/331.png`,
  'epl-chelsea':       `${ESPN}/soccer/500/363.png`,
  'epl-crystalpalace': `${ESPN}/soccer/500/384.png`,
  'epl-everton':       `${ESPN}/soccer/500/368.png`,
  'epl-fulham':        `${ESPN}/soccer/500/370.png`,
  'epl-ipswich':       `${ESPN}/soccer/500/373.png`,
  'epl-leicester':     `${ESPN}/soccer/500/375.png`,
  'epl-liverpool':     `${ESPN}/soccer/500/364.png`,
  'epl-mancity':       `${ESPN}/soccer/500/382.png`,
  'epl-manutd':        `${ESPN}/soccer/500/360.png`,
  'epl-newcastle':     `${ESPN}/soccer/500/361.png`,
  'epl-forest':        `${ESPN}/soccer/500/393.png`,
  'epl-southampton':   `${ESPN}/soccer/500/376.png`,
  'epl-spurs':         `${ESPN}/soccer/500/367.png`,
  'epl-westham':       `${ESPN}/soccer/500/371.png`,
  'epl-wolves':        `${ESPN}/soccer/500/380.png`,
  // 2025-26 promoted sides
  'epl-leeds':         `${ESPN}/soccer/500/357.png`,
  'epl-sunderland':    `${ESPN}/soccer/500/366.png`,
  'epl-burnley':       `${ESPN}/soccer/500/379.png`,

  // ── NFL ────────────────────────────────────────────────────────────────────
  // AFC East
  'nfl-bills':      `${ESPN}/nfl/500/buf.png`,
  'nfl-dolphins':   `${ESPN}/nfl/500/mia.png`,
  'nfl-patriots':   `${ESPN}/nfl/500/ne.png`,
  'nfl-jets':       `${ESPN}/nfl/500/nyj.png`,
  // AFC North
  'nfl-ravens':     `${ESPN}/nfl/500/bal.png`,
  'nfl-bengals':    `${ESPN}/nfl/500/cin.png`,
  'nfl-browns':     `${ESPN}/nfl/500/cle.png`,
  'nfl-steelers':   `${ESPN}/nfl/500/pit.png`,
  // AFC South
  'nfl-texans':     `${ESPN}/nfl/500/hou.png`,
  'nfl-colts':      `${ESPN}/nfl/500/ind.png`,
  'nfl-jaguars':    `${ESPN}/nfl/500/jax.png`,
  'nfl-titans':     `${ESPN}/nfl/500/ten.png`,
  // AFC West
  'nfl-broncos':    `${ESPN}/nfl/500/den.png`,
  'nfl-chiefs':     `${ESPN}/nfl/500/kc.png`,
  'nfl-raiders':    `${ESPN}/nfl/500/lv.png`,
  'nfl-chargers':   `${ESPN}/nfl/500/lac.png`,
  // NFC East
  'nfl-cowboys':    `${ESPN}/nfl/500/dal.png`,
  'nfl-giants':     `${ESPN}/nfl/500/nyg.png`,
  'nfl-eagles':     `${ESPN}/nfl/500/phi.png`,
  'nfl-commanders': `${ESPN}/nfl/500/wsh.png`,
  // NFC North
  'nfl-bears':      `${ESPN}/nfl/500/chi.png`,
  'nfl-lions':      `${ESPN}/nfl/500/det.png`,
  'nfl-packers':    `${ESPN}/nfl/500/gb.png`,
  'nfl-vikings':    `${ESPN}/nfl/500/min.png`,
  // NFC South
  'nfl-falcons':    `${ESPN}/nfl/500/atl.png`,
  'nfl-panthers':   `${ESPN}/nfl/500/car.png`,
  'nfl-saints':     `${ESPN}/nfl/500/no.png`,
  'nfl-buccaneers': `${ESPN}/nfl/500/tb.png`,
  // NFC West
  'nfl-cardinals':  `${ESPN}/nfl/500/ari.png`,
  'nfl-rams':       `${ESPN}/nfl/500/lar.png`,
  'nfl-seahawks':   `${ESPN}/nfl/500/sea.png`,
  'nfl-49ers':      `${ESPN}/nfl/500/sf.png`,

  // ── NBA ────────────────────────────────────────────────────────────────────
  // Atlantic
  'nba-celtics':     `${ESPN}/nba/500/bos.png`,
  'nba-nets':        `${ESPN}/nba/500/bkn.png`,
  'nba-knicks':      `${ESPN}/nba/500/ny.png`,
  'nba-76ers':       `${ESPN}/nba/500/phi.png`,
  'nba-raptors':     `${ESPN}/nba/500/tor.png`,
  // Central
  'nba-bulls':       `${ESPN}/nba/500/chi.png`,
  'nba-cavaliers':   `${ESPN}/nba/500/cle.png`,
  'nba-pistons':     `${ESPN}/nba/500/det.png`,
  'nba-pacers':      `${ESPN}/nba/500/ind.png`,
  'nba-bucks':       `${ESPN}/nba/500/mil.png`,
  // Southeast
  'nba-hawks':       `${ESPN}/nba/500/atl.png`,
  'nba-hornets':     `${ESPN}/nba/500/cha.png`,
  'nba-heat':        `${ESPN}/nba/500/mia.png`,
  'nba-magic':       `${ESPN}/nba/500/orl.png`,
  'nba-wizards':     `${ESPN}/nba/500/wsh.png`,
  // Northwest
  'nba-nuggets':      `${ESPN}/nba/500/den.png`,
  'nba-timberwolves': `${ESPN}/nba/500/min.png`,
  'nba-thunder':      `${ESPN}/nba/500/okc.png`,
  'nba-blazers':      `${ESPN}/nba/500/por.png`,
  'nba-jazz':         `${ESPN}/nba/500/utah.png`,
  // Pacific
  'nba-warriors':    `${ESPN}/nba/500/gs.png`,
  'nba-clippers':    `${ESPN}/nba/500/lac.png`,
  'nba-lakers':      `${ESPN}/nba/500/lal.png`,
  'nba-suns':        `${ESPN}/nba/500/phx.png`,
  'nba-kings':       `${ESPN}/nba/500/sac.png`,
  // Southwest
  'nba-mavericks':   `${ESPN}/nba/500/dal.png`,
  'nba-rockets':     `${ESPN}/nba/500/hou.png`,
  'nba-grizzlies':   `${ESPN}/nba/500/mem.png`,
  'nba-pelicans':    `${ESPN}/nba/500/no.png`,
  'nba-spurs':       `${ESPN}/nba/500/sa.png`,

  // ── MLB ────────────────────────────────────────────────────────────────────
  // AL East
  'mlb-yankees':   `${ESPN}/mlb/500/nyy.png`,
  'mlb-redsox':    `${ESPN}/mlb/500/bos.png`,
  'mlb-bluejays':  `${ESPN}/mlb/500/tor.png`,
  'mlb-rays':      `${ESPN}/mlb/500/tb.png`,
  'mlb-orioles':   `${ESPN}/mlb/500/bal.png`,
  // AL Central
  'mlb-whitesox':  `${ESPN}/mlb/500/chw.png`,
  'mlb-guardians': `${ESPN}/mlb/500/cle.png`,
  'mlb-tigers':    `${ESPN}/mlb/500/det.png`,
  'mlb-royals':    `${ESPN}/mlb/500/kc.png`,
  'mlb-twins':     `${ESPN}/mlb/500/min.png`,
  // AL West
  'mlb-astros':    `${ESPN}/mlb/500/hou.png`,
  'mlb-angels':    `${ESPN}/mlb/500/laa.png`,
  'mlb-athletics': `${ESPN}/mlb/500/ath.png`,
  'mlb-mariners':  `${ESPN}/mlb/500/sea.png`,
  'mlb-rangers':   `${ESPN}/mlb/500/tex.png`,
  // NL Central
  'mlb-cubs':      `${ESPN}/mlb/500/chc.png`,
  'mlb-reds':      `${ESPN}/mlb/500/cin.png`,
  'mlb-brewers':   `${ESPN}/mlb/500/mil.png`,
  'mlb-pirates':   `${ESPN}/mlb/500/pit.png`,
  'mlb-cardinals': `${ESPN}/mlb/500/stl.png`,
  // NL East
  'mlb-braves':    `${ESPN}/mlb/500/atl.png`,
  'mlb-marlins':   `${ESPN}/mlb/500/mia.png`,
  'mlb-mets':      `${ESPN}/mlb/500/nym.png`,
  'mlb-phillies':  `${ESPN}/mlb/500/phi.png`,
  'mlb-nationals': `${ESPN}/mlb/500/wsh.png`,
  // NL West
  'mlb-rockies':   `${ESPN}/mlb/500/col.png`,
  'mlb-dodgers':   `${ESPN}/mlb/500/lad.png`,
  'mlb-padres':    `${ESPN}/mlb/500/sd.png`,
  'mlb-giants':    `${ESPN}/mlb/500/sf.png`,
  'mlb-dbacks':    `${ESPN}/mlb/500/ari.png`,

  // ── NHL ────────────────────────────────────────────────────────────────────
  // Atlantic
  'nhl-bruins':      `${ESPN}/nhl/500/bos.png`,
  'nhl-sabres':      `${ESPN}/nhl/500/buf.png`,
  'nhl-redwings':    `${ESPN}/nhl/500/det.png`,
  'nhl-panthers':    `${ESPN}/nhl/500/fla.png`,
  'nhl-canadiens':   `${ESPN}/nhl/500/mtl.png`,
  'nhl-senators':    `${ESPN}/nhl/500/ott.png`,
  'nhl-lightning':   `${ESPN}/nhl/500/tb.png`,
  'nhl-leafs':       `${ESPN}/nhl/500/tor.png`,
  // Metropolitan
  'nhl-canes':       `${ESPN}/nhl/500/car.png`,
  'nhl-jackets':     `${ESPN}/nhl/500/cbj.png`,
  'nhl-devils':      `${ESPN}/nhl/500/nj.png`,
  'nhl-islanders':   `${ESPN}/nhl/500/nyi.png`,
  'nhl-rangers':     `${ESPN}/nhl/500/nyr.png`,
  'nhl-flyers':      `${ESPN}/nhl/500/phi.png`,
  'nhl-penguins':    `${ESPN}/nhl/500/pit.png`,
  'nhl-capitals':    `${ESPN}/nhl/500/wsh.png`,
  // Central
  'nhl-coyotes':     `${ESPN}/nhl/500/utah.png`,
  'nhl-blackhawks':  `${ESPN}/nhl/500/chi.png`,
  'nhl-avalanche':   `${ESPN}/nhl/500/col.png`,
  'nhl-stars':       `${ESPN}/nhl/500/dal.png`,
  'nhl-wild':        `${ESPN}/nhl/500/min.png`,
  'nhl-predators':   `${ESPN}/nhl/500/nsh.png`,
  'nhl-blues':       `${ESPN}/nhl/500/stl.png`,
  'nhl-jets':        `${ESPN}/nhl/500/wpg.png`,
  // Pacific
  'nhl-ducks':          `${ESPN}/nhl/500/ana.png`,
  'nhl-flames':         `${ESPN}/nhl/500/cgy.png`,
  'nhl-oilers':         `${ESPN}/nhl/500/edm.png`,
  'nhl-kings':          `${ESPN}/nhl/500/la.png`,
  'nhl-sharks':         `${ESPN}/nhl/500/sj.png`,
  'nhl-kraken':         `${ESPN}/nhl/500/sea.png`,
  'nhl-canucks':        `${ESPN}/nhl/500/van.png`,
  'nhl-goldenknights':  `${ESPN}/nhl/500/vgk.png`,

  // ── Formula 1 ───────────────────────────────────────────────────────────────
  // Championship entity (used in league-browse mode)
  'f1-championship': 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',
  // Driver headshots — Official F1 media CDN — 2025 driver portraits
  'f1_ver': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/verstappen.png',
  'f1_law': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/lawson.png',
  'f1_lec': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/leclerc.png',
  'f1_ham': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/hamilton.png',
  'f1_rus': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/russell.png',
  'f1_ant': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/antonelli.png',
  'f1_nor': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/norris.png',
  'f1_pia': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/piastri.png',
  'f1_alo': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/alonso.png',
  'f1_str': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/stroll.png',
  'f1_gas': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/gasly.png',
  'f1_doo': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/doohan.png',
  'f1_alb': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/albon.png',
  'f1_sai': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/sainz.png',
  'f1_tsu': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/tsunoda.png',
  'f1_had': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/hadjar.png',
  'f1_oco': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/ocon.png',
  'f1_bea': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/bearman.png',
  'f1_hul': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/hulkenberg.png',
  'f1_bor': 'https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_320/content/dam/fom-website/drivers/2025Drivers/bortoleto.png',

  // ── Formula 1 (constructor logos) ──────────────────────────────────────────
  'f1-team-redbull':     'https://a.espncdn.com/i/teamlogos/f1/500/red_bull.png',
  'f1-team-ferrari':     'https://a.espncdn.com/i/teamlogos/f1/500/ferrari.png',
  'f1-team-mercedes':    'https://a.espncdn.com/i/teamlogos/f1/500/mercedes.png',
  'f1-team-mclaren':     'https://a.espncdn.com/i/teamlogos/f1/500/mclaren.png',
  'f1-team-astonmartin': 'https://a.espncdn.com/i/teamlogos/f1/500/aston_martin.png',
  'f1-team-alpine':      'https://a.espncdn.com/i/teamlogos/f1/500/alpine.png',
  'f1-team-williams':    'https://a.espncdn.com/i/teamlogos/f1/500/williams.png',
  'f1-team-racingbulls': 'https://a.espncdn.com/i/teamlogos/f1/500/racing_bulls.png',
  'f1-team-haas':        'https://a.espncdn.com/i/teamlogos/f1/500/haas.png',
  'f1-team-sauber':      'https://a.espncdn.com/i/teamlogos/f1/500/sauber.png',

};
