// Diplomacy: war and peace, alliances, treaties, deals, sanctions, the straits and the UN Security Council.

import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import { CHOKEPOINTS } from './data/world.js';
import { REGION_NAMES } from './names.js';
import {
  P5, clamp, news, alert, nameOf, nation, isMinor, alive, atWar, allied, enemiesOf, alliancesOf, treaty, rel, addRel,
  setRel, nextId, money, warBetween, warCaseMade,
} from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;
export const PROPOSAL_WEEKS = 4;

export const PROPOSALS = {
  alliance: 'Join alliance',
  fta: 'Free trade agreement',
  nap: 'Non-aggression pact',
  access: 'Military access',
  deal: 'Resource deal',
  loan: 'Loan',
  peace: 'Peace treaty',
  joinWar: 'Join the war',
  callToArms: 'Call to arms',
};

/* ---------- War ---------- */

// With leaveShared, any alliance or trade bloc both sides belong to is left first, in the same step
export function declareWar(s, c, target, goal = 'conquest', { leaveShared = false } = {}) {
  const t = nation(s, target);
  if (!t || !alive(s, target) || target === c.id) return 'Pick a country to declare war on.';
  if (atWar(s, c.id, target)) return `You are already at war with ${t.name}.`;
  if (s.minors[target]?.puppetOf === c.id) return `${t.name} is already under your control.`;
  if (s.minors[target]?.capitulated) return `${t.name} has already surrendered.`;
  const shared = Object.values(s.alliances).filter((al) => al.members.includes(c.id) && al.members.includes(target));
  const blocking = shared.find((al) => al.kind === 'military');
  if (blocking && !leaveShared) return `You are both in ${blocking.name}. Leave it before going to war.`;
  if (leaveShared) for (const al of shared) leaveAlliance(s, c, al.id);

  const nap = treaty(s, 'nap', c.id, target);
  const claim = c.claims.some((rid) => s.regions[rid]?.ctrl === target);
  // A leader who has made the case to the nation goes to war with the public behind them
  const justified = warCaseMade(s, c, target);
  let cost = claim ? 5 : justified ? 10 : 18;
  if (nap) {
    s.treaties = s.treaties.filter((x) => x !== nap);
    cost += 25;
    news(s, `${c.name} tears up its non-aggression pact with ${t.name}.`, 'diplomacy', [c.id, target]);
  }
  c.rep = Math.max(0, c.rep - cost);
  if (justified) c.rally += 8;
  else if (c.gov !== 'autocracy' && rel(s, c.id, target) > -50 && !claim) c.boost -= 6;
  s.treaties = s.treaties.filter((x) => !(['fta', 'access', 'deal'].includes(x.kind) && ((x.a === c.id && x.b === target) || (x.b === c.id && x.a === target))));
  startWar(s, c.id, target, goal);
  if (justified || claim) warBetween(s, c.id, target).justified = c.id;
  news(s, `${c.name} declares war on ${t.name}${claim ? ', pressing its territorial claims' : justified ? ' after its leader made the case to the nation' : ''}.`, 'war', [c.id, target]);
  if (s.countries[target]) {
    s.countries[target].rally += 14;
    alert(s, target, `${c.name} has declared war on us. Our people rally to the flag.`, 'war');
  }
  callAllies(s, c.id, target);
  reactToAggression(s, c.id, target);
  return null;
}

export function startWar(s, a, b, goal = 'conquest') {
  if (atWar(s, a, b)) return;
  s.wars.push({ id: nextId(s, 'w'), a, b, since: s.week, goal, lossA: 0, lossB: 0 });
  addRel(s, a, b, -60);
  for (const p of Object.values(s.proposals)) {
    if ((p.from === a && p.to === b) || (p.from === b && p.to === a)) delete s.proposals[p.id];
  }
}

// Defensive allies and guarantors are called to fight
function callAllies(s, aggressor, victim) {
  const called = new Set();
  for (const al of alliancesOf(s, victim, 'military')) {
    for (const m of al.members) if (m !== victim && m !== aggressor) called.add(m);
  }
  const g = s.minors[victim]?.guarantor;
  if (g && g !== aggressor) called.add(g);
  for (const m of called) {
    const c = s.countries[m];
    if (!c || !alive(s, m) || atWar(s, m, aggressor) || allied(s, m, aggressor)) continue;
    if (c.human) {
      propose(s, victim, m, 'callToArms', { enemy: aggressor, ally: victim }, true);
      continue;
    }
    const guarantor = s.minors[victim]?.guarantor === m;
    const willing = rel(s, m, aggressor) < 40 && (guarantor || al(s, m, victim) || rel(s, m, victim) > 40);
    if (willing) {
      for (const pact of alliancesOf(s, victim, 'military')) if (pact.secret && pact.members.includes(m)) revealAlliance(s, pact, `as ${c.name} goes to war for ${nameOf(s, victim)}`);
      startWar(s, m, aggressor, 'defence');
      news(s, `${c.name} honours its commitments and declares war on ${nameOf(s, aggressor)} in defence of ${nameOf(s, victim)}.`, 'war', [m, aggressor, victim]);
      alert(s, aggressor, `${c.name} has entered the war against us.`, 'war');
    } else {
      news(s, `${c.name} declines to fight for ${nameOf(s, victim)}.`, 'diplomacy', [m, victim]);
    }
  }
}

const al = (s, a, b) => allied(s, a, b);

// Friends of the victim with no love for the aggressor impose sanctions
function reactToAggression(s, aggressor, victim) {
  const ag = s.countries[aggressor];
  const sanctioners = [];
  for (const c of Object.values(s.countries)) {
    if (c.human || c.id === aggressor || c.id === victim || !alive(s, c.id)) continue;
    if (allied(s, c.id, aggressor)) continue;
    const friend = allied(s, c.id, victim) || rel(s, c.id, victim) > 35;
    if (friend && rel(s, c.id, aggressor) < 20 && !s.sanctions[`${c.id}>${aggressor}`]) {
      s.sanctions[`${c.id}>${aggressor}`] = true;
      addRel(s, c.id, aggressor, -15);
      sanctioners.push(c.name);
    } else {
      addRel(s, c.id, aggressor, friend ? -20 : -6);
    }
  }
  if (sanctioners.length && ag) {
    news(s, `${sanctioners.length} countries impose sanctions on ${ag.name} over its attack on ${nameOf(s, victim)}.`, 'diplomacy', [aggressor]);
    alert(s, aggressor, `In response to the war, sanctions were imposed by: ${sanctioners.join(', ')}.`, 'bad');
  }
}

export function makePeace(s, a, b, terms = {}) {
  const war = warBetween(s, a, b);
  if (!war) return;
  s.wars = s.wars.filter((w) => w !== war);
  const cede = terms.cede ?? [];
  const ceded = new Set();
  for (const { region, to } of cede) {
    const reg = s.regions[region];
    if (!reg || (to !== a && to !== b)) continue;
    const from = to === a ? b : a;
    if (reg.owner !== from && reg.ctrl !== from) continue;
    reg.owner = to;
    reg.ctrl = to;
    reg.unrest = 50;
    reg.battle = null;
    ceded.add(region);
  }
  if (!terms.armistice) {
    for (const reg of Object.values(s.regions)) {
      if (ceded.has(reg.id)) continue;
      if ((reg.owner === a && reg.ctrl === b) || (reg.owner === b && reg.ctrl === a)) {
        reg.ctrl = reg.owner;
        reg.unrest = 0;
        reg.battle = null;
      }
    }
  } else {
    s.treaties.push({ id: nextId(s, 't'), kind: 'armistice', a, b, since: s.week, until: s.week + 9999 });
  }
  // Armies left standing on the other side's ground go home
  for (const army of Object.values(s.armies)) {
    if (army.owner !== a && army.owner !== b) continue;
    const holder = s.regions[army.region].ctrl;
    if (holder === army.owner) continue;
    const home = Object.values(s.regions).find((r) => r.ctrl === army.owner && r.owner === army.owner);
    if (home) { army.region = home.id; army.path = []; army.op = { kind: 'hold', target: home.id, aggr: 'balanced' }; army.status = `Withdrawn to ${regionName(home.id)}`; }
  }
  for (const c of [s.countries[a], s.countries[b]]) if (c) { c.blockades[a === c.id ? b : a] && delete c.blockades[a === c.id ? b : a]; c.airOps = c.airOps.filter((o) => s.regions[o.region].ctrl !== (a === c.id ? b : a)); }
  if (terms.reparations && terms.reparations.amount > 0) {
    const { from, amount, years = 5 } = terms.reparations;
    const to = from === a ? b : a;
    s.treaties.push({ id: nextId(s, 't'), kind: 'reparations', a: from, b: to, payment: amount / 52, since: s.week, until: s.week + years * 52 });
  }
  addRel(s, a, b, 25);
  const parts = [];
  if (ceded.size) parts.push(`ceding ${[...ceded].map(regionName).join(', ')}`);
  if (terms.reparations?.amount) parts.push(`with reparations of ${money(terms.reparations.amount)} a year`);
  if (terms.armistice) parts.push('freezing the front line');
  news(s, `${nameOf(s, a)} and ${nameOf(s, b)} sign ${terms.armistice ? 'an armistice' : 'a peace treaty'}${parts.length ? `, ${parts.join(', ')}` : ''}.`, 'peace', [a, b]);
}

/* ---------- Proposals ---------- */

export function propose(s, from, to, kind, terms = {}, system = false) {
  if (!PROPOSALS[kind]) return 'Unknown proposal.';
  if (!alive(s, to) || !s.countries[to]) return 'You can only make proposals to a country with a government.';
  if (from === to) return 'Pick another country.';
  const dup = Object.values(s.proposals).find((p) => p.from === from && p.to === to && p.kind === kind && JSON.stringify(p.terms) === JSON.stringify(terms));
  if (dup) return 'That proposal is already waiting for an answer.';
  const err = system ? null : validate(s, from, to, kind, terms);
  if (err) return err;
  const id = nextId(s, 'p');
  s.proposals[id] = { id, from, to, kind, terms, week: s.week, expires: s.week + PROPOSAL_WEEKS };
  alert(s, to, `${nameOf(s, from)} proposes: ${describe(s, s.proposals[id])}`, 'proposal', { proposal: id });
  return null;
}

function validate(s, from, to, kind, t) {
  const a = s.countries[from];
  const b = s.countries[to];
  switch (kind) {
    case 'alliance': {
      const al = s.alliances[t.alliance];
      if (!al || !al.members.includes(from)) return 'You can only invite countries to an alliance you belong to.';
      if (al.members.includes(to)) return `${b.name} is already a member.`;
      if (atWar(s, from, to)) return 'You are at war with them.';
      return null;
    }
    case 'fta':
      if (treaty(s, 'fta', from, to)) return 'You already have a free trade agreement.';
      if (atWar(s, from, to)) return 'You are at war with them.';
      return null;
    case 'nap':
      if (treaty(s, 'nap', from, to)) return 'You already have a non-aggression pact.';
      if (atWar(s, from, to)) return 'Make peace first.';
      return null;
    case 'access':
      if (treaty(s, 'access', from, to)) return 'You already have military access.';
      if (atWar(s, from, to)) return 'You are at war with them.';
      return null;
    case 'deal': {
      if (!RESOURCES.includes(t.res)) return 'Pick a resource.';
      const qty = Number(t.qty);
      const price = Number(t.price);
      const weeks = Number(t.weeks);
      if (!(qty > 0) || !(price >= 0) || !(weeks >= 4 && weeks <= 520)) return 'Set an amount, a yearly price and a length of 4 to 520 weeks.';
      if (t.seller !== from && t.seller !== to) return 'Choose who sells.';
      return null;
    }
    case 'loan': {
      const amount = Number(t.amount);
      if (!(amount > 0) || amount > a.treasury) return `You can lend up to ${money(a.treasury)} from your reserves.`;
      if (!(t.years >= 1 && t.years <= 30) || !(t.rate >= 0 && t.rate <= 25)) return 'Loans run 1 to 30 years at 0–25% interest.';
      return null;
    }
    case 'peace': {
      if (!atWar(s, from, to)) return 'You are not at war with them.';
      for (const c of t.cede ?? []) {
        const reg = s.regions[c.region];
        if (!reg || (c.to !== from && c.to !== to)) return 'A ceded province is not valid.';
        const giver = c.to === from ? to : from;
        if (reg.owner !== giver && reg.ctrl !== giver) return `${regionName(c.region)} is not theirs to give.`;
      }
      if (t.reparations) {
        const payer = s.countries[t.reparations.from];
        if (!payer || ![from, to].includes(t.reparations.from)) return 'Reparations must be paid by one side of the war.';
        if (t.reparations.amount > payer.gdp * 0.1) return 'Reparations can be at most 10% of the payer\'s GDP a year.';
      }
      return null;
    }
    case 'joinWar':
      if (!atWar(s, from, t.enemy)) return `You are not at war with ${nameOf(s, t.enemy)}.`;
      if (atWar(s, to, t.enemy)) return `${b.name} is already at war with them.`;
      if (allied(s, to, t.enemy)) return `${b.name} is allied with ${nameOf(s, t.enemy)}.`;
      return null;
    default:
      return null;
  }
}

export function describe(s, p) {
  const t = p.terms;
  switch (p.kind) {
    case 'alliance': return `join ${s.alliances[t.alliance]?.name ?? 'an alliance'}`;
    case 'fta': return 'a free trade agreement';
    case 'nap': return 'a non-aggression pact';
    case 'access': return 'mutual military access';
    case 'deal': {
      const info = RESOURCE_INFO[t.res];
      const buyer = t.seller === p.from ? p.to : p.from;
      return `${nameOf(s, t.seller)} sells ${nameOf(s, buyer)} ${t.qty} ${info.unit} of ${info.name.toLowerCase()} a year for ${money(Number(t.price))} a year, for ${t.weeks} weeks`;
    }
    case 'loan': return `a loan of ${money(Number(t.amount))} over ${t.years} years at ${t.rate}%`;
    case 'peace': {
      const parts = [];
      if (t.armistice) parts.push('an armistice along the current front');
      else parts.push('peace');
      for (const c of t.cede ?? []) parts.push(`${regionName(c.region)} to ${nameOf(s, c.to)}`);
      if (t.reparations?.amount) parts.push(`${nameOf(s, t.reparations.from)} pays ${money(Number(t.reparations.amount))} a year for ${t.reparations.years ?? 5} years`);
      return parts.join('; ');
    }
    case 'joinWar': return `join the war against ${nameOf(s, t.enemy)}`;
    case 'callToArms': return `honour your alliance and defend ${nameOf(s, t.ally)} against ${nameOf(s, t.enemy)}`;
    default: return p.kind;
  }
}

export function respond(s, cid, id, accept) {
  const p = s.proposals[id];
  if (!p || p.to !== cid) return 'That proposal is no longer open.';
  delete s.proposals[id];
  const err = accept && p.kind !== 'callToArms' ? validate(s, p.from, p.to, p.kind, p.terms) : null;
  if (err) {
    alert(s, cid, `The proposal can no longer go ahead: ${err}`, 'warn');
    return null;
  }
  const from = nameOf(s, p.from);
  const to = nameOf(s, p.to);
  if (!accept) {
    alert(s, p.from, `${to} declined: ${describe(s, p)}.`, 'warn');
    if (p.kind === 'callToArms') {
      const c = s.countries[cid];
      c.rep = Math.max(0, c.rep - 8);
      addRel(s, cid, p.terms.ally, -25);
      news(s, `${to} refuses to come to ${nameOf(s, p.terms.ally)}'s defence.`, 'diplomacy', [cid, p.terms.ally]);
    }
    return null;
  }
  alert(s, p.from, `${to} accepted: ${describe(s, p)}.`, 'good');
  const t = p.terms;
  switch (p.kind) {
    case 'alliance': {
      const al = s.alliances[t.alliance];
      if (!al) break;
      al.members.push(p.to);
      for (const m of al.members) if (m !== p.to) addRel(s, m, p.to, 20);
      if (al.secret) for (const m of al.members) alert(s, m, `${to} has secretly joined ${al.name}.`, 'good');
      else news(s, `${to} joins ${al.name}.`, 'diplomacy', [p.to]);
      break;
    }
    case 'fta': case 'nap': case 'access':
      s.treaties.push({ id: nextId(s, 't'), kind: p.kind, a: p.from, b: p.to, since: s.week, until: s.week + 99999 });
      addRel(s, p.from, p.to, p.kind === 'fta' ? 12 : 8);
      news(s, `${from} and ${to} sign ${p.kind === 'fta' ? 'a free trade agreement' : p.kind === 'nap' ? 'a non-aggression pact' : 'a military access agreement'}.`, 'diplomacy', [p.from, p.to]);
      break;
    case 'deal': {
      const buyer = t.seller === p.from ? p.to : p.from;
      s.treaties.push({ id: nextId(s, 't'), kind: 'deal', a: t.seller, b: buyer, res: t.res, qty: Number(t.qty), price: Number(t.price), since: s.week, until: s.week + Number(t.weeks) });
      addRel(s, p.from, p.to, 6);
      news(s, `${nameOf(s, t.seller)} agrees to supply ${nameOf(s, buyer)} with ${RESOURCE_INFO[t.res].name.toLowerCase()}.`, 'trade', [p.from, p.to]);
      break;
    }
    case 'loan': {
      const lender = s.countries[p.from];
      const borrower = s.countries[p.to];
      const amount = Number(t.amount);
      lender.treasury -= amount;
      borrower.treasury += amount;
      const yearly = amount * (t.rate / 100) / (1 - Math.pow(1 + t.rate / 100, -t.years)) || amount / t.years;
      s.treaties.push({ id: nextId(s, 't'), kind: 'loan', a: p.from, b: p.to, payment: yearly / 52, since: s.week, until: s.week + t.years * 52 });
      addRel(s, p.from, p.to, 10);
      news(s, `${from} lends ${to} ${money(amount)}.`, 'trade', [p.from, p.to]);
      break;
    }
    case 'peace':
      makePeace(s, p.from, p.to, t);
      break;
    case 'joinWar':
    case 'callToArms': {
      if (atWar(s, p.to, t.enemy)) break;
      for (const pact of alliancesOf(s, p.to, 'military')) if (pact.secret && pact.members.includes(t.ally ?? p.from)) revealAlliance(s, pact, `as ${to} enters the war`);
      startWar(s, p.to, t.enemy, p.kind === 'callToArms' ? 'defence' : 'alliance');
      addRel(s, p.to, p.from, 15);
      news(s, `${to} enters the war against ${nameOf(s, t.enemy)} alongside ${from}.`, 'war', [p.to, t.enemy, p.from]);
      alert(s, t.enemy, `${to} has declared war on us.`, 'war');
      break;
    }
  }
  return null;
}

/* ---------- Alliances ---------- */

export function createAlliance(s, c, { name, kind, secret = false }) {
  name = String(name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 40);
  if (!name) return 'Give the alliance a name.';
  if (!['military', 'economic'].includes(kind)) return 'Pick a military alliance or a trade bloc.';
  if (Object.values(s.alliances).some((a) => a.name.toLowerCase() === name.toLowerCase())) return 'An alliance with that name exists.';
  const id = nextId(s, 'al');
  s.alliances[id] = { id, name, kind, members: [c.id], founder: c.id, since: s.week, secret: Boolean(secret) };
  if (secret) alert(s, c.id, `${name} is founded in secret. Only its members, and spies inside them, will know.`, 'info');
  else news(s, `${c.name} founds ${kind === 'military' ? 'a new military alliance' : 'a new trade bloc'}: ${name}.`, 'diplomacy', [c.id]);
  return { id };
}

export function revealAlliance(s, al, why) {
  if (!al?.secret) return;
  al.secret = false;
  news(s, `A secret pact is revealed: ${al.name}, binding ${al.members.map((m) => nameOf(s, m)).join(', ')}${why ? `, ${why}` : ''}.`, 'diplomacy', al.members);
}

export function setAllianceSecrecy(s, c, id, secret) {
  const al = s.alliances[id];
  if (!al || !al.members.includes(c.id)) return 'You are not a member.';
  if (secret) return al.secret ? null : 'Once a pact is public it can\'t be made secret again.';
  revealAlliance(s, al, `announced by ${c.name}`);
  return null;
}

export function leaveAlliance(s, c, id) {
  const al = s.alliances[id];
  if (!al || !al.members.includes(c.id)) return 'You are not a member.';
  al.members = al.members.filter((m) => m !== c.id);
  for (const m of al.members) addRel(s, m, c.id, al.kind === 'military' ? -15 : -8);
  if (al.secret) for (const m of al.members) alert(s, m, `${c.name} has quietly left ${al.name}.`, 'warn');
  else news(s, `${c.name} leaves ${al.name}.`, 'diplomacy', [c.id]);
  if (!al.members.length) delete s.alliances[id];
  else if (al.founder === c.id) al.founder = al.members[0];
  return null;
}

/* ---------- One-sided measures ---------- */

export function setSanctions(s, c, target, on) {
  if (!nation(s, target) || target === c.id) return 'Pick a country.';
  const key = `${c.id}>${target}`;
  if (on === Boolean(s.sanctions[key])) return null;
  if (on) {
    s.sanctions[key] = true;
    addRel(s, c.id, target, -20);
    news(s, `${c.name} imposes sanctions on ${nameOf(s, target)}.`, 'diplomacy', [c.id, target]);
    alert(s, target, `${c.name} has imposed sanctions on us.`, 'bad');
  } else {
    delete s.sanctions[key];
    addRel(s, c.id, target, 8);
    news(s, `${c.name} lifts its sanctions on ${nameOf(s, target)}.`, 'diplomacy', [c.id, target]);
  }
  return null;
}

export const TARIFF_LEVELS = [0, 10, 25, 50, 100];
export function setTariff(s, c, target, level) {
  if (!s.countries[target] || target === c.id) return 'Pick a country.';
  level = Number(level);
  if (!TARIFF_LEVELS.includes(level)) return 'Pick a tariff level.';
  const key = `${c.id}>${target}`;
  const old = s.tariffs[key] ?? 0;
  if (level === old) return null;
  if (level) s.tariffs[key] = level; else delete s.tariffs[key];
  addRel(s, c.id, target, (old - level) / 4);
  news(s, level ? `${c.name} sets ${level}% tariffs on goods from ${nameOf(s, target)}.` : `${c.name} drops its tariffs on ${nameOf(s, target)}.`, 'trade', [c.id, target]);
  if (level > old) alert(s, target, `${c.name} raised tariffs on our exports to ${level}%.`, 'bad');
  return null;
}

export function giveAid(s, c, target, amount) {
  const t = s.countries[target];
  amount = Number(amount);
  if (!t || target === c.id) return 'Pick a country.';
  if (!(amount > 0) || amount > c.treasury) return `You can give up to ${money(c.treasury)}.`;
  c.treasury -= amount;
  t.treasury += amount;
  addRel(s, c.id, target, clamp((amount / Math.max(1, t.gdp)) * 400, 2, 25));
  news(s, `${c.name} sends ${money(amount)} in aid to ${t.name}.`, 'trade', [c.id, target]);
  alert(s, target, `${c.name} sent us ${money(amount)} in aid.`, 'good');
  return null;
}

export function shareTech(s, c, target, field) {
  const t = s.countries[target];
  if (!t || !c.tech[field]) return 'Pick a country and a field.';
  if (c.tech[field] <= t.tech[field]) return `${t.name} is not behind you in that field.`;
  if ((c.cooldown[`tech:${target}`] ?? -1) > s.week) return 'You shared technology with them recently.';
  c.cooldown[`tech:${target}`] = s.week + 26;
  t.progress[field] += 0.5 * 1.5 * Math.pow(1.55, t.tech[field]);
  addRel(s, c.id, target, 10);
  alert(s, target, `${c.name} shared ${field} technology with us.`, 'good');
  return null;
}

export function embassy(s, c, target, action) {
  if (!s.countries[target] || target === c.id) return 'Pick a country.';
  const key = `emb:${target}`;
  if ((c.cooldown[key] ?? -1) > s.week) return `Your diplomats need ${c.cooldown[key] - s.week} more weeks before another démarche.`;
  c.cooldown[key] = s.week + 6;
  if (action === 'improve') {
    addRel(s, c.id, target, 6);
    return null;
  }
  if (action === 'condemn') {
    addRel(s, c.id, target, -8);
    s.countries[target].rep = Math.max(0, s.countries[target].rep - 2);
    news(s, `${c.name} publicly condemns ${nameOf(s, target)}.`, 'diplomacy', [c.id, target]);
    return null;
  }
  if (action === 'expel') {
    addRel(s, c.id, target, -15);
    news(s, `${c.name} expels ${nameOf(s, target)}'s diplomats.`, 'diplomacy', [c.id, target]);
    alert(s, target, `${c.name} expelled our diplomats.`, 'bad');
    return null;
  }
  return 'Unknown action.';
}

export function annex(s, c, regionId) {
  const reg = s.regions[regionId];
  if (!reg || reg.ctrl !== c.id || reg.owner === c.id) return 'You can only annex territory your forces occupy.';
  if (isMinor(reg.owner) && s.minors[reg.owner]?.capitulated) return 'Decide the surrendered nation\'s fate from the Diplomacy tab.';
  const prev = reg.owner;
  reg.owner = c.id;
  reg.unrest = 60;
  const claim = c.claims.includes(regionId);
  c.rep = Math.max(0, c.rep - (claim ? 6 : 15));
  if (s.countries[prev]) {
    s.countries[prev].claims.push(regionId);
    addRel(s, c.id, prev, -40);
  }
  for (const other of Object.values(s.countries)) if (other.id !== c.id && other.id !== prev && !allied(s, other.id, c.id)) addRel(s, other.id, c.id, -4);
  news(s, `${c.name} annexes ${regionName(regionId)}${claim ? ', claiming it as its own' : ''}. Most of the world refuses to recognise it.`, 'diplomacy', [c.id, prev]);
  return null;
}

export function setChokepoint(s, c, key, close) {
  const cp = CHOKEPOINTS[key];
  if (!cp) return 'Unknown strait.';
  if (!cp.regions.some((r) => s.regions[r]?.ctrl === c.id)) return `You don't control the ${cp.name}.`;
  const state = s.chokepoints[key];
  if (close) {
    if (state.closedBy) return `The ${cp.name} is already closed.`;
    state.closedBy = c.id;
    c.rep = Math.max(0, c.rep - 10);
    for (const other of Object.values(s.countries)) if (other.id !== c.id && !allied(s, other.id, c.id)) addRel(s, other.id, c.id, -8);
    news(s, `${c.name} closes the ${cp.name} to shipping. ${cp.note}`, 'trade', [c.id]);
  } else {
    if (state.closedBy !== c.id) return 'You did not close it.';
    state.closedBy = null;
    news(s, `${c.name} reopens the ${cp.name}.`, 'trade', [c.id]);
  }
  return null;
}

// A strait reopens when whoever closed it no longer holds any of its shores
export function checkChokepoints(s) {
  for (const [key, state] of Object.entries(s.chokepoints)) {
    if (!state.closedBy) continue;
    if (!CHOKEPOINTS[key].regions.some((r) => s.regions[r]?.ctrl === state.closedBy)) {
      news(s, `The ${CHOKEPOINTS[key].name} is open again.`, 'trade');
      state.closedBy = null;
    }
  }
}

/* ---------- The UN Security Council ---------- */

export const RESOLUTIONS = {
  condemn: 'Condemn',
  sanction: 'Impose sanctions on',
  ceasefire: 'Demand a ceasefire from',
};

export function proposeResolution(s, c, kind, target) {
  if (!RESOLUTIONS[kind]) return 'Pick a resolution.';
  if (!s.countries[target] || target === c.id) return 'Pick a country.';
  if ((c.cooldown.un ?? -1) > s.week) return `You can table another resolution in ${c.cooldown.un - s.week} weeks.`;
  if (s.un.some((r) => !r.done && r.target === target)) return 'A resolution on that country is already being voted on.';
  c.cooldown.un = s.week + 13;
  const id = nextId(s, 'un');
  s.un.push({ id, kind, target, by: c.id, week: s.week, ends: s.week + 2, votes: { [c.id]: 'yes' }, done: false, passed: null });
  news(s, `${c.name} tables a UN Security Council resolution: ${RESOLUTIONS[kind].toLowerCase()} ${nameOf(s, target)}.`, 'un', [c.id, target]);
  for (const other of Object.values(s.countries)) {
    if (other.human && other.id !== c.id && alive(s, other.id)) alert(s, other.id, `UN vote: ${RESOLUTIONS[kind].toLowerCase()} ${nameOf(s, target)}. Cast your vote in the Diplomacy tab.`, 'un', { resolution: id });
  }
  return null;
}

export function vote(s, c, id, choice) {
  const r = s.un.find((x) => x.id === id);
  if (!r || r.done) return 'That vote has closed.';
  if (!['yes', 'no', 'abstain'].includes(choice)) return 'Vote yes, no or abstain.';
  r.votes[c.id] = choice;
  return null;
}

export function unTick(s) {
  for (const r of s.un) {
    if (r.done || s.week < r.ends) continue;
    for (const c of Object.values(s.countries)) {
      if (!alive(s, c.id) || r.votes[c.id] || c.human) continue;
      r.votes[c.id] = aiVote(s, c.id, r);
    }
    r.done = true;
    const tally = { yes: 0, no: 0, abstain: 0 };
    for (const v of Object.values(r.votes)) tally[v]++;
    const vetoes = P5.filter((p) => r.votes[p] === 'no' && alive(s, p));
    r.passed = tally.yes > tally.no && !vetoes.length;
    r.tally = tally;
    r.vetoes = vetoes;
    const name = nameOf(s, r.target);
    if (!r.passed) {
      news(s, vetoes.length
        ? `The UN resolution against ${name} is vetoed by ${vetoes.map((v) => nameOf(s, v)).join(' and ')} (${tally.yes}–${tally.no}).`
        : `The UN resolution against ${name} fails, ${tally.yes}–${tally.no}.`, 'un', [r.target]);
      continue;
    }
    const t = s.countries[r.target];
    news(s, `The UN Security Council passes a resolution to ${RESOLUTIONS[r.kind].toLowerCase()} ${name} (${tally.yes}–${tally.no}).`, 'un', [r.target]);
    if (r.kind === 'condemn' && t) t.rep = Math.max(0, t.rep - 15);
    if (r.kind === 'sanction') {
      for (const [cid, v] of Object.entries(r.votes)) if (v === 'yes' && cid !== r.target) s.sanctions[`${cid}>${r.target}`] = true;
      if (t) t.rep = Math.max(0, t.rep - 8);
    }
    if (r.kind === 'ceasefire' && t) {
      t.rep = Math.max(0, t.rep - 6);
      s.modifiers.push({ id: nextId(s, 'm'), cid: r.target, kind: 'ceasefire', value: 0, until: s.week + 26 });
    }
  }
  s.un = s.un.filter((r) => !r.done || s.week - r.ends < 26);
}

function aiVote(s, voter, r) {
  if (voter === r.target || allied(s, voter, r.target)) return 'no';
  const toTarget = rel(s, voter, r.target);
  const toSponsor = rel(s, voter, r.by);
  const aggressor = s.wars.some((w) => w.a === r.target);
  const score = -toTarget * 0.7 + toSponsor * 0.3 + (aggressor ? 30 : 0) + (r.kind === 'condemn' ? 10 : r.kind === 'ceasefire' ? 15 : -5);
  if (score > 20) return 'yes';
  if (score < -15) return 'no';
  return 'abstain';
}

/* ---------- Weekly upkeep ---------- */

export function diplomacyTick(s) {
  for (const p of Object.values(s.proposals)) {
    if (p.expires > s.week) continue;
    if (p.kind === 'callToArms') { respond(s, p.to, p.id, false); continue; }
    delete s.proposals[p.id];
    alert(s, p.from, `${nameOf(s, p.to)} let your proposal lapse: ${describe(s, p)}.`, 'warn');
  }
  // Resource deals deliver weekly; loans and reparations are paid in the budget
  for (const t of s.treaties) {
    if (t.kind !== 'deal') continue;
    const seller = nation(s, t.a);
    const buyer = nation(s, t.b);
    if (!seller || !buyer) continue;
    const want = t.qty;
    const give = Math.min(want, Math.max(0, seller.stock[t.res] ?? 0));
    seller.stock[t.res] -= give;
    buyer.stock[t.res] = (buyer.stock[t.res] ?? 0) + give;
    const pay = (t.price / 52) * (want ? give / want : 0);
    if (s.countries[t.b]) s.countries[t.b].treasury -= pay;
    if (s.countries[t.a]) s.countries[t.a].treasury += pay;
  }
  const ending = s.treaties.filter((t) => t.until <= s.week);
  for (const t of ending) {
    if (t.kind === 'deal') {
      alert(s, t.a, `Your ${RESOURCE_INFO[t.res].name.toLowerCase()} deal with ${nameOf(s, t.b)} has ended.`, 'info');
      alert(s, t.b, `Your ${RESOURCE_INFO[t.res].name.toLowerCase()} deal with ${nameOf(s, t.a)} has ended.`, 'info');
    }
  }
  s.treaties = s.treaties.filter((t) => t.until > s.week && alive(s, t.a) && alive(s, t.b));
  checkChokepoints(s);
  unTick(s);
  // Ceasefire resolutions weigh on whoever keeps fighting
  for (const m of s.modifiers) {
    if (m.kind !== 'ceasefire') continue;
    const c = s.countries[m.cid];
    if (c && enemiesOf(s, c.id).size) c.rep = Math.max(0, c.rep - 0.3);
  }
  // Puppet states pay tribute
  for (const m of Object.values(s.minors)) {
    if (!m.puppetOf || m.annexed) continue;
    const lord = s.countries[m.puppetOf];
    if (!lord || !alive(s, lord.id)) { m.puppetOf = null; continue; }
    lord.treasury += (m.gdp * 0.05) / 52;
  }
  // Relations drift slowly back toward neutral
  for (const k of Object.keys(s.rel)) s.rel[k] *= 0.999;
  for (const al of Object.values(s.alliances)) {
    if (al.kind !== 'military') continue;
    for (const a of al.members) for (const b of al.members) if (a < b && rel(s, a, b) < 30) setRel(s, a, b, 30);
  }
}

export { setRel };
