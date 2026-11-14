// Economy → Markets: our currency, our stock market and our credit rating, what moves them, and what the central
// bank and the treasury can do about it: buy or sell our currency, capital controls, the IMF.

import { h, flag, money, pct, nationName, spark, bar } from '../dom.js';
import { modal, numberField, confirmBox } from '../dialogs.js';

const RATING_NOTE = {
  AAA: 'The safest borrower there is.', AA: 'Very safe.', A: 'Safe.', BBB: 'The lowest investment grade.',
  BB: 'Junk: speculative, borrowing gets dearer.', B: 'Junk: risky.', CCC: 'Close to default.', D: 'In default.',
};
const gradeTone = (r) => (['AAA', 'AA', 'A'].includes(r) ? 'good' : r === 'BBB' ? '' : ['BB', 'B'].includes(r) ? 'warn' : 'bad');

export function markets(ctx) {
  const s = ctx.state;
  const me = s.you;
  const f = me.finance;
  if (!f) return h('div.empty', 'No market data yet.');
  const fxMove = (f.fx / f.fxRef - 1) * 100;
  const stockMove = (f.stocks / f.stockRef - 1) * 100;
  const e = f.effects ?? {};
  return h('div',
    f.debtCrisis ? h('div.warning.bad', h('b', 'Debt crisis. '), 'The markets have stopped lending to us. Decide how to respond in the Cabinet, or ask the IMF below.') : null,
    f.defaulted ? h('div.warning.bad', h('b', 'In default. '), `We can't borrow until week ${f.defaulted.until}: any shortfall forces spending cuts.`) : null,
    f.imf ? h('div.warning.warn', h('b', 'IMF programme. '), `Until week ${f.imf.until}: bring the deficit down to 3% of GDP (now ${pct(me.deficit)}) and keep defence spending at or below ${f.imf.defence}% of GDP. Warnings so far: ${f.imf.warnings} of 2.`) : null,
    h('div.kpis', { style: { marginTop: '10px' } },
      h('div.kpi', h('span', 'Currency'), h('b', f.fx.toFixed(1)), h('small', { class: fxMove >= 0 ? 'good' : 'bad' }, `${fxMove >= 0 ? '+' : ''}${fxMove.toFixed(1)}% vs its average`)),
      h('div.kpi', h('span', 'Stock market'), h('b', f.stocks.toFixed(1)), h('small', { class: stockMove >= 0 ? 'good' : 'bad' }, `${stockMove >= 0 ? '+' : ''}${stockMove.toFixed(1)}% in 6 months`)),
      h('div.kpi', h('span', 'Credit rating'), h('b', { class: gradeTone(f.rating) }, f.rating), h('small', `borrowing at ${pct(me.bond)}`))),
    h('div.section',
      h('h3', 'Currency'), h('p.muted.small', 'Started the game at 100. Higher interest rates (after inflation) and stability strengthen it; inflation, debt, war, sanctions and crises weaken it.'),
      spark(f.hist.fx.length > 1 ? f.hist.fx : [f.fx, f.fx], 'var(--accent)'),
      h('h3', { style: { marginTop: '12px' } }, 'Stock market'), h('p.muted.small', 'Follows growth, war, unrest and interest rates, and the world\'s mood. It drifts back toward what the economy is really worth.'),
      spark(f.hist.stocks.length > 1 ? f.hist.stocks : [f.stocks, f.stocks], 'var(--good)')),
    h('div.section',
      h('h3', 'What the markets are doing to us'),
      effectRow('Growth', e.growth, ' points a year', true),
      effectRow('Inflation', e.infl, ' points', false),
      effectRow('Approval', e.approval, ' points', true),
      effectRow('Extra interest on new debt', e.spread, ' points', false),
      h('p.muted.small', 'A weak currency makes imports dearer (inflation) and exports cheaper; a falling stock market saps confidence. A poor rating makes borrowing dearer.')),
    debtGauge(me),
    h('div.section',
      h('h3', 'Credit rating'),
      h('div.row.gap', h('b', { class: gradeTone(f.rating), style: { fontSize: '22px' } }, f.rating), h('span.muted', RATING_NOTE[f.rating] ?? '')),
      h('div', { style: { marginTop: '6px' } }, bar(f.ratingScore, 100, gradeTone(f.rating))),
      h('p.muted.small', 'Agencies look at debt against what markets will bear, the deficit, borrowing costs, stability, reserves, how rich and how stable the country is, and any default. Below BBB is "junk".')),
    h('div.section',
      h('h3', 'Central bank and treasury'),
      h('div.actions',
        h('button.btn.small.primary', { onclick: () => fxDialog(ctx, 'buy') }, 'Support the currency…'),
        h('button.btn.small', { onclick: () => fxDialog(ctx, 'sell') }, 'Weaken the currency…'),
        h('button.btn.small', { class: f.controls ? 'warn' : '', onclick: () => controls(ctx, !f.controls) }, f.controls ? 'Lift capital controls' : 'Impose capital controls…'),
        !f.imf && !f.defaulted ? h('button.btn.small', { onclick: () => imf(ctx) }, 'Ask the IMF for a loan…') : null),
      h('p.muted.small', 'Buying our currency with reserves holds it up for a while; selling it makes exports cheaper and fills the treasury, at the cost of inflation. Capital controls stop money fleeing a crisis, but hurt growth and scare investors.')),
    worldMarkets(ctx));
}

// How far our debt is from where the markets stop lending
function debtGauge(me) {
  const lim = me.debtLimit ?? 150;
  const edge = Math.round(lim * 1.15);
  const safe = me.deficit <= 3;
  return h('div.section',
    h('h3', 'Debt and the markets'),
    h('div.row.between.small', h('span.muted', 'Debt'), h('span', `${Math.round(me.debtRatio)}% of GDP`)),
    h('div', { style: { marginTop: '4px' } }, bar(Math.min(me.debtRatio, edge), edge, me.debtRatio > lim ? 'bad' : me.debtRatio > lim * 0.8 ? 'warn' : 'good')),
    h('p.muted.small', safe
      ? `With the deficit at ${pct(me.deficit)} (3% or less), the markets keep lending unless debt passes about ${Math.round(lim * 1.6)}% of GDP.`
      : `The markets stop lending once debt passes about ${edge}% of GDP while we're still running a deficit over 3% (now ${pct(me.deficit)}). Debt over ${Math.round(lim * 0.6)}% already costs us in the credit rating.`));
}

function effectRow(label, v = 0, unit, positiveGood) {
  const good = positiveGood ? v >= 0 : v <= 0;
  const text = Math.abs(v) < 0.05 ? 'none' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit}`;
  return h('div.row.between.small', h('span.muted', label), h('span', { class: Math.abs(v) < 0.05 ? '' : good ? 'good' : 'bad' }, text));
}

function worldMarkets(ctx) {
  const s = ctx.state;
  const rows = Object.entries(s.countries).filter(([, c]) => c.fin && !c.exile && c.gdp > 300).sort(([, a], [, b]) => b.gdp - a.gdp).slice(0, 20);
  const mood = s.you.finance.mood;
  return h('div.section',
    h('h3', 'World markets'),
    h('p.muted.small', `Investors are ${mood < -0.4 ? 'panicking' : mood < -0.1 ? 'nervous' : mood > 0.2 ? 'euphoric' : 'calm'}.`),
    h('table.tbl', h('thead', h('tr', h('th', 'Country'), h('th.num', 'Currency'), h('th.num', 'Stocks'), h('th.num', 'Rating'))),
      h('tbody', rows.map(([id, c]) => h('tr.clickable', { class: id === s.me ? 'me' : '', onclick: () => ctx.openCountry(id) },
        h('td', h('span.row.gap', flag(id), nationName(s, id), c.fin.crisis ? h('span.chip.bad', 'crisis') : null, c.fin.imf ? h('span.chip.warn', 'IMF') : null, c.fin.defaulted ? h('span.chip.bad', 'default') : null)),
        h('td.num', { class: c.fin.fx >= 100 ? 'good' : 'bad' }, c.fin.fx), h('td.num', { class: c.fin.stocks >= 100 ? 'good' : 'bad' }, c.fin.stocks),
        h('td.num', { class: gradeTone(c.fin.rating) }, c.fin.rating ?? '—'))))));
}

function fxDialog(ctx, way) {
  const me = ctx.state.you;
  const max = Math.max(1, Math.floor(Math.min(way === 'buy' ? me.treasury : Infinity, me.gdp * 0.1)));
  const amount = numberField(way === 'buy' ? 'Reserves to spend' : 'Currency to sell', { value: Math.max(1, Math.round(max / 4)), min: 1, max, suffix: '$ billions' });
  modal({
    title: way === 'buy' ? 'Support the currency' : 'Weaken the currency',
    body: h('div.stack', amount.el, h('p.muted.small', way === 'buy'
      ? `The central bank buys our currency with reserves (${money(me.treasury)} available). It rises at once and the support fades over a few months.`
      : 'The central bank sells our currency: it falls, our exports get cheaper and the money goes into reserves, but imports and prices rise.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: way === 'buy' ? 'Buy' : 'Sell', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fxIntervene', amount: (way === 'buy' ? 1 : -1) * Number(amount.input.value) })) || false }],
  });
}

async function controls(ctx, on) {
  if (on && !(await confirmBox('Impose capital controls?', 'Money can no longer leave the country freely: the currency stops falling as fast, but growth slows, the stock market sags and investors and other governments think less of us.'))) return;
  ctx.send({ type: 'capitalControls', on });
}

async function imf(ctx) {
  const me = ctx.state.you;
  if (!(await confirmBox('Ask the IMF for a loan?', `A loan of about ${money(me.gdp * 0.1)} at low interest. In return we must bring the deficit down to 3% of GDP within two years and not raise defence spending. Break the conditions twice and the money stops. Only countries in trouble (rated BB or below, or in a debt crisis) can ask.`))) return;
  ctx.send({ type: 'imf' });
}
