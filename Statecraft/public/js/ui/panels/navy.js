// The navy: fleets at exact points on the world's seas, ships waiting in port, and the orders a leader gives
// them. Every order is two choices: where (any point on the water, a strait, or an enemy's coast) and what to do
// there (hold, blockade the coast, or patrol the strait).

import { h, flag, nationName, regionName, num, bar } from '../dom.js';
import { modal, numberField, selectField, confirmBox } from '../dialogs.js';
import { NODES, PATROL_MODES, nodeName, isStrait, fleetSpeed, MAX_FLEETS, PORTS, seaAt, seaRoute, routeLength, mapDistance, nearestWater, isWater, KM_PER_PX, OFF_COAST } from '../../engine/navy.js';

export const myFleets = (s) => (s.fleets ?? []).filter((f) => f.owner === s.me);
const enemySet = (s) => new Set(s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a)));

// Warships and carriers built but not in any fleet
export function inPort(s) {
  const me = s.you;
  let ships = me.ships;
  let carriers = me.carriers;
  for (const f of myFleets(s)) { ships -= f.ships; carriers -= f.carriers; }
  return { ships: Math.max(0, Math.floor(ships + 0.01)), carriers: Math.max(0, Math.round(carriers)) };
}

// Our ports: the coastal provinces we hold, with the open water off each
export function ourPorts(ctx) {
  const s = ctx.state;
  return Object.entries(ctx.regionIndex).filter(([id, i]) => s.regions[i][1] === s.me && PORTS[id])
    .map(([id, i]) => ({ id, x: PORTS[id][0], y: PORTS[id][1], sea: seaAt(...PORTS[id]), gdp: s.regions[i][9] }))
    .sort((a, b) => b.gdp - a.gdp);
}

// Weeks to sail from where a fleet is now to a point
export function sailWeeks(s, f, to) {
  const route = seaRoute([f.x, f.y], to);
  if (!route) return null;
  return routeLength([f.x, f.y], route) * KM_PER_PX / fleetSpeed(s, f.owner);
}
const weeksText = (w) => (w == null ? 'no way there by sea' : w < 0.15 ? 'already there' : w < 1 ? `${Math.max(1, Math.round(w * 7))} days` : `${Math.round(w * 10) / 10} weeks`);

const where = (f) => (f.moving ? `At sea in the ${nodeName(f.at)}` : `In the ${nodeName(f.at)}`);
function missionText(s, f) {
  if (f.mission === 'blockade' && f.target) return `Blockading ${nationName(s, f.target)}`;
  if (f.mission === 'patrol') return `Patrolling: ${PATROL_MODES[f.mode]?.toLowerCase() ?? ''}`;
  return f.moving ? 'On the move' : 'Holding position';
}

/* ---------- Military → Navy ---------- */

export function navy(ctx) {
  const s = ctx.state;
  const me = s.you;
  const mine = myFleets(s);
  const port = inPort(s);
  const ports = ourPorts(ctx);
  const enemies = enemySet(s);
  const foes = (s.fleets ?? []).filter((f) => enemies.has(f.owner));
  const atSea = mine.reduce((t, f) => t + f.ships, 0);
  const refit = (me.refitUntil ?? -1) > s.week ? me.refitUntil - s.week : 0;
  if (!ports.length) return h('div.empty', `${nationName(s, s.me)} holds no coast, so it has no navy.`);
  return h('div',
    h('div.kpis', { style: { marginBottom: '10px' } },
      h('div.kpi', h('span', 'At sea'), h('b', num(atSea)), h('small', `${mine.length} fleet${mine.length === 1 ? '' : 's'}`)),
      h('div.kpi', h('span', 'In port'), h('b', num(port.ships)), h('small', `${port.carriers} carrier${port.carriers === 1 ? '' : 's'}${refit ? ` · refit ${refit} wk` : ''}`)),
      h('div.kpi', h('span', 'Speed'), h('b', `${num(Math.round(fleetSpeed(s, s.me) / 10) * 10)} km`), h('small', `a week (naval research ${s.countries[s.me].tech?.naval ?? '—'})`))),
    h('div.howto',
      h('div', h('b', '1. Select'), ' a fleet: click it on the map, or "Send…" below.'),
      h('div', h('b', '2. Click'), ' anywhere on the water, a strait (◆) or an enemy coast.'),
      h('div', h('b', '3. Choose'), ' what it does there: hold, blockade, or patrol.')),
    h('p.muted.small', { style: { marginTop: '6px' } }, 'Enemy fleets that come within about 450 km fight. To land an army overseas, a fleet of ours must be lying off that coast, at least as strong as the enemy\'s there.'),
    h('div.list', { style: { marginTop: '10px' } }, mine.length ? mine.map((f) => fleetCard(ctx, f)) : [h('div.empty', 'No fleets at sea.')]),
    h('div.actions', { style: { marginTop: '8px' } },
      h('button.btn.small.primary', { disabled: port.ships + port.carriers < 1 || mine.length >= MAX_FLEETS, onclick: () => formDialog(ctx) }, `Form a fleet (${num(port.ships)} ships${port.carriers ? `, ${port.carriers} carriers` : ''} in port)`),
      h('button.btn.small.ghost', { onclick: () => ctx.go('military', 'weapons') }, 'Build warships…')),
    foes.length ? h('div.section', h('h3', 'Enemy fleets'), h('div.list', foes.map((f) => fleetCard(ctx, f)))) : null);
}

/* ---------- A fleet's card (in the panel and on the map) ---------- */

export function fleetCard(ctx, f, compact = false) {
  const s = ctx.state;
  const mine = f.owner === s.me;
  const port = mine ? inPort(s) : null;
  const ports = mine ? ourPorts(ctx) : [];
  const docked = mine && !f.moving && ports.some((p) => mapDistance(f.x, f.y, p.x, p.y) <= 12);
  const others = mine ? myFleets(s).filter((x) => x.id !== f.id && !x.moving && !f.moving && mapDistance(x.x, x.y, f.x, f.y) <= 12) : [];
  return h('div.item', { class: compact ? '' : 'clickable', onclick: compact ? null : () => ctx.selectFleet(f.id, true) },
    h('div.item-head', mine ? h('span.swatch', { style: { background: 'var(--accent)' } }) : flag(f.owner), h('span.name', f.name),
      f.battle ? h('span.chip.bad', 'In battle') : null,
      h('span.mono.small', { style: { marginLeft: 'auto' } }, `${f.exact || f.seen ? '' : '~'}${num(f.ships)} ships${f.carriers ? ` · ${f.carriers} carriers` : ''}`)),
    !mine ? h('div.meta', nationName(s, f.owner)) : null,
    h('div.meta', `${where(f)} · ${missionText(s, f)}`),
    mine && f.moving && f.dest ? h('div.meta', `Arrives in ${weeksText(sailWeeks(s, f, f.dest))}`) : null,
    mine ? h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span.muted', 'Readiness'), h('div.grow', bar(f.org, 100, f.org < 30 ? 'bad' : f.org < 60 ? 'warn' : 'good')), h('span.mono', `${f.org}%`)) : null,
    mine && f.status ? h('div.meta', { style: { color: 'var(--ink)' } }, f.status) : null,
    mine ? h('div.actions', { onclick: (e) => e.stopPropagation() },
      h('button.btn.small.primary', { onclick: () => ctx.selectFleet(f.id, true) }, 'Send…'),
      h('button.btn.small', { onclick: () => destinationDialog(ctx, f) }, 'To a sea or strait…'),
      docked && port.ships + port.carriers > 0 ? h('button.btn.small.ghost', { onclick: () => reinforceDialog(ctx, f) }, 'Add ships') : null,
      others.length ? h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'fleetMerge', ids: [f.id, ...others.map((o) => o.id)] }) }, 'Merge here') : null,
      h('button.btn.small.ghost', { onclick: () => rename(ctx, f) }, 'Rename'),
      h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Bring ${f.name} home?`, 'Its ships return to port, ready to form a new fleet.')) ctx.send({ type: 'fleetDisband', id: f.id }); } }, 'To port')) : null);
}

/* ---------- Orders ---------- */

// Enemy countries whose coast lies close to a point
function coastsNear(ctx, x, y) {
  const s = ctx.state;
  const enemies = enemySet(s);
  const out = new Set();
  for (const [id, i] of Object.entries(ctx.regionIndex)) {
    const ctrl = s.regions[i][1];
    if (!enemies.has(ctrl) || !PORTS[id]) continue;
    if (mapDistance(x, y, PORTS[id][0], PORTS[id][1]) <= OFF_COAST * 1.5) out.add(ctrl);
  }
  return [...out];
}

// What a fleet can do at a point: hold; patrol if it is a strait; blockade an enemy whose coast is there
function missionsAt(ctx, x, y, node) {
  const s = ctx.state;
  const sea = node ?? seaAt(x, y);
  const place = isStrait(sea) || node ? `the ${nodeName(sea)}` : 'here';
  const out = [{ mission: 'hold', label: `Hold ${place}`, note: 'Guard these waters: it fights any enemy fleet that comes near, protects our coast and convoys, and covers landings on the coast close by.' }];
  if (isStrait(sea)) {
    for (const [mode, label] of Object.entries(PATROL_MODES)) {
      out.push({ mission: 'patrol', mode, label: `Patrol: ${label.toLowerCase()}`, note: mode === 'escort' ? 'Friendly cargoes through the strait become much harder to stop.' : mode === 'enemies' ? 'Seize cargoes bound to or from our enemies, and those we sanction.' : 'Stop every ship except our allies\'. Prices spike worldwide and the world turns against us.' });
    }
  }
  for (const e of coastsNear(ctx, x, y)) out.push({ mission: 'blockade', target: e, label: `Blockade ${nationName(s, e)}`, note: `Lie off ${nationName(s, e)}'s coast and cut its trade by sea. Its fleets and coastal missiles fight back.` });
  return out;
}

// Where to, and to do what: from a click on the water, a strait, a coast or another fleet
export function orderDialog(ctx, f, { x, y, node, prefer } = {}) {
  const s = ctx.state;
  if (node) [x, y] = [NODES[node].x, NODES[node].y];
  if (!isWater(x, y)) {
    const w = nearestWater(x, y);
    if (!w || mapDistance(w[0], w[1], x, y) > 15) return ctx.hint('That is not open water. Click the sea, a strait or a coast.', 'bad', 5000);
    [x, y] = w;
  }
  const options = missionsAt(ctx, x, y, node);
  let pick = options.find((o) => o.mission === 'blockade' && o.target === prefer) ?? options[0];
  const weeks = sailWeeks(s, f, [x, y]);
  const list = h('div.pick-list', options.map((o) => {
    const card = h('button.pick-card', { type: 'button', 'aria-pressed': String(o === pick) },
      h('span.pick-icon', { 'aria-hidden': 'true' }, o.mission === 'blockade' ? '⛔' : o.mission === 'patrol' ? '🛡' : '⚓'),
      h('span.pick-text', h('b', o.label), h('span', o.note)));
    card.addEventListener('click', () => { pick = o; for (const c of list.children) c.setAttribute('aria-pressed', String(c === card)); });
    return card;
  }));
  modal({
    title: `${f.name}: to the ${nodeName(node ?? seaAt(x, y))}`,
    body: h('div.stack', h('p.muted.small', `Sailing time: ${weeksText(weeks)}.`), list),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Sail', kind: 'primary',
      onClick: async () => {
        const err = await ctx.send({ type: 'fleetOrder', id: f.id, x, y, to: pick.mission === 'patrol' ? (node ?? seaAt(x, y)) : null, mission: pick.mission, mode: pick.mode ?? null, target: pick.target ?? null });
        if (!err) ctx.hint(`${f.name} is under way.`, 'good', 3000);
        return !err || false;
      },
    }],
  });
}

// From the card: pick a sea or strait from a list
export function destinationDialog(ctx, f) {
  const s = ctx.state;
  const nodes = Object.keys(NODES).map((k) => [k, sailWeeks(s, f, [NODES[k].x, NODES[k].y])]).filter(([, w]) => w != null).sort((a, b) => a[1] - b[1]);
  const sel = selectField('Sail to', nodes.map(([k, w]) => [k, `${nodeName(k)} (${weeksText(w)})`]), nodes[0]?.[0]);
  modal({
    title: `Orders for ${f.name}`,
    body: h('div.stack', sel.el, h('p.muted.small', 'Or close this, and click any point on the water on the map.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Next', kind: 'primary', onClick: () => { setTimeout(() => orderDialog(ctx, f, { node: sel.input.value })); return true; } }],
  });
}

// A coastal province on the map: the water off it
export function waterOff(regionId) {
  return PORTS[regionId] ? { x: PORTS[regionId][0], y: PORTS[regionId][1] } : null;
}

// Send a fleet to blockade an enemy, choosing the fleet (Military → Air & sea)
export function blockadeDialog(ctx, enemies) {
  const s = ctx.state;
  const mine = myFleets(s);
  const targets = enemies.filter((e) => Object.entries(ctx.regionIndex).some(([id, i]) => s.regions[i][1] === e && PORTS[id]));
  if (!mine.length) return ctx.hint('No fleets at sea. Form one in Military → Navy.', 'bad');
  if (!targets.length) return ctx.hint('None of our enemies has a coast to blockade.', 'bad');
  const fleetSel = selectField('Fleet', mine.map((f) => [f.id, `${f.name} (${num(f.ships)} ships${f.carriers ? `, ${f.carriers} carriers` : ''})`]));
  const enemySel = selectField('Enemy', targets.map((e) => [e, nationName(s, e)]));
  modal({
    title: 'Naval blockade',
    body: h('div.stack', fleetSel.el, enemySel.el, h('p.muted.small', 'The fleet sails to the nearest stretch of the enemy\'s coast and cuts its trade by sea. Its fleets and coastal missiles fight back.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Blockade', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fleetOrder', id: fleetSel.input.value, mission: 'blockade', target: enemySel.input.value })) || false }],
  });
}

// Send a fleet to patrol a strait (Market → Straits)
export function patrolDialog(ctx, key) {
  const s = ctx.state;
  const mine = myFleets(s);
  if (!mine.length) return ctx.hint('No fleets at sea. Form one in Military → Navy.', 'bad');
  const to = [NODES[key].x, NODES[key].y];
  const sorted = mine.map((f) => [f, sailWeeks(s, f, to)]).filter(([, w]) => w != null).sort((a, b) => a[1] - b[1]);
  if (!sorted.length) return ctx.hint(`None of our fleets can reach the ${nodeName(key)}.`, 'bad');
  const fleetSel = selectField('Fleet', sorted.map(([f, w]) => [f.id, `${f.name} (${num(f.ships)} ships, ${weeksText(w)} away)`]));
  let mode = 'escort';
  const segEl = h('div.seg', Object.entries(PATROL_MODES).map(([k, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(k === mode), onclick: () => { mode = k; for (const x of segEl.children) x.setAttribute('aria-pressed', String(x === b)); } }, label);
    return b;
  }));
  modal({
    title: `Patrol the ${nodeName(key)}`,
    body: h('div.stack', fleetSel.el, h('div.field', h('span', 'Orders'), segEl),
      h('p.muted.small', 'Escorts make friendly cargoes far harder to stop. Stopping enemies\' cargoes hurts their supply; stopping all traffic chokes the world\'s trade and makes enemies everywhere. A hostile shore fires missiles at the fleet, and enemy fleets will come to fight it.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Send the fleet', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fleetOrder', id: fleetSel.input.value, to: key, mission: 'patrol', mode })) || false }],
  });
}

// Put ships to sea from one of our ports (from the Navy tab, or a coastal province's card)
export function formDialog(ctx, region) {
  const s = ctx.state;
  const port = inPort(s);
  const ports = ourPorts(ctx);
  if (!ports.length) return ctx.hint('We hold no coast.', 'bad');
  if (port.ships + port.carriers < 1) return ctx.hint('All our warships are at sea. Build more in Military → Weapons.', 'bad', 5000);
  const from = selectField('Put to sea from', ports.map((p) => [p.id, `${regionName(p.id)} (${nodeName(p.sea)})`]), region ?? ports[0].id);
  const ships = numberField('Warships', { value: port.ships, min: 0, max: port.ships, step: 1 });
  const carriers = numberField('Aircraft carriers', { value: port.carriers, min: 0, max: port.carriers, step: 1 });
  const name = h('input', { placeholder: 'Name (optional)', maxlength: 28 });
  const refit = (s.you.refitUntil ?? -1) > s.week;
  modal({
    title: 'Form a fleet',
    body: h('div.stack', from.el, ships.el, port.carriers ? carriers.el : null, h('label.field', h('span', 'Name'), name),
      refit ? h('div.warning.warn', `Ships back from a lost battle are still refitting for ${s.you.refitUntil - s.week} more weeks: a fleet formed now starts badly disorganised.`) : null,
      h('p.muted.small', 'The fleet puts to sea off that province. Then click it, and click anywhere on the water to send it. A carrier counts as eight warships in battle.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Put to sea', kind: 'primary',
      onClick: async () => !(await ctx.send({ type: 'fleetForm', region: from.input.value, ships: Number(ships.input.value), carriers: Number(carriers.input.value) || 0, name: name.value.trim() || undefined })) || false,
    }],
  });
}

function reinforceDialog(ctx, f) {
  const s = ctx.state;
  const port = inPort(s);
  const ships = numberField(`Warships (−${f.ships} to +${port.ships})`, { value: port.ships, min: -f.ships, max: port.ships, step: 1 });
  const carriers = numberField(`Carriers (−${f.carriers} to +${port.carriers})`, { value: port.carriers, min: -f.carriers, max: port.carriers, step: 1 });
  modal({
    title: `Ships for ${f.name}`,
    body: h('div.stack', ships.el, carriers.el, h('p.muted.small', 'Ships join or leave a fleet in port. A negative number sends ships back to port.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Done', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fleetReinforce', id: f.id, ships: Number(ships.input.value) || 0, carriers: Number(carriers.input.value) || 0 })) || false }],
  });
}

function rename(ctx, f) {
  const input = h('input', { value: f.name, maxlength: 28 });
  modal({
    title: 'Rename fleet',
    body: h('label.field', h('span', 'Name'), input),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Rename', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fleetRename', id: f.id, name: input.value })) || false }],
  });
}
