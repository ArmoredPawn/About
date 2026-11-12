// One game: the state plus the weekly tick, commands and what each leader is allowed to see.

import { ORDER } from './data/geo.js';
import { RESOURCES } from './data/regions.js';
import { createState } from './setup.js';
import { alive, allied, nation, isMinor, dateLabel, news } from './core.js';
import { marketTick, economyTick, debtRatio, upkeep, blockadeEffect } from './economy.js';
import { militaryTick, garrisons } from './military.js';
import { diplomacyTick } from './diplomacy.js';
import { aiTick, militaryPower, lostShare } from './ai.js';
import { eventsTick } from './events.js';
import { runCommand } from './commands.js';

export const YEAR_OPTIONS = [2, 5, 10, 25];

export class Game {
  constructor(state) {
    this.s = state;
    this.cache = null;
  }

  static create({ seed, years = 5 } = {}) {
    const s = createState({ seed, years });
    Object.values(s.countries).forEach((c, i) => { c.ai.next = i % 4; });
    news(s, `${dateLabel(0)}: a new year begins in a tense, divided world.`, 'info');
    return new Game(s);
  }

  setLeader(cid, name) {
    const c = this.s.countries[cid];
    if (c) c.human = name ? { name } : null;
    this.cache = null;
  }

  tick() {
    const s = this.s;
    if (s.over) return;
    s.week++;
    aiTick(s);
    diplomacyTick(s);
    const world = marketTick(s);
    economyTick(s, world);
    militaryTick(s);
    eventsTick(s);
    if (s.week >= s.settings.years * 52 || !Object.values(s.countries).some((c) => c.human && alive(s, c.id))) this.finish();
    this.cache = null;
  }

  finish() {
    const s = this.s;
    if (s.over) return;
    s.over = true;
    s.final = rankings(s);
    news(s, `${dateLabel(s.week)}: the game is over.`, 'info');
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
}

/* ---------- Rankings ---------- */

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
      stability: open ? r0(c.stability) : null,
      rep: r0(c.rep), mob: c.mob, rate: c.rate, tax: c.tax,
      mil: { troops: r0(c.troops), tanks: r0(c.tanks), aircraft: r0(c.aircraft), ships: r0(c.ships), carriers: c.carriers, missiles: r0(c.missiles), nukes: c.nukes },
      nukeProgram: c.nukeProgram.on ? (open ? r1(c.nukeProgram.progress * 100) : true) : false,
      treasury: open ? r0(c.treasury) : null,
      tech: open || friend(c.id) ? c.tech : null,
      intel: open && c.id !== cid,
      power: r0(militaryPower(s, c.id)),
      lost: r1(lostShare(s, c.id) * 100),
      blockaded: r0(blockadeEffect(s, c.id) * 100),
    };
  }
  const minors = {};
  for (const m of Object.values(s.minors)) {
    minors[m.id] = { name: m.name, troops: r0(m.troops), gdp: r0(m.gdp), pop: r1(m.pop), puppetOf: m.puppetOf, capitulated: m.capitulated, annexed: m.annexed, guarantor: m.guarantor, nukes: m.nukes, settle: m.pendingSettle?.by === cid };
  }

  const regions = ORDER.map((id) => {
    const r = s.regions[id];
    const g = gar.get(id);
    return [r.owner, r.ctrl, r0(r.dmg * 100), r.infra, r.fort, r.battle?.by ?? 0, r0(r.battle?.prog ?? 0), r0(r.unrest), g ? r0(g.troops) : 0, r1(r.gdp), r1(r.pop)];
  });
  const resources = {};
  for (const id of ORDER) {
    const r = s.regions[id];
    if (Object.keys(r.res).length) resources[id] = r.res;
  }

  const armies = Object.values(s.armies).map((a) => {
    const own = friend(a.owner) || knows(a.owner);
    return own
      ? { id: a.id, owner: a.owner, name: a.name, region: a.region, troops: r1(a.troops), tanks: r0(a.tanks), org: r0(a.org), supply: r1(a.supply), gen: a.gen, op: a.op, path: a.path, sea: a.sea, status: a.status, attacking: a.attacking, exact: true }
      : { id: a.id, owner: a.owner, name: a.name, region: a.region, troops: approx(a.troops, 5), tanks: approx(a.tanks, 50), gen: { name: a.gen.name }, sea: a.sea ? { to: a.sea.to } : null, attacking: a.attacking, exact: false };
  });

  const mine = (t) => t.a === cid || t.b === cid;
  return {
    type: 'state',
    week: s.week, date: dateLabel(s.week), years: s.settings.years, over: s.over, final: s.final,
    me: cid,
    you: me ? own(s, me) : null,
    countries, minors, regions, resources, armies, ranks,
    wars: s.wars.map((w) => ({ id: w.id, a: w.a, b: w.b, since: w.since, goal: w.goal, lossA: r1(w.lossA), lossB: r1(w.lossB) })),
    alliances: Object.values(s.alliances),
    treaties: s.treaties.filter((t) => ['fta', 'nap', 'access', 'armistice'].includes(t.kind) || mine(t)),
    sanctions: Object.keys(s.sanctions).filter((k) => s.sanctions[k]),
    tariffs: s.tariffs,
    proposals: Object.values(s.proposals).filter((p) => p.to === cid || p.from === cid),
    un: s.un.map((r) => ({ ...r, votes: r.done ? r.votes : { [cid]: r.votes[cid] ?? null }, count: Object.keys(r.votes).length })),
    market: { price: s.market.price, history: s.market.history },
    chokepoints: s.chokepoints,
    rel: me ? Object.fromEntries(Object.keys(s.countries).map((id) => [id, r0(s.rel[id < cid ? `${id}|${cid}` : `${cid}|${id}`] ?? (id === cid ? 100 : 0))])) : {},
    news: s.news.slice(-60),
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
  ]);
  out.inbox = c.inbox.slice(-80);
  out.debtRatio = r0(debtRatio(c));
  out.weeklyUpkeep = upkeep(s, c);
  return out;
}

export { RESOURCES, nation };
