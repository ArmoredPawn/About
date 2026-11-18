// Cargo ships on the water. Every cargo that goes by sea sails a real lane between a port of the seller and a
// port of the buyer, at a real position that moves as the week goes on. Only a fleet that is actually there can
// stop it: a fleet at war with the buyer or the seller attacks it when it comes within range, a blockading
// fleet catches it as it nears the blockaded coast, a patrol in a strait stops the traffic it was told to, and a
// fleet sent to hunt one particular cargo sails out to meet it. Warships of the buyer, the seller and their
// allies near the cargo escort it: if they are the stronger force, it gets through.
//
// A cargo under a resource deal sails the route its seller planned (cargo.js): up to ten checkpoints, straight
// lines between them. Other cargoes sail the shortest lane between the two countries' nearest ports. A private
// cargo is out of sight, but a warship that comes very close to one sees it, and its leader decides what to do.

import { MAP_SIZE } from './data/geo.js';
import { RESOURCE_INFO } from './data/regions.js';
import { PORTS, seaRoute as waterRoute, mapDistance, fleetStrength, ENGAGE, seaAt, nodeName, fleetSpeed, KM_PER_PX, inPort, portsOf, formFleet, MAX_FLEETS, raidStatus } from './navy.js';
export { RAID_MODES, RAID_HOW } from './navy.js';
import { stopShipment, escortPower } from './trade.js';
import { clamp, chance, alert, nameOf, atWar, allied, sanctioning } from './core.js';
import { cargoPrivate, canSeeCargo, sighted } from './cargo.js';

const W = MAP_SIZE.w;
const an = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const wrap = (x) => ((x % W) + W) % W;
const ESCORT_RANGE = ENGAGE * 3; // friendly warships this close to a cargo defend it
const NEAR_END = 0.18; // the share of the voyage near each end where a blockade catches it
// How far a freighter gets in a week, port time included: about 13 knots. Warships are a little faster, so a fleet
// can run down a cargo it is placed well for, but can't chase one across an ocean. A truck and rail convoy
// overland makes about 1,500 km a week.
export const CARGO_KMW = 2200;
export const LAND_KMW = 1500;
// A warship this close to a private cargo sees it (map pixels, about 260 km)
export const SIGHT = 13;


/* ---------- Lanes ---------- */

// A country's five biggest ports, largest economy first
export function bigPorts(s, cid) {
  return Object.values(s.regions).filter((r) => r.ctrl === cid && PORTS[r.id]).sort((a, b) => b.gdp - a.gdp).slice(0, 5).map((r) => r.id);
}

// The pair of ports (seller's, buyer's) closest to each other: the lane a cargo between them sails
export function laneFor(s, seller, buyer) {
  let best = null;
  for (const pa of bigPorts(s, seller)) {
    for (const pb of bigPorts(s, buyer)) {
      const d = mapDistance(PORTS[pa][0], PORTS[pa][1], PORTS[pb][0], PORTS[pb][1]);
      if (!best || d < best.d) best = { from: pa, to: pb, d };
    }
  }
  return best ? { from: best.from, to: best.to } : null;
}

// The waypoints of a lane and the distance run at each (it never changes, so it is worked out once)
const geometry = new Map();
export function laneGeometry(from, to) {
  const key = `${from}>${to}`;
  if (!geometry.has(key)) {
    const start = PORTS[from];
    const way = start && PORTS[to] ? waterRoute(start, PORTS[to]) : null;
    if (!way) geometry.set(key, null);
    else {
      const pts = [start, ...way];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      geometry.set(key, { pts, cum });
    }
  }
  return geometry.get(key);
}

// The way a planned cargo goes: its own checkpoints, worked out once per cargo
const planned = new Map();
export function pathGeometry(sh) {
  const key = `${sh.id}|${sh.path.length}|${sh.path[0]}|${sh.path[sh.path.length - 1]}`;
  if (!planned.has(key)) {
    if (planned.size > 4000) planned.clear();
    const pts = sh.path;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    planned.set(key, { pts, cum });
  }
  return planned.get(key);
}
const geometryOf = (sh) => (sh.path?.length >= 2 ? pathGeometry(sh) : sh.mode === 'sea' && sh.lane ? laneGeometry(sh.lane.from, sh.lane.to) : null);

function along(g, t) {
  const want = g.cum[g.cum.length - 1] * clamp(t, 0, 1);
  let i = 1;
  while (i < g.cum.length - 1 && g.cum[i] < want) i++;
  const seg = g.cum[i] - g.cum[i - 1] || 1;
  const k = (want - g.cum[i - 1]) / seg;
  const [x0, y0] = g.pts[i - 1];
  const [x1, y1] = g.pts[i];
  return [wrap(x0 + (x1 - x0) * k), y0 + (y1 - y0) * k];
}

// How far along its voyage a cargo is, 0 to 1, part-way through the week
export const voyage = (s, sh) => clamp((sh.total - sh.left + (s.stepped ?? 0)) / Math.max(1, sh.total), 0, 1);

// Where a cargo is now (or at a later point of its voyage), or null if it has no known way (an overland cargo
// that wasn't planned)
export function shipAt(s, sh, t = voyage(s, sh)) {
  const g = geometryOf(sh);
  return g ? along(g, t) : null;
}

/* ---------- Encounters ---------- */

const sideOf = (s, sh, id) => id === sh.buyer || id === sh.seller || allied(s, id, sh.buyer) || allied(s, id, sh.seller);

// Warships protecting a cargo where it is now: the buyer's, the seller's and their allies', close by, plus any
// escort patrols in the straits on its route
function escortAt(s, sh, x, y) {
  let p = 0;
  for (const f of Object.values(s.fleets ?? {})) {
    if (!sideOf(s, sh, f.owner)) continue;
    if (mapDistance(f.x, f.y, x, y) <= ESCORT_RANGE) p += fleetStrength(s, f);
  }
  return p + escortPower(s, sh) * 0.5;
}

// Why this fleet would attack this cargo, or null: a war with either side, a hunt for it, or a patrol's orders
function hostility(s, sh, f) {
  if (sideOf(s, sh, f.owner)) return null;
  if (f.mission === 'intercept' && f.target === sh.id) return f.how ?? 'seize';
  const war = atWar(s, f.owner, sh.buyer) || atWar(s, f.owner, sh.seller);
  const sanctioned = sanctioning(s, f.owner, sh.buyer) || sanctioning(s, f.owner, sh.seller);
  // Hunting shipping in a sea: the cargo it is chasing, and any other it is ordered to stop that passes close
  if (f.mission === 'raid') return f.target === sh.id || raidable(s, sh, f) ? f.raid ?? 'seize' : null;
  if (f.mission === 'patrol') {
    if (f.mode === 'all') return 'seize';
    if (f.mode === 'enemies' && (war || sanctioned)) return f.raid ?? 'seize';
    return null;
  }
  return war ? f.raid ?? 'seize' : null;
}

// Would a fleet hunting shipping go after this cargo? Its owners' enemies' (and, if told to, the countries it
// sanctions); never its own side's
function raidable(s, sh, f) {
  if (sideOf(s, sh, f.owner) || sh.done || sh.mode !== 'sea') return false;
  if (cargoPrivate(sh) && !canSeeCargo(s, f.owner, sh)) return false;
  if (atWar(s, f.owner, sh.buyer) || atWar(s, f.owner, sh.seller)) return true;
  return f.mode === 'hostile' && (sanctioning(s, f.owner, sh.buyer) || sanctioning(s, f.owner, sh.seller));
}

// The chance that warships this strong stop a cargo guarded by escorts this strong. Sinking it is surer than
// seizing it: a prize has to be boarded and sailed home, and it can still slip away.
export function stopChance(attack, escort, how) {
  if (attack <= 0 || escort >= attack) return 0;
  const base = clamp(attack / (attack + escort + 0.5), 0.55, 0.95);
  return how === 'sink' ? base : Math.max(0.4, base - 0.15);
}

// Fleets meet a cargo: the escorts fight them off, or they stop it
function encounter(s, sh, attackers, how, x, y) {
  const by = attackers[0].owner;
  const attack = attackers.reduce((t, f) => t + fleetStrength(s, f), 0);
  const escort = escortAt(s, sh, x, y);
  const where = `in the ${nodeName(seaAt(x, y))}`;
  const what = RESOURCE_INFO[sh.res].name.toLowerCase();
  if (escort >= attack) {
    for (const f of attackers) f.org = Math.max(0, (f.org ?? 70) - 12);
    // A failed attempt is ours to know about: the cargo's owners only see it arrive
    alert(s, by, `Failed to ${how} ${an(what)} cargo bound for ${nameOf(s, sh.buyer)} ${where}: its escorts were too strong and drove our ships off.`, 'bad', { sea: [x, y] });
    endHunt(s, sh, attackers, false);
    return;
  }
  if (chance(s, stopChance(attack, escort, how))) {
    stopShipment(s, sh, by, how, where, [x, y]);
    endHunt(s, sh, attackers, true);
  } else {
    alert(s, by, `Failed to ${how} ${an(what)} cargo bound for ${nameOf(s, sh.buyer)}: it slipped past our ships ${where}.`, 'bad', { sea: [x, y] });
    endHunt(s, sh, attackers, false);
  }
}

function endHunt(s, sh, fleets, got) {
  for (const f of fleets) {
    if (f.mission === 'raid' && f.target === sh.id) {
      Object.assign(f, { target: null, huntLabel: null, route: [], dest: null });
      f.status = raidStatus(f);
      continue;
    }
    if (f.mission !== 'intercept' || f.target !== sh.id) continue;
    f.mission = 'hold';
    f.target = null;
    f.route = [];
    f.huntLabel = null;
    f.status = got ? 'Holding position after the interception' : 'Holding position: the cargo got away';
  }
}

// A fleet still close to a cargo (it has just reported it) acts at once: no chase, the escorts and the odds decide
export function strikeNow(s, c, sh, f, how) {
  if (!f || f.owner !== c.id || sh.done || sh.x == null) return null;
  if (mapDistance(f.x, f.y, sh.x, sh.y) > ENGAGE * 1.5) return null;
  sh.met ??= {};
  sh.met[f.id] = true;
  encounter(s, sh, [f], how, sh.x, sh.y);
  return 'done';
}

/* ---------- Hunting a cargo ---------- */

// Where and when this fleet can meet a cargo before it reaches port: the point on its lane and the weeks until
// the cargo gets there (the fleet is waiting by then), or null if it can't get there in time
function meeting(s, sh, f, step = 0.01) {
  if (sh.mode !== 'sea' || sh.done || !f) return null;
  const now = voyage(s, sh);
  const speed = fleetSpeed(s, f.owner) / KM_PER_PX; // map pixels a week
  for (let t = now; t <= 0.97; t += step) {
    const p = shipAt(s, sh, t);
    if (!p) return null;
    // Sea routes wind: allow a third more than the straight line
    const fleetWeeks = (mapDistance(f.x, f.y, p[0], p[1]) * 1.3) / Math.max(1, speed);
    const shipWeeks = (t - now) * sh.total;
    if (fleetWeeks <= shipWeeks + 0.1) return { p, weeks: Math.max(shipWeeks, fleetWeeks) };
  }
  return null;
}

export function interceptPoint(s, sh, f) { return meeting(s, sh, f)?.p ?? null; }

// The odds for a fleet of this strength meeting this cargo at a point
function oddsAt(s, sh, cid, attack, p) {
  const escort = escortAt(s, sh, p[0], p[1]);
  return {
    escort: Math.round(escort * 10) / 10, attack: Math.round(attack * 10) / 10,
    seize: Math.round(stopChance(attack, escort, 'seize') * 100), sink: Math.round(stopChance(attack, escort, 'sink') * 100),
  };
}

// What a leader sees before sending a fleet after a cargo: for each of their fleets, how soon it could meet the
// cargo and its chances of seizing or sinking it against the escorts there now
export function huntOptions(s, cid, sh) {
  const out = [];
  for (const f of Object.values(s.fleets ?? {})) {
    if (f.owner !== cid || f.ships + (f.carriers ?? 0) < 1) continue;
    const m = meeting(s, sh, f, 0.02);
    if (!m) { out.push({ fleet: f.id, weeks: null }); continue; }
    out.push({ fleet: f.id, weeks: Math.round(m.weeks * 10) / 10, ...oddsAt(s, sh, cid, fleetStrength(s, f), m.p), busy: f.mission !== 'hold' ? f.mission : null });
  }
  return out;
}

// A fleet that doesn't exist yet: the warships waiting in port, put to sea from whichever of our ports meets the
// cargo soonest. Only the ports nearest what is left of its voyage are tried.
export function spawnOption(s, cid, sh) {
  const c = s.countries[cid];
  if (!c || sh.mode !== 'sea' || sh.done) return null;
  const pool = inPort(s, c);
  if (pool.ships + pool.carriers < 1) return null;
  if (Object.values(s.fleets ?? {}).filter((f) => f.owner === cid).length >= MAX_FLEETS) return null;
  const now = voyage(s, sh);
  const ahead = [0, 0.25, 0.5, 0.75, 1].map((k) => shipAt(s, sh, now + (0.97 - now) * k)).filter(Boolean);
  if (!ahead.length) return null;
  const near = (p) => Math.min(...ahead.map((q) => mapDistance(p.x, p.y, q[0], q[1])));
  const ports = portsOf(s, cid).map((p) => ({ ...p, d: near(p) })).sort((a, b) => a.d - b.d).slice(0, 6);
  const org = (c.refitUntil ?? -1) > s.week ? 25 : 80;
  let best = null;
  for (const p of ports) {
    const m = meeting(s, sh, { owner: cid, x: p.x, y: p.y }, 0.02);
    if (m && (!best || m.weeks < best.weeks)) best = { port: p.region, weeks: m.weeks, p: m.p };
  }
  if (!best) return null;
  const attack = fleetStrength(s, { owner: cid, ships: pool.ships, carriers: pool.carriers, org });
  return { port: best.port, weeks: Math.round(best.weeks * 10) / 10, ships: pool.ships, carriers: pool.carriers, ...oddsAt(s, sh, cid, attack, best.p) };
}

// The fleet of ours already hunting a cargo, and how soon it meets it
export function hunterOf(s, cid, sh) {
  const f = Object.values(s.fleets ?? {}).find((x) => x.owner === cid && (x.mission === 'intercept' || x.mission === 'raid') && x.target === sh.id);
  if (!f) return null;
  const m = meeting(s, sh, f, 0.02);
  return { fleet: f.id, name: f.name, how: (f.mission === 'raid' ? f.raid : f.how) ?? 'seize', weeks: m ? Math.round(m.weeks * 10) / 10 : null, waiting: !f.route?.length, raid: f.mission === 'raid' };
}

// Call a hunting fleet back: it holds where it is
export function callOffHunt(s, c, { fleet }) {
  const f = s.fleets?.[fleet];
  if (!f || f.owner !== c.id) return 'Pick one of your fleets.';
  if (f.mission !== 'intercept' && !(f.mission === 'raid' && f.target)) return 'That fleet isn\'t hunting a cargo.';
  Object.assign(f, { mission: 'hold', target: null, route: [], dest: null, huntLabel: null });
  f.status = 'Holding position: the hunt was called off';
  return null;
}

// Send one of our fleets after a cargo: one at sea, or (fleet 'new') a new one put to sea from the best port
export function huntCargo(s, c, sh, f, how, { ships, carriers } = {}) {
  if (f === 'new') {
    const opt = spawnOption(s, c.id, sh);
    if (!opt) return 'None of our ports can put a fleet in its way before it docks, or we have no warships in port.';
    const pool = inPort(s, c);
    ships = Math.floor(Number(ships ?? pool.ships));
    carriers = Math.floor(Number(carriers ?? pool.carriers) || 0);
    const before = new Set(Object.keys(s.fleets ?? {}));
    const err = formFleet(s, c, { region: opt.port, ships, carriers, name: `${how === 'sink' ? 'Strike' : 'Boarding'} Group` });
    if (err) return err;
    const made = Object.values(s.fleets).find((x) => x.owner === c.id && !before.has(x.id));
    const problem = huntCargo(s, c, sh, made, how);
    if (problem) { delete s.fleets[made.id]; return problem; }
    return null;
  }
  if (!f || f.owner !== c.id) return 'Pick one of your fleets.';
  if (f.ships + (f.carriers ?? 0) < 1) return 'That fleet has no warships.';
  const p = interceptPoint(s, sh, f);
  if (!p) return `${f.name} can't catch it before it reaches port. A fleet closer to its route might.`;
  const way = waterRoute([f.x, f.y], p);
  if (!way) return `${f.name} has no way there by sea.`;
  const label = `${how === 'sink' ? 'sink' : 'seize'} ${an(RESOURCE_INFO[sh.res].name.toLowerCase())} cargo bound for ${nameOf(s, sh.buyer)}`;
  Object.assign(f, { route: way, dest: p, mission: 'intercept', target: sh.id, how, mode: null, retreating: false, huntLabel: label });
  f.status = `Sailing to ${label}`;
  return null;
}

/* ---------- Hunting shipping across a whole sea ---------- */

// Where this fleet can meet a cargo it might go after, or null if it should let it go. It hunts its own waters:
// the meeting point has to be in the sea (or strait) it was sent to, or close to where it was stationed.
function raidChoice(s, f, sh) {
  if (!raidable(s, sh, f) || sh.met?.[f.id]) return null;
  const m = meeting(s, sh, f, 0.02);
  if (!m) return null;
  if (seaAt(m.p[0], m.p[1]) !== f.raidSea && mapDistance(m.p[0], m.p[1], f.station?.[0] ?? f.x, f.station?.[1] ?? f.y) > ENGAGE * 4) return null;
  return m;
}

function raidStep(s, f, live) {
  const chasing = f.target ? (s.shipments ?? []).find((x) => x.id === f.target) : null;
  if (f.target && (!chasing || chasing.done || !live.has(chasing.id))) Object.assign(f, { target: null, huntLabel: null });
  if ((s.stepNo ?? 0) % 3 !== 0) return;
  // Keep after the one it is chasing while it can still catch it; otherwise pick the one it can meet soonest
  let best = null;
  if (f.target && chasing) { const m = raidChoice(s, f, chasing); if (m) best = { sh: chasing, m }; }
  if (!best) {
    for (const sh of s.shipments ?? []) {
      if (sh.mode !== 'sea' || sh.done || !live.has(sh.id)) continue;
      const m = raidChoice(s, f, sh);
      if (m && (!best || m.weeks < best.m.weeks)) best = { sh, m };
    }
  }
  if (!best) {
    if (f.target) Object.assign(f, { target: null, huntLabel: null, route: [], dest: null });
    f.status = raidStatus(f);
    return;
  }
  const { sh, m } = best;
  const how = f.raid ?? 'seize';
  if (f.target !== sh.id || !f.dest || mapDistance(f.dest[0], f.dest[1], m.p[0], m.p[1]) > 12) {
    const way = waterRoute([f.x, f.y], m.p);
    if (!way) return;
    f.route = way;
    f.dest = m.p;
  }
  if (f.target !== sh.id) alert(s, f.owner, `${f.name} has found ${an(RESOURCE_INFO[sh.res].name.toLowerCase())} cargo bound for ${nameOf(s, sh.buyer)} in the ${nodeName(f.raidSea)} and is going after it to ${how} it.`, 'info', { front: true });
  f.target = sh.id;
  f.huntLabel = `${how} ${an(RESOURCE_INFO[sh.res].name.toLowerCase())} cargo bound for ${nameOf(s, sh.buyer)}`;
  f.status = raidStatus(f);
}

/* ---------- Every step ---------- */

// The voyage takes as long as the way is: a freighter's week is about 2,200 km, a land convoy's about 1,500.
// Worked out once, when the cargo sets off.
function sizeVoyage(sh) {
  sh.sized = true;
  const g = geometryOf(sh);
  if (!g) return;
  const km = g.cum[g.cum.length - 1] * KM_PER_PX;
  const weeks = Math.max(1, Math.round(km / (sh.mode === 'land' ? LAND_KMW : CARGO_KMW)));
  const gone = sh.total - sh.left;
  sh.total = Math.max(weeks, gone + 1);
  sh.left = sh.total - gone;
}

export function shippingStep(s) {
  const fleets = Object.values(s.fleets ?? {});
  const live = new Set();
  for (const sh of s.shipments ?? []) {
    if (sh.done) continue;
    if (sh.mode === 'sea') sh.lane ??= laneFor(s, sh.seller, sh.buyer);
    if (!sh.sized) sizeVoyage(sh);
    const p = shipAt(s, sh);
    if (!p) continue;
    const [x, y] = p;
    sh.x = Math.round(x * 10) / 10;
    sh.y = Math.round(y * 10) / 10;
    // An overland convoy is only drawn moving along its way; the countries it crosses deal with it (trade.js)
    if (sh.mode !== 'sea') continue;
    live.add(sh.id);
    sh.met ??= {};
    const hidden = cargoPrivate(sh);
    // Fleets that come upon it
    for (const f of fleets) {
      if (sh.done) break;
      const d = mapDistance(f.x, f.y, x, y);
      // A private cargo is seen only by warships very close to it: their leader is told, and chooses
      if (hidden && d <= SIGHT && !sideOf(s, sh, f.owner)) sighted(s, sh, f, x, y);
      if (sh.met[f.id] || d > ENGAGE) continue;
      // Out of sight, a private cargo can't be attacked by fleets that don't know it is there
      if (hidden && !canSeeCargo(s, f.owner, sh)) continue;
      const how = hostility(s, sh, f);
      if (!how) continue;
      sh.met[f.id] = true;
      encounter(s, sh, [f], how, x, y);
    }
    // Blockades: the fleets off a coast catch what is coming in or going out
    const t = voyage(s, sh);
    for (const [end, near] of [[sh.buyer, t >= 1 - NEAR_END], [sh.seller, t <= NEAR_END]]) {
      if (sh.done || !near) continue;
      const block = fleets.filter((f) => f.mission === 'blockade' && f.target === end && !sh.met[f.id] && atWar(s, f.owner, end) && !sideOf(s, sh, f.owner));
      if (!block.length) continue;
      for (const f of block) sh.met[f.id] = true;
      encounter(s, sh, block, block[0].raid ?? 'seize', x, y);
    }
  }
  for (const f of fleets) if (f.mission === 'raid' && s.fleets[f.id]) raidStep(s, f, live);
  // Hunters keep heading for where their cargo will be; a cargo that has docked or been stopped ends the hunt
  for (const f of fleets) {
    if (f.mission !== 'intercept') continue;
    const sh = (s.shipments ?? []).find((x) => x.id === f.target);
    if (!sh || sh.done || !live.has(sh.id)) {
      f.mission = 'hold';
      f.target = null;
      f.huntLabel = null;
      f.status = 'Holding position: the cargo reached port';
      if (sh && !sh.done) alert(s, f.owner, `Failed to catch the ${RESOURCE_INFO[sh.res].name.toLowerCase()} cargo bound for ${nameOf(s, sh.buyer)}: it reached port before our fleet could.`, 'bad');
      continue;
    }
    if ((s.stepNo ?? 0) % 4 !== 0) continue;
    const p = interceptPoint(s, sh, f);
    if (!p) continue;
    if (!f.dest || mapDistance(f.dest[0], f.dest[1], p[0], p[1]) > 12) {
      const way = waterRoute([f.x, f.y], p);
      if (way) { f.route = way; f.dest = p; }
    }
  }
}
