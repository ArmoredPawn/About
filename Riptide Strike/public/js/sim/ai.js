// Computer-run racers: they follow the racing line (each in a lane of its own), steer round rocks and islands, ease
// off for tight turns, and shoot whatever comes into their sights.

import { nearestOnLine } from './track.js';

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const BOT_NAMES = ['Barracuda', 'Typhoon', 'Kraken', 'Stingray', 'Leviathan', 'Marlin', 'Tempest', 'Corsair', 'Hammerhead', 'Squall'];

export function botBrain(slot, skill = 0.7) {
  return { lane: ((slot % 5) - 2) * 10, skill, burst: 0, think: 0, cannonWant: false, stuck: 0, backing: 0 };
}

export function botInput(world, b, brain, dt) {
  const line = world.course.line;
  const pts = line.pts;
  const near = nearestOnLine(line, b.x, b.z, b.lineHint);
  b.lineHint = near.i;
  // A point ahead on the line, further ahead the faster we go
  const ahead = 30 + b.k.length * 0.8 + Math.max(0, b.speed) * 1.25;
  let j = near.i;
  let s = 0;
  while (s < ahead) { const a = pts[j]; j = (j + 1) % pts.length; s += Math.hypot(pts[j].x - a.x, pts[j].z - a.z); }
  const p = pts[j];
  let lane = brain.lane;
  // Something in the way: pass it on the side away from it
  for (const o of world.obstacles) {
    const dx = o.x - b.x;
    const dz = o.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d > 110 + o.r + b.k.length || d < 1) continue;
    const fwd = dx * Math.sin(b.h) + dz * Math.cos(b.h);
    const side = dx * Math.cos(b.h) - dz * Math.sin(b.h);
    // Ahead, or alongside (pressed against it)
    const clear = o.r + b.k.beam / 2 + 10;
    if (fwd > -o.r - b.k.length / 2 && Math.abs(side) < clear) lane += (side > 0 ? -1 : 1) * (clear + 4);
  }
  const tx = p.x + p.dz * lane;
  const tz = p.z - p.dx * lane;
  const want = Math.atan2(tx - b.x, tz - b.z);
  const off = wrapAngle(want - b.h);
  const steer = Math.max(-1, Math.min(1, off * 2.4));
  // How sharp the line turns ahead: slow for it
  const k = pts[(j + 12) % pts.length];
  const bend = Math.abs(wrapAngle(Math.atan2(k.dx, k.dz) - Math.atan2(p.dx, p.dz)));
  let throttle = 1 - Math.min(0.55, Math.max(0, bend - 0.35) * 0.9) * (b.speed > 25 ? 1 : 0.3);
  if (Math.abs(off) > 1.6) throttle = 0.45;
  throttle *= 0.86 + brain.skill * 0.14;
  // Stuck against something: back off for a moment, turning away
  if (world.phase === 'race' && !b.finished && !b.dead && Math.abs(b.speed) < 3) brain.stuck += dt; else brain.stuck = 0;
  if (brain.stuck > 1.5) { brain.backing = 1.2; brain.stuck = 0; }
  if (brain.backing > 0) { brain.backing -= dt; return { throttle: -0.8, steer: -steer, gun: false, cannon: false, missile: false }; }

  // Shooting: bursts at whatever is in the sights (and always at incoming missiles and aircraft), shells when
  // close, missiles once locked, an air strike now and then
  brain.think -= dt;
  const aimed = b.aim.target && !b.aim.air ? world.boats.get(b.aim.target) : null;
  if (brain.think <= 0) {
    brain.think = 0.25;
    brain.cannonWant = Boolean(aimed && b.aim.dist < 320 && Math.random() < 0.25 * brain.skill);
    if (aimed && b.aim.dist < 380 && Math.random() < 0.3 * brain.skill) brain.burst = 0.4 + Math.random() * 0.7;
    if (b.aim.air && Math.random() < 0.5 * brain.skill) brain.burst = 0.5;
  }
  brain.burst -= dt;
  const gun = brain.burst > 0 && b.heat < 0.85;
  const missile = b.lock.locked && b.ammo.missile > 0 && b.cd.missile <= 0 && Math.random() < dt * 0.3 * brain.skill;
  const air = b.ammo.air > 0 && b.cd.air <= 0 && (b.lock.target || aimed) && Math.random() < dt * 0.08 * brain.skill;
  return { throttle, steer, gun, cannon: brain.cannonWant && b.ammo.cannon > 0, missile, air: Boolean(air) };
}
