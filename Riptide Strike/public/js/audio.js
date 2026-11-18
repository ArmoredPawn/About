// Sound, made on the fly with the Web Audio API (no sound files): our engine's roar and the water rushing past,
// the machine gun's hammer, the cannon's thump, a missile's launch, explosions near and far, the lock tone, the
// countdown and pickups. Sounds of other boats fade with distance.

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
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
    this.master.connect(comp);
    comp.connect(ctx.destination);
    // Half a second of noise, reused by every noisy sound
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Our engine: two detuned saws through a low-pass, and the water rushing past
    this.eng = ctx.createGain();
    this.eng.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.engLp = lp;
    this.oscs = [0, 7].map((cents) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents; o.frequency.value = 45; o.connect(lp); o.start(); return o; });
    lp.connect(this.eng);
    this.eng.connect(this.master);
    const water = ctx.createBufferSource();
    water.buffer = this.noise;
    water.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    this.water = ctx.createGain();
    this.water.gain.value = 0;
    water.connect(bp);
    bp.connect(this.water);
    this.water.connect(this.master);
    water.start();
  }

  setOn(on) { this.on = on; if (this.master) this.master.gain.value = on ? 0.6 : 0; }

  engine(throttle, speed, alive) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 38 + Math.abs(speed) * 2.1 + Math.abs(throttle) * 18;
    for (const o of this.oscs) o.frequency.setTargetAtTime(f, t, 0.08);
    this.engLp.frequency.setTargetAtTime(350 + Math.abs(throttle) * 900 + Math.abs(speed) * 12, t, 0.1);
    this.eng.gain.setTargetAtTime(alive ? 0.05 + Math.abs(throttle) * 0.08 : 0, t, 0.1);
    this.water.gain.setTargetAtTime(alive ? Math.min(0.2, Math.abs(speed) / 220) : 0, t, 0.2);
  }

  // A burst of filtered noise with a quick attack and a decay: most sounds are one of these
  #burst({ freq = 1000, q = 1, type = 'bandpass', gain = 0.3, decay = 0.2, dist = 0, pitch = 0 } = {}) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const fall = 1 / (1 + (dist / 120) ** 2);
    if (fall < 0.02) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (pitch) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * pitch), t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * fall, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + decay + 0.05);
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

  shot(w, dist) {
    if (w === 'hmg') { this.#burst({ freq: 1800, q: 0.8, gain: 0.22, decay: 0.07, dist }); this.#burst({ freq: 180, type: 'lowpass', gain: 0.25, decay: 0.09, dist }); }
    else if (w === 'cannon') { this.#burst({ freq: 260, type: 'lowpass', gain: 0.7, decay: 0.35, dist, pitch: 0.4 }); this.#burst({ freq: 2500, gain: 0.15, decay: 0.08, dist }); }
    else { this.#burst({ freq: 700, q: 0.5, gain: 0.45, decay: 1.4, dist, pitch: 2.4 }); this.#burst({ freq: 120, type: 'lowpass', gain: 0.4, decay: 0.5, dist }); }
  }

  explosion(big, dist) {
    this.#burst({ freq: 140 * (big ? 0.7 : 1), type: 'lowpass', gain: big ? 1 : 0.6, decay: big ? 1.8 : 0.9, dist, pitch: 0.35 });
    this.#burst({ freq: 900, gain: 0.25, decay: 0.4, dist });
  }

  splash(dist) { this.#burst({ freq: 1200, q: 0.4, gain: 0.12, decay: 0.25, dist }); }
  hit() { this.#burst({ freq: 3200, q: 3, gain: 0.18, decay: 0.05 }); }
  lock(locked) { this.#tone(locked ? 1320 : 880, locked ? 0.18 : 0.05, 0.08, 'square'); }
  beep(go) { this.#tone(go ? 880 : 440, go ? 0.6 : 0.25, 0.2); }
  pickup() { this.#tone(660, 0.12, 0.12); setTimeout(() => this.#tone(990, 0.18, 0.12), 90); }
}
