import { Obstacle } from './obstacles.js';

// Track definitions and obstacle generator for Hydro Rush
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
    trackWidth: 320,
    waypoints: [
      { x: 700, y: 800 },
      { x: 1500, y: 700 },
      { x: 2300, y: 850 },
      { x: 3100, y: 650 },
      { x: 3600, y: 1200 },
      { x: 3450, y: 1900 },
      { x: 2900, y: 2200 },
      { x: 3300, y: 2800 },
      { x: 2500, y: 3000 },
      { x: 1800, y: 2600 },
      { x: 1200, y: 2950 },
      { x: 600, y: 2400 },
      { x: 950, y: 1800 },
      { x: 600, y: 1300 },
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
    trackWidth: 290,
    waypoints: [
      { x: 800, y: 750 },
      { x: 1800, y: 650 },
      { x: 2600, y: 900 },
      { x: 3600, y: 750 },
      { x: 4000, y: 1400 },
      { x: 3300, y: 1800 },
      { x: 3800, y: 2400 },
      { x: 3200, y: 3100 },
      { x: 2200, y: 2800 },
      { x: 1600, y: 3200 },
      { x: 900, y: 2850 },
      { x: 600, y: 2100 },
      { x: 1200, y: 1700 },
      { x: 700, y: 1250 },
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
    trackWidth: 310,
    waypoints: [
      { x: 900, y: 800 },
      { x: 1900, y: 700 },
      { x: 3000, y: 850 },
      { x: 3800, y: 1300 },
      { x: 3400, y: 2100 },
      { x: 3800, y: 2800 },
      { x: 2800, y: 3150 },
      { x: 2000, y: 2600 },
      { x: 1300, y: 3100 },
      { x: 650, y: 2500 },
      { x: 1100, y: 1900 },
      { x: 700, y: 1350 },
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
    trackWidth: 330,
    waypoints: [
      { x: 900, y: 900 },
      { x: 2000, y: 750 },
      { x: 3200, y: 800 },
      { x: 4200, y: 1400 },
      { x: 3800, y: 2300 },
      { x: 4100, y: 3200 },
      { x: 3100, y: 3500 },
      { x: 2200, y: 2900 },
      { x: 1400, y: 3500 },
      { x: 700, y: 2800 },
      { x: 1200, y: 2000 },
      { x: 700, y: 1450 },
    ],
  },
};

// Pseudorandom generator using seed
function makeRng(seed) {
  let s = Math.abs(seed) || 12345;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function buildTrack(trackId, obstacleDensity = 'mayhem', seed = 42) {
  const base = TRACKS[trackId] || TRACKS.coral_atoll;
  const rng = makeRng(seed);

  // Compute smooth track spline segments & checkpoints
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

  // Precompute normalized progress for checkpoints
  checkpoints.forEach(cp => {
    cp.progress = cp.cumDist / totalLength;
  });

  // Calculate start line
  const startCp = checkpoints[0];
  const startLine = {
    x: startCp.x,
    y: startCp.y,
    angle: startCp.angle,
    nx: startCp.nx,
    ny: startCp.ny,
    width: base.trackWidth,
  };

  // Generate starting grid positions for 8 boats
  const starterGrid = [];
  const gridSpacing = 80;
  const sideOffset = 50;

  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 2);
    const side = (i % 2 === 0) ? -1 : 1;
    // Behind start line along reverse direction
    const backX = -Math.cos(startCp.angle) * (row * gridSpacing + 50);
    const backY = -Math.sin(startCp.angle) * (row * gridSpacing + 50);
    const lateralX = startCp.nx * (side * sideOffset);
    const lateralY = startCp.ny * (side * sideOffset);

    starterGrid.push({
      x: startCp.x + backX + lateralX,
      y: startCp.y + backY + lateralY,
      angle: startCp.angle,
    });
  }

  // Generate obstacles based on density
  const obstacles = generateObstacles(base, checkpoints, obstacleDensity, rng);

  return {
    ...base,
    checkpoints,
    totalLength,
    startLine,
    starterGrid,
    obstacles,
  };
}

function generateObstacles(track, checkpoints, density, rng) {
  const obstacles = [];
  const numCp = checkpoints.length;

  // Multiplier for density:
  // standard: 1x, high: 2x, mayhem: 3.5x
  let multiplier = 3.5; // default mayhem
  if (density === 'standard') multiplier = 1.0;
  else if (density === 'high') multiplier = 2.0;
  else if (density === 'mayhem') multiplier = 3.5;

  let obsIdCounter = 1;

  for (let i = 0; i < numCp; i++) {
    const cp = checkpoints[i];
    const segLen = cp.dist;
    const forwardX = Math.cos(cp.angle);
    const forwardY = Math.sin(cp.angle);
    const halfWidth = cp.width / 2;

    // 1. Boundary Reefs & Cliffs (Outer Rocks)
    const rockSteps = Math.max(3, Math.floor((segLen / 120) * (multiplier >= 2 ? 1.5 : 1.0)));
    for (let s = 0; s < rockSteps; s++) {
      const t = (s + 0.5) / rockSteps;
      const midX = cp.x + forwardX * (segLen * t);
      const midY = cp.y + forwardY * (segLen * t);

      // Left boundary rock cluster
      const leftDist = halfWidth + 40 + rng() * 60;
      obstacles.push(new Obstacle({
        id: `rock_l_${obsIdCounter++}`,
        type: 'rock',
        x: midX - cp.nx * leftDist,
        y: midY - cp.ny * leftDist,
        radius: 35 + rng() * 25,
        color: track.theme === 'tropical' ? '#4a5759' : (track.theme === 'canyon' ? '#582f0e' : '#22223b'),
      }));

      // Right boundary rock cluster
      const rightDist = halfWidth + 40 + rng() * 60;
      obstacles.push(new Obstacle({
        id: `rock_r_${obsIdCounter++}`,
        type: 'rock',
        x: midX + cp.nx * rightDist,
        y: midY + cp.ny * rightDist,
        radius: 35 + rng() * 25,
        color: track.theme === 'tropical' ? '#4a5759' : (track.theme === 'canyon' ? '#582f0e' : '#22223b'),
      }));
    }

    // 2. Navigation Channel Buoys (slalom and gate markers)
    if (i % 2 === 0 || multiplier >= 2) {
      const buoyDist = halfWidth - 25;
      obstacles.push(new Obstacle({
        id: `buoy_r_${obsIdCounter++}`,
        type: 'buoy',
        subType: 'red',
        x: cp.x + cp.nx * buoyDist,
        y: cp.y + cp.ny * buoyDist,
        radius: 16,
      }));
      obstacles.push(new Obstacle({
        id: `buoy_g_${obsIdCounter++}`,
        type: 'buoy',
        subType: 'green',
        x: cp.x - cp.nx * buoyDist,
        y: cp.y - cp.ny * buoyDist,
        radius: 16,
      }));
    }

    // 3. Jump Ramps and Speed Boost Pads
    if (i % 3 === 1) {
      const rampT = 0.4 + rng() * 0.3;
      const rampOffset = (rng() - 0.5) * (halfWidth * 0.7);
      obstacles.push(new Obstacle({
        id: `ramp_${obsIdCounter++}`,
        type: 'ramp',
        x: cp.x + forwardX * (segLen * rampT) + cp.nx * rampOffset,
        y: cp.y + forwardY * (segLen * rampT) + cp.ny * rampOffset,
        angle: cp.angle,
        width: 50,
        height: 65,
      }));
    }

    if (i % 3 === 2) {
      const padT = 0.5 + rng() * 0.2;
      const padOffset = (rng() - 0.5) * (halfWidth * 0.6);
      obstacles.push(new Obstacle({
        id: `boost_${obsIdCounter++}`,
        type: 'boost_pad',
        x: cp.x + forwardX * (segLen * padT) + cp.nx * padOffset,
        y: cp.y + forwardY * (segLen * padT) + cp.ny * padOffset,
        angle: cp.angle,
        width: 44,
        height: 56,
      }));
    }

    // 4. In-Channel Obstacles: Mines, Whirlpools, Crates, Logs, Oil Slicks
    // Number of in-channel obstacles scaled by density
    const numHazards = Math.round((multiplier * 1.5) + rng());

    for (let h = 0; h < numHazards; h++) {
      // Avoid placing hazards right on the start grid segment (i === 0)
      if (i === 0 && h < 2) continue;

      const t = (h + 1) / (numHazards + 1);
      const laneOffset = (rng() * 2 - 1) * (halfWidth * 0.75);
      const posX = cp.x + forwardX * (segLen * t) + cp.nx * laneOffset;
      const posY = cp.y + forwardY * (segLen * t) + cp.ny * laneOffset;

      const roll = rng();

      if (track.theme === 'maelstrom' && roll < 0.25) {
        // Whirlpool
        obstacles.push(new Obstacle({
          id: `whirlpool_${obsIdCounter++}`,
          type: 'whirlpool',
          x: posX,
          y: posY,
          radius: 65,
          pullRadius: 180,
          pullStrength: 320,
        }));
      } else if (roll < (multiplier >= 3 ? 0.45 : 0.25)) {
        // Floating Naval Mine
        obstacles.push(new Obstacle({
          id: `mine_${obsIdCounter++}`,
          type: 'mine',
          x: posX,
          y: posY,
          radius: 20,
        }));
      } else if (roll < 0.65) {
        // Floating Wooden Crate
        obstacles.push(new Obstacle({
          id: `crate_${obsIdCounter++}`,
          type: 'crate',
          x: posX,
          y: posY,
          radius: 18,
        }));
      } else if (roll < 0.82) {
        // Drifting Timber Log
        obstacles.push(new Obstacle({
          id: `log_${obsIdCounter++}`,
          type: 'log',
          x: posX,
          y: posY,
          length: 50 + rng() * 30,
          rotation: rng() * Math.PI,
        }));
      } else {
        // Oil Slick / Algae Slick
        obstacles.push(new Obstacle({
          id: `oil_${obsIdCounter++}`,
          type: 'oil_slick',
          x: posX,
          y: posY,
          radius: 50 + rng() * 35,
        }));
      }
    }

    // 5. Special Hazards: Patrolling Sea Monsters / Tentacles on Maelstrom & Skull Canyon
    if ((track.theme === 'maelstrom' || track.theme === 'canyon') && i % 4 === 1) {
      obstacles.push(new Obstacle({
        id: `tentacle_${obsIdCounter++}`,
        type: 'tentacle',
        x: cp.x + forwardX * (segLen * 0.5),
        y: cp.y + forwardY * (segLen * 0.5),
        patrolAngle: cp.angle + Math.PI / 2,
        patrolDist: halfWidth * 0.7,
        patrolSpeed: 1.5,
        radius: 28,
      }));
    }
  }

  return obstacles;
}
