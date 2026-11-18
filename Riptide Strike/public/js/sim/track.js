// The courses: a loop of gates on the open sea (each a pair of buoys), the racing line through them, the islands
// and rocks around it, the floating supply crates, and the starting grid. Everything is built from a seed, so every
// player in a room gets the same course.

export const GATE_HALF = 34; // half the width of a gate, in metres: pass within this of its centre
export const LANE = 26; // how far either side of the racing line counts as on the course

export const TRACKS = {
  atoll: {
    name: 'Coral Atoll', blurb: 'Turquoise lagoon, palm islands and a fast sweeping loop. Calm water, high sun.',
    waves: 'calm', seed: 11,
    sky: { elevation: 38, azimuth: 135, turbidity: 4, rayleigh: 1.1, mie: 0.004 },
    water: { deep: '#0a4f63', shallow: '#1aa3a8' }, fog: '#bcd8e6', fogDensity: 0.00038,
    island: { sand: '#e8d6a8', grass: '#3f7a35', rock: '#7b6f60', palms: true, height: 0.35 },
    gates: [[0, 0], [360, 110], [640, 400], [700, 790], [500, 1100], [130, 1190], [-230, 1020], [-430, 720], [-390, 380], [-190, 140]],
    rocks: 6,
  },
  fjord: {
    name: 'Fjord Run', blurb: 'Grey cliffs, cold choppy water and tight turns between granite islands.',
    waves: 'choppy', seed: 23,
    sky: { elevation: 14, azimuth: 200, turbidity: 9, rayleigh: 2.2, mie: 0.008 },
    water: { deep: '#14323d', shallow: '#2c5560' }, fog: '#aeb8bf', fogDensity: 0.00085,
    island: { sand: '#8b8f86', grass: '#405238', rock: '#5d6266', palms: false, height: 0.9 },
    gates: [[0, 0], [210, 300], [250, 690], [110, 1040], [300, 1400], [650, 1500], [820, 1210], [700, 820], [860, 420], [610, 90], [300, -110]],
    rocks: 9,
  },
  harbor: {
    name: 'Sunset Harbour', blurb: 'Golden-hour swells off a rocky coast, with a long back straight for missiles.',
    waves: 'rough', seed: 37,
    sky: { elevation: 4.5, azimuth: 250, turbidity: 10, rayleigh: 3, mie: 0.01 },
    water: { deep: '#1a2f45', shallow: '#3c5a6e' }, fog: '#e0b48c', fogDensity: 0.00055,
    island: { sand: '#c9a77a', grass: '#56622e', rock: '#6e5b4d', palms: true, height: 0.55 },
    gates: [[0, 0], [420, -20], [720, 190], [820, 560], [610, 820], [250, 720], [40, 920], [-320, 860], [-470, 560], [-320, 250]],
    rocks: 7,
  },
};

// A small seeded random number generator (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A closed Catmull-Rom curve through the gates, sampled every few metres: [{ x, z, s (distance along), dx, dz }]
function racingLine(gates, step = 5) {
  const n = gates.length;
  const pts = [];
  const at = (i) => gates[((i % n) + n) % n];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < m; k++) {
      const t = k / m;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]), gate: k === 0 ? i : -1 });
    }
  }
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    a.s = s;
    a.dx = (b.x - a.x) / d;
    a.dz = (b.z - a.z) / d;
    s += d;
  }
  return { pts, length: s };
}

// The nearest point of the racing line to (x, z): { i, d (distance), s, side (+ right, − left) }. hint: a sample index
// to search around first (boats move a little each step)
export function nearestOnLine(line, x, z, hint = -1) {
  const pts = line.pts;
  let best = -1;
  let bd = Infinity;
  const test = (i) => { const p = pts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } };
  if (hint >= 0) for (let k = -40; k <= 40; k++) test(((hint + k) % pts.length + pts.length) % pts.length);
  if (hint < 0 || bd > 120 * 120) for (let i = 0; i < pts.length; i++) test(i);
  const p = pts[best];
  return { i: best, d: Math.sqrt(bd), s: p.s, side: Math.sign((x - p.x) * p.dz - (z - p.z) * p.dx) };
}

export function buildCourse(id) {
  const def = TRACKS[id] ?? TRACKS.atoll;
  const r = rng(def.seed);
  const gates = def.gates.map(([x, z], i) => ({ i, x, z }));
  const line = racingLine(def.gates);
  // Each gate faces along the line where it stands
  for (const g of gates) {
    const p = line.pts.find((q) => q.gate === g.i);
    g.dx = p.dx; g.dz = p.dz;
  }
  const xs = gates.map((g) => g.x);
  const zs = gates.map((g) => g.z);
  const box = { x0: Math.min(...xs) - 700, x1: Math.max(...xs) + 700, z0: Math.min(...zs) - 700, z1: Math.max(...zs) + 700 };
  const clearOf = (x, z, rad) => nearestOnLine(line, x, z).d - rad;

  // Islands: scenery off the course, a few close to the turns. Colliders are circles at the waterline.
  const islands = [];
  for (let tries = 0; tries < 900 && islands.length < 26; tries++) {
    const x = box.x0 + r() * (box.x1 - box.x0);
    const z = box.z0 + r() * (box.z1 - box.z0);
    const rad = 28 + r() ** 1.6 * 140;
    const gap = clearOf(x, z, rad);
    if (gap < 70 || (islands.length < 10 && gap > 260)) continue;
    if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + rad + 40)) continue;
    if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < rad + 110)) continue;
    islands.push({ x, z, r: rad, h: rad * (0.25 + r() * 0.5) * def.island.height * 2, seed: Math.floor(r() * 1e9) });
  }
  // Rocks: a few out on the course, never in a gate, always with room to pass
  const rocks = [];
  for (let tries = 0; tries < 400 && rocks.length < def.rocks; tries++) {
    const p = line.pts[Math.floor(r() * line.pts.length)];
    if (gates.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < 90)) continue;
    const off = (r() < 0.5 ? -1 : 1) * (6 + r() * 16);
    const x = p.x + p.dz * off;
    const z = p.z - p.dx * off;
    const rad = 3.5 + r() * 4;
    if (rocks.some((o) => Math.hypot(o.x - x, o.z - z) < 70)) continue;
    rocks.push({ x, z, r: rad, h: 2 + r() * 5, seed: Math.floor(r() * 1e9) });
  }
  // Supply crates: repairs and ammunition, spread round the loop, either side of the line
  const pickups = [];
  const n = 8;
  for (let k = 0; k < n; k++) {
    const p = line.pts[Math.floor(((k + 0.5) / n) * line.pts.length)];
    for (const side of [-1, 1]) {
      const off = side * 14;
      pickups.push({ id: `pk${pickups.length}`, kind: (k + (side > 0 ? 1 : 0)) % 2 ? 'ammo' : 'repair', x: p.x + p.dz * off, z: p.z - p.dx * off });
    }
  }
  return { id, def, gates, line, islands, rocks, pickups, box };
}

// The starting grid: two abreast, just past the start gate, front row first
export function gridSlot(course, slot) {
  const pts = course.line.pts;
  const row = Math.floor(slot / 2);
  const back = 25 + (7 - row) * 22;
  let i = 0;
  while (i < pts.length - 1 && pts[i].s < back) i++;
  const p = pts[i];
  const off = (slot % 2 ? 1 : -1) * 11;
  return { x: p.x + p.dz * off, z: p.z - p.dx * off, h: Math.atan2(p.dx, p.dz) };
}
