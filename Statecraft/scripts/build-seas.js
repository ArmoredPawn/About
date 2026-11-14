// Builds the sea map fleets sail on: a grid over the world map (5 map pixels a cell, about 100 km) that says,
// for every cell, whether it is land or which sea or strait it belongs to; and a port for every coastal
// province, the nearest open water to it. Uses the same projection as scripts/build-map.js.
//
//   npm run build:seas   ->   public/js/engine/data/seas.js

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as topojson from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { IGNORED_FEATURES } from '../public/js/engine/data/minors.js';
import { GEO, MAP_SIZE } from '../public/js/engine/data/geo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CELL = 5;
const W = MAP_SIZE.w;
const H = MAP_SIZE.h;
const GW = Math.ceil(W / CELL);
const GH = Math.ceil(H / CELL);

// The map's projection, fitted exactly as build-map.js fits it
const topo = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
const features = topojson.feature(topo, topo.objects.countries).features.filter((f) => !IGNORED_FEATURES.includes(f.properties.name));
const projection = geoNaturalEarth1().rotate([-11, 0]).precision(0);
projection.fitWidth(W, { type: 'FeatureCollection', features });
const [[, y0]] = geoPath(projection).bounds({ type: 'FeatureCollection', features });
projection.translate([projection.translate()[0], projection.translate()[1] - y0 + 6]);
const P = (lon, lat) => projection([lon, lat]);

/* ---------- Land: scanline fill of every land polygon (Antarctica included) ---------- */

const landTopo = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/world-atlas/land-50m.json'), 'utf8'));
const land = topojson.feature(landTopo, landTopo.objects.land);
const rings = [];
let ring = null;
geoPath(projection, {
  moveTo(x, y) { ring = [[x, y]]; rings.push(ring); },
  lineTo(x, y) { ring.push([x, y]); },
  closePath() {},
  arc() {}, rect() {},
})(land);

const isLand = new Uint8Array(GW * GH);
for (const r of rings) {
  if (r.length < 3) continue;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of r) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  for (let gy = Math.max(0, Math.floor(minY / CELL)); gy <= Math.min(GH - 1, Math.ceil(maxY / CELL)); gy++) {
    const cy = gy * CELL + CELL / 2;
    const xs = [];
    for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i];
      const [bx, by] = r[(i + 1) % r.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + (cy - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Cells whose centre lies between this pair of crossings: flip (even-odd, so lakes are holes)
      const from = Math.max(0, Math.ceil((xs[k] - CELL / 2) / CELL));
      const to = Math.min(GW - 1, Math.floor((xs[k + 1] - CELL / 2) / CELL));
      for (let gx = from; gx <= to; gx++) isLand[gy * GW + gx] ^= 1;
    }
  }
}

/* ---------- Straits and canals: carved open so ships can pass ---------- */

const idx = (gx, gy) => gy * GW + gx;
const cellAt = (x, y) => [Math.max(0, Math.min(GW - 1, Math.floor(x / CELL))), Math.max(0, Math.min(GH - 1, Math.floor(y / CELL)))];
function carve(points, width = 0) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = P(...points[i]);
    const [bx, by] = P(...points[i + 1]);
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 3)) + 1;
    for (let k = 0; k <= steps; k++) {
      const [gx, gy] = cellAt(ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps);
      for (let dy = -width; dy <= width; dy++) for (let dx = -width; dx <= width; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
        isLand[idx(x, y)] = 0;
        out.push(idx(x, y));
      }
    }
  }
  return out;
}
// [lon, lat] lines through each narrow passage
const CHANNELS = {
  gibraltar: [[-7.0, 36.0], [-5.6, 35.95], [-4.0, 36.1]],
  bosporus: [[29.4, 41.4], [29.0, 41.05], [28.0, 40.8], [26.6, 40.4], [26.0, 40.0]],
  suez: [[32.3, 31.4], [32.35, 30.6], [32.55, 29.9], [32.6, 29.5]],
  panama: [[-79.95, 9.5], [-79.7, 9.1], [-79.5, 8.8]],
  hormuz: [[55.8, 26.8], [56.4, 26.4], [57.0, 25.9]],
  bab: [[43.0, 13.2], [43.4, 12.6], [43.9, 12.2]],
  malacca: [[98.5, 5.0], [100.4, 3.0], [102.5, 1.6], [104.0, 1.2]],
};
const OPEN = [
  [[12.6, 55.4], [12.7, 55.9], [11.0, 57.5]], // the Danish straits into the Baltic
  [[1.5, 51.0], [1.0, 50.6]], // the Strait of Dover
  [[-5.5, 54.5], [-5.4, 55.1]], // the North Channel
  [[22.5, 39.5], [23.5, 38.0]], // round Greece
  [[120.5, 24.0], [119.5, 24.6]], // the Taiwan Strait
  [[129.5, 34.2], [130.5, 34.8]], // the Korea Strait
];
for (const line of OPEN) carve(line, 0);
const straitCells = {};
for (const [key, line] of Object.entries(CHANNELS)) straitCells[key] = carve(line, 0);

/* ---------- Seas: grown from seed points, with the straits as the gates between them ---------- */

const KEYS = ['atl', 'pac', 'med', 'black', 'red', 'gulf', 'ind', 'eas', 'hormuz', 'malacca', 'suez', 'bab', 'bosporus', 'panama', 'gibraltar'];
const LABEL = Object.fromEntries(KEYS.map((k, i) => [k, i + 1]));
const SEEDS = {
  atl: [[-40, 30], [-20, -25], [-75, 15], [3, 56], [19, 57], [-55, 50], [-40, 60], [30, 72], [-30, -50], [-5, 45]],
  pac: [[-145, 25], [-120, -20], [-150, 0], [-130, -40], [-150, 50], [-175, 58], [170, 70], [175, 10], [160, -20], [170, -45], [155, 40]],
  med: [[18, 35], [5, 38], [30, 34], [25, 37]],
  black: [[34, 43.2]],
  red: [[38.6, 20]],
  gulf: [[51.5, 27]],
  ind: [[75, -8], [65, 15], [88, 12], [100, -30], [55, -30], [110, -40]],
  eas: [[114, 13], [125, 29], [135, 40], [140, 50], [123, 5], [110, 0]],
};
const label = new Uint8Array(GW * GH);
for (const [key, cells] of Object.entries(straitCells)) for (const i of cells) if (!isLand[i]) label[i] = LABEL[key];
// Strait gates also take in the open water right round the passage point
const GATE = { hormuz: [56.4, 26.4], malacca: [100.4, 3.0], bab: [43.4, 12.6], gibraltar: [-5.6, 35.95], bosporus: [28.6, 40.9] };
for (const [key, [lon, lat]] of Object.entries(GATE)) {
  const [gx, gy] = cellAt(...P(lon, lat));
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = gx + dx;
    const y = gy + dy;
    if (x >= 0 && y >= 0 && x < GW && y < GH && !isLand[idx(x, y)] && !label[idx(x, y)]) label[idx(x, y)] = LABEL[key];
  }
}
const queue = [];
for (const [key, points] of Object.entries(SEEDS)) {
  for (const [lon, lat] of points) {
    const [gx, gy] = cellAt(...P(lon, lat));
    const i = idx(gx, gy);
    if (isLand[i]) { console.warn(`seed ${key} ${lon},${lat} is on land`); continue; }
    if (!label[i]) { label[i] = LABEL[key]; queue.push(i); }
  }
}
for (let q = 0; q < queue.length; q++) {
  const i = queue[q];
  const gx = i % GW;
  const gy = Math.floor(i / GW);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = (gx + dx + GW) % GW; // the Pacific wraps round the map's edges
    const y = gy + dy;
    if (y < 0 || y >= GH) continue;
    const j = idx(x, y);
    if (isLand[j] || label[j]) continue;
    label[j] = label[i];
    queue.push(j);
  }
}
// Water no seed reached (the Caspian, the Great Lakes) is not navigable

/* ---------- Ports: the nearest open water to every coastal province ---------- */

const PORTS = {};
for (const [id, g] of Object.entries(GEO)) {
  if (!g.coast) continue;
  const [sx, sy] = cellAt(g.x, g.y);
  const seen = new Set([idx(sx, sy)]);
  const ring = [[sx, sy]];
  let found = null;
  for (let r = 0; r < ring.length && !found; r++) {
    const [x, y] = ring[r];
    if (label[idx(x, y)] && label[idx(x, y)] <= 8) { found = [x, y]; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = (x + dx + GW) % GW;
      const ny = y + dy;
      if (ny < 0 || ny >= GH || seen.has(idx(nx, ny))) continue;
      seen.add(idx(nx, ny));
      ring.push([nx, ny]);
    }
    if (ring.length > 4000) break;
  }
  if (found) PORTS[id] = [found[0] * CELL + CELL / 2, found[1] * CELL + CELL / 2];
}

/* ---------- Write ---------- */

// Run-length encoded labels: label (base 36) and run length (base 36), comma-separated
let rle = '';
for (let i = 0; i < label.length;) {
  let j = i;
  while (j < label.length && label[j] === label[i]) j++;
  rle += `${label[i].toString(36)}${(j - i).toString(36)},`;
  i = j;
}
const counts = {};
for (const v of label) counts[v] = (counts[v] ?? 0) + 1;
console.log('cells per label', Object.fromEntries(Object.entries(counts).map(([k, v]) => [k === '0' ? 'land' : KEYS[k - 1], v])));
console.log('ports', Object.keys(PORTS).length, 'of', Object.values(GEO).filter((g) => g.coast).length, 'coastal provinces');
const round = (v) => Math.round(v * 10) / 10;
writeFileSync(path.join(ROOT, 'public/js/engine/data/seas.js'),
  `// Generated by scripts/build-seas.js. Do not edit by hand.\n` +
  `// The sea grid fleets sail on: ${GW}x${GH} cells of ${CELL} map pixels. Each cell is land (0) or a sea or strait,\n` +
  `// numbered from 1 in the order of SEA_KEYS. PORTS: the nearest open water to each coastal province.\n` +
  `export const SEA_GRID = ${JSON.stringify({ cell: CELL, w: GW, h: GH })};\n` +
  `export const SEA_KEYS = ${JSON.stringify(KEYS)};\n` +
  `export const SEA_RLE = '${rle.slice(0, -1)}';\n` +
  `export const PORTS = ${JSON.stringify(Object.fromEntries(Object.entries(PORTS).map(([k, [x, y]]) => [k, [round(x), round(y)]])))};\n`);
console.log('wrote public/js/engine/data/seas.js', Math.round(rle.length / 1024), 'KB of grid');
