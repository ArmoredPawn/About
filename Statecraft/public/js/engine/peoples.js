// The people in each province, and how loyal they are to whoever rules them.
//
// Every province has a people (the nation it belongs to at the start) and a loyalty (0 to 100) to its current
// ruler. A people ruled by its own nation is loyal unless the government is hated, the province is wrecked, or
// it has a movement for independence. A conquered people resists: loyalty starts near zero and only creeps up
// over many years. Low loyalty means unrest, partisans who starve the occupier's armies of supply, and in the
// end uprisings that can drive the ruler out: a conquered province goes back to its own nation, and a people
// with a movement declares independence.
//
// Rulers choose a policy for each province: integrate (the default), autonomy (more loyal, a little less tax),
// or crackdown (fewer uprisings now, more hatred later). A movement's province can also be offered a
// referendum: win it and the movement is quiet for years; lose it and the province leaves in peace.
// Wars drive refugees across borders, and the countries they reach can take them in or close the border.

import { MOVEMENTS } from './data/peoples.js';
import { GEO } from './data/geo.js';
import { RESOURCES } from './data/regions.js';
import { REGION_NAMES } from './names.js';
import { demandWeight } from './setup.js';
import { startWar } from './diplomacy.js';
import { clamp, chance, rand, news, alert, nameOf, alive, atWar, isMinor } from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;

export const POLICIES = {
  integrate: { name: 'Integrate', note: 'Treat it like any other province. Loyalty follows how well it is governed.' },
  autonomy: { name: 'Autonomy', note: 'Let it run its own affairs: much more loyal, but it keeps more of its taxes (about 8% of its output).' },
  crackdown: { name: 'Crackdown', note: 'Police, checkpoints and arrests: uprisings are far less likely, but loyalty sinks, it costs money every week, and the world notices.' },
};
export const REFERENDUM_COOLDOWN = 52 * 10;
export const PLACATED_WEEKS = 52 * 15;

/* ---------- Setting up ---------- */

export function initPeoples(s) {
  for (const reg of Object.values(s.regions)) {
    if (reg.people) continue;
    reg.people = reg.owner;
    const mv = MOVEMENTS[reg.id];
    reg.loyalty = isMinor(reg.owner) ? 70 : Math.round(78 - 60 * (mv?.strength ?? 0) + (mv?.autonomy ? 8 : 0));
    reg.policy = mv?.autonomy ? 'autonomy' : 'integrate';
    reg.lastCtrl = reg.ctrl;
    reg.heldSince = 0;
  }
}

export const movementOf = (reg) => (reg && reg.people === reg.owner && reg.people === reg.ctrl ? MOVEMENTS[reg.id] ?? null : null);

/* ---------- What each province would settle at ---------- */

// The loyalty a province drifts toward under its current ruler, with the reasons (for the province card)
export function loyaltyTarget(s, reg) {
  const ruler = s.countries[reg.ctrl];
  const why = [];
  if (!ruler) return { value: 70, why };
  let v;
  const own = reg.people === reg.ctrl;
  if (own) {
    v = 78;
    const mood = (ruler.approval - 50) * 0.25;
    v += mood;
    if (Math.abs(mood) >= 2) why.push([mood, mood > 0 ? 'a popular government' : 'an unpopular government']);
    const mv = MOVEMENTS[reg.id];
    if (mv && reg.owner === reg.ctrl) {
      let pull = 60 * mv.strength * (reg.policy === 'autonomy' ? 0.55 : 1) * ((reg.placatedUntil ?? -1) > s.week ? 0.35 : 1);
      v -= pull;
      why.push([-pull, `the ${mv.people}' movement for ${mv.joins ? `union with ${nameOf(s, mv.joins)}` : 'independence'}`]);
    }
  } else {
    // A conquered people: bitter at first, slowly reconciled if governed well
    const years = (s.week - (reg.heldSince ?? s.week)) / 52;
    v = 12;
    why.push([-66, `${nameOf(s, reg.people)}'s people under foreign rule`]);
    if (reg.policy !== 'crackdown') {
      const time = Math.min(35, years * 3.5);
      v += time;
      if (time >= 2) why.push([time, `${Math.floor(years)} years of ${reg.owner === reg.ctrl ? 'rule' : 'occupation'}`]);
    }
    if (alive(s, reg.people) && atWar(s, reg.people, reg.ctrl)) { v -= 10; why.push([-10, `${nameOf(s, reg.people)} is still fighting to win it back`]); }
  }
  if (reg.policy === 'autonomy') { v += 10; why.push([10, 'autonomy']); }
  if (reg.policy === 'crackdown') { v -= 12; why.push([-12, 'the crackdown']); }
  if (reg.dmg > 0.05) { v -= reg.dmg * 30; why.push([-reg.dmg * 30, 'war damage']); }
  if (reg.battle || reg.revolt) { v -= 8; why.push([-8, reg.revolt ? 'the uprising' : 'fighting']); }
  if ((ruler.short?.food ?? 0) > 0.25) { v -= 10; why.push([-10, 'hunger']); }
  return { value: clamp(v, 0, 100), why };
}

/* ---------- Once a week ---------- */

export function peoplesTick(s) {
  for (const reg of Object.values(s.regions)) {
    if (reg.people == null) continue;
    // A new ruler: liberation is greeted, conquest resented
    if (reg.lastCtrl !== reg.ctrl) {
      reg.lastCtrl = reg.ctrl;
      reg.heldSince = s.week;
      if (reg.people === reg.ctrl) reg.loyalty = Math.max(reg.loyalty, 65);
      else reg.loyalty = Math.min(reg.loyalty, 15);
      if (reg.policy === 'autonomy' && reg.people !== reg.ctrl) reg.policy = 'integrate';
    }
    const { value } = loyaltyTarget(s, reg);
    reg.loyalty += (value - reg.loyalty) * 0.04;
    // Unrest follows loyalty: none in a contented province, uprisings likely below about 15 (fear holds it down
    // under a crackdown)
    const calm = Math.max(0, 60 - reg.loyalty) * 1.6 * (reg.policy === 'crackdown' ? 0.82 : 1);
    if (!reg.revolt) reg.unrest = clamp(reg.unrest + (calm - reg.unrest) * 0.1, 0, 95);
    // A crackdown costs money and standing
    const ruler = s.countries[reg.ctrl];
    if (ruler && reg.policy === 'crackdown') {
      ruler.treasury -= Math.max(0.01, reg.pop * 0.004);
      ruler.rep = Math.max(0, ruler.rep - (ruler.gov === 'democracy' ? 0.05 : 0.02));
    }
    breakaway(s, reg);
  }
  refugeesTick(s);
}

// An uprising that has outlasted the ruler's grip ends with the province gone
function breakaway(s, reg) {
  const rv = reg.revolt;
  if (!rv || s.week - rv.since < 10 || reg.loyalty > 25) return;
  const ruler = reg.ctrl;
  if (!s.countries[ruler]) return;
  let hold = 0;
  for (const a of Object.values(s.armies)) if (a.region === reg.id && a.owner === ruler && !a.sea) hold += a.troops;
  if (rv.rebels < Math.max(3, hold * 0.6)) return;
  if (reg.people !== ruler && alive(s, reg.people)) {
    // Partisans hand the province back to its own nation
    evict(s, reg, ruler);
    reg.ctrl = reg.people;
    if (reg.owner === ruler) reg.owner = reg.people;
    reg.revolt = null;
    reg.loyalty = 75;
    news(s, `Partisans drive ${nameOf(s, ruler)} out of ${regionName(reg.id)}. It returns to ${nameOf(s, reg.people)}.`, 'war', [ruler, reg.people]);
    alert(s, ruler, `We have lost ${regionName(reg.id)}: the uprising there drove our forces out.`, 'bad', { region: reg.id, front: true });
    alert(s, reg.people, `Partisans have freed ${regionName(reg.id)} and returned it to us.`, 'good', { region: reg.id, front: true });
    return;
  }
  const mv = MOVEMENTS[reg.id];
  if (reg.people === ruler && mv) independence(s, reg, mv, { war: true });
}

// Our troops in a province that has left: back to our nearest province, or home
function evict(s, reg, ruler) {
  for (const a of Object.values(s.armies)) {
    if (a.owner !== ruler || a.region !== reg.id) continue;
    const back = Object.values(s.regions).find((r) => r.ctrl === ruler && r.id !== reg.id);
    if (back) { a.region = back.id; a.path = []; a.op = { kind: 'hold', target: back.id, aggr: a.op.aggr }; a.status = `Withdrew from ${regionName(reg.id)}`; } else delete s.armies[a.id];
  }
}

// A people's own state, or union with the country the movement wants to join
export function independence(s, reg, mv, { war }) {
  const from = reg.ctrl;
  const rebels = Math.max(5, reg.revolt?.rebels ?? reg.pop * 3);
  evict(s, reg, from);
  reg.revolt = null;
  if (mv.joins && alive(s, mv.joins)) {
    reg.owner = reg.ctrl = mv.joins;
    reg.people = mv.joins;
    reg.loyalty = 70;
    news(s, `${regionName(reg.id)} leaves ${nameOf(s, from)} and joins ${nameOf(s, mv.joins)}.`, war ? 'war' : 'diplomacy', [from, mv.joins]);
    alert(s, from, `${regionName(reg.id)} has left us and joined ${nameOf(s, mv.joins)}.`, 'bad', { region: reg.id });
    alert(s, mv.joins, `${regionName(reg.id)} has joined us.`, 'good', { region: reg.id });
    return mv.joins;
  }
  const id = `m-x-${reg.id}`;
  const stock = {};
  const minor = s.minors[id] ?? {};
  Object.assign(minor, {
    id, name: mv.state.replace(/^the /, '').replace(/^\w/, (x) => x.toUpperCase()), troops: rebels, tanks: 0, nukes: 0, guarantor: null, chokepoint: null,
    puppetOf: null, annexed: false, capitulated: false, gdp: reg.gdp, pop: reg.pop, short: {}, stock, home: reg.id, breakaway: from,
  });
  s.minors[id] = minor;
  for (const r of RESOURCES) stock[r] = demandWeight(s, minor, r) * (s.intensity[r] ?? 0) * 4;
  reg.owner = reg.ctrl = id;
  reg.people = id;
  reg.lastCtrl = id;
  reg.heldSince = s.week;
  reg.loyalty = 85;
  reg.policy = 'integrate';
  if (war) {
    startWar(s, id, from, 'independence');
    news(s, `${minor.name} declares independence from ${nameOf(s, from)} after a successful uprising. ${nameOf(s, from)} vows to take it back.`, 'war', [from, id]);
  } else {
    news(s, `${minor.name} becomes independent of ${nameOf(s, from)} after a referendum, peacefully.`, 'diplomacy', [from, id]);
  }
  alert(s, from, `${regionName(reg.id)} has become independent as ${minor.name}.`, 'bad', { region: reg.id });
  return id;
}

/* ---------- Orders ---------- */

export function setProvincePolicy(s, c, regionId, policy) {
  const reg = s.regions[regionId];
  if (!reg || reg.ctrl !== c.id) return 'You don\'t hold that province.';
  if (!POLICIES[policy]) return 'Pick a policy.';
  if (reg.policy === policy) return null;
  const was = reg.policy;
  reg.policy = policy;
  if (policy === 'crackdown') {
    reg.loyalty = Math.max(0, reg.loyalty - 5);
    news(s, `${c.name} launches a security crackdown in ${regionName(regionId)}.`, 'unrest', [c.id]);
    c.rep = Math.max(0, c.rep - (c.gov === 'democracy' ? 3 : 1));
  } else if (policy === 'autonomy') {
    reg.loyalty = Math.min(100, reg.loyalty + 4);
    news(s, `${c.name} grants autonomy to ${regionName(regionId)}.`, 'diplomacy', [c.id]);
  } else if (was === 'crackdown') news(s, `${c.name} ends the crackdown in ${regionName(regionId)}.`, 'unrest', [c.id]);
  return null;
}

// What a referendum would decide today: { leave share, likely to leave }
export function referendumOdds(reg) {
  const leave = clamp(0.5 + (40 - reg.loyalty) / 70, 0.03, 0.97);
  return { leave, likely: leave > 0.5 };
}

export function holdReferendum(s, c, regionId) {
  const reg = s.regions[regionId];
  const mv = movementOf(reg);
  if (!reg || reg.ctrl !== c.id || !mv) return 'Only a province of ours with a movement for independence can hold one.';
  if ((reg.referendumAt ?? -REFERENDUM_COOLDOWN) > s.week - REFERENDUM_COOLDOWN) return `A referendum was held there in ${Math.floor(reg.referendumAt / 52) + 2027}. The next can come ten years later.`;
  if (reg.revolt) return 'Not during an uprising.';
  reg.referendumAt = s.week;
  const { leave } = referendumOdds(reg);
  const share = clamp(leave + (rand(s) - 0.5) * 0.08, 0.02, 0.98);
  const pct = Math.round(share * 100);
  if (share > 0.5) {
    news(s, `${regionName(regionId)} votes ${pct}% to leave ${c.name}.`, 'diplomacy', [c.id]);
    c.rep = Math.min(100, c.rep + 6);
    c.approval = Math.max(0, c.approval - 4);
    independence(s, reg, mv, { war: false });
  } else {
    reg.placatedUntil = s.week + PLACATED_WEEKS;
    reg.loyalty = Math.min(100, reg.loyalty + 15);
    c.rep = Math.min(100, c.rep + 3);
    news(s, `${regionName(regionId)} votes ${100 - pct}% to stay part of ${c.name}. The ${mv.people}' movement for ${mv.joins ? 'union' : 'independence'} loses its momentum.`, 'diplomacy', [c.id]);
  }
  return null;
}

/* ---------- Refugees ---------- */

export function setBorder(s, c, closed) {
  c.borderClosed = Boolean(closed);
  news(s, closed ? `${c.name} closes its borders to refugees.` : `${c.name} opens its borders to refugees.`, 'diplomacy', [c.id]);
  return null;
}

// Wars, uprisings and ruin push people out, across the nearest border that will take them
function refugeesTick(s) {
  const flows = new Map();
  for (const reg of Object.values(s.regions)) {
    const danger = (reg.battle ? 1 : 0) + (reg.revolt ? 0.7 : 0) + (reg.dmg > 0.3 ? reg.dmg - 0.3 : 0);
    if (!danger || reg.pop < 0.05) continue;
    const from = reg.ctrl;
    // Next door: the country with the most border that isn't at war with the people fleeing, and isn't the ruler
    const options = new Map();
    for (const id of GEO[reg.id]?.adj ?? []) {
      const n = s.regions[id];
      const host = s.countries[n?.ctrl];
      if (!host || n.ctrl === from || !alive(s, host.id) || atWar(s, host.id, reg.people) || n.battle) continue;
      options.set(host.id, (options.get(host.id) ?? 0) + 1);
    }
    if (!options.size) continue;
    const host = s.countries[[...options].sort((a, b) => b[1] - a[1])[0][0]];
    const flow = Math.min(reg.pop * 0.004 * danger, 0.4);
    if (host.borderClosed) { host.turnedAway = (host.turnedAway ?? 0) + flow; continue; }
    reg.pop -= flow;
    host.refugees = (host.refugees ?? 0) + flow;
    const key = `${from}>${host.id}`;
    flows.set(key, (flows.get(key) ?? 0) + flow);
  }
  for (const [key, flow] of flows) {
    const [from, to] = key.split('>');
    const host = s.countries[to];
    host.refugeesFrom ??= {};
    const before = host.refugeesFrom[from] ?? 0;
    host.refugeesFrom[from] = before + flow;
    // A headline for every million who cross
    if (Math.floor(before) < Math.floor(before + flow)) {
      news(s, `More than ${Math.floor(before + flow)} million refugees from ${nameOf(s, from)} have now fled to ${host.name}.`, 'war', [from, to]);
    }
  }
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    // Shelter, food and schools for refugees cost money; a little under a third of them settle each year
    if (c.refugees > 0.001) {
      const cost = c.refugees * 0.04 * (0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60));
      c.treasury -= cost;
      c.refugeeCost = cost * 52;
      const settle = c.refugees * 0.006;
      c.refugees -= settle;
      c.pop += settle;
      const share = c.refugees / Math.max(1, c.pop);
      if (share > 0.004) c.approval = Math.max(0, c.approval - Math.min(0.3, share * 20) * (c.gov === 'democracy' ? 1 : 0.4));
    } else { c.refugees = 0; c.refugeeCost = 0; }
    // Turning people away at the border is noticed
    if (c.turnedAway > 0.001) {
      c.rep = Math.max(0, c.rep - Math.min(0.3, c.turnedAway * 2));
      c.turnedAway *= 0.5;
    }
  }
}

/* ---------- Computer-run rulers ---------- */

export function aiPeoples(s, c) {
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== c.id) continue;
    const mv = movementOf(reg);
    // Democracies give restless regions autonomy, and sometimes put the question to a vote
    if (c.gov === 'democracy') {
      if (reg.policy === 'crackdown' && !reg.revolt) setProvincePolicy(s, c, reg.id, 'integrate');
      if (mv && reg.loyalty < 45 && reg.policy !== 'autonomy') setProvincePolicy(s, c, reg.id, 'autonomy');
      if (mv && reg.loyalty < 38 && !reg.revolt && chance(s, 0.02)) holdReferendum(s, c, reg.id);
      continue;
    }
    // Autocracies crack down where uprisings threaten, and ease off once things are quiet
    if ((reg.revolt || reg.loyalty < 25) && reg.policy !== 'crackdown') setProvincePolicy(s, c, reg.id, 'crackdown');
    else if (reg.policy === 'crackdown' && !reg.revolt && reg.loyalty > 45) setProvincePolicy(s, c, reg.id, 'integrate');
  }
  // A flood of refugees: hybrid regimes and autocracies close the border; democracies only when it is huge
  const share = (c.refugees ?? 0) / Math.max(1, c.pop);
  if (!c.borderClosed && share > (c.gov === 'democracy' ? 0.02 : 0.006)) setBorder(s, c, true);
  else if (c.borderClosed && share < 0.002 && !Object.values(s.regions).some((r) => r.battle)) setBorder(s, c, false);
}
