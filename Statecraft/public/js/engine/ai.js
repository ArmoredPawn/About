// Countries no player leads. They run sensible budgets, trade, build alliances, spy on their rivals, judge
// proposals on their merits and honour their alliances. Invaded, they fight with everything they have:
// mobilising, conscripting, drafting reserves and calling on friends. Strong, ambitious and unhappy with a
// weak neighbour, some (autocracies above all) plan wars of their own. Facing revolution at home, they make a
// separate peace, as Russia did at Brest-Litovsk.

import { GEO } from './data/geo.js';
import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import {
  clamp, rand, chance, pick, alive, atWar, allied, enemiesOf, rel, nameOf, nation, alliancesOf, treaty, addRel, news,
  sanctioning, warBetween, friendlyGround, onSameSide, alert,
} from './core.js';
import { PROVINCES } from './data/regions.js';
import { aiDoctrine } from './doctrine.js';
import { coastguardCanStop, orderCoastguard } from './shipping.js';
import { openRoute, planRoute } from './routes.js';
import { BUILD, PROJECT_WEEKS, maxOrders, maxProjects, costFactor, debtRatio, debtLimit, navalPower, upkeep, lineProblem, hasLine, LINE_SETUP } from './economy.js';
import { createArmy, orderArmy, freeForces, garrisons, defenceEstimate, armyAttackEstimate, route, setAirCampaign, missileStrike, settleMinor, breakOut, setAirlift, regionName, MAX_ARMIES, CONTACT, holdFactor, terrainOf } from './military.js';
import { CELLS_OF, holderAt, neighbours4, isLand, cellX, cellY, cellAt, regionAt, provinceCell, dist } from './land.js';
import { aiNavy } from './navy.js';
import { aiPeoples } from './peoples.js';
import { aiAid } from './proxy.js';
import { aiEnergy } from './energy.js';
import { aiClimate } from './climate.js';
import { aiSpace } from './space.js';
import { respond, propose, makePeace, setTariff, setChokepoint, declareWar, createAlliance } from './diplomacy.js';
import { CONSCRIPTION, setConscription, handleProtest, handleUprising, neighbours, makeWarCase } from './government.js';
import { plant, initSpies } from './spies.js';
import { startResearch, projectCost, maxResearch } from './science.js';
import { setStraitPolicy } from './trade.js';
import { CHOKEPOINTS } from './data/world.js';
import { aiFinance } from './finance.js';
import { aiCoups } from './coups.js';

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
    if ((s.week + c.ai.next) % 4 === 3) { aiFinance(s, c); aiCoups(s, c); }
    if ((s.week + c.ai.next) % 26 === 7) aiClimate(s, c);
    if ((s.week + c.ai.next) % 8 === 6) aiSpace(s, c);
    if (enemiesOf(s, c.id).size) war(s, c, gar);
    if (c.ai.stopLines) stopLines(s, c);
    if ((s.week + c.ai.next) % 8 === 2) aiDoctrine(s, c);
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
  // Keep the deficit near where it started, and tighter as debt nears what the markets will bear: raise taxes a
  // little and trim civil spending. In good times, give some back.
  const ratio = debtRatio(c) / debtLimit(c);
  const target = Math.min(Math.max(1.5, b.deficit ?? 3), ratio > 0.8 ? 1.5 : ratio > 0.6 ? 3 : 4);
  const over = (c.deficit ?? 0) - target;
  const atWarNow = enemiesOf(s, c.id).size > 0;
  if (over > 0.5 && !(atWarNow && ratio < 0.9)) {
    if (c.tax < b.tax + 6) c.tax = Math.round((c.tax + Math.min(0.6, over * 0.15)) * 10) / 10;
    if (over > 1.5) for (const k of ['infra', 'edu', 'health', 'research', 'welfare']) c.spend[k] = Math.round(c.spend[k] * 0.985 * 100) / 100;
  } else if (over < -1.5 && ratio < 0.5) {
    if (c.tax > b.tax - 3) c.tax = Math.round((c.tax - 0.3) * 10) / 10;
    for (const k of ['infra', 'edu', 'health', 'research', 'welfare']) if (c.spend[k] < b.spend[k]) c.spend[k] = Math.round(Math.min(b.spend[k], c.spend[k] * 1.01) * 100) / 100;
  }
  if (c.infl > b.infl + 3) c.rate = Math.round((c.rate + 0.5) * 100) / 100;
  else if (c.infl < b.infl + 0.5 && c.growth < c.trend - 1 && c.rate > 0.25) c.rate = Math.round((c.rate - 0.25) * 100) / 100;
  const atWar_ = enemiesOf(s, c.id).size > 0;
  // Pay for the forces we have; in peacetime, send home what the economy can't carry
  const upkeepShare = upkeep(s, c) * 52 / Math.max(0.1, c.gdp) * 100;
  const wantDefence = atWar_ ? Math.min(Math.max(b.spend.defence * 2 + 2, upkeepShare * 1.05), 12) : Math.max(b.spend.defence, Math.min(upkeepShare * 1.05, b.spend.defence + 2));
  c.spend.defence = Math.round((c.spend.defence + clamp(wantDefence - c.spend.defence, -0.3, 0.6)) * 10) / 10;
  if (!atWar_ && upkeepShare > c.spend.defence * 1.1 && c.mob === 0) {
    // After a war, a country that can't pay for its army ends the draft and sends the conscripts home
    if (CONSCRIPTION[c.conscription]?.level > CONSCRIPTION[b.conscription]?.level) setConscription(s, c, b.conscription);
    const cut = Math.min(upkeepShare > c.spend.defence * 2 ? 0.08 : 0.03, 1 - c.spend.defence * 1.05 / upkeepShare);
    const free = freeForces(s, c);
    let go = c.troops * cut;
    const fromFree = Math.min(free.troops, go);
    go -= fromFree;
    // Army groups at home in peacetime are thinned out too
    let fromArmies = 0;
    if (go > 0) {
      const mine = Object.values(s.armies).filter((a) => a.owner === c.id && !a.sea);
      const inArmies = mine.reduce((t, a) => t + a.troops, 0);
      for (const a of mine) {
        const before = a.troops;
        a.troops = Math.max(1, a.troops * (1 - Math.min(0.5, go / Math.max(1, inArmies))));
        fromArmies += before - a.troops;
      }
    }
    const sent = fromFree + fromArmies;
    if (sent > 0) { c.troops -= sent; c.reserves += sent * 0.5; }
  }

  // Buy equipment with spare defence money
  // Only what the defence budget can also keep up afterwards (a microstate doesn't buy a 10,000-man brigade)
  const roomToGrow = upkeepShare < c.spend.defence * 0.8;
  if (c.milFunds > c.gdp * 0.004 && c.queue.length < maxOrders(c) && (roomToGrow || atWar_)) {
    const options = (atWar_ ? ['tanks', 'tanks', 'troops', 'aircraft', 'missiles'] : ['tanks', 'aircraft', 'missiles', 'ships', 'troops'])
      .filter((k) => k !== 'troops' || BUILD.troops.batch <= Math.max(5, c.troops * 0.2))
      // Only what its factories can make (or can be tooled up to make)
      .filter((k) => !lineProblem(c, k, Object.values(s.regions).some((r) => r.ctrl === c.id && GEO[r.id]?.coast)));
    const kind = pick(s, options);
    const cost = kind ? BUILD[kind].cost * costFactor(c) * (hasLine(c, kind) ? 1 : LINE_SETUP) : Infinity;
    if (c.milFunds >= cost) {
      c.milFunds -= cost;
      if (!hasLine(c, kind)) c.lines = { ...(c.lines ?? {}), [kind]: true };
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
      // Neighbours band together in their own region's trade bloc from neutral terms; anything else needs friendship
      return !dislike && r >= (al.kind === 'military' ? 45 : al.name === c.bloc ? 0 : 20);
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
  // A new government imposed from outside: only when beaten
  if (t.regime === c.id) {
    if (!(iLost >= 0.35 || ratio < 0.3 || c.civilWar)) return false;
    if (!giving.length && !paying) return true;
  }
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

  // The front as the armies see it: our ground next to the enemy's, cut into sectors, each to be held by an army
  const front = frontCells(s, c.id, enemySet);
  const sectors = sectorize(s, c.id, front, enemySet);
  const mineLand = () => Object.values(s.armies).filter((a) => a.owner === c.id && !a.sea);
  const invaded = lost > 0 || Object.values(s.battles ?? {}).some((b) => s.armies[b.def]?.owner === c.id);

  // Form army groups where the line needs them: one per sector, and a reserve, from forces at home (drafting
  // reservists straight into the line when the enemy is stronger). Invaded, two a week.
  const draftable = ratio < 1.2 ? Math.max(0, c.reserves) * 0.5 : 0;
  for (let i = 0; i < (invaded ? 2 : 1); i++) {
    const have = mineLand().length;
    const spare = freeForces(s, c);
    const want = Math.min(MAX_ARMIES - 2, sectors.length + 1);
    if (!(sectors.length && have < want && spare.troops + (i ? 0 : draftable) > 30)) break;
    const open = sectors.filter((sec) => !mineLand().some((a) => dist(a.x, a.y, sec.x, sec.y) < CONTACT * 1.5)).sort((a, b) => b.threat - a.threat)[0] ?? sectors[0];
    const spot = formingProvince(s, c.id, open);
    if (!spot) break;
    const share = 1 / Math.max(1, want - have);
    const troops = Math.floor(Math.max(30, (spare.troops + (i ? 0 : draftable)) * Math.min(0.6, share + 0.1)));
    if (createArmy(s, c, { region: spot, troops, tanks: Math.floor(spare.tanks * Math.min(0.6, share + 0.1)) })) break;
  }
  if (ratio < 0.8 && c.reserves > 20) {
    // Feed reservists into the weakest army on the line
    const weakest = mineLand().filter((a) => friendlyGround(s, c.id, s.regions[a.region].ctrl)).sort((x, y) => x.troops - y.troops)[0];
    if (weakest && (s.week - (c.ai.fedAt ?? -99)) >= 2) {
      c.ai.fedAt = s.week;
      const add = Math.floor(Math.min(c.reserves * 0.3, weakest.troops));
      c.reserves -= add; c.troops += add; c.reserveBase = (c.reserveBase ?? c.reserves) - add;
      weakest.troops += add;
      weakest.org = Math.max(30, weakest.org - 8);
    }
  }
  // Dig in where the enemy is massing, and round the capital if they are close to it
  if (invaded || defending) fortifyFront(s, c, sectors);

  // Allies at war with the same enemy, with a front of their own and none of ours there: stand beside them
  expedition(s, c, sectors, enemySet, ratio);

  const assigned = new Set();
  // Surrounded: break out while there is strength left, else fly supplies in
  for (const a of mineLand()) {
    if (!a.pocket || a.pocketSea) continue;
    assigned.add(a.id);
    if (a.org >= 22 && !(a.breakout > s.week) && breakOut(s, c, a) === null) continue;
    const freeAir = c.aircraft - c.airOps.reduce((t, o) => t + o.aircraft, 0) - (c.airlifts ?? []).reduce((t, o) => t + o.aircraft, 0);
    if (!(c.airlifts ?? []).some((x) => x.army === a.id) && freeAir > 30) setAirlift(s, c, a, Math.floor(Math.min(freeAir * 0.5, a.troops * 1.3)));
  }
  // Armies already in a battle or on an attack keep at it
  for (const a of mineLand()) if (a.battle || ((a.op.kind === 'advance' || a.op.kind === 'attack') && s.week - (a.orderedAt ?? 0) < 6)) assigned.add(a.id);

  // Every sector of the line gets an army: the most threatened first, each from the nearest free army
  const holders = new Map();
  for (const sec of [...sectors].sort((a, b) => b.threat - a.threat)) {
    const pick = mineLand().filter((a) => !assigned.has(a.id)).sort((a, b) => dist(a.x, a.y, sec.x, sec.y) - dist(b.x, b.y, sec.x, sec.y))[0];
    if (!pick) break;
    assigned.add(pick.id);
    holders.set(pick.id, sec);
    if (dist(pick.x, pick.y, sec.x, sec.y) > 3 && !(pick.op.kind === 'hold' && pick.op.at && dist(pick.op.at[0], pick.op.at[1], sec.x, sec.y) < 3)) {
      if (!orderArmy(s, c, pick, { kind: 'hold', x: sec.x, y: sec.y, aggr: 'balanced' })) { pick.orderedAt = s.week; pick.status = `Holding the line near ${regionName(regionAt(cellAt(sec.x, sec.y)))}`; }
    }
  }

  // Attacks. Being at war is not enough: a computer-run general attacks when the odds are good, to take back our
  // land, or as part of an offensive the country has decided on, and never with an army the line can't spare.
  // Counter-attacks and taking back our own land may pull an army off the line (it is retaking the line's own
  // ground); an offensive into enemy country only uses armies the line can spare
  const committed = new Set();
  const able = mineLand().filter((a) => !a.battle && !(a.pocket && !a.pocketSea) && !(a.op.kind !== 'hold' && s.week - (a.orderedAt ?? 0) < 6));
  counterAttacks(s, c, able, committed, gar);
  liberate(s, c, able.filter((a) => !committed.has(a.id)), committed);
  const spare = able.filter((a) => !committed.has(a.id) && (!assigned.has(a.id) || (holders.has(a.id) && holders.get(a.id).threat < a.troops * 0.5)));
  if ((ratio > 1.4 && c.gov !== 'democracy') || ratio > 1.8 || (s.wars.some((w) => w.a === c.id) && ratio > 1.15)) offensive(s, c, spare, enemySet, committed);

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

/* ---------- The front, as a computer-run general sees it ---------- */

// Our cells next to ground held by an enemy
function frontCells(s, cid, enemySet) {
  const out = [];
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== cid && !(reg.held?.[cid] > 0)) continue;
    for (const i of CELLS_OF[reg.id]) {
      if (holderAt(s, i) !== cid) continue;
      if (neighbours4(i).some((j) => isLand(j) && enemySet.has(holderAt(s, j)))) out.push(i);
    }
  }
  return out;
}

// The front cut into sectors an army each can hold (about 300 km of line), with how much enemy strength faces
// each: { x, y, cells, threat }
function sectorize(s, cid, cells, enemySet) {
  if (!cells.length) return [];
  const k = clamp(Math.round(cells.length / 6), 1, MAX_ARMIES - 3);
  // Seeds spread along the line (farthest-point sampling), then each cell joins the nearest seed
  const seeds = [cells[0]];
  const near = new Float64Array(cells.length).fill(Infinity);
  while (seeds.length < k) {
    const last = seeds[seeds.length - 1];
    let best = -1;
    let bd = -1;
    cells.forEach((i, n) => {
      near[n] = Math.min(near[n], dist(cellX(i), cellY(i), cellX(last), cellY(last)));
      if (near[n] > bd) { bd = near[n]; best = i; }
    });
    if (bd < 4) break;
    seeds.push(best);
  }
  const groups = seeds.map(() => []);
  for (const i of cells) {
    let g = 0;
    let gd = Infinity;
    seeds.forEach((sd, n) => { const d = dist(cellX(i), cellY(i), cellX(sd), cellY(sd)); if (d < gd) { gd = d; g = n; } });
    groups[g].push(i);
  }
  const foes = Object.values(s.armies).filter((b) => !b.sea && enemySet.has(b.owner));
  return groups.filter((g) => g.length).map((g) => {
    // The cell of the sector nearest its middle
    const mx = g.reduce((t, i) => t + cellX(i), 0) / g.length;
    const my = g.reduce((t, i) => t + cellY(i), 0) / g.length;
    const mid = g.reduce((m, i) => (dist(cellX(i), cellY(i), mx, my) < dist(cellX(m), cellY(m), mx, my) ? i : m), g[0]);
    const x = cellX(mid);
    const y = cellY(mid);
    const threat = 10 + foes.reduce((t, b) => t + (dist(b.x, b.y, x, y) < CONTACT * 3 ? b.troops : 0), 0) + g.length * 2;
    return { x, y, cells: g, threat };
  });
}

// Where to form an army for a sector: our province nearest it whose heart we hold
function formingProvince(s, cid, sec) {
  let best = null;
  let bd = Infinity;
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== cid) continue;
    const cell = provinceCell(reg.id);
    if (holderAt(s, cell) !== cid) continue;
    const d = dist(cellX(cell), cellY(cell), sec.x, sec.y);
    if (d < bd) { bd = d; best = reg.id; }
  }
  return best;
}

// Rough odds of a group of our armies against one enemy army where it stands
function oddsAgainst(s, ours, e, gar) {
  const region = e.region;
  const atk = ours.reduce((t, a) => t + armyAttackEstimate(s, a, region) * Math.min(1, a.org / 60 + 0.3), 0);
  const ground = s.regions[region];
  const def = armyAttackEstimate(s, e, region) * holdFactor(terrainOf(region), holderAt(s, cellAt(e.x, e.y)) === e.owner ? ground.fort : 0) * (e.op.kind === 'hold' ? 1.1 : 1)
    + (gar.get(region)?.holder === e.owner ? (gar.get(region).troops * 0.3) * 0.7 : 0);
  return atk / Math.max(1, def);
}

// Strike an enemy army close to ours when together we clearly outmatch it: from as many sides as we can
function counterAttacks(s, c, spare, assigned, gar) {
  if ((s.week - (c.ai.strikeAt ?? -99)) < 2) return;
  // Only an enemy army inside our lines, attacking one of ours, or right up against our line: not one deep in its
  // own country
  const ours = (h) => h === c.id || (onSameSide(s, c.id, h) && !atWar(s, c.id, h));
  const attackingUs = new Set(Object.values(s.battles ?? {}).filter((b) => ours(s.armies[b.def]?.owner)).flatMap((b) => b.att));
  const line = Object.values(s.armies).filter((a) => a.owner === c.id && !a.sea);
  const foes = Object.values(s.armies).filter((b) => !b.sea && atWar(s, c.id, b.owner)
    && (ours(holderAt(s, cellAt(b.x, b.y))) || attackingUs.has(b.id) || line.some((a) => dist(a.x, a.y, b.x, b.y) < CONTACT * 1.3)));
  let best = null;
  for (const e of foes) {
    const near = spare.filter((a) => !assigned.has(a.id) && a.org >= 40 && dist(a.x, a.y, e.x, e.y) < CONTACT * 3);
    if (!near.length) continue;
    const odds = oddsAgainst(s, near, e, gar);
    if (odds >= 1.35 && (!best || odds * e.troops > best.odds * best.e.troops)) best = { e, near, odds };
  }
  if (!best) return;
  c.ai.strikeAt = s.week;
  for (const a of best.near) {
    assigned.add(a.id);
    if (!orderArmy(s, c, a, { kind: 'attack', enemy: best.e.id, aggr: best.odds > 2 ? 'balanced' : 'allout' })) a.orderedAt = s.week;
  }
  if (best.near.length > 1) news(s, `${c.name} counter-attacks ${nameOf(s, best.e.owner)}'s ${best.e.name} with ${best.near.length} armies.`, 'war', [c.id, best.e.owner]);
}

// Take back our ground that the enemy holds with no army on it (or only a weak one): the nearest spare army
// advances into it
function liberate(s, c, spare, assigned) {
  if ((s.week - (c.ai.liberateAt ?? -99)) < 2) return;
  const enemies = enemiesOf(s, c.id);
  let target = null;
  for (const reg of Object.values(s.regions)) {
    if (reg.owner !== c.id || !reg.held && reg.ctrl === c.id) continue;
    const share = reg.held ? 1 - (reg.held[c.id] ?? 0) : reg.ctrl === c.id ? 0 : 1;
    if (share < 0.1) continue;
    // The heart of what they hold of it
    const cells = [...CELLS_OF[reg.id]].filter((i) => enemies.has(holderAt(s, i)));
    if (!cells.length) continue;
    const mx = cells.reduce((t, i) => t + cellX(i), 0) / cells.length;
    const my = cells.reduce((t, i) => t + cellY(i), 0) / cells.length;
    const guard = Object.values(s.armies).filter((b) => !b.sea && enemies.has(b.owner) && dist(b.x, b.y, mx, my) < CONTACT * 1.5).reduce((t, b) => t + b.troops, 0);
    const score = reg.gdp * share * (CAPITALS.has(reg.id) ? 3 : 1) / (1 + guard / 50);
    if (!target || score > target.score) target = { reg, x: mx, y: my, guard, score };
  }
  if (!target) return;
  const team = spare.filter((a) => !assigned.has(a.id) && a.org >= 35 && dist(a.x, a.y, target.x, target.y) < CONTACT * 8).sort((a, b) => dist(a.x, a.y, target.x, target.y) - dist(b.x, b.y, target.x, target.y));
  const need = target.guard * 1.4 + 20;
  let sum = 0;
  const go = [];
  for (const a of team) { if (sum >= need) break; go.push(a); sum += a.troops; }
  if (!go.length || sum < target.guard) return;
  c.ai.liberateAt = s.week;
  for (const a of go) {
    assigned.add(a.id);
    if (!orderArmy(s, c, a, { kind: 'advance', x: target.x, y: target.y, aggr: 'balanced' })) a.orderedAt = s.week;
  }
  news(s, `${c.name} launches a counter-offensive to retake ${regionName(target.reg.id)}${go.length > 1 ? ` with ${go.length} armies` : ''}.`, 'war', [c.id]);
}

// An offensive into enemy country, every few weeks: a main thrust at the richest objective within reach, and a
// second army swinging round from another side to meet it behind the enemy's line (a pincer)
function offensive(s, c, spare, enemySet, assigned) {
  if ((s.week - (c.ai.offensiveAt ?? -99)) < 4) return;
  const ready = spare.filter((a) => !assigned.has(a.id) && a.org >= 50);
  if (!ready.length) return;
  // The objective: the richest enemy province within reach of our strongest ready army, its capital above all
  const lead = ready.reduce((m, a) => (a.troops > m.troops ? a : m));
  let goal = null;
  for (const reg of Object.values(s.regions)) {
    if (!enemySet.has(reg.ctrl)) continue;
    const cell = provinceCell(reg.id);
    if (!enemySet.has(holderAt(s, cell))) continue;
    const d = dist(lead.x, lead.y, cellX(cell), cellY(cell));
    if (d > 50) continue;
    const score = (reg.gdp + Object.keys(reg.res).length * 40) * (CAPITALS.has(reg.id) ? 2.5 : 1) / (1 + d / 40);
    if (!goal || score > goal.score) goal = { reg, x: cellX(cell), y: cellY(cell), score };
  }
  if (!goal) return;
  c.ai.offensiveAt = s.week;
  const group = ready.sort((a, b) => dist(a.x, a.y, goal.x, goal.y) - dist(b.x, b.y, goal.x, goal.y)).slice(0, 3);
  // The second army aims past the objective from its own side, so the two close on it from different directions
  group.forEach((a, n) => {
    let tx = goal.x;
    let ty = goal.y;
    if (n === 1) {
      const dx = goal.x - group[0].x;
      const dy = goal.y - group[0].y;
      const len = Math.hypot(dx, dy) || 1;
      tx = goal.x + (dx / len) * CONTACT * 1.5;
      ty = goal.y + (dy / len) * CONTACT * 1.5;
    }
    assigned.add(a.id);
    if (orderArmy(s, c, a, { kind: 'advance', x: tx, y: ty, aggr: 'balanced' })) orderArmy(s, c, a, { kind: 'advance', x: goal.x, y: goal.y, aggr: 'balanced' });
    a.orderedAt = s.week;
  });
  news(s, `${c.name} launches an offensive toward ${regionName(goal.reg.id)}${group.length > 1 ? ` with ${group.length} armies` : ''}.`, 'war', [c.id, goal.reg.ctrl]);
}

const CAPITALS = new Set(PROVINCES.filter((p) => p.capital).map((p) => p.id));

// Dig in on the most threatened stretch of the line, and round the capital if the enemy is close to it
function fortifyFront(s, c, sectors) {
  if ((s.week - (c.ai.fortAt ?? -99)) < 3 || c.projects.length >= maxProjects(c)) return;
  const spots = sectors.map((sec) => [regionAt(cellAt(sec.x, sec.y)), sec.threat]).filter(([id]) => id && s.regions[id].ctrl === c.id && s.regions[id].fort < 4 && !c.projects.some((p) => p.region === id && p.kind === 'fort'))
    .map(([id, threat]) => [s.regions[id], threat * (CAPITALS.has(id) || id === c.id ? 2 : 1) + s.regions[id].gdp / 50])
    .sort((a, b) => b[1] - a[1]);
  const pick = spots[0]?.[0];
  if (!pick) return;
  const cost = (pick.fort + 1) * 0.6 * costFactor(c);
  if (cost > (c.milFunds + c.treasury) * 0.3) return;
  const fromFunds = Math.min(c.milFunds, cost);
  c.milFunds -= fromFunds;
  c.treasury -= cost - fromFunds;
  c.projects.push({ id: `pj${s.nextId++}`, kind: 'fort', region: pick.id, left: 8, total: 8, cost });
  c.ai.fortAt = s.week;
}

// An ally fighting our common enemy on a front of its own, with none of ours there: send an army to stand beside
// it. It forms up in our province closest to that front and marches over friendly ground.
function expedition(s, c, sectors, enemySet, ratio) {
  if ((s.week - (c.ai.expeditionAt ?? -99)) < 6) return;
  const abroad = Object.values(s.armies).filter((a) => a.owner === c.id && !a.sea && s.regions[a.region].ctrl !== c.id);
  if (abroad.length >= (sectors.length ? 1 : 3)) return;
  const spare = freeForces(s, c);
  const need = sectors.reduce((t, sec) => t + sec.threat, 0);
  if (spare.troops - need * 0.5 < 40 || (sectors.length && ratio < 1)) return;
  // The ally's line under most pressure
  const allies = Object.values(s.countries).filter((o) => o.id !== c.id && alive(s, o.id) && onSameSide(s, c.id, o.id) && friendlyGround(s, c.id, o.id));
  let best = null;
  for (const o of allies) {
    const theirs = sectorize(s, o.id, frontCells(s, o.id, enemySet), enemySet);
    for (const sec of theirs) {
      if (Object.values(s.armies).some((a) => a.owner === c.id && dist(a.x, a.y, sec.x, sec.y) < CONTACT * 2)) continue;
      if (!best || sec.threat > best.sec.threat) best = { sec, ally: o.id };
    }
  }
  if (!best) return;
  const spot = formingProvince(s, c.id, best.sec);
  if (!spot) return;
  const troops = Math.floor(Math.min(spare.troops * 0.4, Math.max(40, best.sec.threat * 1.2)));
  if (troops < 20) return;
  if (createArmy(s, c, { region: spot, troops, tanks: Math.floor(spare.tanks * 0.4), name: `Expeditionary Force ${nameOf(s, best.ally).split(' ')[0]}`.slice(0, 28) })) return;
  const army = Object.values(s.armies).filter((a) => a.owner === c.id && a.region === spot).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (!army) return;
  army.assist = true;
  if (orderArmy(s, c, army, { kind: 'hold', x: best.sec.x, y: best.sec.y, aggr: 'balanced' })) return;
  army.orderedAt = s.week;
  c.ai.expeditionAt = s.week;
  const where = regionName(regionAt(cellAt(best.sec.x, best.sec.y)));
  news(s, `${c.name} sends ${army.name} (about ${Math.round(troops / 5) * 5}K troops) to fight beside ${nameOf(s, best.ally)}.`, 'war', [c.id, best.ally]);
  alert(s, best.ally, `${c.name} is sending an army of about ${Math.round(troops / 5) * 5}K troops to help us hold the line near ${where}.`, 'good', { region: regionAt(cellAt(best.sec.x, best.sec.y)) });
}

// A hostile country's coastguard stops the cargoes of a secret line it has found in its waters
function stopLines(s, c) {
  const lines = c.ai.stopLines;
  if (!lines) return;
  for (const sh of s.shipments ?? []) {
    const id = sh.lane?.route;
    if (!id || !lines[id] || !coastguardCanStop(s, c.id, sh)) continue;
    if ((sh.coast ?? []).some((o) => o.by === c.id)) continue;
    orderCoastguard(s, c, sh, 'seize');
  }
  for (const id of Object.keys(lines)) if (!s.routes?.[id] || s.routes[id].closed) delete lines[id];
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

// The strait this country most needs that someone has shut (or tolls at 25% or more) for two months: the
// closer, if we can beat its navy
function straitGrievance(s, c) {
  for (const [key, st] of Object.entries(s.chokepoints)) {
    const cp = CHOKEPOINTS[key];
    if (!cp.users?.includes(c.id)) continue;
    const closer = st.closedBy ?? (st.toll && st.toll.rate >= 25 ? st.toll.by : null);
    if (!closer || closer === c.id || allied(s, closer, c.id) || atWar(s, closer, c.id) || !alive(s, closer)) continue;
    if (s.week - (st.closedBy ? st.closedAt ?? 0 : st.toll?.since ?? 0) < 8) continue;
    const them = s.countries[closer];
    if (them && navalPower(c, c.ships, c.carriers) < navalPower(them, them.ships, them.carriers) * 1.2) continue;
    return closer;
  }
  return null;
}

function ambition(s, c, gar) {
  if (s.week < 20 || c.stability < 40 || c.civilWar) return;
  // A strait we live on has been shut: open it by force
  if (!c.ai.plan && !c.minor) {
    const closer = straitGrievance(s, c);
    if (closer && chance(s, 0.15)) {
      c.ai.plan = closer;
      c.ai.planAt = s.week;
      c.ai.planWhy = 'strait';
      makeWarCase(s, c, closer);
      news(s, `${c.name} warns it will use force to reopen the shipping lanes ${nameOf(s, closer)} has shut.`, 'war', [c.id, closer]);
      return;
    }
  }
  const quota = c.minor ? (s.smallWars ??= []) : (s.aiWars ??= []);
  const plan = c.ai.plan;
  if (plan) {
    // A plan made weeks ago: strike if it still makes sense, else shelve it
    const ok = c.ai.planWhy === 'strait' || targetScore(s, c, plan) > 0;
    if (!ok) { c.ai.plan = null; return; }
    if (s.week - c.ai.planAt >= 6) {
      c.ai.plan = null;
      c.ai.planWhy = null;
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
    // The case for the war is prepared in secret while the troops gather
    makeWarCase(s, c, best[0]);
  }
}

// How tempting (and safe) a war on this neighbour looks: 0 means no
function targetScore(s, c, t) {
  if (!alive(s, t) || allied(s, c.id, t) || atWar(s, c.id, t)) return 0;
  // A government doesn't turn on the power that installed it, nor that power on its client
  if (c.regime?.patron === t || s.countries[t]?.regime?.patron === c.id) return 0;
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
  // A shipping line to its biggest free-trade partner overseas
  if (!c.minor && chance(s, 0.04) && Object.values(s.routes ?? {}).filter((r) => r.by === c.id && !r.closed).length < 2) {
    const partner = s.treaties.filter((t) => t.kind === 'fta' && (t.a === c.id || t.b === c.id)).map((t) => (t.a === c.id ? t.b : t.a))
      .map((id) => s.countries[id]).filter((o) => o && alive(s, o.id)).sort((a, b) => b.gdp - a.gdp)[0];
    if (partner) {
      const mine = Object.values(s.regions).filter((r) => r.ctrl === c.id && GEO[r.id]?.coast).sort((a, b) => b.gdp - a.gdp)[0];
      const theirs = Object.values(s.regions).filter((r) => r.ctrl === partner.id && GEO[r.id]?.coast).sort((a, b) => b.gdp - a.gdp)[0];
      if (mine && theirs && !planRoute(s, c, { from: { region: mine.id }, to: { region: theirs.id } }).error && c.treasury > c.gdp * 0.02) openRoute(s, c, { from: { region: mine.id }, to: { region: theirs.id } });
    }
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
