// Sound, made on the fly with the Web Audio API (no sound files): our engine and the water rushing past, the
// guns' hammer (a rotary cannon's buzz), the naval guns' thump (deeper for bigger calibres), missile launches, jets
// taking off, explosions near and far, the lock tone, the incoming-missile warning, the countdown and pickups.
//
// Sounds out in the world are placed where they happen and heard from the camera, in 3-D: a shot off to the left
// is on the left, behind is behind, and far-off ones are quieter, duller (the air soaks up the highs) and arrive
// late (sound takes about three seconds to cross a kilometre). Everything echoes a little, as over open water.

import { WEAPONS } from './sim/boats.js';

const SPEED_OF_SOUND = 343;

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.ear = { x: 0, y: 0, z: 0 };
  }

  // Browsers only allow sound after the player has clicked or pressed a key
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    // The echo: a long, soft, darkening tail made from noise (a big open space over water)
    this.verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const f = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - f * 0.42);
        d[i] = lp * (1 - f) ** 2.6 * (i < ctx.sampleRate * 0.03 ? i / (ctx.sampleRate * 0.03) : 1);
      }
    }
    this.verb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.verb.connect(this.wet);
    this.wet.connect(this.master);
    // A second of noise, reused by every noisy sound
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Brown noise (deeper, for rumble)
    this.brown = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // Our engine: two detuned saws and a sub through a low-pass, and the water rushing past
    this.eng = ctx.createGain();
    this.eng.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.engLp = lp;
    this.oscs = [0, 7].map((cents) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents; o.frequency.value = 45; o.connect(lp); o.start(); return o; });
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = 22;
    const subG = ctx.createGain();
    subG.gain.value = 0.6;
    this.sub.connect(subG);
    subG.connect(lp);
    this.sub.start();
    lp.connect(this.eng);
    this.eng.connect(this.master);
    const water = ctx.createBufferSource();
    water.buffer = this.noise;
    water.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    this.waterBp = bp;
    this.water = ctx.createGain();
    this.water.gain.value = 0;
    water.connect(bp);
    bp.connect(this.water);
    this.water.connect(this.master);
    water.start();
  }

  setOn(on) { this.on = on; if (this.master) this.master.gain.value = on ? 0.6 : 0; }

  // Where we hear from: the camera
  listen(camera) {
    const p = camera.position;
    this.ear.x = p.x; this.ear.y = p.y; this.ear.z = p.z;
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    // The camera looks down its own -Z, with +Y up
    const f = [-e[8], -e[9], -e[10]];
    const u = [e[4], e[5], e[6]];
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f[0], t); L.forwardY.setValueAtTime(f[1], t); L.forwardZ.setValueAtTime(f[2], t);
      L.upX.setValueAtTime(u[0], t); L.upY.setValueAtTime(u[1], t); L.upZ.setValueAtTime(u[2], t);
    } else {
      L.setPosition?.(p.x, p.y, p.z);
      L.setOrientation?.(f[0], f[1], f[2], u[0], u[1], u[2]);
    }
  }

  engine(throttle, speed, alive) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 38 + Math.abs(speed) * 2.1 + Math.abs(throttle) * 18;
    for (const o of this.oscs) o.frequency.setTargetAtTime(f, t, 0.08);
    this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.1);
    this.engLp.frequency.setTargetAtTime(350 + Math.abs(throttle) * 900 + Math.abs(speed) * 12, t, 0.1);
    this.eng.gain.setTargetAtTime(alive ? 0.05 + Math.abs(throttle) * 0.08 : 0, t, 0.1);
    this.water.gain.setTargetAtTime(alive ? Math.min(0.22, Math.abs(speed) / 200) : 0, t, 0.2);
    this.waterBp.frequency.setTargetAtTime(700 + Math.abs(speed) * 14, t, 0.2);
  }

  // Where a sound goes: straight to the speakers (our own), or through a 3-D panner placed where it happened.
  // Returns { node, at (when it starts: later the farther away), dull (how much the air has soaked up) }, or null
  // if it is too far to hear.
  #place(pos, reach = 1, cheap = false) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!pos) return { node: this.master, send: this.verb, at: t, dist: 0 };
    const dist = Math.hypot(pos.x - this.ear.x, pos.y - this.ear.y, pos.z - this.ear.z);
    if (dist > 2500 * reach) return null;
    const p = ctx.createPanner();
    // Head-related panning (true 3-D, behind sounds behind) for the big sounds; plain left-right for small arms,
    // which come thick and fast
    p.panningModel = cheap ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 18 * reach;
    p.rolloffFactor = 1;
    p.maxDistance = 4000;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    // Far away the air takes the highs off
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(500, 18000 / (1 + dist / 120));
    air.connect(p);
    p.connect(this.master);
    // Far things echo more, relative to the direct sound
    const send = ctx.createGain();
    send.gain.value = Math.min(1.4, 0.5 + dist / 400);
    send.connect(this.verb);
    air.connect(send);
    return { node: air, at: t + Math.min(1.5, dist / SPEED_OF_SOUND), dist };
  }

  // A burst of filtered noise with a quick attack and a decay: most sounds are one or more of these
  #burst(out, { freq = 1000, q = 1, type = 'bandpass', gain = 0.3, decay = 0.2, pitch = 0, attack = 0.004, buf = this.noise, rate = 1, delay = 0 } = {}) {
    const ctx = this.ctx;
    const t = out.at + delay;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.2);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (pitch) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * pitch), t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    src.connect(f);
    f.connect(g);
    g.connect(out.node);
    if (out.send) g.connect(out.send);
    src.start(t, Math.random() * Math.max(0, buf.duration - decay - 0.1));
    src.stop(t + attack + decay + 0.05);
  }

  #thump(out, freq, gain, decay) {
    const ctx = this.ctx;
    const t = out.at;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.3), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g);
    g.connect(out.node);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  #tone(freq, dur, gain = 0.15, type = 'sine') {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  #out(x, y, z, reach, cheap = false) {
    if (!this.ctx || !this.on) return null;
    return this.#place(x === undefined ? null : { x, y: y ?? 0, z }, reach, cheap);
  }

  // At most about 30 gun sounds a second: with every ship's guns going at once, more would only cost frame rate
  #gunBudget() {
    const t = this.ctx.currentTime;
    if (t - (this.gunT ?? 0) > 1 / 30) { this.gunT = t; return true; }
    return false;
  }

  shot(w, x, y, z) {
    const W = WEAPONS[w];
    const k = W?.size ?? 1;
    const gun = W?.slot === 'gun';
    if (gun && this.ctx && !this.#gunBudget()) return;
    const out = this.#out(x, y, z, gun ? 0.25 : 1 + k * 0.3, gun);
    if (!out) return;
    if (w === 'hmg') { this.#burst(out, { freq: 1800, q: 0.8, gain: 0.22, decay: 0.07 }); this.#burst(out, { freq: 180, type: 'lowpass', gain: 0.3, decay: 0.09 }); }
    else if (w === 'ciws') { this.#burst(out, { freq: 2600, q: 1.2, gain: 0.14, decay: 0.045 }); this.#burst(out, { freq: 300, type: 'lowpass', gain: 0.16, decay: 0.05 }); }
    else if (W?.slot === 'cannon') {
      // The crack of the muzzle, the boom, and the low thud you feel
      this.#burst(out, { freq: 3000, q: 0.7, gain: 0.25, decay: 0.06 });
      this.#burst(out, { freq: 300 / k, type: 'lowpass', gain: 0.6 + 0.2 * k, decay: 0.35 + 0.15 * k, pitch: 0.4 });
      this.#thump(out, 70 / Math.sqrt(k), 0.5 + 0.15 * k, 0.3 + 0.1 * k);
    } else if (W?.slot === 'missile') {
      // Ignition, then the motor's roar
      this.#thump(out, 90, 0.5, 0.25);
      this.#burst(out, { freq: 700 / Math.sqrt(k), q: 0.5, gain: 0.45, decay: 1.6 + 0.3 * k, pitch: 2.4, attack: 0.05 });
      this.#burst(out, { freq: 140, type: 'lowpass', gain: 0.45, decay: 0.9, buf: this.brown });
    } else if (W?.slot === 'air') {
      this.#burst(out, { freq: w === 'jet' ? 500 : 900, q: 0.4, gain: 0.35, decay: 2.4, pitch: 3, attack: 0.3 });
      if (w === 'jet') this.#burst(out, { freq: 120, type: 'lowpass', gain: 0.4, decay: 2, buf: this.brown, attack: 0.3 });
    } else if (W) this.#burst(out, { freq: 1500, q: 2, gain: 0.08, decay: 0.8, pitch: 0.5 }); // a bomb falling
  }

  // An explosion: the flat crack, the boom with a falling pitch, a deep thump, and debris rumbling down after
  explosion(w, x, y, z) {
    const p = { c30: 0.8, c57: 1, c76: 1.2, asm: 1.4, cruise: 2, bomb: 1.6, heavybomb: 2, drone: 1, jet: 1.3, boat: 2.2 }[w] ?? 1;
    const out = this.#out(x, y, z, 1 + p);
    if (!out) return;
    this.#burst(out, { freq: 2200, q: 0.5, gain: 0.25 + 0.05 * p, decay: 0.12 });
    this.#burst(out, { freq: 180 / Math.sqrt(p), type: 'lowpass', gain: Math.min(1, 0.5 + 0.3 * p), decay: 0.8 + 0.6 * p, pitch: 0.3 });
    this.#thump(out, 55, Math.min(1, 0.4 + 0.25 * p), 0.5 + 0.3 * p);
    this.#burst(out, { freq: 90, type: 'lowpass', gain: 0.3 + 0.12 * p, decay: 1.5 + p, buf: this.brown, attack: 0.08, delay: 0.05 });
    if (p >= 1.4) this.#burst(out, { freq: 1200, q: 0.3, gain: 0.1, decay: 1.2, delay: 0.25 }); // spray and debris falling back
  }

  warning() { this.#tone(1560, 0.09, 0.1, 'square'); }

  splash(x, y, z) {
    if (!this.ctx || !this.#gunBudget()) return;
    const out = this.#out(x, y, z, 0.25, true);
    if (out) this.#burst(out, { freq: 1200, q: 0.4, gain: 0.14, decay: 0.3 });
  }

  hit() {
    const out = this.#out();
    if (!out) return;
    this.#burst(out, { freq: 3200, q: 3, gain: 0.18, decay: 0.05 });
    this.#burst(out, { freq: 400, type: 'lowpass', gain: 0.2, decay: 0.12 });
  }

  lock(locked) { this.#tone(locked ? 1320 : 880, locked ? 0.18 : 0.05, 0.08, 'square'); }
  beep(go) { this.#tone(go ? 880 : 440, go ? 0.6 : 0.25, 0.2); }
  pickup() { this.#tone(660, 0.12, 0.12); setTimeout(() => this.#tone(990, 0.18, 0.12), 90); }
}
