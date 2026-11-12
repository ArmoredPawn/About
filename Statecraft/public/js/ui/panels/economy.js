// The treasury and the economy: budget, central bank, resources, projects and trade.

import { h, flag, money, pct, nationName, regionName, spark, bar, RES_COLORS, RES_LETTERS } from '../dom.js';
import { RESOURCES, RESOURCE_INFO } from '../../engine/data/regions.js';
import { modal, numberField, confirmBox } from '../dialogs.js';

const SPEND = [
  ['defence', 'Defence', 'Upkeep of the armed forces; any surplus buys equipment.'],
  ['infra', 'Infrastructure', 'Roads, rail, ports and power: raises growth and repairs war damage.'],
  ['edu', 'Education', 'Raises growth and speeds research.'],
  ['health', 'Health', 'Popular, and keeps approval up.'],
  ['research', 'Research & development', 'Funds new technology.'],
  ['welfare', 'Welfare & pensions', 'Popular, but does little for growth.'],
];

export function economy(ctx) {
  const tab = ctx.sub('economy', 'budget');
  const tabs = [['budget', 'Budget'], ['resources', 'Resources'], ['projects', 'Projects'], ['trade', 'Trade']];
  return h('div',
    h('div.panel-title', h('h2', 'Economy'), h('span.muted.small', `${money(ctx.state.you.gdp)} GDP`)),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('economy', id) }, label))),
    { budget, resources, projects, trade }[tab](ctx));
}

/* ---------- Budget ---------- */

function budget(ctx) {
  const me = ctx.state.you;
  const draft = ctx.draft('policy', () => ({ tax: me.tax, rate: me.rate, spend: { ...me.spend } }));
  const preview = h('div.budget');
  const outputs = {};

  const refresh = () => {
    const y = me.gdp;
    const revenue = (y * draft.tax) / 100;
    const lines = SPEND.map(([k, label]) => [label, (y * draft.spend[k]) / 100]);
    const interest = me.interest ?? 0;
    const spending = lines.reduce((t, [, v]) => t + v, 0) + interest;
    const deficit = spending - revenue;
    preview.replaceChildren(
      h('span', 'Tax revenue'), h('span.num', money(revenue)),
      ...lines.flatMap(([label, v]) => [h('span.muted', label), h('span.num', `−${money(v)}`)]),
      h('span.muted', 'Interest on debt'), h('span.num', `−${money(interest)}`),
      h('span.total', deficit > 0 ? 'Deficit (borrowed)' : 'Surplus'), h('span.num.total', { class: deficit > y * 0.06 ? 'bad' : deficit < 0 ? 'good' : '' }, `${money(Math.abs(deficit))} · ${pct(Math.abs(deficit / y) * 100)} of GDP`),
    );
  };
  let timer = null;
  const commit = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const err = await ctx.send({ type: 'policy', tax: draft.tax, rate: draft.rate, spend: draft.spend });
      if (!err) ctx.clearDraft('policy');
    }, 250);
  };
  const slider = (label, value, { min, max, step, hint, base, onInput, unit = '%' }) => {
    const out = h('output', `${value}${unit}`);
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
    input.addEventListener('input', () => { onInput(Number(input.value)); out.textContent = `${input.value}${unit}`; refresh(); });
    input.addEventListener('change', commit);
    return h('div.slider', h('label', label), out, input, h('span.hint', hint, base != null ? ` Started at ${base}${unit}.` : ''));
  };

  refresh();
  return h('div',
    h('div.section',
      h('h3', 'Taxes'),
      slider('Tax revenue (% of GDP)', draft.tax, { min: 5, max: 70, step: 0.5, base: me.base.tax, hint: 'Higher taxes fund the budget but slow growth and cost approval.', onInput: (v) => { draft.tax = v; } })),
    h('div.section',
      h('h3', 'Spending (% of GDP)'),
      SPEND.map(([k, label, hint]) => slider(label, draft.spend[k], { min: 0, max: k === 'defence' ? 35 : 25, step: 0.1, base: me.base.spend[k], hint, onInput: (v) => { draft.spend[k] = v; } })),
      preview),
    h('div.section',
      h('h3', 'Central bank'),
      slider('Policy interest rate', draft.rate, { min: 0, max: Math.max(30, Math.ceil(me.base.rate * 1.6)), step: 0.25, base: me.base.rate, hint: `Inflation is ${pct(me.infl)}. Higher rates cool prices but slow growth.`, onInput: (v) => { draft.rate = v; } }),
      h('div.row.between.small', { style: { marginTop: '8px' } }, h('span.muted', `Average cost of government debt: ${me.bond.toFixed(1)}%`), h('span.muted', `Debt ${money(me.debt)}`))),
    h('div.section',
      h('h3', 'Measures'),
      h('div.list',
        action('Stimulus package', me.stimulus && me.stimulus.until > ctx.state.week ? `Running until week ${me.stimulus.until}` : 'Borrow to boost growth for six months. Adds to inflation.', 'Launch…', () => stimulus(ctx)),
        action('Pay down debt', `Use reserves (${money(me.treasury)}) to repay some of the ${money(me.debt)} debt.`, 'Repay…', () => repay(ctx)),
        toggle(ctx, 'Rationing', 'Cuts oil, gas and food use by 15%, at a cost in approval.', me.ration, (on) => ({ type: 'ration', on })),
      ),
      h('p.muted.small', { style: { marginTop: '8px' } }, 'Cutting schools, hospitals or pensions below their 2025 level brings the people affected onto the streets. Martial law, campaigns and elections are under Government.')),
  );
}

function action(title, text, label, onClick, disabledNote) {
  return h('div.item', h('div.item-head', h('span.name', title), h('button.btn.small', { disabled: Boolean(disabledNote), onclick: onClick }, disabledNote ?? label)), h('div.meta', text));
}

function toggle(ctx, title, text, on, cmd, danger = false) {
  return h('div.item', h('div.item-head', h('span.name', title), h('button.btn.small', { class: on ? (danger ? 'danger' : 'primary') : '', onclick: () => ctx.send(cmd(!on)) }, on ? 'On' : 'Off')), h('div.meta', text));
}

function stimulus(ctx) {
  const me = ctx.state.you;
  const f = numberField('Amount', { value: Math.round(me.gdp * 0.02), min: 1, max: Math.floor(me.gdp * 0.1), suffix: '$ billions' });
  modal({
    title: 'Stimulus package',
    body: h('div.stack', h('p.muted', `Up to ${money(me.gdp * 0.1)} (10% of GDP). Paid from reserves first, then borrowed. Growth gets a boost for 26 weeks.`), f.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Launch', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'stimulus', amount: Number(f.input.value) })) || false }],
  });
}

function repay(ctx) {
  const me = ctx.state.you;
  const f = numberField('Amount', { value: Math.floor(me.treasury / 2), min: 1, max: Math.floor(me.treasury), suffix: '$ billions' });
  modal({
    title: 'Pay down debt',
    body: h('div.stack', h('p.muted', `Reserves: ${money(me.treasury)}. Debt: ${money(me.debt)}.`), f.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Repay', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'repay', amount: Number(f.input.value) })) || false }],
  });
}

/* ---------- Resources ---------- */

function resources(ctx) {
  const s = ctx.state;
  const me = s.you;
  const rows = RESOURCES.map((r) => {
    const info = RESOURCE_INFO[r];
    const prod = me.prod[r] ?? 0;
    const dem = me.demand[r] ?? 0;
    const weeks = dem > 0 ? (me.stock[r] ?? 0) / dem : null;
    const short = me.short[r] ?? 0;
    const price = s.market.price[r];
    return h('tr.clickable', { onclick: () => ctx.mapMode('resources', r), title: `Show ${info.name.toLowerCase()} on the map` },
      h('td', h('span.res-dot', { style: { background: RES_COLORS[r], display: 'inline-grid', width: '16px', height: '16px', marginRight: '6px', verticalAlign: 'middle' } }, RES_LETTERS[r]), info.name, h('div.tiny.faint', info.unit)),
      h('td.num', fmt(prod)), h('td.num', fmt(dem)),
      h('td.num', { class: short > 0.02 ? 'bad' : weeks != null && weeks < 4 ? 'warn' : '' }, short > 0.02 ? `short ${Math.round(short * 100)}%` : weeks == null ? '—' : `${weeks.toFixed(0)} wk`),
      h('td.num', { class: price > 1.3 ? 'bad' : price < 0.8 ? 'good' : '' }, `${Math.round(price * 100)}`));
  });
  return h('div',
    h('p.muted.small', 'Yearly rates. Reserves are counted in weeks of demand. Prices are an index (2025 = 100). Click a row to see where the resource is on the map.'),
    h('table.tbl', { style: { marginTop: '10px' } }, h('thead', h('tr', h('th', 'Resource'), h('th.num', 'Output'), h('th.num', 'Need'), h('th.num', 'Reserves'), h('th.num', 'Price'))), h('tbody', rows)),
    h('div.section',
      h('h3', 'Buy or sell'),
      h('p.muted.small', 'Buy from the country of your choice, or sell your surplus, in the Market. Cargoes travel by sea or land and can be stopped on the way.'),
      h('div.row.wrap.gap', { style: { marginTop: '8px' } }, RESOURCES.filter((r) => (me.demand[r] ?? 0) > 0).map((r) => h('button.btn.small', { class: (me.short[r] ?? 0) > 0.02 ? 'danger' : '', onclick: () => { ctx.ui.marketRes = r; ctx.go('market', 'buy'); } }, RESOURCE_INFO[r].name)))),
    h('div.section',
      h('h3', 'World prices (two years)'),
      h('div.list', ['oil', 'gas', 'food', 'chip', 'rare'].map((r) => h('div', h('div.row.between.small', h('span', RESOURCE_INFO[r].name), h('span.mono', `${Math.round(s.market.price[r] * 100)}`)), spark(s.market.history[r], RES_COLORS[r]))))),
  );
}

function fmt(v) {
  if (!v) return '0';
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  if (v >= 10) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/* ---------- Projects ---------- */

function projects(ctx) {
  const me = ctx.state.you;
  const label = (p) => p.kind === 'develop' ? `Develop ${RESOURCE_INFO[p.res].name.toLowerCase()}` : p.kind === 'infra' ? 'Infrastructure' : 'Fortifications';
  return h('div',
    h('p.muted.small', 'Click any of your provinces on the map to develop untapped resources, build infrastructure or fortify it.'),
    h('div.list', { style: { marginTop: '10px' } }, me.projects.length ? me.projects.map((p) => h('div.item.clickable', { onclick: () => ctx.openRegion(p.region, true) },
      h('div.item-head', h('span.name', label(p)), h('span.muted.small', `${Math.ceil(p.left)} wk left`)),
      h('div.meta', regionName(p.region)),
      h('div', { style: { marginTop: '6px' } }, bar(p.total - p.left, p.total)),
      h('div.actions', h('button.btn.small.ghost', { onclick: (e) => { e.stopPropagation(); ctx.send({ type: 'cancelProject', id: p.id }); } }, 'Cancel (half refunded)')))) : [h('div.empty', 'No projects under way.')]),
    h('div.section', h('h3', 'Untapped resources at home'), untapped(ctx)));
}

function untapped(ctx) {
  const s = ctx.state;
  const list = [];
  for (const [id, res] of Object.entries(s.resources)) {
    const row = s.regions[ctx.regionIndex[id]];
    if (row[0] !== s.me || row[1] !== s.me) continue;
    for (const [r, [cur, pot]] of Object.entries(res)) if (pot > cur) list.push([id, r, cur, pot]);
  }
  if (!list.length) return h('div.empty', 'Every field and mine you hold is fully developed.');
  return h('div.list', list.map(([id, r, cur, pot]) => h('div.item.clickable', { onclick: () => ctx.openRegion(id, true) },
    h('div.item-head', h('span.res-dot', { style: { background: RES_COLORS[r] } }, RES_LETTERS[r]), h('span.name', regionName(id))),
    h('div.meta', `${RESOURCE_INFO[r].name}: ${cur} → ${pot} ${RESOURCE_INFO[r].unit}`))));
}

/* ---------- Trade ---------- */

function trade(ctx) {
  const s = ctx.state;
  const me = s.me;
  const ftas = s.treaties.filter((t) => t.kind === 'fta' && (t.a === me || t.b === me)).map((t) => (t.a === me ? t.b : t.a));
  const blocs = s.alliances.filter((a) => a.kind === 'economic' && a.members.includes(me));
  const deals = s.treaties.filter((t) => (t.kind === 'deal' || t.kind === 'loan' || t.kind === 'reparations') && (t.a === me || t.b === me));
  const sanctionsOnMe = s.sanctions.filter((k) => k.endsWith(`>${me}`)).map((k) => k.split('>')[0]);
  const mySanctions = s.sanctions.filter((k) => k.startsWith(`${me}>`)).map((k) => k.split('>')[1]);
  const tariffs = Object.entries(s.tariffs).filter(([k]) => k.startsWith(`${me}>`) || k.endsWith(`>${me}`));
  const flagList = (ids) => ids.length ? h('div.row.wrap.gap', ids.map((id) => h('span.chip', { style: { cursor: 'pointer' }, onclick: () => ctx.openCountry(id) }, flag(id), nationName(s, id)))) : h('div.empty', 'None.');
  return h('div',
    h('div.section', h('h3', 'Trade blocs'), blocs.length ? h('div.list', blocs.map((b) => h('div.item', h('div.item-head', h('span.name', b.name), h('span.muted.small', `${b.members.length} members`))))) : h('div.empty', 'Not in a trade bloc. Create one from Diplomacy.')),
    h('div.section', h('h3', 'Free trade agreements'), flagList(ftas)),
    h('div.section', h('h3', 'Deals, loans and reparations'), deals.length ? h('div.list', deals.map((t) => h('div.item', h('div.meta', { style: { color: 'var(--ink)' } }, dealText(s, t)), h('div.meta', `until week ${t.until}`)))) : h('div.empty', 'None. Propose resource deals and loans from a country\'s page in Diplomacy.')),
    h('div.section', h('h3', 'Tariffs'), tariffs.length ? h('div.list', tariffs.map(([k, v]) => { const [a, b] = k.split('>'); return h('div.item', h('div.meta', { style: { color: 'var(--ink)' } }, `${nationName(s, a)} charges ${v}% on goods from ${nationName(s, b)}`)); })) : h('div.empty', 'No tariffs.')),
    h('div.section', h('h3', 'Sanctions against us'), flagList(sanctionsOnMe)),
    h('div.section', h('h3', 'Our sanctions'), flagList(mySanctions)),
  );
}

function dealText(s, t) {
  if (t.kind === 'deal') return `${nationName(s, t.a)} → ${nationName(s, t.b)}: ${t.qty} ${RESOURCE_INFO[t.res].unit} of ${RESOURCE_INFO[t.res].name.toLowerCase()} a year for ${money(t.price)} a year`;
  if (t.kind === 'loan') return `${nationName(s, t.b)} repays ${nationName(s, t.a)} ${money(t.payment * 52)} a year`;
  return `${nationName(s, t.a)} pays ${nationName(s, t.b)} reparations of ${money(t.payment * 52)} a year`;
}
