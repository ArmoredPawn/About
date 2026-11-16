// Economy → Routes: shipping lines a leader opens between one of our ports and a port abroad, by placing two
// points on the map. Public lines are announced and lift trade; private ones are secret, but countries whose waters
// they cross are likely to notice, and can then stop their cargoes there.

import { h, flag, money, nationName, regionName, num } from '../dom.js';
import { modal, confirmBox } from '../dialogs.js';
import { portAt, routeShape, routeCost, routeUpkeep, MAX_ROUTES } from '../../engine/routes.js';
import { CHOKEPOINTS } from '../../engine/data/world.js';
import { fauxState } from '../map.js';

export function routesTab(ctx) {
  const s = ctx.state;
  const all = s.routes ?? [];
  const ours = all.filter((r) => r.by === s.me);
  const toUs = all.filter((r) => r.partner === s.me);
  const others = all.filter((r) => r.by !== s.me && r.partner !== s.me);
  return h('div',
    h('div.how-it-works',
      h('div', h('b', 'Open a shipping line')),
      h('ol',
        h('li', 'Press "Open a new line", then click one of our ports (a coastal province we hold, or the sea just off it).'),
        h('li', 'Click a port abroad. The line is drawn on the map with its cost and the waters it crosses.'),
        h('li', 'Choose public or private, and open it. Every cargo between us and that country then sails it, about a fifth faster.')),
      h('div', h('b', 'Public'), ': announced and on every map. The trade it carries lifts both economies.'),
      h('div', h('b', 'Private'), ': secret. Its ships are on no one else\'s map. But a country whose waters it crosses is far more likely to notice than anyone else (its spies in our country count four times over), and once it knows, its coastguard can board our cargoes there and its navy stops them more easily.')),
    h('div.actions', { style: { margin: '10px 0' } },
      h('button.btn.primary', { disabled: ours.length >= MAX_ROUTES, onclick: () => pickRoute(ctx) }, ours.length >= MAX_ROUTES ? `${MAX_ROUTES} lines open (the most we can run)` : '＋ Open a new line'),
      all.length ? h('button.btn.ghost', { onclick: () => { ctx.mapLayers?.({ trade: true }); ctx.focusRoutes?.(all); } }, 'Show them on the map') : null),
    h('div.section', h('h3', `Our lines (${ours.length}/${MAX_ROUTES})`), ours.length ? h('div.list', ours.map((r) => routeCard(ctx, r))) : h('div.empty', 'None yet.')),
    toUs.length ? h('div.section', h('h3', 'Lines others run to us'), h('div.list', toUs.map((r) => routeCard(ctx, r)))) : null,
    others.length ? h('div.section', h('h3', 'Other lines we know of'), h('div.list', others.map((r) => routeCard(ctx, r)))) : null);
}

function routeCard(ctx, r) {
  const s = ctx.state;
  const mine = r.by === s.me;
  const busy = r.traffic != null && s.week - r.traffic <= 3;
  return h('div.item.clickable', { onclick: () => ctx.focusRoutes?.([r]) },
    h('div.item-head', flag(mine ? r.partner : r.by), h('span.name', r.name),
      r.private ? h('span.chip.warn', mine || r.partner === s.me ? 'private' : 'secret, found out') : h('span.chip', 'public'),
      busy ? h('span.chip.good', 'ships sailing') : null,
      h('span.mono.small', { style: { marginLeft: 'auto' } }, `${num(r.km)} km`)),
    h('div.meta', `${regionName(r.from)} (${nationName(s, r.by)}) → ${regionName(r.to)} (${nationName(s, r.partner)})${r.straits?.length ? ` · via the ${r.straits.map((k) => CHOKEPOINTS[k]?.name ?? k).join(', ')}` : ''}`),
    r.crosses?.length ? h('div.meta', `Through the waters of ${r.crosses.map((x) => nationName(s, x)).join(', ')}`) : null,
    mine && r.private ? h('div.meta', { class: r.known ? 'bad' : '' }, r.known ? `Found out by ${r.known} countr${r.known === 1 ? 'y' : 'ies'}: their navies and coastguards can go after our cargoes on it.` : 'As far as we know, no one else has found it.') : null,
    mine ? h('div.meta.faint', `Upkeep ${money(r.upkeep ?? 0)} a week`) : null,
    mine || r.partner === s.me ? h('div.actions', { onclick: (e) => e.stopPropagation() },
      mine ? h('button.btn.small', { onclick: () => ctx.send({ type: 'routePrivacy', id: r.id, private: !r.private }) }, r.private ? 'Make it public' : 'Make it private') : null,
      h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Close the ${r.name}?`, 'Cargoes between the two countries go back to the usual lanes.')) ctx.send({ type: 'routeClose', id: r.id }); } }, 'Close')) : null);
}

/* ---------- Placing the two points ---------- */

function pickRoute(ctx) {
  const s = ctx.state;
  const faux = fauxState(s);
  const ourPort = (p) => { const id = portAt(faux, p); return id && faux.regions[id].ctrl === s.me ? id : null; };
  const anyPort = (p) => portAt(faux, p);
  const first = (p) => {
    const a = ourPort(p);
    if (!a) return ctx.hint('Start at one of our ports: click a coastal province we hold, or the sea just off it.', 'bad', 5000);
    ctx.endTarget();
    ctx.previewRoute({ from: a });
    ctx.target({
      text: `From ${regionName(a)}. Now click a port abroad.`,
      onWater: (x, y) => second(a, { x, y }),
      onPick: (rid) => second(a, { region: rid }),
      onCancel: () => ctx.previewRoute(null),
    });
  };
  const second = (a, p) => {
    const b = anyPort(p);
    if (!b) return ctx.hint('End it at a port: click a coastal province, or the sea just off it.', 'bad', 5000);
    if (faux.regions[b].ctrl === s.me) return ctx.hint('That port is ours too: a line runs to a port abroad.', 'bad', 5000);
    ctx.endTarget();
    confirmRoute(ctx, a, b);
  };
  ctx.target({
    text: 'Click the first point: one of our ports',
    onWater: (x, y) => first({ x, y }),
    onPick: (rid) => first({ region: rid }),
  });
}

function confirmRoute(ctx, a, b) {
  const s = ctx.state;
  const faux = fauxState(s);
  const shape = routeShape(faux, a, b);
  if (!shape) { ctx.previewRoute(null); return ctx.hint(`There is no way by sea from ${regionName(a)} to ${regionName(b)}.`, 'bad', 6000); }
  ctx.previewRoute({ from: a, to: b, pts: shape.pts });
  const partner = faux.regions[b].ctrl;
  const allies = new Set(s.alliances.filter((x) => x.kind === 'military' && x.members.includes(s.me)).flatMap((x) => x.members));
  const others = shape.crosses.filter((x) => x !== s.me && x !== partner);
  const watchers = others.filter((x) => !allies.has(x));
  const cost = routeCost(s.you, shape.km);
  const upkeep = routeUpkeep(s.you, shape.km);
  const weeks = Math.max(1, Math.round((shape.km / 2200) * 0.8));
  let secret = false;
  const name = h('input', { maxlength: 40, placeholder: `${regionName(a).replace(/\s*\(.*\)$/, '')}–${regionName(b).replace(/\s*\(.*\)$/, '')} Line` });
  const note = h('div.small');
  const seg = h('div.seg', [['public', 'Public'], ['private', 'Private']].map(([k, label]) => {
    const btn = h('button', { type: 'button', 'aria-pressed': String((k === 'private') === secret) }, label);
    btn.addEventListener('click', () => { secret = k === 'private'; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === btn)); paint(); });
    return btn;
  }));
  const paint = () => {
    note.className = secret && watchers.length ? 'small warning warn' : 'small muted';
    note.textContent = secret
      ? watchers.length
        ? `Secret, but it crosses the waters of ${watchers.map((x) => nationName(s, x)).join(', ')}. ${watchers.length > 1 ? 'They are' : 'It is'} far more likely to notice our ships than anyone else, and once ${watchers.length > 1 ? 'they know' : 'it knows'}, can board our cargoes there without a fleet.`
        : 'Secret: its ships appear on no one else\'s map. It crosses no unfriendly waters, so only spies inside our country (or theirs) could find it.'
      : `Announced to the world and drawn on every map. Trade between us and ${nationName(s, partner)} lifts both economies.`;
  };
  paint();
  modal({
    title: `A line to ${nationName(s, partner)}`,
    body: h('div.stack',
      h('div.route-summary',
        h('div', h('span.faint.small', 'From'), h('b', regionName(a))),
        h('div.route-arrow', '→'),
        h('div', h('span.faint.small', 'To'), h('b', regionName(b)), h('span.faint.small', nationName(s, partner)))),
      h('table.tbl', h('tbody',
        h('tr', h('td', 'Distance'), h('td.num', `${num(shape.km)} km`), h('td.faint.small', `about ${weeks} week${weeks === 1 ? '' : 's'} a voyage`)),
        h('tr', h('td', 'To open'), h('td.num', money(cost)), h('td.faint.small', `treasury ${money(s.you.treasury)}`)),
        h('tr', h('td', 'Upkeep'), h('td.num', money(upkeep)), h('td.faint.small', 'a week')),
        shape.straits.length ? h('tr', h('td', 'Straits'), h('td', { colspan: 2 }, shape.straits.map((k) => CHOKEPOINTS[k]?.name ?? k).join(', '))) : null,
        h('tr', h('td', 'Waters crossed'), h('td', { colspan: 2 }, others.length ? others.map((x) => `${nationName(s, x)}${allies.has(x) ? ' (ally)' : ''}`).join(', ') : 'none but the two ends\'')))),
      h('div.field', h('span', 'Who can see it'), seg),
      note,
      h('label.field', h('span', 'Name'), name)),
    actions: [{ label: 'Cancel', kind: 'ghost', onClick: () => { ctx.previewRoute(null); return true; } }, {
      label: 'Open the line', kind: 'primary', onClick: async () => {
        const err = await ctx.send({ type: 'routeOpen', from: { region: a }, to: { region: b }, private: secret, name: name.value.trim() || undefined });
        ctx.previewRoute(null);
        if (err) return false;
        ctx.toast(`${secret ? 'Private line' : 'Shipping line'} to ${nationName(s, partner)} opened.`, 'good');
        return true;
      },
    }],
    onClose: () => ctx.previewRoute(null),
  });
}
