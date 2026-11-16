// Builds the cities for the close-up war view:
//   public/js/engine/data/cities.js   [name, province, x, y, population in thousands, capital]
//
// Two sources, merged:
//  - Natural Earth's populated places (1:10m): the big cities, with the population of the whole built-up area
//    (Paris is eleven million, not the two million inside the city limits), and every national capital.
//  - GeoNames (cities over 15,000 people, CC BY 4.0): the towns and smaller cities in between.
// A town inside a bigger city's built-up area is part of that city, not a city of its own, so it is dropped.
//
// Each city is placed in the province whose outline (public/data/map.json) contains it, using the same map
// projection as scripts/build-map.js. Every province keeps its cities of 50,000 people or more (up to 30), and
// a province with fewer than 12 is filled up with its next-largest towns.
//
// Run with `npm run build:cities` (it downloads the data), or
//   node scripts/build-cities.js <ne_10m_populated_places_simple.geojson> <cities15000.zip or .txt>
// The output is committed.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as topojson from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { IGNORED_FEATURES } from '../public/js/engine/data/minors.js';
import { COUNTRIES } from '../public/js/engine/data/countries.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NE_SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const GEONAMES_SOURCE = 'https://download.geonames.org/export/dump/cities15000.zip';
const W = 2000;
const MIN_POP = 50000; // a city in its own right
const PER_PROVINCE = 30; // at most
const FILL_TO = 12; // a province with fewer cities than this takes its next-largest towns too
const MIN_GAP = 0.4; // map units (about 8 km): two places closer than this are one town

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
  // Ports and coastal cities can fall just outside a simplified coastline: take the nearest outline within 12 px
  let best = null;
  for (const sh of shapes) {
    if (!allowed(sh.id)) continue;
    if (pt[0] < sh.box[0] - 12 || pt[0] > sh.box[2] + 12 || pt[1] < sh.box[1] - 12 || pt[1] > sh.box[3] + 12) continue;
    for (const ring of sh.rings) {
      for (const [x, y] of ring) {
        const d = Math.hypot(x - pt[0], y - pt[1]);
        if (d <= 12 && (!best || d < best.d)) best = { id: sh.id, d };
      }
    }
  }
  return best?.id ?? null;
}

// The one file inside a zip archive (GeoNames ships a single text file per zip)
function unzipOne(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const dir = buf.readUInt32LE(end + 16);
  const method = buf.readUInt16LE(dir + 10);
  const size = buf.readUInt32LE(dir + 20);
  const local = buf.readUInt32LE(dir + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
}

const read = async (file, url) => (file ? readFileSync(file) : Buffer.from(await (await fetch(url)).arrayBuffer()));
const neFile = process.argv[2];
const gnFile = process.argv[3];
const ne = JSON.parse((await read(neFile, NE_SOURCE)).toString('utf8'));
const gnRaw = await read(gnFile, GEONAMES_SOURCE);
const gnText = (gnFile ?? GEONAMES_SOURCE).endsWith('.zip') ? unzipOne(gnRaw) : gnRaw.toString('utf8');

const ISO2 = new Map(Object.values(COUNTRIES).map((c) => [c.iso2.toUpperCase(), c.id]));
// Official names shortened to the ones people use
const SHORT = {
  'Universitäts- und Hansestadt Greifswald': 'Greifswald',
  'Heroica Ciudad de Juchitán de Zaragoza': 'Juchitán',
  'Tapachula de Córdova y Ordóñez': 'Tapachula',
  'San Martin Texmelucan de Labastida': 'San Martín Texmelucan',
  'Ciudad de Huajuapan de León': 'Huajuapan de León',
  'Makakilo / Kapolei / Honokai Hale': 'Kapolei',
};
const clean = (name) => {
  const n = String(name).replace(/\s+/g, ' ').trim();
  return SHORT[n] ?? n.replace(/^(Hansestadt|Universitätsstadt) /, '');
};
const place = (iso, lon, lat) => {
  const pt = projection([lon, lat]);
  if (!pt) return null;
  const id = provinceAt(pt, COUNTRIES[iso] ? (pid) => pid.startsWith(`${iso}-`) : () => true);
  return id ? { id, x: Math.round(pt[0] * 10) / 10, y: Math.round(pt[1] * 10) / 10 } : null;
};

const candidates = [];
let unplaced = 0;
for (const f of ne.features) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const at = place(String(p.adm0_a3 ?? '').toLowerCase(), lon, lat);
  if (!at) { unplaced++; continue; }
  const pop = Math.max(p.pop_max ?? 0, p.pop_min ?? 0);
  const capital = p.adm0cap === 1 || p.featurecla === 'Admin-0 capital';
  candidates.push({ ...at, name: clean(p.name), pop: Math.round(pop / 1000), capital, metro: true });
}
// GeoNames: geonameid, name, asciiname, alternatenames, latitude, longitude, feature class, feature code,
// country code, cc2, admin1-4, population, elevation, dem, timezone, modified. Parts of a city (PPLX), and
// abandoned, destroyed or historical places, are not towns of their own.
const SKIP = new Set(['PPLX', 'PPLQ', 'PPLW', 'PPLH', 'PPLCH']);
for (const line of gnText.split('\n')) {
  const col = line.split('\t');
  if (col.length < 15 || col[6] !== 'P' || SKIP.has(col[7])) continue;
  const pop = Number(col[14]) || 0;
  if (pop < 15000) continue;
  const at = place(ISO2.get(col[8]) ?? '', Number(col[5]), Number(col[4]));
  if (!at) { unplaced++; continue; }
  // National capitals come from Natural Earth: GeoNames also marks the capitals of overseas territories
  candidates.push({ ...at, name: clean(col[1]), pop: Math.round(pop / 1000), capital: false, metro: false });
}

// Biggest first (Natural Earth's built-up areas ahead of a GeoNames city of the same size), so each built-up
// area keeps one name: a place inside a bigger city's reach, or right next to another town, is part of it
candidates.sort((a, b) => b.pop - a.pop || Number(b.metro) - Number(a.metro));
const reach = (c) => Math.max(MIN_GAP, 0.025 * Math.sqrt(c.pop)); // about 50 km for a city of ten million
const kept = [];
const grid = new Map();
const cell = 4;
const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
for (const c of candidates) {
  let clash = false;
  const gx = Math.floor(c.x / cell);
  const gy = Math.floor(c.y / cell);
  for (let i = -1; i <= 1 && !clash; i++) for (let j = -1; j <= 1 && !clash; j++) {
    for (const o of grid.get(`${gx + i},${gy + j}`) ?? []) {
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < reach(o) || d < MIN_GAP || (o.name === c.name && o.id === c.id)) { clash = true; break; }
    }
  }
  // A capital is always kept, even right next to a bigger city
  if (clash && !c.capital) continue;
  kept.push(c);
  (grid.get(key(c.x, c.y)) ?? grid.set(key(c.x, c.y), []).get(key(c.x, c.y))).push(c);
}

const byProvince = new Map();
for (const c of kept) (byProvince.get(c.id) ?? byProvince.set(c.id, []).get(c.id)).push(c);

const rows = [];
for (const [id, list] of [...byProvince].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  list.sort((a, b) => Number(b.capital) - Number(a.capital) || b.pop - a.pop);
  // A capital and its namesake (Mexico City, Kuwait City) can both survive: keep one per name
  const seen = new Set();
  const unique = list.filter((c) => !seen.has(c.name) && seen.add(c.name));
  const big = unique.filter((c, i) => i === 0 || c.capital || c.pop * 1000 >= MIN_POP);
  const keep = (big.length >= FILL_TO ? big : unique.slice(0, Math.max(FILL_TO, big.length))).slice(0, PER_PROVINCE);
  keep.sort((a, b) => b.pop - a.pop);
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
  '// Generated by scripts/build-cities.js from Natural Earth populated places and GeoNames (CC BY 4.0,\n'
  + '// geonames.org). Do not edit by hand.\n'
  + '// [name, province, x, y, population (thousands), national capital]\n'
  + `export const CITIES = ${JSON.stringify(rows)};\n`
  + '// Each province\'s outline as a convex hull, for measuring how far a front has come across it\n'
  + `export const HULLS = ${JSON.stringify(hulls)};\n`);
console.log(`${rows.length} cities in ${byProvince.size} provinces (${unplaced} places fell outside every province)`);
