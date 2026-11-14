// One game: the state plus the weekly tick, commands and what each leader is allowed to see.

import { ORDER } from './data/geo.js';
import { RESOURCES } from './data/regions.js';
import { createState } from './setup.js';
import { allied, nation, isMinor, dateLabel, news } from './core.js';
import { marketTick, economyTick, debtRatio, upkeep, blockadeEffect } from './economy.js';
import { militaryTick, militaryStep, garrisons, marchSpeed } from './military.js';
import { diplomacyTick } from './diplomacy.js';
import { aiTick, militaryPower, lostShare } from './ai.js';
import { eventsTick } from './events.js';
import { runCommand } from './commands.js';
import { governmentTick, initGovernment } from './government.js';
import { tradeTick, marketView } from './trade.js';
import { spiesTick, initSpies } from './spies.js';
import { initRange } from './science.js';
import { initFleets, fleetsFor, applyFleets } from './navy.js';
import { initPeoples, peoplesTick, loyaltyTarget } from './peoples.js';
import { aidTick, aidFor } from './proxy.js';
import { initEnergy, energyTick, energyView } from './energy.js';
import { initClimate, climateTick, climateView, pledgePath } from './climate.js';
import { initSpace, spaceTick, spaceOf, satSees } from './space.js';

export class Game {
  constructor(state) {
    this.s = state;
    this.cache = null;
    upgrade(state);
  }

  static create({ seed } = {}) {
    const s = createState({ seed });
    Object.values(s.countries).forEach((c, i) => { c.ai.next = i % 4; initGovernment(c); initSpies(c); initRange(c); });
    initFleets(s);
    applyFleets(s);
    initPeoples(s);
    initEnergy(s);
    initClimate(s);
    initSpace(s);
    news(s, `${dateLabel(0)}: a new year begins in a tense, divided world.`, 'info');
    return new Game(s);
  }

  setLeader(cid, name) {
    const c = this.s.countries[cid];
    if (c) c.human = name ? { name } : null;
    this.cache = null;
  }

  // Many times a week: armies march and battles are fought in real time. dt is a fraction of a week; the
  // steps never run more than a week ahead of the weekly tick.
  step(dt) {
    const s = this.s;
    if (s.over) return;
    dt = Math.min(dt, 1 - (s.stepped ?? 0));
    if (!(dt > 0.0005)) return;
    militaryStep(s, dt);
    s.stepped = (s.stepped ?? 0) + dt;
    this.cache = null;
  }

  tick() {
    const s = this.s;
    if (s.over) return;
    s.week++;
    aiTick(s);
    diplomacyTick(s);
    energyTick(s);
    const world = marketTick(s);
    economyTick(s, world);
    tradeTick(s);
    climateTick(s);
    spaceTick(s);
    // Whatever part of the week the real-time steps didn't cover (all of it, without a running clock)
    militaryStep(s, Math.max(0, 1 - (s.stepped ?? 0)));
    s.stepped = 0;
    militaryTick(s);
    governmentTick(s, garrisons(s));
    peoplesTick(s);
    aidTick(s);
    spiesTick(s);
    eventsTick(s);
    // There is no time limit: the game ends only when one country rules every province in the world
    const conqueror = worldConqueror(s);
    if (conqueror) this.finish(conqueror);
    this.cache = null;
  }

  finish(winner) {
    const s = this.s;
    if (s.over) return;
    s.over = true;
    s.winner = winner;
    s.final = rankings(s);
    news(s, `${dateLabel(s.week)}: ${nation(s, winner)?.name ?? winner} has conquered the entire world.`, 'info');
  }

  command(cid, cmd) {
    const err = runCommand(this.s, cid, cmd);
    this.cache = null;
    return err;
  }

  drain() {
    const fresh = this.s.fresh;
    this.s.fresh = [];
    return fresh;
  }

  shared() {
    if (!this.cache) this.cache = { gar: garrisons(this.s), ranks: rankings(this.s) };
    return this.cache;
  }

  view(cid) {
    return view(this.s, cid, this.shared());
  }

  // Between full updates: just the armies this leader can see and the battles, to animate the war in real time
  live(cid) {
    const s = this.s;
    const battles = [];
    ORDER.forEach((id, i) => {
      const b = s.regions[id].battle;
      if (b) battles.push([i, b.by, r0(b.prog), b.from ?? 0]);
    });
    // Only the fleets that are moving or fighting change between weekly updates: [id, at, next, prog, len,
    // ships, battle]. (A fleet that forms, sinks or withdraws makes news, which sends everyone the full state.)
    const changed = new Set(Object.values(s.fleets ?? {}).filter((f) => f.path.length || f.reachedStep === s.stepNo).map((f) => f.id));
    const fleets = fleetsFor(s, cid, { seen: satSees(s, cid) }).filter((f) => changed.has(f.id) || f.battle).map((f) => [f.id, f.at, f.next, f.prog, f.len, f.ships, f.battle ? 1 : 0]);
    return { type: 'live', week: s.week, armies: armiesFor(s, cid), fleetMoves: fleets, battles };
  }
}

// Every army is on everyone's map: their own and their allies' in full, everyone else's in rough figures
// (exact figures with four spy satellites, everything with spies inside their government)
function armiesFor(s, cid) {
  const me = s.countries[cid] ?? null;
  const knows = (id) => id === cid || (me && (me.intel[id] ?? -1) > s.week);
  const friend = (id) => id === cid || (me && allied(s, cid, id));
  // Spy satellites count every army on Earth, though they can't read its orders
  const seen = satSees(s, cid);
  return Object.values(s.armies).map((a) => {
    const own = friend(a.owner) || knows(a.owner);
    return own
      ? { id: a.id, owner: a.owner, name: a.name, region: a.region, troops: r1(a.troops), tanks: r0(a.tanks), org: r0(a.org), supply: r1(a.supply), gen: a.gen, op: a.op, path: a.path, speed: Math.round(marchSpeed(s, a) / 10) * 10, sea: a.sea ? { ...a.sea, left: Math.max(0, Math.ceil(a.sea.left * 10) / 10) } : null, status: a.status, attacking: a.attacking, exact: true }
      : { id: a.id, owner: a.owner, name: a.name, region: a.region, troops: seen ? r0(a.troops) : approx(a.troops, 5), tanks: seen ? r0(a.tanks) : approx(a.tanks, 50), gen: { name: a.gen.name }, sea: a.sea ? { to: a.sea.to } : null, attacking: a.attacking, exact: false, seen };
  });
}

/* ---------- Saved games from before a system existed ---------- */

// Adds whatever an older saved game is missing, so it carries on under the current rules
function upgrade(s) {
  if (!s.fleets) { initFleets(s); applyFleets(s); }
  if (Object.values(s.regions).some((r) => r.people == null)) initPeoples(s);
  s.aid ??= [];
  if (!s.pipelines) initEnergy(s);
  initClimate(s);
  initSpace(s);
}

/* ---------- Rankings ---------- */

// The one country that owns every province on the map, if there is one
export function worldConqueror(s) {
  let owner = null;
  for (const reg of Object.values(s.regions)) {
    if (owner === null) owner = reg.owner;
    else if (reg.owner !== owner) return null;
  }
  return owner && s.countries[owner] ? owner : null;
}

export function rankings(s) {
  const list = Object.values(s.countries).filter((c) => !c.exile);
  const maxG = Math.max(...list.map((c) => c.gdp), 1);
  const maxM = Math.max(...list.map((c) => militaryPower(s, c.id)), 1);
  const startProvinces = {};
  for (const reg of Object.values(s.regions)) if (!isMinor(reg.id)) startProvinces[reg.id.split('-')[0]] = (startProvinces[reg.id.split('-')[0]] ?? 0) + 1;
  const rows = Object.values(s.countries).map((c) => {
    const held = Object.values(s.regions).filter((r) => r.owner === c.id).length;
    const power = c.exile ? 0 : 100 * (0.45 * Math.sqrt(c.gdp / maxG) + 0.35 * Math.sqrt(militaryPower(s, c.id) / maxM) + 0.1 * c.stability / 100 + 0.1 * c.rep / 100);
    return {
      id: c.id, power: Math.round(power * 10) / 10, gdp: Math.round(c.gdp), growth: Math.round((c.gdp / c.history.gdp[0] - 1) * 1000) / 10,
      provinces: held, gained: held - (startProvinces[c.id] ?? 0), human: c.human?.name ?? null, exile: c.exile,
    };
  });
  rows.sort((a, b) => b.power - a.power);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/* ---------- What one leader sees ---------- */

const r1 = (v) => Math.round(v * 10) / 10;
const r0 = (v) => Math.round(v);
const approx = (v, step) => Math.round(v / step) * step;

export function view(s, cid, { gar, ranks }) {
  const me = s.countries[cid] ?? null;
  const knows = (id) => id === cid || (me && (me.intel[id] ?? -1) > s.week);
  const friend = (id) => id === cid || (me && allied(s, cid, id));
  const countries = {};
  for (const c of Object.values(s.countries)) {
    const open = knows(c.id);
    countries[c.id] = {
      name: c.name, title: c.title, gov: c.gov, human: c.human?.name ?? null, exile: c.exile,
      gdp: r0(c.gdp), growth: r1(c.growth ?? c.trend), pop: r1(c.pop), infl: r1(c.infl), debt: r0(debtRatio(c)),
      approval: c.gov !== 'autocracy' || open ? r0(c.approval) : null,
      conscription: c.conscription, security: c.security, press: c.press, civilWar: Boolean(c.civilWar),
      protests: (c.protests ?? []).filter((p) => p.size >= 15 || open).map((p) => ({ cause: p.cause, size: r0(p.size) })),
      dead: r0(c.dead ?? 0),
      stability: open ? r0(c.stability) : null,
      rep: r0(c.rep), mob: c.mob, rate: c.rate, tax: c.tax,
      mil: { troops: r0(c.troops), tanks: r0(c.tanks), aircraft: r0(c.aircraft), ships: r0(c.ships), carriers: c.carriers, missiles: r0(c.missiles), nukes: c.nukes },
      nukeProgram: c.nukeProgram.on ? (open ? r1(c.nukeProgram.progress * 100) : true) : false,
      treasury: open ? r0(c.treasury) : null,
      tech: open || friend(c.id) ? c.tech : null,
      range: open || friend(c.id) ? c.range : null,
      research: open ? (c.research ?? []).map((x) => ({ field: x.field, level: x.level, left: Math.ceil(x.left) })) : null,
      queue: open && c.id !== cid ? c.queue.map((o) => ({ kind: o.kind, qty: o.qty, left: Math.ceil(o.left) })) : null,
      intel: open && c.id !== cid,
      power: r0(militaryPower(s, c.id)),
      lost: r1(lostShare(s, c.id) * 100),
      blockaded: r0(blockadeEffect(s, c.id) * 100),
      space: spaceOf(c),
      emissions: r1(c.emissions ?? 0), carbonTax: c.carbonTax ?? 0, pledge: c.pledge ? { cut: c.pledge.cut, year: c.pledge.year, done: c.pledge.done, onTrack: c.pledge.done ? null : (c.emissions ?? 0) <= (pledgePath(s, c) ?? Infinity) * 1.05 } : null,
    };
  }
  const minors = {};
  for (const m of Object.values(s.minors)) {
    minors[m.id] = { name: m.name, troops: r0(m.troops), gdp: r0(m.gdp), pop: r1(m.pop), puppetOf: m.puppetOf, capitulated: m.capitulated, annexed: m.annexed, guarantor: m.guarantor, nukes: m.nukes, settle: m.pendingSettle?.by === cid, home: m.home ?? null, breakaway: m.breakaway ?? null };
  }

  const regions = ORDER.map((id) => {
    const r = s.regions[id];
    const g = gar.get(id);
    return [r.owner, r.ctrl, r0(r.dmg * 100), r.infra, r.fort, r.battle?.by ?? 0, r0(r.battle?.prog ?? 0), r0(r.unrest), g ? r0(g.troops) : 0, r1(r.gdp), r1(r.pop), r.revolt ? r1(r.revolt.rebels) : 0, r.battle?.from ?? 0, r0(r.loyalty ?? 50), r.policy ?? 'integrate', r.people ?? r.owner];
  });
  const resources = {};
  for (const id of ORDER) {
    const r = s.regions[id];
    if (Object.keys(r.res).length) resources[id] = r.res;
  }

  const armies = armiesFor(s, cid);
  const fleets = fleetsFor(s, cid, { seen: satSees(s, cid) });

  const mine = (t) => t.a === cid || t.b === cid;
  return {
    type: 'state',
    week: s.week, date: dateLabel(s.week), provinces: ORDER.length, over: s.over, winner: s.winner ?? null, final: s.final,
    me: cid,
    you: me ? own(s, me) : null,
    countries, minors, regions, resources, armies, fleets, ranks, aid: aidFor(s, cid), ...energyView(s, cid), climate: climateView(s), space: { debris: Math.round((s.space?.debris ?? 0) * 100), firsts: s.space?.firsts ?? {} },
    wars: s.wars.map((w) => ({ id: w.id, a: w.a, b: w.b, since: w.since, goal: w.goal, lossA: r1(w.lossA), lossB: r1(w.lossB) })),
    alliances: Object.values(s.alliances).filter((al) => !al.secret || !me || al.members.includes(cid) || al.members.some((m) => knows(m))),
    treaties: s.treaties.filter((t) => ['fta', 'nap', 'access', 'armistice'].includes(t.kind) || mine(t)),
    sanctions: Object.keys(s.sanctions).filter((k) => s.sanctions[k]),
    tariffs: s.tariffs,
    proposals: Object.values(s.proposals).filter((p) => p.to === cid || p.from === cid),
    un: s.un.map((r) => ({ ...r, votes: r.done ? r.votes : { [cid]: r.votes[cid] ?? null }, count: Object.keys(r.votes).length })),
    market: { price: s.market.price, history: s.market.history, offer: s.market.offer, bid: s.market.bid, sellers: me ? marketView(s, cid) : {} },
    chokepoints: s.chokepoints,
    shipments: (s.shipments ?? []).filter((x) => !x.covert || x.buyer === cid || x.seller === cid || knows(x.buyer) || knows(x.seller))
      .map((x) => ({ id: x.id, seller: x.seller, buyer: x.buyer, res: x.res, qty: x.qty, cost: r1(x.cost), mode: x.mode, straits: x.straits, transit: x.transit, left: x.left, total: x.total, covert: x.covert })),
    rel: me ? Object.fromEntries(Object.keys(s.countries).map((id) => [id, r0(s.rel[id < cid ? `${id}|${cid}` : `${cid}|${id}`] ?? (id === cid ? 100 : 0))])) : {},
    news: s.news.slice(-150),
    winter: s.winterUntil > s.week,
    nukesUsed: s.nukesUsed,
  };
}

function own(s, c) {
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  const out = pick(c, [
    'id', 'name', 'gov', 'title', 'gdp', 'pot', 'pop', 'growth', 'trend', 'treasury', 'debt', 'milFunds', 'tax', 'spend', 'rate',
    'infl', 'bond', 'approval', 'stability', 'rep', 'base', 'mob', 'mobTroops', 'reserves', 'troops', 'tanks', 'aircraft', 'ships',
    'carriers', 'missiles', 'nukes', 'losses', 'warWeariness', 'tech', 'focus', 'progress', 'stock', 'prod', 'demand', 'short', 'net',
    'queue', 'projects', 'nukeProgram', 'intel', 'cooldown', 'claims', 'electionWeek', 'exile', 'blockades', 'airOps', 'history',
    'deficit', 'revenue', 'spending', 'interest', 'upkeep', 'ration', 'martial', 'stimulus', 'readiness', 'rally', 'windfall',
    'conscription', 'conscripts', 'security', 'press', 'protests', 'threat', 'draftDrag', 'protestDrag', 'strike', 'civilWar', 'rebels',
    'research', 'range', 'rangeWork', 'counterIntel', 'caught', 'sweepUntil', 'logistics', 'offers', 'tollIncome', 'tollsPaid', 'dead', 'boost', 'warCases', 'blockadeCarriers',
    'refugees', 'refugeeCost', 'refugeesFrom', 'borderClosed', 'refitUntil', 'cartelCheat', 'cartelCaught', 'releasing', 'carbonTax', 'carbonEffect', 'carbonRevenue', 'emissions',
  ]);
  out.spies = Object.fromEntries(Object.entries(c.spies ?? {}).map(([k, n]) => [k, { agents: n.agents, since: n.since }]));
  out.reports = (c.reports ?? []).slice(-120).map(({ turned, ...r }) => r);
  out.inbox = c.inbox.slice(-80);
  // Why each of our provinces is as loyal as it is, and its referendum history
  out.provinces = {};
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== c.id) continue;
    const t = loyaltyTarget(s, reg);
    out.provinces[reg.id] = { target: r0(t.value), why: t.why.filter(([d]) => Math.abs(d) >= 1).map(([d, text]) => [r0(d), text]), referendumAt: reg.referendumAt ?? null, placatedUntil: reg.placatedUntil ?? null };
  }
  out.space = c.space ? { ...spaceOf(c), building: c.space.building.map((b) => ({ ...b })) } : null;
  out.pledgeDetail = c.pledge ? { ...c.pledge, path: pledgePath(s, c) } : null;
  out.debtRatio = r0(debtRatio(c));
  out.weeklyUpkeep = upkeep(s, c);
  return out;
}

export { RESOURCES, nation };
