// The race itself, without any drawing: boats on the swell, their weapons and what they hit, the gates and laps,
// supply crates, sinking and coming back. The same code runs in every player's browser.
//
// Each browser is in charge of its own boat (and the host's of the computer-run boats): it moves it, fires its
// weapons and decides what its own shells and missiles hit. Everyone else's boats are copies, moved smoothly
// between the positions their owners send. A hit on a boat someone else owns is sent to that owner, who takes the
// damage; a boat's owner decides when it sinks. Things that happen go into `events`, for the screen, the sound
// and the network.

import { BOATS, WEAPONS, MOUNTS, AIM_CONE, AIM_RANGE, RESPAWN, SHIELD, ARM_GATE } from './boats.js';
import { buildCourse, gridSlot, nearestOnLine, GATE_HALF, rng } from './track.js';
import { waveSet, heightAt, slopeAt } from './waves.js';

const BOAT_RADIUS = 4.2;
const PICKUP_RADIUS = 8;
const PICKUP_RESPAWN = 20;
const INTERP = 0.12; // seconds behind the newest position a copy is drawn at, to smooth out the network

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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

  /* ---------- Boats ---------- */

  addBoat({ id, name, cls = 'gunboat', color = '#e63946', slot = 0, local = false, bot = false }) {
    const k = BOATS[cls] ?? BOATS.gunboat;
    const g = gridSlot(this.course, slot);
    const b = {
      id, name, cls, color, slot, local, bot, k,
      x: g.x, z: g.z, h: g.h, vx: 0, vz: 0, y: 0, pitch: 0, roll: 0, speed: 0,
      throttle: 0, steer: 0, input: { throttle: 0, steer: 0, gun: false, cannon: false, missile: false },
      hp: k.hp, dead: false, respawnAt: 0, shieldUntil: 0,
      lap: 1, next: 1, lastGate: 0, prog: 0, finished: false, finishTime: null, lineHint: -1, offCourse: false,
      heat: 0, overheated: false, armed: false, shells: k.shells, missiles: k.missiles, reload: 0,
      cd: { hmg: 0, cannon: 0, missile: 0 }, aim: { yaw: 0, target: null }, lock: { target: null, t: 0, locked: false },
      kills: 0, deaths: 0, snaps: [], seen: 0,
    };
    this.boats.set(id, b);
    this.#pose(b);
    return b;
  }

  removeBoat(id) { this.boats.delete(id); }

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
      this.#pose(b);
    }
    for (const b of this.boats.values()) if (b.local && !b.dead) this.#collide(b, dt);
    this.#moveShots(dt);
    for (const p of this.pickups.values()) if (p.until && p.until <= this.t) p.until = 0;
  }

  // A boat of ours: its engine, rudder, weapons, the gates it passes and the crates it picks up
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
    // A badly damaged boat loses power
    const top = k.top * (b.hp < k.hp * 0.25 ? 0.82 : 1);
    const fx = Math.sin(b.h);
    const fz = Math.cos(b.h);
    let vf = b.vx * fx + b.vz * fz;
    let vr = b.vx * fz - b.vz * fx;
    const thrust = b.throttle >= 0 ? b.throttle * k.accel : b.throttle * k.accel * 0.55;
    const drag = k.accel / (top * top);
    vf += (thrust - drag * vf * Math.abs(vf) - 0.05 * vf) * dt;
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
    b.offCourse = near.d > 380;
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
    for (const p of this.pickups.values()) {
      if (p.until || Math.hypot(b.x - p.x, b.z - p.z) > PICKUP_RADIUS) continue;
      if (p.kind === 'repair' && b.hp >= b.k.hp) continue;
      if (p.kind === 'ammo' && b.shells >= b.k.shells && b.missiles >= b.k.missiles) continue;
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
    if (p.kind === 'repair') b.hp = Math.min(b.k.hp, b.hp + 45);
    else { b.shells = Math.min(b.k.shells, b.shells + 30); b.missiles = Math.min(b.k.missiles, b.missiles + 2); }
  }

  /* ---------- Weapons ---------- */

  // The best target ahead: within the cone and range, nearest to the bow line
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

  #weapons(b, dt, racing) {
    for (const k of Object.keys(b.cd)) b.cd[k] = Math.max(0, b.cd[k] - dt);
    // The machine gun cools; overheated, it is silent until it is cool again
    b.heat = Math.max(0, b.heat - WEAPONS.hmg.cool * dt);
    if (b.overheated && b.heat < 0.35) b.overheated = false;
    // Missiles reload one at a time
    if (b.missiles < b.k.missiles) { b.reload += dt; if (b.reload >= WEAPONS.missile.reload) { b.reload = 0; b.missiles++; } } else b.reload = 0;
    // The turrets track the best target ahead (aim assist), else point down the bow
    const target = this.#targetAhead(b, AIM_CONE, AIM_RANGE);
    if (target) {
      const d = Math.hypot(target.x - b.x, target.z - b.z);
      const lead = d / WEAPONS.hmg.speed;
      const ax = target.x + target.vx * lead - b.x;
      const az = target.z + target.vz * lead - b.z;
      b.aim = { yaw: Math.max(-AIM_CONE, Math.min(AIM_CONE, wrapAngle(Math.atan2(ax, az) - b.h))), target: target.id, dist: d };
    } else b.aim = { yaw: 0, target: null, dist: 0 };
    // Missile lock: hold a target in the cone ahead
    const cand = this.#targetAhead(b, WEAPONS.missile.lockCone, WEAPONS.missile.lockRange);
    if (cand && cand.id === b.lock.target) b.lock.t += dt; else b.lock = { target: cand?.id ?? null, t: 0, locked: false };
    b.lock.locked = Boolean(b.lock.target) && b.lock.t >= WEAPONS.missile.lockTime;
    if (!racing) return;
    const inp = b.input;
    if (inp.gun && !b.overheated && b.cd.hmg <= 0) {
      b.cd.hmg = 1 / WEAPONS.hmg.rate;
      b.heat += WEAPONS.hmg.heatPerShot;
      if (b.heat >= 1) { b.heat = 1; b.overheated = true; this.events.push({ t: 'overheat', id: b.id }); }
      this.#fire(b, 'hmg', target);
    }
    if (inp.cannon && b.shells > 0 && b.cd.cannon <= 0) {
      b.cd.cannon = 1 / WEAPONS.cannon.rate;
      b.shells--;
      this.#fire(b, 'cannon', target);
    }
    if (inp.missile && b.missiles > 0 && b.cd.missile <= 0) {
      b.cd.missile = 1 / WEAPONS.missile.rate;
      b.missiles--;
      this.#fire(b, 'missile', b.lock.locked ? this.boats.get(b.lock.target) : null);
      b.input.missile = false; // one per press
    }
  }

  #fire(b, w, target) {
    const W = WEAPONS[w];
    const [fwd, up] = MOUNTS[w];
    const L = b.k.length;
    const fx = Math.sin(b.h);
    const fz = Math.cos(b.h);
    const x = b.x + fx * fwd * L;
    const z = b.z + fz * fwd * L;
    const y = b.y + up;
    // The computer's gunners are less steady than a player's
    const spread = (W.spread ?? 0) * (b.bot ? 2.6 : 1);
    const yaw = b.h + (w === 'missile' ? 0 : b.aim.yaw) + (this.rand() - 0.5) * 2 * spread;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    let speed = w === 'missile' ? W.launch : W.speed;
    let vy;
    if (w === 'missile') vy = 3;
    else {
      // Elevation to reach the target (or, with none, a fixed range down the bow)
      const range = target ? Math.hypot(target.x - x, target.z - z) : w === 'cannon' ? 300 : 260;
      const tFlight = range / speed;
      const ty = target ? target.y + 1.4 : 0.5;
      vy = (ty - y) / tFlight + 0.5 * W.gravity * tFlight + (this.rand() - 0.5) * 2 * spread * speed;
    }
    const id = `${b.id}:${++this.seq}`;
    const shot = {
      id, w, owner: b.id, x, y, z, vx: dx * speed + b.vx, vy, vz: dz * speed + b.vz, life: W.life, target: w === 'missile' ? target?.id ?? null : null, local: true, speed,
    };
    this.shots.set(id, shot);
    this.events.push({ t: 'fire', id, w, owner: b.id, x, y, z, vx: shot.vx, vy, vz: shot.vz, target: shot.target, net: true });
  }

  // A shot fired by someone else's boat: it is drawn here, but its owner decides what it hits
  spawnReplica(e) {
    if (this.shots.has(e.id)) return;
    this.shots.set(e.id, { id: e.id, w: e.w, owner: e.owner, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, life: WEAPONS[e.w].life, target: e.target ?? null, local: false, speed: Math.hypot(e.vx, e.vz) });
    this.events.push({ ...e, t: 'fire', net: false });
  }

  // Someone else's shot ended (a hit or a splash): it goes, and the screen shows where
  replicaImpact(e) {
    this.shots.delete(e.id);
    this.events.push({ ...e, t: 'impact', net: false });
  }

  #moveShots(dt) {
    for (const s of this.shots.values()) {
      const W = WEAPONS[s.w];
      s.life -= dt;
      if (s.w === 'missile') this.#guide(s, W, dt);
      else s.vy -= W.gravity * dt;
      const steps = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy, s.vz) * dt) / 4));
      let ended = false;
      for (let i = 0; i < steps && !ended; i++) {
        s.x += (s.vx * dt) / steps;
        s.y += (s.vy * dt) / steps;
        s.z += (s.vz * dt) / steps;
        if (!s.local) { if (s.y < heightAt(this.waves, s.x, s.z, this.t) - 0.5) ended = true; continue; }
        const hit = this.#hitBoat(s);
        if (hit) { this.#impact(s, hit); ended = true; continue; }
        if (this.#hitObstacle(s) || s.y < heightAt(this.waves, s.x, s.z, this.t)) { this.#impact(s, null); ended = true; }
      }
      if (!ended && s.life <= 0) {
        if (s.local && s.w !== 'hmg') this.#impact(s, null);
        ended = true;
      }
      if (ended) this.shots.delete(s.id);
    }
  }

  // A missile flies low over the water and turns toward where its target will be
  #guide(s, W, dt) {
    const sp = Math.min(W.speed, Math.hypot(s.vx, s.vz) + W.accel * dt);
    let yaw = Math.atan2(s.vx, s.vz);
    const t = s.target ? this.boats.get(s.target) : null;
    if (t && !t.dead) {
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      const lead = Math.min(2, d / sp);
      const want = Math.atan2(t.x + t.vx * lead - s.x, t.z + t.vz * lead - s.z);
      yaw += Math.max(-W.turn * dt, Math.min(W.turn * dt, wrapAngle(want - yaw)));
    }
    const sea = heightAt(this.waves, s.x, s.z, this.t);
    s.vy = (sea + 2.2 - s.y) * 3;
    s.vx = Math.sin(yaw) * sp;
    s.vz = Math.cos(yaw) * sp;
  }

  // The boat a shot has struck, if any: each boat is a capsule along its length
  #hitBoat(s) {
    for (const b of this.boats.values()) {
      if (b.id === s.owner || b.dead) continue;
      const L = b.k.length * 0.42;
      const fx = Math.sin(b.h);
      const fz = Math.cos(b.h);
      const along = Math.max(-L, Math.min(L, (s.x - b.x) * fx + (s.z - b.z) * fz));
      const px = b.x + fx * along;
      const pz = b.z + fz * along;
      const dy = s.y - (b.y + 1.3);
      const r = b.k.beam * 0.65 + (s.w === 'missile' ? 2.5 : 0.4);
      if ((s.x - px) ** 2 + (s.z - pz) ** 2 + (dy > 0 ? (dy * 0.8) ** 2 : dy * dy) < r * r) return b;
    }
    return null;
  }

  #hitObstacle(s) {
    for (const o of this.obstacles) {
      const d = Math.hypot(s.x - o.x, s.z - o.z);
      if (d < o.r * 0.85 && s.y < o.h * (1 - (d / o.r) ** 2) + 0.5) return o;
    }
    return null;
  }

  // One of our shots ends: damage to the boat it struck, and around it for explosive rounds
  #impact(s, boat) {
    const W = WEAPONS[s.w];
    if (boat) this.damage(boat.id, W.damage, s.owner, s.w, s);
    if (W.splash) {
      for (const b of this.boats.values()) {
        if (b === boat || b.dead) continue;
        const d = Math.hypot(b.x - s.x, b.z - s.z, (b.y + 1) - s.y);
        if (d < W.splash) this.damage(b.id, W.splashDamage * (1 - d / W.splash), s.owner, s.w, s);
      }
    }
    this.events.push({ t: 'impact', id: s.id, w: s.w, owner: s.owner, x: s.x, y: s.y, z: s.z, boat: boat?.id ?? null, net: s.w !== 'hmg' || Boolean(boat) });
  }

  // Damage to a boat: taken here if it is ours, otherwise sent to its owner
  damage(id, amount, by, w, at = null) {
    const b = this.boats.get(id);
    if (!b || b.dead || amount <= 0) return;
    if (!b.local) { this.events.push({ t: 'hit', id, amount: Math.round(amount * 10) / 10, by, w, net: true }); return; }
    this.takeHit(id, amount, by, w);
    if (at) this.events.push({ t: 'hurt', id, by, w });
  }

  // A hit on one of our boats (from our own shot, or reported by the shooter)
  takeHit(id, amount, by, w) {
    const b = this.boats.get(id);
    if (!b?.local || b.dead || this.t < b.shieldUntil || this.phase === 'over') return;
    b.hp -= amount;
    this.events.push({ t: 'damaged', id, amount, by, w });
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      b.respawnAt = this.t + RESPAWN;
      this.sunk({ id, by, w });
      this.events.push({ t: 'sunk', id, by, w, x: b.x, z: b.z, net: true });
    }
  }

  // A boat is sunk (here, or on another player's screen): the score
  sunk({ id, by }) {
    const b = this.boats.get(id);
    if (b) b.deaths++;
    const k = by && by !== id ? this.boats.get(by) : null;
    if (k) k.kills++;
    if (b && !b.local) { b.dead = true; }
  }

  /* ---------- Collisions ---------- */

  #collide(b, dt) {
    for (const o of this.obstacles) {
      const dx = b.x - o.x;
      const dz = b.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + BOAT_RADIUS;
      if (d >= min || d < 0.01) continue;
      const nx = dx / d;
      const nz = dz / d;
      b.x = o.x + nx * min;
      b.z = o.z + nz * min;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) {
        b.vx -= 1.4 * vn * nx;
        b.vz -= 1.4 * vn * nz;
        b.vx *= 0.6; b.vz *= 0.6;
        const dmg = Math.max(0, -vn - 7) * 1.5;
        if (dmg > 0) this.takeHit(b.id, dmg, null, o.kind);
        this.events.push({ t: 'crash', id: b.id, x: b.x, z: b.z, hard: -vn });
      }
    }
    // Other boats: pushed apart, and a hard ram hurts
    for (const o of this.boats.values()) {
      if (o === b || o.dead) continue;
      const dx = b.x - o.x;
      const dz = b.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = BOAT_RADIUS * 1.7;
      if (d >= min || d < 0.01) continue;
      const nx = dx / d;
      const nz = dz / d;
      b.x += nx * (min - d) * 0.5;
      b.z += nz * (min - d) * 0.5;
      const rel = (b.vx - o.vx) * nx + (b.vz - o.vz) * nz;
      if (rel < 0) {
        const share = o.k.mass / (o.k.mass + b.k.mass);
        b.vx -= 1.2 * rel * nx * share;
        b.vz -= 1.2 * rel * nz * share;
        const dmg = Math.max(0, -rel - 9) * 1.2 * share;
        if (dmg > 0) this.takeHit(b.id, dmg, o.id, 'ram');
      }
    }
    void dt;
  }

  /* ---------- Copies of other players' boats ---------- */

  // A position from a boat's owner (s: their snapshot, at: when it arrived here, in seconds)
  applySnapshot(id, s, at) {
    const b = this.boats.get(id);
    if (!b || b.local) return;
    b.snaps.push({ ...s, at });
    if (b.snaps.length > 12) b.snaps.shift();
    // The score and status come straight from the owner
    b.hp = s.hp; b.lap = s.lap; b.next = s.nx; b.prog = s.pr; b.finished = s.fin; b.finishTime = s.ft;
    b.shieldUntil = s.sh ? this.t + 0.3 : 0; b.throttle = s.th; b.aim = { yaw: s.ay ?? 0, target: null };
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

  // What a boat's owner sends everyone, several times a second
  snapshot(id) {
    const b = this.boats.get(id);
    const r = (v, k = 10) => Math.round(v * k) / k;
    return {
      x: r(b.x), z: r(b.z), h: r(b.h, 1000), vx: r(b.vx), vz: r(b.vz), hp: r(b.hp), dead: b.dead, sh: this.t < b.shieldUntil,
      lap: b.lap, nx: b.next, pr: r(b.prog, 1000), fin: b.finished, ft: b.finishTime == null ? null : r(b.finishTime, 100), th: r(b.throttle, 100), ay: r(b.aim.yaw, 100), k: b.kills,
    };
  }

  /* ---------- How a boat sits on the sea ---------- */

  #pose(b) {
    const sea = heightAt(this.waves, b.x, b.z, this.t);
    const { sx, sz } = slopeAt(this.waves, b.x, b.z, this.t);
    const fx = Math.sin(b.h);
    const fz = Math.cos(b.h);
    // Riding the swell, the bow lifting as the hull planes, banking into turns
    const along = sx * fx + sz * fz;
    const across = sx * fz - sz * fx;
    const plane = Math.min(1, Math.abs(b.speed) / b.k.top);
    const sinking = b.dead ? Math.min(1, (this.t - (b.respawnAt - RESPAWN)) / RESPAWN) : 0;
    const ty = sea + 0.15 + plane * 0.35 - sinking * 3.5;
    b.y += (ty - b.y) * 0.35;
    // pitch: bow up is positive; roll: the boat's left (+x when heading 0) side up is positive
    b.pitch += ((Math.atan(along) * 0.8 + plane * 0.07 + b.throttle * 0.03 - sinking * 0.4) - b.pitch) * 0.2;
    b.roll += ((Math.atan(across) * 0.8 - b.steer * plane * 0.22 + sinking * 0.5) - b.roll) * 0.15;
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
