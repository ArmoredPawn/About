// Global crises: pandemics, financial crashes, famines and terror attacks. Each one is a story that unfolds over
// weeks or years, hits countries unevenly, and asks leaders to choose between looking after their own and working
// together: lock down or stay open, close the borders, fund the vaccine and share it or keep it; bail out the
// banks and join a coordinated stimulus or free-ride; send food to a famine; answer an attack with restraint,
// a crackdown or strikes on whoever sheltered the attackers.
//
// Each week a crisis adds to a country's c.cx (growth, approval, stability, inflation), which economy.js reads.

import { GEO } from './data/geo.js';
import { clamp, rand, chance, pick, news, alert, alive, nameOf, nextId, addRel, enemiesOf, alliancesOf, atWar } from './core.js';
import { perCapita } from './economy.js';
import { register, ask } from './decisions.js';
import { marketShock, investmentGrade, initFinance } from './finance.js';

const PATHOGENS = ['a new strain of bird flu', 'a novel coronavirus', 'a haemorrhagic fever', 'a new influenza', 'a drug-resistant pneumonia'];
export const LOCKDOWNS = {
  open: { name: 'Stay open', cut: 0, growth: 0, note: 'No restrictions: the economy keeps going and the virus spreads freely.' },
  targeted: { name: 'Targeted measures', cut: 0.4, growth: 1, note: 'Masks, testing, no big crowds: slows the spread at a modest cost.' },
  full: { name: 'Full lockdown', cut: 0.75, growth: 3.5, note: 'Everyone stays home: the spread nearly stops, and so does much of the economy. Patience wears thin.' },
};

export function initCrises(s) {
  s.crises ??= [];
  s.crisisLog ??= [];
  s.nextCrisis ??= { pandemic: 60, crash: 30, famine: 10, terror: 4 };
}

const active = (s, kind) => s.crises.filter((x) => x.kind === kind);
const live = (s) => Object.values(s.countries).filter((c) => alive(s, c.id));
const cx = (c) => (c.cx ??= { growth: 0, approval: 0, stability: 0, infl: 0 });

// Who borders whom, worked out once a week
function borders(s) {
  const out = new Map();
  for (const reg of Object.values(s.regions)) {
    const a = reg.ctrl;
    for (const id of GEO[reg.id].adj) {
      const b = s.regions[id]?.ctrl;
      if (!b || b === a) continue;
      (out.get(a) ?? out.set(a, new Set()).get(a)).add(b);
    }
  }
  return out;
}
function tradeLinks(s, id) {
  const out = new Set();
  for (const t of s.treaties) if (t.kind === 'fta' && (t.a === id || t.b === id)) out.add(t.a === id ? t.b : t.a);
  for (const al of alliancesOf(s, id, 'economic')) for (const m of al.members) if (m !== id) out.add(m);
  return out;
}

export function crisesTick(s) {
  initCrises(s);
  initFinance(s);
  for (const c of live(s)) c.cx = { growth: 0, approval: 0, stability: 0, infl: 0 };
  for (const x of [...s.crises]) {
    if (x.kind === 'pandemic') pandemicWeek(s, x);
    else if (x.kind === 'crash') crashWeek(s, x);
    else if (x.kind === 'famine') famineWeek(s, x);
    else if (x.kind === 'terror') terrorWeek(s, x);
  }
  // New crises: each kind has a quiet period after the last one
  const due = (k) => s.week >= (s.nextCrisis[k] ?? 0);
  if (due('pandemic') && !active(s, 'pandemic').length && chance(s, 0.006)) startPandemic(s);
  if (due('crash') && !active(s, 'crash').length && (chance(s, 0.004) || (bubble(s) > 1.35 && chance(s, 0.04)))) startCrash(s);
  if (due('famine')) famineCheck(s);
  if (due('terror') && chance(s, 0.014)) startTerror(s);
}

function finish(s, x, text) {
  s.crises = s.crises.filter((y) => y !== x);
  x.ended = s.week;
  x.summary = text;
  s.crisisLog.push({ id: x.id, kind: x.kind, name: x.name, since: x.since, ended: s.week, summary: text });
  if (s.crisisLog.length > 30) s.crisisLog.shift();
  if (text) news(s, text, x.kind === 'crash' ? 'economy' : 'disaster', x.country ? [x.country] : []);
}

/* ---------- Pandemics ---------- */

export function startPandemic(s, origin = null) {
  const big = live(s).filter((c) => c.pop > 20);
  const o = origin ? s.countries[origin] : pick(s, big);
  if (!o) return null;
  const x = { id: nextId(s, 'x'), kind: 'pandemic', name: pick(s, PATHOGENS), since: s.week, origin: o.id, inf: { [o.id]: 0.003 }, immune: {}, vacc: {}, deaths: {}, vaccine: 0, funds: {}, maker: null, shared: null, reached: [o.id] };
  s.crises.push(x);
  s.nextCrisis.pandemic = s.week + 260;
  news(s, `A new disease is spreading in ${o.name}: ${x.name}. Doctors warn it could go global.`, 'disaster', [o.id]);
  reached(s, x, o);
  return x;
}

function reached(s, x, c) {
  c.pandemic = { policy: 'targeted', borders: false, since: s.week };
  ask(s, c, 'pandemic', {
    title: `${x.name[0].toUpperCase()}${x.name.slice(1)} has reached us`,
    text: 'Cases are rising. How hard do we act? (You can change this at any time in World → Crises.)',
    options: [
      { id: 'targeted', label: LOCKDOWNS.targeted.name, note: LOCKDOWNS.targeted.note },
      { id: 'full', label: LOCKDOWNS.full.name, note: LOCKDOWNS.full.note },
      { id: 'open', label: LOCKDOWNS.open.name, note: LOCKDOWNS.open.note, tone: 'warn' },
      { id: 'borders', label: 'Targeted measures and close the borders', note: 'Keeps new infections out, but trade and growth suffer, and neighbours resent it.' },
    ],
    weeks: 3,
    data: { crisis: x.id },
  });
}

register('pandemic', {
  ai: (s, c) => (c.gov === 'autocracy' && chance(s, 0.5) ? 'full' : perCapita(c) < 3 ? 'open' : chance(s, 0.25) ? 'borders' : 'targeted'),
  apply: (s, c, d, option) => setPandemicPolicy(s, c, option === 'borders' ? { policy: 'targeted', borders: true } : { policy: option }),
});

export function setPandemicPolicy(s, c, { policy, borders: closed }) {
  if (!active(s, 'pandemic').length) return 'There is no pandemic.';
  c.pandemic ??= { policy: 'targeted', borders: false, since: s.week };
  if (policy) {
    if (!LOCKDOWNS[policy]) return 'Pick a policy.';
    if (policy !== c.pandemic.policy) { c.pandemic.policy = policy; c.pandemic.since = s.week; }
  }
  if (closed != null) {
    c.pandemic.borders = Boolean(closed);
    if (closed) news(s, `${c.name} closes its borders to keep the disease out.`, 'disaster', [c.id]);
  }
  return null;
}

function pandemicWeek(s, x) {
  const nb = borders(s);
  const weeks = s.week - x.since;
  // Vaccine research: the world's labs, faster with money
  if (x.vaccine < 1) {
    const funded = Object.values(x.funds).reduce((t, v) => t + v, 0);
    x.vaccine = Math.min(1, x.vaccine + 1 / 90 + Math.min(0.02, (x.fundsWeek ?? 0) / 300) + funded / 20000);
    x.fundsWeek = 0;
    if (x.vaccine >= 1) vaccineReady(s, x);
  }
  // Spread between countries: neighbours, trading partners and the great hubs
  const exposure = new Map();
  for (const [id, inf] of Object.entries(x.inf)) {
    const c = s.countries[id];
    if (!c || inf < 0.001) continue;
    const out = inf * (c.pandemic?.borders ? 0.4 : 1);
    for (const n of nb.get(id) ?? []) exposure.set(n, (exposure.get(n) ?? 0) + out * 0.6);
    for (const n of tradeLinks(s, id)) exposure.set(n, (exposure.get(n) ?? 0) + out * 0.25);
    if (c.gdp > 500) for (const o of live(s)) if (o.gdp > 300) exposure.set(o.id, (exposure.get(o.id) ?? 0) + out * 0.08);
  }
  for (const [id, e] of exposure) {
    const c = s.countries[id];
    if (!c || !alive(s, id) || (x.inf[id] ?? 0) > 0.0005 || (x.immune[id] ?? 0) > 0.6) continue;
    if (chance(s, Math.min(0.6, e * 6 * (c.pandemic?.borders ? 0.2 : 1)))) {
      x.inf[id] = 0.002;
      if (!x.reached.includes(id)) { x.reached.push(id); reached(s, x, c); }
    }
  }
  // Inside each country: infections grow, people recover, the vaccine protects
  let world = 0;
  for (const [id, inf0] of Object.entries(x.inf)) {
    const c = s.countries[id];
    if (!c || !alive(s, id)) { delete x.inf[id]; continue; }
    const pol = LOCKDOWNS[c.pandemic?.policy ?? 'targeted'];
    const healthy = clamp(1 - (c.spend.health - 4) * 0.03, 0.6, 1.2);
    const immune = Math.min(0.95, (x.immune[id] ?? 0) + (x.vacc[id] ?? 0));
    let inf = inf0 + inf0 * 0.9 * (1 - pol.cut) * (1 - immune) - inf0 * 0.3;
    inf = clamp(inf, 0, 0.35);
    x.immune[id] = Math.min(0.9, (x.immune[id] ?? 0) + inf0 * 0.3);
    x.inf[id] = inf;
    world += inf * c.pop;
    // The dead
    const dead = inf * c.pop * 1000 * 0.0012 * healthy * (perCapita(c) < 5 ? 1.5 : 1);
    x.deaths[id] = (x.deaths[id] ?? 0) + dead;
    if (dead > 0.001) {
      for (const reg of Object.values(s.regions)) if (reg.ctrl === id) reg.pop = Math.max(0.01, reg.pop * (1 - dead / 1000 / Math.max(0.1, c.pop)));
      c.dead = (c.dead ?? 0) + dead;
    }
    const e = cx(c);
    e.growth -= Math.min(6, inf * 30) + pol.growth + (c.pandemic?.borders ? 0.7 : 0);
    e.approval -= Math.min(15, inf * 60) + (pol === LOCKDOWNS.full ? Math.min(8, (s.week - (c.pandemic?.since ?? s.week)) / 6) : 0);
    e.stability -= Math.min(6, inf * 20);
    if (inf < 0.0005 && (x.vacc[id] ?? 0) > 0.3) delete x.inf[id];
  }
  // Vaccination: the maker first, then those who paid, then the world (sooner if it was shared)
  if (x.vaccine >= 1) {
    for (const c of live(s)) {
      const rate = c.id === x.maker ? (x.shared ? 0.06 : 0.1) : x.funds[c.id] ? 0.05 : x.shared ? 0.035 : (s.week - x.readyAt > 26 ? 0.03 : 0.01);
      x.vacc[c.id] = Math.min(0.9, (x.vacc[c.id] ?? 0) + rate * (perCapita(c) < 3 ? 0.6 : 1));
    }
  }
  x.peak = Math.max(x.peak ?? 0, world);
  const total = Object.values(x.deaths).reduce((t, v) => t + v, 0);
  if ((Object.keys(x.inf).length === 0 && weeks > 10) || weeks > 200) {
    for (const c of live(s)) if (c.pandemic) c.pandemic = null;
    finish(s, x, `The ${x.name} pandemic is over. It killed about ${fmtDead(total)} people worldwide.`);
  }
}

function vaccineReady(s, x) {
  x.readyAt = s.week;
  const top = Object.entries(x.funds).sort((a, b) => b[1] - a[1])[0]?.[0];
  const maker = s.countries[top] ?? live(s).filter((c) => c.tech.industry >= 7).sort((a, b) => b.gdp - a.gdp)[0];
  if (!maker) { x.shared = true; return; }
  x.maker = maker.id;
  news(s, `Scientists in ${maker.name} have made a vaccine against ${x.name}.`, 'disaster', [maker.id]);
  ask(s, maker, 'vaccine', {
    title: 'Our scientists have a vaccine',
    text: 'Every country wants it. Do we share it with the world, or vaccinate our own people first?',
    options: [
      { id: 'share', label: 'Share it with the world', note: 'Licences and doses for everyone: the pandemic ends sooner everywhere. Our own rollout is a little slower. The world is grateful.' },
      { id: 'hoard', label: 'Our people first', note: 'We vaccinate fastest. Everyone else waits half a year, and remembers it.', tone: 'warn' },
    ],
    weeks: 2,
    data: { crisis: x.id },
  });
}

register('vaccine', {
  ai: (s, c) => (c.gov === 'democracy' ? (chance(s, 0.7) ? 'share' : 'hoard') : chance(s, 0.4) ? 'share' : 'hoard'),
  apply: (s, c, d, option) => {
    const x = s.crises.find((y) => y.id === d.data.crisis);
    if (!x) return null;
    x.shared = option === 'share';
    if (x.shared) {
      c.rep = Math.min(100, c.rep + 8);
      for (const o of live(s)) if (o.id !== c.id) addRel(s, c.id, o.id, 8);
      news(s, `${c.name} shares its vaccine with the world.`, 'disaster', [c.id]);
    } else {
      c.rep = Math.max(0, c.rep - 5);
      for (const o of live(s)) if (o.id !== c.id && !x.funds[o.id]) addRel(s, c.id, o.id, -6);
      news(s, `${c.name} keeps its vaccine for its own people first. Other countries protest.`, 'disaster', [c.id]);
    }
    return null;
  },
});

// Pay toward the vaccine: it comes sooner, and those who paid get it early
export function fundVaccine(s, c, amount) {
  const x = active(s, 'pandemic')[0];
  if (!x) return 'There is no pandemic.';
  if (x.vaccine >= 1) return 'The vaccine is already made.';
  amount = Number(amount);
  if (!(amount > 0) || amount > c.treasury) return 'Not enough in the treasury.';
  c.treasury -= amount;
  x.funds[c.id] = (x.funds[c.id] ?? 0) + amount;
  x.fundsWeek = (x.fundsWeek ?? 0) + amount;
  c.rep = Math.min(100, c.rep + Math.min(4, amount / Math.max(1, c.gdp) * 300));
  if (amount >= 1) news(s, `${c.name} gives $${Math.round(amount * 10) / 10}B to the race for a vaccine.`, 'disaster', [c.id]);
  return null;
}

const fmtDead = (k) => (k >= 1000 ? `${Math.round(k / 100) / 10} million` : k >= 1 ? `${Math.round(k)},000` : `${Math.max(10, Math.round(k * 100) * 10)}`);

/* ---------- Financial crashes ---------- */

// How far the world's stock markets have run ahead of what their economies are worth
function bubble(s) {
  let t = 0;
  let w = 0;
  for (const c of live(s)) {
    if (c.gdp < 500) continue;
    t += (c.stocks ?? 100) / (100 * c.gdp / Math.max(1, c.gdp0 ?? c.gdp)) * c.gdp;
    w += c.gdp;
  }
  return w ? t / w : 1;
}

export function startCrash(s, origin = null) {
  const hubs = live(s).filter((c) => c.gdp > 1000);
  const o = origin ? s.countries[origin] : (hubs.length ? hubs.sort((a, b) => (b.stocks / b.stockRef) * b.gdp - (a.stocks / a.stockRef) * a.gdp)[chance(s, 0.6) ? 0 : Math.floor(rand(s) * hubs.length)] : null);
  if (!o) return null;
  const hit = { [o.id]: 1 };
  const links = tradeLinks(s, o.id);
  for (const c of live(s)) {
    if (c.id === o.id) continue;
    let share = 0.35;
    if (links.has(c.id)) share = 0.7;
    else if (investmentGrade(c.rating) && c.gdp > 300) share = 0.55;
    if (c.controls || Object.keys(s.sanctions).some((k) => s.sanctions[k] && k.endsWith(`>${c.id}`))) share *= 0.5;
    hit[c.id] = share;
  }
  const x = { id: nextId(s, 'x'), kind: 'crash', name: `the ${o.name} crash`, since: s.week, origin: o.id, hit, response: {}, summit: { at: s.week + 3, joined: [], declined: [], done: false } };
  s.crises.push(x);
  s.nextCrisis.crash = s.week + 200;
  marketShock(s, 0.9, Object.entries(hit), 0.3);
  news(s, `Financial crash: banks in ${o.name} collapse and markets around the world plunge.`, 'economy', [o.id]);
  for (const c of live(s)) {
    if (hit[c.id] < 0.5 || c.gdp < 40) continue;
    ask(s, c, 'banks', {
      title: 'Our banks are failing',
      text: `The crash that began in ${o.name} has reached our banks. If they fail, savers lose their money and businesses can't borrow.`,
      options: [
        { id: 'guarantee', label: 'Guarantee savers\' deposits', note: 'Costs about 1% of GDP. Stops the bank runs; the recession is a little milder.' },
        { id: 'bailout', label: 'Bail out the banks', note: 'Costs about 3% of GDP. The recession is much milder, but people hate rescuing bankers.' },
        { id: 'fail', label: 'Let them fail', note: 'Costs nothing now. A deeper, longer recession and angry savers.', tone: 'warn' },
      ],
      weeks: 3,
      data: { crisis: x.id },
    });
  }
  return x;
}

register('banks', {
  ai: (s, c) => (c.treasury > c.gdp * 0.03 && perCapita(c) > 20 ? 'bailout' : c.treasury > c.gdp * 0.01 ? 'guarantee' : 'fail'),
  apply: (s, c, d, option) => {
    const x = s.crises.find((y) => y.id === d.data.crisis);
    if (!x) return null;
    const cost = c.gdp * (option === 'bailout' ? 0.03 : option === 'guarantee' ? 0.01 : 0);
    c.treasury -= cost;
    x.response[c.id] = option;
    if (option === 'bailout') c.approval = Math.max(0, c.approval - 3);
    if (option === 'fail') { c.stocks *= 0.9; c.approval = Math.max(0, c.approval - 2); }
    return null;
  },
});

function crashWeek(s, x) {
  const weeks = s.week - x.since;
  // The emergency summit: who joins the coordinated stimulus
  if (!x.summit.done && s.week >= x.summit.at) {
    x.summit.done = true;
    const members = live(s).filter((c) => c.gdp > 300).sort((a, b) => b.gdp - a.gdp).slice(0, 20);
    x.summit.invited = members.map((c) => c.id);
    news(s, 'World leaders meet at an emergency summit on the crash.', 'economy', []);
    for (const c of members) {
      ask(s, c, 'summit', {
        title: 'Emergency summit: a coordinated stimulus',
        text: 'The largest economies are agreeing to spend together to pull the world out of recession. The more join, the faster everyone recovers, including those who stay out.',
        options: [
          { id: 'join', label: 'Join: spend 2% of GDP', note: 'Our recession eases most. The world sees us lead.' },
          { id: 'stay', label: 'Stay out', note: 'We keep the money and still get part of the benefit from the others\' spending. Some will call it free-riding.' },
        ],
        weeks: 2,
        data: { crisis: x.id },
      });
    }
  }
  const world = live(s).reduce((t, c) => t + c.gdp, 0);
  const joinedGdp = x.summit.joined.reduce((t, id) => t + (s.countries[id]?.gdp ?? 0), 0);
  const coord = joinedGdp / Math.max(1, world);
  const fade = Math.max(0, 1 - weeks / 45);
  for (const c of live(s)) {
    const share = x.hit[c.id] ?? 0.3;
    const resp = x.response[c.id];
    const mult = (resp === 'bailout' ? 0.55 : resp === 'guarantee' ? 0.8 : resp === 'fail' ? 1.4 : 1)
      * (1 - (x.summit.joined.includes(c.id) ? 0.6 : 0.3) * coord * 1.5);
    const e = cx(c);
    e.growth -= 3.5 * share * fade * Math.max(0.2, mult);
    e.approval -= 3 * share * fade;
  }
  s.markets.mood = Math.min(s.markets.mood, -0.3 * fade);
  if (weeks >= 52) finish(s, x, `The world is recovering from ${x.name}${x.summit.joined.length ? `; ${x.summit.joined.length} countries joined the coordinated stimulus` : ''}.`);
}

register('summit', {
  ai: (s, c) => (c.treasury > c.gdp * 0.02 && (c.gov === 'democracy' ? chance(s, 0.75) : chance(s, 0.4)) ? 'join' : 'stay'),
  apply: (s, c, d, option) => {
    const x = s.crises.find((y) => y.id === d.data.crisis);
    if (!x) return null;
    if (option === 'join') {
      x.summit.joined.push(c.id);
      c.treasury -= c.gdp * 0.02;
      c.rep = Math.min(100, c.rep + 3);
      news(s, `${c.name} joins the coordinated stimulus.`, 'economy', [c.id]);
    } else {
      x.summit.declined.push(c.id);
      if (c.gdp > 2000) c.rep = Math.max(0, c.rep - 2);
    }
    return null;
  },
});

/* ---------- Famines ---------- */

function famineCheck(s) {
  if (active(s, 'famine').length >= 2) return;
  for (const c of live(s)) {
    if (perCapita(c) > 8 || c.pop < 3 || s.crises.some((x) => x.kind === 'famine' && x.country === c.id)) continue;
    const hungry = (c.short?.food ?? 0) > 0.25 || ((c.cx?.growth ?? 0) < -4 && enemiesOf(s, c.id).size > 0);
    if ((hungry && chance(s, 0.06)) || chance(s, 0.00012)) { startFamine(s, c.id); return; }
  }
}

export function startFamine(s, cid) {
  const c = s.countries[cid];
  if (!c) return null;
  const x = { id: nextId(s, 'x'), kind: 'famine', name: `famine in ${c.name}`, since: s.week, country: cid, severity: 0.6, aid: {}, deaths: 0 };
  s.crises.push(x);
  s.nextCrisis.famine = s.week + 26;
  news(s, `Famine in ${c.name}: harvests have failed and millions are going hungry. Aid agencies appeal for help.`, 'disaster', [cid]);
  alert(s, cid, 'Famine: our people are starving. Other countries may send aid; rationing and food imports (Market) also help.', 'bad');
  for (const o of live(s)) {
    if (o.id === cid || o.gdp < 150 || atWar(s, o.id, cid)) continue;
    ask(s, o, 'famineAid', {
      title: `Famine in ${c.name}`,
      text: `Millions in ${c.name} are going hungry. Do we send food aid?`,
      options: [
        { id: 'none', label: 'Send nothing', note: 'Costs nothing.' },
        { id: 'small', label: `Send $${aidSize(o, 'small')}B of food`, note: 'Saves lives; they and the world notice.' },
        { id: 'large', label: `Send $${aidSize(o, 'large')}B of food`, note: 'A major relief effort: a real difference, and lasting gratitude.' },
      ],
      weeks: 4,
      data: { crisis: x.id },
    });
  }
  return x;
}
const aidSize = (c, size) => Math.max(0.1, Math.round(Math.min(size === 'large' ? 3 : 0.8, c.gdp * (size === 'large' ? 0.0015 : 0.0004)) * 10) / 10);

register('famineAid', {
  ai: (s, c, d) => {
    const x = s.crises.find((y) => y.id === d.data.crisis);
    const r = x ? (s.rel[c.id < x.country ? `${c.id}|${x.country}` : `${x.country}|${c.id}`] ?? 0) : 0;
    if (r < -20) return 'none';
    if (r > 40) return 'large';
    return c.gov === 'democracy' && chance(s, 0.6) ? 'small' : chance(s, 0.25) ? 'small' : 'none';
  },
  apply: (s, c, d, option) => sendFamineAid(s, c, d.data.crisis, option),
});

export function sendFamineAid(s, c, crisisId, size) {
  const x = s.crises.find((y) => y.id === crisisId);
  if (!x) return 'That famine is over.';
  if (size === 'none') return null;
  const amount = aidSize(c, size);
  if (c.treasury < amount) return 'Not enough in the treasury.';
  c.treasury -= amount;
  x.aid[c.id] = (x.aid[c.id] ?? 0) + amount;
  x.relief = (x.relief ?? 0) + amount / Math.max(0.5, (s.countries[x.country]?.pop ?? 10) * 0.01);
  addRel(s, c.id, x.country, size === 'large' ? 20 : 10);
  c.rep = Math.min(100, c.rep + (size === 'large' ? 3 : 1));
  if (c.human || amount >= 1) news(s, `${c.name} sends $${amount}B of food aid to ${nameOf(s, x.country)}.`, 'disaster', [c.id, x.country]);
  return null;
}

function famineWeek(s, x) {
  const c = s.countries[x.country];
  if (!c || !alive(s, c.id)) { finish(s, x, null); return; }
  const fed = (c.short?.food ?? 0) < 0.1 && !enemiesOf(s, c.id).size;
  // Food aid arriving over the weeks, enough of it (relief 1) about doubling how fast the famine eases
  x.severity = clamp(x.severity - (fed ? 0.03 : 0.012) - 0.02 * Math.min(1.5, x.relief ?? 0) - (c.ration ? 0.01 : 0), 0, 1);
  const dead = c.pop * 1000 * x.severity * 0.00012;
  x.deaths += dead;
  c.dead = (c.dead ?? 0) + dead;
  for (const reg of Object.values(s.regions)) if (reg.ctrl === c.id) reg.pop = Math.max(0.01, reg.pop * (1 - dead / 1000 / Math.max(0.1, c.pop)));
  const e = cx(c);
  e.approval -= 12 * x.severity;
  e.stability -= 8 * x.severity;
  e.growth -= 2 * x.severity;
  if ((x.severity < 0.05 && s.week - x.since >= 10) || s.week - x.since > 60) {
    const donors = Object.keys(x.aid).length;
    finish(s, x, `The famine in ${c.name} is over. About ${fmtDead(x.deaths)} people died${donors ? `; ${donors} countries sent food aid` : '; no one sent help'}.`);
  }
}

/* ---------- Terror attacks ---------- */

function startTerror(s) {
  const pool = live(s).filter((c) => c.gdp > 30);
  if (!pool.length) return null;
  const weight = (c) => (c.terrorGuard > s.week ? 0.4 : 1) * (1 + 3 * Math.min(1, enemiesOf(s, c.id).size) + (c.rep < 40 ? 1 : 0) + (c.gdp > 1500 ? 1 : 0)
    + 3 * Object.values(s.regions).filter((r) => r.ctrl === c.id && (r.loyalty ?? 60) < 30).length / Math.max(1, Object.values(s.regions).filter((r) => r.ctrl === c.id).length));
  let total = pool.reduce((t, c) => t + weight(c), 0) * rand(s);
  let c = pool[0];
  for (const x of pool) { total -= weight(x); if (total <= 0) { c = x; break; } }
  return startTerrorIn(s, c.id);
}

export function startTerrorIn(s, cid) {
  const c = s.countries[cid];
  if (!c) return null;
  // Who sheltered the attackers: an enemy at war with us, or a failing state that hates us
  const havens = live(s).filter((o) => o.id !== cid && (atWar(s, o.id, cid) || ((s.rel[o.id < cid ? `${o.id}|${cid}` : `${cid}|${o.id}`] ?? 0) < -40 && (o.stability < 45 || o.civilWar))));
  const haven = havens.length && chance(s, 0.7) ? pick(s, havens).id : null;
  const dead = Math.round((0.02 + rand(s) * (chance(s, 0.15) ? 2.5 : 0.25)) * 1000);
  const place = pick(s, Object.values(s.regions).filter((r) => r.ctrl === cid).sort((a, b) => b.pop - a.pop).slice(0, 3));
  const x = { id: nextId(s, 'x'), kind: 'terror', name: `attack in ${c.name}`, since: s.week, country: cid, haven, dead, region: place?.id ?? null };
  s.crises.push(x);
  s.nextCrisis.terror = s.week + 8;
  c.stocks = (c.stocks ?? 100) * 0.96;
  c.rally = (c.rally ?? 0) + 5;
  c.dead = (c.dead ?? 0) + dead / 1000;
  news(s, `Terror attack in ${c.name}: ${dead} people killed${haven ? `. Investigators say the attackers trained in ${nameOf(s, haven)}` : ''}. World leaders condemn it.`, 'incident', haven ? [cid, haven] : [cid]);
  const options = [
    { id: 'calm', label: 'Mourn, and carry on', note: 'An open society doesn\'t bend to terror. No cost, but another attack is likelier.' },
    { id: 'crackdown', label: 'Tighten security', note: 'More police powers and surveillance: attacks become rarer, and stability rises. In a democracy, some see it as an overreach.' },
  ];
  if (haven) options.push({ id: 'strike', label: `Hold ${nameOf(s, haven)} responsible`, note: `Relations with ${nameOf(s, haven)} collapse, and the nation rallies behind us: a war against it is now justified at home.`, tone: 'danger' });
  ask(s, c, 'terror', { title: `Terror attack: ${dead} dead`, text: `The country is in shock.${haven ? ` The attackers trained in ${nameOf(s, haven)}.` : ' It was a home-grown cell.'} How do we respond?`, options, weeks: 2, data: { crisis: x.id, haven } });
  return x;
}

register('terror', {
  ai: (s, c, d) => (d.data.haven && (c.gov !== 'democracy' || chance(s, 0.3)) ? 'strike' : c.gov === 'democracy' && chance(s, 0.5) ? 'calm' : 'crackdown'),
  apply: (s, c, d, option) => {
    const haven = d.data.haven;
    if (option === 'crackdown') {
      c.terrorGuard = s.week + 104;
      c.stability = Math.min(100, c.stability + 5);
      if (c.gov === 'democracy') c.approval = Math.max(0, c.approval - 2);
    }
    if (option === 'strike' && haven && s.countries[haven]) {
      addRel(s, c.id, haven, -40);
      c.rally = (c.rally ?? 0) + 6;
      c.warCases = { ...(c.warCases ?? {}), [haven]: s.week + 26 };
      news(s, `${c.name} holds ${nameOf(s, haven)} responsible for the attack and vows to respond.`, 'war', [c.id, haven]);
      alert(s, haven, `${c.name} blames us for the terror attack it suffered and is threatening us.`, 'bad', { country: c.id });
    }
    return null;
  },
});

function terrorWeek(s, x) {
  const c = s.countries[x.country];
  const weeks = s.week - x.since;
  if (c) {
    const e = cx(c);
    e.growth -= 0.4 * Math.max(0, 1 - weeks / 8);
  }
  if (weeks >= 8) finish(s, x, null);
}

/* ---------- What a leader sees ---------- */

export function crisesView(s, cid) {
  initCrises(s);
  return {
    active: s.crises.map((x) => {
      const base = { id: x.id, kind: x.kind, name: x.name, since: x.since, country: x.country ?? x.origin ?? null };
      if (x.kind === 'pandemic') {
        return {
          ...base, vaccine: Math.round(x.vaccine * 100), maker: x.maker, shared: x.shared,
          inf: Object.fromEntries(Object.entries(x.inf).map(([k, v]) => [k, Math.round(v * 1000) / 10])),
          vacc: x.vacc[cid] != null ? Math.round(x.vacc[cid] * 100) : 0,
          deaths: Math.round(Object.values(x.deaths).reduce((t, v) => t + v, 0)), ourDeaths: Math.round(x.deaths[cid] ?? 0),
          funds: Object.fromEntries(Object.entries(x.funds).map(([k, v]) => [k, Math.round(v * 10) / 10])), reached: x.reached.length,
        };
      }
      if (x.kind === 'crash') return { ...base, hit: Math.round((x.hit[cid] ?? 0) * 100), response: x.response[cid] ?? null, summit: { at: x.summit.at, done: x.summit.done, joined: x.summit.joined, declined: x.summit.declined } };
      if (x.kind === 'famine') return { ...base, severity: Math.round(x.severity * 100), deaths: Math.round(x.deaths * 10) / 10, relief: Math.round(Math.min(1.5, x.relief ?? 0) * 100), aid: Object.fromEntries(Object.entries(x.aid).map(([k, v]) => [k, Math.round(v * 10) / 10])) };
      return { ...base, haven: x.haven, dead: x.dead, region: x.region };
    }),
    log: s.crisisLog.slice(-12),
  };
}
