// Government: conscription, the security forces and the press, protests with real causes, and uprisings.
//
// People protest when they have a reason: school cuts, hospital closures, prices, a war they don't believe in,
// a draft with no threat to justify it. How many take to the streets depends on fear and belief as much as on
// anger: a repressive state with a controlled press and a recovering economy sees few protests even when
// times are hard; a free country sees many, and violence against them backfires.

import { GEO } from './data/geo.js';
import { PROVINCES } from './data/regions.js';
import { REGION_NAMES } from './names.js';
import { clamp, news, alert, chance, rand, enemiesOf, nextId, rel, money, troopsLabel, alive, nameOf, warsAccepted } from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;
const CAPITALS = Object.fromEntries(PROVINCES.filter((p) => p.capital).map((p) => [p.country, p.id]));
export const capitalOf = (s, id) => CAPITALS[id] ?? (s.regions[id] ? id : null);

/* ---------- Conscription ---------- */

// share: extra serving conscripts as a share of the population, compared with a volunteer force
export const CONSCRIPTION = {
  volunteer: { level: 0, name: 'Volunteer force', share: 0, rate: 0, note: 'Only professionals who signed up. Cheapest on the economy; slow to grow in a crisis.' },
  selective: { level: 1, name: 'Selective service', share: 0.002, rate: 0.002, note: 'A lottery calls up a slice of each year\'s 18–20 year-olds for 18 months.' },
  national: { level: 2, name: 'National service', share: 0.012, rate: 0.007, note: 'Every man aged 18–23 serves two years, then joins the reserves.' },
  total: { level: 3, name: 'Total war draft', share: 0.05, rate: 0.02, note: 'Men aged 18–45 are called up for the duration. Fills the ranks fast and empties the factories.' },
};
export const CONSCRIPTION_KEYS = Object.keys(CONSCRIPTION);

// Where each country stood in 2025
const START_CONSCRIPTION = {
  kor: 'national', isr: 'national', tur: 'national', sgp: 'national', twn: 'national', fin: 'national', che: 'national',
  aut: 'national', egy: 'national', irn: 'national', vnm: 'national', rus: 'national', col: 'national', kaz: 'national',
  are: 'national', tha: 'selective', nor: 'selective', dnk: 'selective', swe: 'selective', bra: 'selective', mex: 'selective',
  chn: 'selective', chl: 'selective', per: 'selective', irq: 'selective',
};

export const SECURITY = {
  restrained: { name: 'Restrained', fear: 0, note: 'Police keep order and protect the right to protest.' },
  firm: { name: 'Firm', fear: 0.2, note: 'Unauthorised marches are broken up; organisers are watched.' },
  repressive: { name: 'Repressive', fear: 0.45, note: 'Secret police, mass arrests, informers everywhere. Few dare to protest.' },
};
export const PRESS = {
  free: { name: 'Free press', sway: 0, note: 'Journalists report what they find, including your failures.' },
  limited: { name: 'Managed press', sway: 0.07, note: 'Friendly owners and pressure on critics keep the coverage kind.' },
  state: { name: 'State media', sway: 0.15, note: 'The state tells the story. Bad news rarely reaches the public.' },
};

export function initGovernment(c) {
  c.conscription ??= START_CONSCRIPTION[c.id] ?? 'volunteer';
  c.base.conscription ??= c.conscription;
  c.conscripts ??= 0;
  c.security ??= c.gov === 'autocracy' ? 'repressive' : c.gov === 'hybrid' ? 'firm' : 'restrained';
  c.press ??= c.gov === 'autocracy' ? 'state' : c.gov === 'hybrid' ? 'limited' : 'free';
  c.base.security ??= c.security;
  c.base.press ??= c.press;
  c.protests ??= [];
  c.protestDrag ??= 0;
  c.strike ??= 0;
  c.threat ??= { value: 0, reasons: [] };
}

/* ---------- Threat: the reason a country might accept a draft ---------- */

export function neighbours(s, cid) {
  const out = new Set();
  for (const reg of Object.values(s.regions)) {
    if (reg.ctrl !== cid) continue;
    for (const id of GEO[reg.id].adj) {
      const h = s.regions[id]?.ctrl;
      if (h && h !== cid) out.add(h);
    }
  }
  return out;
}

const powerOf = (s, id) => {
  const c = s.countries[id];
  if (!c) return (s.minors[id]?.troops ?? 0) * 0.55;
  return (c.troops + c.tanks * 0.05) * (0.6 + 0.08 * c.tech.army) + c.aircraft * 0.6;
};

// How threatened the people feel, 0 (safe) to 1 (fighting for survival), and why
export function threatTo(s, c) {
  const reasons = [];
  let t = 0;
  const add = (v, why) => { if (v > 0.05) reasons.push(why); t = Math.max(t, v); };
  const enemies = enemiesOf(s, c.id);
  for (const w of s.wars) {
    if (w.b === c.id && w.goal !== 'defence') add(0.9, `${s.countries[w.a]?.name ?? s.minors[w.a]?.name} attacked us`);
    else if (w.a === c.id || w.b === c.id) add(w.goal === 'defence' ? 0.7 : w.justified === c.id ? 0.65 : 0.45, `at war with ${s.countries[w.a === c.id ? w.b : w.a]?.name ?? s.minors[w.a === c.id ? w.b : w.a]?.name}`);
  }
  let lost = 0;
  let total = 0;
  for (const reg of Object.values(s.regions)) {
    if (reg.owner !== c.id) continue;
    total += reg.pop;
    if (reg.ctrl !== c.id) lost += reg.pop;
  }
  if (lost > 0) add(0.85 + 0.15 * Math.min(1, lost / Math.max(1, total) * 4), 'enemy troops occupy our land');
  const mine = powerOf(s, c.id) + 1;
  for (const n of neighbours(s, c.id)) {
    if (enemies.has(n) || !s.countries[n]) continue;
    const r = rel(s, c.id, n);
    const ratio = powerOf(s, n) / mine;
    if (r < -40 && ratio > 0.5) add(clamp(0.2 + (-r - 40) / 150 + Math.min(0.2, ratio * 0.08), 0, 0.6), `a hostile, well-armed ${s.countries[n].name} on our border`);
    if (s.countries[n].mob > 0 && r < -20) add(0.55, `${s.countries[n].name} is mobilising next door`);
  }
  // Foreign armies massing on our border
  for (const a of Object.values(s.armies)) {
    if (a.owner === c.id || a.sea) continue;
    if (rel(s, c.id, a.owner) > -30 && !enemies.has(a.owner)) continue;
    if (GEO[a.region].adj.some((id) => s.regions[id]?.ctrl === c.id)) { add(0.6, `${s.countries[a.owner]?.name ?? 'foreign'} armies are massing on our border`); break; }
  }
  return { value: clamp(t, 0, 1), reasons: [...new Set(reasons)].slice(0, 3) };
}

// Weekly: conscripts arrive (or go home to the reserves) toward the target the law sets
function conscriptionTick(s, c) {
  const want = CONSCRIPTION[c.conscription];
  const base = CONSCRIPTION[c.base.conscription];
  const popK = c.pop * 1000;
  const target = popK * (want.share - base.share);
  const gap = target - c.conscripts;
  let step;
  if (gap > 0) step = Math.min(gap, popK * Math.max(want.rate, 0.004) / 52);
  else step = Math.max(gap, gap / 8 - 1);
  // Can't send home more soldiers than are at home to send
  if (step < 0) {
    let inArmies = 0;
    for (const a of Object.values(s.armies)) if (a.owner === c.id) inArmies += a.troops;
    step = Math.max(step, -(Math.max(0, c.troops - inArmies)));
  }
  c.conscripts += step;
  c.troops += step;
  if (step < 0) { c.reserves -= step * 0.8; c.reserveBase = (c.reserveBase ?? c.reserves) - step * 0.8; }
  // National service builds a trained reserve over the years
  if (want.level >= 2 && step >= 0) { const add = popK * 0.0015 / 52; c.reserves += add; c.reserveBase = (c.reserveBase ?? c.reserves) + add; }
}

/* ---------- Grievances and protests ---------- */

export const CAUSES = {
  schools: { name: 'School cuts', crowd: 'Teachers and parents', fix: 'Restore education spending' },
  hospitals: { name: 'Hospital cuts', crowd: 'Doctors and nurses', fix: 'Restore health spending' },
  pensions: { name: 'Welfare and pension cuts', crowd: 'Pensioners and unions', fix: 'Restore welfare spending' },
  taxes: { name: 'Tax rises', crowd: 'Taxpayers and small businesses', fix: 'Cut taxes back' },
  prices: { name: 'Cost of living', crowd: 'Workers and families', fix: 'Fight inflation: raise interest rates or cut the deficit' },
  shortages: { name: 'Food and fuel shortages', crowd: 'Angry crowds outside empty shops', fix: 'Buy food and fuel on the Market' },
  jobs: { name: 'Lost jobs', crowd: 'The unemployed and the unions', fix: 'Stimulate the economy' },
  war: { name: 'The war', crowd: 'Anti-war marchers and soldiers\' families', fix: 'Make peace' },
  draft: { name: 'The draft', crowd: 'Students and young men facing the call-up', fix: 'Scale conscription back' },
  rights: { name: 'Repression and censorship', crowd: 'Students, journalists and the opposition', fix: 'Ease the security forces and free the press' },
  opposition: { name: 'Opposition campaign', crowd: 'Opposition supporters', fix: 'Negotiate, or wait for it to run out of money' },
  occupation: { name: 'Occupation and annexation', crowd: 'People in newly taken provinces', fix: 'Garrison them, grant amnesty, or let them go' },
};

// How strongly each grievance is felt right now, 0-100
function pressures(s, c) {
  const b = c.base;
  const sp = c.spend;
  const p = {};
  p.schools = Math.max(0, b.spend.edu - sp.edu) * 22;
  p.hospitals = Math.max(0, b.spend.health - sp.health) * 15;
  p.pensions = Math.max(0, b.spend.welfare - sp.welfare) * 11;
  p.taxes = Math.max(0, c.tax - b.tax - 1) * 6;
  p.prices = Math.max(0, c.infl - Math.max(4, b.infl + 2)) * 5;
  p.shortages = ((c.short.food ?? 0) * 120) + ((c.short.oil ?? 0) + (c.short.gas ?? 0)) * 45;
  p.jobs = Math.max(0, -(c.growth ?? 0) - 0.5) * 9;
  // A nation under attack, or one its leader has convinced the war is necessary, protests far less
  const accepted = c.threat.value >= 0.7 || warsAccepted(s, c.id);
  p.war = enemiesOf(s, c.id).size ? Math.min(100, c.warWeariness * 2.2 + 6) * (accepted ? 0.35 : 1) : 0;
  const gap = CONSCRIPTION[c.conscription].level - CONSCRIPTION[c.base.conscription].level;
  p.draft = gap > 0 ? gap * 28 * (1 - c.threat.value) + (c.recentDraft ?? 0) : (c.recentDraft ?? 0);
  const harsh = SECURITY[c.security].fear - SECURITY[c.base.security].fear;
  const muzzle = PRESS[c.press].sway - PRESS[c.base.press].sway;
  p.rights = Math.max(0, harsh) * 90 + Math.max(0, muzzle) * 150 + (c.massacre ?? 0);
  p.opposition = c.opposition ?? 0;
  let occupied = 0;
  for (const reg of Object.values(s.regions)) if (reg.ctrl === c.id && reg.unrest > 30) occupied += (reg.unrest - 30) * Math.min(1, reg.pop / 5);
  p.occupation = Math.min(80, occupied * 0.3);
  return p;
}

// How much of that anger stays at home: fear of the police, belief in the story the state tells, and hope
export function restraint(s, c) {
  let r = SECURITY[c.security].fear + PRESS[c.press].sway;
  if (c.gov === 'autocracy') r += 0.15;
  else if (c.gov === 'democracy') r -= 0.1;
  if ((c.growth ?? 0) > 3) r += 0.08; // a recovering, growing economy buys patience
  r += Math.min(0.2, (c.rally ?? 0) / 60) + Math.min(0.15, Math.max(0, c.boost ?? 0) / 60);
  if (c.threat.value >= 0.7) r += 0.1; // a nation under attack closes ranks
  return clamp(r, 0, 0.9);
}

function protestsTick(s, c) {
  const p = pressures(s, c);
  const hold = restraint(s, c);
  const capital = capitalOf(s, c.id);
  for (const [cause, pressure] of Object.entries(p)) {
    const want = Math.max(0, pressure * (1 - hold) - 12);
    let pr = c.protests.find((x) => x.cause === cause);
    if (!pr && want > 4) {
      pr = { id: nextId(s, 'pr'), cause, size: 0, since: s.week, peak: 0, region: capital };
      c.protests.push(pr);
    }
    if (!pr) continue;
    pr.size = clamp(pr.size + (Math.min(100, want) - pr.size) * (want > pr.size ? 0.14 : 0.1), 0, 100);
    const before = pr.peak;
    pr.peak = Math.max(pr.peak, pr.size);
    const info = CAUSES[cause];
    if (before < 30 && pr.peak >= 30) {
      news(s, `${info.crowd} take to the streets of ${c.name}: protests over ${info.name.toLowerCase()} are growing.`, 'unrest', [c.id]);
      alert(s, c.id, `Protests over ${info.name.toLowerCase()} are growing (${Math.round(pr.size)}% strength). Deal with them in Government.`, 'warn', { protest: pr.id });
    }
    if (before < 65 && pr.peak >= 65) {
      news(s, `Mass protests in ${c.name}: hundreds of thousands march over ${info.name.toLowerCase()}. Strikes shut down transport and factories.`, 'unrest', [c.id]);
      alert(s, c.id, `Mass protests over ${info.name.toLowerCase()}: strikes are hurting the economy. ${info.fix}, negotiate, or send in the police.`, 'bad', { protest: pr.id });
    }
  }
  c.protests = c.protests.filter((x) => x.size >= 2 || s.week - x.since < 2);
  const load = c.protests.reduce((t, x) => t + x.size, 0) / 100;
  c.protestDrag = Math.min(25, load * 7);
  c.strike = Math.min(0.06, c.protests.reduce((t, x) => t + Math.max(0, x.size - 40), 0) / 100 * 0.025);
  // Lingering effects fade
  c.recentDraft = Math.max(0, (c.recentDraft ?? 0) * 0.92 - 0.2);
  c.massacre = Math.max(0, (c.massacre ?? 0) * 0.95 - 0.2);
  c.opposition = Math.max(0, (c.opposition ?? 0) * 0.93 - 0.3);
  // Huge, unanswered protests in a fragile state turn into an uprising
  const top = c.protests.reduce((m, x) => (x.size > (m?.size ?? 0) ? x : m), null);
  if (top && top.size > 70 && c.stability < 18 && chance(s, 0.04)) {
    const reg = s.regions[top.region] ?? Object.values(s.regions).find((r) => r.owner === c.id && r.ctrl === c.id);
    if (reg && reg.ctrl === c.id && !reg.revolt) startRevolt(s, reg, `protests over ${CAUSES[top.cause].name.toLowerCase()} turned into an armed uprising`);
  }
}

/* ---------- Uprisings ---------- */

export function startRevolt(s, reg, why) {
  const holder = reg.ctrl;
  reg.revolt = { rebels: Math.max(3, reg.pop * 1.5), since: s.week, why };
  reg.unrest = Math.max(reg.unrest, 75);
  const c = s.countries[holder];
  news(s, `Uprising in ${regionName(reg.id)}${c ? ` (${c.name})` : ''}: ${why}.`, 'unrest', [holder]);
  alert(s, holder, `Uprising in ${regionName(reg.id)}: about ${troopsLabel(reg.revolt.rebels)} armed rebels. Send an army to hold the province, crush it with the security forces, or offer an amnesty.`, 'bad', { region: reg.id });
}

function revoltsTick(s, gar) {
  for (const reg of Object.values(s.regions)) {
    const holder = reg.ctrl;
    // Long, bitter occupations breed insurgencies
    // A crackdown keeps a lid on it, for now
    if (!reg.revolt && reg.unrest >= 72 && s.countries[holder] && chance(s, 0.015 * (reg.unrest - 70) / 10 * (reg.policy === 'crackdown' ? 0.35 : 1))) {
      startRevolt(s, reg, reg.owner !== holder ? 'partisans rise against the occupation' : 'armed rebels rise against the government');
    }
    const rv = reg.revolt;
    if (!rv) continue;
    const c = s.countries[holder];
    const g = gar?.get(reg.id)?.troops ?? 0;
    let army = 0;
    for (const a of Object.values(s.armies)) if (a.region === reg.id && a.owner === holder && !a.sea) army += a.troops * (a.op.kind === 'hold' ? 1 : 0.5);
    const quality = c ? 0.6 + 0.08 * c.tech.army : 0.6;
    const growth = rv.rebels * 0.035 * (reg.unrest / 80) + reg.pop * 0.05;
    // Rebels armed from abroad are much harder to put down
    const suppress = (g * 0.012 + army * 0.06) * quality / (1 + (rv.armed ?? 0) / 400);
    rv.rebels = Math.max(0, rv.rebels + growth - suppress);
    // Fighting rebels costs soldiers too
    if (army > 0) for (const a of Object.values(s.armies)) if (a.region === reg.id && a.owner === holder) a.troops = Math.max(1, a.troops - Math.min(a.troops * 0.01, rv.rebels * 0.01));
    reg.unrest = Math.max(reg.unrest, 60);
    reg.dmg = Math.min(0.9, reg.dmg + 0.002);
    if (rv.rebels < 0.5) {
      reg.revolt = null;
      reg.unrest = Math.max(30, reg.unrest - 25);
      news(s, `The uprising in ${regionName(reg.id)} has been put down.`, 'unrest', [holder]);
      alert(s, holder, `The uprising in ${regionName(reg.id)} is over.`, 'good', { region: reg.id });
    }
  }
  // A country with several provinces in revolt, or its capital, is in civil war
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    let n = 0;
    let rebels = 0;
    let capital = false;
    for (const reg of Object.values(s.regions)) {
      if (reg.ctrl !== c.id || !reg.revolt) continue;
      n++;
      rebels += reg.revolt.rebels;
      if (reg.id === capitalOf(s, c.id)) capital = true;
    }
    const was = c.civilWar;
    c.civilWar = n >= 2 || capital || rebels > Math.max(20, c.troops * 0.1);
    c.rebels = rebels;
    if (c.civilWar && !was) {
      news(s, `${c.name} slides into civil war.`, 'unrest', [c.id]);
      alert(s, c.id, 'Civil war: rebels hold out in several provinces. Crush them, or end foreign wars to bring troops home, as Russia did at Brest-Litovsk in 1918.', 'bad');
    }
    if (c.civilWar) {
      c.stability = Math.max(0, c.stability - 0.6);
      c.approval = Math.max(0, c.approval - 0.2);
    }
  }
}

/* ---------- The weekly tick ---------- */

export function governmentTick(s, gar) {
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    initGovernment(c);
    c.threat = threatTo(s, c);
    conscriptionTick(s, c);
    protestsTick(s, c);
    // Heavy-handed policing and censorship cost standing abroad, more so for a democracy
    const harsh = SECURITY[c.security].fear - SECURITY[c.base.security].fear;
    const muzzle = PRESS[c.press].sway - PRESS[c.base.press].sway;
    if (harsh > 0 || muzzle > 0) c.rep = Math.max(0, c.rep - (harsh + muzzle) * (c.gov === 'democracy' ? 0.4 : 0.15));
    // Unjustified conscription drags on approval every week it lasts
    const gap = CONSCRIPTION[c.conscription].level - CONSCRIPTION[c.base.conscription].level;
    c.draftDrag = gap > 0 ? gap * (c.gov === 'democracy' ? 4 : c.gov === 'hybrid' ? 2.5 : 1.5) * (1 - c.threat.value) : 0;
  }
  revoltsTick(s, gar);
}

/* ---------- Commands ---------- */

export const WAR_CASE_WEEKS = 26;

// A national address making the case for war on one country. For half a year a war on it is one the public
// understands: little outcry when it starts, few anti-war protests, and a draft people accept.
export function makeWarCase(s, c, target) {
  if (!target || target === c.id || !(s.countries[target] || s.minors[target])) return 'Pick the country you want to make the case against.';
  if ((c.cooldown.warCase ?? -1) > s.week) return `You addressed the nation recently. Try again in ${c.cooldown.warCase - s.week} weeks.`;
  c.warCases = { ...(c.warCases ?? {}), [target]: s.week + WAR_CASE_WEEKS };
  c.cooldown.warCase = s.week + 4;
  c.boost += 2;
  c.rally += 3;
  addRelSafe(s, c.id, target, -8);
  news(s, `${c.name}'s leader addresses the nation, laying out the case against ${nameOf(s, target)}.`, 'war', [c.id, target]);
  alert(s, target, `${c.name}'s leader has made a televised case against us. War may be coming.`, 'warn');
  return null;
}

function addRelSafe(s, a, b, delta) {
  if (!s.countries[a] || !s.countries[b]) return;
  const k = a < b ? `${a}|${b}` : `${b}|${a}`;
  s.rel[k] = clamp((s.rel[k] ?? 0) + delta, -100, 100);
}

export function setConscription(s, c, level) {
  initGovernment(c);
  const want = CONSCRIPTION[level];
  if (!want) return 'Pick a conscription level.';
  if (level === c.conscription) return null;
  const up = want.level > CONSCRIPTION[c.conscription].level;
  c.conscription = level;
  if (up) {
    const justified = c.threat.value;
    // A sudden, unexplained call-up brings people onto the streets
    c.recentDraft = (c.recentDraft ?? 0) + (1 - justified) * (c.gov === 'democracy' ? 40 : 22);
    c.boost -= (1 - justified) * (c.gov === 'democracy' ? 8 : 4);
    if (justified >= 0.6) c.rally += 3;
    news(s, level === 'total'
      ? `${c.name} orders a general call-up: men aged 18 to 45 must report for military service.`
      : `${c.name} introduces ${want.name.toLowerCase()}: young men will be called up to the armed forces.`, 'war', [c.id]);
  } else {
    news(s, `${c.name} scales conscription back to ${want.name.toLowerCase()}.`, 'info', [c.id]);
  }
  return null;
}

export function setSecurity(s, c, level) {
  initGovernment(c);
  if (!SECURITY[level]) return 'Pick a stance for the security forces.';
  if (level === c.security) return null;
  const harder = SECURITY[level].fear > SECURITY[c.security].fear;
  c.security = level;
  if (harder && level === 'repressive') news(s, `Mass arrests in ${c.name} as the security forces are unleashed on the opposition.`, 'unrest', [c.id]);
  return null;
}

export function setPress(s, c, level) {
  initGovernment(c);
  if (!PRESS[level]) return 'Pick a press policy.';
  if (level === c.press) return null;
  const tighter = PRESS[level].sway > PRESS[c.press].sway;
  c.press = level;
  if (tighter) news(s, `${c.name} tightens its grip on the media: critical outlets are shut down.`, 'unrest', [c.id]);
  return null;
}

// concede (fix the cause), negotiate (pay and talk), police (break it up)
export function handleProtest(s, c, id, action) {
  initGovernment(c);
  const pr = c.protests.find((x) => x.id === id);
  if (!pr) return 'That protest has ended.';
  const info = CAUSES[pr.cause];
  if (action === 'concede') {
    const b = c.base;
    switch (pr.cause) {
      case 'schools': c.spend.edu = Math.max(c.spend.edu, b.spend.edu); break;
      case 'hospitals': c.spend.health = Math.max(c.spend.health, b.spend.health); break;
      case 'pensions': c.spend.welfare = Math.max(c.spend.welfare, b.spend.welfare); break;
      case 'taxes': c.tax = Math.min(c.tax, b.tax); break;
      case 'draft': c.conscription = CONSCRIPTION[c.conscription].level > CONSCRIPTION[b.conscription].level ? b.conscription : c.conscription; c.recentDraft = 0; break;
      case 'rights': c.security = b.security; c.press = b.press; c.massacre = 0; break;
      default: return `There is no quick concession on ${info.name.toLowerCase()}. ${info.fix}.`;
    }
    pr.size *= 0.35;
    c.boost += 3;
    news(s, `${c.name}'s government gives in to protesters over ${info.name.toLowerCase()}.`, 'info', [c.id]);
    return null;
  }
  if (action === 'negotiate') {
    if ((pr.talked ?? -99) > s.week - 8) return 'Talks were held recently; give them time.';
    const cost = c.gdp * 0.0004 * (pr.size / 40) + 0.05;
    if (cost > c.treasury) return `Talks and a settlement would cost about ${money(cost)}; the treasury has ${money(c.treasury)}.`;
    c.treasury -= cost;
    pr.talked = s.week;
    pr.size *= 0.6;
    c.boost += 1;
    return null;
  }
  if (action === 'police') {
    const fear = SECURITY[c.security].fear;
    const democracy = c.gov === 'democracy';
    if (democracy && pr.size > 35 && chance(s, 0.35)) {
      // Images of police violence bring even more people out
      pr.size = Math.min(100, pr.size * 1.2);
      c.massacre = (c.massacre ?? 0) + 25;
      c.boost -= 6;
      c.rep = Math.max(0, c.rep - 5);
      news(s, `Police violence against protesters in ${c.name} sparks outrage at home and abroad.`, 'unrest', [c.id]);
      return null;
    }
    pr.size *= 0.45 - fear * 0.4;
    c.boost -= democracy ? 4 : 1;
    c.rep = Math.max(0, c.rep - (democracy ? 3 : 1));
    if (!democracy && pr.size > 20) c.massacre = (c.massacre ?? 0) + 8;
    news(s, `Riot police clear the streets in ${c.name}.`, 'unrest', [c.id]);
    return null;
  }
  return 'Unknown action.';
}

// crush (with the security forces) or amnesty (talks, autonomy and pardons)
export function handleUprising(s, c, regionId, action) {
  const reg = s.regions[regionId];
  if (!reg?.revolt || reg.ctrl !== c.id) return 'There is no uprising there against you.';
  const rv = reg.revolt;
  if ((rv.acted ?? -99) > s.week - 4) return 'Give the last measure a few weeks to work.';
  rv.acted = s.week;
  if (action === 'crush') {
    const cost = Math.max(0.1, rv.rebels * 0.01);
    if (cost > c.milFunds + c.treasury) return `The operation would cost ${money(cost)}.`;
    const fromFunds = Math.min(c.milFunds, cost);
    c.milFunds -= fromFunds;
    c.treasury -= cost - fromFunds;
    rv.rebels *= 0.55 - SECURITY[c.security].fear * 0.4;
    reg.dmg = Math.min(0.9, reg.dmg + 0.04);
    reg.pop *= 0.998;
    c.rep = Math.max(0, c.rep - (c.gov === 'democracy' ? 4 : 2));
    news(s, `${c.name}'s forces launch a crackdown on rebels in ${regionName(regionId)}.`, 'unrest', [c.id]);
    return null;
  }
  if (action === 'amnesty') {
    const works = chance(s, reg.owner === c.id ? 0.65 : 0.35);
    reg.unrest = Math.max(0, reg.unrest - 30);
    c.boost -= 1;
    if (works) {
      rv.rebels *= 0.15;
      news(s, `Rebels in ${regionName(regionId)} lay down arms under an amnesty from ${c.name}.`, 'peace', [c.id]);
    } else {
      rv.rebels *= 0.8;
      alert(s, c.id, `The amnesty offer in ${regionName(regionId)} was rejected by hardliners. Unrest has eased a little.`, 'warn', { region: regionId });
    }
    return null;
  }
  return 'Unknown action.';
}

export { rand };
