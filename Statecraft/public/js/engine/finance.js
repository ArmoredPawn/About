// Money and markets: every country's currency, its stock market and its credit rating, and what happens when the
// markets stop lending: a debt crisis, then a bailout from the IMF (with conditions), a default, or the printing
// press. Indexes start at 100.
//
// What moves them:
//   currency  real interest rates against the world's, inflation, debt beyond what markets trust, stability,
//             wars, sanctions, and the central bank (buying its own currency with reserves, or selling it)
//   stocks    growth, war, unrest, interest rates, the world's mood, and a pull back toward what the economy is
//             really worth (so a bubble deflates, and a crash recovers)
//   rating    debt and deficits against the economy, borrowing costs, stability, reserves, and any default
//
// What they do: a falling currency makes imports dearer (inflation) and exports cheaper (a little growth); a
// collapsing one makes foreign debt dearer. A rising stock market lifts confidence, growth and approval; a crash
// does the opposite. A poor rating raises the interest on new borrowing.

import { clamp, rand, chance, news, alert, alive, atWar, enemiesOf, nameOf, nextId, money } from './core.js';
import { debtRatio, debtLimit, perCapita } from './economy.js';
import { register, ask } from './decisions.js';

export const RATINGS = [[85, 'AAA'], [75, 'AA'], [65, 'A'], [55, 'BBB'], [45, 'BB'], [35, 'B'], [20, 'CCC'], [-Infinity, 'D']];
const ratingOf = (score) => RATINGS.find(([min]) => score >= min)[1];
export const investmentGrade = (r) => ['AAA', 'AA', 'A', 'BBB'].includes(r);

const noise = (s) => (rand(s) + rand(s) + rand(s) - 1.5) * 1.15; // roughly a standard normal
const IMF_WEEKS = 104;

export function initFinance(s) {
  s.markets ??= { mood: 0, crash: null };
  for (const c of Object.values(s.countries)) {
    c.fx ??= 100;
    c.fxRef ??= 100;
    c.stocks ??= 100;
    c.stockRef ??= 100;
    c.gdp0 ??= c.gdp;
    c.fxAdj ??= 0;
    c.fin ??= { growth: 0, infl: 0, approval: 0, spread: 0 };
    c.finHist ??= { fx: [], stocks: [] };
    if (c.ratingScore == null) { c.ratingScore = 70; rating(s, c, true); }
    c.lastRate ??= c.rate;
  }
}

/* ---------- Every week ---------- */

export function financeTick(s) {
  initFinance(s);
  const m = s.markets;
  m.mood *= 0.93;
  const live = Object.values(s.countries).filter((c) => alive(s, c.id));
  // The world's real interest rate, weighted by economy
  let wr = 0;
  let wg = 0;
  for (const c of live) { wr += (c.rate - c.infl) * c.gdp; wg += c.gdp; }
  wr /= Math.max(1, wg);
  for (const c of live) {
    // Whatever the week's bills left unpaid is borrowed
    if (c.treasury < 0) { c.debt += -c.treasury; c.treasury = 0; }
    currency(s, c, wr);
    stocks(s, c);
    rating(s, c);
    debtCrisis(s, c);
    imf(s, c);
    effects(s, c);
    c.lastRate = c.rate;
    if (s.week % 2 === 0) {
      const h = c.finHist;
      h.fx.push(Math.round(c.fx * 10) / 10);
      h.stocks.push(Math.round(c.stocks * 10) / 10);
      if (h.fx.length > 104) { h.fx.shift(); h.stocks.shift(); }
    }
  }
}

function currency(s, c, worldReal) {
  const real = c.rate - c.infl;
  const over = Math.max(0, debtRatio(c) - debtLimit(c));
  const sanctioned = Object.keys(s.sanctions).filter((k) => s.sanctions[k] && k.endsWith(`>${c.id}`)).length;
  let target = 0.035 * clamp(real - worldReal, -10, 10)
    - 0.012 * Math.max(0, c.infl - 4)
    - 0.004 * over
    + 0.004 * (c.stability - 55)
    + 0.05 * clamp((c.windfall ?? 0) * 52 / Math.max(1, c.gdp), -1, 1)
    - 0.03 * Math.min(4, sanctioned)
    - (enemiesOf(s, c.id).size ? 0.05 : 0)
    - (c.debtCrisis ? 0.25 : 0) - (c.defaulted ? 0.35 : 0)
    + c.fxAdj;
  target = 100 * Math.exp(clamp(target, -1.5, 0.8));
  c.fxAdj *= 0.96; // intervention wears off as the money is spent
  let move = (target - c.fx) * 0.05 + c.fx * 0.006 * noise(s);
  if (c.controls && move < 0) move *= 0.3; // capital controls: money can't flee
  c.fx = clamp(c.fx + move, 5, 400);
  c.fxRef += (c.fx - c.fxRef) / 52;
}

function stocks(s, c) {
  const worth = 100 * c.gdp / Math.max(1, c.gdp0) * (c.stocksBase ?? 1);
  let r = (c.growth ?? c.trend) / 100 / 52 * 1.4 + 0.0008
    + s.markets.mood * 0.012
    + 0.004 * noise(s) * (c.gov === 'democracy' ? 1 : 1.3)
    - (enemiesOf(s, c.id).size ? 0.002 : 0)
    - (c.stability < 35 ? 0.003 : 0)
    - (c.debtCrisis ? 0.01 : 0)
    - (c.controls ? 0.0015 : 0)
    - 0.012 * (c.rate - c.lastRate)
    + 0.02 * Math.log(worth / Math.max(1, c.stocks));
  c.stocks = clamp(c.stocks * (1 + r), 3, 2000);
  c.stockRef += (c.stocks - c.stockRef) / 26;
}

function rating(s, c, snap = false) {
  const ratio = debtRatio(c);
  const lim = debtLimit(c);
  const pc = perCapita(c);
  let score = 58 + 25 * Math.min(1, pc / 45)
    + (c.gov === 'democracy' ? 8 : c.gov === 'autocracy' ? -5 : 0)
    + (c.gdp > 2000 ? 5 : 0)
    - (pc < 3 ? 12 : pc < 8 ? 6 : 0)
    - 40 * Math.max(0, ratio / lim - 0.6)
    - 2.5 * Math.max(0, (c.deficit ?? 0) - 3)
    - 2 * Math.max(0, c.bond - Math.max(0, c.infl) - 3)
    - (c.stability < 45 ? (45 - c.stability) * 0.6 : 0)
    + Math.min(8, 40 * c.treasury / Math.max(1, c.gdp))
    - (c.debtCrisis ? 25 : 0)
    - (c.imf ? 8 : 0)
    - (c.fx < c.fxRef * 0.75 ? 8 : 0);
  if (c.defaulted) score = Math.min(score, c.defaulted.until - s.week > 52 ? 5 : 25);
  c.ratingScore += (clamp(score, 0, 100) - c.ratingScore) * (snap ? 1 : 0.15);
  if (snap) { c.rating = ratingOf(Math.max(20, c.ratingScore)); return; }
  const before = c.rating;
  // Only a country that has actually defaulted is rated D
  c.rating = c.defaulted ? 'D' : ratingOf(Math.max(20, c.ratingScore));
  if (before && before !== c.rating && c.gdp > 150) {
    const down = RATINGS.findIndex(([, r]) => r === c.rating) > RATINGS.findIndex(([, r]) => r === before);
    if (investmentGrade(before) !== investmentGrade(c.rating) || c.rating === 'D' || c.human) {
      news(s, `${c.name}'s credit rating is ${down ? 'cut' : 'raised'} from ${before} to ${c.rating}${down && !investmentGrade(c.rating) && investmentGrade(before) ? ': junk' : ''}.`, 'economy', [c.id]);
    }
    if (c.human) alert(s, c.id, `Our credit rating was ${down ? 'cut' : 'raised'} to ${c.rating}. ${down ? 'Borrowing costs rise.' : 'Borrowing gets cheaper.'}`, down ? 'bad' : 'good');
  }
}

// What the markets do to the rest of the economy (read by economy.js)
function effects(s, c) {
  const dev = Math.log(c.fx / Math.max(1, c.fxRef));
  const conf = clamp(Math.log(c.stocks / Math.max(1, c.stockRef)), -0.6, 0.4);
  c.fin.infl = clamp(dev > 0 ? -dev * 8 : -dev * 18, -2, 25);
  c.fin.growth = clamp(-dev * 1.2 + conf * 2.2, -4, 2) - (c.controls ? 0.4 : 0) - (c.debtCrisis && !c.imf ? 2.5 : 0) - (c.defaulted ? 2 : 0);
  c.fin.approval = clamp(conf * 12, -8, 4);
  // Junk ratings and a collapsing currency both raise what the country pays to borrow
  c.fin.spread = Math.min(3, Math.max(0, (55 - c.ratingScore) * 0.05)) + Math.min(2, Math.max(0, -dev) * 4);
}

/* ---------- Debt crises ---------- */

function debtCrisis(s, c) {
  if (c.defaulted && c.defaulted.until <= s.week) {
    c.defaulted = null;
    news(s, `${c.name} returns to the bond markets after its default.`, 'economy', [c.id]);
  }
  if (c.debtCrisis) {
    // It passes once borrowing costs come down and the books are near balance
    if (c.bond < 8 && (c.deficit ?? 0) < 4 && s.week - c.debtCrisis.since > 8) {
      c.debtCrisis = null;
      news(s, `The debt crisis in ${c.name} eases as the markets lend again.`, 'economy', [c.id]);
      alert(s, c.id, 'The markets are lending to us again. The debt crisis is over.', 'good');
    }
    return;
  }
  if (c.defaulted || c.imf || (c.imfDone ?? -99) > s.week - 52) return;
  const ratio = debtRatio(c);
  const lim = debtLimit(c);
  // Markets give up on a country whose debt is well past what they will bear and still climbing, or that pays far
  // more than inflation to borrow on a heavy debt. A country that keeps its books near balance never gets here.
  const realBond = c.bond - Math.max(0, c.infl);
  const climbing = (c.deficit ?? 0) > 3;
  const strained = (ratio > lim * 1.15 && climbing) || (ratio > lim * 0.9 && realBond > 7 && climbing) || ratio > lim * 1.6;
  if (!strained || c.treasury > c.gdp * 0.03) return;
  c.debtCrisis = { since: s.week };
  c.stocks *= 0.8;
  c.fx *= 0.85;
  news(s, `Debt crisis in ${c.name}: investors flee its bonds and its currency tumbles.`, 'economy', [c.id]);
  ask(s, c, 'debtCrisis', {
    title: 'The markets have stopped lending to us',
    text: `Our debt is ${Math.round(ratio)}% of GDP and lenders want ${Math.round(c.bond * 10) / 10}% to roll it over, if they lend at all. Until we act, the economy shrinks and the currency falls.`,
    options: [
      { id: 'imf', label: 'Ask the IMF for a bailout', note: 'A loan of about 10% of GDP at low interest, if we cut the deficit to 3% within two years and don\'t raise defence spending. Austerity is unpopular.' },
      { id: 'austerity', label: 'Cut spending ourselves', note: 'Raise taxes and cut civil spending now. Painful, but no one tells us what to do; the markets may calm down.' },
      { id: 'print', label: 'Print money', note: 'The central bank buys our debt. The crisis eases at once, but inflation soars and the currency collapses.', tone: 'warn' },
      { id: 'default', label: 'Default on our debts', note: 'Half our debt is written off. Our rating goes to D, we can\'t borrow for two years, our standing falls and creditors are furious.', tone: 'danger' },
    ],
    weeks: 6,
  });
}

register('debtCrisis', {
  ai: (s, c) => (c.gov === 'autocracy' && debtRatio(c) > debtLimit(c) * 1.6 ? 'default' : c.approval < 25 ? 'print' : 'imf'),
  apply: (s, c, d, option) => {
    if (option === 'imf') return requestImf(s, c);
    if (option === 'austerity') {
      c.tax = Math.round((c.tax + 3) * 10) / 10;
      for (const k of ['infra', 'edu', 'health', 'welfare', 'research']) c.spend[k] = Math.round(c.spend[k] * 0.88 * 10) / 10;
      c.bond = Math.max(4, c.bond - 1.5);
      c.approval = Math.max(0, c.approval - 4);
      news(s, `${c.name} announces deep spending cuts and tax rises to calm the markets.`, 'economy', [c.id]);
    }
    if (option === 'print') {
      c.treasury += c.gdp * 0.04;
      c.bond = Math.max(4, c.bond - 2.5);
      c.fx *= 0.75;
      c.fxAdj -= 0.25;
      s.modifiers.push({ id: nextId(s, 'm'), cid: c.id, kind: 'infl', value: 9, until: s.week + 52 });
      c.debtCrisis = null;
      news(s, `${c.name}'s central bank starts printing money to buy government debt. Its currency plunges.`, 'economy', [c.id]);
    }
    if (option === 'default') defaultOnDebt(s, c);
    return null;
  },
});

function defaultOnDebt(s, c) {
  c.debt *= 0.5;
  c.defaulted = { since: s.week, until: s.week + 104 };
  c.rating = 'D';
  c.debtCrisis = null;
  c.bond = 20;
  c.stocks *= 0.65;
  c.fx *= 0.7;
  c.rep = Math.max(0, c.rep - 12);
  // Loans from other countries are written off too, and the lenders don't forget
  for (const t of s.treaties) {
    if (t.kind !== 'loan' || t.b !== c.id) continue;
    t.until = s.week;
    const lender = s.countries[t.a];
    if (lender) {
      lender.treasury -= t.payment * 26;
      alert(s, lender.id, `${c.name} has defaulted: our loan to it is lost.`, 'bad');
    }
  }
  for (const o of Object.values(s.countries)) if (o.id !== c.id && o.gdp > 1000) s.rel[o.id < c.id ? `${o.id}|${c.id}` : `${c.id}|${o.id}`] = (s.rel[o.id < c.id ? `${o.id}|${c.id}` : `${c.id}|${o.id}`] ?? 0) - 8;
  news(s, `${c.name} defaults on its debts. Its currency and stock market crash; it is shut out of the markets.`, 'economy', [c.id]);
}

/* ---------- The IMF ---------- */

export function requestImf(s, c) {
  if (c.imf) return 'We are already in an IMF programme.';
  if (c.defaulted) return 'The IMF won\'t lend to a country in default.';
  if (investmentGrade(c.rating) && !c.debtCrisis) return 'Only countries in trouble can borrow from the IMF (a rating of BB or below, or a debt crisis).';
  const sanctioners = Object.keys(s.sanctions).filter((k) => s.sanctions[k] && k.endsWith(`>${c.id}`)).map((k) => s.countries[k.split('>')[0]]).filter((x) => x && x.gdp > 1500);
  if (sanctioners.length >= 2 || c.rep < 15) return 'The IMF\'s biggest shareholders won\'t lend to a country they sanction or shun.';
  const loan = Math.max(c.gdp * 0.1, -c.treasury);
  c.treasury += loan;
  c.debt += loan;
  c.imf = { since: s.week, until: s.week + IMF_WEEKS, loan, target: 3, defence: c.spend.defence, warnings: 0, startDeficit: c.deficit ?? 0 };
  c.debtCrisis = null;
  c.bond = Math.min(c.bond, 6);
  c.approval = Math.max(0, c.approval - 3);
  news(s, `The IMF lends ${nameOf(s, c.id)} ${money(loan)}, on condition it cuts its deficit.`, 'economy', [c.id]);
  alert(s, c.id, `The IMF lent us ${money(loan)}. Conditions: bring the deficit down to 3% of GDP within two years, and don't raise defence spending above ${c.spend.defence}% of GDP.`, 'info');
  return null;
}

function imf(s, c) {
  const p = c.imf;
  if (!p) return;
  // Austerity is unpopular while it lasts
  c.fin.approval -= 2;
  const elapsed = s.week - p.since;
  // The deficit has to come down steadily: checked every quarter
  if (elapsed > 0 && elapsed % 13 === 0) {
    const path = p.startDeficit + (p.target - p.startDeficit) * Math.min(1, elapsed / IMF_WEEKS);
    const broken = (c.deficit ?? 0) > path + 1.5 || c.spend.defence > p.defence + 0.3;
    if (broken) {
      p.warnings++;
      if (p.warnings >= 2) {
        c.imf = null;
        c.debtCrisis = { since: s.week };
        c.bond += 3;
        news(s, `The IMF suspends its programme for ${c.name}, which broke its conditions.`, 'economy', [c.id]);
        alert(s, c.id, 'The IMF has suspended our programme: we broke its conditions. The markets have turned on us again.', 'bad');
        return;
      }
      alert(s, c.id, `IMF warning: our deficit (${Math.round(c.deficit * 10) / 10}% of GDP) should be under ${Math.round(path * 10) / 10}% by now${c.spend.defence > p.defence + 0.3 ? ', and defence spending must come back down' : ''}. One more and the programme is suspended.`, 'warn');
    }
  }
  if (s.week >= p.until) {
    c.imf = null;
    c.imfDone = s.week;
    c.ratingScore += 6;
    news(s, `${c.name} completes its IMF programme.`, 'economy', [c.id]);
    alert(s, c.id, 'We have completed the IMF programme. The conditions are lifted and our rating improves.', 'good');
  }
}

/* ---------- What a leader can do ---------- */

// Buy our own currency with reserves to hold it up (amount > 0), or sell it to push it down and add to reserves
export function intervene(s, c, amount) {
  amount = Number(amount);
  if (!Number.isFinite(amount) || !amount) return 'Choose how much to buy or sell.';
  if (amount > 0 && amount > c.treasury) return 'Not enough reserves.';
  if (Math.abs(amount) > c.gdp * 0.1) return `At most $${Math.round(c.gdp * 0.1)}B at a time.`;
  c.treasury -= amount;
  c.fxAdj += 3 * amount / Math.max(1, c.gdp);
  c.fx *= 1 + 1.2 * amount / Math.max(1, c.gdp);
  if (amount < 0) s.modifiers.push({ id: nextId(s, 'm'), cid: c.id, kind: 'infl', value: Math.min(6, -60 * amount / c.gdp), until: s.week + 26 });
  return null;
}

export function capitalControls(s, c, on) {
  c.controls = Boolean(on);
  if (on) {
    c.rep = Math.max(0, c.rep - 2);
    news(s, `${c.name} imposes capital controls: money can no longer leave the country freely.`, 'economy', [c.id]);
  } else news(s, `${c.name} lifts its capital controls.`, 'economy', [c.id]);
  return null;
}

/* ---------- The world's mood: crashes and booms (set by crises.js) ---------- */

export function marketShock(s, by, ids, depth) {
  initFinance(s);
  s.markets.mood = Math.max(-1, s.markets.mood - by);
  for (const [id, share] of ids) {
    const c = s.countries[id];
    if (!c) continue;
    c.stocks *= 1 - depth * share;
    c.bond += 0.8 * share * (investmentGrade(c.rating) ? 0.3 : 1);
  }
}

export function financeView(c) {
  return { fx: Math.round(c.fx ?? 100), stocks: Math.round(c.stocks ?? 100), rating: c.rating ?? null, crisis: Boolean(c.debtCrisis), imf: Boolean(c.imf), defaulted: Boolean(c.defaulted), controls: Boolean(c.controls) };
}

export function financeOwn(s, c) {
  return {
    fx: Math.round(c.fx * 10) / 10, fxRef: Math.round(c.fxRef * 10) / 10, stocks: Math.round(c.stocks * 10) / 10, stockRef: Math.round(c.stockRef * 10) / 10,
    rating: c.rating, ratingScore: Math.round(c.ratingScore), hist: c.finHist, effects: c.fin, controls: Boolean(c.controls),
    debtCrisis: c.debtCrisis ?? null, defaulted: c.defaulted ?? null, imf: c.imf ? { ...c.imf, loan: Math.round(c.imf.loan) } : null,
    mood: Math.round((s.markets?.mood ?? 0) * 100) / 100,
  };
}

/* ---------- The computer's central banks ---------- */

export function aiFinance(s, c) {
  // Defend a currency in free fall if there are reserves to do it with
  if (c.fx < c.fxRef * 0.8 && c.treasury > c.gdp * 0.05 && chance(s, 0.5)) intervene(s, c, Math.min(c.treasury * 0.3, c.gdp * 0.05));
  if (!c.controls && c.gov !== 'democracy' && c.fx < c.fxRef * 0.65) capitalControls(s, c, true);
  if (c.controls && c.fx > c.fxRef * 0.95 && chance(s, 0.2)) capitalControls(s, c, false);
  // A struggling economy heads to the IMF before it's forced to
  if (!c.imf && !c.debtCrisis && !c.defaulted && c.ratingScore < 30 && c.treasury < c.gdp * 0.01 && chance(s, 0.3)) requestImf(s, c);
  // In an IMF programme, keep to the conditions
  if (c.imf && (c.deficit ?? 0) > 3) {
    c.tax = Math.round((c.tax + 0.3) * 10) / 10;
    if (c.spend.defence > c.imf.defence) c.spend.defence = c.imf.defence;
  }
}

export { atWar };
