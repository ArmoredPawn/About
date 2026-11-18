// Rooms, with the room service and the browser-to-browser connections replaced by in-memory stand-ins: joining by
// code, the lobby, the start, and positions, shots and hits reaching the right players.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, ClientSession } from '../public/js/net/session.js';

// The room service: documents in a map, like Firestore
function fakeSignal() {
  const rooms = new Map();
  return {
    rooms,
    async createRoom(code, host) { if (rooms.has(code)) return false; rooms.set(code, { host, open: true, peers: new Map() }); return true; },
    async roomInfo(code) { const r = rooms.get(code); return r ? { host: r.host, open: r.open } : null; },
    async setOpen(code, host, open) { const r = rooms.get(code); if (r) r.open = open; },
    async closeRoom(code) { rooms.delete(code); },
    async postOffer(code, peer, name, offer) { rooms.get(code).peers.set(peer, { id: peer, name, offer }); return true; },
    async listPeers(code) { return [...(rooms.get(code)?.peers.values() ?? [])]; },
    async postAnswer(code, peer, answer) { const p = rooms.get(code)?.peers.get(peer); if (p) p.answer = answer; },
    async getPeer(code, peer) { return rooms.get(code)?.peers.get(peer) ?? null; },
    async dropPeer(code, peer) { rooms.get(code)?.peers.delete(peer); },
  };
}

// A pair of connected links, for each offer
const pending = new Map();
class FakeLink {
  constructor() { this.onmessage = null; this.onclose = null; this.closed = false; this.opened = new Promise((r) => { this.open = r; }); }
  send(msg) { if (this.closed) return; const m = JSON.parse(JSON.stringify(msg)); setTimeout(() => this.other?.onmessage?.(m), 1); }
  close() { if (this.closed) return; this.closed = true; this.onclose?.(); this.other?.close(); }
}
let n = 0;
async function fakeOffer() {
  const a = new FakeLink();
  const sdp = `offer-${++n}`;
  pending.set(sdp, a);
  // Like WebRTC: nothing opens until the joiner has the host's answer
  a.answered = new Promise((r) => { a.gotAnswer = r; });
  return { link: a, sdp, accept: async () => a.gotAnswer() };
}
async function fakeAnswer(sdp) {
  const a = pending.get(sdp);
  const b = new FakeLink();
  a.other = b; b.other = a;
  a.answered.then(() => setTimeout(() => { a.open(); b.open(); }, 5));
  return { link: b, sdp: `answer-${sdp}` };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await wait(20); } };

test('players join by code, see the lobby, start together, and their positions, shots and hits reach the right boats', { timeout: 30000 }, async () => {
  const sig = fakeSignal();
  const host = new HostSession({ name: 'Hostess', cls: 'gunboat', id: 'H', sig, answer: fakeAnswer });
  const code = await host.open();
  assert.match(code, /^[A-Z]{4}$/);
  const a = new ClientSession({ name: 'Ann', cls: 'interceptor', id: 'A', sig, offer: fakeOffer });
  const b = new ClientSession({ name: 'Bob', cls: 'patrol', id: 'B', sig, offer: fakeOffer });
  let lobbyA = null;
  a.on('lobby', (m) => { lobbyA = m; });
  await Promise.all([a.join(code), b.join(code)]);
  await until(() => lobbyA?.players.length === 3);
  assert.deepEqual(lobbyA.players.map((p) => p.name).sort(), ['Ann', 'Bob', 'Hostess']);
  assert.equal(new Set(lobbyA.players.map((p) => p.color)).size, 3, 'everyone gets their own colour');
  assert.equal(sig.rooms.get(code).peers.size, 0, 'the room service forgets the handshake once connected');

  // The host changes the course; everyone sees it
  host.setSettings({ track: 'fjord', bots: 2 });
  await until(() => lobbyA.settings.track === 'fjord');

  // The start: three players and two computer racers
  let startA = null;
  a.on('start', (m) => { startA = m; });
  host.start(['Bot one', 'Bot two']);
  await until(() => startA);
  assert.equal(startA.roster.length, 5);
  assert.equal(startA.roster.filter((r) => r.bot).length, 2);
  assert.equal(new Set(startA.roster.map((r) => r.slot)).size, 5, 'every boat has its own place on the grid');
  assert.equal(sig.rooms.get(code).open, false, 'the room closes to newcomers during the race');

  // Ann's position reaches Bob and the host, not Ann
  const seen = { H: [], A: [], B: [] };
  host.on('state', (id) => seen.H.push(id));
  a.on('state', (id) => seen.A.push(id));
  b.on('state', (id) => seen.B.push(id));
  a.sendState('A', { x: 1 });
  host.sendState('bot0', { x: 2 });
  await until(() => seen.B.includes('A') && seen.A.includes('bot0') && seen.B.includes('bot0'));
  assert.ok(seen.H.includes('A') && !seen.A.includes('A'));

  // A shot by Ann reaches everyone else
  let evB = null;
  b.on('ev', (e) => { evB = e; });
  a.sendEvent({ t: 'fire', id: 'A:1', owner: 'A', w: 'hmg' });
  await until(() => evB);
  assert.equal(evB.id, 'A:1');

  // Hits go to the hit boat's owner: Ann's on Bob to Bob, Bob's on a computer racer to the host
  const hits = { H: [], A: [], B: [] };
  host.on('hit', (h) => hits.H.push(h.id));
  a.on('hit', (h) => hits.A.push(h.id));
  b.on('hit', (h) => hits.B.push(h.id));
  a.sendHit({ id: 'B', amount: 5, by: 'A', w: 'hmg' });
  b.sendHit({ id: 'bot1', amount: 5, by: 'B', w: 'cannon' });
  host.sendHit({ id: 'A', amount: 9, by: 'H', w: 'missile' });
  await until(() => hits.B.length && hits.H.length && hits.A.length);
  assert.deepEqual(hits, { H: ['bot1'], A: ['A'], B: ['B'] });

  // Bob leaves: the others are told
  let left = null;
  a.on('left', (id) => { left = id; });
  b.close();
  await until(() => left === 'B');
  assert.ok(!host.players.has('B'));

  // The host leaves: the room is gone
  let closed = null;
  a.on('closed', (why) => { closed = why; });
  host.close();
  await until(() => closed);
  assert.ok(!sig.rooms.has(code));
});

test('a code that doesn\'t exist, and a race already under way, are turned away with a reason', async () => {
  const sig = fakeSignal();
  const c = new ClientSession({ name: 'Cy', cls: 'gunboat', sig, offer: fakeOffer });
  await assert.rejects(c.join('ZZZZ'), /no room ZZZZ/);
  const host = new HostSession({ name: 'H', cls: 'gunboat', sig, answer: fakeAnswer });
  const code = await host.open();
  host.start([]);
  await assert.rejects(new ClientSession({ name: 'Late', cls: 'gunboat', sig, offer: fakeOffer }).join(code), /already started/);
  host.close();
});
