// Live rooms for up to 10 players. The server holds the answer lists and does all the scoring,
// so players never see the lists and can't send themselves points.
//
// A connection is { send(object), close() }. Messages from players:
//   create { name }            join { code, name }        resume { code, token }
//   settings { rounds, seconds } (host)                    start (host)
//   answer { text }            again (host, after a game)   leave
// Messages to players: joined, state (a full snapshot after every change), guess (only to the guesser), error.

import { randomBytes } from 'node:crypto';
import { TIERS, normalize, lookupKeys, todayKey } from '../public/js/shared.js';

export const MAX_PLAYERS = 10;
export const ROUND_OPTIONS = [5, 7, 10];
export const SECOND_OPTIONS = [15, 20, 30];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_ROOMS = 200;
const RESULTS_MS = 8000;
const LATE_MS = 600; // answers sent just before the buzzer still count despite network delay
const LOBBY_DROP_MS = 30_000; // a player who disconnects in the lobby is removed after this
const EMPTY_ROOM_MS = 5 * 60_000; // a room with nobody connected is closed after this
const GUESS_GAP_MS = 200;
const MESSAGE_LIMIT = 40; // per connection per 10 seconds
const MAX_ANSWER_LENGTH = 60;

export class Rooms {
  constructor({ content, now = Date.now, timers = { set: setTimeout, clear: clearTimeout }, random = Math.random, today = () => todayKey() }) {
    this.content = content;
    this.now = now;
    this.timers = timers;
    this.random = random;
    this.today = today;
    this.rooms = new Map();
  }

  get stats() {
    let players = 0;
    for (const room of this.rooms.values()) players += room.players.size;
    return { rooms: this.rooms.size, players };
  }

  connect(conn) {
    const client = { conn, player: null, room: null, window: this.now(), count: 0 };
    return {
      message: (raw) => this.#message(client, raw),
      close: () => this.#disconnect(client),
    };
  }

  #message(client, raw) {
    const now = this.now();
    if (now - client.window > 10_000) { client.window = now; client.count = 0; }
    if (++client.count > MESSAGE_LIMIT) { client.conn.close(); return; }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    const handler = {
      create: this.#create, join: this.#join, resume: this.#resume, settings: this.#settings,
      start: this.#start, answer: this.#answer, again: this.#again, leave: this.#leave,
    }[msg.type];
    handler?.call(this, client, msg);
  }

  /* ---------- Joining and leaving ---------- */

  #create(client, msg) {
    const name = cleanName(msg.name);
    if (!name) return error(client, 'name', 'Enter a name.');
    if (this.rooms.size >= MAX_ROOMS) return error(client, 'busy', 'Too many rooms are open right now. Try again soon.');
    this.#leave(client);
    const room = {
      code: this.#newCode(),
      players: new Map(),
      hostId: null,
      phase: 'lobby',
      settings: { rounds: 7, seconds: 20 },
      questions: [],
      round: 0,
      used: new Set(),
      timer: null,
      endsAt: 0,
      emptyTimer: null,
    };
    this.rooms.set(room.code, room);
    this.#addPlayer(client, room, name);
  }

  #join(client, msg) {
    const room = this.rooms.get(String(msg.code ?? '').trim().toUpperCase());
    if (!room) return error(client, 'no-room', 'No room has that code. Check it and try again.');
    const name = cleanName(msg.name);
    if (!name) return error(client, 'name', 'Enter a name.');
    if (client.room === room) return;
    if (room.players.size >= MAX_PLAYERS) return error(client, 'full', `That room is full (${MAX_PLAYERS} players).`);
    const taken = [...room.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return error(client, 'name-taken', 'Someone in that room already has that name.');
    this.#leave(client);
    this.#addPlayer(client, room, name);
  }

  #addPlayer(client, room, name) {
    const player = {
      id: randomBytes(4).toString('hex'),
      token: randomBytes(16).toString('hex'),
      name,
      score: 0,
      answer: null,
      client: null,
      dropTimer: null,
      lastGuess: 0,
    };
    room.players.set(player.id, player);
    room.hostId ??= player.id;
    this.#attach(client, room, player);
  }

  // Reconnecting after a dropped connection or a page reload
  #resume(client, msg) {
    const room = this.rooms.get(String(msg.code ?? '').toUpperCase());
    const player = room && [...room.players.values()].find((p) => p.token === msg.token);
    if (!player) return error(client, 'resume-failed', 'That game has ended.');
    if (player.client === client) return this.#broadcast(room);
    if (player.client) {
      player.client.player = null;
      player.client.room = null;
    }
    this.#leave(client);
    this.#attach(client, room, player);
  }

  #attach(client, room, player) {
    client.room = room;
    client.player = player;
    player.client = client;
    this.timers.clear(player.dropTimer);
    this.timers.clear(room.emptyTimer);
    if (!room.players.get(room.hostId)?.client) room.hostId = player.id;
    client.conn.send({ type: 'joined', code: room.code, you: player.id, token: player.token });
    this.#broadcast(room);
  }

  #leave(client) {
    const { room, player } = client;
    if (!room) return;
    client.room = null;
    client.player = null;
    player.client = null;
    this.#removePlayer(room, player);
  }

  #removePlayer(room, player) {
    this.timers.clear(player.dropTimer);
    room.players.delete(player.id);
    if (room.players.size === 0) return this.#closeRoom(room);
    if (room.hostId === player.id) this.#pickHost(room);
    this.#broadcast(room);
    this.#checkAllAnswered(room);
  }

  #disconnect(client) {
    const { room, player } = client;
    if (!room) return;
    client.room = null;
    client.player = null;
    if (player.client !== client) return;
    player.client = null;
    if (room.hostId === player.id) this.#pickHost(room);
    if (room.phase === 'lobby') {
      player.dropTimer = this.timers.set(() => this.#removePlayer(room, player), LOBBY_DROP_MS);
    }
    if (![...room.players.values()].some((p) => p.client)) {
      room.emptyTimer = this.timers.set(() => this.#closeRoom(room), EMPTY_ROOM_MS);
    }
    this.#broadcast(room);
    this.#checkAllAnswered(room);
  }

  // The longest-standing connected player becomes host
  #pickHost(room) {
    const next = [...room.players.values()].find((p) => p.client) ?? room.players.values().next().value;
    room.hostId = next?.id ?? null;
  }

  #closeRoom(room) {
    this.timers.clear(room.timer);
    this.timers.clear(room.emptyTimer);
    for (const p of room.players.values()) {
      this.timers.clear(p.dropTimer);
      if (p.client) { p.client.room = null; p.client.player = null; }
    }
    this.rooms.delete(room.code);
  }

  #newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(this.random() * CODE_LETTERS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  /* ---------- The game ---------- */

  #isHost(client) {
    return client.room && client.room.hostId === client.player.id;
  }

  #settings(client, msg) {
    if (!this.#isHost(client) || client.room.phase !== 'lobby') return;
    const { settings } = client.room;
    if (ROUND_OPTIONS.includes(msg.rounds)) settings.rounds = msg.rounds;
    if (SECOND_OPTIONS.includes(msg.seconds)) settings.seconds = msg.seconds;
    this.#broadcast(client.room);
  }

  #start(client) {
    const room = client.room;
    if (!this.#isHost(client) || room.phase !== 'lobby') return;
    if (!this.content.ready) return error(client, 'loading', 'The server is still loading questions. Try again in a few seconds.');
    const pool = this.content.pool(this.today());
    if (!pool.length) return error(client, 'no-prompts', 'There are no questions to play yet.');

    // Prefer prompts this room hasn't had yet; start over once it has had them all
    let fresh = pool.filter((p) => !room.used.has(p.id));
    if (fresh.length < room.settings.rounds) {
      room.used.clear();
      fresh = pool;
    }
    room.questions = this.#shuffle(fresh).slice(0, room.settings.rounds);
    room.questions.forEach((q) => room.used.add(q.id));
    room.round = 0;
    for (const p of room.players.values()) { p.score = 0; p.answer = null; }
    this.#nextQuestion(room);
  }

  #nextQuestion(room) {
    if (room.round >= room.questions.length) {
      room.phase = 'final';
      room.timer = null;
      return this.#broadcast(room);
    }
    room.round++;
    room.phase = 'question';
    for (const p of room.players.values()) p.answer = null;
    const ms = room.settings.seconds * 1000;
    room.endsAt = this.now() + ms;
    room.timer = this.timers.set(() => this.#endQuestion(room), ms + LATE_MS);
    this.#broadcast(room);
  }

  #endQuestion(room) {
    if (room.phase !== 'question') return;
    this.timers.clear(room.timer);
    room.phase = 'results';
    room.endsAt = this.now() + RESULTS_MS;
    room.timer = this.timers.set(() => this.#nextQuestion(room), RESULTS_MS);
    this.#broadcast(room);
  }

  #checkAllAnswered(room) {
    if (room.phase !== 'question') return;
    const connected = [...room.players.values()].filter((p) => p.client);
    if (connected.length && connected.every((p) => p.answer)) this.#endQuestion(room);
  }

  #answer(client, msg) {
    const { room, player } = client;
    if (!room || room.phase !== 'question' || player.answer) return;
    const now = this.now();
    if (now > room.endsAt + LATE_MS) return;
    if (now - player.lastGuess < GUESS_GAP_MS) return client.conn.send({ type: 'guess', ok: false, reason: 'slow-down' });
    player.lastGuess = now;

    const text = String(msg.text ?? '').trim().slice(0, MAX_ANSWER_LENGTH);
    const key = normalize(text);
    if (!key) return client.conn.send({ type: 'guess', ok: false, reason: 'empty' });
    const question = room.questions[room.round - 1];
    const match = lookupKeys(key).map((k) => question.keys.get(k)).find(Boolean);
    if (!match) return client.conn.send({ type: 'guess', ok: false, reason: 'not-on-list', text });

    const points = TIERS[match.tier].points;
    player.answer = { text, name: match.name, tier: match.tier, points };
    player.score += points;
    client.conn.send({ type: 'guess', ok: true, answer: player.answer });
    this.#broadcast(room);
    this.#checkAllAnswered(room);
  }

  #again(client) {
    const room = client.room;
    if (!this.#isHost(client) || room.phase !== 'final') return;
    room.phase = 'lobby';
    room.round = 0;
    room.questions = [];
    for (const p of room.players.values()) {
      p.score = 0;
      p.answer = null;
      if (!p.client) p.dropTimer = this.timers.set(() => this.#removePlayer(room, p), LOBBY_DROP_MS);
    }
    this.#broadcast(room);
  }

  /* ---------- Sending state ---------- */

  #broadcast(room) {
    for (const p of room.players.values()) p.client?.conn.send(this.#snapshot(room, p));
  }

  #snapshot(room, viewer) {
    const question = room.round ? room.questions[room.round - 1] : null;
    const reveal = room.phase === 'results' || room.phase === 'final';
    const timed = room.phase === 'question' || room.phase === 'results';
    return {
      type: 'state',
      code: room.code,
      phase: room.phase,
      you: viewer.id,
      hostId: room.hostId,
      settings: room.settings,
      round: room.round,
      rounds: room.questions.length,
      prompt: room.phase === 'question' || room.phase === 'results' ? question.text : null,
      examples: room.phase === 'results' ? question.examples : null,
      remainingMs: timed ? Math.max(0, room.endsAt - this.now()) : 0,
      players: [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: Boolean(p.client),
        answered: Boolean(p.answer),
        answer: reveal || p === viewer ? p.answer : null,
      })),
    };
  }

  #shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

function error(client, code, message) {
  client.conn.send({ type: 'error', code, message });
}

// Up to 16 characters, no control characters or runs of spaces
export function cleanName(value) {
  const text = String(value ?? '').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, 16).join('').trim();
}
