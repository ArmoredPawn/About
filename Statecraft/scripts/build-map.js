// Builds the world map from Natural Earth (world-atlas, 1:50m):
//   public/data/map.json            SVG paths for every province, the ocean outline and a graticule
//   public/js/engine/data/geo.js    each province's map position, coordinates, neighbours and coastline
//
// Each playable country is split between its provinces by nearest seed (Voronoi cells clipped to the country),
// overseas territories join a named province, and every other country is one province of its own.
// Run with `npm run build:map` after changing provinces or seeds. The outputs are committed.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as topojson from 'topojson-client';
import { geoNaturalEarth1, geoPath, geoStream, geoGraticule } from 'd3-geo';
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import { COUNTRIES } from '../public/js/engine/data/countries.js';
import { PROVINCES, EXTRA_SEEDS, TERRITORIES, ATLAS_NAMES, CROSSINGS } from '../public/js/engine/data/regions.js';
import { MINORS, defaultMinor, IGNORED_FEATURES } from '../public/js/engine/data/minors.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 2000;
const SIMPLIFY = 0.45; // px: points closer than this to the last kept point are dropped
const KEY_GRID = 20; // vertex matching grid: 1/20 px

const topo = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
const features = topojson.feature(topo, topo.objects.countries).features
  .filter((f) => !IGNORED_FEATURES.includes(f.properties.name));
const byName = new Map(features.map((f) => [f.properties.name, f]));

const projection = geoNaturalEarth1().rotate([-11, 0]).precision(0);
projection.fitWidth(W, { type: 'FeatureCollection', features });
const [[, y0], [, y1]] = geoPath(projection).bounds({ type: 'FeatureCollection', features });
projection.translate([projection.translate()[0], projection.translate()[1] - y0 + 6]);
const H = Math.ceil(y1 - y0 + 12);

/* ---------- Projecting geometry into planar multipolygons ---------- */

function project(geometry) {
  const rings = [];
  let ring = null;
  geoStream(geometry, projection.stream({
    point(x, y) { ring.push([x, y]); },
    lineStart() { ring = []; },
    lineEnd() { if (ring.length > 2) rings.push(ring); },
    polygonStart() {}, polygonEnd() {}, sphere() {},
  }));
  if (!rings.length) return [];
  // Even-odd combination keeps holes as holes whatever order the clipped rings come in
  return polygonClipping.xor(...rings.map((r) => [close(r)]));
}

function close(ring) {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}

const unionAll = (polys) => polys.filter((p) => p.length).reduce((acc, p) => (acc.length ? polygonClipping.union(acc, p) : p), []);
const projected = new Map(features.map((f) => [f.properties.name, project(f.geometry)]));

/* ---------- Assigning features to provinces ---------- */

const shapes = new Map(); // province id -> multipolygon
const labels = new Map(); // province id -> [x, y]
const used = new Set();
const warnings = [];

const atlasOf = (cid) => ATLAS_NAMES[cid] ?? [COUNTRIES[cid].name];

for (const cid of Object.keys(COUNTRIES)) {
  const mainNames = atlasOf(cid);
  const main = unionAll(mainNames.map((n) => {
    if (!byName.has(n)) throw new Error(`No map feature named "${n}" for ${cid}`);
    used.add(n);
    return projected.get(n);
  }));
  const provinces = PROVINCES.filter((p) => p.country === cid);
  const seeds = [];
  for (const p of provinces) {
    const pt = projection([p.lon, p.lat]);
    labels.set(p.id, pt);
    if (p.territoryOnly) continue;
    seeds.push({ id: p.id, pt });
    for (const [lat, lon] of EXTRA_SEEDS[p.id] ?? []) seeds.push({ id: p.id, pt: projection([lon, lat]) });
  }
  const parts = new Map();
  if (seeds.length === 1) {
    parts.set(seeds[0].id, [main]);
  } else {
    const b = bbox(main);
    const voronoi = Delaunay.from(seeds.map((s) => s.pt)).voronoi([b[0] - 20, b[1] - 20, b[2] + 20, b[3] + 20]);
    seeds.forEach((s, i) => {
      const cell = voronoi.cellPolygon(i);
      if (!cell) return;
      const piece = polygonClipping.intersection(main, [cell]);
      if (piece.length) (parts.get(s.id) ?? parts.set(s.id, []).get(s.id)).push(piece);
    });
  }
  for (const p of provinces) {
    if (p.territoryOnly) continue;
    const shape = unionAll(parts.get(p.id) ?? []);
    if (!shape.length) warnings.push(`${p.id} has no land: move its seed inside ${COUNTRIES[cid].name}`);
    shapes.set(p.id, shape);
  }
}

for (const [feature, pid] of Object.entries(TERRITORIES)) {
  if (!byName.has(feature)) { warnings.push(`Territory "${feature}" isn't on the map`); continue; }
  used.add(feature);
  shapes.set(pid, unionAll([shapes.get(pid) ?? [], projected.get(feature)]));
}

const minorList = new Map();
for (const minor of Object.values(MINORS)) {
  for (const f of minor.features) {
    if (!byName.has(f)) { warnings.push(`Minor feature "${f}" isn't on the map`); continue; }
    used.add(f);
    minorList.set(minor.id, minor);
    shapes.set(minor.id, unionAll([shapes.get(minor.id) ?? [], projected.get(f)]));
  }
}
const extraMinors = [];
for (const f of features) {
  const name = f.properties.name;
  if (used.has(name)) continue;
  const minor = defaultMinor(name);
  extraMinors.push({ id: minor.id, name });
  minorList.set(minor.id, minor);
  shapes.set(minor.id, projected.get(name));
}
for (const id of minorList.keys()) labels.set(id, labelPoint(shapes.get(id)));

/* ---------- Neighbours and coastline ---------- */

const key = ([x, y]) => `${Math.round(x * KEY_GRID)},${Math.round(y * KEY_GRID)}`;

// Vertices used by exactly one country feature are on a coast
const featureCount = new Map();
for (const [name, mp] of projected) {
  const seen = new Set();
  for (const poly of mp) for (const ring of poly) for (const pt of ring) seen.add(key(pt));
  for (const k of seen) featureCount.set(k, (featureCount.get(k) ?? 0) + 1);
}

const owners = new Map(); // vertex key -> province ids
const coast = new Set();
for (const [id, mp] of shapes) {
  for (const poly of mp) for (const ring of poly) for (const pt of ring) {
    const k = key(pt);
    (owners.get(k) ?? owners.set(k, new Set()).get(k)).add(id);
    if (featureCount.get(k) === 1) coast.add(id);
  }
}
const adj = new Map([...shapes.keys()].map((id) => [id, new Set()]));
for (const [k, ids] of owners) {
  const [gx, gy] = k.split(',').map(Number);
  const near = new Set(ids);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (dx || dy) for (const id of owners.get(`${gx + dx},${gy + dy}`) ?? []) near.add(id);
  }
  if (near.size < 2) continue;
  for (const a of near) for (const b of near) if (a !== b) adj.get(a).add(b);
}
for (const [a, b] of CROSSINGS) {
  if (!adj.has(a) || !adj.has(b)) { warnings.push(`Crossing ${a}–${b} names an unknown province`); continue; }
  adj.get(a).add(b);
  adj.get(b).add(a);
}

/* ---------- Writing the outputs ---------- */

const order = [...PROVINCES.map((p) => p.id), ...[...minorList.keys()].sort()];
const regionPaths = {};
const geo = {};
for (const id of order) {
  const mp = shapes.get(id) ?? [];
  regionPaths[id] = pathOf(mp);
  const [x, y] = labels.get(id) ?? labelPoint(mp);
  const [lon, lat] = projection.invert([x, y]);
  geo[id] = {
    x: round(x), y: round(y), lat: round(lat), lon: round(lon),
    area: Math.round(area(mp)), coast: coast.has(id), adj: [...adj.get(id) ?? []].sort(),
  };
}

const sphere = geoPath(projection)({ type: 'Sphere' });
const graticule = geoPath(projection)(geoGraticule().step([20, 20])());
writeFileSync(path.join(ROOT, 'public/data/map.json'), JSON.stringify({
  w: W, h: H, sphere: compactPath(sphere), graticule: compactPath(graticule), regions: regionPaths,
}));

const minorsOut = Object.fromEntries([...minorList.values()].map((m) => [m.id, m]));
writeFileSync(path.join(ROOT, 'public/js/engine/data/geo.js'),
  `// Generated by scripts/build-map.js from Natural Earth. Do not edit by hand.\n` +
  `// Map size, each province's position (x, y on the map; lat, lon), area in map pixels, coast and neighbours,\n` +
  `// and the minor nations made from map features that data/minors.js doesn't list.\n` +
  `export const MAP_SIZE = ${JSON.stringify({ w: W, h: H })};\n` +
  `export const ORDER = ${JSON.stringify(order)};\n` +
  `export const GEO = ${JSON.stringify(geo)};\n` +
  `export const EXTRA_MINORS = ${JSON.stringify(Object.fromEntries(extraMinors.map((m) => [m.id, minorsOut[m.id]])))};\n`);

const lonely = order.filter((id) => !geo[id].adj.length && !geo[id].coast);
if (lonely.length) warnings.push(`Provinces with no neighbours and no coast: ${lonely.join(', ')}`);
for (const w of warnings) console.warn(`warning: ${w}`);
const size = JSON.stringify(regionPaths).length;
console.log(`${order.length} provinces (${minorList.size} minor nations), map ${W}×${H}, paths ${(size / 1024).toFixed(0)} KB`);

/* ---------- Geometry helpers ---------- */

function bbox(mp) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of mp) for (const [x, y] of poly[0]) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return s / 2;
}

function area(mp) {
  return mp.reduce((s, poly) => s + Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
}

// The centroid of the largest piece, or its first vertex if that falls outside a concave shape
function labelPoint(mp) {
  let best = null;
  let bestArea = -1;
  for (const poly of mp) {
    const a = Math.abs(ringArea(poly[0]));
    if (a > bestArea) { bestArea = a; best = poly[0]; }
  }
  if (!best) return [0, 0];
  let cx = 0, cy = 0, s = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1];
    cx += (best[j][0] + best[i][0]) * f;
    cy += (best[j][1] + best[i][1]) * f;
    s += f;
  }
  if (!s) return best[0];
  const c = [cx / (3 * s), cy / (3 * s)];
  return inside(c, best) ? c : best[Math.floor(best.length / 2)];
}

function inside([x, y], ring) {
  let ok = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

function round(v) { return Math.round(v * 10) / 10; }

// Relative path with coordinates in tenths of a pixel; tiny islands are dropped unless they're all there is
function pathOf(mp) {
  const pieces = [];
  const biggest = Math.max(0, ...mp.map((poly) => Math.abs(ringArea(poly[0]))));
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringArea(ring));
      if (a < 0.6 && !(i === 0 && a === biggest)) return;
      const pts = [];
      for (const [x, y] of ring) {
        const p = [Math.round(x * 10), Math.round(y * 10)];
        const last = pts[pts.length - 1];
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < SIMPLIFY * 10) continue;
        pts.push(p);
      }
      if (pts.length < 3) return;
      let d = `M${pts[0][0] / 10} ${pts[0][1] / 10}l`;
      const steps = [];
      for (let k = 1; k < pts.length; k++) steps.push(`${(pts[k][0] - pts[k - 1][0]) / 10} ${(pts[k][1] - pts[k - 1][1]) / 10}`);
      d += steps.join(' ').replace(/ -/g, '-') + 'z';
      pieces.push(d);
    });
  }
  return pieces.join('');
}

function compactPath(d) {
  return d.replace(/(\d+\.\d)\d+/g, '$1');
}
