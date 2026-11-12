// The card that opens over the map for a province or an army.

import { $, h, flag, money, nationName, regionName, troops, num, people, RES_COLORS, RES_LETTERS, fill } from './dom.js';
import { RESOURCE_INFO, TERRAIN, PROVINCES } from '../engine/data/regions.js';
import { GEO } from '../engine/data/geo.js';
import { CHOKEPOINTS } from '../engine/data/world.js';
import { MINOR_TERRAIN } from '../engine/names.js';
import { PROJECT_WEEKS } from '../engine/economy.js';
import { AGGRESSION } from '../engine/military.js';
import { modal, numberField, selectField, confirmBox } from './dialogs.js';
import { armyCard, myArmies, formArmy } from './panels/military.js';

const TERRAIN_OF = Object.fromEntries(PROVINCES.map((p) => [p.id, p.terrain]));

export function closeInspector() {
  $('inspector').hidden = true;
}

export function showRegion(ctx, id) {
  const s = ctx.state;
  const row = s.regions[ctx.regionIndex[id]];
  if (!row) return closeInspector();
  const [owner, ctrl, dmg, infra, fort, battleBy, prog, unrest, gar, gdp, pop] = row;
  const me = s.me;
  const atWarWith = (x) => s.wars.some((w) => (w.a === me && w.b === x) || (w.b === me && w.a === x));
  const occupied = owner !== ctrl;
  const terrain = TERRAIN[TERRAIN_OF[id] ?? MINOR_TERRAIN[id] ?? 'plains'];
  const res = s.resources[id] ?? {};
  const armiesHere = s.armies.filter((a) => a.region === id && !a.sea);
  const mineHeld = ctrl === me;
  const mineOwned = owner === me;
  const enemyHeld = atWarWith(ctrl);
  const cps = Object.entries(CHOKEPOINTS).filter(([, cp]) => cp.regions.includes(id));
  const projects = s.you?.projects.filter((p) => p.region === id) ?? [];

  const fact = (label, value) => h('div', h('span', label), h('b', value));
  const actions = [];
  if (mineHeld && mineOwned) {
    actions.push(h('button.btn.small', { onclick: () => buildInfra(ctx, id, gdp) }, `Infrastructure (${infra}/10)`));
    actions.push(h('button.btn.small', { onclick: () => fortify(ctx, id, fort) }, `Fortify (${fort}/5)`));
    actions.push(h('button.btn.small', { onclick: () => formArmy(ctx, id) }, 'Form army here'));
  }
  if (mineHeld && !mineOwned) {
    actions.push(h('button.btn.small', { onclick: () => fortify(ctx, id, fort) }, `Fortify (${fort}/5)`));
    if (!s.minors[owner]?.capitulated) actions.push(h('button.btn.small.danger', { onclick: async () => { if (await confirmBox(`Annex ${regionName(id)}?`, 'It becomes part of your country. Its old owner will claim it back, and most countries will refuse to recognise the annexation.', { ok: 'Annex', danger: true })) ctx.send({ type: 'annex', region: id }); } }, 'Annex'));
  }
  if (enemyHeld) {
    actions.push(h('button.btn.small.primary', { onclick: () => pickArmy(ctx, id, 'attack') }, mineOwned ? 'Liberate…' : 'Attack…'));
    if (GEO[id].coast) actions.push(h('button.btn.small', { onclick: () => pickArmy(ctx, id, 'invade') }, 'Amphibious landing…'));
    actions.push(h('button.btn.small', { onclick: () => airStrike(ctx, id) }, 'Air campaign…'));
    actions.push(h('button.btn.small', { onclick: () => missile(ctx, id) }, 'Missile strike…'));
    if (s.you?.nukes > 0) actions.push(h('button.btn.small.danger', { onclick: () => nuke(ctx, id) }, '☢ Nuclear strike…'));
  }
  if (mineHeld) actions.push(h('button.btn.small', { onclick: () => pickArmy(ctx, id, 'hold') }, 'Send an army to hold it…'));
  if (!mineOwned) actions.push(h('button.btn.small.ghost', { onclick: () => ctx.openCountry(owner) }, `${nationName(s, owner)} dossier`));
  for (const [key, cp] of cps) {
    if (ctrl !== me) continue;
    const closedBy = s.chokepoints[key]?.closedBy;
    actions.push(closedBy === me
      ? h('button.btn.small', { onclick: () => ctx.send({ type: 'strait', key, close: false }) }, `Reopen the ${cp.name}`)
      : closedBy ? null : h('button.btn.small.danger', { onclick: async () => { if (await confirmBox(`Close the ${cp.name}?`, `${cp.note} Prices will spike and you will lose standing.`, { ok: 'Close it', danger: true })) ctx.send({ type: 'strait', key, close: true }); } }, `Close the ${cp.name}`));
  }

  fill($('inspector'),
    h('button.icon-btn.close', { onclick: () => ctx.closeSelection(), 'aria-label': 'Close' }, '✕'),
    h('h2', regionName(id)),
    h('div.row.gap.sub', flag(owner), h('span', nationName(s, owner)), occupied ? h('span.chip.bad', `Held by ${nationName(s, ctrl)}`) : null, GEO[id].coast ? h('span.chip', 'Coastal') : h('span.chip', 'Landlocked')),
    battleBy ? h('div.warning.bad', { style: { marginTop: '10px' } }, `Battle: ${nationName(s, battleBy)} is ${prog}% of the way to taking it.`) : null,
    h('div.facts',
      fact('Population', people(pop)), fact('Output', money(gdp)),
      fact('Terrain', `${terrain.name} (×${terrain.defend} defence)`), fact('Garrison', mineHeld || ctrl === me ? troops(gar) : `~${troops(Math.round(gar / 10) * 10)}`),
      fact('Infrastructure', `${infra}/10`), fact('Fortifications', `${fort}/5`),
      fact('War damage', `${dmg}%`), fact('Unrest', `${unrest}%`)),
    Object.keys(res).length ? h('div', h('h3.small.muted', { style: { margin: '4px 0 6px' } }, 'RESOURCES'), Object.entries(res).map(([r, [cur, pot]]) => {
      const info = RESOURCE_INFO[r];
      const developing = projects.some((p) => p.res === r);
      return h('div.res-row',
        h('span.res-dot', { style: { background: RES_COLORS[r] } }, RES_LETTERS[r]),
        h('span.grow', info.name, h('span.faint', ` ${cur}${pot > cur ? ` → ${pot}` : ''} ${info.unit}`)),
        mineOwned && mineHeld && pot > cur ? h('button.btn.small', { disabled: developing, onclick: () => develop(ctx, id, r, cur, pot) }, developing ? 'Developing' : 'Develop') : null);
    })) : h('p.muted.small', 'No major natural resources.'),
    projects.length ? h('div.meta', { style: { marginTop: '8px' } }, projects.map((p) => `${p.kind === 'develop' ? RESOURCE_INFO[p.res].name : p.kind === 'infra' ? 'Infrastructure' : 'Fortifications'}: ${Math.ceil(p.left)} weeks left`).join(' · ')) : null,
    armiesHere.length ? h('div', { style: { marginTop: '10px' } }, h('h3.small.muted', { style: { marginBottom: '6px' } }, 'ARMIES HERE'),
      h('div.list', armiesHere.map((a) => a.owner === me ? armyCard(ctx, a, true) : foreignArmy(ctx, a)))) : null,
    actions.length ? h('div.row.wrap.gap', { style: { marginTop: '12px' } }, actions) : null,
  );
  $('inspector').hidden = false;
}

export function showArmy(ctx, id) {
  const s = ctx.state;
  const a = s.armies.find((x) => x.id === id);
  if (!a) return closeInspector();
  fill($('inspector'),
    h('button.icon-btn.close', { onclick: () => ctx.closeSelection(), 'aria-label': 'Close' }, '✕'),
    h('h2', a.name),
    h('div.row.gap.sub', flag(a.owner), h('span', nationName(s, a.owner)), h('span.faint', a.sea ? 'at sea' : regionName(a.region))),
    h('div', { style: { marginTop: '10px' } }, a.owner === s.me ? armyCard(ctx, a, true) : foreignArmy(ctx, a)),
  );
  $('inspector').hidden = false;
}

function foreignArmy(ctx, a) {
  const s = ctx.state;
  return h('div.item',
    h('div.item-head', flag(a.owner), h('span.name', a.name), h('span.mono.small', `${a.exact ? '' : '~'}${troops(a.troops)}`)),
    h('div.meta', `${a.gen?.name ?? 'Unknown general'} · ${a.exact ? '' : 'about '}${num(a.tanks)} tanks`),
    a.status ? h('div.meta', a.status) : a.attacking ? h('div.meta.bad', `Attacking ${regionName(a.attacking)}`) : null,
    a.exact ? null : h('div.meta.faint', 'Spy on them for exact figures and plans.'),
    s.countries[a.owner] ? h('div.actions', h('button.btn.small.ghost', { onclick: () => ctx.openCountry(a.owner) }, 'Dossier')) : null);
}

/* ---------- Actions ---------- */

function pickArmy(ctx, target, kind) {
  const s = ctx.state;
  const list = myArmies(s).filter((a) => !a.sea && (kind !== 'invade' || GEO[a.region]?.coast));
  if (!list.length) {
    ctx.toast(kind === 'invade' ? 'You need an army group in a coastal province first.' : 'Form an army group first (Military tab).', 'warn');
    return;
  }
  const sel = selectField('Army group', list.map((a) => [a.id, `${a.name} · ${troops(a.troops)} · ${regionName(a.region)}`]));
  const aggr = selectField('How hard should the general push?', Object.entries(AGGRESSION).map(([k, v]) => [k, `${v.name}${k === 'cautious' ? ' (attacks only with clear odds)' : k === 'allout' ? ' (attacks whatever the odds)' : ''}`]), 'balanced');
  const verb = { attack: 'Attack', hold: 'Hold', invade: 'Land in' }[kind];
  modal({
    title: `${verb} ${regionName(target)}`,
    body: h('div.stack', sel.el, kind === 'hold' ? null : aggr.el, h('p.muted.small', kind === 'attack' ? 'The general picks the route and fights through any enemy provinces on the way.' : kind === 'invade' ? 'The army sails from its coastal province; enemy fleets can sink part of it on the way, and landings are costly.' : 'The army moves through friendly ground and digs in.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: verb, kind: 'primary', onClick: async () => !(await ctx.send({ type: 'armyOrder', id: sel.input.value, kind, target, aggr: aggr.input.value })) || false }],
  });
}

function develop(ctx, id, r, cur, pot) {
  const me = ctx.state.you;
  const info = RESOURCE_INFO[r];
  const cost = (pot - cur) * info.value * 0.8 * (0.45 + 0.55 * Math.min(1.2, (me.gdp / me.pop) / 60));
  modal({
    title: `Develop ${info.name.toLowerCase()} in ${regionName(id)}`,
    body: h('div.stack', h('p', `Raise output from ${cur} to ${pot} ${info.unit} a year.`), h('p.muted', `Costs about ${money(cost)} from reserves (${money(me.treasury)}) and takes ${PROJECT_WEEKS[r]} weeks.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Start', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'develop', region: id, res: r })) || false }],
  });
}

function buildInfra(ctx, id, gdp) {
  modal({
    title: `Infrastructure in ${regionName(id)}`,
    body: h('div.stack', h('p', 'Roads, rail, ports and power: the province\'s output rises 2%, armies move faster through it, and war damage heals sooner.'), h('p.muted', `Costs about ${money(gdp * 0.03 + 1)} and takes 26 weeks.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Build', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'infra', region: id })) || false }],
  });
}

function fortify(ctx, id, fort) {
  const me = ctx.state.you;
  const cost = (fort + 1) * 0.6 * (0.45 + 0.55 * Math.min(1.2, (me.gdp / me.pop) / 60));
  modal({
    title: `Fortify ${regionName(id)}`,
    body: h('div.stack', h('p', 'Trenches, bunkers and minefields: each level makes the province 15% harder to take.'), h('p.muted', `Costs ${money(cost)} from defence funds and takes 12 weeks.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Fortify', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fortify', region: id })) || false }],
  });
}

export function airStrike(ctx, id) {
  const me = ctx.state.you;
  const free = me.aircraft - me.airOps.reduce((t, o) => t + o.aircraft, 0);
  const f = numberField('Aircraft', { value: Math.floor(free * 0.3), min: 1, max: free, step: 1 });
  modal({
    title: `Air campaign over ${regionName(id)}`,
    body: h('div.stack', h('p.muted.small', `${free} aircraft free. Bombing raises damage to its industry, oil fields and mines each week; enemy fighters and air defences shoot some down.`), f.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Begin', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'air', region: id, aircraft: Number(f.input.value) })) || false }],
  });
}

export function missile(ctx, id) {
  const me = ctx.state.you;
  const f = numberField('Missiles', { value: Math.min(me.missiles, 50), min: 1, max: me.missiles, step: 1 });
  modal({
    title: `Missile strike on ${regionName(id)}`,
    body: h('div.stack', h('p.muted.small', `${me.missiles} missiles in stock. Air defences intercept some; the rest damage facilities and troops.`), f.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Fire', kind: 'danger', onClick: async () => !(await ctx.send({ type: 'missile', region: id, count: Number(f.input.value) })) || false }],
  });
}

async function nuke(ctx, id) {
  const ok = await confirmBox(`Use a nuclear weapon on ${regionName(id)}?`,
    h('div.stack', h('p', 'Millions will die. Every country will turn against you, your standing will collapse, and nuclear-armed enemies or their allies may strike back.'), h('p.bad', 'This cannot be undone.')),
    { ok: 'Launch', danger: true });
  if (ok) ctx.send({ type: 'nuke', region: id });
}
