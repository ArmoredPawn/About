// War: army groups, operations, battles, supply, air and naval campaigns, missiles and nuclear weapons.
//
// Leaders point at the map ("go to the North Caucasus oil fields") and the army goes at once: marching through
// friendly ground, fighting through enemy ground, landing from the sea. Fronts move both ways: an attack that is
// thrown back invites a counter-attack. Computer-run generals still pick their moment and regroup.

import { GEO } from './data/geo.js';
import { TERRAIN } from './data/regions.js';
import { REGION_NAMES, MINOR_TERRAIN, MINOR_QUALITY } from './names.js';
import {
  clamp, rand, chance, pick, news, alert as briefing, nameOf, nation, isMinor, atWar, allied, enemiesOf, friendlyGround,
  onSameSide, addRel, nextId, troopsLabel, alive, money, warsAccepted,
} from './core.js';
import { navyStep, navyTick, landingControl, crossingOdds } from './navy.js';
import { gpsCoverage, commsReady } from './space.js';
import { PROVINCES } from './data/regions.js';
import { COUNTRIES } from './data/countries.js';
import { surpriseFeature } from './terrain.js';
import { rangeProblem } from './science.js';

// Every report from the front is marked as war news, so it also runs in the News section
const alert = (s, cid, text, kind, extra = {}) => briefing(s, cid, text, kind, { front: true, ...extra });
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
      const capital = PROVINCES.find((p) => p.id === reg.id)?.capital;
      return 1 + (front ? 5 : 0) + (capital ? 2 : 0) + (reg.owner === holder ? 0 : 0.5);
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    regs.forEach((reg, i) => out.set(reg.id, { troops: (troops * weights[i]) / total, tanks: (tanks * weights[i]) / total, holder }));
  }
  return out;
}

// Fighting strength. Numbers count most: an exhausted army still fights at 60% and one cut off from supply at
// 55%, so three million tired, hungry men are still worth more than a million fresh ones on open ground.
function power(troops, tanks, qual, org, supply, terrain) {
  return (troops + tanks * 0.05 * terrain.armor) * qual * (0.6 + 0.4 * org / 100) * (0.55 + 0.45 * supply);
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
      if (friendlyGround(s, owner, holder) || onSameSide(s, owner, holder) && !atWar(s, owner, holder)) cost = 0.5 * moveCost(s, id, next) / 600;
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
// fleet of ours (or an ally's) in the sea off the target's coast, at least as strong as the enemy's there.
export function landingProblem(s, c, from, target) {
  if (!GEO[from].coast || s.regions[from].ctrl !== c.id) return 'The army isn\'t in a coastal province you hold, so it has no port to sail from.';
  if (!GEO[target].coast) return `${regionName(target)} is landlocked: there is no water to land from.`;
  const sea = landingControl(s, c.id, target);
  if (sea) return `No landing at ${regionName(target)}: ${sea}.`;
  return null;
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
    const problem = landingProblem(s, c, army.region, target);
    if (problem) return { error: problem };
    const km = distanceKm(army.region, target);
    return { op: { kind, target, aggr }, path: [], sea: { from: army.region, to: target, left: Math.ceil(km / 1500) + 1 }, status: `At sea, bound for ${regionName(target)}` };
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
  if (plan.sea) army.sea = plan.sea;
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

export function missileStrike(s, c, target, count) {
  const reg = s.regions[target];
  if (!reg) return 'Pick a province.';
  if (!atWar(s, c.id, reg.ctrl)) return `You are not at war with ${nameOf(s, reg.ctrl)}.`;
  const far = rangeProblem(s, c, target, 'missile');
  if (far) return far;
  count = Math.floor(Number(count));
  if (!(count > 0) || count > c.missiles) return `You have ${c.missiles} missiles.`;
  const def = s.countries[reg.ctrl];
  const intercept = def ? clamp(0.055 * def.tech.missile - 0.02 * (c.tech.missile - 6), 0, 0.75) : 0.05;
  const hits = Math.round(count * (1 - intercept) * (0.85 + rand(s) * 0.3));
  c.missiles -= count;
  // Satellite navigation guides the missiles in
  const dmg = Math.min(0.35, hits * 0.0016 * (c.tech.missile / 8) * (1 + 0.3 * gpsCoverage(s, c.id)));
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
  const far = rangeProblem(s, c, target, 'nuke');
  if (far) return far;
  const victim = reg.ctrl;
  c.nukes -= 1;
  s.nukesUsed++;
  const deaths = reg.pop * 0.25;
  reg.pop *= 0.75;
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

export function setAirCampaign(s, c, target, aircraft) {
  aircraft = Math.floor(Number(aircraft) || 0);
  c.airOps = c.airOps.filter((o) => o.region !== target);
  if (aircraft <= 0) return null;
  const reg = s.regions[target];
  if (!reg || !atWar(s, c.id, reg.ctrl)) return 'Air campaigns target provinces held by an enemy.';
  const far = rangeProblem(s, c, target, 'air');
  if (far) return far;
  const committed = c.airOps.reduce((t, o) => t + o.aircraft, 0);
  if (aircraft + committed > c.aircraft) return `You have ${c.aircraft - committed} aircraft free.`;
  c.airOps.push({ region: target, aircraft });
  alert(s, reg.ctrl, `${c.name} has begun bombing ${regionName(target)}.`, 'bad');
  return null;
}

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
  const fuel = 1 - 0.5 * (c.short?.oil ?? 0);
  const factories = 0.7 + 0.3 * (c.logistics?.factories ?? 1);
  return base * mech * fuel * factories * (a.gen.trait === 'maneuver' ? 1.3 : 1);
}

// The cost of marching from one province into the next, in km of open road: the distance between them, made
// longer by rough terrain and shorter by good infrastructure
const moveCost = (s, from, to) => distanceKm(from, to) * terrainOf(to).move * (1 - 0.04 * s.regions[to].infra);

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
  const battled = new Set();
  for (const [regionId, attackers] of fights) {
    battle(s, regionId, attackers, gar, dt);
    battled.add(regionId);
  }
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
  supplyAll(s);
  logistics(s);
  for (const a of Object.values(s.armies)) {
    const c = s.countries[a.owner];
    if (!c || !alive(s, a.owner)) { delete s.armies[a.id]; continue; }
    if (a.sea) continue;
    const recover = a.gen.trait === 'logistician' ? 12 : 8;
    a.org = Math.min(100 * (c.readiness ?? 1), a.org + recover * a.supply * (a.attacking ? 0.4 : 1) * (commsReady(s, c.id) ? 1.25 : 1));
    if (a.supply < 0.5) {
      a.troops *= 0.99;
      a.org = Math.max(0, a.org - 5);
    }
  }
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
    let p = armyAttackEstimate(s, a, regionId) * (1 + 0.05 * gpsCoverage(s, a.owner));
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

  const fresh = !(reg.battle && reg.battle.by === lead);
  reg.battle = fresh ? { by: lead, prog: 0, weeks: 0, from: attackers[0].landing ? null : attackers[0].region } : reg.battle;
  reg.battle.weeks = (reg.battle.weeks ?? 0) + dt;
  const sides = [...new Set(attackers.map((a) => a.owner))];
  if (fresh) {
    news(s, `${nameOf(s, lead)}'s forces attack ${regionName(regionId)}, held by ${nameOf(s, holder)}.`, 'war', [...sides, holder]);
    alert(s, holder, `${nameOf(s, lead)} is attacking ${regionName(regionId)} with about ${troopsLabel(approx(attackTroops))} troops.`, 'war', { region: regionId });
  }
  // Ground the defenders thought impassable: lightly held, and the attack comes as a shock
  const sneak = surpriseFeature(regionId);
  if (sneak && reg.fort <= 1 && !defenders.some((a) => a.op.kind === 'hold') && reg.battle.weeks <= 3) {
    defence *= 0.55;
    if (fresh) {
      news(s, `${nameOf(s, lead)}'s forces strike through ${sneak.name}, ground ${nameOf(s, holder)} thought impassable. Its defenders are caught off guard.`, 'war', [lead, holder]);
      alert(s, lead, `Surprise: our attack through ${sneak.name} has caught ${nameOf(s, holder)} off guard.`, 'good', { region: regionId });
    }
  }
  const ratio = attack / defence;
  reportBattle(s, reg, regionId, { attackers, sides, lead, holder, ratio, attackTroops, defendTroops, defenders });
  // The front moves fast: an even fight takes a province in under two weeks, a strong attack in days
  // A winning attack moves as fast as the attackers can: mechanised, well-supplied armies break through in days,
  // low-tech infantry grinds forward
  const main = attackers.reduce((m, a) => (a.troops > m.troops ? a : m));
  const tempo = clamp(marchSpeed(s, main) / 700, 0.5, 1.4);
  // Percent of the province taken a week: an even fight takes about a month, a 3:1 attack about a week, and big
  // provinces (up to three times the usual size) take longer
  const step = (ratio >= 1 ? Math.min(95, 25 + 35 * (ratio - 1)) * tempo : ratio >= 0.8 ? 10 * (ratio - 0.8) / 0.2 : -40 * (0.8 - ratio) / 0.8) / size(regionId);
  reg.battle.prog = clamp(reg.battle.prog + step * dt, 0, 100);
  // Beaten back with nothing gained, the defenders counter-attack into the ground the attack came from
  if (ratio < 0.8 && reg.battle.prog <= 0 && reg.battle.from) counterAttack(s, reg.battle.from, holder, regionId, defence / (terrain.defend * (1 + 0.15 * reg.fort)), gar, dt);

  // Losses
  let attackLoss = 0;
  for (const a of attackers) {
    const style = AGGRESSION[a.op.aggr].losses * (a.gen.trait === 'aggressive' ? 1.2 : a.gen.trait === 'cautious' ? 0.75 : 1);
    const rate = 0.016 * dt * clamp(1 / ratio, 0.35, 2.5) * style * (a.landing ? 1.8 : 1);
    const lost = a.troops * rate;
    a.troops -= lost;
    a.tanks *= 1 - rate * 1.4;
    a.org = Math.max(0, a.org - (a.op.aggr === 'allout' ? 8 : 6) * dt);
    attackLoss += lost;
  }
  const defRate = 0.016 * dt * clamp(ratio, 0.35, 2.5);
  let defendLoss = 0;
  for (const a of defenders) {
    const lost = a.troops * defRate * (a.gen.trait === 'defensive' ? 0.85 : 1);
    a.troops -= lost;
    a.tanks *= 1 - defRate * 1.3;
    a.org = Math.max(0, a.org - 6 * dt);
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
  // The dead are gone from the population, and civilians in the battle zone die or flee
  for (const a of attackers) bury(s, a.owner, attackLoss * (a.troops / Math.max(1, attackTroops)));
  bury(s, holder, defendLoss);
  reg.pop *= 1 - 0.0008 * dt * Math.min(2, ratio);
  const war = s.wars.find((w) => (w.a === lead && w.b === holder) || (w.b === lead && w.a === holder));
  if (war) {
    if (war.a === lead) { war.lossA += attackLoss; war.lossB += defendLoss; } else { war.lossB += attackLoss; war.lossA += defendLoss; }
  }
  reg.dmg = Math.min(0.9, reg.dmg + 0.006 * dt);

  if (reg.battle.prog >= 100) capture(s, regionId, lead, attackers);
  for (const a of Object.values(s.armies)) if (a.troops < 1) destroyArmy(s, a, 'was destroyed in battle');
}

// How an attack is going, on each attacking army's card, and in the news whenever it turns: advancing,
// stalled, or thrown back (when the defenders start pushing into the ground the attack came from)
function reportBattle(s, reg, regionId, { attackers, sides, lead, holder, ratio, attackTroops, defendTroops, defenders }) {
  const trend = ratio >= 1 ? 'advancing' : ratio < 0.8 ? 'repulsed' : 'stalled';
  const odds = `${ratio.toFixed(2)}:1`;
  const where = regionName(regionId);
  const theirs = `about ${troopsLabel(approx(defendTroops))} defenders${defenders.length ? `, including ${defenders.map((a) => `${nameOf(s, a.owner)}'s ${a.name} (~${troopsLabel(approx(a.troops))})`).join(', ')}` : ''}`;
  for (const a of attackers) {
    a.status = trend === 'advancing' ? `Attacking ${where}: winning (${odds})`
      : trend === 'stalled' ? `Attacking ${where}: held up (${odds} against ${theirs})`
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
  const odds = (strength * 0.6) / Math.max(1, defenceEstimate(s, backId, gar));
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
    if (a.attacking === regionId) a.attacking = null;
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
    if (reg.owner === a.owner || (reg.ctrl !== a.owner && friendlyGround(s, a.owner, reg.ctrl))) supply = 1;
    else {
      const hops = (cache.get(a.owner) ?? cache.set(a.owner, homeDistance(s, a.owner)).get(a.owner)).get(a.region);
      if (hops == null) supply = GEO[a.region].coast && c.ships > 5 ? 0.6 : 0.25;
      else supply = clamp(1.05 - 0.1 * hops, 0.35, 1);
    }
    // Partisans: a hostile people ambushes convoys and blows up rail lines
    if (reg.people !== a.owner && reg.ctrl === a.owner && (reg.loyalty ?? 50) < 30) supply *= 0.75 + 0.25 * (reg.loyalty / 30);
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
      const eff = (mine / (mine + defAir + adf)) * (1 - 0.7 * (c.short?.oil ?? 0)) * (1 + 0.2 * gpsCoverage(s, c.id));
      reg.dmg = Math.min(0.9, reg.dmg + 0.012 * eff * Math.min(1, op.aircraft / 80));
      const lost = Math.max(0, Math.round(op.aircraft * 0.006 * (1.2 - eff)));
      op.aircraft -= lost;
      c.aircraft = Math.max(0, c.aircraft - lost);
      if (def && defAir > 0) def.aircraft = Math.max(0, def.aircraft - Math.round(def.aircraft * 0.002 * eff));
      return op.aircraft > 0;
    });
  }
}

function ordinal(n) {
  const sfx = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${sfx}`;
}

export { isMinor };
