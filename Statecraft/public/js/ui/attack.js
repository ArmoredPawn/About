// Attacking a province: pick the army group, the kind of attack and how hard to push, in one dialog.
// If the province belongs to a country we're not at war with, the same click declares war (leaving any
// alliance we share with it).

import { h, fill, regionName, nationName, troops } from './dom.js';
import { modal } from './dialogs.js';
import { GEO } from '../engine/data/geo.js';
import { TERRAIN, PROVINCES } from '../engine/data/regions.js';
import { MINOR_TERRAIN } from '../engine/names.js';
import { route, hypotheticalWar, landingProblem, AGGRESSION, blockers, noRouteReason } from '../engine/military.js';
import { atWar, friendlyGround } from '../engine/core.js';
import { fauxState, CAPITALS } from './map.js';

const TERRAIN_OF = Object.fromEntries(PROVINCES.map((p) => [p.id, p.terrain]));
const terrainOf = (id) => TERRAIN[TERRAIN_OF[id] ?? MINOR_TERRAIN[id] ?? 'plains'];

const row = (ctx, id) => ctx.state.regions[ctx.regionIndex[id]];
const holderOf = (ctx, id) => row(ctx, id)?.[1];

// Can this province be attacked at all (setting aside routes)? Not our own, not a puppet, not a fallen nation.
export function attackable(ctx, id) {
  const s = ctx.state;
  const holder = holderOf(ctx, id);
  if (!holder || holder === s.me) return false;
  const m = s.minors[holder];
  if (m && (m.puppetOf === s.me || m.capitulated)) return false;
  if (s.countries[holder]?.exile) return false;
  return true;
}

// What an army could do against a province: a land route, a landing, and whether war must be declared first
export function attackOptions(ctx, army, target) {
  const s = ctx.state;
  const foe = holderOf(ctx, target);
  const faux = fauxState(s);
  const declare = !atWar(faux, s.me, foe);
  const world = declare ? hypotheticalWar(faux, s.me, foe) : faux;
  const path = army.sea ? null : route(world, s.me, army.region, target, { offensive: true });
  const seaWhy = army.sea ? 'The army is at sea.' : landingProblem(world, { id: s.me, ships: s.you.ships, carriers: s.you.carriers }, army.region, target);
  const shared = s.alliances.filter((al) => al.members.includes(s.me) && al.members.includes(foe));
  return { foe, declare, world, path, ground: Boolean(path), sea: !seaWhy, seaWhy, shared };
}

// Why this army can't attack that province, in plain words, or null if it can
export function attackBlocker(ctx, army, target) {
  const s = ctx.state;
  const holder = holderOf(ctx, target);
  const name = nationName(s, holder);
  if (!holder) return null;
  if (holder === s.me) return `${regionName(target)} is already ours. To move there, use Move / hold.`;
  const m = s.minors[holder];
  if (m?.puppetOf === s.me) return `${name} is our puppet state: its land is already ours to use.`;
  if (m?.capitulated) return `${name} has already surrendered. Decide its fate in Diplomacy.`;
  if (s.countries[holder]?.exile) return `${name}'s government has fallen.`;
  if (army.sea) return `${army.name} is at sea and can't take new orders until it lands.`;
  const o = attackOptions(ctx, army, target);
  if (o.ground || o.sea) return null;
  const land = noRouteReason(o.world, s.me, army.region, target).replace(' Try an amphibious landing.', '');
  return `Can't attack ${regionName(target)}. ${land} ${GEO[target].coast ? `No landing either: ${o.seaWhy}` : 'It is landlocked, so a landing is impossible.'}`;
}

export const canAttackWith = (ctx, army, target) => {
  if (!attackable(ctx, target)) return false;
  const o = attackOptions(ctx, army, target);
  return o.ground || o.sea;
};

// A rough read of the odds at the first enemy province the army must take
function odds(ctx, army, target, kind, opts) {
  const s = ctx.state;
  const first = kind === 'invade' ? target : (opts.path ?? []).find((id) => !friendlyGround(opts.world, s.me, holderOf(ctx, id))) ?? target;
  const r = row(ctx, first);
  const holder = r[1];
  let def = r[8];
  // Once war starts the defender moves its home forces up to the new front: allow for that before declaring
  if (opts.declare && holder === opts.foe) {
    const theirs = Object.keys(ctx.regionIndex).filter((id) => holderOf(ctx, id) === holder);
    const front = theirs.filter((id) => GEO[id].adj.some((x) => holderOf(ctx, x) === s.me)).length || 1;
    const hasCapital = theirs.includes(CAPITALS[holder]);
    const w0 = 1 + (CAPITALS[holder] === first ? 2 : 0);
    const onFront = GEO[first].adj.some((x) => holderOf(ctx, x) === s.me);
    def *= ((w0 + (onFront ? 5 : 0)) / (theirs.length + (hasCapital ? 2 : 0) + 5 * front)) / (w0 / (theirs.length + (hasCapital ? 2 : 0)));
  }
  for (const a of s.armies) if (a.region === first && !a.sea && a.owner !== s.me && (a.owner === holder || !friendlyGround(opts.world, s.me, a.owner))) def += a.troops;
  const terrain = terrainOf(first);
  const defence = Math.max(1, def * terrain.defend * (1 + 0.15 * r[4]));
  const attack = (army.troops + army.tanks * 0.05 * terrain.armor) * (0.35 + 0.65 * army.org / 100) * (kind === 'invade' ? 0.5 : 1);
  return { first, def, terrain, fort: r[4], ratio: attack / defence };
}

function seg(options, value, onPick) {
  const el = h('div.seg', options.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === value), onclick: () => onPick(k) }, label)));
  return el;
}

// Neutral countries in the way: offer to ask them for military access
function accessButtons(ctx, world, army, target) {
  const s = ctx.state;
  const block = blockers(world, s.me, army.region, target).filter((x) => x !== holderOf(ctx, target) && s.countries[x] && !s.countries[x].exile);
  if (!block.length) return null;
  return h('div.row.wrap.gap', { style: { marginTop: '4px' } }, block.map((x) => h('button.btn.small', { type: 'button', onclick: async () => {
    const err = await ctx.send({ type: 'propose', to: x, kind: 'access', terms: {} });
    if (!err) ctx.toast(`Asked ${nationName(s, x)} for military access. ${s.countries[x].human ? 'Its leader will answer.' : 'They will answer within a week.'}`, 'info');
  } }, `Ask ${nationName(s, x)} for access`)));
}

// When the only way in crosses neutral land, explain and offer to ask for access
function accessDialog(ctx, army, target) {
  const s = ctx.state;
  const world = attackOptions(ctx, army, target).world;
  const buttons = accessButtons(ctx, world, army, target);
  if (!buttons) return false;
  modal({
    title: `No way through to ${regionName(target)}`,
    body: h('div.stack', h('p', noRouteReason(world, s.me, army.region, target)), buttons,
      h('p.muted.small', 'A country that grants access lets your troops and tanks pass. One that refuses has to be fought through.')),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
  return true;
}

// opts: { army } to attack with a given army, or { target } alone to choose the army in the dialog
export function attackDialog(ctx, { army, target }) {
  const s = ctx.state;
  const candidates = army ? [army] : s.armies.filter((a) => a.owner === s.me && !a.sea && canAttackWith(ctx, a, target));
  if (!candidates.length) {
    const mine = s.armies.filter((a) => a.owner === s.me && !a.sea);
    if (!mine.length) return ctx.hint('No army groups yet. Draft & form one (Military → Troops, or click one of your provinces), then attack.', 'bad');
    const best = mine.reduce((m, a) => (a.troops > m.troops ? a : m));
    return accessDialog(ctx, best, target) || ctx.hint(attackBlocker(ctx, best, target) ?? `None of our army groups can reach ${regionName(target)}.`, 'bad');
  }
  // Start with the strongest army that can reach it
  let pick = candidates.reduce((m, a) => (a.troops > m.troops ? a : m));
  let kind = null;
  let aggr = 'balanced';
  const box = h('div.stack');
  let launch;

  const draw = () => {
    const o = attackOptions(ctx, pick, target);
    if (!kind || (kind === 'attack' && !o.ground) || (kind === 'invade' && !o.sea)) kind = o.ground ? 'attack' : o.sea ? 'invade' : null;
    const foeName = nationName(s, o.foe);
    const defenders = new Set();
    for (const al of s.alliances) if (al.kind === 'military' && al.members.includes(o.foe)) for (const m of al.members) if (m !== o.foe && m !== s.me) defenders.add(m);
    const g = s.minors[o.foe]?.guarantor;
    if (g && g !== s.me) defenders.add(g);
    const types = [];
    if (o.ground) types.push(['attack', 'Ground offensive']);
    if (o.sea) types.push(['invade', 'Amphibious landing']);
    const est = kind ? odds(ctx, pick, target, kind, o) : null;
    const verdict = !est ? '' : est.ratio >= 1.3 ? 'favourable' : est.ratio >= 0.8 ? 'close' : 'poor: bring more troops or push all-out';
    fill(box,
      o.declare ? h('div.warning.bad', h('span',
        h('b', `You are not at war with ${foeName}. `),
        `Attacking declares war${o.shared.length ? ` and takes you out of ${o.shared.map((al) => al.name).join(' and ')}` : ''}. It costs world standing and may bring sanctions.`,
        defenders.size ? ` Its allies may join in: ${[...defenders].map((d) => nationName(s, d)).join(', ')}.` : '')) : null,
      candidates.length > 1 ? h('label.field', h('span', 'Army group'),
        h('select', { onchange: (e) => { pick = candidates.find((a) => a.id === e.target.value); draw(); } },
          candidates.map((a) => h('option', { value: a.id, selected: a === pick }, `${a.name} · ${troops(a.troops)} · ${regionName(a.region)}`))))
        : h('p.small', h('b', pick.name), ` · ${troops(pick.troops)} troops, ${Math.round(pick.tanks)} tanks · in ${regionName(pick.region)}`),
      h('div.field', h('span', 'Type of attack'),
        types.length ? seg(types, kind, (k) => { kind = k; draw(); }) : h('p.bad.small', 'This army can\'t reach it.'),
        !o.ground ? h('p.muted.small', noRouteReason(o.world, s.me, pick.region, target)) : null,
        !o.ground ? accessButtons(ctx, o.world, pick, target) : null,
        o.ground && !o.sea ? h('p.muted.small', `No amphibious option: ${o.seaWhy.charAt(0).toLowerCase()}${o.seaWhy.slice(1)}`) : null),
      h('div.field', h('span', 'How hard to push'),
        seg(Object.entries(AGGRESSION).map(([k, v]) => [k, v.name]), aggr, (k) => { aggr = k; draw(); }),
        h('p.muted.small', { cautious: 'Attacks only with clear odds; fewer losses.', balanced: 'Attacks when the odds are about even.', allout: 'Attacks whatever the odds; heavy losses.' }[aggr])),
      est ? h('p.small', `First objective: ${regionName(est.first)}, held by about ${troops(Math.round(est.def / 5) * 5)} (${est.terrain.name.toLowerCase()}${est.fort ? `, forts ${est.fort}/5` : ''}). Rough odds ${est.ratio.toFixed(1)} : 1, `, h('b', { class: est.ratio >= 1.3 ? 'good' : est.ratio >= 0.8 ? '' : 'bad' }, verdict), '.') : null,
      kind === 'attack' && o.path.length > 1 ? h('p.muted.small', `The general marches via ${o.path.slice(0, -1).map(regionName).join(', ')} and fights anything in the way.`) : null,
      kind === 'invade' ? h('p.muted.small', 'The army sails from its port; enemy fleets can sink part of it on the way, and landings are costly.') : null,
    );
    if (launch) {
      launch.disabled = !kind;
      launch.textContent = o.declare ? 'Declare war & attack' : 'Attack';
      launch.className = `btn ${o.declare ? 'danger' : 'primary'}`;
    }
  };
  draw();
  const m = modal({
    title: `Attack ${regionName(target)}`,
    body: box,
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Attack', kind: 'primary', onClick: async () => {
        if (!kind) return false;
        const err = await ctx.send({ type: 'armyOrder', id: pick.id, kind, target, aggr, declare: true });
        if (err) return false;
        ctx.toast(`${pick.name}: ${kind === 'invade' ? 'landing at' : 'attacking'} ${regionName(target)}.`, 'good');
        return true;
      },
    }],
  });
  launch = m.el.querySelector('.modal-foot .btn:last-child');
  draw();
}
