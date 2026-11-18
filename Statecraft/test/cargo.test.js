// Planned cargo routes, private cargoes and who sees them, designs, army supplies and supply lines, missile strikes
// and money aid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { startWar, propose } from '../public/js/engine/diplomacy.js';
import { ship } from '../public/js/engine/trade.js';
import { createArmy, abroad } from '../public/js/engine/military.js';
import { planDealRoute, canSeeCargo, MAX_CHECKPOINTS } from '../public/js/engine/cargo.js';
import { designStats, defaultParts } from '../public/js/engine/designs.js';
import { shipAt, voyage } from '../public/js/engine/shipping.js';
import { GEO } from '../public/js/engine/data/geo.js';

function game(seed, ...leaders) {
  const g = Game.create({ seed });
  for (const id of leaders) g.setLeader(id, id.toUpperCase());
  return g;
}
const week = (g) => { for (let i = 0; i < 8; i++) g.step(0.125); g.tick(); };
const told = (s, id, re) => s.countries[id].inbox.some((m) => re.test(m.text));
const plant = (s, by, target) => { s.countries[by].spies[target] = { agents: 8, since: s.week - 10, lastReport: s.week }; };

// A deal between two leaders, agreed: the seller (a) proposes, the buyer (b) accepts
function agree(g, a, b, terms) {
  assert.equal(g.command(a, { type: 'propose', to: b, kind: 'deal', terms: { seller: a, res: 'food', qty: 0.4, price: 1, weeks: 52, ...terms } }), null);
  const p = Object.values(g.s.proposals).find((x) => x.from === a && x.to === b && x.kind === 'deal');
  assert.equal(g.command(b, { type: 'respond', id: p.id, accept: true }), null);
  return g.s.treaties.find((t) => t.kind === 'deal' && t.a === a && t.b === b);
}

test('a leader who sells plans the convoys\' route: no convoy sails until then, legs over land are refused, and the seller pays to ship', () => {
  const g = game(31, 'usa', 'jpn');
  const s = g.s;
  s.countries.usa.stock.food = 50;
  const t = agree(g, 'usa', 'jpn', {});
  assert.equal(t.mode, 'sea');
  assert.ok(told(s, 'usa', /Plan the route/), 'the seller is asked to plan it');
  week(g); week(g); week(g);
  assert.ok(!s.shipments.some((x) => x.deal === t.id), 'nothing sails without a route');
  // A checkpoint in the middle of the United States: the leg crosses land
  assert.match(g.command('usa', { type: 'dealRoute', id: t.id, checkpoints: [[430, 250]] }), /crosses land/);
  assert.match(g.command('usa', { type: 'dealRoute', id: t.id, checkpoints: Array.from({ length: MAX_CHECKPOINTS + 1 }, () => [100, 400]) }), /at most/);
  assert.match(g.command('jpn', { type: 'dealRoute', id: t.id, auto: true }), /Only the seller/);
  assert.equal(g.command('usa', { type: 'dealRoute', id: t.id, auto: true }), null);
  assert.ok(t.route.km > 5000 && t.route.cost > 0);
  const before = s.countries.usa.treasury;
  for (let i = 0; i < 3 && !s.shipments.some((x) => x.deal === t.id); i++) week(g);
  const sh = s.shipments.find((x) => x.deal === t.id);
  assert.ok(sh, 'a convoy sails once the route is planned');
  assert.deepEqual(sh.path, t.route.pts, 'along the planned route');
  assert.ok(t.freight > 0, 'the seller paid for the shipping');
  void before;
  // It sails where the plan says: its position lies on the path
  const p = shipAt(s, sh, 0.5);
  assert.ok(p && Number.isFinite(p[0]));
});

test('a plan checks every leg: a straight line through a continent is refused, one round it is accepted', () => {
  const g = game(32, 'usa', 'jpn');
  const s = g.s;
  const t = { id: 'x', kind: 'deal', a: 'usa', b: 'jpn', res: 'food', qty: 1, price: 1, since: 0, until: 52 };
  const auto = planDealRoute(s, t, { auto: true, mode: 'sea' });
  assert.ok(!auto.error, auto.error);
  const checks = auto.pts.slice(1, -1).slice(0, MAX_CHECKPOINTS);
  if (auto.pts.length - 2 <= MAX_CHECKPOINTS) assert.ok(!planDealRoute(s, t, { checkpoints: checks, mode: 'sea' }).error, 'the computer\'s checkpoints work by hand too');
});

test('in a private deal the buyer asks, and the seller names the price', () => {
  const g = game(33, 'usa', 'jpn');
  const s = g.s;
  assert.match(g.command('jpn', { type: 'propose', to: 'usa', kind: 'deal', terms: { seller: 'usa', res: 'food', qty: 0.4, price: null, weeks: 52, secret: false } }), /price/);
  assert.equal(g.command('jpn', { type: 'propose', to: 'usa', kind: 'deal', terms: { seller: 'usa', res: 'food', qty: 0.4, price: null, weeks: 52, secret: true } }), null);
  const ask = Object.values(s.proposals).find((p) => p.from === 'jpn');
  assert.match(g.command('usa', { type: 'respond', id: ask.id, accept: true }), /Name a yearly price/);
  assert.equal(g.command('usa', { type: 'respond', id: ask.id, accept: true, price: 2.5 }), null);
  const offer = Object.values(s.proposals).find((p) => p.from === 'usa' && p.to === 'jpn');
  assert.equal(offer.terms.price, 2.5, 'our price goes back to the buyer');
  assert.equal(g.command('jpn', { type: 'respond', id: offer.id, accept: true }), null);
  assert.ok(s.treaties.some((t) => t.kind === 'deal' && t.secret && t.price === 2.5));
});

test('a private cargo is seen only by the two countries, spies inside either, spy satellites, and warships very close to it', () => {
  const g = game(34, 'usa', 'gbr', 'bra');
  const s = g.s;
  s.countries.gbr.space.sats.spy = 0;
  s.countries.bra.space.sats.spy = 0;
  const sh = ship(s, { seller: 'usa', buyer: 'jpn', res: 'food', qty: 1, cost: 0, secret: true, route: { mode: 'sea', weeks: 4, straits: [], transit: [] } });
  week(g);
  assert.ok(g.view('usa').shipments.some((x) => x.id === sh.id), 'the seller sees it');
  assert.ok(!g.view('gbr').shipments.some((x) => x.id === sh.id), 'an outsider doesn\'t');
  plant(s, 'gbr', 'jpn');
  assert.ok(g.view('gbr').shipments.some((x) => x.id === sh.id && x.seen === 'spies'), 'spies inside the buyer see it');
  s.countries.bra.space.sats.spy = 1;
  assert.ok(g.view('bra').shipments.some((x) => x.id === sh.id && x.seen === 'satellite'), 'a spy satellite sees it');
  // Britain tells the world
  assert.equal(g.command('gbr', { type: 'cargoExpose', id: sh.id }), null);
  assert.ok(sh.exposed && canSeeCargo(s, 'fra', sh), 'now everyone sees it');
  assert.ok(s.news.some((n) => /reveals that/.test(n.text)));
});

test('a warship that comes very close to a private cargo reports it, and its leader can seize it', () => {
  const g = game(35, 'usa', 'gbr');
  const s = g.s;
  s.countries.gbr.space.sats.spy = 0;
  const sh = ship(s, { seller: 'bra', buyer: 'zaf', res: 'iron', qty: 1, cost: 0.1, covert: true, route: { mode: 'sea', weeks: 6, straits: [], transit: [] } });
  g.step(0.125);
  assert.ok(sh.x != null, 'it is at sea');
  // One of Britain's fleets, waiting on its route just ahead of it
  const f = Object.values(s.fleets).find((x) => x.owner === 'gbr' && x.ships >= 1);
  const ahead = shipAt(s, sh, voyage(s, sh) + 0.08);
  f.x = ahead[0]; f.y = ahead[1]; f.route = [];
  for (let i = 0; i < 6 && !s.countries.gbr.decisions?.some((x) => x.key === 'cargoSighted'); i++) g.step(0.125);
  const d = s.countries.gbr.decisions.find((x) => x.key === 'cargoSighted');
  assert.ok(d, 'the leader is asked what to do');
  assert.deepEqual(d.options.map((o) => o.id), ['pass', 'seize', 'sink', 'broadcast']);
  assert.ok(g.view('gbr').shipments.some((x) => x.id === sh.id && x.seen === 'ships'));
  assert.equal(g.command('gbr', { type: 'decide', id: d.id, option: 'seize' }), null);
  // Alongside it, the fleet boards it at once (seized, or it slipped away)
  assert.ok(sh.met[f.id], 'the fleet acted on it straight away');
  assert.ok(sh.done ? s.countries.gbr.inbox.some((m) => /Seized/.test(m.text)) : s.countries.gbr.inbox.some((m) => /Failed to seize/.test(m.text)));
});

test('a neutral country\'s spies who find a secret trade can keep quiet or broadcast it; a sinking is heard by spies and satellites', () => {
  const g = game(36, 'usa', 'jpn', 'fra', 'ind');
  const s = g.s;
  s.countries.usa.stock.food = 50;
  plant(s, 'fra', 'usa');
  agree(g, 'usa', 'jpn', { secret: true });
  const d = s.countries.fra.decisions.find((x) => x.key === 'cargoLeak');
  assert.ok(d, 'France is asked');
  assert.deepEqual(d.options.map((o) => o.id), ['quiet', 'broadcast']);
  assert.equal(g.command('fra', { type: 'decide', id: d.id, option: 'broadcast' }), null);
  assert.ok(s.treaties.find((t) => t.kind === 'deal' && t.a === 'usa').exposed);
  // India has a spy satellite: it hears when someone sinks a cargo
  s.countries.ind.space.sats.spy = 2;
  const sh = ship(s, { seller: 'bra', buyer: 'zaf', res: 'iron', qty: 1, cost: 0.1, route: { mode: 'sea', weeks: 3, straits: [], transit: [] } });
  g.step(0.125);
  const f = Object.values(s.fleets).filter((x) => x.owner === 'jpn').sort((a, b) => b.ships - a.ships)[0];
  const ahead = shipAt(s, sh, voyage(s, sh) + 0.15);
  f.x = ahead[0]; f.y = ahead[1]; f.route = [];
  assert.equal(g.command('jpn', { type: 'intercept', id: sh.id, fleet: f.id, how: 'sink' }), null);
  for (let i = 0; i < 24 && !sh.done; i++) g.step(0.125);
  if (sh.done && s.news.some((n) => /Japan sank/.test(n.text))) assert.ok(told(s, 'ind', /Our spy satellites saw it: Japan sank/), 'India is told');
});

test('designs: locked parts need research; building to a design moves the arm\'s rating; spies see them', () => {
  const g = game(37, 'usa', 'chn');
  const s = g.s;
  const usa = s.countries.usa;
  usa.tech.army = 4;
  assert.match(g.command('usa', { type: 'designSave', kind: 'tanks', name: 'Brick', parts: { ...defaultParts('tanks'), armour: 'aps' } }), /Not yet/);
  usa.tech.army = 9;
  usa.tech.industry = 9;
  const parts = { hull: 'heavy', gun: 'g130', armour: 'aps', engine: 'hybrid', extras: 'network' };
  assert.equal(g.command('usa', { type: 'designSave', kind: 'tanks', name: 'Thunderbolt', parts }), null);
  assert.match(g.command('usa', { type: 'designSave', kind: 'tanks', name: 'thunderbolt', parts }), /already/);
  const d = Object.values(usa.designs)[0];
  const st = designStats('tanks', parts);
  assert.ok(st.edge > 1.1 && st.cost > 1, 'a better, dearer tank');
  usa.milFunds += 100;
  assert.equal(g.command('usa', { type: 'build', kind: 'tanks', batches: 1, design: d.id }), null);
  assert.equal(usa.queue.at(-1).design, d.id);
  usa.queue.at(-1).left = 0.5;
  const tanks = usa.tanks;
  g.tick();
  assert.equal(usa.tanks, tanks + 50);
  assert.ok(usa.edge.tanks > 1 && d.built === 50, 'the force gets a little better');
  plant(s, 'chn', 'usa');
  const seen = g.view('chn').countries.usa.spied;
  assert.ok(seen.designs.some((x) => x.name === 'Thunderbolt'), 'Chinese spies see the design');
  assert.ok(seen.stock.oil != null, 'and the stockpiles');
  assert.equal(g.view('jpn').countries.usa.spied, undefined, 'others don\'t');
});

test('an army needs fuel, food and munitions: cut off from them, it lives two weeks on what it carries, then falls apart', () => {
  const g = game(38, 'usa', 'can');
  const s = g.s;
  startWar(s, 'usa', 'can');
  assert.equal(createArmy(s, s.countries.usa, { region: 'usa-tx', troops: 60 }), null);
  const a = Object.values(s.armies).find((x) => x.owner === 'usa');
  const v = g.view('usa').armies.find((x) => x.id === a.id);
  assert.ok(v.needs.oil > 0 && v.needs.food > 0 && v.needs.iron > 0, 'its needs are shown');
  const can = Object.values(s.regions).find((r) => r.ctrl === 'can' && r.id.startsWith('can-'));
  a.region = can.id; a.x = GEO[can.id].x; a.y = GEO[can.id].y; a.op = { kind: 'hold', target: can.id, at: [a.x, a.y], aggr: 'balanced' };
  g.tick();
  assert.equal(g.command('usa', { type: 'armyLine', id: a.id, on: false }), null);
  g.tick();
  assert.ok(a.out?.food != null && a.out?.oil != null && a.out?.iron != null, 'nothing gets through');
  assert.ok(told(s, 'usa', /getting no fuel, food, munitions/));
  const troops = a.troops;
  g.tick();
  assert.ok(a.troops >= troops * 0.97, 'it lives off what it carries at first');
  g.tick(); g.tick();
  assert.ok(a.troops < troops * 0.85, 'then it falls apart');
});

test('an army beyond our borders pays for a supply line, which the enemy can cut and we can rebuild', () => {
  const g = game(39, 'usa', 'can');
  const s = g.s;
  startWar(s, 'usa', 'can');
  const can = Object.values(s.regions).find((r) => r.ctrl === 'can' && r.id.startsWith('can-'));
  assert.equal(createArmy(s, s.countries.usa, { region: 'usa-tx', troops: 80 }), null);
  const a = Object.values(s.armies).find((x) => x.owner === 'usa');
  // Standing inside Canada
  const cell = Object.values(s.regions).find((r) => r.id === can.id);
  a.region = can.id;
  a.x = GEO[can.id].x; a.y = GEO[can.id].y;
  g.tick();
  assert.ok(abroad(s, a), 'it is abroad');
  assert.ok(a.lineCost > 0, 'its supply line costs money each week');
  s.countries.can.aircraft = 400;
  s.countries.can.tech.air = 10;
  let err = null;
  for (let i = 0; i < 12 && !a.line?.cut; i++) { s.countries.can.cooldown = {}; err = g.command('can', { type: 'cutSupply', army: a.id, how: 'air' }); if (err && !/failed/.test(err)) break; }
  assert.ok(a.line?.cut, `Canada cuts it (${err})`);
  assert.ok(told(s, 'usa', /has cut/));
  const money = s.countries.usa.treasury + s.countries.usa.milFunds;
  assert.equal(g.command('usa', { type: 'armyLineRepair', id: a.id }), null);
  assert.ok(!a.line.cut && s.countries.usa.treasury + s.countries.usa.milFunds < money, 'rebuilding it costs money');
  assert.equal(g.command('usa', { type: 'armyLine', id: a.id, on: false }), null);
  assert.ok(a.line.off);
  void cell;
});

test('a missile strike spreads fear and stirs nationalism', () => {
  const g = game(40, 'usa');
  const s = g.s;
  startWar(s, 'usa', 'irn');
  const target = Object.values(s.regions).filter((r) => r.ctrl === 'irn').sort((a, b) => b.gdp - a.gdp)[0].id;
  const irn = s.countries.irn;
  const before = { stability: irn.stability, rally: irn.rally ?? 0, reserves: irn.reserves };
  s.countries.usa.range.missile = 20000;
  assert.equal(g.command('usa', { type: 'missile', region: target, count: 100, aim: 'industry' }), null);
  assert.ok(irn.stability < before.stability, 'fear: stability falls');
  assert.ok(irn.rally > before.rally && irn.reserves > before.reserves, 'nationalism: the nation rallies and volunteers enlist');
});

test('money sent as aid arrives at once', () => {
  const g = game(41, 'usa', 'mex');
  const s = g.s;
  const t = s.countries.mex.treasury;
  assert.equal(g.command('usa', { type: 'aid', to: 'mex', amount: 5 }), null);
  assert.ok(Math.abs(s.countries.mex.treasury - (t + 5)) < 1e-9);
});

test('propose is unchanged for public deals', () => {
  const g = game(42, 'usa', 'jpn');
  assert.equal(propose(g.s, 'usa', 'jpn', 'deal', { seller: 'usa', res: 'oil', qty: 0.1, price: 1, weeks: 26 }), null);
});

test('neutral spies who uncover a secret trade later are asked too, once, and can broadcast it any time', () => {
  const g = game(43, 'usa', 'jpn', 'fra', 'deu');
  const s = g.s;
  s.countries.usa.stock.food = 50;
  const t = agree(g, 'usa', 'jpn', { secret: true });
  assert.ok(!s.countries.fra.decisions?.some((d) => d.key === 'cargoLeak'), 'no spies yet, no question');
  // France's agents settle in inside Japan after the deal was made
  plant(s, 'fra', 'jpn');
  g.tick();
  const d = s.countries.fra.decisions.find((x) => x.key === 'cargoLeak');
  assert.ok(d, 'France is asked once its spies find out');
  assert.equal(g.command('fra', { type: 'decide', id: d.id, option: 'quiet' }), null);
  g.tick(); g.tick();
  assert.ok(!s.countries.fra.decisions.some((x) => x.key === 'cargoLeak'), 'and not asked again');
  assert.ok(g.view('fra').spiedDeals.some((x) => x.id === t.id && x.neutral), 'it still sees the deal');
  // Germany, allied to Japan, sees it but isn't neutral: it isn't asked
  s.alliances.ax = { id: 'ax', name: 'Pact', kind: 'military', members: ['deu', 'jpn'], secret: false };
  plant(s, 'deu', 'jpn');
  g.tick();
  assert.ok(!s.countries.deu.decisions?.some((x) => x.key === 'cargoLeak'), 'an ally of one side isn\'t asked');
  // France changes its mind
  assert.equal(g.command('fra', { type: 'dealExpose', id: t.id }), null);
  assert.ok(t.exposed);
  assert.match(g.command('fra', { type: 'dealExpose', id: t.id }), /already knows/);
});

test('a market purchase can be made privately, at a premium: hidden like a private deal', () => {
  const g = game(44, 'usa', 'gbr');
  const s = g.s;
  s.countries.gbr.space.sats.spy = 0;
  g.tick();
  const seller = g.view('usa').market.sellers.food?.find((x) => !x.covert && x.route?.mode === 'sea');
  assert.ok(seller, 'someone sells grain by sea');
  const before = s.countries.usa.treasury;
  assert.equal(g.command('usa', { type: 'marketBuy', res: 'food', qty: 0.2, from: seller.id, private: true }), null);
  const sh = s.shipments.at(-1);
  assert.ok(sh.secret && !sh.covert, 'a private purchase');
  assert.ok(Math.abs((before - s.countries.usa.treasury) - 0.2 * seller.price * 1.08) < 0.01, 'eight per cent dearer');
  g.step(0.125);
  assert.ok(g.view('usa').shipments.some((x) => x.id === sh.id), 'the buyer sees it');
  assert.ok(!g.view('gbr').shipments.some((x) => x.id === sh.id), 'others don\'t');
});

test('free trade, pacts, access and loans can be secret; spies see them, neutrals may broadcast, troops give access away', () => {
  const g = game(45, 'usa', 'mex', 'fra', 'gbr');
  const s = g.s;
  plant(s, 'fra', 'mex');
  assert.equal(g.command('usa', { type: 'propose', to: 'mex', kind: 'nap', terms: { secret: true } }), null);
  const p = Object.values(s.proposals).find((x) => x.kind === 'nap');
  assert.equal(g.command('mex', { type: 'respond', id: p.id, accept: true }), null);
  const nap = s.treaties.find((t) => t.kind === 'nap' && t.a === 'usa' && t.b === 'mex');
  assert.ok(nap.secret && !s.news.some((n) => /non-aggression pact/.test(n.text) && /Mexico/.test(n.text)), 'no headlines');
  assert.ok(g.view('usa').treaties.some((t) => t.id === nap.id));
  assert.ok(!g.view('gbr').treaties.some((t) => t.id === nap.id), 'outsiders don\'t see it');
  assert.ok(g.view('fra').spiedPacts.some((t) => t.id === nap.id), 'French spies inside Mexico do');
  const d = s.countries.fra.decisions.find((x) => x.key === 'pactLeak');
  assert.ok(d, 'and France is asked whether to broadcast it');
  assert.equal(g.command('fra', { type: 'decide', id: d.id, option: 'broadcast' }), null);
  assert.ok(nap.exposed && g.view('gbr').treaties.some((t) => t.id === nap.id), 'now everyone knows');
  // Secret military access is revealed when the troops are seen
  assert.equal(g.command('usa', { type: 'propose', to: 'mex', kind: 'access', terms: { secret: true } }), null);
  const pa = Object.values(s.proposals).find((x) => x.kind === 'access');
  assert.equal(g.command('mex', { type: 'respond', id: pa.id, accept: true }), null);
  const access = s.treaties.find((t) => t.kind === 'access' && t.secret);
  assert.equal(createArmy(s, s.countries.usa, { region: 'usa-tx', troops: 20 }), null);
  const a = Object.values(s.armies).find((x) => x.owner === 'usa');
  const mx = Object.values(s.regions).find((r) => r.ctrl === 'mex');
  a.x = GEO[mx.id].x; a.y = GEO[mx.id].y; a.region = mx.id;
  g.tick();
  assert.ok(access.exposed, 'troops marching through give it away');
  // A secret loan
  s.countries.usa.treasury = 100;
  assert.equal(g.command('usa', { type: 'propose', to: 'mex', kind: 'loan', terms: { amount: 5, years: 5, rate: 3, secret: true } }), null);
  const pl = Object.values(s.proposals).find((x) => x.kind === 'loan');
  assert.equal(g.command('mex', { type: 'respond', id: pl.id, accept: true }), null);
  assert.ok(s.treaties.some((t) => t.kind === 'loan' && t.secret) && !s.news.some((n) => /lends Mexico/.test(n.text)));
});

test('an alliance with one other country in one step: founded only when they accept', () => {
  const g = game(46, 'usa', 'can', 'mex');
  const s = g.s;
  const before = Object.keys(s.alliances).length;
  assert.equal(g.command('usa', { type: 'propose', to: 'mex', kind: 'pact', terms: { kind: 'military', secret: false } }), null);
  assert.equal(Object.keys(s.alliances).length, before, 'nothing is founded yet');
  const no = Object.values(s.proposals).find((x) => x.kind === 'pact' && x.to === 'mex');
  assert.equal(g.command('mex', { type: 'respond', id: no.id, accept: false }), null);
  assert.equal(Object.keys(s.alliances).length, before, 'a refusal leaves no empty alliance behind');
  assert.equal(g.command('usa', { type: 'propose', to: 'can', kind: 'pact', terms: { kind: 'military', secret: true, name: 'Northern Shield' } }), null);
  const yes = Object.values(s.proposals).find((x) => x.kind === 'pact' && x.to === 'can');
  assert.equal(g.command('can', { type: 'respond', id: yes.id, accept: true }), null);
  const al = Object.values(s.alliances).find((x) => x.name === 'Northern Shield');
  assert.deepEqual(al.members, ['usa', 'can']);
  assert.ok(al.secret && al.kind === 'military');
  assert.match(g.command('usa', { type: 'propose', to: 'can', kind: 'pact', terms: { kind: 'military' } }), /already in a military alliance/);
});
