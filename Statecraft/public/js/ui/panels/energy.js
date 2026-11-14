// Market → Oil & pipelines: the producers' cartel (its cut, embargoes and cheats), our strategic reserves, and
// the pipelines that carry oil and gas across borders.

import { h, flag, money, nationName } from '../dom.js';
import { confirmBox, modal, selectField } from '../dialogs.js';
import { CUTS, PIPELINES, PIPELINE_PROJECTS } from '../../engine/data/energy.js';
import { CHOKEPOINTS } from '../../engine/data/world.js';

const DEFS = Object.fromEntries([...PIPELINES, ...PIPELINE_PROJECTS].map((p) => [p.id, p]));
const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);

export function energy(ctx) {
  return h('div', cartel(ctx), reserves(ctx), pipelines(ctx));
}

/* ---------- The cartel ---------- */

function cartel(ctx) {
  const s = ctx.state;
  const me = s.you;
  const ct = s.cartel;
  const price = s.market.price.oil;
  if (!ct) {
    return h('div.section', h('h3', 'Oil cartel'),
      h('p.muted.small', 'There is no producers\' cartel: every country pumps as much as it likes. A major producer (3% of the world\'s oil) can found one.'),
      h('div.actions', h('button.btn.small', { onclick: () => foundDialog(ctx) }, 'Found a cartel…')));
  }
  const member = ct.members.includes(s.me);
  const chair = ct.chair === s.me;
  return h('div.section', h('h3', ct.name),
    h('p.muted.small', `${ct.share}% of the world's oil. The members agree a cut in output that ${nationName(s, ct.chair)} sets as leader: fewer barrels, higher prices. Each member decides whether to keep to it or quietly pump more, and cheats get caught. The leader can also embargo a country, as in 1973.`),
    h('div.kpis', { style: { margin: '8px 0' } },
      h('div.kpi', h('span', 'Production cut'), h('b', `${ct.cut}%`), h('small', `oil at ${Math.round(price * 100)}% of 2025`)),
      h('div.kpi', h('span', 'Leader'), h('b', flag(ct.chair)), h('small', `${nationName(s, ct.chair)} · ${ct.members.length} members`)),
      h('div.kpi', h('span', 'Embargoes'), h('b', String(ct.embargo.length)), h('small', ct.embargo.map((e) => nationName(s, e)).join(', ') || 'none'))),
    h('div.row.wrap.gap', ct.members.map((m) => h('span.chip', { title: nationName(s, m) }, flag(m), nationName(s, m)))),
    ct.embargo.includes(s.me) ? h('div.warning.bad', { style: { marginTop: '8px' } }, `${ct.name} has embargoed our oil. Our reserve covers the gap for a while; rationing (Economy) stretches it, and pipelines and non-members still sell to us.`) : null,
    chair ? chairControls(ctx) : null,
    member && !chair ? h('div', { style: { marginTop: '10px' } },
      h('div.field', h('span', 'Our quota'),
        h('div.seg',
          h('button', { 'aria-pressed': String(!me.cartelCheat), onclick: () => ctx.send({ type: 'cartelCheat', on: false }) }, `Keep to the ${ct.cut}% cut`),
          h('button', { 'aria-pressed': String(Boolean(me.cartelCheat)), onclick: () => ctx.send({ type: 'cartelCheat', on: true }) }, 'Quietly pump more'))),
      h('p.muted.small', { style: { marginTop: '4px' } }, me.cartelCheat ? 'We are pumping above our quota: more oil to sell, until tanker data gives us away. The leader can expel us.' : 'We keep to the quota, which holds prices up for everyone in the cartel.'),
      h('div.actions', h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Leave ${ct.name}?`, 'We can pump as much as we like, but prices will be lower for everyone.')) ctx.send({ type: 'cartelLeave' }); } }, 'Leave the cartel'))) : null,
    !member ? h('div.actions', { style: { marginTop: '10px' } },
      h('button.btn.small', { disabled: (ct.expelledUntil ?? -1) > s.week, onclick: () => ctx.send({ type: 'cartelJoin' }) }, (ct.expelledUntil ?? -1) > s.week ? `Expelled until ${Math.floor(ct.expelledUntil / 52) + 2027}` : `Join ${ct.name}`),
      h('span.muted.small', 'Members must produce at least 1.5% of the world\'s oil.')) : null);
}

function chairControls(ctx) {
  const s = ctx.state;
  const ct = s.cartel;
  const outsiders = Object.keys(s.countries).filter((id) => id !== s.me && !ct.members.includes(id) && !ct.embargo.includes(id) && !s.countries[id].exile);
  const pick = selectField('Embargo', outsiders.sort((a, b) => nationName(s, a).localeCompare(nationName(s, b))).map((id) => [id, nationName(s, id)]));
  return h('div', { style: { marginTop: '10px' } },
    h('div.field', h('span', 'Cut output by'), h('div.seg', CUTS.map((c) => h('button', { 'aria-pressed': String(c === ct.cut), onclick: () => ctx.send({ type: 'cartelCut', cut: c }) }, `${c}%`)))),
    h('p.muted.small', { style: { marginTop: '4px' } }, 'A deeper cut raises the price every member gets, but each of them sells less, and the temptation to cheat grows.'),
    ct.embargo.length ? h('div.list', { style: { marginTop: '8px' } }, ct.embargo.map((e) => h('div.item', h('div.item-head', flag(e), h('span.name', `Embargo on ${nationName(s, e)}`),
      h('button.btn.small.ghost', { style: { marginLeft: 'auto' }, onclick: () => ctx.send({ type: 'cartelEmbargo', target: e, on: false }) }, 'Lift'))))) : null,
    h('div.row.gap', { style: { marginTop: '8px', alignItems: 'flex-end' } }, pick.el,
      h('button.btn.small.danger', { onclick: async () => { const t = pick.input.value; if (await confirmBox(`Embargo ${nationName(s, t)}?`, 'Every member stops selling it oil, pipelines included. It will be furious, and its friends with it.', { ok: 'Embargo', danger: true })) ctx.send({ type: 'cartelEmbargo', target: t, on: true }); } }, 'Embargo')),
    h('div.list', { style: { marginTop: '8px' } }, ct.members.filter((m) => m !== s.me && s.countries[m]).map((m) => h('div.item',
      h('div.item-head', flag(m), h('span.name', nationName(s, m)),
        h('button.btn.small.ghost', { style: { marginLeft: 'auto' }, onclick: async () => { if (await confirmBox(`Expel ${nationName(s, m)}?`, 'It can\'t rejoin for two years.', { ok: 'Expel', danger: true })) ctx.send({ type: 'cartelExpel', target: m }); } }, 'Expel'))))));
}

function foundDialog(ctx) {
  const name = h('input', { placeholder: 'Name', maxlength: 24, value: 'The Producers\' Cartel' });
  modal({
    title: 'Found an oil cartel',
    body: h('div.stack', h('label.field', h('span', 'Name'), name), h('p.muted.small', 'You lead it and set its production cut. Other producers can join.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Found it', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'cartelFound', name: name.value })) || false }],
  });
}

/* ---------- Strategic reserves ---------- */

function reserves(ctx) {
  const s = ctx.state;
  const me = s.you;
  // Before the first week's market there is no demand figure yet
  const weeks = (r) => (me.demand?.[r] ? (me.stock?.[r] ?? 0) / me.demand[r] : null);
  const releasing = (r) => (me.releasing?.[r] ?? 0) > 0.01;
  const wait = (me.cooldown?.release ?? -1) - s.week;
  const row = (r, label) => h('div.item',
    h('div.item-head', h('span.name', label), h('span.mono.small', { style: { marginLeft: 'auto' }, class: weeks(r) == null ? '' : weeks(r) < 2 ? 'bad' : weeks(r) < 5 ? 'warn' : '' }, weeks(r) == null ? 'measuring…' : `${weeks(r).toFixed(1)} weeks of need`)),
    releasing(r) ? h('div.meta', 'A release is under way.') : null,
    h('div.actions',
      h('button.btn.small', { disabled: wait > 0 || (weeks(r) ?? 0) < 1, onclick: () => ctx.send({ type: 'releaseReserve', res: r, share: 0.25 }) }, 'Release a quarter'),
      h('button.btn.small', { disabled: wait > 0 || (weeks(r) ?? 0) < 1, onclick: () => ctx.send({ type: 'releaseReserve', res: r, share: 0.5 }) }, 'Release half'),
      wait > 0 ? h('span.muted.small', `next release in ${wait} wk`) : null));
  return h('div.section', h('h3', 'Strategic reserves'),
    h('p.muted.small', 'Our reserves cover any shortfall on their own. Releasing puts part of them on the world market over a few weeks: more supply, lower prices for everyone, and money for us. Use it in a price shock, not under an embargo (rationing stretches the reserve instead).'),
    h('div.list', row('oil', 'Oil'), row('gas', 'Gas')),
    h('div.row.gap', { style: { marginTop: '8px' } }, h('span.small', me.ration ? 'Fuel and food rationing is on.' : 'No rationing.'),
      h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'ration', on: !me.ration }) }, me.ration ? 'End rationing' : 'Ration fuel and food')));
}

/* ---------- Pipelines ---------- */

function pipelines(ctx) {
  const s = ctx.state;
  const live = s.pipelines ?? [];
  const built = live.filter((p) => p.status !== 'building');
  const building = live.filter((p) => p.status === 'building');
  const projects = PIPELINE_PROJECTS.filter((d) => !live.some((p) => p.id === d.id));
  return h('div.section', h('h3', 'Pipelines'),
    h('p.muted.small', 'Oil and gas by pipeline arrive whatever happens at sea: blockades, closed straits and embargoes can\'t stop them. The country holding the start can shut one as leverage; anyone else can try to blow it up. A bypass pipeline gets an exporter\'s oil round a strait.'),
    h('div.list', built.map((p) => pipelineCard(ctx, p))),
    building.length || projects.length ? h('h3', { style: { marginTop: '12px' } }, 'Planned pipelines') : null,
    h('div.list', [...building.map((p) => pipelineCard(ctx, p)), ...projects.map((d) => projectCard(ctx, d))]));
}

const route = (s, d) => (d.bypass ? `${nationName(s, d.seller)}'s ${d.res}, round the ${CHOKEPOINTS[d.bypass].name}` : `${nationName(s, d.seller)} → ${d.buyers.map((b) => nationName(s, b)).join(', ')}`);

function pipelineCard(ctx, p) {
  const s = ctx.state;
  const d = DEFS[p.id];
  const holder = s.regions[ctx.regionIndex[d.from]]?.[1];
  const party = d.seller === s.me || d.buyers?.includes(s.me);
  const status = p.status === 'building' ? h('span.chip', `building, ${p.left} wk`)
    : p.status === 'sabotaged' ? h('span.chip.bad', `wrecked, ${p.until - s.week} wk`)
      : p.status === 'shut' ? h('span.chip.warn', 'shut')
        : p.flowing ? h('span.chip.good', 'flowing') : h('span.chip.bad', 'cut by war');
  return h('div.item',
    h('div.item-head', h('span.name', d.name), h('span.chip', d.res), status),
    h('div.meta', `${route(s, d)} · ${Math.round(d.share * 100)}% of ${d.bypass ? 'exports' : 'their need'}`),
    h('div.meta.faint', d.note),
    h('div.actions',
      holder === s.me && p.status === 'open' ? h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Shut the ${d.name}?`, 'Buyers lose that supply and will be angry. A powerful lever, used sparingly.')) ctx.send({ type: 'pipeline', id: p.id, shut: true }); } }, 'Shut it') : null,
      holder === s.me && p.status === 'shut' ? h('button.btn.small', { onclick: () => ctx.send({ type: 'pipeline', id: p.id, shut: false }) }, 'Reopen it') : null,
      !party && p.status !== 'sabotaged' && p.status !== 'building' ? h('button.btn.small.danger', {
        onclick: async () => { if (await confirmBox(`Sabotage the ${d.name}?`, `Our agents try to blow it up (about ${money(3 * costFactor(s.you))}). If it works it is out of action for months. If we are caught, ${nationName(s, d.seller)} and its buyers will be furious.`, { ok: 'Do it', danger: true })) ctx.send({ type: 'pipelineSabotage', id: p.id }); },
      }, 'Sabotage…') : null));
}

function projectCard(ctx, d) {
  const s = ctx.state;
  const party = d.seller === s.me || d.buyers?.includes(s.me);
  const cost = d.cost * costFactor(s.you);
  return h('div.item',
    h('div.item-head', h('span.name', d.name), h('span.chip', d.res), h('span.muted.small', { style: { marginLeft: 'auto' } }, `${money(cost)} · ${Math.round(d.weeks / 52 * 10) / 10} years`)),
    h('div.meta', `${route(s, d)} · ${Math.round(d.share * 100)}% of ${d.bypass ? 'exports' : 'their need'}`),
    h('div.meta.faint', d.note),
    party ? h('div.actions', h('button.btn.small', { onclick: async () => { if (await confirmBox(`Build the ${d.name}?`, `It costs ${money(cost)} and takes ${Math.round(d.weeks / 52 * 10) / 10} years. The other countries involved must be on decent terms with us.`)) ctx.send({ type: 'pipelineBuild', id: d.id }); } }, 'Build it')) : null);
}
