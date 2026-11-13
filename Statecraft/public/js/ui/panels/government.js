// Government: the system you run, conscription, the security forces and the press, protests and uprisings,
// and the measures of the home front.

import { h, money, pct, regionName, troops, bar, tone } from '../dom.js';
import { CONSCRIPTION, SECURITY, PRESS, CAUSES } from '../../engine/government.js';
import { confirmBox, modal, selectField } from '../dialogs.js';
import { myArmies } from './military.js';

const GOV = {
  democracy: ['Democracy', 'Free elections every four years. People vote you out if they are unhappy, and protest freely.'],
  hybrid: ['Hybrid regime', 'Elections are held, but the state leans on the courts and the media. Protest is tolerated, within limits.'],
  autocracy: ['Autocracy', 'No real elections. Power rests on the security forces, the party and the story the state tells.'],
};

export function government(ctx) {
  const s = ctx.state;
  const me = s.you;
  if (!me) return h('div.empty', 'You are watching this game.');
  const [govName, govNote] = GOV[me.gov] ?? [me.gov, ''];
  const weeksToElection = me.electionWeek != null ? me.electionWeek - s.week : null;
  const threat = me.threat ?? { value: 0, reasons: [] };
  const rebels = Object.entries(ctx.regionIndex).filter(([, i]) => s.regions[i][1] === s.me && s.regions[i][11] > 0).map(([id, i]) => ({ id, rebels: s.regions[i][11] }));
  const atWar = s.wars.some((w) => w.a === s.me || w.b === s.me);

  return h('div',
    h('div.panel-title', h('h2', 'Government'), h('span.chip.accent', govName)),
    h('p.muted.small', govNote),
    me.civilWar ? h('div.warning.bad', { style: { marginTop: '10px' } },
      h('b', 'Civil war. '), `Rebels hold out in ${rebels.length} province${rebels.length === 1 ? '' : 's'}. Crush them, offer an amnesty, or bring the army home`,
      atWar ? ': a separate peace abroad frees troops for the fight at home, as Russia did at Brest-Litovsk.' : '.',
      atWar ? h('div.actions', h('button.btn.small', { onclick: () => ctx.go('military', 'wars') }, 'Sue for peace…')) : null) : null,
    h('div.kpis', { style: { marginTop: '12px' } },
      kpi('Approval', `${Math.round(me.approval)}%`, weeksToElection != null ? `election in ${weeksToElection} wk` : 'no elections', tone(me.approval, 50, 30)),
      kpi('Stability', `${Math.round(me.stability)}`, me.stability < 30 ? 'fragile' : 'steady', tone(me.stability, 60, 30)),
      kpi('On the streets', me.protests?.length ? `${me.protests.length} movement${me.protests.length > 1 ? 's' : ''}` : 'quiet', me.protestDrag > 2 ? `−${Math.round(me.protestDrag)} approval` : 'no pressure', me.protestDrag > 8 ? 'bad' : me.protestDrag > 2 ? 'warn' : 'good')),
    h('div.section', h('h3', 'Protests'), protests(ctx)),
    rebels.length ? h('div.section', h('h3', 'Uprisings'), h('div.list', rebels.map((r) => uprisingCard(ctx, r)))) : null,
    h('div.section', h('h3', 'Conscription'), conscription(ctx, threat)),
    h('div.section', h('h3', 'Security forces'),
      seg(SECURITY, me.security, (k) => ctx.send({ type: 'security', level: k })),
      h('p.muted.small', { style: { marginTop: '6px' } }, SECURITY[me.security]?.note,
        me.gov === 'democracy' && me.security !== 'restrained' ? ' In a democracy, a heavy hand angers people and costs standing abroad.' : '')),
    h('div.section', h('h3', 'The press'),
      seg(PRESS, me.press, (k) => ctx.send({ type: 'press', level: k })),
      h('p.muted.small', { style: { marginTop: '6px' } }, PRESS[me.press]?.note,
        ' Fear of the police and a friendly press keep people at home even in hard times; free countries see more protest, but violence against it backfires.')),
    h('div.section', h('h3', 'The home front'), homeFront(ctx)),
  );
}

function kpi(label, value, sub, cls = '') {
  return h('div.kpi', h('span', label), h('b', { class: cls }, value), sub ? h('small', sub) : null);
}

function seg(options, value, onPick) {
  return h('div.seg', Object.entries(options).map(([k, o]) => h('button', { 'aria-pressed': String(k === value), onclick: () => onPick(k) }, o.name)));
}

/* ---------- Protests ---------- */

const FIXABLE = new Set(['schools', 'hospitals', 'pensions', 'taxes', 'draft', 'rights']);

function protests(ctx) {
  const me = ctx.state.you;
  const list = [...(me.protests ?? [])].sort((a, b) => b.size - a.size);
  if (!list.length) return h('div.empty', 'Nobody is on the streets. People protest when they have a reason: cuts to schools, hospitals or pensions, rising prices, a war or a draft they don\'t believe in.');
  return h('div.list', list.map((p) => {
    const info = CAUSES[p.cause] ?? { name: p.cause, crowd: '', fix: '' };
    const cost = me.gdp * 0.0004 * (p.size / 40) + 0.05;
    const talkWait = p.talked != null && p.talked > ctx.state.week - 8;
    return h('div.item',
      h('div.item-head', h('span.name', info.name), h('span.chip', { class: p.size > 60 ? 'bad' : p.size > 30 ? 'warn' : '' }, p.size > 60 ? 'Mass protests' : p.size > 30 ? 'Growing' : 'Small')),
      h('div.meta', `${info.crowd}. Since week ${p.since}.`),
      h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span.muted', 'Strength'), h('div.grow', bar(p.size, 100, p.size > 60 ? 'bad' : p.size > 30 ? 'warn' : '')), h('span.mono', `${Math.round(p.size)}%`)),
      h('div.meta', h('span.faint', 'What would end it: '), info.fix),
      h('div.actions',
        FIXABLE.has(p.cause) ? h('button.btn.small.primary', { onclick: () => ctx.send({ type: 'protest', id: p.id, action: 'concede' }) }, 'Give in') : null,
        h('button.btn.small', { disabled: talkWait, onclick: () => ctx.send({ type: 'protest', id: p.id, action: 'negotiate' }) }, talkWait ? 'Talks under way' : `Negotiate (${money(cost)})`),
        h('button.btn.small.danger', { onclick: async () => {
          const risky = me.gov === 'democracy' && p.size > 35;
          if (risky && !(await confirmBox('Send in the riot police?', 'In a democracy, pictures of police beating protesters can bring even more people out, and cost you standing abroad.', { ok: 'Send them in', danger: true }))) return;
          ctx.send({ type: 'protest', id: p.id, action: 'police' });
        } }, 'Police')));
  }));
}

/* ---------- Uprisings ---------- */

function uprisingCard(ctx, { id, rebels }) {
  const s = ctx.state;
  const armies = myArmies(s).filter((a) => !a.sea);
  return h('div.item',
    h('div.item-head', h('span.name', `🔥 ${regionName(id)}`), h('span.mono.small', `~${troops(rebels)} rebels`)),
    h('div.meta', 'Rebels grow while unrest stays high. An army holding the province grinds them down; garrisons alone rarely do.'),
    h('div.actions',
      h('button.btn.small.primary', { disabled: !armies.length, onclick: () => sendArmy(ctx, id, armies) }, armies.length ? 'Send an army' : 'Form an army first'),
      h('button.btn.small', { onclick: () => ctx.send({ type: 'uprising', region: id, action: 'crush' }) }, 'Crack down'),
      h('button.btn.small', { onclick: () => ctx.send({ type: 'uprising', region: id, action: 'amnesty' }) }, 'Offer amnesty'),
      h('button.btn.small.ghost', { onclick: () => ctx.openRegion(id, true) }, 'Show')));
}

function sendArmy(ctx, target, armies) {
  const sel = selectField('Army group', armies.map((a) => [a.id, `${a.name} · ${troops(a.troops)} · ${regionName(a.region)}`]));
  modal({
    title: `Put down the uprising in ${regionName(target)}`,
    body: h('div.stack', sel.el, h('p.muted.small', 'The army marches there and holds the province, fighting the rebels every week.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Send', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'armyOrder', id: sel.input.value, kind: 'hold', target })) || false }],
  });
}

/* ---------- Conscription ---------- */

function conscription(ctx, threat) {
  const me = ctx.state.you;
  const cur = CONSCRIPTION[me.conscription] ?? CONSCRIPTION.volunteer;
  const base = CONSCRIPTION[me.base.conscription] ?? CONSCRIPTION.volunteer;
  const reason = threat.value;
  const reasonText = reason >= 0.7 ? 'Strong: people see the danger' : reason >= 0.4 ? 'Some: people are uneasy' : reason > 0.1 ? 'Weak' : 'None: people see no threat';
  return h('div',
    h('div.seg', Object.entries(CONSCRIPTION).map(([k, o]) => h('button', {
      'aria-pressed': String(k === me.conscription),
      onclick: async () => {
        if (o.level > cur.level && reason < 0.4) {
          const ok = await confirmBox(`Introduce ${o.name.toLowerCase()}?`, h('div.stack',
            h('p', 'Nothing threatens the country, so people won\'t see why their sons should be called up.'),
            h('p.bad', me.gov === 'autocracy' ? 'Expect grumbling; fear keeps most of it quiet.' : 'Expect students and families on the streets, and approval to fall every week it lasts.')), { ok: 'Call them up', danger: true });
          if (!ok) return;
        }
        ctx.send({ type: 'conscription', level: k });
      },
    }, o.name))),
    h('p.muted.small', { style: { marginTop: '6px' } }, cur.note),
    h('div.row.gap.small', { style: { marginTop: '8px' } }, h('span.muted', 'Reason to serve'), h('div.grow', bar(reason * 100, 100, reason >= 0.6 ? 'good' : reason >= 0.3 ? 'warn' : 'bad')), h('span', reasonText)),
    threat.reasons?.length ? h('p.small', { style: { marginTop: '4px' } }, 'Because: ', threat.reasons.join('; '), '.') : null,
    h('p.muted.small', { style: { marginTop: '6px' } },
      `In 2025 the law was ${base.name.toLowerCase()}. `,
      me.conscripts > 1 ? `${troops(me.conscripts)} extra conscripts are serving. ` : me.conscripts < -1 ? `${troops(-me.conscripts)} fewer serve than in 2025. ` : '',
      me.draftDrag > 0.5 ? h('span.bad', `The draft costs about ${Math.max(1, Math.round(me.draftDrag))} point${Math.round(me.draftDrag) > 1 ? 's' : ''} of approval while people see no reason for it.`) : 'Conscripts fill the ranks over months, but every soldier is a worker taken from the economy.'),
  );
}

/* ---------- Home front ---------- */

function homeFront(ctx) {
  const me = ctx.state.you;
  const row = (title, text, button) => h('div.item', h('div.item-head', h('span.name', title), button), h('div.meta', text));
  const toggle = (on, cmd, danger) => h('button.btn.small', { class: on ? (danger ? 'danger' : 'primary') : '', onclick: () => ctx.send(cmd(!on)) }, on ? 'On' : 'Off');
  const wait = (me.cooldown.propaganda ?? -1) - ctx.state.week;
  return h('div.list',
    row('Address the nation', 'A national address and media blitz: a short boost to approval.', h('button.btn.small', { disabled: wait > 0, onclick: () => ctx.send({ type: 'propaganda' }) }, wait > 0 ? `ready in ${wait} wk` : 'Launch')),
    row('Martial law', 'Troops on the streets: stability up, approval and world standing down.', toggle(me.martial, (on) => ({ type: 'martial', on }), true)),
    me.gov !== 'autocracy' ? row('Snap election', `Go to the polls in four weeks while you are popular. Approval is ${Math.round(me.approval)}%.`,
      h('button.btn.small', { onclick: async () => { if (await confirmBox('Call a snap election?', `An election will be held in four weeks. Approval is ${Math.round(me.approval)}%.`)) ctx.send({ type: 'snapElection' }); } }, 'Call it')) : null,
    h('p.muted.small', `Spending on schools, hospitals and pensions is set in Economy: cut them below their 2025 level and the people affected will protest. Inflation is ${pct(me.infl)}.`),
  );
}
