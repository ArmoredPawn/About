// Diplomacy → Arm & fund: weapons, money and volunteers for someone else's war, or for rebels in another
// country, sent openly or covertly; and who our intelligence knows is arming whom.

import { h, flag, money, nationName, regionName, num, troops } from '../dom.js';
import { modal, selectField } from '../dialogs.js';
import { AID_KINDS, AID_SIZES, COVERT_COST } from '../../engine/proxy.js';

const recipient = (s, p) => (p.rebels ? `Rebels in ${regionName(p.rebels)}` : nationName(s, p.to));
const sizeText = (kind, z) => (kind === 'weapons' ? `${z.tanks} tanks, ${z.aircraft} aircraft${z.missiles ? `, ${z.missiles} missiles` : ''} a week`
  : kind === 'money' ? `${money(z.money)} a week` : `${troops(z.troops)} soldiers`);

export function armAndFund(ctx) {
  const s = ctx.state;
  const mine = (s.aid ?? []).filter((p) => p.from === s.me);
  const others = (s.aid ?? []).filter((p) => p.from !== s.me);
  return h('div',
    h('p.muted.small', 'Fight a war without fighting it: send weapons, money or volunteers to a nation at war, or to rebels rising against another government. Openly, it angers the side being fought. Covertly, it costs 30% more and stays hidden until their counter-intelligence finds it out, which is worse.'),
    h('div.section', { style: { marginTop: '14px' } }, h('h3', 'Our programmes'),
      mine.length ? h('div.list', mine.map((p) => programCard(ctx, p, true))) : h('div.empty', 'None.'),
      h('div.actions', { style: { marginTop: '8px' } }, h('button.btn.small.primary', { onclick: () => aidDialog(ctx, {}) }, 'New programme…'))),
    h('div.section', h('h3', 'Who is arming whom'),
      h('p.muted.small', 'Open programmes, exposed ones, and covert ones our spies have uncovered.'),
      others.length ? h('div.list', others.map((p) => programCard(ctx, p, false))) : h('div.empty', 'Nothing we know of.')));
}

function programCard(ctx, p, mine) {
  const s = ctx.state;
  const z = AID_SIZES[p.size];
  const sent = p.sent ? (p.kind === 'weapons' ? `${num(p.sent.tanks)} tanks, ${num(p.sent.aircraft)} aircraft, ${num(p.sent.missiles)} missiles sent so far`
    : p.kind === 'money' ? `${money(p.sent.money)} sent so far` : `${troops(p.troops ?? 0)} volunteers still fighting`) : null;
  return h('div.item', { class: p.rebels ? 'clickable' : '', onclick: p.rebels ? () => ctx.openRegion(p.rebels, true) : null },
    h('div.item-head', mine ? null : flag(p.from), h('span.name', mine ? recipient(s, p) : `${nationName(s, p.from)} → ${recipient(s, p)}`),
      p.covert ? h('span.chip.warn', 'covert') : p.exposed ? h('span.chip.bad', 'exposed') : h('span.chip', 'open'),
      h('span.muted.small', { style: { marginLeft: 'auto' } }, AID_KINDS[p.kind].name)),
    h('div.meta', `${z.name}: ${sizeText(p.kind, z)}${sent ? ` · ${sent}` : ''}`),
    mine ? h('div.actions', { onclick: (e) => e.stopPropagation() }, h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'aidStop', id: p.id }) }, p.kind === 'volunteers' ? 'Bring them home' : 'Stop')) : null);
}

// Nations at war we could help (not our enemies), and uprisings in other countries
function recipients(ctx) {
  const s = ctx.state;
  const enemies = new Set(s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a)));
  const fighting = new Set(s.wars.flatMap((w) => [w.a, w.b]));
  const nations = [...fighting].filter((id) => id !== s.me && !enemies.has(id) && (s.countries[id] || s.minors[id]));
  const out = nations.map((id) => [`n:${id}`, `${nationName(s, id)} (at war with ${s.wars.filter((w) => w.a === id || w.b === id).map((w) => nationName(s, w.a === id ? w.b : w.a)).join(', ')})`]);
  for (const [id, i] of Object.entries(ctx.regionIndex)) {
    const row = s.regions[i];
    if (row[11] > 0 && row[1] !== s.me) out.push([`r:${id}`, `Rebels in ${regionName(id)} (${nationName(s, row[1])})`]);
  }
  return out;
}

export function aidDialog(ctx, { to, rebels }) {
  const s = ctx.state;
  const options = recipients(ctx);
  const pre = rebels ? `r:${rebels}` : to ? `n:${to}` : options[0]?.[0];
  if (rebels && !options.some(([k]) => k === pre)) options.unshift([pre, `Rebels in ${regionName(rebels)}`]);
  if (to && !options.some(([k]) => k === pre)) options.unshift([pre, nationName(s, to)]);
  if (!options.length) return ctx.hint('Nobody is at war or in revolt right now.', 'info');
  const who = selectField('For', options, pre);
  let kind = 'weapons';
  let size = 1;
  let covert = false;
  const detail = h('p.muted.small');
  const refresh = () => {
    const z = AID_SIZES[size];
    detail.textContent = `${AID_KINDS[kind].note} ${z.name}: ${sizeText(kind, z)}.${covert ? ` Covert: costs ${Math.round((COVERT_COST - 1) * 100)}% more.` : ''}`;
  };
  const segOf = (entries, get, set) => {
    const el = h('div.seg', entries.map(([k, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(k === get()), onclick: () => { set(k); for (const x of el.children) x.setAttribute('aria-pressed', String(x === b)); refresh(); } }, label);
      return b;
    }));
    return el;
  };
  const kinds = segOf(Object.entries(AID_KINDS).map(([k, v]) => [k, v.name]), () => kind, (k) => { kind = k; });
  const sizes = segOf(AID_SIZES.map((z, i) => [i, z.name]), () => size, (k) => { size = k; });
  const box = h('input', { type: 'checkbox', onchange: () => { covert = box.checked; refresh(); } });
  refresh();
  modal({
    title: 'Arm & fund',
    body: h('div.stack', who.el, h('div.field', h('span', 'Send'), kinds), h('div.field', h('span', 'How much'), sizes),
      h('label.row.gap', { style: { cursor: 'pointer' } }, box, h('span', h('b', 'Covertly'), h('span.muted.small', { style: { display: 'block' } }, 'Through third countries and shell companies, so nobody can prove it was us.'))),
      detail),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Start', kind: 'primary',
      onClick: async () => {
        const [type, id] = who.input.value.split(':');
        const err = await ctx.send({ type: 'aidStart', to: type === 'n' ? id : null, rebels: type === 'r' ? id : null, kind, size, covert });
        if (!err) ctx.toast('The programme has started.', 'info');
        return !err || false;
      },
    }],
  });
}
