// A small piano synth on the Web Audio API: no samples to download.
// Each voice is a bright harmonic tone through a lowpass filter that closes as the note decays,
// plus a short hammer thump, into a shared room reverb.

let ctx = null;
let bus = null;
let wave = null;
let noise = null;
const active = new Set();

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp).connect(ctx.destination);

    const verb = ctx.createConvolver();
    verb.buffer = roomImpulse(2.2, 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.2;
    verb.connect(wet).connect(master);

    bus = ctx.createGain();
    bus.connect(master);
    bus.connect(verb);

    // Harmonics fall off roughly as 1/n^1.35, with the 7th and 9th softened as on a real string
    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) imag[i] = Math.pow(i, -1.35) * (i === 7 || i === 9 ? 0.5 : 1);
    wave = ctx.createPeriodicWave(real, imag);

    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function roomImpulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export const now = () => (ctx ? ctx.currentTime : 0);

// Starts a note at audio time `t` and returns a handle whose release() ends it.
// With `dur` the note releases itself after that many seconds.
export function note(midi, { t = now(), dur = null, vel = 0.85 } = {}) {
  if (!unlock()) return { release() {} };
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const start = Math.max(t, ctx.currentTime);

  const env = ctx.createGain();
  const rel = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.min(f * (7 + vel * 6), 15000), start);
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.8, 380), start + 1.6);
  lp.connect(env).connect(rel).connect(bus);

  // Lower notes ring longer, as on a piano
  const ring = 1.15 * Math.pow(261.6 / f, 0.45);
  const peak = 0.22 * vel;
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.005);
  env.gain.setTargetAtTime(peak * 0.38, start + 0.005, 0.14);
  env.gain.setTargetAtTime(0.0001, start + 0.3, ring);

  // Two strings a few cents apart give the slow shimmer of a real unison, and a sine adds body
  const oscs = [-3.5, 3.5].map(cents => {
    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = f;
    o.detune.value = cents;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    o.connect(g).connect(lp);
    return o;
  });
  const body = ctx.createOscillator();
  body.frequency.value = f;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.35;
  body.connect(bodyGain).connect(lp);
  oscs.push(body);

  const hammer = ctx.createBufferSource();
  hammer.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(f * 3, 4500);
  bp.Q.value = 1.2;
  const hg = ctx.createGain();
  hg.gain.value = 0.09 * vel;
  hammer.connect(bp).connect(hg).connect(rel);
  hammer.start(start);

  const life = Math.min(6, ring * 5 + 0.5);
  oscs.forEach(o => { o.start(start); o.stop(start + life); });

  // A later, earlier-timed release (hush, or a key let go) simply overrides a scheduled one
  const handle = {
    release(at = ctx.currentTime, fade = 0.09) {
      if (at < start) {
        // Not started yet: cancel it outright
        [...oscs, hammer].forEach(o => { try { o.stop(at); } catch { /* already stopped */ } });
        rel.gain.setValueAtTime(0, at);
        active.delete(handle);
        return;
      }
      const when = Math.max(at, start + 0.02);
      rel.gain.setTargetAtTime(0, when, fade);
      oscs.forEach(o => { try { o.stop(when + fade * 8); } catch { /* already stopped */ } });
    },
  };
  active.add(handle);
  oscs[0].onended = () => active.delete(handle);
  if (dur != null) handle.release(start + dur, 0.12);
  return handle;
}

export function chord(midis, opts) {
  return midis.map(m => note(m, { ...opts, vel: (opts?.vel ?? 0.85) * 0.8 }));
}

// Quickly fades out everything that is sounding (for pause and quit)
export function hush() {
  if (!ctx) return;
  [...active].forEach(h => h.release(ctx.currentTime, 0.04));
}
