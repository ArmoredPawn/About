// The ground inside each province: forests, mountain passes, marshes, deserts and cities, and whether infantry
// and armour can get through. Some ground is widely thought impassable and so is lightly held: an attack
// through it, as through the Ardennes in May 1940, catches the defenders off guard.

import { PROVINCES, TERRAIN } from './data/regions.js';
import { MINOR_TERRAIN, REGION_NAMES } from './names.js';

const TERRAIN_OF = Object.fromEntries(PROVINCES.map((p) => [p.id, p.terrain]));

// Going for foot soldiers and for tanks: good, slow, hard, impassable
export const GOING = {
  good: { name: 'Good going', rank: 0 },
  slow: { name: 'Slow', rank: 1 },
  hard: { name: 'Very hard', rank: 2 },
  none: { name: 'Impassable', rank: 3 },
};

const BY_TERRAIN = {
  plains: { inf: 'good', arm: 'good', note: 'Open farmland and roads: ideal tank country.' },
  hills: { inf: 'good', arm: 'slow', note: 'Rolling hills and valleys give defenders ridgelines to hold.' },
  forest: { inf: 'slow', arm: 'hard', note: 'Dense woods: tanks are tied to the few roads.' },
  mountain: { inf: 'slow', arm: 'hard', note: 'Mountains: armies funnel through passes that a few defenders can hold.' },
  desert: { inf: 'slow', arm: 'good', note: 'Open desert: tanks move fast, infantry need water brought to them.' },
  jungle: { inf: 'hard', arm: 'none', note: 'Rainforest: no roads for armour, disease and ambush for infantry.' },
  marsh: { inf: 'hard', arm: 'none', note: 'Marsh and wetland: impassable to vehicles except in hard frost.' },
  urban: { inf: 'slow', arm: 'hard', note: 'Cities: every building a strongpoint, costly street by street.' },
  arctic: { inf: 'hard', arm: 'hard', note: 'Tundra and ice: cold, darkness and long supply lines.' },
};

// Named ground in particular provinces. surprise: defenders believe it impassable and leave it thin.
export const FEATURES = {
  'bel-wl': [{ name: 'The Ardennes', terrain: 'forest', inf: 'slow', arm: 'hard', surprise: true, note: 'Wooded hills and narrow roads the French high command thought tanks could not cross. In 1940 seven panzer divisions did, in three days.' }],
  'm-luxembourg': [{ name: 'The Ardennes (Oesling)', terrain: 'forest', inf: 'slow', arm: 'hard', surprise: true, note: 'The southern Ardennes: the route Germany took around the Maginot Line in 1940 and again in the Battle of the Bulge.' }],
  'fra-es': [{ name: 'The Vosges', terrain: 'mountain', inf: 'slow', arm: 'hard', note: 'Forested mountains along the Rhine; old Maginot Line forts still dot the plain to the north.' }, { name: 'The Lorraine gap', terrain: 'plains', inf: 'good', arm: 'good', note: 'The open corridor between Metz and Strasbourg, the classic invasion route.' }],
  'fra-ar': [{ name: 'The French Alps', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'High passes, snowbound half the year.' }],
  'fra-oc': [{ name: 'The Pyrenees', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'A wall between France and Spain crossed by a handful of roads.' }],
  'esp-ba': [{ name: 'The Pyrenees', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Few roads cross; the coast roads at Irun and Le Perthus carry nearly everything.' }],
  'che-be': [{ name: 'The National Redoubt', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Alpine fortresses built to hold out against any invader.' }],
  'che-ti': [{ name: 'The Gotthard and the high Alps', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Tunnels that defenders would blow before an enemy reached them.' }],
  'aut-al': [{ name: 'The Brenner Pass', terrain: 'mountain', inf: 'slow', arm: 'hard', note: 'The lowest pass over the main Alps: the road from Germany to Italy.' }],
  'ita-pi': [{ name: 'The Western Alps', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Peaks above 4,000 m guard the frontier with France.' }],
  'deu-he': [{ name: 'The Fulda Gap', terrain: 'hills', inf: 'good', arm: 'good', note: 'Lowland corridor toward Frankfurt that NATO expected Soviet tanks to pour through.' }],
  'pol-ea': [{ name: 'The Suwałki Gap', terrain: 'plains', inf: 'good', arm: 'good', note: 'A 65 km strip between Belarus and Kaliningrad: the Baltic states\' only land link to NATO.' }, { name: 'Białowieża Forest', terrain: 'forest', inf: 'slow', arm: 'hard', note: 'Primeval forest along the Belarusian border.' }],
  'm-belarus': [{ name: 'The Pripet Marshes', terrain: 'marsh', inf: 'hard', arm: 'none', note: 'Europe\'s largest wetland splits any invasion of the east in two.' }],
  'm-ukraine': [{ name: 'The steppe', terrain: 'plains', inf: 'good', arm: 'good', note: 'Open black-earth plains, though the spring mud (rasputitsa) stops wheels.' }, { name: 'The Dnipro', terrain: 'marsh', inf: 'hard', arm: 'hard', note: 'A great river barrier: every crossing is a battle.' }],
  'rus-ca': [{ name: 'The Greater Caucasus', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'The range Hitler\'s armies failed to cross to reach Baku\'s oil.' }],
  'rus-ws': [{ name: 'The Vasyugan swamps', terrain: 'marsh', inf: 'hard', arm: 'none', note: 'One of the largest bogs on earth: oil and gas lie under it.' }],
  'rus-sp': [{ name: 'Karelian forests and lakes', terrain: 'forest', inf: 'slow', arm: 'hard', note: 'Lakes, bogs and forest; Finland held the Soviets here in the Winter War.' }],
  'fin-ea': [{ name: 'The Karelian isthmus', terrain: 'forest', inf: 'slow', arm: 'hard', note: 'Forest, lakes and the old Mannerheim Line.' }],
  'nor-tr': [{ name: 'Fjords and fells', terrain: 'arctic', inf: 'hard', arm: 'none', note: 'One coastal road links the north; everything else moves by sea.' }],
  'ind-jk': [{ name: 'The Siachen Glacier', terrain: 'arctic', inf: 'hard', arm: 'none', note: 'The world\'s highest battlefield: more soldiers die of cold than of bullets.' }, { name: 'Zoji La', terrain: 'mountain', inf: 'slow', arm: 'hard', note: 'The pass to Ladakh; India surprised Pakistan by driving light tanks over it in 1948.', surprise: true }],
  'pak-kp': [{ name: 'The Khyber Pass', terrain: 'mountain', inf: 'slow', arm: 'hard', note: 'The gateway between Afghanistan and the plains of the Indus.' }],
  'pak-gb': [{ name: 'The Karakoram', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Peaks over 8,000 m; one highway climbs to China.' }],
  'm-afghanistan': [{ name: 'The Hindu Kush', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'The graveyard of empires: valleys that suit guerrillas, not armies.' }, { name: 'The Salang Tunnel', terrain: 'mountain', inf: 'slow', arm: 'slow', note: 'The single road link between north and south.' }],
  'chn-xz': [{ name: 'The Himalaya', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Thin air and few roads: India and China fight here with clubs and stones.' }],
  'chn-im': [{ name: 'The Gobi', terrain: 'desert', inf: 'hard', arm: 'slow', note: 'Stony desert: hard on men and machines.' }],
  'm-mongolia': [{ name: 'The Gobi', terrain: 'desert', inf: 'hard', arm: 'slow', note: 'Stony desert, freezing in winter.' }],
  'kor-gw': [{ name: 'The Demilitarised Zone', terrain: 'mountain', inf: 'hard', arm: 'hard', note: 'Minefields, wire and the most fortified border on earth.' }],
  'm-north-korea': [{ name: 'Mountain fortresses', terrain: 'mountain', inf: 'hard', arm: 'hard', note: 'Tunnels and artillery dug into the hills north of the DMZ.' }],
  'twn-tp': [{ name: 'The northern beaches', terrain: 'urban', inf: 'hard', arm: 'none', note: 'Taiwan has only a handful of beaches fit for a landing; all are watched.' }],
  'twn-ea': [{ name: 'The Central Mountain Range', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Peaks almost 4,000 m high and cliffs into the Pacific.' }],
  'isr-nh': [{ name: 'The Golan Heights', terrain: 'hills', inf: 'slow', arm: 'slow', note: 'A volcanic plateau looking down on Galilee and Damascus.' }],
  'egy-sz': [{ name: 'The Mitla and Giddi passes', terrain: 'mountain', inf: 'slow', arm: 'slow', note: 'The only ways through central Sinai for armour.' }, { name: 'The Suez Canal', terrain: 'marsh', inf: 'hard', arm: 'hard', note: 'A water barrier Egypt crossed by surprise in 1973.', surprise: true }],
  'irn-kr': [{ name: 'The Zagros', terrain: 'mountain', inf: 'hard', arm: 'hard', note: 'Parallel ridges that stopped Iraq\'s advance in the 1980s.' }],
  'irn-ds': [{ name: 'The Dasht-e Kavir salt crust', terrain: 'desert', inf: 'none', arm: 'none', note: 'A crust of salt over mud that swallows trucks whole.' }, { name: 'The Dasht-e Lut', terrain: 'desert', inf: 'hard', arm: 'slow', note: 'One of the hottest places on earth.' }],
  'sau-eq': [{ name: 'The Empty Quarter', terrain: 'desert', inf: 'none', arm: 'hard', note: 'The largest sand sea in the world. Almost nobody lives here.' }],
  'aus-ob': [{ name: 'The Great Sandy and Gibson deserts', terrain: 'desert', inf: 'hard', arm: 'slow', note: 'Thousands of kilometres of dunes and spinifex.' }],
  'ind-th': [{ name: 'The Thar dunes', terrain: 'desert', inf: 'hard', arm: 'slow', note: 'India and Pakistan fought a tank battle at Longewala here in 1971.' }],
  'usa-mt': [{ name: 'The Rocky Mountains', terrain: 'mountain', inf: 'slow', arm: 'hard', note: 'High passes through the Continental Divide.' }],
  'm-panama': [{ name: 'The Darién Gap', terrain: 'jungle', inf: 'hard', arm: 'none', note: 'The only break in the Pan-American Highway: roadless swamp and forest.' }],
  'bra-am': [{ name: 'The Amazon rainforest', terrain: 'jungle', inf: 'hard', arm: 'none', note: 'Rivers are the roads.' }],
  'm-dr-congo': [{ name: 'The Congo basin', terrain: 'jungle', inf: 'hard', arm: 'none', note: 'Rainforest and rivers the size of lakes.' }],
  'tur-ea': [{ name: 'The Armenian highlands', terrain: 'mountain', inf: 'slow', arm: 'hard', note: 'Where Russian and Ottoman armies froze in the winter of 1914.' }],
  'vnm-nb': [{ name: 'Karst mountains', terrain: 'mountain', inf: 'hard', arm: 'none', note: 'Limestone towers and jungle along the Chinese border; China\'s 1979 invasion bogged down here.' }],
  'vnm-md': [{ name: 'The Mekong Delta', terrain: 'marsh', inf: 'hard', arm: 'none', note: 'Rice paddies and canals.' }],
  'chl-an': [{ name: 'The Atacama', terrain: 'desert', inf: 'hard', arm: 'good', note: 'The driest desert on earth; Chile and Peru fought over its nitrates.' }],
  'can-no': [{ name: 'The Arctic', terrain: 'arctic', inf: 'none', arm: 'none', note: 'Ice and tundra; no roads cross it.' }],
  'usa-ak': [{ name: 'Alaska\'s interior', terrain: 'arctic', inf: 'hard', arm: 'hard', note: 'Mountains and tundra; one road links it to Canada.' }],
};

// Cities named in a province's title become urban districts
function cities(id) {
  const name = REGION_NAMES[id] ?? '';
  const inside = name.match(/\(([^)]*)\)/)?.[1] ?? '';
  const lead = name.replace(/\s*\(.*\)$/, '');
  const named = (FEATURES[id] ?? []).map((f) => f.name.toLowerCase());
  const parts = inside.split(/,|&/).map((x) => x.trim()).filter((x) => x && x.length < 28
    && !/oil|gas|copper|iron|uranium|rare|lithium|nickel|coal|fields|farmland|Basin|Belt|naval base|the |Gap|Ardennes|Galilee|Golan|Sinai|Alps|Himalaya|Zagros|Pilbara|Svalbard|Karelia|Caucasus|Borneo|Maluku|Mineral|Pre-salt|Cerrado|Orinoquía|Strait|Gulf|Coast|Islands|Bosporus|Persian/i.test(x)
    && !named.some((n) => n.includes(x.toLowerCase())));
  if (!parts.length && /^[A-Z][\w\s'.-]+$/.test(lead) && lead.split(' ').length <= 2 && TERRAIN_OF[id] === 'urban') parts.push(lead);
  return parts.slice(0, 3);
}

export function subregions(id) {
  const terrain = TERRAIN_OF[id] ?? MINOR_TERRAIN[id] ?? 'plains';
  const base = BY_TERRAIN[terrain];
  const out = [];
  for (const f of FEATURES[id] ?? []) out.push({ ...f, terrainName: TERRAIN[f.terrain]?.name ?? f.terrain });
  out.push({ name: out.length ? 'The rest of the province' : 'The countryside', terrain, terrainName: TERRAIN[terrain].name, inf: base.inf, arm: base.arm, note: base.note });
  for (const city of cities(id)) out.push({ name: city, terrain: 'urban', terrainName: 'City', inf: 'slow', arm: 'hard', note: 'Built-up areas: costly to take street by street, easy to defend.' });
  return out;
}

// Ground the defenders don't expect an attack through
export const surpriseFeature = (id) => (FEATURES[id] ?? []).find((f) => f.surprise) ?? null;
