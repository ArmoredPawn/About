// World → Climate: how warm the world is getting and why, who emits the most, our carbon tax and pledge, and
// which of our provinces are most at risk.

import { h, flag, money, nationName, regionName, spark } from '../dom.js';
import { CARBON_TAX, PLEDGE_CUTS, START_TEMP, riskOf } from '../../engine/climate.js';
import { dateLabel } from '../../engine/core.js';

export function climate(ctx) {
  const s = ctx.state;
  const cl = s.climate;
  const me = s.you;
  if (!cl) return h('div.empty', 'No climate data yet.');
  const temps = cl.history.map((x) => x[1]);
  const emitters = Object.entries(s.countries).filter(([, c]) => !c.exile).sort((a, b) => (b[1].emissions ?? 0) - (a[1].emissions ?? 0)).slice(0, 12);
  const year = 2027 + Math.floor(s.week / 52);
  return h('div',
    h('div.kpis', { style: { marginBottom: '10px' } },
      h('div.kpi', h('span', 'Warming'), h('b', { class: cl.temp >= 2 ? 'bad' : cl.temp >= 1.5 ? 'warn' : '' }, `+${cl.temp.toFixed(2)} °C`), h('small', 'above pre-industrial')),
      h('div.kpi', h('span', 'Emissions'), h('b', `${Math.round(cl.world)} Gt`), h('small', 'of CO2 a year')),
      h('div.kpi', h('span', 'Extreme weather'), h('b', `×${cl.extreme.toFixed(2)}`), h('small', 'as often as in 2027'))),
    temps.length > 2 ? h('div', { style: { margin: '4px 0 8px' } }, spark(temps, '#e5a03c')) : null,
    h('p.muted.small', `CO2 is at ${cl.co2.toFixed(1)} ppm. Every billion tonnes burned warms the world a little, for good: heatwaves, floods, wildfires, storms and droughts come more often, and harvests fall in hot, dry lands while the far north gains. The next climate summit opens ${cl.nextSummit <= s.week ? 'now' : dateLabel(cl.nextSummit)}.`),
    me ? ours(ctx, year) : null,
    h('div.section', h('h3', 'The biggest emitters'),
      h('table.tbl', h('thead', h('tr', h('th', 'Country'), h('th.num', 'Gt CO2 a year'), h('th', 'Pledge'), h('th', 'Carbon tax'))),
        h('tbody', emitters.map(([id, c]) => h('tr.clickable', { class: id === s.me ? 'me' : '', onclick: () => ctx.openCountry(id) },
          h('td', h('span.row.gap', flag(id), nationName(s, id))),
          h('td.num', (c.emissions ?? 0).toFixed(1)),
          h('td', c.pledge ? h('span', `${c.pledge.cut}% by ${c.pledge.year} `, c.pledge.done ? null : h('span.chip', { class: c.pledge.onTrack ? 'good' : 'bad' }, c.pledge.onTrack ? 'on track' : 'off track')) : h('span.faint', 'none')),
          h('td', c.carbonTax ? CARBON_TAX[c.carbonTax].name : h('span.faint', 'none'))))))),
    risks(ctx));
}

function ours(ctx, year) {
  const s = ctx.state;
  const me = s.you;
  const level = me.carbonTax ?? 0;
  const p = me.pledgeDetail;
  let cut = 50;
  let by = year + 13;
  const cutSeg = h('div.seg', PLEDGE_CUTS.map((c) => { const b = h('button', { type: 'button', 'aria-pressed': String(c === cut), onclick: () => { cut = c; for (const x of cutSeg.children) x.setAttribute('aria-pressed', String(x === b)); } }, `${c}%`); return b; }));
  const years = [year + 8, year + 13, year + 23];
  const yearSeg = h('div.seg', years.map((y) => { const b = h('button', { type: 'button', 'aria-pressed': String(y === by), onclick: () => { by = y; for (const x of yearSeg.children) x.setAttribute('aria-pressed', String(x === b)); } }, String(y)); return b; }));
  const progress = p && !p.done ? Math.round((1 - (me.emissions ?? 0) / p.base) * 100) : null;
  return h('div.section', h('h3', 'Our emissions'),
    h('p.small', `We emit ${(me.emissions ?? 0).toFixed(2)} billion tonnes of CO2 a year, ${(((me.emissions ?? 0) / Math.max(1, s.climate.world)) * 100).toFixed(1)}% of the world's.`),
    h('div.field', { style: { marginTop: '8px' } }, h('span', 'Carbon tax'),
      h('div.seg', CARBON_TAX.map((t, i) => h('button', { 'aria-pressed': String(i === level), onclick: () => ctx.send({ type: 'carbonTax', level: i }) }, t.name)))),
    h('p.muted.small', { style: { marginTop: '4px' } }, level
      ? `Raises ${money(me.carbonRevenue ?? 0)} a year. Over a few years it cuts our oil and gas use by about ${Math.round(7 * level)}% (more for coal) and slows growth by about ${(0.12 * level).toFixed(2)} points; higher fuel prices cost a little approval in a democracy.`
      : 'A carbon tax moves people and firms off fossil fuels over a few years, raises money, and slows growth a little. Energy research (Research) cuts fuel use without the tax.'),
    p && !p.done
      ? h('div.warning', { class: progress >= 0 && (me.emissions ?? 0) <= (p.path ?? Infinity) * 1.05 ? 'info' : 'warn', style: { marginTop: '8px' } },
        `Our pledge: cut emissions ${p.cut}% by ${p.year}. So far: ${progress >= 0 ? `${progress}% down` : `${-progress}% up`}. ${(me.emissions ?? 0) <= (p.path ?? Infinity) * 1.05 ? 'On track.' : 'Off track: a carbon tax or energy research would help.'} Keeping it raises our standing; breaking it costs more.`)
      : h('div', { style: { marginTop: '8px' } },
        p?.done ? h('p.muted.small', `Our last pledge (${p.cut}% by ${p.year}) has been judged.`) : null,
        h('div.field', h('span', 'Pledge to cut our emissions by'), cutSeg),
        h('div.field', { style: { marginTop: '6px' } }, h('span', 'By'), yearSeg),
        h('div.actions', h('button.btn.small.primary', { onclick: () => ctx.send({ type: 'pledge', cut, year: by }) }, 'Make the pledge'))));
}

// Our provinces most exposed to a warmer world
function risks(ctx) {
  const s = ctx.state;
  const mine = Object.entries(ctx.regionIndex).filter(([, i]) => s.regions[i][1] === s.me).map(([id]) => [id, riskOf(id)]);
  if (!mine.length) return null;
  const worst = mine.sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  const warm = Math.max(0, s.climate.temp - START_TEMP);
  const label = (r) => [r.heat > 0.6 && 'heat', r.drought > 0.5 && 'drought', r.flood > 0.5 && 'floods', r.fire > 0.5 && 'wildfires'].filter(Boolean).join(', ') || 'mild';
  return h('div.section', h('h3', 'Our provinces most at risk'),
    h('div.list', worst.map(([id, r]) => h('div.item.clickable', { onclick: () => ctx.openRegion(id, true) },
      h('div.item-head', h('span.name', regionName(id)), h('span.mono.small', { style: { marginLeft: 'auto' } }, `risk ${Math.round(r.total * 100)}`)),
      h('div.meta', `${label(r)}${warm > 0.02 && (r.heat > 0.5 || r.drought > 0.5) ? ` · harvests down about ${Math.round(warm * (12 * r.heat + 10 * r.drought))}% so far` : ''}`)))),
    h('div.actions', h('button.btn.small.ghost', { onclick: () => ctx.mapMode('climate') }, 'Show climate risk on the map')));
}
