// The world at a glance: power rankings, the market and the news.

import { h, flag, money, pct, nationName, spark, RES_COLORS } from '../dom.js';
import { RESOURCES, RESOURCE_INFO } from '../../engine/data/regions.js';

export function world(ctx) {
  const tab = ctx.sub('world', 'rankings');
  const tabs = [['rankings', 'Rankings'], ['market', 'Market'], ['news', 'News']];
  return h('div',
    h('div.panel-title', h('h2', 'The world'), ctx.state.winter ? h('span.chip.bad', 'Nuclear winter') : null),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('world', id) }, label))),
    { rankings, market, news }[tab](ctx));
}

function rankings(ctx) {
  const s = ctx.state;
  return h('div',
    h('p.muted.small', 'Power blends economic size, military strength, stability and standing. Growth is since the game began.'),
    h('table.tbl', { style: { marginTop: '10px' } },
      h('thead', h('tr', h('th', '#'), h('th', 'Country'), h('th.num', 'Power'), h('th.num', 'GDP'), h('th.num', 'Growth'))),
      h('tbody', s.ranks.map((r) => h('tr.clickable', { class: r.id === s.me ? 'me' : '', onclick: () => ctx.openCountry(r.id) },
        h('td', r.rank), h('td', h('span.row.gap', flag(r.id), h('span', nationName(s, r.id)), r.human ? h('span.chip.accent', r.human) : null, r.exile ? h('span.chip.bad', 'fallen') : null)),
        h('td.num', r.power.toFixed(1)), h('td.num', money(r.gdp)), h('td.num', { class: r.growth >= 0 ? 'good' : 'bad' }, pct(r.growth, 1, true)))))));
}

function market(ctx) {
  const s = ctx.state;
  return h('div',
    h('p.muted.small', 'World prices, as an index where 2025 = 100. Shortages, wars, blockades and closed straits push them up.'),
    h('div.list', { style: { marginTop: '10px' } }, RESOURCES.map((r) => h('div.item.clickable', { onclick: () => ctx.mapMode('resources', r) },
      h('div.item-head', h('span.res-dot', { style: { background: RES_COLORS[r] } }), h('span.name', RESOURCE_INFO[r].name), h('span.mono', { class: s.market.price[r] > 1.3 ? 'bad' : s.market.price[r] < 0.8 ? 'good' : '' }, Math.round(s.market.price[r] * 100))),
      spark(s.market.history[r], RES_COLORS[r])))));
}

function news(ctx) {
  const s = ctx.state;
  const items = [...s.news].reverse();
  return h('div.list', items.map((n) => h('div.item', { class: n.about?.length ? 'clickable' : '', onclick: n.about?.length ? () => ctx.focusCountry(n.about[n.about.length > 1 ? 1 : 0]) : null },
    h('div.item-head', h('span.chip', { class: { war: 'bad', nuclear: 'bad', peace: 'good', election: 'accent', un: 'accent', disaster: 'warn', unrest: 'warn' }[n.kind] ?? '' }, n.kind), h('span.muted.small', { style: { marginLeft: 'auto' } }, `week ${n.w}`)),
    h('div.meta', { style: { color: 'var(--ink)' } }, n.text))));
}
