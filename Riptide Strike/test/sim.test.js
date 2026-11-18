// The race without any drawing: courses, ships, weapons (guns, naval guns, missiles, aircraft and bombs), damage,
// air defence, gates and laps, computer ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../public/js/sim/world.js';
import { TRACKS, buildCourse, nearestOnLine, gridSlot, GATE_HALF } from '../public/js/sim/track.js';
import { botBrain, botInput } from '../public/js/sim/ai.js';
import { heightAt, waveSet } from '../public/js/sim/waves.js';
import { BOATS, WEAPONS } from '../public/js/sim/boats.js';

const run = (w, seconds, inputs = () => {}) => { for (let i = 0; i < seconds * 60; i++) { inputs(); w.step(1 / 60); } };
// A ship placed d metres dead ahead of another, facing the same way
const ahead = (a, t, d) => { t.x = a.x + Math.sin(a.h) * d; t.z = a.z + Math.cos(a.h) * d; t.h = a.h; t.vx = t.vz = 0; };
const racing = (w, ...ships) => { w.startCountdown(0.01); run(w, 0.1); for (const b of ships) b.next = 2; };

test('every course is a fair loop: islands clear of the racing line and the gates, rocks only at the edges', () => {
  for (const id of Object.keys(TRACKS)) {
    const c = buildCourse(id);
    assert.ok(c.line.length > 2500, `${id} is a real course (${Math.round(c.line.length)} m)`);
    for (const o of c.islands) assert.ok(nearestOnLine(c.line, o.x, o.z).d - o.r >= 119, `${id}: an island keeps clear of the line`);
    for (const o of c.rocks) {
      const d = nearestOnLine(c.line, o.x, o.z).d;
      assert.ok(d > 25 && d < 55, `${id}: rocks sit at the edges of the course (${d.toFixed(0)} m out)`);
      for (const g of c.gates) assert.ok(Math.hypot(g.x - o.x, g.z - o.z) > 140, 'but never near a gate');
    }
    assert.deepEqual(buildCourse(id).islands, c.islands, 'the same course for everyone');
  }
});

test('the starting grid has room for a full field of carriers, all past the start and short of gate 1', () => {
  for (const id of Object.keys(TRACKS)) {
    const c = buildCourse(id);
    const slots = Array.from({ length: 8 }, (_, i) => gridSlot(c, i));
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const a = slots[i]; const b = slots[j];
      const along = Math.abs((b.x - a.x) * Math.sin(a.h) + (b.z - a.z) * Math.cos(a.h));
      const across = Math.abs((b.x - a.x) * Math.cos(a.h) - (b.z - a.z) * Math.sin(a.h));
      assert.ok(along > BOATS.carrier.length + 2 || across > BOATS.carrier.beam + 20, `${id}: slots ${i} and ${j} don't overlap`);
    }
    for (const s of slots) assert.ok(Math.hypot(s.x - c.gates[1].x, s.z - c.gates[1].z) > GATE_HALF, 'no one starts inside gate 1');
  }
});

test('the sea moves, ships ride it, and a carrier rides it more steadily than an interceptor', () => {
  const waves = waveSet('rough');
  assert.notEqual(heightAt(waves, 10, 10, 0), heightAt(waves, 10, 10, 2));
  const w = new World({ track: 'harbor' });
  const small = w.addBoat({ id: 'a', name: 'A', cls: 'interceptor', local: true, slot: 0 });
  const big = w.addBoat({ id: 'b', name: 'B', cls: 'carrier', local: true, slot: 1 });
  let ps = 0; let pb = 0;
  for (let i = 0; i < 600; i++) { w.step(1 / 60); ps += Math.abs(small.pitch) + Math.abs(small.roll); pb += Math.abs(big.pitch) + Math.abs(big.roll); }
  assert.ok(ps > 0.5 && pb < ps * 0.6, `the carrier pitches and rolls less (${pb.toFixed(1)} against ${ps.toFixed(1)})`);
});

test('every class reaches its top speed, turns, and stays still before the start; bigger ships are slower', () => {
  const tops = {};
  for (const cls of Object.keys(BOATS)) {
    const w = new World({ track: 'atoll' });
    const b = w.addBoat({ id: 'a', name: 'A', cls, local: true });
    const start = [b.x, b.z];
    w.setInput('a', { throttle: 1 });
    run(w, 1);
    assert.ok(Math.hypot(b.x - start[0], b.z - start[1]) < 0.5, 'no moving on the grid');
    w.startCountdown(0.01);
    run(w, 30);
    assert.ok(b.speed > b.k.top * 0.9 && b.speed <= b.k.top * 1.01, `${cls} near top speed (${b.speed.toFixed(1)} of ${b.k.top})`);
    tops[cls] = b.speed;
    const h0 = b.h;
    w.setInput('a', { steer: 1 });
    run(w, 1.5);
    assert.ok(Math.abs(b.h - h0) > 0.4, `${cls} turns`);
  }
  assert.ok(tops.interceptor > tops.corvette && tops.corvette > tops.destroyer && tops.destroyer > tops.carrier);
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

test('weapons are locked until the first gate; then the gun fires, overheats and cools', () => {
  const w = new World({ track: 'atoll' });
  const a = w.addBoat({ id: 'a', name: 'A', cls: 'interceptor', local: true, slot: 0 });
  w.startCountdown(0.01);
  w.setInput('a', { gun: true });
  run(w, 0.5);
  assert.ok(!w.drain().some((e) => e.t === 'fire'), 'nothing fires on the grid');
  a.next = 2;
  run(w, 0.5);
  assert.ok(w.drain().filter((e) => e.t === 'fire').length >= 4, 'it fires once armed');
  run(w, 6);
  assert.ok(a.overheated, 'a long burst overheats it');
  w.setInput('a', { gun: false });
  run(w, 4);
  assert.ok(!a.overheated);
});

test('naval-gun shells strike the ship ahead; it sinks, and comes back at its last gate with a full hull', () => {
  const w = new World({ track: 'atoll', seed: 4 });
  const a = w.addBoat({ id: 'a', name: 'A', cls: 'destroyer', local: true, slot: 0 });
  const t = w.addBoat({ id: 't', name: 'T', cls: 'corvette', local: true, slot: 1 });
  racing(w, a, t);
  ahead(a, t, 220);
  w.setInput('a', { cannon: true });
  const hp = t.hp;
  run(w, 4);
  assert.ok(t.hp < hp - 30, `76 mm shells strike it (${hp} → ${t.hp.toFixed(0)})`);
  t.hp = 5;
  run(w, 3);
  assert.ok(w.drain().some((e) => e.t === 'sunk' && e.id === 't'), 'sunk');
  assert.equal(a.kills, 1);
  w.setInput('a', { cannon: false });
  run(w, 3.5);
  assert.ok(!t.dead && t.hp === t.k.hp && t.shieldUntil > 0, 'back, shielded, with a full hull');
});

test('a heavy cruise missile climbs out of its cell, turns onto a locked target off to one side, and hits hard', () => {
  const w = new World({ track: 'fjord' });
  const a = w.addBoat({ id: 'a', name: 'A', cls: 'destroyer', local: true, slot: 0 });
  const t = w.addBoat({ id: 't', name: 'T', cls: 'carrier', local: true, slot: 1 });
  racing(w, a, t);
  t.x = a.x + Math.sin(a.h + 0.35) * 600; t.z = a.z + Math.cos(a.h + 0.35) * 600;
  a.lock = { target: 't', t: 5, locked: true };
  w.setInput('a', { missile: true });
  let peak = 0;
  const hp = t.hp;
  run(w, 8, () => { for (const s of w.shots.values()) if (s.w === 'cruise') peak = Math.max(peak, s.y); });
  assert.ok(peak > 25, `it climbs out of the launch cell (${peak.toFixed(0)} m)`);
  assert.ok(t.hp <= hp - WEAPONS.cruise.damage * 0.9, `and strikes the carrier (${hp} → ${t.hp.toFixed(0)})`);
});

test('a carrier\'s strike jet flies out to a locked ship, bombs it, and comes back to the deck', () => {
  const w = new World({ track: 'atoll' });
  const c = w.addBoat({ id: 'c', name: 'C', cls: 'carrier', local: true, slot: 0 });
  const t = w.addBoat({ id: 't', name: 'T', cls: 'destroyer', local: true, slot: 1 });
  racing(w, c, t);
  ahead(c, t, 900);
  c.lock = { target: 't', t: 5, locked: true };
  w.setInput('c', { air: true });
  const hp = t.hp;
  run(w, 0.2);
  assert.equal(c.ammo.air, c.k.ammo.air - 1, 'one jet fewer ready until another is serviced');
  const seen = { jet: 0, bombs: 0 };
  run(w, 30, () => { for (const e of w.events) { if (e.t === 'fire' && e.w === 'jet') seen.jet++; if (e.t === 'fire' && e.w === 'heavybomb') seen.bombs++; } w.drain(); });
  assert.equal(seen.jet, 1, 'one jet launched');
  assert.ok(seen.bombs > 0);
  assert.equal(seen.bombs, WEAPONS.jet.bombs, 'it drops its stick of bombs');
  assert.ok(t.hp < hp - 40, `the bombs land on the destroyer (${hp} → ${t.hp.toFixed(0)})`);
  assert.ok(![...w.shots.values()].some((s) => s.w === 'jet'), 'and the jet is back on deck');
});

test('guns shoot down an incoming missile or aircraft, which needs several hits', () => {
  const w = new World({ track: 'atoll', seed: 2 });
  const d = w.addBoat({ id: 'd', name: 'D', cls: 'destroyer', local: true, slot: 0 });
  const e = w.addBoat({ id: 'e', name: 'E', cls: 'corvette', local: true, slot: 1 });
  racing(w, d, e);
  ahead(e, d, 900);
  e.lock = { target: 'd', t: 5, locked: true };
  w.setInput('e', { air: true });
  run(w, 2);
  const drone = [...w.shots.values()].find((s) => s.w === 'drone');
  assert.ok(drone, 'a drone is on its way');
  assert.equal(drone.hp, 5, 'it takes five rounds to bring down');
  // The destroyer's gun goes for it on its own once it is in range; we hold the trigger
  let downed = false;
  run(w, 20, () => { w.setInput('d', { gun: true }); for (const x of w.events) if (x.t === 'impact' && x.downed === drone.id) downed = true; w.drain(); });
  assert.ok(downed, 'the rotary cannon shoots it down');
});

test('a hit on a ship someone else owns goes to its owner, who takes the damage', () => {
  const shooter = new World({ track: 'atoll' });
  shooter.addBoat({ id: 'me', name: 'Me', local: true, slot: 0 });
  shooter.addBoat({ id: 'you', name: 'You', local: false, slot: 1 });
  shooter.damage('you', 12, 'me', 'c57');
  const hit = shooter.drain().find((e) => e.t === 'hit');
  assert.deepEqual([hit.id, hit.amount, hit.by], ['you', 12, 'me']);
  const owner = new World({ track: 'atoll' });
  const you = owner.addBoat({ id: 'you', name: 'You', local: true, slot: 1 });
  owner.addBoat({ id: 'me', name: 'Me', local: false, slot: 0 });
  owner.takeHit(hit.id, hit.amount, hit.by, hit.w);
  assert.equal(you.hp, you.k.hp - 12);
});

test('someone else\'s jet is drawn here but drops no bombs of its own: its owner\'s bombs arrive as their own shots', () => {
  const w = new World({ track: 'atoll' });
  w.addBoat({ id: 'me', name: 'Me', local: true, slot: 0 });
  const them = w.addBoat({ id: 'them', name: 'Them', cls: 'carrier', local: false, slot: 1 });
  w.applySnapshot('them', w.snapshot('them'), 0);
  w.spawnReplica({ t: 'fire', id: 'them:1', w: 'jet', owner: 'them', x: them.x, y: 10, z: them.z, vx: 0, vy: 0, vz: 100, target: 'me', home: 'them' });
  run(w, 10);
  assert.ok(!w.drain().some((e) => e.t === 'fire' && WEAPONS[e.w]?.slot === 'none' && e.net), 'no bombs from a copy');
});

test('a copy of someone else\'s ship moves smoothly between the positions its owner sends', () => {
  const w = new World({ track: 'atoll' });
  const b = w.addBoat({ id: 'r', name: 'R', local: false, slot: 0 });
  w.applySnapshot('r', { x: 0, z: 0, h: 0, vx: 0, vz: 30, hp: 100, lap: 1, nx: 1, pr: 0, fin: false, ft: null, th: 1, ay: 0, k: 0 }, 10);
  w.applySnapshot('r', { x: 0, z: 3, h: 0, vx: 0, vz: 30, hp: 100, lap: 1, nx: 1, pr: 0, fin: false, ft: null, th: 1, ay: 0, k: 0 }, 10.1);
  w.step(1 / 60, 10.17);
  assert.ok(b.z > 0.5 && b.z < 2.5, `between the two (${b.z.toFixed(2)})`);
});

test('a carrier rammed by an interceptor barely notices; the interceptor does', () => {
  const w = new World({ track: 'atoll' });
  const c = w.addBoat({ id: 'c', name: 'C', cls: 'carrier', local: true, slot: 0 });
  const i = w.addBoat({ id: 'i', name: 'I', cls: 'interceptor', local: true, slot: 1 });
  racing(w, c, i);
  // The interceptor at full speed into the carrier's side
  i.x = c.x + Math.cos(c.h) * 40; i.z = c.z - Math.sin(c.h) * 40;
  i.h = c.h - Math.PI / 2; i.vx = -Math.cos(c.h) * 45; i.vz = Math.sin(c.h) * 45;
  run(w, 1.5);
  assert.ok(Math.hypot(i.x - c.x, i.z - c.z) > c.k.beam / 2, 'the interceptor bounces off the hull');
  assert.ok(c.k.hp - c.hp < (i.k.hp - i.hp) * 0.5, `the carrier takes far less (${(c.k.hp - c.hp).toFixed(0)} against ${(i.k.hp - i.hp).toFixed(0)})`);
});

test('crates repair and rearm every slot', () => {
  const w = new World({ track: 'fjord' });
  const a = w.addBoat({ id: 'a', name: 'A', cls: 'carrier', local: true, slot: 0 });
  w.startCountdown(0.01);
  run(w, 0.1);
  const p = [...w.pickups.values()].find((x) => x.kind === 'ammo');
  a.ammo = { cannon: 0, missile: 0, air: 0 };
  a.x = p.x; a.z = p.z;
  w.step(1 / 60);
  assert.ok(a.ammo.cannon > 0 && a.ammo.missile >= 2 && a.ammo.air >= 1 && p.until > 0);
});

test('computer ships of every class finish a race on every course', () => {
  for (const track of Object.keys(TRACKS)) {
    const w = new World({ track, laps: 1, seed: 9 });
    const brains = new Map();
    const classes = Object.keys(BOATS);
    for (let i = 0; i < 8; i++) { w.addBoat({ id: `b${i}`, name: `B${i}`, cls: classes[i % 4], slot: i, local: true, bot: true }); brains.set(`b${i}`, botBrain(i, 0.8)); }
    w.startCountdown(0.01);
    for (let i = 0; i < 60 * 420 && [...w.boats.values()].some((b) => !b.finished); i++) {
      for (const [id, br] of brains) w.setInput(id, botInput(w, w.boats.get(id), br, 1 / 60));
      w.step(1 / 60);
      w.drain();
    }
    const done = [...w.boats.values()].filter((b) => b.finished).length;
    assert.ok(done >= 7, `${track}: ${done} of 8 finished`);
  }
});
