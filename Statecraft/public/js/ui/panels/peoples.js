// Govern → Peoples: how loyal each of our provinces is and why, independence movements and referendums, the
// policy for each province (integrate, autonomy, crackdown), occupied lands, and refugees.

import { h, flag, money, nationName, regionName, bar, people } from '../dom.js';
import { confirmBox } from '../dialogs.js';
import { MOVEMENTS } from '../../engine/data/peoples.js';
import { POLICIES, referendumOdds, REFERENDUM_COOLDOWN } from '../../engine/peoples.js';

const POLICY_KEYS = Object.keys(POLICIES);

// Our provinces with their people, loyalty and policy
function ours(ctx) {
  const s = ctx.state;
  return Object.entries(ctx.regionIndex)
    .map(([id, i]) => ({ id, row: s.regions[i] }))
    .filter(({ row }) => row[1] === s.me)
    .map(({ id, row }) => ({ id, owner: row[0], loyalty: row[13] ?? 50, policy: row[14] ?? 'integrate', people: row[15] ?? row[0], pop: row[10], rebels: row[11] }));
}

export const loyaltyTone = (v) => (v >= 60 ? 'good' : v >= 35 ? 'warn' : 'bad');

export function peoples(ctx) {
  const s = ctx.state;
  const me = s.you;
  const list = ours(ctx);
  const popTotal = list.reduce((t, r) => t + r.pop, 0) || 1;
  const avg = list.reduce((t, r) => t + r.loyalty * r.pop, 0) / popTotal;
  const movements = list.filter((r) => MOVEMENTS[r.id] && r.people === s.me && r.owner === s.me);
  const conquered = list.filter((r) => r.people !== s.me);
  const restless = list.filter((r) => r.people === s.me && !MOVEMENTS[r.id] && r.loyalty < 45);
  const atRisk = list.filter((r) => r.loyalty < 25).length;
  return h('div',
    h('div.kpis', { style: { marginBottom: '10px' } },
      h('div.kpi', h('span', 'Loyalty'), h('b', { class: loyaltyTone(avg) }, `${Math.round(avg)}%`), h('small', 'across our people')),
      h('div.kpi', h('span', 'At risk'), h('b', { class: atRisk ? 'bad' : '' }, String(atRisk)), h('small', 'provinces near revolt')),
      h('div.kpi', h('span', 'Refugees'), h('b', people(me.refugees ?? 0)), h('small', me.refugeeCost ? `${money(me.refugeeCost)} a year` : 'none hosted'))),
    h('p.muted.small', 'Every province has a people and a loyalty to whoever rules it. Below about 40, unrest grows; below 15, uprisings break out, and partisans starve occupying armies of supply. An uprising that outlasts our grip ends with the province gone: back to its own nation, or independent.'),
    movements.length ? h('div.section', h('h3', 'Movements for independence'), h('div.list', movements.map((r) => provinceRow(ctx, r, true)))) : null,
    conquered.length ? h('div.section', h('h3', 'Conquered lands'),
      h('p.muted.small', 'A conquered people resists for years. Governing well wins them over slowly; a crackdown keeps a lid on them but makes them hate us more.'),
      h('div.list', conquered.map((r) => provinceRow(ctx, r)))) : null,
    restless.length ? h('div.section', h('h3', 'Restless provinces'), h('div.list', restless.map((r) => provinceRow(ctx, r)))) : null,
    !movements.length && !conquered.length && !restless.length ? h('div.empty', { style: { marginTop: '10px' } }, 'Every province is content.') : null,
    refugees(ctx));
}

function provinceRow(ctx, r, movement = false) {
  const s = ctx.state;
  const mv = MOVEMENTS[r.id];
  const info = s.you.provinces?.[r.id];
  return h('div.item.clickable', { onclick: () => ctx.openRegion(r.id, true) },
    h('div.item-head', r.people !== s.me ? flag(r.people) : null, h('span.name', regionName(r.id)),
      r.rebels ? h('span.chip.bad', 'Uprising') : null,
      h('span.mono.small', { style: { marginLeft: 'auto' }, class: loyaltyTone(r.loyalty) }, `${r.loyalty}% loyal`)),
    h('div.meta', movement && mv ? `${mv.people}: ${mv.joins ? `want to join ${nationName(s, mv.joins)}` : `want ${mv.state} to be independent`}` : r.people !== s.me ? `${nationName(s, r.people)}'s people` : 'Our people'),
    h('div.row.gap.small', { style: { marginTop: '6px' } }, h('div.grow', bar(r.loyalty, 100, loyaltyTone(r.loyalty))), info ? h('span.muted', `heading for ${info.target}%`) : null),
    h('div', { onclick: (e) => e.stopPropagation() }, policyControls(ctx, r.id, r.policy, movement)));
}

// The policy buttons and the referendum, used in the panel and on the province card
export function policyControls(ctx, id, policy, movement) {
  const s = ctx.state;
  const info = s.you?.provinces?.[id];
  const row = s.regions[ctx.regionIndex[id]];
  const loyalty = row?.[13] ?? 50;
  const odds = referendumOdds({ loyalty });
  const lastVote = info?.referendumAt;
  const wait = lastVote != null ? lastVote + REFERENDUM_COOLDOWN - s.week : 0;
  return h('div',
    h('div.seg', { style: { marginTop: '8px' } }, POLICY_KEYS.map((k) => h('button', {
      'aria-pressed': String(k === policy), title: POLICIES[k].note,
      onclick: () => ctx.send({ type: 'provincePolicy', region: id, policy: k }),
    }, POLICIES[k].name))),
    h('p.muted.small', { style: { marginTop: '4px' } }, POLICIES[policy]?.note ?? ''),
    movement ? h('div.actions',
      h('button.btn.small', {
        disabled: wait > 0 || Boolean(row?.[11]),
        onclick: async () => {
          if (await confirmBox(`Hold a referendum in ${regionName(id)}?`, `On today's mood about ${Math.round(odds.leave * 100)}% would vote to leave. If they vote to leave, ${regionName(id)} becomes independent peacefully. If they vote to stay, the movement loses its momentum for about fifteen years. The world will respect it either way.`, { ok: 'Hold it', danger: odds.likely })) ctx.send({ type: 'referendum', region: id });
        },
      }, wait > 0 ? `Referendum possible in ${Math.ceil(wait / 52)} yr` : `Hold a referendum (~${Math.round(odds.leave * 100)}% to leave)`),
      info?.placatedUntil > s.week ? h('span.chip.good', 'Voted to stay') : null) : null);
}

// The block on the province card
export function provincePeople(ctx, id) {
  const s = ctx.state;
  const row = s.regions[ctx.regionIndex[id]];
  if (!row) return null;
  const [owner, ctrl] = row;
  const loyalty = row[13] ?? 50;
  const policy = row[14] ?? 'integrate';
  const peopleOf = row[15] ?? owner;
  const mv = MOVEMENTS[id];
  const movement = mv && peopleOf === owner && owner === ctrl && s.countries[owner];
  const mine = ctrl === s.me;
  const info = mine ? s.you.provinces?.[id] : null;
  const who = s.minors[peopleOf]?.home === id ? `${nationName(s, peopleOf)} (independent)` : movement ? `${mv.people} (${mv.joins ? `seeking union with ${nationName(s, mv.joins)}` : 'independence movement'})` : `${nationName(s, peopleOf)}'s people`;
  return h('div', { style: { marginTop: '10px' } },
    h('h3.small.muted', { style: { marginBottom: '6px' } }, 'PEOPLE'),
    h('div.row.gap.small', h('span', who), h('span.mono', { style: { marginLeft: 'auto' }, class: loyaltyTone(loyalty) }, `${loyalty}% loyal to ${nationName(s, ctrl)}`)),
    h('div', { style: { marginTop: '4px' } }, bar(loyalty, 100, loyaltyTone(loyalty))),
    info?.why?.length ? h('div.meta', { style: { marginTop: '4px' } }, `Heading for ${info.target}%: `, info.why.map(([d, text]) => `${d > 0 ? '+' : '−'}${Math.abs(d)} ${text}`).join(', ')) : null,
    mine ? policyControls(ctx, id, policy, Boolean(movement)) : policy !== 'integrate' ? h('div.meta', `${nationName(s, ctrl)}'s policy: ${POLICIES[policy].name.toLowerCase()}`) : null);
}

function refugees(ctx) {
  const s = ctx.state;
  const me = s.you;
  const from = Object.entries(me.refugeesFrom ?? {}).filter(([, v]) => v >= 0.005).sort((a, b) => b[1] - a[1]);
  return h('div.section', h('h3', 'Refugees'),
    h('p.muted.small', 'War, uprisings and ruin drive people across the nearest open border. Taking them in costs money, and a large influx strains a democracy\'s patience; about a third settle each year and join the workforce. Closing the border turns them away, which the world condemns.'),
    from.length ? h('div.meta', `Arrived from ${from.map(([id, v]) => `${nationName(s, id)} (${people(v)})`).join(', ')}.`) : h('div.meta', 'No refugees have come to us.'),
    h('div.seg', { style: { marginTop: '8px' } },
      h('button', { 'aria-pressed': String(!me.borderClosed), onclick: () => ctx.send({ type: 'border', closed: false }) }, 'Border open'),
      h('button', { 'aria-pressed': String(Boolean(me.borderClosed)), onclick: () => ctx.send({ type: 'border', closed: true }) }, 'Border closed')));
}
