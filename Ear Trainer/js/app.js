import { KEYS, LOW, DRILLS, drillById, makeQuestion, describeMiss, noteName, fullName, isBlack, sameNote } from './music.js';
import * as audio from './audio.js';

const $ = id => document.getElementById(id);
const ROUNDS_PER_STAGE = 6;
const MAX_LIVES = 3;
const ENCORE_DRILLS = ['chromatic', 'intervals', 'chords', 'melodies', 'intervals', 'chords', 'melodies'];
const PRAISE = ['Nice', 'Spot on', 'Yes', 'Great ear', 'Perfect', 'Nailed it'];
const coarse = matchMedia('(pointer: coarse)');

// Saved in this browser only: the personal best and the note-names setting
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`by-ear.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`by-ear.${key}`, JSON.stringify(value)); } catch { /* storage blocked: skip */ }
  },
};

/* ---------- The piano ---------- */

const keyEls = new Map();
const codeToMidi = new Map(KEYS.map(k => [k.code, k.midi]));
const held = new Map();
let midiSound = true;

function buildPiano() {
  const piano = $('piano');
  const whites = KEYS.filter(k => !isBlack(k.midi)).length;
  piano.style.setProperty('--whites', whites);
  let whiteIndex = 0;
  for (const k of KEYS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.tabIndex = -1;
    el.className = `key ${isBlack(k.midi) ? 'black' : 'white'}`;
    el.dataset.midi = k.midi;
    el.setAttribute('aria-label', `${fullName(k.midi)}, laptop key ${k.label}`);
    el.innerHTML = `<span class="key-note">${noteName(k.midi)}</span><kbd class="key-cap">${k.label}</kbd>`;
    if (isBlack(k.midi)) el.style.left = `${(whiteIndex / whites) * 100}%`;
    else whiteIndex++;
    piano.append(el);
    keyEls.set(k.midi, el);
  }

  piano.addEventListener('pointerdown', e => {
    const key = e.target.closest('.key');
    if (!key) return;
    e.preventDefault();
    press(+key.dataset.midi, `p${e.pointerId}`);
  });
  const up = e => lift(`p${e.pointerId}`);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

// A note from outside the on-screen range (a MIDI keyboard) lights the key with the same name
const keyFor = midi => keyEls.get(midi) ?? keyEls.get(LOW + (((midi % 12) + 12) % 12));

function press(midi, source, vel = 0.85, { silent = false } = {}) {
  audio.unlock();
  // With the key map open you can try keys freely, even mid-game (the game is paused then)
  const free = helpOpen;
  if (!free) {
    if (paused) return;
    if (phase === 'listen') { nudge('Listen first. You can answer once the sound has played.'); return; }
    if (phase === 'banner') { nudge(coarse.matches ? 'Tap <b>Start</b> to begin the stage.' : 'Press <kbd>Enter</kbd> to start the stage.'); return; }
  }
  lift(source);
  const el = keyFor(midi);
  const voice = silent ? null : audio.note(midi, { vel });
  el?.classList.add('is-down');
  capFor(midi)?.forEach(c => c.classList.add('is-down'));
  held.set(source, { voice, el, midi });

  if (free) return;
  if (phase === 'answer') answer(midi, el);
  else if (screen === 'menu') tutorial(midi);
}

function lift(source) {
  const h = held.get(source);
  if (!h) return;
  held.delete(source);
  h.voice?.release();
  if (![...held.values()].some(o => o.el === h.el)) h.el?.classList.remove('is-down');
  capFor(h.midi)?.forEach(c => c.classList.remove('is-down'));
}

const liftAll = () => [...held.keys()].forEach(lift);

function flashKey(el, cls, ms = 450) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  later(() => el.classList.remove(cls), ms, 'ui');
}

function clearKeys() {
  keyEls.forEach(el => el.classList.remove('is-given', 'is-found', 'is-right', 'is-wrong', 'is-reveal', 'is-sounding'));
}

/* ---------- The laptop-key diagram ---------- */

const capEls = new Map();
const capFor = midi => capEls.get(midi) ?? capEls.get(LOW + (((midi % 12) + 12) % 12));

function buildKeymap(container) {
  const byLabel = new Map(KEYS.map(k => [k.label, k.midi]));
  // Each row is offset as on a real keyboard, which also puts every black-key cap between its two white keys
  const rows = [['1234567890', 0, 'upper'], ['QWERTYUIOP', 0.5, 'upper'], ['ASDFGHJKL;', 0.75, 'lower'], ['ZXCVBNM,./', 1.25, 'lower']];
  for (const [letters, offset, octave] of rows) {
    const line = document.createElement('div');
    line.className = `keymap-row is-${octave}`;
    line.style.setProperty('--offset', offset);
    for (const letter of letters) {
      const midi = byLabel.get(letter);
      const cap = document.createElement('span');
      cap.className = `cap ${midi == null ? 'is-off' : isBlack(midi) ? 'is-black' : 'is-white'}`;
      cap.innerHTML = `<b>${letter}</b><small>${midi == null ? '' : noteName(midi)}</small>`;
      line.append(cap);
      if (midi != null) capEls.set(midi, [...(capEls.get(midi) ?? []), cap]);
    }
    container.append(line);
  }
}

function buildKeyTable() {
  $('keytable').innerHTML = KEYS.map(k =>
    `<tr><th scope="row">${k.label}</th><td>${fullName(k.midi)}${isBlack(k.midi) ? ' (black key)' : ''}</td></tr>`).join('');
}

/* ---------- Screens, timers and the hint line ---------- */

let screen = 'menu';
let phase = 'menu';
let paused = false;
let helpOpen = false;
const timers = { ui: new Set(), hint: new Set(), prompt: new Set(), flow: new Set() };

function later(fn, ms, group = 'flow') {
  const id = setTimeout(() => { timers[group].delete(id); fn(); }, ms);
  timers[group].add(id);
  return id;
}
function cancel(group) {
  timers[group].forEach(clearTimeout);
  timers[group].clear();
}

function showScreen(name) {
  screen = name;
  $('app').dataset.screen = name;
  for (const s of ['menu', 'game', 'end']) $(`screen-${s}`).hidden = s !== name;
  $('hud').hidden = name !== 'game';
  $('pause-btn').hidden = name !== 'game';
  if (document.activeElement && document.activeElement !== document.body && !document.activeElement.offsetParent) {
    document.activeElement.blur();
  }
  document.querySelector('.stage').scrollTop = 0;
  setHint();
}

let hintStep = 0;
function setHint(html) {
  const hint = $('hint');
  hint.classList.remove('is-nudge');
  if (html != null) { hint.innerHTML = html; return; }
  if (screen === 'menu') {
    if (coarse.matches) hint.innerHTML = 'Tap any key to hear it, then press <b>Play</b>.';
    else hint.innerHTML = [
      'Try it: press <kbd>Z</kbd> to hear <b>C</b>.',
      'Black keys are on the row above. Press <kbd>S</kbd> for <b>C♯</b>.',
      'The top two rows are the octave above. Press <kbd>Q</kbd> for the higher <b>C</b>.',
      'You’re ready. Press <kbd>Enter</kbd> to play.',
    ][hintStep];
  } else if (screen === 'game') {
    hint.innerHTML = coarse.matches ? '' :
      '<span class="hint-keys"><kbd>Space</kbd> hear it again · <kbd>Esc</kbd> pause · <kbd>?</kbd> key map</span>';
  } else {
    hint.innerHTML = '';
  }
}

function nudge(html) {
  const hint = $('hint');
  hint.innerHTML = html;
  hint.classList.remove('is-nudge');
  void hint.offsetWidth;
  hint.classList.add('is-nudge');
  cancel('hint');
  later(() => setHint(), 1800, 'hint');
  if (phase === 'listen') {
    const p = $('prompt');
    p.classList.remove('is-shake');
    void p.offsetWidth;
    p.classList.add('is-shake');
  }
}

function tutorial(midi) {
  if (coarse.matches) return;
  if (hintStep === 0 && midi === 60) hintStep = 1;
  else if (hintStep === 1 && midi === 61) hintStep = 2;
  else if (hintStep === 2 && midi === 72) hintStep = 3;
  setHint();
}

const announce = text => { $('announce').textContent = text; };

/* ---------- Game state ---------- */

let G = null;

function newGame(mode, drillId = null) {
  G = {
    mode, drillId,
    stage: 0, round: 0, encore: 0,
    lives: MAX_LIVES, score: 0, shownScore: 0,
    streak: 0, bestStreak: 0,
    asked: 0, correct: 0, times: [],
    perDrill: {}, weak: new Map(),
    stageMisses: 0, dots: [],
    q: null, last: null, progress: 0, found: new Set(),
    elapsed: 0, limit: 0, tick: 0, raf: 0,
    resume: null,
  };
}

const inEncore = () => G.mode === 'arcade' && G.stage >= DRILLS.length;

function currentDrill() {
  if (G.mode === 'practice') return drillById(G.drillId);
  if (inEncore()) return drillById(ENCORE_DRILLS[Math.floor(Math.random() * ENCORE_DRILLS.length)]);
  return DRILLS[G.stage];
}

function currentLevel() {
  if (G.mode === 'practice') return G.correct >= 14 ? 3 : G.correct >= 6 ? 2 : 1;
  if (inEncore()) return 3;
  return G.round < ROUNDS_PER_STAGE / 2 ? 1 : 2;
}

const multiplier = streak => (streak >= 20 ? 4 : streak >= 10 ? 3 : streak >= 5 ? 2 : 1);

function timeLimit(q, drill) {
  let s = q.drill === 'melodies' ? 4 + 3 * q.targets.length : drill.time;
  if (inEncore()) s *= Math.max(0.55, Math.pow(0.96, G.encore));
  return s * 1000;
}

/* ---------- Starting and stages ---------- */

function startArcade() {
  newGame('arcade');
  enterGame();
  showBanner();
}

function startPractice(drillId) {
  newGame('practice', drillId);
  enterGame();
  startRound();
}

function enterGame() {
  audio.unlock();
  hush();
  showScreen('game');
  const practice = G.mode === 'practice';
  $('score-label').textContent = practice ? 'Correct' : 'Score';
  $('lives').hidden = practice;
  $('finish-btn').hidden = !practice;
  $('timer').hidden = practice;
  $('results-btn').textContent = practice ? 'Finish and see results' : 'End and see results';
  renderHud();
}

function showBanner(bonus = '') {
  phase = 'banner';
  const encore = inEncore();
  const drill = DRILLS[G.stage];
  $('banner-kicker').textContent = encore ? 'Encore' : `Stage ${G.stage + 1} of ${DRILLS.length}`;
  $('banner-title').textContent = encore ? 'Everything, faster' : drill.name;
  $('banner-text').textContent = encore
    ? 'Every drill, mixed up, and the clock gets shorter each round. How long can you last?'
    : drill.blurb;
  $('banner-bonus').hidden = !bonus;
  $('banner-bonus').textContent = bonus;
  const ms = bonus ? 3400 : 2800;
  $('banner').style.setProperty('--banner-ms', `${ms}ms`);
  const bar = $('banner').querySelector('.banner-bar i');
  bar.style.animation = 'none';
  void bar.offsetWidth;
  bar.style.animation = '';
  $('banner').hidden = false;
  $('stage-name').textContent = encore ? 'Encore' : `Stage ${G.stage + 1} · ${drill.name}`;
  G.dots = [];
  renderDots();
  G.resume = () => showBanner(bonus);
  later(beginStage, ms);
}

function beginStage() {
  if (phase !== 'banner' || paused) return;
  cancel('flow');
  $('banner').hidden = true;
  startRound();
}

/* ---------- A round ---------- */

function startRound() {
  cancel('flow');
  cancel('prompt');
  clearKeys();
  const drill = currentDrill();
  const q = makeQuestion(drill.id, currentLevel(), G.last);
  G.q = q;
  G.drill = drill;
  G.last = q.targets.at(-1);
  G.progress = 0;
  G.found = new Set();
  G.elapsed = 0;
  G.limit = timeLimit(q, drill);

  $('q-title').textContent = drill.title;
  $('q-sub').textContent = drill.sub;
  $('verdict').textContent = '';
  $('verdict').className = 'verdict';
  if (G.mode === 'practice') $('stage-name').textContent = `Practice · ${drill.name}`;
  else if (inEncore()) $('stage-name').textContent = `Encore · round ${G.encore + 1} · ${drill.name}`;
  renderSlots();
  setTimer(1);

  q.given.forEach(m => keyFor(m)?.classList.add('is-given'));
  phase = 'listen';
  renderDots();
  setState('listen', 'Listen');
  playPrompt(openAnswer);
}

// Plays the question. Only the given notes light up as they sound, so the answer stays hidden.
function playPrompt(done) {
  cancel('prompt');
  audio.hush();
  const q = G.q;
  const ctx = audio.unlock();
  const t0 = audio.now() + 0.08;
  for (const part of q.parts) {
    part.notes.length > 1
      ? audio.chord(part.notes, { t: t0 + part.at, dur: part.dur })
      : audio.note(part.notes[0], { t: t0 + part.at, dur: part.dur });
    if (part.show) later(() => flashKey(keyFor(part.notes[0]), 'is-sounding', 600), part.at * 1000 + 80, 'prompt');
  }
  $('prompt').classList.add('is-sounding');
  later(() => $('prompt').classList.remove('is-sounding'), q.length * 1000, 'prompt');
  // The answer opens just after the last part starts, so quick ears can reply while it rings
  const open = (q.parts.at(-1).at + 0.3) * 1000 + 80;
  if (done) later(done, ctx ? open : 0, 'prompt');
}

function openAnswer() {
  if (phase !== 'listen') return;
  phase = 'answer';
  setState('answer', 'Your turn');
  markNextSlot();
  G.tick = performance.now();
  cancelAnimationFrame(G.raf);
  G.raf = requestAnimationFrame(tick);
}

function tick(t) {
  if (phase !== 'answer' || paused) return;
  G.elapsed += t - G.tick;
  G.tick = t;
  if (G.mode === 'arcade') {
    const left = 1 - G.elapsed / G.limit;
    setTimer(left);
    if (left <= 0) { miss(null); return; }
  }
  G.raf = requestAnimationFrame(tick);
}

function setTimer(frac) {
  const f = Math.max(0, Math.min(1, frac));
  $('timer-fill').style.transform = `scaleX(${f})`;
  $('timer').classList.toggle('is-low', f < 0.4 && f >= 0.2);
  $('timer').classList.toggle('is-critical', f < 0.2);
}

function replay() {
  if (screen !== 'game' || paused || phase !== 'answer') return;
  playPrompt(null);
}

function answer(midi, el) {
  const q = G.q;
  if (q.ordered) {
    if (sameNote(midi, q.targets[G.progress])) {
      fillSlot(G.progress + 1, midi, 'is-ok');
      G.progress++;
      flashKey(el, 'is-right');
      if (G.progress === q.targets.length) correct(el);
      else markNextSlot();
      return;
    }
  } else {
    const i = q.targets.findIndex((t, k) => !G.found.has(k) && sameNote(t, midi));
    if (i >= 0) {
      G.found.add(i);
      fillSlot(G.found.size, midi, 'is-ok');
      el?.classList.add('is-found');
      if (G.found.size === q.targets.length) correct(el);
      else markNextSlot();
      return;
    }
    if (q.targets.some((t, k) => G.found.has(k) && sameNote(t, midi))) return;
  }
  // Replaying a note you were given is never a mistake
  if (G.progress === 0 && q.given.some(g => sameNote(g, midi))) return;
  if (!q.ordered && q.given.some(g => sameNote(g, midi))) return;
  miss(midi, el);
}

function correct(el) {
  phase = 'feedback';
  cancelAnimationFrame(G.raf);
  const q = G.q;
  G.streak++;
  G.bestStreak = Math.max(G.bestStreak, G.streak);
  G.correct++;
  G.times.push(G.elapsed);
  record(q, true);
  G.dots.push('ok');

  let text = PRAISE[Math.floor(Math.random() * PRAISE.length)];
  let pts = 0;
  if (G.mode === 'arcade') {
    const base = G.drill.base;
    const speed = Math.max(0, 1 - G.elapsed / G.limit);
    const mult = multiplier(G.streak);
    pts = Math.round(((base + base * 0.5 * speed) * mult) / 10) * 10;
    G.score += pts;
    if (mult > multiplier(G.streak - 1)) text = `${G.streak} in a row! Points ×${mult}`;
  } else if ([5, 10, 20].includes(G.streak)) {
    text = `${G.streak} in a row!`;
  }

  setState('right', 'Correct');
  const v = $('verdict');
  v.className = 'verdict is-ok';
  v.innerHTML = `${text}${pts ? `<span class="pts">+${pts.toLocaleString()}</span>` : ''}`;
  if (pts) popup(el, `+${pts.toLocaleString()}`);
  announce(`Correct. ${q.answer}.${pts ? ` ${pts} points.` : ''}`);
  renderHud(true);
  renderDots();
  G.resume = advance;
  later(advance, 950);
}

function miss(pressed, el) {
  phase = 'feedback';
  cancelAnimationFrame(G.raf);
  const q = G.q;
  G.streak = 0;
  G.stageMisses++;
  record(q, false, pressed);
  G.dots.push('miss');
  if (G.mode === 'arcade') G.lives--;
  if (el) flashKey(el, 'is-wrong', 900);

  setState('wrong', pressed == null ? 'Time’s up' : 'Not quite');
  const v = $('verdict');
  v.className = 'verdict is-bad';
  v.textContent = `It was ${q.answer}`;
  announce(`${pressed == null ? 'Time’s up' : 'Not quite'}. It was ${q.answer}.`);
  setTimer(0);
  renderHud();
  renderDots();
  revealAnswer();

  // Let the right answer play out before moving on
  const wait = Math.max(1900, (q.drill === 'melodies' ? q.targets.length * 0.5 + 1.4 : 1.9) * 1000);
  G.resume = G.lives <= 0 ? endGame : advance;
  later(G.resume, wait);
}

function revealAnswer() {
  const q = G.q;
  if (q.ordered) {
    q.targets.forEach((t, i) => { if (i >= G.progress) fillSlot(i + 1, t, 'is-reveal'); });
  } else {
    q.targets.filter((_, i) => !G.found.has(i)).forEach((t, k) => fillSlot(G.found.size + 1 + k, t, 'is-reveal'));
  }
  $('slots').querySelectorAll('.is-next').forEach(s => s.classList.remove('is-next'));

  const t0 = audio.now() + 0.35;
  if (q.drill === 'melodies') {
    const seq = [q.given[0], ...q.targets];
    seq.forEach((m, i) => {
      audio.note(m, { t: t0 + i * 0.5, dur: 0.45 });
      later(() => flashKey(keyFor(m), 'is-reveal', 480), 350 + i * 500, 'ui');
    });
  } else if (q.drill === 'chords') {
    audio.chord([q.given[0], ...q.targets], { t: t0, dur: 1.4 });
    later(() => q.targets.forEach(m => flashKey(keyFor(m), 'is-reveal', 1500)), 350, 'ui');
  } else {
    audio.note(q.targets[0], { t: t0, dur: 1.2 });
    later(() => flashKey(keyFor(q.targets[0]), 'is-reveal', 1500), 350, 'ui');
  }
}

function advance() {
  cancel('flow');
  if (G.mode === 'arcade') {
    if (inEncore()) {
      G.encore++;
    } else if (++G.round >= ROUNDS_PER_STAGE) {
      let bonus = '';
      if (G.stageMisses === 0) {
        G.score += 500;
        const life = G.lives < MAX_LIVES;
        if (life) G.lives++;
        bonus = `Perfect stage! +500 points${life ? ' and a life back' : ''}`;
        renderHud(true);
      }
      G.stage++;
      G.round = 0;
      G.stageMisses = 0;
      clearKeys();
      showBanner(bonus);
      return;
    }
  }
  startRound();
}

function record(q, ok, pressed) {
  const d = (G.perDrill[q.drill] ??= { ok: 0, total: 0 });
  d.total++;
  G.asked++;
  if (ok) d.ok++;
  const w = G.weak.get(q.weak.key) ?? { label: q.weak.label, drill: q.drill, ok: 0, total: 0, misses: new Map() };
  w.total++;
  if (ok) w.ok++;
  if (!ok && pressed != null) {
    const why = describeMiss(q, pressed);
    if (why) w.misses.set(why, (w.misses.get(why) ?? 0) + 1);
  }
  G.weak.set(q.weak.key, w);
}

/* ---------- Drawing the round ---------- */

function setState(state, text) {
  $('prompt').dataset.state = state;
  $('state-text').textContent = text;
}

function renderSlots() {
  const q = G.q;
  const given = q.given[0];
  const ref = q.drill === 'notes' || q.drill === 'chromatic';
  const slots = [`<span class="slot is-given">${noteName(given)}<small>${ref ? 'first' : q.drill === 'chords' ? 'root' : 'start'}</small></span>`];
  q.targets.forEach(() => slots.push('<span class="slot">?</span>'));
  $('slots').innerHTML = slots.join('');
}

function fillSlot(index, midi, cls) {
  const slot = $('slots').children[index];
  if (!slot) return;
  slot.classList.remove('is-next');
  slot.classList.add(cls);
  slot.textContent = noteName(midi);
}

function markNextSlot() {
  const slots = [...$('slots').children];
  slots.forEach(s => s.classList.remove('is-next'));
  const next = G.q.ordered ? G.progress + 1 : G.found.size + 1;
  slots[next]?.classList.add('is-next');
}

function renderDots() {
  const dots = $('dots');
  if (G.mode !== 'arcade' || inEncore()) { dots.hidden = true; return; }
  dots.hidden = false;
  dots.innerHTML = Array.from({ length: ROUNDS_PER_STAGE }, (_, i) => {
    const r = G.dots[i];
    const cls = r === 'ok' ? 'is-ok' : r === 'miss' ? 'is-miss' : i === G.dots.length && phase !== 'banner' ? 'is-current' : '';
    return `<li class="${cls}"></li>`;
  }).join('');
}

const HEART = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.8 3.9 4.5 7.4 4.5c2 0 3.6 1.1 4.6 2.7 1-1.6 2.6-2.7 4.6-2.7 3.5 0 5.7 3.3 4.6 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>';
let lastLives = MAX_LIVES;

function renderHud(bump = false) {
  if (!G) return;
  const practice = G.mode === 'practice';
  if (practice) {
    $('score').textContent = `${G.correct} / ${G.asked}`;
  } else {
    countTo($('score'), G.score);
  }

  const mult = multiplier(G.streak);
  const streak = $('streak');
  streak.dataset.mult = practice ? 1 : mult;
  $('mult').textContent = practice ? `${G.streak}` : `×${mult}`;
  $('streak-count').textContent = practice ? 'in a row' : `${G.streak} in a row`;
  if (bump) {
    streak.classList.remove('is-bump');
    void streak.offsetWidth;
    streak.classList.add('is-bump');
  }

  const lives = $('lives');
  lives.innerHTML = Array.from({ length: MAX_LIVES }, () => HEART).join('');
  [...lives.children].forEach((h, i) => {
    if (i >= G.lives) h.classList.add('is-lost');
    if (i === G.lives && lastLives > G.lives) h.classList.add('is-breaking');
  });
  lives.setAttribute('aria-label', `${G.lives} ${G.lives === 1 ? 'life' : 'lives'} left`);
  lastLives = G.lives;
}

let countRaf = 0;
function countTo(el, target) {
  cancelAnimationFrame(countRaf);
  const from = G.shownScore;
  const start = performance.now();
  const step = t => {
    const k = Math.min(1, (t - start) / 450);
    G.shownScore = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = G.shownScore.toLocaleString();
    if (k < 1) countRaf = requestAnimationFrame(step);
  };
  countRaf = requestAnimationFrame(step);
}

function popup(el, text) {
  if (!el) return;
  const wrap = $('piano-wrap');
  const a = el.getBoundingClientRect();
  const b = wrap.getBoundingClientRect();
  const p = document.createElement('span');
  p.className = 'popup';
  p.textContent = text;
  p.style.left = `${a.left - b.left + a.width / 2}px`;
  p.style.top = `${a.top - b.top + 8}px`;
  wrap.append(p);
  setTimeout(() => p.remove(), 1000);
}

/* ---------- Pause, results ---------- */

function pause() {
  if (screen !== 'game' || paused) return;
  paused = true;
  cancelAnimationFrame(G.raf);
  cancel('flow');
  cancel('prompt');
  hush();
  $('pause-text').textContent = G.mode === 'practice'
    ? 'Take a breather. The sound will replay when you come back.'
    : 'The clock has stopped. The sound will replay when you come back.';
  $('pause').hidden = false;
  $('resume-btn').focus({ preventScroll: true });
}

function resume() {
  if (!paused) return;
  paused = false;
  $('pause').hidden = true;
  document.activeElement?.blur();
  if (phase === 'listen') playPrompt(openAnswer);
  else if (phase === 'answer') { G.tick = performance.now(); G.raf = requestAnimationFrame(tick); }
  else if (phase === 'feedback' || phase === 'banner') {
    const go = G.resume;
    if (phase === 'banner') go();
    else later(go, 400);
  }
}

function hush() {
  audio.hush();
  liftAll();
  $('prompt').classList.remove('is-sounding');
}

function quitToMenu() {
  paused = false;
  $('pause').hidden = true;
  stopGame();
  showMenu();
}

function stopGame() {
  cancel('flow');
  cancel('prompt');
  cancel('ui');
  cancel('hint');
  if (G) cancelAnimationFrame(G.raf);
  hush();
  clearKeys();
  $('banner').hidden = true;
}

function endGame() {
  paused = false;
  $('pause').hidden = true;
  stopGame();
  phase = 'end';
  const arcade = G.mode === 'arcade';

  $('end-eyebrow').textContent = arcade ? (G.lives <= 0 ? 'Game over' : 'Game ended') : `Practice · ${drillById(G.drillId).name}`;
  const scoreEl = $('end-score');
  if (arcade) {
    G.shownScore = 0;
    countTo(scoreEl, G.score);
  } else {
    scoreEl.textContent = G.asked ? `${G.correct} / ${G.asked}` : '0';
  }

  const best = store.get('best', null);
  const bestEl = $('end-best');
  if (!arcade) {
    bestEl.textContent = G.asked ? `${G.correct === G.asked ? 'Every one right.' : 'Answers right.'}` : 'Nothing answered yet.';
  } else if (G.score > 0 && (!best || G.score > best.score)) {
    store.set('best', { score: G.score });
    bestEl.innerHTML = `<span class="ribbon">New personal best!</span>${best ? ` Previous: ${best.score.toLocaleString()}` : ''}`;
  } else {
    bestEl.textContent = best ? `Personal best: ${best.score.toLocaleString()}` : '';
  }

  const acc = G.asked ? Math.round((G.correct / G.asked) * 100) : 0;
  const avg = G.times.length ? (G.times.reduce((a, b) => a + b, 0) / G.times.length / 1000).toFixed(1) : '–';
  const reached = !arcade ? `Level ${currentLevel()}`
    : inEncore() ? `Encore` : `Stage ${G.stage + 1}`;
  const reachedNote = !arcade ? 'of 3' : inEncore() ? `round ${G.encore + 1}` : DRILLS[G.stage].name;
  $('end-stats').innerHTML = [
    ['Accuracy', `${acc}%`, `${G.correct} of ${G.asked}`],
    ['Best streak', G.bestStreak, G.bestStreak === 1 ? 'answer in a row' : 'answers in a row'],
    [arcade ? 'Reached' : 'Difficulty', reached, reachedNote],
    ['Average answer', avg === '–' ? avg : `${avg}s`, 'after the sound'],
  ].map(([k, v, s]) => `<div><dt>${k}</dt><dd>${v}<small>${s}</small></dd></div>`).join('');

  const drills = DRILLS.filter(d => G.perDrill[d.id]);
  $('end-drills').innerHTML = drills.length ? drills.map(d => {
    const { ok, total } = G.perDrill[d.id];
    const pct = Math.round((ok / total) * 100);
    const cls = pct >= 75 ? '' : pct >= 45 ? 'is-mid' : 'is-low';
    return `<li><div class="bar-head"><span>${d.name}</span><span>${ok} / ${total}</span></div><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div></li>`;
  }).join('') : '<li class="weak-empty">No rounds played yet.</li>';

  const weak = [...G.weak.values()]
    .filter(w => w.ok < w.total)
    .sort((a, b) => a.ok / a.total - b.ok / b.total || (b.total - b.ok) - (a.total - a.ok))
    .slice(0, 3);
  $('end-weak').innerHTML = weak.length ? weak.map(w => {
    const [why] = [...w.misses.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    const detail = `${w.ok} of ${w.total} right${why ? `, you ${why}` : ''}`;
    return `<li><span class="weak-text"><b>${w.label}</b><span>${detail}</span></span>
      <button class="btn btn-small" type="button" data-practice="${w.drill}">Practise</button></li>`;
  }).join('') : `<li class="weak-empty">${G.asked ? 'No weak spots this time. Great ears!' : 'Play a few rounds to see what to work on.'}</li>`;

  showScreen('end');
}

/* ---------- Menu ---------- */

function showMenu() {
  phase = 'menu';
  G = null;
  const best = store.get('best', null);
  $('menu-best').hidden = !best;
  if (best) $('menu-best-value').textContent = best.score.toLocaleString();
  showScreen('menu');
}

function buildDrills() {
  $('drills').innerHTML = DRILLS.map((d, i) => `
    <button class="drill" type="button" data-practice="${d.id}">
      <span class="drill-num">0${i + 1}</span>
      <span class="drill-name">${d.name}</span>
      <span class="drill-blurb">${d.blurb}</span>
    </button>`).join('');
}

/* ---------- Help overlay ---------- */

function openHelp() {
  if (helpOpen) return;
  if (screen === 'game' && !paused && phase !== 'end') pause();
  helpOpen = true;
  $('help').hidden = false;
  $('help-close').focus({ preventScroll: true });
}

function closeHelp() {
  helpOpen = false;
  $('help').hidden = true;
  if (paused) $('resume-btn').focus({ preventScroll: true });
  else document.activeElement?.blur();
}

function setNames(on) {
  $('piano').classList.toggle('no-names', !on);
  $('names-toggle').checked = on;
  store.set('names', on);
}

/* ---------- MIDI keyboards ---------- */

async function connectMidi() {
  const status = $('midi-status');
  status.classList.remove('is-on');
  if (!navigator.requestMIDIAccess) {
    status.textContent = 'This browser can’t read MIDI keyboards. Try Chrome or Edge.';
    return;
  }
  status.textContent = 'Asking your browser for access…';
  try {
    const access = await navigator.requestMIDIAccess();
    const hook = () => {
      const inputs = [...access.inputs.values()];
      inputs.forEach(input => { input.onmidimessage = onMidi; });
      status.classList.toggle('is-on', inputs.length > 0);
      status.textContent = inputs.length
        ? `Connected: ${inputs.map(i => i.name).join(', ')}`
        : 'No keyboard found yet. Plug one in and it will connect.';
      $('midi-btn').hidden = inputs.length > 0;
      $('midi-sound').hidden = inputs.length === 0;
    };
    access.onstatechange = hook;
    hook();
  } catch {
    status.textContent = 'MIDI access was blocked. Allow it in the browser’s site settings to use a keyboard.';
  }
}

function onMidi(e) {
  const [status, note, velocity] = e.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && velocity > 0) press(note, `m${note}`, 0.35 + 0.6 * (velocity / 127), { silent: !midiSound });
  else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) lift(`m${note}`);
}

/* ---------- Wiring ---------- */

function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onButton = e.target instanceof HTMLElement && e.target.matches('button, input');

  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
    e.preventDefault();
    helpOpen ? closeHelp() : openHelp();
    return;
  }
  if (helpOpen) {
    if (e.key === 'Escape') { e.preventDefault(); closeHelp(); }
    return;
  }

  const midi = codeToMidi.get(e.code);
  if (midi != null) {
    e.preventDefault();
    if (!e.repeat) press(midi, `k${e.code}`);
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    if (paused) resume();
    else if (screen === 'game') pause();
    else if (screen === 'end') showMenu();
    return;
  }

  if (onButton && (e.key === 'Enter' || e.key === ' ')) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) replay();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (paused) resume();
    else if (screen === 'menu') startArcade();
    else if (screen === 'end') playAgain();
    else if (phase === 'banner') beginStage();
  }
}

function playAgain() {
  if (G?.mode === 'practice') startPractice(G.drillId);
  else startArcade();
}

function init() {
  buildPiano();
  buildKeymap($('keymap-menu'));
  buildKeymap($('keymap-help'));
  buildKeyTable();
  buildDrills();
  setNames(store.get('names', true));

  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', e => {
    if (codeToMidi.has(e.code)) lift(`k${e.code}`);
  });
  addEventListener('blur', liftAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'game' && !paused) pause();
  });
  // Clicked buttons give up focus, so Space and Enter keep meaning "replay" and "continue"
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && e.detail > 0) b.blur();
  });
  // Unlock audio on the very first touch or key, as browsers require
  addEventListener('pointerdown', () => audio.unlock(), { once: true });

  document.addEventListener('click', e => {
    const drill = e.target.closest('[data-practice]');
    if (drill) startPractice(drill.dataset.practice);
  });
  $('play-btn').addEventListener('click', startArcade);
  $('banner-go').addEventListener('click', beginStage);
  $('banner').addEventListener('click', e => { if (!e.target.closest('button')) beginStage(); });
  $('replay-btn').addEventListener('click', replay);
  $('finish-btn').addEventListener('click', endGame);
  $('pause-btn').addEventListener('click', pause);
  $('resume-btn').addEventListener('click', resume);
  $('results-btn').addEventListener('click', endGame);
  $('quit-btn').addEventListener('click', quitToMenu);
  $('again-btn').addEventListener('click', playAgain);
  $('menu-btn').addEventListener('click', showMenu);
  $('brand').addEventListener('click', () => {
    if (screen === 'game') pause();
    else showMenu();
  });
  $('help-btn').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', closeHelp);
  $('help').addEventListener('click', e => { if (e.target === $('help')) closeHelp(); });
  $('names-toggle').addEventListener('change', e => setNames(e.target.checked));
  $('midi-btn').addEventListener('click', connectMidi);
  $('midi-sound').addEventListener('click', () => {
    midiSound = !midiSound;
    $('midi-sound').textContent = `Game sound: ${midiSound ? 'on' : 'off'}`;
    $('midi-sound').setAttribute('aria-pressed', midiSound);
  });
  coarse.addEventListener?.('change', () => setHint());

  showMenu();
}

init();
