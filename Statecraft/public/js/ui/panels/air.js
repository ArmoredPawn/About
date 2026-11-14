// Air power and missiles: what each kind of air campaign and missile strike is for, a forecast before ordering
// it, and what it achieved afterwards.

import { h, flag, regionName, num, troops, bar } from '../dom.js';
import { modal } from '../dialogs.js';
import { AIR_MISSIONS, MISSILE_AIMS } from '../../engine/military.js';

const ICON = { support: '🎯', interdict: '⛓', strategic: '🏭', army: '🪖', forts: '🧱', airbase: '✈', industry: '🏭' };
const freeAircraft = (me) => me.aircraft - me.airOps.reduce((t, o) => t + o.aircraft, 0);
const holderOf = (ctx, id) => ctx.state.regions[ctx.regionIndex[id]]?.[1];

// Our rough read of an air campaign's chances: their fighters and air defences against our planes
function airForecast(ctx, id, aircraft) {
  const s = ctx.state;
  const me = s.you;
  const foe = s.countries[holderOf(ctx, id)];
  const q = (lvl) => 0.6 + 0.08 * (lvl ?? 6);
  const defAir = foe ? (foe.mil?.aircraft ?? 0) * q(foe.tech?.air) * 0.3 : 5;
  const adf = foe ? (foe.tech?.missile ?? 6) * 15 : 10;
  const mine = aircraft * q(me.tech.air);
  const eff = mine / (mine + defAir + adf + 0.001);
  return { eff, losses: Math.max(0, Math.round(aircraft * 0.006 * (1.2 - eff))), power: eff * Math.min(1.5, aircraft / 60), known: Boolean(foe?.tech) };
}

// A mission picker: cards to choose from, one highlighted
function picker(entries, initial, onPick) {
  let current = initial;
  const cards = entries.map(([key, d]) => {
    const card = h('button.pick-card', { type: 'button', 'aria-pressed': String(key === current) },
      h('span.pick-icon', { 'aria-hidden': 'true' }, ICON[key] ?? '•'),
      h('span.pick-text', h('b', d.name), h('span', d.note)));
    card.addEventListener('click', () => { current = key; for (const c of cards) c.setAttribute('aria-pressed', String(c === card)); onPick(key); });
    return card;
  });
  return h('div.pick-list', cards);
}

/* ---------- Air campaigns ---------- */

export function airDialog(ctx, id) {
  const s = ctx.state;
  const me = s.you;
  const existing = me.airOps.find((o) => o.region === id);
  const free = freeAircraft(me) + (existing?.aircraft ?? 0);
  if (free < 1) return ctx.hint('All our aircraft are already flying missions. Call one off, or build more (Military → Weapons).', 'bad', 6000);
  const attacking = s.armies.some((a) => a.owner === s.me && a.attacking === id) || (s.regions[ctx.regionIndex[id]]?.[5] === s.me);
  let mission = existing?.mission ?? (attacking ? 'support' : 'strategic');
  let aircraft = existing?.aircraft ?? Math.max(1, Math.min(free, Math.round(free * 0.3)));
  const forecast = h('div.forecast');
  const slider = h('input', { type: 'range', min: 1, max: free, step: 1, value: aircraft });
  const count = h('b.mono');
  const refresh = () => {
    aircraft = Number(slider.value);
    count.textContent = `${num(aircraft)} aircraft`;
    const f = airForecast(ctx, id, aircraft);
    const p = Math.min(1, f.power);
    const what = mission === 'support' ? `Defenders lose about ${Math.round(7 * f.power)} organisation a week; our attack there hits about ${Math.round(25 * p)}% harder.`
      : mission === 'interdict' ? `Enemy armies there lose about ${Math.round(40 * p)}% of their supply (half that next door).`
        : `About ${Math.round(2 * f.power * 10) / 10} points of damage to output a week.`;
    forecast.replaceChildren(
      h('div.row.between.small', h('span.muted', 'Air superiority'), h('span', `${Math.round(f.eff * 100)}%${f.known ? '' : ' (estimate)'}`)),
      bar(f.eff * 100, 100, f.eff > 0.6 ? 'good' : f.eff > 0.35 ? 'warn' : 'bad'),
      h('p.small', { style: { marginTop: '6px' } }, what),
      h('p.muted.small', f.losses >= 1 ? `Expected losses: about ${f.losses} aircraft a week to their fighters and air defences.` : 'Expected losses: hardly any; their fighters and air defences are no match.'));
  };
  slider.addEventListener('input', refresh);
  refresh();
  modal({
    title: `Air campaign over ${regionName(id)}`,
    body: h('div.stack',
      picker(Object.entries(AIR_MISSIONS), mission, (k) => { mission = k; refresh(); }),
      h('div.field', h('span', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } }, h('span', 'Aircraft'), count), slider, h('span.muted.small', `${num(free)} free`)),
      forecast),
    actions: [
      ...(existing ? [{ label: 'Call it off', kind: 'ghost', onClick: async () => !(await ctx.send({ type: 'air', region: id, aircraft: 0 })) || false }] : [{ label: 'Cancel', kind: 'ghost' }]),
      { label: existing ? 'Update' : 'Begin', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'air', region: id, aircraft, mission })) || false },
    ],
  });
}

/* ---------- Missiles ---------- */

export function missileDialog(ctx, id) {
  const s = ctx.state;
  const me = s.you;
  if (me.missiles < 1) return ctx.hint('We have no missiles. Build some in Military → Weapons.', 'bad', 6000);
  const foeId = holderOf(ctx, id);
  const foe = s.countries[foeId];
  const enemyArmies = s.armies.filter((a) => a.region === id && !a.sea && a.owner === foeId);
  const fort = s.regions[ctx.regionIndex[id]]?.[4] ?? 0;
  let aim = enemyArmies.length ? 'army' : fort ? 'forts' : 'industry';
  const slider = h('input', { type: 'range', min: 1, max: me.missiles, step: 1, value: Math.min(me.missiles, 50) });
  const count = h('b.mono');
  const forecast = h('div.forecast');
  const intercept = foe ? Math.min(0.75, Math.max(0, 0.055 * (foe.tech?.missile ?? 6) - 0.02 * (me.tech.missile - 6))) : 0.05;
  const refresh = () => {
    const n = Number(slider.value);
    count.textContent = `${num(n)} missiles`;
    const hits = Math.round(n * (1 - intercept));
    const acc = me.tech.missile / 8;
    const what = aim === 'army' ? `About ${troops(hits * 0.12 * acc)} casualties${enemyArmies.length ? ` among ${enemyArmies.map((a) => a.name).join(', ')}` : ' in the garrison'}, and lost organisation.`
      : aim === 'forts' ? (fort ? ((n) => (n ? `Fortifications (level ${fort}) knocked down by about ${n} level${n === 1 ? '' : 's'}.` : `Too few get through to dent the fortifications (level ${fort}).`))(Math.min(fort, Math.floor(hits * acc / 40) + (hits * acc >= 15 ? 1 : 0))) : 'There are no fortifications here.')
        : aim === 'airbase' ? `About ${Math.round(hits * 0.35 * acc)} aircraft destroyed on the ground.`
          : `About ${Math.round(Math.min(35, hits * 0.24 * acc))} points of damage to industry and resources.`;
    forecast.replaceChildren(
      h('div.row.between.small', h('span.muted', 'Their air defences shoot down'), h('span', `about ${Math.round(intercept * 100)}%${foe?.tech ? '' : ' (estimate)'}`)),
      bar(100 - intercept * 100, 100, intercept < 0.25 ? 'good' : intercept < 0.45 ? 'warn' : 'bad'),
      h('p.small', { style: { marginTop: '6px' } }, `About ${hits} get through. ${what}`));
  };
  slider.addEventListener('input', refresh);
  refresh();
  modal({
    title: `Missile strike on ${regionName(id)}`,
    body: h('div.stack',
      picker(Object.entries(MISSILE_AIMS), aim, (k) => { aim = k; refresh(); }),
      h('div.field', h('span', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } }, h('span', 'Missiles'), count), slider, h('span.muted.small', `${num(me.missiles)} in stock`)),
      forecast),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Fire', kind: 'danger', onClick: async () => !(await ctx.send({ type: 'missile', region: id, count: Number(slider.value), aim })) || false }],
  });
}

/* ---------- Military → Air & sea ---------- */

export function airOps(ctx, enemies) {
  const s = ctx.state;
  const me = s.you;
  const free = freeAircraft(me);
  const card = (o) => {
    const d = AIR_MISSIONS[o.mission ?? 'strategic'];
    const holder = holderOf(ctx, o.region);
    const last = o.last;
    const total = o.total;
    const result = !last ? 'First sorties this week.'
      : o.mission === 'support' ? `Last week: defenders lost ${Math.round(last.org)} organisation and ${troops(last.killed)} men. So far: ${troops(total?.killed ?? 0)} hit.`
        : o.mission === 'interdict' ? 'Enemy armies there are short of supply while it lasts.'
          : `Output down ${Math.round((total?.dmg ?? 0) * 100)} points so far.`;
    return h('div.item.clickable', { onclick: () => ctx.openRegion(o.region, true) },
      h('div.item-head', h('span.pick-icon.small', ICON[o.mission ?? 'strategic']), h('span.name', regionName(o.region)), flag(holder), h('span.chip', d.short), h('span.mono.small', { style: { marginLeft: 'auto' } }, `${num(o.aircraft)} aircraft`)),
      h('div.meta', result, total?.lost ? ` Lost: ${Math.round(total.lost)} aircraft.` : ''),
      last ? h('div.row.gap.small', { style: { marginTop: '4px' } }, h('span.muted', 'Air superiority'), h('div.grow', bar((last.eff ?? 0) * 100, 100, last.eff > 0.6 ? 'good' : last.eff > 0.35 ? 'warn' : 'bad')), h('span.mono', `${Math.round((last.eff ?? 0) * 100)}%`)) : null,
      h('div.actions', { onclick: (e) => e.stopPropagation() },
        h('button.btn.small', { onclick: () => airDialog(ctx, o.region) }, 'Change…'),
        h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'air', region: o.region, aircraft: 0 }) }, 'Call off')));
  };
  return h('div',
    h('div.section', h('h3', 'Air campaigns'),
      h('div.kpis', { style: { marginBottom: '8px' } },
        h('div.kpi', h('span', 'Aircraft'), h('b', num(me.aircraft)), h('small', `${num(free)} free`)),
        h('div.kpi', h('span', 'Missions'), h('b', String(me.airOps.length)), h('small', 'flying now')),
        h('div.kpi', h('span', 'Missiles'), h('b', num(me.missiles)), h('small', 'in stock'))),
      h('div.pick-legend', Object.entries(AIR_MISSIONS).map(([k, d]) => h('div.row.gap.small', h('span.pick-icon.small', ICON[k]), h('span', h('b', `${d.name}: `), d.note)))),
      h('div.list', { style: { marginTop: '8px' } }, me.airOps.length ? me.airOps.map(card) : [h('div.empty', enemies.length ? 'No missions flying. Pick a province to bomb.' : 'At peace: air campaigns need a war.')]),
      h('button.btn.small.primary', { style: { marginTop: '8px' }, disabled: !enemies.length || free < 1, onclick: () => ctx.strikeTarget('air') }, `New air campaign (${num(free)} aircraft free)`)),
    h('div.section', h('h3', 'Missile strikes'),
      h('div.pick-legend', Object.entries(MISSILE_AIMS).map(([k, d]) => h('div.row.gap.small', h('span.pick-icon.small', ICON[k]), h('span', h('b', `${d.name}: `), d.note)))),
      h('button.btn.small', { style: { marginTop: '8px' }, disabled: !enemies.length || me.missiles < 1, onclick: () => ctx.strikeTarget('missile') }, 'Pick a target…')));
}
