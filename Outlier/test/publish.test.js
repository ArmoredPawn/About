import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DirStore } from '../lib/store.js';
import { parseAll } from '../lib/prompts.js';
import { publish } from '../lib/publish.js';
import { dayStartMs, hashKey, normalize } from '../public/js/shared.js';

const answers = { common: ['A1', 'A2', 'A3'], familiar: ['B1', 'B2'], uncommon: ['C1', 'C2'], rare: ['D1'], outlier: ['E1', 'E2'] };
const make = (id, pool) => ({ id, pool, prompt: `Name a ${id}`, answers });
const prompts = (list) => parseAll([{ name: 'test.json', data: list }]);

test('publish writes daily, unlimited and server documents, and re-runs safely', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'outlier-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new DirStore(dir);

  const day1 = Date.parse('2026-10-30T15:00:00Z');
  const first = [...Array.from({ length: 11 }, (_, i) => make(`d${i + 1}`, 'daily')), make('u1', 'unlimited'), make('u2', 'unlimited')];
  const r1 = await publish({ prompts: prompts(first), store, now: day1 });
  assert.equal(r1.lastDay, '2026-10-31');
  assert.equal(r1.spare, 1);

  const today = await store.readRaw('daily/2026-10-30');
  assert.equal(today.opensAt, dayStartMs('2026-10-30'));
  assert.deepEqual(today.payload.prompts.map((p) => p.id), ['d1', 'd2', 'd3', 'd4', 'd5']);
  const p = today.payload.prompts[0];
  assert.equal(p.keys[await hashKey(p.salt, normalize('e1'))], 4);
  assert.ok(!JSON.stringify(today).includes('"A1"'), 'answer names are not in the browser copy');

  assert.deepEqual((await store.read('meta/public')).unlimited, ['u1', 'u2']);
  assert.equal((await store.read('answerKeys/d1')).answers.length, 10);
  assert.equal((await store.read('meta/server')).version, day1);

  // Next day: d7 deleted (it was on 10-31, which is now today and stays), u2 moved to daily, four new
  const day2 = Date.parse('2026-10-31T15:00:00Z');
  const second = [...first.filter((x) => x.id !== 'd7' && x.id !== 'u2'), make('u2', 'daily'),
    ...['n1', 'n2', 'n3'].map((id) => make(id, 'daily'))];
  const r2 = await publish({ prompts: prompts(second), store, now: day2 });
  const server = await store.read('meta/server');
  assert.deepEqual(server.schedule['2026-10-30'], ['d1', 'd2', 'd3', 'd4', 'd5']);
  assert.deepEqual(server.schedule['2026-10-31'], ['d6', 'd7', 'd8', 'd9', 'd10']);
  assert.deepEqual(server.schedule['2026-11-01'], ['d11', 'u2', 'n1', 'n2', 'n3']);
  assert.deepEqual(r2.kept, ['2026-10-31'], 'today keeps its published document because d7 is gone');
  assert.equal(await store.read('answerKeys/d7'), null);
  assert.equal(await store.read('unlimited/u2'), null);
  assert.deepEqual((await store.read('meta/public')).unlimited, ['u1']);
  assert.ok(await store.read('daily/2026-10-31'), 'today is still there');
});
