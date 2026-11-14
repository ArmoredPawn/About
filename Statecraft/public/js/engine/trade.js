// The market and the shipping lanes. Countries buy and sell resources from each other; every cargo travels by
// sea (through the world's straits) or overland, and can be stopped on the way: by a blockade, a hostile navy
// patrolling a strait, the country holding a strait's shores, a closed border, or a leader who orders it seized.
// Sanctions close the front door, but intermediaries will still sell, at a price and a risk.

import { GEO } from './data/geo.js';
import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import { CHOKEPOINTS } from './data/world.js';
import { STOCK_WEEKS } from './setup.js';
import {
  clamp, chance, rand, news, alert, nameOf, nation, alive, atWar, allied, rel, addRel, nextId, money, sanctioning, pick, enemiesOf,
} from './core.js';

/* ---------- Seas ---------- */

// Which seas each country ships from. Minor nations are placed by where they lie on the map.
const BASINS = {
  usa: ['atl', 'pac'], can: ['atl', 'pac'], mex: ['atl', 'pac'], bra: ['atl'], arg: ['atl'], col: ['atl', 'pac'], chl: ['pac'], per: ['pac'],
  gbr: ['atl'], irl: ['atl'], fra: ['atl', 'med'], esp: ['atl', 'med'], prt: ['atl'], nld: ['atl'], bel: ['atl'], deu: ['atl'],
  dnk: ['atl'], nor: ['atl'], swe: ['atl'], fin: ['atl'], pol: ['atl'], ita: ['med'], tur: ['med', 'black'], rou: ['black'],
  rus: ['atl', 'black', 'pac'], isr: ['med', 'red'], egy: ['med', 'red'], sau: ['gulf', 'red'], are: ['gulf', 'ind'], irq: ['gulf'],
  irn: ['gulf', 'ind'], pak: ['ind'], ind: ['ind'], bgd: ['ind'], tha: ['eas', 'ind'], mys: ['ind', 'eas'], sgp: ['ind', 'eas'],
  idn: ['ind', 'eas'], vnm: ['eas'], phl: ['eas'], chn: ['eas'], twn: ['eas'], kor: ['eas'], jpn: ['eas'], aus: ['ind', 'pac'],
  zaf: ['atl', 'ind'], che: [], aut: [], cze: [], kaz: [],
};
// Sea lanes between them: [from, to, length, strait on the way]
export const LANES = [
  ['gulf', 'ind', 1, 'hormuz'],
  ['ind', 'eas', 2.5, 'malacca'],
  ['ind', 'eas', 4, null], // the long way, through the Lombok Strait
  ['ind', 'red', 1, 'bab'],
  ['red', 'med', 1, 'suez'],
  ['med', 'atl', 1.5, 'gibraltar'],
  ['black', 'med', 0.7, 'bosporus'],
  ['atl', 'pac', 3.5, 'panama'],
  ['atl', 'pac', 7, null], // round Cape Horn
  ['atl', 'ind', 6, null], // round the Cape of Good Hope
  ['eas', 'pac', 3, null],
  ['ind', 'pac', 4, null],
];
export const SEA_NAMES = { atl: 'Atlantic', pac: 'Pacific', med: 'Mediterranean', black: 'Black Sea', red: 'Red Sea', gulf: 'Persian Gulf', ind: 'Indian Ocean', eas: 'East Asian seas' };

const basinCache = new Map();
export function basinsOf(s, id) {
  if (BASINS[id]) return BASINS[id];
  // A nation born of a breakaway province trades from that province's coast
  const home = s?.minors?.[id]?.home;
  if (home) return basinsOf(s, home);
  if (basinCache.has(id)) return basinCache.get(id);
  const g = GEO[id];
  let out = [];
  if (g?.coast) {
    const { lat, lon } = g;
    if (lat > 36 && lat < 48 && lon > 46 && lon < 62) out = []; // the Caspian goes nowhere
    else if (lon > 46 && lon < 57 && lat > 23 && lat < 31) out = ['gulf'];
    else if (lon > 32 && lon < 45 && lat > 11 && lat < 30) out = ['red'];
    else if (lat > 40 && lat < 48 && lon > 27 && lon < 42) out = ['black'];
    else if (lat > 30 && lat < 46 && lon > -6 && lon < 37) out = ['med'];
    else if (lon < -30) out = americasCoast(lat, lon);
    else if (lon < 20) out = ['atl'];
    else if (lat >= 46 && lon < 70) out = ['atl']; // the Baltic, the White Sea and the Barents Sea
    else if (lon < 100 && lat < 30) out = ['ind'];
    else if (lon >= 100 && lon < 130 && lat < -8) out = ['ind']; // Western Australia
    else if (lon >= 100 && lon < 150 && lat > -8) out = ['eas'];
    else out = ['pac'];
  }
  if (id === 'm-panama') out = ['atl', 'pac'];
  if (id === 'm-oman' || id === 'm-yemen') out = ['ind', id === 'm-oman' ? 'gulf' : 'red'];
  if (id === 'm-ukraine' || id === 'm-georgia') out = ['black'];
  basinCache.set(id, out);
  return out;
}

// Which ocean an American coast faces: the Pacific along the west coast (Alaska to Chile), the Atlantic along
// the east coast, the Gulf of Mexico and the Caribbean
function americasCoast(lat, lon) {
  if (lat >= 32) return lon < -114 ? ['pac'] : ['atl'];
  if (lat >= 14) return lon < -100 ? ['pac'] : ['atl'];
  if (lat >= 0) return lon < -79 || (lon < -77 && lat < 9) ? ['pac'] : ['atl'];
  return lon < -70 ? ['pac'] : ['atl'];
}

// Can a ship pass this strait? Not if it is closed to the cargo's owners, or a hostile navy blocks it.
function straitOpen(s, key, a, b) {
  const st = s.chokepoints[key];
  if (st.closedBy && ![a, b].includes(st.closedBy) && !allied(s, st.closedBy, a) && !allied(s, st.closedBy, b)) return false;
  return true;
}

// The cheapest sea route between two countries: { length, straits } or null
export function seaRoute(s, a, b) {
  const from = basinsOf(s, a);
  const to = new Set(basinsOf(s, b));
  if (!from.length || !to.size) return null;
  const dist = new Map(from.map((x) => [x, { length: 0, straits: [] }]));
  const open = [...from];
  while (open.length) {
    open.sort((x, y) => dist.get(x).length - dist.get(y).length);
    const cur = open.shift();
    const d = dist.get(cur);
    for (const [p, q, len, cp] of LANES) {
      const next = p === cur ? q : q === cur ? p : null;
      if (!next) continue;
      if (cp && !straitOpen(s, cp, a, b)) continue;
      const nd = d.length + len;
      if (nd < (dist.get(next)?.length ?? Infinity)) {
        dist.set(next, { length: nd, straits: cp ? [...d.straits, cp] : d.straits });
        open.push(next);
      }
    }
  }
  let best = null;
  for (const x of to) if (dist.has(x) && (!best || dist.get(x).length < best.length)) best = dist.get(x);
  return best;
}

// An overland route through countries not at war with either side: { hops, transit } or null
export function landRoute(s, a, b, maxHops = 10) {
  const start = Object.values(s.regions).filter((r) => r.ctrl === a).map((r) => r.id);
  const goal = (id) => s.regions[id]?.ctrl === b;
  const prev = new Map(start.map((id) => [id, null]));
  let frontier = start;
  for (let hop = 0; hop <= maxHops && frontier.length; hop++) {
    const next = [];
    for (const id of frontier) {
      for (const n of GEO[id].adj) {
        if (prev.has(n)) continue;
        const holder = s.regions[n]?.ctrl;
        if (!holder) continue;
        prev.set(n, id);
        if (goal(n)) {
          const transit = new Set();
          for (let x = prev.get(n); x && s.regions[x].ctrl !== a; x = prev.get(x)) transit.add(s.regions[x].ctrl);
          return { hops: hop + 1, transit: [...transit] };
        }
        if (atWar(s, holder, a) || atWar(s, holder, b)) continue;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/* ---------- Buying and selling ---------- */

// What minor nations pump or mine (computed once a week)
const prodCache = { week: -1, seed: null, map: new Map() };
function minorProd(s, id, r) {
  if (prodCache.week !== s.week || prodCache.seed !== s) {
    prodCache.week = s.week; prodCache.seed = s; prodCache.map = new Map();
    for (const reg of Object.values(s.regions)) {
      if (!s.minors[reg.ctrl]) continue;
      for (const [k, [cur]] of Object.entries(reg.res)) prodCache.map.set(`${reg.ctrl}|${k}`, (prodCache.map.get(`${reg.ctrl}|${k}`) ?? 0) + cur * (1 - reg.dmg));
    }
  }
  return prodCache.map.get(`${id}|${r}`) ?? 0;
}

const unitValue = (s, r) => (RESOURCE_INFO[r].value / 52) * s.market.price[r];
const keepWeeks = 6;

// What a seller will let go of, and on what terms: { qty, price (per unit), covert, why }
export function sellerTerms(s, buyerId, sellerId, r) {
  const seller = nation(s, sellerId);
  if (!seller || sellerId === buyerId || !alive(s, sellerId)) return { qty: 0, why: 'Not a seller.' };
  if (s.minors[sellerId]?.capitulated) return { qty: 0, why: 'Under occupation.' };
  if (atWar(s, buyerId, sellerId)) return { qty: 0, why: 'At war with you.' };
  const c = s.countries[sellerId];
  let qty;
  let markup = 0.04;
  if (c?.human) {
    const offer = c.offers?.[r];
    if (!offer || offer.qty <= 0) return { qty: 0, why: 'Its leader has nothing on offer.' };
    qty = Math.min(offer.qty, Math.max(0, c.stock[r] ?? 0));
    markup = offer.markup / 100;
  } else {
    const prod = c ? (c.prod[r] ?? 0) : minorProd(s, sellerId, r);
    const dem = c ? (c.demand[r] ?? 0) : prod * 0.25;
    // Exporters sell what they produce beyond their needs; others only let go of unusually large stockpiles
    qty = Math.max(0, prod - dem) * 4 + Math.max(0, (seller.stock[r] ?? 0) - Math.max(dem, 0.001) * 14);
    if (c) {
      const r0 = rel(s, buyerId, sellerId);
      if (r0 < -45) return { qty: 0, why: 'Refuses to trade with you.' };
      markup += Math.max(0, -r0) / 120;
    }
  }
  if (qty <= 0.0001) return { qty: 0, why: 'Nothing to spare.' };
  const banned = sanctioning(s, sellerId, buyerId) || sanctioning(s, buyerId, sellerId);
  const price = unitValue(s, r) * (1 + markup) * (banned ? 1.35 : 1);
  return { qty, price, covert: banned, why: banned ? 'Under sanctions: only through intermediaries, at a premium and a risk.' : null };
}


// How a cargo would travel: prefer a short land route, else the sea. Cached for the week.
const routeCache = { week: -1, seed: null, map: new Map() };
export function routeFor(s, from, to) {
  if (routeCache.week !== s.week || routeCache.seed !== s) { routeCache.week = s.week; routeCache.seed = s; routeCache.map = new Map(); }
  const key = `${from}>${to}`;
  if (routeCache.map.has(key)) return routeCache.map.get(key);
  const land = landRoute(s, from, to, 8);
  const sea = seaRoute(s, from, to);
  let out = null;
  if (land && (!sea || land.hops <= 6)) out = { mode: 'land', weeks: 1 + Math.ceil(land.hops / 4), transit: land.transit, straits: [] };
  else if (sea) out = { mode: 'sea', weeks: 1 + Math.ceil(sea.length / 2), transit: [], straits: sea.straits };
  routeCache.map.set(key, out);
  return out;
}

// For one leader's Market tab: the best few sellers of each resource, with their terms and route
export function marketView(s, cid) {
  const out = {};
  for (const r of RESOURCES) out[r] = topSellers(s, cid, r);
  return out;
}

// The cheapest open sellers of a resource to this buyer, plus a few who would only sell around sanctions
export function topSellers(s, cid, r) {
  {
    const list = [];
    for (const id of [...Object.keys(s.countries), ...Object.keys(s.minors)]) {
      if (id === cid || !alive(s, id)) continue;
      const t = sellerTerms(s, cid, id, r);
      if (t.qty > 0) list.push({ id, qty: Math.round(t.qty * 100) / 100, price: t.price, covert: Boolean(t.covert) });
    }
    list.sort((a, b) => a.price - b.price);
    const open = list.filter((x) => !x.covert).slice(0, 6);
    const shady = list.filter((x) => x.covert).slice(0, 3);
    return [...open, ...shady].map((x) => {
      const route = routeFor(s, x.id, cid);
      return { ...x, price: Math.round(x.price * 10000) / 10000, route: route ? { mode: route.mode, weeks: route.weeks, straits: route.straits, transit: route.transit } : null };
    });
  }
}

export function buy(s, c, { res, qty, from, covert }) {
  if (!RESOURCES.includes(res)) return 'Pick a resource.';
  qty = Number(qty);
  if (!(qty > 0)) return 'Pick an amount.';
  let sellerId = from;
  if (!from || from === 'world') {
    const best = (marketView(s, c.id)[res] ?? []).find((x) => !x.covert && x.route && x.qty >= qty * 0.5);
    if (!best) return 'No country will sell that much openly right now. Pick a seller, or buy less.';
    sellerId = best.id;
  }
  const t = sellerTerms(s, c.id, sellerId, res);
  if (!t.qty) return `${nameOf(s, sellerId)}: ${t.why}`;
  if (t.covert && !covert) return `${nameOf(s, sellerId)} is under sanctions with you. Tick "through intermediaries" to buy around them.`;
  qty = Math.min(qty, t.qty);
  const route = routeFor(s, sellerId, c.id);
  if (!route) return `There is no way to ship it: no open sea lane or land route from ${nameOf(s, sellerId)}.`;
  const cost = qty * t.price;
  if (cost > c.treasury) return `That costs ${money(cost)}; the treasury has ${money(c.treasury)}.`;
  c.treasury -= cost; // held in escrow until delivery
  const seller = nation(s, sellerId);
  seller.stock[res] = Math.max(0, (seller.stock[res] ?? 0) - qty);
  if (s.countries[sellerId]?.human && s.countries[sellerId].offers?.[res]) s.countries[sellerId].offers[res].qty = Math.max(0, s.countries[sellerId].offers[res].qty - qty);
  ship(s, { seller: sellerId, buyer: c.id, res, qty, cost, covert: t.covert, route });
  if (s.countries[sellerId]?.human) alert(s, sellerId, `${c.name} bought ${fmtQty(res, qty)} of your ${RESOURCE_INFO[res].name.toLowerCase()} for ${money(cost)}. Payment on delivery.`, 'good');
  return null;
}

export function sellToWorld(s, c, { res, qty }) {
  if (!RESOURCES.includes(res)) return 'Pick a resource.';
  qty = Math.min(Number(qty), c.stock[res] ?? 0);
  if (!(qty > 0)) return 'You have none of that in reserve.';
  const value = qty * unitValue(s, res) * 0.92;
  c.stock[res] -= qty;
  c.treasury += value;
  return null;
}

export function setOffer(s, c, { res, qty, markup }) {
  if (!RESOURCES.includes(res)) return 'Pick a resource.';
  qty = Math.max(0, Number(qty) || 0);
  markup = clamp(Math.round(Number(markup) || 0), -20, 200);
  c.offers ??= {};
  if (!qty) delete c.offers[res]; else c.offers[res] = { qty, markup };
  return null;
}

export function fmtQty(r, qty) {
  // Stock is counted in weeks of a yearly rate: show it as the actual volume
  const info = RESOURCE_INFO[r];
  const total = qty / 52;
  if (r === 'oil') return `${Math.round(qty * 7)} million barrels`;
  if (r === 'chip') return `${(total).toFixed(2)}% of a year's world chips`;
  return `${total >= 10 ? Math.round(total) : total.toFixed(total >= 1 ? 1 : 2)} ${info.unit}`;
}

/* ---------- Shipments ---------- */

export function ship(s, { seller, buyer, res, qty, cost, covert = false, route }) {
  s.shipments ??= [];
  const sh = {
    id: nextId(s, 'sh'), seller, buyer, res, qty, cost, covert, mode: route.mode, straits: route.straits, transit: route.transit,
    left: route.weeks, total: route.weeks, since: s.week,
  };
  s.shipments.push(sh);
  return sh;
}

// The navy a country can put on the water near a strait, if it can reach it
export const seaReach = (c) => (c.carriers > 0 ? 20000 : 1500 + c.ships * 25);
function nearestCoastKm(s, cid, targetId) {
  const t = GEO[targetId];
  let best = Infinity;
  for (const reg of Object.values(s.regions)) {
    if (!GEO[reg.id].coast) continue;
    if (reg.ctrl !== cid && !allied(s, reg.ctrl, cid)) continue;
    const g = GEO[reg.id];
    const d = Math.hypot((g.lon - t.lon) * Math.cos(((g.lat + t.lat) / 2) * Math.PI / 180), g.lat - t.lat) * 111;
    if (d < best) best = d;
  }
  return best;
}
function shipmentReach(s, c, sh) {
  if (sh.mode === 'land') return sh.transit.some((t) => t === c.id || allied(s, t, c.id));
  if (c.ships < 3) return false;
  const points = [sh.seller, sh.buyer].flatMap((n) => Object.values(s.regions).filter((r) => r.ctrl === n && GEO[r.id].coast).slice(0, 4).map((r) => r.id));
  for (const cp of sh.straits) points.push(CHOKEPOINTS[cp].regions[0]);
  return points.some((p) => nearestCoastKm(s, c.id, p) <= seaReach(c));
}

// Why this leader can't stop a cargo, or null if they can try
export function interceptProblem(s, c, sh) {
  if (!sh) return 'That shipment has arrived or been stopped.';
  if (sh.seller === c.id || sh.buyer === c.id) return 'That is your own trade.';
  if (allied(s, c.id, sh.buyer) || allied(s, c.id, sh.seller)) return 'You can\'t seize an ally\'s cargo.';
  if (sh.mode === 'sea' && c.ships < 3) return 'You need at least 3 warships.';
  if (!shipmentReach(s, c, sh)) return sh.mode === 'land' ? 'It doesn\'t cross your territory.' : 'Your navy can\'t reach its route. Carriers and more warships extend your reach.';
  return null;
}

export function orderIntercept(s, c, { id, how }) {
  const sh = (s.shipments ?? []).find((x) => x.id === id);
  const why = interceptProblem(s, c, sh);
  if (why) return why;
  if (!['seize', 'sink'].includes(how)) how = 'seize';
  sh.hunted ??= [];
  if (sh.hunted.some((x) => x.by === c.id)) return 'Your navy is already hunting it.';
  sh.hunted.push({ by: c.id, how });
  return null;
}

function navalStrength(c) {
  return (c?.ships ?? 0) * (0.6 + 0.08 * (c?.tech?.naval ?? 4)) + (c?.carriers ?? 0) * 6;
}

// Escorts: the buyer's and seller's patrols at the straits on the route, plus a share of their navies
function escortPower(s, sh) {
  let p = 0;
  for (const id of [sh.buyer, sh.seller]) {
    const c = s.countries[id];
    if (c) p += navalStrength(c) * 0.08;
  }
  for (const cp of sh.straits) {
    for (const [owner, pt] of Object.entries(s.chokepoints[cp].patrols ?? {})) {
      if (pt.mode !== 'escort') continue;
      if ([sh.buyer, sh.seller].some((x) => x === owner || allied(s, x, owner))) p += navalStrength({ ...s.countries[owner], ships: pt.ships, carriers: pt.carriers ?? 0 });
    }
  }
  return p;
}

function stop(s, sh, by, how, where) {
  const what = RESOURCE_INFO[sh.res].name.toLowerCase();
  const buyer = s.countries[sh.buyer];
  if (buyer) buyer.treasury += sh.cost; // the escrow comes back
  const seized = how === 'seize';
  const taker = nation(s, by);
  if (seized && taker) taker.stock[sh.res] = (taker.stock[sh.res] ?? 0) + sh.qty;
  const verb = seized ? 'seized' : 'sank';
  news(s, `${nameOf(s, by)} ${verb} a cargo of ${what} from ${nameOf(s, sh.seller)} to ${nameOf(s, sh.buyer)}${where ? ` ${where}` : ''}.`, 'trade', [by, sh.seller, sh.buyer]);
  alert(s, sh.seller, `${nameOf(s, by)} stopped your shipment of ${what} to ${nameOf(s, sh.buyer)}${where ? ` ${where}` : ''}. The cargo is lost.`, 'bad');
  alert(s, sh.buyer, `${nameOf(s, by)} stopped the shipment of ${what} from ${nameOf(s, sh.seller)} to us${where ? ` ${where}` : ''}. Our payment was refunded.`, 'bad');
  alert(s, by, seized
    ? `We seized ${fmtQty(sh.res, sh.qty)} of ${what} bound for ${nameOf(s, sh.buyer)} from ${nameOf(s, sh.seller)}.`
    : `We sank a ${what} cargo bound for ${nameOf(s, sh.buyer)} from ${nameOf(s, sh.seller)}.`, 'good');
  // Piracy in peacetime is an outrage
  for (const victim of [sh.buyer, sh.seller]) {
    if (!atWar(s, by, victim)) {
      addRel(s, by, victim, -18);
      const t = s.countries[by];
      if (t) t.rep = Math.max(0, t.rep - 3);
    }
  }
  if (!seized && (sh.res === 'oil' || sh.res === 'gas')) news(s, `An oil slick spreads${where ? ` ${where}` : ''} after the attack.`, 'disaster', [by]);
  sh.done = true;
}

/* ---------- Straits: closing, tolls, policies and patrols ---------- */

export const TOLLS = [0, 5, 10, 25, 50];

function straitHolders(s, key) {
  return [...new Set(CHOKEPOINTS[key].regions.map((r) => s.regions[r]?.ctrl).filter(Boolean))];
}

export function setToll(s, c, key, rate) {
  const cp = CHOKEPOINTS[key];
  if (!cp) return 'Unknown strait.';
  if (!straitHolders(s, key).includes(c.id)) return `You don't hold the shores of the ${cp.name}.`;
  rate = Number(rate);
  if (!TOLLS.includes(rate)) return 'Pick a toll.';
  const st = s.chokepoints[key];
  const before = st.toll?.rate ?? 0;
  st.toll = rate ? { by: c.id, rate } : null;
  if (rate > before) {
    news(s, `${c.name} demands a ${rate}% toll from every ship passing through the ${cp.name}.`, 'trade', [c.id]);
    c.rep = Math.max(0, c.rep - rate / 5);
    for (const o of Object.values(s.countries)) if (o.id !== c.id && !allied(s, o.id, c.id)) addRel(s, o.id, c.id, -rate / 4);
  } else if (!rate && before) news(s, `${c.name} drops its toll on the ${cp.name}.`, 'trade', [c.id]);
  return null;
}

export const STRAIT_POLICIES = { pass: 'Let all ships pass', seize: 'Seize enemy cargoes', sink: 'Attack enemy tankers and freighters' };
export function setStraitPolicy(s, c, key, policy) {
  const cp = CHOKEPOINTS[key];
  if (!cp) return 'Unknown strait.';
  if (!straitHolders(s, key).includes(c.id)) return `You don't hold the shores of the ${cp.name}.`;
  if (!STRAIT_POLICIES[policy]) return 'Pick a policy.';
  const st = s.chokepoints[key];
  st.policy = policy === 'pass' ? null : { by: c.id, kind: policy };
  if (policy !== 'pass') news(s, `${c.name} threatens ships of its enemies in the ${cp.name}.`, 'war', [c.id]);
  return null;
}

// What a patrol in a strait does. Patrols are fleets sent there (navy.js).
export const PATROL_MODES = { escort: 'Escort our and allied ships', enemies: "Stop our enemies' cargoes", all: 'Stop all traffic (except allies)' };

// Is a nation's trade through this strait blocked by someone's patrol?
export function patrolBlocks(s, key, nationId) {
  for (const [owner, pt] of Object.entries(s.chokepoints[key]?.patrols ?? {})) {
    if (owner === nationId || allied(s, owner, nationId)) continue;
    if (pt.mode === 'all') return owner;
    if (pt.mode === 'enemies' && (atWar(s, owner, nationId) || sanctioning(s, owner, nationId))) return owner;
  }
  return null;
}

/* ---------- The weekly tick ---------- */

export function tradeTick(s) {
  s.tradeFlows = worldFlows(s);
  s.shipments ??= [];
  for (const st of Object.values(s.chokepoints)) st.patrols ??= {};
  aiShipments(s);
  for (const sh of s.shipments) {
    if (sh.done) continue;
    sh.left -= 1;
    const where = (cp) => `in the ${CHOKEPOINTS[cp].name}`;
    // Orders to hunt it
    for (const h of sh.hunted ?? []) {
      const c = s.countries[h.by];
      if (!c || sh.done) continue;
      if (interceptProblem(s, c, sh)) continue;
      const mine = sh.mode === 'land' ? 10 : navalStrength(c) * 0.3;
      const p = sh.mode === 'land' ? 0.95 : clamp(mine / (mine + escortPower(s, sh) + 0.5), 0.15, 0.95);
      if (chance(s, p)) stop(s, sh, h.by, h.how, sh.mode === 'land' ? 'at the border' : sh.straits[0] ? where(sh.straits[0]) : 'at sea');
      else {
        alert(s, h.by, `Our attempt to stop a ${RESOURCE_INFO[sh.res].name.toLowerCase()} cargo bound for ${nameOf(s, sh.buyer)} failed: its escorts drove us off.`, 'warn');
        alert(s, sh.buyer, `${nameOf(s, h.by)} tried to stop a ${RESOURCE_INFO[sh.res].name.toLowerCase()} shipment bound for us. The escorts got it through.`, 'warn');
      }
    }
    sh.hunted = [];
    if (sh.done) continue;
    if (sh.mode === 'land') {
      for (const t of sh.transit) {
        if (atWar(s, t, sh.buyer) || atWar(s, t, sh.seller)) { stop(s, sh, t, 'seize', 'at the border'); break; }
        if ((sanctioning(s, t, sh.buyer) || sanctioning(s, t, sh.seller)) && chance(s, sh.covert ? 0.08 : 0.4)) { stop(s, sh, t, 'seize', 'at customs'); break; }
      }
    } else {
      // Blockades of the buyer or the seller
      for (const end of [sh.buyer, sh.seller]) {
        if (sh.done) break;
        for (const c of Object.values(s.countries)) {
          const ships = c.blockades?.[end];
          if (!ships || !atWar(s, c.id, end)) continue;
          if (chance(s, 0.35 * Math.min(1, ships / 20) / sh.total)) { stop(s, sh, c.id, 'seize', `off the coast of ${nameOf(s, end)}`); break; }
        }
      }
      for (const cp of sh.straits) {
        if (sh.done) break;
        const st = s.chokepoints[cp];
        // The shore's holder
        if (st.policy) {
          const by = st.policy.by;
          if ((atWar(s, by, sh.buyer) || atWar(s, by, sh.seller)) && chance(s, 0.55 / sh.total)) { stop(s, sh, by, st.policy.kind, where(cp)); break; }
        }
        // Patrolling navies
        for (const [owner, pt] of Object.entries(st.patrols)) {
          if (pt.mode === 'escort' || owner === sh.buyer || owner === sh.seller) continue;
          const target = [sh.buyer, sh.seller].some((x) => !allied(s, owner, x) && (pt.mode === 'all' || atWar(s, owner, x) || sanctioning(s, owner, x)));
          if (!target) continue;
          const mine = navalStrength({ ...s.countries[owner], ships: pt.ships, carriers: pt.carriers ?? 0 });
          if (chance(s, clamp(mine / (mine + escortPower(s, sh) + 1), 0.1, 0.9) / sh.total * 1.6)) { stop(s, sh, owner, 'seize', where(cp)); break; }
        }
      }
      // Sanctions-busting cargoes can be exposed
      if (!sh.done && sh.covert && chance(s, 0.05)) {
        const sanctioner = Object.keys(s.sanctions).filter((k) => s.sanctions[k] && (k.endsWith(`>${sh.buyer}`) || k.endsWith(`>${sh.seller}`))).map((k) => k.split('>')[0]).find((x) => s.countries[x] && navalStrength(s.countries[x]) > 5);
        if (sanctioner) {
          news(s, `Investigators expose a sanctions-busting ${RESOURCE_INFO[sh.res].name.toLowerCase()} trade between ${nameOf(s, sh.seller)} and ${nameOf(s, sh.buyer)} through shell companies.`, 'trade', [sh.seller, sh.buyer]);
          stop(s, sh, sanctioner, 'seize', 'on the high seas');
        }
      }
    }
    if (sh.done || sh.left > 0) continue;
    deliver(s, sh);
  }
  s.shipments = s.shipments.filter((x) => !x.done);
  straitsTick(s);
}

function deliver(s, sh) {
  const buyer = nation(s, sh.buyer);
  if (buyer) buyer.stock[sh.res] = (buyer.stock[sh.res] ?? 0) + sh.qty;
  let paid = sh.cost;
  // Tolls along the way
  for (const cp of sh.straits) {
    const toll = s.chokepoints[cp].toll;
    if (!toll || [sh.buyer, sh.seller].includes(toll.by) || allied(s, toll.by, sh.buyer)) continue;
    const fee = sh.cost * toll.rate / 100;
    const b = s.countries[sh.buyer];
    if (b) { b.treasury -= fee; b.tollsPaid = (b.tollsPaid ?? 0) + fee; }
    const t = s.countries[toll.by];
    if (t) { t.treasury += fee; t.tollIncome = (t.tollIncome ?? 0) + fee; }
  }
  const seller = s.countries[sh.seller];
  if (seller) seller.treasury += paid;
  sh.done = true;
  if (s.countries[sh.buyer]?.human) alert(s, sh.buyer, `Delivered: ${fmtQty(sh.res, sh.qty)} of ${RESOURCE_INFO[sh.res].name.toLowerCase()} from ${nameOf(s, sh.seller)}.`, 'good');
}

function straitsTick(s) {
  for (const [key, st] of Object.entries(s.chokepoints)) {
    const holders = straitHolders(s, key);
    if (st.toll && !holders.includes(st.toll.by)) { news(s, `The toll on the ${CHOKEPOINTS[key].name} ends: ${nameOf(s, st.toll.by)} no longer holds its shores.`, 'trade'); st.toll = null; }
    if (st.policy && !holders.includes(st.policy.by)) st.policy = null;
    // Tolls on the general flow of trade through the strait
    if (st.toll) {
      const t = s.countries[st.toll.by];
      const cp = CHOKEPOINTS[key];
      const users = cp.exportCut?.nations ?? cp.importCut?.nations ?? null;
      let flow = 0;
      for (const c of Object.values(s.countries)) {
        if (!alive(s, c.id) || c.id === st.toll.by || allied(s, c.id, st.toll.by)) continue;
        const share = users ? (users.includes(c.id) ? 1 : 0) : 0.12;
        if (!share) continue;
        let traded = 0;
        for (const r of RESOURCES) traded += Math.abs(c.net?.[r] ?? 0) * unitValue(s, r);
        const fee = traded * share * st.toll.rate / 100 * 0.5;
        c.treasury -= fee;
        c.tollsPaid = (c.tollsPaid ?? 0) + fee;
        flow += fee;
      }
      if (t) { t.treasury += flow; t.tollIncome = (t.tollIncome ?? 0) + flow; }
    }
  }
}

// Computer-run countries running short top up their stocks by buying from abroad
function aiShipments(s) {
  const buyers = Object.values(s.countries).filter((c) => !c.human && alive(s, c.id));
  for (let i = 0; i < 8; i++) {
    const c = pick(s, buyers);
    if (!c) return;
    const needs = RESOURCES.filter((r) => (c.demand[r] ?? 0) > (c.prod[r] ?? 0) && (c.stock[r] ?? 0) < (c.demand[r] ?? 0) * STOCK_WEEKS * (enemiesOf(s, c.id).size ? 1.6 : 1.05));
    if (!needs.length) continue;
    const r = pick(s, needs);
    const offer = topSellers(s, c.id, r).filter((x) => x.route && !s.countries[x.id]?.human && (!x.covert || c.gov !== 'democracy'))[0];
    if (!offer) continue;
    const qty = Math.min(offer.qty, (c.demand[r] ?? 0) * 2);
    if (qty <= 0 || qty * offer.price > c.treasury * 0.2) continue;
    c.treasury -= qty * offer.price;
    const seller = nation(s, offer.id);
    seller.stock[r] = Math.max(0, (seller.stock[r] ?? 0) - qty);
    ship(s, { seller: offer.id, buyer: c.id, res: r, qty, cost: qty * offer.price, covert: offer.covert, route: routeFor(s, offer.id, c.id) });
  }
}

export { CHOKEPOINTS };

/* ---------- The world's main trade flows (for the map) ---------- */

// The world market is one pool, so who ships to whom is estimated: each exporter's sales go to the importers in
// proportion to what they buy, more to nearer ones, never to an enemy, a country it sanctions or one under an oil
// embargo, and not by sea to a neighbour (that trade goes overland). Returns the biggest flows by value:
// [from, to, resource, $ billions a year].
export function worldFlows(s, limit = 48) {
  const live = Object.values(s.countries).filter((c) => !c.exile && c.net);
  // Where each country is: its richest province
  const where = new Map();
  for (const reg of Object.values(s.regions)) {
    const w = where.get(reg.ctrl);
    if (!w || reg.gdp > w.gdp) where.set(reg.ctrl, { gdp: reg.gdp, g: GEO[reg.id] });
  }
  const neighbours = new Map();
  for (const reg of Object.values(s.regions)) {
    for (const id of GEO[reg.id].adj) {
      const b = s.regions[id]?.ctrl;
      if (b && b !== reg.ctrl) (neighbours.get(reg.ctrl) ?? neighbours.set(reg.ctrl, new Set()).get(reg.ctrl)).add(b);
    }
  }
  const blocked = (a, b, r) => atWar(s, a, b) || s.sanctions[`${a}>${b}`] || s.sanctions[`${b}>${a}`] || neighbours.get(a)?.has(b)
    || (r === 'oil' && s.cartel?.embargo?.includes(b) && s.cartel.members?.includes(a));
  const out = [];
  for (const r of RESOURCES) {
    const value = RESOURCE_INFO[r].value * (s.market.price[r] ?? 1); // $B a year per unit of weekly volume
    const sellers = live.filter((c) => (c.net[r] ?? 0) > 0);
    const buyers = live.filter((c) => (c.net[r] ?? 0) < 0);
    const flows = [];
    for (const e of sellers) {
      const pe = where.get(e.id)?.g;
      if (!pe) continue;
      const weights = [];
      let total = 0;
      for (const i of buyers) {
        const pi = where.get(i.id)?.g;
        if (!pi || blocked(e.id, i.id, r)) continue;
        const km = Math.max(800, Math.hypot((pe.lon - pi.lon) * Math.cos(((pe.lat + pi.lat) / 2) * Math.PI / 180), pe.lat - pi.lat) * 111);
        const w = -i.net[r] / Math.sqrt(km);
        weights.push([i.id, w]);
        total += w;
      }
      for (const [to, w] of weights) flows.push([e.id, to, r, e.net[r] * (w / total) * value]);
    }
    flows.sort((a, b) => b[3] - a[3]);
    out.push(...flows.slice(0, 10));
  }
  return out.sort((a, b) => b[3] - a[3]).slice(0, limit).map(([a, b, r, v]) => [a, b, r, Math.round(v * 10) / 10]);
}
