// Spy networks. A leader plants agents in another country; once established they relay what they see
// (armies on the move, weapons being built, secret pacts, the treasury, the mood on the streets) until
// counter-intelligence catches them. Some caught agents are quietly turned, and feed home lies.
//
// What they find can be acted on: warn the country a war is being planned against, or expose the plan to the
// world; expose a secret pact or a nuclear programme; roll up the network they run inside our country. Act on
// a turned network's lies and it backfires. A network deep inside shows their armies' orders on our map, and
// knowing an enemy's plans gives our armies an edge in battle.

import { GEO } from './data/geo.js';
import { TECH_FIELDS } from './data/world.js';
import { REGION_NAMES } from './names.js';
import { clamp, chance, rand, pick, alert, news, nameOf, alive, addRel, allied, troopsLabel, money, rel } from './core.js';
import { revealAlliance } from './diplomacy.js';

const regionName = (id) => REGION_NAMES[id] ?? id;

export const COUNTER_INTEL = [
  { name: 'Minimal', cost: 0, catch: 0.004, note: 'A small security service. Foreign agents operate freely.' },
  { name: 'Standard', cost: 0.02, catch: 0.012, note: 'A capable service that catches careless networks.' },
  { name: 'Vigilant', cost: 0.06, catch: 0.026, note: 'Phone taps, watchers and double agents. Costly.' },
  { name: 'Paranoid', cost: 0.14, catch: 0.045, note: 'A surveillance state. In a democracy, people resent being watched.' },
];
export const MAX_AGENTS = 20;
export const agentCost = (c) => 0.03 * (0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60));

export function initSpies(c) {
  c.spies ??= {};
  c.reports ??= [];
  c.counterIntel ??= c.gov === 'autocracy' ? 2 : 1;
  c.caught ??= {}; // who we have caught spying on us: { [cid]: weeks }
  c.sweepUntil ??= 0;
}

// How well a network sees: established agents, tradecraft (cyber) against the target's counter-intelligence
export function networkStrength(s, c, target) {
  const n = c.spies?.[target];
  const t = s.countries[target];
  if (!n || !t) return 0;
  const established = clamp((s.week - n.since) / 4, 0, 1);
  return established * (Math.sqrt(n.agents) * 0.55) * (1 + 0.12 * (c.tech.cyber - t.tech.cyber)) - (t.counterIntel ?? 1) * 0.25;
}
// A network strong enough (and not turned) shows the target's full picture, including army movements
export const seesInto = (s, c, target) => networkStrength(s, c, target) >= 0.6;

export function plant(s, c, target, agents) {
  initSpies(c);
  const t = s.countries[target];
  if (!t || target === c.id || !alive(s, target)) return 'Pick a country to spy on.';
  agents = Math.floor(Number(agents));
  const have = c.spies[target]?.agents ?? 0;
  if (!(agents >= 1) || have + agents > MAX_AGENTS) return `A network can have up to ${MAX_AGENTS} agents (${have} there now).`;
  const cost = agents * agentCost(c);
  if (cost > c.treasury) return `Recruiting ${agents} agents costs ${money(cost)}; the treasury has ${money(c.treasury)}.`;
  c.treasury -= cost;
  if (c.spies[target]) c.spies[target].agents += agents;
  else c.spies[target] = { agents, since: s.week, turned: false, lastReport: s.week };
  return null;
}

export function recall(s, c, target) {
  initSpies(c);
  if (!c.spies[target]) return 'No network there.';
  delete c.spies[target];
  return null;
}

export function setCounterIntel(s, c, level) {
  initSpies(c);
  level = Number(level);
  if (!COUNTER_INTEL[level]) return 'Pick a level.';
  c.counterIntel = level;
  return null;
}

export function sweep(s, c) {
  initSpies(c);
  if (c.sweepUntil > s.week) return 'A sweep is already under way.';
  if ((c.cooldown.sweep ?? -1) > s.week) return `The security service needs ${c.cooldown.sweep - s.week} more weeks before another sweep.`;
  const cost = Math.max(0.05, c.gdp * 0.00015);
  if (cost > c.treasury) return `A sweep costs ${money(cost)}.`;
  c.treasury -= cost;
  c.sweepUntil = s.week + 6;
  c.cooldown.sweep = s.week + 20;
  if (c.gov === 'democracy') c.boost -= 2;
  alert(s, c.id, 'Counter-intelligence sweep under way for six weeks: foreign agents are far more likely to be caught.', 'info');
  return null;
}

/* ---------- Reports ---------- */

function report(s, c, target, text, kind = 'intel', extra = {}) {
  // Don't repeat what we already know: the same news, or routine figures, within a couple of months
  c.reportSeen ??= {};
  const routine = kind === 'money' || /sit in garrisons/.test(text);
  const key = `${target}|${routine ? kind : text}`;
  if ((c.reportSeen[key] ?? -99) > s.week - (routine ? 8 : 12)) return;
  c.reportSeen[key] = s.week;
  if (Object.keys(c.reportSeen).length > 300) for (const [k, w] of Object.entries(c.reportSeen)) if (w < s.week - 12) delete c.reportSeen[k];
  const r = { id: s.nextId++, w: s.week, about: target, text, kind, ...extra };
  c.reports.push(r);
  const keep = c.human ? 160 : 12; // computer-run countries act on what they learn, they don't keep files
  if (c.reports.length > keep) c.reports.splice(0, c.reports.length - keep);
  return r;
}

/* ---------- Acting on what the agents found ---------- */

// Act on a report. If the network that sent it has been turned, the "discovery" was a lie, and it backfires.
export function intelAction(s, c, { id, action }) {
  const r = (c.reports ?? []).find((x) => x.id === id);
  if (!r || !r.act) return 'There is nothing to act on in that report.';
  if (r.used) return 'We have already acted on it.';
  if (r.w < s.week - 26) return 'That report is too old to act on.';
  if (!s.countries[r.about] || !alive(s, r.about)) return 'That government is gone.';
  let err;
  if (r.act === 'plan' && action === 'warn') err = warnVictim(s, c, r);
  else if (r.act === 'plan' && action === 'expose') err = exposePlan(s, c, r);
  else if (r.act === 'pact' && action === 'expose') err = exposePact(s, c, r);
  else if (r.act === 'nukes' && action === 'expose') err = exposeNukes(s, c, r);
  else if (r.act === 'rollup' && action === 'rollup') err = rollUp(s, c, r);
  else return "That isn't something we can do with this report.";
  if (!err) r.used = action;
  return err;
}

function warnVictim(s, c, r) {
  const v = s.countries[r.victim];
  if (!v || !alive(s, r.victim)) return 'That country is gone.';
  if (r.victim === c.id) return 'We are the target: fortify the border and form armies there.';
  const planner = nameOf(s, r.planner);
  if (r.turned) {
    // The tip was planted: they mobilise for nothing, and remember who cried wolf
    alert(s, r.victim, `${c.name} warned us that ${planner} was about to attack. Nothing came of it.`, 'warn');
    addRel(s, c.id, r.victim, -6);
    alert(s, c.id, `Our warning to ${v.name} proved false: no attack was coming. Our network in ${planner} may have been turned.`, 'bad');
    return null;
  }
  addRel(s, c.id, r.victim, 15);
  alert(s, r.victim, `${c.name} has warned us in confidence: ${planner} is preparing to attack us within weeks.`, 'war');
  // A warned computer-run country gets ready
  if (!v.human) {
    v.mob = Math.max(v.mob, 1);
    v.ai.warned = { by: r.planner, until: s.week + 12 };
  }
  alert(s, c.id, `${v.name} thanks us for the warning${v.human ? '' : ' and is mobilising'}.`, 'good');
  return null;
}

function exposePlan(s, c, r) {
  const t = s.countries[r.planner];
  const victim = nameOf(s, r.victim);
  if (r.turned) {
    news(s, `${c.name} accuses ${t.name} of planning to invade ${victim}. ${t.name} denies it, and the evidence falls apart.`, 'diplomacy', [c.id, r.planner]);
    c.rep = Math.max(0, c.rep - 8);
    addRel(s, c.id, r.planner, -20);
    alert(s, c.id, `The war plan we exposed was a fabrication. Our network in ${t.name} has probably been turned.`, 'bad');
    return null;
  }
  news(s, `${c.name} reveals intelligence that ${t.name} is preparing to invade ${victim}.`, 'diplomacy', [c.id, r.planner, r.victim]);
  alert(s, c.id, `We exposed ${t.name}'s plan to invade ${victim}. ${t.name} is furious; the world is watching.`, 'good');
  t.rep = Math.max(0, t.rep - 8);
  addRel(s, c.id, r.planner, -15);
  if (s.countries[r.victim]) { addRel(s, r.planner, r.victim, -20); addRel(s, c.id, r.victim, 10); }
  // With the world watching and surprise gone, a computer-run planner usually stands down
  if (!t.human && t.ai.plan === r.victim && chance(s, 0.65)) {
    t.ai.plan = null;
    t.ai.warAt = s.week;
    news(s, `Under the world's gaze, ${t.name} pulls its troops back from the ${victim} border.`, 'diplomacy', [r.planner, r.victim]);
    alert(s, c.id, `${t.name} has called off its attack on ${victim}.`, 'good');
  }
  return null;
}

function exposePact(s, c, r) {
  const al = s.alliances[r.alliance];
  if (!al) return 'That pact no longer exists.';
  if (!al.secret) return 'It is already public.';
  revealAlliance(s, al, `exposed by ${c.name}'s intelligence service`);
  alert(s, c.id, `We exposed ${al.name}. Its members are embarrassed, and angry with us.`, 'good');
  for (const m of al.members) {
    addRel(s, c.id, m, -10);
    const x = s.countries[m];
    if (x) x.rep = Math.max(0, x.rep - 3);
  }
  return null;
}

function exposeNukes(s, c, r) {
  const t = s.countries[r.target];
  if (!t?.nukeProgram?.on) return 'The programme has ended.';
  news(s, `${c.name} reveals evidence that ${t.name} is secretly building nuclear weapons.`, 'nuclear', [c.id, r.target]);
  t.rep = Math.max(0, t.rep - 10);
  addRel(s, c.id, r.target, -15);
  for (const o of Object.values(s.countries)) if (o.id !== r.target && o.id !== c.id && o.gov === 'democracy') addRel(s, o.id, r.target, -10);
  alert(s, c.id, `We exposed ${t.name}'s nuclear programme. The democracies are turning against it.`, 'good');
  return null;
}

function rollUp(s, c, r) {
  const t = s.countries[r.target];
  const net = t.spies?.[c.id];
  if (!net) return 'They have already pulled their agents out.';
  delete t.spies[c.id];
  c.caught[r.target] = s.week;
  addRel(s, c.id, r.target, -10);
  news(s, `${c.name} arrests a spy ring of ${net.agents} working for ${t.name}.`, 'incident', [c.id, r.target]);
  alert(s, r.target, `${c.name} has rolled up our entire network in their country: ${net.agents} agents arrested.`, 'bad');
  alert(s, c.id, `Our police arrested ${net.agents} agents working for ${t.name}. Their spying here is over, for now.`, 'good');
  return null;
}

// Computer-run spymasters warn their friends of what is coming
function aiActOnPlan(s, c, r) {
  if (r.victim === c.id || r.turned || r.used) return;
  const friend = allied(s, c.id, r.victim) || rel(s, c.id, r.victim) > 40;
  const foe = allied(s, c.id, r.planner) || rel(s, c.id, r.planner) > 30;
  if (friend && !foe && chance(s, 0.6)) { warnVictim(s, c, r); r.used = 'warn'; }
}


// What a network sees this week. A turned network reports plausible lies.
function gather(s, c, target) {
  const t = s.countries[target];
  const n = c.spies[target];
  const lie = n.turned;
  const fudge = (v) => (lie ? v * (0.35 + rand(s) * 0.4) : v);
  const facts = [];
  const armies = Object.values(s.armies).filter((a) => a.owner === target);
  for (const a of armies) {
    if (a.sea) facts.push([`${a.name} (${troopsLabel(fudge(a.troops))}) is at sea, bound for ${regionName(a.sea.to)}.`, 'army']);
    else if (a.op.kind === 'attack' && a.path.length) facts.push([`${a.name} (${troopsLabel(fudge(a.troops))}) is advancing from ${regionName(a.region)} toward ${regionName(lie ? a.region : a.op.target)}.`, 'army']);
    else if (a.path.length) facts.push([`${a.name} is moving to ${regionName(a.op.target)}.`, 'army']);
  }
  if (!armies.length && t.troops > 50) facts.push([`No army groups in the field; ${troopsLabel(fudge(t.troops))} troops sit in garrisons.`, 'army']);
  const builds = {};
  for (const o of t.queue) builds[o.kind] = (builds[o.kind] ?? 0) + o.qty;
  if (Object.keys(builds).length && !lie) facts.push([`Factories are building: ${Object.entries(builds).map(([k, q]) => `${q} ${k}`).join(', ')}.`, 'arms']);
  for (const al of Object.values(s.alliances)) {
    if (al.secret && al.members.includes(target) && !al.members.includes(c.id) && !lie) facts.push([`${t.name} belongs to a secret pact, ${al.name}, with ${al.members.filter((m) => m !== target).map((m) => nameOf(s, m)).join(', ')}.`, 'secret', { act: 'pact', alliance: al.id }]);
  }
  if (t.ai?.plan && !lie) facts.push([`War planning: ${t.name} is preparing to attack ${nameOf(s, t.ai.plan)}, within weeks.`, 'plan', { act: 'plan', planner: target, victim: t.ai.plan }]);
  // A turned network sometimes invents a war plan, to provoke us into a costly mistake
  if (lie && chance(s, 0.12)) {
    const victim = pick(s, Object.keys(s.countries).filter((x) => x !== target && x !== c.id && alive(s, x)));
    if (victim) facts.push([`War planning: ${t.name} is preparing to attack ${nameOf(s, victim)}, within weeks.`, 'plan', { act: 'plan', planner: target, victim }]);
  }
  if (t.nukeProgram.on) facts.push([`The nuclear weapons programme is ${Math.round(fudge(t.nukeProgram.progress) * 100)}% complete.`, 'secret', { act: 'nukes', target }]);
  for (const p of t.research ?? []) facts.push([`Scientists are working on ${TECH_FIELDS[p.field]?.name ?? p.field} level ${p.level}, due in about ${Math.ceil(p.left)} weeks.`, 'tech', (c.tech[p.field] ?? 0) < t.tech[p.field] ? { act: 'steal', target } : {}]);
  facts.push([`Treasury ${money(fudge(t.treasury))}, defence funds ${money(fudge(t.milFunds))}.`, 'money']);
  const big = (t.protests ?? []).filter((p) => p.size > 25);
  if (big.length) facts.push([`The mood is sour: ${big.length} protest movement${big.length > 1 ? 's' : ''} on the streets; stability ${Math.round(t.stability)}.`, 'mood']);
  for (const [other, net] of Object.entries(t.spies ?? {})) if (other === c.id && !lie) facts.push([`${t.name} runs a network of about ${net.agents} agents inside our country.`, 'counter', { act: 'rollup', target }]);
  return facts;
}

/* ---------- The weekly tick ---------- */

export function spiesTick(s) {
  for (const c of Object.values(s.countries)) initSpies(c);
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    // Counter-intelligence costs money every week
    const ci = COUNTER_INTEL[c.counterIntel];
    c.treasury -= (c.gdp * ci.cost) / 100 / 52;
    if (c.counterIntel === 3 && c.gov === 'democracy') c.boost -= 0.1;
    for (const [target, n] of Object.entries(c.spies)) {
      const t = s.countries[target];
      if (!t || !alive(s, target)) { delete c.spies[target]; continue; }
      // Being caught
      const tci = COUNTER_INTEL[t.counterIntel ?? 1];
      const edge = (t.tech.cyber - c.tech.cyber) * 0.004;
      const p = clamp((tci.catch + edge + n.agents * 0.0012) * (t.sweepUntil > s.week ? 2.2 : 1) * (allied(s, c.id, target) ? 0.6 : 1), 0.001, 0.3);
      if (chance(s, p)) {
        const turn = !n.turned && (t.counterIntel ?? 1) >= 2 && chance(s, 0.35);
        if (turn) {
          n.turned = true;
          alert(s, target, `Counter-intelligence uncovered a spy ring working for ${c.name} and turned it: it now feeds ${c.name} false reports.`, 'good');
        } else {
          const lost = Math.max(1, Math.round(n.agents * (0.3 + rand(s) * 0.4)));
          n.agents -= lost;
          t.caught[c.id] = s.week;
          addRel(s, c.id, target, -12);
          alert(s, c.id, `${t.name}'s counter-intelligence arrested ${lost} of our agents${n.agents <= 0 ? ': the network is gone' : `. ${n.agents} remain`}.`, 'bad');
          alert(s, target, `We arrested ${lost} agents working for ${c.name}.`, 'good');
          if (chance(s, t.human ? 0 : 0.25) || lost >= 5) {
            news(s, `${t.name} arrests ${lost} ${lost === 1 ? 'person' : 'people'} accused of spying for ${c.name}.`, 'incident', [target, c.id]);
            c.rep = Math.max(0, c.rep - 2);
          }
          if (n.agents <= 0) { delete c.spies[target]; continue; }
        }
      }
      // Relaying what they see, every two weeks once established
      if (s.week - n.since >= 4 && s.week - n.lastReport >= 2) {
        n.lastReport = s.week;
        const facts = gather(s, c, target);
        const strength = networkStrength(s, c, target);
        const share = clamp(0.35 + strength * 0.4, 0.3, 1);
        for (const [text, kind, data] of facts) {
          // War plans always get through: it is what agents are there for
          if (kind !== 'plan' && rand(s) >= share) continue;
          const r = report(s, c, target, text, kind, { turned: n.turned, ...(data ?? {}) });
          if (!r) continue;
          if (kind === 'plan' || kind === 'counter') alert(s, c.id, `Our agents in ${t.name}: ${text} Act on it in Spies, Reports.`, kind === 'plan' ? 'war' : 'warn');
          if (!c.human && kind === 'plan') aiActOnPlan(s, c, r);
        }
        // Deep enough to see their armies' orders and the workings of their government
        const deep = !n.turned && seesInto(s, c, target);
        if (deep) c.intel[target] = Math.max(c.intel[target] ?? 0, s.week + 3);
        if (deep && !n.deep) alert(s, c.id, `Our network in ${t.name} is deep inside: we now see their armies' orders on the map, their treasury and their research, and our generals fight them knowing their plans.`, 'good');
        if (!deep && n.deep) alert(s, c.id, `Our network in ${t.name} has lost its access: we no longer see inside their government. More agents or better tradecraft would win it back.`, 'warn');
        n.deep = deep;
      }
      if (s.week - n.since === 4) alert(s, c.id, `Our agents in ${t.name} have settled in and begun reporting (Spies, Reports).`, 'info');
    }
  }
}

export { GEO, pick };
