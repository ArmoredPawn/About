// All the live rooms on the server: codes, joining, reconnecting and rate limits.
// The rooms themselves (lobby, chat and the game clock) are public/js/engine/room.js, shared with solo play.
//
// From players: create { name }, join { code, name }, resume { code, token }, leave, and anything a room handles.
// To players: joined { code, you, token }, error { code, message }, and everything a room sends.

import { randomBytes } from 'node:crypto';
import { Room, MAX_PLAYERS } from '../public/js/engine/room.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_ROOMS = 40;
const EMPTY_ROOM_MS = 20 * 60_000; // a room nobody is connected to closes after this
const LOBBY_DROP_MS = 60_000; // someone who disconnects in the lobby is removed after this
const MESSAGE_LIMIT = 80; // per connection per 10 seconds

export class Rooms {
  constructor({ now = Date.now, timers = { set: setTimeout, clear: clearTimeout, every: setInterval, stop: clearInterval }, random = Math.random } = {}) {
    this.now = now;
    this.timers = timers;
    this.random = random;
    this.rooms = new Map();
  }

  get stats() {
    let players = 0;
    let games = 0;
    for (const room of this.rooms.values()) {
      players += room.players.size;
      if (room.phase === 'playing') games++;
    }
    return { rooms: this.rooms.size, games, players };
  }

  connect(conn) {
    const client = { conn, room: null, player: null, window: this.now(), count: 0 };
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
    switch (msg.type) {
      case 'create': return this.#create(client, msg);
      case 'join': return this.#join(client, msg);
      case 'resume': return this.#resume(client, msg);
      case 'leave': return this.#leave(client);
      default:
        if (client.room && client.player) client.room.handle(client.player, msg);
    }
  }

  #create(client, msg) {
    const name = cleanName(msg.name);
    if (!name) return error(client, 'name', 'Enter a name.');
    if (this.rooms.size >= MAX_ROOMS) return error(client, 'busy', 'Too many games are running right now. Try again soon.');
    this.#leave(client);
    const code = this.#newCode();
    const room = new Room({ code, now: this.now, timers: this.timers });
    room.emptyTimer = null;
    this.rooms.set(code, room);
    this.#enter(client, room, name);
  }

  #join(client, msg) {
    const room = this.rooms.get(String(msg.code ?? '').trim().toUpperCase());
    if (!room) return error(client, 'no-room', 'No game has that code. Check it and try again.');
    const name = cleanName(msg.name);
    if (!name) return error(client, 'name', 'Enter a name.');
    if (client.room === room) return;
    if (room.phase !== 'lobby') return error(client, 'started', 'That game has already started. Ask the host to start a new one.');
    if (room.players.size >= MAX_PLAYERS) return error(client, 'full', `That game is full (${MAX_PLAYERS} leaders).`);
    if ([...room.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) return error(client, 'name-taken', 'Someone in that game already has that name.');
    this.#leave(client);
    this.#enter(client, room, name);
  }

  #enter(client, room, name) {
    const id = randomBytes(4).toString('hex');
    const token = randomBytes(16).toString('hex');
    client.room = room;
    client.conn.send({ type: 'joined', code: room.code, you: id, token });
    client.player = room.addPlayer({ id, token, name, conn: client.conn });
    client.player.client = client;
    this.timers.clear(room.emptyTimer);
  }

  #resume(client, msg) {
    const room = this.rooms.get(String(msg.code ?? '').toUpperCase());
    const player = room && [...room.players.values()].find((p) => p.token === msg.token);
    if (!player) return error(client, 'resume-failed', 'That game has ended.');
    if (client.player === player) return;
    for (const other of this.#clientsOf(player)) { other.room = null; other.player = null; }
    this.#leave(client);
    this.timers.clear(player.dropTimer);
    this.timers.clear(room.emptyTimer);
    client.room = room;
    client.player = player;
    player.client = client;
    client.conn.send({ type: 'joined', code: room.code, you: player.id, token: player.token });
    room.reconnect(player, client.conn);
  }

  *#clientsOf(player) {
    if (player.client) yield player.client;
  }

  #leave(client) {
    const { room, player } = client;
    if (!room) return;
    client.room = null;
    client.player = null;
    this.timers.clear(player.dropTimer);
    room.removePlayer(player);
    if (!room.players.size) this.#close(room);
  }

  #disconnect(client) {
    const { room, player } = client;
    if (!room) return;
    client.room = null;
    client.player = null;
    if (player.client && player.client !== client) return;
    room.disconnect(player);
    if (room.phase === 'lobby') player.dropTimer = this.timers.set(() => { room.removePlayer(player); if (!room.players.size) this.#close(room); }, LOBBY_DROP_MS);
    if (room.empty) {
      this.timers.clear(room.emptyTimer);
      room.emptyTimer = this.timers.set(() => this.#close(room), EMPTY_ROOM_MS);
    }
  }

  #close(room) {
    room.stopClock();
    this.timers.clear(room.emptyTimer);
    for (const p of room.players.values()) this.timers.clear(p.dropTimer);
    this.rooms.delete(room.code);
  }

  #newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(this.random() * CODE_LETTERS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}

function error(client, code, message) {
  client.conn.send({ type: 'error', code, message });
}

// Up to 20 characters, no control characters or runs of spaces
export function cleanName(value) {
  const text = String(value ?? '').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, 20).join('').trim();
}
