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
  onSameSide, addRel, nextId, troopsLabel, alive, money, warsAccepted, rel,
} from './core.js';
import { navyStep, navyTick, landingControl, crossingOdds, controlAt, PORTS, OFF_COAST } from './navy.js';
import { shippingStep } from './shipping.js';
import { fallenCities, citiesIn, cityDepths } from './cities.js';
import { fx as doctrineFx, matchup, noteFighting } from './doctrine.js';
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
  const p = s.pockets?.[regionId];
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
  return Math.max(0, reg.pop * 4 * k - (reg.battle?.militiaLost ?? 0));
}
const militiaPower = (s, reg, terrain) => power(militiaOf(s, reg), 0, 0.45, 60, 1, terrain);

/* ---------- Fuel ---------- */

// Oil burned per week, in millions of barrels a day (the market's unit), per thousand troops and per tank.
// Fighting burns the most: tanks, trucks, generators and artillery tractors all running. About 0.3 barrels per
// soldier a day in battle, as in modern campaigns.
export const FUEL = { hold: [0.00005, 0.000001], march: [0.0002, 0.000006], fight: [0.0003, 0.00001] };
export const AIR_FUEL = 0.00003; // per aircraft flying a campaign
export const SHIP_FUEL = { underway: 0.0006, idle: 0.0001 }; // per warship (a carrier counts as eight)
export const armyMode = (a) => (a.attacking || a.landing ? 'fight' : a.path?.length || a.sea ? 'march' : 'hold');
export const armyFuel = (a, mode = armyMode(a)) => a.troops * FUEL[mode][0] + a.tanks * FUEL[mode][1];

// Weeks to march along a path, and the oil it burns (plus a fortnight of fighting if it ends in an attack)
export function orderFuel(s, a, path, attack = false) {
  let km = 0;
  let from = a.region;
  for (const id of path ?? []) { km += moveCost(s, from, id); from = id; }
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

// The nearest province held by a country at war with this army's owner that it can reach over land, or null
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
  if (a.auto) briefing(s, c.id, `${a.gen.name} has orders to keep attacking: ${a.name} will take one enemy province after another until no enemy is left within reach, or it is destroyed.`, 'info');
  return null;
}

// An army on automatic capture with nothing to do picks its next objective
function autoCapture(s, a) {
  if (!a.auto || a.sea) return;
  const busy = a.path.length && (a.op.kind !== 'attack' || atWar(s, a.owner, s.regions[a.op.target]?.ctrl));
  if (busy || (a.autoAt ?? 0) > (s.stepNo ?? 0)) return;
  const next = enemiesOf(s, a.owner).size ? nextConquest(s, a) : null;
  if (!next) {
    a.autoAt = (s.stepNo ?? 0) + 8;
    if (a.op.kind === 'attack' && a.region !== a.op.target) a.op = { kind: 'hold', target: a.region, aggr: a.op.aggr };
    a.status = enemiesOf(s, a.owner).size ? 'Automatic capture: no enemy within reach over land' : 'Automatic capture: no enemies left';
    return;
  }
  const path = route(s, a.owner, a.region, next, { offensive: true, maneuver: a.gen.trait === 'maneuver' });
  if (!path) { a.autoAt = (s.stepNo ?? 0) + 8; return; }
  a.op = { kind: 'attack', target: next, aggr: a.op.aggr ?? 'balanced' };
  a.path = path;
  a.status = `Automatic capture: advancing on ${regionName(next)}`;
}

// Works out an order without carrying it out: { error } or the new operation
// (`through` is set internally when the way to a friendly province leads through enemy ground)
function planOrder(s, c, army, { kind, target, aggr = 'balanced', through = false }) {
  if (!army || army.owner !== c.id) return { error: 'That army is not yours.' };
  if (!s.regions[target]) return { error: 'Pick a province on the map.' };
  if (!AGGRESSION[aggr]) aggr = 'balanced';
  if (army.sea) return { error: `${army.name} is at sea and can't take new orders until it lands.` };
  const maneuver = army.gen.trait === 'maneuver';
  if (kind === 'hold') {
    const path = route(s, c.id, army.region, target, { offensive: false, maneuver });
    if (!path) return { error: noRouteReason(s, c.id, army.region, target) };
    return { op: { kind, target, aggr }, path, status: path.length ? `Moving to hold ${regionName(target)}` : `Holding ${regionName(target)}` };
  }
  if (kind === 'go') {
    // Wherever the leader points: march through friendly ground if we can, fight through if we must,
    // and go by sea when there is no way over land
    const holder = s.regions[target].ctrl;
    if (friendlyGround(s, c.id, holder)) {
      const walk = planOrder(s, c, army, { kind: 'hold', target, aggr });
      if (!walk.error) return walk;
      const fight = planOrder(s, c, army, { kind: 'attack', target, aggr, through: true });
      return fight.error ? walk : { ...fight, status: `Fighting through to ${regionName(target)}` };
    }
    if (!atWar(s, c.id, holder)) return { error: `You are not at war with ${nameOf(s, holder)}. Declare war first.` };
    const land = planOrder(s, c, army, { kind: 'attack', target, aggr });
    if (!land.error) return land;
    const sea = planOrder(s, c, army, { kind: 'invade', target, aggr });
    return sea.error ? land : sea;
  }
  if (kind === 'attack' || kind === 'invade') {
    const holder = s.regions[target].ctrl;
    if (!atWar(s, c.id, holder) && !(through && friendlyGround(s, c.id, holder))) return { error: `You are not at war with ${nameOf(s, holder)}. Declare war first.` };
  }
  if (kind === 'attack') {
    const path = route(s, c.id, army.region, target, { offensive: true, maneuver });
    if (!path) return { error: noRouteReason(s, c.id, army.region, target) };
    return { op: { kind, target, aggr }, path, status: `Advancing on ${regionName(target)}` };
  }
  if (kind === 'invade') {
    const prepared = landingReady(s, army);
    const problem = landingProblem(s, c, army.region, target, prepared && Boolean(landingControl(s, c.id, target)));
    if (problem) return { error: problem };
    const km = distanceKm(army.region, target);
    return { op: { kind, target, aggr }, path: [], sea: { from: army.region, to: target, left: Math.ceil(km / 1500) + 1, prepared }, status: `At sea, bound for ${regionName(target)}` };
  }
  return { error: 'Unknown order.' };
}

// Checks an attack as if war were already declared, so a leader can declare war and attack in one step
export function checkOrder(s, c, army, order) {
  const holder = s.regions[order.target]?.ctrl;
  const peaceful = order.kind === 'hold' || holder === c.id || (order.kind === 'go' && friendlyGround(s, c.id, holder));
  const world = holder && !peaceful ? hypotheticalWar(s, c.id, holder) : s;
  return planOrder(world, c, army, order).error ?? null;
}

export function orderArmy(s, c, army, order) {
  const plan = planOrder(s, c, army, order);
  if (plan.error) return plan.error;
  army.op = plan.op;
  army.path = plan.path;
  // A fresh order: the army sets off on the very next step
  army.mv = Math.max(army.mv ?? 0, 1.2);
  if (plan.sea) {
    army.sea = plan.sea;
    // The build-up is spent on this crossing
    if (plan.sea.prepared) { army.prepared = true; army.buildup = null; }
  }
  army.status = plan.status;
  return null;
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
// so an order is carried out within a second and fronts move smoothly. Supply, logistics, recovery and the air
// and sea campaigns are settled once a week (militaryTick).

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

// The cost of marching from one province into the next, in km of open road: the distance between them, made
// longer by rough terrain and shorter by good infrastructure
const moveCost = (s, from, to) => distanceKm(from, to) * terrainOf(to).move * (1 - 0.04 * (s.regions[to].infra ?? 0));

export function militaryStep(s, dt) {
  if (!(dt > 0)) return;
  s.stepNo = (s.stepNo ?? 0) + 1;
  const gar = garrisons(s);
  const fights = new Map(); // region -> attacking armies
  for (const a of Object.values(s.armies)) {
    const c = s.countries[a.owner];
    if (!c || !alive(s, a.owner)) { delete s.armies[a.id]; continue; }
    a.attacking = null;
    if (a.sea) sail(s, a, c, dt, fights);
    else march(s, a, c, dt, gar, fights);
  }
  navyStep(s, dt);
  shippingStep(s);
  const battled = new Set();
  for (const [regionId, attackers] of fights) {
    battle(s, regionId, attackers, gar, dt);
    battled.add(regionId);
  }
  // Provinces changed hands: who is cut off now
  if (s.frontMoved && (s.stepNo ?? 0) % 3 === 0) { s.frontMoved = false; updatePockets(s); }
  // Where the fighting has stopped, the attackers' gains melt away
  for (const reg of Object.values(s.regions)) {
    if (reg.battle && !battled.has(reg.id) && reg.battle.pushed !== s.stepNo) {
      reg.battle.prog -= 40 * dt;
      if (reg.battle.prog <= 0) reg.battle = null;
    }
  }
}

function sail(s, a, c, dt, fights) {
  a.sea.left -= dt;
  // Enemy fleets in the waters off the landing pick off the transports; our fleets there shield them
  const { mine, theirs } = crossingOdds(s, c.id, a.sea.to);
  if (theirs > 0 && a.sea.left > 0) {
    const lost = 0.06 * dt * theirs / (theirs + mine + 1);
    a.troops *= 1 - lost;
    a.tanks *= 1 - lost;
  }
  if (a.sea.left > 0) return;
  if (a.landing && (a.org < 12 || a.troops < 3)) {
    // The landing has failed: what is left re-embarks for home
    a.region = a.sea.from;
    a.sea = null;
    a.landing = false;
    a.prepared = false;
    a.op = { kind: 'hold', target: a.region, aggr: a.op.aggr };
    a.status = 'Withdrawn after a failed landing';
    alert(s, a.owner, `${a.gen.name} reports: the landing has been thrown back. ${a.name} has re-embarked for ${regionName(a.region)}.`, 'bad');
    news(s, `${nameOf(s, a.owner)}'s landing is thrown back into the sea.`, 'war', [a.owner]);
    return;
  }
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

function march(s, a, c, dt, gar, fights) {
  const maneuver = a.gen.trait === 'maneuver';
  autoCapture(s, a);
  keepToFront(s, a, c);
  // An army knocked off its route (pushed back, or the map changed) finds a new way to its objective
  if (a.op.kind === 'attack' && !a.path.length && a.region !== a.op.target) {
    a.path = route(s, a.owner, a.region, a.op.target, { offensive: true, maneuver }) ?? [];
  }
  // Movement saved up never runs past what the next province costs, so a waiting army doesn't then leap ahead
  a.mv = a.path.length ? Math.min(Math.max(100, moveCost(s, a.region, a.path[0])), (a.mv ?? 0) + marchSpeed(s, a) * dt) : 0;
  while (a.path.length) {
    const next = a.path[0];
    const holder = s.regions[next].ctrl;
    if (friendlyGround(s, a.owner, holder)) {
      const cost = moveCost(s, a.region, next);
      if (a.mv < cost) { a.status = `On the march to ${regionName(a.op.target)}`; break; }
      a.region = next;
      a.path.shift();
      a.mv -= cost;
      continue;
    }
    if (atWar(s, a.owner, holder) && a.op.kind === 'attack') {
      // A leader's order is carried out at once. Only computer-run generals pause to regroup or wait for odds.
      if (!c.human) {
        const odds = armyAttackEstimate(s, a, next) / Math.max(1, defenceEstimate(s, next, gar));
        if (a.org < 20) { a.status = `Regrouping before ${regionName(next)} (organisation ${Math.round(a.org)}%)`; a.regrouping = true; break; }
        if (a.regrouping && a.org < 45) { a.status = `Regrouping before ${regionName(next)} (organisation ${Math.round(a.org)}%)`; break; }
        a.regrouping = false;
        if (odds < AGGRESSION[a.op.aggr].attackAt) { a.status = `Waiting for better odds at ${regionName(next)} (${odds.toFixed(1)}:1)`; break; }
      }
      a.regrouping = false;
      a.mv = 0;
      a.attacking = next;
      // An attack launched after two weeks or more of preparation in place is a set-piece battle
      if (!a.assault || a.assault.target !== next) a.assault = { target: next, since: s.week, prepared: a.stillSince != null && s.week - a.stillSince >= 2 };
      addFight(fights, next, a);
      a.status = `Attacking ${regionName(next)}`;
      break;
    }
    // Neutral ground or the target changed hands: look for another way
    const again = route(s, a.owner, a.region, a.op.target, { offensive: a.op.kind === 'attack', maneuver });
    if (again && again[0] !== next) { a.path = again; continue; }
    a.path = [];
    a.status = `Halted: ${nameOf(s, holder)} blocks the way`;
    alert(s, a.owner, `${a.name} has halted: the route to ${regionName(a.op.target)} crosses ${nameOf(s, holder)}, which we are not at war with.`, 'warn');
    break;
  }
  if (a.path.length || a.attacking) a.stillSince = null;
  else a.stillSince ??= s.week;
  if (!a.attacking) a.assault = null;
  if (!a.path.length && !a.attacking) {
    if (a.op.kind === 'attack' && a.region === a.op.target) {
      a.op = { kind: 'hold', target: a.region, aggr: a.op.aggr };
      alert(s, a.owner, `${a.gen.name} reports: ${a.name} has taken its objective, ${regionName(a.region)}, and is digging in.`, 'good');
    }
    if (a.op.kind === 'hold' || a.region === a.op.target) a.status = `Holding ${regionName(a.region)}`;
  }
}

// Once a week: supply, the cost of the war, recovery, and the air and sea campaigns
export function militaryTick(s) {
  navyTick(s);
  updatePockets(s);
  supplyAll(s);
  logistics(s);
  for (const a of Object.values(s.armies)) {
    const c = s.countries[a.owner];
    if (!c || !alive(s, a.owner)) { delete s.armies[a.id]; continue; }
    if (a.sea) continue;
    const recover = (a.gen.trait === 'logistician' ? 12 : 8) * (1 + (dfx(s, c.id).orgRecover ?? 0));
    a.org = Math.min(100 * (c.readiness ?? 1), a.org + recover * a.supply * (a.attacking ? 0.4 : 1) * (commsReady(s, c.id) ? 1.25 : 1));
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
  pocketTick(s);
  airAndSea(s);
}

function addFight(fights, regionId, army) {
  (fights.get(regionId) ?? fights.set(regionId, []).get(regionId)).push(army);
}

function battle(s, regionId, attackers, gar, dt = 1) {
  const reg = s.regions[regionId];
  const holder = reg.ctrl;
  const terrain = terrainOf(regionId);
  attackers = attackers.filter((a) => atWar(s, a.owner, holder));
  if (!attackers.length) return;
  const lead = attackers.reduce((m, a) => (a.troops > m.troops ? a : m)).owner;
  const fa = dfx(s, lead);
  const fh = dfx(s, holder);

  // Air superiority over the battlefield: aircraft for both sides, plus the defender's air defences
  const airOf = (id) => {
    const c = s.countries[id];
    if (!c) return 0;
    const busy = Math.max(1, enemiesOf(s, id).size);
    return c.aircraft * airQuality(c) * 0.6 / busy * (1 + (dfx(s, id).airEdge ?? 0));
  };
  const airA = airOf(lead);
  const hd = s.countries[holder];
  const airD = airOf(holder) + (hd ? hd.tech.missile * 25 : 30 + (s.minors[holder]?.troops ?? 0) * 0.05);
  const airEdge = (airA - airD) / (airA + airD + 1);

  let attack = 0;
  let attackTroops = 0;
  for (const a of attackers) {
    let p = armyAttackEstimate(s, a, regionId) * (1 + 0.05 * gpsCoverage(s, a.owner)) * (knowsPlans(s, a.owner, holder) ? 1.08 : 1);
    if (a.landing) p *= a.prepared ? 0.75 : 0.5;
    // A prepared, set-piece attack; a desperate breakout from a pocket
    if (a.assault?.prepared) p *= 1 + (dfx(s, a.owner).setPiece ?? 0);
    if ((a.breakout ?? -1) > s.week) p *= 1.25;
    attack += p;
    attackTroops += a.troops;
  }
  attack *= 1 + 0.3 * airEdge;
  // How our way of attacking fares against their way of defending
  attack *= 1 + matchup(s, lead, holder);
  if (reg.cas && reg.cas.until > s.week && onSameSide(s, reg.cas.side, lead)) attack *= 1 + 0.25 * Math.min(1, reg.cas.power) * (1 + (dfx(s, reg.cas.side).cas ?? 0));

  // Pincers: armies closing in on a province from two sides at once (the arrows converge). The defenders can't
  // face both ways, and armoured spearheads make the most of it.
  const pincer = pincerOf(attackers, regionId);
  const bt = Math.max(0, Math.max(...attackers.map((a) => breakthroughOf(s, a))) - (fh.vsBreakthrough ?? 0) * 0.5);
  if (pincer) attack *= 1.15 + (fa.pincer ?? 0) * 0.6 + bt * 0.1;

  const g = gar.get(regionId) ?? { troops: 0, tanks: 0 };
  const gs = garrisonState(s, regionId);
  const defenders = Object.values(s.armies).filter((a) => a.region === regionId && !a.sea && onSameSide(s, a.owner, holder));
  let defence = power(g.troops, g.tanks, quality(s, holder), gs.org, gs.supply, terrain);
  let defendTroops = g.troops;
  // The home guard of a people defending its own land
  const militia = militiaOf(s, reg);
  defence += power(militia, 0, 0.45, 60, 1, terrain);
  defendTroops += militia;
  for (const a of defenders) {
    defence += power(a.troops, runningTanks(s, a) * (1 + (dfx(s, a.owner).armorDefend ?? 0)), quality(s, a.owner), a.org, a.supply, terrain) * genBonus(a.gen, 'defend') * (a.op.kind === 'hold' ? 1.1 : 1);
    defendTroops += a.troops;
  }
  defence *= defendMul(s, holder, terrain, reg.fort) * (1 - 0.2 * airEdge) * (knowsPlans(s, holder, lead) ? 1.08 : 1);
  // Whoever has far more men gets the edge of mass (more so for a broad-front doctrine)
  attack *= 1 + (massBonus(attackTroops, defendTroops) - 1) * (1 + (fa.mass ?? 0));
  defence *= 1 + (massBonus(defendTroops, attackTroops) - 1) * (1 + (fh.mass ?? 0));
  // Armour that has broken through bypasses strongpoints the garrison alone can't plug
  if (bt > 0.3 && !defenders.length) defence *= 1 - 0.25 * Math.min(1, bt);
  // Street fighting: a big city in the front's path holds the attack up
  const street = streetFight(reg, regionId);
  if (street) defence *= 1.12 + 0.12 * (fh.urban ?? 0);
  defence = Math.max(defence, 0.5);

  const fresh = !(reg.battle && reg.battle.by === lead);
  reg.battle = fresh ? { by: lead, prog: 0, weeks: 0, from: attackers[0].landing ? null : attackers[0].region } : reg.battle;
  reg.battle.weeks = (reg.battle.weeks ?? 0) + dt;
  const sides = [...new Set(attackers.map((a) => a.owner))];
  if (fresh) {
    news(s, `${nameOf(s, lead)}'s forces attack ${regionName(regionId)}, held by ${nameOf(s, holder)}.`, 'war', [...sides, holder]);
    alert(s, holder, `${nameOf(s, lead)} is attacking ${regionName(regionId)} with about ${troopsLabel(approx(attackTroops))} troops.`, 'war', { region: regionId });
  }
  if (pincer && !reg.battle.pincer) {
    reg.battle.pincer = true;
    news(s, `Pincer movement: ${nameOf(s, lead)}'s armies close in on ${regionName(regionId)} from two sides.`, 'war', [...sides, holder]);
    for (const side of sides) briefing(s, side, `Our armies are attacking ${regionName(regionId)} from two sides at once: a pincer. The defenders can't face both ways.`, 'good', { region: regionId, front: true });
    briefing(s, holder, `${nameOf(s, lead)} is closing in on ${regionName(regionId)} from two sides. If the pincers meet behind it, our troops there could be cut off.`, 'bad', { region: regionId, front: true });
  }
  if (street && reg.battle.street !== street.name) {
    reg.battle.street = street.name;
    if (street.share >= 0.08 || street.capital) news(s, `Street fighting in ${street.name}: ${nameOf(s, holder)}'s defenders fight for every block.`, 'war', [lead, holder]);
  } else if (!street) reg.battle.street = null;
  reg.battle.militia = Math.round(militia);
  reg.battle.bt = Math.round(bt * 100) / 100;
  // Ground the defenders thought impassable: lightly held, and the attack comes as a shock
  const sneak = surpriseFeature(regionId);
  if (sneak && reg.fort <= 1 && !defenders.some((a) => a.op.kind === 'hold') && reg.battle.weeks <= 3) {
    defence *= clamp(0.55 - 0.3 * (fa.surprise ?? 0), 0.3, 0.8);
    if (fresh) {
      news(s, `${nameOf(s, lead)}'s forces strike through ${sneak.name}, ground ${nameOf(s, holder)} thought impassable. Its defenders are caught off guard.`, 'war', [lead, holder]);
      alert(s, lead, `Surprise: our attack through ${sneak.name} has caught ${nameOf(s, holder)} off guard.`, 'good', { region: regionId });
    }
  }
  const ratio = attack / defence;
  reportBattle(s, reg, regionId, { attackers, sides, lead, holder, ratio, attackTroops, defendTroops, defenders, militia, street, pincer });
  // A winning attack moves as fast as the attackers can: mechanised, well-supplied armies break through in days,
  // low-tech infantry grinds forward
  const main = attackers.reduce((m, a) => (a.troops > m.troops ? a : m));
  const tempo = clamp(marchSpeed(s, main) / 700, 0.5, 1.4) * (1 + (fa.tempo ?? 0)) * (ratio >= 1.3 ? 1 + 0.8 * Math.min(1, bt) : 1);
  // Percent of the province taken a week: an even fight takes about a month, a 3:1 attack about a week, and big
  // provinces (up to three times the usual size) take longer; street fighting in a big city slows it to a crawl
  const step = (ratio >= 1 ? Math.min(95, 25 + 35 * (ratio - 1)) * tempo * (street ? 0.55 / (1 + (fh.urban ?? 0)) : 1) : ratio >= 0.8 ? 10 * (ratio - 0.8) / 0.2 : -40 * (0.8 - ratio) / 0.8) / size(regionId);
  reg.battle.prog = clamp(reg.battle.prog + step * dt, 0, 100);
  // Beaten back with nothing gained, the defenders counter-attack into the ground the attack came from
  if (ratio < 0.8 && reg.battle.prog <= 0 && reg.battle.from) counterAttack(s, reg.battle.from, holder, regionId, defence / defendMul(s, holder, terrain, reg.fort), gar, dt);

  // Losses
  let attackLoss = 0;
  for (const a of attackers) {
    const style = AGGRESSION[a.op.aggr].losses * (a.gen.trait === 'aggressive' ? 1.2 : a.gen.trait === 'cautious' ? 0.75 : 1) * Math.max(0.5, 1 + (dfx(s, a.owner).attackLoss ?? 0));
    const rate = 0.016 * dt * clamp(1 / ratio, 0.35, 2.5) * style * (a.landing ? (a.prepared ? 1.4 : 1.8) : 1);
    const lost = a.troops * rate;
    a.troops -= lost;
    a.tanks *= 1 - rate * 1.4;
    a.org = Math.max(0, a.org - (a.op.aggr === 'allout' ? 8 : 6) * dt);
    attackLoss += lost;
  }
  const defRate = 0.016 * dt * clamp(ratio, 0.35, 2.5) * Math.max(0.5, 1 + (fh.defendLoss ?? 0)) * (pincer ? 1.25 : 1);
  let defendLoss = 0;
  for (const a of defenders) {
    const lost = a.troops * defRate * (a.gen.trait === 'defensive' ? 0.85 : 1) * Math.max(0.5, 1 + (dfx(s, a.owner).defendLoss ?? 0));
    a.troops -= lost;
    a.tanks *= 1 - defRate * 1.3;
    a.org = Math.max(0, a.org - (pincer ? 9 : 6) * dt);
    defendLoss += lost;
  }
  const gLost = g.troops * defRate;
  const hn = nation(s, holder);
  if (hn) {
    hn.troops = Math.max(0, hn.troops - gLost);
    hn.tanks = Math.max(0, hn.tanks - g.tanks * defRate * 1.3);
  }
  defendLoss += gLost;
  // The home guard is used up as it fights
  if (militia > 0) { const mLost = militia * defRate * 1.6; reg.battle.militiaLost = (reg.battle.militiaLost ?? 0) + mLost; defendLoss += mLost; }
  for (const a of attackers) {
    const n = s.countries[a.owner];
    n.troops = Math.max(0, n.troops - attackLoss * (a.troops / Math.max(1, attackTroops)));
  }
  record(s, lead, attackLoss);
  record(s, holder, defendLoss);
  // Every week of fighting teaches each side's doctrine something
  for (const side of sides) noteFighting(s.countries[side], 'attack', dt / sides.length, ratio >= 1);
  noteFighting(s.countries[holder], 'defend', dt, ratio < 1);
  if (reg.cas && reg.cas.until > s.week) noteFighting(s.countries[reg.cas.side], 'air', dt * 0.5, true);
  // The dead are gone from the population, and civilians in the battle zone die or flee
  for (const a of attackers) bury(s, a.owner, attackLoss * (a.troops / Math.max(1, attackTroops)));
  bury(s, holder, defendLoss);
  reg.pop *= 1 - 0.0008 * dt * Math.min(2, ratio) * (street ? 1.6 : 1);
  const war = s.wars.find((w) => (w.a === lead && w.b === holder) || (w.b === lead && w.a === holder));
  if (war) {
    if (war.a === lead) { war.lossA += attackLoss; war.lossB += defendLoss; } else { war.lossB += attackLoss; war.lossA += defendLoss; }
  }
  reg.dmg = Math.min(0.9, reg.dmg + 0.006 * dt * (street ? 1.8 : 1));

  // Cities fall one by one as the front passes them
  if (reg.battle.prog < 100) {
    const fallen = fallenCities(s, reg);
    reg.battle.fallen ??= [];
    reg.battle.fallenShare = fallen.share;
    for (const city of fallen.cities ?? []) {
      if (reg.battle.fallen.includes(city.name)) continue;
      reg.battle.fallen.push(city.name);
      if (city.share < 0.04 && !city.capital) continue;
      const pct = Math.round(city.share * 100);
      news(s, `${city.name} falls to ${nameOf(s, lead)}${city.capital ? `: ${nameOf(s, holder)}'s capital is lost` : ''}.`, 'war', [lead, holder]);
      briefing(s, holder, `${city.name} has fallen to ${nameOf(s, lead)}. We have lost its factories and workers (about ${pct}% of ${regionName(regionId)}'s output).`, 'bad', { region: regionId, front: true });
      briefing(s, lead, `Our troops have taken ${city.name} (about ${pct}% of ${regionName(regionId)}'s output).`, 'good', { region: regionId, front: true });
    }
  }
  if (reg.battle.prog >= 100) capture(s, regionId, lead, attackers, bt);
  for (const a of Object.values(s.armies)) if (a.troops < 1) destroyArmy(s, a, 'was destroyed in battle');
}

// Do the attacks on a province come from two sides? Two attacking armies whose lines of approach are at least
// 70 degrees apart are a pincer.
function pincerOf(attackers, regionId) {
  const to = GEO[regionId];
  const dirs = [];
  for (const a of attackers) {
    if (a.landing || !GEO[a.region] || a.region === regionId) continue;
    const g = GEO[a.region];
    const dx = to.x - g.x;
    const dy = to.y - g.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) dirs.push([dx / len, dy / len]);
  }
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    if (dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] <= Math.cos((70 * Math.PI) / 180)) return true;
  }
  return false;
}

// A big city just ahead of the front (within the next tenth of the province), still holding out: the attack has to
// take it street by street
function streetFight(reg, regionId) {
  const b = reg.battle;
  if (!b?.from || !GEO[b.from]) return null;
  const cities = citiesIn(regionId, reg.pop);
  if (!cities.length) return null;
  const depth = cityDepths(regionId, GEO[b.from], cities);
  const p = (b.prog ?? 0) / 100;
  let best = null;
  cities.forEach((c, i) => {
    if (c.share < 0.05 && !c.capital) return;
    if (depth[i] <= p || depth[i] > p + 0.1) return;
    if (!best || c.share > best.share) best = c;
  });
  return best;
}

// How an attack is going, on each attacking army's card, and in the news whenever it turns: advancing,
// stalled, or thrown back (when the defenders start pushing into the ground the attack came from)
function reportBattle(s, reg, regionId, { attackers, sides, lead, holder, ratio, attackTroops, defendTroops, defenders, militia = 0, street = null, pincer = false }) {
  const trend = ratio >= 1 ? 'advancing' : ratio < 0.8 ? 'repulsed' : 'stalled';
  const odds = `${ratio.toFixed(2)}:1`;
  const where = regionName(regionId);
  const parts = [...defenders.map((a) => `${nameOf(s, a.owner)}'s ${a.name} (~${troopsLabel(approx(a.troops))})`), militia >= 1 ? `~${troopsLabel(approx(militia))} home guard` : null].filter(Boolean);
  const theirs = `about ${troopsLabel(approx(defendTroops))} defenders${parts.length ? `, including ${parts.join(', ')}` : ''}`;
  const how = [pincer ? 'pincer' : null, street ? `street fighting in ${street.name}` : null].filter(Boolean).join(', ');
  for (const a of attackers) {
    a.status = trend === 'advancing' ? `Attacking ${where}: winning (${odds}${how ? `; ${how}` : ''})`
      : trend === 'stalled' ? `Attacking ${where}: held up (${odds} against ${theirs}${street ? `; street fighting in ${street.name}` : ''})`
        : `Thrown back at ${where} (${odds} against ${theirs})`;
  }
  const was = reg.battle.trend;
  reg.battle.trend = trend;
  if (trend === 'advancing' || trend === was) return;
  // At most one report a fortnight for each battle, so a fight on the edge doesn't flood the news
  if ((reg.battle.told ?? -99) > s.week - 2 && !(trend === 'repulsed' && was === 'stalled')) return;
  reg.battle.told = s.week;
  if (trend === 'stalled') {
    news(s, `${nameOf(s, lead)}'s attack on ${where} has stalled against ${nameOf(s, holder)}'s defences.`, 'war', [...sides, holder]);
    for (const side of sides) alert(s, side, `Our attack on ${where} has stalled: ${troopsLabel(approx(attackTroops))} troops against ${theirs}. The odds are ${odds}; at 1:1 or better we advance. Send more armies to attack it together, or call in the air force.`, 'warn', { region: regionId });
  } else {
    news(s, `${nameOf(s, holder)} throws back ${nameOf(s, lead)}'s attack on ${where}.`, 'war', [...sides, holder]);
    for (const side of sides) alert(s, side, `Our attack on ${where} is being thrown back: ${troopsLabel(approx(attackTroops))} troops against ${theirs}. The odds are only ${odds}, and the defenders will push into the ground we attacked from. Reinforce, send more armies to attack together, or pull back.`, 'bad', { region: regionId });
    alert(s, holder, `Our defenders in ${where} are throwing back ${nameOf(s, lead)}'s attack.`, 'good', { region: regionId });
  }
}

// The defenders of `from` push into `back`, the province an attack on them came from. Held long enough, it
// falls: the front line moves the other way.
// `strength` is what held the attack off; it has to beat whatever guards the ground behind the attackers.
function counterAttack(s, backId, by, from, strength, gar, dt = 1) {
  const back = s.regions[backId];
  if (!back || !atWar(s, by, back.ctrl)) return;
  // An elastic or mobile defence is built to strike back
  const odds = (strength * 0.6 * (1 + (dfx(s, by).counter ?? 0))) / Math.max(1, defenceEstimate(s, backId, gar));
  if (odds < 1) return;
  const push = (Math.min(60, 15 + 30 * (odds - 1)) / size(backId)) * dt;
  if (!(back.battle && back.battle.by === by)) {
    back.battle = { by, prog: 0, weeks: 0, from };
    news(s, `${nameOf(s, by)} counter-attacks into ${regionName(backId)}.`, 'war', [by, back.ctrl]);
    alert(s, back.ctrl, `${nameOf(s, by)} is counter-attacking into ${regionName(backId)}, the ground our failed attack on ${regionName(from)} came from.`, 'bad', { region: backId });
  }
  back.battle.prog = clamp(back.battle.prog + push, 0, 100);
  back.battle.weeks += dt;
  back.battle.pushed = s.stepNo;
  if (back.battle.prog >= 100) capture(s, backId, by, []);
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

export function capture(s, regionId, by, attackers = [], bt = 0) {
  const reg = s.regions[regionId];
  const prev = reg.ctrl;
  reg.ctrl = by;
  reg.battle = null;
  s.frontMoved = true;
  reg.dmg = Math.min(0.9, reg.dmg + 0.05);
  if (by === reg.owner) {
    reg.unrest = 0;
  } else {
    reg.unrest = 45;
    // Retreating defenders wreck oil wells and mines (as at Maykop in 1942)
    if ((reg.res.oil || reg.res.gas) && chance(s, 0.6)) reg.dmg = Math.min(0.9, reg.dmg + 0.2);
  }
  // Defending armies fall back to the new line, or surrender if surrounded. They fall back toward home (never
  // into a dead end the enemy can cut off), onto our own ground, and where the line needs them most.
  const homes = new Map();
  for (const a of Object.values(s.armies)) {
    if (a.region !== regionId || a.sea || a.owner === by || onSameSide(s, a.owner, by)) continue;
    const exits = GEO[regionId].adj.filter((id) => friendlyGround(s, a.owner, s.regions[id].ctrl));
    if (!exits.length) {
      destroyArmy(s, a, `was encircled in ${regionName(regionId)} and surrendered`);
      continue;
    }
    const home = homes.get(a.owner) ?? homes.set(a.owner, homeDistance(s, a.owner)).get(a.owner);
    const score = (id) => {
      const reg = s.regions[id];
      const b = reg.battle && atWar(s, reg.battle.by, a.owner);
      return (home.has(id) ? 20 - Math.min(10, home.get(id)) : 0) + (reg.ctrl === a.owner ? 4 : 0) + (b ? 3 + reg.battle.prog / 25 : 0);
    };
    const best = exits.reduce((m, id) => (score(id) > score(m) ? id : m), exits[0]);
    a.region = best;
    a.troops *= 0.9;
    a.tanks *= 0.85;
    a.org = Math.max(0, a.org / 2);
    a.path = [];
    if (a.op.kind === 'hold') a.op = { kind: 'hold', target: best, aggr: a.op.aggr };
    a.assistAt = 0;
    a.status = `Fell back to ${regionName(best)}`;
  }
  // The attackers move in
  for (const a of attackers) {
    if (!s.armies[a.id]) continue;
    if (a.landing) {
      a.region = regionId;
      a.sea = null;
      a.landing = false;
      a.prepared = false;
    } else if (a.path[0] === regionId) {
      a.region = regionId;
      a.path.shift();
    }
    if (a.attacking === regionId) a.attacking = null;
    // Armour that has broken through keeps rolling: it carries its momentum into the next province
    if (bt >= 0.3 && a.path.length) a.mv = (a.mv ?? 0) + 260 * Math.min(1, bt);
    a.status = a.path.length ? `Advancing on ${regionName(a.op.target)}` : `Holding ${regionName(a.region)}`;
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
  const hopsCache = new Map();
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
      const fighting = Boolean(a.attacking) || Boolean(reg.battle);
      let hops = 0;
      if (abroad && !a.sea) {
        const map = hopsCache.get(c.id) ?? hopsCache.set(c.id, homeDistance(s, c.id)).get(c.id);
        hops = map.get(a.region) ?? 8;
      }
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

function supplyAll(s) {
  const cache = new Map();
  for (const a of Object.values(s.armies)) {
    if (a.sea) { a.supply = 0.8; continue; }
    const c = s.countries[a.owner];
    const reg = s.regions[a.region];
    let supply;
    const d = dfx(s, a.owner);
    if (reg.owner === a.owner || (reg.ctrl !== a.owner && friendlyGround(s, a.owner, reg.ctrl))) supply = 1;
    else {
      const hops = (cache.get(a.owner) ?? cache.set(a.owner, homeDistance(s, a.owner)).get(a.owner)).get(a.region);
      if (hops == null) supply = GEO[a.region].coast && c.ships > 5 ? 0.6 : 0.25;
      else supply = clamp(1.05 - 0.1 * hops * Math.max(0.3, 1 - (d.reach ?? 0)), 0.35, 1);
      // Living off the land: never as short in enemy country
      if (d.forage) supply = Math.max(supply, 0.45 + d.forage);
    }
    // Cut off: whatever the army carried, and whatever is flown in
    const pocket = s.pockets?.[a.region];
    a.pocket = pocket && onSameSide(s, a.owner, pocket.holder) ? pocket.id : null;
    a.pocketSea = Boolean(a.pocket && pocket.sea);
    if (a.pocket) supply = Math.min(supply, pocket.sea ? 0.65 : POCKET_SUPPLY + 0.55 * airliftCover(s, a));
    // Partisans: a hostile people ambushes convoys and blows up rail lines, all the more under a people's war
    if (reg.people !== a.owner && reg.ctrl === a.owner && (reg.loyalty ?? 50) < 30) supply *= Math.max(0.4, 0.75 - 0.15 * (dfx(s, reg.people).partisans ?? 0) + 0.25 * (reg.loyalty / 30));
    // Bombed roads and depots
    if (reg.interdict && reg.interdict.until > s.week && atWar(s, reg.interdict.by, a.owner)) supply *= 1 - 0.4 * Math.min(1, reg.interdict.power);
    if (a.gen.trait === 'logistician') supply = Math.min(1, supply + 0.15);
    a.supply = supply * (1 - 0.6 * fuelCut(c));
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
// Every province a country holds draws its supply over its own (or friendly) ground from the capital and the
// heartland. When an advance cuts the last friendly path between a stretch of front and the heartland, that whole
// stretch is a pocket: the armies and garrisons inside keep fighting on what they carry, losing organisation,
// fuel and men every week, until they break out, are relieved from outside, are kept alive by an airlift (as at
// Stalingrad, for a while), or surrender. A pocket on the coast that the enemy doesn't hold the sea around is
// supplied by ship instead, as Odessa and Sevastopol were.

const CAPITAL_OF = new Map(PROVINCES.filter((p) => p.capital).map((p) => [p.country, p.id]));
const capitalOf = (id) => CAPITAL_OF.get(id) ?? id;
export const POCKET_WEEKS_TO_COLLAPSE = 3;

// Recomputes every pocket in the world: s.pockets maps each cut-off province to { id, holder, sea, since, name }
export function updatePockets(s) {
  const before = s.pockets ?? {};
  const out = {};
  const list = {};
  const holders = new Set();
  for (const reg of Object.values(s.regions)) if (enemiesOf(s, reg.ctrl).size) holders.add(reg.ctrl);
  for (const h of holders) {
    const seen = new Set();
    const comps = [];
    for (const reg of Object.values(s.regions)) {
      if (reg.ctrl !== h || seen.has(reg.id)) continue;
      // One stretch of ground our forces can move through: our own provinces, allies', and land we have access to
      const ids = [];
      let capital = false;
      let enemyNear = false;
      let home = 0;
      const queue = [reg.id];
      seen.add(reg.id);
      while (queue.length) {
        const id = queue.pop();
        ids.push(id);
        const r = s.regions[id];
        if (r.ctrl === r.owner && capitalOf(r.ctrl) === id && (r.ctrl === h || allied(s, h, r.ctrl))) capital = true;
        if (r.ctrl === h && r.owner === h) home++;
        for (const next of GEO[id].adj) {
          const n = s.regions[next];
          if (!n) continue;
          if (atWar(s, h, n.ctrl)) { enemyNear = true; continue; }
          if (seen.has(next) || !friendlyGround(s, h, n.ctrl)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      comps.push({ ids, capital, enemyNear, home });
    }
    // With the capital lost, the biggest stretch of home soil left is the heartland
    if (!comps.some((x) => x.capital)) {
      const heart = comps.filter((x) => x.home > 0).sort((a, b) => b.home - a.home)[0];
      if (heart) heart.capital = true;
    }
    for (const comp of comps) {
      // Supplied: the heartland, and anywhere the war hasn't reached
      if (comp.capital || !comp.enemyNear) continue;
      const own = comp.ids.filter((id) => s.regions[id].ctrl === h);
      if (!own.length) continue;
      // Supplied by sea: a coast whose waters the enemy doesn't hold, and ships to run the supplies in
      const ships = (s.countries[h]?.ships ?? 0) + Object.values(s.countries).filter((o) => o.id !== h && allied(s, o.id, h)).reduce((t, o) => t + o.ships, 0);
      const sea = ships >= 3 && own.some((id) => {
        const port = PORTS[id];
        if (!port) return false;
        const { mine, theirs } = controlAt(s, h, port[0], port[1], OFF_COAST * 1.5);
        return theirs === 0 || mine >= theirs;
      });
      // Named after its biggest province, as the Kiev or Demyansk pocket was
      const main = own.reduce((m, id) => (s.regions[id].gdp > s.regions[m].gdp ? id : m), own[0]);
      const was = own.map((id) => before[id]).find((p) => p && p.holder === h);
      const id = was?.id ?? nextId(s, 'pk');
      const pocket = { id, holder: h, sea, since: was?.since ?? s.week, name: regionName(main).replace(/\s*\(.*\)$/, ''), main };
      list[id] = { ...pocket, regions: own };
      for (const rid of own) out[rid] = pocket;
      if (!was) {
        const enemies = [...enemiesOf(s, h)].filter((e) => comp.ids.some((x) => GEO[x].adj.some((n) => s.regions[n]?.ctrl === e)));
        const troops = Object.values(s.armies).filter((a) => own.includes(a.region) && onSameSide(s, a.owner, h)).reduce((t, a) => t + a.troops, 0);
        news(s, `${sea ? 'Cut off by land' : 'Encircled'}: ${nameOf(s, h)}'s forces around ${pocket.name} are surrounded${troops >= 1 ? ` (about ${troopsLabel(approx(troops))} troops in armies)` : ''}${sea ? ', though still supplied by sea' : ''}.`, 'war', [h, ...enemies]);
        briefing(s, h, sea
          ? `Our forces around ${pocket.name} are cut off by land. Ships are still getting supplies in, but if the enemy wins the sea there they will be truly surrounded.`
          : `ENCIRCLED: our forces around ${pocket.name} (${own.length} province${own.length > 1 ? 's' : ''}) are cut off from home. Every week they lose organisation, fuel and men. Break out toward our lines, fly in supplies (an airlift, from the army's card), open a corridor from outside, or surrender.`, 'bad', { region: main, front: true });
        for (const e of enemies) briefing(s, e, `Our armies have encircled ${nameOf(s, h)}'s forces around ${pocket.name}. Tighten the ring: cut off from supply, they weaken every week.`, 'good', { region: main, front: true });
      }
    }
  }
  // Pockets that are gone: relieved, or overrun
  for (const [rid, p] of Object.entries(before)) {
    if (out[rid] || Object.values(out).some((x) => x.id === p.id)) continue;
    if (list[p.id]) continue;
    const relieved = s.regions[rid]?.ctrl === p.holder;
    if (relieved && !s.pocketGone?.[p.id]) {
      s.pocketGone = { ...(s.pocketGone ?? {}), [p.id]: s.week };
      if (!p.sea) {
        news(s, `The pocket around ${p.name} is relieved: ${nameOf(s, p.holder)} has opened a corridor to its trapped forces.`, 'war', [p.holder]);
        briefing(s, p.holder, `Our forces around ${p.name} are no longer surrounded: supplies are getting through again.`, 'good', { region: p.main ?? rid, front: true });
      }
    }
  }
  if (s.pocketGone) for (const [k, w] of Object.entries(s.pocketGone)) if (s.week - w > 8) delete s.pocketGone[k];
  s.pockets = out;
  s.pocketList = list;
}

// How much of a surrounded army's needs an airlift covers, 0 to 1
export function airliftCover(s, a) {
  const c = s.countries[a.owner];
  const lift = (c?.airlifts ?? []).find((x) => x.army === a.id);
  if (!lift) return 0;
  return clamp((lift.aircraft * 0.8 * (1 + (dfx(s, a.owner).airlift ?? 0))) / Math.max(20, a.troops), 0, 1);
}

// The pocket's clock, once a week: organisation, fuel and men drain away; the garrisons inside wear down; armies
// at the end of their strength surrender; airlifts fly in and lose aircraft
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
      briefing(s, a.owner, `${a.name} has been surrounded for ${a.pocketWeeks} week${a.pocketWeeks > 1 ? 's' : ''} at ${regionName(a.region)}: organisation ${Math.round(a.org)}%, supply ${Math.round(a.supply * 100)}%${lift ? `, the airlift covering ${Math.round(lift * 100)}% of its needs` : ''}. ${a.org < 20 ? 'It cannot hold out much longer.' : 'Break out, fly in supplies or relieve it.'}`, a.org < 20 ? 'bad' : 'warn', { region: a.region, front: true });
    }
    // At the end of its strength, an army surrenders. A human leader's army only when it has nothing left; never
    // one with commissars at its back.
    if (d.noSurrender || a.pocketWeeks < POCKET_WEEKS_TO_COLLAPSE) continue;
    const spent = a.org < 4 && lift < 0.4;
    if (c?.human ? spent && chance(s, 0.4) : a.org < 12 && lift < 0.5 && chance(s, 0.35)) surrender(s, a, true);
  }
  // Garrisons inside a pocket wear down too
  const gar = garrisons(s);
  for (const [rid, p] of Object.entries(s.pockets ?? {})) {
    if (p.sea) continue;
    const n = nation(s, p.holder);
    const g = gar.get(rid);
    if (n && g) n.troops = Math.max(0, n.troops - g.troops * 0.015 * (1 - clamp(dfx(s, p.holder).pocket ?? 0, 0, 0.8)));
  }
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
  const enemies = [...enemiesOf(s, a.owner)];
  const taker = enemies.find((e) => GEO[a.region].adj.some((n) => s.regions[n]?.ctrl === e)) ?? enemies[0];
  if (c) c.troops = Math.max(0, c.troops - a.troops);
  news(s, `${nameOf(s, a.owner)}'s ${a.name} surrenders ${forced ? 'in the pocket ' : ''}at ${regionName(a.region)}: about ${troopsLabel(approx(a.troops))} troops go into captivity${taker ? ` with ${nameOf(s, taker)}` : ''}.`, 'war', [a.owner, ...(taker ? [taker] : [])]);
  briefing(s, a.owner, `${a.name} (${a.gen.name}) has surrendered at ${regionName(a.region)}. About ${troopsLabel(approx(a.troops))} of our soldiers are prisoners.`, 'bad', { region: a.region, front: true });
  if (taker) briefing(s, taker, `${nameOf(s, a.owner)}'s ${a.name} has surrendered to us at ${regionName(a.region)}: about ${troopsLabel(approx(a.troops))} prisoners.`, 'good', { region: a.region, front: true });
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
  if (!was) news(s, `${c.name} begins an airlift to its forces surrounded at ${regionName(a.region)}.`, 'war', [c.id]);
  return null;
}

// The nearest province our side holds that isn't cut off, and the way there through the ring
export function breakoutPlan(s, a) {
  const owner = a.owner;
  const prev = new Map([[a.region, null]]);
  const queue = [a.region];
  let goal = null;
  while (queue.length && !goal) {
    const id = queue.shift();
    for (const next of GEO[id].adj) {
      if (prev.has(next)) continue;
      const reg = s.regions[next];
      if (!reg) continue;
      const friendly = friendlyGround(s, owner, reg.ctrl);
      if (!friendly && !atWar(s, owner, reg.ctrl)) continue;
      prev.set(next, id);
      if (friendly && !s.pockets?.[next]) { goal = next; break; }
      queue.push(next);
    }
  }
  return goal;
}

// Break out of the ring toward our lines: a desperate attack, a quarter harder for three weeks
export function breakOut(s, c, a) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  if (!a.pocket || a.pocketSea) return `${a.name} isn't surrounded.`;
  const goal = breakoutPlan(s, a);
  if (!goal) return 'There is no way back to our lines from here: every road runs through neutral ground.';
  const err = orderArmy(s, c, a, { kind: 'go', target: goal, aggr: 'allout' });
  if (err) return err;
  a.breakout = s.week + 3;
  a.org = Math.min(100, a.org + 10);
  a.status = `Breaking out toward ${regionName(goal)}`;
  news(s, `${nameOf(s, c.id)}'s surrounded ${a.name} tries to break out at ${regionName(a.region)}.`, 'war', [c.id]);
  return null;
}

/* ---------- Armies that support the front on their own ---------- */

export function setAssist(s, c, a, on) {
  if (!a || a.owner !== c.id) return 'That army is not yours.';
  a.assist = Boolean(on);
  a.assistAt = 0;
  if (a.assist) briefing(s, c.id, `${a.name} will support the front: it moves to defend any nearby province of ours or our allies' that comes under attack, moves up to the line wherever the front has moved, and joins our allies' attacks next to it.`, 'info');
  return null;
}

// Is this province on the front line: next to ground held by an enemy of ours?
const onFront = (s, owner, id) => GEO[id].adj.some((n) => s.regions[n] && atWar(s, owner, s.regions[n].ctrl));

// Armies holding the line stay on it. Every computer-run army does this, and a leader's army when told to
// support the front: where a province next door is under attack it goes to defend it; where the front has moved
// on (pushed forward, or the enemy's attacks have bent it back), it marches to the nearest stretch of the line
// that needs it. An army told to support the front also joins our allies' attacks next to it.
function keepToFront(s, a, c) {
  if (!(a.assist || !c.human) || a.sea || a.auto || a.path.length || a.attacking || a.op.kind !== 'hold') return;
  // A surrounded army has the pocket's own choices: break out, airlift, or surrender
  if (a.pocket && !a.pocketSea) return;
  // Nor does a landing force building up in its port
  if (a.buildup?.region === a.region) return;
  if ((a.assistAt ?? 0) > (s.stepNo ?? 0)) return;
  a.assistAt = (s.stepNo ?? 0) + 2;
  if (!enemiesOf(s, a.owner).size) return;
  const here = s.regions[a.region];
  // Our own ground under attack: stay and hold it
  if (here.battle && atWar(s, here.battle.by, a.owner)) return;
  let best = null;
  for (const id of GEO[a.region].adj) {
    const reg = s.regions[id];
    if (!reg?.battle) continue;
    const by = reg.battle.by;
    // A friendly province under attack: go and defend it
    if (onSameSide(s, a.owner, reg.ctrl) && friendlyGround(s, a.owner, reg.ctrl) && atWar(s, by, a.owner)) {
      const score = 2 + reg.battle.prog / 50;
      if (!best || score > best.score) best = { id, kind: 'hold', score };
    }
    // An ally's attack on an enemy we are at war with: join it (only when told to)
    if (a.assist && by !== a.owner && onSameSide(s, a.owner, by) && atWar(s, a.owner, reg.ctrl)) {
      const score = 1 + reg.battle.prog / 100;
      if (!best || score > best.score) best = { id, kind: 'attack', score };
    }
  }
  // Behind the line: forward to the nearest province on it, the one under attack or with the fewest of our troops
  if (!best && !onFront(s, a.owner, a.region)) best = nearestFront(s, a);
  if (!best) return;
  if (orderArmy(s, c, a, { kind: best.kind, target: best.id, aggr: a.op.aggr ?? 'balanced' })) return;
  a.orderedAt = s.week;
  a.status = best.kind === 'attack' ? `Supporting the front: joining the attack on ${regionName(best.id)}`
    : best.score >= 2 ? `Holding the line: reinforcing ${regionName(best.id)}` : `Holding the line: moving up to ${regionName(best.id)}`;
}

// The nearest province of the front line over our own ground (up to eight provinces away), ours or an ally's
function nearestFront(s, a) {
  const owner = a.owner;
  const dist = new Map([[a.region, 0]]);
  const queue = [a.region];
  const found = [];
  let reach = 8;
  while (queue.length) {
    const id = queue.shift();
    const d = dist.get(id);
    if (d > reach) break;
    if (id !== a.region && onFront(s, owner, id)) { found.push(id); reach = Math.min(reach, d + 1); continue; }
    for (const next of GEO[id].adj) {
      if (dist.has(next)) continue;
      const reg = s.regions[next];
      if (!reg || !(reg.ctrl === owner || friendlyGround(s, owner, reg.ctrl))) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  if (!found.length) return null;
  const troopsAt = (id) => Object.values(s.armies).reduce((t, o) => t + (o.id !== a.id && !o.sea && onSameSide(s, o.owner, owner) && (o.region === id || (o.op.kind === 'hold' && o.op.target === id)) ? o.troops : 0), 0);
  const need = (id) => {
    const b = s.regions[id].battle;
    return (b && atWar(s, b.by, owner) ? 1000 + b.prog * 10 : 0) - troopsAt(id) - dist.get(id) * 40 + (s.regions[id].ctrl === owner ? 20 : 0);
  };
  const id = found.reduce((m, x) => (need(x) > need(m) ? x : m), found[0]);
  return { id, kind: 'hold', score: 1 };
}

// What each leader sees of the pockets: where they are and who is in them
export function pocketsView(s) {
  return Object.values(s.pocketList ?? {}).map((p) => ({ id: p.id, holder: p.holder, sea: p.sea, since: p.since, name: p.name, regions: p.regions }));
}

function ordinal(n) {
  const sfx = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${sfx}`;
}

export { isMinor };
