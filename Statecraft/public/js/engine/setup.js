// Builds a new game's state from the data files.

import { COUNTRIES, COUNTRY_IDS, TECH_OVERRIDES, CLAIMS, NUCLEAR_PROGRAMMES } from './data/countries.js';
import { PROVINCES, RESOURCES, RESOURCE_INFO } from './data/regions.js';
import { MINORS } from './data/minors.js';
import { GEO, ORDER, EXTRA_MINORS } from './data/geo.js';
import { START_FRIENDS, START_RELATIONS, START_SANCTIONS, ELECTIONS, TECH_FIELDS, DEMAND_TILT, CHOKEPOINTS } from './data/world.js';
import { setRel, rel } from './core.js';
import { START_FORTS } from './names.js';

export const STOCK_WEEKS = 8; // strategic reserves held at the start, in weeks of demand

// Each spending line's share of non-defence spending
const SPLIT = { infra: 0.12, edu: 0.17, health: 0.3, research: 0.04, welfare: 0.37 };

export function allMinors() {
  return { ...MINORS, ...EXTRA_MINORS };
}

export function createState({ seed = Date.now() % 2147483647, years = 5 } = {}) {
  const s = {
    v: 1,
    seed: seed | 0,
    week: 0,
    settings: { years },
    over: false,
    countries: {},
    minors: {},
    regions: {},
    armies: {},
    wars: [],
    alliances: {},
    treaties: [],
    sanctions: {},
    tariffs: {},
    proposals: {},
    rel: {},
    market: { price: {}, history: {}, offer: {}, bid: {} },
    intensity: {},
    un: [],
    chokepoints: Object.fromEntries(Object.keys(CHOKEPOINTS).map((k) => [k, { closedBy: null }])),
    modifiers: [],
    news: [],
    fresh: [],
    nukesUsed: 0,
    nextId: 1,
    final: null,
  };

  /* ---------- Provinces ---------- */
  const shareTotals = {};
  const popTotals = {};
  for (const p of PROVINCES) {
    shareTotals[p.country] = (shareTotals[p.country] ?? 0) + p.gdpShare;
    popTotals[p.country] = (popTotals[p.country] ?? 0) + p.pop;
  }
  for (const p of PROVINCES) {
    const c = COUNTRIES[p.country];
    s.regions[p.id] = region(p.id, p.country, (p.gdpShare / shareTotals[p.country]) * c.gdp, (p.pop / popTotals[p.country]) * c.pop, p.resources);
  }
  const minors = allMinors();
  for (const m of Object.values(minors)) {
    s.regions[m.id] = region(m.id, m.id, m.gdp, m.pop, m.resources);
    s.minors[m.id] = {
      id: m.id, name: m.name, troops: m.troops, tanks: Math.round(m.troops * 1.5), nukes: m.nukes,
      guarantor: m.guarantor, chokepoint: m.chokepoint, puppetOf: null, annexed: false, capitulated: false,
      gdp: m.gdp, pop: m.pop, short: {}, stock: {},
    };
  }

  /* ---------- Countries ---------- */
  for (const id of COUNTRY_IDS) s.countries[id] = country(s, COUNTRIES[id]);

  /* ---------- Diplomacy ---------- */
  // No alliances exist at the start; leaders found their own during the game.
  for (const [pair, value] of Object.entries(START_RELATIONS)) {
    const [a, b] = pair.split(' ');
    if (s.countries[a] && s.countries[b]) setRel(s, a, b, value);
  }
  for (const al of START_FRIENDS) {
    for (const a of al.members) for (const b of al.members) {
      if (a < b) setRel(s, a, b, Math.max(rel(s, a, b), al.kind === 'military' ? 55 : 35));
    }
  }
  for (const [a, b] of START_SANCTIONS) s.sanctions[`${a}>${b}`] = true;
  for (const [id, fort] of Object.entries(START_FORTS)) if (s.regions[id]) s.regions[id].fort = fort;

  /* ---------- World market: demand is calibrated so the world starts in balance ---------- */
  const supply = {};
  const weight = {};
  for (const r of RESOURCES) { supply[r] = 0; weight[r] = 0; }
  for (const reg of Object.values(s.regions)) for (const [r, [cur]] of Object.entries(reg.res)) supply[r] += cur;
  for (const n of [...Object.values(s.countries), ...Object.values(s.minors)]) {
    for (const r of RESOURCES) weight[r] += demandWeight(s, n, r);
  }
  for (const r of RESOURCES) {
    s.intensity[r] = weight[r] ? supply[r] / weight[r] : 0;
    s.market.price[r] = 1; // prices are kept relative to the 2025 level
    s.market.history[r] = [];
  }
  for (const n of [...Object.values(s.countries), ...Object.values(s.minors)]) {
    for (const r of RESOURCES) n.stock[r] = demandWeight(s, n, r) * s.intensity[r] * STOCK_WEEKS;
  }
  return s;
}

function region(id, owner, gdp, pop, resources) {
  const g = GEO[id];
  if (!g) throw new Error(`Province ${id} is missing from the map; run npm run build:map`);
  const res = {};
  for (const [r, [cur, pot]] of Object.entries(resources ?? {})) res[r] = [cur, pot];
  return {
    id, owner, ctrl: owner, gdp, pop, res,
    infra: 5, fort: 0, dmg: 0, unrest: 0, battle: null,
  };
}

function country(s, d) {
  const tech = {};
  for (const f of Object.keys(TECH_FIELDS)) tech[f] = TECH_OVERRIDES[d.id]?.[f] ?? d.tech;
  const bond = Math.max(0.5, Math.min(8, 0.35 * d.rate + 1.5));
  const interest = (d.debt * bond) / 100;
  const civil = Math.max(4, d.tax + 3 - d.defence - interest);
  const spend = { defence: d.defence };
  for (const [k, share] of Object.entries(SPLIT)) spend[k] = round1(civil * share);
  const gdp = d.gdp;
  const c = {
    id: d.id, name: d.name, human: null,
    gov: d.gov, title: d.title,
    gdp, pot: gdp, pop: d.pop, growth: d.growth, trend: d.growth, popGrowth: d.popGrowth,
    treasury: d.reserves, debt: (d.debt / 100) * gdp, milFunds: gdp * d.defence / 100 / 12,
    tax: d.tax, spend, rate: d.rate, infl: d.inflation, bond,
    approval: d.approval, stability: clamp01(55 + (d.gov === 'autocracy' ? 15 : 0) + (d.approval - 45) * 0.4),
    rep: d.standing,
    base: { tax: d.tax, spend: { ...spend }, rate: d.rate, infl: d.inflation, growth: d.growth, approval: d.approval, rep: d.standing, tech: { ...tech } },
    mob: 0, mobTroops: 0, rally: 0, boost: 0, stimulus: null, martial: false, ration: false,
    troops: d.troops, reserves: d.reserveTroops, tanks: d.tanks, aircraft: d.aircraft, ships: d.ships,
    carriers: d.carriers, missiles: d.missiles, nukes: d.nukes,
    losses: 0, warWeariness: 0,
    tech, focus: 'industry', progress: Object.fromEntries(Object.keys(tech).map((f) => [f, 0])),
    stock: {}, prod: {}, demand: {}, short: {}, net: {}, windfall: 0,
    queue: [], projects: [],
    nukeProgram: NUCLEAR_PROGRAMMES[d.id] != null ? { on: true, progress: NUCLEAR_PROGRAMMES[d.id] } : { on: false, progress: 0 },
    intel: {}, cooldown: {}, claims: [...(CLAIMS[d.id] ?? [])],
    electionWeek: d.gov === 'autocracy' ? null : (ELECTIONS[d.id] ?? 100),
    exile: false, blockades: {}, airOps: [], generalsUsed: 0,
    energy: d.energy, uranium: d.uranium, rents: d.rents,
    inbox: [], history: { gdp: [gdp], approval: [d.approval], growth: [d.growth], infl: [d.inflation], debt: [d.debt] },
    ai: { next: 0 },
  };
  return c;
}

// How much of a resource a nation needs, before multiplying by the world intensity
export function demandWeight(s, n, r) {
  const c = s.countries[n.id];
  const gdp = n.gdp;
  if (r === 'food') return n.pop + gdp * 0.004;
  if (r === 'uran') return c ? c.uranium : (n.id === 'm-ukraine' ? 2 : 0);
  const tilt = DEMAND_TILT[r]?.[n.id] ?? 1;
  if (r === 'oil' || r === 'gas' || r === 'coal') {
    const energy = c ? c.energy * Math.pow(0.96, Math.max(0, c.tech.energy - c.base.tech.energy)) : 1;
    return gdp * energy * tilt;
  }
  if (r === 'chip') return gdp * tilt * (c ? 0.5 + c.base.tech.industry / 10 : 0.6);
  return gdp * tilt;
}

export const resourceValue = (r) => RESOURCE_INFO[r].value;
export { ORDER };

function clamp01(v) { return Math.max(0, Math.min(100, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
