// Govern → Power: who really holds power. The army's loyalty, the risk of a coup and why, plots our security
// services uncover, the kind of government we are, and the coups we are funding abroad.

import { h, flag, money, nationName, bar } from '../dom.js';
import { modal, numberField, confirmBox } from '../dialogs.js';

const REGIME = {
  junta: ['Military government', 'The generals rule by decree: no elections, state media, secret police. Democracies keep their distance.'],
  revolution: ['Revolutionary government', 'The people brought down the old regime. Elections are coming.'],
  installed: ['Installed government', 'A foreign power put this government in place after a war.'],
  civilian: ['Civilian rule restored', 'The generals handed power back.'],
};

export function power(ctx) {
  const s = ctx.state;
  const me = s.you;
  const p = me.power;
  if (!p) return h('div.empty', 'No data yet.');
  const riskTone = p.risk >= 50 ? 'bad' : p.risk >= 30 ? 'warn' : 'good';
  const reg = p.regime ? REGIME[p.regime.kind] : null;
  return h('div',
    p.plot ? h('div.warning.bad', { style: { marginTop: '10px' } }, h('b', 'A plot. '), `Our security services say officers have been plotting since week ${p.plot.since}. Buy them off or purge them, before they move.`) : null,
    reg ? h('div.warning', { class: p.regime.kind === 'junta' ? 'warn' : 'info', style: { marginTop: '10px' } }, h('b', `${reg[0]}. `), reg[1],
      p.regime.patron ? ` It owes its place to ${nationName(s, p.regime.patron)}.` : '') : null,
    h('div.kpis', { style: { marginTop: '10px' } },
      h('div.kpi', h('span', 'Army loyalty'), h('b', { class: p.loyalty < 40 ? 'bad' : p.loyalty < 60 ? 'warn' : 'good' }, `${p.loyalty}`), h('small', p.loyalty < 40 ? 'restless' : p.loyalty < 60 ? 'grumbling' : 'loyal')),
      h('div.kpi', h('span', 'Coup risk'), h('b', { class: riskTone }, `${p.risk}%`), h('small', p.risk >= 50 ? 'danger' : p.risk >= 30 ? 'watch it' : 'low')),
      h('div.kpi', h('span', 'Security forces'), h('b', me.security), h('small', me.security === 'repressive' ? 'hear every plot' : me.security === 'firm' ? 'hear most plots' : 'may miss a plot'))),
    h('div.section',
      h('h3', 'Why the risk is what it is'),
      h('div', bar(p.risk, 100, riskTone)),
      p.why.length ? h('div.stack-sm', { style: { marginTop: '8px' } }, p.why.map(([v, text]) => h('div.row.between.small', h('span', text), h('span.mono', { class: v > 0 ? 'bad' : 'good' }, `${v > 0 ? '+' : ''}${v}`)))) : null,
      h('p.muted.small', { style: { marginTop: '10px' } }, 'Plots form when the risk passes about 40%. The army\'s loyalty rises with pay and defence spending, and falls with lost wars, lost provinces, unpaid troops and war weariness. Rich democracies almost never see coups; poor, unstable countries often do.')),
    h('div.section',
      h('h3', 'Keep the army on side'),
      h('div.actions',
        h('button.btn.small.primary', { disabled: (p.paidUntil ?? -1) > s.week, onclick: () => pay(ctx) }, (p.paidUntil ?? -1) > s.week ? `Paid until week ${p.paidUntil}` : `Pay the generals (${money(me.gdp * 0.004)})…`),
        h('button.btn.small.warn', { onclick: () => purge(ctx) }, 'Purge the officer corps…'),
        p.regime?.kind === 'junta' ? h('button.btn.small', { onclick: () => civilian(ctx) }, 'Hand power back to civilians…') : null)),
    p.backing.length ? h('div.section', h('h3', 'Plotters we are funding'),
      h('div.list', p.backing.map((b) => h('div.item', h('div.item-head', flag(b.target), h('span.name', nationName(s, b.target)), h('span.muted.small', { style: { marginLeft: 'auto' } }, `until week ${b.until}`)),
        h('div.meta', `Adds ${b.power} points to its coup risk. If exposed, it will never forgive us.`))))) : null,
    h('p.muted.small', { style: { marginTop: '12px' } }, 'To fund a coup abroad you need a spy network inside the country: Spies → Networks.'));
}

async function pay(ctx) {
  const me = ctx.state.you;
  if (await confirmBox('Pay the generals?', `Raises, promotions and new kit for the officer corps: ${money(me.gdp * 0.004)}, from defence funds first. Loyalty rises for six months, and a plot may be called off.`)) ctx.send({ type: 'payGenerals' });
}

async function purge(ctx) {
  if (await confirmBox('Purge the officer corps?', 'Arrest suspect officers and promote loyalists. No one will dare move for six months, but our armies lose a quarter of their organisation, and in a democracy it is unpopular.', { danger: true, ok: 'Purge' })) ctx.send({ type: 'purge' });
}

async function civilian(ctx) {
  if (await confirmBox('Hand power back to civilians?', 'Elections are called for six months\' time, the press is freed and the world thinks better of us. The army is not pleased. The country must be stable (45 or more).')) ctx.send({ type: 'civilianRule' });
}

// From Spies: fund officers in another country to overthrow its government
export function backCoupDialog(ctx, target) {
  const s = ctx.state;
  const me = s.you;
  const t = s.countries[target];
  const amount = numberField('Money for the plotters', { value: Math.max(0.5, Math.round((t?.gdp ?? 100) * 0.01 * 10) / 10), min: 0.1, max: Math.max(0.1, Math.floor(me.treasury)), suffix: '$ billions' });
  modal({
    title: `Back a coup in ${nationName(s, target)}`,
    body: h('div.stack', amount.el,
      t?.coupRisk != null ? h('p', `Our agents put its coup risk at ${t.coupRisk}%.`) : h('p.muted.small', 'Our agents can\'t yet see how shaky its government is.'),
      h('p.muted.small', 'For six months our agents pass money to officers who want to seize power: the more money (against the size of its economy) and the more agents we have there, the higher its coup risk. The coup still needs an unstable country and a restless army. If it succeeds, the new government owes us: friendship, free passage for our troops, and an end to any alliance against us. If our role is exposed, relations collapse and the world condemns us.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Fund the plotters', kind: 'danger', onClick: async () => !(await ctx.send({ type: 'backCoup', target, amount: Number(amount.input.value) })) || false }],
  });
}
