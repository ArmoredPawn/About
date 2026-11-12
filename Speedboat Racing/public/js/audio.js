// Procedural Web Audio API sound synthesizer for Hydro Rush
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.initialized = false;
    this.engineGain = null;
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineFilter = null;
    this.wakeGain = null;
    this.wakeSource = null;
    this.isEngineRunning = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.initialized = true;
      this.setupEngineSynth();
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  ensureContext() {
    if (!this.initialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.engineGain) {
      this.engineGain.gain.setValueAtTime(this.muted ? 0 : 0.08, this.ctx.currentTime);
    }
    return this.muted;
  }

  setupEngineSynth() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Dual oscillator marine outboard engine
    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc2.type = 'triangle';
    this.engineOsc1.frequency.setValueAtTime(55, now);
    this.engineOsc2.frequency.setValueAtTime(110, now);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(450, now);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0, now);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // Procedural water wake noise
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.wakeSource = this.ctx.createBufferSource();
    this.wakeSource.buffer = noiseBuffer;
    this.wakeSource.loop = true;

    this.wakeFilter = this.ctx.createBiquadFilter();
    this.wakeFilter.type = 'bandpass';
    this.wakeFilter.frequency.setValueAtTime(700, now);
    this.wakeFilter.Q.setValueAtTime(1.5, now);

    this.wakeGain = this.ctx.createGain();
    this.wakeGain.gain.setValueAtTime(0, now);

    this.wakeSource.connect(this.wakeFilter);
    this.wakeFilter.connect(this.wakeGain);
    this.wakeGain.connect(this.ctx.destination);
    this.wakeSource.start();

    this.isEngineRunning = true;
  }

  updateEngine(speedRatio, throttle, isBoosting) {
    if (!this.ctx || this.muted || !this.isEngineRunning) return;
    const now = this.ctx.currentTime;
    const normSpeed = Math.min(1.4, Math.max(0, speedRatio));

    // Engine RPM modulation
    const baseFreq = 50 + normSpeed * 110 + (throttle > 0 ? 35 : 0) + (isBoosting ? 50 : 0);
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.05);

    const filterCutoff = 350 + normSpeed * 850 + (isBoosting ? 600 : 0);
    this.engineFilter.frequency.setTargetAtTime(filterCutoff, now, 0.05);

    const targetEngineGain = Math.max(0.02, Math.min(0.12, 0.03 + normSpeed * 0.07 + (throttle > 0 ? 0.02 : 0)));
    this.engineGain.gain.setTargetAtTime(targetEngineGain, now, 0.08);

    // Water wake rushing sound
    const targetWakeGain = Math.max(0, Math.min(0.08, normSpeed * 0.07));
    this.wakeGain.gain.setTargetAtTime(targetWakeGain, now, 0.05);
    this.wakeFilter.frequency.setTargetAtTime(500 + normSpeed * 800, now, 0.05);
  }

  stopEngine() {
    if (!this.ctx || !this.engineGain) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, now, 0.1);
    if (this.wakeGain) this.wakeGain.gain.setTargetAtTime(0, now, 0.1);
  }

  playCountdownBeep(isGo) {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (isGo) {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.35);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  }

  playBoost() {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Sub-bass drop
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.6);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.7);

    // Whoosh noise
    this.createNoiseBurst(now, 0.5, 900, 2500, 0.15);
  }

  playJump() {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.4);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  playSplash() {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Low thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);

    // Water splash noise
    this.createNoiseBurst(now, 0.35, 400, 1600, 0.2);
  }

  playBump() {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.15);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  playRockHit() {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Harsh crunch
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);

    this.createNoiseBurst(now, 0.25, 200, 1200, 0.22);
  }

  playExplosion() {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Deep boom
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.9);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 1.0);

    // Explosive blast noise
    this.createNoiseBurst(now, 0.8, 100, 1800, 0.35);
  }

  playCheer() {
    if (!this.ctx || this.muted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 arpeggio

    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const noteTime = now + i * 0.12;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);
      gain.gain.setValueAtTime(0.18, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.45);
    });
  }

  createNoiseBurst(startTime, duration, lowCut, highCut, peakVolume) {
    if (!this.ctx) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-3 * (i / bufferSize));
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime((lowCut + highCut) / 2, startTime);
    filter.Q.setValueAtTime(1.0, startTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peakVolume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    source.start(startTime);
    source.stop(startTime + duration);
  }
}

export const sounds = new SoundEngine();
