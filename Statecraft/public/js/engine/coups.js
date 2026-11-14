// Coups and regime change. The army's loyalty to the government rises and falls with how it is paid, used and
// beaten; a country's coup risk comes from that, from instability and unpopularity, from crises, and from foreign
// money. Generals plot; a leader with good security hears about it and can purge the officers or buy them off.
// A coup that succeeds puts the army in charge (an autocracy, often turned toward whoever backed it); one that
// fails gets the plotters purged. Hated autocracies can fall to the street instead, and a war can end with the
// winner installing a friendly government. A military government can hand power back to civilians.
//
// Leaders whose country has a coup keep playing it: they now head the new government.

import { clamp, chance, news, alert, alive, nameOf, addRel, rel, setRel, enemiesOf, alliancesOf, treaty, nextId, atWar } from './core.js';
import { lostShare } from './ai.js';
import { perCapita } from './economy.js';
import { register, ask } from './decisions.js';
import { makePeace } from './diplomacy.js';

const SECURITY_POWER = { restrained: 0, firm: 0.08, repressive: 0.18 };
const SPOTS_PLOTS = { restrained: 0.45, firm: 0.75, repressive: 0.95 };
const TITLES = { democracy: 'President', hybrid: 'President', autocracy: 'President' };

// Countries ruled by their armies in 2027
const JUNTAS = { 'm-mali': 'President', 'm-burkina-faso': 'President', 'm-niger': 'President', 'm-guinea': 'President', 'm-sudan': 'Chairman of the Sovereignty Council', 'm-myanmar': 'Senior General', 'm-chad': 'President', 'm-gabon': 'President' };

export function initCoups(c) {
  c.army ??= { loyalty: c.gov === 'autocracy' ? 72 : 70 };
  c.coup ??= { risk: 0, why: [], plot: null };
  if (JUNTAS[c.id] && c.regime === undefined) {
    c.regime = { kind: 'junta', since: -52, before: { gov: 'hybrid', title: 'President', press: 'limited', security: 'firm' }, patron: null };
    c.coupHistory = true;
  }
  c.regime ??= null;
}

/* ---------- Every week ---------- */

export function coupsTick(s) {
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    initCoups(c);
    loyalty(s, c);
    risk(s, c);
    plots(s, c);
    revolution(s, c);
    backing(s, c);
    patronage(s, c);
  }
}

function loyalty(s, c) {
  const a = c.army;
  let target = 70
    + clamp(3 * (c.spend.defence - c.base.spend.defence), -12, 10)
    - ((c.readiness ?? 1) < 1 ? 15 : 0)
    - lostShare(s, c.id) * 50
    - Math.min(15, (c.warWeariness ?? 0) * 0.4)
    + (c.regime?.kind === 'junta' ? 10 : 0)
    + ((a.purgedUntil ?? -1) > s.week ? 18 : 0)
    + ((a.paidUntil ?? -1) > s.week ? 12 : 0)
    + (c.gov === 'democracy' && perCapita(c) > 25 ? 10 : 0);
  a.loyalty = clamp(a.loyalty + (clamp(target, 0, 100) - a.loyalty) * 0.05, 0, 100);
}

function risk(s, c) {
  const why = [];
  const add = (v, text) => { if (v > 0.5 || v < -0.5) why.push([Math.round(v), text]); return v; };
  let r = 0;
  r += add(Math.max(0, 60 - c.stability) * 0.9, 'the country is unstable');
  r += add(Math.max(0, 60 - c.army.loyalty) * 0.8, 'the army is disloyal');
  r += add(Math.max(0, 30 - c.approval) * 0.5, 'the government is hated');
  const pc = perCapita(c);
  const rich = c.gov === 'democracy' && pc > 25;
  r += add(rich ? -45 : c.gov === 'democracy' ? (pc > 8 ? -25 : -10) : c.gov === 'hybrid' ? 0 : 0, rich ? 'old, wealthy democracy' : c.gov === 'democracy' ? (pc > 8 ? 'democratic institutions' : 'a young democracy') : c.gov === 'hybrid' ? 'weak institutions' : 'rule by force');
  r += add(pc < 3 ? 18 : pc < 8 ? 9 : 0, 'poverty');
  if (c.coupHistory) r += add(8, 'a history of coups');
  if (c.debtCrisis || c.defaulted) r += add(8, 'the economy is in crisis');
  if (c.civilWar) r += add(10, 'civil war');
  if (c.regime && s.week - c.regime.since < 52) r += add(10, 'a recent change of government');
  if (c.backing && c.backing.until > s.week) r += add(c.backing.power, 'foreign money for the plotters');
  if (c.regime?.kind === 'junta') r += add(-6, 'the generals already rule (but rivals among them may strike)');
  c.coup.risk = Math.round(clamp(r, 0, 100));
  c.coup.why = why.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
}

function plots(s, c) {
  const k = c.coup;
  if (!k.plot) {
    if (k.risk >= 40 && chance(s, 0.05 + (k.risk - 40) / 300)) {
      k.plot = { since: s.week, known: chance(s, SPOTS_PLOTS[c.security] ?? 0.5) };
      if (k.plot.known) {
        ask(s, c, 'plot', {
          title: 'Officers are plotting against us',
          text: `Our security services report that a group of senior officers is preparing a coup. Coup risk: ${k.risk}%.`,
          options: [
            { id: 'watch', label: 'Keep watching', note: 'Do nothing yet. If they move, our security forces will have to stop them.' },
            { id: 'pay', label: 'Buy them off', note: `Raises, promotions and new equipment: about ${money(c.gdp * 0.004)}. Loyalty rises for half a year.` },
            { id: 'purge', label: 'Purge the officers', note: 'Arrest and replace them. Loyalty is assured for half a year, but our armies lose organisation and experience.', tone: 'warn' },
          ],
          weeks: 2,
        });
      }
    }
    return;
  }
  if (k.risk < 30) { k.plot = null; return; }
  if (s.week - k.plot.since >= 3 && chance(s, 0.12 + (k.risk - 40) / 200)) attempt(s, c);
}

const money = (b) => (b >= 1 ? `$${Math.round(b * 10) / 10}B` : `$${Math.round(b * 1000)}M`);

register('plot', {
  // Governments often misjudge a plot, or can't afford to act on it
  ai: (s, c) => (chance(s, 0.4) ? 'watch' : c.gov === 'autocracy' ? 'purge' : c.treasury > c.gdp * 0.01 ? 'pay' : 'watch'),
  apply: (s, c, d, option) => (option === 'watch' ? null : option === 'pay' ? payGenerals(s, c) : purge(s, c)),
});

export function payGenerals(s, c) {
  initCoups(c);
  const cost = c.gdp * 0.004;
  if (c.treasury + c.milFunds < cost) return 'Not enough money.';
  const fromMil = Math.min(c.milFunds, cost);
  c.milFunds -= fromMil;
  c.treasury -= cost - fromMil;
  c.army.paidUntil = s.week + 26;
  c.army.loyalty = Math.min(100, c.army.loyalty + 8);
  if (c.coup.plot && chance(s, 0.6)) c.coup.plot = null;
  return null;
}

export function purge(s, c) {
  initCoups(c);
  c.army.purgedUntil = s.week + 26;
  c.army.loyalty = Math.min(100, c.army.loyalty + 15);
  c.coup.plot = null;
  for (const a of Object.values(s.armies)) if (a.owner === c.id) a.org = Math.max(10, a.org - 25);
  if (c.gov === 'democracy') c.approval = Math.max(0, c.approval - 3);
  news(s, `${c.name} arrests dozens of senior officers accused of plotting a coup.`, 'unrest', [c.id]);
  return null;
}

function attempt(s, c) {
  const k = c.coup;
  const backer = c.backing && c.backing.until > s.week ? c.backing.by : null;
  const odds = clamp(0.35 + (55 - c.army.loyalty) / 100 + (35 - c.approval) / 150 - (SECURITY_POWER[c.security] ?? 0) + (backer ? 0.15 : 0), 0.08, 0.85);
  k.plot = null;
  if (chance(s, odds)) {
    regimeChange(s, c, { kind: 'junta', patron: backer });
    return true;
  }
  c.army.loyalty = Math.min(100, c.army.loyalty + 12);
  c.stability = Math.max(0, c.stability - 6);
  c.approval = Math.min(100, c.approval + 3);
  for (const a of Object.values(s.armies)) if (a.owner === c.id) a.org = Math.max(10, a.org - 15);
  news(s, `A coup attempt in ${c.name} fails: loyal troops surround the plotters, who are arrested.`, 'unrest', [c.id]);
  alert(s, c.id, 'A coup attempt against us failed. The plotters are under arrest; the army is shaken.', 'warn');
  if (backer && chance(s, 0.6)) exposeBacker(s, c, backer);
  return false;
}

/* ---------- Revolutions: when the people bring down a dictatorship ---------- */

function revolution(s, c) {
  if (c.gov === 'democracy' || c.regime?.kind === 'revolution' && s.week - c.regime.since < 104) return;
  const crowds = (c.protests ?? []).reduce((t, p) => t + p.size, 0);
  if (!(c.civilWar || (c.approval < 15 && crowds > 60))) return;
  if (chance(s, c.civilWar ? 0.012 : 0.02)) regimeChange(s, c, { kind: 'revolution' });
}

/* ---------- A new government ---------- */

// kind: 'junta' (the army takes over), 'revolution' (the people do), 'installed' (a foreign power does)
export function regimeChange(s, c, { kind, patron = null }) {
  initCoups(c);
  const before = c.regime?.before ?? { gov: c.gov, title: c.title, press: c.press, security: c.security };
  const old = { gov: c.gov, name: c.name };
  const p = patron ? s.countries[patron] : null;
  if (kind === 'junta') {
    c.gov = 'autocracy';
    c.title = 'Chairman of the Military Council';
    c.press = 'state';
    c.security = 'repressive';
    c.electionWeek = null;
    c.approval = Math.max(c.approval, 40);
    c.stability = Math.min(100, c.stability + 12);
    c.rep = Math.max(0, c.rep - 12);
    c.army.loyalty = 80;
    for (const o of Object.values(s.countries)) if (o.gov === 'democracy' && o.id !== c.id && o.id !== patron) addRel(s, o.id, c.id, -15);
  } else if (kind === 'revolution') {
    c.gov = 'democracy';
    c.title = 'President';
    c.press = 'free';
    c.security = 'restrained';
    c.electionWeek = s.week + 26;
    c.approval = 60;
    c.stability = Math.max(20, c.stability - 5);
    c.rep = Math.min(100, c.rep + 10);
    c.army.loyalty = 55;
    for (const o of Object.values(s.countries)) if (o.gov === 'democracy' && o.id !== c.id) addRel(s, o.id, c.id, 15);
    if (c.regime?.patron) addRel(s, c.id, c.regime.patron, -30);
  } else if (kind === 'installed' && p) {
    c.gov = p.gov;
    c.title = TITLES[p.gov] ?? 'President';
    c.press = p.gov === 'democracy' ? 'free' : 'limited';
    c.security = p.gov === 'democracy' ? 'restrained' : 'firm';
    c.electionWeek = c.gov === 'autocracy' ? null : s.week + 52;
    c.approval = 45;
    c.army.loyalty = 60;
  }
  c.base.security = c.security;
  c.base.press = c.press;
  c.regime = { kind, since: s.week, before, patron: patron ?? null };
  if (kind === 'junta') c.coupHistory = true;
  c.coup.plot = null;
  c.backing = null;
  c.ai.plan = null;
  c.ai.warAt = s.week;
  if (p) turnToward(s, c, p);
  const how = {
    junta: `The army seizes power in ${c.name}${p ? `, with backing from ${p.name}` : ''}. A military council rules by decree.`,
    revolution: `Revolution in ${c.name}: crowds bring down the ${old.gov === 'autocracy' ? 'dictatorship' : 'government'}. Free elections are promised within six months.`,
    installed: `${p?.name ?? 'A foreign power'} installs a new government in ${c.name}.`,
  }[kind];
  news(s, how, 'unrest', p ? [c.id, p.id] : [c.id]);
  alert(s, c.id, {
    junta: 'The army has seized power. You remain at the head of the new military government: elections are cancelled, the press and police answer to the generals, and democracies have turned cold. You can hand power back to civilians once the country is stable (Govern → Power).',
    revolution: 'Revolution: the old regime has fallen. You lead the new democratic government; elections are due in six months.',
    installed: `Under the peace, ${p?.name} has installed a new government. You lead it, but ${p?.name} expects friendship and free passage for its troops.`,
  }[kind], 'bad');
  if (p) alert(s, p.id, `${c.name} has a new government friendly to us.`, 'good', { country: c.id });
}

// A government a foreign power put in place: friendship, open borders, and no alliance with its enemies
function turnToward(s, c, p) {
  setRel(s, c.id, p.id, Math.max(rel(s, c.id, p.id), 65));
  if (!treaty(s, 'access', c.id, p.id)) s.treaties.push({ id: nextId(s, 't'), kind: 'access', a: p.id, b: c.id, since: s.week, until: s.week + 99999 });
  if (atWar(s, c.id, p.id)) makePeace(s, c.id, p.id, {});
  for (const al of alliancesOf(s, c.id)) {
    if (al.members.some((m) => m !== c.id && (rel(s, m, p.id) < -20 || atWar(s, m, p.id)))) al.members = al.members.filter((m) => m !== c.id);
  }
}

// Client states stay close to the power that installed them, until a new government changes course
function patronage(s, c) {
  const p = c.regime?.patron;
  if (!p) return;
  if (!alive(s, p) || (c.gov === 'democracy' && s.week - c.regime.since > 156 && chance(s, 0.01))) {
    c.regime.patron = null;
    return;
  }
  if (rel(s, c.id, p) < 40) setRel(s, c.id, p, 40);
}

/* ---------- Backing a coup abroad (Spies) ---------- */

export function backCoup(s, c, target, amount) {
  const t = s.countries[target];
  if (!t || target === c.id || !alive(s, target)) return 'Pick a country.';
  const agents = c.spies?.[target]?.agents ?? 0;
  if (agents < 2) return `We need a spy network of at least 2 agents inside ${t.name} to reach its officers.`;
  amount = Number(amount);
  if (!(amount > 0)) return 'Choose how much money to give the plotters.';
  if (amount > c.treasury) return 'Not enough in the treasury.';
  if (t.backing && t.backing.until > s.week && t.backing.by !== c.id) return 'Someone else is already backing plotters there.';
  c.treasury -= amount;
  initCoups(t);
  const power = clamp(8 + 600 * amount / Math.max(1, t.gdp) + 2 * Math.min(8, agents), 0, 40);
  t.backing = { by: c.id, power: Math.max(power, t.backing?.power ?? 0), until: s.week + 26 };
  alert(s, c.id, `Our agents are funnelling money to officers in ${t.name}. Its coup risk rises while the money flows (six months). The more unstable it is, the better the odds.`, 'info');
  return null;
}

function backing(s, c) {
  const b = c.backing;
  if (!b) return;
  if (b.until <= s.week || !alive(s, b.by)) { c.backing = null; return; }
  if (chance(s, 0.025 + 0.015 * ((c.counterIntel ?? 1) - 1))) exposeBacker(s, c, b.by);
}

function exposeBacker(s, c, by) {
  c.backing = null;
  addRel(s, c.id, by, -45);
  const b = s.countries[by];
  if (b) b.rep = Math.max(0, b.rep - 8);
  news(s, `${c.name} accuses ${nameOf(s, by)} of funding a coup against its government.`, 'incident', [c.id, by]);
  alert(s, c.id, `We uncovered ${nameOf(s, by)}'s money behind the plotters.`, 'warn', { country: by });
  alert(s, by, `${c.name} has exposed our backing of its plotters.`, 'bad', { country: c.id });
}

/* ---------- Handing power back ---------- */

export function civilianRule(s, c) {
  if (c.regime?.kind !== 'junta') return 'Only a military government can hand power back.';
  if (c.stability < 45) return 'The country is too unstable: the generals refuse to step aside yet (stability 45 needed).';
  const b = c.regime.before;
  c.gov = b.gov === 'autocracy' ? 'hybrid' : b.gov;
  c.title = b.title === 'Chairman of the Military Council' ? 'President' : b.title;
  c.press = c.gov === 'democracy' ? 'free' : 'limited';
  c.security = c.gov === 'democracy' ? 'restrained' : 'firm';
  c.base.press = c.press;
  c.base.security = c.security;
  c.electionWeek = s.week + 26;
  c.rep = Math.min(100, c.rep + 10);
  c.approval = Math.min(100, c.approval + 5);
  c.army.loyalty = Math.max(0, c.army.loyalty - 10);
  c.regime = { kind: 'civilian', since: s.week, before: null, patron: c.regime.patron };
  for (const o of Object.values(s.countries)) if (o.gov === 'democracy' && o.id !== c.id) addRel(s, o.id, c.id, 10);
  news(s, `The generals in ${c.name} hand power back to civilians. Elections are called for six months' time.`, 'diplomacy', [c.id]);
  return null;
}

/* ---------- The computer ---------- */

export function aiCoups(s, c) {
  initCoups(c);
  // Keep the army sweet when the risk climbs
  if (c.coup.risk > 45 && (c.army.paidUntil ?? -1) < s.week && c.treasury > c.gdp * 0.01 && chance(s, 0.3)) payGenerals(s, c);
  // Juntas hand back power in time
  if (c.regime?.kind === 'junta' && s.week - c.regime.since > 260 && c.stability > 60 && chance(s, 0.01)) civilianRule(s, c);
  // Autocracies meddle in shaky rivals where they have agents
  if (c.gov !== 'democracy' && chance(s, 0.08)) {
    for (const [id, n] of Object.entries(c.spies ?? {})) {
      const t = s.countries[id];
      if (!t || n.agents < 2 || t.human || rel(s, c.id, id) > -30 || (t.coup?.risk ?? 0) < 30) continue;
      if (backCoup(s, c, id, Math.min(c.treasury * 0.1, t.gdp * 0.01)) === null) break;
    }
  }
}

export function coupView(c, open) {
  return {
    regime: c.regime ? { kind: c.regime.kind, since: c.regime.since, patron: c.regime.patron } : null,
    coupRisk: open ? c.coup?.risk ?? 0 : null,
  };
}

export function coupOwn(s, c) {
  initCoups(c);
  return {
    loyalty: Math.round(c.army.loyalty), risk: c.coup.risk, why: c.coup.why, plot: c.coup.plot?.known ? { since: c.coup.plot.since } : null,
    paidUntil: c.army.paidUntil ?? null, purgedUntil: c.army.purgedUntil ?? null, regime: c.regime ?? null,
    backing: Object.values(s.countries).filter((t) => t.backing?.by === c.id && t.backing.until > s.week).map((t) => ({ target: t.id, until: t.backing.until, power: Math.round(t.backing.power) })),
  };
}

export { enemiesOf };
