import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../lib/rooms.js';

function fakeTimers() {
  const list = new Map();
  let id = 0;
  return {
    set: (fn) => { list.set(++id, fn); return id; },
    clear: (i) => list.delete(i),
    every: () => ++id,
    stop: () => {},
    run() { for (const [i, fn] of [...list]) { list.delete(i); fn(); } },
  };
}

function client(rooms) {
  const inbox = [];
  const session = rooms.connect({ send: (m) => inbox.push(m), close: () => inbox.push({ type: 'closed' }) });
  return {
    inbox,
    send: (m) => session.message(JSON.stringify(m)),
    close: () => session.close(),
    last: (type) => inbox.filter((m) => m.type === type).at(-1),
  };
}

test('leaders create, join, start, and each gets a different country', () => {
  const timers = fakeTimers();
  const rooms = new Rooms({ timers, random: () => 0.5 });
  const a = client(rooms);
  a.send({ type: 'create', name: 'Ana' });
  const code = a.last('joined').code;
  const b = client(rooms);
  b.send({ type: 'join', code, name: 'Ben' });
  assert.equal(b.last('lobby').players.length, 2);
  b.send({ type: 'start' }); // not the host
  assert.equal(a.last('lobby').phase, 'lobby');
  a.send({ type: 'start' });
  const sa = a.last('state');
  const sb = b.last('state');
  assert.ok(sa.me && sb.me && sa.me !== sb.me);
  assert.equal(sa.countries[sb.me].human, 'Ben');
});

test('names must be unique and rooms hold at most 20 leaders', () => {
  const rooms = new Rooms({ timers: fakeTimers() });
  const a = client(rooms);
  a.send({ type: 'create', name: 'Host' });
  const code = a.last('joined').code;
  const dup = client(rooms);
  dup.send({ type: 'join', code, name: 'host' });
  assert.equal(dup.last('error').code, 'name-taken');
  for (let i = 0; i < 19; i++) client(rooms).send({ type: 'join', code, name: `P${i}` });
  const late = client(rooms);
  late.send({ type: 'join', code, name: 'Late' });
  assert.equal(late.last('error').code, 'full');
});

test('direct messages reach only the two leaders; group chats only their members', () => {
  const rooms = new Rooms({ timers: fakeTimers() });
  const [a, b, c] = [client(rooms), client(rooms), client(rooms)];
  a.send({ type: 'create', name: 'A' });
  const code = a.last('joined').code;
  b.send({ type: 'join', code, name: 'B' });
  c.send({ type: 'join', code, name: 'C' });
  a.send({ type: 'start' });
  const ids = [a, b, c].map((x) => x.last('state').me);
  a.send({ type: 'chat', to: ids[1], text: 'just us' });
  assert.equal(b.last('chat')?.msg.text, 'just us');
  assert.notEqual(c.last('chat')?.msg.text, 'just us');
  a.send({ type: 'group', name: 'Pact', members: [ids[2]] });
  const ch = c.last('channels').channels.find((x) => x.kind === 'group');
  assert.ok(ch, 'C sees the group');
  assert.ok(!b.last('channels')?.channels.some((x) => x.kind === 'group'), 'B does not');
});

test('a dropped leader can resume their country with their token', () => {
  const rooms = new Rooms({ timers: fakeTimers() });
  const a = client(rooms);
  a.send({ type: 'create', name: 'A' });
  const { code, token } = a.last('joined');
  a.send({ type: 'start' });
  const me = a.last('state').me;
  a.close();
  const again = client(rooms);
  again.send({ type: 'resume', code, token });
  assert.equal(again.last('state').me, me);
});

test('weekly updates carry only what changed in other countries since the last one', async () => {
  const { Game } = await import('../public/js/engine/game.js');
  const { countryChanges } = await import('../public/js/engine/room.js');
  const g = Game.create({ seed: 9 });
  g.setLeader('fra', 'Ana');
  const player = { conn: {}, cid: 'fra' };
  const first = countryChanges(player, g, g.view('fra').countries);
  assert.equal(Object.keys(first).length, Object.keys(g.s.countries).length, 'the first update has everyone');
  assert.equal(Object.keys(countryChanges(player, g, g.view('fra').countries)).length, 0, 'nothing changed, nothing sent');
  for (let i = 0; i < 3; i++) g.step(1 / 3);
  g.tick();
  const next = countryChanges(player, g, g.view('fra').countries);
  const fields = Object.values(next).reduce((t, c) => t + Object.keys(c).length, 0);
  const all = Object.values(first).reduce((t, c) => t + Object.keys(c).length, 0);
  assert.ok(fields < all / 5, `a week later only a few fields moved (${fields} of ${all})`);
  player.conn = {};
  assert.equal(Object.keys(countryChanges(player, g, g.view('fra').countries)).length, Object.keys(g.s.countries).length, 'a reconnect gets everyone again');
});
