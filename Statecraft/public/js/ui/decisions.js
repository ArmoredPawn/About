// Decisions waiting for the leader (a crisis, the markets, the generals): a card each in the Cabinet, and a
// dialog with one big button per option.

import { h } from './dom.js';
import { modal } from './dialogs.js';

const ICONS = { pandemic: '🦠', vaccine: '💉', banks: '🏦', summit: '🤝', famineAid: '🌾', terror: '🚨', debtCrisis: '📉', plot: '🎖' };
const toneOf = (o) => (o.tone === 'danger' ? 'bad' : o.tone === 'warn' ? 'warn' : '');

export function decisionDialog(ctx, d) {
  let dlg = null;
  const choose = async (o) => {
    const err = await ctx.send({ type: 'decide', id: d.id, option: o.id });
    if (!err) dlg?.close();
  };
  dlg = modal({
    title: `${ICONS[d.key] ?? '⚖'} ${d.title}`,
    body: h('div.stack',
      h('p', d.text),
      h('div.pick-list', d.options.map((o) => h('button.pick-card', { type: 'button', class: toneOf(o), onclick: () => choose(o) },
        h('span.pick-text', h('b', o.label), h('span', o.note))))),
      h('p.muted.small', `If we don't decide by week ${d.until}, the cabinet chooses "${d.options[0].label}".`)),
    actions: [{ label: 'Later', kind: 'ghost' }],
  });
  return dlg;
}

export function decisionCards(ctx) {
  const s = ctx.state;
  const list = s.you?.decisions ?? [];
  if (!list.length) return null;
  return h('div.section',
    h('h3', `Decisions (${list.length})`),
    h('div.list', list.map((d) => h('div.item.decision', { class: 'clickable', onclick: () => decisionDialog(ctx, d) },
      h('div.item-head', h('span.pick-icon', { 'aria-hidden': 'true' }, ICONS[d.key] ?? '⚖'), h('span.name', d.title),
        h('span.chip.warn', { style: { marginLeft: 'auto' } }, `${Math.max(0, d.until - s.week)} wk left`)),
      h('div.meta', d.text),
      h('div.actions', h('button.btn.small.primary', { onclick: (e) => { e.stopPropagation(); decisionDialog(ctx, d); } }, 'Decide…'))))));
}

export function openDecision(ctx, id) {
  const d = ctx.state?.you?.decisions?.find((x) => x.id === id);
  if (d) decisionDialog(ctx, d);
  else ctx.go('overview');
}
