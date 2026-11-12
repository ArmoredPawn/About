import { Obstacle } from './obstacles.js';

// Track definitions and obstacle generator for Hydro Rush.
// Waypoints are joined by a smooth curve; bends are no tighter than a ~360-unit radius so every
// corner can be taken at speed with a little care.
export const TRACKS = {
  coral_atoll: {
    id: 'coral_atoll',
    name: 'Emerald Atoll',
    theme: 'tropical',
    description: 'Sunlit turquoise lagoons, coral reefs, sandbar jumps, and buoy slaloms.',
    width: 4200,
    height: 3400,
    waterColor: '#0a84b3',
    deepWaterColor: '#004e75',
    ambientColor: '#48cae4',
    trackWidth: 440,
    waypoints: [
      { x: 770, y: 670 },
      { x: 1460, y: 440 },
      { x: 2390, y: 540 },
      { x: 3200, y: 600 },
      { x: 3680, y: 1060 },
      { x: 3670, y: 1740 },
      { x: 3340, y: 2240 },
      { x: 3140, y: 2720 },
      { x: 2590, y: 2960 },
      { x: 1820, y: 2800 },
      { x: 1140, y: 2780 },
      { x: 700, y: 2350 },
      { x: 650, y: 1720 },
      { x: 520, y: 1140 },
    ],
  },
  skull_canyon: {
    id: 'skull_canyon',
    name: 'Skull Rock Gorge',
    theme: 'canyon',
    description: 'Treacherous river gorge packed with drifting timber logs, jagged cliffs, and minefields.',
    width: 4600,
    height: 3600,
    waterColor: '#005f73',
    deepWaterColor: '#002830',
    ambientColor: '#0a9396',
    trackWidth: 400,
    waypoints: [
      { x: 960, y: 640 },
      { x: 1780, y: 430 },
      { x: 2760, y: 610 },
      { x: 3630, y: 760 },
      { x: 3990, y: 1220 },
      { x: 3870, y: 1790 },
      { x: 3810, y: 2440 },
      { x: 3260, y: 2960 },
      { x: 2320, y: 3040 },
      { x: 1540, y: 3170 },
      { x: 870, y: 2840 },
      { x: 610, y: 2180 },
      { x: 730, y: 1610 },
      { x: 660, y: 1080 },
    ],
  },
  neon_bay: {
    id: 'neon_bay',
    name: 'Cyber Marina',
    theme: 'cyber',
    description: 'High-speed midnight marina with neon light arches, oil slicks, and turbo boost pads.',
    width: 4400,
    height: 3600,
    waterColor: '#03071e',
    deepWaterColor: '#01040f',
    ambientColor: '#7209b7',
    trackWidth: 420,
    waypoints: [
      { x: 950, y: 680 },
      { x: 1910, y: 460 },
      { x: 3120, y: 670 },
      { x: 3780, y: 1260 },
      { x: 3770, y: 2090 },
      { x: 3680, y: 2770 },
      { x: 2970, y: 3140 },
      { x: 2040, y: 2900 },
      { x: 1240, y: 2990 },
      { x: 740, y: 2530 },
      { x: 770, y: 1870 },
      { x: 620, y: 1220 },
    ],
  },
  maelstrom_abyss: {
    id: 'maelstrom_abyss',
    name: 'The Maelstrom Abyss',
    theme: 'maelstrom',
    description: 'Catastrophic tempest sea with massive spinning whirlpools, kraken hazards, and endless obstacles.',
    width: 4800,
    height: 4000,
    waterColor: '#0d1b2a',
    deepWaterColor: '#050a12',
    ambientColor: '#1b263b',
    trackWidth: 440,
    waypoints: [
      { x: 880, y: 700 },
      { x: 1980, y: 450 },
      { x: 3360, y: 570 },
      { x: 4240, y: 1290 },
      { x: 4180, y: 2290 },
      { x: 4120, y: 3160 },
      { x: 3280, y: 3550 },
      { x: 2230, y: 3220 },
      { x: 1310, y: 3390 },
      { x: 710, y: 2830 },
      { x: 830, y: 1980 },
      { x: 560, y: 1280 },
    ],
  },
};

// Spacing (world units) between samples of a track's smoothed centreline
export const PATH_STEP = 20;

// Pseudorandom generator using seed
function makeRng(seed) {
  let s = Math.abs(seed) || 12345;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Centripetal Catmull-Rom between p1 and p2 (no loops or cusps on uneven waypoint spacing)
function catmullRom(p0, p1, p2, p3, u) {
  const knot = (a, b) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y), 0.5) || 1e-4;
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a, b, ta, tb) => ({
    x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
    y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
  });
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

// Smooth closed centreline through the waypoints, resampled every PATH_STEP units.
// Each sample has its position, distance along the course (s), heading and left-hand normal.
export function buildPath(waypoints) {
  const n = waypoints.length;
  const SUB = 48;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i - 1 + n) % n];
    const p1 = waypoints[i];
    const p2 = waypoints[(i + 1) % n];
    const p3 = waypoints[(i + 2) % n];
    for (let k = 0; k < SUB; k++) dense.push(catmullRom(p0, p1, p2, p3, k / SUB));
  }

  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = cum[dense.length];
  const count = Math.round(length / PATH_STEP);
  const step = length / count;

  const pts = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s });
  }
  for (let i = 0; i < count; i++) {
    const prev = pts[(i - 1 + count) % count];
    const next = pts[(i + 1) % count];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    pts[i].angle = angle;
    pts[i].nx = Math.cos(angle + Math.PI / 2);
    pts[i].ny = Math.sin(angle + Math.PI / 2);
  }
  return { points: pts, length, step };
}

// The centreline sample at distance s along the course (wraps around the loop)
export function pathAt(path, s) {
  const n = path.points.length;
  const i = ((Math.round(s / path.step) % n) + n) % n;
  return path.points[i];
}

// Index of the centreline sample nearest (x, y). With a hint, only searches nearby samples.
export function nearestPathIndex(path, x, y, hint = -1, window = 40) {
  const pts = path.points;
  const n = pts.length;
  let best = 0;
  let bestD = Infinity;
  const from = hint < 0 ? 0 : hint - window;
  const to = hint < 0 ? n - 1 : hint + window;
  for (let k = from; k <= to; k++) {
    const i = ((k % n) + n) % n;
    const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Shortest distance from (x, y) to the centreline
export function distanceToPath(path, x, y) {
  let best = Infinity;
  for (const p of path.points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function buildTrack(trackId, obstacleDensity = 'mayhem', seed = 42) {
  const base = TRACKS[trackId] || TRACKS.coral_atoll;
  const rng = makeRng(seed);
  const path = buildPath(base.waypoints);

  // Checkpoints sit on the waypoints (the smooth path passes through every one)
  const waypoints = base.waypoints;
  const numWaypoints = waypoints.length;
  const checkpoints = [];
  let totalLength = 0;

  for (let i = 0; i < numWaypoints; i++) {
    const curr = waypoints[i];
    const next = waypoints[(i + 1) % numWaypoints];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const normalAngle = angle + Math.PI / 2;

    checkpoints.push({
      index: i,
      x: curr.x,
      y: curr.y,
      nextX: next.x,
      nextY: next.y,
      angle,
      dist,
      cumDist: totalLength,
      nx: Math.cos(normalAngle),
      ny: Math.sin(normalAngle),
      width: base.trackWidth,
    });
    totalLength += dist;
  }

  checkpoints.forEach(cp => {
    cp.progress = cp.cumDist / totalLength;
  });

  const start = path.points[0];
  const startLine = {
    x: start.x,
    y: start.y,
    angle: start.angle,
    nx: start.nx,
    ny: start.ny,
    width: base.trackWidth,
  };

  // Starting grid for 8 boats: two abreast, in rows behind the start line, following the course
  const starterGrid = [];
  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 2);
    const side = (i % 2 === 0) ? -1 : 1;
    const p = pathAt(path, -(row * 80 + 60));
    starterGrid.push({
      x: p.x + p.nx * side * 70,
      y: p.y + p.ny * side * 70,
      angle: p.angle,
    });
  }

  const obstacles = generateObstacles(base, path, obstacleDensity, rng);

  return {
    ...base,
    checkpoints,
    totalLength,
    path,
    startLine,
    starterGrid,
    obstacles,
  };
}

// How many hazards each density puts in the channel. Hazards are spaced along the course so
// there is never more than one across the channel at any point: always a way through.
const DENSITY = {
  standard: { spacing: 360, mineChance: 0.25 },
  high: { spacing: 240, mineChance: 0.32 },
  mayhem: { spacing: 150, mineChance: 0.4 },
};

function generateObstacles(track, path, density, rng) {
  const obstacles = [];
  const halfWidth = track.trackWidth / 2;
  const length = path.length;
  const cfg = DENSITY[density] || DENSITY.mayhem;
  const rockColor = track.theme === 'tropical' ? '#4a5759' : (track.theme === 'canyon' ? '#582f0e' : '#22223b');
  let obsIdCounter = 1;
  const at = (s, offset) => {
    const p = pathAt(path, s);
    return { x: p.x + p.nx * offset, y: p.y + p.ny * offset, angle: p.angle, p };
  };

  // 1. Shoreline rocks along both edges, spaced along the shore itself so neighbours overlap
  //    into an unbroken wall (no gaps to slip through on the outside of a bend). A rock is
  //    dropped if any part of it would reach into the channel anywhere on the course.
  //    A second lap round the course fills any space left (such as where the loop closes).
  for (const side of [-1, 1]) {
    const shore = [];
    let radius = 30 + rng() * 26;
    let offset = halfWidth + radius + 14 + rng() * 20;
    for (let pass = 0; pass < 2; pass++) {
      for (const p of path.points) {
        if (pass === 1) {
          // Filler: as big a rock as fits the space left (if that is big enough to matter)
          offset = halfWidth + 44;
          const fx = p.x + p.nx * side * offset;
          const fy = p.y + p.ny * side * offset;
          radius = Math.min(56, offset - halfWidth - 14, ...shore.map(r => Math.hypot(r.x - fx, r.y - fy) / 0.75 - r.radius));
          if (radius < 14) continue;
        }
        const x = p.x + p.nx * side * offset;
        const y = p.y + p.ny * side * offset;
        if (shore.some(r => Math.hypot(r.x - x, r.y - y) < (r.radius + radius) * 0.75)) continue;
        if (distanceToPath(path, x, y) < halfWidth + radius + 10) continue;
        const rock = new Obstacle({
          id: `rock_${side < 0 ? 'r' : 'l'}_${obsIdCounter++}`,
          type: 'rock',
          x,
          y,
          radius,
          color: rockColor,
        });
        obstacles.push(rock);
        shore.push(rock);
        radius = 30 + rng() * 26;
        offset = halfWidth + radius + 14 + rng() * 20;
      }
    }
  }

  // 2. Channel marker buoys just inside the edges at every waypoint (red on the right, green on the left)
  for (const wp of track.waypoints) {
    const i = nearestPathIndex(path, wp.x, wp.y);
    const p = path.points[i];
    const d = halfWidth - 18;
    obstacles.push(new Obstacle({ id: `buoy_r_${obsIdCounter++}`, type: 'buoy', subType: 'red', x: p.x - p.nx * d, y: p.y - p.ny * d, radius: 16 }));
    obstacles.push(new Obstacle({ id: `buoy_g_${obsIdCounter++}`, type: 'buoy', subType: 'green', x: p.x + p.nx * d, y: p.y + p.ny * d, radius: 16 }));
  }

  // 3. Jump ramps, boost pads and (canyon / maelstrom) kraken tentacles at fixed intervals
  const features = [];
  for (let s = 900; s < length - 600; s += 1500) {
    const pos = at(s, (rng() - 0.5) * halfWidth * 0.8);
    obstacles.push(new Obstacle({ id: `ramp_${obsIdCounter++}`, type: 'ramp', x: pos.x, y: pos.y, angle: pos.angle, width: 50, height: 65 }));
    features.push(s);
  }
  for (let s = 1650; s < length - 600; s += 1500) {
    const pos = at(s, (rng() - 0.5) * halfWidth * 0.8);
    obstacles.push(new Obstacle({ id: `boost_${obsIdCounter++}`, type: 'boost_pad', x: pos.x, y: pos.y, angle: pos.angle, width: 44, height: 56 }));
    features.push(s);
  }
  if (track.theme === 'maelstrom' || track.theme === 'canyon') {
    for (let s = 1250; s < length - 600; s += 1800) {
      const pos = at(s, 0);
      obstacles.push(new Obstacle({
        id: `tentacle_${obsIdCounter++}`,
        type: 'tentacle',
        x: pos.x,
        y: pos.y,
        patrolAngle: pos.angle + Math.PI / 2,
        patrolDist: halfWidth * 0.6,
        patrolSpeed: 1.3,
        radius: 28,
      }));
      features.push(s);
    }
  }

  // 4. Hazards in the channel: mines, crates, logs, oil slicks and (maelstrom) whirlpools.
  //    The start and the starting grid are kept clear.
  for (let s = 550; s < length - 500; s += cfg.spacing * (0.8 + rng() * 0.4)) {
    if (features.some(f => Math.abs(f - s) < 150)) continue;
    const roll = rng();

    if (track.theme === 'maelstrom' && roll < 0.2) {
      const pos = at(s, (rng() * 2 - 1) * (halfWidth - 150));
      obstacles.push(new Obstacle({ id: `whirlpool_${obsIdCounter++}`, type: 'whirlpool', x: pos.x, y: pos.y, radius: 65, pullRadius: 170, pullStrength: 300 }));
      continue;
    }

    const pos = at(s, (rng() * 2 - 1) * (halfWidth - 55));
    if (roll < cfg.mineChance) {
      obstacles.push(new Obstacle({ id: `mine_${obsIdCounter++}`, type: 'mine', x: pos.x, y: pos.y, radius: 20 }));
    } else if (roll < 0.66) {
      obstacles.push(new Obstacle({ id: `crate_${obsIdCounter++}`, type: 'crate', x: pos.x, y: pos.y, radius: 18 }));
    } else if (roll < 0.83) {
      obstacles.push(new Obstacle({
        id: `log_${obsIdCounter++}`,
        type: 'log',
        x: pos.x,
        y: pos.y,
        length: 50 + rng() * 30,
        rotation: pos.angle + (rng() - 0.5) * 1.2,
      }));
    } else {
      obstacles.push(new Obstacle({ id: `oil_${obsIdCounter++}`, type: 'oil_slick', x: pos.x, y: pos.y, radius: 50 + rng() * 30 }));
    }
  }

  return obstacles;
}
