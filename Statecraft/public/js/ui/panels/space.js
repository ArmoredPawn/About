// Research → Space: our satellites and what they give us, the space programmes, the race for the Moon and
// Mars, and anti-satellite strikes.

import { h, flag, money, nationName, bar } from '../dom.js';
import { confirmBox, modal, selectField } from '../dialogs.js';
import { SATS, PROGRAMMES, LAUNCH_WEEKS, MIN_LAUNCH_TECH, ASAT_COST, ASAT_TECH } from '../../engine/space.js';

const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);

export function space(ctx) {
  const s = ctx.state;
  const me = s.you;
  const sp = me.space;
  if (!sp) return h('div.empty', 'No space programme.');
  const tech = me.tech.missile ?? 0;
  const rockets = tech >= MIN_LAUNCH_TECH;
  return h('div',
    h('p.muted.small', 'Satellites change how wars are fought: spy satellites watch every army, navigation satellites guide missiles and bombs, communications satellites hold armies together. They wear out and must be replaced. Crewed spaceflight, a station, the Moon and Mars bring standing and pride, most of all for whoever gets there first.'),
    !rockets ? h('div.warning.info', { style: { marginTop: '8px' } }, `We have no rockets of our own: Missiles research level ${MIN_LAUNCH_TECH} or more launches satellites (we are at ${tech}).`) : null,
    s.space?.debris >= 5 ? h('div.warning.bad', { style: { marginTop: '8px' } }, `Debris from shot-down satellites fills orbit (${s.space.debris}%): every country's satellites wear out faster and launches fail more often.`) : null,
    h('div.section', { style: { marginTop: '14px' } }, h('h3', 'Our satellites'),
      h('div.list', Object.entries(SATS).map(([kind, d]) => {
        const n = sp.sats[kind];
        const coming = sp.building.filter((b) => b.kind === kind);
        const cost = d.cost * costFactor(me);
        const working = n >= d.need;
        return h('div.item',
          h('div.item-head', h('span.name', d.name), h('span.chip', { class: working ? 'good' : '' }, working ? 'working' : `${d.need} needed`), h('span.mono.small', { style: { marginLeft: 'auto' } }, `${n} in orbit`)),
          h('div.meta', d.note),
          kind === 'nav' && !working ? h('div.meta', 'Without our own, we use an ally\'s, or a neutral power\'s civilian signal at half the benefit, which goes dark if every country running one is at war with us.') : null,
          coming.length ? h('div.meta', `Launching: ${coming.map((b) => `${b.left} wk`).join(', ')}`) : null,
          h('div.actions', h('button.btn.small', { disabled: !rockets || sp.building.length >= 4, onclick: () => ctx.send({ type: 'satellite', kind }) }, `Launch one (${money(cost)}, ${LAUNCH_WEEKS} wk)`)));
      }))),
    h('div.section', h('h3', 'Space programmes'),
      h('div.list', Object.entries(PROGRAMMES).map(([kind, d]) => programmeCard(ctx, kind, d)))),
    race(ctx),
    h('div.section', h('h3', 'Anti-satellite weapons'),
      h('p.muted.small', `Shoot down another country's satellites (Missiles level ${ASAT_TECH}+, about ${money(ASAT_COST * costFactor(me))} a shot). It blinds an enemy, but every kill scatters debris that threatens everyone's satellites, ours too, and the world condemns it, most of all in peacetime.`),
      h('div.actions', h('button.btn.small.danger', { disabled: tech < ASAT_TECH, onclick: () => asatDialog(ctx) }, tech < ASAT_TECH ? `Needs Missiles level ${ASAT_TECH}` : 'Shoot down a satellite…'))));
}

function programmeCard(ctx, kind, d) {
  const s = ctx.state;
  const me = s.you;
  const sp = me.space;
  const done = sp.done[kind] != null;
  const run = sp.prog[kind];
  const locked = (me.tech.missile ?? 0) < d.tech || (d.needs && sp.done[d.needs] == null);
  const cost = d.cost * costFactor(me);
  const first = s.space?.firsts?.[kind];
  return h('div.item',
    h('div.item-head', h('span.name', d.name),
      done ? h('span.chip.good', sp.done[kind] < 0 ? 'achieved' : `achieved ${2027 + Math.floor(sp.done[kind] / 52)}`) : run ? h('span.chip', { class: run.stalled ? 'bad' : 'accent' }, run.stalled ? 'stalled: no money' : `${run.left} wk left`) : null,
      h('span.muted.small', { style: { marginLeft: 'auto' } }, `${money(cost)} over ${Math.round(d.weeks / 52 * 10) / 10} yr`)),
    h('div.meta', d.note, first ? ` First in this era: ${nationName(s, first.by)}, ${2027 + Math.floor(first.week / 52)}.` : ''),
    run ? h('div', { style: { marginTop: '6px' } }, bar(run.total - run.left, run.total, run.stalled ? 'bad' : '')) : null,
    !done && !run ? h('div.meta', locked ? `Needs Missiles research level ${d.tech}${d.needs ? ` and ${PROGRAMMES[d.needs].name.toLowerCase()} first` : ''}.` : 'Paid week by week; it stalls if the treasury runs low.') : null,
    h('div.actions',
      !done && !run ? h('button.btn.small.primary', { disabled: Boolean(locked), onclick: async () => { if (await confirmBox(`Start: ${d.name}?`, `About ${money(cost)} over ${Math.round(d.weeks / 52 * 10) / 10} years, paid weekly.`)) ctx.send({ type: 'spaceProgramme', kind }); } }, 'Start') : null,
      run ? h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Cancel: ${d.name}?`, 'The money spent so far is lost.', { ok: 'Cancel it', danger: true })) ctx.send({ type: 'spaceCancel', kind }); } }, 'Cancel') : null));
}

// Who has done what, and who is racing for what
function race(ctx) {
  const s = ctx.state;
  const rows = Object.entries(s.countries).filter(([, c]) => c.space && (Object.keys(c.space.done).length || Object.keys(c.space.prog).length));
  if (!rows.length) return null;
  const cell = (c, kind) => (c.space.done[kind] != null ? h('td', { class: 'good' }, '✓') : c.space.prog[kind] ? h('td.muted', `${c.space.prog[kind].left} wk`) : h('td.faint', '—'));
  return h('div.section', h('h3', 'The space race'),
    h('table.tbl', h('thead', h('tr', h('th', 'Country'), ...Object.values(PROGRAMMES).map((d) => h('th', d.name.split(' ')[0])), h('th.num', 'Satellites'))),
      h('tbody', rows.map(([id, c]) => h('tr', { class: id === s.me ? 'me' : '' },
        h('td', h('span.row.gap', flag(id), nationName(s, id))),
        ...Object.keys(PROGRAMMES).map((k) => cell(c, k)),
        h('td.num', String(Object.values(c.space.sats).reduce((a, b) => a + b, 0))))))));
}

function asatDialog(ctx) {
  const s = ctx.state;
  const targets = Object.entries(s.countries).filter(([id, c]) => id !== s.me && c.space && Object.values(c.space.sats).some((n) => n > 0));
  if (!targets.length) return ctx.hint('Nobody else has satellites.', 'info');
  const who = selectField('Country', targets.map(([id, c]) => [id, `${nationName(s, id)} (${c.space.sats.spy} spy, ${c.space.sats.nav} navigation, ${c.space.sats.comms} comms)`]));
  const kind = selectField('Satellite', Object.entries(SATS).map(([k, d]) => [k, d.name]));
  modal({
    title: 'Anti-satellite strike',
    body: h('div.stack', who.el, kind.el, h('p.muted.small', 'One interceptor, one or two satellites if it hits. The debris will spread through orbit for years.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Fire', kind: 'danger', onClick: async () => !(await ctx.send({ type: 'asat', target: who.input.value, kind: kind.input.value })) || false }],
  });
}
