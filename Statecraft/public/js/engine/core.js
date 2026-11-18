// Shared helpers for the simulation: random numbers, dates, relations, wars, alliances and the news.
// The whole game state is plain JSON, so it can be sent, saved and restored as is.

export const START = Date.UTC(2027, 0, 4); // Monday 4 January 2027
export const WEEK_MS = 7 * 24 * 3600 * 1000;
export const P5 = ['usa', 'chn', 'rus', 'gbr', 'fra'];

/* ---------- Random numbers (seeded, stored in the state) ---------- */

export function rand(s) {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const chance = (s, p) => rand(s) < p;
export const pick = (s, list) => list[Math.floor(rand(s) * list.length)];
export function shuffle(s, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- Eyes abroad ---------- */

// A spy network inside a country that has settled in (four weeks after it was planted) and still has agents
export function hasNetwork(s, cid, target) {
  const n = s.countries[cid]?.spies?.[target];
  return Boolean(n && n.agents > 0 && s.week - n.since >= 4);
}
// How many spy satellites a country has in orbit
export const spySats = (s, cid) => s.countries[cid]?.space?.sats?.spy ?? 0;
// Does one of a country's spy satellites happen to be over this army or fleet? Each covers about a quarter of the
// world; four or more see everything.
export function satCovers(s, cid, id) {
  const n = spySats(s, cid);
  if (n <= 0) return false;
  if (n >= 4) return true;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 4 < n;
}

/* ---------- Dates ---------- */

export function dateOf(week) {
  return new Date(START + week * WEEK_MS);
}
export function dateLabel(week) {
  return dateOf(week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function monthLabel(week) {
  return dateOf(week).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ---------- Nations (playable countries and minor nations) ---------- */

// Minor nations are the states that break away during a game (every nation on the map at the start is a country)
export const isMinor = (id) => id?.startsWith('m-x-');
export const nation = (s, id) => s.countries[id] ?? s.minors[id];
export const nameOf = (s, id) => nation(s, id)?.name ?? id;
export const alive = (s, id) => {
  const n = nation(s, id);
  return Boolean(n) && !n.exile && !n.annexed;
};

export function nextId(s, prefix) {
  return `${prefix}${s.nextId++}`;
}

/* ---------- Relations (-100 to 100, between playable countries) ---------- */

const relKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function rel(s, a, b) {
  if (a === b) return 100;
  return s.rel[relKey(a, b)] ?? 0;
}
export function addRel(s, a, b, delta) {
  if (a === b || isMinor(a) || isMinor(b)) return;
  const k = relKey(a, b);
  s.rel[k] = clamp((s.rel[k] ?? 0) + delta, -100, 100);
}
export function setRel(s, a, b, value) {
  if (a === b) return;
  s.rel[relKey(a, b)] = clamp(value, -100, 100);
}

/* ---------- Wars ---------- */

// How badly a country's forces are short of fuel, 0 to 1: the army's own shortfall (it gets fuel before the
// civilian economy does), or half the country's general oil shortage, whichever is worse
export const fuelCut = (c) => Math.max(c?.fuelShort ?? 0, (c?.short?.oil ?? 0) * 0.4);
// Oil is traded in millions of barrels a day; held for a week that is seven million barrels
export const BARRELS = 7;

export function warBetween(s, a, b) {
  return s.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
}
export const atWar = (s, a, b) => a !== b && Boolean(warBetween(s, a, b));
// A war has to be justified before it is declared: the case takes JUSTIFY_WEEKS to prepare (about 45 seconds at
// normal speed), in secret, and once ready it stands for WAR_CASE_WEEKS.
export const JUSTIFY_WEEKS = 5;
export const WAR_CASE_WEEKS = 26;
// The game clock part-way through the week
export const nowWeeks = (s) => s.week + (s.stepped ?? 0);
// { ready, until, since } or null (a bare week number from an older save counts as a finished case)
export function warCaseOf(c, target) {
  const w = c?.warCases?.[target];
  if (w == null) return null;
  return typeof w === 'number' ? { ready: 0, until: w, since: 0 } : w;
}
// Is the case against `target` ready, so war can be declared?
export const warCaseMade = (s, c, target) => {
  const w = warCaseOf(c, target);
  return Boolean(w) && w.ready <= nowWeeks(s) + 1e-6 && w.until >= s.week;
};
// Weeks until a case being prepared is ready (0 if none is under way)
export const warCasePending = (s, c, target) => {
  const w = warCaseOf(c, target);
  return w && w.until >= s.week && w.ready > nowWeeks(s) + 1e-6 ? w.ready - nowWeeks(s) : 0;
};
// Do the people accept every war this country is in? Defensive wars and wars the leader explained to them are
// accepted; an unexplained war of choice is not.
export function warsAccepted(s, id) {
  const mine = s.wars.filter((w) => w.a === id || w.b === id);
  return mine.length > 0 && mine.every((w) => w.b === id || w.goal === 'defence' || w.justified === id);
}
export function enemiesOf(s, id) {
  const out = new Set();
  for (const w of s.wars) {
    if (w.a === id) out.add(w.b);
    if (w.b === id) out.add(w.a);
  }
  return out;
}

/* ---------- Alliances and treaties ---------- */

export function alliancesOf(s, id, kind) {
  return Object.values(s.alliances).filter((al) => al.members.includes(id) && (!kind || al.kind === kind));
}
export function allied(s, a, b) {
  if (a === b) return true;
  return Object.values(s.alliances).some((al) => al.kind === 'military' && al.members.includes(a) && al.members.includes(b));
}
export function treaty(s, kind, a, b) {
  return s.treaties.find((t) => t.kind === kind && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}
export function hasAccess(s, mover, host) {
  return s.treaties.some((t) => t.kind === 'access' && ((t.a === mover && t.b === host) || (t.a === host && t.b === mover)));
}
export const sanctioning = (s, a, b) => Boolean(s.sanctions[`${a}>${b}`]);

// Land a country's troops may enter without fighting: its own, an ally's, a puppet's or one that gave access
export function friendlyGround(s, mover, holder) {
  if (mover === holder) return true;
  if (atWar(s, mover, holder)) return false;
  if (allied(s, mover, holder) || hasAccess(s, mover, holder)) return true;
  const m = s.minors[holder];
  return Boolean(m && m.puppetOf === mover);
}

// Co-belligerents fighting the same enemy (or allies) can share each other's ground and supply
export function onSameSide(s, a, b) {
  if (a === b) return true;
  if (allied(s, a, b)) return true;
  const ea = enemiesOf(s, a);
  for (const e of enemiesOf(s, b)) if (ea.has(e)) return true;
  return false;
}

/* ---------- News (public) and alerts (to one country) ---------- */

const ROUTINE = new Set(['election', 'incident']);
export function news(s, text, kind = 'info', about = []) {
  if (ROUTINE.has(kind) && about.length && about.every((id) => s.countries[id]?.minor)) return;
  s.news.push({ id: s.nextId++, w: s.week, text, kind, about });
  if (s.news.length > 300) s.news.splice(0, s.news.length - 300);
  s.fresh.push({ type: 'news', w: s.week, text, kind, about });
}

export function alert(s, cid, text, kind = 'info', extra = {}) {
  const c = s.countries[cid];
  if (!c) return;
  const item = { id: s.nextId++, w: s.week, text, kind, ...extra };
  c.inbox.push(item);
  if (c.inbox.length > 120) c.inbox.splice(0, c.inbox.length - 120);
  s.fresh.push({ type: 'alert', to: cid, ...item });
}

/* ---------- Formatting used in news text ---------- */

export function money(b) {
  if (Math.abs(b) >= 1000) return `$${(b / 1000).toFixed(b >= 10000 ? 1 : 2)} trillion`;
  if (Math.abs(b) >= 1) return `$${b.toFixed(b >= 100 ? 0 : 1)} billion`;
  return `$${Math.round(b * 1000)} million`;
}
export function troopsLabel(k) {
  return k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${Math.round(k)}K`;
}
