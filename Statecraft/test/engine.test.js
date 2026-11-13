import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { COUNTRY_IDS, COUNTRIES } from '../public/js/engine/data/countries.js';
import { PROVINCES } from '../public/js/engine/data/regions.js';
import { GEO, ORDER } from '../public/js/engine/data/geo.js';
import { route, freeForces, bury } from '../public/js/engine/military.js';

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
  // Declaring war on a fellow member leaves the alliance in the same step
  assert.equal(g.command('rus', { type: 'war', target: 'kaz' }), null);
  assert.ok(g.s.wars.some((w) => w.a === 'rus' && w.b === 'kaz'), 'at war');
  assert.ok(!Object.values(g.s.alliances).some((al) => al.members.includes('rus') && al.members.includes('kaz')), 'pact left');
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
  // Fog of war: an army far from American soil is invisible without spies
  assert.equal(v.armies.find((a) => a.owner === 'chn'), undefined);
  assert.equal(v.you.id, 'usa');
  // A neighbour sees it roughly, but not its plans
  const near = GEO['chn-fj'].adj.map((id) => g.s.regions[id].ctrl).find((h) => h !== 'chn' && g.s.countries[h]);
  if (near) {
    const seen = g.view(near).armies.find((a) => a.owner === 'chn');
    assert.equal(seen.exact, false);
    assert.equal(seen.path, undefined);
  }
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
  assert.match(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'invade', target: 'irq-ms', declare: true }), /landlocked|port/);
  assert.equal(g.s.wars.length, 0, 'an impossible attack does not start a war');
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
    assert.equal(g.command('chn', { type: 'intercept', id: sh.id, how: 'seize' }), null);
    g.tick();
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
  assert.equal(g.command('tur', { type: 'armyOrder', id: army.id, kind: 'go', target: 'irq-ms', declare: true }), null);
  assert.ok(g.s.wars.some((w) => w.a === 'tur' && w.b === 'irq'), 'war declared');
  assert.equal(army.op.kind, 'attack');
  army.org = 5;
  let attacked = false;
  for (let i = 0; i < 4 && !attacked; i++) { g.tick(); attacked = Boolean(army.attacking) || g.s.regions['irq-ms'].ctrl === 'tur'; }
  assert.ok(attacked, `attacked at once (status: ${army.status})`);
});

test('making the case to the nation first takes the edge off the outcry over a war', () => {
  const run = (justify) => {
    const g = game(22, 'deu');
    const c = g.s.countries.deu;
    if (justify) assert.equal(g.command('deu', { type: 'warCase', target: 'pol' }), null);
    const boost = c.boost;
    const rep = c.rep;
    assert.equal(g.command('deu', { type: 'war', target: 'pol' }), null);
    const war = g.s.wars.find((w) => w.a === 'deu' && w.b === 'pol');
    for (let i = 0; i < 20; i++) g.tick();
    const anti = (c.protests.find((p) => p.cause === 'war')?.size ?? 0);
    return { justified: war.justified === 'deu', boostHit: boost - c.boost, repHit: rep - c.rep, anti };
  };
  const plain = run(false);
  const made = run(true);
  assert.equal(made.justified, true);
  assert.equal(plain.justified, false);
  assert.ok(made.anti <= plain.anti, `anti-war protests ${made.anti} vs ${plain.anti}`);
  assert.ok(made.repHit < plain.repHit + 0.01 || made.repHit <= plain.repHit, `standing lost ${made.repHit} vs ${plain.repHit}`);
});
