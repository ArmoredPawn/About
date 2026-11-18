// The race without any drawing: courses, boats, weapons, damage, gates and laps, computer racers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../public/js/sim/world.js';
import { TRACKS, buildCourse, nearestOnLine, GATE_HALF } from '../public/js/sim/track.js';
import { botBrain, botInput } from '../public/js/sim/ai.js';
import { heightAt, waveSet } from '../public/js/sim/waves.js';
import { WEAPONS } from '../public/js/sim/boats.js';

const run = (w, seconds, inputs = () => {}) => { for (let i = 0; i < seconds * 60; i++) { inputs(); w.step(1 / 60); } };

test('every course is a fair loop: no island on the racing line or in a gate, every rock leaves room to pass', () => {
  for (const id of Object.keys(TRACKS)) {
    const c = buildCourse(id);
    assert.ok(c.line.length > 2500, `${id} is a real course (${Math.round(c.line.length)} m)`);
    for (const o of c.islands) assert.ok(nearestOnLine(c.line, o.x, o.z).d - o.r >= 69, `${id}: an island keeps clear of the line`);
    for (const o of c.rocks) {
      assert.ok(nearestOnLine(c.line, o.x, o.z).d < 30, 'rocks are out on the course');
      for (const g of c.gates) assert.ok(Math.hypot(g.x - o.x, g.z - o.z) > 80, 'but never in a gate');
    }
    assert.deepEqual(buildCourse(id).islands, c.islands, 'the same course for everyone');
  }
});

test('the sea moves, and a boat rides it', () => {
  const waves = waveSet('rough');
  assert.notEqual(heightAt(waves, 10, 10, 0), heightAt(waves, 10, 10, 2));
  const w = new World({ track: 'harbor' });
  const b = w.addBoat({ id: 'a', name: 'A', local: true });
  const ys = new Set();
  for (let i = 0; i < 120; i++) { w.step(1 / 60); ys.add(Math.round(b.y * 100)); }
  assert.ok(ys.size > 5, 'it bobs');
});

test('a boat accelerates to its top speed, turns, and stays still before the start', () => {
  const w = new World({ track: 'atoll' });
  const b = w.addBoat({ id: 'a', name: 'A', cls: 'interceptor', local: true });
  const start = [b.x, b.z];
  w.setInput('a', { throttle: 1 });
  run(w, 1);
  assert.ok(Math.hypot(b.x - start[0], b.z - start[1]) < 0.5, 'no moving on the grid');
  w.startCountdown(0.01);
  run(w, 20);
  assert.ok(b.speed > b.k.top * 0.9 && b.speed <= b.k.top * 1.01, `near top speed (${b.speed.toFixed(1)} of ${b.k.top})`);
  const h0 = b.h;
  w.setInput('a', { steer: 1 });
  run(w, 1);
  assert.ok(Math.abs(b.h - h0) > 0.5, 'it turns');
});

test('gates count in order; the start gate ends a lap; the last lap finishes the race', () => {
  const w = new World({ track: 'atoll', laps: 2 });
  const b = w.addBoat({ id: 'a', name: 'A', local: true });
  w.startCountdown(0.01);
  w.step(1 / 60); w.step(1 / 60);
  const gates = w.course.gates;
  const visit = (g) => { b.x = g.x; b.z = g.z; w.step(1 / 60); };
  visit(gates[3]);
  assert.equal(b.next, 1, 'skipping a gate counts for nothing');
  for (let lap = 0; lap < 2; lap++) for (let i = 1; i <= gates.length; i++) visit(gates[i % gates.length]);
  assert.ok(b.finished && b.finishTime > 0);
  assert.ok(w.drain().some((e) => e.t === 'finish' && e.id === 'a'));
});

test('weapons are locked until the first gate, then the gun fires, overheats and cools', () => {
  const w = new World({ track: 'atoll' });
  const a = w.addBoat({ id: 'a', name: 'A', local: true, slot: 0 });
  w.startCountdown(0.01);
  w.setInput('a', { gun: true });
  run(w, 0.5);
  assert.ok(!w.drain().some((e) => e.t === 'fire'), 'nothing fires on the grid');
  a.next = 2;
  run(w, 0.5);
  assert.ok(w.drain().filter((e) => e.t === 'fire').length >= 4, 'it fires once armed');
  run(w, 5);
  assert.ok(a.overheated, 'a long burst overheats it');
  w.setInput('a', { gun: false });
  run(w, 3);
  assert.ok(!a.overheated);
});

test('shots hit the boat ahead; damage sinks it; it comes back at the last gate, shielded', () => {
  const w = new World({ track: 'atoll', seed: 4 });
  const a = w.addBoat({ id: 'a', name: 'A', local: true, slot: 0 });
  const t = w.addBoat({ id: 't', name: 'T', local: true, slot: 1 });
  w.startCountdown(0.01);
  run(w, 0.1);
  for (const b of [a, t]) b.next = 2;
  // The target 120 m dead ahead, stopped
  t.x = a.x + Math.sin(a.h) * 120; t.z = a.z + Math.cos(a.h) * 120; t.h = a.h;
  w.setInput('a', { cannon: true });
  const hp = t.hp;
  run(w, 4);
  assert.ok(t.hp < hp || t.dead, 'shells strike it');
  t.hp = 5;
  w.setInput('a', { cannon: false, missile: true });
  a.lock = { target: 't', t: 5, locked: true };
  run(w, 3);
  const events = w.drain();
  assert.ok(t.dead || events.some((e) => e.t === 'sunk' && e.id === 't'), 'finished off');
  assert.equal(a.kills, 1);
  run(w, 3.5);
  assert.ok(!t.dead && t.hp === t.k.hp, 'back with a full hull');
  assert.ok(t.shieldUntil > 0, 'and protected for a moment');
});

test('a hit on a boat someone else owns goes to its owner, who takes the damage', () => {
  const shooter = new World({ track: 'atoll' });
  shooter.addBoat({ id: 'me', name: 'Me', local: true, slot: 0 });
  shooter.addBoat({ id: 'you', name: 'You', local: false, slot: 1 });
  shooter.damage('you', 12, 'me', 'cannon');
  const hit = shooter.drain().find((e) => e.t === 'hit');
  assert.deepEqual([hit.id, hit.amount, hit.by], ['you', 12, 'me']);
  const owner = new World({ track: 'atoll' });
  const you = owner.addBoat({ id: 'you', name: 'You', local: true, slot: 1 });
  owner.addBoat({ id: 'me', name: 'Me', local: false, slot: 0 });
  owner.takeHit(hit.id, hit.amount, hit.by, hit.w);
  assert.equal(you.hp, you.k.hp - 12);
});

test('a copy of someone else\'s boat moves smoothly between the positions its owner sends', () => {
  const w = new World({ track: 'atoll' });
  const b = w.addBoat({ id: 'r', name: 'R', local: false, slot: 0 });
  w.applySnapshot('r', { x: 0, z: 0, h: 0, vx: 0, vz: 30, hp: 100, lap: 1, nx: 1, pr: 0, fin: false, ft: null, th: 1, ay: 0, k: 0 }, 10);
  w.applySnapshot('r', { x: 0, z: 3, h: 0, vx: 0, vz: 30, hp: 100, lap: 1, nx: 1, pr: 0, fin: false, ft: null, th: 1, ay: 0, k: 0 }, 10.1);
  w.step(1 / 60, 10.17);
  assert.ok(b.z > 0.5 && b.z < 2.5, `between the two (${b.z.toFixed(2)})`);
});

test('missiles home on a locked target; crates repair and rearm', () => {
  const w = new World({ track: 'fjord' });
  const a = w.addBoat({ id: 'a', name: 'A', local: true, slot: 0 });
  const t = w.addBoat({ id: 't', name: 'T', local: true, slot: 1 });
  w.startCountdown(0.01);
  run(w, 0.1);
  a.next = 2;
  // Off to one side, ahead: a dumb missile would miss
  t.x = a.x + Math.sin(a.h + 0.3) * 300; t.z = a.z + Math.cos(a.h + 0.3) * 300;
  a.lock = { target: 't', t: 5, locked: true };
  w.setInput('a', { missile: true });
  const hp = t.hp;
  run(w, 5);
  assert.ok(t.hp <= hp - WEAPONS.missile.damage * 0.9, 'the missile turned onto it');
  const p = [...w.pickups.values()].find((x) => x.kind === 'ammo');
  a.missiles = 0;
  a.x = p.x; a.z = p.z;
  w.step(1 / 60);
  assert.ok(a.missiles >= 2 && p.until > 0, 'ammunition taken on, crate gone for a while');
});

test('computer racers finish a race on every course', () => {
  for (const track of Object.keys(TRACKS)) {
    const w = new World({ track, laps: 1, seed: 9 });
    const brains = new Map();
    for (let i = 0; i < 4; i++) { w.addBoat({ id: `b${i}`, name: `B${i}`, cls: ['interceptor', 'gunboat', 'patrol'][i % 3], slot: i, local: true, bot: true }); brains.set(`b${i}`, botBrain(i, 0.8)); }
    w.startCountdown(0.01);
    for (let i = 0; i < 60 * 400 && [...w.boats.values()].some((b) => !b.finished); i++) {
      for (const [id, br] of brains) w.setInput(id, botInput(w, w.boats.get(id), br, 1 / 60));
      w.step(1 / 60);
      w.drain();
    }
    const done = [...w.boats.values()].filter((b) => b.finished).length;
    assert.ok(done >= 3, `${track}: ${done} of 4 finished`);
  }
});

test('the gate radius matches the pylons', () => { assert.ok(GATE_HALF >= 30); });
