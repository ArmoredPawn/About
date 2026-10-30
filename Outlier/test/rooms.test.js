import test from 'node:test';
import assert from 'node:assert/strict';
import { Rooms, cleanName, MAX_PLAYERS } from '../lib/rooms.js';
import { parsePrompt, keyMap, examples } from '../lib/prompts.js';

// A clock and timers the test moves by hand
function fakeTime() {
  let now = 1_000_000;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => now,
    timers: {
      set: (fn, ms) => { const id = ++seq; pending.set(id, { fn, at: now + ms }); return id; },
      clear: (id) => { pending.delete(id); },
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        pending.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = until;
    },
  };
}

function prompt(id) {
  const p = parsePrompt({
    id, pool: 'unlimited', prompt: `Name a ${id}`,
    answers: { common: ['Apple', 'Banana', 'Orange'], familiar: ['Mango', 'Kiwi'], uncommon: ['Lychee', 'Papaya'], rare: ['Durian'], outlier: ['Rambutan', 'Salak|snake fruit'] },
  });
  return { id: p.id, text: p.text, keys: keyMap(p), examples: examples(p) };
}

function setup({ prompts = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'] } = {}) {
  const time = fakeTime();
  const list = prompts.map(prompt);
  const content = { ready: true, pool: () => list };
  const rooms = new Rooms({ content, now: time.now, timers: time.timers, random: Math.random, today: () => '2026-10-30' });
  const connect = () => {
    const c = { inbox: [], closed: false };
    c.session = rooms.connect({ send: (m) => c.inbox.push(m), close: () => { c.closed = true; } });
    c.send = (m) => c.session.message(JSON.stringify(m));
    c.last = (type) => c.inbox.filter((m) => m.type === type).at(-1);
    c.state = () => c.last('state');
    return c;
  };
  return { rooms, time, connect };
}

function room(t, n) {
  const host = t.connect();
  host.send({ type: 'create', name: 'Host' });
  const code = host.last('joined').code;
  const others = Array.from({ length: n - 1 }, (_, i) => {
    const c = t.connect();
    c.send({ type: 'join', code, name: `P${i + 1}` });
    return c;
  });
  return { host, others, code, all: [host, ...others] };
}

test('a full game: answers are scored on the server and the round ends when everyone has answered', () => {
  const t = setup();
  const { host, others, code } = room(t, 3);
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  assert.equal(host.state().players.length, 3);
  assert.equal(host.state().hostId, host.last('joined').you);

  others[0].send({ type: 'start' });
  assert.equal(host.state().phase, 'lobby', 'only the host can start');
  host.send({ type: 'settings', rounds: 5, seconds: 15 });
  host.send({ type: 'start' });
  let s = host.state();
  assert.equal(s.phase, 'question');
  assert.equal(s.rounds, 5);
  assert.equal(s.remainingMs, 15_000);

  host.send({ type: 'answer', text: 'Carrot' });
  assert.deepEqual(host.last('guess'), { type: 'guess', ok: false, reason: 'not-on-list', text: 'Carrot' });
  t.time.advance(500);
  host.send({ type: 'answer', text: 'snake fruits' });
  assert.equal(host.last('guess').answer.name, 'Salak');
  assert.equal(host.last('guess').answer.points, 100);
  // Others see that the host answered, but not what
  const seen = others[0].state().players.find((p) => p.name === 'Host');
  assert.equal(seen.answered, true);
  assert.equal(seen.answer, null);

  host.send({ type: 'answer', text: 'Apple' });
  assert.equal(host.state().players.find((p) => p.name === 'Host').score, 100, 'one answer per round');

  others[0].send({ type: 'answer', text: 'apples' });
  others[1].send({ type: 'answer', text: 'Durian' });
  s = host.state();
  assert.equal(s.phase, 'results');
  assert.deepEqual(s.players.map((p) => p.answer.points), [100, 10, 75]);
  assert.equal(s.examples[0].name, 'Rambutan');

  t.time.advance(8000);
  assert.equal(host.state().phase, 'question');
  assert.equal(host.state().round, 2);

  // Nobody answers: the clock runs out (plus the grace period) and the round still ends
  for (let r = 2; r <= 5; r++) t.time.advance(15_600 + 8000);
  s = host.state();
  assert.equal(s.phase, 'final');
  assert.deepEqual(s.players.map((p) => p.score), [100, 10, 75]);

  host.send({ type: 'again' });
  assert.equal(host.state().phase, 'lobby');
  assert.deepEqual(host.state().players.map((p) => p.score), [0, 0, 0]);
});

test('late answers past the grace period are ignored', () => {
  const t = setup();
  const { host, others } = room(t, 2);
  host.send({ type: 'start' });
  t.time.advance(20_000 + 599);
  host.send({ type: 'answer', text: 'Kiwi' });
  assert.equal(host.last('guess').ok, true, 'just inside the grace period');
  t.time.advance(2);
  others[0].send({ type: 'answer', text: 'Kiwi' });
  assert.equal(others[0].last('guess'), undefined);
  assert.equal(host.state().phase, 'results');
});

test('rooms hold at most 10 players and names are unique', () => {
  const t = setup();
  const { code } = room(t, MAX_PLAYERS);
  const late = t.connect();
  late.send({ type: 'join', code, name: 'Eleven' });
  assert.equal(late.last('error').code, 'full');

  const t2 = setup();
  const r = room(t2, 2);
  const dup = t2.connect();
  dup.send({ type: 'join', code: r.code.toLowerCase(), name: ' host ' });
  assert.equal(dup.last('error').code, 'name-taken');
  dup.send({ type: 'join', code: 'ZZZZ', name: 'X' });
  assert.equal(dup.last('error').code, 'no-room');
});

test('a dropped player can resume, and the host role moves on', () => {
  const t = setup();
  const { host, others, code } = room(t, 3);
  const { token, you } = host.last('joined');
  host.send({ type: 'start' });
  host.send({ type: 'answer', text: 'Mango' });
  host.session.close();

  let s = others[0].state();
  assert.equal(s.players.find((p) => p.id === you).connected, false);
  assert.notEqual(s.hostId, you, 'host moved to a connected player');

  // The two still connected answer, so the round ends without waiting for the dropped host
  others[0].send({ type: 'answer', text: 'Kiwi' });
  others[1].send({ type: 'answer', text: 'Apple' });
  assert.equal(others[0].state().phase, 'results');

  const back = t.connect();
  back.send({ type: 'resume', code, token });
  assert.equal(back.last('joined').you, you);
  s = back.state();
  assert.equal(s.players.find((p) => p.id === you).score, 25, 'score kept');
  assert.equal(s.players.find((p) => p.id === you).connected, true);

  const stranger = t.connect();
  stranger.send({ type: 'resume', code, token: 'nope' });
  assert.equal(stranger.last('error').code, 'resume-failed');
});

test('lobby players who drop are removed, and empty rooms close', () => {
  const t = setup();
  const { host, others } = room(t, 2);
  others[0].session.close();
  assert.equal(host.state().players.length, 2);
  t.time.advance(30_000);
  assert.equal(host.state().players.length, 1);

  host.session.close();
  assert.equal(t.rooms.stats.rooms, 1);
  t.time.advance(5 * 60_000);
  assert.equal(t.rooms.stats.rooms, 0);
});

test('leaving hands the host role over and the last one out closes the room', () => {
  const t = setup();
  const { host, others } = room(t, 2);
  host.send({ type: 'leave' });
  assert.equal(others[0].state().hostId, others[0].last('joined').you);
  others[0].send({ type: 'leave' });
  assert.equal(t.rooms.stats.rooms, 0);
});

test('a room avoids repeating prompts until it has used them all', () => {
  const t = setup({ prompts: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'] });
  const { host } = room(t, 1);
  host.send({ type: 'settings', rounds: 5, seconds: 15 });
  const seen = [];
  for (let game = 0; game < 2; game++) {
    host.send({ type: 'start' });
    for (let r = 0; r < 5; r++) {
      seen.push(host.state().prompt);
      t.time.advance(15_600 + 8000);
    }
    host.send({ type: 'again' });
  }
  assert.equal(new Set(seen).size, 10);
});

test('flooding the server closes the connection', () => {
  const t = setup();
  const c = t.connect();
  for (let i = 0; i < 41; i++) c.send({ type: 'noop' });
  assert.equal(c.closed, true);
});

test('cleanName trims, collapses spaces and caps length', () => {
  assert.equal(cleanName('  Ayush \n  S  '), 'Ayush S');
  assert.equal(cleanName('x'.repeat(30)).length, 16);
  assert.equal(cleanName('\u0000\u0007'), '');
  assert.equal(cleanName(undefined), '');
});
