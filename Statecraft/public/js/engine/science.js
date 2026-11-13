// Research projects and weapon ranges. Better technology is bought with money and time: a leader funds a
// project, scientists work on it for months, and the most advanced ones need semiconductors or uranium a
// country may have to import. A licence from a country further ahead is faster. Aircraft and missiles can only
// reach so far from their bases; longer range is another programme to pay for.

import { GEO } from './data/geo.js';
import { TECH_FIELDS } from './data/world.js';
import { REGION_NAMES } from './names.js';
import { clamp, alert, news, nameOf, alive, allied, atWar, hasAccess, rel, addRel, money, sanctioning } from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;
const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);

/* ---------- Research projects ---------- */

export const MAX_TECH = 12;
export const projectCost = (c, level) => 0.9 * Math.pow(1.5, level) * costFactor(c);
export const projectWeeks = (level) => 20 + level * 4;
export const maxResearch = (c) => clamp(1 + Math.floor(c.gdp / 2500), 1, 3);

// What an advanced project needs that a country may have to buy abroad
export function projectNeeds(c, field, level) {
  if (['air', 'missile', 'cyber', 'naval'].includes(field) && level >= 8) return 'chip';
  if (field === 'industry' && level >= 9) return 'chip';
  if (field === 'nuclear' && level >= 6) return 'uran';
  return null;
}

// Research speed: the research budget and education make scientists faster
export function researchSpeed(c) {
  return clamp(0.6 + c.spend.research * 0.25 + 0.04 * (c.spend.edu - c.base.spend.edu), 0.5, 2.5);
}

export function startResearch(s, c, field) {
  c.research ??= [];
  if (!TECH_FIELDS[field]) return 'Pick a field.';
  if (c.tech[field] >= MAX_TECH) return 'That field is as advanced as it gets.';
  if (c.research.some((p) => p.field === field)) return 'A project in that field is already under way.';
  if (c.research.length >= maxResearch(c)) return `Your scientists can run ${maxResearch(c)} project${maxResearch(c) > 1 ? 's' : ''} at once.`;
  const level = c.tech[field] + 1;
  const cost = projectCost(c, level);
  if (cost > c.treasury) return `That programme costs ${money(cost)}; the treasury has ${money(c.treasury)}.`;
  c.treasury -= cost;
  const weeks = projectWeeks(level);
  c.research.push({ id: `rp${s.nextId++}`, field, level, left: weeks, total: weeks, cost, how: 'own' });
  return null;
}

export function cancelResearch(s, c, id) {
  c.research ??= [];
  const p = c.research.find((x) => x.id === id);
  if (!p) return 'No such project.';
  c.research = c.research.filter((x) => x !== p);
  c.treasury += p.cost * 0.4 * (p.left / p.total);
  return null;
}

// A licence: the country further ahead sells its know-how. Computer-run sellers decide straight away.
export function licenceTerms(s, buyer, seller, field) {
  const t = s.countries[seller];
  if (!t || seller === buyer.id || !alive(s, seller)) return { error: 'Pick a country.' };
  if (!TECH_FIELDS[field]) return { error: 'Pick a field.' };
  if (t.tech[field] <= buyer.tech[field]) return { error: `${t.name} is not ahead of you in ${TECH_FIELDS[field].name}.` };
  if (atWar(s, buyer.id, seller)) return { error: 'You are at war with them.' };
  if (sanctioning(s, seller, buyer.id)) return { error: `${t.name} sanctions you: no licences.` };
  const level = buyer.tech[field] + 1;
  return { level, price: projectCost(buyer, level) * 0.8, weeks: 13 };
}

export function buyLicence(s, c, seller, field) {
  c.research ??= [];
  const terms = licenceTerms(s, c, seller, field);
  if (terms.error) return terms.error;
  if (c.research.some((p) => p.field === field)) return 'A project in that field is already under way.';
  if (c.research.length >= maxResearch(c)) return `Your scientists can run ${maxResearch(c)} project${maxResearch(c) > 1 ? 's' : ''} at once.`;
  if (terms.price > c.treasury) return `The licence costs ${money(terms.price)}.`;
  const t = s.countries[seller];
  if (t.human) return 'Ask its leader directly: propose it in chat, then they can share technology from your dossier.';
  const military = ['army', 'air', 'naval', 'missile', 'nuclear', 'cyber'].includes(field);
  const willing = rel(s, c.id, seller) >= (military ? 45 : 20) || allied(s, c.id, seller);
  if (!willing) return `${t.name} won't sell ${TECH_FIELDS[field].name} technology to you. Better relations (or an alliance) would change that.`;
  c.treasury -= terms.price;
  t.treasury += terms.price;
  addRel(s, c.id, seller, 4);
  c.research.push({ id: `rp${s.nextId++}`, field, level: terms.level, left: terms.weeks, total: terms.weeks, cost: terms.price, how: 'licence', from: seller });
  alert(s, c.id, `${t.name} sold us a licence for ${TECH_FIELDS[field].name} level ${terms.level}: our engineers need ${terms.weeks} weeks to put it to use.`, 'good');
  return null;
}

export function researchTick(s, c) {
  c.research ??= [];
  for (const p of c.research) {
    const need = p.how === 'own' ? projectNeeds(c, p.field, p.level) : null;
    const short = need ? (c.short[need] ?? 0) > 0.15 || (c.stock[need] ?? 0) < (c.demand[need] ?? 0) * 0.5 : false;
    p.blocked = short ? need : null;
    if (short) continue;
    p.left -= p.how === 'own' ? researchSpeed(c) : 1;
  }
  const done = c.research.filter((p) => p.left <= 0);
  c.research = c.research.filter((p) => p.left > 0);
  for (const p of done) {
    if (c.tech[p.field] >= p.level) continue;
    c.tech[p.field] = p.level;
    c.progress[p.field] = 0;
    alert(s, c.id, `Breakthrough: ${TECH_FIELDS[p.field].name} reached level ${p.level}. ${TECH_FIELDS[p.field].note}.`, 'good');
  }
}

/* ---------- Range ---------- */

// Reach in km from the nearest base: aircraft (with tankers), conventional missiles, and nuclear delivery
const START_RANGE = {
  usa: [12000, 2500, 13000], rus: [5500, 2500, 13000], chn: [3500, 4000, 13000], gbr: [3500, 1600, 12000], fra: [3500, 1000, 11000],
  ind: [2000, 800, 5000], pak: [1200, 750, 2750], isr: [2200, 1500, 6500], irn: [900, 2000, 2000], deu: [1800, 500, 0],
  jpn: [1500, 1000, 0], kor: [1300, 800, 0], tur: [1500, 1000, 0], sau: [1600, 2500, 0], twn: [800, 1200, 0], egy: [1000, 300, 0],
  aus: [2500, 1600, 0], ita: [1800, 500, 0], esp: [1500, 500, 0], are: [1400, 300, 0], pol: [1200, 500, 0],
};
export function initRange(c) {
  if (c.range) return;
  const [air, missile, nuke] = START_RANGE[c.id] ?? [Math.min(1500, 600 + c.aircraft * 1.5), Math.min(600, 150 + c.missiles), 0];
  c.range = { air, missile, nuke };
}

export const RANGE_KINDS = {
  air: { name: 'Air force reach', max: 15000, note: 'Tanker aircraft, forward airfields and long-range bombers.' },
  missile: { name: 'Missile range', max: 13000, note: 'Longer-range cruise and ballistic missiles.' },
};
export const rangeCost = (c, kind) => (c.range[kind] / 1000) * (kind === 'air' ? 4 : 3) * costFactor(c) + 2;
export const RANGE_WEEKS = 40;

export function extendRange(s, c, kind) {
  initRange(c);
  const k = RANGE_KINDS[kind];
  if (!k) return 'Pick air force or missiles.';
  c.rangeWork ??= [];
  if (c.rangeWork.some((w) => w.kind === kind)) return 'That programme is already under way.';
  if (c.range[kind] >= k.max) return 'Range is already as long as it gets.';
  const cost = rangeCost(c, kind);
  if (cost > c.milFunds + c.treasury) return `The programme costs ${money(cost)} from the defence budget.`;
  const fromFunds = Math.min(c.milFunds, cost);
  c.milFunds -= fromFunds;
  c.treasury -= cost - fromFunds;
  c.rangeWork.push({ kind, left: RANGE_WEEKS, total: RANGE_WEEKS, cost, to: Math.min(k.max, Math.round(c.range[kind] * 1.35 + 300)) });
  return null;
}

export function rangeTick(s, c) {
  initRange(c);
  c.rangeWork ??= [];
  for (const w of c.rangeWork) w.left -= 1;
  for (const w of c.rangeWork.filter((x) => x.left <= 0)) {
    c.range[w.kind] = w.to;
    alert(s, c.id, `${RANGE_KINDS[w.kind].name} extended to ${w.to.toLocaleString('en-US')} km.`, 'good');
  }
  c.rangeWork = c.rangeWork.filter((x) => x.left > 0);
}

export function km(a, b) {
  const ga = GEO[a];
  const gb = GEO[b];
  const toRad = Math.PI / 180;
  const dLat = (gb.lat - ga.lat) * toRad;
  const dLon = (gb.lon - ga.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(ga.lat * toRad) * Math.cos(gb.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The nearest place a country can launch from: its own provinces, and allies' or access partners' bases
export function nearestBase(s, cid, target) {
  let best = { km: Infinity, base: null };
  for (const reg of Object.values(s.regions)) {
    const h = reg.ctrl;
    if (h !== cid && !allied(s, h, cid) && !hasAccess(s, cid, h)) continue;
    const d = km(reg.id, target);
    if (d < best.km) best = { km: d, base: reg.id };
  }
  return best;
}

// Why a strike can't reach a province, or null. kind: air | missile | nuke
export function rangeProblem(s, c, target, kind) {
  initRange(c);
  const reach = kind === 'nuke' ? Math.max(c.range.nuke, c.range.missile, c.range.air) : c.range[kind];
  const { km: dist, base } = nearestBase(s, c.id, target);
  if (dist <= reach) return null;
  // Carriers carry aircraft, and warships carry cruise missiles, to coastal targets
  if (GEO[target].coast && kind !== 'nuke') {
    const seaReach = c.carriers > 0 ? 20000 : 1500 + c.ships * 25;
    if (kind === 'air' && c.carriers > 0 && dist <= seaReach) return null;
    if (kind === 'missile' && c.ships >= 10 && dist <= Math.min(seaReach, reach + 1600)) return null;
  }
  const label = { air: 'Our aircraft', missile: 'Our missiles', nuke: 'Our nuclear delivery systems' }[kind];
  return `${regionName(target)} is ${Math.round(dist).toLocaleString('en-US')} km from our nearest base${base ? ` (${regionName(base)})` : ''}. ${label} reach ${Math.round(reach).toLocaleString('en-US')} km: extend range in Research, or win basing rights from an ally.`;
}

export { news };
