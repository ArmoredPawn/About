import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { COUNTRY_IDS, COUNTRIES } from '../public/js/engine/data/countries.js';
import { PROVINCES } from '../public/js/engine/data/regions.js';
import { GEO, ORDER } from '../public/js/engine/data/geo.js';
import { route, freeForces, bury } from '../public/js/engine/military.js';
import { rel, setRel } from '../public/js/engine/core.js';
import { shipAt } from '../public/js/engine/shipping.js';

// A war now needs a case prepared in advance (in secret, about 45 seconds); the tests skip the wait
function justify(g, a, b) {
  const c = (g.s ?? g).countries[a];
  c.warCases = { ...(c.warCases ?? {}), [b]: { ready: 0, until: 99999, since: 0 } };
}

function game(seed = 1, leader = 'usa') {
  const g = Game.create({ seed });
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
  justify(g, 'irq', 'm-kuwait');
  assert.equal(g.command('irq', { type: 'war', target: 'm-kuwait' }), null);
  // Kuwait is a country the computer runs, with an army of its own, but no one is bound to defend it at the start
  assert.ok(g.s.countries['m-kuwait'] && !g.s.countries['m-kuwait'].human, 'Kuwait is computer-run');
  assert.equal(g.s.countries['m-kuwait'].minor, true, 'and not playable');
  assert.ok(!g.s.wars.some((w) => w.a === 'usa' && w.b === 'irq'), 'no guarantees at the start');
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
  // Declaring war on a fellow member leaves the alliance in the same step
  justify(g, 'rus', 'kaz');
  assert.equal(g.command('rus', { type: 'war', target: 'kaz' }), null);
  assert.ok(g.s.wars.some((w) => w.a === 'rus' && w.b === 'kaz'), 'at war');
  assert.ok(!Object.values(g.s.alliances).some((al) => al.members.includes('rus') && al.members.includes('kaz')), 'pact left');
  justify(g, 'ind', 'pak');
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
  // Every army is on the map, but without spies only roughly and without its plans
  const seen = v.armies.find((a) => a.owner === 'chn');
  assert.equal(seen.exact, false);
  assert.equal(seen.path, undefined);
  assert.equal(seen.status, undefined);
  assert.equal(v.you.id, 'usa');
  // A spy network deep enough inside shows it exactly
  g.s.countries.usa.intel.chn = g.s.week + 5;
  assert.equal(g.view('usa').armies.find((a) => a.owner === 'chn').exact, true);
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

test('drafting: an army bigger than the forces at home calls up reservists', () => {
  const g = game(10, 'deu');
  const c = g.s.countries.deu;
  const free = freeForces(g.s, c);
  const before = { troops: c.troops, reserves: c.reserves };
  const want = Math.floor(free.troops) + 20;
  assert.equal(g.command('deu', { type: 'armyCreate', region: 'deu-be', troops: want, tanks: 0 }), null);
  assert.equal(Math.round(c.troops - before.troops), 20, 'troops grow by the draft');
  assert.equal(Math.round(before.reserves - c.reserves), 20, 'reserves shrink by the draft');
  const army = Object.values(g.s.armies).find((a) => a.owner === 'deu');
  assert.equal(army.troops, want);
  assert.match(g.command('deu', { type: 'armyCreate', region: 'deu-be', troops: c.reserves + 9999, tanks: 0 }), /reservists can be drafted/);
  // Mobilising afterwards can't pull reservists that are already gone
  g.command('deu', { type: 'mobilize', level: 2 });
  for (let i = 0; i < 30; i++) g.tick();
  assert.ok(c.reserves >= -0.001, `reserves ${c.reserves}`);
});

test('one click: attacking a country we are allied with declares war, leaves the alliance and attacks', () => {
  const g = game(11, 'tur');
  g.setLeader('irq', 'Neighbour');
  g.command('tur', { type: 'allianceCreate', name: 'Tigris Pact', kind: 'military', invite: ['irq'] });
  const inv = Object.values(g.s.proposals).find((x) => x.kind === 'alliance' && x.to === 'irq');
  assert.equal(g.command('irq', { type: 'respond', id: inv.id, accept: true }), null);
  g.command('tur', { type: 'armyCreate', region: 'tur-se', troops: 150, tanks: 300 });
  const army = Object.values(g.s.armies).find((a) => a.owner === 'tur');
  // Without "declare" the order is refused and nothing changes
  assert.match(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'attack', target: 'irq-ms' }), /not at war/);
  assert.equal(g.s.wars.length, 0);
  // A landing on a landlocked province is refused before any war starts
  justify(g, 'tur', g.s.regions['irq-ms'].ctrl);
  assert.match(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'invade', target: 'irq-ms', declare: true }), /landlocked|port/);
  assert.equal(g.s.wars.length, 0, 'an impossible attack does not start a war');
  justify(g, 'tur', g.s.regions['irq-ms'].ctrl);
  assert.equal(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'attack', target: 'irq-ms', declare: true, aggr: 'allout' }), null);
  assert.ok(g.s.wars.some((w) => w.a === 'tur' && w.b === 'irq'), 'war declared');
  for (let i = 0; i < 20 && g.s.regions['irq-ms'].ctrl !== 'tur'; i++) g.tick();
  assert.equal(g.s.regions['irq-ms'].ctrl, 'tur', 'Mosul taken');
});

test('empty deserts are their own provinces, worth little next to the oil fields', () => {
  const g = game(12, 'usa');
  const r = g.s.regions;
  for (const [desert, prize] of [['irn-ds', 'irn-kh'], ['sau-eq', 'sau-ep'], ['aus-ob', 'aus-wa'], ['ind-th', 'ind-gj'], ['arg-sp', 'arg-pt']]) {
    assert.ok(r[desert], `${desert} exists`);
    assert.ok(r[desert].gdp < r[prize].gdp / 5, `${desert} is worth far less than ${prize}`);
    assert.ok(GEO[desert].area > 200, `${desert} has real land`);
  }
  assert.equal(Object.keys(r['sau-eq'].res).length, 0, 'nothing to extract in the Empty Quarter');
  assert.ok(r['sau-ep'].res.oil[0] > 8, 'Ghawar stays in the Eastern Province');
});

/* ---------- Government, the market, spies, range and fog of war ---------- */

test('a draft with no reason brings protests; a nation under attack accepts it', () => {
  const g = game(21, 'deu');
  g.setLeader('pol', 'Defender');
  g.setLeader('rus', 'Aggressor');
  g.tick();
  justify(g, 'rus', 'pol');
  assert.equal(g.command('rus', { type: 'war', target: 'pol' }), null);
  assert.equal(g.command('deu', { type: 'conscription', level: 'national' }), null);
  assert.equal(g.command('pol', { type: 'conscription', level: 'national' }), null);
  const deuApproval = g.s.countries.deu.approval;
  for (let i = 0; i < 10; i++) g.tick();
  const draftProtest = (id) => g.s.countries[id].protests.find((p) => p.cause === 'draft')?.size ?? 0;
  assert.ok(draftProtest('deu') > 15, `Germans protest the draft (${draftProtest('deu')})`);
  assert.ok(draftProtest('pol') < 5, `Poles under attack accept it (${draftProtest('pol')})`);
  assert.ok(g.s.countries.deu.approval < deuApproval, 'German approval falls');
  assert.ok(g.s.countries.deu.troops > COUNTRIES.deu.troops + 50, 'conscripts arrive');
});

test('an invaded computer-run country calls up its people and drafts reservists', () => {
  const g = game(22, 'rus');
  const k = g.s.countries.kaz;
  const troops = k.troops;
  justify(g, 'rus', 'kaz');
  assert.equal(g.command('rus', { type: 'war', target: 'kaz' }), null);
  for (let i = 0; i < 8; i++) g.tick();
  assert.ok(k.mob >= 1, 'mobilised');
  assert.notEqual(k.conscription, k.base.conscription, 'conscription raised');
  assert.ok(k.troops > troops * 1.3, `more soldiers (${Math.round(troops)}K → ${Math.round(k.troops)}K)`);
});

test('a purchase ships the cargo; it is delivered, or stopped with both sides told who did it', () => {
  let stopped = 0;
  let delivered = 0;
  for (let seed = 30; seed < 36; seed++) {
    const g = game(seed, 'jpn');
    g.setLeader('chn', 'Raider');
    g.tick();
    const seller = g.view('jpn').market.sellers.oil.find((x) => !x.covert && x.route?.mode === 'sea');
    assert.ok(seller, 'someone sells oil to Japan by sea');
    const before = g.s.countries.jpn.treasury;
    assert.equal(g.command('jpn', { type: 'marketBuy', res: 'oil', qty: 3, from: seller.id }), null);
    assert.ok(g.s.countries.jpn.treasury < before, 'paid up front');
    const sh = g.s.shipments.find((x) => x.buyer === 'jpn');
    // A Chinese squadron waits off Japan's coast and is sent after it
    g.step(0.125);
    const fleet = Object.values(g.s.fleets).find((f) => f.owner === 'chn');
    const [x, y] = shipAt(g.s, sh, 0.85);
    Object.assign(fleet, { x, y, route: [], ships: 30, org: 90 });
    for (const f of Object.values(g.s.fleets)) if (f.owner === 'jpn') { f.x = 5; f.y = 5; }
    // Before sending it, China sees how soon this fleet meets the cargo and its odds
    const seen = g.view('chn').shipments.find((x) => x.id === sh.id);
    const option = seen.hunt.find((o) => o.fleet === fleet.id);
    assert.ok(option.weeks > 0 && option.seize > 0 && option.sink >= option.seize, 'odds are shown, sinking surer than seizing');
    assert.equal(g.command('chn', { type: 'intercept', id: sh.id, fleet: fleet.id, how: 'seize' }), null);
    const hunted = g.view('chn').shipments.find((x) => x.id === sh.id);
    assert.equal(hunted.hunter.fleet, fleet.id, 'the cargo shows who is after it');
    assert.match(fleet.status, /Lying in wait|Sailing to seize/);
    for (let i = 0; i < 10 * 8 && !sh.done; i++) { g.step(0.125); if ((g.s.stepped ?? 0) >= 0.999) g.tick(); }
    if (sh.done && sh.left > 0) {
      stopped++;
      if (g.s.countries[seller.id]) assert.ok(g.s.countries[seller.id].inbox.some((m) => /China stopped your shipment of oil to Japan/.test(m.text)), 'the seller is told');
      assert.ok(g.s.countries.jpn.inbox.some((m) => /China stopped the shipment of oil/.test(m.text)), 'the buyer is told');
    } else {
      for (let i = 0; i < 8 && !sh.done; i++) g.tick();
      if (sh.done) delivered++;
    }
  }
  assert.ok(stopped > 0, 'some cargoes are stopped');
  assert.ok(stopped + delivered === 6, 'every cargo is either delivered or stopped');
});

test('spies, once settled in, report armies on the move and reveal them on the map', () => {
  const g = game(23, 'usa');
  g.setLeader('chn', 'Rival');
  g.s.countries.chn.counterIntel = 0;
  assert.equal(g.command('usa', { type: 'spyPlant', target: 'chn', agents: 12 }), null);
  g.command('chn', { type: 'armyCreate', region: 'chn-fj', troops: 150, tanks: 0 });
  const army = Object.values(g.s.armies).find((a) => a.owner === 'chn');
  g.command('chn', { type: 'armyOrder', id: army.id, kind: 'hold', target: 'chn-gd' });
  for (let i = 0; i < 7; i++) g.tick();
  const usa = g.s.countries.usa;
  assert.ok(usa.reports.some((r) => r.about === 'chn'), 'reports arrive');
  if (usa.spies.chn) assert.ok(g.view('usa').armies.some((a) => a.owner === 'chn'), 'their armies show on our map');
});

test('aircraft and missiles only reach so far from a base', () => {
  const g = game(24, 'irn');
  g.setLeader('usa', 'Far');
  justify(g, 'irn', 'usa');
  assert.equal(g.command('irn', { type: 'war', target: 'usa' }), null);
  const err = g.command('irn', { type: 'air', region: 'usa-ma', aircraft: 10 });
  assert.match(err, /km from our nearest base/);
  assert.equal(g.command('irn', { type: 'range', kind: 'air' }), null, 'range can be extended');
});

test('secret alliances are hidden from outsiders', () => {
  const g = game(25, 'pak');
  assert.equal(g.command('pak', { type: 'allianceCreate', name: 'Quiet Pact', kind: 'military', secret: true }), null);
  g.setLeader('ind', 'Outsider');
  assert.ok(g.view('pak').alliances.some((a) => a.name === 'Quiet Pact'));
  assert.ok(!g.view('ind').alliances.some((a) => a.name === 'Quiet Pact'));
  assert.ok(!g.s.news.some((n) => /Quiet Pact/.test(n.text)), 'no public news of it');
});

test('soldiers killed in battle come off the population; conquered people join the conqueror', () => {
  const g = game(26, 'rus');
  const pop = g.s.countries.rus.pop;
  bury(g.s, 'rus', 1000);
  const homes = Object.values(g.s.regions).filter((r) => r.owner === 'rus').reduce((t, r) => t + r.pop, 0);
  assert.ok(Math.abs(homes - (pop - 0.35)) < 0.05, 'a thousand thousand casualties, 350,000 dead');
  const ukr = g.s.regions['m-ukraine'];
  ukr.ctrl = 'rus';
  g.tick();
  assert.ok(g.s.countries.rus.pop > homes + ukr.pop * 0.9, 'Ukraine\'s people are counted under Russian rule');
});

test('a leader\'s order goes at once: one click sends the army, and it attacks without waiting to regroup', () => {
  const g = game(21, 'tur');
  g.command('tur', { type: 'armyCreate', region: 'tur-se', troops: 120, tanks: 200 });
  const army = Object.values(g.s.armies).find((a) => a.owner === 'tur');
  // A friendly province: it just marches
  assert.equal(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'go', target: 'tur-ea' }), null);
  assert.equal(army.op.kind, 'hold');
  // An enemy province: war is declared and it attacks, even badly disorganised
  justify(g, 'tur', g.s.regions['irq-ms'].ctrl);
  assert.equal(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'go', target: 'irq-ms', declare: true }), null);
  assert.ok(g.s.wars.some((w) => w.a === 'tur' && w.b === 'irq'), 'war declared');
  assert.equal(army.op.kind, 'attack');
  army.org = 5;
  let attacked = false;
  for (let i = 0; i < 4 && !attacked; i++) { g.tick(); attacked = Boolean(army.attacking) || g.s.regions['irq-ms'].ctrl === 'tur'; }
  assert.ok(attacked, `attacked at once (status: ${army.status})`);
});

test('a war fought on a prepared case is one the public accepts', () => {
  const g = game(22, 'deu');
  const c = g.s.countries.deu;
  assert.equal(g.command('deu', { type: 'warCase', target: 'pol' }), null);
  for (let i = 0; i < 6; i++) { for (let k = 0; k < 8; k++) g.step(0.125); g.tick(); }
  assert.equal(g.command('deu', { type: 'war', target: 'pol' }), null);
  const war = g.s.wars.find((w) => w.a === 'deu' && w.b === 'pol');
  assert.equal(war.justified, 'deu');
  for (let i = 0; i < 20; i++) g.tick();
  assert.ok((c.protests.find((p) => p.cause === 'war')?.size ?? 0) < 40, 'no mass anti-war movement');
});

test('armies march at the speed their research, industry and tanks allow, in real time', () => {
  // Seconds (at normal speed, 9 a week) for a Turkish army to cross from the southeast to Istanbul
  const crossing = (tech, tanks) => {
    const g = game(23, 'tur');
    const c = g.s.countries.tur;
    c.tech.army = tech;
    c.tech.industry = tech;
    c.tanks = Math.max(c.tanks, tanks);
    g.command('tur', { type: 'armyCreate', region: 'tur-se', troops: 120, tanks });
    const army = Object.values(g.s.armies).find((a) => a.owner === 'tur');
    assert.equal(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'go', target: 'tur-is' }), null);
    const second = 1 / 9;
    for (let i = 1; i <= 120; i++) {
      g.step(second);
      if (i % 9 === 0) g.tick();
      if (army.region === 'tur-is') return i;
    }
    return Infinity;
  };
  const advanced = crossing(10, 400);
  const backward = crossing(4, 0);
  assert.ok(advanced > 6, `no more lightning marches (${advanced}s)`);
  assert.ok(advanced <= 40, `a modern mechanised army still crosses Turkey in under a minute (${advanced}s)`);
  assert.ok(backward > advanced * 2, `low-tech infantry is much slower (${backward}s vs ${advanced}s)`);
  // Steps never run ahead of the weekly clock
  const g = game(23, 'tur');
  for (let i = 0; i < 30; i++) g.step(1 / 9);
  assert.ok(g.s.stepped <= 1 + 1e-9);
  g.tick();
  assert.equal(g.s.stepped, 0);
});

test('there is no time limit: the game ends only when one country owns the whole world', () => {
  const g = game(31);
  g.s.week = 52 * 100;
  g.tick();
  assert.equal(g.s.over, false, 'still going after a century');
  // Even with no human leader left alive, the world keeps turning
  g.setLeader('usa', null);
  g.tick();
  assert.equal(g.s.over, false, 'still going with no human leaders');
  for (const reg of Object.values(g.s.regions)) { reg.owner = 'usa'; reg.ctrl = 'usa'; }
  g.tick();
  assert.equal(g.s.over, true);
  assert.equal(g.s.winner, 'usa');
  assert.equal(g.view('usa').winner, 'usa');
});

test('declaring war costs no money, even after making the case for it', () => {
  const g = game(37);
  const c = g.s.countries.usa;
  c.treasury = 0;
  assert.equal(g.command('usa', { type: 'warCase', target: 'mex' }), null);
  justify(g, 'usa', 'mex');
  assert.equal(g.command('usa', { type: 'war', target: 'mex', goal: 'conquest' }), null);
  assert.equal(c.treasury, 0);
});

test('every army is on every map, and a failing attack is explained in the news', () => {
  const g = game(41, 'ind');
  g.setLeader('fra', 'Watcher');
  const s = g.s;
  g.command('pak', { type: 'armyCreate', region: 'pak-kr', troops: 150, tanks: 100 });
  const seen = g.view('fra').armies.find((a) => a.owner === 'pak');
  assert.ok(seen, 'a far-away country sees the army');
  assert.equal(seen.exact, false, 'in rough figures');
  g.command('ind', { type: 'armyCreate', region: 'ind-gj', troops: 60, tanks: 50 });
  const a = Object.values(s.armies).find((x) => x.owner === 'ind');
  justify(g, 'ind', g.s.regions['pak-kr'].ctrl);
  assert.equal(g.command('ind', { type: 'armyOrder', id: a.id, kind: 'go', target: 'pak-kr', declare: true }), null);
  s.fresh = [];
  for (let i = 0; i < 9; i++) g.step(1 / 9);
  assert.match(a.status, /Thrown back at Karachi/);
  assert.ok(s.fresh.some((f) => f.type === 'news' && /throws back India's attack on Karachi/.test(f.text)), 'world news');
  const report = s.countries.ind.inbox.find((m) => /being thrown back/.test(m.text));
  assert.ok(report?.front, 'a front report for the attacker');
  assert.match(report.text, /Pakistan's .* \(~\d+K\)/, 'naming the army in the way');
});

test('numbers count: a tired, hungry 3M army still beats 1M on open ground and is not pushed back by it', () => {
  const setup = () => {
    const g = game(7, 'rus');
    const s = g.s;
    s.countries.rus.troops = 3300;
    s.countries.kaz.troops = 1100;
    g.command('rus', { type: 'armyCreate', region: 'rus-ur', troops: 3000, tanks: 2000 });
    g.command('kaz', { type: 'armyCreate', region: 'kaz-at', troops: 1000, tanks: 0 });
    s.countries.rus.short = { oil: 1 };
    return { g, s, r: Object.values(s.armies).find((x) => x.owner === 'rus'), k: Object.values(s.armies).find((x) => x.owner === 'kaz') };
  };
  // Worn out (organisation 15) and out of oil, the big army still takes the province
  {
    const { g, s, r } = setup();
    justify(g, 'rus', g.s.regions['kaz-at'].ctrl);
    assert.equal(g.command('rus', { type: 'armyOrder', id: r.id, kind: 'go', target: 'kaz-at', declare: true }), null);
    for (let w = 0; w < 6 && s.regions['kaz-at'].ctrl !== 'rus'; w++) { for (let i = 0; i < 9; i++) { r.org = Math.min(r.org, 15); g.step(1 / 9); } g.tick(); }
    assert.equal(s.regions['kaz-at'].ctrl, 'rus');
  }
  // And a fresh 1M attacking it gets nowhere
  {
    const { g, s, r, k } = setup();
    justify(g, 'rus', 'kaz');
    g.command('rus', { type: 'war', target: 'kaz', goal: 'conquest' });
    g.command('kaz', { type: 'armyOrder', id: k.id, kind: 'go', target: 'rus-ur' });
    k.op.kind = 'attack';
    for (let w = 0; w < 6; w++) { for (let i = 0; i < 9; i++) { r.org = 15; g.step(1 / 9); } g.tick(); }
    assert.equal(s.regions['rus-ur'].ctrl, 'rus');
  }
});

/* ---------- Navies ---------- */

test('navies are fleets on the map: patrols, blockades and sea battles come from where they are', async () => {
  const { declareWar } = await import('../public/js/engine/diplomacy.js');
  const g = game(4, 'gbr');
  const s = g.s;
  assert.ok(Object.values(s.fleets).some((f) => f.owner === 'usa' && f.at === 'atl'), 'the US Atlantic Fleet');
  assert.ok(Object.values(s.fleets).every((f) => Number.isFinite(f.x) && Number.isFinite(f.y)), 'every fleet is at an exact point');
  assert.ok(!Object.values(s.fleets).some((f) => f.owner === 'che'), 'landlocked Switzerland has no navy');
  const f = Object.values(s.fleets).find((x) => x.owner === 'gbr');
  assert.match(g.command('gbr', { type: 'fleetOrder', id: f.id, mission: 'blockade', target: 'fra' }), /not at war/);
  assert.equal(g.command('gbr', { type: 'fleetOrder', id: f.id, to: 'gibraltar', mission: 'patrol', mode: 'escort' }), null);
  assert.equal(s.chokepoints.gibraltar.patrols.gbr, undefined, 'not there yet');
  for (let i = 0; i < 90 && f.route.length; i++) { g.step(1 / 9); if (i % 9 === 8) g.tick(); }
  assert.equal(f.at, 'gibraltar', 'sailed round Spain into the strait');
  assert.equal(s.chokepoints.gibraltar.patrols.gbr.mode, 'escort');
  // Any point on the water: the North Sea off Norway
  assert.equal(g.command('gbr', { type: 'fleetOrder', id: f.id, x: 905, y: 135, mission: 'hold' }), null);
  assert.match(g.command('gbr', { type: 'fleetOrder', id: f.id, x: 1000, y: 200, mission: 'hold' }) ?? '', /water/, 'not inland');
  // China and Taiwan at war: China's main fleet sails at Taiwan's, which, far smaller and off its own coast, withdraws into port
  justify(s, 'chn', 'twn');
  declareWar(s, s.countries.chn, 'twn', 'conquest');
  const tw = Object.values(s.fleets).find((x) => x.owner === 'twn');
  const cn = Object.values(s.fleets).filter((x) => x.owner === 'chn').sort((a, b) => b.ships - a.ships)[0];
  assert.equal(g.command('chn', { type: 'fleetOrder', id: cn.id, x: tw.x, y: tw.y, mission: 'hold' }), null);
  for (let i = 0; i < 90 && s.fleets[tw.id]; i++) { g.step(1 / 9); if (i % 9 === 8) g.tick(); }
  assert.ok(!s.fleets[tw.id], "Taiwan's fleet has left the sea");
  assert.ok(s.countries.twn.refitUntil > s.week, 'and is refitting in port');
});

test("a landing needs a fleet in the sea off the coast, at least as strong as the enemy's", async () => {
  const { landingProblem } = await import('../public/js/engine/military.js');
  const g = game(4, 'jpn');
  const s = g.s;
  justify(g, 'jpn', 'kor');
  g.command('jpn', { type: 'war', target: 'kor', goal: 'conquest' });
  const from = Object.keys(s.regions).find((id) => id.startsWith('jpn-') && GEO[id].coast);
  const target = Object.keys(s.regions).find((id) => id.startsWith('kor-') && GEO[id].coast);
  assert.match(landingProblem(s, { id: 'jpn' }, from, target), /no fleet of ours/, 'our fleet is still in home waters');
  for (const k of Object.values(s.fleets)) if (k.owner === 'kor') delete s.fleets[k.id]; // Korea's navy is in port
  const { PORTS } = await import('../public/js/engine/navy.js');
  const f = Object.values(s.fleets).filter((x) => x.owner === 'jpn').sort((a, b) => b.ships - a.ships)[0];
  assert.equal(g.command('jpn', { type: 'fleetOrder', id: f.id, x: PORTS[target][0], y: PORTS[target][1], mission: 'hold' }), null);
  for (let i = 0; i < 90 && f.route.length; i++) { g.step(1 / 9); if (i % 9 === 8) g.tick(); }
  assert.equal(landingProblem(s, { id: 'jpn' }, from, target), null, "with Japan's fleet off the Korean coast, the landing can go ahead");
});

/* ---------- Peoples ---------- */

test('conquered peoples resist, movements can vote to leave, and a winning uprising takes the province away', async () => {
  const { peoplesTick } = await import('../public/js/engine/peoples.js');
  const g = game(13, 'esp');
  const s = g.s;
  const R = s.regions;
  assert.ok(R['ind-jk'].loyalty < R['ind-dl'].loyalty, 'Kashmir is less loyal than Delhi');
  // Occupation: loyalty collapses and unrest follows
  R['kaz-ek'].ctrl = 'rus';
  for (let w = 0; w < 20; w++) peoplesTick(s);
  assert.ok(R['kaz-ek'].loyalty < 15 && R['kaz-ek'].unrest > 40);
  // A referendum lost: Catalonia leaves in peace
  R['esp-ct'].loyalty = 20;
  assert.equal(g.command('esp', { type: 'referendum', region: 'esp-ct' }), null);
  assert.equal(R['esp-ct'].owner, 'm-x-esp-ct');
  assert.equal(s.minors['m-x-esp-ct'].name, 'Catalonia');
  assert.ok(!s.wars.some((w) => [w.a, w.b].includes('m-x-esp-ct')), 'no war after a referendum');
  // An uprising that outlasts the army: Kurdistan breaks away and Turkey goes to war to get it back
  s.week = 30;
  R['tur-se'].loyalty = 10;
  R['tur-se'].revolt = { rebels: 120, since: 5, why: 'test' };
  peoplesTick(s);
  assert.equal(R['tur-se'].owner, 'm-x-tur-se');
  assert.ok(s.wars.some((w) => [w.a, w.b].includes('tur') && [w.a, w.b].includes('m-x-tur-se')));
  assert.ok(g.view('usa').minors['m-x-tur-se'], "the new nation is on everyone's map");
});

/* ---------- Proxy wars ---------- */

test('arming a country at war moves weapons, and covert programmes stay hidden from others', async () => {
  const { declareWar } = await import('../public/js/engine/diplomacy.js');
  const g = game(21, 'usa');
  g.setLeader('fra', 'Other');
  const s = g.s;
  justify(s, 'rus', 'pol');
  declareWar(s, s.countries.rus, 'pol', 'conquest');
  const tanks = s.countries.pol.tanks;
  assert.equal(g.command('usa', { type: 'aidStart', to: 'pol', kind: 'weapons', size: 1, covert: true }), null);
  g.tick();
  assert.ok(s.countries.pol.tanks > tanks, 'Poland received tanks');
  const mine = s.aid.find((p) => p.from === 'usa');
  assert.ok(mine && (mine.covert || mine.exposed));
  if (mine.covert) assert.ok(!g.view('fra').aid.some((p) => p.from === 'usa'), "France can't see a covert programme");
  assert.match(g.command('usa', { type: 'aidStart', to: 'pol', kind: 'weapons', size: 0 }), /already send/);
});

/* ---------- Oil ---------- */

test("the cartel's cut and embargo bite, and pipelines get fuel past them", async () => {
  const { cartelOutput, embargoCut, pipelineShare, bypassShare } = await import('../public/js/engine/energy.js');
  const g = game(5, 'sau');
  const s = g.s;
  assert.equal(s.cartel, null, 'no cartel at the start');
  assert.equal(g.command('sau', { type: 'cartelFound', name: 'The Producers' }), null);
  assert.equal(s.cartel.chair, 'sau');
  for (const id of ['irq', 'are', 'irn', 'rus', 'kaz']) s.countries[id].human = { name: 'x' }, assert.equal(g.command(id, { type: 'cartelJoin' }), null);
  for (const id of ['irq', 'are', 'irn', 'rus', 'kaz']) s.countries[id].human = null;
  for (let w = 0; w < 4; w++) g.tick();
  const before = s.market.price.oil;
  assert.equal(g.command('sau', { type: 'cartelCut', cut: 30 }), null);
  assert.equal(cartelOutput(s, 'irq'), 0.7);
  for (let w = 0; w < 20; w++) g.tick();
  assert.ok(s.market.price.oil > before * 1.1, `oil up from ${before.toFixed(2)} to ${s.market.price.oil.toFixed(2)}`);
  assert.equal(g.command('sau', { type: 'cartelEmbargo', target: 'jpn', on: true }), null);
  assert.ok(embargoCut(s, 'jpn') > 0.2);
  assert.ok(pipelineShare(s, 'chn', 'gas') > 0, 'Power of Siberia flows to China');
  assert.ok(bypassShare(s, 'sau', 'hormuz') > 0.5, 'Petroline gets Saudi oil round Hormuz');
  assert.equal(bypassShare(s, 'irq', 'hormuz'), 0, 'Kirkuk–Ceyhan is shut');
});

/* ---------- Climate ---------- */

test('emissions warm the world, and a carbon tax cuts them over time', () => {
  const g = game(8, 'deu');
  const s = g.s;
  for (let w = 0; w < 2; w++) g.tick();
  assert.ok(s.climate.world > 30 && s.climate.world < 45, `about 37 billion tonnes a year (${s.climate.world.toFixed(1)})`);
  const t0 = s.climate.temp;
  const e0 = s.countries.deu.emissions;
  assert.equal(g.command('deu', { type: 'carbonTax', level: 3 }), null);
  assert.equal(g.command('deu', { type: 'pledge', cut: 30, year: 2040 }), null);
  for (let w = 0; w < 104; w++) g.tick();
  assert.ok(s.climate.temp > t0 + 0.02, 'warmer after two years');
  assert.ok(s.countries.deu.emissions < e0 * 0.95, `German emissions down (${e0.toFixed(2)} → ${s.countries.deu.emissions.toFixed(2)})`);
  assert.ok(s.countries.deu.carbonRevenue > 0);
});

/* ---------- Space ---------- */

test('spy satellites count every army, and a launch takes twelve weeks', async () => {
  const { satSees } = await import('../public/js/engine/space.js');
  const g = game(30, 'ind');
  const s = g.s;
  g.command('pak', { type: 'armyCreate', region: 'pak-kr', troops: 123, tanks: 0 });
  assert.ok(satSees(s, 'usa') && !satSees(s, 'bra'));
  const pak = g.view('usa').armies.find((a) => a.owner === 'pak');
  assert.equal(pak.seen, true);
  assert.equal(pak.troops, 123, 'exact from orbit');
  assert.equal(pak.path, undefined, 'but not its orders');
  assert.equal(g.command('ind', { type: 'satellite', kind: 'comms' }), null);
  assert.equal(s.countries.ind.space.building.length, 1);
  for (let w = 0; w < 12; w++) g.tick();
  assert.equal(s.countries.ind.space.building.length, 0, 'launched after twelve weeks');
});

/* ---------- Old saved games ---------- */

test('a game saved before navies, peoples, oil, climate and space carries on under the new rules', () => {
  const g = game(2, 'usa');
  for (let i = 0; i < 3; i++) g.tick();
  const old = JSON.parse(JSON.stringify(g.s));
  delete old.fleets; delete old.aid; delete old.pipelines; delete old.cartel; delete old.climate; delete old.space;
  for (const r of Object.values(old.regions)) { delete r.people; delete r.loyalty; delete r.policy; }
  for (const c of Object.values(old.countries)) delete c.space;
  // Back then the smaller nations were passive 'minors' that only defended themselves
  for (const c of Object.values(old.countries)) {
    if (!c.minor) continue;
    delete old.countries[c.id];
    old.minors[c.id] = { id: c.id, name: c.name, troops: c.troops, tanks: c.tanks, nukes: c.nukes, guarantor: null, chokepoint: null, puppetOf: c.id === 'm-kuwait' ? 'usa' : null, annexed: false, capitulated: false, gdp: c.gdp, pop: c.pop, short: {}, stock: {} };
  }
  const back = new Game(old);
  assert.equal(Object.keys(back.s.minors).length, 0, 'the old minor nations are countries now');
  assert.ok(back.s.countries['m-kuwait'].minor && back.s.countries['m-kuwait'].conscription, 'with all a country needs');
  assert.ok(back.s.treaties.some((t) => t.kind === 'access' && t.a === 'usa' && t.b === 'm-kuwait'), 'a puppet lets its old master through');
  for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) back.step(1 / 3); back.tick(); }
  assert.ok(Object.keys(back.s.fleets).length > 20);
  assert.ok('cartel' in back.s && back.s.climate && back.s.space && back.s.pipelines.length);
  assert.ok(Object.values(back.s.regions).every((r) => r.people && r.loyalty != null));
  assert.ok(back.view('usa').fleets.length > 20);
});

/* ---------- Spies ---------- */

test('spies uncover war plans that can be acted on, and a turned network\'s lies backfire', async () => {
  const { intelAction } = await import('../public/js/engine/spies.js');
  const g = game(51, 'gbr');
  const s = g.s;
  const me = s.countries.gbr;
  me.treasury += 100;
  // Russia is planning to attack Poland; our network in Moscow finds out
  s.countries.rus.ai.plan = 'pol';
  s.countries.rus.ai.planAt = s.week + 100; // keep the plan alive while we watch
  assert.equal(g.command('gbr', { type: 'spyPlant', target: 'rus', agents: 12 }), null);
  s.countries.rus.counterIntel = 0;
  let plan = null;
  for (let w = 0; w < 12 && !plan; w++) { g.tick(); plan = me.reports.find((r) => r.act === 'plan'); }
  assert.ok(plan, 'the plan was reported');
  assert.equal(plan.victim, 'pol');
  assert.ok(me.inbox.some((m) => /preparing to attack Poland/.test(m.text)), 'and we were alerted');
  const relBefore = s.rel['gbr|pol'] ?? 0;
  assert.equal(g.command('gbr', { type: 'intelAct', id: plan.id, action: 'warn' }), null);
  assert.ok((s.rel['gbr|pol'] ?? 0) > relBefore, 'Poland is grateful');
  assert.ok(s.countries.pol.mob >= 1, 'and mobilises');
  assert.match(g.command('gbr', { type: 'intelAct', id: plan.id, action: 'expose' }), /already acted/);
  // A lie from a turned network: exposing it costs us
  const rep = me.rep;
  me.reports.push({ id: 999999, w: s.week, about: 'rus', text: 'fake', kind: 'plan', act: 'plan', planner: 'rus', victim: 'fin', turned: true });
  assert.equal(intelAction(s, me, { id: 999999, action: 'expose' }), null);
  assert.ok(me.rep < rep, 'exposing a fabrication hurts our standing');
  assert.ok(!g.view('gbr').you.reports.some((r) => 'turned' in r), 'the view never says which reports are lies');
  // Rolling up their network in our country
  s.countries.rus.spies.gbr = { agents: 6, since: 0, turned: false, lastReport: 0 };
  me.reports.push({ id: 999998, w: s.week, about: 'rus', text: 'their spies', kind: 'counter', act: 'rollup', target: 'rus' });
  assert.equal(g.command('gbr', { type: 'intelAct', id: 999998, action: 'rollup' }), null);
  assert.equal(s.countries.rus.spies.gbr, undefined);
});

test('a settled network can trace where a country gets its raw materials, but it is hard', async () => {
  const { supplyPicture } = await import('../public/js/engine/spies.js');
  const g = game(52, 'usa');
  const s = g.s;
  const me = s.countries.usa;
  me.treasury += 500;
  for (let w = 0; w < 3; w++) g.tick(); // let the market settle so imports show
  // Without agents inside it can't even be tried
  assert.match(g.command('usa', { type: 'intel', op: 'supply', target: 'jpn' }), /settled network/);
  // A secret oil deal for Japan, which our agents should find
  s.treaties.push({ id: 't-test', kind: 'deal', a: 'sau', b: 'jpn', res: 'oil', qty: 1, price: 5, secret: true, since: s.week, until: s.week + 200 });
  const p = supplyPicture(s, 'jpn');
  assert.ok(p.res.length > 0, 'Japan imports raw materials');
  assert.ok(p.res.some((x) => x.suppliers.length), 'and its suppliers are named');
  assert.ok(p.deals.some((d) => d.secret && d.from === 'sau'), 'the secret deal is found');
  assert.ok(p.res.every((x) => x.imported > 0 && x.imported <= 1));
  // With a settled network, it eventually works; it is hard, so it takes several tries
  g.command('usa', { type: 'spyPlant', target: 'jpn', agents: 10 });
  s.countries.jpn.counterIntel = 0;
  let tries = 0;
  let got = null;
  for (; tries < 60 && !got; tries++) {
    me.spies.jpn.since = s.week - 10;
    me.spies.jpn.agents = 10;
    me.spies.jpn.turned = false;
    delete me.cooldown['intel:supply:jpn'];
    assert.equal(g.command('usa', { type: 'intel', op: 'supply', target: 'jpn' }), null);
    got = me.reports.find((r) => r.kind === 'supply');
  }
  assert.ok(got, 'the supply lines were traced');
  assert.ok(got.supply.deals.some((d) => d.secret), 'including the secret deal');
  assert.equal(got.act, 'supply');
  assert.ok((me.cooldown['intel:supply:jpn'] ?? 0) >= s.week + 12, 'and it can only be tried every three months');
  // Exposing it makes the deal public
  assert.equal(g.command('usa', { type: 'intelAct', id: got.id, action: 'expose' }), null);
  assert.equal(s.treaties.find((t) => t.id === 't-test').secret, false);
  // A turned network names the wrong suppliers and keeps real secret deals hidden
  s.treaties.find((t) => t.id === 't-test').secret = true;
  const lie = supplyPicture(s, 'jpn', true);
  assert.ok(!lie.deals.some((d) => d.id === 't-test'), 'a turned network hides the real secret deal');
});

/* ---------- Military access ---------- */

test('crossing another country takes its permission: granted, the army marches on; refused, only war opens the way', async () => {
  const { respond } = await import('../public/js/engine/diplomacy.js');
  const g = game(61, 'fra');
  const s = g.s;
  for (const f of Object.values(s.fleets)) if (f.owner === 'fra') delete s.fleets[f.id]; // no landing by sea
  justify(g, 'fra', 'pol');
  g.command('fra', { type: 'war', target: 'pol', goal: 'conquest' });
  g.command('fra', { type: 'armyCreate', region: 'fra-es', troops: 60, tanks: 0 });
  const army = Object.values(s.armies).find((a) => a.owner === 'fra');
  assert.match(g.command('fra', { type: 'armyOrder', id: army.id, kind: 'go', target: 'pol-wp' }) ?? '', /Germany|access|through|cross/i, 'Germany is in the way');
  // Fighting on the same side is no longer a free pass
  justify(g, 'deu', 'pol');
  g.command('deu', { type: 'war', target: 'pol', goal: 'conquest' });
  assert.ok(g.command('fra', { type: 'armyOrder', id: army.id, kind: 'go', target: 'pol-wp' }), 'still needs Germany\'s permission');
  // Ask; Germany agrees; the army sets off by itself
  s.countries.deu.human = { name: 'Berlin' };
  assert.equal(g.command('fra', { type: 'propose', to: 'deu', kind: 'access', terms: { army: army.id, target: 'pol-wp' } }), null);
  const p = Object.values(s.proposals).find((x) => x.kind === 'access');
  assert.equal(respond(s, 'deu', p.id, true), null);
  assert.equal(army.op.target, 'pol-wp', 'the army is on its way');
  assert.ok(s.countries.fra.inbox.some((m) => /granted access/.test(m.text)));
  // A refusal says so plainly
  g.command('fra', { type: 'propose', to: 'che', kind: 'access', terms: {} });
  s.countries.che.human = { name: 'Bern' };
  const q = Object.values(s.proposals).find((x) => x.kind === 'access' && x.to === 'che');
  if (q) {
    respond(s, 'che', q.id, false);
    assert.ok(s.countries.fra.inbox.some((m) => /refused our troops passage/.test(m.text)));
  }
});

test('every other nation is a country the computer runs: blocs, protectors and wars of their own', () => {
  const g = game(12, 'usa');
  const s = g.s;
  const npc = Object.values(s.countries).filter((c) => c.minor);
  assert.ok(npc.length > 140, 'about 150 smaller nations');
  assert.equal(Object.keys(s.alliances).length, 0, 'no alliances at the start');
  g.setLeader('m-greece', 'Someone');
  assert.equal(s.countries['m-greece'].human, null, 'a smaller nation cannot be led by a person');
  assert.equal(rel(s, 'm-armenia', 'm-azerbaijan'), 0, 'every game starts from scratch: no old feuds');
  assert.equal(Object.keys(s.sanctions).length, 0, 'and no sanctions');
  assert.deepEqual(s.countries['m-serbia'].claims, ['m-kosovo']);
  // Feuds and friendships grow during the game: here Armenia falls out with Azerbaijan and warms to France
  setRel(s, 'm-armenia', 'm-azerbaijan', -70);
  setRel(s, 'm-armenia', 'fra', 70);
  for (let w = 0; w < 80; w++) { for (let i = 0; i < 3; i++) g.step(1 / 3); g.tick(); }
  const blocs = Object.values(s.alliances).filter((al) => al.kind === 'economic' && al.members.every((m) => s.countries[m]?.minor));
  assert.ok(blocs.length >= 5 && blocs.some((al) => al.members.length >= 4), 'regional trade blocs formed');
  assert.ok(Object.values(s.alliances).some((al) => al.kind === 'military' && al.members.some((m) => s.countries[m]?.minor) && al.members.some((m) => !s.countries[m]?.minor)), 'a smaller nation found a protector');
  assert.ok(!s.news.some((n) => /goes to the polls|Election upset/.test(n.text) && n.about.every((id) => s.countries[id]?.minor)), 'their routine elections stay out of the news');
});

test('the world\'s main sea trade is estimated from who exports and imports what, and wars cut it', () => {
  const g = game(15, 'usa');
  for (let i = 0; i < 4; i++) g.tick();
  const flows = g.s.tradeFlows;
  assert.ok(flows.length >= 20, 'dozens of flows');
  assert.ok(flows.some(([a, , r]) => r === 'oil' && ['sau', 'rus', 'irq', 'are', 'irn'].includes(a)), 'oil from the big exporters');
  for (const [a, b, , v] of flows) assert.ok(a !== b && v > 0 && g.s.countries[a] && g.s.countries[b]);
  const [a, b] = flows[0];
  g.setLeader(a, 'X');
  justify(g, a, b);
  assert.equal(g.command(a, { type: 'war', target: b }), null);
  g.tick();
  assert.ok(!g.s.tradeFlows.some(([x, y]) => (x === a && y === b) || (x === b && y === a)), 'no trade between countries at war');
  assert.equal(g.view('usa').trade.length, g.s.tradeFlows.length);
});

test('the browser finds a route through home ground from what the server sends it', () => {
  const g = game(1, 'mex');
  const v = g.view('mex');
  // The same fields the map's fauxState keeps from each region row
  const regions = Object.fromEntries(ORDER.map((id, i) => [id, { id, ctrl: v.regions[i][1], owner: v.regions[i][0], infra: v.regions[i][3] }]));
  const s = { regions, wars: v.wars, alliances: {}, treaties: v.treaties, minors: {}, countries: v.countries, fleets: {} };
  assert.deepEqual(route(s, 'mex', 'mex-mx', 'mex-nw', { offensive: false }), ['mex-bj', 'mex-nw']);
  // Missing infrastructure must not make every friendly move impossible
  for (const r of Object.values(regions)) delete r.infra;
  assert.ok(route(s, 'mex', 'mex-mx', 'mex-nw', { offensive: false }));
});

test('a figure that turns NaN is repaired before it can spread, and junk numbers are refused', () => {
  const g = game(2, 'mex');
  g.tick();
  const c = g.s.countries.mex;
  const gdp = c.gdp;
  const warn = console.warn;
  console.warn = () => {};
  try {
    c.gdp = NaN;
    c.treasury = Infinity;
    g.s.regions['mex-mx'].unrest = NaN;
    g.tick();
  } finally { console.warn = warn; }
  assert.ok(Number.isFinite(c.gdp) && Math.abs(c.gdp - gdp) / gdp < 0.05, 'GDP is back near what it was');
  assert.ok(Number.isFinite(c.treasury));
  const bad = [];
  const walk = (o, p) => { for (const k in o) { const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${p}.${k}`); else if (v && typeof v === 'object') walk(v, `${p}.${k}`); } };
  walk(g.s, 's');
  assert.deepEqual(bad, [], 'nothing else caught it');
  // A blank number box or a NaN amount never gets into the books
  assert.match(g.command('mex', { type: 'stimulus', amount: NaN }), /valid number/);
  assert.match(g.command('mex', { type: 'policy', spend: { health: NaN } }), /valid number/);
  assert.match(g.command('mex', { type: 'propose', to: 'usa', kind: 'loan', terms: { amount: NaN, years: 5, rate: 3 } }), /valid number/);
  const before = c.treasury;
  assert.match(g.command('mex', { type: 'stimulus', amount: 'abc' }) ?? '', /stimulus/);
  assert.equal(c.treasury, before);
});

test('a war must be justified first: the case takes weeks, stays secret, and only deep spy networks hear of it', () => {
  const g = game(3, 'rus');
  const s = g.s;
  g.tick();
  assert.match(g.command('rus', { type: 'war', target: 'pol' }), /justify/i);
  const newsBefore = s.news?.length ?? 0;
  assert.equal(g.command('rus', { type: 'warCase', target: 'pol' }), null);
  assert.match(g.command('rus', { type: 'war', target: 'pol' }), /still being prepared/);
  // Nobody is told
  const told = (s.fresh ?? []).filter((f) => /case/i.test(f.text ?? '') && f.to !== 'rus');
  assert.deepEqual(told, []);
  assert.equal(s.news?.length ?? 0, newsBefore);
  // Poland plants a deep network in Russia; Russia then starts on Kazakhstan, and Poland's agents hear of it
  s.countries.pol.spies.rus = { agents: 40, since: -100, lastReport: -100 };
  assert.equal(g.command('rus', { type: 'warCase', target: 'kaz' }), null);
  assert.ok(s.countries.pol.reports.some((r) => /case for war against Kazakhstan/.test(r.text)), 'a deep network hears of it');
  assert.ok(!s.countries.deu.reports?.some((r) => /case for war/.test(r.text)), 'others do not');
  for (let i = 0; i < 5; i++) { for (let k = 0; k < 8; k++) g.step(0.125); g.tick(); }
  assert.equal(g.command('rus', { type: 'war', target: 'pol' }), null);
  assert.ok(!s.countries.rus.warCases.pol, 'the case is used up');
});

test('cargo ships are at sea: only a fleet that reaches one can stop it, and stronger escorts get it through', async () => {
  const { ship, routeFor } = await import('../public/js/engine/trade.js');
  const { shipAt } = await import('../public/js/engine/shipping.js');
  const g = game(4, 'pol');
  const s = g.s;
  g.tick();
  const nz = s.countries['m-new-zealand'] ? 'm-new-zealand' : Object.keys(s.countries).find((id) => /zealand/i.test(s.countries[id].name));
  const send = () => ship(s, { seller: 'aus', buyer: nz, res: 'food', qty: 2, cost: 1, route: { ...routeFor(s, 'aus', nz), mode: 'sea', weeks: 4 } });
  const step = (n = 1) => { for (let i = 0; i < n; i++) { g.step(0.125); if ((s.stepped ?? 0) >= 0.999) g.tick(); } };
  // Poland's fleets are in Europe: they can't catch a cargo crossing the Tasman Sea
  const sh = send();
  step();
  const polFleet = Object.values(s.fleets).find((f) => f.owner === 'pol');
  assert.ok(polFleet, 'Poland has a fleet');
  assert.match(g.command('pol', { type: 'intercept', id: sh.id, fleet: polFleet.id, how: 'seize' }), /can't catch/);
  // A Polish squadron right on the lane, at war with Australia, stops an unescorted cargo
  for (const f of Object.values(s.fleets)) if (f.owner === 'aus') { f.x = 10; f.y = 10; }
  s.wars.push({ id: 'wx', a: 'pol', b: 'aus', since: s.week, goal: 'conquest', lossA: 0, lossB: 0 });
  const raid = send();
  step();
  const [x, y] = shipAt(s, raid, 0.5);
  Object.assign(polFleet, { x, y, route: [], ships: 12, carriers: 0, org: 90, mission: 'hold' });
  step(24);
  assert.ok(raid.done, 'the cargo was stopped');
  // With a stronger Australian fleet sailing alongside, the next one gets through
  const escorted = send();
  step();
  const ausFleet = Object.values(s.fleets).find((f) => f.owner === 'aus');
  polFleet.ships = 3;
  Object.assign(ausFleet, { x, y, route: [], ships: 20, carriers: 0, org: 90, mission: 'hold' });
  polFleet.x = x; polFleet.y = y;
  step(24);
  assert.ok(!escorted.done || escorted.left <= 0, 'the escorts got it through');
});

test('automatic capture keeps an army attacking province after province; a prepared landing crosses without the sea', () => {
  const g = game(5, 'rus');
  const s = g.s;
  g.tick();
  justify(g, 'rus', 'kaz');
  assert.equal(g.command('rus', { type: 'war', target: 'kaz' }), null);
  assert.equal(g.command('rus', { type: 'armyCreate', region: 'rus-ur', troops: 400, tanks: 1500 }), null);
  const a = Object.values(s.armies).find((x) => x.owner === 'rus' && x.region === 'rus-ur');
  assert.equal(g.command('rus', { type: 'armyAuto', id: a.id, on: true }), null);
  const held = () => Object.values(s.regions).filter((r) => r.id.startsWith('kaz-') && r.ctrl === 'rus').length;
  for (let w = 0; w < 30 && s.armies[a.id]; w++) { for (let k = 0; k < 8; k++) g.step(0.125); g.tick(); }
  assert.ok(held() >= 2, `took several provinces on its own (${held()})`);

  // Turkey prepares a landing on its own coast: it costs money, takes weeks, and Greece-side spies see it
  const g2 = game(6, 'tur');
  const s2 = g2.s;
  g2.tick();
  assert.equal(g2.command('tur', { type: 'armyCreate', region: 'tur-ag', troops: 60, tanks: 100 }), null);
  const t = Object.values(s2.armies).find((x) => x.owner === 'tur');
  s2.countries.egy.spies.tur = { agents: 5, since: -50, lastReport: -50 };
  const before = s2.countries.tur.treasury + s2.countries.tur.milFunds;
  assert.equal(g2.command('tur', { type: 'armyLanding', id: t.id }), null);
  assert.ok(s2.countries.tur.treasury + s2.countries.tur.milFunds < before, 'it costs money');
  assert.ok(s2.countries.egy.inbox.some((m) => /build-up/.test(m.text)), 'spies report it');
  assert.match(g2.command('tur', { type: 'armyLanding', id: t.id }), /under way/);
});

test('an occupied province works for its occupier, not its home country', () => {
  const g = game(31, 'deu');
  const s = g.s;
  g.tick();
  const reg = Object.values(s.regions).filter((r) => r.owner === 'pol').sort((a, b) => b.gdp - a.gdp)[0];
  const deu0 = s.countries.deu.pot;
  const pol0 = s.countries.pol.pot;
  reg.ctrl = 'deu';
  reg.unrest = 0;
  g.tick();
  const share = reg.gdp * (1 - 0.8 * reg.dmg);
  assert.ok(s.countries.deu.pot - deu0 > share * 0.9, 'the occupier gains (nearly) all its output');
  assert.ok(pol0 - s.countries.pol.pot > share * 0.9, 'the home country loses it');
});
