// The navy: fleets on the world's seas, ships waiting in port, and the orders a leader gives them. Every order
// is the same two choices: where to sail (a sea or a strait), and what to do there (hold the sea, blockade an
// enemy's coast, or patrol the strait).

import { h, flag, nationName, num, bar } from '../dom.js';
import { modal, numberField, selectField, confirmBox } from '../dialogs.js';
import { NODES, PATROL_MODES, seaPath, nodeName, isStrait, fleetSpeed, MAX_FLEETS } from '../../engine/navy.js';
import { basinsOf } from '../../engine/trade.js';

export const myFleets = (s) => (s.fleets ?? []).filter((f) => f.owner === s.me);
const seasOf = (s, id) => basinsOf(s, id).filter((k) => NODES[k]);
const enemySet = (s) => new Set(s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a)));

// Warships and carriers built but not in any fleet
export function inPort(s) {
  const me = s.you;
  let ships = me.ships;
  let carriers = me.carriers;
  for (const f of myFleets(s)) { ships -= f.ships; carriers -= f.carriers; }
  return { ships: Math.max(0, Math.floor(ships + 0.01)), carriers: Math.max(0, Math.round(carriers)) };
}

// Weeks to sail from where a fleet is now to a node
export function sailWeeks(s, f, to) {
  const from = f.next && f.prog > 0 ? f.next : f.at;
  const r = seaPath(from, to);
  if (!r) return null;
  const extra = f.next && f.prog > 0 ? Math.max(0, f.len - f.prog) : 0;
  return (r.len + extra) / fleetSpeed(s, f.owner);
}
const weeksText = (w) => (w == null ? 'unreachable' : w < 0.15 ? 'already there' : w < 1 ? `${Math.max(1, Math.round(w * 7))} days` : `${Math.round(w * 10) / 10} weeks`);

function where(s, f) {
  if (f.next && f.prog > 0) return `At sea between the ${nodeName(f.at)} and the ${nodeName(f.next)}`;
  return `In the ${nodeName(f.at)}`;
}

function missionText(s, f) {
  if (f.mission === 'blockade' && f.target) return `Blockading ${nationName(s, f.target)}`;
  if (f.mission === 'patrol') return `Patrolling: ${PATROL_MODES[f.mode]?.toLowerCase() ?? ''}`;
  return 'Holding the sea';
}

/* ---------- Military → Navy ---------- */

export function navy(ctx) {
  const s = ctx.state;
  const me = s.you;
  const mine = myFleets(s);
  const port = inPort(s);
  const home = seasOf(s, s.me);
  const enemies = enemySet(s);
  const foes = (s.fleets ?? []).filter((f) => enemies.has(f.owner));
  const atSea = mine.reduce((t, f) => t + f.ships, 0);
  const kmWeek = Math.round(fleetSpeed(s, s.me) * 1500 / 10) * 10;
  const refit = (me.refitUntil ?? -1) > s.week ? me.refitUntil - s.week : 0;
  if (!home.length) return h('div.empty', `${nationName(s, s.me)} has no coast, so no navy.`);
  return h('div',
    h('div.kpis', { style: { marginBottom: '10px' } },
      h('div.kpi', h('span', 'At sea'), h('b', num(atSea)), h('small', `${mine.length} fleet${mine.length === 1 ? '' : 's'}`)),
      h('div.kpi', h('span', 'In port'), h('b', num(port.ships)), h('small', `${port.carriers} carrier${port.carriers === 1 ? '' : 's'}${refit ? ` · refit ${refit} wk` : ''}`)),
      h('div.kpi', h('span', 'Speed'), h('b', `${num(kmWeek)} km`), h('small', `a week (naval research ${s.countries[s.me].tech?.naval ?? '—'})`))),
    h('p.muted.small', 'Fleets sail between the seas and through the straits. Click a fleet on the map, then click a sea, a strait or a coast to send it. A fleet can hold a sea, blockade an enemy\'s coast, or patrol a strait. To land an army overseas you need a fleet in the sea off that coast, at least as strong as the enemy\'s there.'),
    h('div.list', { style: { marginTop: '10px' } }, mine.length ? mine.map((f) => fleetCard(ctx, f)) : [h('div.empty', 'No fleets at sea.')]),
    h('div.actions', { style: { marginTop: '8px' } },
      h('button.btn.small.primary', { disabled: port.ships + port.carriers < 1 || mine.length >= MAX_FLEETS, onclick: () => formDialog(ctx) }, `Form a fleet (${num(port.ships)} ships${port.carriers ? `, ${port.carriers} carriers` : ''} in port)`),
      h('button.btn.small.ghost', { onclick: () => ctx.go('military', 'weapons') }, 'Build warships…')),
    foes.length ? h('div.section', h('h3', 'Enemy fleets'),
      h('div.list', foes.map((f) => fleetCard(ctx, f)))) : null);
}

/* ---------- A fleet's card (in the panel and on the map) ---------- */

export function fleetCard(ctx, f, compact = false) {
  const s = ctx.state;
  const mine = f.owner === s.me;
  const others = mine ? myFleets(s).filter((x) => x.id !== f.id && x.at === f.at && !(x.prog > 0) && !(f.prog > 0)) : [];
  const home = seasOf(s, s.me);
  const port = mine ? inPort(s) : null;
  const inHome = mine && !(f.prog > 0) && !f.path?.length && home.includes(f.at);
  return h('div.item', { class: compact ? '' : 'clickable', onclick: compact ? null : () => ctx.selectFleet(f.id, true) },
    h('div.item-head', mine ? h('span.swatch', { style: { background: 'var(--accent)' } }) : flag(f.owner), h('span.name', f.name),
      f.battle ? h('span.chip.bad', 'In battle') : null,
      h('span.mono.small', { style: { marginLeft: 'auto' } }, `${f.exact || f.seen ? '' : '~'}${num(f.ships)} ships${f.carriers ? ` · ${f.carriers} carriers` : ''}`)),
    !mine ? h('div.meta', nationName(s, f.owner)) : null,
    h('div.meta', `${where(s, f)} · ${missionText(s, f)}`),
    mine && f.path?.length ? h('div.meta', `Bound for the ${nodeName(f.dest)}: ${weeksText(sailWeeks(s, f, f.dest))}`) : null,
    mine ? h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span.muted', 'Readiness'), h('div.grow', bar(f.org, 100, f.org < 30 ? 'bad' : f.org < 60 ? 'warn' : 'good')), h('span.mono', `${f.org}%`)) : null,
    mine && f.status ? h('div.meta', { style: { color: 'var(--ink)' } }, f.status) : null,
    mine ? h('div.actions', { onclick: (e) => e.stopPropagation() },
      h('button.btn.small.primary', { onclick: () => ctx.selectFleet(f.id, true) }, 'Send…'),
      h('button.btn.small', { onclick: () => destinationDialog(ctx, f) }, 'Orders…'),
      inHome && port.ships + port.carriers > 0 ? h('button.btn.small.ghost', { onclick: () => reinforceDialog(ctx, f) }, 'Add ships') : null,
      others.length ? h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'fleetMerge', ids: [f.id, ...others.map((o) => o.id)] }) }, 'Merge here') : null,
      h('button.btn.small.ghost', { onclick: () => rename(ctx, f) }, 'Rename'),
      h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Bring ${f.name} home?`, 'Its ships return to port, ready to form a new fleet.')) ctx.send({ type: 'fleetDisband', id: f.id }); } }, 'To port')) : null);
}

/* ---------- Orders ---------- */

// What a fleet can do at a node: hold it; blockade an enemy with a coast on it; patrol it if it is a strait
function missionsAt(s, node) {
  const enemies = [...enemySet(s)].filter((e) => seasOf(s, e).includes(node));
  const out = [{ mission: 'hold', label: isStrait(node) ? 'Hold the strait' : `Hold the ${nodeName(node)}`, note: 'Guard these waters: our fleets here protect our coasts and convoys, fight any enemy fleet that comes, and make landings possible.' }];
  if (isStrait(node)) {
    for (const [mode, label] of Object.entries(PATROL_MODES)) {
      out.push({ mission: 'patrol', mode, label: `Patrol: ${label.toLowerCase()}`, note: mode === 'escort' ? 'Friendly cargoes through the strait become much harder to stop.' : mode === 'enemies' ? 'Seize cargoes bound to or from our enemies, and those we sanction.' : 'Stop every ship except our allies\'. Prices spike worldwide and the world turns against us.' });
    }
  }
  for (const e of enemies) out.push({ mission: 'blockade', target: e, label: `Blockade ${nationName(s, e)}`, note: `Cut ${nationName(s, e)}'s trade by sea. Its fleets and coastal missiles will fight back.` });
  return out;
}

// After clicking somewhere on the map: sail there and do what?
export function orderDialog(ctx, f, node, { prefer } = {}) {
  const s = ctx.state;
  const options = missionsAt(s, node);
  let pick = options.find((o) => o.mission === 'blockade' && o.target === prefer) ?? options[0];
  const weeks = sailWeeks(s, f, node);
  const list = h('div.list', options.map((o) => {
    const el = h('label.item.clickable', { style: { display: 'block' } },
      h('div.item-head', h('input', { type: 'radio', name: 'mission', checked: o === pick, onchange: () => { pick = o; } }), h('span.name', o.label)),
      h('div.meta', o.note));
    return el;
  }));
  modal({
    title: `${f.name} to the ${nodeName(node)}`,
    body: h('div.stack', h('p.muted.small', `Sailing time: ${weeksText(weeks)}.`), list),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Sail', kind: 'primary',
      onClick: async () => {
        const err = await ctx.send({ type: 'fleetOrder', id: f.id, to: node, mission: pick.mission, mode: pick.mode ?? null, target: pick.target ?? null });
        if (!err) ctx.hint(`${f.name}: sailing to the ${nodeName(node)}.`, 'good', 3500);
        return !err || false;
      },
    }],
  });
}

// From the card: pick the sea or strait from a list
export function destinationDialog(ctx, f) {
  const s = ctx.state;
  const nodes = Object.keys(NODES).sort((a, b) => (sailWeeks(s, f, a) ?? 99) - (sailWeeks(s, f, b) ?? 99));
  const sel = selectField('Sail to', nodes.map((k) => [k, `${nodeName(k)} (${weeksText(sailWeeks(s, f, k))})`]), f.dest ?? f.at);
  modal({
    title: `Orders for ${f.name}`,
    body: h('div.stack', sel.el, h('p.muted.small', 'Next you choose what the fleet does there.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Next', kind: 'primary', onClick: () => { setTimeout(() => orderDialog(ctx, f, sel.input.value)); return true; } }],
  });
}

// Which sea to sail to for a coastal province: the nearest one off its coast
export function seaForRegion(s, f, regionId) {
  const seas = seasOf(s, regionId);
  return seas.sort((a, b) => (sailWeeks(s, f, a) ?? 99) - (sailWeeks(s, f, b) ?? 99))[0] ?? null;
}

// Send a fleet to blockade an enemy, choosing the fleet (Military → Air & sea)
export function blockadeDialog(ctx, enemies) {
  const s = ctx.state;
  const mine = myFleets(s);
  const targets = enemies.filter((e) => seasOf(s, e).length);
  if (!mine.length) return ctx.hint('No fleets at sea. Form one in Military → Navy.', 'bad');
  if (!targets.length) return ctx.hint('None of our enemies has a coast to blockade.', 'bad');
  const fleetSel = selectField('Fleet', mine.map((f) => [f.id, `${f.name} (${num(f.ships)} ships${f.carriers ? `, ${f.carriers} carriers` : ''})`]));
  const enemySel = selectField('Enemy', targets.map((e) => [e, nationName(s, e)]));
  modal({
    title: 'Naval blockade',
    body: h('div.stack', fleetSel.el, enemySel.el, h('p.muted.small', 'The fleet sails to the nearest of the enemy\'s seas and cuts its trade by sea. Its fleets and coastal missiles fight back.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Blockade', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fleetOrder', id: fleetSel.input.value, mission: 'blockade', target: enemySel.input.value })) || false }],
  });
}

// Send a fleet to patrol a strait (Market → Straits)
export function patrolDialog(ctx, key) {
  const s = ctx.state;
  const mine = myFleets(s);
  if (!mine.length) return ctx.hint('No fleets at sea. Form one in Military → Navy.', 'bad');
  const sorted = [...mine].sort((a, b) => (sailWeeks(s, a, key) ?? 99) - (sailWeeks(s, b, key) ?? 99));
  const fleetSel = selectField('Fleet', sorted.map((f) => [f.id, `${f.name} (${num(f.ships)} ships, ${weeksText(sailWeeks(s, f, key))} away)`]));
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

function formDialog(ctx) {
  const s = ctx.state;
  const port = inPort(s);
  const home = seasOf(s, s.me);
  const sea = selectField('Put to sea in', home.map((k) => [k, `the ${nodeName(k)}`]));
  const ships = numberField('Warships', { value: port.ships, min: 0, max: port.ships, step: 1 });
  const carriers = numberField('Aircraft carriers', { value: port.carriers, min: 0, max: port.carriers, step: 1 });
  const name = h('input', { placeholder: 'Name (optional)', maxlength: 28 });
  const refit = (s.you.refitUntil ?? -1) > s.week;
  modal({
    title: 'Form a fleet',
    body: h('div.stack', sea.el, ships.el, port.carriers ? carriers.el : null, h('label.field', h('span', 'Name'), name),
      refit ? h('div.warning.warn', `Ships back from a lost battle are still refitting for ${s.you.refitUntil - s.week} more weeks: a fleet formed now starts badly disorganised.`) : null,
      h('p.muted.small', 'A carrier group counts as eight warships in battle and lets the fleet strike far beyond its guns.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Put to sea', kind: 'primary',
      onClick: async () => !(await ctx.send({ type: 'fleetForm', sea: sea.input.value, ships: Number(ships.input.value), carriers: Number(carriers.input.value) || 0, name: name.value.trim() || undefined })) || false,
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
    body: h('div.stack', ships.el, carriers.el, h('p.muted.small', 'Ships join or leave in home waters. A negative number sends ships back to port.')),
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
