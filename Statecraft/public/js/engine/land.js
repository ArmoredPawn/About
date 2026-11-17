// The ground armies fight over. The map is cut into cells about 50 km across (data/land.js), each part of one
// province. Provinces are what the economy counts (output, resources, cities, garrisons, forts); the cells are
// what armies take. A cell belongs to whoever controls its province unless an army has taken it: s.occ maps those
// cells to their new holder. So a front can run through the middle of a province, and a province changes hands
// once most of it has been taken.
//
// Only armies hold ground. An army on the attack takes the enemy's cells around it as it goes, unless an enemy
// army stands close enough to hold them (its zone of control): those have to be won in battle. Land the enemy
// has no army on is simply marched through.

import { LAND_GRID, LAND_RLE } from './data/land.js';
import { GEO, ORDER, MAP_SIZE } from './data/geo.js';
import { PROVINCES, TERRAIN } from './data/regions.js';
import { MINOR_TERRAIN } from './names.js';
import { CITIES } from './data/cities.js';
import { atWar, friendlyGround } from './core.js';

export const CELL = LAND_GRID.cell;
export const GW = LAND_GRID.w;
export const GH = LAND_GRID.h;
export const CELL_KM = CELL * 20;
const W = MAP_SIZE.w;

// Province index of every cell (-1: sea)
export const REG = (() => {
  const out = new Int16Array(GW * GH);
  let i = 0;
  for (const run of LAND_RLE.split(',')) {
    const [v, n] = run.split('.');
    const len = parseInt(n, 36);
    out.fill(parseInt(v, 36) - 1, i, i + len);
    i += len;
  }
  return out;
})();
export const INDEX = Object.fromEntries(ORDER.map((id, i) => [id, i]));
// The cells of each province
export const CELLS_OF = (() => {
  const lists = ORDER.map(() => []);
  for (let i = 0; i < REG.length; i++) if (REG[i] >= 0) lists[REG[i]].push(i);
  return Object.fromEntries(ORDER.map((id, k) => [id, Int32Array.from(lists[k])]));
})();
export const regionAt = (i) => (i >= 0 && REG[i] >= 0 ? ORDER[REG[i]] : null);
export const isLand = (i) => i >= 0 && i < REG.length && REG[i] >= 0;

const wrap = (x) => ((x % W) + W) % W;
export function cellAt(x, y) {
  const gx = Math.floor(wrap(x) / CELL) % GW;
  const gy = Math.floor(y / CELL);
  if (gy < 0 || gy >= GH) return -1;
  return gy * GW + gx;
}
export const cellX = (i) => (i % GW) * CELL + CELL / 2;
export const cellY = (i) => Math.floor(i / GW) * CELL + CELL / 2;
export const cellXY = (i) => [cellX(i), cellY(i)];

// The nearest land cell to a point (within about 600 km), optionally one that passes a test
export function nearestLand(x, y, ok = null, max = 12) {
  const c0 = cellAt(x, y);
  if (c0 >= 0 && isLand(c0) && (!ok || ok(c0))) return c0;
  const gx0 = Math.floor(wrap(x) / CELL);
  const gy0 = Math.floor(y / CELL);
  for (let r = 1; r <= max; r++) {
    let best = -1;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const gy = gy0 + dy;
      if (gy < 0 || gy >= GH) continue;
      const i = gy * GW + ((gx0 + dx + GW) % GW);
      if (!isLand(i) || (ok && !ok(i))) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

// The cell at the heart of a province: its centre if that is in it, else the cell nearest the centre
export function provinceCell(id) {
  const g = GEO[id];
  const cells = CELLS_OF[id];
  if (!g || !cells?.length) return -1;
  const c = cellAt(g.x, g.y);
  if (REG[c] === INDEX[id]) return c;
  let best = cells[0];
  let bd = Infinity;
  for (const i of cells) { const d = (cellX(i) - g.x) ** 2 + (cellY(i) - g.y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

// Crossings: neighbouring provinces whose ground doesn't touch on the grid because a narrow strait lies between
// them (the Bosporus, the Danish straits, Kerch, Messina...). Armies cross them as by bridge or ferry, so their
// nearest cells on either side are joined. Gaps wider than about 150 km are open sea, not a crossing.
export const BRIDGES = (() => {
  const out = new Map();
  const link = (a, b) => { (out.get(a) ?? out.set(a, []).get(a)).push(b); (out.get(b) ?? out.set(b, []).get(b)).push(a); };
  const side4 = (x) => {
    const gx = x % GW;
    const gy = Math.floor(x / GW);
    const nb = [gy * GW + ((gx + 1) % GW), gy * GW + ((gx - 1 + GW) % GW)];
    if (gy > 0) nb.push(x - GW);
    if (gy < GH - 1) nb.push(x + GW);
    return nb;
  };
  const isCoast = (i) => side4(i).some((j) => REG[j] < 0);
  const closest = (as, bs) => {
    let best = null;
    for (const i of as) for (const j of bs) {
      let dx = Math.abs((i % GW) - (j % GW));
      if (dx > GW / 2) dx = GW - dx;
      const d = Math.hypot(dx, Math.floor(i / GW) - Math.floor(j / GW));
      if (!best || d < best[2]) best = [i, j, d];
    }
    return best && best[2] <= 3.5 ? best : null;
  };
  // A province split by a strait (Istanbul across the Bosporus): its pieces are joined
  for (const id of ORDER) {
    const cells = new Set(CELLS_OF[id] ?? []);
    const seen = new Set();
    const pieces = [];
    for (const i of cells) {
      if (seen.has(i)) continue;
      const piece = [];
      const q = [i];
      seen.add(i);
      while (q.length) {
        const x = q.pop();
        piece.push(x);
        for (const j of side4(x)) if (cells.has(j) && !seen.has(j)) { seen.add(j); q.push(j); }
      }
      pieces.push(piece.filter(isCoast));
    }
    for (let x = 0; x < pieces.length; x++) for (let y = x + 1; y < pieces.length; y++) {
      const best = closest(pieces[x], pieces[y]);
      if (best) link(best[0], best[1]);
    }
  }
  // Neighbouring provinces whose ground doesn't touch: joined across the strait between them
  for (const [id, g] of Object.entries(GEO)) {
    const a = INDEX[id];
    if (a == null) continue;
    for (const nb of g.adj) {
      const b = INDEX[nb];
      if (b == null || b <= a) continue;
      if ([...(CELLS_OF[id] ?? [])].some((i) => side4(i).some((j) => REG[j] === b))) continue;
      const best = closest([...CELLS_OF[id]].filter(isCoast), [...CELLS_OF[nb]].filter(isCoast));
      if (best) link(best[0], best[1]);
    }
  }
  return out;
})();

// Neighbouring cells: the four sides (for what is connected to what) or all eight (for marching), and across a
// crossing
export function neighbours4(i) {
  const gx = i % GW;
  const gy = Math.floor(i / GW);
  const out = [gy * GW + ((gx + 1) % GW), gy * GW + ((gx - 1 + GW) % GW)];
  if (gy > 0) out.push(i - GW);
  if (gy < GH - 1) out.push(i + GW);
  const b = BRIDGES.get(i);
  if (b) out.push(...b);
  return out;
}
const STEPS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

const TERRAIN_OF = Object.fromEntries(PROVINCES.map((p) => [p.id, p.terrain]));
export const terrainAt = (i) => TERRAIN[TERRAIN_OF[regionAt(i)] ?? MINOR_TERRAIN[regionAt(i)] ?? 'plains'];

/* ---------- Who holds each cell ---------- */

// The occupied cells, kept as a Map beside the state (s.occ is a plain object, so the game can be saved and sent,
// but looking a number up in an object is slow). Rebuilt only if the state's own record changed underneath it.
const occMaps = new WeakMap();
function occMap(s) {
  let m = occMaps.get(s);
  if (!m || m.src !== s.occ || m.rev !== (s.occRev ?? 0)) {
    m = { src: s.occ, rev: s.occRev ?? 0, map: new Map(Object.entries(s.occ ?? {}).map(([k, v]) => [Number(k), v])) };
    occMaps.set(s, m);
  }
  return m.map;
}
// After a change made here, the Map is changed the same way and kept
function occSet(s, i, holder) {
  const m = occMaps.get(s);
  const fresh = m && m.src === s.occ && m.rev === (s.occRev ?? 0);
  if (holder == null) delete s.occ[i]; else s.occ[i] = holder;
  s.occRev = (s.occRev ?? 0) + 1;
  if (fresh) { if (holder == null) m.map.delete(i); else m.map.set(i, holder); m.rev = s.occRev; }
}
const ORDER_IDS = ORDER;
export const holderAt = (s, i) => occMap(s).get(i) ?? s.regions[ORDER_IDS[REG[i]]]?.ctrl ?? null;

// Hand a cell to a new holder. Returns true if it changed hands.
export function setHolder(s, i, holder) {
  const id = regionAt(i);
  const reg = s.regions[id];
  if (!reg) return false;
  const was = holderAt(s, i);
  if (was === holder) return false;
  s.occ ??= {};
  occSet(s, i, holder === reg.ctrl ? null : holder);
  (s.dirtyRegions ??= {})[id] = true;
  return true;
}

// A province has changed hands as a whole (it was captured, ceded, or rose up): its cells are rewritten so that
// the ground each side held is kept
export function rebase(s, id, newCtrl, oldCtrl) {
  const reg = s.regions[id];
  if (!reg) return;
  s.occ ??= {};
  for (const i of CELLS_OF[id]) {
    const h = s.occ[i] ?? oldCtrl;
    if (h === newCtrl) delete s.occ[i]; else s.occ[i] = h;
  }
  s.occRev = (s.occRev ?? 0) + 1;
}

// Every cell in a province goes back to whoever controls it (after a peace, a settlement or an uprising)
export function clearProvince(s, id) {
  if (!s.occ) return;
  let changed = false;
  for (const i of CELLS_OF[id]) if (s.occ[i] != null) { delete s.occ[i]; changed = true; }
  if (changed) s.occRev = (s.occRev ?? 0) + 1;
}

// Occupied cells whose holder is no longer at war with the province's controller go back to it (after a peace),
// as do any left behind by a province changing hands without a war
export function normaliseOcc(s) {
  if (!s.occ) return;
  let changed = false;
  for (const k of Object.keys(s.occ)) {
    const i = Number(k);
    const reg = s.regions[regionAt(i)];
    const h = s.occ[k];
    if (!reg || h === reg.ctrl || !atWar(s, h, reg.ctrl)) { delete s.occ[k]; changed = true; (s.dirtyRegions ??= {})[reg?.id] = true; }
  }
  if (changed) s.occRev = (s.occRev ?? 0) + 1;
}

/* ---------- Cities on the grid ---------- */

// Cities by cell: a city falls with the cell it stands in
export const CITY_CELL = new Map();
export const CITIES_AT = new Map();
for (const [name, region, x, y, pop, capital] of CITIES) {
  let i = cellAt(x, y);
  if (regionAt(i) !== region) i = nearestLand(x, y, (c) => regionAt(c) === region, 6);
  if (i < 0) i = provinceCell(region);
  CITY_CELL.set(`${region}|${name}`, i);
  (CITIES_AT.get(i) ?? CITIES_AT.set(i, []).get(i)).push({ name, region, pop, capital: Boolean(capital) });
}
export const cityCell = (region, name) => CITY_CELL.get(`${region}|${name}`) ?? -1;

/* ---------- Provinces from their cells ---------- */

// How much of a province each side holds: by ground (for who controls it) and by output (its cities, and its
// countryside by area), for the economy
export function provinceShares(s, id, cityShares = null) {
  const cells = CELLS_OF[id];
  const ground = {};
  for (const i of cells) { const h = holderAt(s, i); ground[h] = (ground[h] ?? 0) + 1; }
  const n = cells.length || 1;
  for (const k of Object.keys(ground)) ground[k] /= n;
  if (!cityShares) return { ground, output: ground };
  let cityTotal = 0;
  const output = {};
  for (const c of cityShares) {
    const h = holderAt(s, cityCell(id, c.name));
    output[h] = (output[h] ?? 0) + c.share;
    cityTotal += c.share;
  }
  for (const [h, g] of Object.entries(ground)) output[h] = (output[h] ?? 0) + g * (1 - cityTotal);
  return { ground, output };
}

/* ---------- Paths ---------- */

// The way for an army from one point to another over the land: waypoints, or null. It may cross the ground of
// its own side and anywhere it has access to; enemy ground only on an offensive; never a neutral's. A march
// order also steers clear of enemy armies (avoid: [[x, y, radius]]).
export function landPath(s, owner, from, to, { offensive = false, avoid = [], speedOf = null, maxCells = 60000 } = {}) {
  const start = nearestLand(from[0], from[1]);
  const goal = nearestLand(to[0], to[1]);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [[cellX(goal), cellY(goal)]];
  const passable = (i) => {
    const h = holderAt(s, i);
    if (h == null) return false;
    if (friendlyGround(s, owner, h)) return true;
    return offensive && atWar(s, owner, h);
  };
  if (!passable(goal) && !(offensive && atWar(s, owner, holderAt(s, goal)))) return null;
  const tx = goal % GW;
  const ty = Math.floor(goal / GW);
  const hfun = (i) => { let dx = Math.abs((i % GW) - tx); if (dx > GW / 2) dx = GW - dx; return Math.hypot(dx, Math.floor(i / GW) - ty) * 0.85; };
  const g = new Map([[start, 0]]);
  const came = new Map();
  const heap = new Heap();
  heap.push(start, hfun(start));
  const closed = new Set();
  let found = false;
  while (heap.size) {
    const i = heap.pop();
    if (i === goal) { found = true; break; }
    if (closed.has(i)) continue;
    closed.add(i);
    if (closed.size > maxCells) break;
    const gx = i % GW;
    const gy = Math.floor(i / GW);
    for (const [dx, dy, len] of STEPS8) {
      const ny = gy + dy;
      if (ny < 0 || ny >= GH) continue;
      const j = ny * GW + ((gx + dx + GW) % GW);
      if (!isLand(j) || closed.has(j) || !passable(j)) continue;
      // No slipping diagonally between two cells that can't be crossed
      if (dx && dy && (!isLand(gy * GW + ((gx + dx + GW) % GW)) || !isLand(ny * GW + gx))) continue;
      const t = terrainAt(j);
      const infra = s.regions[regionAt(j)]?.infra ?? 0;
      let cost = len * t.move * (1 - 0.04 * infra) * (speedOf ? speedOf(j) : 1);
      if (!friendlyGround(s, owner, holderAt(s, j))) cost *= 1.15;
      if (avoid.length) {
        const x = cellX(j);
        const y = cellY(j);
        for (const [ax, ay, r] of avoid) {
          let dx2 = Math.abs(ax - x);
          if (dx2 > W / 2) dx2 = W - dx2;
          if (dx2 * dx2 + (ay - y) ** 2 < r * r) { cost += 12; break; }
        }
      }
      const ng = g.get(i) + cost;
      if (ng < (g.get(j) ?? Infinity)) { g.set(j, ng); came.set(j, i); heap.push(j, ng + hfun(j)); }
    }
    // Across a strait, by bridge or ferry
    for (const j of BRIDGES.get(i) ?? []) {
      if (closed.has(j) || !passable(j)) continue;
      let dx = Math.abs((j % GW) - gx);
      if (dx > GW / 2) dx = GW - dx;
      const ng = g.get(i) + Math.hypot(dx, Math.floor(j / GW) - gy) * 1.5;
      if (ng < (g.get(j) ?? Infinity)) { g.set(j, ng); came.set(j, i); heap.push(j, ng + hfun(j)); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let i = goal; i !== start; i = came.get(i)) cells.push(i);
  cells.reverse();
  // Waypoints with x unwrapped, so a march across the edge of the map runs smoothly
  const pts = [];
  let px = cellX(start);
  for (const i of cells) {
    let x = cellX(i);
    while (x - px > W / 2) x -= W;
    while (px - x > W / 2) x += W;
    pts.push([x, cellY(i)]);
    px = x;
  }
  return simplify(pts);
}

// Drop waypoints that run in a straight line
function simplify(pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = pts[k];
    const [cx, cy] = pts[k + 1];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) > 0.01) out.push(pts[k]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

class Heap {
  constructor() { this.a = []; this.k = []; }
  get size() { return this.a.length; }
  push(item, key) {
    const a = this.a;
    const k = this.k;
    let i = a.length;
    a.push(item); k.push(key);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; a[i] = a[p]; k[i] = k[p]; i = p; }
    a[i] = item; k[i] = key;
  }
  pop() {
    const a = this.a;
    const k = this.k;
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
        a[i] = a[c]; k[i] = k[c]; i = c;
      }
      a[i] = item; k[i] = key;
    }
    return top;
  }
}

/* ---------- Supply lines and pockets ---------- */

const CAPITAL_OF = new Map(PROVINCES.filter((p) => p.capital).map((p) => [p.country, p.id]));
export const capitalOf = (id) => CAPITAL_OF.get(id) ?? id;

// For one country at war: how far (in cells) every cell its side holds is from the heartland over its side's
// ground, and the stretches cut off from it entirely. Sources are the capital's cells (and allies' capitals);
// with the capital lost, the largest stretch of home soil.
export function supplyMap(s, holder) {
  const sides = (h) => h === holder || friendlyGround(s, holder, h);
  const dist = new Map();
  const queue = [];
  const sourceOf = (cid) => {
    const cap = CAPITAL_OF.get(cid) ?? (s.regions[cid] ? cid : null);
    if (!cap || !CELLS_OF[cap]) return [];
    return [...CELLS_OF[cap]].filter((i) => holderAt(s, i) === cid);
  };
  let sources = sourceOf(holder);
  for (const c of Object.values(s.countries)) if (c.id !== holder && sides(c.id) && !atWar(s, c.id, holder)) sources.push(...sourceOf(c.id).slice(0, 40));
  if (!sourceOf(holder).length) {
    // The heartland: the biggest connected stretch of our own home soil
    const seen = new Set();
    let best = [];
    for (const reg of Object.values(s.regions)) {
      if (reg.owner !== holder) continue;
      for (const i of CELLS_OF[reg.id]) {
        if (seen.has(i) || holderAt(s, i) !== holder) continue;
        const comp = [];
        const q = [i];
        seen.add(i);
        while (q.length) {
          const x = q.pop();
          comp.push(x);
          for (const j of neighbours4(x)) {
            if (seen.has(j) || !isLand(j)) continue;
            const r = s.regions[regionAt(j)];
            if (r.owner !== holder || holderAt(s, j) !== holder) continue;
            seen.add(j);
            q.push(j);
          }
        }
        if (comp.length > best.length) best = comp;
      }
    }
    sources = [...sources, ...best];
  }
  for (const i of sources) if (!dist.has(i)) { dist.set(i, 0); queue.push(i); }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const d = dist.get(i) + 1;
    for (const j of neighbours4(i)) {
      if (dist.has(j) || !isLand(j) || !sides(holderAt(s, j))) continue;
      dist.set(j, d);
      queue.push(j);
    }
  }
  return dist;
}

// Cells a country holds that its supply map doesn't reach, grouped into the stretches they form
export function cutOff(s, holder, dist) {
  const lost = new Set();
  // Only the provinces this country holds some of
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== holder && !(reg.held?.[holder] > 0)) continue;
    for (const i of CELLS_OF[reg.id]) if (!dist.has(i) && holderAt(s, i) === holder) lost.add(i);
  }
  for (const [i, h] of occMap(s)) if (h === holder && !dist.has(i)) lost.add(i);
  const groups = [];
  const seen = new Set();
  for (const i of lost) {
    if (seen.has(i)) continue;
    const comp = [];
    const q = [i];
    seen.add(i);
    while (q.length) {
      const x = q.pop();
      comp.push(x);
      for (const j of neighbours4(x)) if (lost.has(j) && !seen.has(j)) { seen.add(j); q.push(j); }
    }
    groups.push(comp);
  }
  return groups;
}

/* ---------- For the map ---------- */

// The occupied cells as runs: [first cell, length, holder], in cell order
export function occRuns(s) {
  const keys = Object.keys(s.occ ?? {}).map(Number).sort((a, b) => a - b);
  const out = [];
  for (const i of keys) {
    const h = s.occ[i];
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === i && last[2] === h) last[1]++;
    else out.push([i, 1, h]);
  }
  return out;
}
export function cellRuns(cells) {
  const sorted = [...cells].sort((a, b) => a - b);
  const out = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === i) last[1]++;
    else out.push([i, 1]);
  }
  return out;
}

// Distance across the map between two points, the short way round
export function dist(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx);
  if (dx > W / 2) dx = W - dx;
  return Math.hypot(dx, ay - by);
}
export { wrap };
