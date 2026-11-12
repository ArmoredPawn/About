import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { COUNTRY_IDS, COUNTRIES } from '../public/js/engine/data/countries.js';
import { PROVINCES } from '../public/js/engine/data/regions.js';
import { GEO, ORDER } from '../public/js/engine/data/geo.js';
import { route } from '../public/js/engine/military.js';

function game(seed = 1, leader = 'usa') {
  const g = Game.create({ seed, years: 5 });
  g.setLeader(leader, 'Tester');
  return g;
}

test('the 50 playable countries all have provinces on the map', () => {
  assert.equal(COUNTRY_IDS.length, 50);
  for (const id of COUNTRY_IDS) {
    const provinces = PROVINCES.filter((p) => p.country === id);
    assert.ok(provinces.length >= 1, `${id} has provinces`);
    assert.equal(provinces.filter((p) => p.capital).length, 1, `${id} has one capital`);
    for (const p of provinces) assert.ok(GEO[p.id], `${p.id} is on the map`);
  }
  for (const id of ORDER) assert.ok(GEO[id].adj.length || GEO[id].coast, `${id} can be reached`);
});

test('real resources are where they should be', () => {
  const g = game();
  const r = g.s.regions;
  assert.ok(r['rus-ws'].res.oil[0] > 5, 'West Siberian oil');
  assert.ok(r['rus-ca'].res.oil, 'North Caucasus oil (Maykop, Grozny)');
  assert.ok(r['sau-ep'].res.oil[0] > 8, 'Ghawar');
  assert.ok(r['twn-ts'].res.chip[0] > 20, 'Taiwan chips');
  assert.ok(r['chn-im'].res.rare[0] > 100, 'Bayan Obo rare earths');
  assert.ok(r['kaz-sk'].res.uran[0] > 15, 'Kazakh uranium');
  assert.ok(r['chl-an'].res.metal[0] > 3, 'Atacama copper and lithium');
});

test('a quiet year keeps the economy and prices believable', () => {
  const g = game(3);
  for (let i = 0; i < 52; i++) g.tick();
  const { s } = g;
  for (const id of ['usa', 'chn', 'deu', 'ind', 'jpn']) {
    const c = s.countries[id];
    assert.ok(c.growth > -3 && c.growth < 10, `${id} growth ${c.growth}`);
    assert.ok(c.gdp > COUNTRIES[id].gdp * 0.9 && c.gdp < COUNTRIES[id].gdp * 1.15, `${id} gdp ${c.gdp}`);
  }
  for (const [r, p] of Object.entries(s.market.price)) assert.ok(p > 0.5 && p < 1.8, `${r} price ${p}`);
});

test('commands are checked: you cannot spend money you do not have or attack without a war', () => {
  const g = game(4, 'irq');
  assert.match(g.command('irq', { type: 'build', kind: 'carriers', batches: 1 }), /Carriers need/);
  assert.match(g.command('irq', { type: 'stimulus', amount: 1e9 }), /up to/);
  g.command('irq', { type: 'armyCreate', region: 'irq-bs', troops: 50, tanks: 100 });
  const army = Object.values(g.s.armies)[0];
  assert.ok(army, 'army formed');
  assert.match(g.command('irq', { type: 'armyOrder', id: army.id, kind: 'attack', target: 'm-kuwait' }), /not at war/);
  assert.match(g.command('usa', { type: 'armyDisband', id: army.id }), /not yours/);
});

test('invading Kuwait: the general advances, captures it and the world reacts', () => {
  const g = game(5, 'irq');
  assert.equal(g.command('irq', { type: 'war', target: 'm-kuwait' }), null);
  // The United States guarantees Kuwait and joins the war
  assert.ok(g.s.wars.some((w) => w.a === 'usa' && w.b === 'irq'), 'USA defends Kuwait');
  g.command('irq', { type: 'armyCreate', region: 'irq-bs', troops: 150, tanks: 300 });
  const army = Object.values(g.s.armies).find((a) => a.owner === 'irq');
  assert.equal(g.command('irq', { type: 'armyOrder', id: army.id, kind: 'attack', target: 'm-kuwait', aggr: 'allout' }), null);
  for (let i = 0; i < 20 && g.s.regions['m-kuwait'].ctrl !== 'irq'; i++) g.tick();
  assert.equal(g.s.regions['m-kuwait'].ctrl, 'irq', 'Kuwait captured');
  assert.ok(g.s.countries.irq.rep < COUNTRIES.irq.standing, 'standing fell');
});

test('peace treaties hand over provinces and end the war', () => {
  const g = game(6, 'ind');
  // No alliances exist at the start, but allies in the same alliance can't fight each other
  assert.equal(Object.keys(g.s.alliances).length, 0, 'no starting alliances');
  g.setLeader('kaz', 'Ally');
  const res = g.command('rus', { type: 'allianceCreate', name: 'Steppe Pact', kind: 'military', invite: ['kaz'] });
  const inv = Object.values(g.s.proposals).find((x) => x.kind === 'alliance' && x.to === 'kaz');
  assert.ok(inv, `invite sent (${res})`);
  assert.equal(g.command('kaz', { type: 'respond', id: inv.id, accept: true }), null);
  assert.match(g.command('rus', { type: 'war', target: 'kaz' }) ?? '', /Steppe Pact/);
  assert.equal(g.command('ind', { type: 'war', target: 'pak' }), null);
  g.s.regions['pak-gb'].ctrl = 'ind';
  const err = g.command('ind', { type: 'propose', to: 'pak', kind: 'peace', terms: { cede: [{ region: 'pak-gb', to: 'ind' }] } });
  assert.equal(err, null);
  const p = Object.values(g.s.proposals).find((x) => x.kind === 'peace');
  assert.equal(g.command('ind', { type: 'respond', id: p.id, accept: true }), 'That proposal is no longer open.', 'only the recipient can answer');
  g.setLeader('pak', 'Other');
  assert.equal(g.command('pak', { type: 'respond', id: p.id, accept: true }), null);
  assert.equal(g.s.regions['pak-gb'].owner, 'ind');
  assert.ok(!g.s.wars.some((w) => [w.a, w.b].includes('ind') && [w.a, w.b].includes('pak')), 'war over');
});

test('routes go through friendly ground and stop at neutral borders', () => {
  const g = game(7, 'deu');
  const path = route(g.s, 'deu', 'deu-by', 'deu-no', { offensive: false });
  assert.ok(path && path.at(-1) === 'deu-no');
  assert.equal(route(g.s, 'deu', 'deu-by', 'm-belarus', { offensive: false }), null, 'no peaceful route into Belarus');
});

test('a view never leaks another leader\'s secrets', () => {
  const g = game(8, 'usa');
  g.setLeader('chn', 'Rival');
  g.command('chn', { type: 'armyCreate', region: 'chn-fj', troops: 123, tanks: 0 });
  const v = g.view('usa');
  assert.equal(v.countries.chn.treasury, null);
  assert.equal(v.countries.chn.stability, null);
  const army = v.armies.find((a) => a.owner === 'chn');
  assert.equal(army.exact, false);
  assert.equal(army.path, undefined);
  assert.equal(v.you.id, 'usa');
});

test('the state survives a save and reload', () => {
  const g = game(9);
  for (let i = 0; i < 5; i++) g.tick();
  const copy = new Game(JSON.parse(JSON.stringify(g.s)));
  copy.tick();
  g.tick();
  assert.equal(copy.s.week, g.s.week);
  assert.equal(Math.round(copy.s.countries.usa.gdp), Math.round(g.s.countries.usa.gdp));
});
