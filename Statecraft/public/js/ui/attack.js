// Sending armies: select an army, click anywhere on the map, and it goes there. Friendly ground it marches
// through; enemy ground it fights through; across water it lands. If the province belongs to a country we're
// not at war with, one short dialog declares war first (with the option of making the case to the nation).

import { h, regionName, nationName, troops } from './dom.js';
import { modal } from './dialogs.js';
import { GEO } from '../engine/data/geo.js';
import { route, hypotheticalWar, landingProblem, blockers, noRouteReason } from '../engine/military.js';
import { atWar, friendlyGround } from '../engine/core.js';
import { fauxState } from './map.js';

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

// How an army would get to a province: { friendly, foe, declare, world, path, sea, seaWhy, shared }
export function goOptions(ctx, army, target) {
  const s = ctx.state;
  const faux = fauxState(s);
  const foe = holderOf(ctx, target);
  const friendly = friendlyGround(faux, s.me, foe);
  const declare = !friendly && !atWar(faux, s.me, foe);
  const world = declare ? hypotheticalWar(faux, s.me, foe) : faux;
  let path = null;
  if (!army.sea) {
    path = friendly ? route(world, s.me, army.region, target, { offensive: false }) : null;
    path ??= route(world, s.me, army.region, target, { offensive: true });
  }
  const seaWhy = army.sea ? 'The army is at sea.' : friendly ? 'It is friendly ground.' : landingProblem(world, { id: s.me, ships: s.you.ships, carriers: s.you.carriers }, army.region, target);
  const shared = s.alliances.filter((al) => al.members.includes(s.me) && al.members.includes(foe));
  return { friendly, foe, declare, world, path, ground: Boolean(path), sea: !seaWhy, seaWhy, shared };
}
export const attackOptions = goOptions;

// Why this army can't go to that province, in plain words, or null if it can
export function goBlocker(ctx, army, target) {
  const s = ctx.state;
  const holder = holderOf(ctx, target);
  const name = nationName(s, holder);
  if (!holder) return null;
  if (army.sea) return `${army.name} is at sea and can't take new orders until it lands.`;
  if (army.region === target) return `${army.name} is already in ${regionName(target)}.`;
  const m = s.minors[holder];
  if (m?.capitulated) return `${name} has already surrendered. Decide its fate in Diplomacy.`;
  if (s.countries[holder]?.exile) return `${name}'s government has fallen.`;
  const o = goOptions(ctx, army, target);
  if (o.ground || o.sea) return null;
  const land = noRouteReason(o.world, s.me, army.region, target).replace(' Try an amphibious landing.', '');
  if (o.friendly) return land;
  return `Can't reach ${regionName(target)}. ${land} ${GEO[target].coast ? `No landing either: ${o.seaWhy}` : ''}`.trim();
}
export const attackBlocker = goBlocker;
export const canGo = (ctx, army, target) => !goBlocker(ctx, army, target);
export const canAttackWith = (ctx, army, target) => attackable(ctx, target) && canGo(ctx, army, target);

// The route preview drawn while choosing
export function goPath(ctx, army, target) {
  const o = goOptions(ctx, army, target);
  return o.path ?? (o.sea ? [target] : null);
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

function accessDialog(ctx, army, target) {
  const s = ctx.state;
  const world = goOptions(ctx, army, target).world;
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

// Has the leader made the case for war against this country recently?
export const caseMade = (s, foe) => (s.you?.warCases?.[foe] ?? -1) >= s.week;

// The warnings and the "address the nation" choice shown before declaring war. Returns { el, justify() }.
export function warNotice(ctx, foe, shared = []) {
  const s = ctx.state;
  const defenders = new Set();
  for (const al of s.alliances) if (al.kind === 'military' && al.members.includes(foe)) for (const m of al.members) if (m !== foe && m !== s.me) defenders.add(m);
  const g = s.minors[foe]?.guarantor;
  if (g && g !== s.me) defenders.add(g);
  const made = caseMade(s, foe);
  const wait = (s.you?.cooldown?.warCase ?? -1) - s.week;
  const box = h('input', { type: 'checkbox', checked: !made && wait <= 0, disabled: made || wait > 0 });
  const nap = s.treaties.some((t) => t.kind === 'nap' && [t.a, t.b].includes(s.me) && [t.a, t.b].includes(foe));
  const el = h('div.stack',
    h('div.warning.bad', h('span', h('b', `This declares war on ${nationName(s, foe)}. `),
      shared.length ? `You leave ${shared.map((al) => al.name).join(' and ')}. ` : '',
      defenders.size ? `Its allies may join in: ${[...defenders].map((d) => nationName(s, d)).join(', ')}.` : 'It has no allies bound to defend it.')),
    nap ? h('div.warning.bad', 'You have a non-aggression pact with them. Breaking it badly damages your standing.') : null,
    made
      ? h('div.warning.info', 'You have already made the case for this war to the nation: the public is behind you.')
      : h('label.row.gap', { style: { alignItems: 'flex-start', cursor: wait > 0 ? 'default' : 'pointer' } }, box,
        h('span', h('b', 'Address the nation first'), h('span.muted.small', { style: { display: 'block' } },
          wait > 0 ? `You addressed the nation recently; possible again in ${wait} weeks.`
            : 'Explain why this war is necessary. Far less public outcry, fewer anti-war protests, and a smaller hit to your standing.'))),
  );
  return {
    el,
    justify: async () => {
      if (!box.checked || box.disabled) return true;
      return !(await ctx.send({ type: 'warCase', target: foe }));
    },
  };
}

// Sends the order. Asks first only when the order means declaring war.
export async function sendArmy(ctx, army, target) {
  const s = ctx.state;
  const why = goBlocker(ctx, army, target);
  if (why) {
    if (!army.sea && accessDialog(ctx, army, target)) return false;
    ctx.hint(why, 'bad', 8000);
    return false;
  }
  const o = goOptions(ctx, army, target);
  const verb = o.friendly ? 'moving to' : o.ground ? 'attacking' : 'landing at';
  const go = async () => {
    const err = await ctx.send({ type: 'armyOrder', id: army.id, kind: 'go', target, declare: true });
    if (!err) ctx.hint(`${army.name}: ${verb} ${regionName(target)}.`, 'good', 3500);
    return !err;
  };
  if (!o.declare) return go();
  const notice = warNotice(ctx, o.foe, o.shared);
  modal({
    title: `War with ${nationName(s, o.foe)}?`,
    body: h('div.stack', h('p.small', `${army.name} (${troops(army.troops)} troops) will ${o.ground ? 'attack' : 'land at'} ${regionName(target)} as soon as war is declared.`), notice.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Declare war & send', kind: 'danger', onClick: async () => {
        if (!(await notice.justify())) return false;
        return (await go()) || false;
      },
    }],
  });
  return true;
}

// From a province's card: choose which army to send there
export function attackDialog(ctx, { army, target }) {
  const s = ctx.state;
  if (army) return sendArmy(ctx, army, target);
  const candidates = s.armies.filter((a) => a.owner === s.me && !a.sea && canGo(ctx, a, target));
  if (!candidates.length) {
    const mine = s.armies.filter((a) => a.owner === s.me && !a.sea);
    if (!mine.length) return ctx.hint('No army groups yet. Draft & form one (Military → Troops, or click one of your provinces), then send it.', 'bad');
    const best = mine.reduce((m, a) => (a.troops > m.troops ? a : m));
    return accessDialog(ctx, best, target) || ctx.hint(goBlocker(ctx, best, target) ?? `None of our army groups can reach ${regionName(target)}.`, 'bad');
  }
  if (candidates.length === 1) return sendArmy(ctx, candidates[0], target);
  return multiAttack(ctx, candidates, target);
}

// Several armies can go: tick the ones to send. Armies attacking the same province at the same time fight as
// one force, so the dialog adds up their troops against the defenders.
function multiAttack(ctx, candidates, target) {
  const s = ctx.state;
  const holder = holderOf(ctx, target);
  const garrison = row(ctx, target)?.[8] ?? 0;
  const defenders = garrison + s.armies.filter((a) => a.region === target && !a.sea && a.owner === holder).reduce((t, a) => t + a.troops, 0);
  const sorted = [...candidates].sort((a, b) => b.troops - a.troops);
  const picked = new Set([sorted[0].id]);
  const total = h('b');
  const odds = h('span.muted.small');
  const sendBtn = h('button.btn.primary', { type: 'button' });
  const refresh = () => {
    const sum = sorted.filter((a) => picked.has(a.id)).reduce((t, a) => t + a.troops, 0);
    total.textContent = troops(sum);
    odds.textContent = ` against about ${troops(defenders)} defenders in ${regionName(target)}${defenders ? ` (${(sum / Math.max(1, defenders)).toFixed(1)} to 1 in numbers; ground, forts, tanks and supply also count)` : ''}.`;
    sendBtn.textContent = picked.size > 1 ? `Send ${picked.size} armies` : 'Send 1 army';
    sendBtn.disabled = !picked.size;
  };
  const rows = sorted.map((a) => {
    const box = h('input', { type: 'checkbox', checked: picked.has(a.id), onchange: () => { if (box.checked) picked.add(a.id); else picked.delete(a.id); refresh(); } });
    return h('label.item.clickable', { style: { display: 'block' } },
      h('div.item-head', box, h('span.name', a.name), h('span.mono.small', { style: { marginLeft: 'auto' } }, troops(a.troops))),
      h('div.meta', `${regionName(a.region)} · ${a.tanks} tanks · organisation ${a.org}%`));
  });
  refresh();
  const o = goOptions(ctx, sorted[0], target);
  const notice = o.declare ? warNotice(ctx, o.foe, o.shared) : null;
  const dlg = modal({
    title: `Attack ${regionName(target)}`,
    body: h('div.stack',
      h('p.small', 'Armies that attack the same province together fight as one force.'),
      h('div.list', rows),
      h('p.small', 'Together: ', total, odds),
      notice ? h('p.muted.small', `Once war is declared, ${nationName(s, holder)} moves its home garrison to the threatened border, so expect more defenders than this.`) : null,
      notice?.el ?? null),
    actions: [{ label: 'Cancel', kind: 'ghost' }],
  });
  // Our own send button, so its label can follow the choice
  sendBtn.addEventListener('click', async () => {
    const ids = sorted.filter((a) => picked.has(a.id)).map((a) => a.id);
    if (!ids.length) return;
    sendBtn.disabled = true;
    if (notice && !(await notice.justify())) { sendBtn.disabled = false; return; }
    const err = await ctx.send({ type: 'armyOrder', ids, kind: 'go', target, declare: true });
    sendBtn.disabled = false;
    if (err) return;
    dlg.close();
    ctx.hint(`${ids.length > 1 ? `${ids.length} armies` : '1 army'} on the way to ${regionName(target)}.`, 'good', 3500);
  });
  document.querySelector('#modal .modal-foot')?.append(sendBtn);

}
