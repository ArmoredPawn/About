// Science and intelligence: technology fields, the research focus and what our spies can see.

import { h, flag, money, nationName, bar } from '../dom.js';
import { TECH_FIELDS } from '../../engine/data/world.js';
import { researchCost } from '../../engine/economy.js';

export function research(ctx) {
  const s = ctx.state;
  const me = s.you;
  const budget = (me.gdp * me.spend.research) / 100;
  const covered = Object.entries(me.intel ?? {}).filter(([, until]) => until > s.week);
  return h('div',
    h('div.panel-title', h('h2', 'Research & intelligence'), h('span.muted.small', `${money(budget)}/yr`)),
    h('p.muted.small', 'Research spending is set in Economy. The focus field gets 40% of it; the rest is shared. Education spending makes it go further.'),
    h('div.list', { style: { marginTop: '12px' } }, Object.entries(TECH_FIELDS).map(([f, d]) => {
      const cost = researchCost(me.tech[f]);
      const progress = me.progress[f] ?? 0;
      const share = f === me.focus ? 0.4 : 0.6 / 7;
      const perYear = budget * share;
      const years = perYear > 0 ? Math.max(0, (cost - progress) / perYear) : Infinity;
      return h('div.item', { class: f === me.focus ? 'clickable' : 'clickable', style: f === me.focus ? { borderColor: 'var(--accent)' } : null, onclick: () => ctx.send({ type: 'focus', field: f }) },
        h('div.item-head', h('span.name', d.name), f === me.focus ? h('span.chip.accent', 'Focus') : null, h('span.mono', `Lv ${me.tech[f]}`)),
        h('div.meta', d.note),
        h('div.row.gap.small', { style: { marginTop: '6px' } }, h('div.grow', bar(progress, cost)), h('span.faint', me.tech[f] >= 12 ? 'max' : years > 50 ? '50+ yr' : `${years.toFixed(1)} yr`)));
    })),
    h('div.section',
      h('h3', 'Intelligence coverage'),
      covered.length
        ? h('div.list', covered.map(([id, until]) => h('div.item.clickable', { onclick: () => ctx.openCountry(id) }, h('div.item-head', flag(id), h('span.name', nationName(s, id)), h('span.muted.small', `until week ${until}`)))))
        : h('div.empty', 'No active intelligence. Order "Gather intelligence" from a country\'s page in Diplomacy.'),
      h('p.muted.small', { style: { marginTop: '8px' } }, `Our cyber level is ${me.tech.cyber}. A higher level than the target makes operations more likely to work and less likely to be caught.`)),
  );
}
