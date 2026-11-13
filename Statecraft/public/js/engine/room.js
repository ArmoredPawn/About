// A room: the lobby, up to 20 leaders, chat, and the clock that runs the game.
// It knows nothing about networks: a connection is { send(object) }. The server runs many rooms;
// solo play runs one in the browser.
//
// From players: settings { speed, pool } (host), start (host), again (host), cmd { req, cmd }, chat { ch, text }, dm { to }, group { name, members },
//   groupInvite { ch, members }, groupLeave { ch }
// To players: lobby, state, chat, channels, cmdResult, alert/news (fresh events), error

import { COUNTRY_IDS, COUNTRIES } from './data/countries.js';
import { Game } from './game.js';
import { alliancesOf, alive } from './core.js';

export const MAX_PLAYERS = 20;
export const SPEEDS = { slow: 15000, normal: 9000, fast: 5000, blitz: 2500 };
export const POOLS = [50, 20, 10];
// Armies march and battles are fought in steps this often (at least 8 a game week), so the war runs in real time
export const stepMs = (speed) => Math.min(1000, (SPEEDS[speed] ?? SPEEDS.normal) / 8);
const CHAT_KEEP = 150;
const CARETAKER_MS = 120_000; // a disconnected leader's country is run by the computer after this
const MAX_TEXT = 500;
const DEFAULT_TIMERS = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
  every: (fn, ms) => setInterval(fn, ms),
  stop: (id) => clearInterval(id),
};

export class Room {
  constructor({ code = 'SOLO', now = () => Date.now(), timers = DEFAULT_TIMERS, seed, onTick } = {}) {
    this.code = code;
    this.now = now;
    this.timers = timers;
    this.seed = seed;
    this.onTick = onTick;
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby';
    this.settings = { speed: 'normal', pool: 50 };
    this.paused = false;
    this.game = null;
    this.clock = null;
    this.channels = new Map([['world', { id: 'world', kind: 'world', name: 'World', messages: [] }]]);
    this.groupCount = 0;
  }

  /* ---------- Players ---------- */

  addPlayer({ id, token, name, conn }) {
    const player = { id, token, name, conn, cid: null, connected: true, caretaker: null, lastChat: 0 };
    this.players.set(id, player);
    this.hostId ??= id;
    this.#hello(player);
    this.#everyone();
    return player;
  }

  reconnect(player, conn) {
    player.conn = conn;
    player.connected = true;
    this.timers.clear(player.caretaker);
    player.caretaker = null;
    if (player.cid && this.game && !this.game.s.countries[player.cid].human) this.game.setLeader(player.cid, player.name);
    if (!this.players.get(this.hostId)?.connected) this.hostId = player.id;
    this.#hello(player);
    this.#everyone();
  }

  disconnect(player) {
    player.connected = false;
    player.conn = null;
    if (this.hostId === player.id) this.#pickHost();
    if (this.phase === 'playing' && player.cid) {
      player.caretaker = this.timers.set(() => {
        if (!player.connected && this.game) {
          this.game.setLeader(player.cid, null);
          this.#system(`${player.name} lost connection. The computer is running ${COUNTRIES[player.cid].name} until they return.`);
        }
      }, CARETAKER_MS);
    }
    this.#everyone();
  }

  removePlayer(player) {
    this.timers.clear(player.caretaker);
    this.players.delete(player.id);
    if (this.game && player.cid) {
      this.game.setLeader(player.cid, null);
      this.#system(`${player.name} has left. The computer now runs ${COUNTRIES[player.cid].name}.`);
    }
    if (this.hostId === player.id) this.#pickHost();
    if (this.players.size) this.#everyone();
  }

  get empty() {
    return ![...this.players.values()].some((p) => p.connected);
  }

  #pickHost() {
    const next = [...this.players.values()].find((p) => p.connected) ?? this.players.values().next().value;
    this.hostId = next?.id ?? null;
  }

  /* ---------- Messages ---------- */

  handle(player, msg) {
    const isHost = player.id === this.hostId;
    switch (msg.type) {
      case 'settings':
        if (!isHost || this.phase !== 'lobby') return;
        if (SPEEDS[msg.speed]) this.settings.speed = msg.speed;
        if (POOLS.includes(msg.pool)) this.settings.pool = msg.pool;
        return this.#everyone();
      case 'start':
        if (!isHost) return;
        return this.start();
      // The world runs in real time: no pausing, and the pace is fixed when the game starts
      case 'pause':
      case 'speed':
        return;
      // No one can call the game early: it ends only when one country has conquered the world
      case 'end':
        return;
      case 'again':
        if (!isHost || this.phase !== 'over') return;
        this.phase = 'lobby';
        this.game = null;
        for (const p of this.players.values()) p.cid = null;
        for (const [id, ch] of this.channels) if (ch.kind !== 'world') this.channels.delete(id);
        return this.#everyone();
      case 'cmd':
        return this.#command(player, msg);
      case 'chat':
        return this.#chat(player, msg);
      case 'group':
        return this.#group(player, msg);
      case 'groupInvite':
        return this.#groupInvite(player, msg);
      case 'groupLeave':
        return this.#groupLeave(player, msg);
      default:
    }
  }

  start() {
    if (this.phase !== 'lobby') return;
    const players = [...this.players.values()];
    const pool = COUNTRY_IDS.slice(0, Math.max(this.settings.pool, players.length));
    this.game = Game.create({ seed: this.seed ?? Math.floor(Math.random() * 2 ** 31) });
    const s = this.game.s;
    const order = shuffleWith(pool, () => (s.seed = (s.seed * 1103515245 + 12345) | 0, ((s.seed >>> 0) % 100000) / 100000));
    players.forEach((p, i) => {
      p.cid = order[i];
      this.game.setLeader(p.cid, p.name);
    });
    this.phase = 'playing';
    this.paused = false;
    this.#system(`The game begins. ${players.map((p) => `${p.name} leads ${COUNTRIES[p.cid].name}`).join(', ')}. The other countries are run by the computer.`);
    this.#runClock();
    this.#everyone();
  }

  // Restores a saved solo game
  restore(state, player) {
    this.game = new Game(state);
    this.phase = state.over ? 'over' : 'playing';
    player.cid = Object.values(state.countries).find((c) => c.human)?.id ?? null;
    this.paused = false;
    this.#runClock();
    this.#everyone();
  }

  #runClock() {
    this.stopClock();
    if (this.phase !== 'playing' || this.paused) return;
    this.clock = this.timers.every(() => this.tick(), SPEEDS[this.settings.speed]);
    this.stepper = this.timers.every(() => this.step(), stepMs(this.settings.speed));
  }

  tick() {
    if (!this.game || this.phase !== 'playing' || this.paused) return;
    this.game.tick();
    this.#tickDone();
  }

  // Armies move and battles progress. Anything newsworthy (a province falls, an army is destroyed) sends
  // everyone the full picture; otherwise just the armies and battles.
  step() {
    if (!this.game || this.phase !== 'playing' || this.paused) return;
    this.game.step(stepMs(this.settings.speed) / SPEEDS[this.settings.speed]);
    if (this.game.s.fresh.length) {
      this.#flush();
      this.#everyone();
      return;
    }
    for (const p of this.players.values()) if (p.conn) p.conn.send(this.game.live(p.cid));
  }

  #tickDone() {
    if (this.game.s.over && this.phase === 'playing') {
      this.phase = 'over';
      this.stopClock();
    }
    this.#syncAllianceChats();
    this.#flush();
    this.#everyone();
    this.onTick?.(this);
  }

  #command(player, msg) {
    if (!this.game || this.phase !== 'playing' || !player.cid) return;
    const err = this.game.command(player.cid, msg.cmd ?? {});
    player.conn?.send({ type: 'cmdResult', req: msg.req, error: err });
    this.#syncAllianceChats();
    this.#flush();
    // The leader sees the result straight away; everyone else gets an update moments later (batched)
    this.#sendState(player);
    if (!this.soon) {
      this.soon = this.timers.set(() => {
        this.soon = null;
        for (const p of this.players.values()) if (p !== player) this.#sendState(p);
      }, 300);
    }
  }

  // Fresh news goes to everyone, alerts to their leader
  #flush() {
    if (!this.game) return;
    for (const f of this.game.drain()) {
      if (f.type === 'news') this.#all({ type: 'news', item: f });
      else for (const p of this.players.values()) if (p.cid === f.to) p.conn?.send({ type: 'alert', item: f });
    }
  }

  /* ---------- Chat ---------- */

  #visible(player) {
    const out = [];
    for (const ch of this.channels.values()) if (this.#canSee(player, ch)) out.push(ch);
    return out;
  }

  #canSee(player, ch) {
    if (ch.kind === 'world') return true;
    if (!player.cid) return false;
    if (ch.kind === 'alliance') {
      const al = this.game?.s.alliances[ch.alliance];
      return Boolean(al && al.members.includes(player.cid));
    }
    return ch.members.includes(player.cid);
  }

  #chat(player, { ch, text, to }) {
    const now = this.now();
    if (now - player.lastChat < 400) return;
    text = String(text ?? '').replace(/[\p{Cc}]/gu, ' ').trim().slice(0, MAX_TEXT);
    if (!text) return;
    let channel = this.channels.get(ch);
    if (!channel && to && player.cid) channel = this.#directChannel(player.cid, to);
    if (!channel || !this.#canSee(player, channel)) return;
    player.lastChat = now;
    const msg = {
      id: `${now.toString(36)}${Math.floor(Math.random() * 1e4)}`, ch: channel.id, from: player.cid, player: player.name, text, t: now,
      week: this.game?.s.week ?? null,
    };
    channel.messages.push(msg);
    if (channel.messages.length > CHAT_KEEP) channel.messages.shift();
    for (const p of this.players.values()) if (p.conn && this.#canSee(p, channel)) p.conn.send({ type: 'chat', msg, channel: meta(channel) });
  }

  #directChannel(a, b) {
    if (!this.game || a === b || !this.#leaderOf(b)) return null;
    const id = `dm:${[a, b].sort().join(':')}`;
    let ch = this.channels.get(id);
    if (!ch) {
      ch = { id, kind: 'dm', name: '', members: [a, b], messages: [] };
      this.channels.set(id, ch);
      this.#sendChannels();
    }
    return ch;
  }

  #leaderOf(cid) {
    return [...this.players.values()].find((p) => p.cid === cid) ?? null;
  }

  #group(player, { name, members }) {
    if (!player.cid || !this.game) return;
    name = String(name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 32);
    if (!name) return player.conn?.send({ type: 'error', message: 'Give the group chat a name.' });
    const list = [...new Set([player.cid, ...(Array.isArray(members) ? members : [])])].filter((cid) => this.#leaderOf(cid));
    if (list.length < 2) return player.conn?.send({ type: 'error', message: 'Add at least one other leader.' });
    const id = `g:${++this.groupCount}`;
    this.channels.set(id, { id, kind: 'group', name, members: list, owner: player.cid, messages: [] });
    this.#systemIn(id, `${player.name} started the group "${name}".`);
    this.#sendChannels();
  }

  #groupInvite(player, { ch, members }) {
    const channel = this.channels.get(ch);
    if (!channel || channel.kind !== 'group' || !channel.members.includes(player.cid)) return;
    for (const cid of Array.isArray(members) ? members : []) {
      if (this.#leaderOf(cid) && !channel.members.includes(cid)) channel.members.push(cid);
    }
    this.#sendChannels();
  }

  #groupLeave(player, { ch }) {
    const channel = this.channels.get(ch);
    if (!channel || channel.kind !== 'group') return;
    channel.members = channel.members.filter((m) => m !== player.cid);
    if (!channel.members.length) this.channels.delete(ch);
    this.#sendChannels();
  }

  // Every alliance with a human member gets a chat; it follows the membership
  #syncAllianceChats() {
    if (!this.game) return;
    let changed = false;
    const live = new Set();
    for (const al of Object.values(this.game.s.alliances)) {
      const id = `al:${al.id}`;
      live.add(id);
      const humans = al.members.filter((m) => this.#leaderOf(m));
      const ch = this.channels.get(id);
      if (!ch && humans.length) {
        this.channels.set(id, { id, kind: 'alliance', alliance: al.id, name: al.name, members: humans, sig: humans.sort().join(','), messages: [] });
        changed = true;
      }
      const sig = humans.sort().join(',');
      if (ch && ch.sig !== sig) { ch.sig = sig; ch.members = humans; ch.name = al.name; changed = true; }
    }
    for (const [id, ch] of this.channels) if (ch.kind === 'alliance' && !live.has(id)) { this.channels.delete(id); changed = true; }
    if (changed) this.#sendChannels();
  }

  #system(text) {
    this.#systemIn('world', text);
  }

  #systemIn(chId, text) {
    const channel = this.channels.get(chId);
    if (!channel) return;
    const now = this.now();
    const msg = { id: `${now.toString(36)}s${Math.floor(Math.random() * 1e4)}`, ch: chId, from: null, player: null, text, t: now, week: this.game?.s.week ?? null, system: true };
    channel.messages.push(msg);
    if (channel.messages.length > CHAT_KEEP) channel.messages.shift();
    for (const p of this.players.values()) if (p.conn && this.#canSee(p, channel)) p.conn.send({ type: 'chat', msg, channel: meta(channel) });
  }

  #sendChannels() {
    for (const p of this.players.values()) p.conn?.send({ type: 'channels', channels: this.#visible(p).map(meta) });
  }

  /* ---------- Sending ---------- */

  #hello(player) {
    player.conn?.send({
      type: 'chatInit',
      channels: this.#visible(player).map((ch) => ({ ...meta(ch), messages: ch.messages })),
    });
  }

  #all(msg) {
    for (const p of this.players.values()) p.conn?.send(msg);
  }

  #lobby() {
    return {
      type: 'lobby', code: this.code, phase: this.phase, hostId: this.hostId, settings: this.settings, paused: this.paused,
      max: MAX_PLAYERS, speeds: Object.keys(SPEEDS), pools: POOLS,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, cid: p.cid, connected: p.connected })),
    };
  }

  #everyone() {
    const lobby = this.#lobby();
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      p.conn.send({ ...lobby, you: p.id });
      this.#sendState(p);
    }
  }

  #sendState(player) {
    if (!this.game || !player.conn) return;
    player.conn.send({ ...this.game.view(player.cid), paused: this.paused, speed: this.settings.speed, stepMs: stepMs(this.settings.speed), phase: this.phase });
  }

  stopClock() {
    this.timers.stop?.(this.clock);
    this.timers.stop?.(this.stepper);
    this.clock = null;
    this.stepper = null;
  }
}

function meta(ch) {
  return { id: ch.id, kind: ch.kind, name: ch.name, members: ch.members, owner: ch.owner ?? null, alliance: ch.alliance ?? null };
}

function shuffleWith(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { alliancesOf, alive };
