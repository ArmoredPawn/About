// Encirclement, pincers, doctrine, allies at the front, hunting shipping, new fleets from port, and shipping lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { updatePockets, breakthroughOf, placeArmy, pocketCells } from '../public/js/engine/military.js';
import { provinceCell, CELLS_OF, holderAt } from '../public/js/engine/land.js';
import { fx, planDoctrine, doctrineTick, SYNERGIES } from '../public/js/engine/doctrine.js';
import { shipAt, spawnOption } from '../public/js/engine/shipping.js';
import { routeShape } from '../public/js/engine/routes.js';
import { startWar } from '../public/js/engine/diplomacy.js';
import { PORTS } from '../public/js/engine/navy.js';

function justify(g, a, b) {
  const c = g.s.countries[a];
  c.warCases = { ...(c.warCases ?? {}), [b]: { ready: 0, until: 99999, since: 0 } };
}
function game(seed = 1, leader = 'usa') {
  const g = Game.create({ seed });
  g.setLeader(leader, 'Tester');
  return g;
}
const week = (g) => { for (let i = 0; i < 8; i++) g.step(0.125); g.tick(); };

// Germany holds Lower Silesia, Silesia and Warsaw, joined to Germany itself: Eastern Poland is cut off from the
// rest of the country
function polishPocket(seed = 2) {
  const g = game(seed, 'pol');
  const s = g.s;
  startWar(s, 'deu', 'pol');
  for (const id of ['pol-lw', 'pol-si', 'pol-wa']) s.regions[id].ctrl = 'deu';
  assert.equal(g.command('pol', { type: 'armyCreate', region: 'pol-ea', troops: 60, tanks: 0 }), null);
  const a = Object.values(s.armies).find((x) => x.owner === 'pol' && x.region === 'pol-ea');
  return { g, s, a };
}
// The pocket a province's heart is in, if any
const pocketOf = (s, id) => Object.values(s.pocketList ?? {}).find((p) => pocketCells(p).includes(provinceCell(id)));

test('ground cut off from the heartland is a pocket, and the armies in it weaken every week', () => {
  const { g, s, a } = polishPocket();
  updatePockets(s);
  const p = pocketOf(s, 'pol-ea');
  assert.ok(p, 'Eastern Poland is encircled');
  assert.equal(p.holder, 'pol');
  assert.ok(!pocketOf(s, 'pol-wp'), 'the rest of Poland is still supplied');
  assert.ok(s.news.some((n) => /Encircled: Poland's forces around/.test(n.text)), 'the world hears of it');
  const org = a.org;
  const men = a.troops;
  a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: 'balanced' };
  week(g);
  assert.ok(a.pocket, 'the army knows it is surrounded');
  assert.ok(a.supply <= 0.25, `supply runs dry (${a.supply})`);
  assert.ok(a.org < org, 'organisation drains');
  assert.ok(a.troops < men, 'men are lost');
  const view = g.view('pol');
  assert.ok(view.pockets.some((x) => x.id === a.pocket && x.runs.length), 'the pocket is on the map');
  assert.ok(view.armies.find((x) => x.id === a.id).pocket, 'and on the army card');
});

test('an airlift keeps a surrounded army supplied, at a cost in aircraft', () => {
  const { g, s, a } = polishPocket(3);
  updatePockets(s);
  a.op = { kind: 'hold', target: a.region, at: [a.x, a.y], aggr: 'balanced' };
  week(g);
  const before = a.supply;
  const planes = s.countries.pol.aircraft;
  assert.equal(g.command('pol', { type: 'armyAirlift', id: a.id, aircraft: 80 }), null);
  assert.ok(a.supply > before, 'supplies fly in at once');
  week(g);
  assert.ok(a.supply > 0.35 && a.supply > before, `the airlift keeps it supplied (${a.supply})`);
  assert.ok(s.countries.pol.aircraft <= planes, 'aircraft are lost on the way');
  assert.match(g.command('pol', { type: 'armyAirlift', id: a.id, aircraft: 99999 }), /aircraft free/);
});

test('a surrounded army can break out toward its lines, or surrender', () => {
  const { g, s, a } = polishPocket(4);
  updatePockets(s);
  week(g);
  assert.equal(g.command('pol', { type: 'armyBreakout', id: a.id }), null);
  assert.equal(a.op.kind, 'advance', 'it attacks through the ring');
  assert.ok(a.breakout > s.week, 'with the strength of desperation');
  assert.match(a.status, /Breaking out/);
  const troops = s.countries.pol.troops;
  assert.equal(g.command('pol', { type: 'armySurrender', id: a.id }), null);
  assert.ok(!s.armies[a.id], 'the army is gone');
  assert.ok(s.countries.pol.troops < troops, 'its men are prisoners');
  assert.ok(s.news.some((n) => /surrenders/.test(n.text)));
});

test('a corridor reopened to the pocket relieves it', () => {
  const { s } = polishPocket(5);
  updatePockets(s);
  assert.ok(pocketOf(s, 'pol-ea'));
  s.regions['pol-si'].ctrl = 'pol';
  updatePockets(s);
  assert.ok(!pocketOf(s, 'pol-ea'), 'no longer cut off');
  assert.ok(s.news.some((n) => /is relieved/.test(n.text)));
});

test('ground inside a ring with no army to hold it falls to the encircler', () => {
  const { g, s, a } = polishPocket(6);
  delete s.armies[a.id];
  updatePockets(s);
  assert.ok(pocketOf(s, 'pol-ea'));
  for (let i = 0; i < 3; i++) week(g);
  const held = [...CELLS_OF['pol-ea']].filter((i) => holderAt(s, i) === 'deu').length;
  assert.ok(held > CELLS_OF['pol-ea'].length * 0.8, `its garrisons give up (${held} of ${CELLS_OF['pol-ea'].length} cells)`);
  assert.ok(s.news.some((n) => /cut off with no army to relieve them, surrender/.test(n.text)));
});

test('attacking an army from two sides is a pincer, and hits harder', () => {
  const g = game(6, 'deu');
  const s = g.s;
  justify(g, 'deu', 'pol');
  assert.equal(g.command('deu', { type: 'war', target: 'pol', goal: 'conquest' }), null);
  // A Polish army in Silesia; German armies come at it from Warsaw (north-east) and Lower Silesia (west)
  s.countries.pol.human = { name: 'Warsaw' };
  assert.equal(g.command('pol', { type: 'armyCreate', region: 'pol-si', troops: 80 }), null);
  const p = Object.values(s.armies).find((x) => x.owner === 'pol');
  s.regions['pol-wa'].ctrl = 'deu';
  s.regions['pol-lw'].ctrl = 'deu';
  assert.equal(g.command('deu', { type: 'armyCreate', region: 'pol-wa', troops: 120, tanks: 120 }), null);
  assert.equal(g.command('deu', { type: 'armyCreate', region: 'pol-lw', troops: 120, tanks: 120 }), null);
  const mine = Object.values(s.armies).filter((x) => x.owner === 'deu');
  // Both close enough to strike, from about a hundred degrees apart
  placeArmy(mine[0], p.x + 5, p.y - 5);
  placeArmy(mine[1], p.x - 7, p.y + 1);
  for (const a of mine) assert.equal(g.command('deu', { type: 'armyOrder', id: a.id, kind: 'attack', enemy: p.id }), null);
  for (let i = 0; i < 4; i++) g.step(0.125);
  const b = Object.values(s.battles).find((x) => x.def === p.id);
  assert.ok(b?.pincer, 'the attacks converge');
  assert.ok(s.news.some((n) => /Pincer movement/.test(n.text)));
  assert.ok(breakthroughOf(s, mine[0]) > 0.2, 'German armour breaks through');
});

test('a people defending its homeland raises a home guard', () => {
  const g = game(7, 'rus');
  const s = g.s;
  justify(g, 'rus', 'pol');
  assert.equal(g.command('rus', { type: 'war', target: 'pol', goal: 'conquest' }), null);
  s.countries.pol.human = { name: 'Warsaw' };
  assert.equal(g.command('pol', { type: 'armyCreate', region: 'pol-wp', troops: 60 }), null);
  const p = Object.values(s.armies).find((x) => x.owner === 'pol');
  assert.equal(g.command('rus', { type: 'armyCreate', region: 'rus-kl', troops: 200, tanks: 500 }), null);
  const a = Object.values(s.armies).find((x) => x.owner === 'rus');
  assert.equal(g.command('rus', { type: 'armyOrder', id: a.id, kind: 'attack', enemy: p.id }), null);
  let b = null;
  for (let i = 0; i < 16 && !b; i++) { g.step(0.125); b = Object.values(s.battles ?? {}).find((x) => x.def === p.id && x.started); }
  assert.ok(b?.militia > 5, `the Poles take up arms (${b?.militia}K)`);
  assert.match(a.status, /home guard|pushing/);
});

test('a new doctrine is developed, trained in, and changes how the army fights', () => {
  const g = game(8, 'ind');
  const s = g.s;
  const c = s.countries.ind;
  const before = fx(s, 'ind');
  assert.equal(c.doctrine.picks.offence, 'broad');
  const picks = { ...c.doctrine.picks, offence: 'maneuver', air: 'support', command: 'mission' };
  assert.equal(g.command('ind', { type: 'doctrine', picks, name: 'Cold Start' }), null);
  assert.ok(c.doctrine.draft, 'the staff gets to work');
  assert.match(g.command('ind', { type: 'doctrine', picks: { ...picks, offence: 'nope' } }), /Pick how/);
  const weeks = c.doctrine.draft.weeks;
  for (let i = 0; i < weeks; i++) g.tick();
  assert.equal(c.doctrine.picks.offence, 'maneuver');
  assert.equal(c.doctrine.name, 'Cold Start');
  assert.ok(c.doctrine.ready.offence < 1, 'not yet trained in it');
  const after = fx(s, 'ind');
  assert.ok((after.breakthrough ?? 0) > (before.breakthrough ?? 0), 'it breaks through better');
  // Mastered in battle, the pieces become Blitzkrieg
  for (const k of ['maneuver', 'support', 'mission']) c.doctrine.mastery[k] = 0.9;
  for (let i = 0; i < 30 && c.innovations.blitz == null; i++) doctrineTick(s);
  assert.ok(c.innovations.blitz != null, 'a new way of war');
  assert.ok(s.news.some((n) => /new way of war: Blitzkrieg/.test(n.text)), 'the world takes note of the pioneer');
  assert.ok(SYNERGIES.find((x) => x.id === 'blitz'));
});

test('computer-run allies send armies to fight beside a country under attack', () => {
  const g = game(9, 'rus');
  const s = g.s;
  // Germany and Poland in one alliance; Russia attacks Poland
  const al = 'al-test';
  s.alliances[al] = { id: al, name: 'Test Pact', kind: 'military', members: ['pol', 'deu'], founder: 'pol', since: 0 };
  justify(g, 'rus', 'pol');
  assert.equal(g.command('rus', { type: 'war', target: 'pol', goal: 'conquest' }), null);
  for (let i = 0; i < 3; i++) week(g);
  assert.ok(s.wars.some((w) => [w.a, w.b].includes('deu') && [w.a, w.b].includes('rus')), 'Germany honours the alliance');
  for (let i = 0; i < 10; i++) week(g);
  const german = Object.values(s.armies).filter((a) => a.owner === 'deu');
  assert.ok(german.some((a) => s.regions[a.region].ctrl === 'pol' || s.regions[a.op.target]?.ctrl === 'pol' || a.attacking), `Germany sends troops to the Polish front (${german.map((a) => `${a.name}@${a.region}`).join(', ')})`);
});

// A cargo bound for Japan by sea, with a Chinese fleet set up to meet it
function cargoForJapan(seed) {
  const g = game(seed, 'jpn');
  g.setLeader('chn', 'Raider');
  g.tick();
  const seller = g.view('jpn').market.sellers.oil.find((x) => !x.covert && x.route?.mode === 'sea');
  assert.equal(g.command('jpn', { type: 'marketBuy', res: 'oil', qty: 3, from: seller.id }), null);
  const sh = g.s.shipments.find((x) => x.buyer === 'jpn');
  g.step(0.125);
  return { g, s: g.s, sh, seller: seller.id };
}

test('a voyage takes as long as its lane is long', () => {
  const { sh } = cargoForJapan(30);
  assert.ok(sh.sized && sh.total >= 2, `a long haul takes weeks (${sh.total})`);
});

test('a new fleet can be put to sea from the port nearest a cargo\'s route', () => {
  const { g, s, sh } = cargoForJapan(31);
  // All Chinese warships back in port
  for (const f of Object.values(s.fleets)) if (f.owner === 'chn') delete s.fleets[f.id];
  const opt = spawnOption(s, 'chn', sh);
  assert.ok(opt?.port && opt.weeks != null, 'a port that can meet it');
  const seen = g.view('chn').shipments.find((x) => x.id === sh.id);
  assert.ok(seen.spawn, 'the leader is offered it');
  assert.equal(g.command('chn', { type: 'intercept', id: sh.id, fleet: 'new', how: 'sink' }), null);
  const f = Object.values(s.fleets).find((x) => x.owner === 'chn' && x.mission === 'intercept');
  assert.ok(f && f.target === sh.id, 'it puts to sea and goes after it');
  assert.equal(f.how, 'sink');
});

test('a fleet hunting shipping in a sea goes after enemy cargo there; a failure is told only to the hunter', () => {
  const { g, s, sh, seller } = cargoForJapan(32);
  startWar(s, 'chn', 'jpn');
  const fleet = Object.values(s.fleets).find((f) => f.owner === 'chn');
  const [x, y] = shipAt(s, sh, 0.6);
  Object.assign(fleet, { x, y, route: [], ships: 40, org: 90 });
  for (const f of Object.values(s.fleets)) if (f.owner === 'jpn') { f.x = 5; f.y = 5; }
  assert.equal(g.command('chn', { type: 'fleetRaid', id: fleet.id, how: 'sink' }), null);
  assert.equal(g.command('chn', { type: 'fleetOrder', id: fleet.id, x, y, mission: 'raid', mode: 'enemies' }), null);
  assert.equal(fleet.mission, 'raid');
  assert.ok(fleet.raidSea, 'it hunts in the sea it was sent to');
  for (let i = 0; i < 80 && !sh.done; i++) { g.step(0.125); if ((s.stepped ?? 0) >= 0.999) g.tick(); }
  const told = (cid, re) => s.countries[cid]?.inbox.some((m) => re.test(m.text));
  if (sh.done && s.news.some((n) => /China sank a cargo of oil/.test(n.text))) {
    assert.ok(told('chn', /^Sunk:/), 'the hunter is told');
    assert.ok(told('jpn', /China sank the shipment/), 'so is the buyer');
  }
  // Whatever happened, the buyer never hears of an attempt that failed
  assert.ok(!told('jpn', /tried to stop|escorts got it through/), 'failures stay with the hunter');
  if (s.countries[seller]) assert.ok(!told(seller, /tried to stop/));
});

test('a shipping line carries the trade between two countries; a private one is hidden, but the waters it crosses can find it', () => {
  const g = game(40, 'usa');
  const s = g.s;
  const from = Object.values(s.regions).find((r) => r.ctrl === 'usa' && PORTS[r.id] && /fl|se|gu/.test(r.id))?.id ?? Object.values(s.regions).find((r) => r.ctrl === 'usa' && PORTS[r.id]).id;
  const to = Object.values(s.regions).find((r) => r.ctrl === 'bra' && PORTS[r.id]).id;
  const shape = routeShape(s, from, to);
  assert.ok(shape && shape.km > 1000, 'a line over the water');
  const before = s.countries.usa.treasury;
  assert.equal(g.command('usa', { type: 'routeOpen', from: { region: from }, to: { region: to }, private: true, name: 'Secret Line' }), null);
  assert.ok(s.countries.usa.treasury < before, 'it costs money to open');
  const line = Object.values(s.routes)[0];
  assert.equal(line.partner, 'bra');
  assert.match(g.command('usa', { type: 'routeOpen', from: { region: from }, to: { region: to } }), /already open/);
  // A cargo between the two sails it
  g.tick();
  const seller = g.view('usa').market.sellers.food?.find((x) => x.id === 'bra') ?? g.view('usa').market.sellers.iron?.find((x) => x.id === 'bra');
  if (seller) {
    const res = g.view('usa').market.sellers.food?.some((x) => x.id === 'bra') ? 'food' : 'iron';
    assert.equal(g.command('usa', { type: 'marketBuy', res, qty: 0.5, from: 'bra' }), null);
    g.step(0.125);
    const sh = s.shipments.find((x) => x.buyer === 'usa' && x.seller === 'bra');
    assert.equal(sh.lane.route, line.id, 'the cargo sails the line');
    const outsider = Object.keys(s.countries).find((id) => !['usa', 'bra'].includes(id) && !line.crosses.includes(id) && !s.countries[id].minor);
    assert.ok(!g.view(outsider).shipments.some((x) => x.id === sh.id), 'a private line\'s ships are hidden');
  }
  // A country whose waters it crosses is likely to notice it
  const watcher = line.crosses[0];
  if (watcher && s.countries[watcher]) {
    line.traffic = s.week;
    for (let i = 0; i < 80 && line.known[watcher] == null; i++) { line.traffic = s.week; g.tick(); }
    assert.ok(line.known[watcher] != null, `${watcher} finds the line in its waters`);
    assert.ok(g.view(watcher).routes.some((r) => r.id === line.id), 'and sees it from then on');
  }
});
