// World → Crises: pandemics, crashes, famines and attacks happening now, what they are doing to us, and what we
// can do: our pandemic measures and borders, money for the vaccine, food aid. Past crises below.

import { h, flag, money, nationName, regionName, bar } from '../dom.js';
import { modal, numberField } from '../dialogs.js';
import { LOCKDOWNS } from '../../engine/crises.js';

const ICON = { pandemic: '🦠', crash: '📉', famine: '🌾', terror: '🚨' };
const fmtK = (k) => (k >= 1000 ? `${(k / 1000).toFixed(1)} million` : k >= 1 ? `${Math.round(k)},000` : `${Math.max(10, Math.round(k * 1000 / 10) * 10)}`);

export function crisesPanel(ctx) {
  const s = ctx.state;
  const c = s.crises ?? { active: [], log: [] };
  return h('div',
    h('p.muted.small', 'Pandemics, financial crashes, famines and terror attacks strike at random, and some are brought on by the world itself (bubbles, droughts, wars). Each asks leaders to choose between looking after their own and working together.'),
    c.active.length ? h('div.list', { style: { marginTop: '10px' } }, c.active.map((x) => card(ctx, x))) : h('div.empty', { style: { marginTop: '10px' } }, 'No crisis right now.'),
    c.log.length ? h('div.section', h('h3', 'Past crises'), h('div.list', [...c.log].reverse().map((x) => h('div.item',
      h('div.item-head', h('span', ICON[x.kind]), h('span.name', cap(x.name)), h('span.muted.small', { style: { marginLeft: 'auto' } }, `weeks ${x.since}–${x.ended}`)),
      x.summary ? h('div.meta', x.summary) : null)))) : null);
}

const cap = (t) => t[0].toUpperCase() + t.slice(1);

function card(ctx, x) {
  const s = ctx.state;
  const head = h('div.item-head', h('span.pick-icon', ICON[x.kind]), h('span.name', cap(x.name)), x.country ? flag(x.country) : null, h('span.muted.small', { style: { marginLeft: 'auto' } }, `since week ${x.since}`));
  if (x.kind === 'pandemic') {
    const mine = x.inf[s.me] ?? 0;
    const pol = s.you.pandemic;
    const worst = Object.entries(x.inf).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return h('div.item', head,
      h('div.meta', `Reached ${x.reached} countries. About ${fmtK(x.deaths)} dead worldwide${x.ourDeaths ? `, ${fmtK(x.ourDeaths)} of them ours` : ''}.`),
      h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span.muted', 'Infected here'), h('div.grow', bar(Math.min(35, mine), 35, mine > 5 ? 'bad' : mine > 1 ? 'warn' : 'good')), h('span.mono', `${mine}%`)),
      h('div.row.gap.small', h('span.muted', 'Vaccine'), h('div.grow', bar(x.vaccine, 100, 'good')), h('span.mono', `${x.vaccine}%`)),
      x.vaccine >= 100 ? h('div.meta', `Made by ${nationName(s, x.maker)}${x.shared === true ? ', and shared with the world' : x.shared === false ? ', which is vaccinating its own people first' : ''}. ${x.vacc}% of our people are vaccinated.`) : null,
      worst.length ? h('div.meta', `Worst hit: ${worst.map(([id, v]) => `${nationName(s, id)} ${v}%`).join(', ')}`) : null,
      pol ? h('div.field', { style: { marginTop: '8px' } }, h('span', 'Our measures'),
        h('div.seg', Object.entries(LOCKDOWNS).map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(pol.policy === k), title: l.note, onclick: () => ctx.send({ type: 'pandemicPolicy', policy: k }) }, l.name)))) : null,
      pol ? h('p.muted.small', LOCKDOWNS[pol.policy]?.note ?? '') : null,
      h('div.actions',
        pol ? h('button.btn.small', { onclick: () => ctx.send({ type: 'pandemicPolicy', borders: !pol.borders }) }, pol.borders ? 'Reopen our borders' : 'Close our borders') : null,
        x.vaccine < 100 ? h('button.btn.small.primary', { onclick: () => fundDialog(ctx, x) }, 'Fund the vaccine…') : null),
      Object.keys(x.funds).length ? h('div.meta', `Funding the vaccine: ${Object.entries(x.funds).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${nationName(s, id)} ${money(v)}`).join(', ')}. They get it first.`) : null);
  }
  if (x.kind === 'crash') {
    const summit = x.summit;
    return h('div.item', head,
      h('div.meta', `It began in ${nationName(s, x.country)}. ${x.hit >= 70 ? 'We are badly exposed.' : x.hit >= 45 ? 'We are exposed.' : 'We are only lightly exposed.'}${x.response ? ` Our banks: ${{ bailout: 'bailed out', guarantee: 'deposits guaranteed', fail: 'left to fail' }[x.response]}.` : ''}`),
      h('div.meta', summit.done
        ? `Emergency summit: ${summit.joined.length} joined the coordinated stimulus (${summit.joined.slice(0, 8).map((id) => nationName(s, id)).join(', ')}${summit.joined.length > 8 ? '…' : ''})${summit.declined.length ? `; ${summit.declined.length} stayed out` : ''}.`
        : `The world's largest economies meet in an emergency summit in week ${summit.at}.`),
      h('div.actions', h('button.btn.small', { onclick: () => ctx.go('economy', 'markets') }, 'Our markets')));
  }
  if (x.kind === 'famine') {
    const ours = x.country === s.me;
    return h('div.item', head,
      h('div.meta', `About ${fmtK(x.deaths)} dead so far. ${Object.keys(x.aid).length ? `Aid from ${Object.entries(x.aid).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => `${nationName(s, id)} (${money(v)})`).join(', ')}${Object.keys(x.aid).length > 6 ? '…' : ''}.` : 'No one has sent aid yet.'}`),
      h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span.muted', 'Severity'), h('div.grow', bar(x.severity, 100, x.severity > 50 ? 'bad' : 'warn')), h('span.mono', `${x.severity}%`)),
      ours ? h('p.muted.small', 'Our people are starving. Buying food (Market) and rationing help; other countries may send aid.')
        : h('div.actions',
          h('button.btn.small.primary', { onclick: () => ctx.send({ type: 'famineAid', crisis: x.id, size: 'large' }) }, 'Send major food aid'),
          h('button.btn.small', { onclick: () => ctx.send({ type: 'famineAid', crisis: x.id, size: 'small' }) }, 'Send some food')));
  }
  return h('div.item', head,
    h('div.meta', `${x.dead} killed${x.region ? ` in ${regionName(x.region)}` : ''}.${x.haven ? ` The attackers trained in ${nationName(s, x.haven)}.` : ' A home-grown cell.'}`));
}

function fundDialog(ctx, x) {
  const me = ctx.state.you;
  const amount = numberField('Amount', { value: Math.max(1, Math.round(me.gdp * 0.002)), min: 0.1, max: Math.max(0.1, Math.floor(me.treasury)), suffix: '$ billions' });
  modal({
    title: 'Fund the vaccine',
    body: h('div.stack', amount.el, h('p.muted.small', `The world's labs are ${x.vaccine}% of the way there. Money speeds them up, and countries that paid get the first doses. The biggest funder makes it, and decides whether to share it.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Give', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'vaccineFund', amount: Number(amount.input.value) })) || false }],
  });
}
