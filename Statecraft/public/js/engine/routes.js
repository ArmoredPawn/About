// Trade routes: shipping lines a country opens between one of its ports and a port abroad (two points on the
// map). Every cargo between the two countries then sails that line, on a faster timetable, instead of whatever
// lane the shippers would have picked.
//
// A public line is announced and drawn on every map; the trade it carries lifts both economies. A private line is
// secret: its ships are on no one else's map and in no one's shipping lists. But the sea is watched. A country
// whose waters (about 200 nautical miles off its coast) the line crosses is far more likely to notice the traffic
// than anyone else, its spies in the owner's country count four times over, and once it knows, its navy and
// coastguard stop those cargoes in its own waters more easily (shipping.js), as Cuba-to-Panama smugglers would
// find out off Jamaica or Colombia.

import { PORTS, seaRoute, mapDistance, KM_PER_PX, seaAt, isStrait, nearestWater, isWater } from './navy.js';
import { EEZ } from './shipping.js';
import { networkStrength } from './spies.js';
import { costFactor } from './economy.js';
import { clamp, chance, news, alert, nameOf, nation, alive, atWar, allied, nextId, money, rel, sanctioning } from './core.js';
import { REGION_NAMES } from './names.js';

const regionName = (id) => REGION_NAMES[id] ?? id;
export const MAX_ROUTES = 6;
// How far from a port a click on the water may be and still mean that port (map pixels, about 1,000 km)
const SNAP = 50;

// The port a point on the map stands for: a coastal province clicked directly, or the nearest port to a point
// on the water
export function portAt(s, { region, x, y }) {
  if (region && PORTS[region]) return region;
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  let best = null;
  for (const [id, p] of Object.entries(PORTS)) {
    if (!s.regions[id]) continue;
    const d = mapDistance(Number(x), Number(y), p[0], p[1]);
    if (d <= SNAP && (!best || d < best.d)) best = { id, d };
  }
  return best?.id ?? null;
}

// The line's path over the water, its length, the straits it passes and whose waters it crosses
export function routeShape(s, from, to) {
  const a = PORTS[from];
  const b = PORTS[to];
  if (!a || !b) return null;
  const way = seaRoute(a, b);
  if (!way) return null;
  const pts = [a, ...way];
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * KM_PER_PX;
  // Points every ~100 km along the way
  const samples = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 5));
    for (let k = 0; k <= n; k++) samples.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  const W = 2000;
  const wrap = (x) => ((x % W) + W) % W;
  const straits = [...new Set(samples.map(([x, y]) => seaAt(wrap(x), y)).filter((k) => k && isStrait(k)))];
  // Whose waters: any coastal province held by a country within reach of the line (the two ends' own coasts
  // don't count)
  const crosses = new Set();
  const near = new Map();
  for (const [id, p] of Object.entries(PORTS)) {
    const reg = s.regions[id];
    if (!reg || id === from || id === to) continue;
    for (const [x, y] of samples) {
      if (mapDistance(wrap(x), y, p[0], p[1]) <= EEZ) { crosses.add(reg.ctrl); near.set(reg.ctrl, [...(near.get(reg.ctrl) ?? []), id]); break; }
    }
  }
  return { pts: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), km: Math.round(km), straits, crosses: [...crosses], waters: Object.fromEntries([...near].map(([k, v]) => [k, [...new Set(v)].slice(0, 4)])) };
}

export const routeCost = (c, km) => (0.4 + (km / 1000) * 0.12) * costFactor(c);
export const routeUpkeep = (c, km) => routeCost(c, km) * 0.012;

// Works out a line before it is opened: { error } or everything the leader needs to decide
export function planRoute(s, c, { from, to }) {
  const a = portAt(s, from ?? {});
  const b = portAt(s, to ?? {});
  if (!a) return { error: 'Start the line at one of our ports: click a coastal province we hold, or the sea just off it.' };
  if (!b) return { error: 'End it at a port abroad: click a coastal province, or the sea just off it.' };
  let start = a;
  let end = b;
  // Either end may be ours: the line always runs from our port
  if (s.regions[start].ctrl !== c.id && s.regions[end].ctrl === c.id) [start, end] = [end, start];
  if (s.regions[start].ctrl !== c.id) return { error: 'One end of the line has to be a port we hold.' };
  const partner = s.regions[end].ctrl;
  if (partner === c.id) return { error: 'Both ends are ours: a line runs to a port abroad.' };
  if (!alive(s, partner)) return { error: `${regionName(end)} has no government to trade with.` };
  if (atWar(s, c.id, partner)) return { error: `We are at war with ${nameOf(s, partner)}.` };
  if (sanctioning(s, c.id, partner) || sanctioning(s, partner, c.id)) return { error: `Sanctions stand between us and ${nameOf(s, partner)}. A secret line won't get round them: lift them first, or buy through intermediaries.` };
  if (Object.values(s.routes ?? {}).some((r) => !r.closed && ((r.by === c.id && r.partner === partner) || (r.by === partner && r.partner === c.id)))) return { error: `A line between us and ${nameOf(s, partner)} is already open.` };
  if (Object.values(s.routes ?? {}).filter((r) => r.by === c.id && !r.closed).length >= MAX_ROUTES) return { error: `We can run ${MAX_ROUTES} lines at once. Close one first.` };
  const shape = routeShape(s, start, end);
  if (!shape) return { error: `There is no way by sea from ${regionName(start)} to ${regionName(end)}.` };
  const others = shape.crosses.filter((x) => x !== c.id && x !== partner);
  const watchers = others.filter((x) => !allied(s, x, c.id));
  return { from: start, to: end, partner, ...shape, others, watchers, cost: routeCost(c, shape.km), upkeep: routeUpkeep(c, shape.km), weeks: Math.max(1, Math.round((shape.km / 2200) * 0.8)) };
}

export function openRoute(s, c, { from, to, private: secret = false, name }) {
  const plan = planRoute(s, c, { from, to });
  if (plan.error) return plan.error;
  if (plan.cost > c.treasury) return `Opening the line costs ${money(plan.cost)} (ships, berths, insurance); the treasury has ${money(c.treasury)}.`;
  c.treasury -= plan.cost;
  s.routes ??= {};
  const id = nextId(s, 'tr');
  const label = String(name || `${regionName(plan.from).replace(/\s*\(.*\)$/, '')}–${regionName(plan.to).replace(/\s*\(.*\)$/, '')} Line`).replace(/[\p{C}]/gu, '').trim().slice(0, 40);
  s.routes[id] = {
    id, name: label, by: c.id, partner: plan.partner, from: plan.from, to: plan.to, private: Boolean(secret), since: s.week,
    pts: plan.pts, km: plan.km, straits: plan.straits, crosses: plan.others, waters: plan.waters, known: {}, cost: plan.cost, closed: false, traffic: null,
  };
  if (!secret) {
    news(s, `${c.name} opens a shipping line to ${nameOf(s, plan.partner)}: ${label}.`, 'trade', [c.id, plan.partner]);
  }
  alert(s, plan.partner, `${c.name} has opened ${secret ? 'a private' : 'a'} shipping line to our port at ${regionName(plan.to)}. Trade between us now sails it, faster.`, 'trade');
  return null;
}

export function closeRoute(s, c, { id }) {
  const r = s.routes?.[id];
  if (!r || r.closed) return 'No such line.';
  if (r.by !== c.id && r.partner !== c.id) return 'That line is not ours to close.';
  r.closed = true;
  r.closedAt = s.week;
  if (!r.private) news(s, `The ${r.name} between ${nameOf(s, r.by)} and ${nameOf(s, r.partner)} closes.`, 'trade', [r.by, r.partner]);
  alert(s, r.by === c.id ? r.partner : r.by, `${c.name} has closed the ${r.name}.`, 'trade');
  return null;
}

export function setRoutePrivacy(s, c, { id, private: secret }) {
  const r = s.routes?.[id];
  if (!r || r.closed || r.by !== c.id) return 'That line is not ours.';
  secret = Boolean(secret);
  if (r.private === secret) return null;
  if (!secret) news(s, `${c.name} announces its ${r.name} to ${nameOf(s, r.partner)}.`, 'trade', [c.id, r.partner]);
  // A line that goes dark is still remembered by anyone who saw it
  r.private = secret;
  return null;
}

// Does this country know about this line?
export function knowsRoute(s, cid, r) {
  if (!r.private) return true;
  if (cid === r.by || cid === r.partner) return true;
  if (r.known?.[cid] != null) return true;
  // A deep spy network inside either end sees it
  const me = s.countries[cid];
  return Boolean(me && ((me.intel?.[r.by] ?? -1) > s.week || (me.intel?.[r.partner] ?? -1) > s.week));
}

/* ---------- Every week ---------- */

export function routesTick(s) {
  for (const r of Object.values(s.routes ?? {})) {
    if (r.closed) {
      // Closed lines are forgotten after a year
      if (s.week - (r.closedAt ?? s.week) > 52) delete s.routes[r.id];
      continue;
    }
    const by = s.countries[r.by];
    // A port lost, a war between the two, or a government gone ends the line
    const lost = s.regions[r.from]?.ctrl !== r.by ? r.from : s.regions[r.to]?.ctrl !== r.partner ? r.to : null;
    if (!by || !alive(s, r.by) || !alive(s, r.partner) || lost || atWar(s, r.by, r.partner)) {
      r.closed = true;
      r.closedAt = s.week;
      const why = lost ? `${regionName(lost)} has changed hands` : atWar(s, r.by, r.partner) ? 'the two countries are at war' : 'one of its ends has no government';
      for (const id of [r.by, r.partner]) alert(s, id, `The ${r.name} has closed: ${why}.`, 'warn');
      continue;
    }
    by.treasury -= routeUpkeep(by, r.km);
    if (r.private) discover(s, r);
  }
}

// The weekly chance that each country finds out about a private line. The countries whose waters it crosses see
// its ships (more so while cargo is sailing), and their spies count for four times as much; anyone else needs
// agents inside one of the two countries.
export function discoveryChance(s, r, cid) {
  if (knowsRoute(s, cid, r)) return 0;
  const c = s.countries[cid];
  if (!c || !alive(s, cid) || allied(s, cid, r.by)) return 0;
  const busy = r.traffic != null && s.week - r.traffic <= 3;
  const spies = Math.max(0, networkStrength(s, c, r.by), networkStrength(s, c, r.partner));
  if (r.crosses?.includes(cid)) return clamp((busy ? 0.07 : 0.025) + 0.005 * (c.tech?.naval ?? 4) + spies * 0.16, 0, 0.6);
  return clamp(spies * 0.04, 0, 0.15);
}

function discover(s, r) {
  for (const c of Object.values(s.countries)) {
    const p = discoveryChance(s, r, c.id);
    if (!(p > 0) || !chance(s, p)) continue;
    r.known[c.id] = s.week;
    const waters = r.crosses?.includes(c.id);
    alert(s, c.id, waters
      ? `Our coastguard has spotted a secret shipping line through our waters: ${nameOf(s, r.by)}'s ships run from ${regionName(r.from)} to ${regionName(r.to)} (${nameOf(s, r.partner)}). We can now see its cargoes, and stop them in our waters without a fleet (Market → Shipping).`
      : `Our agents have uncovered a secret shipping line: ${nameOf(s, r.by)}'s ships run from ${regionName(r.from)} to ${regionName(r.to)} (${nameOf(s, r.partner)}). Its cargoes now show on our map.`, 'intel');
    // A hostile country that finds a secret line through its own waters stops its cargoes
    if (!c.human && waters && (rel(s, c.id, r.by) < -20 || rel(s, c.id, r.partner) < -20 || sanctioning(s, c.id, r.by) || sanctioning(s, c.id, r.partner))) c.ai.stopLines = { ...(c.ai.stopLines ?? {}), [r.id]: true };
  }
}

/* ---------- What each leader sees ---------- */

export function routesView(s, cid) {
  return Object.values(s.routes ?? {}).filter((r) => !r.closed && knowsRoute(s, cid, r)).map((r) => ({
    id: r.id, name: r.name, by: r.by, partner: r.partner, from: r.from, to: r.to, private: r.private, since: r.since, km: r.km, pts: r.pts,
    straits: r.straits, crosses: r.crosses, traffic: r.traffic,
    // Only the owner knows who has found out about a secret line, and only its partner and owner its costs
    known: r.by === cid ? Object.keys(r.known ?? {}).length : null, discovered: r.known?.[cid] != null,
    upkeep: r.by === cid ? Math.round(routeUpkeep(s.countries[cid], r.km) * 1000) / 1000 : null,
  }));
}

export { isWater, nearestWater };
