// Countries no player leads. They run sensible budgets, trade, build alliances, spy on their rivals, judge
// proposals on their merits and honour their alliances. Invaded, they fight with everything they have:
// mobilising, conscripting, drafting reserves and calling on friends. Strong, ambitious and unhappy with a
// weak neighbour, some (autocracies above all) plan wars of their own. Facing revolution at home, they make a
// separate peace, as Russia did at Brest-Litovsk.

import { GEO } from './data/geo.js';
import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import {
  clamp, rand, chance, pick, alive, atWar, allied, enemiesOf, rel, nameOf, nation, alliancesOf, treaty, addRel, news,
  sanctioning, warBetween, friendlyGround,
} from './core.js';
import { BUILD, PROJECT_WEEKS, maxOrders, maxProjects, costFactor, debtRatio, debtLimit, navalPower } from './economy.js';
import { createArmy, orderArmy, freeForces, garrisons, defenceEstimate, armyAttackEstimate, route, setAirCampaign, missileStrike, settleMinor } from './military.js';
import { aiNavy } from './navy.js';
import { aiPeoples } from './peoples.js';
import { aiAid } from './proxy.js';
import { aiEnergy } from './energy.js';
import { aiClimate } from './climate.js';
import { aiSpace } from './space.js';
import { respond, propose, makePeace, setTariff, setChokepoint, declareWar, createAlliance } from './diplomacy.js';
import { CONSCRIPTION, setConscription, handleProtest, handleUprising, neighbours } from './government.js';
import { plant, initSpies } from './spies.js';
import { startResearch, projectCost, maxResearch } from './science.js';
import { setStraitPolicy } from './trade.js';
import { CHOKEPOINTS } from './data/world.js';

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
    if ((s.week + c.ai.next) % 4 === 0) { economy(s, c); homeFront(s, c); aiPeoples(s, c); }
    if ((s.week + c.ai.next) % 4 === 1) aiEnergy(s, c);
    if ((s.week + c.ai.next) % 26 === 7) aiClimate(s, c);
    if ((s.week + c.ai.next) % 8 === 6) aiSpace(s, c);
    if (enemiesOf(s, c.id).size) war(s, c, gar);
    else {
      if (c.mob > 0 && (s.week + c.ai.next) % 8 === 0) c.mob -= 1;
      if ((s.week + c.ai.next) % 8 === 0 && c.conscription && CONSCRIPTION[c.conscription].level > CONSCRIPTION[c.base.conscription].level && (c.threat?.value ?? 0) < 0.4) setConscription(s, c, c.base.conscription);
      if ((s.week + c.ai.next) % 4 === 2) ambition(s, c, gar);
    }
    if ((s.week + c.ai.next) % 8 === 5) standing(s, c);
    if ((s.week + c.ai.next) % 8 === 3) aiAid(s, c);
    aiNavy(s, c);
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
      // Countries don't sign up to every pact going
      if (al.kind === 'military' && alliancesOf(s, c.id, 'military').length >= 2) return false;
      return !dislike && r >= (al.kind === 'military' ? 45 : 20);
    }
    case 'fta': return r >= 5 && !sanctioning(s, c.id, p.from) && !sanctioning(s, p.from, c.id) && !(c.minor && s.treaties.filter((t) => t.kind === 'fta' && (t.a === c.id || t.b === c.id)).length >= 4);
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
  // Letting the enemy's troops through is a concession only the losing side makes
  if (t.access && !(lostShare(s, c.id) >= 0.08 || ratio < 0.7)) return false;
  if (!giving.length && !paying) {
    if (getting.length || t.reparations?.from === p.from) return true;
    if (t.armistice) return age >= 8 && (ratio < 1.6 || iLost > theyLost);
    return age >= 4 && (theyLost <= iLost + 0.05 || ratio < 1.2);
  }
  if (age < 6 && !c.civilWar) return false;
  const occupied = giving.every((x) => s.regions[x.region]?.ctrl === x.to);
  const desperate = iLost >= 0.3 || ratio < 0.35 || c.civilWar || c.stability < 20;
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
  // Outmatched: bring in the draft, harder the worse it gets
  const defending = s.wars.some((w) => w.b === c.id) || lost > 0;
  if (defending && c.conscription) {
    const want = ratio < 0.6 || lost > 0.08 ? 'total' : ratio < 1.2 ? 'national' : null;
    if (want && CONSCRIPTION[want].level > CONSCRIPTION[c.conscription].level) setConscription(s, c, want);
  }
  // Ask friends for help
  if (defending && ratio < 1 && (s.week - (c.ai.askedAt ?? -99)) >= 8) {
    c.ai.askedAt = s.week;
    for (const other of Object.values(s.countries)) {
      if (other.id === c.id || !alive(s, other.id) || allied(s, other.id, c.id)) continue;
      const foe = enemies.find((e) => !atWar(s, other.id, e) && !allied(s, other.id, e) && rel(s, other.id, e) < 0);
      if (foe && rel(s, c.id, other.id) >= 40) propose(s, c.id, other.id, 'joinWar', { enemy: foe });
    }
  }

  const enemySet = new Set(enemies);
  const fronts = Object.values(s.regions).filter((reg) => reg.ctrl === c.id && GEO[reg.id].adj.some((a) => enemySet.has(s.regions[a]?.ctrl)));
  const mine = Object.values(s.armies).filter((a) => a.owner === c.id);

  // Form army groups on the front from forces at home
  const free = freeForces(s, c);
  // Draft reservists straight into the line when the enemy is stronger
  const draftable = ratio < 1.2 ? Math.max(0, c.reserves) * 0.5 : 0;
  if (fronts.length && mine.length < Math.min(6, fronts.length + 1) && free.troops + draftable > 40) {
    const threat = fronts.map((reg) => [reg, threatTo(s, c.id, reg.id, enemySet)]).sort((a, b) => b[1] - a[1]);
    const spot = threat[0][0];
    const troops = Math.floor(free.troops * 0.45 + draftable);
    if (createArmy(s, c, { region: spot.id, troops, tanks: Math.floor(free.tanks * 0.45) })) createArmy(s, c, { region: spot.id, troops: Math.floor(free.troops * 0.45), tanks: Math.floor(free.tanks * 0.45) });
  } else if (ratio < 0.8 && mine.length && c.reserves > 20) {
    // Feed reservists into the weakest army on the front
    const weakest = mine.filter((a) => !a.sea && friendlyGround(s, c.id, s.regions[a.region].ctrl)).sort((x, y) => x.troops - y.troops)[0];
    if (weakest) {
      const add = Math.floor(Math.min(c.reserves * 0.3, weakest.troops));
      c.reserves -= add; c.troops += add; c.reserveBase = (c.reserveBase ?? c.reserves) - add;
      weakest.troops += add;
      weakest.org = Math.max(30, weakest.org - 8);
    }
  }

  // Orders: liberate our land first, then hold the most threatened front, and counter-attack if much stronger
  const occupied = Object.values(s.regions).filter((reg) => reg.owner === c.id && enemySet.has(reg.ctrl));
  // Troops already heading to each front, so armies spread out instead of all chasing the emptiest one
  const bound = new Map();
  for (const a of Object.values(s.armies)) {
    if (a.owner === c.id && !a.sea && a.op.kind === 'hold' && a.region !== a.op.target) bound.set(a.op.target, (bound.get(a.op.target) ?? 0) + a.troops);
  }
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
      // Worth = output and resources: empty deserts and tundra are taken only when nothing better is in reach
      const avgGdp = targets.reduce((t, reg) => t + reg.gdp, 0) / Math.max(1, targets.length) || 1;
      const worth = (reg) => 0.3 + 0.7 * Math.min(1.5, reg.gdp / avgGdp) + Object.keys(reg.res).length * 0.15;
      const best = targets.filter((reg) => odds(reg.id) >= 1.3).map((reg) => [reg, odds(reg.id) * worth(reg)]).sort((x, y) => y[1] - x[1])[0];
      if (best) order = { kind: 'attack', target: best[0].id, aggr: 'balanced' };
    }
    if (!order) {
      // How badly each front needs troops, not counting this army itself. It only moves for a front that needs
      // them clearly more than the one it holds: otherwise every army shuttles back and forth between the two
      // emptiest fronts each week.
      const mineThere = (id) => (a.region === id ? a.troops : 0) + (a.op.kind === 'hold' && a.op.target === id && a.region !== id ? a.troops : 0);
      const need = (id) => threatTo(s, c.id, id, enemySet) - defenceHere(s, c.id, id) - (bound.get(id) ?? 0) + mineThere(id);
      const threatened = fronts.map((reg) => [reg, need(reg.id)]).sort((x, y) => y[1] - x[1])[0];
      const here = a.op.kind === 'hold' ? a.op.target : a.region;
      const stay = fronts.some((reg) => reg.id === here) ? need(here) : -Infinity;
      if (threatened && here !== threatened[0].id && threatened[1] > stay + Math.max(30, Math.abs(stay) * 0.3)) {
        order = { kind: 'hold', target: threatened[0].id, aggr: 'balanced' };
        bound.set(threatened[0].id, (bound.get(threatened[0].id) ?? 0) + a.troops);
      }
    }
    if (order && !(order.kind === a.op.kind && order.target === a.op.target)) {
      if (!orderArmy(s, c, a, order)) a.orderedAt = s.week;
    }
  }

  // Air, sea and missiles
  if (!c.airOps.length && c.aircraft > 40) {
    const attacking = Object.values(s.armies).filter((a) => a.owner === c.id && a.attacking).map((a) => a.attacking);
    const enemyArmies = Object.values(s.armies).filter((a) => enemySet.has(a.owner) && !a.sea && GEO[a.region].adj.some((x) => s.regions[x]?.ctrl === c.id)).map((a) => a.region);
    const targets = Object.values(s.regions).filter((reg) => enemySet.has(reg.ctrl) && GEO[reg.id].adj.some((x) => s.regions[x]?.ctrl === c.id));
    if (attacking.length) setAirCampaign(s, c, pick(s, attacking), Math.floor(c.aircraft * 0.35), 'support');
    else if (enemyArmies.length) setAirCampaign(s, c, pick(s, enemyArmies), Math.floor(c.aircraft * 0.3), 'interdict');
    else if (targets.length) setAirCampaign(s, c, pick(s, targets).id, Math.floor(c.aircraft * 0.3), 'strategic');
  }
  if (c.missiles > 50 && chance(s, 0.1)) {
    const targets = Object.values(s.regions).filter((reg) => enemySet.has(reg.ctrl) && s.countries[reg.ctrl]);
    if (targets.length) {
      const best = targets.sort((x, y) => (Object.keys(y.res).length + y.gdp / 500) - (Object.keys(x.res).length + x.gdp / 500))[0];
      const massed = Object.values(s.armies).find((a) => enemySet.has(a.owner) && !a.sea && a.troops > 50);
      if (massed) missileStrike(s, c, massed.region, Math.floor(c.missiles * 0.05), 'army');
      else missileStrike(s, c, best.id, Math.floor(c.missiles * 0.05), 'industry');
    }
  }
  for (const [key, cp] of Object.entries(CHOKEPOINTS)) {
    if (!s.chokepoints[key].policy && cp.regions.some((r) => s.regions[r]?.ctrl === c.id) && chance(s, 0.2)) setStraitPolicy(s, c, key, 'seize');
  }
  if (c.id === 'irn' && !s.chokepoints.hormuz.closedBy && enemies.some((e) => ['usa', 'sau', 'are', 'isr'].includes(e)) && chance(s, 0.08)) {
    setChokepoint(s, c, 'hormuz', true);
  }

  // Revolution at home: give up what the enemy holds to bring the army home (Brest-Litovsk, 1918)
  if ((c.civilWar || c.stability < 18) && (s.week - (c.ai.separateAt ?? -99)) >= 6) {
    c.ai.separateAt = s.week;
    for (const e of enemies) {
      const cede = Object.values(s.regions).filter((reg) => reg.owner === c.id && reg.ctrl === e).map((reg) => ({ region: reg.id, to: e }));
      if (s.countries[e]?.human) {
        propose(s, c.id, e, 'peace', { cede }, true);
        alert(s, e, `${c.name} is facing revolution at home and sues for a separate peace${cede.length ? `, offering the ${cede.length} province${cede.length > 1 ? 's' : ''} you hold` : ''}.`, 'proposal');
      } else {
        makePeace(s, c.id, e, { cede });
        news(s, `Facing revolution at home, ${c.name} signs a separate peace with ${nameOf(s, e)}${cede.length ? ' and gives up the land it lost' : ''}.`, 'peace', [c.id, e]);
      }
    }
    return;
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
      const won = Object.values(s.regions).filter((reg) => reg.owner === e && reg.ctrl === c.id).map((reg) => ({ region: reg.id, to: c.id }));
      if (won.length && myLoss < 0.05 && age > 12) propose(s, c.id, e, 'peace', { cede: won }, true);
      else if (myLoss > 0.15 || ratio < 0.5) propose(s, c.id, e, 'peace', { armistice: myLoss > 0.3 }, true);
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

/* ---------- The home front ---------- */

function homeFront(s, c) {
  for (const pr of [...(c.protests ?? [])]) {
    if (pr.size < 35) continue;
    if (c.gov === 'autocracy') handleProtest(s, c, pr.id, 'police');
    else if (handleProtest(s, c, pr.id, 'concede')) handleProtest(s, c, pr.id, c.gov === 'hybrid' && pr.size > 60 ? 'police' : 'negotiate');
  }
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== c.id || !reg.revolt) continue;
    handleUprising(s, c, reg.id, c.gov === 'democracy' && reg.owner === c.id ? 'amnesty' : 'crush');
    // Send troops to hold it
    const army = Object.values(s.armies).find((a) => a.owner === c.id && !a.sea && a.op.kind === 'hold' && !enemiesOf(s, c.id).size);
    if (army && army.region !== reg.id) orderArmy(s, c, army, { kind: 'hold', target: reg.id });
    else if (!army && freeForces(s, c).troops > reg.revolt.rebels * 3 + 10) createArmy(s, c, { region: reg.id, troops: Math.floor(reg.revolt.rebels * 3 + 5), tanks: 0 });
  }
}

/* ---------- Ambition: computer-run countries pick their own fights ---------- */

const AGGRESSIVE = { autocracy: 1, hybrid: 0.55, democracy: 0.1 };

function ambition(s, c, gar) {
  if (s.week < 20 || c.stability < 40 || c.civilWar) return;
  const quota = c.minor ? (s.smallWars ??= []) : (s.aiWars ??= []);
  const plan = c.ai.plan;
  if (plan) {
    // A plan made weeks ago: strike if it still makes sense, else shelve it
    const ok = targetScore(s, c, plan) > 0;
    if (!ok) { c.ai.plan = null; return; }
    if (s.week - c.ai.planAt >= 6) {
      c.ai.plan = null;
      if (quota.filter((w) => w > s.week - 52).length >= 2) return;
      if (!declareWar(s, c, plan, 'conquest')) {
        quota.push(s.week);
        c.ai.warAt = s.week;
      }
    } else {
      // Get ready: mobilise and form up on the border
      if (c.mob === 0) c.mob = 1;
      const border = Object.values(s.regions).filter((reg) => reg.ctrl === c.id && GEO[reg.id].adj.some((x) => s.regions[x]?.ctrl === plan));
      const free = freeForces(s, c);
      if (border.length && free.troops > 30 && !Object.values(s.armies).some((a) => a.owner === c.id && border.some((b) => b.id === a.region))) {
        const spot = border.sort((x, y) => y.gdp - x.gdp)[0];
        createArmy(s, c, { region: spot.id, troops: Math.floor(free.troops * 0.5), tanks: Math.floor(free.tanks * 0.5) });
      }
    }
    return;
  }
  if ((s.week - (c.ai.warAt ?? -99)) < 104) return;
  if (quota.filter((w) => w > s.week - 52).length >= 2) return;
  const aggression = AGGRESSIVE[c.gov] ?? 0.3;
  let best = null;
  for (const n of neighbours(s, c.id)) {
    const score = targetScore(s, c, n);
    if (score > 0 && (!best || score > best[1])) best = [n, score];
  }
  if (best && chance(s, Math.min(0.5, 0.06 * aggression * best[1]))) {
    c.ai.plan = best[0];
    c.ai.planAt = s.week;
  }
}

// How tempting (and safe) a war on this neighbour looks: 0 means no
function targetScore(s, c, t) {
  if (!alive(s, t) || allied(s, c.id, t) || atWar(s, c.id, t)) return 0;
  const minor = s.minors[t];
  if (minor && (minor.puppetOf || minor.capitulated || minor.guarantor === c.id)) return 0;
  if (s.treaties.some((x) => ['nap', 'access', 'armistice'].includes(x.kind) && ((x.a === c.id && x.b === t) || (x.b === c.id && x.a === t)))) return 0;
  if (Object.values(s.alliances).some((al) => al.members.includes(c.id) && al.members.includes(t))) return 0;
  if (s.countries[t] && rel(s, c.id, t) > -25) return 0;
  // Who would fight for them
  let theirs = militaryPower(s, t);
  for (const al of alliancesOf(s, t, 'military')) for (const m of al.members) if (m !== t && m !== c.id) theirs += militaryPower(s, m) * 0.6;
  if (minor?.guarantor && minor.guarantor !== c.id) theirs += militaryPower(s, minor.guarantor) * 0.8;
  const mine = militaryPower(s, c.id);
  if (mine < theirs * 2.5) return 0;
  // What there is to gain: claims, resources, a hated rival
  let prize = 0;
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== t) continue;
    if (c.claims.includes(reg.id)) prize += 2;
    if (GEO[reg.id].adj.some((x) => s.regions[x]?.ctrl === c.id)) prize += Object.keys(reg.res).length * 0.5;
  }
  if (s.countries[t] && rel(s, c.id, t) < -60) prize += 1;
  if (prize < 1) return 0;
  return prize * (AGGRESSIVE[c.gov] ?? 0.3) * Math.min(2, mine / (theirs * 2.5));
}

/* ---------- Standing in the world: trade, friends, spies and science ---------- */

function standing(s, c) {
  initSpies(c);
  if (c.minor) smallNation(s, c);
  const others = Object.values(s.countries).filter((o) => o.id !== c.id && alive(s, o.id) && !atWar(s, c.id, o.id));
  // Free trade with friends
  const ftas = (id) => s.treaties.filter((t) => t.kind === 'fta' && (t.a === id || t.b === id)).length;
  if (chance(s, c.minor ? 0.1 : 0.3) && !(c.minor && ftas(c.id) >= 4)) {
    const partner = others.filter((o) => !(o.minor && ftas(o.id) >= 4) && rel(s, c.id, o.id) > 30 && !treaty(s, 'fta', c.id, o.id) && !sanctioning(s, c.id, o.id) && !sanctioning(s, o.id, c.id) && !Object.values(s.proposals).some((p) => p.from === c.id && p.to === o.id))
      .sort((a, b) => b.gdp - a.gdp)[0];
    if (partner && !(partner.human && chance(s, 0.6))) propose(s, c.id, partner.id, 'fta');
  }
  // A defence pact with a close friend who shares a rival
  const pacts = alliancesOf(s, c.id, 'military');
  if (pacts.length < 2 && chance(s, 0.12)) {
    const rivals = others.filter((o) => rel(s, c.id, o.id) < -40).map((o) => o.id);
    const friend = others.filter((o) => !o.human && rel(s, c.id, o.id) > 60 && !allied(s, c.id, o.id) && alliancesOf(s, o.id, 'military').length < 2 && rivals.some((r) => rel(s, o.id, r) < -30))[0];
    if (friend) {
      const mineFounded = pacts.find((al) => al.founder === c.id && al.members.length < 6);
      if (mineFounded) propose(s, c.id, friend.id, 'alliance', { alliance: mineFounded.id });
      else {
        const made = createAlliance(s, c, { name: `${c.name}–${friend.name} Pact`, kind: 'military', secret: c.gov !== 'democracy' && chance(s, 0.5) });
        if (made?.id) propose(s, c.id, friend.id, 'alliance', { alliance: made.id });
      }
    }
  }
  // Spies on the most hostile major power
  const rival = others.filter((o) => rel(s, c.id, o.id) < -30).sort((a, b) => b.gdp - a.gdp)[0];
  if (rival && !c.spies[rival.id] && chance(s, 0.25)) plant(s, c, rival.id, 3 + Math.floor(rand(s) * 4));
  if (rival && c.counterIntel < 2 && c.gdp > 300) c.counterIntel = 2;
  // Science
  c.research ??= [];
  if (c.research.length < maxResearch(c) && chance(s, 0.4)) {
    const atWarNow = enemiesOf(s, c.id).size > 0;
    const field = atWarNow ? pick(s, ['army', 'air', 'missile']) : chance(s, 0.5) ? c.focus : pick(s, ['industry', 'army', 'energy', 'cyber', 'air', 'naval']);
    if (c.tech[field] < 12 && c.treasury > projectCost(c, c.tech[field] + 1) * 3) startResearch(s, c, field);
  }
}

// What the world's smaller nations do on top of the rest: band together with their neighbours in a trade bloc,
// and, when a much stronger rival threatens them, look for a protector among the powers that are their friends
function smallNation(s, c) {
  const pending = (from, to) => Object.values(s.proposals).some((p) => p.from === from && p.to === to && p.kind === 'alliance');
  // A trade bloc with the neighbours
  if (c.bloc && !alliancesOf(s, c.id, 'economic').length && chance(s, 0.2)) {
    const bloc = Object.values(s.alliances).find((al) => al.name === c.bloc);
    if (bloc) {
      const host = s.countries[bloc.founder] && !s.countries[bloc.founder].human ? bloc.founder : bloc.members.find((m) => !s.countries[m]?.human);
      if (host && bloc.members.length < 16 && !pending(host, c.id)) propose(s, host, c.id, 'alliance', { alliance: bloc.id });
    } else {
      const made = createAlliance(s, c, { name: c.bloc, kind: 'economic' });
      if (made?.id) {
        const others = Object.values(s.countries).filter((o) => o.id !== c.id && o.bloc === c.bloc && alive(s, o.id) && !atWar(s, c.id, o.id));
        for (const o of others) propose(s, c.id, o.id, 'alliance', { alliance: made.id });
      }
    }
  }
  // A pact we founded that no one joined is wound up
  for (const al of Object.values(s.alliances)) {
    if (al.founder === c.id && al.members.length === 1 && s.week - al.since > 8 && !Object.values(s.proposals).some((p) => p.terms?.alliance === al.id)) delete s.alliances[al.id];
  }
  // A protector against a rival far stronger than us
  if (alliancesOf(s, c.id, 'military').some((al) => al.members.length > 1) || !chance(s, 0.35)) return;
  const mine = militaryPower(s, c.id);
  const threat = Object.values(s.countries).filter((o) => o.id !== c.id && alive(s, o.id) && rel(s, c.id, o.id) < -30 && militaryPower(s, o.id) > mine * 1.5)
    .sort((a, b) => militaryPower(s, b.id) - militaryPower(s, a.id))[0];
  if (!threat) return;
  const protector = Object.values(s.countries)
    .filter((o) => o.id !== c.id && o.id !== threat.id && alive(s, o.id) && !o.minor && rel(s, c.id, o.id) >= 40 && rel(s, o.id, threat.id) < 10 && !atWar(s, c.id, o.id))
    .filter((o) => o.human || (rel(s, o.id, c.id) >= 45 && alliancesOf(s, o.id, 'military').length < 2))
    .sort((a, b) => militaryPower(s, b.id) - militaryPower(s, a.id))[0];
  if (!protector || pending(c.id, protector.id) || pending(protector.id, c.id)) return;
  const theirs = alliancesOf(s, protector.id, 'military').find((al) => al.founder === protector.id && al.members.length < 10 && !al.members.some((m) => rel(s, c.id, m) < -20));
  if (theirs && !protector.human) {
    propose(s, protector.id, c.id, 'alliance', { alliance: theirs.id });
  } else if (!alliancesOf(s, c.id, 'military').length) {
    const made = createAlliance(s, c, { name: `${c.name}–${protector.name} Defence Pact`, kind: 'military' });
    if (made?.id) {
      propose(s, c.id, protector.id, 'alliance', { alliance: made.id });
      news(s, `${c.name}, fearing ${threat.name}, asks ${protector.name} for protection.`, 'diplomacy', [c.id, protector.id, threat.id]);
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
