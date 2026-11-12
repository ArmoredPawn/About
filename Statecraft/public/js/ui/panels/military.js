// The war room: forces, army groups and their operations, air and sea campaigns, production and wars.

import { h, flag, money, nationName, regionName, troops, bar, num } from '../dom.js';
import { BUILD } from '../../engine/economy.js';
import { TRAITS, AGGRESSION } from '../../engine/military.js';
import { GEO } from '../../engine/data/geo.js';
import { modal, numberField, selectField, confirmBox } from '../dialogs.js';
import { peaceDialog } from './diplomacy.js';

export function military(ctx) {
  const tab = ctx.sub('military', 'armies');
  const tabs = [['armies', 'Army groups'], ['forces', 'Forces'], ['ops', 'Air & sea'], ['build', 'Production'], ['wars', 'Wars']];
  return h('div',
    h('div.panel-title', h('h2', 'Military'), h('span.muted.small', `${money(ctx.state.you.milFunds)} defence funds`)),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('military', id) }, label))),
    { armies, forces, ops, build, wars }[tab](ctx));
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
    h('div.item', h('div.item-head', h('span.name', 'Forces at home'), h('button.btn.small.primary', { onclick: () => formArmy(ctx) }, '＋ Form army group')),
      h('div.meta', `${troops(free.troops)} troops and ${num(free.tanks)} tanks garrison your provinces. Army groups are what you send on operations.`)),
    h('div.list', { style: { marginTop: '10px' } }, list.length ? list.map((a) => armyCard(ctx, a)) : [h('div.empty', 'No army groups yet. Form one, then give it an operation: your general handles the rest.')]));
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
    h('div.meta', { style: { color: 'var(--ink)' } }, a.status, a.op ? h('span.faint', ` · ${AGGRESSION[a.op.aggr]?.name ?? ''}`) : null),
    a.sea ? null : h('div.actions', { onclick: (e) => e.stopPropagation() },
      h('button.btn.small.primary', { onclick: () => ctx.orderArmy(a, 'attack') }, 'Attack…'),
      h('button.btn.small', { onclick: () => ctx.orderArmy(a, 'hold') }, 'Hold / move…'),
      GEO[a.region]?.coast ? h('button.btn.small', { onclick: () => ctx.orderArmy(a, 'invade') }, 'Land…') : null,
      h('button.btn.small.ghost', { onclick: () => reinforce(ctx, a) }, 'Reinforce'),
      others.length ? h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'armyMerge', ids: [a.id, ...others.map((o) => o.id)] }) }, 'Merge here') : null,
      h('button.btn.small.ghost', { onclick: () => rename(ctx, a) }, 'Rename'),
      h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Disband ${a.name}?`, 'Its troops return to the home garrisons.')) ctx.send({ type: 'armyDisband', id: a.id }); } }, 'Disband')));
}

export function formArmy(ctx, region) {
  const s = ctx.state;
  const open = (regionId) => {
    const free = freeForces(s);
    const name = h('input', { maxlength: 28, placeholder: 'e.g. Army Group South' });
    const t = numberField('Troops', { value: Math.min(Math.floor(free.troops * 0.3), 300), min: 5, max: Math.floor(free.troops), step: 1, suffix: 'thousands' });
    const k = numberField('Tanks', { value: Math.floor(free.tanks * 0.3), min: 0, max: Math.floor(free.tanks), step: 10 });
    modal({
      title: `Form an army group in ${regionName(regionId)}`,
      body: h('div.stack', h('p.muted.small', `Available: ${troops(free.troops)} troops and ${num(free.tanks)} tanks. A general is appointed automatically.`), h('label.field', h('span', 'Name (optional)'), name), t.el, k.el),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Form', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'armyCreate', region: regionId, troops: Number(t.input.value), tanks: Number(k.input.value), name: name.value })) || false }],
    });
  };
  if (region) return open(region);
  ctx.target({
    text: 'Pick one of your provinces to form the army group in',
    filter: (id) => s.regions[ctx.regionIndex[id]][1] === s.me,
    onPick: (id) => { ctx.endTarget(); open(id); },
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
    h('div.section', h('h3', 'Mobilisation'),
      h('div.seg', [['Peacetime', 0], ['Partial', 1], ['Full', 2]].map(([label, lvl]) => h('button', { 'aria-pressed': String(me.mob === lvl), onclick: () => ctx.send({ type: 'mobilize', level: lvl }) }, label))),
      h('p.muted.small', { style: { marginTop: '6px' } }, `Partial calls up 30% of reserves, full 80%. Both slow the economy and cost approval. Reserves left: ${troops(me.reserves)}.`)),
    h('div.section', h('h3', 'Order of battle'),
      h('table.tbl', h('tbody',
        row('Active troops', troops(me.troops), `${troops(free.troops)} at home`),
        row('Tanks', num(me.tanks), `${num(free.tanks)} at home`),
        row('Combat aircraft', num(me.aircraft), `${num(me.airOps.reduce((t, o) => t + o.aircraft, 0))} on campaigns`),
        row('Warships & submarines', num(me.ships), `${num(Object.values(me.blockades).reduce((t, v) => t + v, 0))} blockading`),
        row('Aircraft carriers', num(me.carriers), me.carriers ? 'unlimited naval reach' : 'landings limited by range'),
        row('Missiles', num(me.missiles)),
        row('Nuclear warheads', num(me.nukes), me.nukeProgram.on ? `weapons programme ${Math.round(me.nukeProgram.progress * 100)}%` : ''),
        row('Losses so far', troops(me.losses))))),
    h('div.section', h('h3', 'Budget'),
      h('div.budget',
        h('span', 'Defence budget'), h('span.num', `${money((me.gdp * me.spend.defence) / 100)}/yr`),
        h('span', 'Upkeep of forces'), h('span.num', `−${money(me.upkeep ?? 0)}/yr`),
        h('span.total', 'Defence funds now'), h('span.num.total', money(me.milFunds))),
      h('p.muted.small', { style: { marginTop: '6px' } }, 'Raise defence spending in Economy to afford more.')),
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
  return h('div',
    h('p.muted.small', `Paid from defence funds (${money(me.milFunds)}), then reserves (${money(me.treasury)}). Your industry can run ${limit} orders at once. Shortages of the listed resources slow production.`),
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
