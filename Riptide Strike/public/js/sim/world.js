// The race itself, without any drawing: ships on the swell, their weapons and what they hit, the gates and laps,
// supply crates, sinking and coming back. The same code runs in every player's browser.
//
// Each browser is in charge of its own ship (and the host's of the computer-run ones): it moves it, fires its
// weapons and decides what its own shells, missiles and bombs hit. Everyone else's ships are copies, moved
// smoothly between the positions their owners send. A hit on a ship someone else owns is sent to that owner, who
// takes the damage; a ship's owner decides when it sinks. Things that happen go into `events`, for the screen, the
// sound and the network.
//
// Shots are everything in flight: gun rounds, shells, missiles, aircraft and bombs. Aircraft fly out to their
// target, drop their bombs and head home. Guns engage incoming missiles and aircraft first (air defence): a round
// that strikes one shoots it down.

import { BOATS, WEAPONS, SLOTS, mountOf, AIM_CONE, AIM_RANGE, RESPAWN, SHIELD, ARM_GATE } from './boats.js';
import { buildCourse, gridSlot, nearestOnLine, GATE_HALF, rng } from './track.js';
import { waveSet, heightAt, slopeAt } from './waves.js';

const PICKUP_RESPAWN = 20;
const INTERP = 0.12; // seconds behind the newest position a copy is drawn at, to smooth out the network
const AA_RANGE = 480; // guns engage aircraft and missiles this close
const AIR_RADIUS = { drone: 3.2, jet: 4.5, asm: 2.4, cruise: 3 };
// Rounds it takes to bring one down
const AIR_HP = { drone: 5, jet: 9, asm: 3, cruise: 6 };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const isAircraft = (w) => WEAPONS[w]?.slot === 'air';
const isMissile = (w) => WEAPONS[w]?.slot === 'missile';
const isBomb = (w) => w === 'bomb' || w === 'heavybomb';

// Circles along a ship's length, for running into things: one every 14 m or so
function hullCircles(b) {
  const L = b.k.length;
  const n = Math.max(1, Math.round(L / 14));
  const r = b.k.beam / 2 + 0.8;
  const fx = Math.sin(b.h);
  const fz = Math.cos(b.h);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (L - 2 * r) * 0.95;
    out.push({ x: b.x + fx * t, z: b.z + fz * t, r });
  }
  return out;
}

export class World {
  constructor({ track = 'atoll', laps = 3, seed = 1 } = {}) {
    this.course = buildCourse(track);
    this.track = track;
    this.laps = laps;
    this.waves = waveSet(this.course.def.waves);
    this.t = 0; // the sea's clock, always running
    this.clock = 0; // the race clock, from the start
    this.phase = 'grid'; // grid → countdown → race → over
    this.countdown = 0;
    this.boats = new Map();
    this.shots = new Map();
    this.pickups = new Map(this.course.pickups.map((p) => [p.id, { ...p, until: 0 }]));
    this.events = [];
    this.rand = rng(seed * 7919 + 13);
    this.seq = 0;
    this.obstacles = [...this.course.islands.map((o) => ({ ...o, kind: 'island' })), ...this.course.rocks.map((o) => ({ ...o, kind: 'rock' }))];
  }

  /* ---------- Ships ---------- */

  addBoat({ id, name, cls = 'corvette', color = '#e63946', slot = 0, local = false, bot = false }) {
    const k = BOATS[cls] ?? BOATS.corvette;
    const g = gridSlot(this.course, slot);
    const b = {
      id, name, cls: BOATS[cls] ? cls : 'corvette', color, slot, local, bot, k,
      x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, y: 0, pitch: 0, roll: 0, speed: 0,
      throttle: 0, steer: 0, input: { throttle: 0, steer: 0, gun: false, cannon: false, missile: false, air: false },
      hp: k.hp, dead: false, respawnAt: 0, shieldUntil: 0,
      lap: 1, next: 1, lastGate: 0, prog: 0, finished: false, finishTime: null, lineHint: -1, offCourse: false,
      heat: 0, overheated: false, armed: false,
      ammo: { ...k.ammo }, reload: { missile: 0, air: 0 },
      cd: { gun: 0, cannon: 0, missile: 0, air: 0 }, aim: { yaw: 0, pitch: 0, target: null, dist: 0, air: false }, lock: { target: null, t: 0, locked: false },
      kills: 0, deaths: 0, snaps: [], seen: 0,
    };
    this.boats.set(id, b);
    this.#pose(b);
    return b;
  }

  removeBoat(id) { this.boats.delete(id); }
  weapon(b, slot) { return WEAPONS[b.k.loadout[slot]]; }

  setInput(id, input) {
    const b = this.boats.get(id);
    if (b) b.input = { ...b.input, ...input };
  }

  startCountdown(seconds = 3) {
    this.phase = 'countdown';
    this.countdown = seconds;
  }

  /* ---------- The step ---------- */

  step(dt, now = this.t + dt) {
    this.t += dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = 'race'; this.clock = -this.countdown; this.events.push({ t: 'go' }); }
    } else if (this.phase === 'race') this.clock += dt;
    for (const b of this.boats.values()) {
      if (b.local) this.#drive(b, dt);
      else this.#follow(b, now);
      // A ship that ended up somewhere impossible (it shouldn't, but a bad number would black out the screen)
      // goes back to its last gate
      if (!Number.isFinite(b.x + b.z + b.h + b.vx + b.vz + b.y)) { if (b.local) this.#respawn(b); else { b.x = b.z = b.h = b.vx = b.vz = 0; b.snaps = []; } b.y = 0; }
      this.#pose(b);
    }
    for (const b of this.boats.values()) if (b.local && !b.dead) this.#collide(b);
    this.#moveShots(dt);
    for (const p of this.pickups.values()) if (p.until && p.until <= this.t) p.until = 0;
  }

  // A ship of ours: its engines, rudder, weapons, the gates it passes and the crates it picks up
  #drive(b, dt) {
    if (b.dead) {
      if (this.t >= b.respawnAt) this.#respawn(b);
      return;
    }
    const racing = this.phase === 'race' && !b.finished;
    const inp = b.input;
    const throttle = racing ? Math.max(-1, Math.min(1, inp.throttle)) : b.finished ? 0.25 : 0;
    const steer = Math.max(-1, Math.min(1, inp.steer));
    b.throttle += (throttle - b.throttle) * Math.min(1, dt * 4);
    b.steer += (steer - b.steer) * Math.min(1, dt * 6);
    const k = b.k;
    // A badly damaged ship loses power
    const top = k.top * (b.hp < k.hp * 0.25 ? 0.82 : 1);
    const fx = Math.sin(b.h);
    const fz = Math.cos(b.h);
    let vf = b.vx * fx + b.vz * fz;
    let vr = b.vx * fz - b.vz * fx;
    const thrust = b.throttle >= 0 ? b.throttle * k.accel : b.throttle * k.accel * 0.55;
    // Water resistance, mostly growing with the square of the speed, set so that full throttle settles exactly at
    // the ship's top speed
    const lin = 0.02;
    const drag = (k.accel - lin * top) / (top * top);
    vf += (thrust - drag * vf * Math.abs(vf) - lin * vf) * dt;
    // The keel bites: sideways speed dies away, less so when the throttle is off at speed (a drift)
    const grip = k.grip * (Math.abs(b.throttle) < 0.2 && Math.abs(vf) > 15 ? 0.45 : 1);
    vr *= Math.exp(-grip * dt);
    const steerEff = Math.min(1, Math.abs(vf) / 10) * (1 - 0.4 * Math.min(1, Math.abs(vf) / top)) * Math.sign(vf || 1);
    b.h = wrapAngle(b.h + b.steer * k.turn * steerEff * dt);
    const nfx = Math.sin(b.h);
    const nfz = Math.cos(b.h);
    b.vx = nfx * vf + nfz * vr;
    b.vz = nfz * vf - nfx * vr;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.speed = vf;

    this.#gates(b);
    this.#crates(b);
    // Weapons arm once past the first gate, so the start isn't a massacre
    b.armed = b.lap > 1 || b.next > ARM_GATE || b.next === 0;
    this.#weapons(b, dt, racing && b.armed);
    const near = nearestOnLine(this.course.line, b.x, b.z, b.lineHint);
    b.lineHint = near.i;
    b.offCourse = near.d > 420;
  }

  #respawn(b) {
    const g = this.course.gates[b.lastGate];
    const nx = this.course.gates[(b.lastGate + 1) % this.course.gates.length];
    b.dead = false;
    b.hp = b.k.hp;
    b.x = g.x; b.z = g.z;
    b.h = Math.atan2(nx.x - g.x, nx.z - g.z);
    b.vx = 0; b.vz = 0; b.speed = 0; b.throttle = 0;
    b.shieldUntil = this.t + SHIELD;
    b.heat = 0; b.overheated = false;
    b.lock = { target: null, t: 0, locked: false };
    this.events.push({ t: 'respawn', id: b.id });
  }

  // Each gate in order; the start gate ends a lap
  #gates(b) {
    if (this.phase !== 'race' || b.finished) return;
    const gates = this.course.gates;
    const g = gates[b.next];
    if (Math.hypot(b.x - g.x, b.z - g.z) < GATE_HALF) {
      b.lastGate = b.next;
      if (b.next === 0) {
        b.lap++;
        if (b.lap > this.laps) {
          b.finished = true;
          b.finishTime = this.clock;
          this.events.push({ t: 'finish', id: b.id, time: this.clock, net: true });
        } else this.events.push({ t: 'lap', id: b.id, lap: b.lap });
      } else this.events.push({ t: 'gate', id: b.id, gate: b.next });
      b.next = (b.next + 1) % gates.length;
    }
    const prev = gates[(b.next - 1 + gates.length) % gates.length];
    const nx = gates[b.next];
    const span = Math.hypot(nx.x - prev.x, nx.z - prev.z) || 1;
    const frac = Math.max(0, Math.min(0.999, 1 - Math.hypot(b.x - nx.x, b.z - nx.z) / span));
    const done = (b.lap - 1) * gates.length + ((b.next - 1 + gates.length) % gates.length);
    b.prog = b.finished ? this.laps * gates.length + 1000 - b.finishTime : done + frac;
  }

  #crates(b) {
    const reach = 8 + b.k.beam / 2;
    for (const p of this.pickups.values()) {
      if (p.until || Math.hypot(b.x - p.x, b.z - p.z) > reach) continue;
      if (p.kind === 'repair' && b.hp >= b.k.hp) continue;
      if (p.kind === 'ammo' && Object.keys(b.ammo).every((s) => b.ammo[s] >= b.k.ammo[s])) continue;
      this.takePickup(p.id, b.id);
      this.events.push({ t: 'pickup', id: p.id, boat: b.id, kind: p.kind, net: true });
    }
  }

  // A crate is taken (here, or on another player's screen)
  takePickup(id, boatId) {
    const p = this.pickups.get(id);
    if (!p) return;
    p.until = this.t + PICKUP_RESPAWN;
    const b = this.boats.get(boatId);
    if (!b?.local) return;
    if (p.kind === 'repair') b.hp = Math.min(b.k.hp, b.hp + b.k.hp * 0.4);
    else {
      b.ammo.cannon = Math.min(b.k.ammo.cannon, b.ammo.cannon + Math.ceil(b.k.ammo.cannon * 0.4));
      b.ammo.missile = Math.min(b.k.ammo.missile, b.ammo.missile + 2);
      b.ammo.air = Math.min(b.k.ammo.air, b.ammo.air + 1);
    }
  }

  /* ---------- Weapons ---------- */

  // The best ship ahead: within the cone and range, nearest to the bow line
  #targetAhead(b, cone, range) {
    let best = null;
    let score = Infinity;
    for (const o of this.boats.values()) {
      if (o === b || o.dead) continue;
      const dx = o.x - b.x;
      const dz = o.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 5) continue;
      const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - b.h));
      if (off > cone) continue;
      const sc = off * 400 + d;
      if (sc < score) { score = sc; best = o; }
    }
    return best;
  }

  // The nearest enemy aircraft or missile coming for us, for the guns
  #airThreat(b) {
    let best = null;
    let bd = AA_RANGE;
    for (const s of this.shots.values()) {
      if (s.owner === b.id || !(isAircraft(s.w) || isMissile(s.w)) || s.downed) continue;
      // A missile only matters if it is coming our way
      if (isMissile(s.w) && s.target && s.target !== b.id) continue;
      const d = Math.hypot(s.x - b.x, s.z - b.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  #weapons(b, dt, racing) {
    for (const k of Object.keys(b.cd)) b.cd[k] = Math.max(0, b.cd[k] - dt);
    const gun = this.weapon(b, 'gun');
    const missile = this.weapon(b, 'missile');
    const air = this.weapon(b, 'air');
    // The gun cools; overheated, it is silent until it is cool again
    b.heat = Math.max(0, b.heat - gun.cool * dt);
    if (b.overheated && b.heat < 0.35) b.overheated = false;
    // Missiles and aircraft come back one at a time
    for (const [slot, W] of [['missile', missile], ['air', air]]) {
      if (b.ammo[slot] < b.k.ammo[slot]) { b.reload[slot] += dt; if (b.reload[slot] >= W.reload) { b.reload[slot] = 0; b.ammo[slot]++; } } else b.reload[slot] = 0;
    }
    // The guns go for the nearest incoming missile or aircraft; otherwise they track the best ship ahead
    const threat = this.#airThreat(b);
    const target = this.#targetAhead(b, AIM_CONE, AIM_RANGE);
    if (threat) {
      const d = Math.hypot(threat.x - b.x, threat.z - b.z);
      const lead = d / gun.speed;
      const ax = threat.x + threat.vx * lead - b.x;
      const az = threat.z + threat.vz * lead - b.z;
      b.aim = { yaw: wrapAngle(Math.atan2(ax, az) - b.h), target: threat.id, dist: d, air: true, y: threat.y + threat.vy * lead };
    } else if (target) {
      const d = Math.hypot(target.x - b.x, target.z - b.z);
      const lead = d / gun.speed;
      const ax = target.x + target.vx * lead - b.x;
      const az = target.z + target.vz * lead - b.z;
      b.aim = { yaw: Math.max(-AIM_CONE, Math.min(AIM_CONE, wrapAngle(Math.atan2(ax, az) - b.h))), target: target.id, dist: d, air: false };
    } else b.aim = { yaw: 0, target: null, dist: 0, air: false };
    // Missile lock: hold a ship in the cone ahead
    const cand = this.#targetAhead(b, missile.lockCone, missile.lockRange);
    if (cand && cand.id === b.lock.target) b.lock.t += dt; else b.lock = { target: cand?.id ?? null, t: 0, locked: false };
    b.lock.locked = Boolean(b.lock.target) && b.lock.t >= missile.lockTime;
    if (!racing) return;
    const inp = b.input;
    if (inp.gun && !b.overheated && b.cd.gun <= 0) {
      b.cd.gun = 1 / gun.rate;
      b.heat += gun.heatPerShot;
      if (b.heat >= 1) { b.heat = 1; b.overheated = true; this.events.push({ t: 'overheat', id: b.id }); }
      this.#fire(b, 'gun', b.aim.air ? null : target, b.aim.air ? b.aim : null);
    }
    const cannon = this.weapon(b, 'cannon');
    if (inp.cannon && b.ammo.cannon > 0 && b.cd.cannon <= 0) {
      b.cd.cannon = 1 / cannon.rate;
      b.ammo.cannon--;
      this.#fire(b, 'cannon', target);
    }
    if (inp.missile && b.ammo.missile > 0 && b.cd.missile <= 0) {
      b.cd.missile = 1 / missile.rate;
      b.ammo.missile--;
      this.#fire(b, 'missile', b.lock.locked ? this.boats.get(b.lock.target) : null);
      b.input.missile = false; // one per press
    }
    if (inp.air && b.ammo.air > 0 && b.cd.air <= 0) {
      b.cd.air = 1 / air.rate;
      b.ammo.air--;
      // A strike goes for the locked ship, else the one in the sights, else the nearest ahead
      const t = (b.lock.target && this.boats.get(b.lock.target)) || target || this.#targetAhead(b, 1.2, 1600);
      this.#fire(b, 'air', t);
      b.input.air = false;
    }
  }

  // Fire a weapon from a slot. target: a ship to aim at; aa: an aircraft or missile to aim at instead
  #fire(b, slot, target, aa = null) {
    const wid = b.k.loadout[slot];
    const W = WEAPONS[wid];
    const [fwd, up] = mountOf(b.k, slot);
    const L = b.k.length;
    const fx = Math.sin(b.h);
    const fz = Math.cos(b.h);
    const x = b.x + fx * fwd * L;
    const z = b.z + fz * fwd * L;
    const y = b.y + up;
    // The computer's gunners are less steady than a player's
    const spread = (W.spread ?? 0) * (b.bot ? 2.6 : 1);
    const guided = slot === 'missile' || slot === 'air';
    const yaw = b.h + (guided ? 0 : b.aim.yaw) + (this.rand() - 0.5) * 2 * spread;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const speed = slot === 'missile' ? W.launch : slot === 'air' ? W.speed * 0.6 : W.speed;
    let vy;
    if (slot === 'missile') vy = W.vertical ? 40 : 3;
    else if (slot === 'air') vy = 8;
    else {
      // Elevation to reach the target (or, with none, a fixed range down the bow)
      const range = aa ? aa.dist : target ? Math.hypot(target.x - x, target.z - z) : slot === 'cannon' ? 340 : 280;
      const tFlight = Math.max(0.05, range / speed);
      const ty = aa ? aa.y : target ? target.y + target.k.beam * 0.25 : 0.5;
      vy = (ty - y) / tFlight + 0.5 * W.gravity * tFlight + (this.rand() - 0.5) * 2 * spread * speed;
    }
    this.#spawn(b.id, wid, x, y, z, dx * speed + b.vx, vy, dz * speed + b.vz, guided ? target?.id ?? null : null, { home: slot === 'air' ? b.id : null });
  }

  // Something new in the air: kept here, and announced (for the screen, the sound and the network)
  #spawn(owner, w, x, y, z, vx, vy, vz, target, extra = {}) {
    const id = `${owner}:${++this.seq}`;
    const W = WEAPONS[w];
    this.shots.set(id, { id, w, owner, x, y, z, vx, vy, vz, life: W.life, age: 0, target, local: true, bombs: W.bombs ?? 0, phase: 'out', dropT: 0, hp: AIR_HP[w] ?? 1, ...extra });
    this.events.push({ t: 'fire', id, w, owner, x, y, z, vx, vy, vz, target, home: extra.home ?? null, net: true });
    return id;
  }

  // A shot fired by someone else: it is drawn here, but its owner decides what it hits
  spawnReplica(e) {
    if (this.shots.has(e.id) || !WEAPONS[e.w]) return;
    const W = WEAPONS[e.w];
    this.shots.set(e.id, { id: e.id, w: e.w, owner: e.owner, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, life: W.life, age: 0, target: e.target ?? null, local: false, home: e.home ?? null, bombs: W.bombs ?? 0, phase: 'out', dropT: 0, hp: AIR_HP[e.w] ?? 1 });
    this.events.push({ ...e, t: 'fire', net: false });
  }

  // Someone else's shot ended (a hit, a splash, or shot down): it goes, and the screen shows where
  replicaImpact(e) {
    this.shots.delete(e.id);
    if (e.downed) this.shots.delete(e.downed);
    this.events.push({ ...e, t: 'impact', net: false });
  }

  #moveShots(dt) {
    for (const s of this.shots.values()) {
      const W = WEAPONS[s.w];
      s.life -= dt;
      s.age += dt;
      if (W.slot === 'missile') this.#guide(s, W, dt);
      else if (W.slot === 'air') { if (this.#fly(s, W, dt)) { this.shots.delete(s.id); continue; } } else s.vy -= W.gravity * dt;
      const steps = W.slot === 'air' ? 1 : Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy, s.vz) * dt) / 4));
      let ended = false;
      for (let i = 0; i < steps && !ended; i++) {
        s.x += (s.vx * dt) / steps;
        s.y += (s.vy * dt) / steps;
        s.z += (s.vz * dt) / steps;
        if (W.slot === 'air') continue;
        if (!s.local) { if (s.y < heightAt(this.waves, s.x, s.z, this.t) - 0.5) ended = true; continue; }
        // Gun rounds can shoot down missiles and aircraft
        if (W.slot === 'gun') {
          const down = this.#hitAir(s);
          if (down) {
            down.hp -= 1;
            if (down.hp <= 0) this.#shootDown(s, down);
            else this.events.push({ t: 'impact', id: s.id, w: s.w, owner: s.owner, x: s.x, y: s.y, z: s.z, boat: null, air: true, net: false });
            ended = true;
            continue;
          }
        }
        const hit = this.#hitBoat(s);
        if (hit) { this.#impact(s, hit); ended = true; continue; }
        if (this.#hitObstacle(s) || s.y < heightAt(this.waves, s.x, s.z, this.t)) { this.#impact(s, null); ended = true; }
      }
      if (!ended && s.life <= 0) {
        if (s.local && W.slot !== 'gun') this.#impact(s, null);
        ended = true;
      }
      if (ended) this.shots.delete(s.id);
    }
  }

  // A missile skims the water and turns toward where its target will be. A heavy cruise missile climbs out of its
  // launch cell first, then dives to sea-skimming height.
  #guide(s, W, dt) {
    const sp = Math.min(W.speed, Math.hypot(s.vx, s.vz) + W.accel * dt);
    let yaw = Math.atan2(s.vx, s.vz);
    const t = s.target ? this.boats.get(s.target) : null;
    if (t && !t.dead && !(W.vertical && s.age < 0.8)) {
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      const lead = Math.min(2.5, d / sp);
      const want = Math.atan2(t.x + t.vx * lead - s.x, t.z + t.vz * lead - s.z);
      yaw += Math.max(-W.turn * dt, Math.min(W.turn * dt, wrapAngle(want - yaw)));
    }
    const sea = heightAt(this.waves, s.x, s.z, this.t);
    const cruise = W.vertical && s.age < 1.4 ? sea + 45 : sea + 2.6 * (W.size ?? 1);
    s.vy += ((cruise - s.y) * 3 - s.vy) * Math.min(1, dt * 4);
    s.vx = Math.sin(yaw) * sp;
    s.vz = Math.cos(yaw) * sp;
  }

  // An aircraft: out to its target at its cruising height, bombs away when they would land on it, then home to
  // its ship (or off the edge of the course). Returns true when it has landed or flown away.
  #fly(s, W, dt) {
    const sea = heightAt(this.waves, s.x, s.z, this.t);
    const target = s.target ? this.boats.get(s.target) : null;
    const home = s.home ? this.boats.get(s.home) : null;
    let gx;
    let gz;
    let alt = W.altitude;
    if (s.phase === 'out') {
      if (target && !target.dead) {
        const fall = Math.sqrt((2 * W.altitude) / WEAPONS[W.bomb].gravity);
        const px = target.x + target.vx * fall;
        const pz = target.z + target.vz * fall;
        gx = px; gz = pz;
        const sp = Math.hypot(s.vx, s.vz);
        const d = Math.hypot(px - s.x, pz - s.z);
        // Bombs away: they fly on at the aircraft's speed while they fall
        if (d <= sp * fall + 6 && s.age > 1.5) s.phase = 'drop';
      } else {
        // No target (or it sank): fly on, and bomb whatever comes under us
        gx = s.x + s.vx; gz = s.z + s.vz;
        if (s.age > 8) s.phase = 'drop';
      }
    }
    if (s.phase === 'drop') {
      gx = s.x + s.vx; gz = s.z + s.vz;
      s.dropT -= dt;
      if (s.dropT <= 0 && s.bombs > 0) {
        s.dropT = 0.16;
        s.bombs--;
        if (s.local) this.#spawn(s.owner, W.bomb, s.x, s.y - 2, s.z, s.vx, s.vy - 2, s.vz, null);
      }
      if (s.bombs <= 0) s.phase = 'home';
    }
    if (s.phase === 'home') {
      if (home && !home.dead) {
        gx = home.x; gz = home.z;
        alt = Math.max(12, Math.min(W.altitude, Math.hypot(home.x - s.x, home.z - s.z) * 0.15));
        if (Math.hypot(home.x - s.x, home.z - s.z) < home.k.length * 0.4) return true; // back on deck
      } else { gx = s.x + s.vx; gz = s.z + s.vz; }
    }
    if (s.life <= 0) return true;
    // Steer toward the goal, climbing or descending to the height we want
    const sp = Math.min(W.speed, Math.hypot(s.vx, s.vz) + 40 * dt);
    let yaw = Math.atan2(s.vx, s.vz);
    yaw += Math.max(-1.1 * dt, Math.min(1.1 * dt, wrapAngle(Math.atan2(gx - s.x, gz - s.z) - yaw)));
    s.vx = Math.sin(yaw) * sp;
    s.vz = Math.cos(yaw) * sp;
    s.vy += ((sea + alt - s.y) * 1.2 - s.vy) * Math.min(1, dt * 2);
    return false;
  }

  // The ship a shot has struck, if any: each ship is a capsule along its length
  #hitBoat(s) {
    const big = isMissile(s.w) ? 2.5 : isBomb(s.w) ? 1.5 : 0.4;
    for (const b of this.boats.values()) {
      if (b.id === s.owner || b.dead) continue;
      const L = b.k.length * 0.44;
      const fx = Math.sin(b.h);
      const fz = Math.cos(b.h);
      const along = Math.max(-L, Math.min(L, (s.x - b.x) * fx + (s.z - b.z) * fz));
      const px = b.x + fx * along;
      const pz = b.z + fz * along;
      const top = b.y + b.k.beam * 0.55 + (b.k.length > 20 ? 4 : 1);
      const dy = s.y < b.y ? b.y - s.y : s.y > top ? s.y - top : 0;
      const r = b.k.beam * 0.6 + big;
      if ((s.x - px) ** 2 + (s.z - pz) ** 2 + dy * dy < r * r) return b;
    }
    return null;
  }

  // The enemy aircraft or missile a gun round has struck, if any
  #hitAir(s) {
    for (const o of this.shots.values()) {
      if (o === s || o.owner === s.owner || o.downed || !(isAircraft(o.w) || isMissile(o.w))) continue;
      const r = AIR_RADIUS[o.w] ?? 3;
      if ((o.x - s.x) ** 2 + (o.y - s.y) ** 2 + (o.z - s.z) ** 2 < r * r) return o;
    }
    return null;
  }

  #shootDown(s, o) {
    o.downed = true;
    this.shots.delete(o.id);
    this.events.push({ t: 'impact', id: s.id, w: o.w, owner: s.owner, x: o.x, y: o.y, z: o.z, boat: null, downed: o.id, air: true, net: true });
  }

  #hitObstacle(s) {
    for (const o of this.obstacles) {
      const d = Math.hypot(s.x - o.x, s.z - o.z);
      if (d < o.r * 0.85 && s.y < o.h * (1 - (d / o.r) ** 2) + 0.5) return o;
    }
    return null;
  }

  // One of our shots ends: damage to the ship it struck, and around it for explosive rounds
  #impact(s, boat) {
    const W = WEAPONS[s.w];
    if (boat) this.damage(boat.id, W.damage, s.owner, s.w, s);
    if (W.splash) {
      for (const b of this.boats.values()) {
        if (b === boat || b.dead) continue;
        // Distance to the nearest point of its hull
        let d = Infinity;
        for (const c of hullCircles(b)) d = Math.min(d, Math.max(0, Math.hypot(c.x - s.x, c.z - s.z, (b.y + 2) - s.y) - c.r));
        if (d < W.splash) this.damage(b.id, W.splashDamage * (1 - d / W.splash), s.owner, s.w, s);
      }
    }
    this.events.push({ t: 'impact', id: s.id, w: s.w, owner: s.owner, x: s.x, y: s.y, z: s.z, boat: boat?.id ?? null, net: W.slot !== 'gun' || Boolean(boat) });
  }

  // Damage to a ship: taken here if it is ours, otherwise sent to its owner
  damage(id, amount, by, w, at = null) {
    const b = this.boats.get(id);
    if (!b || b.dead || amount <= 0) return;
    if (!b.local) { this.events.push({ t: 'hit', id, amount: Math.round(amount * 10) / 10, by, w, net: true }); return; }
    this.takeHit(id, amount, by, w, at);
  }

  // A hit on one of our ships (from our own shot, or reported by the shooter)
  takeHit(id, amount, by, w, at = null) {
    const b = this.boats.get(id);
    if (!b?.local || b.dead || this.t < b.shieldUntil || this.phase === 'over') return;
    b.hp -= amount;
    const from = by ? this.boats.get(by) : null;
    this.events.push({ t: 'damaged', id, amount, by, w, fx: at?.x ?? from?.x ?? null, fz: at?.z ?? from?.z ?? null });
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      b.respawnAt = this.t + RESPAWN;
      this.sunk({ id, by, w });
      this.events.push({ t: 'sunk', id, by, w, x: b.x, z: b.z, net: true });
    }
  }

  // A ship is sunk (here, or on another player's screen): the score
  sunk({ id, by }) {
    const b = this.boats.get(id);
    if (b) b.deaths++;
    const k = by && by !== id ? this.boats.get(by) : null;
    if (k) k.kills++;
    if (b && !b.local) { b.dead = true; }
  }

  /* ---------- Collisions ---------- */

  #collide(b) {
    const mine = hullCircles(b);
    for (const o of this.obstacles) {
      if (Math.hypot(b.x - o.x, b.z - o.z) > o.r + b.k.length) continue;
      for (const c of mine) {
        const dx = c.x - o.x;
        const dz = c.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + c.r;
        if (d >= min || d < 0.01) continue;
        const nx = dx / d;
        const nz = dz / d;
        b.x += nx * (min - d);
        b.z += nz * (min - d);
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= 1.4 * vn * nx;
          b.vz -= 1.4 * vn * nz;
          b.vx *= 0.6; b.vz *= 0.6;
          const dmg = Math.max(0, -vn - 7) * 1.5 * Math.sqrt(b.k.mass);
          if (dmg > 0) this.takeHit(b.id, dmg, null, o.kind);
          if (-vn > 3) this.events.push({ t: 'crash', id: b.id, x: c.x, z: c.z, hard: -vn });
        }
        break;
      }
    }
    // Other ships: pushed apart, and a hard ram hurts (the lighter ship more)
    for (const o of this.boats.values()) {
      if (o === b || o.dead || Math.hypot(b.x - o.x, b.z - o.z) > (b.k.length + o.k.length) / 2 + 4) continue;
      const theirs = hullCircles(o);
      let best = null;
      for (const c of mine) for (const e of theirs) {
        const d = Math.hypot(c.x - e.x, c.z - e.z);
        const pen = c.r + e.r - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: (c.x - e.x) / (d || 1), nz: (c.z - e.z) / (d || 1) };
      }
      if (!best) continue;
      const share = o.k.mass / (o.k.mass + b.k.mass);
      b.x += best.nx * best.pen * share;
      b.z += best.nz * best.pen * share;
      const rel = (b.vx - o.vx) * best.nx + (b.vz - o.vz) * best.nz;
      if (rel < 0) {
        b.vx -= 1.2 * rel * best.nx * share;
        b.vz -= 1.2 * rel * best.nz * share;
        const dmg = Math.max(0, -rel - 9) * 1.4 * share * Math.sqrt(o.k.mass);
        if (dmg > 0) this.takeHit(b.id, dmg, o.id, 'ram');
      }
    }
  }

  /* ---------- Copies of other players' ships ---------- */

  // A position from a ship's owner (s: their snapshot, at: when it arrived here, in seconds)
  applySnapshot(id, s, at) {
    const b = this.boats.get(id);
    if (!b || b.local) return;
    b.snaps.push({ ...s, at });
    if (b.snaps.length > 12) b.snaps.shift();
    // The score and status come straight from the owner
    b.hp = s.hp; b.lap = s.lap; b.next = s.nx; b.prog = s.pr; b.finished = s.fin; b.finishTime = s.ft;
    b.shieldUntil = s.sh ? this.t + 0.3 : 0; b.throttle = s.th; b.aim = { yaw: s.ay ?? 0, target: null, dist: 0, air: false };
    b.kills = Math.max(b.kills, s.k ?? 0);
    if (b.dead && !s.dead) this.events.push({ t: 'respawn', id });
    b.dead = Boolean(s.dead);
    b.seen = at;
  }

  #follow(b, now) {
    const snaps = b.snaps;
    if (!snaps.length) return;
    const t = now - INTERP;
    let a = snaps[0];
    let c = null;
    for (const s of snaps) { if (s.at <= t) a = s; else { c = s; break; } }
    if (c && c !== a) {
      const f = Math.max(0, Math.min(1, (t - a.at) / Math.max(0.001, c.at - a.at)));
      b.x = a.x + (c.x - a.x) * f;
      b.z = a.z + (c.z - a.z) * f;
      b.h = a.h + wrapAngle(c.h - a.h) * f;
      b.vx = a.vx + (c.vx - a.vx) * f;
      b.vz = a.vz + (c.vz - a.vz) * f;
    } else {
      // Past the newest one: carry on at its speed, for a moment
      const ahead = Math.min(0.3, t - a.at);
      b.x = a.x + a.vx * ahead;
      b.z = a.z + a.vz * ahead;
      b.h = a.h;
      b.vx = a.vx; b.vz = a.vz;
    }
    b.speed = b.vx * Math.sin(b.h) + b.vz * Math.cos(b.h);
  }

  // What a ship's owner sends everyone, several times a second
  snapshot(id) {
    const b = this.boats.get(id);
    const r = (v, k = 10) => Math.round(v * k) / k;
    return {
      x: r(b.x), z: r(b.z), h: r(b.h, 1000), vx: r(b.vx), vz: r(b.vz), hp: r(b.hp), dead: b.dead, sh: this.t < b.shieldUntil,
      lap: b.lap, nx: b.next, pr: r(b.prog, 1000), fin: b.finished, ft: b.finishTime == null ? null : r(b.finishTime, 100), th: r(b.throttle, 100), ay: r(b.aim.yaw, 100), k: b.kills,
    };
  }

  /* ---------- How a ship sits on the sea ---------- */

  #pose(b) {
    const sea = heightAt(this.waves, b.x, b.z, this.t);
    const { sx, sz } = slopeAt(this.waves, b.x, b.z, this.t);
    const fx = Math.sin(b.h);
    const fz = Math.cos(b.h);
    // Riding the swell (big ships less so), the bow lifting as the hull planes, banking into turns
    const along = sx * fx + sz * fz;
    const across = sx * fz - sz * fx;
    const steady = 1 / (1 + b.k.length / 25);
    const plane = Math.min(1, Math.abs(b.speed) / b.k.top);
    const sinking = b.dead ? Math.min(1, (this.t - (b.respawnAt - RESPAWN)) / RESPAWN) : 0;
    const ty = sea * (0.4 + 0.6 * steady) + 0.15 + plane * 0.35 - sinking * (3 + b.k.beam * 0.6);
    b.y += (ty - b.y) * 0.35;
    // pitch: bow up is positive; roll: the ship's left (+x when heading 0) side up is positive
    b.pitch += ((Math.atan(along) * 0.8 * steady + plane * 0.07 * steady + b.throttle * 0.03 * steady - sinking * 0.3) - b.pitch) * 0.2;
    b.roll += ((Math.atan(across) * 0.8 * steady - b.steer * plane * (0.08 + 0.14 * steady) + sinking * 0.45) - b.roll) * 0.15;
  }

  /* ---------- The standings ---------- */

  standings() {
    return [...this.boats.values()].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.prog - a.prog;
    });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export { SLOTS };
