// The war room: manpower, army groups and their operations, weapons and production, logistics, air and sea
// campaigns, and wars.

import { h, flag, money, nationName, regionName, troops, bar, num } from '../dom.js';
import { BUILD } from '../../engine/economy.js';
import { TRAITS, AGGRESSION, MIN_ARMY, draftCost } from '../../engine/military.js';
import { CAPITALS } from '../map.js';
import { GEO } from '../../engine/data/geo.js';
import { modal, numberField, selectField, confirmBox } from '../dialogs.js';
import { peaceDialog } from './diplomacy.js';
import { CONSCRIPTION } from '../../engine/government.js';
import { RANGE_KINDS, rangeCost, RANGE_WEEKS } from '../../engine/science.js';

export function military(ctx) {
  const tab = ctx.sub('military', 'overview');
  const tabs = [['overview', 'Overview'], ['armies', 'Troops'], ['weapons', 'Weapons'], ['logistics', 'Logistics'], ['ops', 'Air & sea'], ['wars', 'Wars']];
  return h('div',
    h('div.panel-title', h('h2', 'Military'), h('span.muted.small', `${money(ctx.state.you.milFunds)} defence funds`)),
    deployable(ctx),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('military', id) }, label))),
    ({ overview, armies, weapons, logistics, ops, wars, forces: overview, build: weapons }[tab] ?? overview)(ctx));
}

// Always on top: what the leader can actually send into battle right now
function deployable(ctx) {
  const s = ctx.state;
  const me = s.you;
  const free = freeForces(s);
  const inArmies = myArmies(s).reduce((t, a) => t + a.troops, 0);
  return h('div.kpis', { style: { marginBottom: '12px' } },
    h('div.kpi', h('span', 'Deployable now'), h('b', troops(free.troops)), h('small', `${num(free.tanks)} tanks at home`)),
    h('div.kpi', h('span', 'In army groups'), h('b', troops(inArmies)), h('small', `${myArmies(s).length} group${myArmies(s).length === 1 ? '' : 's'}`)),
    h('div.kpi', h('span', 'Can be drafted'), h('b', troops(Math.max(0, me.reserves))), h('small', `${CONSCRIPTION[me.conscription]?.name ?? 'reservists'}`)));
}

/* ---------- Overview: manpower and readiness ---------- */

function overview(ctx) {
  const s = ctx.state;
  const me = s.you;
  const free = freeForces(s);
  const l = me.logistics;
  const row = (label, v, note) => h('tr', h('td', label), h('td.num', v), h('td.faint.small', note ?? ''));
  return h('div',
    h('div.section', h('h3', 'Manpower'),
      h('table.tbl', h('tbody',
        row('Active troops', troops(me.troops), `${troops(free.troops)} free to deploy`),
        row('Trained reserves', troops(Math.max(0, me.reserves)), 'drafted on the spot into new army groups'),
        row('Called up by mobilisation', troops(me.mobTroops ?? 0), ['peacetime', 'partial', 'full'][me.mob]),
        row('Extra conscripts', troops(Math.max(0, me.conscripts ?? 0)), CONSCRIPTION[me.conscription]?.name),
        row('Killed so far', troops(me.dead ?? 0), 'counted off the population'),
        row('Casualties (all)', troops(me.losses), 'killed, wounded and captured')))),
    h('div.section', h('h3', 'Mobilisation'),
      h('div.seg', [['Peacetime', 0], ['Partial', 1], ['Full', 2]].map(([label, lvl]) => h('button', { 'aria-pressed': String(me.mob === lvl), onclick: () => ctx.send({ type: 'mobilize', level: lvl }) }, label))),
      h('p.muted.small', { style: { marginTop: '6px' } }, `Partial calls up 30% of reserves, full 80%, and puts factories on a war footing. Both slow the economy and cost approval. To grow the pool itself, change conscription in Government.`),
      h('button.btn.small', { style: { marginTop: '6px' }, onclick: () => ctx.go('government') }, 'Conscription…')),
    h('div.section', h('h3', 'Readiness'),
      h('div.budget',
        h('span', 'Defence budget'), h('span.num', `${money((me.gdp * me.spend.defence) / 100)}/yr`),
        h('span', 'Upkeep of forces'), h('span.num', `−${money(me.upkeep ?? 0)}/yr`),
        h('span', 'Armies in the field'), h('span.num', `−${money(l?.cost ?? 0)}/yr`),
        h('span.total', 'Defence funds now'), h('span.num.total', money(me.milFunds))),
      l && l.ratio < 0.95 ? h('div.warning', { style: { marginTop: '8px' } }, `Supply lines are strained: armies get ${Math.round(l.ratio * 100)}% of what they need. See Logistics.`) : null,
      me.readiness < 1 ? h('div.warning.bad', { style: { marginTop: '8px' } }, 'Defence funds ran out: readiness is falling. Raise defence spending in Economy.') : null),
    h('div.section', h('h3', 'Reach'),
      h('p.small', `Aircraft ${num(me.range?.air)} km · missiles ${num(me.range?.missile)} km${me.range?.nuke ? ` · nuclear delivery ${num(me.range.nuke)} km` : ''} from our nearest base. Allies' and access partners' bases count too.`),
      h('button.btn.small', { style: { marginTop: '6px' }, onclick: () => ctx.setSub('military', 'weapons') }, 'Extend range…')),
  );
}

/* ---------- Logistics ---------- */

function logistics(ctx) {
  const s = ctx.state;
  const me = s.you;
  const l = me.logistics ?? { cost: 0, factories: 1, guards: 1, ratio: 1, rear: 0, free: 0, capacity: 0, demand: 0 };
  const pctOf = (v) => `${Math.round(v * 100)}%`;
  const abroad = myArmies(s).filter((a) => a.sea || s.regions[ctx.regionIndex[a.region]]?.[0] !== s.me);
  return h('div',
    h('p.muted.small', 'An army far from home needs three things, as Germany found in Russia in 1941: money for fuel, food and ammunition; factories to make the shells and spare parts; and soldiers to guard the roads and railways behind the front. Run short of any and every army\'s supply falls.'),
    h('div.kpis', { style: { marginTop: '10px' } },
      h('div.kpi', h('span', 'Money'), h('b', money(l.cost)), h('small', 'a year on armies in the field')),
      h('div.kpi', h('span', 'Factories'), h('b', { class: l.factories < 0.8 ? 'bad' : l.factories < 1 ? 'warn' : 'good' }, pctOf(l.factories)), h('small', 'of munitions needed')),
      h('div.kpi', h('span', 'Rear guards'), h('b', { class: l.guards < 0.8 ? 'bad' : l.guards < 1 ? 'warn' : 'good' }, pctOf(l.guards)), h('small', `${troops(l.rear)} needed, ${troops(l.free)} free`))),
    h('div.section', h('h3', 'What helps'),
      h('ul.small', { style: { paddingLeft: '18px', display: 'grid', gap: '4px' } },
        h('li', 'Money: defence spending (Economy). When defence funds run out, the treasury pays, then borrowing.'),
        h('li', `Factories: partial or full mobilisation puts industry on a war footing; Industry research and a supply of iron and critical metals raise output. Now making ${pctOf(l.factories)} of what the front uses.`),
        h('li', 'Rear guards: keep enough troops at home (don\'t send everyone to the front), or draft more through conscription.'),
        h('li', 'Shorter lines: armies close to home soil, and on allied ground, are cheaper to supply. Oil shortages cut supply everywhere.'))),
    h('div.section', h('h3', 'Armies abroad'),
      abroad.length ? h('div.list', abroad.map((a) => h('div.item.clickable', { onclick: () => ctx.selectArmy(a.id, true) },
        h('div.item-head', h('span.name', a.name), h('span.mono.small', troops(a.troops))),
        h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span.muted', 'Supply'), h('div.grow', bar(a.supply * 100, 100, a.supply < 0.5 ? 'bad' : a.supply < 0.8 ? 'warn' : 'good')), h('span.mono', `${Math.round(a.supply * 100)}%`)),
        h('div.meta', a.sea ? 'At sea' : regionName(a.region)))))
        : h('div.empty', 'No armies beyond our borders.')),
  );
}

/* ---------- Weapons: inventory, production and range ---------- */

function weapons(ctx) {
  return h('div', forces(ctx), build(ctx), ranges(ctx));
}

function ranges(ctx) {
  const me = ctx.state.you;
  const work = me.rangeWork ?? [];
  return h('div.section', h('h3', 'Range'),
    h('p.muted.small', 'Aircraft need fuel and missiles have a fixed reach: neither can strike across the world from home. Range is measured from our nearest base, an ally\'s or an access partner\'s; carriers carry aircraft, and warships carry cruise missiles, toward coastal targets.'),
    h('div.list', { style: { marginTop: '8px' } }, Object.entries(RANGE_KINDS).map(([kind, k]) => {
      const w = work.find((x) => x.kind === kind);
      const cost = me.range ? rangeCost(me, kind) : 0;
      return h('div.item',
        h('div.item-head', h('span.name', k.name), h('span.mono', `${num(me.range?.[kind])} km`)),
        h('div.meta', k.note),
        w ? h('div', { style: { marginTop: '6px' } }, bar(w.total - w.left, w.total), h('div.meta', `Extending to ${num(w.to)} km: ${w.left} weeks left`)) : null,
        h('div.actions', h('button.btn.small', { disabled: Boolean(w) || (me.range?.[kind] ?? 0) >= k.max, onclick: async () => {
          if (await confirmBox(`Extend ${k.name.toLowerCase()}?`, `About +35% range. Costs ${money(cost)} from the defence budget and takes ${RANGE_WEEKS} weeks.`)) ctx.send({ type: 'range', kind });
        } }, w ? 'In progress' : `Extend (${money(cost)})`)));
    })));
}

export function myArmies(s) {
  return s.armies.filter((a) => a.owner === s.me);
}

export function freeForces(s) {
  const me = s.you;
  let t = me.troops;
  let k = me.tanks;
  for (const a of myArmies(s)) { t -= a.troops; k -= a.tanks; }
  return { troops: Math.max(0, t), tanks: Math.max(0, k) };
}

/* ---------- Army groups ---------- */

function armies(ctx) {
  const s = ctx.state;
  const list = myArmies(s);
  const free = freeForces(s);
  return h('div',
    h('div.item', h('div.item-head', h('span.name', 'Forces at home'), h('button.btn.small.primary', { onclick: () => formArmy(ctx) }, '＋ Draft & form army')),
      h('div.meta', `${troops(free.troops)} troops and ${num(free.tanks)} tanks garrison your provinces, with ${troops(Math.max(0, s.you.reserves))} reservists who can be drafted. Army groups are what you send to attack.`)),
    h('div.list', { style: { marginTop: '10px' } }, list.length ? list.map((a) => armyCard(ctx, a)) : [h('div.empty', 'No army groups yet. 1) Draft & form one where you want it. 2) Click it on the map, then click where it should go.')]));
}

export function armyCard(ctx, a, compact = false) {
  const s = ctx.state;
  const trait = TRAITS[a.gen.trait];
  const stars = '★'.repeat(a.gen.skill) + '☆'.repeat(5 - a.gen.skill);
  const others = myArmies(s).filter((x) => x.id !== a.id && x.region === a.region && !x.sea);
  return h('div.item', { class: compact ? '' : 'clickable', onclick: compact ? null : () => ctx.selectArmy(a.id, true) },
    h('div.item-head', h('span.swatch', { style: { background: 'var(--accent)' } }), h('span.name', a.name), h('span.mono.small', troops(a.troops))),
    h('div.meta', `${a.gen.name} · `, h('span', { title: 'Skill' }, stars), ` · ${trait?.name ?? ''}`, h('span.faint', ` (${trait?.note ?? ''})`)),
    h('div.meta', `${a.sea ? 'At sea' : regionName(a.region)} · ${num(a.tanks)} tanks · supply ${Math.round(a.supply * 100)}%`),
    h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span.muted', 'Organisation'), h('div.grow', bar(a.org, 100, a.org < 30 ? 'bad' : a.org < 60 ? 'warn' : 'good')), h('span.mono', `${a.org}%`)),
    h('div.meta', { style: { color: 'var(--ink)' } }, a.status),
    a.sea ? null : h('div.actions', { onclick: (e) => e.stopPropagation() },
      h('button.btn.small.primary', { onclick: () => ctx.selectArmy(a.id, true) }, 'Send…'),
      h('button.btn.small.ghost', { onclick: () => reinforce(ctx, a) }, 'Reinforce'),
      others.length ? h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'armyMerge', ids: [a.id, ...others.map((o) => o.id)] }) }, 'Merge here') : null,
      h('button.btn.small.ghost', { onclick: () => rename(ctx, a) }, 'Rename'),
      h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Disband ${a.name}?`, 'Its troops return to the home garrisons.')) ctx.send({ type: 'armyDisband', id: a.id }); } }, 'Disband')));
}

// Provinces we hold, front lines first (then the capital), for choosing where an army forms
function formingGrounds(ctx) {
  const s = ctx.state;
  const enemies = new Set(s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a)));
  const holder = (id) => s.regions[ctx.regionIndex[id]]?.[1];
  const capital = CAPITALS[s.me];
  return Object.keys(ctx.regionIndex)
    .filter((id) => holder(id) === s.me)
    .map((id) => {
      const foes = [...new Set(GEO[id].adj.map(holder).filter((h2) => enemies.has(h2)))];
      const borders = [...new Set(GEO[id].adj.map(holder).filter((h2) => h2 && h2 !== s.me && !enemies.has(h2)))];
      return { id, front: foes.length > 0, foes, borders, capital: id === capital };
    })
    .sort((a, b) => (b.front - a.front) || (b.capital - a.capital) || regionName(a.id).localeCompare(regionName(b.id)));
}

// One dialog: how many troops (drafting reservists if needed) and which province they form up in
export function formArmy(ctx, region) {
  const s = ctx.state;
  const me = s.you;
  const free = freeForces(s);
  const freeT = Math.floor(free.troops);
  const reserves = Math.floor(Math.max(0, me.reserves));
  const grounds = formingGrounds(ctx);
  if (!grounds.length) return ctx.toast('You hold no provinces to form an army in.', 'warn');
  const label = (g) => `${regionName(g.id)}${g.front ? ` · front with ${g.foes.map((f) => nationName(s, f)).join(', ')}` : g.capital ? ' · capital' : g.borders.length ? ` · borders ${g.borders.slice(0, 2).map((f) => nationName(s, f)).join(', ')}` : ''}`;
  const where = selectField('Form up in', grounds.map((g) => [g.id, label(g)]), region ?? grounds[0].id);
  const t = numberField('Troops', { value: Math.max(MIN_ARMY, Math.floor(freeT * 0.5)), min: MIN_ARMY, max: freeT + reserves, step: 1, suffix: 'thousands' });
  const k = numberField('Tanks', { value: Math.floor(free.tanks * 0.5), min: 0, max: Math.floor(free.tanks), step: 10 });
  const name = h('input', { maxlength: 28, placeholder: 'Optional, e.g. Army Group South' });
  const quick = h('div.row.wrap.gap', [['Quarter', 0.25], ['Half', 0.5], ['All free', 1]].map(([lbl, f]) => h('button.btn.small.ghost', { type: 'button', onclick: () => { t.input.value = Math.max(MIN_ARMY, Math.floor(freeT * f)); k.input.value = Math.floor(free.tanks * f); hint(); } }, lbl)),
    reserves > 0 ? h('button.btn.small.ghost', { type: 'button', onclick: () => { t.input.value = freeT + reserves; k.input.value = Math.floor(free.tanks); hint(); } }, 'Everything + draft all reserves') : null);
  const note = h('p.small');
  const hint = () => {
    const want = Math.floor(Number(t.input.value) || 0);
    const draft = Math.max(0, want - freeT);
    if (want < MIN_ARMY) { note.className = 'small bad'; note.textContent = `An army group needs at least ${MIN_ARMY},000 troops.`; return; }
    if (draft > reserves) { note.className = 'small bad'; note.textContent = `Too many: ${troops(freeT)} are free and ${troops(reserves)} reservists can be drafted.`; return; }
    note.className = 'small muted';
    note.textContent = draft
      ? `${troops(want - draft)} from your garrisons + ${troops(draft)} newly drafted reservists. The draft costs about ${money(draftCost(me, draft))}, dents approval a little, and draftees start less organised.`
      : `${troops(want)} from your garrisons. ${troops(freeT - want)} stay home${reserves ? `; go higher to draft from ${troops(reserves)} reservists` : ''}.`;
  };
  t.input.addEventListener('input', hint);
  hint();
  modal({
    title: 'Draft & form an army group',
    body: h('div.stack', t.el, quick, note, k.el, where.el, h('label.field', h('span', 'Name'), name),
      h('p.muted.small', 'A general is appointed. Next: click the army on the map, then click where it should go.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Form army', kind: 'primary', onClick: async () => {
        const err = await ctx.send({ type: 'armyCreate', region: where.input.value, troops: Number(t.input.value), tanks: Number(k.input.value), name: name.value });
        if (err) return false;
        ctx.toast(`Army formed in ${regionName(where.input.value)}. Press Attack on it to send it in.`, 'good');
        return true;
      },
    }],
  });
}

function reinforce(ctx, a) {
  const free = freeForces(ctx.state);
  const t = numberField('Troops to add (negative sends them home)', { value: Math.min(50, Math.floor(free.troops)), step: 1, suffix: 'thousands' });
  const k = numberField('Tanks to add', { value: 0, step: 10 });
  modal({
    title: `Reinforce ${a.name}`,
    body: h('div.stack', h('p.muted.small', `Free at home: ${troops(free.troops)} troops, ${num(free.tanks)} tanks. Armies are reinforced on friendly ground only.`), t.el, k.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Send', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'armyReinforce', id: a.id, troops: Number(t.input.value), tanks: Number(k.input.value) })) || false }],
  });
}

function rename(ctx, a) {
  const input = h('input', { value: a.name, maxlength: 28 });
  modal({ title: 'Rename army group', body: h('label.field', h('span', 'Name'), input), actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: () => ctx.send({ type: 'armyRename', id: a.id, name: input.value }) }] });
}

/* ---------- Forces ---------- */

function forces(ctx) {
  const s = ctx.state;
  const me = s.you;
  const free = freeForces(s);
  const row = (label, v, note) => h('tr', h('td', label), h('td.num', v), h('td.faint.small', note ?? ''));
  return h('div',
    h('div.section', h('h3', 'Inventory'),
      h('table.tbl', h('tbody',
        row('Active troops', troops(me.troops), `${troops(free.troops)} at home`),
        row('Tanks', num(me.tanks), `${num(free.tanks)} at home`),
        row('Combat aircraft', num(me.aircraft), `${num(me.airOps.reduce((t, o) => t + o.aircraft, 0))} on campaigns`),
        row('Warships & submarines', num(me.ships), `${num(Object.values(me.blockades).reduce((t, v) => t + v, 0))} blockading`),
        row('Aircraft carriers', num(me.carriers), me.carriers ? 'unlimited naval reach' : 'landings limited by range'),
        row('Missiles', num(me.missiles)),
        row('Nuclear warheads', num(me.nukes), me.nukeProgram.on ? `weapons programme ${Math.round(me.nukeProgram.progress * 100)}%` : ''),
        row('Losses so far', troops(me.losses))))),
    h('div.section', h('h3', 'Nuclear'),
      me.nukes > 0
        ? h('p.muted.small', `${me.nukes} warheads. To use one, select an enemy-held province on the map. Every country will turn against you, and nuclear-armed enemies may answer in kind.`)
        : h('div.item', h('div.item-head', h('span.name', 'Weapons programme'), h('button.btn.small', { class: me.nukeProgram.on ? 'danger' : '', onclick: async () => {
          if (!me.nukeProgram.on && !(await confirmBox('Start a nuclear weapons programme?', 'Enriching uranium to weapons grade will be detected. World standing will fall and sanctions are likely. It needs a uranium supply and takes years.', { ok: 'Start enrichment', danger: true }))) return;
          ctx.send({ type: 'nukeProgram', on: !me.nukeProgram.on });
        } }, me.nukeProgram.on ? 'Stop' : 'Start')), h('div.meta', me.nukeProgram.on ? `Progress ${Math.round(me.nukeProgram.progress * 100)}%` : 'No nuclear weapons.'))),
  );
}

/* ---------- Air and sea ---------- */

function ops(ctx) {
  const s = ctx.state;
  const me = s.you;
  const enemies = s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a));
  const freeAir = me.aircraft - me.airOps.reduce((t, o) => t + o.aircraft, 0);
  const freeShips = me.ships - Object.values(me.blockades).reduce((t, v) => t + v, 0);
  return h('div',
    !enemies.length ? h('div.warning.info', 'You are at peace. Air campaigns, blockades and missile strikes need a war.') : null,
    h('div.section', h('h3', 'Air campaigns'),
      h('div.list', me.airOps.length ? me.airOps.map((o) => h('div.item', h('div.item-head', h('span.name', regionName(o.region)), h('span.mono.small', `${o.aircraft} aircraft`)),
        h('div.actions', h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'air', region: o.region, aircraft: 0 }) }, 'Call off')))) : [h('div.empty', 'None. Bombing wrecks industry, oil fields and mines in a province.')]),
      h('button.btn.small', { style: { marginTop: '8px' }, disabled: !enemies.length || freeAir < 1, onclick: () => airCampaign(ctx) }, `New air campaign (${num(freeAir)} free)`)),
    h('div.section', h('h3', 'Naval blockades'),
      h('div.list', Object.entries(me.blockades).length ? Object.entries(me.blockades).map(([t, ships]) => h('div.item', h('div.item-head', flag(t), h('span.name', nationName(s, t)), h('span.mono.small', `${ships} ships`)),
        h('div.meta', `Cutting ${s.countries[t]?.blockaded ?? 0}% of their sea trade`),
        h('div.actions', h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'blockade', target: t, ships: 0 }) }, 'Lift')))) : [h('div.empty', 'None. A blockade chokes an enemy\'s imports and exports by sea.')]),
      h('button.btn.small', { style: { marginTop: '8px' }, disabled: !enemies.length || freeShips < 1, onclick: () => blockade(ctx, enemies) }, `New blockade (${num(freeShips)} ships free)`)),
    h('div.section', h('h3', 'Missile strikes'),
      h('p.muted.small', `${num(me.missiles)} missiles. Target an enemy province's oil fields, factories or troops. Air defences intercept some.`),
      h('button.btn.small', { style: { marginTop: '8px' }, disabled: !enemies.length || me.missiles < 1, onclick: () => ctx.strikeTarget('missile') }, 'Pick a target…')),
  );
}

function airCampaign(ctx) {
  ctx.strikeTarget('air');
}

function blockade(ctx, enemies) {
  const s = ctx.state;
  const sel = selectField('Enemy', enemies.filter((e) => s.countries[e]).map((e) => [e, nationName(s, e)]));
  const free = s.you.ships - Object.values(s.you.blockades).reduce((t, v) => t + v, 0);
  const f = numberField('Warships', { value: Math.floor(free * 0.5), min: 1, max: free, step: 1 });
  modal({
    title: 'Naval blockade',
    body: h('div.stack', sel.el, f.el, h('p.muted.small', 'Both fleets take losses each week. A stronger navy blockades more effectively.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Blockade', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'blockade', target: sel.input.value, ships: Number(f.input.value) })) || false }],
  });
}

/* ---------- Production ---------- */

function build(ctx) {
  const s = ctx.state;
  const me = s.you;
  const cf = costFactorOf(me);
  const limit = 3 + Math.floor(me.gdp / 800);
  return h('div.section', h('h3', 'Production'),
    h('p.muted.small', `Paid from defence funds (${money(me.milFunds)}), then reserves (${money(me.treasury)}). Your industry can run ${limit} orders at once. Shortages of the listed resources slow production. New weapons are built in secret: only spies inside your government see them.`),
    h('div.list', { style: { marginTop: '10px' } }, Object.entries(BUILD).map(([kind, b]) => {
      const locked = (kind === 'nukes' && me.nukes <= 0) || (b.tech && me.tech[b.tech[0]] < b.tech[1]);
      return h('div.item',
        h('div.item-head', h('span.name', b.name), h('span.mono.small', money(b.cost * cf))),
        h('div.meta', `${b.batch} ${b.unit} per order · ${b.weeks} weeks${b.needs.length ? ` · needs ${b.needs.join(', ')}` : ''}${locked ? (kind === 'nukes' ? ' · needs a nuclear weapon first' : ` · needs ${b.tech[0]} level ${b.tech[1]}`) : ''}`),
        h('div.actions', [1, 5].map((n) => h('button.btn.small', { disabled: locked, onclick: () => ctx.send({ type: 'build', kind, batches: n }) }, `Order ${n}`))));
    })),
    h('div.section', h('h3', `Queue (${me.queue.length}/${limit})`),
      h('div.list', me.queue.length ? me.queue.map((o) => h('div.item',
        h('div.item-head', h('span.name', `${o.qty} ${BUILD[o.kind].unit}`), h('span.muted.small', `${Math.ceil(o.left)} wk`)),
        h('div', { style: { marginTop: '6px' } }, bar(o.total - o.left, o.total)),
        h('div.actions', h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'cancelBuild', id: o.id }) }, 'Cancel')))) : [h('div.empty', 'Nothing on order.')])));
}

function costFactorOf(c) {
  return 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);
}

/* ---------- Wars ---------- */

function wars(ctx) {
  const s = ctx.state;
  const mine = s.wars.filter((w) => w.a === s.me || w.b === s.me);
  return h('div',
    h('div.list', mine.length ? mine.map((w) => {
      const foe = w.a === s.me ? w.b : w.a;
      const ourLoss = w.a === s.me ? w.lossA : w.lossB;
      const theirLoss = w.a === s.me ? w.lossB : w.lossA;
      const held = Object.values(s.regions).filter((r) => r[0] === foe && r[1] === s.me).length;
      const lost = Object.values(s.regions).filter((r) => r[0] === s.me && r[1] === foe).length;
      return h('div.item',
        h('div.item-head', flag(foe), h('span.name', nationName(s, foe)), h('span.chip.bad', `${s.week - w.since} wk`)),
        h('div.meta', `${w.a === s.me ? 'We declared war' : 'They declared war'} · our losses ${troops(ourLoss)}, theirs ${troops(theirLoss)}`),
        h('div.meta', `We hold ${held} of their provinces; they hold ${lost} of ours.`),
        h('div.actions',
          s.countries[foe] ? h('button.btn.small.primary', { onclick: () => peaceDialog(ctx, foe) }, 'Offer peace…') : h('span.muted.small', 'Minor nations surrender when all their land is taken.'),
          h('button.btn.small.ghost', { onclick: () => ctx.focusCountry(foe) }, 'Show on map')));
    }) : [h('div.empty', 'We are at peace.')]),
    otherWars(ctx));
}

function otherWars(ctx) {
  const s = ctx.state;
  const others = s.wars.filter((w) => w.a !== s.me && w.b !== s.me);
  return h('div.section', h('h3', 'Wars around the world'),
    others.length
      ? h('div.list', others.map((w) => h('div.item.clickable', { onclick: () => ctx.focusCountry(w.b) },
        h('div.item-head', flag(w.a), h('span.name', `${nationName(s, w.a)} vs ${nationName(s, w.b)}`), h('span.muted.small', `${s.week - w.since} wk`)))))
      : h('div.empty', 'No other wars.'));
}
