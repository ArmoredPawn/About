// Oil and gas politics: the producers' cartel, embargoes, strategic reserves and pipelines.
//
// The cartel (OPEC+ at the start) agrees a production cut that its chair sets: fewer barrels, higher prices.
// Each member decides whether to keep to it or quietly pump more and pocket the difference, and cheats get
// caught. The chair can also embargo a country, as in 1973, cutting it off from the cartel's oil.
// Pipelines carry oil and gas past blockades, closed straits and embargoes: a buyer gets that share of its
// fuel whatever happens at sea, unless the seller shuts the pipe, a war cuts it, or someone blows it up.
// Bypass pipelines let an exporter reach the open sea without passing a strait (Saudi Arabia's Petroline).

import { CARTEL_START, CUTS, PIPELINES, PIPELINE_PROJECTS } from './data/energy.js';
import { REGION_NAMES } from './names.js';
import { clamp, chance, news, alert, nameOf, alive, atWar, addRel, money, isMinor } from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;
export { CUTS };

/* ---------- Setting up ---------- */

export function initEnergy(s) {
  // Only once: a cartel that later collapses stays gone (null) until someone founds a new one
  if (!('cartel' in s)) {
    s.cartel = { name: CARTEL_START.name, members: CARTEL_START.members.filter((id) => s.countries[id] || s.minors[id]), chair: 'sau', cut: CARTEL_START.cut, embargo: [], founded: 0, expelled: {}, share: 0.5 };
  }
  if (!s.pipelines) {
    s.pipelines = PIPELINES.map((p) => ({ id: p.id, status: p.shut ? 'shut' : 'open', until: null, left: 0 }));
  }
}

const DEFS = Object.fromEntries([...PIPELINES, ...PIPELINE_PROJECTS].map((p) => [p.id, p]));
export const pipelineDef = (id) => DEFS[id];

const isMember = (s, id) => Boolean(s.cartel?.members.includes(id));
const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);

// Oil a nation pumps from the fields it holds, before any cut
function oilOutput(s, id) {
  let total = 0;
  for (const reg of Object.values(s.regions)) if (reg.ctrl === id && reg.res.oil) total += reg.res.oil[0] * (1 - reg.dmg);
  return total;
}

// The world's oil output, and each producer's share (the threshold to join is 1.5%)
function oilShares(s) {
  const out = new Map();
  let total = 0;
  for (const id of [...Object.keys(s.countries), ...Object.keys(s.minors)]) {
    if (!alive(s, id)) continue;
    const p = oilOutput(s, id);
    if (p > 0) { out.set(id, p); total += p; }
  }
  for (const [k, v] of out) out.set(k, v / (total || 1));
  return out;
}

/* ---------- What the cartel does to the market ---------- */

// Multiplier on a producer's oil output: members keeping to the cut pump less, cheats pump a little more
export function cartelOutput(s, id) {
  const ct = s.cartel;
  if (!ct || !ct.members.includes(id)) return 1;
  if (s.countries[id]?.cartelCheat) return 1.03;
  return 1 - ct.cut / 100;
}

// How much of a country's oil imports are cut by a cartel embargo
export function embargoCut(s, id) {
  const ct = s.cartel;
  if (!ct?.embargo.includes(id)) return 0;
  return 0.7 * clamp(ct.share ?? 0.5, 0, 1);
}

/* ---------- Pipelines in the market ---------- */

// Is this pipeline carrying fuel to this buyer right now?
export function pipelineFlows(s, p, buyer) {
  const def = DEFS[p.id];
  if (p.status !== 'open' || !alive(s, def.seller)) return false;
  // The seller must still hold the start, and no one at war with either end can sit on the route
  if (s.regions[def.from]?.ctrl !== def.seller && !(isMinor(def.seller) && s.regions[def.from]?.ctrl === def.from)) return false;
  const ends = [def.seller, buyer].filter(Boolean);
  for (const r of [...(def.via ?? []), def.to]) {
    const ctrl = s.regions[r]?.ctrl;
    if (ctrl && ends.some((e) => atWar(s, ctrl, e))) return false;
  }
  if (buyer) {
    if (atWar(s, def.seller, buyer)) return false;
    // A cartel member keeps the embargo even on its pipelines
    if (isMember(s, def.seller) && s.cartel.embargo.includes(buyer)) return false;
  }
  return true;
}

// Share of a buyer's need for a fuel that arrives by pipeline, whatever happens at sea
export function pipelineShare(s, buyer, res) {
  let share = 0;
  for (const p of s.pipelines ?? []) {
    const def = DEFS[p.id];
    if (def.res !== res || !def.buyers?.includes(buyer)) continue;
    if (pipelineFlows(s, p, buyer)) share += def.share;
  }
  return Math.min(0.8, share);
}

// Share of an exporter's oil that can get round a closed strait through a bypass pipeline
export function bypassShare(s, seller, strait) {
  let share = 0;
  for (const p of s.pipelines ?? []) {
    const def = DEFS[p.id];
    if (def.bypass !== strait || def.seller !== seller) continue;
    if (pipelineFlows(s, p, null)) share += def.share;
  }
  return Math.min(0.9, share);
}

/* ---------- Orders: the cartel ---------- */

export function cartelJoin(s, c) {
  const ct = s.cartel;
  if (!ct) return 'There is no cartel. Found one.';
  if (ct.members.includes(c.id)) return `You are already in ${ct.name}.`;
  if ((ct.expelled[c.id] ?? -1) > s.week) return `${ct.name} expelled you. It won't take you back until ${Math.floor(ct.expelled[c.id] / 52) + 2027}.`;
  const share = oilShares(s).get(c.id) ?? 0;
  if (share < 0.015) return `Only countries producing at least 1.5% of the world's oil can join (you produce ${(share * 100).toFixed(1)}%).`;
  ct.members.push(c.id);
  c.cartelCheat = false;
  news(s, `${c.name} joins ${ct.name}.`, 'economy', [c.id]);
  pickChair(s);
  return null;
}

export function cartelLeave(s, c) {
  const ct = s.cartel;
  if (!ct?.members.includes(c.id)) return 'You are not a member.';
  ct.members = ct.members.filter((m) => m !== c.id);
  c.cartelCheat = false;
  news(s, `${c.name} leaves ${ct.name} to pump as much oil as it likes.`, 'economy', [c.id]);
  if (!ct.members.some((m) => s.countries[m])) dissolve(s);
  else pickChair(s);
  return null;
}

export function cartelFound(s, c, { name }) {
  if (s.cartel) return `${s.cartel.name} already exists. Join it instead.`;
  const share = oilShares(s).get(c.id) ?? 0;
  if (share < 0.03) return 'Only a major producer (3% of the world\'s oil) can found a cartel.';
  const clean = String(name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 24) || 'The Producers\' Cartel';
  s.cartel = { name: clean, members: [c.id], chair: c.id, cut: 0, embargo: [], founded: s.week, expelled: {}, share };
  news(s, `${c.name} founds a new oil cartel: ${clean}. Producers are invited to join.`, 'economy', [c.id]);
  return null;
}

function dissolve(s) {
  news(s, `${s.cartel.name} has collapsed: no major producer is left in it.`, 'economy');
  s.cartel = null;
}

function pickChair(s) {
  const ct = s.cartel;
  if (!ct) return;
  const shares = oilShares(s);
  const best = ct.members.filter((m) => s.countries[m] && alive(s, m)).sort((a, b) => (shares.get(b) ?? 0) - (shares.get(a) ?? 0))[0];
  if (best && best !== ct.chair) {
    const was = ct.chair;
    ct.chair = best;
    if (was) news(s, `${nameOf(s, best)} now leads ${ct.name}.`, 'economy', [best]);
  }
}

const chairOnly = (s, c) => (!s.cartel ? 'There is no cartel.' : s.cartel.chair !== c.id ? `Only ${nameOf(s, s.cartel.chair)}, which leads ${s.cartel.name}, sets that.` : null);

export function setCut(s, c, { cut }) {
  const err = chairOnly(s, c);
  if (err) return err;
  cut = Number(cut);
  if (!CUTS.includes(cut)) return 'Pick a cut.';
  const was = s.cartel.cut;
  s.cartel.cut = cut;
  if (cut !== was) news(s, cut > was ? `${s.cartel.name} cuts oil output by ${cut}%. Prices jump.` : cut ? `${s.cartel.name} eases its cut to ${cut}%.` : `${s.cartel.name} ends its production cut.`, 'economy', [c.id]);
  return null;
}

export function setEmbargo(s, c, { target, on }) {
  const err = chairOnly(s, c);
  if (err) return err;
  const t = s.countries[target];
  if (!t || target === c.id || isMember(s, target)) return 'Pick a country outside the cartel.';
  const ct = s.cartel;
  if (on && !ct.embargo.includes(target)) {
    ct.embargo.push(target);
    news(s, `${ct.name} imposes an oil embargo on ${t.name}.`, 'economy', [c.id, target]);
    alert(s, target, `${ct.name} has embargoed our oil supply. Imports will fall sharply: release reserves, ration fuel, or find other sellers.`, 'bad');
    for (const m of ct.members) if (s.countries[m]) addRel(s, m, target, -10);
  } else if (!on && ct.embargo.includes(target)) {
    ct.embargo = ct.embargo.filter((x) => x !== target);
    news(s, `${ct.name} lifts its oil embargo on ${t.name}.`, 'economy', [c.id, target]);
  }
  return null;
}

export function setCheat(s, c, { on }) {
  if (!isMember(s, c.id)) return 'You are not in the cartel.';
  if (s.cartel.chair === c.id && on) return 'The chair can\'t cheat on its own cut: change the cut instead.';
  c.cartelCheat = Boolean(on);
  return null;
}

export function expel(s, c, { target }) {
  const err = chairOnly(s, c);
  if (err) return err;
  if (!isMember(s, target) || target === c.id) return 'Pick a member to expel.';
  s.cartel.members = s.cartel.members.filter((m) => m !== target);
  s.cartel.expelled[target] = s.week + 104;
  if (s.countries[target]) s.countries[target].cartelCheat = false;
  addRel(s, c.id, target, -20);
  news(s, `${s.cartel.name} expels ${nameOf(s, target)} for breaking its quota.`, 'economy', [c.id, target]);
  return null;
}

/* ---------- Orders: reserves and pipelines ---------- */

// Selling off part of the strategic reserve over eight weeks: more supply on the market, lower prices
export function releaseReserve(s, c, { res = 'oil', share = 0.25 }) {
  if (!['oil', 'gas'].includes(res)) return 'Only oil and gas reserves can be released.';
  share = clamp(Number(share) || 0, 0.05, 0.75);
  if ((c.cooldown.release ?? -1) > s.week) return `The last release is still under way for ${c.cooldown.release - s.week} more weeks.`;
  const qty = (c.stock[res] ?? 0) * share;
  if (qty <= 0.01) return 'There is almost nothing in the reserve.';
  c.releasing ??= {};
  c.releasing[res] = (c.releasing[res] ?? 0) + qty;
  c.cooldown.release = s.week + 8;
  news(s, `${c.name} releases ${Math.round(share * 100)}% of its strategic ${res} reserve onto the market.`, 'economy', [c.id]);
  return null;
}

export function setPipeline(s, c, { id, shut }) {
  const p = (s.pipelines ?? []).find((x) => x.id === id);
  const def = DEFS[id];
  if (!p || !def) return 'No such pipeline.';
  if (s.regions[def.from]?.ctrl !== c.id) return `Only whoever holds ${regionName(def.from)} can open or close it.`;
  if (p.status === 'sabotaged' || p.status === 'building') return `The pipeline is ${p.status === 'building' ? 'still being built' : 'wrecked and under repair'}.`;
  p.status = shut ? 'shut' : 'open';
  news(s, shut ? `${c.name} shuts the ${def.name} pipeline.` : `${c.name} reopens the ${def.name} pipeline.`, 'economy', [c.id, ...(def.buyers ?? []).filter((b) => s.countries[b])]);
  if (shut) for (const b of def.buyers ?? []) { if (s.countries[b]) { addRel(s, c.id, b, -12); alert(s, b, `${c.name} has cut off the ${def.name} pipeline. We will have to buy that ${def.res} elsewhere.`, 'bad'); } }
  return null;
}

export const SABOTAGE_COST = 3;
export function sabotagePipeline(s, c, { id }) {
  const p = (s.pipelines ?? []).find((x) => x.id === id);
  const def = DEFS[id];
  if (!p || !def || p.status === 'building') return 'No such pipeline.';
  if (p.status === 'sabotaged') return 'It is already out of action.';
  if (def.seller === c.id || def.buyers?.includes(c.id)) return 'That is our own supply.';
  const cost = SABOTAGE_COST * costFactor(c);
  if (c.treasury < cost) return `The operation costs ${money(cost)}.`;
  c.treasury -= cost;
  const seller = s.countries[def.seller];
  const ci = seller?.counterIntel ?? 1;
  const works = chance(s, clamp(0.75 + 0.03 * ((c.tech.cyber ?? 5) - (seller?.tech.cyber ?? 5)) - 0.05 * ci, 0.3, 0.9));
  const caught = chance(s, clamp(0.25 + 0.06 * ci - (works ? 0 : -0.15), 0.1, 0.7));
  if (works) {
    p.status = 'sabotaged';
    p.until = s.week + 30;
    news(s, `Explosions rip through the ${def.name} pipeline. It will be out of action for months.`, 'incident', [def.seller, ...(def.buyers ?? [])]);
  } else alert(s, c.id, `The operation against the ${def.name} pipeline failed.`, 'warn');
  if (caught) {
    news(s, `Investigators blame ${c.name} for the ${works ? 'attack on' : 'plot against'} the ${def.name} pipeline.`, 'incident', [c.id, def.seller]);
    for (const x of [def.seller, ...(def.buyers ?? [])]) if (s.countries[x]) addRel(s, c.id, x, x === def.seller ? -35 : -15);
    c.rep = Math.max(0, c.rep - 6);
  } else if (works) alert(s, c.id, `The ${def.name} pipeline is wrecked, and no one can prove it was us.`, 'good');
  return null;
}

// Fund one of the planned pipelines. The seller or a buyer can build it, if they are on good terms.
export function buildPipeline(s, c, { id }) {
  const def = PIPELINE_PROJECTS.find((x) => x.id === id);
  if (!def) return 'No such project.';
  if ((s.pipelines ?? []).some((p) => p.id === id)) return 'It is already built or being built.';
  const parties = [def.seller, ...(def.buyers ?? [])];
  if (!parties.includes(c.id)) return `Only ${parties.map((x) => nameOf(s, x)).join(', ')} can build it.`;
  for (const x of parties) {
    if (x === c.id || !s.countries[x]) continue;
    const r = s.rel[x < c.id ? `${x}|${c.id}` : `${c.id}|${x}`] ?? 0;
    if (atWar(s, x, c.id) || r < 10) return `${nameOf(s, x)} won't take part: relations are too poor.`;
  }
  if (s.regions[def.from]?.ctrl !== def.seller) return `${nameOf(s, def.seller)} no longer holds ${regionName(def.from)}.`;
  const cost = def.cost * costFactor(c);
  if (c.treasury < cost) return `It costs ${money(cost)}.`;
  c.treasury -= cost;
  s.pipelines.push({ id, status: 'building', until: null, left: def.weeks, by: c.id });
  news(s, `${c.name} begins building the ${def.name} pipeline (${money(cost)}).`, 'economy', parties.filter((x) => s.countries[x]));
  for (const x of parties) if (x !== c.id && s.countries[x]) addRel(s, c.id, x, 8);
  return null;
}

/* ---------- Once a week ---------- */

export function energyTick(s) {
  initEnergy(s);
  const ct = s.cartel;
  if (ct) {
    ct.members = ct.members.filter((m) => alive(s, m));
    ct.embargo = ct.embargo.filter((t) => alive(s, t) && !isMember(s, t));
    if (!ct.members.some((m) => s.countries[m])) dissolve(s);
    else {
      if (!ct.members.includes(ct.chair) || !alive(s, ct.chair)) pickChair(s);
      const shares = oilShares(s);
      ct.share = ct.members.reduce((t, m) => t + (shares.get(m) ?? 0), 0);
      // Cheats get found out
      for (const m of ct.members) {
        const c = s.countries[m];
        if (!c?.cartelCheat || !chance(s, 0.03)) continue;
        c.cartelCaught = (c.cartelCaught ?? 0) + 1;
        news(s, `Tanker data shows ${c.name} pumping far above its ${ct.name} quota.`, 'economy', [m, ct.chair]);
        addRel(s, ct.chair, m, -15);
        alert(s, ct.chair, `${c.name} has been caught breaking ${ct.name}'s quota. As leader you can expel it (Market → Oil & pipelines).`, 'warn');
        alert(s, m, `We have been caught pumping above our ${ct.name} quota. ${nameOf(s, ct.chair)} is angry.`, 'warn');
      }
    }
  }
  for (const p of s.pipelines) {
    if (p.status === 'sabotaged' && p.until <= s.week) {
      p.status = 'open';
      p.until = null;
      news(s, `The ${DEFS[p.id].name} pipeline is repaired and flowing again.`, 'economy', [DEFS[p.id].seller]);
    }
    if (p.status === 'building' && --p.left <= 0) {
      p.status = 'open';
      news(s, `The ${DEFS[p.id].name} pipeline opens.`, 'economy', [DEFS[p.id].seller, ...(DEFS[p.id].buyers ?? [])]);
    }
  }
}

/* ---------- Computer-run countries ---------- */

export function aiEnergy(s, c) {
  const ct = s.cartel;
  const price = s.market.price.oil;
  if (ct?.chair === c.id) {
    // Defend a price band
    const i = CUTS.indexOf(ct.cut);
    if (price < 0.9 && i < CUTS.length - 1) setCut(s, c, { cut: CUTS[i + 1] });
    else if (price > 1.35 && i > 0) setCut(s, c, { cut: CUTS[i - 1] });
    // Embargo anyone waging war on a member, as in 1973; lift it when the war ends
    const hostile = new Set(s.wars.filter((w) => ct.members.includes(w.b) && s.countries[w.a]).map((w) => w.a));
    for (const t of hostile) if (!ct.embargo.includes(t) && !isMember(s, t)) setEmbargo(s, c, { target: t, on: true });
    for (const t of [...ct.embargo]) if (!hostile.has(t)) setEmbargo(s, c, { target: t, on: false });
    // Repeat cheats are thrown out
    for (const m of [...ct.members]) if ((s.countries[m]?.cartelCaught ?? 0) >= 2 && s.countries[m]?.cartelCheat) expel(s, c, { target: m });
  } else if (ct && isMember(s, c.id)) {
    const broke = c.treasury < 0 || c.debt / Math.max(1, c.gdp) > 1;
    const sour = (s.rel[c.id < ct.chair ? `${c.id}|${ct.chair}` : `${ct.chair}|${c.id}`] ?? 0) < -20;
    if (!c.cartelCheat && (broke || sour) && ct.cut >= 10 && chance(s, 0.25) && !c.cartelCaught) setCheat(s, c, { on: true });
    else if (c.cartelCheat && (c.cartelCaught ?? 0) >= 1) setCheat(s, c, { on: false });
  } else if (ct && price < 0.85 && chance(s, 0.03)) cartelJoin(s, c);
  // In a world price shock, importers with full tanks put some of their reserve on the market to bring prices
  // down (as the IEA does). An embargoed country keeps its reserve: it is already drawn on to cover the gap.
  const weeksLeft = (c.stock.oil ?? 0) / Math.max(0.001, c.demand?.oil ?? 0);
  const embargoed = Boolean(ct?.embargo.includes(c.id));
  if (price > 1.8 && !embargoed && (c.net?.oil ?? 0) < 0 && !(c.cooldown.release > s.week) && weeksLeft > 6) releaseReserve(s, c, { res: 'oil', share: 0.25 });
  // Ration fuel when it runs short or an embargo is draining the reserve (unpopular, so only while it lasts)
  const short = Math.max(c.short?.oil ?? 0, c.short?.gas ?? 0);
  if (!c.ration && (short > 0.12 || (embargoed && weeksLeft < 5))) c.ration = true;
  else if (c.ration && short < 0.02 && weeksLeft > 4) c.ration = false;
}

/* ---------- What each leader sees ---------- */

export function energyView(s, cid) {
  const ct = s.cartel;
  return {
    cartel: ct ? { name: ct.name, members: ct.members, chair: ct.chair, cut: ct.cut, embargo: ct.embargo, share: Math.round((ct.share ?? 0) * 1000) / 10, expelledUntil: ct.expelled?.[cid] ?? null } : null,
    pipelines: (s.pipelines ?? []).map((p) => ({ id: p.id, status: p.status, until: p.until, left: p.left, by: p.by ?? null, flowing: p.status === 'open' && pipelineFlows(s, p, null) })),
  };
}
