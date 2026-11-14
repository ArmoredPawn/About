// Every order a leader can give. Each command is checked here, so a player can't do anything their country
// couldn't. A command returns null when it worked, or a message saying why not.

import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import { TECH_FIELDS } from './data/world.js';
import { REGION_NAMES } from './names.js';
import { clamp, news, alert, alive, nameOf, money, nextId, atWar, friendlyGround } from './core.js';
import { BUILD, PROJECT_WEEKS, maxOrders, maxProjects, costFactor } from './economy.js';
import {
  createArmy, orderArmy, disbandArmy, reinforceArmy, mergeArmies, missileStrike, nuclearStrike,
  setAirCampaign, settleMinor, checkOrder,
} from './military.js';
import { formFleet, fleetOrder, reinforceFleet, mergeFleets, disbandFleet, renameFleet, recallFleets } from './navy.js';
import { setProvincePolicy, holdReferendum, setBorder } from './peoples.js';
import { startAid, stopAid } from './proxy.js';
import { setCarbonTax, makePledge } from './climate.js';
import { launchSatellite, startProgramme, cancelProgramme, antiSatellite } from './space.js';
import { cartelJoin, cartelLeave, cartelFound, setCut, setEmbargo, setCheat, expel, releaseReserve, setPipeline, sabotagePipeline, buildPipeline } from './energy.js';
import {
  declareWar, propose, respond, createAlliance, leaveAlliance, setSanctions, setTariff, giveAid, shareTech, embassy,
  annex, setChokepoint, proposeResolution, vote,
} from './diplomacy.js';
import { covertOp } from './events.js';
import { setConscription, setSecurity, setPress, handleProtest, handleUprising, makeWarCase } from './government.js';
import { buy, sellToWorld, setOffer, orderIntercept, setToll, setStraitPolicy } from './trade.js';
import { plant, recall, setCounterIntel, sweep, intelAction } from './spies.js';
import { startResearch, cancelResearch, buyLicence, extendRange } from './science.js';
import { setAllianceSecrecy } from './diplomacy.js';
import { decide } from './decisions.js';
import { intervene, capitalControls, requestImf } from './finance.js';
import { setPandemicPolicy, fundVaccine, sendFamineAid } from './crises.js';
import { payGenerals, purge, civilianRule, backCoup } from './coups.js';

const regionName = (id) => REGION_NAMES[id] ?? id;
export const SPEND_KEYS = ['defence', 'infra', 'edu', 'health', 'research', 'welfare'];

const num = (v) => Number(v);
const valid = (v) => Number.isFinite(Number(v));

export function runCommand(s, cid, cmd) {
  const c = s.countries[cid];
  if (!c || !cmd || typeof cmd.type !== 'string') return 'Unknown command.';
  if (s.over) return 'The game is over.';
  if (!alive(s, cid)) return 'Your government is in exile.';
  const handler = HANDLERS[cmd.type];
  if (!handler) return 'Unknown command.';
  const result = handler(s, c, cmd);
  return result ?? null;
}

const HANDLERS = {
  /* ---------- Economy ---------- */
  policy(s, c, { tax, spend, rate }) {
    if (tax != null) {
      if (!valid(tax)) return 'Tax must be a number.';
      c.tax = clamp(Math.round(num(tax) * 10) / 10, 5, 70);
    }
    if (spend && typeof spend === 'object') {
      for (const k of SPEND_KEYS) {
        if (spend[k] == null) continue;
        if (!valid(spend[k])) return 'Spending must be a number.';
        c.spend[k] = clamp(Math.round(num(spend[k]) * 10) / 10, 0, k === 'defence' ? 35 : 25);
      }
    }
    if (rate != null) {
      if (!valid(rate)) return 'The interest rate must be a number.';
      c.rate = clamp(Math.round(num(rate) * 100) / 100, 0, 60);
    }
    return null;
  },

  stimulus(s, c, { amount }) {
    amount = num(amount);
    if (!(amount > 0) || amount > c.gdp * 0.1) return `A stimulus can be up to ${money(c.gdp * 0.1)} (10% of GDP).`;
    if (c.stimulus && c.stimulus.until > s.week) return 'A stimulus package is already running.';
    c.debt += Math.max(0, amount - c.treasury);
    c.treasury = Math.max(0, c.treasury - amount);
    c.stimulus = { amount, boost: (amount / c.gdp) * 100 * 0.6, until: s.week + 26 };
    news(s, `${c.name} launches a ${money(amount)} stimulus package.`, 'economy', [c.id]);
    return null;
  },

  repay(s, c, { amount }) {
    amount = num(amount);
    if (!(amount > 0) || amount > c.treasury) return `You can repay up to ${money(c.treasury)}.`;
    amount = Math.min(amount, c.debt);
    c.treasury -= amount;
    c.debt -= amount;
    return null;
  },

  reserve(s, c, { res, weeks }) {
    if (!RESOURCES.includes(res)) return 'Pick a resource.';
    weeks = num(weeks);
    if (!(weeks > 0 && weeks <= 12)) return 'Buy 1 to 12 weeks of reserves.';
    const qty = (c.demand[res] ?? 0) * weeks;
    const cost = (qty * RESOURCE_INFO[res].value / 52) * s.market.price[res] * 1.1;
    if (cost > c.treasury) return `That costs ${money(cost)}; the treasury has ${money(c.treasury)}.`;
    if (s.market.offer[res] < qty / 4) return 'The world market can\'t supply that much right now.';
    c.treasury -= cost;
    c.stock[res] = (c.stock[res] ?? 0) + qty;
    return null;
  },

  develop(s, c, { region, res }) {
    const reg = s.regions[region];
    if (!reg || reg.owner !== c.id || reg.ctrl !== c.id) return 'You can only develop provinces you own and hold.';
    const r = reg.res[res];
    if (!r || r[1] <= r[0]) return 'There is nothing more to develop there.';
    if (c.projects.some((p) => p.region === region && p.res === res)) return 'That project is already under way.';
    if (c.projects.length >= maxProjects(c)) return `You can run ${maxProjects(c)} projects at once.`;
    const cost = (r[1] - r[0]) * RESOURCE_INFO[res].value * 0.8 * costFactor(c);
    if (cost > c.treasury) return `That costs ${money(cost)}; the treasury has ${money(c.treasury)}.`;
    c.treasury -= cost;
    c.projects.push({ id: nextId(s, 'pj'), kind: 'develop', region, res, left: PROJECT_WEEKS[res], total: PROJECT_WEEKS[res], cost });
    return null;
  },

  infra(s, c, { region }) {
    const reg = s.regions[region];
    if (!reg || reg.owner !== c.id || reg.ctrl !== c.id) return 'You can only build in provinces you own and hold.';
    if (reg.infra >= 10) return 'Infrastructure there is already at its best.';
    if (c.projects.some((p) => p.region === region && p.kind === 'infra')) return 'Construction is already under way there.';
    if (c.projects.length >= maxProjects(c)) return `You can run ${maxProjects(c)} projects at once.`;
    const cost = reg.gdp * 0.03 + 1;
    if (cost > c.treasury) return `That costs ${money(cost)}.`;
    c.treasury -= cost;
    c.projects.push({ id: nextId(s, 'pj'), kind: 'infra', region, left: 26, total: 26, cost });
    return null;
  },

  fortify(s, c, { region }) {
    const reg = s.regions[region];
    if (!reg || reg.ctrl !== c.id) return 'You can only fortify provinces you hold.';
    if (reg.fort >= 5) return 'Those defences are as strong as they get.';
    if (c.projects.some((p) => p.region === region && p.kind === 'fort')) return 'Work is already under way there.';
    if (c.projects.length >= maxProjects(c)) return `You can run ${maxProjects(c)} projects at once.`;
    const cost = (reg.fort + 1) * 0.6 * costFactor(c);
    if (cost > c.milFunds + c.treasury) return `That costs ${money(cost)}.`;
    pay(c, cost);
    c.projects.push({ id: nextId(s, 'pj'), kind: 'fort', region, left: 12, total: 12, cost });
    return null;
  },

  cancelProject(s, c, { id }) {
    const p = c.projects.find((x) => x.id === id);
    if (!p) return 'No such project.';
    c.projects = c.projects.filter((x) => x !== p);
    c.treasury += (p.cost ?? 0) * 0.5 * (p.left / p.total);
    return null;
  },

  focus(s, c, { field }) {
    if (!TECH_FIELDS[field]) return 'Pick a research field.';
    c.focus = field;
    return null;
  },

  /* ---------- Home front ---------- */
  mobilize(s, c, { level }) {
    level = num(level);
    if (![0, 1, 2].includes(level)) return 'Pick a mobilisation level.';
    if (level === c.mob) return null;
    if (level > c.mob) news(s, `${c.name} orders ${level === 2 ? 'full' : 'partial'} mobilisation.`, 'war', [c.id]);
    c.mob = level;
    return null;
  },

  ration(s, c, { on }) { c.ration = Boolean(on); return null; },

  martial(s, c, { on }) {
    on = Boolean(on);
    if (on && !c.martial) {
      c.rep = Math.max(0, c.rep - 10);
      news(s, `${c.name} declares martial law.`, 'unrest', [c.id]);
    }
    c.martial = on;
    return null;
  },

  propaganda(s, c) {
    if ((c.cooldown.propaganda ?? -1) > s.week) return `Another campaign is possible in ${c.cooldown.propaganda - s.week} weeks.`;
    const cost = c.gdp * 0.0005;
    if (cost > c.treasury) return 'Not enough money in the treasury.';
    c.treasury -= cost;
    c.boost += 6;
    c.cooldown.propaganda = s.week + 13;
    return null;
  },

  snapElection(s, c) {
    if (c.gov === 'autocracy') return 'Your system has no elections to call.';
    if ((c.cooldown.election ?? -1) > s.week) return 'You called an election recently.';
    c.cooldown.election = s.week + 104;
    c.electionWeek = s.week + 4;
    news(s, `${c.name} calls a snap election in four weeks.`, 'election', [c.id]);
    return null;
  },

  nukeProgram(s, c, { on }) {
    on = Boolean(on);
    if (c.nukes > 0) return 'You already have nuclear weapons.';
    if (on && !c.nukeProgram.on) {
      c.rep = Math.max(0, c.rep - 10);
      news(s, `Inspectors report that ${c.name} has begun enriching uranium to weapons grade.`, 'nuclear', [c.id]);
    }
    c.nukeProgram.on = on;
    return null;
  },

  /* ---------- Military production ---------- */
  build(s, c, { kind, batches = 1 }) {
    const b = BUILD[kind];
    if (!b) return 'Pick something to build.';
    batches = Math.floor(num(batches));
    if (!(batches >= 1 && batches <= 20)) return 'Order 1 to 20 batches.';
    if (b.tech && c.tech[b.tech[0]] < b.tech[1]) return `Carriers need ${TECH_FIELDS[b.tech[0]].name} level ${b.tech[1]}.`;
    if (kind === 'nukes' && c.nukes <= 0) return 'You need a working nuclear weapon first: start a weapons programme.';
    if (c.queue.length + batches > maxOrders(c)) return `Your industry can handle ${maxOrders(c)} orders at once (${c.queue.length} running).`;
    const cost = b.cost * costFactor(c) * batches;
    if (cost > c.milFunds + c.treasury) return `That costs ${money(cost)}; you have ${money(c.milFunds)} in defence funds and ${money(c.treasury)} in reserves.`;
    pay(c, cost);
    for (let i = 0; i < batches; i++) c.queue.push({ id: nextId(s, 'q'), kind, qty: b.batch, left: b.weeks, total: b.weeks, cost: cost / batches });
    return null;
  },

  cancelBuild(s, c, { id }) {
    const o = c.queue.find((x) => x.id === id);
    if (!o) return 'No such order.';
    c.queue = c.queue.filter((x) => x !== o);
    c.milFunds += (o.cost ?? 0) * 0.5 * (o.left / o.total);
    return null;
  },

  /* ---------- Armies and operations ---------- */
  armyCreate(s, c, cmd) { return createArmy(s, c, cmd); },
  // With declare, an attack on a country we're not at war with declares war first (leaving shared alliances),
  // but only once the attack itself is known to be possible
  // kind 'go' sends the army to the province whatever it takes: marching through friendly ground, fighting
  // through enemy ground, or landing from the sea
  armyOrder(s, c, { id, ids, kind, target, aggr, declare }) {
    const list = (ids ?? [id]).map((x) => s.armies[x]);
    if (!list.length || list.some((a) => !a)) return 'Pick an army.';
    const holder = s.regions[target]?.ctrl;
    if (declare && ['attack', 'invade', 'go'].includes(kind) && holder && holder !== c.id && !atWar(s, c.id, holder)
      // "go" to an ally's or partner's province just marches there; an explicit attack on them is war
      && !(kind === 'go' && friendlyGround(s, c.id, holder))) {
      for (const a of list) {
        const err = checkOrder(s, c, a, { kind, target, aggr });
        if (err) return list.length > 1 ? `${a.name}: ${err}` : err;
      }
      const err = declareWar(s, c, holder, 'conquest', { leaveShared: true });
      if (err) return err;
    }
    for (const a of list) {
      const err = orderArmy(s, c, a, { kind, target, aggr });
      if (err) return list.length > 1 ? `${a.name}: ${err}` : err;
      a.orderedAt = s.week;
    }
    return null;
  },
  armyDisband(s, c, { id }) { return disbandArmy(s, c, s.armies[id]); },
  armyReinforce(s, c, { id, troops, tanks }) { return reinforceArmy(s, c, s.armies[id], { troops, tanks }); },
  armyMerge(s, c, { ids }) { return Array.isArray(ids) ? mergeArmies(s, c, ids) : 'Pick armies to merge.'; },
  armyRename(s, c, { id, name }) {
    const a = s.armies[id];
    if (!a || a.owner !== c.id) return 'That army is not yours.';
    const clean = String(name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 28);
    if (!clean) return 'Enter a name.';
    a.name = clean;
    return null;
  },
  missile(s, c, { region, count, aim }) { return missileStrike(s, c, region, count, aim); },
  nuke(s, c, { region }) { return nuclearStrike(s, c, region); },
  blockade(s, c, { target }) { return recallFleets(s, c, { target }); },
  /* ---------- Navy ---------- */
  fleetForm(s, c, { region, sea, ships, carriers, name }) { return formFleet(s, c, { region, sea, ships, carriers, name }); },
  fleetOrder(s, c, { id, x, y, to, mission, mode, target }) { return fleetOrder(s, c, { id, x, y, to, mission, mode, target }); },
  fleetReinforce(s, c, { id, ships, carriers }) { return reinforceFleet(s, c, { id, ships, carriers }); },
  fleetMerge(s, c, { ids }) { return mergeFleets(s, c, ids); },
  fleetDisband(s, c, { id }) { return disbandFleet(s, c, { id }); },
  fleetRename(s, c, { id, name }) { return renameFleet(s, c, { id, name }); },
  air(s, c, { region, aircraft, mission }) { return setAirCampaign(s, c, region, aircraft, mission); },

  /* ---------- Diplomacy ---------- */
  war(s, c, { target, goal }) { return declareWar(s, c, target, goal, { leaveShared: true }); },
  propose(s, c, { to, kind, terms }) { return propose(s, c.id, to, kind, terms && typeof terms === 'object' ? terms : {}); },
  respond(s, c, { id, accept }) { return respond(s, c.id, id, Boolean(accept)); },
  allianceCreate(s, c, { name, kind, invite, secret }) {
    const result = createAlliance(s, c, { name, kind, secret: Boolean(secret) });
    if (typeof result === 'string') return result;
    for (const to of Array.isArray(invite) ? invite.slice(0, 49) : []) propose(s, c.id, to, 'alliance', { alliance: result.id });
    return null;
  },
  allianceLeave(s, c, { id }) { return leaveAlliance(s, c, id); },
  allianceInvite(s, c, { id, to }) { return propose(s, c.id, to, 'alliance', { alliance: id }); },
  sanction(s, c, { target, on }) { return setSanctions(s, c, target, Boolean(on)); },
  tariff(s, c, { target, level }) { return setTariff(s, c, target, level); },
  aid(s, c, { to, amount }) { return giveAid(s, c, to, amount); },
  tech(s, c, { to, field }) { return shareTech(s, c, to, field); },
  embassy(s, c, { target, action }) { return embassy(s, c, target, action); },
  annex(s, c, { region }) { return annex(s, c, region); },
  settle(s, c, { minor, how }) {
    const m = s.minors[minor];
    if (!m?.pendingSettle || m.pendingSettle.by !== c.id) return 'That nation did not surrender to you.';
    return settleMinor(s, c.id, minor, how === 'annex' ? 'annex' : 'puppet');
  },
  strait(s, c, { key, close }) { return setChokepoint(s, c, key, Boolean(close)); },
  unPropose(s, c, { kind, target }) { return proposeResolution(s, c, kind, target); },
  unVote(s, c, { id, vote: v }) { return vote(s, c, id, v); },
  intel(s, c, { op, target, region }) { return covertOp(s, c, op, target, region); },
  allianceReveal(s, c, { id }) { return setAllianceSecrecy(s, c, id, false); },

  /* ---------- Government ---------- */
  conscription(s, c, { level }) { return setConscription(s, c, level); },
  security(s, c, { level }) { return setSecurity(s, c, level); },
  press(s, c, { level }) { return setPress(s, c, level); },
  warCase(s, c, { target }) { return makeWarCase(s, c, target); },
  protest(s, c, { id, action }) { return handleProtest(s, c, id, action); },
  uprising(s, c, { region, action }) { return handleUprising(s, c, region, action); },
  provincePolicy(s, c, { region, policy }) { return setProvincePolicy(s, c, region, policy); },
  referendum(s, c, { region }) { return holdReferendum(s, c, region); },
  border(s, c, { closed }) { return setBorder(s, c, closed); },
  aidStart(s, c, { to, rebels, kind, size, covert }) { return startAid(s, c, { to, rebels, kind, size, covert }); },
  aidStop(s, c, { id }) { return stopAid(s, c, { id }); },
  /* ---------- Oil and gas ---------- */
  cartelJoin(s, c) { return cartelJoin(s, c); },
  cartelLeave(s, c) { return cartelLeave(s, c); },
  cartelFound(s, c, { name }) { return cartelFound(s, c, { name }); },
  cartelCut(s, c, { cut }) { return setCut(s, c, { cut }); },
  cartelEmbargo(s, c, { target, on }) { return setEmbargo(s, c, { target, on }); },
  cartelCheat(s, c, { on }) { return setCheat(s, c, { on }); },
  cartelExpel(s, c, { target }) { return expel(s, c, { target }); },
  releaseReserve(s, c, { res, share }) { return releaseReserve(s, c, { res, share }); },
  pipeline(s, c, { id, shut }) { return setPipeline(s, c, { id, shut }); },
  pipelineSabotage(s, c, { id }) { return sabotagePipeline(s, c, { id }); },
  pipelineBuild(s, c, { id }) { return buildPipeline(s, c, { id }); },
  /* ---------- Climate ---------- */
  carbonTax(s, c, { level }) { return setCarbonTax(s, c, level); },
  pledge(s, c, { cut, year }) { return makePledge(s, c, { cut, year }); },
  /* ---------- Space ---------- */
  satellite(s, c, { kind }) { return launchSatellite(s, c, { kind }); },
  spaceProgramme(s, c, { kind }) { return startProgramme(s, c, { kind }); },
  spaceCancel(s, c, { kind }) { return cancelProgramme(s, c, { kind }); },
  asat(s, c, { target, kind }) { return antiSatellite(s, c, { target, kind }); },

  /* ---------- Market and shipping ---------- */
  marketBuy(s, c, { res, qty, from, covert }) { return buy(s, c, { res, qty, from, covert: Boolean(covert) }); },
  marketSell(s, c, { res, qty }) { return sellToWorld(s, c, { res, qty }); },
  marketOffer(s, c, { res, qty, markup }) { return setOffer(s, c, { res, qty, markup }); },
  intercept(s, c, { id, how }) { return orderIntercept(s, c, { id, how }); },
  toll(s, c, { key, rate }) { return setToll(s, c, key, rate); },
  straitPolicy(s, c, { key, policy }) { return setStraitPolicy(s, c, key, policy); },
  // Patrols and blockades are fleets now; these call them off
  patrol(s, c, { key }) { return recallFleets(s, c, { key }); },

  /* ---------- Spies ---------- */
  spyPlant(s, c, { target, agents }) { return plant(s, c, target, agents); },
  spyRecall(s, c, { target }) { return recall(s, c, target); },
  counterIntel(s, c, { level }) { return setCounterIntel(s, c, level); },
  spySweep(s, c) { return sweep(s, c); },
  intelAct(s, c, { id, action }) { return intelAction(s, c, { id, action }); },

  /* ---------- Science ---------- */
  research(s, c, { field }) { return startResearch(s, c, field); },
  cancelResearch(s, c, { id }) { return cancelResearch(s, c, id); },
  licence(s, c, { from, field }) { return buyLicence(s, c, from, field); },
  range(s, c, { kind }) { return extendRange(s, c, kind); },

  /* ---------- Decisions, markets, crises and the army ---------- */
  decide(s, c, { id, option }) { return decide(s, c, id, option); },
  fxIntervene(s, c, { amount }) { return intervene(s, c, amount); },
  capitalControls(s, c, { on }) { return capitalControls(s, c, on); },
  imf(s, c) { return requestImf(s, c); },
  pandemicPolicy(s, c, { policy, borders }) { return setPandemicPolicy(s, c, { policy, borders }); },
  vaccineFund(s, c, { amount }) { return fundVaccine(s, c, amount); },
  famineAid(s, c, { crisis, size }) { return sendFamineAid(s, c, crisis, ['small', 'large'].includes(size) ? size : 'small'); },
  payGenerals(s, c) { return payGenerals(s, c); },
  purge(s, c) { return purge(s, c); },
  civilianRule(s, c) { return civilianRule(s, c); },
  backCoup(s, c, { target, amount }) { return backCoup(s, c, target, amount); },
};

function pay(c, cost) {
  const fromFunds = Math.min(c.milFunds, cost);
  c.milFunds -= fromFunds;
  c.treasury -= cost - fromFunds;
}

export { regionName, alert, nameOf };
