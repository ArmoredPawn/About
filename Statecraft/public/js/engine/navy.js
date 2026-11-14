// The navies. Every fleet is at an exact point on the water. It sails where it is sent, along a real route round
// the land and through the straits, fights the enemy fleets it comes near, blockades the coast it lies off,
// patrols a strait it sits in, and gives our armies the control of the sea they need to land.
//
// Fleets drive the effects trade and the economy already understand: a fleet blockading a country fills in
// c.blockades, and a fleet patrolling a strait fills in chokepoints[key].patrols. Both are worked out from the
// fleets every step (applyFleets), so they can never disagree with what is on the map.
//
// The water comes from data/seas.js (scripts/build-seas.js): a grid of cells about 100 km across, each land or
// part of one of eight seas or seven straits, and a port off every coastal province.

import { CHOKEPOINTS } from './data/world.js';
import { SEA_GRID, SEA_KEYS, SEA_RLE, PORTS } from './data/seas.js';
import { MAP_SIZE } from './data/geo.js';
import { SEA_NAMES, PATROL_MODES, basinsOf } from './trade.js';
import { chance, rand, news, alert, nameOf, alive, atWar, allied, enemiesOf, nextId, addRel } from './core.js';
import { commsReady } from './space.js';
import { REGION_NAMES } from './names.js';

const regionLabel = (id) => (id ? REGION_NAMES[id] ?? id : 'sea');

/* ---------- The water ---------- */

const W = MAP_SIZE.w;
const CELL = SEA_GRID.cell;
const GW = SEA_GRID.w;
const GH = SEA_GRID.h;
const LABELS = (() => {
  const out = new Uint8Array(GW * GH);
  let i = 0;
  for (const run of SEA_RLE.split(',')) {
    const v = parseInt(run[0], 36);
    const n = parseInt(run.slice(1), 36);
    out.fill(v, i, i + n);
    i += n;
  }
  return out;
})();
export const KM_PER_PX = 20; // the map is 2,000 pixels for 360 degrees of longitude
export { PORTS };

const wrapX = (x) => ((x % W) + W) % W;
const cellOf = (x, y) => [Math.floor(wrapX(x) / CELL) % GW, Math.max(0, Math.min(GH - 1, Math.floor(y / CELL)))];
const labelOf = (gx, gy) => LABELS[gy * GW + gx];
export const isWater = (x, y) => labelOf(...cellOf(x, y)) > 0;
// The sea or strait a point is in: 'atl', 'hormuz'... (null on land)
export function seaAt(x, y) {
  const l = labelOf(...cellOf(x, y));
  return l ? SEA_KEYS[l - 1] : null;
}

// Seas and straits: their names, and a point in each for labels and for sending fleets
const SEA_POINTS = {
  atl: [685.1, 340.4], pac: [85.6, 380.5], med: [1016.2, 293.6], black: [1098.4, 239.1], red: [1133.9, 393.9],
  gulf: [1203, 347.1], ind: [1350.6, 580.2], eas: [1569.6, 427.3],
  hormuz: [1231.7, 351.1], malacca: [1491.6, 503.1], suez: [1095.8, 323], bab: [1163.1, 443.3],
  bosporus: [1073.7, 252.6], panama: [459.2, 466.6], gibraltar: [888.9, 287.2],
};
export const NODES = Object.fromEntries(SEA_KEYS.map((k) => {
  const [x, y] = nearestWater(...SEA_POINTS[k], k) ?? SEA_POINTS[k];
  return [k, { kind: CHOKEPOINTS[k] ? 'strait' : 'sea', name: CHOKEPOINTS[k]?.name ?? SEA_NAMES[k] ?? k, x, y }];
}));
export const nodeName = (k) => NODES[k]?.name ?? k;
export const isStrait = (k) => NODES[k]?.kind === 'strait';

// The nearest navigable water to a point (in a given sea or strait, if asked), or null
export function nearestWater(x, y, want = null) {
  const [sx, sy] = cellOf(x, y);
  const ok = (gx, gy) => { const l = labelOf(gx, gy); return l > 0 && (!want || SEA_KEYS[l - 1] === want); };
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const gx = (sx + dx + GW) % GW;
      const gy = sy + dy;
      if (gy < 0 || gy >= GH || !ok(gx, gy)) continue;
      return [gx * CELL + CELL / 2, gy * CELL + CELL / 2];
    }
  }
  return null;
}

// Distance across the map, the short way round where the Pacific wraps
export function mapDistance(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx);
  if (dx > W / 2) dx = W - dx;
  return Math.hypot(dx, ay - by);
}

// A sea route from one point to another: waypoints (with x unwrapped, so a route across the Pacific edge runs
// smoothly past 0 or 2,000), or null. A* over the water cells, then straightened where the sea allows.
export function seaRoute(from, to) {
  const [sx, sy] = cellOf(...from);
  const [tx, ty] = cellOf(...to);
  if (!labelOf(sx, sy) || !labelOf(tx, ty)) return null;
  const start = sy * GW + sx;
  const goal = ty * GW + tx;
  if (start === goal) return [[to[0], to[1]]];
  // Full precision: rounded costs let two cells keep "improving" each other for ever
  const g = new Float64Array(GW * GH).fill(Infinity);
  const came = new Int32Array(GW * GH).fill(-1);
  const heap = new MinHeap();
  const h = (i) => { let dx = Math.abs((i % GW) - tx); if (dx > GW / 2) dx = GW - dx; return Math.hypot(dx, Math.floor(i / GW) - ty); };
  g[start] = 0;
  heap.push(start, h(start));
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const i = heap.pop();
    if (i === goal) break;
    const gx = i % GW;
    const gy = Math.floor(i / GW);
    for (const [dx, dy, cost] of steps) {
      const nx = (gx + dx + GW) % GW;
      const ny = gy + dy;
      if (ny < 0 || ny >= GH || !labelOf(nx, ny)) continue;
      // No slipping diagonally between two land cells
      if (dx && dy && (!labelOf((gx + dx + GW) % GW, gy) || !labelOf(gx, ny))) continue;
      const j = ny * GW + nx;
      const ng = g[i] + cost;
      if (ng < g[j]) { g[j] = ng; came[j] = i; heap.push(j, ng + h(j)); }
    }
  }
  if (came[goal] < 0) return null;
  // Back from the goal, unwrapping x so the path is continuous
  const cells = [];
  for (let i = goal; i !== start && cells.length < GW * GH; i = came[i]) cells.push(i);
  cells.reverse();
  const pts = [];
  let px = sx;
  for (const i of cells) {
    let x = i % GW;
    while (x - px > GW / 2) x -= GW;
    while (px - x > GW / 2) x += GW;
    pts.push([x * CELL + CELL / 2, Math.floor(i / GW) * CELL + CELL / 2]);
    px = x;
  }
  const last = pts[pts.length - 1];
  const tox = to[0] + Math.round((last[0] - to[0]) / W) * W;
  pts[pts.length - 1] = [tox, to[1]];
  return straighten([[from[0], from[1]], ...pts]).slice(1);
}

// Drop waypoints wherever a straight line over open water does the same job (looking a limited way ahead,
// which keeps long voyages quick to plan)
function straighten(pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = Math.min(pts.length - 1, a + 48);
    while (b > a + 1 && !clearLine(pts[a], pts[b])) b--;
    out.push(pts[b]);
    a = b;
  }
  return out;
}
function clearLine([ax, ay], [bx, by]) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2));
  for (let k = 1; k < n; k++) if (!isWater(ax + (bx - ax) * k / n, ay + (by - ay) * k / n)) return false;
  return true;
}
export const routeLength = (from, route) => route.reduce((t, p, i) => { const q = i ? route[i - 1] : from; return t + Math.hypot(p[0] - q[0], p[1] - q[1]); }, 0);

class MinHeap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const a = this.items;
    const k = this.keys;
    let i = a.length;
    a.push(item); k.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      a[i] = a[p]; k[i] = k[p];
      i = p;
    }
    a[i] = item; k[i] = key;
  }
  pop() {
    const a = this.items;
    const k = this.keys;
    const top = a[0];
    const item = a.pop();
    const key = k.pop();
    if (a.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        a[i] = a[c]; k[i] = k[c];
        i = c;
      }
      a[i] = item; k[i] = key;
    }
    return top;
  }
}

/* ---------- Strength and ranges ---------- */

export { PATROL_MODES };
export const MISSIONS = { hold: 'Hold position', patrol: 'Patrol the strait', blockade: 'Blockade' };
export const MAX_FLEETS = 8;
export const CARRIER_WEIGHT = 8; // a carrier group counts as eight warships
export const REFIT_WEEKS = 6;
// In map pixels (about 20 km each)
export const ENGAGE = 22; // enemy fleets this close fight
export const OFF_COAST = 30; // a fleet this close to a coast blockades it, or covers a landing on it
export const IN_PORT = 12; // close enough to a port to take on or send home ships

const navalTech = (s, owner) => s.countries[owner]?.tech?.naval ?? 5;
// How fast a fleet sails: km a week, from naval research (about 2,000 to 2,800)
export const fleetSpeed = (s, owner) => (0.9 + 0.1 * navalTech(s, owner)) * 1500;
const speedPx = (s, owner) => fleetSpeed(s, owner) / KM_PER_PX;

export function fleetStrength(s, f) {
  return (f.ships + f.carriers * CARRIER_WEIGHT) * (0.6 + 0.08 * navalTech(s, f.owner)) * (0.5 + 0.5 * (f.org ?? 70) / 100);
}

const fleets = (s) => Object.values(s.fleets ?? {});
const moving = (f) => Boolean(f.route?.length);
const sameSide = (s, a, b) => a === b || allied(s, a, b);

// Seas a country (or a province) touches, among the ones fleets sail
export const seasOf = (s, id) => basinsOf(s, id).filter((k) => NODES[k]);

// Ports: the open water off each coastal province a country holds
export function portsOf(s, cid) {
  return Object.values(s.regions).filter((r) => r.ctrl === cid && PORTS[r.id]).map((r) => ({ region: r.id, x: PORTS[r.id][0], y: PORTS[r.id][1], sea: seaAt(...PORTS[r.id]), gdp: r.gdp }));
}
const nearestPort = (s, cid, x, y) => portsOf(s, cid).sort((a, b) => mapDistance(x, y, a.x, a.y) - mapDistance(x, y, b.x, b.y))[0] ?? null;

// Who holds the water around a point: our side's fleet strength within a radius against our enemies'
export function controlAt(s, cid, x, y, radius = OFF_COAST) {
  let mine = 0;
  let theirs = 0;
  for (const f of fleets(s)) {
    if (mapDistance(f.x, f.y, x, y) > radius) continue;
    if (sameSide(s, cid, f.owner)) mine += fleetStrength(s, f);
    else if (atWar(s, cid, f.owner)) theirs += fleetStrength(s, f);
  }
  return { mine, theirs };
}
// The same, for a whole sea (used by the computer)
export function seaControl(s, cid, sea) {
  let mine = 0;
  let theirs = 0;
  for (const f of fleets(s)) {
    if (f.at !== sea) continue;
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

// Every coastal country starts with its navy at sea: a fleet off its main port in each sea it borders, the
// carriers with the first
export function initFleets(s) {
  s.fleets ??= {};
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id) || c.ships + c.carriers <= 0) continue;
    if (c.minor && c.ships < 3) continue; // a coastguard of a ship or two stays in harbour
    if (fleets(s).some((f) => f.owner === c.id)) continue;
    const ports = portsOf(s, c.id);
    const seas = [...new Set(ports.map((p) => p.sea))].filter((k) => k && !isStrait(k));
    const ordered = seasOf(s, c.id).filter((k) => seas.includes(k));
    for (const k of seas) if (!ordered.includes(k)) ordered.push(k);
    if (!ordered.length) continue;
    const use = ordered.slice(0, 3);
    const shares = use.map((_, i) => (i === 0 ? 1.5 : 1));
    const total = shares.reduce((a, b) => a + b, 0);
    let left = Math.floor(c.ships);
    use.forEach((sea, i) => {
      const ships = i === use.length - 1 ? left : Math.floor(c.ships * shares[i] / total);
      left -= ships;
      const carriers = i === 0 ? c.carriers : 0;
      if (ships + carriers <= 0) return;
      const port = ports.filter((p) => p.sea === sea).sort((a, b) => b.gdp - a.gdp)[0];
      addFleet(s, c, { x: port.x, y: port.y, ships, carriers, name: `${NODES[sea].name} Fleet`, port: port.region });
    });
  }
}

// Fleets from a saved game made before fleets had exact positions: off a port in the sea they were in
export function placeFleets(s) {
  for (const f of fleets(s)) {
    if (f.x != null) continue;
    const port = portsOf(s, f.owner).filter((p) => p.sea === f.at)[0] ?? portsOf(s, f.owner)[0];
    const at = port ? [port.x, port.y] : NODES[f.at] ? [NODES[f.at].x, NODES[f.at].y] : null;
    if (!at) { delete s.fleets[f.id]; continue; }
    f.x = at[0];
    f.y = at[1];
    f.route = [];
    f.dest = null;
    f.port = port?.region ?? null;
    delete f.path; delete f.prog;
    f.at = seaAt(f.x, f.y);
  }
}

function addFleet(s, c, { x, y, ships, carriers, name, port }) {
  const id = nextId(s, 'f');
  s.fleets[id] = {
    id, owner: c.id, name: String(name || 'Fleet').slice(0, 28), ships, carriers, x, y, route: [], dest: null, at: seaAt(x, y),
    port: port ?? null, mission: 'hold', mode: null, target: null, org: 80, status: `In port at ${regionLabel(port)}`,
  };
  return s.fleets[id];
}

/* ---------- Orders ---------- */

// A new fleet puts to sea off one of our coastal provinces (or, given only a sea, our best port in it)
export function formFleet(s, c, { region, sea, ships, carriers = 0, name }) {
  if (fleets(s).filter((f) => f.owner === c.id).length >= MAX_FLEETS) return `You can have at most ${MAX_FLEETS} fleets. Merge or disband one first.`;
  const ports = portsOf(s, c.id);
  if (!ports.length) return 'We hold no coast, so we have no navy.';
  let port = region ? ports.find((p) => p.region === region) : null;
  if (region && !port) return 'Pick a coastal province we hold.';
  if (!port && sea) port = ports.filter((p) => p.sea === sea).sort((a, b) => b.gdp - a.gdp)[0];
  if (!port) port = ports.sort((a, b) => b.gdp - a.gdp)[0];
  const pool = inPort(s, c);
  ships = Math.floor(Number(ships) || 0);
  carriers = Math.floor(Number(carriers) || 0);
  if (ships < 0 || carriers < 0 || ships + carriers < 1) return 'A fleet needs at least one ship.';
  if (ships > pool.ships || carriers > pool.carriers) return `In port: ${pool.ships} warships and ${pool.carriers} carriers.`;
  const f = addFleet(s, c, { x: port.x, y: port.y, ships, carriers, name: name || `${ordinal(fleets(s).filter((x) => x.owner === c.id).length + 1)} Fleet`, port: port.region });
  // Ships back from a lost battle are still being repaired
  if ((c.refitUntil ?? -1) > s.week) f.org = 25;
  return null;
}

// Sail to a point on the water and, on arrival, carry out a mission: hold there, patrol a strait, or blockade a
// country. `to` may name a sea or strait instead of a point; for a blockade the fleet heads for the nearest
// stretch of the target's coast.
export function fleetOrder(s, c, { id, x, y, to, mission = 'hold', mode = null, target = null }) {
  const f = s.fleets?.[id];
  if (!f || f.owner !== c.id) return 'That fleet is not yours.';
  if (!MISSIONS[mission]) return 'Pick a mission.';
  let dest = Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? [Number(x), Number(y)] : null;
  if (mission === 'blockade') {
    if (!target || !(s.countries[target] || s.minors[target])) return 'Pick a country to blockade.';
    if (!atWar(s, c.id, target)) return `You are not at war with ${nameOf(s, target)}.`;
    const coast = portsOf(s, target);
    if (!coast.length) return `${nameOf(s, target)} has no coast to blockade.`;
    // Their coast nearest to where we point, or to the fleet
    const ref = dest ?? [f.x, f.y];
    const near = coast.sort((a, b) => mapDistance(ref[0], ref[1], a.x, a.y) - mapDistance(ref[0], ref[1], b.x, b.y))[0];
    dest = [near.x, near.y];
  } else target = null;
  if (mission === 'patrol') {
    const key = to ?? (dest ? seaAt(...dest) : null);
    if (!isStrait(key)) return 'Patrols guard a strait: pick one.';
    if (!PATROL_MODES[mode]) return 'Pick what the patrol does.';
    dest = [NODES[key].x, NODES[key].y];
  } else mode = null;
  if (!dest && to && NODES[to]) dest = [NODES[to].x, NODES[to].y];
  if (!dest) return 'Pick a point on the water.';
  if (!isWater(...dest)) {
    const w = nearestWater(...dest);
    // A click just off the shore counts as the water there; one well inland doesn't
    if (!w || mapDistance(w[0], w[1], dest[0], dest[1]) > 15) return 'That is not open water.';
    dest = w;
  }
  const route = seaRoute([f.x, f.y], dest);
  if (!route) return 'There is no way there by sea.';
  f.route = route;
  f.dest = [wrapX(dest[0]), dest[1]];
  Object.assign(f, { mission, mode, target, retreating: false });
  f.status = route.length && routeLength([f.x, f.y], route) > 2 ? `Sailing to the ${nodeName(seaAt(...f.dest))}` : statusOf(s, f);
  applyFleets(s);
  return null;
}

export function reinforceFleet(s, c, { id, ships = 0, carriers = 0 }) {
  const f = s.fleets?.[id];
  if (!f || f.owner !== c.id) return 'That fleet is not yours.';
  const port = nearestPort(s, c.id, f.x, f.y);
  if (moving(f) || !port || mapDistance(f.x, f.y, port.x, port.y) > IN_PORT) return 'Ships join or leave a fleet in one of our ports. Send it home first.';
  ships = Math.floor(Number(ships) || 0);
  carriers = Math.floor(Number(carriers) || 0);
  const pool = inPort(s, c);
  if (ships > pool.ships || carriers > pool.carriers) return `In port: ${pool.ships} warships and ${pool.carriers} carriers.`;
  if (f.ships + ships < 0 || f.carriers + carriers < 0) return 'The fleet doesn\'t have that many ships.';
  if (f.ships + ships + f.carriers + carriers < 1) return 'A fleet needs at least one ship. Send it to port instead.';
  f.ships += ships;
  f.carriers += carriers;
  if (ships + carriers > 0) f.org = Math.max(40, f.org - 10 * (ships + carriers) / (f.ships + f.carriers));
  return null;
}

export function mergeFleets(s, c, ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => s.fleets?.[id]).filter((f) => f && f.owner === c.id);
  if (list.length < 2) return 'Pick two or more of your fleets.';
  const [keep, ...rest] = list;
  if (list.some((f) => moving(f) || mapDistance(f.x, f.y, keep.x, keep.y) > IN_PORT)) return 'Fleets must be together, and stopped, to merge.';
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
    if ((target && f.mission === 'blockade' && f.target === target) || (key && f.mission === 'patrol' && seaAt(...(f.dest ?? [f.x, f.y])) === key)) {
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
  if (moving(f)) return f.retreating ? 'Retreating' : `Sailing to the ${nodeName(seaAt(...(f.dest ?? [f.x, f.y])))}`;
  if (f.mission === 'blockade' && f.target) return `Blockading ${nameOf(s, f.target)}`;
  if (f.mission === 'patrol') return `Patrolling the ${nodeName(f.at)}: ${PATROL_MODES[f.mode]?.toLowerCase() ?? ''}`;
  const port = nearestPort(s, f.owner, f.x, f.y);
  if (port && mapDistance(f.x, f.y, port.x, port.y) <= IN_PORT) return `In port at ${regionLabel(port.region)}`;
  return `Holding position in the ${nodeName(f.at)}`;
}

/* ---------- What the fleets do: blockades and patrols ---------- */

// Is this fleet lying off the target's coast, close enough to stop its shipping?
function offCoastOf(s, f, target) {
  return portsOf(s, target).some((p) => mapDistance(f.x, f.y, p.x, p.y) <= OFF_COAST);
}

// Works out every country's blockades and every strait's patrols from where the fleets are and what they were
// told to do. Run whenever fleets move or get orders.
export function applyFleets(s) {
  const before = {};
  for (const c of Object.values(s.countries)) before[c.id] = { ...(c.blockades ?? {}) };
  const patrolsBefore = Object.fromEntries(Object.entries(s.chokepoints).map(([k, st]) => [k, { ...(st.patrols ?? {}) }]));
  for (const c of Object.values(s.countries)) { c.blockades = {}; c.blockadeCarriers = {}; }
  for (const st of Object.values(s.chokepoints)) st.patrols = {};
  for (const f of fleets(s)) {
    if (moving(f)) continue;
    const c = s.countries[f.owner];
    if (!c) continue;
    if (f.mission === 'blockade' && f.target && atWar(s, f.owner, f.target) && offCoastOf(s, f, f.target)) {
      c.blockades[f.target] = (c.blockades[f.target] ?? 0) + f.ships;
      c.blockadeCarriers[f.target] = (c.blockadeCarriers[f.target] ?? 0) + f.carriers;
    }
    if (f.mission === 'patrol' && isStrait(f.at) && PATROL_MODES[f.mode] && s.chokepoints[f.at]) {
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
  let changed = false;
  for (const f of fleets(s)) {
    if (!s.countries[f.owner] || !alive(s, f.owner)) { delete s.fleets[f.id]; continue; }
    if (sail(s, f, dt)) changed = true;
  }
  battles(s, dt);
  if (changed) applyFleets(s);
}

const hostileNear = (s, f) => fleets(s).some((g) => g !== f && atWar(s, f.owner, g.owner) && mapDistance(f.x, f.y, g.x, g.y) <= ENGAGE);

// Returns true when the fleet arrived, or crossed into another sea or strait
function sail(s, f, dt) {
  if (!moving(f)) return false;
  // Enemy fleets close by: stand and fight (a retreating fleet keeps running)
  if (!f.retreating && hostileNear(s, f)) { f.status = `Fighting in the ${nodeName(f.at)}`; return false; }
  let budget = speedPx(s, f.owner) * dt;
  while (budget > 0 && f.route.length) {
    const [nx, ny] = f.route[0];
    const d = Math.hypot(nx - f.x, ny - f.y);
    if (d <= budget) { f.x = nx; f.y = ny; f.route.shift(); budget -= d; } else {
      f.x += (nx - f.x) * budget / d;
      f.y += (ny - f.y) * budget / d;
      budget = 0;
    }
  }
  // Back onto the map where a route crosses the Pacific edge
  if (f.x < 0 || f.x >= W) {
    const shift = f.x < 0 ? W : -W;
    f.x += shift;
    for (const p of f.route) p[0] += shift;
  }
  const at = seaAt(f.x, f.y) ?? f.at;
  const crossed = at !== f.at;
  f.at = at;
  f.reachedStep = s.stepNo;
  if (!f.route.length) {
    f.retreating = false;
    f.status = statusOf(s, f);
    if (f.mission !== 'hold') alert(s, f.owner, `${f.name} is in position: ${f.status.toLowerCase()}.`, 'info', { front: true });
    return true;
  }
  return crossed;
}

function battles(s, dt) {
  const all = fleets(s);
  s.seaBattles ??= {};
  const active = new Set();
  const plans = [];
  for (const f of all) {
    const foes = all.filter((g) => g !== f && atWar(s, f.owner, g.owner) && mapDistance(f.x, f.y, g.x, g.y) <= ENGAGE);
    if (!foes.length) continue;
    const friends = all.filter((g) => !atWar(s, f.owner, g.owner) && mapDistance(f.x, f.y, g.x, g.y) <= ENGAGE && (sameSide(s, f.owner, g.owner) || foes.some((e) => atWar(s, g.owner, e.owner))));
    const foe = foes.reduce((t, g) => t + fleetStrength(s, g), 0);
    const own = friends.reduce((t, g) => t + fleetStrength(s, g), 0);
    plans.push({ f, foe, own, rate: 0.07 * dt * foe / (foe + own + 0.1) });
    for (const g of foes) {
      const key = [f.owner, g.owner].sort().join('|');
      active.add(key);
      if (!s.seaBattles[key]) {
        s.seaBattles[key] = { since: s.week, at: f.at };
        news(s, `Naval battle in the ${nodeName(f.at)}: ${nameOf(s, f.owner)} against ${nameOf(s, g.owner)}.`, 'war', [f.owner, g.owner]);
        for (const x of [f.owner, g.owner]) alert(s, x, `Our fleets are fighting ${nameOf(s, x === f.owner ? g.owner : f.owner)}'s in the ${nodeName(f.at)}.`, 'war', { front: true, sea: [f.x, f.y] });
      }
    }
  }
  for (const k of Object.keys(s.seaBattles)) if (!active.has(k)) delete s.seaBattles[k];
  // Everyone's losses are worked out first, then taken together
  for (const { f, foe, own, rate } of plans) {
    if (!s.fleets[f.id]) continue;
    const c = s.countries[f.owner];
    const lost = f.ships * rate;
    f.ships -= lost;
    c.ships = Math.max(0, c.ships - lost);
    const sunk = sinkCarriers(s, f, rate * 0.5);
    if (sunk) {
      c.carriers = Math.max(0, c.carriers - sunk);
      news(s, `${nameOf(s, f.owner)} loses ${sunk === 1 ? 'an aircraft carrier' : `${sunk} aircraft carriers`} in the ${nodeName(f.at)}.`, 'war', [f.owner]);
    }
    f.org = Math.max(0, f.org - 22 * dt);
    f.battle = s.week;
    f.status = `Fighting in the ${nodeName(f.at)}`;
    if (f.ships < 0.5 && f.carriers <= 0) {
      delete s.fleets[f.id];
      news(s, `${nameOf(s, f.owner)}'s ${f.name} is sunk in the ${nodeName(f.at)}.`, 'war', [f.owner]);
      alert(s, f.owner, `${f.name} has been destroyed in the ${nodeName(f.at)}.`, 'bad', { front: true });
      continue;
    }
    // Badly outgunned or worn out: break off and run for home
    if (f.org < 20 || own < foe * 0.3) retreat(s, f);
  }
}

function sinkCarriers(s, f, p) {
  const whole = Math.floor(f.carriers * p);
  let sunk = whole + (chance(s, f.carriers * p - whole) ? 1 : 0);
  sunk = Math.min(f.carriers, sunk);
  f.carriers -= sunk;
  return sunk;
}

function retreat(s, f) {
  if (f.retreating) return;
  const home = portsOf(s, f.owner)
    .map((p) => ({ ...p, d: mapDistance(f.x, f.y, p.x, p.y) }))
    .filter((p) => !fleets(s).some((g) => atWar(s, f.owner, g.owner) && mapDistance(g.x, g.y, p.x, p.y) <= ENGAGE))
    .sort((a, b) => a.d - b.d)[0];
  // Nowhere safe to run, or already off our own coast: into harbour, and the enemy holds the sea
  if (!home || home.d <= OFF_COAST * 1.5) return withdraw(s, f);
  const route = seaRoute([f.x, f.y], [home.x, home.y]);
  if (!route) return withdraw(s, f);
  f.route = route;
  f.dest = [home.x, home.y];
  f.retreating = true;
  f.mission = 'hold';
  f.mode = null;
  f.target = null;
  f.status = `Retreating to ${regionLabel(home.region)}`;
  news(s, `${nameOf(s, f.owner)}'s ${f.name} breaks off and retreats from the ${nodeName(f.at)}.`, 'war', [f.owner]);
  alert(s, f.owner, `${f.name} was outgunned in the ${nodeName(f.at)} and is falling back to ${regionLabel(home.region)}.`, 'bad', { front: true });
}

function withdraw(s, f) {
  delete s.fleets[f.id];
  const c = s.countries[f.owner];
  if (c) c.refitUntil = s.week + REFIT_WEEKS;
  news(s, `${nameOf(s, f.owner)}'s ${f.name} is beaten in the ${nodeName(f.at)} and withdraws into port.`, 'war', [f.owner]);
  alert(s, f.owner, `${f.name} lost the battle for the ${nodeName(f.at)} and has withdrawn into port. Its ${Math.round(f.ships)} ships${f.carriers ? ` and ${Math.round(f.carriers)} carriers` : ''} need ${REFIT_WEEKS} weeks to refit before they can sail again.`, 'bad', { front: true });
}

/* ---------- Once a week: readiness, shore batteries and blockade attrition ---------- */

export function navyTick(s) {
  if (!s.fleets) initFleets(s);
  placeFleets(s);
  for (const f of fleets(s)) {
    const c = s.countries[f.owner];
    if (!c || !alive(s, f.owner)) { delete s.fleets[f.id]; continue; }
    f.at = seaAt(f.x, f.y) ?? f.at;
    const fighting = f.battle === s.week;
    const port = nearestPort(s, f.owner, f.x, f.y);
    const home = port && mapDistance(f.x, f.y, port.x, port.y) <= OFF_COAST;
    if (!fighting) f.org = Math.min(100, f.org + (home ? 10 : 4) * (1 - 0.6 * (c.short?.oil ?? 0)) * (commsReady(s, f.owner) ? 1.25 : 1));
    // Shore missiles and aircraft from a hostile shore
    if (isStrait(f.at)) {
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
    // Lying off an enemy coast: its missiles and aircraft wear the fleet down
    if (f.mission === 'blockade' && f.target && !moving(f)) {
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

// Can our side put an army ashore here? It needs a fleet of ours or an ally's lying off that coast, at least as
// strong as the enemy's there. Returns a reason, or null.
export function landingControl(s, cid, region) {
  const port = PORTS[region];
  if (!port) return 'there is no open sea off that coast';
  const { mine, theirs } = controlAt(s, cid, port[0], port[1], OFF_COAST + 8);
  if (mine > 0 && mine >= theirs) return null;
  if (!mine) return `no fleet of ours or an ally's is off that coast. Send a fleet there first (click it, then click the coast)`;
  return 'enemy fleets control the waters off that coast. Win the sea first';
}

// The navy escorting an army across: its strength off the landing beaches against the enemy's
export function crossingOdds(s, cid, region) {
  const port = PORTS[region];
  if (!port) return { mine: 0, theirs: 0 };
  return controlAt(s, cid, port[0], port[1], OFF_COAST + 8);
}

/* ---------- Computer-run admirals ---------- */

export function aiNavy(s, c) {
  const mine = fleets(s).filter((f) => f.owner === c.id);
  const ports = portsOf(s, c.id);
  if (!ports.length) return;
  const main = [...ports].sort((a, b) => b.gdp - a.gdp)[0];
  const pool = inPort(s, c);
  // New ships join a fleet in port, or put to sea as a new one
  if (pool.ships + pool.carriers >= 3 && !((c.refitUntil ?? -1) > s.week)) {
    const idle = mine.find((f) => !moving(f) && ports.some((p) => mapDistance(f.x, f.y, p.x, p.y) <= IN_PORT));
    if (idle) reinforceFleet(s, c, { id: idle.id, ships: pool.ships, carriers: pool.carriers });
    else if (mine.length < MAX_FLEETS) {
      // Put to sea only where the enemy doesn't hold the water: otherwise the ships stay safe in harbour
      const strength = fleetStrength(s, { owner: c.id, ships: pool.ships, carriers: pool.carriers, org: 80 });
      const port = [...ports].sort((a, b) => b.gdp - a.gdp).find((p) => controlAt(s, c.id, p.x, p.y, ENGAGE * 2).theirs < strength * 0.8);
      if (port) formFleet(s, c, { region: port.region, ships: pool.ships, carriers: pool.carriers, name: `${nodeName(port.sea)} Fleet` });
    }
  }
  const enemies = [...enemiesOf(s, c.id)].filter((e) => alive(s, e));
  const ready = (f) => !moving(f) && f.org >= 45;
  // At peace: blockading fleets come home
  if (!enemies.length) {
    for (const f of mine) {
      if (f.mission === 'blockade' || (f.mission === 'patrol' && f.mode !== 'escort')) {
        const home = f.port && PORTS[f.port] ? { x: PORTS[f.port][0], y: PORTS[f.port][1] } : main;
        fleetOrder(s, c, { id: f.id, x: home.x, y: home.y, mission: 'hold' });
      }
    }
    return;
  }
  const strengthOf = (id) => fleets(s).filter((f) => f.owner === id).reduce((t, f) => t + fleetStrength(s, f), 0);
  const ours = strengthOf(c.id);
  // Enemy fleets off our coast: meet them, if we can win
  for (const g of fleets(s)) {
    if (!enemies.includes(g.owner)) continue;
    if (!ports.some((p) => mapDistance(g.x, g.y, p.x, p.y) <= OFF_COAST * 2)) continue;
    const { mine: here } = controlAt(s, c.id, g.x, g.y, ENGAGE);
    if (here < fleetStrength(s, g) && ours > fleetStrength(s, g) * 1.2) {
      const pick = mine.filter(ready).sort((a, b) => mapDistance(a.x, a.y, g.x, g.y) - mapDistance(b.x, b.y, g.x, g.y))[0];
      if (pick) fleetOrder(s, c, { id: pick.id, x: g.x, y: g.y, mission: 'hold' });
    }
  }
  // Blockade the weaker enemies' coasts
  for (const e of enemies) {
    if (!portsOf(s, e).length) continue;
    if (mine.some((f) => f.mission === 'blockade' && f.target === e)) continue;
    const theirs = strengthOf(e) + (s.minors[e] ? 2 : 0);
    if (ours < theirs * 1.4) continue;
    const pick = mine.filter(ready).sort((a, b) => fleetStrength(s, b) - fleetStrength(s, a))[0];
    if (pick) fleetOrder(s, c, { id: pick.id, mission: 'blockade', target: e });
  }
  // Big navies stop enemy trade at the straits it depends on
  if (ours > 60 && chance(s, 0.15)) {
    for (const [key, cp] of Object.entries(CHOKEPOINTS)) {
      const hits = enemies.some((e) => cp.importCut?.nations.includes(e) || cp.exportCut?.nations.includes(e));
      if (!hits || mine.some((f) => f.mission === 'patrol' && f.dest && seaAt(...f.dest) === key)) continue;
      const pick = mine.filter(ready).filter((f) => f.mission === 'hold').sort((a, b) => mapDistance(a.x, a.y, NODES[key].x, NODES[key].y) - mapDistance(b.x, b.y, NODES[key].x, NODES[key].y))[0];
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
      id: f.id, owner: f.owner, name: f.name, x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, at: f.at, moving: moving(f),
      carriers: Math.round(f.carriers), mission: f.mission, target: f.target, mode: f.mode, battle: f.battle === s.week,
    };
    return own
      ? { ...base, ships: Math.round(f.ships), org: Math.round(f.org), route: f.route.map(([x, y]) => [Math.round(x), Math.round(y)]), dest: f.dest, status: f.status, exact: true }
      : { ...base, ships: seen ? Math.round(f.ships) : Math.max(1, Math.round(f.ships / 5) * 5), exact: false, seen };
  });
}

export function ordinal(n) {
  const sfx = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${sfx}`;
}
