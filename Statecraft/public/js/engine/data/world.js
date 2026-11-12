// How the world stands at the start: real alliances and trade blocs, rivalries, sanctions, elections,
// shipping chokepoints and the technology fields.

const NATO = ['usa', 'can', 'gbr', 'fra', 'deu', 'ita', 'esp', 'nld', 'bel', 'pol', 'nor', 'dnk', 'tur', 'prt', 'cze', 'rou', 'swe', 'fin'];
const EU = ['deu', 'fra', 'ita', 'esp', 'nld', 'bel', 'pol', 'swe', 'irl', 'aut', 'dnk', 'rou', 'cze', 'prt', 'fin'];

export const START_ALLIANCES = [
  { name: 'NATO', kind: 'military', members: NATO },
  { name: 'CSTO', kind: 'military', members: ['rus', 'kaz'] },
  { name: 'US–Japan Security Treaty', kind: 'military', members: ['usa', 'jpn'] },
  { name: 'US–ROK Mutual Defense Treaty', kind: 'military', members: ['usa', 'kor'] },
  { name: 'ANZUS', kind: 'military', members: ['usa', 'aus'] },
  { name: 'US–Philippines Mutual Defense Treaty', kind: 'military', members: ['usa', 'phl'] },
  { name: 'European Union', kind: 'economic', members: EU },
  { name: 'USMCA', kind: 'economic', members: ['usa', 'can', 'mex'] },
  { name: 'ASEAN', kind: 'economic', members: ['idn', 'tha', 'sgp', 'mys', 'phl', 'vnm'] },
  { name: 'Mercosur', kind: 'economic', members: ['bra', 'arg'] },
  { name: 'Gulf Cooperation Council', kind: 'economic', members: ['sau', 'are'] },
];

// Starting relations beyond what alliances give (pairs not listed start near 0)
export const START_RELATIONS = {
  'usa chn': -35, 'usa rus': -60, 'usa irn': -85, 'usa isr': 70, 'usa ind': 30, 'usa sau': 35, 'usa twn': 55,
  'usa vnm': 20, 'usa pak': 0, 'usa egy': 25, 'usa are': 40, 'usa irq': 10, 'usa sgp': 45,
  'chn rus': 50, 'chn pak': 65, 'chn irn': 35, 'chn twn': -65, 'chn jpn': -35, 'chn ind': -30, 'chn phl': -40,
  'chn vnm': -15, 'chn kor': -5, 'chn aus': -15, 'chn kaz': 35, 'chn bgd': 20, 'chn sau': 25, 'chn egy': 20,
  'rus pol': -75, 'rus fin': -55, 'rus gbr': -65, 'rus deu': -50, 'rus fra': -50, 'rus swe': -50, 'rus ind': 35,
  'rus irn': 50, 'rus kaz': 40, 'rus tur': 10, 'rus jpn': -40, 'rus nor': -40, 'rus dnk': -40, 'rus rou': -45,
  'ind pak': -80, 'ind bgd': 10, 'ind jpn': 35, 'ind are': 30, 'ind isr': 30, 'ind irn': 15,
  'isr irn': -95, 'isr tur': -40, 'isr egy': 5, 'isr are': 25, 'isr sau': -5, 'isr irq': -40,
  'sau irn': -30, 'sau are': 50, 'sau egy': 40, 'sau pak': 45,
  'irn irq': 35, 'irn are': -10, 'irq kaz': 0,
  'jpn kor': 15, 'jpn twn': 45, 'jpn phl': 30, 'jpn aus': 40,
  'gbr arg': -25, 'tur egy': -10, 'tur grc': 0, 'kor twn': 10, 'aus phl': 20, 'vnm phl': 10, 'mys sgp': 30,
  'bra arg': 20, 'col per': 15, 'chl arg': 10, 'chl per': 5, 'mex col': 10,
};

// Sanctioner > target, in force at the start
export const START_SANCTIONS = [
  ...['usa', 'can', 'gbr', 'jpn', 'kor', 'aus', 'che', 'nor', 'twn', 'sgp', ...EU].map((c) => [c, 'rus']),
  ...['usa', 'can', 'gbr', 'aus', 'jpn', ...EU].map((c) => [c, 'irn']),
];

// Weeks from 4 January 2027 to each democracy's next national election (others get one every four years)
export const ELECTIONS = {
  fra: 15, fin: 15, esp: 30, ita: 37, pol: 41, arg: 42, che: 42, twn: 54, tur: 70, aus: 70, phl: 70, mys: 60,
  usa: 96, rou: 100, jpn: 85, ind: 125, gbr: 135, deu: 112, can: 145, nld: 130, bel: 75, cze: 148, chl: 150,
  zaf: 120, idn: 110, kor: 175, mex: 180, bra: 196, swe: 192, irl: 105, isr: 190, aut: 140, nor: 140, dnk: 190,
  col: 175, prt: 120, per: 225, pak: 135, bgd: 160, irq: 150, tha: 60,
};

export const TECH_FIELDS = {
  industry: { name: 'Industry', note: 'Faster economic growth' },
  army: { name: 'Land warfare', note: 'Stronger armies' },
  air: { name: 'Air power', note: 'Better aircraft and air defence' },
  naval: { name: 'Naval', note: 'Stronger fleets' },
  missile: { name: 'Missiles', note: 'More accurate strikes and interceptors' },
  cyber: { name: 'Cyber & intelligence', note: 'Covert operations succeed more and are caught less' },
  energy: { name: 'Energy transition', note: 'Less oil, gas and coal needed' },
  nuclear: { name: 'Nuclear', note: 'Cheaper reactors; a weapons programme moves faster' },
};

// Demand leans: how much more than its economy's size a country needs of a resource
export const DEMAND_TILT = {
  coal: { chn: 3.6, ind: 3.2, zaf: 4, pol: 2.2, kaz: 3, vnm: 2.5, idn: 1.4, kor: 1.3, tur: 1.3, jpn: 0.8, rus: 1.4, usa: 0.5, deu: 0.5, aus: 0.8, twn: 1.4, mys: 1.2, phl: 1.4, tha: 1.0, cze: 1.6, pak: 1.0 },
  iron: { chn: 3.6, ind: 1.8, jpn: 1.4, kor: 2.2, rus: 1.4, tur: 1.6, vnm: 1.8, irn: 1.5, usa: 0.4, deu: 0.9, bra: 1.2 },
  rare: { chn: 3.2, jpn: 1.8, kor: 1.5, deu: 1.2, usa: 0.8 },
  metal: { chn: 2.6, jpn: 1.2, kor: 1.4, deu: 1.1, usa: 0.8, ind: 1.0, twn: 1.2 },
  chip: { chn: 1.6, usa: 1.0, twn: 1.2, kor: 1.5, jpn: 1.2, deu: 1.0, vnm: 1.3, mys: 1.4, mex: 1.1, sgp: 1.3, ind: 0.8 },
  gas: { rus: 2.2, irn: 3.0, sau: 1.5, are: 1.8, egy: 2.0, uzb: 2, deu: 0.9, ita: 1.2, nld: 1.4, gbr: 1.0, jpn: 1.0, kor: 1.0, chn: 0.7, ind: 0.4, usa: 1.0, can: 1.2, mex: 1.2, arg: 1.6, pak: 1.5, bgd: 1.6, tha: 1.4, mys: 1.4, tur: 1.2, kaz: 1.2, irq: 0.6, dnk: 0.3, swe: 0.1, fin: 0.3, nor: 0.5, che: 0.3 },
  oil: { sau: 1.3, irn: 1.0, sgp: 2.0, usa: 0.8, chn: 1.0, ind: 1.2, rus: 0.9 },
};

// Shipping lanes a country can close by holding one of the listed provinces
export const CHOKEPOINTS = {
  hormuz: {
    name: 'Strait of Hormuz', regions: ['irn-hz', 'm-oman'],
    note: 'A fifth of the world\'s oil leaves the Gulf through it.',
    exportCut: { nations: ['sau', 'are', 'irq', 'irn', 'm-kuwait', 'm-qatar', 'm-bahrain'], res: ['oil', 'gas'], factor: 0.35 },
  },
  malacca: {
    name: 'Strait of Malacca', regions: ['sgp-sg', 'idn-sm', 'mys-kl'],
    note: 'East Asia\'s oil and trade with Europe and the Gulf passes through it.',
    importCut: { nations: ['chn', 'jpn', 'kor', 'twn'], factor: 0.25 },
  },
  suez: {
    name: 'Suez Canal', regions: ['egy-sz'],
    note: 'The short route between Europe and Asia.',
    priceShock: 0.12, growthDrag: 0.3,
  },
  bab: {
    name: 'Bab el-Mandeb', regions: ['m-yemen', 'm-djibouti'],
    note: 'The Red Sea\'s southern gate, on the way to Suez.',
    priceShock: 0.08, growthDrag: 0.15,
  },
  bosporus: {
    name: 'Turkish Straits', regions: ['tur-is'],
    note: 'The Black Sea\'s only way out: Russian and Ukrainian grain and oil.',
    exportCut: { nations: ['rus', 'm-ukraine', 'm-georgia', 'rou'], res: ['food', 'oil'], factor: 0.5 },
  },
  panama: {
    name: 'Panama Canal', regions: ['m-panama'],
    note: 'Links the Atlantic and the Pacific.',
    priceShock: 0.04, growthDrag: 0.15,
  },
  gibraltar: {
    name: 'Strait of Gibraltar', regions: ['esp-an', 'm-morocco'],
    note: 'The Mediterranean\'s western gate.',
    priceShock: 0.05, growthDrag: 0.1,
  },
};
