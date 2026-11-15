// Builds the cities for the close-up war view from Natural Earth's populated places (1:50m):
//   public/js/engine/data/cities.js   [name, province, x, y, population in thousands, capital]
//
// Each city is placed in the province whose outline (public/data/map.json) contains it, using the same map
// projection as scripts/build-map.js. Cities of a quarter of a million or more are kept, every national capital,
// and the largest city of any province that would otherwise have none; at most eight per province.
//
// Run with `npm run build:cities` (it downloads the data), or `node scripts/build-cities.js <places.geojson>`.
// The output is committed.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as topojson from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { IGNORED_FEATURES } from '../public/js/engine/data/minors.js';
import { COUNTRIES } from '../public/js/engine/data/countries.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson';
const W = 2000;
const MIN_POP = 250000;
const PER_PROVINCE = 8;

// The same projection as the map
const topo = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
const features = topojson.feature(topo, topo.objects.countries).features.filter((f) => !IGNORED_FEATURES.includes(f.properties.name));
const projection = geoNaturalEarth1().rotate([-11, 0]).precision(0);
projection.fitWidth(W, { type: 'FeatureCollection', features });
const [[, y0]] = geoPath(projection).bounds({ type: 'FeatureCollection', features });
projection.translate([projection.translate()[0], projection.translate()[1] - y0 + 6]);

// Province outlines back from their compact SVG paths: "M x y l dx dy dx dy ... z", one or more rings
const map = JSON.parse(readFileSync(path.join(ROOT, 'public/data/map.json'), 'utf8'));
const shapes = [];
for (const [id, d] of Object.entries(map.regions)) {
  const rings = [];
  for (const piece of d.split('M').filter(Boolean)) {
    const nums = piece.replace(/[lz]/g, ' ').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length < 6) continue;
    let x = nums[0];
    let y = nums[1];
    const ring = [[x, y]];
    for (let i = 2; i + 1 < nums.length; i += 2) { x += nums[i]; y += nums[i + 1]; ring.push([x, y]); }
    rings.push(ring);
  }
  if (!rings.length) continue;
  const xs = rings.flat().map((p) => p[0]);
  const ys = rings.flat().map((p) => p[1]);
  shapes.push({ id, rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
}

function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// A city of one of the playable countries belongs in one of that country's provinces (a border city can fall
// on the wrong side of a simplified border otherwise)
function provinceAt(pt, allowed = () => true) {
  const hits = shapes.filter((sh) => allowed(sh.id) && pt[0] >= sh.box[0] && pt[0] <= sh.box[2] && pt[1] >= sh.box[1] && pt[1] <= sh.box[3]);
  for (const sh of hits) {
    let n = 0;
    for (const ring of sh.rings) if (inside(pt, ring)) n++;
    if (n % 2 === 1) return sh.id;
  }
  // Ports and coastal cities can fall just outside a simplified coastline: take the nearest outline within 6 px
  let best = null;
  for (const sh of shapes) {
    if (!allowed(sh.id)) continue;
    if (pt[0] < sh.box[0] - 6 || pt[0] > sh.box[2] + 6 || pt[1] < sh.box[1] - 6 || pt[1] > sh.box[3] + 6) continue;
    for (const ring of sh.rings) {
      for (const [x, y] of ring) {
        const d = Math.hypot(x - pt[0], y - pt[1]);
        if (d <= 12 && (!best || d < best.d)) best = { id: sh.id, d };
      }
    }
  }
  return best?.id ?? null;
}

const file = process.argv[2];
const places = file ? JSON.parse(readFileSync(file, 'utf8')) : await (await fetch(SOURCE)).json();

const byProvince = new Map();
let unplaced = 0;
for (const f of places.features) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const pt = projection([lon, lat]);
  if (!pt) continue;
  const iso = String(p.adm0_a3 ?? '').toLowerCase();
  const id = provinceAt(pt, COUNTRIES[iso] ? (pid) => pid.startsWith(`${iso}-`) : () => true);
  if (!id) { unplaced++; continue; }
  const pop = Math.max(p.pop_max ?? 0, p.pop_min ?? 0);
  const capital = p.adm0cap === 1 || p.featurecla === 'Admin-0 capital';
  const list = byProvince.get(id) ?? byProvince.set(id, []).get(id);
  list.push({ name: String(p.name).replace(/\s+/g, ' ').trim(), x: Math.round(pt[0] * 10) / 10, y: Math.round(pt[1] * 10) / 10, pop: Math.round(pop / 1000), capital });
}

const rows = [];
for (const [id, list] of [...byProvince].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  list.sort((a, b) => b.pop - a.pop);
  // The same city can appear twice (a capital and its metro): keep one per name
  const seen = new Set();
  const keep = list.filter((c) => !seen.has(c.name) && seen.add(c.name))
    .filter((c, i) => i === 0 || c.capital || c.pop * 1000 >= MIN_POP)
    .slice(0, PER_PROVINCE);
  for (const c of keep) rows.push([c.name, id, c.x, c.y, c.pop, c.capital ? 1 : 0]);
}

// The outline of each province with cities, as a convex hull of at most 24 points: enough for the game to
// measure how far across a province a front has come, exactly as the map draws it
function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const h = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (h.length <= 24) return h;
  const step = h.length / 24;
  return Array.from({ length: 24 }, (_, i) => h[Math.floor(i * step)]);
}
const withCities = new Set(rows.map((r) => r[1]));
const hulls = {};
for (const sh of shapes) {
  if (!withCities.has(sh.id)) continue;
  hulls[sh.id] = hull(sh.rings.flat()).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

writeFileSync(path.join(ROOT, 'public/js/engine/data/cities.js'),
  '// Generated by scripts/build-cities.js from Natural Earth populated places. Do not edit by hand.\n'
  + '// [name, province, x, y, population (thousands), national capital]\n'
  + `export const CITIES = ${JSON.stringify(rows)};\n`
  + '// Each province\'s outline as a convex hull, for measuring how far a front has come across it\n'
  + `export const HULLS = ${JSON.stringify(hulls)};\n`);
console.log(`${rows.length} cities in ${byProvince.size} provinces (${unplaced} places fell outside every province)`);
