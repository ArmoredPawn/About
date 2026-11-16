// Connections to a game. Both kinds take the same messages:
//   RemoteLink talks to the multiplayer server over a WebSocket, reconnecting and resuming on its own.
//   LocalLink runs a room right here in the browser for solo play, and saves it as it goes.

import { CONFIG } from './config.js';
import { Room } from './engine/room.js';

// Browsers refuse timer functions called as methods of another object, so wrap them
const BROWSER_TIMERS = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
  every: (fn, ms) => setInterval(fn, ms),
  stop: (id) => clearInterval(id),
};
const SAVE_KEY = 'statecraft.solo';
// Bumped when the map changes: a save from an older map is missing provinces
const SAVE_VERSION = 3;
const ROOM_KEY = 'statecraft.room';

export function serverBase() {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return location.origin;
  return CONFIG.serverUrl ? CONFIG.serverUrl.replace(/\/+$/, '') : '';
}

export class RemoteLink {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.queue = [];
    this.closed = false;
    this.retry = 0;
    this.session = loadRoom();
  }

  get available() {
    return Boolean(serverBase());
  }

  open() {
    const base = serverBase();
    if (!base) { this.onStatus('no-server'); return; }
    this.closed = false;
    this.onStatus(this.retry ? 'reconnecting' : 'connecting');
    // A server asleep on Render's free plan takes up to a minute to wake; poke it over HTTP too
    fetch(`${base}/healthz`, { cache: 'no-store' }).catch(() => {});
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`);
    this.ws = ws;
    const slow = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) this.onStatus('waking'); }, 3000);
    ws.addEventListener('open', () => {
      clearTimeout(slow);
      this.retry = 0;
      this.onStatus('open');
      if (this.session) ws.send(JSON.stringify({ type: 'resume', code: this.session.code, token: this.session.token }));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'joined') {
        this.session = { code: msg.code, token: msg.token };
        saveRoom(this.session);
      }
      if (msg.type === 'error' && msg.code === 'resume-failed') {
        this.session = null;
        saveRoom(null);
      }
      this.onMessage(msg);
    });
    ws.addEventListener('close', () => {
      clearTimeout(slow);
      if (this.closed) return;
      this.retry++;
      this.onStatus('reconnecting');
      setTimeout(() => { if (!this.closed) this.open(); }, Math.min(10000, 800 * this.retry));
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  leave() {
    this.send({ type: 'leave' });
    this.closed = true;
    this.session = null;
    saveRoom(null);
    setTimeout(() => this.ws?.close(), 100);
  }
}

export function hasSavedRoom() {
  return Boolean(loadRoom());
}

function loadRoom() {
  try { return JSON.parse(sessionStorage.getItem(ROOM_KEY) ?? 'null'); } catch { return null; }
}
function saveRoom(v) {
  try { v ? sessionStorage.setItem(ROOM_KEY, JSON.stringify(v)) : sessionStorage.removeItem(ROOM_KEY); } catch { /* storage unavailable */ }
}

/* ---------- Solo play ---------- */

// The link whose saves count: one that has been left may still send its last save after a new game started
let latestSolo = null;

export class LocalLink {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.worker = null;
    this.room = null;
    this.player = null;
    this.left = false;
  }

  get available() { return true; }

  // The world runs in a background worker so the map stays smooth; on the page itself if workers are missing
  open({ name, restore }) {
    latestSolo = this;
    const state = restore ? loadSolo()?.state ?? null : null;
    this.onStatus('open');
    let worker = null;
    try {
      worker = new Worker(new URL('./solo-worker.js', import.meta.url), { type: 'module' });
    } catch { /* no module workers here */ }
    if (!worker) { this.#openHere(name, state); return; }
    this.worker = worker;
    let heard = false;
    worker.addEventListener('message', ({ data }) => {
      heard = true;
      if (data.save != null) {
        if (latestSolo === this) try { localStorage.setItem(SAVE_KEY, data.save); } catch { /* storage full or unavailable */ }
      } else if (data.left) {
        worker.terminate();
      } else if (data.msg && !this.left) {
        this.onMessage(data.msg);
      }
    });
    // A worker that fails to start (an old browser, a blocked script): play on the page instead
    worker.addEventListener('error', (e) => {
      if (heard || this.left) return;
      e.preventDefault?.();
      worker.terminate();
      this.worker = null;
      this.#openHere(name, state);
    });
    worker.postMessage({ open: { name, state, v: SAVE_VERSION } });
  }

  #openHere(name, state) {
    const deliver = (msg) => queueMicrotask(() => { if (!this.left) this.onMessage(structuredClone(msg)); });
    this.room = new Room({
      code: 'SOLO',
      timers: BROWSER_TIMERS,
      onTick: (room) => { if (room.game.s.week % 2 === 0 || room.game.s.over) this.save(); },
    });
    deliver({ type: 'joined', code: 'SOLO', you: 'me', token: 'solo', solo: true });
    this.player = this.room.addPlayer({ id: 'me', token: 'solo', name: name || 'You', conn: { send: deliver } });
    if (state) {
      this.room.restore(state, this.player);
      return;
    }
    this.room.settings.speed = 'normal';
    this.room.start();
    this.save();
  }

  send(msg) {
    if (msg.type === 'leave') return this.leave();
    if (this.worker) { this.worker.postMessage({ msg }); return; }
    if (!this.room) return;
    this.room.handle(this.player, msg);
    if (msg.type === 'cmd') this.save();
  }

  save() {
    if (!this.room?.game || latestSolo !== this) return;
    try {
      const s = this.room.game.s;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, saved: Date.now(), state: { ...s, fresh: [] } }));
    } catch { /* storage full or unavailable: the game still runs */ }
  }

  leave() {
    if (this.left) return;
    this.left = true;
    // The worker saves the game, stops its clock, then says so and is shut down
    if (this.worker) { this.worker.postMessage({ leave: true }); this.worker = null; return; }
    this.save();
    this.room?.stopClock();
    this.room = null;
  }
}

export function loadSolo() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    return saved?.v === SAVE_VERSION ? saved : null;
  } catch { return null; }
}

export function clearSolo() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
