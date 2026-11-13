// Spy networks. A leader plants agents in another country; once established they relay what they see
// (armies on the move, weapons being built, secret pacts, the treasury, the mood on the streets) until
// counter-intelligence catches them. Some caught agents are quietly turned, and feed home lies.

import { GEO } from './data/geo.js';
import { TECH_FIELDS } from './data/world.js';
import { REGION_NAMES } from './names.js';
import { clamp, chance, rand, pick, alert, news, nameOf, alive, addRel, allied, troopsLabel, money } from './core.js';

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
  c.reports.push({ id: s.nextId++, w: s.week, about: target, text, kind, ...extra });
  const keep = c.human ? 160 : 12; // computer-run countries act on what they learn, they don't keep files
  if (c.reports.length > keep) c.reports.splice(0, c.reports.length - keep);
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
    if (al.secret && al.members.includes(target) && !al.members.includes(c.id) && !lie) facts.push([`${t.name} belongs to a secret pact, ${al.name}, with ${al.members.filter((m) => m !== target).map((m) => nameOf(s, m)).join(', ')}.`, 'secret']);
  }
  if (t.ai?.plan && !lie) facts.push([`War planning: ${t.name} is preparing to attack ${nameOf(s, t.ai.plan)}.`, 'plan']);
  if (t.nukeProgram.on) facts.push([`The nuclear weapons programme is ${Math.round(fudge(t.nukeProgram.progress) * 100)}% complete.`, 'secret']);
  for (const p of t.research ?? []) facts.push([`Scientists are working on ${TECH_FIELDS[p.field]?.name ?? p.field} level ${p.level}, due in about ${Math.ceil(p.left)} weeks.`, 'tech']);
  facts.push([`Treasury ${money(fudge(t.treasury))}, defence funds ${money(fudge(t.milFunds))}.`, 'money']);
  const big = (t.protests ?? []).filter((p) => p.size > 25);
  if (big.length) facts.push([`The mood is sour: ${big.length} protest movement${big.length > 1 ? 's' : ''} on the streets; stability ${Math.round(t.stability)}.`, 'mood']);
  for (const [other, net] of Object.entries(t.spies ?? {})) if (other === c.id && !lie) facts.push([`${t.name} runs a network of about ${net.agents} agents inside our country.`, 'counter']);
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
            news(s, `${t.name} arrests ${lost} people accused of spying for ${c.name}.`, 'incident', [target, c.id]);
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
        for (const [text, kind] of facts) if (rand(s) < share) report(s, c, target, text, kind, { turned: n.turned });
        if (!n.turned && seesInto(s, c, target)) c.intel[target] = Math.max(c.intel[target] ?? 0, s.week + 3);
      }
    }
  }
}

export { GEO, pick };
