// Armies holding the line stay on it, and every country has its towns as well as its great cities.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { createArmy, CONTACT, zocOf } from '../public/js/engine/military.js';
import { CELLS_OF, holderAt, neighbours4, isLand, cellX, cellY, dist } from '../public/js/engine/land.js';
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

// Our ground next to an enemy's: where the front is
const frontNear = (s, owner, enemy, x, y, r) => {
  for (const i of [...CELLS_OF['deu-be'], ...CELLS_OF['deu-sx'], ...CELLS_OF['deu-by'], ...CELLS_OF['deu-bw']]) {
    if (holderAt(s, i) !== owner || dist(cellX(i), cellY(i), x, y) > r) continue;
    if (neighbours4(i).some((j) => isLand(j) && holderAt(s, j) === enemy)) return true;
  }
  return false;
};

test('a computer-run country at war puts an army on its front line', () => {
  const g = game(11);
  const s = g.s;
  startWar(s, 'deu', 'pol');
  // Baden-Württemberg borders only countries Germany is at peace with
  const a = army(s, 'deu', 'deu-bw');
  g.tick();
  const at = a.op.at ?? [a.x, a.y];
  // To hold a stretch of the line, or (Germany being the stronger) to push on into Poland
  const ok = a.op.kind === 'advance' ? s.regions[a.op.target]?.owner === 'pol' : frontNear(s, 'deu', 'pol', at[0], at[1], CONTACT);
  assert.ok(ok, `it is sent to the Polish front (${a.op.kind} near ${a.op.target})`);
  assert.match(a.status, /Holding the line|On the march|Moving|Advancing/);
});

test('only an army that means to attack starts a battle: two armies at war can face each other for weeks', () => {
  const g = game(12);
  const s = g.s;
  startWar(s, 'deu', 'pol');
  const d = army(s, 'deu', 'deu-be', 60);
  const p = army(s, 'pol', 'pol-wp', 60);
  // Both told to hold, close enough to fight: a phoney war
  d.op = { kind: 'hold', target: d.region, at: [d.x, d.y], aggr: 'balanced' };
  p.op = { kind: 'hold', target: p.region, at: [p.x, p.y], aggr: 'balanced' };
  s.countries.deu.human = { name: 'Berlin' };
  s.countries.pol.human = { name: 'Warsaw' };
  steps(g, 8);
  assert.equal(Object.keys(s.battles ?? {}).length, 0, 'no battle without an attack');
  // One attacks: now they fight
  assert.equal(g.command('deu', { type: 'armyOrder', id: d.id, kind: 'attack', enemy: p.id }), null);
  for (let i = 0; i < 24 && !Object.keys(s.battles ?? {}).length; i++) { g.step(0.125); if ((s.stepped ?? 0) >= 0.999) g.tick(); }
  assert.ok(Object.values(s.battles).some((b) => b.def === p.id && b.att.includes(d.id)), 'the attack starts a battle');
});

test('land no army holds is marched through and taken; ground an army holds must be won in battle', () => {
  const g = game(13, 'deu');
  const s = g.s;
  startWar(s, 'deu', 'pol');
  const d = army(s, 'deu', 'deu-be', 120);
  assert.equal(g.command('deu', { type: 'armyOrder', id: d.id, kind: 'go', target: 'pol-wp' }), null);
  assert.equal(d.op.kind, 'advance');
  for (let i = 0; i < 24 && !Object.keys(s.battles ?? {}).length; i++) { g.step(0.125); if ((s.stepped ?? 0) >= 0.999) g.tick(); }
  const taken = [...CELLS_OF['pol-wp']].filter((i) => holderAt(s, i) === 'deu').length;
  assert.ok(taken > 5, `it takes the ground it crosses (${taken} cells of Pomerania)`);
  // A Polish army in the way holds the ground around it
  const p = army(s, 'pol', 'pol-wa', 80);
  const inZone = [...CELLS_OF['pol-wa']].filter((i) => dist(cellX(i), cellY(i), p.x, p.y) < zocOf(p) * 0.8);
  assert.ok(inZone.every((i) => holderAt(s, i) !== 'deu'), 'its zone is not simply walked into');
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
  steps(g, 6);
  const at = a.op.at ?? [a.x, a.y];
  assert.ok(frontNear(s, 'deu', 'pol', at[0], at[1], CONTACT * 1.6), `told to support the front, it moves up to the line (${a.op.target})`);
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
