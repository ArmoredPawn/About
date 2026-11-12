// War: army groups, operations, battles, supply, air and naval campaigns, missiles and nuclear weapons.
//
// Leaders give big orders ("take the North Caucasus oil fields", "hold the Suwałki Gap", "land on Taiwan").
// Each army's general handles the rest every week: the route, when to attack and when to regroup.

import { GEO } from './data/geo.js';
import { TERRAIN } from './data/regions.js';
import { REGION_NAMES, MINOR_TERRAIN, MINOR_QUALITY } from './names.js';
import {
  clamp, rand, chance, pick, news, alert, nameOf, nation, isMinor, atWar, allied, enemiesOf, friendlyGround,
  onSameSide, addRel, nextId, troopsLabel, alive,
} from './core.js';
import { navalPower } from './economy.js';
import { PROVINCES } from './data/regions.js';
import { COUNTRIES } from './data/countries.js';

export const MAX_ARMIES = 14;
export const TRAITS = {
  aggressive: { name: 'Aggressive', note: '+15% attack, heavier losses' },
  defensive: { name: 'Defensive', note: '+20% in defence' },
  logistician: { name: 'Logistician', note: 'Better supply, regroups faster' },
  maneuver: { name: 'Maneuver', note: 'Moves faster, finds better routes' },
  cautious: { name: 'Cautious', note: 'Fewer losses, slower to attack' },
};
export const AGGRESSION = {
  cautious: { name: 'Cautious', attackAt: 1.4, losses: 0.75 },
  balanced: { name: 'Balanced', attackAt: 0.9, losses: 1 },
  allout: { name: 'All-out', attackAt: 0, losses: 1.4 },
};

const TERRAIN_OF = Object.fromEntries(PROVINCES.map((p) => [p.id, p.terrain]));
export const terrainOf = (id) => TERRAIN[TERRAIN_OF[id] ?? MINOR_TERRAIN[id] ?? 'plains'];
export const regionName = (id) => REGION_NAMES[id] ?? id;

/* ---------- Measures ---------- */

const quality = (s, id) => (s.countries[id] ? 0.6 + 0.08 * s.countries[id].tech.army : MINOR_QUALITY[id] ?? 0.5);
// Big provinces take longer to overrun: there is more ground to cross and hold
const depth = (id) => clamp(Math.sqrt((GEO[id]?.area ?? 1500) / 1500), 0.7, 3.5);
const airQuality = (c) => 0.6 + 0.08 * c.tech.air;

export function distanceKm(a, b) {
  const ga = GEO[a];
  const gb = GEO[b];
  const toRad = Math.PI / 180;
  const dLat = (gb.lat - ga.lat) * toRad;
  const dLon = (gb.lon - ga.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(ga.lat * toRad) * Math.cos(gb.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Forces a holder keeps at home, spread over the provinces it controls (more on fronts and around the capital)
export function garrisons(s) {
  const out = new Map();
  const holders = new Map();
  for (const reg of Object.values(s.regions)) {
    const list = holders.get(reg.ctrl) ?? holders.set(reg.ctrl, []).get(reg.ctrl);
    list.push(reg);
  }
  for (const [holder, regs] of holders) {
    const n = nation(s, holder);
    if (!n) continue;
    let troops = n.troops;
    let tanks = n.tanks;
    for (const a of Object.values(s.armies)) if (a.owner === holder) { troops -= a.troops; tanks -= a.tanks; }
    troops = Math.max(0, troops);
    tanks = Math.max(0, tanks);
    const enemies = enemiesOf(s, holder);
    const weights = regs.map((reg) => {
      const front = GEO[reg.id].adj.some((id) => enemies.has(s.regions[id]?.ctrl));
      const capital = PROVINCES.find((p) => p.id === reg.id)?.capital;
      return 1 + (front ? 5 : 0) + (capital ? 2 : 0) + (reg.owner === holder ? 0 : 0.5);
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    regs.forEach((reg, i) => out.set(reg.id, { troops: (troops * weights[i]) / total, tanks: (tanks * weights[i]) / total, holder }));
  }
  return out;
}

function power(troops, tanks, qual, org, supply, terrain) {
  return (troops + tanks * 0.05 * terrain.armor) * qual * (0.35 + 0.65 * org / 100) * supply;
}

function genBonus(gen, role) {
  let m = 1 + 0.04 * (gen.skill - 1);
  if (gen.trait === 'aggressive' && role === 'attack') m *= 1.15;
  if (gen.trait === 'defensive' && role === 'defend') m *= 1.2;
  if (gen.trait === 'cautious' && role === 'attack') m *= 0.9;
  return m;
}

// A rough strength guess for a province's defence, used by generals and the AI to plan
export function defenceEstimate(s, regionId, gar = garrisons(s)) {
  const reg = s.regions[regionId];
  const terrain = terrainOf(regionId);
  const g = gar.get(regionId) ?? { troops: 0, tanks: 0 };
  let p = power(g.troops, g.tanks, quality(s, reg.ctrl), 80, 1, terrain);
  for (const a of Object.values(s.armies)) {
    if (a.region === regionId && !a.sea && onSameSide(s, a.owner, reg.ctrl)) {
      p += power(a.troops, a.tanks, quality(s, a.owner), a.org, a.supply, terrain) * genBonus(a.gen, 'defend');
    }
  }
  return p * terrain.defend * (1 + 0.15 * reg.fort);
}

export function armyAttackEstimate(s, a, regionId) {
  return power(a.troops, a.tanks, quality(s, a.owner), a.org, a.supply, terrainOf(regionId)) * genBonus(a.gen, 'attack');
}

/* ---------- Routes ---------- */

// Cheapest route for an army: through friendly ground, and (for an offensive) through enemy provinces
export function route(s, owner, from, to, { offensive = true, maneuver = false } = {}) {
  if (from === to) return [];
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = [[0, from]];
  const done = new Set();
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, id] = open.shift();
    if (done.has(id)) continue;
    done.add(id);
    if (id === to) break;
    for (const next of GEO[id].adj) {
      const reg = s.regions[next];
      if (!reg) continue;
      const holder = reg.ctrl;
      const terrain = terrainOf(next);
      let cost;
      if (friendlyGround(s, owner, holder) || onSameSide(s, owner, holder) && !atWar(s, owner, holder)) cost = 0.5 * terrain.move;
      else if (offensive && atWar(s, owner, holder)) cost = 2 * terrain.move * terrain.defend + 1;
      else continue;
      if (maneuver) cost *= 0.8;
      const nd = d + cost;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, id);
        open.push([nd, next]);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path = [];
  for (let id = to; id !== from; id = prev.get(id)) path.unshift(id);
  return path;
}

/* ---------- Orders ---------- */

export function createArmy(s, c, { region, troops, tanks = 0, name }) {
  const mine = Object.values(s.armies).filter((a) => a.owner === c.id);
  if (mine.length >= MAX_ARMIES) return `You can field at most ${MAX_ARMIES} army groups. Merge or disband one first.`;
  const reg = s.regions[region];
  if (!reg || reg.ctrl !== c.id) return 'Armies form in a province you control.';
  const free = freeForces(s, c);
  troops = Math.floor(Number(troops));
  tanks = Math.floor(Number(tanks) || 0);
  if (!(troops >= 5)) return 'An army group needs at least 5,000 troops.';
  if (troops > free.troops) return `Only ${troopsLabel(free.troops)} troops are free to assign.`;
  if (tanks < 0 || tanks > free.tanks) return `Only ${Math.floor(free.tanks)} tanks are free to assign.`;
  const id = nextId(s, 'a');
  const n = mine.length + 1;
  s.armies[id] = {
    id, owner: c.id, name: String(name || `${ordinal(c.generalsUsed + 1)} Army`).slice(0, 28),
    gen: newGeneral(s, c), region, troops, tanks, org: 70, supply: 1,
    op: { kind: 'hold', target: region, aggr: 'balanced' }, path: [], move: null, sea: null, attacking: null,
    status: `Forming up in ${regionName(region)}`,
  };
  c.generalsUsed++;
  return null;
}

export function freeForces(s, c) {
  let troops = c.troops;
  let tanks = c.tanks;
  for (const a of Object.values(s.armies)) if (a.owner === c.id) { troops -= a.troops; tanks -= a.tanks; }
  return { troops: Math.max(0, troops), tanks: Math.max(0, tanks) };
}

function newGeneral(s, c) {
  const names = COUNTRIES[c.id]?.generals ?? ['Smith'];
  const surname = names[c.generalsUsed % names.length];
  const rank = c.generalsUsed >= names.length ? ` ${['II', 'III', 'IV'][Math.floor(c.generalsUsed / names.length) - 1] ?? ''}` : '';
  const r = rand(s);
  return { name: `Gen. ${surname}${rank}`.trim(), skill: r < 0.15 ? 5 : r < 0.4 ? 4 : r < 0.75 ? 3 : 2, trait: pick(s, Object.keys(TRAITS)) };
}


export function orderArmy(s, c, army, { kind, target, aggr = 'balanced' }) {
  if (!army || army.owner !== c.id) return 'That army is not yours.';
  if (!s.regions[target]) return 'Pick a province on the map.';
  if (!AGGRESSION[aggr]) aggr = 'balanced';
  if (army.sea) return `${army.name} is at sea and can't take new orders until it lands.`;
  const maneuver = army.gen.trait === 'maneuver';
  if (kind === 'hold') {
    const path = route(s, c.id, army.region, target, { offensive: false, maneuver });
    if (!path) return `${army.gen.name} can't find a route to ${regionName(target)} through friendly ground.`;
    army.op = { kind, target, aggr };
    army.path = path;
    army.status = path.length ? `Moving to hold ${regionName(target)}` : `Holding ${regionName(target)}`;
    return null;
  }
  if (kind === 'attack') {
    const holder = s.regions[target].ctrl;
    if (!atWar(s, c.id, holder)) return `You are not at war with ${nameOf(s, holder)}. Declare war first.`;
    const path = route(s, c.id, army.region, target, { offensive: true, maneuver });
    if (!path) return `${army.gen.name} reports no land route to ${regionName(target)}. Try an amphibious invasion.`;
    army.op = { kind, target, aggr };
    army.path = path;
    army.status = `Advancing on ${regionName(target)}`;
    return null;
  }
  if (kind === 'invade') {
    const holder = s.regions[target].ctrl;
    if (!atWar(s, c.id, holder)) return `You are not at war with ${nameOf(s, holder)}. Declare war first.`;
    if (!GEO[army.region].coast || s.regions[army.region].ctrl !== c.id) return 'Amphibious landings set out from a coastal province you control.';
    if (!GEO[target].coast) return `${regionName(target)} has no coast to land on.`;
    if (c.ships < 3) return 'You need at least 3 warships to escort a landing.';
    const km = distanceKm(army.region, target);
    const reach = c.carriers > 0 ? 20000 : 1500 + c.ships * 25;
    if (km > reach) return `${regionName(target)} is ${Math.round(km)} km away, beyond your navy's reach (${Math.round(reach)} km). Aircraft carriers extend it.`;
    army.op = { kind, target, aggr };
    army.path = [];
    army.sea = { from: army.region, to: target, left: Math.ceil(km / 1500) + 1 };
    army.status = `At sea, bound for ${regionName(target)}`;
    return null;
  }
  return 'Unknown order.';
}

export function disbandArmy(s, c, army) {
  if (!army || army.owner !== c.id) return 'That army is not yours.';
  if (army.sea) return 'An army at sea cannot disband.';
  delete s.armies[army.id];
  return null;
}

export function reinforceArmy(s, c, army, { troops = 0, tanks = 0 }) {
  if (!army || army.owner !== c.id) return 'That army is not yours.';
  if (army.sea || !friendlyGround(s, c.id, s.regions[army.region].ctrl)) return 'Reinforcements reach armies on friendly ground only.';
  const free = freeForces(s, c);
  troops = Math.max(-army.troops + 5, Math.floor(Number(troops) || 0));
  tanks = Math.max(-army.tanks, Math.floor(Number(tanks) || 0));
  if (troops > free.troops || tanks > free.tanks) return 'Not enough free forces at home.';
  army.troops += troops;
  army.tanks += tanks;
  if (troops > 0) army.org = Math.max(30, army.org - 10 * (troops / (army.troops)));
  return null;
}

export function mergeArmies(s, c, ids) {
  const list = ids.map((id) => s.armies[id]).filter((a) => a && a.owner === c.id && !a.sea);
  if (list.length < 2) return 'Pick two or more of your armies.';
  if (new Set(list.map((a) => a.region)).size > 1) return 'Armies must be in the same province to merge.';
  const [keep, ...rest] = list;
  for (const a of rest) {
    keep.org = (keep.org * keep.troops + a.org * a.troops) / (keep.troops + a.troops);
    keep.troops += a.troops;
    keep.tanks += a.tanks;
    delete s.armies[a.id];
  }
  return null;
}

/* ---------- Strikes ---------- */

export function missileStrike(s, c, target, count) {
  const reg = s.regions[target];
  if (!reg) return 'Pick a province.';
  if (!atWar(s, c.id, reg.ctrl)) return `You are not at war with ${nameOf(s, reg.ctrl)}.`;
  count = Math.floor(Number(count));
  if (!(count > 0) || count > c.missiles) return `You have ${c.missiles} missiles.`;
  const def = s.countries[reg.ctrl];
  const intercept = def ? clamp(0.055 * def.tech.missile - 0.02 * (c.tech.missile - 6), 0, 0.75) : 0.05;
  const hits = Math.round(count * (1 - intercept) * (0.85 + rand(s) * 0.3));
  c.missiles -= count;
  const dmg = Math.min(0.35, hits * 0.0016 * (c.tech.missile / 8));
  reg.dmg = clamp(reg.dmg + dmg, 0, 0.95);
  for (const a of Object.values(s.armies)) if (a.region === target && a.owner === reg.ctrl) a.troops = Math.max(1, a.troops - hits * 0.04);
  const n = nation(s, reg.ctrl);
  if (n) n.troops = Math.max(0, n.troops - hits * 0.02);
  news(s, `${c.name} fires ${count} missiles at ${regionName(target)}. ${hits} get through${intercept > 0.2 ? ` air defences` : ''}.`, 'strike', [c.id, reg.ctrl]);
  alert(s, reg.ctrl, `${count} missiles from ${c.name} struck ${regionName(target)}: damage now ${Math.round(reg.dmg * 100)}%.`, 'bad');
  return null;
}

export function nuclearStrike(s, c, target, retaliation = false) {
  const reg = s.regions[target];
  if (!reg) return 'Pick a province.';
  if (c.nukes < 1) return 'You have no nuclear weapons.';
  if (!atWar(s, c.id, reg.ctrl) && !retaliation) return `You are not at war with ${nameOf(s, reg.ctrl)}.`;
  const victim = reg.ctrl;
  c.nukes -= 1;
  s.nukesUsed++;
  const deaths = reg.pop * 0.25;
  reg.pop *= 0.55;
  reg.gdp *= 0.3;
  reg.dmg = 0.92;
  reg.unrest = 90;
  for (const a of Object.values(s.armies)) {
    if (a.region === target) { a.troops *= 0.25; a.tanks *= 0.25; a.org = 5; }
  }
  const n = nation(s, victim);
  if (n) n.troops *= 0.94;
  c.rep = 0;
  for (const other of Object.values(s.countries)) {
    if (other.id !== c.id) addRel(s, c.id, other.id, -70);
    other.approval = Math.max(0, other.approval - 3);
  }
  s.modifiers.push({ id: nextId(s, 'm'), cid: 'all', kind: 'gdp', value: -0.015, until: s.week + 52 });
  news(s, `NUCLEAR DETONATION: ${c.name} has used a nuclear weapon on ${regionName(target)} (${nameOf(s, victim)}). An estimated ${Math.round(deaths * 10) / 10} million people are dead or missing.`, 'nuclear', [c.id, victim]);
  if (s.nukesUsed >= 10 && !s.winterUntil) {
    s.winterUntil = s.week + 156;
    news(s, 'Smoke from burning cities is cooling the planet. A nuclear winter is cutting harvests worldwide.', 'nuclear');
  }
  if (!retaliation) answerNuclearStrike(s, c.id, victim);
  return null;
}

// Second strike: the victim (if it can) or a nuclear-armed ally answers; human leaders are told and choose
function answerNuclearStrike(s, attacker, victim) {
  const candidates = [victim, ...Object.keys(s.countries).filter((id) => id !== victim && allied(s, id, victim))];
  for (const id of candidates) {
    const c = s.countries[id] ?? null;
    const minor = s.minors[id];
    if (minor && minor.nukes > 0) continue;
    if (!c || c.nukes < 1 || !alive(s, id)) continue;
    if (c.human) {
      alert(s, id, `${nameOf(s, attacker)} has launched a nuclear strike${id === victim ? ' on us' : ` on our ally ${nameOf(s, victim)}`}. You may retaliate from the Military tab.`, 'nuclear');
      continue;
    }
    if (!atWar(s, id, attacker)) s.wars.push({ id: nextId(s, 'w'), a: id, b: attacker, since: s.week, goal: 'retaliation', lossA: 0, lossB: 0 });
    const targets = Object.values(s.regions).filter((r) => r.owner === attacker && r.ctrl === attacker).sort((a, b) => b.gdp - a.gdp);
    if (targets[0]) nuclearStrike(s, c, targets[0].id, true);
    return;
  }
}

export function setBlockade(s, c, target, ships) {
  ships = Math.floor(Number(ships) || 0);
  if (ships <= 0) { delete c.blockades[target]; return null; }
  if (!atWar(s, c.id, target)) return `You are not at war with ${nameOf(s, target)}.`;
  const committed = Object.entries(c.blockades).reduce((t, [k, v]) => t + (k === target ? 0 : v), 0);
  if (ships + committed > c.ships) return `You have ${c.ships - committed} warships free.`;
  c.blockades[target] = ships;
  news(s, `${c.name}'s navy blockades ${nameOf(s, target)}.`, 'war', [c.id, target]);
  alert(s, target, `${c.name} has blockaded our ports with ${ships} warships. Trade by sea is being cut.`, 'bad');
  return null;
}

export function setAirCampaign(s, c, target, aircraft) {
  aircraft = Math.floor(Number(aircraft) || 0);
  c.airOps = c.airOps.filter((o) => o.region !== target);
  if (aircraft <= 0) return null;
  const reg = s.regions[target];
  if (!reg || !atWar(s, c.id, reg.ctrl)) return 'Air campaigns target provinces held by an enemy.';
  const committed = c.airOps.reduce((t, o) => t + o.aircraft, 0);
  if (aircraft + committed > c.aircraft) return `You have ${c.aircraft - committed} aircraft free.`;
  c.airOps.push({ region: target, aircraft });
  alert(s, reg.ctrl, `${c.name} has begun bombing ${regionName(target)}.`, 'bad');
  return null;
}

/* ---------- The weekly war ---------- */

export function militaryTick(s) {
  const gar = garrisons(s);
  supplyAll(s);
  const fights = new Map(); // region -> attacking armies

  for (const a of Object.values(s.armies)) {
    const c = s.countries[a.owner];
    if (!c || !alive(s, a.owner)) { delete s.armies[a.id]; continue; }
    a.attacking = null;
    if (a.sea) {
      a.sea.left -= 1;
      const enemyNavy = navalPower(nation(s, s.regions[a.sea.to].ctrl) ?? { ships: 0, carriers: 0, tech: {} });
      const mine = navalPower(c);
      if (enemyNavy > 0 && a.sea.left > 0) {
        const lost = 0.06 * enemyNavy / (enemyNavy + mine + 1);
        a.troops *= 1 - lost;
        a.tanks *= 1 - lost;
        c.ships = Math.max(0, c.ships - Math.round(c.ships * 0.01 * enemyNavy / (enemyNavy + mine + 1)));
      }
      if (a.sea.left <= 0 && a.landing && (a.org < 12 || a.troops < 3)) {
        // The landing has failed: what is left re-embarks for home
        a.region = a.sea.from;
        a.sea = null;
        a.landing = false;
        a.op = { kind: 'hold', target: a.region, aggr: a.op.aggr };
        a.status = 'Withdrawn after a failed landing';
        alert(s, a.owner, `${a.gen.name} reports: the landing has been thrown back. ${a.name} has re-embarked for ${regionName(a.region)}.`, 'bad');
        news(s, `${nameOf(s, a.owner)}'s landing is thrown back into the sea.`, 'war', [a.owner]);
        continue;
      }
      if (a.sea.left <= 0) {
        const holder = s.regions[a.sea.to].ctrl;
        if (holder === c.id || friendlyGround(s, c.id, holder)) {
          a.region = a.sea.to;
          a.sea = null;
          a.status = `Landed in ${regionName(a.region)}`;
        } else if (atWar(s, c.id, holder)) {
          a.attacking = a.sea.to;
          a.landing = true;
          addFight(fights, a.sea.to, a);
          a.status = `Storming the beaches of ${regionName(a.sea.to)}`;
        } else {
          a.region = a.sea.from;
          a.sea = null;
          a.status = 'Landing called off; returned to port';
        }
      }
      continue;
    }
    const recover = a.gen.trait === 'logistician' ? 12 : 8;
    let budget = 1;
    while (a.path.length && budget > 0) {
      const next = a.path[0];
      const holder = s.regions[next].ctrl;
      if (friendlyGround(s, a.owner, holder)) {
        const terrain = terrainOf(next);
        const cost = 0.45 * terrain.move * (1 - 0.04 * s.regions[next].infra) * (a.gen.trait === 'maneuver' ? 0.7 : 1);
        a.region = next;
        a.path.shift();
        budget -= cost;
        continue;
      }
      if (atWar(s, a.owner, holder) && a.op.kind === 'attack') {
        const odds = armyAttackEstimate(s, a, next) / Math.max(1, defenceEstimate(s, next, gar));
        if (a.org < 25) { a.status = `Regrouping before ${regionName(next)} (organisation ${Math.round(a.org)}%)`; a.regrouping = true; break; }
        if (a.regrouping && a.org < 60) { a.status = `Regrouping before ${regionName(next)} (organisation ${Math.round(a.org)}%)`; break; }
        a.regrouping = false;
        if (odds < AGGRESSION[a.op.aggr].attackAt) { a.status = `Waiting for better odds at ${regionName(next)} (${odds.toFixed(1)}:1)`; break; }
        a.attacking = next;
        addFight(fights, next, a);
        a.status = `Attacking ${regionName(next)}`;
        break;
      }
      // Neutral ground or the target changed hands: look for another way
      const again = route(s, a.owner, a.region, a.op.target, { offensive: a.op.kind === 'attack', maneuver: a.gen.trait === 'maneuver' });
      if (again && again[0] !== next) { a.path = again; continue; }
      a.path = [];
      a.status = `Halted: ${nameOf(s, holder)} blocks the way`;
      alert(s, a.owner, `${a.name} has halted: the route to ${regionName(a.op.target)} crosses ${nameOf(s, holder)}, which we are not at war with.`, 'warn');
      break;
    }
    if (!a.path.length && !a.attacking) {
      if (a.op.kind === 'attack' && a.region === a.op.target) {
        a.op = { kind: 'hold', target: a.region, aggr: a.op.aggr };
        alert(s, a.owner, `${a.gen.name} reports: ${a.name} has taken its objective, ${regionName(a.region)}, and is digging in.`, 'good');
      }
      if (a.op.kind === 'hold' || a.region === a.op.target) a.status = `Holding ${regionName(a.region)}`;
    }
    if (!a.attacking) a.org = Math.min(100 * (c.readiness ?? 1), a.org + recover * a.supply);
    if (a.supply < 0.5) {
      a.troops *= 0.99;
      a.org = Math.max(0, a.org - 5);
    }
  }

  // Battles
  const battled = new Set();
  for (const [regionId, attackers] of fights) {
    battle(s, regionId, attackers, gar);
    battled.add(regionId);
  }
  for (const reg of Object.values(s.regions)) {
    if (reg.battle && !battled.has(reg.id)) {
      reg.battle.prog -= 20;
      if (reg.battle.prog <= 0) reg.battle = null;
    }
  }

  airAndSea(s);
}

function addFight(fights, regionId, army) {
  (fights.get(regionId) ?? fights.set(regionId, []).get(regionId)).push(army);
}

function battle(s, regionId, attackers, gar) {
  const reg = s.regions[regionId];
  const holder = reg.ctrl;
  const terrain = terrainOf(regionId);
  attackers = attackers.filter((a) => atWar(s, a.owner, holder));
  if (!attackers.length) return;
  const lead = attackers.reduce((m, a) => (a.troops > m.troops ? a : m)).owner;

  // Air superiority over the battlefield: aircraft for both sides, plus the defender's air defences
  const airOf = (id) => {
    const c = s.countries[id];
    if (!c) return 0;
    const busy = Math.max(1, enemiesOf(s, id).size);
    return c.aircraft * airQuality(c) * 0.6 / busy;
  };
  const airA = airOf(lead);
  const hd = s.countries[holder];
  const airD = airOf(holder) + (hd ? hd.tech.missile * 25 : 30 + (s.minors[holder]?.troops ?? 0) * 0.05);
  const airEdge = (airA - airD) / (airA + airD + 1);

  let attack = 0;
  let attackTroops = 0;
  for (const a of attackers) {
    let p = armyAttackEstimate(s, a, regionId);
    if (a.landing) p *= 0.5;
    attack += p;
    attackTroops += a.troops;
  }
  attack *= 1 + 0.3 * airEdge;

  const g = gar.get(regionId) ?? { troops: 0, tanks: 0 };
  const defenders = Object.values(s.armies).filter((a) => a.region === regionId && !a.sea && onSameSide(s, a.owner, holder));
  let defence = power(g.troops, g.tanks, quality(s, holder), 80, 1, terrain);
  let defendTroops = g.troops;
  for (const a of defenders) {
    defence += power(a.troops, a.tanks, quality(s, a.owner), a.org, a.supply, terrain) * genBonus(a.gen, 'defend') * (a.op.kind === 'hold' ? 1.1 : 1);
    defendTroops += a.troops;
  }
  defence *= terrain.defend * (1 + 0.15 * reg.fort) * (1 - 0.2 * airEdge);
  defence = Math.max(defence, 0.5);

  const ratio = attack / defence;
  reg.battle = reg.battle && reg.battle.by === lead ? reg.battle : { by: lead, prog: 0 };
  const step = (ratio >= 1 ? Math.min(45, 10 + 20 * (ratio - 1)) : -12 * (1 - ratio)) / depth(regionId);
  reg.battle.prog = clamp(reg.battle.prog + step, 0, 100);

  // Losses
  let attackLoss = 0;
  for (const a of attackers) {
    const style = AGGRESSION[a.op.aggr].losses * (a.gen.trait === 'aggressive' ? 1.2 : a.gen.trait === 'cautious' ? 0.75 : 1);
    const rate = 0.016 * clamp(1 / ratio, 0.35, 2.5) * style * (a.landing ? 1.8 : 1);
    const lost = a.troops * rate;
    a.troops -= lost;
    a.tanks *= 1 - rate * 1.4;
    a.org = Math.max(0, a.org - (a.op.aggr === 'allout' ? 14 : 10));
    attackLoss += lost;
  }
  const defRate = 0.016 * clamp(ratio, 0.35, 2.5);
  let defendLoss = 0;
  for (const a of defenders) {
    const lost = a.troops * defRate * (a.gen.trait === 'defensive' ? 0.85 : 1);
    a.troops -= lost;
    a.tanks *= 1 - defRate * 1.3;
    a.org = Math.max(0, a.org - 6);
    defendLoss += lost;
  }
  const gLost = g.troops * defRate;
  const hn = nation(s, holder);
  if (hn) {
    hn.troops = Math.max(0, hn.troops - gLost);
    hn.tanks = Math.max(0, hn.tanks - g.tanks * defRate * 1.3);
  }
  defendLoss += gLost;
  for (const a of attackers) {
    const n = s.countries[a.owner];
    n.troops = Math.max(0, n.troops - attackLoss * (a.troops / Math.max(1, attackTroops)));
  }
  record(s, lead, attackLoss);
  record(s, holder, defendLoss);
  const war = s.wars.find((w) => (w.a === lead && w.b === holder) || (w.b === lead && w.a === holder));
  if (war) {
    if (war.a === lead) { war.lossA += attackLoss; war.lossB += defendLoss; } else { war.lossB += attackLoss; war.lossA += defendLoss; }
  }
  reg.dmg = Math.min(0.9, reg.dmg + 0.006);

  if (reg.battle.prog >= 100) capture(s, regionId, lead, attackers);
  for (const a of Object.values(s.armies)) if (a.troops < 1) destroyArmy(s, a, 'was destroyed in battle');
}

function record(s, id, lossK) {
  const c = s.countries[id];
  if (!c) return;
  c.losses += lossK;
  c.warWeariness += (lossK / Math.sqrt(Math.max(1, c.pop))) * 3;
}

function destroyArmy(s, a, how) {
  if (!s.armies[a.id]) return;
  delete s.armies[a.id];
  alert(s, a.owner, `${a.name} (${a.gen.name}) ${how}.`, 'bad');
  news(s, `${nameOf(s, a.owner)}'s ${a.name} ${how}.`, 'war', [a.owner]);
}

export function capture(s, regionId, by, attackers = []) {
  const reg = s.regions[regionId];
  const prev = reg.ctrl;
  reg.ctrl = by;
  reg.battle = null;
  reg.dmg = Math.min(0.9, reg.dmg + 0.05);
  if (by === reg.owner) {
    reg.unrest = 0;
  } else {
    reg.unrest = 45;
    // Retreating defenders wreck oil wells and mines (as at Maykop in 1942)
    if ((reg.res.oil || reg.res.gas) && chance(s, 0.6)) reg.dmg = Math.min(0.9, reg.dmg + 0.2);
  }
  // Defending armies fall back, or surrender if surrounded
  for (const a of Object.values(s.armies)) {
    if (a.region !== regionId || a.sea || a.owner === by || onSameSide(s, a.owner, by)) continue;
    const exits = GEO[regionId].adj.filter((id) => friendlyGround(s, a.owner, s.regions[id].ctrl));
    if (!exits.length) {
      destroyArmy(s, a, `was encircled in ${regionName(regionId)} and surrendered`);
      continue;
    }
    const best = exits.reduce((m, id) => (s.regions[id].ctrl === a.owner ? id : m), exits[0]);
    a.region = best;
    a.troops *= 0.9;
    a.tanks *= 0.85;
    a.org = Math.max(0, a.org / 2);
    a.path = [];
    a.status = `Fell back to ${regionName(best)}`;
  }
  // The attackers move in
  for (const a of attackers) {
    if (!s.armies[a.id]) continue;
    if (a.landing) {
      a.region = regionId;
      a.sea = null;
      a.landing = false;
    } else if (a.path[0] === regionId) {
      a.region = regionId;
      a.path.shift();
    }
  }
  const liberated = by === reg.owner;
  news(s, liberated
    ? `${nameOf(s, by)} liberates ${regionName(regionId)}.`
    : `${nameOf(s, by)} captures ${regionName(regionId)} from ${nameOf(s, prev)}.`, 'war', [by, prev]);
  alert(s, prev, `We have lost ${regionName(regionId)} to ${nameOf(s, by)}.`, 'bad', { region: regionId });
  alert(s, by, liberated ? `Our forces liberated ${regionName(regionId)}.` : `Our forces captured ${regionName(regionId)}.`, 'good', { region: regionId });
  collapseCheck(s, prev, by);
}

// A nation that holds none of its land has fallen
function collapseCheck(s, id, by) {
  const holds = Object.values(s.regions).some((r) => r.ctrl === id);
  if (holds) return;
  const minor = s.minors[id];
  if (minor) {
    minor.capitulated = true;
    s.wars = s.wars.filter((w) => w.a !== id && w.b !== id);
    news(s, `${minor.name} has capitulated to ${nameOf(s, by)}.`, 'war', [by, id]);
    const c = s.countries[by];
    if (c?.human) {
      minor.pendingSettle = { by, until: s.week + 8 };
      alert(s, by, `${minor.name} has surrendered. Decide its fate from the Diplomacy tab: annex it or install a friendly government.`, 'good', { settle: id });
    } else {
      settleMinor(s, by, id, 'puppet');
    }
    return;
  }
  const c = s.countries[id];
  if (!c || c.exile) return;
  c.exile = true;
  for (const reg of Object.values(s.regions)) if (reg.owner === id) reg.owner = reg.ctrl;
  for (const a of Object.values(s.armies)) if (a.owner === id) delete s.armies[a.id];
  s.wars = s.wars.filter((w) => w.a !== id && w.b !== id);
  for (const al of Object.values(s.alliances)) al.members = al.members.filter((m) => m !== id);
  news(s, `The government of ${c.name} has fallen. Its territory is divided between the occupying powers.`, 'war', [id, by]);
  alert(s, id, 'Our last province has fallen. The government is in exile: you can still talk to other leaders, but you no longer run a country.', 'bad');
}

export function settleMinor(s, by, minorId, how) {
  const minor = s.minors[minorId];
  if (!minor || !minor.capitulated) return 'That nation has not surrendered.';
  const regs = Object.values(s.regions).filter((r) => r.owner === minorId);
  minor.pendingSettle = null;
  const c = s.countries[by];
  if (how === 'annex') {
    for (const r of regs) { r.owner = r.ctrl; r.unrest = 60; }
    minor.annexed = true;
    if (c) c.rep = Math.max(0, c.rep - 12);
    news(s, `${nameOf(s, by)} annexes ${minor.name}. Much of the world refuses to recognise it.`, 'diplomacy', [by, minorId]);
    for (const other of Object.values(s.countries)) if (other.id !== by && !allied(s, other.id, by)) addRel(s, other.id, by, -10);
  } else {
    for (const r of regs) { r.ctrl = minorId; r.unrest = 20; }
    minor.puppetOf = by;
    minor.capitulated = false;
    minor.troops = Math.max(minor.troops, 2);
    if (c) c.rep = Math.max(0, c.rep - 5);
    news(s, `${nameOf(s, by)} installs a friendly government in ${minor.name}.`, 'diplomacy', [by, minorId]);
  }
  return null;
}

/* ---------- Supply ---------- */

function supplyAll(s) {
  const cache = new Map();
  for (const a of Object.values(s.armies)) {
    if (a.sea) { a.supply = 0.8; continue; }
    const c = s.countries[a.owner];
    const reg = s.regions[a.region];
    let supply;
    if (reg.owner === a.owner || (reg.ctrl !== a.owner && friendlyGround(s, a.owner, reg.ctrl))) supply = 1;
    else {
      const hops = (cache.get(a.owner) ?? cache.set(a.owner, homeDistance(s, a.owner)).get(a.owner)).get(a.region);
      if (hops == null) supply = GEO[a.region].coast && c.ships > 5 ? 0.6 : 0.25;
      else supply = clamp(1.05 - 0.1 * hops, 0.35, 1);
    }
    if (a.gen.trait === 'logistician') supply = Math.min(1, supply + 0.15);
    a.supply = supply * (1 - 0.6 * (c.short?.oil ?? 0));
  }
}

// Hops from each province held by this side back to home soil, through ground held by this side
function homeDistance(s, owner) {
  const dist = new Map();
  const queue = [];
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl === reg.owner && onSameSide(s, owner, reg.ctrl) && friendlyGround(s, owner, reg.ctrl)) {
      dist.set(reg.id, 0);
      queue.push(reg.id);
    }
  }
  while (queue.length) {
    const id = queue.shift();
    for (const next of GEO[id].adj) {
      if (dist.has(next)) continue;
      const holder = s.regions[next]?.ctrl;
      if (!holder || !(holder === owner || friendlyGround(s, owner, holder))) continue;
      dist.set(next, dist.get(id) + 1);
      queue.push(next);
    }
  }
  return dist;
}

/* ---------- Air campaigns and blockades ---------- */

function airAndSea(s) {
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    c.airOps = c.airOps.filter((op) => {
      const reg = s.regions[op.region];
      if (!reg || !atWar(s, c.id, reg.ctrl) || op.aircraft <= 0) return false;
      const def = s.countries[reg.ctrl];
      const defAir = def ? def.aircraft * airQuality(def) * 0.3 : 5;
      const adf = def ? def.tech.missile * 15 : 10;
      const mine = op.aircraft * airQuality(c);
      const eff = mine / (mine + defAir + adf);
      reg.dmg = Math.min(0.9, reg.dmg + 0.012 * eff * Math.min(1, op.aircraft / 80));
      const lost = Math.max(0, Math.round(op.aircraft * 0.006 * (1.2 - eff)));
      op.aircraft -= lost;
      c.aircraft = Math.max(0, c.aircraft - lost);
      if (def && defAir > 0) def.aircraft = Math.max(0, def.aircraft - Math.round(def.aircraft * 0.002 * eff));
      return op.aircraft > 0;
    });
    for (const [target, ships] of Object.entries(c.blockades)) {
      if (!atWar(s, c.id, target)) { delete c.blockades[target]; continue; }
      const t = s.countries[target];
      if (!t) continue;
      const mine = navalPower(c, ships, 0) + 1;
      const theirs = navalPower(t) + 0.1;
      const myLoss = Math.round(ships * 0.004 * theirs / (mine + theirs) * 2);
      const theirLoss = Math.round(t.ships * 0.004 * mine / (mine + theirs) * 2);
      c.ships = Math.max(0, c.ships - myLoss);
      c.blockades[target] = Math.max(0, ships - myLoss);
      t.ships = Math.max(0, t.ships - theirLoss);
    }
  }
}

function ordinal(n) {
  const sfx = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${sfx}`;
}

export { isMinor };
