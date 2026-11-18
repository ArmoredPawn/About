// Cargo routes, and who sees what on them.
//
// The seller of a resource deal plans the way its convoys go: up to ten checkpoints between its port (or, overland,
// its province nearest the buyer) and the buyer's, and the ships or trucks go in a straight line from one to the
// next. Ships can't cross land and trucks can't cross the sea, nor a country at war with either side. The seller
// pays to ship every convoy, more the longer the way.
//
// A public cargo, and its route, is on everyone's map. A private one (a secret deal, or a purchase around
// sanctions) is seen only by:
//   - the seller and the buyer;
//   - anyone with a spy network inside either of them;
//   - anyone with a spy satellite in orbit;
//   - anyone whose warship comes very close to it at sea: its leader is told and can seize it, sink it, or tell
//     the world (the cargo is then public);
//   - everyone, once someone has told the world.
// A neutral country whose spies find a secret trade chooses to keep quiet or broadcast it. When a cargo is sunk,
// anyone with spies inside the countries involved, or a satellite overhead, hears about it.

import { GEO } from './data/geo.js';
import { RESOURCE_INFO } from './data/regions.js';
import { PORTS, KM_PER_PX, isWater, seaAt, isStrait, nodeName, seaRoute as waterRoute } from './navy.js';
import { cellAt, cellXY, isLand, holderAt, provinceCell } from './land.js';
import { news, alert, nameOf, atWar, allied, addRel, hasNetwork, spySats, sanctioning, chance, rel } from './core.js';
import { ask, register } from './decisions.js';
import { huntCargo, laneFor, strikeNow } from './shipping.js';
import { REGION_NAMES } from './names.js';
import { cargoHooks } from './trade.js';

export const MAX_CHECKPOINTS = 10;
export const CONVOY_WEEKS = 2; // a deal's convoy sails every two weeks, carrying two weeks' worth
const W = 2000;
const regionName = (id) => REGION_NAMES[id] ?? id;
const an = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;

/* ---------- Who sees a cargo ---------- */

export const cargoPrivate = (sh) => Boolean((sh.covert || sh.secret) && !sh.exposed);

export function canSeeCargo(s, cid, sh) {
  if (!cargoPrivate(sh)) return true;
  if (!cid) return false;
  if (cid === sh.seller || cid === sh.buyer) return true;
  if (sh.sighted?.[cid] != null) return true;
  if (spySats(s, cid) >= 1) return true;
  return hasNetwork(s, cid, sh.seller) || hasNetwork(s, cid, sh.buyer);
}

// Can this leader see a secret deal between two countries (not its own)?
export const seesDeal = (s, cid, t) => !t.secret || t.exposed || t.a === cid || t.b === cid || hasNetwork(s, cid, t.a) || hasNetwork(s, cid, t.b);

/* ---------- Planning a route ---------- */

// Where a deal's convoys start and end: { mode, from, to, a: [x, y], b: [x, y] }. By sea, between the two
// countries' nearest big ports; overland, between the seller's province nearest the buyer and the buyer's
// nearest the seller.
export function dealEnds(s, seller, buyer, mode) {
  if (mode === 'sea') {
    const lane = laneFor(s, seller, buyer);
    if (!lane) return null;
    return { mode, from: lane.from, to: lane.to, a: PORTS[lane.from], b: PORTS[lane.to] };
  }
  const mine = Object.values(s.regions).filter((r) => r.ctrl === seller && provinceCell(r.id) >= 0);
  const theirs = Object.values(s.regions).filter((r) => r.ctrl === buyer && provinceCell(r.id) >= 0);
  if (!mine.length || !theirs.length) return null;
  let best = null;
  for (const p of mine) for (const q of theirs) {
    const d = (GEO[p.id].x - GEO[q.id].x) ** 2 + (GEO[p.id].y - GEO[q.id].y) ** 2;
    if (!best || d < best.d) best = { d, from: p.id, to: q.id };
  }
  return { mode, from: best.from, to: best.to, a: cellXY(provinceCell(best.from)), b: cellXY(provinceCell(best.to)) };
}

// The way through the checkpoints, with x unwrapped so a route across the Pacific edge runs on past 0 or 2,000
export function buildPath(a, checkpoints, b) {
  const pts = [[a[0], a[1]]];
  for (const p of [...checkpoints, b]) {
    const prev = pts[pts.length - 1];
    let x = Number(p[0]);
    while (x - prev[0] > W / 2) x -= W;
    while (prev[0] - x > W / 2) x += W;
    pts.push([x, Number(p[1])]);
  }
  return pts;
}

// Points every ~40 km along a path
function samples(pts, step = 2) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, i]);
  }
  return out;
}

// What is wrong with a path, or null: a leg over land (by sea) or over the sea (overland), or through a country at
// war with the seller or the buyer. Ports sit on the shore, so the first and last few km don't count.
export function pathProblem(s, mode, pts, seller, buyer) {
  if (!Array.isArray(pts) || pts.length < 2) return 'Plan a route.';
  if (pts.length - 2 > MAX_CHECKPOINTS) return `A route has at most ${MAX_CHECKPOINTS} checkpoints.`;
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return 'A checkpoint is off the map.';
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const nearEnd = (x, y) => Math.hypot(x - ax, y - ay) < 6 || Math.hypot(x - bx, y - by) < 6;
  for (const [x, y, leg] of samples(pts)) {
    if (nearEnd(x, y)) continue;
    if (mode === 'sea') {
      if (!isWater(x, y)) return `Leg ${leg} crosses land: ships can't sail over it. Move a checkpoint so the line stays on the water.`;
    } else {
      const cell = cellAt(x, y);
      if (!isLand(cell)) return `Leg ${leg} crosses the sea: trucks and trains can't. Keep the line on land.`;
      const h = holderAt(s, cell);
      if (h && h !== seller && h !== buyer && (atWar(s, h, seller) || atWar(s, h, buyer))) return `Leg ${leg} crosses ${nameOf(s, h)}, which is at war with ${atWar(s, h, seller) ? nameOf(s, seller) : nameOf(s, buyer)}: the convoy would be seized.`;
    }
  }
  return null;
}

// The length, the straits it passes (by sea) and the countries it crosses (overland)
export function pathFacts(s, mode, pts, seller, buyer) {
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * KM_PER_PX;
  const straits = new Set();
  const transit = new Set();
  for (const [x, y] of samples(pts, 3)) {
    const wx = ((x % W) + W) % W;
    if (mode === 'sea') {
      const k = seaAt(wx, y);
      if (k && isStrait(k)) straits.add(k);
    } else {
      const cell = cellAt(wx, y);
      const h = isLand(cell) ? holderAt(s, cell) : null;
      if (h && h !== seller && h !== buyer) transit.add(h);
    }
  }
  return { km: Math.round(km), weeks: Math.max(1, Math.round(km / (mode === 'land' ? 1500 : 2200))), straits: [...straits], transit: [...transit] };
}

// What it costs the seller to ship one cargo: freight, insurance and port fees, about 1% of its value plus 0.4% for
// every 1,000 km (half as much again overland)
export function shippingCost(s, res, qty, km, mode) {
  const value = qty * (RESOURCE_INFO[res].value / 52) * (s.market?.price?.[res] ?? 1);
  return Math.max(0.001, value * (0.01 + 0.004 * km / 1000) * (mode === 'land' ? 1.5 : 1));
}

// The computer's own route: the shortest way, cut down to as few checkpoints as the coast allows
export function autoPath(s, ends, seller, buyer) {
  if (ends.mode === 'sea') {
    const way = waterRoute(ends.a, ends.b);
    if (!way) return null;
    return simplify([ends.a, ...way], (p, q) => clear(p, q, (x, y) => isWater(x, y)));
  }
  // Overland: from province to province, through countries at peace with both sides
  const okHolder = (id) => { const h = s.regions[id]?.ctrl; return h && (h === seller || h === buyer || !(atWar(s, h, seller) || atWar(s, h, buyer))); };
  const prev = new Map([[ends.from, null]]);
  let frontier = [ends.from];
  while (frontier.length && !prev.has(ends.to)) {
    const next = [];
    for (const id of frontier) for (const n of GEO[id]?.adj ?? []) {
      if (prev.has(n) || !s.regions[n] || !okHolder(n) || provinceCell(n) < 0) continue;
      prev.set(n, id);
      next.push(n);
    }
    frontier = next;
  }
  if (!prev.has(ends.to)) return null;
  const chain = [];
  for (let id = ends.to; id; id = prev.get(id)) chain.unshift(cellXY(provinceCell(id)));
  const onLand = (x, y) => isLand(cellAt(x, y));
  const out = simplify(buildPath(chain[0], chain.slice(1, -1), chain[chain.length - 1]), (p, q) => clear(p, q, onLand));
  return out;
}
function clear(p, q, ok) {
  const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
  for (let k = 1; k < n; k++) {
    const x = p[0] + (q[0] - p[0]) * k / n;
    const y = p[1] + (q[1] - p[1]) * k / n;
    if (Math.hypot(x - p[0], y - p[1]) < 6 && k < 4) continue;
    if (!ok(x, y)) return false;
  }
  return true;
}
// Greedy: from each point, the farthest one it can see in a straight line
function simplify(pts, visible) {
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !visible(pts[a], pts[b])) b--;
    out.push(pts[b]);
    a = b;
  }
  return out.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

// A full plan for a deal's convoys: { error } or { mode, from, to, pts, km, weeks, straits, transit, cost }. The
// treaty's own mode and ends are used once set, so a plan made in the browser matches the server's.
export function planDealRoute(s, t, { checkpoints = [], auto = false, mode, ends } = {}) {
  ends ??= dealEnds(s, t.a, t.b, mode ?? 'sea');
  if (!ends) return { error: 'There is no way between the two countries: no port, or no shared border.' };
  let pts;
  if (auto) {
    pts = autoPath(s, ends, t.a, t.b);
    if (!pts) return { error: ends.mode === 'sea' ? 'No sea route joins the two ports.' : 'No overland way avoids the countries at war with either side.' };
  } else {
    if (!Array.isArray(checkpoints) || checkpoints.length > MAX_CHECKPOINTS) return { error: `A route has at most ${MAX_CHECKPOINTS} checkpoints.` };
    pts = buildPath(ends.a, checkpoints.map((p) => [Number(p?.[0]), Number(p?.[1])]), ends.b);
    const why = pathProblem(s, ends.mode, pts, t.a, t.b);
    if (why) return { error: why };
  }
  const facts = pathFacts(s, ends.mode, pts, t.a, t.b);
  const qty = Number(t.qty) * CONVOY_WEEKS;
  return { mode: ends.mode, from: ends.from, to: ends.to, pts, auto: Boolean(auto), ...facts, cost: Math.round(shippingCost(s, t.res, qty, facts.km, ends.mode) * 10000) / 10000 };
}

// Why a planned route can no longer be sailed, or null
export function routeBlocked(s, plan, a, b) {
  if (plan.mode === 'sea') {
    if (s.regions[plan.from]?.ctrl !== a) return `we no longer hold ${regionName(plan.from)}, the port it sails from`;
    if (s.regions[plan.to]?.ctrl !== b) return `${nameOf(s, b)} no longer holds ${regionName(plan.to)}, the port it sails to`;
    for (const k of plan.straits ?? []) {
      const st = s.chokepoints?.[k];
      if (st?.closedBy && ![a, b].includes(st.closedBy) && !allied(s, st.closedBy, a) && !allied(s, st.closedBy, b)) return `${nameOf(s, st.closedBy)} has closed the ${nodeName(k)}`;
    }
    return null;
  }
  for (const h of plan.transit ?? []) if (atWar(s, h, a) || atWar(s, h, b)) return `it crosses ${nameOf(s, h)}, now at war with ${atWar(s, h, a) ? nameOf(s, a) : nameOf(s, b)}`;
  if (s.regions[plan.from]?.ctrl !== a) return `we no longer hold ${regionName(plan.from)}, where it sets off`;
  return null;
}

// The seller sets (or changes) the route of a deal's convoys
export function setDealRoute(s, c, { id, checkpoints, auto }) {
  const t = s.treaties.find((x) => x.id === id && x.kind === 'deal');
  if (!t) return 'That deal has ended.';
  if (t.a !== c.id) return 'Only the seller plans the route.';
  const plan = planDealRoute(s, t, { checkpoints, auto, ends: t.ends ?? undefined, mode: t.mode });
  if (plan.error) return plan.error;
  t.route = plan;
  t.mode = plan.mode;
  t.ends ??= { mode: plan.mode, from: plan.from, to: plan.to, a: plan.pts[0], b: plan.pts[plan.pts.length - 1] };
  if (s.countries[t.b]?.human) alert(s, t.b, `${c.name} has planned the route for our ${RESOURCE_INFO[t.res].name.toLowerCase()} convoys: ${plan.km.toLocaleString('en')} km, about ${plan.weeks} week${plan.weeks === 1 ? '' : 's'} each way${plan.straits.length ? `, through the ${plan.straits.map(nodeName).join(' and the ')}` : ''}.`, 'info');
  return null;
}

/* ---------- Seen at sea ---------- */

// One of our warships has come very close to a private cargo: we see it, and the leader decides what to do
export function sighted(s, sh, f, x, y) {
  sh.sighted ??= {};
  if (sh.sighted[f.owner] != null || f.owner === sh.seller || f.owner === sh.buyer) return;
  sh.sighted[f.owner] = s.week;
  const c = s.countries[f.owner];
  if (!c) return;
  const what = RESOURCE_INFO[sh.res].name.toLowerCase();
  const where = seaAt(x, y) ? `in the ${nodeName(seaAt(x, y))}` : 'at sea';
  ask(s, c, 'cargoSighted', {
    title: `${f.name} has come upon a secret cargo`,
    text: `${f.name} is shadowing a freighter ${where} carrying ${what} from ${nameOf(s, sh.seller)} to ${nameOf(s, sh.buyer)}${sh.covert ? ', around sanctions' : ', under a secret deal'}. No one else can see it. We can seize it (the cargo becomes ours), sink it, tell the world about it, or let it pass. Seizing or sinking it in peacetime will outrage both countries.`,
    options: [
      { id: 'pass', label: 'Let it pass', note: 'Say nothing. We still see it until it docks.' },
      { id: 'seize', label: 'Seize it', note: `${f.name} boards it and sails it home: the cargo is ours.`, tone: 'warn' },
      { id: 'sink', label: 'Sink it', note: 'Surer than seizing it, and the cargo is lost to everyone.', tone: 'bad' },
      { id: 'broadcast', label: 'Tell the world', note: 'Every country sees the cargo, and its route, from now on.' },
    ],
    weeks: 2, data: { sh: sh.id, fleet: f.id, x, y }, once: `sight:${sh.id}`,
  });
}

register('cargoSighted', {
  apply(s, c, d, pick) {
    if (pick === 'pass') return null;
    const sh = (s.shipments ?? []).find((x) => x.id === d.data.sh);
    if (!sh || sh.done) return 'The cargo has gone: it has docked or been stopped.';
    if (pick === 'broadcast') return exposeCargo(s, c, sh);
    const f = s.fleets?.[d.data.fleet];
    const how = pick === 'sink' ? 'sink' : 'seize';
    // Still alongside it: our ships act at once; otherwise they (or a new fleet) go after it
    if (strikeNow(s, c, sh, f, how)) return null;
    return huntCargo(s, c, sh, f && f.owner === c.id ? f : 'new', how);
  },
  // The computer lets most go; a bitter rival tells the world. Enemies at war attack it anyway when in range.
  ai(s, c, d) {
    const sh = (s.shipments ?? []).find((x) => x.id === d.data.sh);
    if (!sh) return 'pass';
    if (Math.min(rel(s, c.id, sh.seller), rel(s, c.id, sh.buyer)) < -40 && chance(s, 0.3)) return 'broadcast';
    return 'pass';
  },
});

/* ---------- Found by spies ---------- */

// A neutral country: at war with neither side, and allied to neither
export const neutralTo = (s, cid, a, b) => !atWar(s, cid, a) && !atWar(s, cid, b) && !allied(s, cid, a) && !allied(s, cid, b);

// A secret trade (a deal, or a purchase around sanctions) found by spies: every neutral country with a network inside
// either side is asked, once per trade, whether to keep quiet or broadcast it: when the trade begins, or later, the
// week its spies settle in. Countries on one side or the other just see it.
export function secretTradeFound(s, { seller, buyer, res, deal = null, sh = null }) {
  const rec = deal ? s.treaties.find((t) => t.id === deal) : (s.shipments ?? []).find((x) => x.id === sh);
  if (!rec || rec.exposed) return;
  rec.leakAsked ??= {};
  for (const c of Object.values(s.countries)) {
    if (c.id === seller || c.id === buyer || c.exile || rec.leakAsked[c.id] != null) continue;
    const via = hasNetwork(s, c.id, seller) ? seller : hasNetwork(s, c.id, buyer) ? buyer : null;
    if (!via || !neutralTo(s, c.id, seller, buyer)) continue;
    rec.leakAsked[c.id] = s.week;
    const what = RESOURCE_INFO[res].name.toLowerCase();
    ask(s, c, 'cargoLeak', {
      title: `Our agents in ${nameOf(s, via)} found a secret trade`,
      text: `${nameOf(s, seller)} is ${deal ? 'secretly selling' : 'shipping'} ${what} to ${nameOf(s, buyer)}${deal ? ' under a secret deal' : rec.covert ? ' around sanctions' : ', bought in private'}. We see its cargoes and their route. As a neutral country, we can keep this to ourselves, or broadcast it to the world. (To warn just one country, use the chat.)`,
      options: [
        { id: 'quiet', label: 'Keep quiet', note: 'Only we know. We keep watching its cargoes.' },
        { id: 'broadcast', label: 'Broadcast it', note: 'It makes the news; every country sees its cargoes from now on. Both countries will resent it.', tone: 'warn' },
      ],
      weeks: 4, data: { seller, buyer, res, deal, sh }, once: `leak:${deal ?? sh}`,
    });
  }
}

register('cargoLeak', {
  apply(s, c, d, pick) {
    if (pick !== 'broadcast') return null;
    if (d.data.deal) {
      const t = s.treaties.find((x) => x.id === d.data.deal);
      if (!t) return 'That deal has already ended.';
      return exposeDeal(s, c, t);
    }
    const sh = (s.shipments ?? []).find((x) => x.id === d.data.sh);
    if (!sh || sh.done) return 'The cargo has already docked.';
    return exposeCargo(s, c, sh);
  },
  ai(s, c, d) {
    const worst = Math.min(rel(s, c.id, d.data.seller), rel(s, c.id, d.data.buyer));
    return worst < -40 && chance(s, 0.25) ? 'broadcast' : 'quiet';
  },
});

/* ---------- Telling the world ---------- */

// A private cargo made public by someone who can see it (not one of the two countries trading)
export function exposeCargo(s, c, sh) {
  if (!sh || sh.done) return 'That cargo has docked or been stopped.';
  if (!cargoPrivate(sh)) return 'Everyone already knows about it.';
  if (c.id === sh.seller || c.id === sh.buyer) return 'It is our own trade.';
  if (!canSeeCargo(s, c.id, sh)) return 'We can\'t see that cargo.';
  if (sh.deal) {
    const t = s.treaties.find((x) => x.id === sh.deal);
    if (t) return exposeDeal(s, c, t);
  }
  sh.exposed = true;
  told(s, c, sh.seller, sh.buyer, sh.res, Boolean(sh.covert), false);
  return null;
}

export function exposeDeal(s, c, t) {
  if (t.exposed || !t.secret) return 'Everyone already knows about it.';
  t.exposed = true;
  for (const sh of s.shipments ?? []) if (sh.deal === t.id) sh.exposed = true;
  told(s, c, t.a, t.b, t.res, false, true);
  return null;
}

function told(s, c, seller, buyer, res, covert, deal) {
  const what = RESOURCE_INFO[res].name.toLowerCase();
  news(s, `${c.name} reveals that ${nameOf(s, seller)} has been ${deal ? 'secretly selling' : 'shipping'} ${what} to ${nameOf(s, buyer)}${covert ? ' around sanctions' : deal ? ' under a secret deal' : ''}. Its cargoes are now on every map.`, 'trade', [c.id, seller, buyer]);
  for (const id of [seller, buyer]) {
    addRel(s, c.id, id, -8);
    alert(s, id, `${c.name} has told the world about our secret ${what} trade with ${nameOf(s, id === seller ? buyer : seller)}. Every navy can now see its cargoes.`, 'bad');
  }
  if (covert) {
    // Sanctions-busting caught in the open: the countries enforcing the sanctions take it badly
    for (const o of Object.values(s.countries)) {
      if ([seller, buyer, c.id].includes(o.id)) continue;
      if (sanctioning(s, o.id, seller) || sanctioning(s, o.id, buyer)) { addRel(s, o.id, seller, -6); addRel(s, o.id, buyer, -6); }
    }
    for (const id of [seller, buyer]) { const n = s.countries[id]; if (n) n.rep = Math.max(0, n.rep - 3); }
  }
  c.rep = Math.min(100, c.rep + 1);
}

cargoHooks.secretTradeFound = (...a) => secretTradeFound(...a);

// Every week: neutral spies who have newly settled in inside a country trading in secret find out about it
export function cargoTick(s) {
  for (const t of s.treaties) {
    if (!t.secret || t.exposed) continue;
    if (t.kind === 'deal') secretTradeFound(s, { seller: t.a, buyer: t.b, res: t.res, deal: t.id });
    else if (PACT_KINDS.includes(t.kind)) secretPactFound(s, t);
  }
  for (const sh of s.shipments ?? []) if (!sh.done && (sh.covert || sh.secret) && !sh.deal && !sh.exposed) secretTradeFound(s, { seller: sh.seller, buyer: sh.buyer, res: sh.res, sh: sh.id });
  accessSeen(s);
}

/* ---------- Secret agreements: free trade, non-aggression, military access, loans ---------- */

export const PACT_KINDS = ['fta', 'nap', 'access', 'loan'];
const PACT_NAMES = { fta: 'a free trade agreement', nap: 'a non-aggression pact', access: 'a military access agreement', loan: 'a loan' };
const pactText = (s, t) => (t.kind === 'loan' ? `${nameOf(s, t.a)} has secretly lent ${nameOf(s, t.b)} money` : `${nameOf(s, t.a)} and ${nameOf(s, t.b)} have secretly signed ${PACT_NAMES[t.kind]}`);

// Can this leader see a secret agreement between two countries?
export const seesPact = (s, cid, t) => !t.secret || t.exposed || t.a === cid || t.b === cid || hasNetwork(s, cid, t.a) || hasNetwork(s, cid, t.b);

// A secret agreement found by spies: neutral countries with a network inside either side are asked, once, whether
// to keep quiet or broadcast it
export function secretPactFound(s, t) {
  if (!t.secret || t.exposed) return;
  t.leakAsked ??= {};
  for (const c of Object.values(s.countries)) {
    if (c.id === t.a || c.id === t.b || c.exile || t.leakAsked[c.id] != null) continue;
    const via = hasNetwork(s, c.id, t.a) ? t.a : hasNetwork(s, c.id, t.b) ? t.b : null;
    if (!via || !neutralTo(s, c.id, t.a, t.b)) continue;
    t.leakAsked[c.id] = s.week;
    ask(s, c, 'pactLeak', {
      title: `Our agents in ${nameOf(s, via)} found a secret agreement`,
      text: `${pactText(s, t)}. No one else knows. As a neutral country, we can keep it to ourselves, or broadcast it to the world. (To warn just one country, use the chat.)`,
      options: [
        { id: 'quiet', label: 'Keep quiet', note: 'Only we know.' },
        { id: 'broadcast', label: 'Broadcast it', note: 'It makes the news. Both countries will resent it.', tone: 'warn' },
      ],
      weeks: 4, data: { pact: t.id, a: t.a, b: t.b }, once: `leak:${t.id}`,
    });
  }
}

register('pactLeak', {
  apply(s, c, d, pick) {
    if (pick !== 'broadcast') return null;
    const t = s.treaties.find((x) => x.id === d.data.pact);
    if (!t) return 'That agreement has already ended.';
    return exposePact(s, c, t);
  },
  ai(s, c, d) { return Math.min(rel(s, c.id, d.data.a), rel(s, c.id, d.data.b)) < -40 && chance(s, 0.25) ? 'broadcast' : 'quiet'; },
});

export function exposePact(s, c, t, how = null) {
  if (!t.secret || t.exposed) return 'Everyone already knows about it.';
  t.exposed = true;
  news(s, how ?? `${c.name} reveals that ${pactText(s, t)}.`, 'diplomacy', [c?.id, t.a, t.b].filter(Boolean));
  if (c) for (const id of [t.a, t.b]) {
    addRel(s, c.id, id, -6);
    alert(s, id, `${c.name} has told the world about our secret agreement with ${nameOf(s, id === t.a ? t.b : t.a)}.`, 'bad');
  }
  return null;
}

export function exposeSpiedPact(s, c, id) {
  const t = s.treaties.find((x) => x.id === id && PACT_KINDS.includes(x.kind));
  if (!t) return 'That agreement has ended.';
  if (t.a === c.id || t.b === c.id) return 'It is our own agreement.';
  if (!(hasNetwork(s, c.id, t.a) || hasNetwork(s, c.id, t.b))) return 'Our spies don\'t know about it.';
  return exposePact(s, c, t);
}

// Secret military access can't stay secret once the troops are seen marching through
function accessSeen(s) {
  const secret = s.treaties.filter((t) => t.kind === 'access' && t.secret && !t.exposed);
  if (!secret.length) return;
  for (const a of Object.values(s.armies)) {
    if (a.sea || a.x == null) continue;
    const h = holderAt(s, cellAt(a.x, a.y));
    if (!h || h === a.owner) continue;
    const t = secret.find((x) => (x.a === a.owner && x.b === h) || (x.b === a.owner && x.a === h));
    if (t && !t.exposed) exposePact(s, null, t, `${nameOf(s, a.owner)}'s troops are seen marching through ${nameOf(s, h)}: the two had secretly agreed to let them pass.`);
  }
}

// Broadcast a secret deal our spies have found (any time, not only when first asked)
export function exposeSpiedDeal(s, c, id) {
  const t = s.treaties.find((x) => x.id === id && x.kind === 'deal');
  if (!t) return 'That deal has ended.';
  if (t.a === c.id || t.b === c.id) return 'It is our own deal.';
  if (!(hasNetwork(s, c.id, t.a) || hasNetwork(s, c.id, t.b))) return 'Our spies don\'t know about it.';
  return exposeDeal(s, c, t);
}
cargoHooks.sinkWitnesses = (...a) => sinkWitnesses(...a);

/* ---------- A cargo sunk ---------- */

// Leaders with spies inside the countries involved, or a spy satellite overhead, hear when a cargo is sunk
export function sinkWitnesses(s, sh, by, where, at) {
  const what = RESOURCE_INFO[sh.res].name.toLowerCase();
  for (const c of Object.values(s.countries)) {
    if (!c.human || [by, sh.seller, sh.buyer].includes(c.id)) continue;
    const sat = spySats(s, c.id) >= 1;
    const spy = [by, sh.seller, sh.buyer].find((id) => hasNetwork(s, c.id, id));
    if (!sat && !spy) continue;
    alert(s, c.id, `${sat ? 'Our spy satellites saw it' : `Our agents in ${nameOf(s, spy)} report it`}: ${nameOf(s, by)} sank ${an(what)} cargo bound for ${nameOf(s, sh.buyer)} from ${nameOf(s, sh.seller)}${where ? ` ${where}` : ''}.`, 'info', at ? { sea: at } : {});
  }
}
