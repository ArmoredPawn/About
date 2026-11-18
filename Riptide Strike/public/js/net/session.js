// A multiplayer room. The host's browser is the hub: everyone connects to it directly, it runs the lobby (who is
// in, which boats, the course, the laps, how many computer racers), starts the race, runs the computer racers,
// and passes each player's positions, shots and hits on to the others. Players never connect to each other.
//
// Messages (JSON): hello { name, cls } · cls { cls } · lobby { players, settings, code } · start { track, laps,
// seed, roster } · st { id, s } (a boat's position, on the fast channel) · ev { e } (a shot, an impact, a sinking,
// a crate taken, a finish) · hit { id, amount, by, w } (to the hit boat's owner) · over { } · back { } · bye { }

import * as signal from './signal.js';
import { makeOffer, answerOffer } from './peer.js';
import { BOAT_COLORS } from '../sim/boats.js';

export const MAX_PLAYERS = 8;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const newId = () => Math.random().toString(36).slice(2, 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Emitter {
  constructor() { this.handlers = {}; }
  on(type, fn) { (this.handlers[type] ??= []).push(fn); return this; }
  emit(type, ...args) { for (const fn of this.handlers[type] ?? []) fn(...args); }
}

export class HostSession extends Emitter {
  constructor({ name, cls, id = newId(), sig = signal, answer = answerOffer }) {
    super();
    this.id = id;
    this.sig = sig;
    this.answer = answer;
    this.players = new Map([[id, { id, name, cls, color: BOAT_COLORS[0], host: true, link: null }]]);
    this.settings = { track: 'atoll', laps: 3, bots: 3 };
    this.code = null;
    this.inRace = false;
    this.handled = new Set();
    this.closed = false;
  }

  async open() {
    for (let i = 0; i < 12; i++) {
      const code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
      if (await this.sig.createRoom(code, this.id)) { this.code = code; break; }
    }
    if (!this.code) throw new Error('Could not get a room code. Try again.');
    this.timer = setInterval(() => this.#poll().catch((e) => this.emit('status', e.message)), 1500);
    this.#lobby();
    return this.code;
  }

  // Anyone new knocking: answer their offer, and wait for them to say hello
  async #poll() {
    if (this.inRace || this.closed) return;
    const docs = await this.sig.listPeers(this.code);
    for (const d of docs) {
      if (!d?.offer || d.answer || this.handled.has(d.id)) continue;
      this.handled.add(d.id);
      this.#accept(d).catch(() => this.sig.dropPeer(this.code, d.id));
    }
  }

  async #accept(d) {
    const full = this.players.size >= MAX_PLAYERS;
    const { link, sdp } = await this.answer(d.offer);
    await this.sig.postAnswer(this.code, d.id, sdp);
    const opened = await Promise.race([link.opened.then(() => true), wait(20000).then(() => false)]);
    this.sig.dropPeer(this.code, d.id);
    if (!opened) { link.close(); return; }
    if (full || this.inRace) { link.send({ type: 'bye', reason: full ? 'The room is full.' : 'The race has already started.' }); setTimeout(() => link.close(), 500); return; }
    link.onmessage = (m) => this.#message(d.id, m);
    link.onclose = () => this.#left(d.id);
    this.pending ??= new Map();
    this.pending.set(d.id, link);
  }

  #message(pid, m) {
    const p = this.players.get(pid);
    if (m.type === 'hello' && !p) {
      const link = this.pending?.get(pid);
      if (!link) return;
      this.pending.delete(pid);
      const used = new Set([...this.players.values()].map((x) => x.color));
      const color = BOAT_COLORS.find((c) => !used.has(c)) ?? BOAT_COLORS[this.players.size % BOAT_COLORS.length];
      this.players.set(pid, { id: pid, name: String(m.name ?? 'Racer').slice(0, 20), cls: m.cls, color, host: false, link });
      this.emit('joined', pid);
      this.#lobby();
      return;
    }
    if (!p) return;
    if (m.type === 'cls' && !this.inRace) { p.cls = m.cls; this.#lobby(); return; }
    if (m.type === 'st') { this.emit('state', pid, m.s); this.#others(pid, { type: 'st', id: pid, s: m.s }, true); return; }
    if (m.type === 'ev') { this.emit('ev', m.e); this.#others(pid, { type: 'ev', e: m.e }); return; }
    if (m.type === 'hit') this.#route(m);
  }

  // A hit goes to whoever owns the boat: us (our boat, or a computer racer), or one of the players
  #route(h) {
    const target = this.players.get(h.id);
    if (!target || target.host) this.emit('hit', h);
    else target.link?.send({ type: 'hit', ...h });
  }

  #others(from, msg, fast = false) {
    for (const p of this.players.values()) if (p.link && p.id !== from) p.link.send(msg, fast);
  }

  #left(pid) {
    this.pending?.delete(pid);
    if (!this.players.has(pid)) return;
    this.players.delete(pid);
    this.emit('left', pid);
    this.#others(null, { type: 'left', id: pid });
    this.#lobby();
  }

  #lobby() {
    const players = [...this.players.values()].map(({ id, name, cls, color, host }) => ({ id, name, cls, color, host }));
    const msg = { type: 'lobby', players, settings: this.settings, code: this.code };
    if (!this.inRace) this.#others(null, msg);
    this.emit('lobby', msg);
  }

  setClass(cls) { this.players.get(this.id).cls = cls; this.#lobby(); }
  setSettings(s) { Object.assign(this.settings, s); this.#lobby(); }

  // The race: everyone in the room, then computer racers to fill the grid
  start(botNames) {
    const humans = [...this.players.values()];
    const roster = humans.map((p, i) => ({ id: p.id, name: p.name, cls: p.cls, color: p.color, slot: i, bot: false }));
    const classes = ['interceptor', 'corvette', 'destroyer', 'carrier'];
    const used = new Set(roster.map((r) => r.color));
    const free = BOAT_COLORS.filter((c) => !used.has(c));
    for (let i = 0; i < Math.min(this.settings.bots, MAX_PLAYERS - humans.length); i++) {
      roster.push({ id: `bot${i}`, name: botNames[i % botNames.length], cls: classes[Math.floor(Math.random() * classes.length)], color: free[i % free.length] ?? '#cccccc', slot: roster.length, bot: true });
    }
    // Shuffle the grid
    const slots = roster.map((_, i) => i).sort(() => Math.random() - 0.5);
    roster.forEach((r, i) => { r.slot = slots[i]; });
    const msg = { type: 'start', track: this.settings.track, laps: this.settings.laps, seed: Math.floor(Math.random() * 1e9), roster, host: this.id };
    this.inRace = true;
    this.sig.setOpen(this.code, this.id, false).catch(() => {});
    this.#others(null, msg);
    this.emit('start', msg);
  }

  sendState(id, s) { this.#others(null, { type: 'st', id, s }, true); }
  sendEvent(e) { this.#others(null, { type: 'ev', e }); }
  sendHit(h) { this.#route(h); }
  endRace() { this.#others(null, { type: 'over' }); this.emit('over'); }
  backToLobby() {
    this.inRace = false;
    this.handled.clear();
    this.sig.setOpen(this.code, this.id, true).catch(() => {});
    this.#others(null, { type: 'back' });
    this.#lobby();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.#others(null, { type: 'bye', reason: 'The host left.' });
    for (const p of this.players.values()) setTimeout(() => p.link?.close(), 300);
    if (this.code) this.sig.closeRoom(this.code);
  }
}

export class ClientSession extends Emitter {
  constructor({ name, cls, id = newId(), sig = signal, offer = makeOffer }) {
    super();
    this.id = id;
    this.name = name;
    this.cls = cls;
    this.sig = sig;
    this.offer = offer;
    this.link = null;
  }

  async join(code) {
    code = String(code).trim().toUpperCase();
    this.code = code;
    const room = await this.sig.roomInfo(code);
    if (!room) throw new Error(`There is no room ${code}.`);
    if (room.open === false) throw new Error('That race has already started. Ask the host to go back to the lobby.');
    this.emit('status', 'Connecting to the host…');
    const { link, sdp, accept } = await this.offer();
    this.link = link;
    // Listen from the start: the host may answer straight away (a full room, a race under way)
    link.onmessage = (m) => this.#message(m);
    if (!(await this.sig.postOffer(code, this.id, this.name, sdp))) throw new Error('Could not reach the room.');
    let answer = null;
    for (let i = 0; i < 25 && !answer; i++) {
      await wait(1000);
      answer = (await this.sig.getPeer(code, this.id))?.answer ?? null;
    }
    if (!answer) { this.sig.dropPeer(code, this.id); throw new Error('The host didn\'t answer. Are they still in the lobby?'); }
    await accept(answer);
    const opened = await Promise.race([link.opened.then(() => true), wait(15000).then(() => false)]);
    if (!opened) {
      link.close();
      throw new Error('Couldn\'t connect directly to the host. Some school and office networks block direct connections between browsers: try another network, or both join the same Wi-Fi.');
    }
    link.onclose = () => this.emit('closed', this.byeReason ?? 'Lost the connection to the host.');
    link.send({ type: 'hello', name: this.name, cls: this.cls });
  }

  #message(m) {
    if (m.type === 'lobby') this.emit('lobby', m);
    else if (m.type === 'start') this.emit('start', m);
    else if (m.type === 'st') this.emit('state', m.id, m.s);
    else if (m.type === 'ev') this.emit('ev', m.e);
    else if (m.type === 'hit') this.emit('hit', m);
    else if (m.type === 'left') this.emit('left', m.id);
    else if (m.type === 'over') this.emit('over');
    else if (m.type === 'back') this.emit('back');
    else if (m.type === 'bye') { this.byeReason = m.reason; this.emit('closed', m.reason); }
  }

  setClass(cls) { this.cls = cls; this.link?.send({ type: 'cls', cls }); }
  sendState(id, s) { this.link?.send({ type: 'st', s }, true); }
  sendEvent(e) { this.link?.send({ type: 'ev', e }); }
  sendHit(h) { this.link?.send({ type: 'hit', ...h }); }
  close() { this.link?.close(); }
}
