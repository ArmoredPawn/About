// War: army groups, operations, battles, supply, air and naval campaigns, missiles and nuclear weapons.
//
// Leaders point at the map ("go to the North Caucasus oil fields") and the army goes at once: marching through
// friendly ground, fighting through enemy ground, landing from the sea. Fronts move both ways: an attack that is
// thrown back invites a counter-attack. Computer-run generals still pick their moment and regroup.

import { GEO } from './data/geo.js';
import { TERRAIN } from './data/regions.js';
import { REGION_NAMES, MINOR_TERRAIN, MINOR_QUALITY } from './names.js';
import {
  clamp, rand, chance, pick, news, alert as briefing, nameOf, nation, isMinor, atWar, allied, enemiesOf, friendlyGround, fuelCut,
  onSameSide, addRel, nextId, troopsLabel, alive, money, warsAccepted, rel, warBetween,
} from './core.js';
import { navyStep, navyTick, landingControl, crossingOdds, controlAt, PORTS, OFF_COAST } from './navy.js';
import { shippingStep } from './shipping.js';
import { citiesIn } from './cities.js';
import { fx as doctrineFx, matchup, noteFighting } from './doctrine.js';
import {
  cellAt, cellX, cellY, cellXY, regionAt, holderAt, setHolder, rebase, landPath, nearestLand, provinceCell, supplyMap, cutOff, CELLS_OF,
  CITIES_AT, dist, terrainAt, provinceShares, neighbours4, isLand, cellRuns, normaliseOcc, CELL as CELL_SIZE, GW as GRID_W, GH as GRID_H,
} from './land.js';
import { gpsCoverage, commsReady, satSees } from './space.js';
import { PROVINCES } from './data/regions.js';
import { NATIONS as COUNTRIES } from './data/nations.js';
import { surpriseFeature } from './terrain.js';
import { rangeProblem } from './science.js';

// Every report from the front is marked as war news, so it also runs in the News section
const alert = (s, cid, text, kind, extra = {}) => briefing(s, cid, text, kind, { front: true, ...extra });
// Spies deep inside the enemy's government: our generals fight knowing its plans
const knowsPlans = (s, who, enemy) => (s.countries[who]?.intel?.[enemy] ?? -1) > s.week;
// Troop numbers as the other side would put them: to the nearest 5,000
const approx = (k) => Math.max(1, Math.round(k / 5) * 5);

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
const depth = (id) => clamp(Math.sqrt((GEO[id]?.area ?? 1500) / 1500), 0.7, 2.2);
// How big a province is next to an ordinary one (1), up to about 3 for Siberia or the Sahara
const size = (id) => depth(id) / 0.7;
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
      const capital = PROVINCES.find((p) => p.id === reg.id)?.capital || reg.id === holder;
      return 1 + (front ? 5 : 0) + (capital ? 2 : 0) + (reg.owner === holder ? 0 : 0.5);
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    regs.forEach((reg, i) => out.set(reg.id, { troops: (troops * weights[i]) / total, tanks: (tanks * weights[i]) / total, holder }));
  }
  return out;
}

// Fighting strength. Numbers count most: an exhausted army still fights at 75% and one short of supply at 70%,
// so three million tired, hungry men are worth far more than a million fresh ones.
function power(troops, tanks, qual, org, supply, terrain) {
  return (troops + tanks * 0.05 * terrain.armor) * qual * (0.75 + 0.25 * org / 100) * (0.7 + 0.3 * supply);
}

// What ground and fortifications add to a defence. They help, but they can't make up for being outnumbered
// three to one: mountains count about 1.55 times, a fully fortified line half as much again.
export const holdFactor = (terrain, fort = 0) => terrain.defend ** 0.75 * (1 + 0.1 * fort);

// Sheer mass: a side with two, three, four times the men can attack everywhere at once, feed in fresh units and
// outflank. Worth nothing at even numbers, about +15% at 2:1, +33% at 3:1 and +45% at 4:1 or more.
export const massBonus = (mine, theirs) => 1 + 0.3 * clamp(Math.log2(Math.max(1, mine) / Math.max(1, theirs)) - 0.5, 0, 1.5);

function genBonus(gen, role) {
  let m = 1 + 0.04 * (gen.skill - 1);
  if (gen.trait === 'aggressive' && role === 'attack') m *= 1.15;
  if (gen.trait === 'defensive' && role === 'defend') m *= 1.2;
  if (gen.trait === 'cautious' && role === 'attack') m *= 0.9;
  return m;
}

// Doctrine (doctrine.js): how each country's armies fight
const dfx = (s, id) => doctrineFx(s, id);
// Rough ground: hills, forests, mountains, marshes, jungle, cities
const rough = (terrain) => terrain.defend > 1.1;
// A surrounded garrison fights on what it has left
const POCKET_SUPPLY = 0.2;
const garrisonState = (s, regionId) => {
  const p = pocketAt(s, provinceCell(regionId));
  return p && !p.sea ? { org: 45, supply: POCKET_SUPPLY } : { org: 80, supply: 1 };
};
// What a defender's doctrine adds to holding a province: fortifications count for more behind a fortified line
export const defendMul = (s, holder, terrain, fort) => holdFactor(terrain, fort * (1 + (dfx(s, holder).fort ?? 0))) * (1 + (dfx(s, holder).defend ?? 0));

// A rough strength guess for a province's defence, used by generals and the AI to plan
export function defenceEstimate(s, regionId, gar = garrisons(s)) {
  const reg = s.regions[regionId];
  const terrain = terrainOf(regionId);
  const g = gar.get(regionId) ?? { troops: 0, tanks: 0 };
  const gs = garrisonState(s, regionId);
  let p = power(g.troops, g.tanks, quality(s, reg.ctrl), gs.org, gs.supply, terrain) + militiaPower(s, reg, terrain);
  for (const a of Object.values(s.armies)) {
    if (a.region === regionId && !a.sea && onSameSide(s, a.owner, reg.ctrl)) {
      p += power(a.troops, runningTanks(s, a) * (1 + (dfx(s, a.owner).armorDefend ?? 0)), quality(s, a.owner), a.org, a.supply, terrain) * genBonus(a.gen, 'defend');
    }
  }
  return p * defendMul(s, reg.ctrl, terrain, reg.fort);
}

// Tanks without fuel are only pillboxes, and a surrounded army's fuel runs out first
const runningTanks = (s, a) => a.tanks * (1 - fuelCut(s.countries[a.owner])) * (a.pocket && !a.pocketSea ? 0.35 : 1);

export function armyAttackEstimate(s, a, regionId) {
  const terrain = terrainOf(regionId);
  const d = dfx(s, a.owner);
  const tanks = runningTanks(s, a) * Math.max(0.3, 1 + (d.armor ?? 0));
  return power(a.troops, tanks, quality(s, a.owner), a.org, a.supply, terrain) * genBonus(a.gen, 'attack')
    * (1 + (d.attack ?? 0) + (rough(terrain) ? d.roughAttack ?? 0 : 0));
}

// How well an army can break through a line and run on into the open behind it: mechanised (tanks per thousand
// men) and trained to it by its doctrine. 0 (foot infantry) to about 1.
export function breakthroughOf(s, a) {
  const armour = clamp(runningTanks(s, a) / Math.max(1, a.troops) / 3, 0, 1);
  const tech = 0.6 + 0.05 * (s.countries[a.owner]?.tech?.army ?? 4);
  return clamp(armour * 0.6 * tech + (dfx(s, a.owner).breakthrough ?? 0) * (0.4 + 0.6 * armour), 0, 1.2);
}

// The people of a province defending their own homeland take up arms: a home guard of about 4,000 for every
// million people, many times that under a people's war. It fights as the cities do, and is used up as they fall.
export function militiaOf(s, reg) {
  const holder = reg.ctrl;
  if (reg.owner !== holder || (reg.people ?? reg.owner) !== holder || !s.countries[holder]) return 0;
  const k = 1 + 2 * (dfx(s, holder).militia ?? 0);
  return Math.max(0, reg.pop * 4 * k - (reg.militiaLost ?? 0));
}
const militiaPower = (s, reg, terrain) => power(militiaOf(s, reg), 0, 0.45, 60, 1, terrain);

/* ---------- Fuel ---------- */

// Oil burned per week, in millions of barrels a day (the market's unit), per thousand troops and per tank.
// Fighting burns the most: tanks, trucks, generators and artillery tractors all running. About 0.3 barrels per
// soldier a day in battle, as in modern campaigns.
export const FUEL = { hold: [0.00005, 0.000001], march: [0.0002, 0.000006], fight: [0.0003, 0.00001] };
export const AIR_FUEL = 0.00003; // per aircraft flying a campaign
export const SHIP_FUEL = { underway: 0.0006, idle: 0.0001 }; // per warship (a carrier counts as eight)
export const armyMode = (a) => (a.battle ? 'fight' : a.path?.length || a.sea ? 'march' : 'hold');
export const armyFuel = (a, mode = armyMode(a)) => a.troops * FUEL[mode][0] + a.tanks * FUEL[mode][1];

// Weeks to march along a path, and the oil it burns (plus a fortnight of fighting if it ends in an attack)
export function orderFuel(s, a, path, attack = false) {
  // The way as waypoints (map pixels, 20 km each), or the old way as province ids
  let km = 0;
  let from = a.x != null ? [a.x, a.y] : a.region;
  for (const p of path ?? []) {
    if (Array.isArray(p)) { km += Math.hypot(p[0] - from[0], p[1] - from[1]) * 20 * terrainAt(cellAt(p[0], p[1])).move; from = p; } else { km += moveCost(s, typeof from === 'string' ? from : a.region, p); from = p; }
  }
  const weeks = km / Math.max(50, marchSpeed(s, a));
  const oil = weeks * armyFuel(a, 'march') + (attack ? 2 * armyFuel(a, 'fight') : 0);
  return { weeks, oil };
}

// What a country's forces burn this week: { armies, garrisons, air, navy, total }
export function forcesFuel(s, c) {
  let armies = 0;
  let inArmies = 0;
  for (const a of Object.values(s.armies)) {
    if (a.owner !== c.id) continue;
    armies += armyFuel(a) * (1 + (dfx(s, c.id).fuel ?? 0));
    inArmies += a.troops;
  }
  const garrisons = Math.max(0, c.troops - inArmies) * FUEL.hold[0] + c.aircraft * 0.000004 + Math.max(0, c.tanks) * FUEL.hold[1] * 0.5;
  const air = (c.airOps ?? []).reduce((t, o) => t + o.aircraft * AIR_FUEL, 0);
  let navy = 0;
  for (const f of Object.values(s.fleets ?? {})) {
    if (f.owner !== c.id) continue;
    const ships = f.ships + (f.carriers ?? 0) * 8;
    navy += ships * (f.route?.length || f.mission === 'blockade' || f.mission === 'patrol' ? SHIP_FUEL.underway : SHIP_FUEL.idle);
  }
  return { armies, garrisons, air, navy, total: armies + garrisons + air + navy };
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
      // Our land, an ally's, a puppet's, or a country that granted us access. Anyone else must be asked first.
      if (friendlyGround(s, owner, holder)) cost = 0.5 * moveCost(s, id, next) / 600;
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

// The neutral countries standing between an army and its objective (when there is no route without them)
export function blockers(s, owner, from, to) {
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
      const friendly = friendlyGround(s, owner, holder);
      const cost = friendly ? 1 : atWar(s, owner, holder) ? 2 : 6;
      const nd = d + cost;
      if (nd < (dist.get(next) ?? Infinity)) { dist.set(next, nd); prev.set(next, id); open.push([nd, next]); }
    }
  }
  if (!prev.has(to)) return [];
  const out = new Set();
  for (let id = to; id && id !== from; id = prev.get(id)) {
    const h = s.regions[id].ctrl;
    if (!friendlyGround(s, owner, h) && !atWar(s, owner, h)) out.add(h);
  }
  return [...out];
}

export function noRouteReason(s, owner, from, to) {
  const holder = s.regions[to]?.ctrl;
  const block = blockers(s, owner, from, to).filter((h) => h !== holder);
  if (block.length) {
    const names = block.map((h) => nameOf(s, h)).join(' and ');
    return `The only way to ${regionName(to)} crosses ${names}, which ${block.length > 1 ? 'don\'t' : 'doesn\'t'} let our troops through. Ask for military access (Diplomacy), or declare war and fight through.`;
  }
  return `There is no land route to ${regionName(to)}.${GEO[to].coast ? ' Try an amphibious landing.' : ''}`;
}

/* ---------- Orders ---------- */

export const MIN_ARMY = 5;
// Training and kit for reservists called straight into an army, per thousand troops, before the country's cost level
export const DRAFT_COST = 0.006;
export const draftCost = (c, k) => k * DRAFT_COST * (0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60));

// Forms an army group in a province. Troops beyond those free at home are drafted from the reserves on the spot.
export function createArmy(s, c, { region, troops, tanks = 0, name }) {
  const mine = Object.values(s.armies).filter((a) => a.owner === c.id);
  if (mine.length >= MAX_ARMIES) return `You can field at most ${MAX_ARMIES} army groups. Merge or disband one first.`;
  const reg = s.regions[region];
  if (!reg || reg.ctrl !== c.id) return 'Armies form in a province you control.';
  // At the heart of the province, or the nearest ground of it we still hold
  let spot = provinceCell(region);
  if (holderAt(s, spot) !== c.id) spot = [...CELLS_OF[region]].find((i) => holderAt(s, i) === c.id) ?? -1;
  if (spot < 0) return 'Armies form on ground you hold.';
  const free = freeForces(s, c);
  troops = Math.floor(Number(troops));
  tanks = Math.floor(Number(tanks) || 0);
  if (!(troops >= MIN_ARMY)) return `An army group needs at least ${MIN_ARMY},000 troops.`;
  if (tanks < 0 || tanks > free.tanks) return `Only ${Math.floor(free.tanks)} tanks are free to assign.`;
  const draft = Math.max(0, troops - Math.floor(free.troops));
  if (draft > Math.floor(Math.max(0, c.reserves))) {
    return `Only ${troopsLabel(free.troops)} troops are free and ${troopsLabel(Math.max(0, c.reserves))} reservists can be drafted.`;
  }
  if (draft > 0) {
    const cost = draftCost(c, draft);
    if (cost > c.milFunds + c.treasury) return `Drafting ${troopsLabel(draft)} reservists costs ${money(cost)}; you have ${money(c.milFunds + c.treasury)}.`;
    const fromFunds = Math.min(c.milFunds, cost);
    c.milFunds -= fromFunds;
    c.treasury -= cost - fromFunds;
    c.reserveBase = (c.reserveBase ?? c.reserves + c.mobTroops) - draft;
    c.reserves -= draft;
    c.troops += draft;
    // A sudden call-up is unpopular, more so in a democracy, and most of all with no threat to explain it
    const share = draft / Math.max(1, c.troops);
    const reason = c.threat?.value ?? (enemiesOf(s, c.id).size ? 0.6 : 0);
    c.boost -= Math.min(10, share * (c.gov === 'autocracy' ? 6 : 14) * (1.2 - reason));
    c.recentDraft = (c.recentDraft ?? 0) + Math.min(40, share * 120 * (1 - reason));
    news(s, `${c.name} drafts ${troopsLabel(draft)} reservists into the army.`, 'war', [c.id]);
  }
  const id = nextId(s, 'a');
  s.armies[id] = {
    id, owner: c.id, name: String(name || `${ordinal(c.generalsUsed + 1)} Army`).slice(0, 28),
    // Fresh draftees are less organised than standing troops
    gen: newGeneral(s, c), region, troops, tanks, org: Math.round(70 - 25 * (draft / troops)), supply: 1,
    op: { kind: 'hold', target: region, at: cellXY(spot), aggr: 'balanced' }, path: [], move: null, sea: null, attacking: null, battle: null,
    status: `Forming up in ${regionName(region)}`,
  };
  placeArmy(s.armies[id], ...cellXY(spot));
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

// The world as it would be if `me` declared war on `foe` (leaving any alliance they share): for checking an attack first
export function hypotheticalWar(s, me, foe) {
  if (atWar(s, me, foe)) return s;
  const alliances = {};
  for (const [id, al] of Object.entries(s.alliances)) {
    alliances[id] = al.members.includes(foe) && al.members.includes(me) ? { ...al, members: al.members.filter((m) => m !== me) } : al;
  }
  return { ...s, alliances, wars: [...s.wars, { a: me, b: foe }] };
}

// Why a landing from `from` on `target` can't go ahead, or null if it can. `c` needs an id. A landing needs a
// fleet of ours (or an ally's) in the sea off the target's coast, at least as strong as the enemy's there, or a
// prepared build-up (landing craft, transports, stores: the months before D-Day) for a crossing within range.
export const LANDING_RANGE = 2000; // km a prepared landing can cross
export function landingProblem(s, c, from, target, prepared = false) {
  if (!GEO[from].coast || s.regions[from].ctrl !== c.id) return 'The army isn\'t in a coastal province you hold, so it has no port to sail from.';
  if (!GEO[target].coast) return `${regionName(target)} is landlocked: there is no water to land from.`;
  if (prepared) {
    if (distanceKm(from, target) > LANDING_RANGE) return `${regionName(target)} is beyond the reach of our landing craft (${Math.round(distanceKm(from, target)).toLocaleString('en')} km; ${LANDING_RANGE.toLocaleString('en')} km at most).`;
    return null;
  }
  const sea = landingControl(s, c.id, target);
  if (sea) return `No landing at ${regionName(target)}: ${sea}. Or prepare a landing (the army's card) to cross without command of the sea.`;
  return null;
}

/* ---------- Preparing a landing ---------- */

// The build-up for a crossing: landing craft, transports, beach engineers, stores. Weeks of work in plain sight.
export const buildupCost = (c, a) => (a.troops * 0.006 + a.tanks * 0.003) * (0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60));
export const buildupWeeks = (c) => Math.max(4, 8 - Math.floor((c.tech?.naval ?? 4) / 3));
export const landingReady = (s, a) => Boolean(a.buildup && a.buildup.ready <= s.week && a.buildup.region === a.region);

export function prepareLanding(s, c, a) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  if (a.sea) return 'The army is already at sea.';
  if (!GEO[a.region].coast || s.regions[a.region].ctrl !== c.id) return 'The army must be in a coastal province we hold.';
  if (a.buildup?.region === a.region) return landingReady(s, a) ? 'The landing force is ready.' : `The build-up is under way: ready in week ${a.buildup.ready}.`;
  const cost = buildupCost(c, a);
  if (cost > c.milFunds + c.treasury) return `The build-up costs ${money(cost)}; you have ${money(c.milFunds + c.treasury)}.`;
  const fromFunds = Math.min(c.milFunds, cost);
  c.milFunds -= fromFunds;
  c.treasury -= cost - fromFunds;
  a.buildup = { region: a.region, since: s.week, ready: s.week + buildupWeeks(c), cost };
  a.status = `Preparing a landing at ${regionName(a.region)}`;
  // Hundreds of landing craft and a port full of troops can't be hidden: spy networks inside us and anyone
  // with reconnaissance satellites see it
  for (const o of Object.values(s.countries)) {
    if (o.id === c.id || !alive(s, o.id)) continue;
    const spies = (o.spies?.[c.id]?.agents ?? 0) >= 2 && s.week - (o.spies[c.id].since ?? s.week) >= 4;
    const eyes = satSees(s, o.id) && (enemiesOf(s, c.id).has(o.id) || rel(s, o.id, c.id) < 0);
    if (!spies && !eyes) continue;
    briefing(s, o.id, `${eyes && !spies ? 'Our satellites show' : 'Our agents report'} a massive build-up at ${regionName(a.region)} (${c.name}): landing craft, transports and about ${troopsLabel(Math.round(a.troops / 10) * 10)} troops. An invasion across the sea is being prepared, ready in about ${buildupWeeks(c)} weeks.`, 'war', { region: a.region });
  }
  return null;
}

/* ---------- Automatic capture ---------- */

const CAPITAL_IDS = new Set(PROVINCES.filter((p) => p.capital).map((p) => p.id));

// The nearest province held (mostly) by a country at war with this army's owner that it can reach over land, or null
function nextConquest(s, a) {
  const owner = a.owner;
  const dist = new Map([[a.region, 0]]);
  const open = [[0, a.region]];
  const done = new Set();
  while (open.length) {
    open.sort((x, y) => x[0] - y[0]);
    const [d, id] = open.shift();
    if (done.has(id)) continue;
    done.add(id);
    if (id !== a.region && atWar(s, owner, s.regions[id].ctrl)) return id;
    for (const next of GEO[id].adj) {
      const reg = s.regions[next];
      if (!reg) continue;
      let cost;
      if (friendlyGround(s, owner, reg.ctrl)) cost = 0.5 * moveCost(s, id, next) / 600;
      else if (atWar(s, owner, reg.ctrl)) cost = 2 * terrainOf(next).move * terrainOf(next).defend + 1 - (CAPITAL_IDS.has(next) ? 1 : 0);
      else continue;
      const nd = d + Math.max(0.1, cost);
      if (nd < (dist.get(next) ?? Infinity)) { dist.set(next, nd); open.push([nd, next]); }
    }
  }
  return null;
}

export function setAuto(s, c, a, on) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  a.auto = Boolean(on);
  a.autoAt = 0;
  if (a.auto) briefing(s, c.id, `${a.gen.name} has orders to keep attacking: ${a.name} will push on into one enemy province after another until no enemy is left within reach, or it is destroyed.`, 'info');
  return null;
}

// An army on automatic capture with nothing to do picks its next objective: the nearest ground an enemy still
// holds, and on into it, about 400 km deep
function nextGround(s, a) {
  const start = cellAt(a.x, a.y);
  const seen = new Set([start]);
  const queue = [start];
  let hit = -1;
  for (let qi = 0; qi < queue.length && qi < 30000; qi++) {
    const i = queue[qi];
    const h = holderAt(s, i);
    if (i !== start && atWar(s, a.owner, h)) { hit = i; break; }
    for (const j of neighbours4(i)) {
      if (seen.has(j) || !isLand(j)) continue;
      const hj = holderAt(s, j);
      if (!hj || !(friendlyGround(s, a.owner, hj) || atWar(s, a.owner, hj))) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  if (hit < 0) return null;
  // Deeper in: the enemy-held cell furthest from us within about 400 km of the first one
  const hx = cellX(hit);
  const hy = cellY(hit);
  let best = hit;
  let bd = 0;
  const r = 8;
  const gx0 = Math.floor(hx / CELL_SIZE);
  const gy0 = Math.floor(hy / CELL_SIZE);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const gy = gy0 + dy;
    if (gy < 0 || gy >= GRID_H) continue;
    const i = gy * GRID_W + ((gx0 + dx + GRID_W) % GRID_W);
    if (!isLand(i) || !atWar(s, a.owner, holderAt(s, i))) continue;
    const d = dist(a.x, a.y, cellX(i), cellY(i));
    if (d > bd && dist(hx, hy, cellX(i), cellY(i)) <= r * CELL_SIZE) { bd = d; best = i; }
  }
  return [cellX(best), cellY(best)];
}

function autoCapture(s, a, c) {
  if (!a.auto || a.sea || a.battle) return;
  const busy = a.path.length && a.op.kind === 'advance';
  if (busy || (a.autoAt ?? 0) > (s.stepNo ?? 0)) return;
  a.autoAt = (s.stepNo ?? 0) + 4;
  const next = enemiesOf(s, a.owner).size ? nextGround(s, a) : null;
  if (!next) {
    a.status = enemiesOf(s, a.owner).size ? 'Automatic capture: no enemy within reach over land' : 'Automatic capture: no enemies left';
    return;
  }
  if (!orderArmy(s, c, a, { kind: 'advance', x: next[0], y: next[1], aggr: a.op.aggr ?? 'balanced' })) a.status = `Automatic capture: advancing on ${regionName(regionAt(cellAt(next[0], next[1])))}`;
}

/* ---------- Orders ---------- */
//
// An army stands at a point on the map, not in a province. It is told to go somewhere: a point, a province, or an
// enemy army.
//   move     march over our side's ground to a point and hold there; it won't start a fight
//   advance  push into enemy ground to a point: it takes the land it crosses and attacks any enemy army in its way
//   attack   go after one enemy army and fight it
//   hold     stay put, and defend if attacked
// Being at war is not enough for a battle: one side has to mean to attack (advance or attack). Two armies at war
// can face each other across a border for months.

// Where an order points: { x, y, region }, from a province, a point or an enemy army
function orderPoint(s, { target, x, y, enemy }) {
  if (enemy && s.armies[enemy]) { const e = s.armies[enemy]; return { x: e.x, y: e.y, region: e.region, enemy }; }
  if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    const cell = nearestLand(Number(x), Number(y));
    if (cell < 0) return null;
    return { x: cellX(cell), y: cellY(cell), region: regionAt(cell) };
  }
  if (target && s.regions[target]) { const cell = provinceCell(target); return cell < 0 ? null : { x: cellX(cell), y: cellY(cell), region: target }; }
  return null;
}

// The enemy armies a march order steers clear of
const enemyZones = (s, owner) => Object.values(s.armies).filter((b) => !b.sea && b.x != null && atWar(s, owner, b.owner)).map((b) => [b.x, b.y, CONTACT]);

// Works out an order without carrying it out: { error } or the new operation
function planOrder(s, c, army, { kind, target, x, y, enemy, aggr = 'balanced' }) {
  if (!army || army.owner !== c.id) return { error: 'That army is not yours.' };
  if (!AGGRESSION[aggr]) aggr = 'balanced';
  if (army.sea) return { error: `${army.name} is at sea and can't take new orders until it lands.` };
  if (army.x == null) placeArmy(army, ...cellXY(provinceCell(army.region)));
  const here = [army.x, army.y];
  if (kind === 'hold' && target == null && x == null && !enemy) return { op: { kind: 'hold', target: army.region, at: here, aggr }, path: [], status: `Holding near ${regionName(army.region)}` };
  if (kind === 'invade') return planLanding(s, c, army, target, aggr);
  const p = orderPoint(s, { target, x, y, enemy });
  if (!p) return { error: 'Pick a point on land.' };
  const cell = cellAt(p.x, p.y);
  const holder = holderAt(s, cell);
  const name = regionName(p.region);
  // An enemy army: go after it
  if (enemy) {
    const e = s.armies[enemy];
    if (!e || e.sea) return { error: 'That army is out of reach.' };
    if (!atWar(s, c.id, e.owner)) return { error: `You are not at war with ${nameOf(s, e.owner)}. Declare war first.` };
    const path = landPath(s, c.id, here, [p.x, p.y], { offensive: true });
    if (!path) return { error: `There is no way over land to ${nameOf(s, e.owner)}'s ${e.name}.` };
    return { op: { kind: 'attack', enemy, target: e.region, at: [p.x, p.y], from: here, aggr }, path, status: `Going after ${nameOf(s, e.owner)}'s ${e.name}` };
  }
  if (holder == null) return { error: 'Pick a point on land.' };
  // An attack on a country we are at peace with (an ally's ground too) needs a war first
  if ((kind === 'attack' || kind === 'advance') && holder !== c.id && !atWar(s, c.id, holder)) return { error: `You are not at war with ${nameOf(s, holder)}. Declare war first.` };
  // Our side's ground: march there and hold it (fighting through enemy ground only when there is no other way)
  if (friendlyGround(s, c.id, holder)) {
    const walk = landPath(s, c.id, here, [p.x, p.y], { avoid: enemyZones(s, c.id) });
    if (walk) return { op: { kind: kind === 'hold' ? 'hold' : 'move', target: p.region, at: [p.x, p.y], aggr }, path: walk, status: walk.length ? `Moving to ${name}` : `Holding near ${name}` };
    const fight = landPath(s, c.id, here, [p.x, p.y], { offensive: true });
    if (fight) return { op: { kind: 'advance', target: p.region, at: [p.x, p.y], aggr, through: true }, path: fight, status: `Fighting through to ${name}` };
    if (GEO[p.region]?.coast && GEO[army.region]?.coast) return planLanding(s, c, army, p.region, aggr);
    return { error: noRouteReason(s, c.id, army.region, p.region) };
  }
  if (!atWar(s, c.id, holder)) return { error: `${name} is held by ${nameOf(s, holder)}, which we are not at war with. Declare war first.` };
  if (kind === 'hold' || kind === 'move') return { error: `${name} is enemy ground: send the army to advance or attack there.` };
  const path = landPath(s, c.id, here, [p.x, p.y], { offensive: true });
  if (path) return { op: { kind: 'advance', target: p.region, at: [p.x, p.y], aggr }, path, status: `Advancing on ${name}` };
  const sea = GEO[p.region]?.coast ? planLanding(s, c, army, p.region, aggr) : null;
  if (sea && !sea.error) return sea;
  // No way over land, nor by sea: say what is in the way on land (and, for a coast, why no landing)
  return { error: `${noRouteReason(s, c.id, army.region, p.region)}${sea?.error && !/landlocked/.test(sea.error) ? ` ${sea.error}` : ''}`.replace(' Try an amphibious landing.', '') };
}

function planLanding(s, c, army, target, aggr) {
  if (!target || !s.regions[target]) return { error: 'Pick a coast to land on.' };
  const holder = s.regions[target].ctrl;
  if (!friendlyGround(s, c.id, holder) && !atWar(s, c.id, holder)) return { error: `You are not at war with ${nameOf(s, holder)}. Declare war first.` };
  const prepared = landingReady(s, army);
  const problem = landingProblem(s, c, army.region, target, prepared && Boolean(landingControl(s, c.id, target)));
  if (problem) return { error: problem };
  const km = distanceKm(army.region, target);
  return { op: { kind: 'advance', target, at: cellXY(provinceCell(target)), aggr }, path: [], sea: { from: army.region, to: target, left: Math.ceil(km / 1500) + 1, prepared }, status: `At sea, bound for ${regionName(target)}` };
}

// Checks an attack as if war were already declared, so a leader can declare war and attack in one step
export function checkOrder(s, c, army, order) {
  const holder = order.enemy ? s.armies[order.enemy]?.owner : s.regions[order.target]?.ctrl ?? (order.x != null ? holderAt(s, nearestLand(Number(order.x), Number(order.y))) : null);
  const peaceful = order.kind === 'hold' || order.kind === 'move' || holder === c.id || (order.kind === 'go' && holder && friendlyGround(s, c.id, holder));
  const world = holder && !peaceful ? hypotheticalWar(s, c.id, holder) : s;
  return planOrder(world, c, army, order).error ?? null;
}

// The order kinds a leader (or the computer) can give; 'go' and 'attack' on a province both mean: go there,
// advancing into enemy ground if that is what it is
export function orderArmy(s, c, army, order) {
  const plan = planOrder(s, c, army, order);
  if (plan.error) return plan.error;
  army.op = plan.op;
  army.path = plan.path;
  army.battle = null;
  army.attacking = null;
  if (plan.sea) {
    army.sea = plan.sea;
    if (plan.sea.prepared) { army.prepared = true; army.buildup = null; }
  }
  army.status = plan.status;
  army.orderedAt = s.week;
  return null;
}

// Where an order would take an army, for drawing it before it is given: waypoints, or null
export function previewPath(s, owner, from, order) {
  const p = orderPoint(s, order);
  if (!p) return null;
  const holder = holderAt(s, cellAt(p.x, p.y));
  if (holder && friendlyGround(s, owner, holder)) return landPath(s, owner, from, [p.x, p.y], { avoid: enemyZones(s, owner) }) ?? landPath(s, owner, from, [p.x, p.y], { offensive: true });
  return landPath(s, owner, from, [p.x, p.y], { offensive: true });
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

// What an air campaign is for
export const AIR_MISSIONS = {
  support: { name: 'Close air support', short: 'Support', note: 'Bomb the defenders of a province we are attacking: they lose organisation and men, and our attack there hits up to 25% harder.' },
  interdict: { name: 'Interdiction', short: 'Interdict', note: 'Hit roads, rail and depots in and around the province: enemy armies there run short of supply, and fight and recover worse.' },
  strategic: { name: 'Strategic bombing', short: 'Strategic', note: 'Wreck industry, oil fields, mines and power plants: the province produces less for the enemy\'s war.' },
};
// What a missile salvo is aimed at
export const MISSILE_AIMS = {
  army: { name: 'Troops', note: 'Strike armies and garrisons: real casualties, and the survivors lose organisation.' },
  forts: { name: 'Fortifications', note: 'Knock out bunkers and defensive lines: the province loses fortification levels.' },
  airbase: { name: 'Airbases', note: 'Destroy enemy aircraft on the ground.' },
  industry: { name: 'Industry', note: 'Hit factories, oil fields and power plants: lasting damage to what the province produces.' },
};

export function missileStrike(s, c, target, count, aim = 'industry') {
  const reg = s.regions[target];
  if (!reg) return 'Pick a province.';
  if (!atWar(s, c.id, reg.ctrl)) return `You are not at war with ${nameOf(s, reg.ctrl)}.`;
  if (!MISSILE_AIMS[aim]) aim = 'industry';
  const far = rangeProblem(s, c, target, 'missile');
  if (far) return far;
  count = Math.floor(Number(count));
  if (!(count > 0) || count > c.missiles) return `You have ${c.missiles} missiles.`;
  const def = s.countries[reg.ctrl];
  const intercept = interceptRate(s, c, reg.ctrl);
  // Satellite navigation guides the missiles in
  const hits = Math.round(count * (1 - intercept) * (0.85 + rand(s) * 0.3));
  const accuracy = (c.tech.missile / 8) * (1 + 0.3 * gpsCoverage(s, c.id));
  c.missiles -= count;
  const holder = nation(s, reg.ctrl);
  let result;
  if (aim === 'army') {
    // About 120 casualties a hit on troops in the open, and the shock of it
    const armies = Object.values(s.armies).filter((a) => a.region === target && !a.sea && onSameSide(s, a.owner, reg.ctrl));
    const killed = Math.min(hits * 0.12 * accuracy, 0.25 * (armies.reduce((t, a) => t + a.troops, 0) + 20));
    const total = armies.reduce((t, a) => t + a.troops, 0);
    for (const a of armies) {
      const share = total ? a.troops / total : 0;
      a.troops = Math.max(1, a.troops - killed * 0.8 * share);
      a.org = Math.max(0, a.org - Math.min(25, hits * 0.4 * accuracy));
    }
    if (holder) holder.troops = Math.max(0, holder.troops - killed);
    bury(s, reg.ctrl, killed);
    result = `about ${troopsLabel(killed)} troops killed or wounded${armies.length ? `, and ${armies.map((a) => a.name).join(', ')} badly shaken` : ' in the garrison'}`;
  } else if (aim === 'forts') {
    const before = reg.fort;
    const levels = Math.min(before, Math.floor(hits * accuracy / 40) + (hits * accuracy >= 15 ? 1 : 0));
    reg.fort = before - levels;
    reg.dmg = clamp(reg.dmg + hits * 0.0004, 0, 0.95);
    result = before ? (levels ? `fortifications down from level ${before} to ${reg.fort}` : 'the fortifications held') : 'there were no fortifications to hit';
  } else if (aim === 'airbase') {
    const destroyed = def ? Math.min(Math.round(hits * 0.35 * accuracy), Math.round(def.aircraft * 0.1)) : 0;
    if (def) def.aircraft = Math.max(0, def.aircraft - destroyed);
    result = def ? `${destroyed} enemy aircraft destroyed on the ground` : 'no air force to hit';
  } else {
    const dmg = Math.min(0.35, hits * 0.0024 * accuracy);
    reg.dmg = clamp(reg.dmg + dmg, 0, 0.95);
    result = `industry and resources ${Math.round(dmg * 100)} points more damaged (now ${Math.round(reg.dmg * 100)}%)`;
  }
  news(s, `${c.name} fires ${count} missiles at ${MISSILE_AIMS[aim].name.toLowerCase()} in ${regionName(target)}. ${hits} get through${intercept > 0.2 ? ' its air defences' : ''}.`, 'strike', [c.id, reg.ctrl]);
  alert(s, c.id, `Missile strike on ${regionName(target)}: ${hits} of ${count} got through (${Math.round(intercept * 100)}% intercepted). Result: ${result}.`, hits ? 'good' : 'warn', { region: target, front: true });
  alert(s, reg.ctrl, `${count} missiles from ${c.name} struck ${regionName(target)}: ${result}.`, 'bad', { region: target });
  return null;
}

// How many of our missiles the enemy shoots down
export function interceptRate(s, c, defender) {
  const def = s.countries[defender];
  return def ? clamp(0.055 * def.tech.missile - 0.02 * ((c.tech?.missile ?? 6) - 6), 0, 0.75) : 0.05;
}

export const FALLOUT_WEEKS = 260;
export const inFallout = (s, reg) => (reg?.fallout?.until ?? -1) > s.week;

export function nuclearStrike(s, c, target, retaliation = false) {
  const reg = s.regions[target];
  if (!reg) return 'Pick a province.';
  if (c.nukes < 1) return 'You have no nuclear weapons.';
  if (!atWar(s, c.id, reg.ctrl) && !retaliation) return `You are not at war with ${nameOf(s, reg.ctrl)}.`;
  const far = rangeProblem(s, c, target, 'nuke');
  if (far) return far;
  const victim = reg.ctrl;
  c.nukes -= 1;
  s.nukesUsed++;
  // The blast and firestorm kill a third of the province; most of the rest flee the fallout. For five years
  // nothing can be mined, pumped or farmed there, and nothing rebuilt.
  const deaths = reg.pop * 0.35;
  reg.pop *= 0.4;
  reg.gdp *= 0.15;
  reg.dmg = 0.95;
  reg.unrest = 90;
  reg.infra = 0;
  reg.fort = 0;
  for (const r of Object.values(reg.res)) r[0] = 0;
  reg.fallout = { until: s.week + FALLOUT_WEEKS, by: c.id, since: s.week };
  reg.battle = null;
  if (s.countries[reg.owner]) s.countries[reg.owner].refugees = (s.countries[reg.owner].refugees ?? 0) + reg.pop * 0.4;
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

export function setAirCampaign(s, c, target, aircraft, mission = 'strategic') {
  aircraft = Math.floor(Number(aircraft) || 0);
  if (!AIR_MISSIONS[mission]) mission = 'strategic';
  const was = c.airOps.find((o) => o.region === target);
  c.airOps = c.airOps.filter((o) => o.region !== target);
  if (aircraft <= 0) return null;
  const reg = s.regions[target];
  if (!reg || !atWar(s, c.id, reg.ctrl)) return 'Air campaigns target provinces held by an enemy.';
  const far = rangeProblem(s, c, target, 'air');
  if (far) { if (was) c.airOps.push(was); return far; }
  const committed = c.airOps.reduce((t, o) => t + o.aircraft, 0) + (c.airlifts ?? []).reduce((t, o) => t + o.aircraft, 0);
  if (aircraft + committed > c.aircraft) { if (was) c.airOps.push(was); return `You have ${c.aircraft - committed} aircraft free.`; }
  c.airOps.push({ region: target, aircraft, mission, since: was?.since ?? s.week, last: was?.last ?? null, total: was?.total ?? { org: 0, killed: 0, dmg: 0, lost: 0, weeks: 0 } });
  if (!was) alert(s, reg.ctrl, `${c.name} has begun ${mission === 'support' ? 'bombing our troops' : mission === 'interdict' ? 'bombing our supply lines' : 'bombing'} in ${regionName(target)}.`, 'bad', { region: target });
  return null;
}


// What an air campaign is worth against this defence: 0 to about 1.5
function airPower(s, c, op, reg) {
  const def = s.countries[reg.ctrl];
  const defAir = def ? def.aircraft * airQuality(def) * 0.3 / Math.max(1, enemiesOf(s, reg.ctrl).size) : 5;
  const adf = def ? def.tech.missile * 15 : 10;
  const mine = op.aircraft * airQuality(c);
  const eff = (mine / (mine + defAir + adf)) * (1 - 0.9 * fuelCut(c)) * (1 + 0.2 * gpsCoverage(s, c.id));
  return { eff, power: eff * Math.min(1.5, op.aircraft / 60), defAir };
}
export const airEstimate = (s, c, op, regionId) => airPower(s, c, op, s.regions[regionId]);


/* ---------- The war, in real time ---------- */
//
// Marching and fighting run in small steps many times a game week (militaryStep, with dt the fraction of a week),
// so an order is carried out within a second and fronts move smoothly. Supply, logistics, recovery, pockets and
// the air and sea campaigns are settled once a week (militaryTick).
//
// The front is not a line between provinces. Each army holds the ground around it (its zone of control, 80 to 180
// km depending on its size); an army on the attack takes every enemy cell around it that no enemy army holds.
// Where two hostile armies meet and one of them means to attack, they fight: the loser is pushed back, the winner
// follows and takes the ground in between. Land with no army on it is simply marched through, slowed only by its
// garrison and home guard.

// How far an army marches in a week over open plains, in km. It comes from land-warfare research and industry
// (trucks, rail, fuel depots), how mechanised the army is (tanks per thousand men), oil, and whether the factories
// keep up with the war. Low-tech infantry manages about 300 km; the most advanced, fully mechanised army about
// 1,100 km (some 160 km a day by road and rail). Hills, forests and mountains slow it; good roads speed it up.
export function marchSpeed(s, a) {
  const c = s.countries[a.owner];
  if (!c) return 300;
  const base = 40 + 55 * c.tech.army + 35 * c.tech.industry;
  const mech = 0.8 + 0.4 * Math.min(1, a.tanks / Math.max(1, a.troops) / 3);
  const fuel = 1 - 0.85 * fuelCut(c);
  const factories = 0.7 + 0.3 * (c.logistics?.factories ?? 1);
  const doctrine = Math.max(0.6, 1 + (dfx(s, a.owner).speed ?? 0));
  return base * mech * fuel * factories * (a.gen.trait === 'maneuver' ? 1.3 : 1) * doctrine;
}

// The cost of marching from one province into the next, in km of open road (for plans and estimates)
const moveCost = (s, from, to) => distanceKm(from, to) * terrainOf(to).move * (1 - 0.04 * (s.regions[to].infra ?? 0));

// Armies this close (map pixels; about 180 km) can fight
export const CONTACT = 9;
// While pushing, the attackers stay this close behind the defenders
const GAP = 5.5;
// The ground an army holds around it: 80 km for a small one, up to 180 km for a big one
export const zocOf = (a) => clamp(4 + Math.sqrt(Math.max(1, a.troops)) * 0.22, 4, CONTACT);
const MAPW = 2000;
const wrapX = (x) => ((x % MAPW) + MAPW) % MAPW;

export function placeArmy(a, x, y) {
  a.x = Math.round(wrapX(x) * 100) / 100;
  a.y = Math.round(y * 100) / 100;
  const cell = cellAt(a.x, a.y);
  const r = regionAt(cell);
  if (r) a.region = r;
}

const intends = (a) => (a.op?.kind === 'advance' || a.op?.kind === 'attack') && !a.sea;
const hostile = (s, a, b) => a.owner !== b.owner && atWar(s, a.owner, b.owner);

export function militaryStep(s, dt) {
  if (!(dt > 0)) return;
  s.stepNo = (s.stepNo ?? 0) + 1;
  s.battles ??= {};
  const gar = garrisons(s);
  const land = [];
  for (const a of Object.values(s.armies)) {
    const c = s.countries[a.owner];
    if (!c || !alive(s, a.owner)) { delete s.armies[a.id]; continue; }
    if (a.x == null) placeArmy(a, ...cellXY(provinceCell(a.region)));
    if (a.sea) { sail(s, a, c, dt); continue; }
    land.push(a);
  }
  // Who attacks whom: an army that means to attack engages the nearest hostile army within reach
  const engaged = engage(s, land);
  for (const a of land) {
    a.battle = engaged.byArmy.get(a.id) ?? null;
    if (!a.battle) a.attacking = null;
  }
  for (const b of Object.values(s.battles)) fight(s, b, gar, dt);
  // Everyone not fighting marches (and an army on the attack takes the ground around it)
  for (const a of land) {
    if (!s.armies[a.id] || a.battle) continue;
    march(s, a, s.countries[a.owner], dt, gar);
  }
  for (const a of land) if (s.armies[a.id] && intends(a)) claimAround(s, a, gar);
  syncProvinces(s);
  navyStep(s, dt);
  shippingStep(s);
  // The front has moved: who is cut off now
  if (s.frontMoved && (s.stepNo ?? 0) % 4 === 0) { s.frontMoved = false; updatePockets(s); }
}

// Once a week: supply, the cost of the war, recovery, pockets, and the air and sea campaigns
export function militaryTick(s) {
  navyTick(s);
  normaliseOcc(s);
  syncProvinces(s, true);
  updatePockets(s);
  supplyAll(s);
  logistics(s);
  for (const a of Object.values(s.armies)) {
    const c = s.countries[a.owner];
    if (!c || !alive(s, a.owner)) { delete s.armies[a.id]; continue; }
    if (a.sea) continue;
    const recover = (a.gen.trait === 'logistician' ? 12 : 8) * (1 + (dfx(s, c.id).orgRecover ?? 0));
    a.org = Math.min(100 * (c.readiness ?? 1), a.org + recover * a.supply * (a.battle ? 0.4 : 1) * (commsReady(s, c.id) ? 1.25 : 1));
    if (a.supply < 0.5) {
      a.troops *= 0.99;
      a.org = Math.max(0, a.org - 5);
    }
    // Radiation sickness in a contaminated province
    if (inFallout(s, s.regions[a.region])) {
      a.troops *= 0.97;
      a.org = Math.max(0, a.org - 4);
      if (!a.irradiated) { a.irradiated = true; briefing(s, a.owner, `${a.name} is in a contaminated zone: radiation sickness is spreading through the ranks. Move it out.`, 'bad'); }
    } else a.irradiated = false;
  }
  // The home guard of a province not being fought over musters again
  for (const reg of Object.values(s.regions)) if (reg.militiaLost && !reg.battle?.fighting) reg.militiaLost = Math.max(0, reg.militiaLost * 0.9 - 1);
  pocketTick(s);
  airAndSea(s);
}

// Pairs off attackers with defenders. A battle is one defending army (and the friendly armies standing right
// beside it) against every army attacking it.
function engage(s, armies) {
  const byArmy = new Map();
  const battles = {};
  for (const a of armies) {
    if (!intends(a) || a.sea) continue;
    let target = null;
    let best = Infinity;
    for (const b of armies) {
      if (b === a || b.sea || !hostile(s, a, b)) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      // An attack order goes for its target first; everyone else in the way is fought too
      const score = d - (a.op.enemy === b.id ? CONTACT : 0);
      if (d <= CONTACT && score < best) { best = score; target = b; }
    }
    if (!target) continue;
    const prev = Object.values(s.battles).find((x) => x.def === target.id);
    const id = prev?.id ?? `b${target.id}`;
    battles[id] ??= { ...(prev ?? {}), id, def: target.id, att: [], since: prev?.since ?? s.week };
    battles[id].att.push(a.id);
  }
  for (const b of Object.values(battles)) {
    byArmy.set(b.def, b.id);
    for (const id of b.att) byArmy.set(id, b.id);
  }
  // Battles that have ended
  for (const b of Object.values(s.battles)) {
    if (battles[b.id]) continue;
    const d = s.armies[b.def];
    if (d && b.trend === 'advancing' && b.att.every((id) => !s.armies[id] || !intends(s.armies[id]))) d.status = `Holding near ${regionName(d.region)}`;
  }
  s.battles = battles;
  return { byArmy };
}

function sail(s, a, c, dt) {
  a.sea.left -= dt;
  // Enemy fleets in the waters off the landing pick off the transports; our fleets there shield them
  const { mine, theirs } = crossingOdds(s, c.id, a.sea.to);
  if (theirs > 0 && a.sea.left > 0) {
    const lost = 0.06 * dt * theirs / (theirs + mine + 1);
    a.troops *= 1 - lost;
    a.tanks *= 1 - lost;
  }
  if (a.sea.left > 0) return;
  const to = a.sea.to;
  const port = PORTS[to];
  const beach = port ? nearestLand(port[0], port[1], (i) => regionAt(i) === to) : provinceCell(to);
  const holder = s.regions[to].ctrl;
  const from = a.sea.from;
  a.sea = null;
  if (!(beach >= 0) || (!friendlyGround(s, c.id, holder) && !atWar(s, c.id, holder))) {
    placeArmy(a, ...cellXY(provinceCell(from)));
    a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: a.op.aggr };
    a.status = 'Landing called off; returned to port';
    return;
  }
  placeArmy(a, ...cellXY(beach));
  if (friendlyGround(s, c.id, holder)) {
    a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: a.op.aggr };
    a.status = `Landed in ${regionName(to)}`;
    return;
  }
  // Storming the beaches: weaker for a fortnight, then the beachhead is just ground like any other
  a.landing = s.week + 2;
  a.op = { kind: 'advance', target: to, at: cellXY(provinceCell(to)), aggr: a.op.aggr };
  a.path = landPath(s, c.id, [a.x, a.y], a.op.at, { offensive: true }) ?? [];
  a.status = `Storming the beaches of ${regionName(to)}`;
  news(s, `${nameOf(s, c.id)}'s troops land in ${regionName(to)}.`, 'war', [c.id, holder]);
  alert(s, holder, `${nameOf(s, c.id)} has landed about ${troopsLabel(approx(a.troops))} troops in ${regionName(to)}.`, 'war', { region: to });
}

// How hard the ground ahead is to cross without a fight: the garrison and home guard of an enemy province slow an
// army down (and cost it men), though they can't stop it
function resistance(s, a, cell, gar) {
  const id = regionAt(cell);
  const reg = s.regions[id];
  if (!reg) return 0;
  const g = gar.get(id);
  const defenders = (g && atWar(s, a.owner, g.holder) ? g.troops : 0) + militiaOf(s, reg);
  if (defenders <= 0) return 0;
  // Spread over the province: what stands in this army's way is a share of it
  const local = defenders * Math.min(1, 12 / Math.max(12, CELLS_OF[id].length));
  return clamp((local / Math.max(5, a.troops)) * terrainAt(cell).defend ** 0.5 * (1 + 0.1 * reg.fort), 0, 3);
}

function march(s, a, c, dt, gar) {
  autoCapture(s, a, c);
  keepToFront(s, a, c);
  // Going after an army: follow it
  if (a.op.kind === 'attack') {
    const e = s.armies[a.op.enemy];
    // A pursuit ends about 1,400 km from where the fighting began: the army doesn't chase a beaten enemy across a continent
    const far = a.op.engaged && a.op.from && dist(a.x, a.y, a.op.from[0], a.op.from[1]) > CONTACT * 8;
    if (!e || e.sea || !hostile(s, a, e) || far) {
      a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: a.op.aggr };
      a.path = [];
      a.status = far ? `Holding near ${regionName(a.region)}: the pursuit has gone far enough` : e ? `Holding near ${regionName(a.region)}: its target is out of reach` : `Holding near ${regionName(a.region)}: its target is gone`;
    } else if ((s.stepNo ?? 0) % 3 === 0 || !a.path.length) {
      a.path = landPath(s, a.owner, [a.x, a.y], [e.x, e.y], { offensive: true }) ?? a.path;
      a.op.at = [e.x, e.y];
    }
  }
  if (!a.path.length) {
    // At the objective with enemy armies still close: the advance goes on until they are beaten or gone
    if (a.op.kind === 'advance' && Object.values(s.armies).some((b) => !b.sea && hostile(s, a, b) && dist(a.x, a.y, b.x, b.y) <= CONTACT * 1.2)) {
      a.status = `Fighting for its objective near ${regionName(a.region)}`;
      return;
    }
    if (a.op.kind === 'advance') {
      const name = regionName(a.region);
      a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: a.op.aggr };
      a.status = `Reached its objective near ${name}: digging in`;
      alert(s, a.owner, `${a.gen.name} reports: ${a.name} has reached its objective near ${name} and is digging in.`, 'good', { region: a.region });
    } else if (a.op.kind === 'move') {
      a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: a.op.aggr };
      a.status = `Holding near ${regionName(a.region)}`;
    } else if (a.op.kind === 'hold' && !/^(Holding|Reached|Fell back|Forming|Landed|Supporting|Encircled|Breaking)/.test(a.status ?? '')) a.status = `Holding near ${regionName(a.region)}`;
    a.stillSince ??= s.week;
    return;
  }
  a.stillSince = null;
  let budget = (marchSpeed(s, a) / 20) * dt;
  let slowed = false;
  while (budget > 0 && a.path.length) {
    const [nx, ny] = a.path[0];
    const next = cellAt(nx, ny);
    const holder = holderAt(s, next);
    // Ground that has changed hands since the order: neutral ground (or enemy ground on a march) means finding
    // another way
    const ok = holder && (friendlyGround(s, a.owner, holder) || (intends(a) && atWar(s, a.owner, holder)));
    if (!ok) {
      const again = a.op.at ? landPath(s, a.owner, [a.x, a.y], a.op.at, { offensive: intends(a), avoid: intends(a) ? [] : enemyZones(s, a.owner) }) : null;
      if (again?.length && again[0] !== a.path[0]) { a.path = again; continue; }
      a.path = [];
      a.status = holder && !atWar(s, a.owner, holder) && !friendlyGround(s, a.owner, holder) ? `Halted: ${nameOf(s, holder)} blocks the way` : 'Halted: enemy ground ahead. Order it to advance to push on';
      a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: a.op.aggr };
      return;
    }
    // A march stops short of an enemy army; it takes an attack to go through one
    if (!intends(a) && Object.values(s.armies).some((b) => !b.sea && hostile(s, a, b) && dist(nx, ny, b.x, b.y) < CONTACT * 0.8)) {
      a.path = [];
      a.status = `Halted: ${nameOf(s, Object.values(s.armies).find((b) => !b.sea && hostile(s, a, b) && dist(nx, ny, b.x, b.y) < CONTACT * 0.8).owner)}'s army is in the way`;
      return;
    }
    // Enemy ground with no army on it: marched through, slowed by its garrison and home guard
    if (!slowed && atWar(s, a.owner, holder)) {
      slowed = true;
      const res = resistance(s, a, next, gar);
      budget /= 1 + 1.5 * res;
      if (res > 0) {
        const lost = a.troops * res * 0.01 * dt;
        a.troops -= lost;
        c.troops = Math.max(0, c.troops - lost);
      }
    }
    const t = terrainAt(next);
    const step = budget / t.move;
    const tx = unwrapNear(nx, a.x);
    const dx = tx - a.x;
    const dy = ny - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      placeArmy(a, tx, ny);
      a.path.shift();
      budget -= d * t.move;
    } else {
      placeArmy(a, a.x + dx * step / d, a.y + dy * step / d);
      budget = 0;
    }
  }
  if (a.op.kind === 'advance') a.status = `${a.op.through ? 'Fighting through' : 'Advancing'} toward ${regionName(a.op.target)}`;
  else if (a.op.kind === 'move') a.status = `On the march to ${regionName(a.op.target)}`;
  else if (a.op.kind === 'attack') a.status = `Going after ${nameOf(s, s.armies[a.op.enemy]?.owner)}'s ${s.armies[a.op.enemy]?.name ?? 'army'}`;
}

// The cells an army on the attack takes: enemy ground around it that no enemy army holds. Ground that belongs to
// an ally (or to a co-belligerent we are not at war with) goes back to it.
function claimAround(s, a, gar) {
  const r = zocOf(a);
  // Ground no enemy army is anywhere near falls much further out: the army's follow-on units and patrols take it
  const far = r * 2.5;
  const zones = [];
  for (const b of Object.values(s.armies)) if (!b.sea && b.x != null && hostile(s, a, b)) zones.push([b.x, b.y, zocOf(b)]);
  const cr = Math.ceil(far / CELL_SIZE);
  const gx0 = Math.floor(a.x / CELL_SIZE);
  const gy0 = Math.floor(a.y / CELL_SIZE);
  const taken = new Map();
  for (let dy = -cr; dy <= cr; dy++) {
    for (let dx = -cr; dx <= cr; dx++) {
      const gy = gy0 + dy;
      if (gy < 0 || gy >= GRID_H) continue;
      const i = gy * GRID_W + ((gx0 + dx + GRID_W) % GRID_W);
      if (!isLand(i)) continue;
      const x = cellX(i);
      const y = cellY(i);
      const d = dist(a.x, a.y, x, y);
      if (d > far) continue;
      const h = holderAt(s, i);
      if (!h || !atWar(s, a.owner, h)) continue;
      // Held by an enemy army's zone: only a battle wins it. Beyond our own zone, only ground no enemy army is
      // close enough to contest.
      if (zones.some(([zx, zy, zr]) => dist(zx, zy, x, y) < (d > r ? zr + CONTACT * 1.5 : zr))) continue;
      // Ground that belongs to an ally (or a co-belligerent) at war with its holder goes back to it
      const owner = s.regions[regionAt(i)].owner;
      const back = owner !== a.owner && alive(s, owner) && onSameSide(s, a.owner, owner) && !atWar(s, a.owner, owner) && atWar(s, owner, h);
      const to = back ? owner : a.owner;
      if (!setHolder(s, i, to)) continue;
      const id = regionAt(i);
      taken.set(id, (taken.get(id) ?? 0) + 1);
      cityFalls(s, i, to, h);
    }
  }
  if (!taken.size) return;
  s.frontMoved = true;
  // The garrison of ground overrun is killed, captured or scattered
  for (const [id, n] of taken) {
    const g = gar.get(id);
    if (!g || g.troops <= 0) continue;
    const share = n / Math.max(1, CELLS_OF[id].length);
    const holder = nation(s, g.holder);
    if (holder && atWar(s, a.owner, g.holder)) holder.troops = Math.max(0, holder.troops - g.troops * share * 0.6);
  }
}

// A city falls with the cell it stands in
function cityFalls(s, cell, to, from) {
  const list = CITIES_AT.get(cell);
  if (!list) return;
  for (const city of list) {
    const reg = s.regions[city.region];
    const share = citiesIn(city.region, reg.pop).find((x) => x.name === city.name)?.share ?? 0;
    if (share < 0.04 && !city.capital) continue;
    const pct = Math.round(share * 100);
    const back = reg.owner === to;
    news(s, back ? `${nameOf(s, to)} retakes ${city.name}.` : `${city.name} falls to ${nameOf(s, to)}${city.capital && reg.owner === from ? `: ${nameOf(s, from)}'s capital is lost` : ''}.`, 'war', [to, from]);
    briefing(s, from, `${city.name} has fallen to ${nameOf(s, to)}. We have lost its factories and workers (about ${pct}% of ${regionName(city.region)}'s output).`, 'bad', { region: city.region, front: true });
    briefing(s, to, `Our troops have ${back ? 'retaken' : 'taken'} ${city.name} (about ${pct}% of ${regionName(city.region)}'s output).`, 'good', { region: city.region, front: true });
  }
}

// After ground changes hands: a province most of which has been taken changes hands as a whole (the minority still
// held by the other side stays theirs, cell by cell), and every province knows how much each side holds
export function syncProvinces(s, all = false) {
  const ids = all ? Object.keys(s.regions) : Object.keys(s.dirtyRegions ?? {});
  s.dirtyRegions = {};
  const fighting = new Set(Object.values(s.battles ?? {}).map((b) => b.region));
  for (const id of ids) {
    const reg = s.regions[id];
    if (!reg) continue;
    const { ground, output } = provinceShares(s, id, citiesIn(id, reg.pop));
    const top = Object.entries(ground).sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] !== reg.ctrl && top[1] > 0.5) capture(s, id, top[0]);
    const others = Object.entries(ground).filter(([h]) => h !== reg.ctrl);
    if (!others.length) { reg.held = null; reg.battle = null; continue; }
    reg.held = Object.fromEntries(Object.entries(output).map(([h, v]) => [h, Math.round(v * 1000) / 1000]));
    const main = others.sort((a, b) => b[1] - a[1])[0];
    reg.battle = { by: main[0], prog: Math.round(main[1] * 100), fallenShare: Math.max(0, 1 - (output[reg.ctrl] ?? 0)), fighting: fighting.has(id), from: null };
  }
}

// What one battle does in a step: the odds, the push, the ground, the losses
function fight(s, b, gar, dt) {
  const d = s.armies[b.def];
  const attackers = b.att.map((id) => s.armies[id]).filter((a) => a && d && hostile(s, a, d));
  if (!d || !attackers.length) return;
  const holder = d.owner;
  const cell = cellAt(d.x, d.y);
  const regionId = regionAt(cell);
  const reg = s.regions[regionId];
  const terrain = terrainAt(cell);
  const lead = attackers.reduce((m, a) => (a.troops > m.troops ? a : m)).owner;
  const fa = dfx(s, lead);
  const fh = dfx(s, holder);
  // Ground held by the defender's side keeps its forts and garrison; ground the enemy already holds doesn't
  const ownGround = onSameSide(s, holder, holderAt(s, cell)) && !atWar(s, holder, holderAt(s, cell));
  const fort = ownGround ? reg.fort : 0;

  // Air superiority over the battlefield: aircraft for both sides, plus the defender's air defences
  const airOf = (id) => {
    const c = s.countries[id];
    if (!c) return 0;
    const busy = Math.max(1, enemiesOf(s, id).size);
    return c.aircraft * airQuality(c) * 0.6 / busy * (1 + (dfx(s, id).airEdge ?? 0));
  };
  const airA = airOf(lead);
  const hd = s.countries[holder];
  const airD = airOf(holder) + (hd ? hd.tech.missile * 25 : 30);
  const airEdge = (airA - airD) / (airA + airD + 1);

  let attack = 0;
  let attackTroops = 0;
  for (const a of attackers) {
    let p = armyAttackEstimate(s, a, regionId) * (1 + 0.05 * gpsCoverage(s, a.owner)) * (knowsPlans(s, a.owner, holder) ? 1.08 : 1);
    if ((a.landing ?? -1) > s.week) p *= a.prepared ? 0.75 : 0.5;
    if (a.assault?.prepared) p *= 1 + (dfx(s, a.owner).setPiece ?? 0);
    if ((a.breakout ?? -1) > s.week) p *= 1.25;
    attack += p;
    attackTroops += a.troops;
    if (!a.assault || a.assault.target !== d.id) a.assault = { target: d.id, since: s.week, prepared: a.stillSince != null && s.week - a.stillSince >= 2 };
    a.stillSince = null;
    a.attacking = regionId;
    // A pursuit is measured from where the fighting began
    if (a.op.kind === 'attack' && a.op.enemy === d.id && !a.op.engaged) { a.op.engaged = true; a.op.from = [a.x, a.y]; }
  }
  attack *= 1 + 0.3 * airEdge;
  attack *= 1 + matchup(s, lead, holder);
  if (reg.cas && reg.cas.until > s.week && onSameSide(s, reg.cas.side, lead)) attack *= 1 + 0.25 * Math.min(1, reg.cas.power) * (1 + (dfx(s, reg.cas.side).cas ?? 0));

  // Pincers: armies closing in from two sides at once
  const pincer = pincerOf(attackers, d);
  const bt = Math.max(0, Math.max(...attackers.map((a) => breakthroughOf(s, a))) - (fh.vsBreakthrough ?? 0) * 0.5);
  if (pincer) attack *= 1.15 + (fa.pincer ?? 0) * 0.6 + bt * 0.1;

  // The defence: the army, the friendly armies right beside it, and (on its own ground) part of the province's
  // garrison and its home guard
  const support = Object.values(s.armies).filter((x) => x !== d && !x.sea && x.x != null && !x.battle && onSameSide(s, x.owner, holder) && attackers.some((a) => hostile(s, a, x)) && dist(x.x, x.y, d.x, d.y) <= GAP * 1.2);
  const defenders = [d, ...support];
  const g = ownGround ? gar.get(regionId) : null;
  const garTroops = g && onSameSide(s, g.holder, holder) ? g.troops * 0.3 : 0;
  const militia = ownGround ? militiaOf(s, reg) * 0.5 : 0;
  let defence = power(garTroops, 0, quality(s, holder), d.pocket && !d.pocketSea ? 45 : 80, d.pocket && !d.pocketSea ? POCKET_SUPPLY : 1, terrain) + power(militia, 0, 0.45, 60, 1, terrain);
  let defendTroops = garTroops + militia;
  for (const x of defenders) {
    const hold = x.op.kind === 'hold' ? 1.1 + 0.05 * Math.min(4, s.week - (x.stillSince ?? s.week)) : 1;
    defence += power(x.troops, runningTanks(s, x) * (1 + (dfx(s, x.owner).armorDefend ?? 0)), quality(s, x.owner), x.org, x.supply, terrain) * genBonus(x.gen, 'defend') * hold;
    defendTroops += x.troops;
  }
  defence *= defendMul(s, holder, terrain, fort) * (1 - 0.2 * airEdge) * (knowsPlans(s, holder, lead) ? 1.08 : 1);
  attack *= 1 + (massBonus(attackTroops, defendTroops) - 1) * (1 + (fa.mass ?? 0));
  defence *= 1 + (massBonus(defendTroops, attackTroops) - 1) * (1 + (fh.mass ?? 0));
  // Street fighting: a big city in the battle holds the attack up
  const street = ownGround ? streetFight(s, d, holder) : null;
  if (street) defence *= 1.12 + 0.12 * (fh.urban ?? 0);
  defence = Math.max(defence, 0.5);

  const fresh = !b.started;
  b.started = true;
  b.region = regionId;
  b.by = lead;
  b.holder = holder;
  const sides = [...new Set(attackers.map((a) => a.owner))];
  if (fresh) {
    news(s, `${nameOf(s, lead)}'s forces attack ${nameOf(s, holder)}'s ${d.name} near ${regionName(regionId)}.`, 'war', [...sides, holder]);
    alert(s, holder, `${nameOf(s, lead)} is attacking our ${d.name} near ${regionName(regionId)} with about ${troopsLabel(approx(attackTroops))} troops.`, 'war', { region: regionId });
  }
  if (pincer && !b.pincer) {
    b.pincer = true;
    news(s, `Pincer movement: ${nameOf(s, lead)}'s armies close in on ${nameOf(s, holder)}'s ${d.name} from two sides.`, 'war', [...sides, holder]);
    for (const side of sides) briefing(s, side, `Our armies are attacking ${nameOf(s, holder)}'s ${d.name} from two sides at once: a pincer. It can't face both ways.`, 'good', { region: regionId, front: true });
    briefing(s, holder, `${nameOf(s, lead)} is closing in on our ${d.name} from two sides. If the pincers meet behind it, it will be cut off.`, 'bad', { region: regionId, front: true });
  }
  if (street && b.street !== street.name && (street.share >= 0.08 || street.capital)) news(s, `Street fighting in ${street.name}: ${nameOf(s, holder)}'s defenders fight for every block.`, 'war', [lead, holder]);
  b.street = street?.name ?? null;
  b.militia = Math.round(militia);
  b.bt = Math.round(bt * 100) / 100;

  const ratio = attack / defence;
  b.ratio = Math.round(ratio * 100) / 100;
  const was = b.trend;
  b.trend = ratio >= 1 ? 'advancing' : ratio < 0.8 ? 'repulsed' : 'stalled';
  reportBattle(s, b, d, { attackers, sides, lead, holder, ratio, attackTroops, defendTroops, defenders, militia, street, pincer, was, regionId });

  // The push, in map pixels a week: an even fight gains about 120 km a week, a 3:1 attack several times that,
  // faster for mechanised armies that break through, slower in rough ground and street by street
  const main = attackers.reduce((m, a) => (a.troops > m.troops ? a : m));
  const tempo = clamp(marchSpeed(s, main) / 700, 0.5, 1.4) * (1 + (fa.tempo ?? 0)) * (ratio >= 1.3 ? 1 + 0.8 * Math.min(1, bt) : 1);
  const push = ratio >= 1 ? Math.min(32, 5 + 9 * (ratio - 1)) * tempo * (street ? 0.5 / (1 + (fh.urban ?? 0)) : 1) / terrain.move
    : ratio >= 0.8 ? 1.5 * (ratio - 0.8) / 0.2
      : -(3 + 10 * (0.8 - ratio)) * (1 + (fh.counter ?? 0));
  let cut = false;
  if (push > 0) cut = !retreat(s, d, attackers, push * dt * (d.org <= 0 ? 2 : 1));
  else if (push < 0) for (const a of attackers) fallBack(s, a, d, -push * dt);
  // An army going after this one keeps in touch with it as it retreats; one advancing on an objective pushes on
  // toward it, and fights whatever is still in its way
  if (push >= 0) {
    for (const a of attackers) {
      if (a.op.kind === 'attack' && a.op.enemy === d.id) closeIn(s, a, d, push * dt * 1.3);
      else if (push > 0) pushOn(s, a, push * dt * 1.2);
    }
  }

  // Losses
  let attackLoss = 0;
  for (const a of attackers) {
    const style = AGGRESSION[a.op.aggr ?? 'balanced'].losses * (a.gen.trait === 'aggressive' ? 1.2 : a.gen.trait === 'cautious' ? 0.75 : 1) * Math.max(0.5, 1 + (dfx(s, a.owner).attackLoss ?? 0));
    const rate = 0.016 * dt * clamp(1 / ratio, 0.35, 2.5) * style * ((a.landing ?? -1) > s.week ? (a.prepared ? 1.4 : 1.8) : 1);
    const lost = a.troops * rate;
    a.troops -= lost;
    a.tanks *= 1 - rate * 1.4;
    a.org = Math.max(0, a.org - ((a.op.aggr ?? 'balanced') === 'allout' ? 8 : 6) * dt);
    attackLoss += lost;
  }
  // A defender with nowhere to fall back to (cut off behind) takes far heavier losses, and one hopelessly
  // outnumbered is overrun
  const overrun = ratio > 2 ? 1 + Math.min(6, ratio - 2) : 1;
  const defRate = 0.016 * dt * clamp(ratio, 0.35, 2.5) * Math.max(0.5, 1 + (fh.defendLoss ?? 0)) * (pincer ? 1.25 : 1) * (cut ? 1.8 : 1) * overrun;
  let defendLoss = 0;
  for (const x of defenders) {
    const share = x === d ? 1 : 0.5;
    const lost = x.troops * defRate * share * (x.gen.trait === 'defensive' ? 0.85 : 1) * Math.max(0.5, 1 + (dfx(s, x.owner).defendLoss ?? 0));
    x.troops -= lost;
    const xn = nation(s, x.owner);
    if (xn) xn.troops = Math.max(0, xn.troops - lost);
    x.tanks *= 1 - defRate * 1.3 * share;
    x.org = Math.max(0, x.org - ((pincer ? 9 : 6) + (cut ? 6 : 0) + (overrun - 1) * 10) * dt * share);
    defendLoss += lost;
  }
  const hn = nation(s, holder);
  if (garTroops > 0 && hn) { const gl = garTroops * defRate; hn.troops = Math.max(0, hn.troops - gl); defendLoss += gl; }
  if (militia > 0) { const ml = militia * defRate * 1.6; reg.militiaLost = (reg.militiaLost ?? 0) + ml; defendLoss += ml; }
  for (const a of attackers) {
    const n = s.countries[a.owner];
    n.troops = Math.max(0, n.troops - attackLoss * (a.troops / Math.max(1, attackTroops)));
  }
  record(s, lead, attackLoss);
  record(s, holder, defendLoss);
  for (const side of sides) noteFighting(s.countries[side], 'attack', dt / sides.length, ratio >= 1);
  noteFighting(s.countries[holder], 'defend', dt, ratio < 1);
  if (reg.cas && reg.cas.until > s.week) noteFighting(s.countries[reg.cas.side], 'air', dt * 0.5, true);
  for (const a of attackers) bury(s, a.owner, attackLoss * (a.troops / Math.max(1, attackTroops)));
  bury(s, holder, defendLoss);
  reg.pop *= 1 - 0.0008 * dt * Math.min(2, ratio) * (street ? 1.6 : 1);
  const war = warBetween(s, lead, holder);
  if (war) {
    if (war.a === lead) { war.lossA += attackLoss; war.lossB += defendLoss; } else { war.lossB += attackLoss; war.lossA += defendLoss; }
  }
  reg.dmg = Math.min(0.9, reg.dmg + 0.006 * dt * (street ? 1.8 : 1));
  b.x = Math.round(((d.x + attackers[0].x) / 2) * 10) / 10;
  b.y = Math.round(((d.y + attackers[0].y) / 2) * 10) / 10;
  b.att = attackers.map((a) => a.id);
  b.attackTroops = Math.round(attackTroops);
  b.defendTroops = Math.round(defendTroops);
  // A spent attack is called off; a beaten army that can go no further breaks
  for (const a of attackers) {
    b.badSince = ratio < 0.5 ? b.badSince ?? s.week + (s.stepped ?? 0) : null;
    const hopeless = b.badSince != null && s.week + (s.stepped ?? 0) - b.badSince >= 1;
    // A computer-run general calls off a spent attack; a leader's order stands until it is hopeless
    if ((a.org < 6 && !s.countries[a.owner]?.human) || hopeless) {
      a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: a.op.aggr };
      a.path = [];
      a.status = `Attack called off near ${regionName(a.region)}: exhausted`;
      alert(s, a.owner, `${a.gen.name} has called off ${a.name}'s attack near ${regionName(a.region)}: the troops are spent. It is holding where it stands.`, 'warn', { region: a.region });
    }
  }
  // Broken: an army with no organisation left against overwhelming odds, or with nowhere to retreat to, gives up
  if (s.armies[d.id] && d.org <= 0 && (ratio >= 5 || (cut && ratio >= 2))) {
    news(s, `${nameOf(s, holder)}'s ${d.name} is overrun near ${regionName(regionId)}.`, 'war', [holder, lead]);
    surrender(s, d, false);
  }
  for (const a of Object.values(s.armies)) if (a.troops < 1) destroyArmy(s, a, 'was destroyed in battle');
}

// An attacker advancing on an objective moves on along its route as it wins
function pushOn(s, a, by) {
  let budget = by;
  while (budget > 0 && a.path.length) {
    const [nx, ny] = a.path[0];
    const cell = cellAt(nx, ny);
    const h = holderAt(s, cell);
    if (!h || !(friendlyGround(s, a.owner, h) || atWar(s, a.owner, h))) return;
    const tx = unwrapNear(nx, a.x);
    const d = Math.hypot(tx - a.x, ny - a.y);
    if (d <= budget) { placeArmy(a, tx, ny); a.path.shift(); budget -= d; } else { placeArmy(a, a.x + (tx - a.x) * budget / d, a.y + (ny - a.y) * budget / d); budget = 0; }
  }
}

// The defender gives ground, away from the attackers, onto ground its own side holds. Returns false when it has
// nowhere to go (the ground behind it is the enemy's).
function retreat(s, d, attackers, by) {
  const cx = attackers.reduce((t, a) => t + unwrapNear(a.x, d.x), 0) / attackers.length;
  const cy = attackers.reduce((t, a) => t + a.y, 0) / attackers.length;
  let dx = d.x - cx;
  let dy = d.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.4, -1.4]) {
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const rx = dx * c - dy * sn;
    const ry = dx * sn + dy * c;
    const nx = d.x + rx * by;
    const ny = d.y + ry * by;
    const cell = cellAt(nx, ny);
    if (!isLand(cell)) continue;
    const h = holderAt(s, cell);
    if (!h || !(friendlyGround(s, d.owner, h))) continue;
    placeArmy(d, nx, ny);
    if (d.op.kind === 'hold') d.op.at = [d.x, d.y];
    return true;
  }
  return false;
}

// An attack that is beaten back loses ground
function fallBack(s, a, d, by) {
  let dx = a.x - unwrapNear(d.x, a.x);
  let dy = a.y - d.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const nx = a.x + dx * by;
  const ny = a.y + dy * by;
  const cell = cellAt(nx, ny);
  if (isLand(cell) && friendlyGround(s, a.owner, holderAt(s, cell))) placeArmy(a, nx, ny);
  else if (isLand(cell) && atWar(s, a.owner, holderAt(s, cell))) placeArmy(a, nx, ny);
}

// Attackers follow a retreating defender to keep up the pressure
function closeIn(s, a, d, by) {
  const tx = unwrapNear(d.x, a.x);
  const gap = Math.hypot(tx - a.x, d.y - a.y);
  if (gap <= GAP) return;
  const step = Math.min(gap - GAP, Math.max(by, (gap - GAP) * 0.5));
  const nx = a.x + (tx - a.x) * step / gap;
  const ny = a.y + (d.y - a.y) * step / gap;
  const cell = cellAt(nx, ny);
  if (!isLand(cell)) return;
  const h = holderAt(s, cell);
  if (h && (friendlyGround(s, a.owner, h) || atWar(s, a.owner, h))) placeArmy(a, nx, ny);
}

const unwrapNear = (x, ref) => (x - ref > MAPW / 2 ? x - MAPW : ref - x > MAPW / 2 ? x + MAPW : x);

// Do the attacks come from two sides? Two attacking armies whose lines of approach are at least 70 degrees apart
// are a pincer.
function pincerOf(attackers, d) {
  const dirs = [];
  for (const a of attackers) {
    const dx = d.x - unwrapNear(a.x, d.x);
    const dy = d.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) dirs.push([dx / len, dy / len]);
  }
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    if (dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] <= Math.cos((70 * Math.PI) / 180)) return true;
  }
  return false;
}

// A big city right where the defender stands, still in its side's hands: the attack has to take it street by street
function streetFight(s, d, holder) {
  let best = null;
  const gx0 = Math.floor(d.x / CELL_SIZE);
  const gy0 = Math.floor(d.y / CELL_SIZE);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = (gy0 + dy) * GRID_W + ((gx0 + dx + GRID_W) % GRID_W);
    const list = CITIES_AT.get(i);
    if (!list || !onSameSide(s, holderAt(s, i), holder)) continue;
    for (const c of list) {
      const share = citiesIn(c.region, s.regions[c.region].pop).find((x) => x.name === c.name)?.share ?? 0;
      if ((share < 0.05 && !c.capital) || (best && share <= best.share)) continue;
      best = { name: c.name, share, capital: c.capital };
    }
  }
  return best;
}

// How the battle is going, on each army's card, and in the news whenever it turns
function reportBattle(s, b, d, { attackers, sides, lead, holder, ratio, attackTroops, defendTroops, defenders, militia = 0, street = null, pincer = false, was, regionId }) {
  const trend = b.trend;
  const odds = `${ratio.toFixed(2)}:1`;
  const where = regionName(regionId);
  const parts = [...defenders.map((a) => `${nameOf(s, a.owner)}'s ${a.name} (~${troopsLabel(approx(a.troops))})`), militia >= 1 ? `~${troopsLabel(approx(militia))} home guard` : null].filter(Boolean);
  const theirs = `about ${troopsLabel(approx(defendTroops))} defenders${parts.length ? `, including ${parts.join(', ')}` : ''}`;
  const how = [pincer ? 'pincer' : null, street ? `street fighting in ${street.name}` : null].filter(Boolean).join(', ');
  for (const a of attackers) {
    a.status = trend === 'advancing' ? `Attacking ${nameOf(s, holder)}'s ${d.name} near ${where}: pushing it back (${odds}${how ? `; ${how}` : ''})`
      : trend === 'stalled' ? `Attacking near ${where}: held up (${odds} against ${theirs})`
        : `Thrown back near ${where} (${odds} against ${theirs})`;
  }
  d.status = trend === 'advancing' ? `Falling back under attack near ${where} (${odds} against us)` : trend === 'stalled' ? `Holding off an attack near ${where}` : `Throwing back an attack near ${where}`;
  if (trend === 'advancing' || trend === was) return;
  if ((b.told ?? -99) > s.week - 2 && !(trend === 'repulsed' && was === 'stalled')) return;
  b.told = s.week;
  if (trend === 'stalled') {
    news(s, `${nameOf(s, lead)}'s attack near ${where} has stalled against ${nameOf(s, holder)}'s defences.`, 'war', [...sides, holder]);
    for (const side of sides) alert(s, side, `Our attack near ${where} has stalled: ${troopsLabel(approx(attackTroops))} troops against ${theirs}. The odds are ${odds}; at 1:1 or better we advance. Send more armies to attack it together, from another side if you can, or call in the air force.`, 'warn', { region: regionId });
  } else {
    news(s, `${nameOf(s, holder)} throws back ${nameOf(s, lead)}'s attack near ${where}.`, 'war', [...sides, holder]);
    for (const side of sides) alert(s, side, `Our attack near ${where} is being thrown back: ${troopsLabel(approx(attackTroops))} troops against ${theirs}. The odds are only ${odds}. Reinforce, attack together, or pull back.`, 'bad', { region: regionId });
    alert(s, holder, `Our ${d.name} is throwing back ${nameOf(s, lead)}'s attack near ${where}.`, 'good', { region: regionId });
  }
}

// Soldiers killed (in thousands) come off their home population: about a third of losses are dead, the rest
// wounded or captured
export function bury(s, id, lossK) {
  const dead = (lossK * 0.35) / 1000;
  if (!(dead > 0)) return;
  const homes = Object.values(s.regions).filter((r) => r.owner === id && r.ctrl === id);
  const total = homes.reduce((t, r) => t + r.pop, 0);
  if (!total) return;
  const f = Math.max(0.5, 1 - dead / total);
  for (const r of homes) r.pop *= f;
  const n = nation(s, id);
  if (n) n.dead = (n.dead ?? 0) + lossK * 0.35;
}

function record(s, id, lossK) {
  const c = s.countries[id];
  if (!c) return;
  c.losses += lossK;
  // People who believe in the war bear its losses longer
  c.warWeariness += (lossK / Math.sqrt(Math.max(1, c.pop))) * 3 * (warsAccepted(s, id) ? 0.6 : 1);
}

function destroyArmy(s, a, how) {
  if (!s.armies[a.id]) return;
  delete s.armies[a.id];
  alert(s, a.owner, `${a.name} (${a.gen.name}) ${how}.`, 'bad');
  news(s, `${nameOf(s, a.owner)}'s ${a.name} ${how}.`, 'war', [a.owner]);
}

// A province has changed hands as a whole: most of its ground taken by armies, or handed over by a peace, a
// settlement or an uprising. Ground each side held inside it stays theirs.
export function capture(s, regionId, by) {
  const reg = s.regions[regionId];
  const prev = reg.ctrl;
  if (prev === by) return;
  reg.ctrl = by;
  rebase(s, regionId, by, prev);
  s.frontMoved = true;
  reg.dmg = Math.min(0.9, reg.dmg + 0.05);
  reg.militiaLost = 0;
  if (by === reg.owner) {
    reg.unrest = 0;
  } else {
    reg.unrest = 45;
    // Retreating defenders wreck oil wells and mines (as at Maykop in 1942)
    if ((reg.res.oil || reg.res.gas) && chance(s, 0.6)) reg.dmg = Math.min(0.9, reg.dmg + 0.2);
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

/* ---------- Logistics: money, factories and men to keep armies fed far from home ---------- */

// For each country: what its armies abroad cost each week, whether its factories keep up with munitions, and
// whether enough troops are free to guard the supply lines. Shortfalls cut every army's supply.
function logistics(s) {
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    const mine = Object.values(s.armies).filter((a) => a.owner === c.id);
    const cf = 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);
    let cost = 0;
    let demand = 0;
    let rear = 0;
    for (const a of mine) {
      const reg = s.regions[a.region];
      const abroad = Boolean(a.sea) || reg.owner !== c.id;
      const fighting = Boolean(a.battle);
      const hops = abroad && !a.sea ? hopsHome(s, a) ?? 8 : 0;
      cost += a.troops * (abroad ? 0.0009 : 0.0002) * (1 + hops * 0.2) * cf + a.tanks * (fighting ? 0.00012 : 0.00003) * cf;
      // Fighting far from home burns munitions and fuel fastest; defending at home draws on local stocks
      demand += (a.troops * 0.001 + a.tanks * 0.00015) * (abroad ? (fighting ? 2.5 : 1.2) : (fighting ? 1 : 0.4));
      if (abroad) rear += a.troops * Math.min(0.3, 0.03 * Math.max(1, hops));
    }
    const capacity = c.gdp * (0.5 + c.tech.industry / 20) * 0.0008 * [1, 1.5, 2.2][c.mob] * (1 - 0.6 * (c.short.metal ?? 0)) * (1 - 0.5 * (c.short.iron ?? 0));
    const fromFunds = Math.min(c.milFunds, cost);
    c.milFunds -= fromFunds;
    c.treasury -= cost - fromFunds;
    const free = Math.max(0, c.troops - mine.reduce((t, a) => t + a.troops, 0));
    const factories = demand > 0 ? Math.min(1, capacity / demand) : 1;
    const guards = rear > 0 ? Math.min(1, free / rear) : 1;
    const funds = c.readiness ?? 1;
    c.logistics = { cost: cost * 52, capacity, demand, factories, rear, free, guards, ratio: (0.55 + 0.45 * factories) * (0.6 + 0.4 * guards) * funds };
    // The week's fuel bill, which the country must buy on the market if it doesn't pump enough itself
    c.fuel = forcesFuel(s, c);
    const cut = fuelCut(c);
    if (cut >= 0.25 && !c.fuelCrisis) {
      c.fuelCrisis = true;
      briefing(s, c.id, `Fuel crisis: our forces are getting only ${Math.round((1 - cut) * 100)}% of the oil they burn. Tanks are stalling, aircraft are grounded and the advance is slowing. Buy oil (Economy, Market), seize oil fields, or halt operations.`, 'bad');
      if (mine.length) news(s, `${c.name}'s war machine is running out of fuel.`, 'war', [c.id]);
    } else if (cut < 0.1) c.fuelCrisis = false;
    for (const a of mine) if (!a.sea) a.supply *= c.logistics.ratio;
  }
}

/* ---------- Supply ---------- */

// Every country's supply map for the week: how far each cell its side holds is from home over its side's ground
// (land.js), worked out once per week and once after the front moves
const supplyCache = new WeakMap();
function supplyOf(s, owner) {
  let cache = supplyCache.get(s);
  // Provinces can change hands without a battle (a peace, an uprising): who controls each is part of the key
  const sig = `${s.occRev ?? 0}|${s.week}|${Object.values(s.regions).map((r) => r.ctrl).join(',')}`;
  if (!cache || cache.sig !== sig) { cache = { sig, maps: new Map() }; supplyCache.set(s, cache); }
  if (!cache.maps.has(owner)) cache.maps.set(owner, supplyMap(s, owner));
  return cache.maps.get(owner);
}
// How far an army is from home over friendly ground, in old-style province hops (about 400 km each), or null if
// it is cut off
export function hopsHome(s, a) {
  const d = supplyOf(s, a.owner).get(cellAt(a.x, a.y));
  return d == null ? null : d / 8;
}

function supplyAll(s) {
  for (const a of Object.values(s.armies)) {
    if (a.sea) { a.supply = 0.8; continue; }
    const c = s.countries[a.owner];
    if (a.x == null) placeArmy(a, ...cellXY(provinceCell(a.region)));
    const reg = s.regions[a.region];
    const d = dfx(s, a.owner);
    const cell = cellAt(a.x, a.y);
    const holder = holderAt(s, cell);
    const home = reg.owner === a.owner && holder === a.owner;
    let supply;
    const hops = hopsHome(s, a);
    if (home) supply = 1;
    // Off the land connection home but not surrounded (an island, an exclave): supplied by sea and air
    else if (hops == null) supply = 0.6;
    else {
      supply = clamp(1.05 - 0.1 * hops * Math.max(0.3, 1 - (d.reach ?? 0)), 0.35, 1);
      // Living off the land: never as short in enemy country
      if (d.forage && reg.owner !== a.owner) supply = Math.max(supply, 0.45 + d.forage);
    }
    // Cut off: whatever the army carried, and whatever is flown in
    const pocket = pocketAt(s, cell);
    a.pocket = pocket && onSameSide(s, a.owner, pocket.holder) ? pocket.id : null;
    a.pocketSea = Boolean(a.pocket && pocket.sea);
    if (a.pocket) supply = pocket.sea ? Math.max(Math.min(supply, 0.8), 0.65) : Math.min(supply, POCKET_SUPPLY + 0.55 * airliftCover(s, a));
    // Partisans: a hostile people ambushes convoys and blows up rail lines, all the more under a people's war
    if (reg.people !== a.owner && holder === a.owner && (reg.loyalty ?? 50) < 30) supply *= Math.max(0.4, 0.75 - 0.15 * (dfx(s, reg.people).partisans ?? 0) + 0.25 * (reg.loyalty / 30));
    // Bombed roads and depots
    if (reg.interdict && reg.interdict.until > s.week && atWar(s, reg.interdict.by, a.owner)) supply *= 1 - 0.4 * Math.min(1, reg.interdict.power);
    if (a.gen.trait === 'logistician') supply = Math.min(1, supply + 0.15);
    a.supply = supply * (1 - 0.6 * fuelCut(c));
  }
}

/* ---------- Air campaigns and blockades ---------- */

function airAndSea(s) {
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    c.airOps = c.airOps.filter((op) => {
      const reg = s.regions[op.region];
      if (!reg || !atWar(s, c.id, reg.ctrl) || op.aircraft <= 0) return false;
      op.mission ??= 'strategic';
      op.total ??= { org: 0, killed: 0, dmg: 0, lost: 0, weeks: 0 };
      const def = s.countries[reg.ctrl];
      const { eff, power, defAir } = airPower(s, c, op, reg);
      const week = { org: 0, killed: 0, dmg: 0, lost: 0 };
      if (op.mission === 'support') {
        // The defenders take it, and our attack there goes in easier this coming week
        const armies = Object.values(s.armies).filter((a) => a.region === op.region && !a.sea && onSameSide(s, a.owner, reg.ctrl));
        for (const a of armies) {
          const hit = Math.min(a.org, 7 * power);
          a.org -= hit;
          const killed = a.troops * 0.006 * power;
          a.troops = Math.max(1, a.troops - killed);
          week.org = Math.max(week.org, hit);
          week.killed += killed;
        }
        const g = garrisons(s).get(op.region);
        if (g && def) { const killed = g.troops * 0.004 * power; def.troops = Math.max(0, def.troops - killed); week.killed += killed; }
        bury(s, reg.ctrl, week.killed);
        reg.cas = { side: c.id, power, until: s.week + 2 };
      } else if (op.mission === 'interdict') {
        reg.interdict = { by: c.id, power, until: s.week + 2 };
        for (const id of GEO[op.region].adj) {
          const n = s.regions[id];
          if (n && atWar(s, c.id, n.ctrl) && !(n.interdict?.until > s.week && n.interdict.power > power / 2)) n.interdict = { by: c.id, power: power / 2, until: s.week + 2 };
        }
        week.dmg = 0.004 * power;
        reg.dmg = Math.min(0.9, reg.dmg + week.dmg);
      } else {
        week.dmg = 0.02 * power * (1 + (dfx(s, c.id).strategic ?? 0));
        reg.dmg = Math.min(0.9, reg.dmg + week.dmg);
      }
      // Fighters and air defences shoot some of ours down; theirs suffer too
      const lost = Math.max(0, Math.round(op.aircraft * 0.006 * (1.2 - eff)));
      week.lost = lost;
      op.aircraft -= lost;
      c.aircraft = Math.max(0, c.aircraft - lost);
      if (def && defAir > 0) def.aircraft = Math.max(0, def.aircraft - Math.round(def.aircraft * 0.002 * eff));
      op.last = { ...week, eff: Math.round(eff * 100) / 100, week: s.week };
      for (const k of ['org', 'killed', 'dmg', 'lost']) op.total[k] += week[k];
      op.total.weeks++;
      // A report from the air staff: after the first week, then once a month
      if (op.total.weeks === 1 || op.total.weeks % 4 === 0) alert(s, c.id, airReport(op), 'info', { region: op.region, front: true });
      return op.aircraft > 0;
    });
  }
}

function airReport(op) {
  const where = regionName(op.region);
  const t = op.total;
  const lost = t.lost ? ` We have lost ${Math.round(t.lost)} aircraft.` : '';
  if (op.mission === 'support') return `Close air support over ${where}, ${t.weeks} week${t.weeks > 1 ? 's' : ''}: ${troopsLabel(t.killed)} defenders hit, their organisation down ${Math.round(op.last.org)} points this week; our attacks there hit harder.${lost}`;
  if (op.mission === 'interdict') return `Interdiction around ${where}, ${t.weeks} week${t.weeks > 1 ? 's' : ''}: enemy armies there are short of supply.${lost}`;
  return `Strategic bombing of ${where}, ${t.weeks} week${t.weeks > 1 ? 's' : ''}: output ${Math.round(t.dmg * 100)} points lower.${lost}`;
}

/* ---------- Encirclement: supply lines, pockets, airlifts and breakouts ---------- */
//
// Every cell a country holds draws its supply over its own (or friendly) ground from the capital and the
// heartland. When spearheads close a ring around a stretch of ground, everything inside is a pocket: the armies
// there keep fighting on what they carry, losing organisation, fuel and men every week, until they break out, are
// relieved from outside, are kept alive by an airlift (as at Stalingrad, for a while), or surrender. Ground inside
// a ring with no army to hold it falls: its garrisons give up within a week. A pocket on the coast that the enemy
// doesn't hold the sea around is supplied by ship instead, as Odessa and Sevastopol were.

export const POCKET_WEEKS_TO_COLLAPSE = 3;

// The pocket a cell is in, if any
const pocketIndex = new WeakMap();
export function pocketAt(s, cell) {
  let idx = pocketIndex.get(s);
  if (!idx || idx.list !== s.pocketList) {
    idx = { list: s.pocketList, map: new Map() };
    for (const p of Object.values(s.pocketList ?? {})) for (const i of pocketCells(p)) idx.map.set(i, p);
    pocketIndex.set(s, idx);
  }
  return idx.map.get(cell) ?? null;
}
// A pocket's cells, from the runs it is kept as
export function pocketCells(p) {
  const out = [];
  for (const [i, n] of p.runs ?? []) for (let k = 0; k < n; k++) out.push(i + k);
  return out;
}

// Recomputes every pocket in the world (s.pocketList: { id, holder, sea, since, name, main, cells })
export function updatePockets(s) {
  const before = s.pocketList ?? {};
  const was = new Map();
  for (const p of Object.values(before)) for (const i of pocketCells(p)) was.set(i, p);
  const list = {};
  const holders = new Set();
  for (const c of [...Object.values(s.countries), ...Object.values(s.minors)]) if (alive(s, c.id) && enemiesOf(s, c.id).size) holders.add(c.id);
  for (const h of holders) {
    const supply = supplyOf(s, h);
    for (const cells of cutOff(s, h, supply)) {
      // Too small to matter: a cell or two left behind by the front
      if (cells.length < 3) continue;
      const enemyNear = cells.some((i) => neighbours4(i).some((j) => isLand(j) && atWar(s, h, holderAt(s, j))));
      if (!enemyNear) continue;
      // Supplied by sea: a port inside it whose waters the enemy doesn't hold, and ships to run supplies in
      const ships = (s.countries[h]?.ships ?? 0) + Object.values(s.countries).filter((o) => o.id !== h && allied(s, o.id, h)).reduce((t, o) => t + o.ships, 0);
      const regions = [...new Set(cells.map(regionAt))];
      const sea = ships >= 3 && regions.some((id) => {
        const port = PORTS[id];
        if (!port || !cells.some((i) => dist(cellX(i), cellY(i), port[0], port[1]) < 20)) return false;
        const { mine, theirs } = controlAt(s, h, port[0], port[1], OFF_COAST * 1.5);
        return theirs === 0 || mine >= theirs;
      });
      const old = cells.map((i) => was.get(i)).find((p) => p && p.holder === h);
      const id = old?.id ?? nextId(s, 'pk');
      // Named after the biggest city inside, as the Kiev or Demyansk pocket was
      let city = null;
      for (const i of cells) for (const c of CITIES_AT.get(i) ?? []) if (!city || c.pop > city.pop) city = c;
      const main = regions.reduce((m, r) => (s.regions[r].gdp > s.regions[m].gdp ? r : m), regions[0]);
      list[id] = { id, holder: h, sea, since: old?.since ?? s.week, name: city?.name ?? regionName(main).replace(/\s*\(.*\)$/, ''), main, runs: cellRuns(cells) };
      if (!old) {
        const enemies = [...new Set(cells.flatMap((i) => neighbours4(i).filter(isLand).map((j) => holderAt(s, j)).filter((x) => x && atWar(s, h, x))))];
        const inside = new Set(cells);
        const troops = Object.values(s.armies).filter((a) => !a.sea && onSameSide(s, a.owner, h) && inside.has(cellAt(a.x, a.y))).reduce((t, a) => t + a.troops, 0);
        news(s, `${sea ? 'Cut off by land' : 'Encircled'}: ${nameOf(s, h)}'s forces around ${list[id].name} are surrounded${troops >= 1 ? ` (about ${troopsLabel(approx(troops))} troops in armies)` : ''}${sea ? ', though still supplied by sea' : ''}.`, 'war', [h, ...enemies]);
        briefing(s, h, sea
          ? `Our forces around ${list[id].name} are cut off by land. Ships are still getting supplies in, but if the enemy wins the sea there they will be truly surrounded.`
          : troops >= 1
            ? `ENCIRCLED: our forces around ${list[id].name} are cut off from home. Every week they lose organisation, fuel and men. Break out toward our lines, fly in supplies (an airlift, from the army's card), open a corridor from outside, or surrender.`
            : `Our ground around ${list[id].name} has been cut off. With no army there to hold it, its garrisons will not last a week.`, 'bad', { region: main, front: true });
        for (const e of enemies) briefing(s, e, `Our armies have encircled ${nameOf(s, h)}'s ground around ${list[id].name}${troops >= 1 ? `, with about ${troopsLabel(approx(troops))} of its troops inside` : ''}. Cut off from supply, it weakens every week.`, 'good', { region: main, front: true });
      }
    }
  }
  // Pockets gone: relieved, or overrun
  for (const p of Object.values(before)) {
    if (list[p.id] || p.sea) continue;
    const relieved = pocketCells(p).some((i) => holderAt(s, i) === p.holder);
    if (relieved) {
      news(s, `The pocket around ${p.name} is relieved: ${nameOf(s, p.holder)} has opened a corridor to its trapped forces.`, 'war', [p.holder]);
      briefing(s, p.holder, `Our forces around ${p.name} are no longer surrounded: supplies are getting through again.`, 'good', { region: p.main, front: true });
    }
  }
  s.pocketList = list;
}

// Ground inside a ring that no army holds falls to the encircler: the garrisons give up after a week
function mopUp(s) {
  for (const p of Object.values(s.pocketList ?? {})) {
    if (p.sea || s.week - p.since < 1) continue;
    const cells = pocketCells(p);
    const inside = new Set(cells);
    const held = Object.values(s.armies).some((a) => !a.sea && onSameSide(s, a.owner, p.holder) && inside.has(cellAt(a.x, a.y)));
    if (held) continue;
    // To whoever holds most of the ground around it
    const count = new Map();
    for (const i of cells) for (const j of neighbours4(i)) {
      if (!isLand(j)) continue;
      const h = holderAt(s, j);
      if (h && atWar(s, p.holder, h)) count.set(h, (count.get(h) ?? 0) + 1);
    }
    const to = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!to) continue;
    const gar = garrisons(s);
    const lost = new Map();
    for (const i of cells) {
      if (holderAt(s, i) !== p.holder) continue;
      const owner = s.regions[regionAt(i)].owner;
      const back = owner !== to && alive(s, owner) && onSameSide(s, to, owner) && !atWar(s, to, owner) && atWar(s, owner, p.holder);
      setHolder(s, i, back ? owner : to);
      cityFalls(s, i, back ? owner : to, p.holder);
      lost.set(regionAt(i), (lost.get(regionAt(i)) ?? 0) + 1);
    }
    const n = nation(s, p.holder);
    for (const [id, k] of lost) { const g = gar.get(id); if (n && g) n.troops = Math.max(0, n.troops - g.troops * k / Math.max(1, CELLS_OF[id].length)); }
    news(s, `${nameOf(s, p.holder)}'s garrisons around ${p.name}, cut off with no army to relieve them, surrender to ${nameOf(s, to)}.`, 'war', [p.holder, to]);
    s.frontMoved = true;
    delete s.pocketList[p.id];
    s.pocketList = { ...s.pocketList };
  }
  syncProvinces(s);
}

// How much of a surrounded army's needs an airlift covers, 0 to 1
export function airliftCover(s, a) {
  const c = s.countries[a.owner];
  const lift = (c?.airlifts ?? []).find((x) => x.army === a.id);
  if (!lift) return 0;
  return clamp((lift.aircraft * 0.8 * (1 + (dfx(s, a.owner).airlift ?? 0))) / Math.max(20, a.troops), 0, 1);
}

// The pocket's clock, once a week: organisation, fuel and men drain away; armies at the end of their strength
// surrender; airlifts fly in and lose aircraft; undefended ground inside a ring falls
function pocketTick(s) {
  for (const a of Object.values(s.armies)) {
    if (a.sea) continue;
    const c = s.countries[a.owner];
    if (!a.pocket || a.pocketSea) { a.pocketWeeks = 0; continue; }
    const d = dfx(s, a.owner);
    const lift = airliftCover(s, a);
    const bite = (1 - 0.75 * lift) * (1 - clamp(d.pocket ?? 0, 0, 0.8));
    a.pocketWeeks = (a.pocketWeeks ?? 0) + 1;
    a.org = Math.max(0, a.org - 10 * bite);
    const lost = a.troops * 0.025 * bite;
    a.troops -= lost;
    a.tanks *= 1 - 0.04 * bite;
    if (c) c.troops = Math.max(0, c.troops - lost);
    bury(s, a.owner, lost * 0.5);
    if (a.pocketWeeks === 1 || a.pocketWeeks % 3 === 0) {
      briefing(s, a.owner, `${a.name} has been surrounded for ${a.pocketWeeks} week${a.pocketWeeks > 1 ? 's' : ''} near ${regionName(a.region)}: organisation ${Math.round(a.org)}%, supply ${Math.round(a.supply * 100)}%${lift ? `, the airlift covering ${Math.round(lift * 100)}% of its needs` : ''}. ${a.org < 20 ? 'It cannot hold out much longer.' : 'Break out, fly in supplies or relieve it.'}`, a.org < 20 ? 'bad' : 'warn', { region: a.region, front: true });
    }
    // At the end of its strength, an army surrenders. A human leader's army only when it has nothing left; never
    // one with commissars at its back.
    if (d.noSurrender || a.pocketWeeks < POCKET_WEEKS_TO_COLLAPSE) continue;
    const spent = a.org < 4 && lift < 0.4;
    if (c?.human ? spent && chance(s, 0.4) : a.org < 12 && lift < 0.5 && chance(s, 0.35)) surrender(s, a, true);
  }
  mopUp(s);
  // Airlifts: transports and fighters lost to the enemy's air force and flak; a lift to an army no longer
  // surrounded (or gone) stands down
  for (const c of Object.values(s.countries)) {
    if (!c.airlifts?.length) continue;
    c.airlifts = c.airlifts.filter((x) => {
      const a = s.armies[x.army];
      if (!a || !a.pocket || a.pocketSea) {
        if (a) briefing(s, c.id, `The airlift to ${a.name} has stood down: it is no longer surrounded.`, 'info');
        return false;
      }
      const foes = [...enemiesOf(s, c.id)].reduce((t, e) => t + (s.countries[e]?.aircraft ?? 0) * airQuality(s.countries[e] ?? { tech: { air: 4 } }), 0);
      const share = foes / (foes + c.aircraft * airQuality(c) + 1);
      const lost = Math.max(0, Math.round(x.aircraft * 0.02 * (0.3 + share * 1.5)));
      x.aircraft -= lost;
      c.aircraft = Math.max(0, c.aircraft - lost);
      x.lost = (x.lost ?? 0) + lost;
      x.weeks = (x.weeks ?? 0) + 1;
      if (x.weeks === 1 || x.weeks % 4 === 0) briefing(s, c.id, `Airlift to ${a.name}: ${Math.round(airliftCover(s, a) * 100)}% of its needs flown in; ${x.lost} aircraft lost so far.`, 'info', { region: a.region, front: true });
      return x.aircraft > 0;
    });
  }
}

// The army lays down its arms
function surrender(s, a, forced = false) {
  const c = s.countries[a.owner];
  const near = Object.values(s.armies).filter((b) => !b.sea && hostile(s, a, b)).sort((x, y) => dist(x.x, x.y, a.x, a.y) - dist(y.x, y.y, a.x, a.y))[0];
  const taker = near?.owner ?? [...enemiesOf(s, a.owner)][0];
  if (c) c.troops = Math.max(0, c.troops - a.troops);
  news(s, `${nameOf(s, a.owner)}'s ${a.name} surrenders ${forced ? 'in the pocket ' : ''}near ${regionName(a.region)}: about ${troopsLabel(approx(a.troops))} troops go into captivity${taker ? ` with ${nameOf(s, taker)}` : ''}.`, 'war', [a.owner, ...(taker ? [taker] : [])]);
  briefing(s, a.owner, `${a.name} (${a.gen.name}) has surrendered near ${regionName(a.region)}. About ${troopsLabel(approx(a.troops))} of our soldiers are prisoners.`, 'bad', { region: a.region, front: true });
  if (taker) briefing(s, taker, `${nameOf(s, a.owner)}'s ${a.name} has surrendered to us near ${regionName(a.region)}: about ${troopsLabel(approx(a.troops))} prisoners.`, 'good', { region: a.region, front: true });
  record(s, a.owner, a.troops);
  delete s.armies[a.id];
  if (c?.airlifts) c.airlifts = c.airlifts.filter((x) => x.army !== a.id);
}

export function surrenderArmy(s, c, a) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  if (!a.pocket || a.pocketSea) return `${a.name} isn't surrounded. Disband it instead, if you must.`;
  surrender(s, a);
  return null;
}

// Fly supplies in to a surrounded army: aircraft taken from the air force, within range of our bases
export function setAirlift(s, c, a, aircraft) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  aircraft = Math.floor(Number(aircraft) || 0);
  c.airlifts ??= [];
  const was = c.airlifts.find((x) => x.army === a.id);
  c.airlifts = c.airlifts.filter((x) => x.army !== a.id);
  if (aircraft <= 0) return null;
  if (!a.pocket || a.pocketSea) { if (was) c.airlifts.push(was); return `${a.name} isn't surrounded: it doesn't need an airlift.`; }
  const far = rangeProblem(s, c, a.region, 'air');
  if (far) { if (was) c.airlifts.push(was); return far.replace(/bomb|strike/gi, 'reach'); }
  const committed = c.airOps.reduce((t, o) => t + o.aircraft, 0) + c.airlifts.reduce((t, o) => t + o.aircraft, 0);
  if (aircraft + committed > c.aircraft) { if (was) c.airlifts.push(was); return `We have ${Math.max(0, c.aircraft - committed)} aircraft free.`; }
  c.airlifts.push({ army: a.id, aircraft, since: was?.since ?? s.week, lost: was?.lost ?? 0, weeks: was?.weeks ?? 0 });
  a.supply = Math.max(a.supply, POCKET_SUPPLY + 0.55 * airliftCover(s, a));
  if (!was) news(s, `${c.name} begins an airlift to its forces surrounded near ${regionName(a.region)}.`, 'war', [c.id]);
  return null;
}

// The nearest cell our side holds that isn't cut off: where a breakout aims
export function breakoutPlan(s, a) {
  const supply = supplyOf(s, a.owner);
  const start = cellAt(a.x, a.y);
  const seen = new Set([start]);
  const queue = [start];
  for (let qi = 0; qi < queue.length && qi < 40000; qi++) {
    const i = queue[qi];
    for (const j of neighbours4(i)) {
      if (seen.has(j) || !isLand(j)) continue;
      seen.add(j);
      const h = holderAt(s, j);
      if (!h || (!friendlyGround(s, a.owner, h) && !atWar(s, a.owner, h))) continue;
      if (supply.has(j)) return [cellX(j), cellY(j)];
      queue.push(j);
    }
  }
  return null;
}

// Break out of the ring toward our lines: a desperate attack, a quarter harder for three weeks
export function breakOut(s, c, a) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  if (!a.pocket || a.pocketSea) return `${a.name} isn't surrounded.`;
  const goal = breakoutPlan(s, a);
  if (!goal) return 'There is no way back to our lines from here: every road runs through neutral ground.';
  const err = orderArmy(s, c, a, { kind: 'go', x: goal[0], y: goal[1], aggr: 'allout' });
  if (err) return err;
  if (a.op.kind === 'move') a.op = { ...a.op, kind: 'advance', through: true };
  a.breakout = s.week + 3;
  a.org = Math.min(100, a.org + 10);
  a.status = `Breaking out toward our lines near ${regionName(regionAt(cellAt(goal[0], goal[1])))}`;
  news(s, `${nameOf(s, c.id)}'s surrounded ${a.name} tries to break out near ${regionName(a.region)}.`, 'war', [c.id]);
  return null;
}

/* ---------- Armies that keep to the front ---------- */

export function setAssist(s, c, a, on) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  a.assist = Boolean(on);
  a.assistAt = 0;
  if (a.assist) briefing(s, c.id, `${a.name} will support the front: it moves up to the line wherever the front has gone, stands beside any of our (or our allies') armies under attack nearby, and joins our allies' attacks next to it.`, 'info');
  return null;
}

// The nearest stretch of the front: a cell our side holds next to ground held by an enemy, within reach
export function nearestFront(s, owner, x, y, max = 70) {
  const c0 = nearestLand(x, y);
  if (c0 < 0) return null;
  const seen = new Set([c0]);
  const queue = [c0];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const h = holderAt(s, i);
    if (neighbours4(i).some((j) => isLand(j) && atWar(s, owner, holderAt(s, j)))) return [cellX(i), cellY(i)];
    if (qi > max * max * 3) break;
    for (const j of neighbours4(i)) {
      if (seen.has(j) || !isLand(j)) continue;
      const hj = holderAt(s, j);
      if (!hj || !(hj === h || friendlyGround(s, owner, hj))) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return null;
}

// A leader's army told to support the front (and an expeditionary force sent to an ally): where one of our
// side's armies close by is being attacked it goes to stand beside it; where an ally attacks close by it joins in;
// and if the front has moved away from it, it moves up to the line
function keepToFront(s, a, c) {
  // Computer-run countries at war place their armies themselves (ai.js); this is for a leader's army told to help
  if (!a.assist || a.sea || a.auto || a.path.length || a.battle || a.op.kind !== 'hold') return;
  if (a.pocket && !a.pocketSea) return;
  if (a.buildup?.region === a.region) return;
  if (!c.human && (s.week - (a.orderedAt ?? -99)) < 2) return;
  if ((a.assistAt ?? 0) > (s.stepNo ?? 0)) return;
  a.assistAt = (s.stepNo ?? 0) + 4;
  if (!enemiesOf(s, a.owner).size) return;
  let best = null;
  for (const b of Object.values(s.battles ?? {})) {
    const d = s.armies[b.def];
    if (!d || d.id === a.id || b.att.includes(a.id)) continue;
    const far = dist(a.x, a.y, d.x, d.y);
    if (far > CONTACT * 3) continue;
    // One of our side's armies under attack: go and stand beside it
    if (onSameSide(s, a.owner, d.owner) && b.att.some((id) => s.armies[id] && hostile(s, a, s.armies[id]))) {
      if (!best || far < best.far) best = { kind: 'hold', x: d.x, y: d.y, far, why: `reinforcing ${d.owner === a.owner ? 'our' : `${nameOf(s, d.owner)}'s`} ${d.name}` };
    } else if (a.assist && hostile(s, a, d) && b.att.some((id) => s.armies[id] && onSameSide(s, a.owner, s.armies[id].owner))) {
      // An ally's attack on an enemy army: join it
      if (!best || far < best.far) best = { kind: 'attack', enemy: d.id, far, why: `joining the attack on ${nameOf(s, d.owner)}'s ${d.name}` };
    }
  }
  if (!best) {
    // Behind the line: forward to it
    const front = nearestFront(s, a.owner, a.x, a.y);
    if (front && dist(front[0], front[1], a.x, a.y) > CONTACT * 1.5) best = { kind: 'hold', x: front[0], y: front[1], why: 'moving up to the line' };
  }
  if (!best) return;
  const err = best.enemy ? orderArmy(s, c, a, { kind: 'attack', enemy: best.enemy, aggr: a.op.aggr ?? 'balanced' }) : orderArmy(s, c, a, { kind: 'hold', x: best.x, y: best.y, aggr: a.op.aggr ?? 'balanced' });
  if (err) return;
  a.status = `${a.assist || c.human ? 'Supporting the front' : 'Holding the line'}: ${best.why}`;
}

// What each leader sees of the pockets: where they are, who is in them, and their ground as runs of cells
export function pocketsView(s) {
  return Object.values(s.pocketList ?? {}).map((p) => ({ id: p.id, holder: p.holder, sea: p.sea, since: p.since, name: p.name, main: p.main, runs: p.runs }));
}

function ordinal(n) {
  const sfx = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${sfx}`;
}

export { isMinor };
