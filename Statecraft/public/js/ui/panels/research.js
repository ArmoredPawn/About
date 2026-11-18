// Research: better technology costs money and time. Fund a project, wait for the scientists, and import the
// semiconductors or uranium the most advanced work needs, or buy a licence from a country further ahead.

import { h, flag, money, nationName, bar } from '../dom.js';
import { TECH_FIELDS } from '../../engine/data/world.js';
import { projectCost, projectWeeks, projectNeeds, researchSpeed, maxResearch, MAX_TECH } from '../../engine/science.js';
import { confirmBox, modal, selectField } from '../dialogs.js';
import { space } from './space.js';
import { DESIGN_KINDS, MAX_DESIGNS } from '../../engine/designs.js';
import { designCard, kindIcon } from '../design.js';

const NEED_NAMES = { chip: 'semiconductors', uran: 'uranium' };

export function research(ctx) {
  const s = ctx.state;
  const me = s.you;
  const running = me.research ?? [];
  const slots = maxResearch(me);
  const speed = researchSpeed(me);
  const tab = ctx.sub('research', 'fields');
  const tabs = [['fields', 'Research'], ['design', 'Design'], ['space', 'Space']];
  const head = [
    h('div.panel-title', h('h2', 'Research'), h('span.muted.small', `${running.length}/${slots} projects`)),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('research', id) }, label))),
  ];
  if (tab === 'space') return h('div', ...head, space(ctx));
  if (tab === 'design') return h('div', ...head, design(ctx));
  return h('div',
    ...head,
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

// Our own tanks, vehicles, aircraft and warships: the bureau's front desk
function design(ctx) {
  const me = ctx.state.you;
  const mine = Object.values(me.designs ?? {});
  const kinds = Object.entries(DESIGN_KINDS);
  const filter = mine.some((d) => d.kind === ctx.ui.designKind) ? ctx.ui.designKind : 'all';
  const shown = mine.filter((d) => filter === 'all' || d.kind === filter).sort((a, b) => (b.built ?? 0) - (a.built ?? 0) || a.name.localeCompare(b.name));
  const present = kinds.filter(([k]) => mine.some((d) => d.kind === k));
  const setFilter = (k) => { ctx.ui.designKind = k; ctx.setSub('research', 'design'); };
  return h('div.dz',
    h('div.dz-hero',
      h('div.dz-hero-text',
        h('h3', 'Design bureau'),
        h('p', 'Draw up our own weapons part by part, then have the factories build them. The better the design, the more every unit built to it is worth.')),
      h('div.dz-hero-foot',
        h('span.dz-count', h('b', String(mine.length)), ` of ${MAX_DESIGNS} designs`),
        h('button.btn.primary.small', { onclick: () => ctx.openDesigner({ kind: filter === 'all' ? 'tanks' : filter }) }, 'Open the bureau'))),
    h('div.section',
      h('h3', 'Start a new design'),
      h('div.dz-kinds', kinds.map(([k, d]) => {
        const n = mine.filter((x) => x.kind === k).length;
        return h('button.dz-kind', { type: 'button', onclick: () => ctx.openDesigner({ kind: k }) },
          kindIcon(k), h('span.dz-kind-name', d.name), h('span.dz-kind-sub', n ? `${n} saved` : 'none yet'), h('span.dz-plus', { 'aria-hidden': 'true' }, '＋'));
      }))),
    h('div.section',
      h('div.dz-sec-head', h('h3', 'Our designs'), mine.length ? h('span.faint.small', `${mine.length}`) : null),
      present.length > 1 ? h('div.seg.dz-filter', { role: 'group', 'aria-label': 'Show' },
        h('button', { 'aria-pressed': String(filter === 'all'), onclick: () => setFilter('all') }, 'All'),
        present.map(([k, d]) => h('button', { 'aria-pressed': String(filter === k), title: d.name, onclick: () => setFilter(k) }, kindIcon(k)))) : null,
      shown.length ? h('div.dz-list', shown.map((d) => designCard(ctx, d)))
        : h('div.dz-empty',
          h('div.dz-empty-art', kindIcon('tanks'), kindIcon('aircraft'), kindIcon('ships')),
          h('b', 'No designs yet'),
          h('p.muted.small', 'Pick what to design above. Parts with a lock need more research in the field shown.'))),
    h('div.section',
      h('h3', 'Forces in service'),
      h('div.dz-service', kinds.map(([k, d]) => {
        const e = me.edge?.[k] ?? 1;
        const pos = (v) => `${Math.max(0, Math.min(100, ((v - 0.75) / 0.65) * 100))}%`;
        return h('div.dz-svc',
          h('div.dz-svc-head', kindIcon(k), h('span', SHORT_KIND[k]), h('b.mono', { class: e > 1.005 ? 'good' : e < 0.995 ? 'bad' : '' }, `×${e.toFixed(2)}`)),
          h('div.dz-gauge', { title: 'From ×0.75 to ×1.40; the mark is the standard model' }, h('i.dz-gauge-std', { style: { left: pos(1) } }), h('i.dz-gauge-dot', { style: { left: pos(e) } })),
          h('span.faint.tiny', k === 'vehicles' ? `${(me.vehicles ?? 0).toLocaleString('en')} vehicles` : e > 1.005 ? 'better than standard' : e < 0.995 ? 'below standard' : 'standard model'));
      })),
      h('p.faint.small', { style: { marginTop: '8px' } }, 'Each arm\'s rating moves toward its designs as new units are built to them. Order more from here or from Military, Weapons.')));
}

const SHORT_KIND = { tanks: 'Tanks', vehicles: 'Vehicles', aircraft: 'Aircraft', ships: 'Warships' };

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
