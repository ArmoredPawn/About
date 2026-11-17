// Sending armies: select an army, click anywhere on the map, and it goes there. Friendly ground it marches
// through; enemy ground it fights through; across water it lands. If the province belongs to a country we're
// not at war with, one short dialog declares war first (with the option of making the case to the nation).

import { h, regionName, nationName, troops } from './dom.js';
import { modal } from './dialogs.js';
import { GEO } from '../engine/data/geo.js';
import { route, hypotheticalWar, landingProblem, blockers, noRouteReason, distanceKm, terrainOf, previewPath, checkOrder } from '../engine/military.js';
import { nearestLand, regionAt, holderAt, cellX, cellY } from '../engine/land.js';
import { barrels } from './panels/military.js';
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
    const err = await ctx.send({ type: 'propose', to: x, kind: 'access', terms: { army: army.id, target } });
    if (!err) ctx.toast(`Asked ${nationName(s, x)} to let our troops pass. ${s.countries[x].human ? 'Its leader will answer.' : 'They will answer within a week.'} If they agree, ${army.name} sets off at once.`, 'info');
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
      h('p.muted.small', 'Every country between us and the objective must agree to let our troops pass (allies always do). If one agrees, the army sets off on its own. If it refuses, the only way through is to defeat it in a war; a peace treaty can then force it to grant access.')),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
  return true;
}

// Where our case for a war on `foe` stands: { state: 'none' | 'pending' | 'ready', secs (until ready), until }.
// The case is prepared in secret and takes about 45 seconds at normal speed.
export function warCaseStatus(ctx, foe) {
  const s = ctx.state;
  const raw = s.you?.warCases?.[foe];
  if (raw == null) return { state: 'none' };
  const w = typeof raw === 'number' ? { ready: 0, until: raw } : raw;
  if (w.until < s.week) return { state: 'none' };
  const now = s.week + Math.min(0.999, ctx.tickAge?.() ?? 0);
  if (w.ready <= now + 1e-6) return { state: 'ready', until: w.until };
  return { state: 'pending', secs: Math.max(1, Math.ceil(((w.ready - now) * (ctx.tickMs?.() ?? 9000)) / 1000)), until: w.until };
}
export const caseMade = (ctx, foe) => warCaseStatus(ctx, foe).state === 'ready';

// No case yet: offer to start preparing one. Returns true if it was started.
export async function justifyDialog(ctx, foe, then = '') {
  const s = ctx.state;
  const st = warCaseStatus(ctx, foe);
  if (st.state === 'pending') {
    ctx.hint(`The case for war against ${nationName(s, foe)} is still being prepared: ready in about ${st.secs} seconds.`, 'warn', 6000);
    return false;
  }
  return new Promise((resolve) => {
    modal({
      title: `Justify a war on ${nationName(s, foe)}?`,
      body: h('div.stack',
        h('p', `No country can be attacked without a case for war. Our staff will build one (the grievances, the legal grounds, the story for the public) in about 45 seconds. ${then}`),
        h('p.muted.small', 'It is prepared in secret: no one is told. Only a country with a deep, well-established spy network inside our government will find out before we declare war; everyone else learns of it when war comes. Once ready, the case stands for six months.')),
      actions: [
        { label: 'Not now', kind: 'ghost', onClick: () => resolve(false) },
        { label: 'Start preparing the case', kind: 'danger', onClick: async () => {
          const err = await ctx.send({ type: 'warCase', target: foe });
          if (!err) ctx.toast(`The case for war against ${nationName(s, foe)} is being prepared in secret: ready in about 45 seconds.`, 'info');
          resolve(!err);
          return !err || false;
        } },
      ],
      onClose: () => resolve(false),
    });
  });
}

// The warnings shown before declaring war. Returns { el, justify() } (justify() is kept for older callers).
export function warNotice(ctx, foe, shared = []) {
  const s = ctx.state;
  const defenders = new Set();
  for (const al of s.alliances) if (al.kind === 'military' && al.members.includes(foe)) for (const m of al.members) if (m !== foe && m !== s.me) defenders.add(m);
  const g = s.minors[foe]?.guarantor;
  if (g && g !== s.me) defenders.add(g);
  const nap = s.treaties.some((t) => t.kind === 'nap' && [t.a, t.b].includes(s.me) && [t.a, t.b].includes(foe));
  const el = h('div.stack',
    h('div.warning.bad', h('span', h('b', `This declares war on ${nationName(s, foe)}. `),
      shared.length ? `You leave ${shared.map((al) => al.name).join(' and ')}. ` : '',
      defenders.size ? `Its allies may join in: ${[...defenders].map((d) => nationName(s, d)).join(', ')}.` : 'It has no allies bound to defend it.')),
    nap ? h('div.warning.bad', 'You have a non-aggression pact with them. Breaking it badly damages your standing.') : null,
    h('div.warning.info', 'Our case for this war is ready: the public is behind us.'),
  );
  return { el, justify: async () => true };
}

// How long a march takes and the oil it burns (plus two weeks of fighting if it ends in an attack)
export function marchEstimate(ctx, army, path, attack) {
  if (!army.speed || !army.fuel || !path?.length) return null;
  let km = 0;
  let from = army.region;
  for (const id of path) {
    const infra = ctx.state.regions[ctx.regionIndex[id]]?.[3] ?? 0;
    km += distanceKm(from, id) * terrainOf(id).move * (1 - 0.04 * infra);
    from = id;
  }
  const weeks = km / Math.max(50, army.speed);
  return { weeks, oil: weeks * army.fuel.march + (attack ? 2 * army.fuel.fight : 0) };
}
const estimateText = (e) => (e ? ` About ${e.weeks < 1 ? 'a week' : `${Math.round(e.weeks * 10) / 10} weeks`} and ${barrels(e.oil)} of oil.` : '');

// Sends the order. Asks first only when the order means declaring war (and that needs a case for it).
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
  const est = o.ground ? marchEstimate(ctx, army, o.path, !o.friendly) : null;
  const go = async () => {
    const err = await ctx.send({ type: 'armyOrder', id: army.id, kind: 'go', target, declare: true });
    if (!err) ctx.hint(`${army.name}: ${verb} ${regionName(target)}.${estimateText(est)}`, 'good', 5000);
    return !err;
  };
  if (!o.declare) return go();
  if (!caseMade(ctx, o.foe)) {
    await justifyDialog(ctx, o.foe, `When it is ready, send ${army.name} again.`);
    return false;
  }
  const notice = warNotice(ctx, o.foe, o.shared);
  modal({
    title: `War with ${nationName(s, o.foe)}?`,
    body: h('div.stack', h('p.small', `${army.name} (${troops(army.troops)} troops) will ${o.ground ? 'attack' : 'land at'} ${regionName(target)} as soon as war is declared.${estimateText(est)}`), notice.el),
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
  // A war still needs its case first
  const o = goOptions(ctx, candidates[0], target);
  if (o.declare && !caseMade(ctx, o.foe)) return justifyDialog(ctx, o.foe, 'When it is ready, send the armies again.');
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

/* ---------- Orders to a point on the map, or at an enemy army ---------- */
//
// An army goes to the exact point clicked. Our side's ground: it marches there and holds. Enemy ground: it
// advances, taking the ground it crosses and attacking any army in its way. An enemy army: it goes after it.

// What sending this army to this point (or after this army) means:
// { x, y, region, holder, friendly, declare, path, why, attack }
export function pointOptions(ctx, army, target) {
  const s = ctx.state;
  const faux = fauxState(s);
  let x;
  let y;
  let holder;
  let region;
  if (target.enemy) {
    const e = s.armies.find((a) => a.id === target.enemy);
    if (!e || e.x == null) return { why: 'That army is out of reach.' };
    [x, y] = [e.x, e.y];
    holder = e.owner;
    region = e.region;
  } else {
    const cell = nearestLand(target.x, target.y);
    if (cell < 0) return { why: 'Pick a point on land.' };
    [x, y] = [cellX(cell), cellY(cell)];
    holder = holderAt(faux, cell);
    region = regionAt(cell);
  }
  if (army.sea) return { x, y, region, holder, why: `${army.name} is at sea and can't take new orders until it lands.` };
  const friendly = holder === s.me || friendlyGround(faux, s.me, holder);
  const declare = !friendly && !atWar(faux, s.me, holder);
  const order = target.enemy ? { kind: 'attack', enemy: target.enemy } : { kind: 'go', x, y };
  const me = { id: s.me, ships: s.you.ships, carriers: s.you.carriers, tech: s.you.tech };
  const world = declare ? hypotheticalWar(faux, s.me, holder) : faux;
  let why = null;
  if (s.minors[holder]?.capitulated) why = `${nationName(s, holder)} has already surrendered. Decide its fate in Diplomacy.`;
  else if (s.countries[holder]?.exile) why = `${nationName(s, holder)}'s government has fallen.`;
  else why = checkOrder(faux, me, { ...army, owner: s.me }, order);
  const path = why ? null : previewPath(world, s.me, [army.x, army.y], target.enemy ? { enemy: target.enemy } : { x, y });
  return { x, y, region, holder, friendly, declare, path, why, attack: !friendly };
}

// For the preview while choosing: the route and what it means
export function pointPreview(ctx, army, x, y) {
  const s = ctx.state;
  if (army.x == null) return null;
  const o = pointOptions(ctx, army, { x, y });
  if (!o.region) return null;
  const label = o.why ? null : o.friendly ? `Move to ${regionName(o.region)}` : `${o.declare ? 'War: ' : ''}Advance on ${regionName(o.region)} (${nationName(s, o.holder)})`;
  return { from: [army.x, army.y], path: o.path, to: [o.x, o.y], attack: o.attack, why: o.why, label };
}

// How long a march along waypoints takes, and the oil it burns
function pointEstimate(army, path, attack) {
  if (!army.speed || !army.fuel || !path?.length) return null;
  let km = 0;
  let [px, py] = [army.x, army.y];
  for (const [x, y] of path) {
    km += Math.hypot(x - px, y - py) * 20 * terrainOf(regionAt(nearestLand(x, y)) ?? army.region).move;
    [px, py] = [x, y];
  }
  const weeks = km / Math.max(50, army.speed);
  return { weeks, oil: weeks * army.fuel.march + (attack ? 2 * army.fuel.fight : 0) };
}

// Sends an army to a point, or after an enemy army. Asks first only when it means declaring war.
export async function sendArmyTo(ctx, army, target) {
  const s = ctx.state;
  const o = pointOptions(ctx, army, target);
  if (o.why) {
    if (!army.sea && o.region && /military access/.test(o.why) && accessDialog(ctx, army, o.region)) return false;
    ctx.hint(o.why, 'bad', 8000);
    return false;
  }
  const enemy = target.enemy ? s.armies.find((a) => a.id === target.enemy) : null;
  const what = enemy ? `going after ${nationName(s, enemy.owner)}'s ${enemy.name}` : o.friendly ? `moving to ${regionName(o.region)}` : `advancing on ${regionName(o.region)}`;
  const est = pointEstimate(army, o.path, o.attack);
  const cmd = enemy ? { type: 'armyOrder', id: army.id, kind: 'attack', enemy: enemy.id, declare: true } : { type: 'armyOrder', id: army.id, kind: 'go', x: o.x, y: o.y, declare: true };
  const go = async () => {
    const err = await ctx.send(cmd);
    if (!err) ctx.hint(`${army.name}: ${what}.${estimateText(est)}`, 'good', 5000);
    return !err;
  };
  if (!o.declare) return go();
  if (!caseMade(ctx, o.holder)) {
    await justifyDialog(ctx, o.holder, `When it is ready, send ${army.name} again.`);
    return false;
  }
  const shared = s.alliances.filter((al) => al.members.includes(s.me) && al.members.includes(o.holder));
  const notice = warNotice(ctx, o.holder, shared);
  modal({
    title: `War with ${nationName(s, o.holder)}?`,
    body: h('div.stack', h('p.small', `${army.name} (${troops(army.troops)} troops) will ${enemy ? `attack ${enemy.name}` : `advance on ${regionName(o.region)}`} as soon as war is declared.${estimateText(est)}`), notice.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Declare war & send', kind: 'danger', onClick: async () => (await go()) || false,
    }],
  });
  return true;
}
