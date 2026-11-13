// Research: better technology costs money and time. Fund a project, wait for the scientists, and import the
// semiconductors or uranium the most advanced work needs, or buy a licence from a country further ahead.

import { h, flag, money, nationName, bar } from '../dom.js';
import { TECH_FIELDS } from '../../engine/data/world.js';
import { projectCost, projectWeeks, projectNeeds, researchSpeed, maxResearch, MAX_TECH } from '../../engine/science.js';
import { confirmBox, modal, selectField } from '../dialogs.js';

const NEED_NAMES = { chip: 'semiconductors', uran: 'uranium' };

export function research(ctx) {
  const s = ctx.state;
  const me = s.you;
  const running = me.research ?? [];
  const slots = maxResearch(me);
  const speed = researchSpeed(me);
  return h('div',
    h('div.panel-title', h('h2', 'Research'), h('span.muted.small', `${running.length}/${slots} projects`)),
    h('p.muted.small', `Fund a project to raise a field one level: you pay up front, then scientists need months. Research and education spending (Economy) set how fast they work: now ×${speed.toFixed(2)}. The research budget also adds slow progress across every field.`),
    running.length ? h('div.section', h('h3', 'Under way'), h('div.list', running.map((p) => h('div.item',
      h('div.item-head', h('span.name', `${TECH_FIELDS[p.field].name} level ${p.level}`), p.how === 'licence' ? h('span.chip.accent', `licence from ${nationName(s, p.from)}`) : null, h('span.muted.small', { style: { marginLeft: 'auto' } }, p.blocked ? 'stalled' : `${Math.ceil(p.left / (p.how === 'own' ? speed : 1))} wk`)),
      h('div', { style: { marginTop: '6px' } }, bar(p.total - p.left, p.total, p.blocked ? 'bad' : '')),
      p.blocked ? h('div.warning.bad', { style: { marginTop: '6px' } }, `Stalled: this needs ${NEED_NAMES[p.blocked]} we don't have. `, h('button.btn.small', { onclick: () => { ctx.ui.marketRes = p.blocked; ctx.go('market', 'buy'); } }, `Buy ${NEED_NAMES[p.blocked]}…`)) : null,
      h('div.actions', h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'cancelResearch', id: p.id }) }, 'Cancel (part refund)')))))) : null,
    h('div.section', h('h3', 'Fields'),
      h('div.list', Object.entries(TECH_FIELDS).map(([f, d]) => {
        const lvl = me.tech[f];
        const busy = running.some((p) => p.field === f);
        const next = lvl + 1;
        const cost = projectCost(me, next);
        const needs = projectNeeds(me, f, next);
        const leaders = Object.entries(s.countries).filter(([id, c]) => id !== s.me && c.tech && c.tech[f] > lvl).sort((a, b) => b[1].tech[f] - a[1].tech[f]);
        const progress = me.progress?.[f] ?? 0;
        return h('div.item',
          h('div.item-head', h('span.name', d.name), h('span.mono', `Lv ${lvl}`)),
          h('div.meta', d.note),
          lvl < MAX_TECH ? h('div.meta', `Next level: ${money(cost)}, about ${Math.ceil(projectWeeks(next) / speed)} weeks${needs ? `, needs a supply of ${NEED_NAMES[needs]}` : ''}.`) : h('div.meta', 'At the frontier.'),
          progress > 0 ? h('div.row.gap.small', { style: { marginTop: '4px' } }, h('span.faint', 'Slow progress from the budget'), h('div.grow', bar(progress, 1.5 * Math.pow(1.55, lvl))), h('span.faint', '')) : null,
          lvl < MAX_TECH ? h('div.actions',
            h('button.btn.small.primary', { disabled: busy || running.length >= slots, onclick: async () => {
              if (await confirmBox(`Fund ${d.name} level ${next}?`, `Costs ${money(cost)} from the treasury (${money(me.treasury)}) and takes about ${Math.ceil(projectWeeks(next) / speed)} weeks.${needs ? ` Work stalls if we run short of ${NEED_NAMES[needs]}.` : ''}`)) ctx.send({ type: 'research', field: f });
            } }, busy ? 'Under way' : 'Fund project'),
            leaders.length ? h('button.btn.small', { disabled: busy || running.length >= slots, onclick: () => licence(ctx, f, leaders) }, 'Buy a licence…') : null) : null);
      }))),
    h('div.section', h('h3', 'Intelligence'),
      h('p.muted.small', 'Stealing technology, planting agents and catching foreign spies are run from the Spies tab.'),
      h('button.btn.small', { style: { marginTop: '6px' }, onclick: () => ctx.go('spies') }, 'Open Spies')),
  );
}

function licence(ctx, field, leaders) {
  const s = ctx.state;
  const me = s.you;
  const lvl = me.tech[field] + 1;
  const price = projectCost(me, lvl) * 0.8;
  const sel = selectField('Buy from', leaders.map(([id, c]) => [id, `${c.name} (level ${c.tech[field]})${c.human ? ' · leader' : ''}`]));
  modal({
    title: `${TECH_FIELDS[field].name}: buy a licence`,
    body: h('div.stack', sel.el,
      h('p.muted.small', `A licence for level ${lvl} costs about ${money(price)}, paid to the seller, and takes 13 weeks to put to use. Sellers want good relations, more so for military technology; a country that sanctions you won't sell. Leaders run by players can share technology with you from their side.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Ask', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'licence', from: sel.input.value, field })) || false }],
  });
}

export { flag };
