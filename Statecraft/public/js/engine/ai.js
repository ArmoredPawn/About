// Countries no player leads. They run sensible budgets, judge proposals on their merits, defend themselves,
// honour alliances and make peace when a war goes badly. They never start wars of conquest themselves.

import { GEO } from './data/geo.js';
import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import {
  clamp, rand, chance, pick, alive, atWar, allied, enemiesOf, rel, nameOf, nation, alliancesOf, treaty, addRel, news,
  sanctioning, warBetween,
} from './core.js';
import { BUILD, PROJECT_WEEKS, maxOrders, maxProjects, costFactor, debtRatio, debtLimit, navalPower } from './economy.js';
import { createArmy, orderArmy, freeForces, garrisons, defenceEstimate, armyAttackEstimate, route, setBlockade, setAirCampaign, missileStrike, settleMinor } from './military.js';
import { respond, propose, makePeace, setTariff, setChokepoint } from './diplomacy.js';

export function militaryPower(s, id) {
  const c = s.countries[id];
  if (!c) {
    const m = s.minors[id];
    return m ? m.troops * 0.55 : 0;
  }
  return (c.troops + c.tanks * 0.05) * (0.6 + 0.08 * c.tech.army) + c.aircraft * 0.6 * (0.6 + 0.08 * c.tech.air) + navalPower(c) * 2;
}

// Share of a nation's people living under enemy occupation
export function lostShare(s, id) {
  let lost = 0;
  let total = 0;
  for (const reg of Object.values(s.regions)) {
    if (reg.owner !== id) continue;
    total += reg.pop + 0.1;
    if (reg.ctrl !== id) lost += reg.pop + 0.1;
  }
  return total ? lost / total : 0;
}

export function aiTick(s) {
  const gar = garrisons(s);
  for (const c of Object.values(s.countries)) {
    if (c.human || !alive(s, c.id)) continue;
    answerProposals(s, c);
    if ((s.week + c.ai.next) % 4 === 0) economy(s, c);
    if (enemiesOf(s, c.id).size) war(s, c, gar);
    else if (c.mob > 0 && (s.week + c.ai.next) % 8 === 0) c.mob -= 1;
  }
  for (const m of Object.values(s.minors)) {
    if (m.pendingSettle && m.pendingSettle.until <= s.week) settleMinor(s, m.pendingSettle.by, m.id, 'puppet');
  }
}

/* ---------- Budgets ---------- */

function economy(s, c) {
  const b = c.base;
  if ((c.deficit ?? 0) > 6 && debtRatio(c) > debtLimit(c) * 0.7 && c.tax < b.tax + 6) c.tax = Math.round((c.tax + 0.5) * 10) / 10;
  if ((c.deficit ?? 0) < 0 && c.tax > b.tax - 3) c.tax = Math.round((c.tax - 0.3) * 10) / 10;
  if (c.infl > b.infl + 3) c.rate = Math.round((c.rate + 0.5) * 100) / 100;
  else if (c.infl < b.infl + 0.5 && c.growth < c.trend - 1 && c.rate > 0.25) c.rate = Math.round((c.rate - 0.25) * 100) / 100;
  const atWar_ = enemiesOf(s, c.id).size > 0;
  const wantDefence = atWar_ ? Math.min(b.spend.defence * 2 + 2, 12) : b.spend.defence;
  c.spend.defence = Math.round((c.spend.defence + clamp(wantDefence - c.spend.defence, -0.3, 0.6)) * 10) / 10;

  // Buy equipment with spare defence money
  if (c.milFunds > c.gdp * 0.004 && c.queue.length < maxOrders(c)) {
    const options = atWar_ ? ['tanks', 'tanks', 'troops', 'aircraft', 'missiles'] : ['tanks', 'aircraft', 'missiles', 'ships', 'troops'];
    const kind = pick(s, options);
    const cost = BUILD[kind].cost * costFactor(c);
    if (c.milFunds >= cost) {
      c.milFunds -= cost;
      c.queue.push({ id: `q${s.nextId++}`, kind, qty: BUILD[kind].batch, left: BUILD[kind].weeks, total: BUILD[kind].weeks });
    }
  }
  // Develop untapped resources now and then
  if (!atWar_ && c.treasury > c.gdp * 0.03 && c.projects.length < maxProjects(c) && chance(s, 0.25)) {
    const sites = [];
    for (const reg of Object.values(s.regions)) {
      if (reg.owner !== c.id || reg.ctrl !== c.id) continue;
      for (const [r, [cur, pot]] of Object.entries(reg.res)) if (pot > cur && !c.projects.some((p) => p.region === reg.id && p.res === r)) sites.push([reg, r, pot - cur]);
    }
    if (sites.length) {
      const [reg, r, delta] = pick(s, sites);
      const cost = delta * RESOURCE_INFO[r].value * 0.8 * costFactor(c);
      if (c.treasury > cost * 2) {
        c.treasury -= cost;
        c.projects.push({ id: `pj${s.nextId++}`, kind: 'develop', region: reg.id, res: r, left: PROJECT_WEEKS[r], total: PROJECT_WEEKS[r] });
      }
    }
  }
  // Tit-for-tat on tariffs
  for (const [key, level] of Object.entries(s.tariffs)) {
    const [a, b2] = key.split('>');
    if (b2 === c.id && (s.tariffs[`${c.id}>${a}`] ?? 0) < level && chance(s, 0.6)) setTariff(s, c, a, level);
  }
}

/* ---------- Proposals ---------- */

function answerProposals(s, c) {
  for (const p of Object.values(s.proposals)) {
    if (p.to !== c.id) continue;
    if (s.week - p.week < 1 && p.kind !== 'callToArms') continue; // a week to think it over
    respond(s, c.id, p.id, judge(s, c, p));
  }
}

function judge(s, c, p) {
  const r = rel(s, c.id, p.from);
  const t = p.terms;
  switch (p.kind) {
    case 'alliance': {
      const al = s.alliances[t.alliance];
      if (!al) return false;
      const dislike = al.members.some((m) => rel(s, c.id, m) < -20 || atWar(s, c.id, m));
      return !dislike && r >= (al.kind === 'military' ? 45 : 20);
    }
    case 'fta': return r >= 5 && !sanctioning(s, c.id, p.from) && !sanctioning(s, p.from, c.id);
    case 'nap': return r >= -30;
    case 'access': return r >= 40;
    case 'deal': {
      const value = Number(t.qty) * RESOURCE_INFO[t.res].value * s.market.price[t.res];
      const price = Number(t.price);
      if (r < -20) return false;
      if (t.seller === c.id) {
        const spare = (c.prod[t.res] ?? 0) - (c.demand[t.res] ?? 0);
        return price >= value * 0.95 && (spare >= Number(t.qty) * 0.8 || (c.stock[t.res] ?? 0) > Number(t.qty) * 12);
      }
      const need = (c.demand[t.res] ?? 0) - (c.prod[t.res] ?? 0);
      return price <= value * 1.1 && (need > 0 || (c.short[t.res] ?? 0) > 0);
    }
    case 'loan': return r >= -10 && (c.treasury < c.gdp * 0.02 || (c.deficit ?? 0) > 5) && t.rate <= c.bond + 1.5;
    case 'peace': return judgePeace(s, c, p);
    case 'joinWar': {
      const enemy = t.enemy;
      return r >= 60 && rel(s, c.id, enemy) <= -40 && militaryPower(s, c.id) > militaryPower(s, enemy) * 0.4;
    }
    default: return false;
  }
}

function judgePeace(s, c, p) {
  const t = p.terms;
  const war = warBetween(s, c.id, p.from);
  if (!war) return false;
  const age = s.week - war.since;
  const mine = militaryPower(s, c.id);
  const theirs = militaryPower(s, p.from) + 1;
  const ratio = mine / theirs;
  const iLost = lostShare(s, c.id);
  const theyLost = lostShare(s, p.from);
  const giving = (t.cede ?? []).filter((x) => x.to !== c.id);
  const getting = (t.cede ?? []).filter((x) => x.to === c.id);
  const paying = t.reparations?.from === c.id ? Number(t.reparations.amount) : 0;
  if (!giving.length && !paying) {
    if (getting.length || t.reparations?.from === p.from) return true;
    if (t.armistice) return age >= 8 && (ratio < 1.6 || iLost > theyLost);
    return age >= 4 && (theyLost <= iLost + 0.05 || ratio < 1.2);
  }
  if (age < 6) return false;
  const occupied = giving.every((x) => s.regions[x.region]?.ctrl === x.to);
  const desperate = iLost >= 0.3 || ratio < 0.35;
  const losing = iLost >= 0.12 || ratio < 0.6;
  if (paying > c.gdp * 0.03 && !desperate) return false;
  return (occupied && losing) || desperate;
}

/* ---------- War ---------- */

function war(s, c, gar) {
  const enemies = [...enemiesOf(s, c.id)];
  const theirPower = enemies.reduce((t, e) => t + militaryPower(s, e), 0);
  const ratio = militaryPower(s, c.id) / (theirPower + 1);
  const lost = lostShare(s, c.id);
  if (c.mob === 0 && ratio < 1.5) c.mob = 1;
  if (c.mob === 1 && (lost > 0.05 || ratio < 0.7)) c.mob = 2;

  const enemySet = new Set(enemies);
  const fronts = Object.values(s.regions).filter((reg) => reg.ctrl === c.id && GEO[reg.id].adj.some((a) => enemySet.has(s.regions[a]?.ctrl)));
  const mine = Object.values(s.armies).filter((a) => a.owner === c.id);

  // Form army groups on the front from forces at home
  const free = freeForces(s, c);
  if (fronts.length && mine.length < Math.min(6, fronts.length + 1) && free.troops > 40) {
    const threat = fronts.map((reg) => [reg, threatTo(s, c.id, reg.id, enemySet)]).sort((a, b) => b[1] - a[1]);
    const spot = threat[0][0];
    createArmy(s, c, { region: spot.id, troops: Math.floor(free.troops * 0.45), tanks: Math.floor(free.tanks * 0.45) });
  }

  // Orders: liberate our land first, then hold the most threatened front, and counter-attack if much stronger
  const occupied = Object.values(s.regions).filter((reg) => reg.owner === c.id && enemySet.has(reg.ctrl));
  for (const a of Object.values(s.armies)) {
    if (a.owner !== c.id || a.sea) continue;
    const busy = a.op.kind === 'attack' && a.path.length && enemySet.has(s.regions[a.op.target].ctrl);
    if (busy && (s.week - (a.orderedAt ?? 0)) < 12) continue;
    const odds = (id) => armyAttackEstimate(s, a, id) / Math.max(1, defenceEstimate(s, id, gar));
    const near = (list) => list
      .map((reg) => [reg, route(s, c.id, a.region, reg.id, { offensive: true })])
      .filter(([, path]) => path && path.length <= 4)
      .sort((x, y) => x[1].length - y[1].length || odds(y[0].id) - odds(x[0].id));
    let order = null;
    const lib = near(occupied).find(([reg, path]) => odds(path[0] ?? reg.id) >= 0.9);
    if (lib) order = { kind: 'attack', target: lib[0].id, aggr: 'balanced' };
    if (!order && ratio > 1.4 && c.gov !== 'democracy' || !order && ratio > 1.8) {
      const targets = Object.values(s.regions).filter((reg) => enemySet.has(reg.ctrl) && GEO[reg.id].adj.some((x) => s.regions[x]?.ctrl === c.id));
      const best = targets.map((reg) => [reg, odds(reg.id) * (1 + Object.keys(reg.res).length * 0.15)]).sort((x, y) => y[1] - x[1])[0];
      if (best && best[1] >= 1.3) order = { kind: 'attack', target: best[0].id, aggr: 'balanced' };
    }
    if (!order) {
      const threatened = fronts.map((reg) => [reg, threatTo(s, c.id, reg.id, enemySet) - defenceHere(s, c.id, reg.id)]).sort((x, y) => y[1] - x[1])[0];
      if (threatened && a.op.target !== threatened[0].id) order = { kind: 'hold', target: threatened[0].id, aggr: 'balanced' };
    }
    if (order && !(order.kind === a.op.kind && order.target === a.op.target)) {
      if (!orderArmy(s, c, a, order)) a.orderedAt = s.week;
    }
  }

  // Air, sea and missiles
  for (const e of enemies) {
    const t = s.countries[e];
    if (t && !c.blockades[e] && c.ships > 10 && navalPower(c) > navalPower(t) * 1.5) setBlockade(s, c, e, Math.floor(c.ships * 0.4));
  }
  if (!c.airOps.length && c.aircraft > 40) {
    const targets = Object.values(s.regions).filter((reg) => enemySet.has(reg.ctrl) && GEO[reg.id].adj.some((x) => s.regions[x]?.ctrl === c.id));
    if (targets.length) setAirCampaign(s, c, pick(s, targets).id, Math.floor(c.aircraft * 0.3));
  }
  if (c.missiles > 50 && chance(s, 0.1)) {
    const targets = Object.values(s.regions).filter((reg) => enemySet.has(reg.ctrl) && s.countries[reg.ctrl]);
    if (targets.length) {
      const best = targets.sort((x, y) => (Object.keys(y.res).length + y.gdp / 500) - (Object.keys(x.res).length + x.gdp / 500))[0];
      missileStrike(s, c, best.id, Math.floor(c.missiles * 0.05));
    }
  }
  if (c.id === 'irn' && !s.chokepoints.hormuz.closedBy && enemies.some((e) => ['usa', 'sau', 'are', 'isr'].includes(e)) && chance(s, 0.08)) {
    setChokepoint(s, c, 'hormuz', true);
  }

  // Peace
  for (const e of enemies) {
    const w = warBetween(s, c.id, e);
    const age = s.week - w.since;
    if (age < 8 || (s.week - (c.ai.peaceAt?.[e] ?? -99)) < 8) continue;
    c.ai.peaceAt = { ...(c.ai.peaceAt ?? {}), [e]: s.week };
    const enemy = s.countries[e];
    const myLoss = lostShare(s, c.id);
    const theirLoss = lostShare(s, e);
    if (!enemy) {
      // A war with a minor nation: settle once nothing changes hands
      if (theirLoss === 0 && myLoss === 0 && age > 16) makePeace(s, c.id, e, {});
      continue;
    }
    if (enemy.human) {
      if (myLoss > 0.15 || ratio < 0.5) propose(s, c.id, e, 'peace', { armistice: myLoss > 0.3 }, true);
      else if (age > 26 && Math.abs(myLoss - theirLoss) < 0.05) propose(s, c.id, e, 'peace', {}, true);
      continue;
    }
    // Two computer-run countries settle between themselves
    if (age > 20 && chance(s, 0.4)) {
      const winner = theirLoss > myLoss ? c.id : e;
      const loser = winner === c.id ? e : c.id;
      const cede = Object.values(s.regions).filter((reg) => reg.owner === loser && reg.ctrl === winner).map((reg) => ({ region: reg.id, to: winner }));
      makePeace(s, c.id, e, Math.abs(myLoss - theirLoss) > 0.1 ? { cede } : {});
    }
  }
}

function threatTo(s, cid, regionId, enemySet) {
  let t = 0;
  for (const id of GEO[regionId].adj) {
    const reg = s.regions[id];
    if (!reg || !enemySet.has(reg.ctrl)) continue;
    for (const a of Object.values(s.armies)) if (a.region === id && enemySet.has(a.owner)) t += a.troops;
    t += 5;
  }
  return t;
}

function defenceHere(s, cid, regionId) {
  let t = 0;
  for (const a of Object.values(s.armies)) if (a.region === regionId && a.owner === cid) t += a.troops;
  return t;
}

export { RESOURCES };
