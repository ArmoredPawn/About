// The game: menus, the lobby, and the race loop that ties the simulation, the 3-D view, the HUD, the sound and the
// network together. Behind the menu, computer racers race the course for show.

import { World } from './sim/world.js';
import { BOATS, BOAT_COLORS } from './sim/boats.js';
import { TRACKS } from './sim/track.js';
import { botBrain, botInput, BOT_NAMES } from './sim/ai.js';
import { Stage, ChaseCamera } from './render/scene.js';
import { View } from './render/view.js';
import { Hud } from './hud.js';
import { Sound } from './audio.js';
import { HostSession, ClientSession } from './net/session.js';
import { usingLocal } from './net/signal.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STEP = 1 / 60;
const SEND = 1 / 15; // positions sent fifteen times a second
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };

const app = {
  cls: store.get('rs.cls', 'gunboat'),
  track: store.get('rs.track', 'atoll'),
  session: null,
  race: null,
  stage: null,
  sound: new Sound(),
};

/* ---------- Input ---------- */

const keys = new Set();
const mouse = { gun: false, cannon: false };
const touch = new Set();
let missilePress = false;
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  app.sound.start();
  const k = e.key.toLowerCase();
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  if ((k === 'q' || k === 'r') && !e.repeat) missilePress = true;
  if (k === 'c' && !e.repeat && app.race?.cam) { const m = ['chase', 'high', 'helm']; app.race.cam.mode = m[(m.indexOf(app.race.cam.mode) + 1) % m.length]; }
  if (k === 'm' && !e.repeat) app.sound.setOn(!app.sound.on);
  if (k === 'escape' && app.race && !app.race.attract) leaveRace();
  keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); mouse.gun = mouse.cannon = false; });
$('view').addEventListener('pointerdown', (e) => { app.sound.start(); if (e.button === 0) mouse.gun = true; if (e.button === 2) mouse.cannon = true; if (e.button === 1) missilePress = true; });
addEventListener('pointerup', (e) => { if (e.button === 0) mouse.gun = false; if (e.button === 2) mouse.cannon = false; });
$('view').addEventListener('contextmenu', (e) => e.preventDefault());
for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); app.sound.start(); touch.add(k); if (k === 'missile') missilePress = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => touch.delete(k));
}
const isTouch = matchMedia('(pointer: coarse)').matches;

function readInput() {
  const has = (...k) => k.some((x) => keys.has(x));
  // Heading increases to the left as seen from behind the boat, so left steers +1
  const steer = (has('a', 'arrowleft') || touch.has('left') ? 1 : 0) - (has('d', 'arrowright') || touch.has('right') ? 1 : 0);
  const throttle = (has('w', 'arrowup') || touch.has('gas') ? 1 : 0) - (has('s', 'arrowdown') || touch.has('back') ? 1 : 0);
  const out = { throttle, steer, gun: has(' ') || mouse.gun || touch.has('gun'), cannon: has('e') || mouse.cannon || touch.has('cannon'), missile: missilePress };
  missilePress = false;
  return out;
}

/* ---------- A race ---------- */

class Race {
  // roster: [{ id, name, cls, color, slot, bot }]; me: our boat's id (or, watching, the boat the camera follows)
  constructor({ track, laps, seed, roster, me, session = null, host = true, attract = false }) {
    this.attract = attract;
    this.me = me;
    this.session = session;
    this.host = host;
    this.world = new World({ track, laps, seed });
    this.brains = new Map();
    for (const r of roster) {
      const local = r.id === me && !attract ? true : r.bot && host;
      this.world.addBoat({ ...r, local, bot: r.bot });
      if (r.bot && host) this.brains.set(r.id, botBrain(r.slot, 0.55 + Math.random() * 0.35));
    }
    const stage = app.stage;
    stage.clear();
    this.view = new View(stage, this.world, me);
    this.cam = new ChaseCamera(stage.camera);
    this.hud = attract ? null : new Hud(this.world, me, stage.camera);
    this.acc = 0;
    this.sendT = 0;
    this.lastLock = 0;
    this.overAt = null;
    this.firstFinish = null;
    this.alive = true;
    this.names = new Map(roster.map((r) => [r.id, r.name]));
    this.world.startCountdown(attract ? 0.01 : 4);
    this.lastBeep = 5;
    this.wire();
    this.prev = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  wire() {
    const s = this.session;
    if (!s) return;
    const w = this.world;
    const now = () => performance.now() / 1000;
    s.on('state', (id, snap) => { if (this.alive) w.applySnapshot(id, snap, now()); });
    s.on('hit', (h) => { if (this.alive) w.takeHit(h.id, h.amount, h.by, h.w); });
    s.on('left', (id) => { if (!this.alive) return; const b = w.boats.get(id); if (b) { this.hud?.feed(`<b>${esc(b.name)}</b> left`); w.removeBoat(id); } });
    s.on('ev', (e) => {
      if (!this.alive) return;
      if (e.t === 'fire') w.spawnReplica(e);
      else if (e.t === 'impact') w.replicaImpact(e);
      else if (e.t === 'sunk') { w.sunk(e); w.events.push({ ...e, net: false }); }
      else if (e.t === 'pickup') { w.takePickup(e.id, e.boat); w.events.push({ ...e, net: false }); }
      else if (e.t === 'finish') w.events.push({ ...e, net: false });
    });
    s.on('over', () => { if (this.alive) this.finish(); });
  }

  // A boat of ours (or one of our computer racers) did something the others need to see
  forward(e) {
    if (!this.session || !e.net) return;
    const w = this.world;
    const owner = e.t === 'fire' || e.t === 'impact' ? e.owner : e.t === 'hit' ? e.by : e.t === 'pickup' ? e.boat : e.id;
    if (!w.boats.get(owner)?.local) return;
    if (e.t === 'hit') this.session.sendHit({ id: e.id, amount: e.amount, by: e.by, w: e.w });
    else {
      const { net, ...rest } = e;
      void net;
      this.session.sendEvent(rest);
    }
  }

  frame(t) {
    if (!this.alive) return;
    const dt = Math.min(0.05, (t - this.prev) / 1000);
    this.prev = t;
    const w = this.world;
    const me = w.boats.get(this.me);
    if (me && !this.attract) w.setInput(this.me, readInput());
    this.acc += dt;
    while (this.acc >= STEP) {
      for (const [id, brain] of this.brains) { const b = w.boats.get(id); if (b) w.setInput(id, botInput(w, b, brain, STEP)); }
      w.step(STEP, performance.now() / 1000);
      this.acc -= STEP;
    }
    // Send our boats' positions
    this.sendT += dt;
    if (this.session && this.sendT >= SEND) {
      this.sendT = 0;
      for (const b of w.boats.values()) if (b.local) this.session.sendState(b.id, w.snapshot(b.id));
    }
    // What happened
    const events = w.drain();
    this.view.events(events, (e) => {
      this.forward(e);
      this.hud?.event(e, (id) => this.names.get(id) ?? '?');
      this.noise(e, me);
    });
    // The camera, the scene, the HUD
    if (me) {
      if (this.attract || w.phase === 'countdown') this.cam.orbit(dt, me, w.t);
      else this.cam.update(dt, me, keys.has('v'));
    }
    this.view.update(dt);
    app.stage.render();
    this.hud?.update(dt);
    if (me && !this.attract) {
      app.sound.engine(me.throttle, me.speed, !me.dead);
      // The lock tone
      if (me.lock.target && !me.lock.locked && t - this.lastLock > 220) { this.lastLock = t; app.sound.lock(false); }
      if (me.lock.locked && !this.wasLocked) app.sound.lock(true);
      this.wasLocked = me.lock.locked;
      if (w.phase === 'countdown' && Math.ceil(w.countdown) < this.lastBeep) { this.lastBeep = Math.ceil(w.countdown); if (this.lastBeep <= 3) app.sound.beep(false); }
    }
    this.checkEnd(me);
    if (this.attract && me?.finished) { startAttract(); return; }
    requestAnimationFrame((x) => this.frame(x));
  }

  noise(e, me) {
    const s = app.sound;
    const far = (x, z) => (me ? Math.hypot(x - me.x, z - me.z) : 300);
    if (this.attract) return;
    if (e.t === 'fire') s.shot(e.w, far(e.x, e.z));
    else if (e.t === 'impact') { if (e.w === 'hmg') { if (e.boat === this.me) s.hit(); else if (!e.boat) s.splash(far(e.x, e.z)); } else s.explosion(e.w === 'missile', far(e.x, e.z)); }
    else if (e.t === 'sunk') { const b = this.world.boats.get(e.id); s.explosion(true, b ? far(b.x, b.z) : 200); }
    else if (e.t === 'damaged' && e.id === this.me) { this.cam.shake(e.amount > 10 ? 1.6 : 0.5); s.hit(); }
    else if (e.t === 'impact' || e.t === 'crash') { if (e.id === this.me) this.cam.shake(0.8); }
    else if (e.t === 'go') s.beep(true);
    else if (e.t === 'pickup' && e.boat === this.me) s.pickup();
  }

  // When the race is over: solo, once we finish; in a room, the host calls it when every player has finished,
  // or a minute after the first one did
  checkEnd(me) {
    const w = this.world;
    if (this.attract || w.phase !== 'race') return;
    const humans = [...w.boats.values()].filter((b) => !b.bot);
    if (!this.firstFinish && [...w.boats.values()].some((b) => b.finished)) this.firstFinish = w.t;
    if (!this.session) {
      if (me?.finished && !this.overAt) this.overAt = w.t + 2.5;
    } else if (this.host && !this.overAt) {
      if (humans.every((b) => b.finished) || (this.firstFinish && w.t - this.firstFinish > 60)) this.overAt = w.t + 2.5;
    }
    if (this.overAt && w.t >= this.overAt) {
      this.overAt = Infinity;
      if (this.session && this.host) this.session.endRace(); else if (!this.session) this.finish();
    }
  }

  finish() {
    const w = this.world;
    if (w.phase === 'over') return;
    w.phase = 'over';
    const list = w.standings().map((b) => ({ id: b.id, name: b.name, color: b.color, finished: b.finished, finishTime: b.finishTime, kills: b.kills, deaths: b.deaths }));
    const inRoom = Boolean(this.session);
    $('results-again').textContent = inRoom ? (this.host ? 'Back to the lobby' : 'Waiting for the host…') : 'Race again';
    $('results-again').disabled = inRoom && !this.host;
    $('results-msg').textContent = inRoom && !this.host ? 'The host will take everyone back to the lobby.' : '';
    this.hud.results(list, () => {
      if (!inRoom) { const opts = this.opts; leaveRace(false); startSolo(opts); }
      else if (this.host) { leaveRace(false); this.session.backToLobby(); showLobby(); }
    });
  }

  stop() {
    this.alive = false;
    this.hud?.hide();
    app.sound.engine(0, 0, false);
  }
}

function leaveRace(toMenu = true) {
  app.race?.stop();
  app.race = null;
  if (toMenu) {
    app.session?.close();
    app.session = null;
    showMenu();
  }
}

/* ---------- Screens ---------- */

function show(id) {
  for (const s of ['menu', 'lobby', 'results']) $(s).hidden = s !== id;
  $('touch').hidden = !(isTouch && !id);
}

function showMenu() {
  show('menu');
  history.replaceState(null, '', location.pathname);
  startAttract();
}

// Behind the menu: computer racers on the chosen course
function startAttract() {
  app.race?.stop();
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `bot${i}`, name: BOT_NAMES[i], cls: ['interceptor', 'gunboat', 'patrol'][i % 3], color: BOAT_COLORS[i], slot: i, bot: true }));
  app.race = new Race({ track: app.track, laps: 3, seed: 1, roster, me: 'bot0', attract: true });
}

function cards(el, items, selected, onPick) {
  el.innerHTML = items.map(([k, title, sub]) => `<button class="card${k === selected ? ' on' : ''}" data-k="${k}"><b>${esc(title)}</b><span>${sub}</span></button>`).join('');
  for (const b of el.querySelectorAll('.card')) b.onclick = () => { for (const o of el.querySelectorAll('.card')) o.classList.toggle('on', o === b); onPick(b.dataset.k); };
}
const boatCards = () => Object.entries(BOATS).map(([k, b]) => [k, b.name, `${esc(b.note)}<em>Hull ${b.hp} · ${Math.round(b.top * 1.944)} knots · ${b.missiles} missiles</em>`]);
const trackCards = () => Object.entries(TRACKS).map(([k, t]) => [k, t.name, esc(t.blurb)]);

function name() {
  const n = $('name').value.trim() || 'Captain';
  store.set('rs.name', n);
  return n;
}

function menuMsg(text, bad = false) { $('menu-msg').textContent = text; $('menu-msg').className = `msg${bad ? ' bad' : ''}`; }

function startSolo(opts) {
  app.sound.start();
  app.session = null;
  const o = opts ?? { track: app.track, laps: Number($('laps').value), bots: Number($('bots').value) };
  const roster = [{ id: 'me', name: name(), cls: app.cls, color: BOAT_COLORS[0], slot: 0, bot: false }];
  for (let i = 0; i < o.bots; i++) roster.push({ id: `bot${i}`, name: BOT_NAMES[i], cls: ['interceptor', 'gunboat', 'patrol'][i % 3], color: BOAT_COLORS[i + 1], slot: i + 1, bot: true });
  const slots = roster.map((_, i) => i).sort(() => Math.random() - 0.5);
  roster.forEach((r, i) => { r.slot = slots[i]; });
  app.race?.stop();
  show(null);
  app.race = new Race({ track: o.track, laps: o.laps, seed: Math.floor(Math.random() * 1e9), roster, me: 'me' });
  app.race.opts = o;
}

/* ---------- Rooms ---------- */

async function hostRoom() {
  app.sound.start();
  menuMsg('Opening a room…');
  const s = new HostSession({ name: name(), cls: app.cls });
  app.session = s;
  s.on('lobby', (m) => renderLobby(m));
  s.on('start', (m) => raceFrom(m));
  s.on('status', (t) => { $('lobby-msg').textContent = t; });
  try {
    await s.open();
  } catch (e) { app.session = null; menuMsg(e.message, true); return; }
  menuMsg('');
  showLobby();
  s.setSettings({ track: app.track, laps: Number($('laps').value), bots: Number($('bots').value) });
}

async function joinRoom(code) {
  app.sound.start();
  if (!/^[A-Za-z]{4}$/.test(code)) { menuMsg('Room codes are four letters.', true); return; }
  menuMsg('Looking for the room…');
  const s = new ClientSession({ name: name(), cls: app.cls });
  s.on('status', (t) => menuMsg(t));
  try {
    await s.join(code);
  } catch (e) { menuMsg(e.message, true); s.close(); return; }
  app.session = s;
  s.on('lobby', (m) => { if (!app.race || app.race.attract) showLobby(); renderLobby(m); });
  s.on('start', (m) => raceFrom(m));
  s.on('back', () => { leaveRace(false); showLobby(); });
  s.on('closed', (reason) => { leaveRace(false); app.session = null; showMenu(); menuMsg(reason, true); });
  menuMsg('');
  showLobby();
}

function showLobby() {
  show('lobby');
  if (!app.race) startAttract();
  const s = app.session;
  history.replaceState(null, '', `?room=${s.code}`);
  $('lobby-code').textContent = s.code ?? '----';
  const host = s instanceof HostSession;
  $('lobby-host').hidden = !host;
  $('start').hidden = !host;
  cards($('l-boats'), boatCards(), app.cls, (k) => { app.cls = k; store.set('rs.cls', k); s.setClass(k); });
}

function renderLobby(m) {
  const s = app.session;
  if (!s) return;
  $('lobby-code').textContent = m.code;
  $('players').innerHTML = m.players.map((p) => `<li><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b><span class="faint">${esc(BOATS[p.cls]?.name ?? '')}</span>${p.host ? '<span class="chip">host</span>' : ''}${p.id === s.id ? '<span class="chip">you</span>' : ''}</li>`).join('')
    + (m.settings.bots ? `<li class="faint">+ up to ${m.settings.bots} computer racer${m.settings.bots === 1 ? '' : 's'}</li>` : '');
  const t = TRACKS[m.settings.track];
  $('lobby-msg').textContent = `${t.name}, ${m.settings.laps} lap${m.settings.laps === 1 ? '' : 's'}. ${s instanceof HostSession ? 'Share the code; start when everyone is in.' : 'Waiting for the host to start…'}`;
  if (s instanceof HostSession) {
    $('l-track').value = m.settings.track;
    $('l-laps').value = String(m.settings.laps);
    $('l-bots').value = String(m.settings.bots);
  }
}

function raceFrom(m) {
  app.race?.stop();
  show(null);
  const s = app.session;
  app.race = new Race({ track: m.track, laps: m.laps, seed: m.seed, roster: m.roster, me: s.id, session: s, host: s instanceof HostSession });
}

/* ---------- Start ---------- */

function setup() {
  $('name').value = store.get('rs.name', '');
  cards($('boats'), boatCards(), app.cls, (k) => { app.cls = k; store.set('rs.cls', k); });
  cards($('tracks'), trackCards(), app.track, (k) => { app.track = k; store.set('rs.track', k); if (app.race?.attract) startAttract(); });
  $('l-track').innerHTML = Object.entries(TRACKS).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('');
  $('solo').onclick = () => startSolo();
  $('host').onclick = () => hostRoom();
  $('join').onclick = () => joinRoom($('code').value);
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('code').value); });
  $('code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('start').onclick = () => app.session.start(BOT_NAMES);
  $('leave').onclick = () => { app.session?.close(); app.session = null; showMenu(); };
  $('copy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${app.session.code}`;
    try { await navigator.clipboard.writeText(url); $('copy').textContent = 'Copied!'; } catch { $('copy').textContent = url; }
    setTimeout(() => { $('copy').textContent = 'Copy invite link'; }, 2000);
  };
  for (const [id, key] of [['l-track', 'track'], ['l-laps', 'laps'], ['l-bots', 'bots']]) {
    $(id).onchange = (e) => app.session?.setSettings({ [key]: key === 'track' ? e.target.value : Number(e.target.value) });
  }
  $('results-menu').onclick = () => leaveRace(true);
  $('quality').value = store.get('rs.quality', 'high');
  $('quality').onchange = (e) => { store.set('rs.quality', e.target.value); location.reload(); };
  if (usingLocal) menuMsg('Local test mode: rooms run through the dev server, between tabs on this computer (add ?firebase to use Firebase).');
}

function boot() {
  try {
    app.stage = new Stage($('view'), { quality: store.get('rs.quality', 'high') });
  } catch (e) {
    $('loading').textContent = `This browser can't show 3-D graphics (WebGL): ${e.message}`;
    return;
  }
  setup();
  $('loading').hidden = true;
  const room = new URLSearchParams(location.search).get('room');
  showMenu();
  if (room) { $('code').value = room.toUpperCase(); menuMsg(`Invited to room ${room.toUpperCase()}: pick a boat and press Join room.`); }
}

boot();
