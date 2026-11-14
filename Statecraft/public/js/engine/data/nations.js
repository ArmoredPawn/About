// Every nation outside the 50 playable countries, as a full country the computer runs: its own budget, army,
// navy, research, diplomacy and wars. Their size, people, armed forces and resources come from minors.js (and
// the microstates in geo.js); the rest is filled in here from how rich each one is, with a short table of what
// can't be derived (flag, government, leader's title, and where in the world, for its generals' names).

import { MINORS } from './minors.js';
import { EXTRA_MINORS } from './geo.js';
import { COUNTRIES } from './countries.js';
import { PORTS } from './seas.js';

// name: iso2 flag code, government (d democracy, h hybrid, a autocracy), leader's title (P President,
// M Prime Minister, or the title itself), name pool for generals
const TABLE = {
  'Ukraine': ['ua', 'd', 'P', 'slav'], 'Belarus': ['by', 'a', 'P', 'slav'], 'Kuwait': ['kw', 'a', 'Emir', 'arab'],
  'Qatar': ['qa', 'a', 'Emir', 'arab'], 'Oman': ['om', 'a', 'Sultan', 'arab'], 'Bahrain': ['bh', 'a', 'King', 'arab'],
  'Libya': ['ly', 'h', 'M', 'arab'], 'Algeria': ['dz', 'h', 'P', 'arab'], 'Nigeria': ['ng', 'd', 'P', 'west'],
  'Angola': ['ao', 'h', 'P', 'lusa'], 'Venezuela': ['ve', 'a', 'P', 'lat'], 'North Korea': ['kp', 'a', 'Supreme Leader', 'kor'],
  'DR Congo': ['cd', 'h', 'P', 'cent'], 'Zambia': ['zm', 'd', 'P', 'south'], 'Zimbabwe': ['zw', 'h', 'P', 'south'],
  'Namibia': ['na', 'd', 'P', 'south'], 'Niger': ['ne', 'a', 'P', 'sahel'], 'Myanmar': ['mm', 'a', 'Senior General', 'sea'],
  'Mongolia': ['mn', 'd', 'P', 'mong'], 'Bolivia': ['bo', 'd', 'P', 'lat'], 'Guinea': ['gn', 'a', 'P', 'west'],
  'Mauritania': ['mr', 'h', 'P', 'sahel'], 'Turkmenistan': ['tm', 'a', 'P', 'turk'], 'Uzbekistan': ['uz', 'a', 'P', 'turk'],
  'Azerbaijan': ['az', 'a', 'P', 'turk'], 'Georgia': ['ge', 'h', 'M', 'cauc'], 'Armenia': ['am', 'd', 'M', 'cauc'],
  'Syria': ['sy', 'a', 'P', 'arab'], 'Lebanon': ['lb', 'h', 'P', 'arab'], 'Jordan': ['jo', 'h', 'King', 'arab'],
  'Yemen': ['ye', 'a', 'P', 'arab'], 'Afghanistan': ['af', 'a', 'Supreme Leader', 'afg'], 'Ethiopia': ['et', 'h', 'M', 'horn'],
  'Kenya': ['ke', 'd', 'P', 'east'], 'Tanzania': ['tz', 'h', 'P', 'east'], 'Ghana': ['gh', 'd', 'P', 'west'],
  "Côte d'Ivoire": ['ci', 'h', 'P', 'west'], 'Morocco': ['ma', 'h', 'King', 'arab'], 'Western Sahara': ['eh', 'a', 'P', 'arab'],
  'Tunisia': ['tn', 'h', 'P', 'arab'], 'Sudan': ['sd', 'a', 'P', 'arab'], 'South Sudan': ['ss', 'a', 'P', 'east'],
  'Chad': ['td', 'a', 'P', 'sahel'], 'Cameroon': ['cm', 'a', 'P', 'cent'], 'Gabon': ['ga', 'a', 'P', 'cent'],
  'Republic of the Congo': ['cg', 'a', 'P', 'cent'], 'Equatorial Guinea': ['gq', 'a', 'P', 'cent'], 'Senegal': ['sn', 'd', 'P', 'sahel'],
  'Mali': ['ml', 'a', 'P', 'sahel'], 'Burkina Faso': ['bf', 'a', 'P', 'sahel'], 'Uganda': ['ug', 'a', 'P', 'east'],
  'Rwanda': ['rw', 'a', 'P', 'east'], 'Burundi': ['bi', 'a', 'P', 'east'], 'Somalia': ['so', 'h', 'P', 'horn'],
  'Somaliland': [null, 'h', 'P', 'horn'], 'Eritrea': ['er', 'a', 'P', 'horn'], 'Djibouti': ['dj', 'a', 'P', 'horn'],
  'Madagascar': ['mg', 'h', 'P', 'east'], 'Mozambique': ['mz', 'h', 'P', 'lusa'], 'Malawi': ['mw', 'd', 'P', 'south'],
  'Botswana': ['bw', 'd', 'P', 'south'], 'Lesotho': ['ls', 'd', 'M', 'south'], 'Eswatini': ['sz', 'a', 'King', 'south'],
  'Benin': ['bj', 'h', 'P', 'west'], 'Togo': ['tg', 'a', 'P', 'west'], 'Liberia': ['lr', 'd', 'P', 'west'],
  'Sierra Leone': ['sl', 'd', 'P', 'west'], 'Guinea-Bissau': ['gw', 'h', 'P', 'lusa'], 'Gambia': ['gm', 'd', 'P', 'sahel'],
  'Cabo Verde': ['cv', 'd', 'M', 'lusa'], 'Central African Republic': ['cf', 'a', 'P', 'cent'], 'Comoros': ['km', 'h', 'P', 'east'],
  'Mauritius': ['mu', 'd', 'M', 'east'], 'Seychelles': ['sc', 'd', 'P', 'east'], 'São Tomé and Príncipe': ['st', 'd', 'M', 'lusa'],
  'Greece': ['gr', 'd', 'M', 'greek'], 'Hungary': ['hu', 'h', 'M', 'hun'], 'Slovakia': ['sk', 'd', 'M', 'slav'],
  'Bulgaria': ['bg', 'd', 'M', 'slav'], 'Serbia': ['rs', 'h', 'P', 'slav'], 'Croatia': ['hr', 'd', 'M', 'slav'],
  'Slovenia': ['si', 'd', 'M', 'slav'], 'Bosnia and Herzegovina': ['ba', 'd', 'M', 'slav'], 'Montenegro': ['me', 'd', 'M', 'slav'],
  'Albania': ['al', 'h', 'M', 'balk'], 'North Macedonia': ['mk', 'd', 'M', 'slav'], 'Kosovo': ['xk', 'd', 'M', 'balk'],
  'Moldova': ['md', 'd', 'P', 'rom'], 'Lithuania': ['lt', 'd', 'P', 'balt'], 'Latvia': ['lv', 'd', 'M', 'balt'],
  'Estonia': ['ee', 'd', 'M', 'balt'], 'Iceland': ['is', 'd', 'M', 'nord'], 'Luxembourg': ['lu', 'd', 'M', 'west-eu'],
  'Malta': ['mt', 'd', 'M', 'west-eu'], 'Cyprus': ['cy', 'd', 'P', 'greek'], 'Northern Cyprus': [null, 'h', 'P', 'turk'],
  'Cambodia': ['kh', 'a', 'M', 'sea'], 'Laos': ['la', 'a', 'P', 'sea'], 'Sri Lanka': ['lk', 'd', 'P', 'south-asia'],
  'Nepal': ['np', 'd', 'M', 'south-asia'], 'Bhutan': ['bt', 'd', 'King', 'south-asia'], 'Brunei': ['bn', 'a', 'Sultan', 'sea'],
  'Timor-Leste': ['tl', 'd', 'M', 'lusa'], 'Papua New Guinea': ['pg', 'd', 'M', 'pac'], 'Kyrgyzstan': ['kg', 'h', 'P', 'turk'],
  'Tajikistan': ['tj', 'a', 'P', 'afg'], 'Maldives': ['mv', 'h', 'P', 'south-asia'], 'Palestine': ['ps', 'h', 'P', 'arab'],
  'Ecuador': ['ec', 'd', 'P', 'lat'], 'Paraguay': ['py', 'd', 'P', 'lat'], 'Uruguay': ['uy', 'd', 'P', 'lat'],
  'Guyana': ['gy', 'd', 'P', 'carib'], 'Suriname': ['sr', 'd', 'P', 'carib'], 'Cuba': ['cu', 'a', 'P', 'lat'],
  'Dominican Republic': ['do', 'd', 'P', 'lat'], 'Haiti': ['ht', 'h', 'P', 'carib'], 'Jamaica': ['jm', 'd', 'M', 'carib'],
  'Trinidad and Tobago': ['tt', 'd', 'M', 'carib'], 'Bahamas': ['bs', 'd', 'M', 'carib'], 'Barbados': ['bb', 'd', 'M', 'carib'],
  'Guatemala': ['gt', 'd', 'P', 'lat'], 'Honduras': ['hn', 'd', 'P', 'lat'], 'El Salvador': ['sv', 'h', 'P', 'lat'],
  'Nicaragua': ['ni', 'a', 'P', 'lat'], 'Costa Rica': ['cr', 'd', 'P', 'lat'], 'Panama': ['pa', 'd', 'P', 'lat'],
  'Belize': ['bz', 'd', 'M', 'carib'], 'New Zealand': ['nz', 'd', 'M', 'anglo'], 'Fiji': ['fj', 'd', 'M', 'pac'],
  'Vatican': ['va', 'a', 'Pope', 'it'], 'Vanuatu': ['vu', 'd', 'M', 'pac'], 'Micronesia': ['fm', 'd', 'P', 'pac'],
  'Marshall Is.': ['mh', 'd', 'P', 'pac'], 'Tonga': ['to', 'd', 'M', 'pac'], 'Solomon Is.': ['sb', 'd', 'M', 'pac'],
  'San Marino': ['sm', 'd', 'Captain Regent', 'it'], 'Samoa': ['ws', 'd', 'M', 'pac'], 'St. Vin. and Gren.': ['vc', 'd', 'M', 'carib'],
  'Saint Lucia': ['lc', 'd', 'M', 'carib'], 'St. Kitts and Nevis': ['kn', 'd', 'M', 'carib'], 'Palau': ['pw', 'd', 'P', 'pac'],
  'Nauru': ['nr', 'd', 'P', 'pac'], 'Monaco': ['mc', 'd', 'Prince', 'west-eu'], 'Liechtenstein': ['li', 'd', 'Prince', 'west-eu'],
  'Kiribati': ['ki', 'd', 'P', 'pac'], 'Grenada': ['gd', 'd', 'M', 'carib'], 'Dominica': ['dm', 'd', 'M', 'carib'],
  'Antigua and Barb.': ['ag', 'd', 'M', 'carib'], 'Andorra': ['ad', 'd', 'M', 'west-eu'],
};

const NAMES = {
  slav: 'Kovalenko Zaluzhny Petrovic Horvat Novak Dimitrov Marchenko Syrsky',
  arab: 'Al-Sabah Haddad Mansour Khalil Nasser Saleh Hamdan Rahman',
  west: 'Adeyemi Okafor Mensah Boateng Diallo Koroma Owusu Danjuma',
  lusa: 'Santos Lourenço Dos Reis Mendes Cabral Pereira Nhaca Gomes',
  lat: 'Ramírez Herrera Morales Castillo Rojas Guzmán Ortega Medina',
  kor: 'Ri Pak Kim Choe Jong O Han Kang',
  cent: 'Mbeki Tshisekedi Kabila Biya Ondo Moukoko Nguema Lumbala',
  south: 'Banda Mwale Sithole Moyo Phiri Dlamini Nkosi Tembo',
  sahel: 'Traoré Goïta Keïta Touré Sall Ndiaye Diop Coulibaly',
  sea: 'Min Aung Than Sok Phan Hun Vong Thein',
  mong: 'Batbayar Ganbold Enkhbayar Tsogt Bold Erdene Sukh Dorj',
  turk: 'Aliyev Karimov Nazarov Rahimov Sadykov Ismayilov Yusupov Orazov',
  cauc: 'Beridze Kvaratskhelia Sargsyan Harutyunyan Gelashvili Avetisyan Lomidze Grigoryan',
  afg: 'Haqqani Akhund Rahimi Sharifi Karimi Ahmadzai Nazari Mirzai',
  horn: 'Abiy Tesfaye Mohamed Abdi Gebre Hassan Warsame Ali',
  east: 'Kenyatta Odhiambo Museveni Kagame Mwangi Kiprop Otieno Nyerere',
  greek: 'Papadopoulos Georgiou Konstantinou Nikolaou Dimitriou Floros Ioannou Christodoulou',
  hun: 'Nagy Kovács Szabó Tóth Horváth Varga Kiss Molnár',
  balk: 'Hoxha Berisha Kelmendi Krasniqi Gashi Shehu Leka Rama',
  rom: 'Popescu Rusu Ciobanu Munteanu Lungu Cebotari Moraru Turcan',
  balt: 'Kazlauskas Ozols Tamm Berzins Petrauskas Saar Kalnins Vaher',
  nord: 'Jónsson Sigurdsson Gudmundsson Magnússon Ólafsson Einarsson Björnsson Stefánsson',
  'west-eu': 'Weber Muller Borg Camilleri Schmit Hoffmann Vella Martin',
  'south-asia': 'Perera Silva Thapa Shrestha Dorji Gurung Fernando Rana',
  pac: 'Tuilagi Vaai Bainimarama Tupou Kalsakau Narokobi Sopoaga Fifita',
  carib: 'Holness Rowley Mottley Persaud Bouterse Moïse Gonsalves Browne',
  anglo: 'Short Gawn Rennie Mateparae Jones Keating Fraser Freyberg',
  it: 'Rossi Bianchi Colombo Ricci Marino Greco Gallo Conti',
};

// A muted colour of its own for each, so the 50 playable countries still stand out on the map
function colourFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const sat = 0.22 + ((hash >> 9) % 10) / 100;
  const light = 0.42 + ((hash >> 13) % 8) / 100;
  const k = (n) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const GOV = { d: 'democracy', h: 'hybrid', a: 'autocracy' };
const TITLE = { P: 'President', M: 'Prime Minister' };
const r1 = (v) => Math.round(v * 10) / 10;

function build(m) {
  const [iso2 = null, g = 'h', t = 'P', pool = 'west'] = TABLE[m.name] ?? [];
  const gov = GOV[g];
  const perHead = m.gdp * 1000 / Math.max(0.05, m.pop); // $ a person
  const rich = perHead > 25000;
  const poor = perHead < 4000;
  const tech = perHead < 1500 ? 2 : perHead < 4000 ? 3 : perHead < 10000 ? 4 : perHead < 25000 ? 5 : perHead < 45000 ? 6 : 7;
  const oil = (m.resources.oil?.[0] ?? 0) + (m.resources.gas?.[0] ?? 0) * 0.5;
  const coast = Boolean(PORTS[m.id]);
  const troops = Math.max(0.3, m.troops);
  return {
    id: m.id, rank: null, minor: true, name: m.name, iso2, title: TITLE[t] ?? t, color: colourFor(m.id),
    gdp: m.gdp, pop: m.pop,
    growth: poor ? 4 : rich ? 1.8 : 3, popGrowth: poor ? 2.3 : rich ? 0.4 : 1,
    debt: poor ? 60 : 55, gov,
    tax: rich ? 34 : poor ? 15 : 22, defence: gov === 'autocracy' ? 2.8 : 1.6, rate: poor ? 8 : rich ? 3 : 5,
    inflation: poor ? 7 : rich ? 2.5 : 4, approval: gov === 'autocracy' ? 60 : 44,
    standing: m.name === 'North Korea' ? 8 : gov === 'autocracy' ? 38 : rich ? 66 : 52,
    reserves: r1(m.gdp * (oil > 20 ? 0.6 : 0.12)),
    troops, reserveTroops: r1(troops * 0.8), tanks: Math.round(troops * 1.5),
    aircraft: Math.round(m.gdp * 0.12 + troops * 0.05), ships: coast ? Math.round(m.gdp / 40) : 0, carriers: 0,
    missiles: Math.round(m.gdp * 0.04 + troops * 0.05), nukes: m.nukes ?? 0, tech,
    energy: oil > 20 ? 1.6 : 1.2, uranium: m.name === 'Ukraine' ? 2 : 0, rents: oil > 20 ? 0.8 : 0.3,
    generals: (NAMES[pool] ?? NAMES.west).split(' '),
  };
}

export const NPC = Object.fromEntries(Object.values({ ...MINORS, ...EXTRA_MINORS }).map((m) => [m.id, build(m)]));
export const NPC_IDS = Object.keys(NPC);

// Every country on the map: the 50 playable ones and the rest
export const NATIONS = { ...COUNTRIES, ...NPC };

const NPC_BY_NAME = Object.fromEntries(Object.values(NPC).map((n) => [n.name, n.id]));
const idOf = (x) => (/^[a-z]{3}$/.test(x) ? x : NPC_BY_NAME[x]);

// Old friendships and feuds at the start, by name (or a playable country's id). No one is in an alliance yet.
const FEUDS = [
  ['Ukraine', 'rus', -85], ['Ukraine', 'pol', 60], ['Ukraine', 'usa', 45], ['Ukraine', 'gbr', 50], ['Ukraine', 'deu', 40], ['Ukraine', 'Belarus', -40],
  ['Belarus', 'rus', 75], ['Belarus', 'pol', -35], ['Belarus', 'Lithuania', -35],
  ['North Korea', 'kor', -85], ['North Korea', 'usa', -80], ['North Korea', 'jpn', -70], ['North Korea', 'chn', 55], ['North Korea', 'rus', 50],
  ['Syria', 'isr', -80], ['Syria', 'tur', -45], ['Syria', 'rus', 50], ['Syria', 'irn', 60], ['Syria', 'usa', -50],
  ['Lebanon', 'isr', -60], ['Palestine', 'isr', -90], ['Jordan', 'usa', 40], ['Jordan', 'sau', 40],
  ['Kuwait', 'irq', -30], ['Kuwait', 'usa', 45], ['Kuwait', 'sau', 50], ['Qatar', 'usa', 40], ['Qatar', 'tur', 45],
  ['Bahrain', 'irn', -50], ['Bahrain', 'sau', 60], ['Oman', 'irn', 20],
  ['Yemen', 'sau', -60], ['Yemen', 'usa', -40], ['Yemen', 'irn', 50],
  ['Armenia', 'Azerbaijan', -80], ['Azerbaijan', 'tur', 70], ['Armenia', 'rus', 30], ['Armenia', 'irn', 30],
  ['Georgia', 'rus', -50], ['Moldova', 'rus', -30], ['Moldova', 'rou', 70],
  ['Lithuania', 'rus', -55], ['Latvia', 'rus', -55], ['Estonia', 'rus', -55], ['Lithuania', 'pol', 50],
  ['Lithuania', 'usa', 50], ['Latvia', 'usa', 50], ['Estonia', 'usa', 50], ['Estonia', 'fin', 60],
  ['Serbia', 'Kosovo', -70], ['Serbia', 'rus', 45], ['Kosovo', 'usa', 55], ['Albania', 'Kosovo', 70], ['Croatia', 'Serbia', -30],
  ['Greece', 'tur', -35], ['Greece', 'Cyprus', 80], ['Cyprus', 'Northern Cyprus', -60], ['Northern Cyprus', 'tur', 85], ['Cyprus', 'tur', -50],
  ['Venezuela', 'usa', -65], ['Venezuela', 'Guyana', -55], ['Venezuela', 'Cuba', 70], ['Venezuela', 'rus', 45], ['Venezuela', 'chn', 40], ['Venezuela', 'col', -30],
  ['Cuba', 'usa', -60], ['Cuba', 'rus', 45], ['Nicaragua', 'usa', -45], ['Guyana', 'usa', 40], ['Panama', 'usa', 40],
  ['Bahamas', 'usa', 50], ['Guatemala', 'Belize', -30], ['Bolivia', 'chl', -30], ['Dominican Republic', 'Haiti', -30],
  ['Morocco', 'Algeria', -50], ['Morocco', 'Western Sahara', -70], ['Algeria', 'Western Sahara', 50], ['Morocco', 'usa', 40], ['Morocco', 'fra', 40], ['Algeria', 'rus', 40],
  ['Ethiopia', 'Eritrea', -50], ['Ethiopia', 'egy', -45], ['Sudan', 'South Sudan', -40], ['Somalia', 'Somaliland', -55],
  ['Ethiopia', 'Somaliland', 35], ['Somalia', 'tur', 50], ['Eritrea', 'egy', 30],
  ['DR Congo', 'Rwanda', -55], ['Rwanda', 'Burundi', -30], ['Chad', 'Sudan', -25],
  ['Mali', 'fra', -45], ['Niger', 'fra', -45], ['Burkina Faso', 'fra', -45], ['Mali', 'rus', 45], ['Niger', 'rus', 40], ['Burkina Faso', 'rus', 40],
  ['Mali', 'Algeria', -25], ['Mali', 'Burkina Faso', 60], ['Mali', 'Niger', 60], ['Burkina Faso', 'Niger', 60],
  ['Afghanistan', 'pak', -45], ['Afghanistan', 'usa', -60], ['Tajikistan', 'Afghanistan', -35], ['Kyrgyzstan', 'Tajikistan', -40],
  ['Myanmar', 'chn', 40], ['Myanmar', 'usa', -40], ['Cambodia', 'chn', 60], ['Cambodia', 'tha', -25], ['Laos', 'chn', 55], ['Laos', 'vnm', 55],
  ['Nepal', 'ind', 35], ['Bhutan', 'ind', 70], ['Sri Lanka', 'ind', 30], ['Sri Lanka', 'chn', 30], ['Mongolia', 'chn', 10],
  ['New Zealand', 'aus', 80], ['New Zealand', 'usa', 45], ['New Zealand', 'gbr', 60], ['Fiji', 'aus', 40], ['Papua New Guinea', 'aus', 55], ['Solomon Is.', 'chn', 40],
  ['Iceland', 'nor', 60], ['Iceland', 'usa', 45], ['Luxembourg', 'bel', 80], ['Luxembourg', 'deu', 60], ['Luxembourg', 'fra', 60],
  ['Malta', 'ita', 50], ['Monaco', 'fra', 85], ['Andorra', 'esp', 70], ['Andorra', 'fra', 70], ['San Marino', 'ita', 85],
  ['Vatican', 'ita', 85], ['Liechtenstein', 'che', 85], ['Slovakia', 'cze', 75], ['Bulgaria', 'rou', 40],
  ['Uruguay', 'arg', 40], ['Uruguay', 'bra', 40], ['Paraguay', 'bra', 30], ['Paraguay', 'arg', 30], ['Jamaica', 'gbr', 40],
  ['Kenya', 'usa', 40], ['Kenya', 'gbr', 40], ['Tanzania', 'chn', 40], ['Zimbabwe', 'chn', 45], ['Zimbabwe', 'gbr', -30], ['Angola', 'chn', 40],
  ['Namibia', 'zaf', 50], ['Botswana', 'zaf', 50], ['Lesotho', 'zaf', 70], ['Eswatini', 'zaf', 60], ['Mozambique', 'zaf', 40],
  ['Libya', 'tur', 40], ['Tunisia', 'Algeria', 40], ['Central African Republic', 'rus', 40], ['Djibouti', 'chn', 35], ['Djibouti', 'usa', 30],
  ['Senegal', 'fra', 30], ["Côte d'Ivoire", 'fra', 40], ['Ghana', 'Nigeria', 30],
];
export const NPC_RELATIONS = FEUDS.map(([a, b, v]) => [idOf(a), idOf(b), v]).filter(([a, b]) => a && b);

// Claims on a neighbour's land, which make a war to take it easier to justify
const CLAIMS = {
  'Morocco': ['Western Sahara'], 'Serbia': ['Kosovo'], 'Venezuela': ['Guyana'], 'Somalia': ['Somaliland'],
  'Cyprus': ['Northern Cyprus'], 'Guatemala': ['Belize'], 'North Korea': ['kor-se', 'kor-gw', 'kor-cc', 'kor-gs', 'kor-jl'],
};

// The trade bloc each nation and its neighbours may found during the game
export const BLOCS = {
  'West African Economic Community': ['Nigeria', 'Ghana', "Côte d'Ivoire", 'Senegal', 'Mali', 'Burkina Faso', 'Niger', 'Guinea', 'Benin', 'Togo', 'Liberia', 'Sierra Leone', 'Guinea-Bissau', 'Gambia', 'Cabo Verde'],
  'Central African Community': ['Cameroon', 'Gabon', 'Republic of the Congo', 'Equatorial Guinea', 'Chad', 'Central African Republic', 'DR Congo', 'São Tomé and Príncipe'],
  'East African Community': ['Kenya', 'Tanzania', 'Uganda', 'Rwanda', 'Burundi', 'South Sudan', 'Somalia', 'Ethiopia', 'Djibouti', 'Eritrea', 'Somaliland', 'Comoros', 'Seychelles', 'Madagascar', 'Mauritius'],
  'Southern African Union': ['Zambia', 'Zimbabwe', 'Namibia', 'Botswana', 'Lesotho', 'Eswatini', 'Malawi', 'Mozambique', 'Angola'],
  'Maghreb Union': ['Morocco', 'Algeria', 'Tunisia', 'Libya', 'Mauritania', 'Western Sahara'],
  'Gulf Council': ['Kuwait', 'Qatar', 'Bahrain', 'Oman'],
  'Arab Trade Council': ['Syria', 'Lebanon', 'Jordan', 'Palestine', 'Yemen', 'Sudan'],
  'Central Asian Union': ['Turkmenistan', 'Uzbekistan', 'Kyrgyzstan', 'Tajikistan', 'Afghanistan', 'Mongolia', 'Azerbaijan'],
  'Black Sea Partnership': ['Ukraine', 'Moldova', 'Georgia', 'Armenia'],
  'Balkan Free Trade Area': ['Serbia', 'Croatia', 'Slovenia', 'Bosnia and Herzegovina', 'Montenegro', 'Albania', 'North Macedonia', 'Kosovo', 'Bulgaria', 'Greece', 'Hungary', 'Slovakia'],
  'Baltic Council': ['Lithuania', 'Latvia', 'Estonia', 'Iceland'],
  'Mekong Partnership': ['Myanmar', 'Cambodia', 'Laos', 'Brunei', 'Timor-Leste'],
  'South Asian Association': ['Sri Lanka', 'Nepal', 'Bhutan', 'Maldives'],
  'Southern Cone Market': ['Bolivia', 'Ecuador', 'Paraguay', 'Uruguay', 'Venezuela'],
  'Central American Integration System': ['Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Belize'],
  'Caribbean Community': ['Cuba', 'Dominican Republic', 'Haiti', 'Jamaica', 'Trinidad and Tobago', 'Bahamas', 'Barbados', 'Guyana', 'Suriname', 'St. Vin. and Gren.', 'Saint Lucia', 'St. Kitts and Nevis', 'Grenada', 'Dominica', 'Antigua and Barb.'],
  'Pacific Islands Forum': ['New Zealand', 'Fiji', 'Papua New Guinea', 'Vanuatu', 'Micronesia', 'Marshall Is.', 'Tonga', 'Solomon Is.', 'Samoa', 'Palau', 'Nauru', 'Kiribati'],
};
for (const [bloc, names] of Object.entries(BLOCS)) for (const n of names) if (NPC_BY_NAME[n]) NPC[NPC_BY_NAME[n]].bloc = bloc;
for (const [n, claims] of Object.entries(CLAIMS)) if (NPC_BY_NAME[n]) NPC[NPC_BY_NAME[n]].claims = claims.map((x) => NPC_BY_NAME[x] ?? x);
