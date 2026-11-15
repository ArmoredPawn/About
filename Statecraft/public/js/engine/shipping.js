// Cargo ships on the water. Every cargo that goes by sea sails a real lane between a port of the seller and a
// port of the buyer, at a real position that moves as the week goes on. Only a fleet that is actually there can
// stop it: a fleet at war with the buyer or the seller attacks it when it comes within range, a blockading
// fleet catches it as it nears the blockaded coast, a patrol in a strait stops the traffic it was told to, and a
// fleet sent to hunt one particular cargo sails out to meet it. Warships of the buyer, the seller and their
// allies near the cargo escort it: if they are the stronger force, it gets through.

import { MAP_SIZE } from './data/geo.js';
import { RESOURCE_INFO } from './data/regions.js';
import { PORTS, seaRoute as waterRoute, mapDistance, fleetStrength, ENGAGE, seaAt, nodeName, fleetSpeed, KM_PER_PX } from './navy.js';
import { stopShipment, escortPower } from './trade.js';
import { clamp, chance, alert, nameOf, atWar, allied, sanctioning } from './core.js';

const W = MAP_SIZE.w;
const wrap = (x) => ((x % W) + W) % W;
const ESCORT_RANGE = ENGAGE * 3; // friendly warships this close to a cargo defend it
const NEAR_END = 0.18; // the share of the voyage near each end where a blockade catches it

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

// Where a cargo is now (or at a later point of its voyage), or null if it isn't at sea
export function shipAt(s, sh, t = voyage(s, sh)) {
  if (sh.mode !== 'sea' || !sh.lane) return null;
  const g = laneGeometry(sh.lane.from, sh.lane.to);
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
  if (f.mission === 'patrol') {
    if (f.mode === 'all') return 'seize';
    if (f.mode === 'enemies' && (war || sanctioning(s, f.owner, sh.buyer) || sanctioning(s, f.owner, sh.seller))) return 'seize';
    return null;
  }
  return war ? f.raid ?? 'seize' : null;
}

// Fleets meet a cargo: the escorts fight them off, or they stop it
function encounter(s, sh, attackers, how, x, y) {
  const attack = attackers.reduce((t, f) => t + fleetStrength(s, f), 0);
  const escort = escortAt(s, sh, x, y);
  const by = attackers[0].owner;
  const where = `in the ${nodeName(seaAt(x, y))}`;
  const what = RESOURCE_INFO[sh.res].name.toLowerCase();
  if (escort >= attack) {
    for (const f of attackers) f.org = Math.max(0, (f.org ?? 70) - 12);
    alert(s, by, `Our ships tried to stop a ${what} cargo bound for ${nameOf(s, sh.buyer)} ${where}, but its escorts were too strong and drove us off.`, 'warn', { front: true });
    alert(s, sh.buyer, `${nameOf(s, by)}'s navy went for a ${what} cargo bound for us ${where}. Its escorts got it through.`, 'good');
    endHunt(s, sh, attackers, false);
    return;
  }
  if (chance(s, clamp(attack / (attack + escort + 0.5), 0.55, 0.95))) {
    stopShipment(s, sh, by, how, where);
    endHunt(s, sh, attackers, true);
  } else {
    alert(s, by, `A ${what} cargo bound for ${nameOf(s, sh.buyer)} slipped past our ships ${where}.`, 'warn', { front: true });
    endHunt(s, sh, attackers, false);
  }
}

function endHunt(s, sh, fleets, got) {
  for (const f of fleets) {
    if (f.mission !== 'intercept' || f.target !== sh.id) continue;
    f.mission = 'hold';
    f.target = null;
    f.route = [];
    f.status = got ? 'Holding position after the interception' : 'Holding position: the cargo got away';
  }
}

/* ---------- Hunting a cargo ---------- */

// The point on a cargo's lane where this fleet can meet it before it reaches port, or null
export function interceptPoint(s, sh, f) {
  if (sh.mode !== 'sea' || sh.done) return null;
  const now = voyage(s, sh);
  const speed = fleetSpeed(s, f.owner) / KM_PER_PX; // map pixels a week
  for (let t = now; t <= 0.97; t += 0.01) {
    const p = shipAt(s, sh, t);
    if (!p) return null;
    // Sea routes wind: allow a third more than the straight line
    const fleetWeeks = (mapDistance(f.x, f.y, p[0], p[1]) * 1.3) / Math.max(1, speed);
    const shipWeeks = (t - now) * sh.total;
    if (fleetWeeks <= shipWeeks + 0.1) return p;
  }
  return null;
}

// Send one of our fleets after a cargo
export function huntCargo(s, c, sh, f, how) {
  if (!f || f.owner !== c.id) return 'Pick one of your fleets.';
  if (f.ships + (f.carriers ?? 0) < 1) return 'That fleet has no warships.';
  const p = interceptPoint(s, sh, f);
  if (!p) return `${f.name} can't catch it before it reaches port. A fleet closer to its route might.`;
  const way = waterRoute([f.x, f.y], p);
  if (!way) return `${f.name} has no way there by sea.`;
  Object.assign(f, { route: way, dest: p, mission: 'intercept', target: sh.id, how, mode: null, retreating: false });
  f.status = `Hunting a ${RESOURCE_INFO[sh.res].name.toLowerCase()} cargo bound for ${nameOf(s, sh.buyer)}`;
  return null;
}

/* ---------- Every step ---------- */

export function shippingStep(s) {
  const fleets = Object.values(s.fleets ?? {});
  const live = new Set();
  for (const sh of s.shipments ?? []) {
    if (sh.done || sh.mode !== 'sea') continue;
    sh.lane ??= laneFor(s, sh.seller, sh.buyer);
    const p = shipAt(s, sh);
    if (!p) continue;
    live.add(sh.id);
    const [x, y] = p;
    sh.x = Math.round(x * 10) / 10;
    sh.y = Math.round(y * 10) / 10;
    sh.met ??= {};
    // Fleets that come upon it
    for (const f of fleets) {
      if (sh.done) break;
      if (sh.met[f.id] || mapDistance(f.x, f.y, x, y) > ENGAGE) continue;
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
  // Hunters keep heading for where their cargo will be; a cargo that has docked or been stopped ends the hunt
  for (const f of fleets) {
    if (f.mission !== 'intercept') continue;
    const sh = (s.shipments ?? []).find((x) => x.id === f.target);
    if (!sh || sh.done || !live.has(sh.id)) {
      f.mission = 'hold';
      f.target = null;
      f.status = 'Holding position: the cargo reached port';
      if (sh && !sh.done) alert(s, f.owner, `The ${RESOURCE_INFO[sh.res].name.toLowerCase()} cargo our fleet was hunting reached ${nameOf(s, sh.buyer)}.`, 'warn');
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
