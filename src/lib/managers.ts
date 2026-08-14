/**
 * Head coach / manager lookup — keyed by internal team ID.
 *
 * Used by both the API route and the standalone generation scripts so
 * every preview path (heartbeat, regen, on-demand) gets the same data.
 *
 * Update when managers change mid-season. The model will only name coaches
 * that appear in the HEAD COACHES data-block line — names here are the
 * authoritative, verified source.
 */

export const MANAGER: Record<string, string> = {
  // EPL
  'epl-arsenal':       'Mikel Arteta',
  'epl-astonvilla':    'Unai Emery',
  'epl-bournemouth':   'Andoni Iraola',
  'epl-brentford':     'Thomas Frank',
  'epl-brighton':      'Fabian Hürzeler',
  'epl-burnley':       'Scott Parker',
  'epl-chelsea':       'Enzo Maresca',
  'epl-crystalpalace': 'Oliver Glasner',
  'epl-everton':       'Sean Dyche',
  'epl-fulham':        'Marco Silva',
  'epl-leeds':         'Daniel Farke',
  'epl-liverpool':     'Arne Slot',
  'epl-mancity':       'Pep Guardiola',
  'epl-manutd':        'Ruben Amorim',
  'epl-newcastle':     'Eddie Howe',
  'epl-forest':        'Nuno Espírito Santo',
  'epl-spurs':         'Ange Postecoglou',
  'epl-sunderland':    'Régis Le Bris',
  'epl-westham':       'Graham Potter',
  'epl-wolves':        'Vítor Pereira',
  // AFL
  'afl-lions':         'Chris Fagan',
  'afl-swans':         'John Longmire',
  'afl-cats':          'Chris Scott',
  'afl-pies':          'Craig McRae',
  'afl-blues':         'Michael Voss',
  'afl-demons':        'Simon Goodwin',
  'afl-dogs':          'Luke Beveridge',
  'afl-tigers':        'Adem Yze',
  'afl-hawks':         'Sam Mitchell',
  'afl-bombers':       'Brad Scott',
  'afl-crows':         'Matthew Nicks',
  'afl-power':         'Ken Hinkley',
  'afl-dockers':       'Justin Longmuir',
  'afl-giants':        'Adam Kingsley',
  'afl-suns':          'Damien Hardwick',
  'afl-kangaroos':     'Alastair Clarkson',
  'afl-saints':        'Ross Lyon',
  'afl-eagles':        'Andrew McQualter',
  // NRL
  'nrl-broncos':       'Michael Maguire',
  'nrl-storm':         'Craig Bellamy',
  'nrl-panthers':      'Ivan Cleary',
  'nrl-roosters':      'Trent Robinson',
  'nrl-rabbitohs':     'Wayne Bennett',
  'nrl-sharks':        'Craig Fitzgibbon',
  'nrl-raiders':       'Ricky Stuart',
  'nrl-eels':          'Jason Ryles',
  'nrl-bulldogs':      'Cameron Ciraldo',
  'nrl-knights':       'Adam O\'Brien',
  'nrl-warriors':      'Andrew Webster',
  'nrl-cowboys':       'Todd Payten',
  'nrl-titans':        'Des Hasler',
  'nrl-dolphins':      'Kristian Woolf',
  'nrl-seahawks':      'Anthony Seibold',
  'nrl-dragons':       'Shane Flanagan',
  'nrl-tigers':        'Benji Marshall',
  // Super Rugby
  'sru-crusaders':     'Scott Robertson',
  'sru-chiefs':        'Clayton McMillan',
  'sru-blues':         'Vern Cotter',
  'sru-hurricanes':    'Clark Laidlaw',
  'sru-highlanders':   'Clarke Dermody',
  'sru-brumbies':      'Stephen Larkham',
  'sru-reds':          'Les Kiss',
  'sru-waratahs':      'Darren Coleman',
  'sru-force':         'Simon Cron',
  // International Rugby
  'rint-wallabies':    'Joe Schmidt',
  'rint-allblacks':    'Scott Robertson',
  'rint-boks':         'Rassie Erasmus',
  'rint-england':      'Steve Borthwick',
  'rint-ireland':      'Andy Farrell',
  'rint-france':       'Fabien Galthié',
  'rint-scotland':     'Gregor Townsend',
  'rint-wales':        'Mike Ruddock',
  'rint-argentina':    'Felipe Contepomi',
};

/** Look up the head coach/manager name for a team, by internal team ID. */
export function lookupManager(teamId: string): string | undefined {
  return MANAGER[teamId];
}
