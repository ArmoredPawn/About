// The cities inside each province (data/cities.js, from Natural Earth). A city's share of its province's output
// follows its population, with cities about half again as productive as the countryside around them. In a battle
// for a province, the front passes the cities one by one as the attack advances from the side it came in on:
// each one that falls is lost to the defender at once (and makes the news), so taking the industrial cities of a
// province matters long before the whole province falls.

import { CITIES, HULLS } from './data/cities.js';
import { GEO } from './data/geo.js';
import { clamp } from './core.js';

export const CITIES_OF = new Map();
for (const [name, region, x, y, pop, capital] of CITIES) {
  (CITIES_OF.get(region) ?? CITIES_OF.set(region, []).get(region)).push({ name, region, x, y, pop, capital: Boolean(capital) });
}

const URBAN_EDGE = 1.5;

// The cities of a province with their share of its output (0-1), given its population in millions
export function citiesIn(regionId, popMillions) {
  const list = CITIES_OF.get(regionId) ?? [];
  const pop = Math.max(0.05, popMillions || 0) * 1000; // thousands
  let total = 0;
  const out = list.map((c) => {
    const share = Math.min(0.85, (c.pop / pop) * URBAN_EDGE);
    total += share;
    return { ...c, share };
  });
  // Never more than 90% of a province in its cities
  const scale = total > 0.9 ? 0.9 / total : 1;
  for (const c of out) c.share *= scale;
  return out;
}

// How far along an attack from `origin` each city lies, 0 (the edge it comes in from) to 1 (the far edge),
// measured across the province's outline the same way the map draws the front
export function cityDepths(regionId, origin, cities) {
  const g = GEO[regionId];
  if (!g || !origin) return cities.map(() => 0.5);
  let dx = g.x - origin.x;
  let dy = g.y - origin.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const outline = HULLS[regionId];
  let lo;
  let hi;
  if (outline?.length) {
    lo = Infinity;
    hi = -Infinity;
    for (const [x, y] of outline) {
      const t = x * dx + y * dy;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  } else {
    const radius = Math.max(4, Math.sqrt((g.area ?? 400) / Math.PI));
    const mid = g.x * dx + g.y * dy;
    lo = mid - radius;
    hi = mid + radius;
  }
  return cities.map((c) => clamp((c.x * dx + c.y * dy - lo) / Math.max(1, hi - lo), 0.02, 0.98));
}

// The cities of a province under attack that the front has passed, and the share of its output they make
export function fallenCities(s, reg) {
  const b = reg.battle;
  if (!b) return { names: [], share: 0 };
  const from = b.from && GEO[b.from] ? GEO[b.from] : null;
  const cities = citiesIn(reg.id, reg.pop);
  if (!from || !cities.length) return { names: [], share: 0 };
  const depth = cityDepths(reg.id, from, cities);
  const p = b.prog / 100;
  const fallen = cities.filter((_, i) => depth[i] <= p);
  return { names: fallen.map((c) => c.name), share: fallen.reduce((t, c) => t + c.share, 0), cities: fallen };
}
