// The war bar along the bottom of the map: air strikes, missile strikes, amphibious landings and cutting an enemy
// army's supply line, each one click away. While a strike is aimed, our spies show what is worth hitting in the
// countries they are inside (each province's output and the troops in it); elsewhere we see nothing.

import { h, nationName, troops } from './dom.js';
import { modal } from './dialogs.js';
import { CUT_AIRCRAFT, CUT_MISSILES } from '../engine/military.js';
import { INDEX } from './map.js';

const atWarWith = (s, id) => s.wars.some((w) => (w.a === s.me && w.b === id) || (w.b === s.me && w.a === id));
// A spy network of ours inside a country that has settled in (four weeks)
export const spiesIn = (s, id) => { const n = s.you?.spies?.[id]; return Boolean(n && n.agents > 0 && s.week - n.since >= 4); };
const enemies = (s) => [...new Set(s.wars.flatMap((w) => (w.a === s.me ? [w.b] : w.b === s.me ? [w.a] : [])))];

export function renderWarBar(ctx, el) {
  const s = ctx.state;
  if (!s?.you || s.over) { el.hidden = true; return; }
  const foes = enemies(s);
  const me = s.you;
  const busy = (me.airOps ?? []).reduce((t, o) => t + o.aircraft, 0) + (me.airlifts ?? []).reduce((t, o) => t + o.aircraft, 0);
  const free = Math.max(0, me.aircraft - busy);
  const mine = s.armies.filter((a) => a.owner === s.me && !a.sea);
  const why = {
    air: !foes.length ? 'Air strikes need a war.' : free < 1 ? 'All our aircraft are busy.' : null,
    missile: !foes.length ? 'Missile strikes need a war.' : me.missiles < 1 ? 'We have no missiles: build some in Military, Weapons.' : null,
    landing: !mine.length ? 'Form an army first (Military, Troops).' : null,
    cut: !foes.length ? 'Cutting supply lines needs a war.' : free < CUT_AIRCRAFT && me.missiles < CUT_MISSILES ? `It takes ${CUT_AIRCRAFT} free aircraft or ${CUT_MISSILES} missiles.` : null,
  };
  const btn = (key, icon, label, run) => h('button.war-btn', { disabled: Boolean(why[key]), title: why[key] ?? label, onclick: run }, h('span', { 'aria-hidden': 'true' }, icon), h('span', label));
  el.hidden = false;
  el.replaceChildren(
    btn('air', '✈', 'Air strike', () => strike(ctx, 'air')),
    btn('missile', '🚀', 'Missile strike', () => strike(ctx, 'missile')),
    btn('landing', '⚓', 'Amphibious landing', () => landing(ctx)),
    btn('cut', '✂', 'Cut a supply line', () => pickSupplyLine(ctx)));
}

// What our spies show of the enemy while a strike is aimed: every province of a country at war with us that our
// spies are inside, with its output and the troops in it
export function strikeIntel(s) {
  const out = [];
  const seen = enemies(s).filter((id) => spiesIn(s, id));
  if (!seen.length) return { list: [], seen, blind: enemies(s) };
  const set = new Set(seen);
  const troopsIn = new Map();
  for (const a of s.armies) if (set.has(a.owner) && !a.sea) troopsIn.set(a.region, (troopsIn.get(a.region) ?? 0) + a.troops);
  for (const [id, i] of Object.entries(INDEX)) {
    const row = s.regions[i];
    if (!set.has(row[1])) continue;
    out.push({ id, gdp: row[9], troops: (troopsIn.get(id) ?? 0) + (row[8] ?? 0) });
  }
  return { list: out, seen, blind: enemies(s).filter((id) => !set.has(id)) };
}

function strike(ctx, kind) {
  const s = ctx.state;
  const intel = strikeIntel(s);
  ctx.showIntel(intel.list);
  if (!intel.seen.length) ctx.hint(`We have no spies inside ${intel.blind.map((id) => nationName(s, id)).join(' or ')}: we can't see which provinces are worth hitting or where their troops are. Plant agents (Spies) to see it.`, 'warn', 9000);
  else ctx.hint(`Our spies show ${intel.seen.map((id) => nationName(s, id)).join(' and ')}: rings are each province's output, with the troops there.${intel.blind.length ? ` We see nothing inside ${intel.blind.map((id) => nationName(s, id)).join(' or ')}.` : ''}`, 'info', 9000);
  ctx.strikeTarget(kind);
}

function landing(ctx) {
  const s = ctx.state;
  const mine = s.armies.filter((a) => a.owner === s.me && !a.sea);
  const go = (id) => {
    ctx.selectArmy(id, true);
    ctx.hint('Now click an enemy coast across the sea, or the water just off it, to land there. A landing force prepared on its card ("Prepare a landing") crosses up to 2,000 km, even without command of the sea.', 'info', 10000);
  };
  if (mine.length === 1) return go(mine[0].id);
  ctx.target({
    text: 'Pick the army to land: click one of our armies',
    onArmy: (id) => { const a = s.armies.find((x) => x.id === id); if (a?.owner !== s.me) return true; ctx.endTarget(); go(id); return true; },
    onPick: () => ctx.hint('Click one of our armies (the markers on the map).', 'info', 4000),
  });
}

function pickSupplyLine(ctx) {
  const s = ctx.state;
  ctx.target({
    text: 'Click an enemy army deep in someone else\'s land to cut its supply line',
    onArmy: (id) => {
      const a = ctx.state.armies.find((x) => x.id === id);
      if (!a || a.owner === s.me) return true;
      if (!atWarWith(s, a.owner)) { ctx.hint(`We are not at war with ${nationName(s, a.owner)}.`, 'bad', 5000); return true; }
      ctx.endTarget();
      cutSupplyDialog(ctx, a);
      return true;
    },
    onPick: () => ctx.hint('Click an enemy army marker.', 'info', 4000),
  });
}

export function cutSupplyDialog(ctx, a) {
  const s = ctx.state;
  const me = s.you;
  const busy = (me.airOps ?? []).reduce((t, o) => t + o.aircraft, 0) + (me.airlifts ?? []).reduce((t, o) => t + o.aircraft, 0);
  const free = Math.max(0, me.aircraft - busy);
  const spy = spiesIn(s, a.owner);
  modal({
    title: `Cut ${a.name}'s supply line`,
    body: h('div.stack',
      h('p', `Strike the depots, bridges, rail junctions and fuel convoys behind ${nationName(s, a.owner)}'s ${a.name} (${troops(a.troops)}). With its line cut it gets no fuel, food or munitions: it lives off what it carries for two weeks, then falls apart fast, unless ${nationName(s, a.owner)} pays to rebuild the line.`),
      a.abroad === false ? h('div.warning.bad', `${a.name} is on its own ground, close to its depots: there is no long supply line to cut.`) : null,
      a.lineCut ? h('div.warning.info', 'Its line is already cut.') : null,
      h('p.muted.small', spy ? `Our spies inside ${nationName(s, a.owner)} know where its depots are: better odds.` : `We have no spies inside ${nationName(s, a.owner)}: we strike blind (worse odds).`),
      h('p.muted.small', `Uses ${CUT_AIRCRAFT} of our ${free} free aircraft (some may be shot down), or ${CUT_MISSILES} of our ${me.missiles} missiles.`)),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: `${CUT_MISSILES} missiles`, kind: 'ghost', disabled: me.missiles < CUT_MISSILES, onClick: async () => !(await ctx.send({ type: 'cutSupply', army: a.id, how: 'missile' })) || false },
      { label: `${CUT_AIRCRAFT} aircraft`, kind: 'primary', disabled: free < CUT_AIRCRAFT, onClick: async () => !(await ctx.send({ type: 'cutSupply', army: a.id, how: 'air' })) || false },
    ],
  });
}

