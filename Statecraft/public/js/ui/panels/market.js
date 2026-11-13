// The market: world prices, buying from a chosen country (or around sanctions), selling, the cargoes at sea and
// on the road, and the straits they pass through.

import { h, flag, money, nationName, spark, RES_COLORS, RES_LETTERS, num } from '../dom.js';
import { RESOURCES, RESOURCE_INFO } from '../../engine/data/regions.js';
import { CHOKEPOINTS } from '../../engine/data/world.js';
import { fmtQty, TOLLS, STRAIT_POLICIES, PATROL_MODES } from '../../engine/trade.js';
import { modal, numberField, confirmBox } from '../dialogs.js';

export function market(ctx) {
  const tab = ctx.sub('market', 'buy');
  const s = ctx.state;
  const mine = (s.shipments ?? []).filter((x) => x.buyer === s.me || x.seller === s.me).length;
  const tabs = [['buy', 'Buy'], ['sell', 'Sell'], ['ships', `Shipping${mine ? ` (${mine})` : ''}`], ['straits', 'Straits'], ['prices', 'Prices']];
  return h('div',
    h('div.panel-title', h('h2', 'Market'), h('span.muted.small', `${money(s.you.treasury)} in reserves`)),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('market', id) }, label))),
    { buy, sell, ships, straits, prices }[tab](ctx));
}

const resDot = (r) => h('span.res-dot', { style: { background: RES_COLORS[r], display: 'inline-grid', width: '16px', height: '16px', marginRight: '6px', verticalAlign: 'middle' } }, RES_LETTERS[r]);
const weeksOf = (me, r, qty) => ((me.demand[r] ?? 0) > 0 ? qty / me.demand[r] : null);

function routeText(s, route) {
  if (!route) return 'no route open';
  if (route.mode === 'land') return `overland${route.transit?.length ? ` via ${route.transit.slice(0, 3).map((t) => nationName(s, t)).join(', ')}` : ''} · ${route.weeks} wk`;
  return `by sea${route.straits?.length ? ` via ${route.straits.map((k) => CHOKEPOINTS[k]?.name.replace(/^(Strait of |The )/, '')).join(', ')}` : ''} · ${route.weeks} wk`;
}

/* ---------- Buy ---------- */

function buy(ctx) {
  const s = ctx.state;
  const me = s.you;
  const r = ctx.ui.marketRes ?? RESOURCES.find((x) => (me.short[x] ?? 0) > 0.02) ?? 'oil';
  const info = RESOURCE_INFO[r];
  const dem = me.demand[r] ?? 0;
  const weeks = dem > 0 ? (me.stock[r] ?? 0) / dem : null;
  const list = s.market.sellers?.[r] ?? [];
  return h('div',
    h('div.row.wrap.gap', RESOURCES.map((x) => h('button.btn.small', { class: x === r ? 'primary' : (me.short[x] ?? 0) > 0.02 ? 'danger' : '', onclick: () => { ctx.ui.marketRes = x; ctx.rerender(); } }, RES_LETTERS[x], ' ', RESOURCE_INFO[x].name))),
    h('div.kpis', { style: { marginTop: '12px' } },
      h('div.kpi', h('span', 'We produce'), h('b', fmt(me.prod[r])), h('small', `${info.unit} a year`)),
      h('div.kpi', h('span', 'We need'), h('b', fmt(dem)), h('small', `${info.unit} a year`)),
      h('div.kpi', h('span', 'Reserves'), h('b', { class: (me.short[r] ?? 0) > 0.02 ? 'bad' : weeks != null && weeks < 4 ? 'warn' : '' }, (me.short[r] ?? 0) > 0.02 ? `short ${Math.round(me.short[r] * 100)}%` : weeks == null ? '—' : `${weeks.toFixed(0)} wk`), h('small', `price ${Math.round(s.market.price[r] * 100)}`))),
    h('p.muted.small', { style: { marginTop: '10px' } }, 'Pick who to buy from. You pay now; the money is held until the cargo arrives and refunded if someone stops it on the way. Sanctions close the front door, but intermediaries will sell at a premium, with a risk the deal is exposed.'),
    h('div.list', { style: { marginTop: '10px' } }, list.length ? list.map((x) => sellerCard(ctx, r, x)) : [h('div.empty', 'Nobody has any to spare right now.')]));
}

function sellerCard(ctx, r, x) {
  const s = ctx.state;
  const me = s.you;
  const human = s.countries[x.id]?.human;
  const perWeek = (me.demand[r] ?? 0) * x.price;
  return h('div.item',
    h('div.item-head', flag(x.id), h('span.name', nationName(s, x.id)), human ? h('span.chip.accent', human) : null, x.covert ? h('span.chip.warn', 'Under sanctions') : null,
      h('span.mono.small', { style: { marginLeft: 'auto' } }, perWeek > 0 ? `${money(perWeek)}/wk of need` : `${money(x.price)}/unit`)),
    h('div.meta', `Can sell ${fmtQty(r, x.qty)}${weeksOf(me, r, x.qty) != null ? ` (${weeksOf(me, r, x.qty).toFixed(1)} weeks of our need)` : ''} · ${routeText(s, x.route)}`),
    x.covert ? h('div.meta.faint', 'Through shell companies and front firms: about 35% dearer, and the cargo can be exposed and seized.') : null,
    h('div.actions', h('button.btn.small.primary', { disabled: !x.route, onclick: () => buyDialog(ctx, r, x) }, x.covert ? 'Buy through intermediaries…' : 'Buy…')));
}

function buyDialog(ctx, r, x) {
  const s = ctx.state;
  const me = s.you;
  const info = RESOURCE_INFO[r];
  const dem = me.demand[r] ?? 0;
  const maxWeeks = dem > 0 ? Math.max(0.5, Math.floor((x.qty / dem) * 10) / 10) : null;
  const f = dem > 0
    ? numberField('Weeks of our need to buy', { value: Math.min(4, maxWeeks), min: 0.1, max: maxWeeks, step: 0.5 })
    : numberField(`Amount (stock units of ${info.unit}·week)`, { value: Math.min(x.qty, 1), min: 0.01, max: x.qty, step: 0.1 });
  const note = h('p.small');
  const qtyOf = () => Math.min(x.qty, dem > 0 ? Number(f.input.value) * dem : Number(f.input.value));
  const update = () => {
    const q = qtyOf();
    const cost = q * x.price;
    note.className = cost > me.treasury ? 'small bad' : 'small muted';
    note.textContent = `${fmtQty(r, q)} for ${money(cost)} (treasury ${money(me.treasury)}). Arrives ${routeText(s, x.route)}.`;
  };
  f.input.addEventListener('input', update);
  update();
  modal({
    title: `Buy ${info.name.toLowerCase()} from ${nationName(s, x.id)}`,
    body: h('div.stack', f.el, note, x.covert ? h('div.warning', 'This goes around sanctions. If it is exposed, the cargo is seized and the world will know.') : null),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: x.covert ? 'Buy quietly' : 'Buy', kind: 'primary', onClick: async () => {
        const err = await ctx.send({ type: 'marketBuy', res: r, qty: qtyOf(), from: x.id, covert: x.covert });
        if (err) return false;
        ctx.toast(`Ordered ${fmtQty(r, qtyOf())} of ${info.name.toLowerCase()} from ${nationName(s, x.id)}. Track it under Shipping.`, 'good');
        return true;
      },
    }],
  });
}

/* ---------- Sell ---------- */

function sell(ctx) {
  const s = ctx.state;
  const me = s.you;
  const rows = RESOURCES.filter((r) => (me.stock[r] ?? 0) > 0.001).map((r) => {
    const dem = me.demand[r] ?? 0;
    const spare = Math.max(0, (me.stock[r] ?? 0) - dem * 6);
    const offer = me.offers?.[r];
    return h('div.item',
      h('div.item-head', resDot(r), h('span.name', RESOURCE_INFO[r].name), h('span.mono.small', `price ${Math.round(s.market.price[r] * 100)}`)),
      h('div.meta', `In reserve: ${fmtQty(r, me.stock[r])}${dem > 0 ? ` (${((me.stock[r] ?? 0) / dem).toFixed(0)} weeks of our need)` : ''}. Spare beyond six weeks: ${fmtQty(r, spare)}.`),
      offer ? h('div.meta', { style: { color: 'var(--ink)' } }, `Listed for other leaders: ${fmtQty(r, offer.qty)} at ${offer.markup >= 0 ? '+' : ''}${offer.markup}% on the world price.`) : null,
      h('div.actions',
        h('button.btn.small.primary', { disabled: spare <= 0, onclick: () => sellDialog(ctx, r, spare) }, 'Sell on the world market…'),
        h('button.btn.small', { onclick: () => offerDialog(ctx, r, spare, offer) }, offer ? 'Change listing…' : 'List for other leaders…'),
        offer ? h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'marketOffer', res: r, qty: 0 }) }, 'Withdraw') : null));
  });
  return h('div',
    h('p.muted.small', 'The world market buys at once, at 8% under the price. Listings let other leaders buy from you at your price; the cargo then ships to them and you are paid on delivery.'),
    h('div.list', { style: { marginTop: '10px' } }, rows.length ? rows : [h('div.empty', 'Nothing in reserve to sell.')]));
}

function sellDialog(ctx, r, spare) {
  const s = ctx.state;
  const info = RESOURCE_INFO[r];
  const f = numberField('Amount to sell (stock units)', { value: Math.round(spare * 50) / 100, min: 0.01, max: spare, step: 0.1 });
  const note = h('p.small.muted');
  const update = () => { note.textContent = `${fmtQty(r, Number(f.input.value))} for about ${money(Number(f.input.value) * (info.value / 52) * s.market.price[r] * 0.92)}.`; };
  f.input.addEventListener('input', update);
  update();
  modal({
    title: `Sell ${info.name.toLowerCase()}`,
    body: h('div.stack', f.el, note),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Sell', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'marketSell', res: r, qty: Number(f.input.value) })) || false }],
  });
}

function offerDialog(ctx, r, spare, offer) {
  const info = RESOURCE_INFO[r];
  const f = numberField('Amount on offer (stock units)', { value: offer?.qty ?? Math.round(spare * 100) / 100, min: 0, step: 0.1 });
  const m = numberField('Your price, over (+) or under (−) the world price', { value: offer?.markup ?? 5, min: -20, max: 200, step: 1, suffix: '%' });
  modal({
    title: `List ${info.name.toLowerCase()} for other leaders`,
    body: h('div.stack', f.el, m.el, h('p.muted.small', 'Other leaders see your listing in their Buy tab. Computer-run countries buy on the world market instead.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'List it', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'marketOffer', res: r, qty: Number(f.input.value), markup: Number(m.input.value) })) || false }],
  });
}

/* ---------- Shipping ---------- */

function ships(ctx) {
  const s = ctx.state;
  const me = s.you;
  const all = s.shipments ?? [];
  const mine = all.filter((x) => x.buyer === s.me || x.seller === s.me);
  const allies = new Set(s.alliances.filter((a) => a.kind === 'military' && a.members.includes(s.me)).flatMap((a) => a.members));
  const others = all.filter((x) => x.buyer !== s.me && x.seller !== s.me);
  const enemies = new Set(s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a)));
  others.sort((a, b) => (enemies.has(b.buyer) || enemies.has(b.seller)) - (enemies.has(a.buyer) || enemies.has(a.seller)) || b.cost - a.cost);
  const card = (x, canStop) => h('div.item',
    h('div.item-head', resDot(x.res), h('span.name', `${nationName(s, x.seller)} → ${nationName(s, x.buyer)}`), x.covert ? h('span.chip.warn', 'covert') : null,
      enemies.has(x.buyer) || enemies.has(x.seller) ? h('span.chip.bad', 'enemy trade') : null, h('span.muted.small', { style: { marginLeft: 'auto' } }, `${x.left} wk left`)),
    h('div.meta', `${fmtQty(x.res, x.qty)} of ${RESOURCE_INFO[x.res].name.toLowerCase()} worth ${money(x.cost)} · ${x.mode === 'land' ? `overland${x.transit?.length ? ` through ${x.transit.map((t) => nationName(s, t)).join(', ')}` : ''}` : `by sea${x.straits?.length ? ` through the ${x.straits.map((k) => CHOKEPOINTS[k].name).join(', ')}` : ''}`}`),
    canStop ? h('div.actions',
      h('button.btn.small', { onclick: () => stop(ctx, x, 'seize') }, 'Seize it'),
      h('button.btn.small.danger', { onclick: () => stop(ctx, x, 'sink') }, x.mode === 'land' ? 'Destroy it' : 'Sink it')) : null);
  return h('div',
    h('div.section', h('h3', 'Our cargoes'), mine.length ? h('div.list', mine.map((x) => card(x, false))) : h('div.empty', 'Nothing in transit. Buy something under Buy.')),
    h('div.section', h('h3', 'Shipping lanes'),
      h('p.muted.small', `Cargoes our intelligence can see. Stopping one takes warships within reach of its route (yours: ${num(me.ships)} warships${me.carriers ? `, ${me.carriers} carriers` : ''}), or control of the land it crosses. In peacetime it is piracy: both countries will be furious.`),
      others.length ? h('div.list', { style: { marginTop: '8px' } }, others.slice(0, 40).map((x) => card(x, !allies.has(x.buyer) && !allies.has(x.seller) && (x.mode === 'land' ? x.transit?.includes(s.me) : me.ships >= 3)))) : h('div.empty', 'No cargoes in sight.')));
}

async function stop(ctx, x, how) {
  const s = ctx.state;
  const atWar = s.wars.some((w) => [w.a, w.b].includes(s.me) && [w.a, w.b].some((n) => n === x.buyer || n === x.seller));
  if (!atWar && !(await confirmBox('Stop a cargo in peacetime?', `We are not at war with ${nationName(s, x.seller)} or ${nationName(s, x.buyer)}. Both will be told it was us, and the world will call it piracy.`, { ok: how === 'sink' ? 'Sink it' : 'Seize it', danger: true }))) return;
  const err = await ctx.send({ type: 'intercept', id: x.id, how });
  if (!err) ctx.toast('Orders sent. The navy will try to stop it this week.', 'info');
}

/* ---------- Straits ---------- */

function straits(ctx) {
  const s = ctx.state;
  const me = s.you;
  const busy = Object.values(me.blockades).reduce((t, v) => t + v, 0) + Object.values(s.chokepoints).reduce((t, st) => t + (st.patrols?.[s.me]?.ships ?? 0), 0);
  return h('div',
    h('p.muted.small', 'Most of the world\'s trade squeezes through a few straits. Hold a shore and you can close it, charge a toll, or attack enemy cargoes; any navy that can reach one can patrol it, to escort friendly ships or stop others. A toll or a closure lasts until its holder lifts it or loses the shore.'),
    h('p.small', { style: { marginTop: '6px' } }, `Our warships: ${num(me.ships)} (${num(Math.max(0, me.ships - busy))} free). Tolls collected: ${money(me.tollIncome ?? 0)}; paid: ${money(me.tollsPaid ?? 0)}.`),
    h('div.list', { style: { marginTop: '10px' } }, Object.entries(CHOKEPOINTS).map(([key, cp]) => straitCard(ctx, key, cp, Math.max(0, me.ships - busy)))));
}

function straitCard(ctx, key, cp, freeShips) {
  const s = ctx.state;
  const st = s.chokepoints[key] ?? {};
  const holders = [...new Set(cp.regions.map((r) => s.regions[ctx.regionIndex[r]]?.[1]).filter(Boolean))];
  const mine = holders.includes(s.me);
  const patrols = Object.entries(st.patrols ?? {});
  const myPatrol = st.patrols?.[s.me];
  const status = st.closedBy ? h('span.chip.bad', `Closed by ${nationName(s, st.closedBy)}`)
    : patrols.some(([, p]) => p.mode === 'all') ? h('span.chip.bad', 'Blockaded')
      : st.toll ? h('span.chip.warn', `${st.toll.rate}% toll`) : h('span.chip.good', 'Open');
  return h('div.item',
    h('div.item-head', h('span.name', cp.name), status),
    h('div.meta', cp.note),
    h('div.meta', `Shores held by ${holders.map((x) => nationName(s, x)).join(', ')}${st.toll ? ` · ${nationName(s, st.toll.by)} charges ${st.toll.rate}%` : ''}${st.policy ? ` · ${nationName(s, st.policy.by)}: ${STRAIT_POLICIES[st.policy.kind].toLowerCase()}` : ''}`),
    patrols.length ? h('div.meta', 'Navies on patrol: ', patrols.map(([o, p]) => `${nationName(s, o)} ${p.ships} ships (${PATROL_MODES[p.mode].toLowerCase()})`).join('; ')) : null,
    mine ? h('div', { style: { marginTop: '8px' } },
      h('div.row.gap.small', h('span', 'Toll'), h('div.seg.grow', TOLLS.map((t) => h('button', { 'aria-pressed': String((st.toll?.by === s.me ? st.toll.rate : 0) === t), onclick: () => ctx.send({ type: 'toll', key, rate: t }) }, `${t}%`)))),
      h('div.row.gap.small', { style: { marginTop: '6px' } }, h('span', 'Enemy ships'), h('div.seg.grow', Object.entries(STRAIT_POLICIES).map(([k, label]) => h('button', { 'aria-pressed': String((st.policy?.by === s.me ? st.policy.kind : 'pass') === k), onclick: () => ctx.send({ type: 'straitPolicy', key, policy: k }) }, label.split(' ')[0])))),
      h('div.actions', st.closedBy === s.me
        ? h('button.btn.small', { onclick: () => ctx.send({ type: 'strait', key, close: false }) }, 'Reopen')
        : st.closedBy ? null : h('button.btn.small.danger', { onclick: async () => { if (await confirmBox(`Close the ${cp.name}?`, `${cp.note} Prices will spike worldwide, trading partners will be furious and standing will fall.`, { ok: 'Close it', danger: true })) ctx.send({ type: 'strait', key, close: true }); } }, 'Close it'))) : null,
    h('div.actions',
      myPatrol ? h('button.btn.small.ghost', { onclick: () => ctx.send({ type: 'patrol', key, ships: 0 }) }, `Recall our ${myPatrol.ships} ships`) : null,
      h('button.btn.small', { disabled: freeShips < 1 && !myPatrol, onclick: () => patrolDialog(ctx, key, cp, freeShips + (myPatrol?.ships ?? 0), myPatrol) }, myPatrol ? 'Change patrol…' : 'Send a patrol…')));
}

function patrolDialog(ctx, key, cp, free, current) {
  let mode = current?.mode ?? 'escort';
  const f = numberField('Warships', { value: current?.ships ?? Math.min(free, 10), min: 1, max: free, step: 1 });
  const segEl = h('div.seg', Object.entries(PATROL_MODES).map(([k, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(k === mode), onclick: () => { mode = k; for (const x of segEl.children) x.setAttribute('aria-pressed', String(x === b)); } }, label);
    return b;
  }));
  modal({
    title: `Patrol the ${cp.name}`,
    body: h('div.stack', f.el, h('div.field', h('span', 'Orders'), segEl),
      h('p.muted.small', 'Escorts make friendly cargoes far harder to stop. Stopping enemies\' cargoes hurts their supply; stopping all traffic chokes the world\'s trade and makes enemies everywhere. A hostile shore will fire missiles at your ships.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Send them', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'patrol', key, ships: Number(f.input.value), mode })) || false }],
  });
}

/* ---------- Prices ---------- */

function prices(ctx) {
  const s = ctx.state;
  return h('div',
    h('p.muted.small', 'World prices, as an index where 2025 = 100. Shortages, wars, blockades, tolls and closed straits push them up. Click one to see where it is found.'),
    h('div.list', { style: { marginTop: '10px' } }, RESOURCES.map((r) => h('div.item.clickable', { onclick: () => ctx.mapMode('resources', r) },
      h('div.item-head', resDot(r), h('span.name', RESOURCE_INFO[r].name), h('span.mono', { class: s.market.price[r] > 1.3 ? 'bad' : s.market.price[r] < 0.8 ? 'good' : '' }, Math.round(s.market.price[r] * 100))),
      spark(s.market.history[r], RES_COLORS[r])))));
}

function fmt(v) {
  if (!v) return '0';
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  if (v >= 10) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}
