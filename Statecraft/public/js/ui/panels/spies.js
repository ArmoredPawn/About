// The spy network: agents planted abroad, what they relay home, covert operations, and catching the agents
// other countries plant on us.

import { h, flag, money, nationName, regionName } from '../dom.js';
import { INTEL } from '../../engine/events.js';
import { COUNTER_INTEL, MAX_AGENTS } from '../../engine/spies.js';
import { modal, numberField, selectField } from '../dialogs.js';

export function spies(ctx) {
  const tab = ctx.sub('spies', 'networks');
  const me = ctx.state.you;
  const fresh = (me.reports ?? []).filter((r) => r.w >= ctx.state.week - 2).length;
  const tabs = [['networks', 'Networks'], ['reports', `Reports${fresh ? ` (${fresh})` : ''}`], ['ops', 'Operations'], ['counter', 'Counter-intelligence']];
  return h('div',
    h('div.panel-title', h('h2', 'Spy network'), h('span.muted.small', `Cyber & intelligence level ${me.tech.cyber}`)),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('spies', id) }, label))),
    { networks, reports, ops, counter }[tab](ctx));
}

const agentCost = (me) => 0.03 * (0.45 + 0.55 * Math.min(1.2, (me.gdp / Math.max(0.01, me.pop)) / 60));
const countryOptions = (s) => Object.entries(s.countries).filter(([id, c]) => id !== s.me && !c.exile).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, c]) => [id, c.name]);

/* ---------- Networks ---------- */

function networks(ctx) {
  const s = ctx.state;
  const me = s.you;
  const list = Object.entries(me.spies ?? {});
  return h('div',
    h('button.btn.primary.block', { onclick: () => plantDialog(ctx) }, '＋ Plant agents in a country'),
    h('p.muted.small', { style: { marginTop: '6px' } }, 'Agents take about four weeks to settle in. Then they report every couple of weeks: armies on the move, weapons being built, secret pacts, war plans, the treasury and the mood on the streets. A big enough network, and better tradecraft than their counter-intelligence, shows you their armies on the map. The bigger the network, the likelier it is to be caught.'),
    h('div.list', { style: { marginTop: '10px' } }, list.length ? list.map(([id, n]) => {
      const age = s.week - n.since;
      const count = (me.reports ?? []).filter((r) => r.about === id).length;
      const sees = (me.intel?.[id] ?? -1) > s.week;
      return h('div.item',
        h('div.item-head', flag(id), h('span.name', nationName(s, id)), h('span.chip', { class: age < 4 ? 'warn' : sees ? 'good' : '' }, age < 4 ? `settling in (${4 - age} wk)` : sees ? 'deep inside' : 'reporting'), h('span.mono.small', `${n.agents} agents`)),
        h('div.meta', `Planted week ${n.since} · ${count} reports so far${sees ? ' · their armies show on our map' : age >= 4 ? ' · not yet deep enough to track their armies' : ''}`),
        h('div.actions',
          h('button.btn.small', { onclick: () => { ctx.ui.spyFilter = id; ctx.setSub('spies', 'reports'); } }, 'Reports'),
          h('button.btn.small', { disabled: n.agents >= MAX_AGENTS, onclick: () => plantDialog(ctx, id) }, 'Add agents…'),
          h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'spyRecall', target: id }) }, 'Recall')));
    }) : [h('div.empty', 'No agents abroad.')]));
}

function plantDialog(ctx, target) {
  const s = ctx.state;
  const me = s.you;
  const sel = selectField('Country', countryOptions(s), target ?? countryOptions(s)[0]?.[0]);
  const f = numberField('Agents to recruit', { value: 4, min: 1, max: MAX_AGENTS, step: 1 });
  const note = h('p.small.muted');
  const update = () => { note.textContent = `Costs ${money(Number(f.input.value) * agentCost(me))} from the treasury (${money(me.treasury)}). ${me.spies?.[sel.input.value] ? `${me.spies[sel.input.value].agents} agents already there.` : ''}`; };
  f.input.addEventListener('input', update);
  sel.input.addEventListener('change', update);
  update();
  modal({
    title: 'Plant agents',
    body: h('div.stack', sel.el, f.el, note),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Send them in', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'spyPlant', target: sel.input.value, agents: Number(f.input.value) })) || false }],
  });
}

/* ---------- Reports ---------- */

const KIND = { army: ['Army', 'bad'], arms: ['Weapons', 'warn'], secret: ['Secret', 'accent'], plan: ['War plan', 'bad'], tech: ['Research', ''], money: ['Money', ''], mood: ['Mood', 'warn'], counter: ['Their spies', 'bad'] };

function reports(ctx) {
  const s = ctx.state;
  const me = s.you;
  const filter = ctx.ui.spyFilter ?? 'all';
  const sources = [...new Set((me.reports ?? []).map((r) => r.about))];
  const list = [...(me.reports ?? [])].reverse().filter((r) => filter === 'all' || r.about === filter);
  return h('div',
    h('label.field', h('span', 'From'), h('select', { onchange: (e) => { ctx.ui.spyFilter = e.target.value; ctx.rerender(); } },
      h('option', { value: 'all', selected: filter === 'all' }, 'All networks'),
      sources.map((id) => h('option', { value: id, selected: filter === id }, nationName(s, id))))),
    h('p.muted.small', 'Relayed in secret by agents who haven\'t been caught. A network that has been caught and turned feeds you lies, and you won\'t be told.'),
    h('div.list', { style: { marginTop: '10px' } }, list.length ? list.slice(0, 80).map((r) => h('div.item',
      h('div.item-head', flag(r.about), h('span.name', nationName(s, r.about)), h('span.chip', { class: KIND[r.kind]?.[1] ?? '' }, KIND[r.kind]?.[0] ?? 'Intel'), h('span.muted.small', { style: { marginLeft: 'auto' } }, `week ${r.w}`)),
      h('div.meta', { style: { color: 'var(--ink)' } }, r.text))) : [h('div.empty', 'No reports yet. Plant agents under Networks.')]));
}

/* ---------- Covert operations ---------- */

function ops(ctx) {
  const s = ctx.state;
  const me = s.you;
  const target = ctx.ui.opTarget ?? Object.keys(me.spies ?? {})[0] ?? countryOptions(s)[0]?.[0];
  const agents = me.spies?.[target]?.agents ?? 0;
  return h('div',
    h('label.field', h('span', 'Target'), h('select', { onchange: (e) => { ctx.ui.opTarget = e.target.value; ctx.rerender(); } },
      countryOptions(s).map(([id, name]) => h('option', { value: id, selected: id === target }, `${name}${me.spies?.[id] ? ` · ${me.spies[id].agents} agents` : ''}`)))),
    h('p.muted.small', agents ? `${agents} of our agents are inside ${nationName(s, target)}: operations there are more likely to work and less likely to be traced.` : `We have no agents in ${nationName(s, target)}. Operations are riskier without people on the ground.`),
    h('div.list', { style: { marginTop: '10px' } }, Object.entries(INTEL).map(([op, d]) => {
      const wait = (me.cooldown[`intel:${op}:${target}`] ?? -1) - s.week;
      return h('div.item', h('div.item-head', h('span.name', d.name), h('button.btn.small', { disabled: wait > 0, onclick: () => covert(ctx, op, target) }, wait > 0 ? `${wait} wk` : 'Order')), h('div.meta', d.note));
    })));
}

function covert(ctx, op, id) {
  const d = INTEL[op];
  if (d.region) {
    ctx.target({
      text: `${d.name}: pick a province held by ${nationName(ctx.state, id)}`,
      filter: (rid) => ctx.state.regions[ctx.regionIndex[rid]]?.[1] === id,
      reason: () => `Pick a province held by ${nationName(ctx.state, id)}.`,
      onPick: (rid) => { ctx.endTarget(); ctx.send({ type: 'intel', op, target: id, region: rid }); },
    });
    ctx.focusCountry(id);
    return;
  }
  ctx.send({ type: 'intel', op, target: id });
}

/* ---------- Counter-intelligence ---------- */

function counter(ctx) {
  const s = ctx.state;
  const me = s.you;
  const level = me.counterIntel ?? 1;
  const caught = Object.entries(me.caught ?? {}).sort((a, b) => b[1] - a[1]);
  const sweeping = (me.sweepUntil ?? 0) > s.week;
  const wait = (me.cooldown.sweep ?? -1) - s.week;
  return h('div',
    h('div.section', h('h3', 'Security service'),
      h('div.seg', COUNTER_INTEL.map((c, i) => h('button', { 'aria-pressed': String(i === level), onclick: () => ctx.send({ type: 'counterIntel', level: i }) }, c.name))),
      h('p.muted.small', { style: { marginTop: '6px' } }, `${COUNTER_INTEL[level].note} Costs ${money((me.gdp * COUNTER_INTEL[level].cost) / 100)} a year.`),
      h('p.muted.small', 'Foreign agents are caught more often when your service is bigger, your cyber level beats theirs, and their network is large. A vigilant or paranoid service sometimes turns a ring instead of arresting it, and it then feeds its masters lies.')),
    h('div.section', h('h3', 'Sweep for spies'),
      h('div.item', h('div.item-head', h('span.name', sweeping ? `Sweep under way until week ${me.sweepUntil}` : 'Order a sweep'),
        h('button.btn.small', { disabled: sweeping || wait > 0, onclick: () => ctx.send({ type: 'spySweep' }) }, sweeping ? 'Running' : wait > 0 ? `${wait} wk` : 'Start')),
      h('div.meta', `Six weeks of raids, phone taps and checkpoints: foreign agents are more than twice as likely to be caught. Costs about ${money(Math.max(0.05, me.gdp * 0.00015))}${me.gov === 'democracy' ? '; people resent it a little' : ''}.`))),
    h('div.section', h('h3', 'Caught spying on us'),
      caught.length ? h('div.list', caught.map(([id, w]) => h('div.item', h('div.item-head', flag(id), h('span.name', nationName(s, id)), h('span.muted.small', `last arrests week ${w}`)),
        h('div.actions', h('button.btn.small', { onclick: () => ctx.send({ type: 'embassy', target: id, action: 'expel' }) }, 'Expel their diplomats'), h('button.btn.small.ghost', { onclick: () => ctx.openCountry(id) }, 'Dossier')))))
        : h('div.empty', 'Nobody caught yet. That doesn\'t mean nobody is there.')),
  );
}

export { regionName };
