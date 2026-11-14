// Money and markets, global crises, coups and regime change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/engine/game.js';
import { startPandemic, startCrash, startFamine, startTerrorIn } from '../public/js/engine/crises.js';
import { regimeChange } from '../public/js/engine/coups.js';
import { rel } from '../public/js/engine/core.js';

function game(seed = 1, leader = 'usa') {
  const g = Game.create({ seed });
  g.setLeader(leader, 'Tester');
  return g;
}
const week = (g, n = 1) => { for (let w = 0; w < n; w++) { for (let i = 0; i < 3; i++) g.step(1 / 3); g.tick(); } };
const decisionFor = (g, cid, key) => g.s.countries[cid].decisions?.find((d) => d.key === key);

/* ---------- Money and markets ---------- */

test('every country has a currency, a stock market and a credit rating that respond to policy', () => {
  const g = game(3, 'gbr');
  const s = g.s;
  week(g, 2);
  const gbr = s.countries.gbr;
  assert.ok(gbr.fx > 50 && gbr.stocks > 50 && gbr.rating, 'indexes and rating');
  assert.equal(s.countries.deu.rating[0], 'A', 'Germany is rated in the A range');
  assert.ok(['B', 'BB', 'CCC'].includes(s.countries['m-chad'].rating), 'Chad is not');
  // Buying our own currency with reserves holds it up
  const before = gbr.fx;
  assert.equal(g.command('gbr', { type: 'fxIntervene', amount: 50 }), null);
  assert.ok(gbr.fx > before, 'the pound rises');
  assert.match(g.command('gbr', { type: 'fxIntervene', amount: 1e6 }) ?? '', /reserves|most/);
  // Investment-grade countries don't need the IMF
  assert.match(g.command('gbr', { type: 'imf' }) ?? '', /in trouble/);
  const view = g.view('gbr');
  assert.ok(view.you.finance.hist && view.countries.usa.fin.rating, 'leaders see markets');
});

test('a debt crisis forces a choice: the IMF lends with conditions; a default writes off debt and shuts the markets', () => {
  const g = game(4, 'arg');
  const s = g.s;
  const arg = s.countries.arg;
  arg.debt = arg.gdp * 2.2;
  arg.bond = 14;
  arg.treasury = 0;
  arg.deficit = 8;
  week(g);
  assert.ok(arg.debtCrisis, 'the markets stop lending');
  const d = decisionFor(g, 'arg', 'debtCrisis');
  assert.ok(d, 'Argentina must decide');
  assert.equal(g.command('arg', { type: 'decide', id: d.id, option: 'imf' }), null);
  assert.ok(arg.imf && arg.treasury > arg.gdp * 0.05, 'an IMF loan with conditions');
  assert.equal(arg.debtCrisis, null);

  // A computer-run country in the same mess decides for itself
  const g2 = game(5, 'usa');
  const egy = g2.s.countries.egy;
  egy.gov = 'autocracy';
  egy.debt = egy.gdp * 3;
  egy.bond = 15;
  egy.treasury = 0;
  egy.deficit = 9;
  week(g2);
  assert.ok(egy.defaulted || egy.imf || egy.infl > 0, 'Egypt chose');
  const debt = egy.debt;
  if (egy.defaulted) assert.equal(egy.rating, 'D');
  else assert.ok(debt > 0);
});

/* ---------- Crises ---------- */

test('a pandemic spreads country to country, leaders choose lockdowns, and a funded vaccine ends it', () => {
  const g = game(6, 'ita');
  const s = g.s;
  const x = startPandemic(s, 'chn');
  assert.ok(x && x.inf.chn > 0);
  for (let i = 0; i < 30; i++) week(g);
  assert.ok(x.reached.length > 5, `it spread (${x.reached.length} countries)`);
  if (x.reached.includes('ita') && decisionFor(g, 'ita', 'pandemic')) {
    const d = decisionFor(g, 'ita', 'pandemic');
    assert.ok(d, 'Italy is asked how to respond');
    assert.equal(g.command('ita', { type: 'decide', id: d.id, option: 'full' }), null);
    assert.equal(s.countries.ita.pandemic.policy, 'full');
    assert.equal(g.command('ita', { type: 'pandemicPolicy', borders: true }), null);
    assert.ok(s.countries.ita.pandemic.borders);
  }
  assert.ok(s.countries.chn.cx.growth < 0, 'the economy suffers');
  assert.equal(g.command('ita', { type: 'vaccineFund', amount: 20 }), null);
  assert.ok(x.funds.ita === 20);
  for (let i = 0; i < 150 && s.crises.includes(x); i++) week(g);
  assert.ok(x.vaccine >= 1, 'a vaccine was made');
  assert.ok(Object.values(x.deaths).reduce((t, v) => t + v, 0) > 1, 'people died');
  assert.ok(g.view('ita').crises, 'leaders see the crisis');
});

test('a crash hits markets worldwide; banks need rescuing and the summit decides how fast the world recovers', () => {
  const g = game(7, 'jpn');
  const s = g.s;
  const before = s.countries.jpn.stocks;
  const x = startCrash(s, 'usa');
  assert.ok(s.countries.usa.stocks < 80, 'Wall Street crashes');
  assert.ok(s.countries.jpn.stocks < before, 'markets fall worldwide');
  const banks = decisionFor(g, 'jpn', 'banks');
  assert.ok(banks);
  assert.equal(g.command('jpn', { type: 'decide', id: banks.id, option: 'bailout' }), null);
  week(g, 4);
  const summit = decisionFor(g, 'jpn', 'summit');
  assert.ok(summit, 'Japan is invited to the summit');
  assert.equal(g.command('jpn', { type: 'decide', id: summit.id, option: 'join' }), null);
  assert.ok(x.summit.joined.includes('jpn') && x.summit.joined.length > 1);
  week(g);
  assert.ok(s.countries.deu.cx.growth < 0, 'recession');
});

test('famines and terror attacks: aid saves lives and wins friends; an attack can be blamed on whoever sheltered it', () => {
  const g = game(8, 'fra');
  const s = g.s;
  const x = startFamine(s, 'm-ethiopia');
  const d = decisionFor(g, 'fra', 'famineAid');
  assert.ok(d, 'France is asked to help');
  const r0 = rel(s, 'fra', 'm-ethiopia');
  assert.equal(g.command('fra', { type: 'decide', id: d.id, option: 'large' }), null);
  assert.ok(rel(s, 'fra', 'm-ethiopia') > r0 && x.aid.fra > 0);
  week(g, 3);
  assert.ok(x.deaths > 0 && x.severity < 0.6);

  // An attack in France by a group sheltered in a country at war with it
  g.command('fra', { type: 'war', target: 'm-libya' });
  startTerrorIn(s, 'fra');
  const t = decisionFor(g, 'fra', 'terror');
  assert.ok(t);
  const strike = t.options.find((o) => o.id === 'strike');
  if (strike) {
    assert.equal(g.command('fra', { type: 'decide', id: t.id, option: 'strike' }), null);
    assert.ok(rel(s, 'fra', t.data.haven) < -30);
  } else assert.equal(g.command('fra', { type: 'decide', id: t.id, option: 'crackdown' }), null);
});

test('decisions left unanswered take the cautious default', () => {
  const g = game(9, 'deu');
  startFamine(g.s, 'm-chad');
  const d = decisionFor(g, 'deu', 'famineAid');
  assert.ok(d);
  week(g, 6);
  assert.ok(!decisionFor(g, 'deu', 'famineAid'), 'gone');
  assert.ok(g.s.countries.deu.inbox.some((m) => /No answer in time/.test(m.text)));
});

/* ---------- Coups and regime change ---------- */

test('an unstable country with a disloyal army is at risk of a coup, and a coup puts the generals in charge', () => {
  const g = game(10, 'usa');
  const s = g.s;
  const nga = s.countries['m-nigeria'];
  nga.stability = 15;
  nga.approval = 10;
  nga.army.loyalty = 20;
  week(g);
  assert.ok(nga.coup.risk >= 50, `high risk (${nga.coup.risk})`);
  assert.ok(nga.coup.why.length >= 3, 'with reasons');
  regimeChange(s, nga, { kind: 'junta' });
  assert.equal(nga.gov, 'autocracy');
  assert.equal(nga.regime.kind, 'junta');
  assert.equal(nga.electionWeek, null);
  assert.ok(s.news.some((n) => /army seizes power in Nigeria/.test(n.text)));
  // Juntas already in power in 2027
  assert.equal(s.countries['m-mali'].regime.kind, 'junta');
});

test('leaders can buy off or purge their generals, back coups abroad through their spies, and hand power back', () => {
  const g = game(11, 'rus');
  const s = g.s;
  const rus = s.countries.rus;
  const l0 = rus.army.loyalty;
  assert.equal(g.command('rus', { type: 'payGenerals' }), null);
  week(g);
  assert.ok(rus.army.paidUntil > s.week && rus.army.loyalty >= l0);
  assert.match(g.command('rus', { type: 'backCoup', target: 'm-georgia', amount: 1 }) ?? '', /spy network/);
  rus.spies['m-georgia'] = { agents: 4, since: 0 };
  assert.equal(g.command('rus', { type: 'backCoup', target: 'm-georgia', amount: 1 }), null);
  const geo = s.countries['m-georgia'];
  week(g);
  assert.ok(geo.coup.why.some(([, why]) => /foreign money/.test(why)), 'the money raises its coup risk');
  // A coup backed by Russia leaves a government friendly to it
  regimeChange(s, geo, { kind: 'junta', patron: 'rus' });
  assert.ok(rel(s, 'rus', 'm-georgia') >= 60 && s.treaties.some((t) => t.kind === 'access' && t.a === 'rus' && t.b === 'm-georgia'));
  // A junta led by a person can step aside once the country is calm
  g.setLeader('rus', null);
  const g2 = game(12, 'tha');
  const tha = g2.s.countries.tha;
  regimeChange(g2.s, tha, { kind: 'junta' });
  tha.stability = 70;
  assert.equal(g2.command('tha', { type: 'civilianRule' }), null);
  assert.notEqual(tha.gov, 'autocracy', 'civilians rule again');
  assert.ok(tha.electionWeek > g2.s.week);
});

test('a peace treaty can install a friendly government in the beaten country', () => {
  const g = game(13, 'usa');
  const s = g.s;
  g.command('usa', { type: 'war', target: 'm-cuba' });
  // Cuba accepts only when beaten: occupy it first
  s.regions['m-cuba'].ctrl = 'usa';
  const err = g.command('usa', { type: 'propose', to: 'm-cuba', kind: 'peace', terms: { regime: 'm-cuba' } });
  assert.equal(err, null);
  week(g);
  const cuba = s.countries['m-cuba'];
  assert.equal(cuba.regime?.kind, 'installed', 'a new government');
  assert.equal(cuba.regime.patron, 'usa');
  assert.equal(cuba.gov, 'democracy');
  assert.ok(!s.wars.some((w) => [w.a, w.b].includes('m-cuba')), 'the war is over');
});

test('well-run countries rarely hit a debt crisis: two years of peace and no country gets one', () => {
  const g = game(14, 'deu');
  const s = g.s;
  const struck = new Set();
  const fought = new Set();
  for (let w = 0; w < 104; w++) {
    week(g);
    for (const x of s.wars) { fought.add(x.a); fought.add(x.b); }
    for (const c of Object.values(s.countries)) if (c.debtCrisis) struck.add(c.id);
  }
  const peaceful = [...struck].filter((id) => !fought.has(id));
  assert.deepEqual(peaceful, [], `debt crises without a war: ${peaceful.join(', ')}`);
  assert.ok(!s.countries.deu.debtCrisis, 'a leader who keeps the starting budget is safe');
  assert.ok(Object.values(s.countries).filter((c) => !c.exile).every((c) => c.deficit < 12 || fought.has(c.id)), 'no runaway deficits in peacetime');
});
