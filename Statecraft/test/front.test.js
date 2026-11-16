// Armies holding the line stay on it, and every country has its towns as well as its great cities.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { createArmy, orderArmy, capture } from '../public/js/engine/military.js';
import { startWar } from '../public/js/engine/diplomacy.js';
import { CITIES } from '../public/js/engine/data/cities.js';
import { COUNTRIES } from '../public/js/engine/data/countries.js';
import { citiesIn } from '../public/js/engine/cities.js';

function game(seed = 1, leader = 'usa') {
  const g = Game.create({ seed });
  g.setLeader(leader, 'Tester');
  return g;
}
const steps = (g, n) => { for (let i = 0; i < n; i++) g.step(0.125); };
const army = (s, owner, region, troops = 40) => {
  assert.equal(createArmy(s, s.countries[owner], { region, troops }), null);
  return Object.values(s.armies).filter((a) => a.owner === owner && a.region === region).at(-1);
};

test('a computer-run army behind the line moves up to the front', () => {
  const g = game(11);
  const s = g.s;
  startWar(s, 'deu', 'pol');
  // Baden-Württemberg borders only countries Germany is at peace with
  const a = army(s, 'deu', 'deu-bw');
  steps(g, 3);
  assert.ok(['deu-be', 'deu-sx'].includes(a.op.target), `it heads for the Polish front (${a.op.target})`);
  assert.equal(a.op.kind, 'hold');
  assert.match(a.status, /Holding the line|On the march/);
});

test('a computer-run army goes to defend the province next door when it is attacked', () => {
  const g = game(12);
  const s = g.s;
  startWar(s, 'deu', 'pol');
  const attacker = army(s, 'deu', 'deu-sx', 120);
  assert.equal(orderArmy(s, s.countries.deu, attacker, { kind: 'attack', target: 'pol-lw', aggr: 'allout' }), null);
  // Silesia is not on the front with Germany, but Lower Silesia next to it is about to be
  const d = army(s, 'pol', 'pol-si');
  steps(g, 6);
  assert.ok(s.regions['pol-lw'].battle || s.regions['pol-lw'].ctrl === 'deu', 'the attack has begun');
  assert.equal(d.op.target, 'pol-lw', 'the defenders move to meet it');
});

test('defenders driven out fall back onto the new line, connected to home, and hold there', () => {
  const g = game(13);
  const s = g.s;
  startWar(s, 'deu', 'pol');
  const d = army(s, 'pol', 'pol-lw');
  d.op = { kind: 'hold', target: 'pol-lw', aggr: 'balanced' };
  capture(s, 'pol-lw', 'deu');
  assert.ok(['pol-si', 'pol-wp'].includes(d.region), `it falls back into Poland (${d.region})`);
  assert.equal(d.op.target, d.region, 'and holds the province it fell back to');
  assert.match(d.status, /Fell back/);
});

test("a leader's army stays where it is put, unless told to support the front", () => {
  const g = game(14, 'deu');
  const s = g.s;
  startWar(s, 'deu', 'pol');
  const a = army(s, 'deu', 'deu-bw');
  steps(g, 3);
  assert.equal(a.region, 'deu-bw');
  assert.ok(!a.path.length, 'it waits for orders');
  assert.equal(g.command('deu', { type: 'armyAssist', id: a.id, on: true }), null);
  steps(g, 3);
  assert.ok(['deu-be', 'deu-sx'].includes(a.op.target), `told to support the front, it moves up (${a.op.target})`);
});

test('every country has dozens of cities and towns', () => {
  const count = new Map();
  for (const [, region] of CITIES) count.set(region.split('-')[0], (count.get(region.split('-')[0]) ?? 0) + 1);
  for (const c of Object.values(COUNTRIES)) {
    if (c.id === 'sgp') continue; // a city-state
    assert.ok((count.get(c.id) ?? 0) >= 15, `${c.name} has ${count.get(c.id) ?? 0} cities`);
  }
  assert.ok(count.get('deu') >= 100 && count.get('gbr') >= 100 && count.get('fra') >= 100, 'the big European countries have over a hundred each');
  // The towns never take more of a province's output than its cities and towns could hold
  for (const [region] of new Map(CITIES.map((r) => [r[1], true]))) {
    const total = citiesIn(region, 5).reduce((t, c) => t + c.share, 0);
    assert.ok(total <= 0.9001, `${region}: ${total}`);
  }
});
