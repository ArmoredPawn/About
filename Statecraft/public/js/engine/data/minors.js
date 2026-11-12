// Every other country on the map: a neutral nation run by the game. Each is one province.
// Keyed by the map feature name. Row: display name, population M, GDP $B, troops K, resources, extras
//   extras: g:<id> a playable country that guarantees it (treaty or close patron), cp:<chokepoint>, n:<warheads>
// Map features not listed here become tiny neutral states with default values.

const ROWS = {
  'Ukraine': ['Ukraine', 37, 205, 800, 'food:80 iron:40/60 coal:25 gas:18 uran:0.5 metal:0.05/0.3 rare:0/2'],
  'Belarus': ['Belarus', 9.1, 75, 48, 'food:9', 'g:rus'],
  'Kuwait': ['Kuwait', 4.9, 160, 17, 'oil:2.5/3 gas:16', 'g:usa'],
  'Qatar': ['Qatar', 3.0, 220, 17, 'oil:1.3 gas:180/250', 'g:usa'],
  'Oman': ['Oman', 5.3, 105, 43, 'oil:1.0 gas:40', 'cp:hormuz'],
  'Bahrain': ['Bahrain', 1.6, 47, 8, 'oil:0.2', 'g:sau'],
  'Libya': ['Libya', 7.4, 45, 30, 'oil:1.3/2 gas:12'],
  'Algeria': ['Algeria', 46, 268, 140, 'oil:1.2 gas:100 food:5 iron:0/5'],
  'Nigeria': ['Nigeria', 230, 188, 140, 'oil:1.5/2.2 gas:45/80 food:30'],
  'Angola': ['Angola', 37, 115, 107, 'oil:1.1 gas:8 food:3'],
  'Venezuela': ['Venezuela', 28, 100, 123, 'oil:0.9/3.0 gas:25 iron:5'],
  'North Korea': ['North Korea', 26, 25, 1280, 'coal:20 rare:0/20 metal:0.05 food:5', 'g:chn n:50'],
  'Dem. Rep. Congo': ['DR Congo', 110, 70, 135, 'metal:4.0/5'],
  'Zambia': ['Zambia', 21, 28, 15, 'metal:0.8/1.2'],
  'Zimbabwe': ['Zimbabwe', 17, 40, 30, 'metal:0.3/0.5 food:2'],
  'Namibia': ['Namibia', 3, 13, 10, 'uran:7/8'],
  'Niger': ['Niger', 27, 20, 33, 'uran:2/4'],
  'Myanmar': ['Myanmar', 54, 65, 150, 'rare:31 gas:17 food:30 metal:0.1'],
  'Mongolia': ['Mongolia', 3.5, 23, 10, 'coal:80 metal:0.4/0.8'],
  'Bolivia': ['Bolivia', 12.5, 50, 34, 'gas:13 metal:0.2/2 food:3'],
  'Guinea': ['Guinea', 14.5, 25, 10, 'iron:10/120 metal:0.3'],
  'Mauritania': ['Mauritania', 5, 11, 16, 'iron:13'],
  'Turkmenistan': ['Turkmenistan', 7, 80, 36, 'gas:80/120 oil:0.25'],
  'Uzbekistan': ['Uzbekistan', 37, 115, 48, 'gas:50 uran:4 metal:0.2 food:8'],
  'Azerbaijan': ['Azerbaijan', 10, 75, 64, 'oil:0.6 gas:37'],
  'Georgia': ['Georgia', 3.7, 33, 20, ''],
  'Armenia': ['Armenia', 3, 26, 45, ''],
  'Syria': ['Syria', 23, 20, 100, 'oil:0.03'],
  'Lebanon': ['Lebanon', 5.5, 20, 60, ''],
  'Jordan': ['Jordan', 11.5, 55, 100, ''],
  'Yemen': ['Yemen', 40, 19, 40, '', 'cp:bab'],
  'Afghanistan': ['Afghanistan', 42, 17, 150, 'metal:0/1 rare:0/5'],
  'Ethiopia': ['Ethiopia', 130, 115, 160, 'food:30'],
  'Kenya': ['Kenya', 56, 130, 24, 'food:5'],
  'Tanzania': ['Tanzania', 69, 85, 27, 'gas:0/20 food:10 metal:0.05'],
  'Ghana': ['Ghana', 35, 85, 16, 'oil:0.15 gas:3 metal:0.1'],
  "Côte d'Ivoire": ["Côte d'Ivoire", 31, 95, 27, 'oil:0.05 food:3'],
  'Morocco': ['Morocco', 38, 160, 195, 'food:8 metal:0.1', 'cp:gibraltar'],
  'W. Sahara': ['Western Sahara', 0.6, 1, 5, ''],
  'Tunisia': ['Tunisia', 12, 52, 36, ''],
  'Sudan': ['Sudan', 50, 30, 100, 'oil:0.05 food:6'],
  'S. Sudan': ['South Sudan', 11, 4, 50, 'oil:0.15'],
  'Chad': ['Chad', 19, 18, 33, 'oil:0.1'],
  'Cameroon': ['Cameroon', 29, 52, 25, 'oil:0.06'],
  'Gabon': ['Gabon', 2.5, 21, 5, 'oil:0.2 metal:0.1'],
  'Congo': ['Republic of the Congo', 6, 15, 10, 'oil:0.27'],
  'Eq. Guinea': ['Equatorial Guinea', 1.8, 12, 2, 'oil:0.1'],
  'Senegal': ['Senegal', 18.5, 33, 14, 'oil:0.1 gas:0/2'],
  'Mali': ['Mali', 24, 21, 20, 'metal:0.1'],
  'Burkina Faso': ['Burkina Faso', 23.5, 22, 11, ''],
  'Uganda': ['Uganda', 49, 55, 45, 'oil:0/0.2'],
  'Rwanda': ['Rwanda', 14, 14, 33, ''],
  'Burundi': ['Burundi', 13.7, 3, 30, ''],
  'Somalia': ['Somalia', 19, 12, 15, ''],
  'Somaliland': ['Somaliland', 5.7, 3, 10, ''],
  'Eritrea': ['Eritrea', 3.7, 2.5, 200, ''],
  'Djibouti': ['Djibouti', 1.2, 4, 10, '', 'cp:bab'],
  'Madagascar': ['Madagascar', 31, 17, 14, 'metal:0.05 rare:0/2'],
  'Mozambique': ['Mozambique', 34, 22, 11, 'gas:5/60 coal:15'],
  'Malawi': ['Malawi', 21, 11, 11, ''],
  'Botswana': ['Botswana', 2.5, 20, 9, ''],
  'Lesotho': ['Lesotho', 2.3, 2.3, 2, ''],
  'eSwatini': ['Eswatini', 1.2, 4.8, 3, ''],
  'Benin': ['Benin', 14, 21, 12, ''],
  'Togo': ['Togo', 9, 10, 9, ''],
  'Liberia': ['Liberia', 5.6, 4.8, 2, 'iron:4/10'],
  'Sierra Leone': ['Sierra Leone', 8.8, 4, 9, 'iron:0/10 metal:0.05'],
  'Guinea-Bissau': ['Guinea-Bissau', 2.2, 2, 4, ''],
  'Gambia': ['Gambia', 2.8, 2.5, 1, ''],
  'Cabo Verde': ['Cabo Verde', 0.5, 2.6, 1, ''],
  'Central African Rep.': ['Central African Republic', 5.5, 3, 9, ''],
  'Comoros': ['Comoros', 0.9, 1.5, 0.5, ''],
  'Mauritius': ['Mauritius', 1.3, 15, 0.5, ''],
  'Seychelles': ['Seychelles', 0.1, 2.2, 0.5, ''],
  'São Tomé and Principe': ['São Tomé and Príncipe', 0.2, 0.7, 0.3, ''],
  'Greece': ['Greece', 10.4, 257, 130, 'food:7'],
  'Hungary': ['Hungary', 9.6, 237, 41, 'food:14 gas:1'],
  'Slovakia': ['Slovakia', 5.4, 140, 16, 'food:4'],
  'Bulgaria': ['Bulgaria', 6.4, 115, 37, 'coal:25 food:10'],
  'Serbia': ['Serbia', 6.6, 90, 28, 'food:10 coal:35 metal:0.1/0.4'],
  'Croatia': ['Croatia', 3.9, 95, 15, ''],
  'Slovenia': ['Slovenia', 2.1, 72, 7, ''],
  'Bosnia and Herz.': ['Bosnia and Herzegovina', 3.2, 30, 10, 'coal:15'],
  'Montenegro': ['Montenegro', 0.6, 8, 2, ''],
  'Albania': ['Albania', 2.7, 27, 7, ''],
  'Macedonia': ['North Macedonia', 1.8, 16, 8, ''],
  'Kosovo': ['Kosovo', 1.6, 11, 3, ''],
  'Moldova': ['Moldova', 2.4, 19, 5, ''],
  'Lithuania': ['Lithuania', 2.9, 85, 23, '', 'g:pol'],
  'Latvia': ['Latvia', 1.9, 46, 8, ''],
  'Estonia': ['Estonia', 1.4, 44, 7, ''],
  'Iceland': ['Iceland', 0.4, 34, 0.3, ''],
  'Luxembourg': ['Luxembourg', 0.67, 93, 1, ''],
  'Malta': ['Malta', 0.55, 25, 2, ''],
  'Cyprus': ['Cyprus', 1.0, 37, 12, '', 'g:gbr'],
  'N. Cyprus': ['Northern Cyprus', 0.4, 5, 3, '', 'g:tur'],
  'Cambodia': ['Cambodia', 17.6, 50, 125, 'food:10'],
  'Laos': ['Laos', 7.8, 16, 29, 'metal:0.05'],
  'Sri Lanka': ['Sri Lanka', 22, 98, 150, 'food:5'],
  'Nepal': ['Nepal', 30.5, 43, 95, 'food:7'],
  'Bhutan': ['Bhutan', 0.8, 3.3, 8, ''],
  'Brunei': ['Brunei', 0.46, 16, 7, 'oil:0.1 gas:12'],
  'Timor-Leste': ['Timor-Leste', 1.4, 2, 2, 'gas:0/5'],
  'Papua New Guinea': ['Papua New Guinea', 10.3, 32, 4, 'gas:11 metal:0.15'],
  'Kyrgyzstan': ['Kyrgyzstan', 7.2, 17, 11, 'metal:0.05'],
  'Tajikistan': ['Tajikistan', 10.5, 14, 9, ''],
  'Maldives': ['Maldives', 0.5, 7, 4, ''],
  'Palestine': ['Palestine', 5.5, 13, 10, ''],
  'Ecuador': ['Ecuador', 18, 125, 40, 'oil:0.47 food:3'],
  'Paraguay': ['Paraguay', 6.9, 45, 14, 'food:12'],
  'Uruguay': ['Uruguay', 3.4, 82, 21, 'food:4'],
  'Guyana': ['Guyana', 0.83, 25, 3.4, 'oil:0.65/1.3'],
  'Suriname': ['Suriname', 0.63, 4.4, 2, 'oil:0.02/0.2'],
  'Cuba': ['Cuba', 11, 100, 49, 'metal:0.05'],
  'Dominican Rep.': ['Dominican Republic', 11.4, 125, 56, ''],
  'Haiti': ['Haiti', 11.8, 25, 1, ''],
  'Jamaica': ['Jamaica', 2.8, 20, 6, 'metal:0.02'],
  'Trinidad and Tobago': ['Trinidad and Tobago', 1.5, 28, 5, 'gas:25 oil:0.06'],
  'Bahamas': ['Bahamas', 0.4, 15, 1.5, ''],
  'Barbados': ['Barbados', 0.28, 7, 0.6, ''],
  'Guatemala': ['Guatemala', 18, 115, 18, 'food:2'],
  'Honduras': ['Honduras', 10.6, 37, 15, ''],
  'El Salvador': ['El Salvador', 6.3, 37, 25, ''],
  'Nicaragua': ['Nicaragua', 6.9, 20, 12, ''],
  'Costa Rica': ['Costa Rica', 5.2, 95, 0.5, ''],
  'Panama': ['Panama', 4.5, 90, 1, '', 'cp:panama g:usa'],
  'Belize': ['Belize', 0.4, 3.3, 1, ''],
  'New Zealand': ['New Zealand', 5.3, 260, 9, 'food:1 gas:4', 'g:aus'],
  'Cook Is.': ['New Zealand', 0, 0, 0, ''],
  'Niue': ['New Zealand', 0, 0, 0, ''],
  'Fiji': ['Fiji', 0.9, 6, 4, ''],
};

// Several features can share one display name (New Zealand's islands): they become one nation
export const MINORS = {};
for (const [feature, [name, pop, gdp, troops, res, extra = '']] of Object.entries(ROWS)) {
  const id = `m-${slug(name)}`;
  const minor = MINORS[id] ??= { id, name, features: [], pop: 0, gdp: 0, troops: 0, resources: {}, guarantor: null, chokepoint: null, nukes: 0 };
  minor.features.push(feature);
  minor.pop += pop;
  minor.gdp += gdp;
  minor.troops += troops;
  for (const part of res.split(/\s+/).filter(Boolean)) {
    const [r, amounts] = part.split(':');
    const [cur, pot] = amounts.split('/').map(Number);
    minor.resources[r] = [cur, pot ?? cur];
  }
  for (const part of extra.split(/\s+/).filter(Boolean)) {
    const [k, v] = part.split(':');
    if (k === 'g') minor.guarantor = v;
    if (k === 'cp') minor.chokepoint = v;
    if (k === 'n') minor.nukes = Number(v);
  }
}

// A small state the table doesn't list (Caribbean and Pacific islands, European microstates)
export function defaultMinor(feature) {
  return { id: `m-${slug(feature)}`, name: feature, features: [feature], pop: 0.1, gdp: 1.5, troops: 0.3, resources: {}, guarantor: null, chokepoint: null, nukes: 0 };
}

export function slug(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Features that aren't part of the game at all (drawn as plain land)
export const IGNORED_FEATURES = ['Antarctica'];
