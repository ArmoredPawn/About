// Climate. Burning oil, gas and coal releases carbon dioxide; the world warms in proportion to all the carbon
// ever released (about 0.45 °C per thousand billion tonnes). Warming brings heavier storms, longer droughts,
// heatwaves and floods, and it moves harvests: hot, dry lands lose crops while cold ones gain a little.
// Countries can tax carbon (less fossil fuel burned, some growth lost, revenue gained), research clean energy,
// and pledge cuts at the climate summits held every five years. Pledges kept win standing; broken ones lose it.

import { GEO } from './data/geo.js';
import { PROVINCES } from './data/regions.js';
import { REGION_NAMES, MINOR_TERRAIN } from './names.js';
import { clamp, chance, rand, pick, news, alert, alive } from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;
const TERRAIN_OF = Object.fromEntries(PROVINCES.map((p) => [p.id, p.terrain]));

export const START_TEMP = 1.35; // °C above pre-industrial, early 2027
export const START_CO2 = 426; // ppm
const TCRE = 0.00045; // °C per billion tonnes of CO2
const PPM_PER_GT = 0.128 * 0.45; // ppm per billion tonnes, with about 55% taken up by oceans and forests
// Real-world CO2 from each fuel, billions of tonnes a year, for the 50 countries in the game (about 80% of the
// world's). The rest of the world emits about 7 billion tonnes more.
const FUEL_GT = { oil: 10.5, gas: 6.2, coal: 13.5 };
const REST_OF_WORLD = 7;

export const CARBON_TAX = [
  { name: 'None', price: 0 },
  { name: '$25 a tonne', price: 25 },
  { name: '$75 a tonne', price: 75 },
  { name: '$150 a tonne', price: 150 },
];
export const PLEDGE_CUTS = [20, 30, 50, 80];
export const SUMMIT_EVERY = 52 * 5;
const FIRST_SUMMIT = 46; // November 2027

/* ---------- Setting up ---------- */

export function initClimate(s) {
  s.climate ??= { temp: START_TEMP, co2: START_CO2, world: 0, k: null, history: [], nextSummit: FIRST_SUMMIT, summits: 0 };
}

// Fixes how much CO2 each unit of each fuel releases, from the first week's demand
function calibrate(s) {
  const totals = { oil: 0, gas: 0, coal: 0 };
  for (const c of Object.values(s.countries)) for (const f of Object.keys(totals)) totals[f] += c.demand?.[f] ?? 0;
  if (!totals.oil || !totals.gas || !totals.coal) return null;
  return Object.fromEntries(Object.entries(totals).map(([f, t]) => [f, FUEL_GT[f] / t]));
}

// A country's CO2, billions of tonnes a year
export function emissionsOf(s, c) {
  const k = s.climate?.k;
  if (!k) return 0;
  return Object.keys(FUEL_GT).reduce((t, f) => t + (c.demand?.[f] ?? 0) * k[f], 0);
}

/* ---------- How exposed each province is ---------- */

const DELTAS = new Set(['bgd-dh', 'bgd-kh', 'bgd-ch', 'nld-rd', 'nld-no', 'nld-so', 'vnm-ms', 'vnm-hn', 'egy-de', 'egy-cr', 'chn-sh', 'chn-gd', 'usa-se', 'usa-tx', 'ind-bh', 'ind-mh', 'idn-jk', 'tha-bk', 'phl-mn', 'pak-kr', 'irq-bs', 'ita-ve', 'jpn-kn', 'mmr-yg']);
const FIRE = new Set(['aus-ns', 'aus-vi', 'aus-wa', 'usa-ca', 'usa-sw', 'usa-nw', 'can-bc', 'can-ab', 'rus-es', 'rus-yk', 'tur-me', 'tur-ag', 'esp-an', 'fra-pr', 'ita-si', 'chl-sa', 'bra-mt', 'bra-am']);

// heat (crops and heatwaves), drought, flood and fire risk, 0 to 1, and a single number for the map
export function riskOf(id) {
  const g = GEO[id];
  if (!g) return { heat: 0, drought: 0, flood: 0, fire: 0, total: 0, cold: 0 };
  const lat = Math.abs(g.lat);
  const terrain = TERRAIN_OF[id] ?? MINOR_TERRAIN[id] ?? 'plains';
  const heat = clamp((32 - Math.abs(lat - 18)) / 32, 0, 1) * (terrain === 'desert' ? 1 : 0.75);
  const drought = (terrain === 'desert' ? 0.8 : terrain === 'plains' ? 0.45 : terrain === 'hills' ? 0.3 : 0.15) * clamp((45 - lat) / 30, 0.2, 1);
  const flood = DELTAS.has(id) ? 0.9 : g.coast ? 0.3 : terrain === 'marsh' ? 0.4 : 0.05;
  const fire = FIRE.has(id) ? 0.8 : terrain === 'forest' ? 0.3 : 0.05;
  const cold = clamp((lat - 50) / 15, 0, 1); // the far north gains a longer growing season
  return { heat, drought, flood, fire, cold, total: clamp(0.35 * heat + 0.3 * drought + 0.25 * flood + 0.1 * fire - 0.2 * cold, 0, 1) };
}
const riskCache = new Map();
const riskFor = (id) => riskCache.get(id) ?? riskCache.set(id, riskOf(id)).get(id);

// Harvests under the current warming: down in hot, dry lands, up a little in the far north
export function climateYield(s, regionId) {
  const d = (s.climate?.temp ?? START_TEMP) - START_TEMP;
  if (d <= 0) return 1;
  const r = riskFor(regionId);
  return clamp(1 - d * (0.12 * r.heat + 0.1 * r.drought) + d * 0.06 * r.cold, 0.4, 1.2);
}

// How much more often extreme weather strikes now than in 2027
export const extremeFactor = (s) => 1 + 1.6 * Math.max(0, (s.climate?.temp ?? START_TEMP) - START_TEMP);

/* ---------- Once a week ---------- */

export function climateTick(s) {
  initClimate(s);
  const cl = s.climate;
  cl.k ??= calibrate(s);
  if (!cl.k) return;
  let world = REST_OF_WORLD * Math.pow(0.995, s.week / 52);
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) { c.emissions = 0; continue; }
    c.emissions = emissionsOf(s, c);
    world += c.emissions;
    // A carbon tax bites over a few years as people and firms switch
    const level = CARBON_TAX[c.carbonTax ?? 0] ? (c.carbonTax ?? 0) : 0;
    c.carbonEffect = (c.carbonEffect ?? 0) + (level - (c.carbonEffect ?? 0)) * 0.03;
    if (level) {
      // Revenue: about 40% of emissions are covered, at the tax's price; fuel costs dent approval a little
      const revenue = c.emissions * 1e9 * CARBON_TAX[level].price * 0.4 / 1e9 / 52;
      c.treasury += revenue;
      c.carbonRevenue = revenue * 52;
      if (c.gov === 'democracy') c.approval = Math.max(0, c.approval - 0.015 * level);
    } else c.carbonRevenue = 0;
  }
  cl.world = world;
  const yearly = world / 52;
  const feedback = cl.temp > 2 ? 1 + (cl.temp - 2) * 0.25 : 1;
  cl.temp += yearly * TCRE * feedback;
  cl.co2 += yearly * PPM_PER_GT;
  if (s.week % 4 === 0) {
    cl.history.push([s.week, Math.round(cl.temp * 1000) / 1000, Math.round(world * 10) / 10]);
    if (cl.history.length > 400) cl.history.shift();
  }
  milestones(s);
  extremeWeather(s);
  pledgesTick(s);
}

function milestones(s) {
  const cl = s.climate;
  for (const mark of [1.5, 2, 2.5, 3]) {
    if (cl.temp >= mark && !(cl.passed ?? []).includes(mark)) {
      cl.passed = [...(cl.passed ?? []), mark];
      news(s, mark === 1.5
        ? 'Scientists confirm the world has passed 1.5 °C of warming, the limit the Paris Agreement hoped to hold.'
        : `The world has now warmed ${mark} °C. Heatwaves, droughts and floods are striking far more often.`, 'disaster');
    }
  }
}

// Heatwaves, floods and wildfires, more often the warmer it gets (storms and droughts are in events.js)
function extremeWeather(s) {
  const f = extremeFactor(s);
  if (!chance(s, 0.02 * (f - 0.7))) return;
  const roll = Math.floor(rand(s) * 3);
  const regions = Object.keys(s.regions).filter((id) => s.countries[s.regions[id].ctrl]);
  if (roll === 0) {
    const options = regions.filter((id) => riskFor(id).heat > 0.6);
    if (!options.length) return;
    const id = pick(s, options);
    const reg = s.regions[id];
    const c = s.countries[reg.ctrl];
    reg.pop *= 0.9995;
    c.approval = Math.max(0, c.approval - 1);
    if (reg.res.food) reg.res.food[0] = Math.round(reg.res.food[0] * 0.92 * 100) / 100;
    news(s, `A deadly heatwave grips ${regionName(id)} (${c.name}). Crops wither and hospitals overflow.`, 'disaster', [c.id]);
    alert(s, c.id, `Heatwave in ${regionName(id)}: harvest losses and deaths. Health spending and infrastructure help.`, 'bad', { region: id });
  } else if (roll === 1) {
    const options = regions.filter((id) => riskFor(id).flood > 0.5);
    if (!options.length) return;
    const id = pick(s, options);
    const reg = s.regions[id];
    const c = s.countries[reg.ctrl];
    const hit = 0.06 * (1 - 0.05 * reg.infra);
    reg.dmg = Math.min(0.9, reg.dmg + hit);
    news(s, `Catastrophic floods swamp ${regionName(id)} (${c.name}).`, 'disaster', [c.id]);
    alert(s, c.id, `Floods in ${regionName(id)}: damage ${Math.round(reg.dmg * 100)}%. Good infrastructure limits the damage.`, 'bad', { region: id });
  } else {
    const options = regions.filter((id) => riskFor(id).fire > 0.5);
    if (!options.length) return;
    const id = pick(s, options);
    const reg = s.regions[id];
    const c = s.countries[reg.ctrl];
    reg.dmg = Math.min(0.9, reg.dmg + 0.03);
    news(s, `Wildfires rage across ${regionName(id)} (${c.name}).`, 'disaster', [c.id]);
    alert(s, c.id, `Wildfires in ${regionName(id)}.`, 'bad', { region: id });
  }
}

/* ---------- Pledges and summits ---------- */

export function setCarbonTax(s, c, level) {
  level = Number(level);
  if (!CARBON_TAX[level]) return 'Pick a level.';
  const was = c.carbonTax ?? 0;
  c.carbonTax = level;
  if (level > was) news(s, `${c.name} ${was ? 'raises its carbon tax' : 'introduces a carbon tax'}: ${CARBON_TAX[level].name}.`, 'economy', [c.id]);
  else if (level < was) news(s, `${c.name} ${level ? 'cuts its carbon tax' : 'scraps its carbon tax'}.`, 'economy', [c.id]);
  return null;
}

// A pledge to cut emissions by `cut`% (from today) by `year`
export function makePledge(s, c, { cut, year }) {
  cut = Number(cut);
  year = Number(year);
  if (!PLEDGE_CUTS.includes(cut)) return 'Pick a cut.';
  const now = 2027 + Math.floor(s.week / 52);
  if (!(year >= now + 5 && year <= now + 30)) return `Pick a year between ${now + 5} and ${now + 30}.`;
  if (c.pledge && c.pledge.cut >= cut && !c.pledge.done) return `We have already pledged ${c.pledge.cut}% by ${c.pledge.year}.`;
  const base = c.pledge && !c.pledge.done ? c.pledge.base : (c.emissions || emissionsOf(s, c));
  c.pledge = { cut, year, by: (year - 2027) * 52, base, made: s.week, done: false };
  c.rep = Math.min(100, c.rep + cut / 15);
  news(s, `${c.name} pledges to cut its carbon emissions ${cut}% by ${year}.`, 'diplomacy', [c.id]);
  return null;
}

// Where the pledge says emissions should be by now, on a straight line from when it was made
export function pledgePath(s, c) {
  const p = c.pledge;
  if (!p || p.done) return null;
  const k = clamp((s.week - p.made) / Math.max(1, p.by - p.made), 0, 1);
  return p.base * (1 - (p.cut / 100) * k);
}

function pledgesTick(s) {
  const cl = s.climate;
  for (const c of Object.values(s.countries)) {
    const p = c.pledge;
    if (!p || p.done || !alive(s, c.id) || s.week < p.by) continue;
    p.done = true;
    const target = p.base * (1 - p.cut / 100);
    if (c.emissions <= target * 1.05) {
      c.rep = Math.min(100, c.rep + 8);
      news(s, `${c.name} meets its pledge to cut emissions ${p.cut}% by ${p.year}.`, 'diplomacy', [c.id]);
      alert(s, c.id, `We kept our climate pledge. Our standing rises.`, 'good');
    } else {
      c.rep = Math.max(0, c.rep - 10);
      news(s, `${c.name} breaks its pledge to cut emissions ${p.cut}% by ${p.year}.`, 'diplomacy', [c.id]);
      alert(s, c.id, `We broke our climate pledge (emissions ${Math.round((1 - c.emissions / p.base) * 100)}% down, not ${p.cut}%). Our standing falls.`, 'bad');
    }
  }
  if (s.week < cl.nextSummit) return;
  cl.nextSummit = s.week + SUMMIT_EVERY;
  cl.summits++;
  const year = 2027 + Math.floor(s.week / 52);
  news(s, `The ${year} climate summit opens. The world has warmed ${cl.temp.toFixed(2)} °C and emits ${Math.round(cl.world)} billion tonnes of CO2 a year. Leaders are pressed to pledge deeper cuts.`, 'diplomacy');
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    if (c.human) { alert(s, c.id, `The ${year} climate summit is under way. A new pledge now (World → Climate) is noticed.`, 'info'); continue; }
    if (c.pledge && !c.pledge.done) continue;
    const keen = c.gov === 'democracy' ? 0.85 : c.gov === 'hybrid' ? 0.55 : 0.35;
    if (!chance(s, keen)) continue;
    const cut = c.gov === 'democracy' ? pick(s, [30, 50, 50, 80]) : pick(s, [20, 20, 30]);
    makePledge(s, c, { cut, year: year + pick(s, [8, 10, 13, 23]) });
  }
}

/* ---------- Computer-run countries ---------- */

// Countries with a pledge tax carbon to keep it; others don't
export function aiClimate(s, c) {
  const path = pledgePath(s, c);
  if (path == null) {
    if ((c.carbonTax ?? 0) > 0 && c.gov !== 'democracy') setCarbonTax(s, c, 0);
    return;
  }
  const over = c.emissions / Math.max(0.001, path);
  const level = c.carbonTax ?? 0;
  if (over > 1.05 && level < 3) setCarbonTax(s, c, level + 1);
  else if (over < 0.85 && level > 0) setCarbonTax(s, c, level - 1);
}

/* ---------- What each leader sees ---------- */

export function climateView(s) {
  const cl = s.climate;
  if (!cl) return null;
  return { temp: Math.round(cl.temp * 1000) / 1000, co2: Math.round(cl.co2 * 10) / 10, world: Math.round(cl.world * 10) / 10, history: cl.history, nextSummit: cl.nextSummit, extreme: Math.round(extremeFactor(s) * 100) / 100 };
}
