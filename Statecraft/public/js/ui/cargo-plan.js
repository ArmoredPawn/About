// Planning the route a resource deal's convoys take. The seller clicks up to ten checkpoints on the map, between
// its port (or, overland, its province nearest the buyer) and the buyer's: the ships or trucks go straight from one
// to the next. A leg that crosses land (by sea) or the sea (overland) shows red. "Shortest route" lets the
// computer place them. Finishing shows what shipping will cost, to confirm or go back.

import { h, money, nationName, regionName } from './dom.js';
import { buildPath, pathProblem, pathFacts, shippingCost, autoPath, MAX_CHECKPOINTS, CONVOY_WEEKS } from '../engine/cargo.js';
import { RESOURCE_INFO } from '../engine/data/regions.js';
import { nodeName } from '../engine/navy.js';
import { fauxState } from './map.js';
import { modal } from './dialogs.js';

export function planRoute(ctx, dealId) {
  const s = ctx.state;
  const t = (s.treaties ?? []).find((x) => x.id === dealId && x.kind === 'deal');
  if (!t) return ctx.hint('That deal has ended.', 'bad', 5000);
  if (t.a !== s.me) return ctx.hint('Only the seller plans the route.', 'bad', 5000);
  const ends = t.ends;
  if (!ends) return ctx.hint(`There is no way to ${nationName(s, t.b)}: no port, or no shared border.`, 'bad', 6000);
  const sea = ends.mode === 'sea';
  const what = RESOURCE_INFO[t.res].name.toLowerCase();
  // Start from the route already planned, if any
  let checks = t.route ? t.route.pts.slice(1, -1).map(([x, y]) => [((x % 2000) + 2000) % 2000, y]) : [];
  let auto = Boolean(t.route?.auto && checks.length > MAX_CHECKPOINTS);
  const world = () => ({ ...fauxState(ctx.state), market: ctx.state.market });

  const status = h('span.route-status');
  const count = h('b');
  const bar = h('span.row.gap.small', { style: { alignItems: 'center', flexWrap: 'wrap' } },
    h('button.btn.small', { onclick: () => { checks.pop(); auto = false; redraw(); } }, 'Undo'),
    h('button.btn.small', { onclick: () => { checks = []; auto = false; redraw(); } }, 'Clear'),
    h('button.btn.small', { title: 'Let the computer find the shortest way and place the checkpoints', onclick: () => {
      const pts = autoPath(world(), ends, t.a, t.b);
      if (!pts) return ctx.hint('No way joins the two ends.', 'bad', 5000);
      checks = pts.slice(1, -1).map(([x, y]) => [((x % 2000) + 2000) % 2000, y]);
      auto = checks.length > MAX_CHECKPOINTS;
      redraw(true);
    } }, 'Shortest route'),
    h('button.btn.small.primary', { onclick: () => finish() }, 'Finish…'));

  const evaluate = () => {
    const pts = buildPath(ends.a, checks, ends.b);
    const why = auto ? null : pathProblem(world(), ends.mode, pts, t.a, t.b);
    const bad = Number(/Leg (\d+)/.exec(why ?? '')?.[1] ?? 0);
    return { pts, why, bad };
  };
  const redraw = (fit = false) => {
    const { pts, why, bad } = evaluate();
    ctx.previewRoute({ pts, bad }, fit);
    count.textContent = `${checks.length}/${MAX_CHECKPOINTS}`;
    status.replaceChildren(why ? h('span.bad', why) : h('span.faint', checks.length ? 'Every leg works.' : 'A straight line from A to B.'));
  };

  const add = (x, y) => {
    if (checks.length >= MAX_CHECKPOINTS && !auto) return ctx.hint(`A route has at most ${MAX_CHECKPOINTS} checkpoints. Undo one, or use the shortest route.`, 'bad', 5000);
    if (auto) { checks = []; auto = false; }
    checks.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    redraw();
  };

  const finish = () => {
    const { pts, why } = evaluate();
    if (why) return ctx.hint(why, 'bad', 7000);
    const w = world();
    const facts = pathFacts(w, ends.mode, pts, t.a, t.b);
    const qty = t.qty * CONVOY_WEEKS;
    const each = shippingCost(w, t.res, qty, facts.km, ends.mode);
    const convoys = Math.max(1, Math.ceil((t.until - s.week) / CONVOY_WEEKS));
    const income = (t.price / 52) * CONVOY_WEEKS;
    modal({
      title: 'The cost of shipping',
      body: h('div.stack',
        h('div.route-summary',
          h('div', h('span.faint.small', 'From'), h('b', regionName(ends.from))),
          h('div.route-arrow', '→'),
          h('div', h('span.faint.small', 'To'), h('b', regionName(ends.to)))),
        h('table.tbl', h('tbody',
          h('tr', h('td', 'Distance'), h('td.num', `${facts.km.toLocaleString('en')} km ${sea ? 'by sea' : 'overland'}`)),
          h('tr', h('td', 'Each voyage'), h('td.num', `about ${facts.weeks} week${facts.weeks === 1 ? '' : 's'}`)),
          sea && facts.straits.length ? h('tr', h('td', 'Through'), h('td.num', facts.straits.map(nodeName).join(', '))) : null,
          !sea && facts.transit.length ? h('tr', h('td', 'Across'), h('td.num', facts.transit.map((id) => nationName(s, id)).join(', '))) : null,
          h('tr', h('td', h('b', 'Shipping each convoy')), h('td.num', h('b', money(each)))),
          h('tr', h('td', 'Convoys left in the deal'), h('td.num', `${convoys} (one every ${CONVOY_WEEKS} weeks)`)),
          h('tr', h('td', 'Shipping over the whole deal'), h('td.num', `about ${money(each * convoys)}`)),
          h('tr', h('td', `${nationName(s, t.b)} pays us per convoy`), h('td.num', money(income))))),
        h('p.muted.small', `We pay for shipping as each convoy of ${what} sets off. ${t.secret && !t.exposed ? 'It is a secret deal: only spies inside either country, spy satellites, and warships that come very close will see the convoys.' : 'The route is on every map, so everyone can see where the convoys go.'}`)),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Continue with the shipment', kind: 'primary', onClick: async () => {
          const err = await ctx.send(auto ? { type: 'dealRoute', id: t.id, auto: true } : { type: 'dealRoute', id: t.id, checkpoints: checks });
          if (err) return false;
          ctx.endTarget();
          ctx.previewRoute(null);
          ctx.toast(`Route set: ${what} convoys to ${nationName(s, t.b)} will sail it.`, 'good');
          return true;
        } },
      ],
    });
  };

  ctx.target({
    keep: false,
    text: sea
      ? `Plan the ${what} convoys to ${nationName(s, t.b)}: click the sea to place checkpoints (`
      : `Plan the ${what} convoys to ${nationName(s, t.b)} overland: click the land to place checkpoints (`,
    extra: h('span.row.gap', { style: { alignItems: 'center', flexWrap: 'wrap' } }, count, ')', bar, status),
    onWater: (x, y) => (sea ? add(x, y) : ctx.hint('Trucks and trains can\'t cross the sea: place checkpoints on land.', 'bad', 5000)),
    onPoint: sea ? null : (x, y) => add(x, y),
    onPick: () => ctx.hint(sea ? 'Ships need checkpoints on the water.' : 'Click where the convoy should pass.', 'bad', 4000),
    onArmy: () => true,
    onFleet: () => true,
    onCancel: () => ctx.previewRoute(null),
  });
  redraw(true);
}
