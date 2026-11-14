// The weekly economy: the world resource market, GDP, budgets, inflation, approval, research and production.
// Yearly figures (GDP, spending as % of GDP) are applied a week (1/52) at a time.

import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import { CHOKEPOINTS, TECH_FIELDS } from './data/world.js';
import { demandWeight, STOCK_WEEKS } from './setup.js';
import { clamp, news, alert, alive, atWar, allied, enemiesOf, alliancesOf, treaty, chance, rand, money, nameOf, isMinor } from './core.js';
import { REGION_NAMES } from './names.js';
import { researchTick, rangeTick } from './science.js';
import { patrolBlocks } from './trade.js';
import { seasOf, fleetStrength } from './navy.js';
import { cartelOutput, embargoCut, pipelineShare, bypassShare } from './energy.js';
import { climateYield } from './climate.js';

const CP_KEY = new Map(Object.entries(CHOKEPOINTS).map(([k, v]) => [v, k]));

// Share of output lost when a resource is completely short
const SHORT_WEIGHT = { oil: 0.3, gas: 0.12, coal: 0.08, iron: 0.04, food: 0.08, rare: 0.03, uran: 0, metal: 0.05, chip: 0.1 };
const ELASTIC = { oil: 3.5, gas: 3, coal: 2, iron: 2, food: 3, rare: 2.5, uran: 2, metal: 2, chip: 3 };

export const BUILD = {
  troops: { name: 'Infantry', batch: 10, unit: 'K troops', cost: 0.08, weeks: 12, needs: [] },
  tanks: { name: 'Tanks', batch: 50, unit: 'tanks', cost: 0.4, weeks: 26, needs: ['iron', 'metal'] },
  aircraft: { name: 'Combat aircraft', batch: 10, unit: 'aircraft', cost: 1.0, weeks: 52, needs: ['chip', 'rare', 'metal'] },
  ships: { name: 'Warship', batch: 1, unit: 'warship', cost: 1.1, weeks: 104, needs: ['iron', 'metal', 'chip'] },
  carriers: { name: 'Aircraft carrier', batch: 1, unit: 'carrier', cost: 12, weeks: 260, needs: ['iron', 'chip'], tech: ['naval', 7] },
  missiles: { name: 'Missiles', batch: 50, unit: 'missiles', cost: 0.2, weeks: 16, needs: ['chip', 'rare'] },
  nukes: { name: 'Nuclear warheads', batch: 10, unit: 'warheads', cost: 0.8, weeks: 26, needs: ['uran'] },
};

export const PROJECT_WEEKS = { oil: 52, gas: 52, coal: 52, iron: 78, food: 26, rare: 78, uran: 78, metal: 78, chip: 104 };

/* ---------- Small shared measures ---------- */

export const perCapita = (c) => (c.gdp / Math.max(0.01, c.pop)); // thousand $ per person
export const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, perCapita(c) / 60);
export const maxOrders = (c) => 3 + Math.floor(c.gdp / 800);
export const maxProjects = (c) => 2 + Math.floor(c.gdp / 1200);
export const researchCost = (level) => 1.5 * Math.pow(1.55, level);
export const debtRatio = (c) => (c.debt / Math.max(1, c.gdp)) * 100;
export const debtLimit = (c) => (c.id === 'jpn' ? 260 : 90 + (perCapita(c) > 25 ? 60 : 0));

export function navalPower(c, ships = c.ships, carriers = c.carriers) {
  return (ships + carriers * 8) * (0.6 + 0.08 * (c.tech?.naval ?? 4));
}

export function upkeep(s, c) {
  const pc = perCapita(c);
  const perK = 0.004 + 0.13 * Math.min(1.3, pc / 80);
  const gear = 0.4 + 0.6 * Math.min(1, pc / 50);
  const yearly = c.troops * perK
    + gear * (c.tanks * 0.0012 + c.aircraft * 0.012 + c.ships * 0.07 + c.carriers * 1.2 + c.nukes * 0.005 + c.missiles * 0.0003);
  return (yearly * 1.6 / 52) * (enemiesOf(s, c.id).size ? 1.3 : 1);
}

function nuclearShare(c) {
  return clamp((c.uranium / Math.max(0.1, c.gdp / 1000)) * 0.12, 0, 0.7);
}

function worldGdp(s) {
  let t = 0;
  for (const c of Object.values(s.countries)) if (alive(s, c.id)) t += c.gdp;
  for (const m of Object.values(s.minors)) if (!m.annexed) t += m.gdp;
  return t;
}

/* ---------- Trade access: sanctions, blockades and closed straits ---------- */

function sanctionShare(s, id, world) {
  let t = 0;
  for (const [key, on] of Object.entries(s.sanctions)) {
    if (!on) continue;
    const [a, b] = key.split('>');
    if (b === id && alive(s, a)) t += s.countries[a]?.gdp ?? 0;
  }
  return Math.min(0.9, t / world);
}

// The defender's fleets in its own seas, which keep its ports open
function homeWaters(s, id) {
  const seas = new Set(seasOf(s, id));
  let p = 0;
  for (const f of Object.values(s.fleets ?? {})) if (f.owner === id && seas.has(f.at) && !(f.prog > 0)) p += fleetStrength(s, f);
  return p;
}

export function blockadeEffect(s, target) {
  const t = s.countries[target] ?? s.minors[target];
  if (!t) return 0;
  const defence = s.countries[target] ? homeWaters(s, target) : (t.troops / 50);
  let open = 1;
  for (const c of Object.values(s.countries)) {
    const ships = c.blockades[target];
    if (!ships || !atWar(s, c.id, target)) continue;
    const p = navalPower(c, ships, c.blockadeCarriers?.[target] ?? 0);
    open *= 1 - (p / (p + defence * 1.2 + 0.01)) * 0.8;
  }
  return 1 - open;
}

function closedChokepoints(s, id) {
  const out = [];
  for (const [key, cp] of Object.entries(s.chokepoints)) {
    const closed = cp.closedBy && cp.closedBy !== id && !allied(s, cp.closedBy, id);
    if (!closed && !patrolBlocks(s, key, id)) continue;
    out.push(CHOKEPOINTS[key]);
  }
  return out;
}

function access(s, id, world) {
  const share = sanctionShare(s, id, world);
  const blockade = blockadeEffect(s, id);
  // Sanctioned goods still find buyers (at a discount); blockades physically stop ships
  const base = (1 - 0.08 * share) * (1 - 0.75 * blockade);
  return { imp: base, exp: base, discount: 0.35 * share, share };
}

/* ---------- The world market ---------- */

export function production(s, nationId, r, index) {
  let total = 0;
  for (const reg of index ? index.get(nationId) ?? [] : Object.values(s.regions)) {
    if (reg.ctrl !== nationId || !reg.res[r]) continue;
    total += reg.res[r][0] * regionEfficiency(reg, nationId) * (r === 'food' ? climateYield(s, reg.id) : 1);
  }
  return r === 'food' && s.winterUntil > s.week ? total * 0.6 : total;
}

// Efficiency gains: each year the world needs a little less energy and material per dollar of output
const EFFICIENCY = { oil: 0.015, gas: 0.012, coal: 0.02, iron: 0.008, food: 0, rare: 0.004, uran: 0, metal: 0.006, chip: 0 };

export function regionEfficiency(reg, holder) {
  return (1 - reg.dmg) * (reg.owner === holder ? 1 : 0.5) * (reg.battle ? 0.5 : 1) * (1 - reg.unrest / 200);
}

function demand(s, n, r) {
  let d = demandWeight(s, n, r) * s.intensity[r] * Math.pow(1 - EFFICIENCY[r], s.week / 52) * Math.pow(s.market.price[r], -0.2);
  const c = s.countries[n.id];
  if (c) {
    if (r === 'oil') {
      const military = c.troops * 0.00008 + c.tanks * 0.00001 + c.aircraft * 0.00006 + c.ships * 0.0003 + c.carriers * 0.001;
      d += military * (enemiesOf(s, c.id).size ? 3 : 1);
    }
    if (c.ration && (r === 'oil' || r === 'gas' || r === 'food')) d *= 0.85;
    // A carbon tax moves people and firms off fossil fuels over a few years
    if (r === 'oil' || r === 'gas' || r === 'coal') d *= 1 - 0.07 * (c.carbonEffect ?? 0) * (r === 'coal' ? 1.4 : 1);
  }
  return d;
}

export function marketTick(s) {
  const world = worldGdp(s);
  const nations = [...Object.values(s.countries).filter((c) => alive(s, c.id)), ...Object.values(s.minors).filter((m) => !m.annexed)];
  const acc = new Map(nations.map((n) => [n.id, access(s, n.id, world)]));
  const chokes = new Map(nations.map((n) => [n.id, closedChokepoints(s, n.id)]));
  let shock = 0;
  for (const [key, cp] of Object.entries(s.chokepoints)) {
    const blockedAll = Object.values(cp.patrols ?? {}).some((pt) => pt.mode === 'all');
    if (cp.closedBy || blockedAll) shock += CHOKEPOINTS[key].priceShock ?? 0;
    if (cp.toll) shock += (CHOKEPOINTS[key].priceShock ?? 0.04) * cp.toll.rate / 50;
  }
  for (const n of nations) n.windfall = 0;
  const index = new Map();
  for (const reg of Object.values(s.regions)) {
    if (!Object.keys(reg.res).length) continue;
    (index.get(reg.ctrl) ?? index.set(reg.ctrl, []).get(reg.ctrl)).push(reg);
  }

  for (const r of RESOURCES) {
    const rows = [];
    let offers = 0;
    let bids = 0;
    for (const n of nations) {
      // Producers with spare capacity pump more when prices are high (and less when they slump)
      const prod = production(s, n.id, r, index) * (1 + clamp(0.08 * (s.market.price[r] - 1), -0.08, 0.1)) * (r === 'oil' ? cartelOutput(s, n.id) : 1);
      const dem = demand(s, n, r);
      const a = acc.get(n.id);
      let exp = a.exp;
      let imp = a.imp;
      for (const cp of chokes.get(n.id)) {
        // A bypass pipeline gets part of the exports out without passing the strait
        if (cp.exportCut && cp.exportCut.nations.includes(n.id) && cp.exportCut.res.includes(r)) exp *= cp.exportCut.factor + (1 - cp.exportCut.factor) * bypassShare(s, n.id, CP_KEY.get(cp));
        if (cp.importCut && cp.importCut.nations.includes(n.id)) imp *= 1 - cp.importCut.factor;
      }
      if (r === 'oil') imp *= 1 - embargoCut(s, n.id);
      // Fuel that arrives by pipeline gets through whatever happens at sea
      if (r === 'oil' || r === 'gas') imp += (1 - imp) * pipelineShare(s, n.id, r);
      const net = prod - dem;
      const stock = n.stock[r] ?? 0;
      const target = dem * STOCK_WEEKS;
      let offer = net > 0 ? net * exp : 0;
      if (stock > target * 1.5) offer += (stock - target * 1.5) * 0.1 * exp;
      // A strategic reserve being released goes onto the market a quarter at a time
      const released = Math.min(n.releasing?.[r] ?? 0, Math.max(0.01, (n.releasing?.[r] ?? 0) / 4), stock);
      if (released > 0) { offer += released; n.releasing[r] -= released; }
      let bid = net < 0 ? -net * imp : 0;
      if (stock < target && s.market.price[r] < 1.4) bid += (target - stock) * 0.04 * imp;
      rows.push({ n, prod, dem, offer, bid });
      offers += offer;
      bids += bid;
    }
    const traded = Math.min(offers, bids);
    const fillE = offers ? traded / offers : 0;
    const fillI = bids ? traded / bids : 0;
    const m = s.market;
    m.ratio0 ??= {};
    const ratio = offers ? bids / offers : 4;
    m.ratio0[r] ??= ratio || 1;
    const target = clamp(Math.pow(ratio / m.ratio0[r], ELASTIC[r]) * (1 + shock * (r === 'oil' || r === 'gas' ? 1 : 0.4)), 0.3, 6);
    m.price[r] += (target - m.price[r]) * 0.2;
    m.offer[r] = offers;
    m.bid[r] = bids;
    const price = m.price[r];
    const value = RESOURCE_INFO[r].value / 52;

    for (const { n, prod, dem, offer, bid } of rows) {
      const sold = offer * fillE;
      const got = bid * fillI;
      let stock = (n.stock[r] ?? 0) + prod - dem + got - sold;
      let short = 0;
      if (stock < 0) {
        short = dem > 0 ? clamp(-stock / dem, 0, 1) : 0;
        stock = 0;
      }
      n.stock[r] = Math.min(stock, Math.max(dem, 0.01) * 26);
      n.short[r] = short;
      if (s.countries[n.id]) {
        const c = n;
        c.prod[r] = prod;
        c.demand[r] = dem;
        c.net[r] = sold - got;
      }
      n.windfall += (sold - got) * value * (price - 1) - sold * value * price * acc.get(n.id).discount;
    }
    m.history[r].push(Math.round(price * 1000) / 1000);
    if (m.history[r].length > 104) m.history[r].shift();
  }
  return world;
}

/* ---------- Countries, week by week ---------- */

export function economyTick(s, world) {
  const drag = Object.entries(s.chokepoints).reduce((t, [k, cp]) => t + (cp.closedBy ? CHOKEPOINTS[k].growthDrag ?? 0 : 0), 0);
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    const mods = s.modifiers.filter((m) => m.cid === c.id || m.cid === 'all');
    output(s, c, mods);
    const g = growthRate(s, c, world, mods, drag);
    for (const reg of Object.values(s.regions)) {
      if (reg.owner === c.id && reg.ctrl === c.id) {
        reg.gdp *= 1 + g / 5200;
        reg.pop *= 1 + c.popGrowth / 5200 - (c.short.food > 0.25 ? c.short.food * 0.001 : 0);
      } else if (reg.owner === c.id) {
        reg.gdp *= 0.999; // occupied provinces wither
      }
    }
    c.trendNow = g;
    budget(s, c);
    prices(s, c);
    mobilisation(s, c);
    opinion(s, c, mods);
    research(s, c);
    researchTick(s, c);
    rangeTick(s, c);
    production_(s, c);
    projects(s, c);
    nuclearProgramme(s, c);
    elections(s, c);
    history(s, c);
  }
  for (const m of Object.values(s.minors)) {
    if (m.annexed) continue;
    // At war, minor nations call up reserves to replace their losses
    m.baseTroops ??= m.troops;
    const foes = enemiesOf(s, m.id);
    if (foes.size) {
      // Everyone who can hold a rifle: up to about 4% of the people against a stronger invader
      let threat = 0;
      for (const f of foes) threat += s.countries[f] ? s.countries[f].troops * 0.3 : (s.minors[f]?.troops ?? 0);
      const cap = Math.max(m.baseTroops * 1.4, Math.min(m.pop * 1000 * 0.04, m.baseTroops + threat * 0.5));
      if (m.troops < cap) m.troops += Math.max(m.baseTroops * 0.012, (cap - m.troops) * 0.04);
    }
    let gdp = 0;
    let pop = 0;
    for (const reg of Object.values(s.regions)) {
      if (reg.owner !== m.id) continue;
      reg.gdp *= 1 + 2.5 / 5200;
      if (reg.ctrl === m.id) { gdp += reg.gdp * (1 - 0.8 * reg.dmg); pop += reg.pop; }
    }
    for (const reg of Object.values(s.regions)) {
      if (reg.owner !== m.id && reg.ctrl === m.id) pop += reg.pop;
    }
    m.gdp = gdp;
    m.pop = pop;
  }
  s.modifiers = s.modifiers.filter((m) => m.until > s.week);
}

function output(s, c, mods) {
  let pot = 0;
  let pop = 0;
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== c.id) continue;
    const own = reg.owner === c.id;
    pot += reg.gdp * (1 - 0.8 * reg.dmg) * (own ? 1 : 0.3) * (1 - reg.unrest / 250) * (reg.revolt ? 0.4 : 1) * (reg.policy === 'autonomy' ? 0.92 : 1);
    pop += reg.pop;
  }
  c.pot = pot;
  c.pop = pop || c.pop * 0.99;
  let loss = 0;
  for (const r of RESOURCES) loss += SHORT_WEIGHT[r] * (c.short[r] ?? 0);
  loss += nuclearShare(c) * 0.6 * (c.short.uran ?? 0);
  const tot = clamp(((c.windfall ?? 0) * 52) / Math.max(1, pot) * 0.3, -0.08, 0.12);
  let level = 1;
  for (const m of mods) if (m.kind === 'gdp') level *= 1 + m.value;
  // Conscripts are workers taken out of farms and factories
  const drafted = Math.max(0, c.conscripts ?? 0) / Math.max(1, c.pop * 1000);
  c.gdp = Math.max(0.5, pot * (1 - clamp(loss, 0, 0.6)) * (1 + tot) * [1, 0.985, 0.95][c.mob] * level * (1 - (c.strike ?? 0)) * (1 - drafted * 0.9));
}

export function tradeScore(s, c, world) {
  let partners = 0;
  for (const al of alliancesOf(s, c.id, 'economic')) {
    for (const m of al.members) if (m !== c.id && alive(s, m)) partners += s.countries[m].gdp;
  }
  for (const t of s.treaties) {
    if (t.kind !== 'fta') continue;
    const other = t.a === c.id ? t.b : t.b === c.id ? t.a : null;
    if (other && alive(s, other)) partners += s.countries[other].gdp;
  }
  let tariffs = 0;
  for (const [key, level] of Object.entries(s.tariffs)) {
    const [a, b] = key.split('>');
    if (a === c.id || b === c.id) tariffs += (level / 100) * ((s.countries[a === c.id ? b : a]?.gdp ?? 0) / world);
  }
  return Math.min(1.5, (partners / world) * 3) - sanctionShare(s, c.id, world) * 3 - tariffs * 4;
}

function growthRate(s, c, world, mods, drag) {
  const b = c.base;
  const sp = c.spend;
  b.trade ??= tradeScore(s, c, world);
  let g = c.trend;
  g += 0.22 * (sp.infra - b.spend.infra) + 0.15 * (sp.edu - b.spend.edu) + 0.35 * (sp.research - b.spend.research) + 0.08 * (sp.health - b.spend.health);
  g -= 0.12 * (c.tax - b.tax);
  g -= 0.25 * clamp((c.rate - c.infl) - (b.rate - b.infl), -8, 15);
  g += 0.15 * (c.tech.industry - b.tech.industry);
  g += tradeScore(s, c, world) - b.trade;
  g -= 0.6 * Math.min(3, enemiesOf(s, c.id).size);
  g -= [0, 0.5, 2][c.mob];
  if (c.stability < 40) g -= (40 - c.stability) * 0.05;
  const over = debtRatio(c) - debtLimit(c);
  if (over > 0) g -= over * 0.02;
  if (c.infl > Math.max(12, b.infl + 6)) g -= (c.infl - Math.max(12, b.infl + 6)) * 0.08;
  if (c.stimulus && c.stimulus.until > s.week) g += c.stimulus.boost;
  if (c.martial) g -= 0.5;
  g -= 0.12 * (c.carbonEffect ?? 0);
  g -= drag;
  for (const m of mods) if (m.kind === 'growth') g += m.value;
  return clamp(g, -15, 15);
}

function budget(s, c) {
  const y = c.gdp;
  const sp = c.spend;
  const revenue = (y * c.tax) / 100 / 52 + Math.max(0, c.windfall ?? 0) * c.rents + tariffIncome(s, c);
  const civil = (y * (sp.infra + sp.edu + sp.health + sp.research + sp.welfare)) / 100 / 52;
  const defence = (y * sp.defence) / 100 / 52;
  const interest = (c.debt * c.bond) / 100 / 52;
  const keep = upkeep(s, c);
  c.upkeep = keep * 52;
  c.milFunds += defence - keep;
  c.readiness = 1;
  if (c.milFunds < 0) {
    c.treasury += c.milFunds;
    c.milFunds = 0;
    c.readiness = 0.85;
  }
  const cap = (y * sp.defence) / 100 * 1.5;
  if (c.milFunds > cap) { c.treasury += c.milFunds - cap; c.milFunds = cap; }
  for (const t of s.treaties) {
    if (t.kind === 'loan' && t.b === c.id) { c.treasury -= t.payment; s.countries[t.a] && (s.countries[t.a].treasury += t.payment); }
    if (t.kind === 'reparations' && t.a === c.id) { c.treasury -= t.payment; s.countries[t.b] && (s.countries[t.b].treasury += t.payment); }
  }
  c.treasury += revenue - civil - interest;
  if (c.treasury < 0) {
    c.debt += -c.treasury;
    c.treasury = 0;
  }
  const risk = Math.max(0, debtRatio(c) - debtLimit(c)) * 0.04 + (c.stability < 30 ? 1.5 : 0);
  c.bond += (Math.min(25, 0.35 * c.rate + 1.5) + risk - c.bond) * 0.01;
  c.deficit = ((civil + defence + interest - revenue) * 52 / y) * 100;
  c.base.deficit ??= c.deficit;
  c.revenue = revenue * 52;
  c.spending = (civil + defence + interest) * 52;
  c.interest = interest * 52;
}

function tariffIncome(s, c) {
  let t = 0;
  for (const [key, level] of Object.entries(s.tariffs)) {
    const [a, b] = key.split('>');
    if (a !== c.id || !s.countries[b]) continue;
    t += (level / 100) * Math.min(c.gdp, s.countries[b].gdp) * 0.02 / 52;
  }
  return t;
}

function prices(s, c) {
  const b = c.base;
  let shortage = 0;
  for (const r of RESOURCES) shortage += SHORT_WEIGHT[r] * (c.short[r] ?? 0);
  const m = s.market.price;
  let target = b.infl + 0.35 * ((c.deficit ?? 0) - (b.deficit ?? 0)) - 0.5 * (c.rate - b.rate)
    + 14 * shortage + 2 * (m.oil - 1) + 1.5 * (m.food - 1) + 1.5 * c.mob;
  if (c.stimulus && c.stimulus.until > s.week) target += c.stimulus.boost * 0.8;
  c.infl += (Math.max(-3, target) - c.infl) * 0.06;
}

function mobilisation(s, c) {
  c.reserveBase ??= c.reserves + c.mobTroops;
  const want = c.reserveBase * [0, 0.3, 0.8][c.mob];
  let step = clamp(want - c.mobTroops, -0.08 * c.reserveBase, 0.08 * c.reserveBase);
  // Reservists already drafted straight into armies can't be called up twice
  if (step > 0) step = Math.min(step, Math.max(0, c.reserves));
  if (step < 0) {
    const inArmies = Object.values(s.armies).filter((a) => a.owner === c.id).reduce((t, a) => t + a.troops, 0);
    step = Math.max(step, -(c.troops - inArmies));
  }
  c.mobTroops += step;
  c.troops += step;
  c.reserves -= step;
}

function opinion(s, c, mods) {
  const b = c.base;
  const sp = c.spend;
  let target = b.approval
    + clamp(2.5 * ((c.growth ?? c.trend) - b.growth), -12, 10)
    - 1.2 * Math.max(0, c.infl - Math.max(3, b.infl + 1))
    - 1.0 * (c.tax - b.tax)
    + 0.8 * (sp.health - b.spend.health) + 0.5 * (sp.welfare - b.spend.welfare) + 0.4 * (sp.edu - b.spend.edu)
    - Math.min(30, c.warWeariness)
    - (c.protestDrag ?? 0) - (c.draftDrag ?? 0)
    + c.rally + c.boost
    - 25 * (c.short.food ?? 0) - 10 * (c.short.gas ?? 0) - 8 * (c.short.oil ?? 0);
  let lost = 0;
  let total = 0;
  for (const reg of Object.values(s.regions)) {
    if (reg.owner !== c.id) continue;
    total += reg.pop;
    if (reg.ctrl !== c.id) lost += reg.pop;
  }
  const occupied = total ? lost / total : 0;
  target -= occupied * 30;
  const autocracy = c.gov === 'autocracy';
  target -= [0, autocracy ? 2 : 4, autocracy ? 5 : 10][c.mob];
  if (c.ration) target -= 6;
  if (c.martial) target -= 15;
  for (const m of mods) if (m.kind === 'approval') target += m.value;
  c.approval = clamp(c.approval + (clamp(target, 2, 95) - c.approval) * 0.06, 0, 100);
  c.rally *= 0.97;
  c.boost *= 0.94;
  c.warWeariness *= enemiesOf(s, c.id).size ? 0.995 : 0.97;

  let stab = 0.6 * c.approval + (autocracy ? 32 : c.gov === 'hybrid' ? 26 : 22) + (c.martial ? 15 : 0) - occupied * 20 - 20 * (c.short.food ?? 0)
    - (c.protestDrag ?? 0) * 0.8 - (c.civilWar ? 15 : 0);
  for (const m of mods) if (m.kind === 'stability') stab += m.value;
  c.stability = clamp(c.stability + (clamp(stab, 0, 100) - c.stability) * 0.05, 0, 100);
  c.rep += (b.rep - c.rep) * 0.004;

  if (c.stability < 15 && chance(s, 0.03)) {
    alert(s, c.id, 'Government crisis: mass protests forced a cabinet reshuffle. Approval and the treasury took a hit.', 'bad');
    news(s, `Mass protests rock ${c.name}; the government survives a crisis.`, 'unrest', [c.id]);
    c.treasury *= 0.97;
    c.approval = Math.max(0, c.approval - 5);
  }
}

function research(s, c) {
  const points = (c.gdp * c.spend.research) / 100 / 52 * (1 + 0.03 * (c.spend.edu - c.base.spend.edu)) * 0.5;
  const fields = Object.keys(TECH_FIELDS);
  for (const f of fields) {
    const share = f === c.focus ? 0.4 : 0.6 / (fields.length - 1);
    c.progress[f] += points * share;
    const cost = researchCost(c.tech[f]);
    if (c.tech[f] < 12 && c.progress[f] >= cost) {
      c.progress[f] -= cost;
      c.tech[f]++;
      alert(s, c.id, `Breakthrough: ${TECH_FIELDS[f].name} reached level ${c.tech[f]}. ${TECH_FIELDS[f].note}.`, 'good');
    }
  }
}

function production_(s, c) {
  for (const order of c.queue) {
    const kind = BUILD[order.kind];
    const short = Math.max(0, ...kind.needs.map((r) => c.short[r] ?? 0));
    order.left -= 1 - 0.8 * short;
  }
  const done = c.queue.filter((o) => o.left <= 0);
  c.queue = c.queue.filter((o) => o.left > 0);
  for (const o of done) {
    const kind = BUILD[o.kind];
    if (o.kind === 'troops') c.troops += o.qty;
    else c[o.kind] += o.qty;
    alert(s, c.id, `Delivered: ${o.qty} ${kind.unit}.`, 'good');
  }
}

function projects(s, c) {
  for (const p of c.projects) p.left -= 1;
  const done = c.projects.filter((p) => p.left <= 0);
  c.projects = c.projects.filter((p) => p.left > 0);
  for (const p of done) {
    const reg = s.regions[p.region];
    if (!reg || reg.owner !== c.id) continue;
    if (p.kind === 'develop' && reg.res[p.res]) {
      reg.res[p.res][0] = reg.res[p.res][1];
      alert(s, c.id, `${RESOURCE_INFO[p.res].name} development in ${regionName(p.region)} is complete.`, 'good');
    }
    if (p.kind === 'infra') {
      reg.infra = Math.min(10, reg.infra + 1);
      reg.gdp *= 1.02;
      alert(s, c.id, `New infrastructure finished in ${regionName(p.region)}.`, 'good');
    }
    if (p.kind === 'fort') {
      reg.fort = Math.min(5, reg.fort + 1);
      alert(s, c.id, `Fortifications in ${regionName(p.region)} raised to level ${reg.fort}.`, 'good');
    }
  }
}

const regionName = (id) => REGION_NAMES[id] ?? id;

function nuclearProgramme(s, c) {
  const p = c.nukeProgram;
  if (!p.on || c.nukes > 0) return;
  const cost = 0.15 + c.gdp * 0.00002;
  c.treasury -= cost;
  const fuel = (c.short.uran ?? 0) < 0.5 && (c.stock.uran ?? 0) > 0.001 ? 1 : 0.25;
  p.progress += 0.003 * (1 + c.tech.nuclear / 6) * fuel;
  c.rep -= 0.12;
  if (p.progress >= 1) {
    c.nukes = 5;
    p.on = false;
    news(s, `${c.name} has tested its first nuclear weapon. The world reacts with alarm.`, 'nuclear', [c.id]);
    alert(s, c.id, 'Our first nuclear test succeeded: we now have 5 warheads and can build more.', 'good');
    c.rep = Math.max(0, c.rep - 15);
  }
}

function elections(s, c) {
  if (c.electionWeek == null || s.week < c.electionWeek) return;
  c.electionWeek = s.week + 208;
  const swing = (rand(s) - 0.5) * 8;
  const hybrid = c.gov === 'hybrid';
  const won = c.approval + swing >= (hybrid ? 30 : Math.min(45, c.base.approval + 4));
  if (won) {
    c.stability = Math.min(100, c.stability + 8);
    c.boost += 5;
    news(s, `${c.name} goes to the polls: the government wins a new mandate.`, 'election', [c.id]);
    alert(s, c.id, `Election day: you won with approval at ${Math.round(c.approval)}%. Your mandate is renewed for four years.`, 'good');
  } else {
    c.stability = Math.max(0, c.stability - 18);
    c.approval = 45;
    news(s, `Election upset in ${c.name}: the ruling party loses its majority and must govern in a fragile coalition.`, 'election', [c.id]);
    alert(s, c.id, 'Election day: your party lost its majority. You stay on at the head of a weak coalition, and stability has fallen.', 'bad');
  }
}

function history(s, c) {
  c.gw ??= [];
  c.gw.push(c.gdp);
  if (c.gw.length > 53) c.gw.shift();
  if (c.gw.length > 13) c.growth = (Math.pow(c.gdp / c.gw[c.gw.length - 14], 4) - 1) * 100;
  else c.growth = c.trendNow;
  if (s.week % 4 === 0) {
    const h = c.history;
    h.gdp.push(Math.round(c.gdp));
    h.approval.push(Math.round(c.approval));
    h.growth.push(Math.round(c.growth * 10) / 10);
    h.infl.push(Math.round(c.infl * 10) / 10);
    h.debt.push(Math.round(debtRatio(c)));
    for (const k of Object.keys(h)) if (h[k].length > 130) h[k].shift();
  }
}

export { isMinor, nameOf, money, treaty };
