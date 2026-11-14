// The world at a glance: power rankings, and the climate. (Prices and trade are under Market, the news under
// News.)

import { h, flag, money, pct, nationName } from '../dom.js';
import { climate } from './climate.js';
import { crisesPanel } from './crises.js';

export function world(ctx) {
  const tab = ctx.sub('world', 'rankings');
  const live = ctx.state.crises?.active?.length ?? 0;
  const tabs = [['rankings', 'Rankings'], ['crises', live ? `Crises (${live})` : 'Crises'], ['climate', 'Climate']];
  return h('div',
    h('div.panel-title', h('h2', 'The world'), ctx.state.winter ? h('span.chip.bad', 'Nuclear winter') : null),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('world', id) }, label))),
    tab === 'climate' ? climate(ctx) : tab === 'crises' ? crisesPanel(ctx) : rankings(ctx),
    tab !== 'rankings' ? null : h('div.row.gap', { style: { marginTop: '12px' } },
      h('button.btn.small', { onclick: () => ctx.go('market', 'prices') }, 'World prices'),
      h('button.btn.small', { onclick: () => ctx.go('news') }, 'World news')));
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
