// The navies. Fleets sail between the world's seas and through its straits, fight the enemy fleets they meet,
// blockade enemy coasts, patrol the straits, and win control of a sea so that armies can land across it.
//
// Fleets are what drive the effects trade and the economy already understand: a fleet blockading a country
// fills in c.blockades, and a fleet patrolling a strait fills in chokepoints[key].patrols. Both are worked out
// from the fleets every step (applyFleets), so they can never disagree with what is on the map.

import { CHOKEPOINTS } from './data/world.js';
import { LANES, SEA_NAMES, PATROL_MODES, basinsOf } from './trade.js';
import { chance, rand, news, alert, nameOf, alive, atWar, allied, enemiesOf, nextId, addRel } from './core.js';
import { commsReady } from './space.js';

/* ---------- The sea network ---------- */

// Seas and straits, placed on the map with the same projection as the provinces (scripts/build-map.js)
export const NODES = {
  atl: { kind: 'sea', name: 'Atlantic', x: 685.1, y: 340.4 },
  pac: { kind: 'sea', name: 'Pacific', x: 85.6, y: 380.5 },
  med: { kind: 'sea', name: 'Mediterranean', x: 1016.2, y: 293.6 },
  black: { kind: 'sea', name: 'Black Sea', x: 1098.4, y: 239.1 },
  red: { kind: 'sea', name: 'Red Sea', x: 1133.9, y: 393.9 },
  gulf: { kind: 'sea', name: 'Persian Gulf', x: 1203, y: 347.1 },
  ind: { kind: 'sea', name: 'Indian Ocean', x: 1350.6, y: 580.2 },
  eas: { kind: 'sea', name: 'East Asian seas', x: 1569.6, y: 427.3 },
  hormuz: { kind: 'strait', x: 1231.7, y: 351.1 },
  malacca: { kind: 'strait', x: 1491.6, y: 503.1 },
  suez: { kind: 'strait', x: 1095.8, y: 323 },
  bab: { kind: 'strait', x: 1163.1, y: 443.3 },
  bosporus: { kind: 'strait', x: 1073.7, y: 252.6 },
  panama: { kind: 'strait', x: 459.2, y: 466.6 },
  gibraltar: { kind: 'strait', x: 888.9, y: 287.2 },
};
for (const [k, n] of Object.entries(NODES)) n.name ??= CHOKEPOINTS[k]?.name ?? SEA_NAMES[k] ?? k;
export const nodeName = (k) => NODES[k]?.name ?? k;
export const isStrait = (k) => NODES[k]?.kind === 'strait';

// Sailing distances between neighbouring nodes, in the trade lanes' units (about 1,500 km each). A lane through
// a strait is split in two at the strait.
const EDGES = new Map(Object.keys(NODES).map((k) => [k, []]));
function link(a, b, len) {
  EDGES.get(a).push({ to: b, len });
  EDGES.get(b).push({ to: a, len });
}
for (const [a, b, len, strait] of LANES) {
  if (strait) { link(a, strait, len / 2); link(strait, b, len / 2); } else link(a, b, len);
}
function edgeLen(a, b) {
  let best = Infinity;
  for (const e of EDGES.get(a) ?? []) if (e.to === b && e.len < best) best = e.len;
  return best;
}

// The shortest way between two nodes: { path (the nodes after `from`), len } or null
export function seaPath(from, to) {
  if (!NODES[from] || !NODES[to]) return null;
  if (from === to) return { path: [], len: 0 };
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = [from];
  const done = new Set();
  while (open.length) {
    open.sort((x, y) => dist.get(x) - dist.get(y));
    const cur = open.shift();
    if (done.has(cur)) continue;
    done.add(cur);
    if (cur === to) break;
    for (const e of EDGES.get(cur)) {
      const nd = dist.get(cur) + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); open.push(e.to); }
    }
  }
  if (!dist.has(to)) return null;
  const path = [];
  for (let x = to; x !== from; x = prev.get(x)) path.unshift(x);
  return { path, len: dist.get(to) };
}

// Seas a country (or a province) touches, among the ones fleets sail
export const seasOf = (s, id) => basinsOf(s, id).filter((k) => NODES[k]);

/* ---------- Strength ---------- */

export { PATROL_MODES };
export const MISSIONS = { hold: 'Hold the sea', patrol: 'Patrol the strait', blockade: 'Blockade' };
export const MAX_FLEETS = 8;
export const CARRIER_WEIGHT = 8; // a carrier group counts as eight warships

const navalTech = (s, owner) => s.countries[owner]?.tech?.naval ?? 5;

// How fast a fleet sails: lane units a week (about 1,500 km each), from naval research
export const fleetSpeed = (s, owner) => 0.9 + 0.1 * navalTech(s, owner);

export function fleetStrength(s, f) {
  return (f.ships + f.carriers * CARRIER_WEIGHT) * (0.6 + 0.08 * navalTech(s, f.owner)) * (0.5 + 0.5 * (f.org ?? 70) / 100);
}

const fleets = (s) => Object.values(s.fleets ?? {});
const atNode = (f) => !(f.prog > 0);
const sameSide = (s, a, b) => a === b || allied(s, a, b);

// Who holds a sea: our side's fleet strength there against our enemies'
export function seaControl(s, cid, sea) {
  let mine = 0;
  let theirs = 0;
  for (const f of fleets(s)) {
    if (f.at !== sea || !atNode(f)) continue;
    if (sameSide(s, cid, f.owner)) mine += fleetStrength(s, f);
    else if (atWar(s, cid, f.owner)) theirs += fleetStrength(s, f);
  }
  return { mine, theirs };
}

// Warships and carriers in port: built but not in any fleet
export function inPort(s, c) {
  let ships = c.ships;
  let carriers = c.carriers;
  for (const f of fleets(s)) if (f.owner === c.id) { ships -= f.ships; carriers -= f.carriers; }
  return { ships: Math.max(0, Math.floor(ships + 1e-6)), carriers: Math.max(0, Math.round(carriers)) };
}

/* ---------- Setting up ---------- */

// Every coastal country starts with its navy at sea: one fleet per sea it borders, the carriers with the first
export function initFleets(s) {
  s.fleets ??= {};
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id) || c.ships + c.carriers <= 0) continue;
    if (fleets(s).some((f) => f.owner === c.id)) continue;
    const seas = seasOf(s, c.id);
    if (!seas.length) continue;
    const shares = seas.map((_, i) => (i === 0 ? 1.5 : 1));
    const total = shares.reduce((a, b) => a + b, 0);
    let left = Math.floor(c.ships);
    seas.forEach((sea, i) => {
      const ships = i === seas.length - 1 ? left : Math.floor(c.ships * shares[i] / total);
      left -= ships;
      const carriers = i === 0 ? c.carriers : 0;
      if (ships + carriers <= 0) return;
      addFleet(s, c, { sea, ships, carriers, name: `${NODES[sea].name} Fleet` });
    });
  }
}

function addFleet(s, c, { sea, ships, carriers, name }) {
  const id = nextId(s, 'f');
  s.fleets[id] = {
    id, owner: c.id, name: String(name || 'Fleet').slice(0, 28), ships, carriers, at: sea, path: [], prog: 0, dest: sea,
    mission: 'hold', mode: null, target: null, org: 80, status: `Holding the ${NODES[sea].name}`,
  };
  return s.fleets[id];
}

/* ---------- Orders ---------- */

export function formFleet(s, c, { sea, ships, carriers = 0, name }) {
  if (fleets(s).filter((f) => f.owner === c.id).length >= MAX_FLEETS) return `You can have at most ${MAX_FLEETS} fleets. Merge or disband one first.`;
  const home = seasOf(s, c.id);
  if (!home.length) return 'You have no coast, so no navy.';
  if (!home.includes(sea)) return `New fleets put to sea from home waters: ${home.map((k) => NODES[k].name).join(' or ')}.`;
  const port = inPort(s, c);
  ships = Math.floor(Number(ships) || 0);
  carriers = Math.floor(Number(carriers) || 0);
  if (ships < 0 || carriers < 0 || ships + carriers < 1) return 'A fleet needs at least one ship.';
  if (ships > port.ships || carriers > port.carriers) return `In port: ${port.ships} warships and ${port.carriers} carriers.`;
  const f = addFleet(s, c, { sea, ships, carriers, name: name || `${ordinal(fleets(s).filter((f) => f.owner === c.id).length + 1)} Fleet` });
  // Ships back from a lost battle are still being repaired
  if ((c.refitUntil ?? -1) > s.week) f.org = 25;
  return null;
}

// Sail somewhere and, on arrival, carry out a mission: hold the sea, patrol a strait, or blockade a country
// (for a blockade, `to` may be left out: the fleet heads for the nearest of the target's seas)
export function fleetOrder(s, c, { id, to, mission = 'hold', mode = null, target = null }) {
  const f = s.fleets?.[id];
  if (!f || f.owner !== c.id) return 'That fleet is not yours.';
  if (!MISSIONS[mission]) return 'Pick a mission.';
  const from = f.prog > 0 ? f.path[0] : f.at;
  if (mission === 'blockade') {
    if (!target || !(s.countries[target] || s.minors[target])) return 'Pick a country to blockade.';
    if (!atWar(s, c.id, target)) return `You are not at war with ${nameOf(s, target)}.`;
    const seas = seasOf(s, target);
    if (!seas.length) return `${nameOf(s, target)} has no coast to blockade.`;
    if (!to || !seas.includes(to)) to = seas.map((k) => [k, seaPath(from, k)?.len ?? Infinity]).sort((x, y) => x[1] - y[1])[0][0];
  } else target = null;
  if (mission === 'patrol') {
    if (!isStrait(to)) return 'Patrols guard a strait: pick one.';
    if (!PATROL_MODES[mode]) return 'Pick what the patrol does.';
  } else mode = null;
  if (!NODES[to]) return 'Pick a sea or a strait.';
  const route = plan(f, to);
  if (!route) return `There is no sea route to the ${nodeName(to)}.`;
  Object.assign(f, route, { dest: to, mission, mode, target });
  f.status = f.path.length ? `Sailing to the ${nodeName(to)}` : statusOf(s, f);
  applyFleets(s);
  return null;
}

// The route from where the fleet is now. Under way between two nodes, it either sails on or turns back,
// whichever is shorter.
function plan(f, to) {
  if (!(f.prog > 0)) {
    const r = seaPath(f.at, to);
    return r && { path: r.path, prog: 0 };
  }
  const next = f.path[0];
  const len = edgeLen(f.at, next);
  const on = seaPath(next, to);
  const back = seaPath(f.at, to);
  const onLen = on ? len - f.prog + on.len : Infinity;
  const backLen = back ? f.prog + back.len : Infinity;
  if (onLen === Infinity && backLen === Infinity) return null;
  if (onLen <= backLen) return { path: [next, ...on.path], prog: f.prog };
  // Turning round: we are now sailing from `next` back towards `at`
  const at = f.at;
  f.at = next;
  return { path: [at, ...back.path], prog: len - f.prog };
}

export function reinforceFleet(s, c, { id, ships = 0, carriers = 0 }) {
  const f = s.fleets?.[id];
  if (!f || f.owner !== c.id) return 'That fleet is not yours.';
  if (!atNode(f) || f.path.length || !seasOf(s, c.id).includes(f.at)) return 'Ships join or leave a fleet in home waters only.';
  ships = Math.floor(Number(ships) || 0);
  carriers = Math.floor(Number(carriers) || 0);
  const port = inPort(s, c);
  if (ships > port.ships || carriers > port.carriers) return `In port: ${port.ships} warships and ${port.carriers} carriers.`;
  if (f.ships + ships < 0 || f.carriers + carriers < 0) return 'The fleet doesn\'t have that many ships.';
  if (f.ships + ships + f.carriers + carriers < 1) return 'A fleet needs at least one ship. Disband it instead.';
  f.ships += ships;
  f.carriers += carriers;
  if (ships + carriers > 0) f.org = Math.max(40, f.org - 10 * (ships + carriers) / (f.ships + f.carriers));
  return null;
}

export function mergeFleets(s, c, ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => s.fleets?.[id]).filter((f) => f && f.owner === c.id);
  if (list.length < 2) return 'Pick two or more of your fleets.';
  if (list.some((f) => !atNode(f)) || new Set(list.map((f) => f.at)).size > 1) return 'Fleets must be in the same sea or strait to merge.';
  const [keep, ...rest] = list;
  for (const f of rest) {
    keep.org = (keep.org * (keep.ships + keep.carriers) + f.org * (f.ships + f.carriers)) / (keep.ships + keep.carriers + f.ships + f.carriers);
    keep.ships += f.ships;
    keep.carriers += f.carriers;
    delete s.fleets[f.id];
  }
  applyFleets(s);
  return null;
}

// The ships go back to port, ready to form a new fleet
export function disbandFleet(s, c, { id }) {
  const f = s.fleets?.[id];
  if (!f || f.owner !== c.id) return 'That fleet is not yours.';
  delete s.fleets[id];
  applyFleets(s);
  return null;
}

export function renameFleet(s, c, { id, name }) {
  const f = s.fleets?.[id];
  if (!f || f.owner !== c.id) return 'That fleet is not yours.';
  const clean = String(name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 28);
  if (!clean) return 'Enter a name.';
  f.name = clean;
  return null;
}

// Call off every blockade of a target, or every patrol in a strait: the fleets stay where they are and hold
export function recallFleets(s, c, { target, key }) {
  for (const f of fleets(s)) {
    if (f.owner !== c.id) continue;
    if ((target && f.mission === 'blockade' && f.target === target) || (key && f.mission === 'patrol' && f.dest === key)) {
      f.mission = 'hold';
      f.mode = null;
      f.target = null;
      f.status = statusOf(s, f);
    }
  }
  applyFleets(s);
  return null;
}

function statusOf(s, f) {
  if (f.path.length) return `Sailing to the ${nodeName(f.dest)}`;
  if (f.mission === 'blockade' && f.target) return `Blockading ${nameOf(s, f.target)} from the ${nodeName(f.at)}`;
  if (f.mission === 'patrol') return `Patrolling the ${nodeName(f.at)}: ${PATROL_MODES[f.mode]?.toLowerCase() ?? ''}`;
  return `Holding the ${nodeName(f.at)}`;
}

/* ---------- What the fleets do: blockades and patrols ---------- */

// Works out every country's blockades and every strait's patrols from where the fleets are and what they were
// told to do. Run whenever fleets move or get orders.
export function applyFleets(s) {
  const before = {};
  for (const c of Object.values(s.countries)) before[c.id] = { ...(c.blockades ?? {}) };
  const patrolsBefore = Object.fromEntries(Object.entries(s.chokepoints).map(([k, st]) => [k, { ...(st.patrols ?? {}) }]));
  for (const c of Object.values(s.countries)) { c.blockades = {}; c.blockadeCarriers = {}; }
  for (const st of Object.values(s.chokepoints)) st.patrols = {};
  for (const f of fleets(s)) {
    if (!atNode(f) || f.path.length) continue;
    const c = s.countries[f.owner];
    if (!c) continue;
    if (f.mission === 'blockade' && f.target && atWar(s, f.owner, f.target) && seasOf(s, f.target).includes(f.at)) {
      c.blockades[f.target] = (c.blockades[f.target] ?? 0) + f.ships;
      c.blockadeCarriers[f.target] = (c.blockadeCarriers[f.target] ?? 0) + f.carriers;
    }
    if (f.mission === 'patrol' && isStrait(f.at) && PATROL_MODES[f.mode]) {
      const st = s.chokepoints[f.at];
      const was = patrolsBefore[f.at]?.[f.owner];
      const cur = st.patrols[f.owner];
      // One patrol per navy per strait; with several fleets there, the biggest one's orders stand
      if (!cur || f.ships > cur.lead) st.patrols[f.owner] = { ships: (cur?.ships ?? 0) + f.ships, carriers: (cur?.carriers ?? 0) + f.carriers, mode: f.mode, since: was?.since ?? s.week, lead: f.ships };
      else { cur.ships += f.ships; cur.carriers += f.carriers; }
    }
  }
  // News when a blockade or a patrol begins
  for (const c of Object.values(s.countries)) {
    for (const t of Object.keys(c.blockades)) {
      if (before[c.id]?.[t]) continue;
      news(s, `${c.name}'s navy blockades ${nameOf(s, t)}.`, 'war', [c.id, t]);
      alert(s, t, `${c.name} has blockaded our ports with ${Math.round(c.blockades[t])} warships${c.blockadeCarriers[t] ? ` and ${Math.round(c.blockadeCarriers[t])} carriers` : ''}. Trade by sea is being cut. Send our fleets to break it.`, 'bad');
    }
  }
  for (const [key, st] of Object.entries(s.chokepoints)) {
    for (const [owner, pt] of Object.entries(st.patrols)) {
      const was = patrolsBefore[key]?.[owner];
      if (was && was.mode === pt.mode) continue;
      const c = s.countries[owner];
      const cp = CHOKEPOINTS[key];
      news(s, pt.mode === 'escort'
        ? `${c.name} sends warships to escort shipping through the ${cp.name}.`
        : pt.mode === 'all'
          ? `${c.name}'s navy blocks the ${cp.name}: no ship passes without its say-so.`
          : `${c.name}'s navy patrols the ${cp.name}, stopping cargoes bound for its enemies.`, pt.mode === 'escort' ? 'trade' : 'war', [owner]);
      if (pt.mode === 'all') {
        c.rep = Math.max(0, c.rep - 8);
        for (const o of Object.values(s.countries)) if (o.id !== owner && !allied(s, o.id, owner)) addRel(s, o.id, owner, -10);
      }
    }
  }
}

/* ---------- Many times a week: sailing and sea battles ---------- */

export function navyStep(s, dt) {
  if (!s.fleets) return;
  let moved = false;
  for (const f of fleets(s)) {
    if (!s.countries[f.owner] || !alive(s, f.owner)) { delete s.fleets[f.id]; continue; }
    if (sail(s, f, dt)) moved = true;
  }
  battles(s, dt);
  if (moved) applyFleets(s);
}

const hostileHere = (s, f) => fleets(s).some((g) => g !== f && g.at === f.at && atNode(g) && atWar(s, f.owner, g.owner));

// Returns true when the fleet reached a node
function sail(s, f, dt) {
  if (!f.path.length) return false;
  if (atNode(f) && hostileHere(s, f)) { f.status = `Fighting in the ${nodeName(f.at)}`; return false; }
  f.prog += fleetSpeed(s, f.owner) * dt;
  let reached = false;
  let len = edgeLen(f.at, f.path[0]);
  while (f.path.length && f.prog >= len) {
    f.prog -= len;
    f.at = f.path.shift();
    reached = true;
    // Enemy fleets bar the way: stop and fight
    if (hostileHere(s, f)) { f.prog = 0; break; }
    if (f.path.length) len = edgeLen(f.at, f.path[0]);
  }
  if (!f.path.length) f.prog = 0;
  if (reached) {
    f.reachedStep = s.stepNo;
    f.status = statusOf(s, f);
    if (!f.path.length && f.dest === f.at && f.mission !== 'hold') alert(s, f.owner, `${f.name} has reached the ${nodeName(f.at)}: ${f.status.toLowerCase()}.`, 'info', { front: true });
  }
  return reached;
}

function battles(s, dt) {
  const byNode = new Map();
  for (const f of fleets(s)) if (atNode(f)) (byNode.get(f.at) ?? byNode.set(f.at, []).get(f.at)).push(f);
  s.seaBattles ??= {};
  for (const [node, list] of byNode) {
    const fighting = list.filter((f) => list.some((g) => atWar(s, f.owner, g.owner)));
    const key = node;
    if (!fighting.length) {
      if (s.seaBattles[key]) delete s.seaBattles[key];
      continue;
    }
    if (!s.seaBattles[key]) {
      const sides = [...new Set(fighting.map((f) => f.owner))];
      s.seaBattles[key] = { since: s.week, sides };
      news(s, `Naval battle in the ${nodeName(node)}: ${sides.map((x) => nameOf(s, x)).join(', ')}.`, 'war', sides);
      for (const x of sides) alert(s, x, `Our fleets are fighting in the ${nodeName(node)}.`, 'war', { front: true });
    }
    // Everyone's losses are worked out first, then taken together
    const plans = fighting.map((f) => {
      let foe = 0;
      let own = 0;
      for (const g of list) {
        if (atWar(s, f.owner, g.owner)) foe += fleetStrength(s, g);
        else if (sameSide(s, f.owner, g.owner) || list.some((e) => atWar(s, f.owner, e.owner) && atWar(s, g.owner, e.owner))) own += fleetStrength(s, g);
      }
      return { f, foe, own, rate: 0.07 * dt * foe / (foe + own + 0.1) };
    });
    for (const { f, foe, own, rate } of plans) {
      const c = s.countries[f.owner];
      const lost = f.ships * rate;
      f.ships -= lost;
      c.ships = Math.max(0, c.ships - lost);
      const sunk = sinkCarriers(s, f, rate * 0.5);
      if (sunk) {
        c.carriers = Math.max(0, c.carriers - sunk);
        news(s, `${nameOf(s, f.owner)} loses ${sunk === 1 ? 'an aircraft carrier' : `${sunk} aircraft carriers`} in the ${nodeName(node)}.`, 'war', [f.owner]);
      }
      f.org = Math.max(0, f.org - 22 * dt);
      f.status = `Fighting in the ${nodeName(node)}`;
      if (f.ships < 0.5 && f.carriers <= 0) {
        delete s.fleets[f.id];
        news(s, `${nameOf(s, f.owner)}'s ${f.name} is sunk in the ${nodeName(node)}.`, 'war', [f.owner]);
        alert(s, f.owner, `${f.name} has been destroyed in the ${nodeName(node)}.`, 'bad', { front: true });
        continue;
      }
      // Badly outgunned or worn out: break off and run for home
      if (f.org < 20 || own < foe * 0.3) retreat(s, f, node);
    }
  }
}

export const REFIT_WEEKS = 6;

function withdraw(s, f, node) {
  delete s.fleets[f.id];
  const c = s.countries[f.owner];
  if (c) c.refitUntil = s.week + REFIT_WEEKS;
  news(s, `${nameOf(s, f.owner)}'s ${f.name} is beaten in the ${nodeName(node)} and withdraws into port.`, 'war', [f.owner]);
  alert(s, f.owner, `${f.name} lost the battle for the ${nodeName(node)} and has withdrawn into port. Its ${Math.round(f.ships)} ships${f.carriers ? ` and ${Math.round(f.carriers)} carriers` : ''} need ${REFIT_WEEKS} weeks to refit before they can sail again.`, 'bad', { front: true });
}

function sinkCarriers(s, f, p) {
  let sunk = 0;
  const whole = Math.floor(f.carriers * p);
  sunk += whole;
  if (chance(s, f.carriers * p - whole)) sunk++;
  sunk = Math.min(f.carriers, sunk);
  f.carriers -= sunk;
  return sunk;
}

function retreat(s, f, node) {
  const home = seasOf(s, f.owner).map((k) => [k, seaPath(node, k)]).filter(([, r]) => r).sort((x, y) => x[1].len - y[1].len)[0];
  // Beaten in its own waters: the fleet runs for harbour, and the enemy holds the sea
  if (!home || home[0] === node) return withdraw(s, f, node);
  f.path = home[1].path;
  f.dest = home[0];
  f.mission = 'hold';
  f.mode = null;
  f.target = null;
  f.status = `Retreating to the ${nodeName(home[0])}`;
  // The first leg is sailed at once, so the fleet gets clear of the battle
  f.prog = 0.0001;
  news(s, `${nameOf(s, f.owner)}'s ${f.name} breaks off and retreats from the ${nodeName(node)}.`, 'war', [f.owner]);
  alert(s, f.owner, `${f.name} was outgunned in the ${nodeName(node)} and is falling back to the ${nodeName(home[0])}.`, 'bad', { front: true });
}

/* ---------- Once a week: readiness, shore batteries and blockade attrition ---------- */

export function navyTick(s) {
  if (!s.fleets) initFleets(s);
  for (const f of fleets(s)) {
    const c = s.countries[f.owner];
    if (!c || !alive(s, f.owner)) { delete s.fleets[f.id]; continue; }
    // Ships lost elsewhere (or never built) come off the fleets too
    const fighting = Boolean(s.seaBattles?.[f.at]) && atNode(f);
    const home = seasOf(s, f.owner).includes(f.at) && atNode(f);
    if (!fighting) f.org = Math.min(100, f.org + (home ? 10 : 4) * (1 - 0.6 * (c.short?.oil ?? 0)) * (commsReady(s, f.owner) ? 1.25 : 1));
    // Shore missiles and aircraft from a hostile shore
    if (atNode(f) && isStrait(f.at)) {
      for (const h of shoreHolders(s, f.at)) {
        if (!atWar(s, h, f.owner)) continue;
        const shore = s.countries[h];
        const lost = f.ships * 0.012 * (shore ? 0.5 + shore.tech.missile / 10 : 0.5) * (0.5 + rand(s));
        if (lost >= 0.5) {
          f.ships = Math.max(0, f.ships - lost);
          c.ships = Math.max(0, c.ships - lost);
          alert(s, f.owner, `Shore missiles from ${nameOf(s, h)} sank ${Math.round(lost)} of ${f.name}'s ships in the ${nodeName(f.at)}.`, 'bad', { front: true });
        }
      }
    }
    // Blockading an enemy coast: its missiles and aircraft wear the fleet down
    if (f.mission === 'blockade' && f.target && atNode(f) && !f.path.length) {
      const t = s.countries[f.target];
      const lost = f.ships * 0.004 * (t ? 0.5 + t.tech.missile / 12 + Math.min(1, t.aircraft / 1500) : 0.3);
      f.ships = Math.max(0, f.ships - lost);
      c.ships = Math.max(0, c.ships - lost);
    }
    if (f.ships < 0.5 && f.carriers <= 0) delete s.fleets[f.id];
  }
  // A country's fleets can never hold more ships than it has (ships sunk by other means come off the biggest fleet)
  for (const c of Object.values(s.countries)) {
    const mine = fleets(s).filter((f) => f.owner === c.id).sort((a, b) => b.ships - a.ships);
    let extra = mine.reduce((t, f) => t + f.ships, 0) - c.ships;
    for (const f of mine) { if (extra <= 0) break; const cut = Math.min(f.ships, extra); f.ships -= cut; extra -= cut; }
    let extraC = mine.reduce((t, f) => t + f.carriers, 0) - c.carriers;
    for (const f of mine) { if (extraC <= 0) break; const cut = Math.min(f.carriers, extraC); f.carriers -= cut; extraC -= cut; }
    for (const f of mine) if (f.ships < 0.5 && f.carriers <= 0) delete s.fleets[f.id];
  }
  applyFleets(s);
}

export function shoreHolders(s, key) {
  return [...new Set((CHOKEPOINTS[key]?.regions ?? []).map((r) => s.regions[r]?.ctrl).filter(Boolean))];
}

/* ---------- Landings ---------- */

// Can our side put an army ashore here? It needs a fleet of ours or an ally's in the sea off the coast, at
// least as strong as the enemy's fleets there. Returns a reason, or null.
export function landingControl(s, cid, region) {
  const seas = seasOf(s, region);
  if (!seas.length) return 'there is no open sea off that coast';
  let best = null;
  for (const sea of seas) {
    const { mine, theirs } = seaControl(s, cid, sea);
    if (mine > 0 && mine >= theirs) return null;
    if (!best || mine - theirs > best.mine - best.theirs) best = { sea, mine, theirs };
  }
  if (!best.mine) return `no fleet of ours or an ally's is in the ${seas.map(nodeName).join(' or ')}. Send a fleet there first (Military → Navy)`;
  return `enemy fleets control the ${nodeName(best.sea)}. Win the sea first`;
}

// The navy escorting an army across: its strength in the sea of the landing against the enemy's
export function crossingOdds(s, cid, region) {
  let mine = 0;
  let theirs = 0;
  for (const sea of seasOf(s, region)) {
    const c = seaControl(s, cid, sea);
    mine += c.mine;
    theirs += c.theirs;
  }
  return { mine, theirs };
}

/* ---------- Computer-run admirals ---------- */

export function aiNavy(s, c) {
  const mine = fleets(s).filter((f) => f.owner === c.id);
  const home = seasOf(s, c.id);
  if (!home.length) return;
  const port = inPort(s, c);
  // New ships join the fleet in home waters, or put to sea as a new one
  if (port.ships + port.carriers >= 3 && !((c.refitUntil ?? -1) > s.week)) {
    const idle = mine.find((f) => atNode(f) && !f.path.length && home.includes(f.at));
    if (idle) reinforceFleet(s, c, { id: idle.id, ships: port.ships, carriers: port.carriers });
    else if (mine.length < MAX_FLEETS) {
      // Put to sea only where the enemy doesn't hold the water: otherwise the ships stay safe in harbour
      const portPower = fleetStrength(s, { owner: c.id, ships: port.ships, carriers: port.carriers, org: 80 });
      const sea = home.find((k) => seaControl(s, c.id, k).theirs < portPower * 0.8);
      if (sea) formFleet(s, c, { sea, ships: port.ships, carriers: port.carriers, name: `${NODES[sea].name} Fleet` });
    }
  }
  const enemies = [...enemiesOf(s, c.id)].filter((e) => alive(s, e));
  const ready = (f) => atNode(f) && !f.path.length && f.org >= 45;
  // At peace: blockading fleets come home
  if (!enemies.length) {
    for (const f of mine) {
      if (f.mission === 'blockade' || (f.mission === 'patrol' && f.mode !== 'escort')) fleetOrder(s, c, { id: f.id, to: home[0], mission: 'hold' });
    }
    return;
  }
  const strength = (id) => fleets(s).filter((f) => f.owner === id).reduce((t, f) => t + fleetStrength(s, f), 0);
  const ours = strength(c.id);
  // Enemy fleets in our home waters: bring the navy home to meet them, if it can win
  for (const sea of home) {
    const { mine: here, theirs } = seaControl(s, c.id, sea);
    if (theirs > 0 && here < theirs && ours > theirs * 1.2) {
      for (const f of mine.filter((x) => ready(x) && x.at !== sea).slice(0, 2)) fleetOrder(s, c, { id: f.id, to: sea, mission: 'hold' });
    }
  }
  // Blockade the weaker enemies' coasts
  for (const e of enemies) {
    if (!seasOf(s, e).length) continue;
    if (mine.some((f) => f.mission === 'blockade' && f.target === e)) continue;
    const theirs = strength(e) + (s.minors[e] ? 2 : 0);
    if (ours < theirs * 1.4) continue;
    const pick = mine.filter(ready).sort((a, b) => fleetStrength(s, b) - fleetStrength(s, a))[0];
    if (pick) fleetOrder(s, c, { id: pick.id, mission: 'blockade', target: e });
  }
  // Big navies stop enemy trade at the straits it depends on
  if (ours > 60 && chance(s, 0.15)) {
    for (const [key, cp] of Object.entries(CHOKEPOINTS)) {
      const hits = enemies.some((e) => cp.importCut?.nations.includes(e) || cp.exportCut?.nations.includes(e));
      if (!hits || mine.some((f) => f.dest === key)) continue;
      const pick = mine.filter(ready).filter((f) => f.mission === 'hold').sort((a, b) => (seaPath(a.at, key)?.len ?? 99) - (seaPath(b.at, key)?.len ?? 99))[0];
      if (pick) { fleetOrder(s, c, { id: pick.id, to: key, mission: 'patrol', mode: 'enemies' }); break; }
    }
  }
}

/* ---------- What each leader sees ---------- */

// Every fleet is tracked by everyone: their own and their allies' in full, others in rough numbers
export function fleetsFor(s, cid, { seen = false } = {}) {
  const me = s.countries[cid] ?? null;
  return fleets(s).map((f) => {
    const own = !me || f.owner === cid || allied(s, cid, f.owner);
    const base = {
      id: f.id, owner: f.owner, name: f.name, at: f.at, next: f.path[0] ?? null, prog: Math.round((f.prog ?? 0) * 100) / 100,
      len: f.path.length ? Math.round(edgeLen(f.at, f.path[0]) * 100) / 100 : 0, carriers: Math.round(f.carriers),
      mission: f.mission, target: f.target, mode: f.mode, battle: Boolean(s.seaBattles?.[f.at]) && atNode(f),
    };
    return own
      ? { ...base, ships: Math.round(f.ships), org: Math.round(f.org), path: [...f.path], dest: f.dest, status: f.status, exact: true }
      : { ...base, ships: seen ? Math.round(f.ships) : Math.max(1, Math.round(f.ships / 5) * 5), exact: false, seen };
  });
}

export function ordinal(n) {
  const sfx = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${sfx}`;
}
