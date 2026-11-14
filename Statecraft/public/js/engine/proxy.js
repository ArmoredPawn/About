// Proxy wars: arming and funding someone else's war without fighting it ourselves. A country can send weapons,
// money or volunteers to a nation at war, or to the rebels in an uprising in another country. Done openly it
// angers the side being fought. Done covertly it costs more and stays hidden, until the other side's
// counter-intelligence finds it out, which is worse.

import { REGION_NAMES } from './names.js';
import { chance, news, alert, nameOf, nation, alive, atWar, enemiesOf, addRel, nextId, troopsLabel } from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;

export const AID_KINDS = {
  weapons: { name: 'Weapons', note: 'Tanks, aircraft and missiles from our own stocks, every week.' },
  money: { name: 'Money', note: 'Cash for their war chest, every week.' },
  volunteers: { name: 'Volunteers', note: 'Our soldiers fight for them, "on leave" from our army. They come home when the programme ends.' },
};
// Per week, by size (small, medium, large)
export const AID_SIZES = [
  { name: 'Small', tanks: 5, aircraft: 1, missiles: 0, money: 0.1, troops: 5 },
  { name: 'Medium', tanks: 15, aircraft: 3, missiles: 5, money: 0.35, troops: 15 },
  { name: 'Large', tanks: 40, aircraft: 8, missiles: 15, money: 1, troops: 40 },
];
export const COVERT_COST = 1.3; // hiding where the help comes from costs extra

// Whom a programme helps against: the recipient's enemies, or the ruler of a province in revolt
export function victimsOf(s, p) {
  if (p.rebels) return [s.regions[p.rebels]?.ctrl].filter(Boolean);
  return [...enemiesOf(s, p.to)];
}

const recipientName = (s, p) => (p.rebels ? `the rebels in ${regionName(p.rebels)}` : nameOf(s, p.to));

// Why this programme can't start, or null
export function aidProblem(s, c, { to, rebels, kind, size }) {
  if (!AID_KINDS[kind]) return 'Pick what to send.';
  if (!AID_SIZES[size]) return 'Pick how much.';
  if (rebels) {
    const reg = s.regions[rebels];
    if (!reg?.revolt) return 'There is no uprising there.';
    if (reg.ctrl === c.id) return 'Those rebels are fighting us.';
  } else {
    const t = nation(s, to);
    if (!t || to === c.id || !alive(s, to)) return 'Pick a nation at war.';
    if (!enemiesOf(s, to).size) return `${nameOf(s, to)} is not at war.`;
    if (atWar(s, c.id, to)) return `We are at war with ${nameOf(s, to)}.`;
  }
  const mine = (s.aid ?? []).filter((p) => p.from === c.id);
  if (mine.length >= 6) return 'We run at most six programmes at once. End one first.';
  if (mine.some((p) => (rebels ? p.rebels === rebels : p.to === to && !p.rebels) && p.kind === kind)) return 'We already send that. End the programme to change it.';
  if (kind === 'volunteers' && c.troops - AID_SIZES[size].troops < 20) return 'We can\'t spare that many soldiers.';
  return null;
}

export function startAid(s, c, { to = null, rebels = null, kind, size = 0, covert = false }) {
  size = Number(size);
  const err = aidProblem(s, c, { to, rebels, kind, size });
  if (err) return err;
  s.aid ??= [];
  const p = { id: nextId(s, 'aid'), from: c.id, to: rebels ? null : to, rebels: rebels || null, kind, size, covert: Boolean(covert), since: s.week, exposed: false, sent: { tanks: 0, aircraft: 0, missiles: 0, money: 0 }, troops: 0 };
  if (kind === 'volunteers') {
    const n = AID_SIZES[size].troops;
    c.troops -= n;
    p.troops = n;
    if (rebels) s.regions[rebels].revolt.rebels += n;
    else nation(s, to).troops += n;
  }
  s.aid.push(p);
  if (!p.covert) {
    publicise(s, p, false);
  } else {
    alert(s, c.id, `Our covert programme for ${recipientName(s, p)} is running. Their enemies' counter-intelligence may find it out.`, 'info');
  }
  if (!rebels && s.countries[to]) alert(s, to, `${c.name} is sending us ${AID_KINDS[kind].name.toLowerCase()}${p.covert ? ', quietly' : ''}.`, 'good');
  return null;
}

// The world learns of it: openly announced, or exposed
function publicise(s, p, exposed) {
  const c = s.countries[p.from];
  const what = AID_KINDS[p.kind].name.toLowerCase();
  const victims = victimsOf(s, p);
  if (exposed) {
    news(s, `Exposed: ${c.name} has been secretly sending ${what} to ${recipientName(s, p)}.`, 'war', [p.from, ...victims, ...(p.to ? [p.to] : [])]);
    for (const v of victims) {
      addRel(s, p.from, v, -30);
      alert(s, v, `Our intelligence has exposed ${c.name}'s secret ${what} for ${recipientName(s, p)}.`, 'war', p.rebels ? { region: p.rebels } : {});
    }
    c.rep = Math.max(0, c.rep - 5);
    alert(s, p.from, `Our covert programme for ${recipientName(s, p)} has been exposed. ${victims.map((v) => nameOf(s, v)).join(' and ')} ${victims.length > 1 ? 'are' : 'is'} furious.`, 'bad');
  } else {
    news(s, `${c.name} sends ${what} to ${recipientName(s, p)}.`, 'war', [p.from, ...victims, ...(p.to ? [p.to] : [])]);
    for (const v of victims) {
      addRel(s, p.from, v, -15);
      alert(s, v, `${c.name} is openly sending ${what} to ${recipientName(s, p)}.`, 'war', p.rebels ? { region: p.rebels } : {});
    }
    // Helping the victim of an invasion is admired; arming rebels against a government is not
    if (p.rebels) c.rep = Math.max(0, c.rep - 3);
    else if (s.wars.some((w) => w.b === p.to && w.goal !== 'defence')) c.rep = Math.min(100, c.rep + 2);
  }
  p.exposed = exposed;
  p.covert = false;
}

export function stopAid(s, c, { id }) {
  const p = (s.aid ?? []).find((x) => x.id === id && x.from === c.id);
  if (!p) return 'No such programme.';
  end(s, p, 'ended by us');
  return null;
}

function end(s, p, why) {
  s.aid = s.aid.filter((x) => x !== p);
  const c = s.countries[p.from];
  // Volunteers come home, those who survived
  if (p.troops && c && alive(s, c.id)) {
    const back = Math.round(p.troops * 0.7);
    c.troops += back;
    if (back) alert(s, c.id, `${troopsLabel(back)} volunteers are home from fighting for ${recipientName(s, p)}.`, 'info');
  }
  if (c && why !== 'ended by us') alert(s, c.id, `Our ${AID_KINDS[p.kind].name.toLowerCase()} for ${recipientName(s, p)} has ended: ${why}.`, 'info');
}

/* ---------- Once a week ---------- */

export function aidTick(s) {
  for (const p of [...(s.aid ?? [])]) {
    const c = s.countries[p.from];
    if (!c || !alive(s, p.from)) { s.aid = s.aid.filter((x) => x !== p); continue; }
    // Over when the war or the uprising is
    if (p.rebels) {
      const reg = s.regions[p.rebels];
      if (!reg?.revolt) { end(s, p, reg && reg.ctrl === reg.people && !s.countries[reg.ctrl] ? 'they won' : 'the uprising is over'); continue; }
      if (reg.ctrl === p.from) { end(s, p, 'we now hold the province'); continue; }
    } else if (!alive(s, p.to) || !enemiesOf(s, p.to).size) { end(s, p, `${nameOf(s, p.to)}'s war is over`); continue; }
    if (p.to && atWar(s, p.from, p.to)) { end(s, p, `we are at war with ${nameOf(s, p.to)}`); continue; }
    deliver(s, c, p);
    // The other side hunts for where the help is coming from
    if (p.covert) {
      for (const v of victimsOf(s, p)) {
        const ci = s.countries[v]?.counterIntel ?? 0;
        const odds = (0.004 + 0.006 * ci) * (1 + p.size) * (p.kind === 'volunteers' ? 2 : 1);
        if (chance(s, odds)) { publicise(s, p, true); break; }
      }
    }
  }
}

function deliver(s, c, p) {
  const z = AID_SIZES[p.size];
  const cost = p.covert ? COVERT_COST : 1;
  if (p.kind === 'money') {
    const amount = Math.min(z.money * cost, Math.max(0, c.treasury));
    if (amount <= 0) return;
    c.treasury -= amount;
    const got = amount / cost;
    p.sent.money += got;
    if (p.rebels) s.regions[p.rebels].revolt.rebels += got * 12;
    else {
      const t = nation(s, p.to);
      if (s.countries[p.to]) t.treasury += got;
      else t.troops += got * 8; // a minor nation turns money into soldiers
    }
  } else if (p.kind === 'weapons') {
    const tanks = Math.min(z.tanks, Math.max(0, Math.floor(c.tanks * 0.02)));
    const aircraft = Math.min(z.aircraft, Math.max(0, Math.floor(c.aircraft * 0.02)));
    const missiles = Math.min(z.missiles, Math.max(0, Math.floor(c.missiles * 0.05)));
    c.tanks -= tanks; c.aircraft -= aircraft; c.missiles -= missiles;
    if (p.covert) c.treasury -= (tanks * 0.004 + aircraft * 0.03) * (COVERT_COST - 1);
    p.sent.tanks += tanks; p.sent.aircraft += aircraft; p.sent.missiles += missiles;
    if (p.rebels) {
      const rv = s.regions[p.rebels].revolt;
      rv.rebels += tanks * 0.15 + aircraft * 0.5;
      rv.armed = (rv.armed ?? 0) + tanks + aircraft * 5;
    } else {
      const t = nation(s, p.to);
      t.tanks = (t.tanks ?? 0) + tanks;
      if (s.countries[p.to]) { t.aircraft += aircraft; t.missiles += missiles; } else t.troops += aircraft * 0.5 + missiles * 0.1;
    }
  } else if (p.kind === 'volunteers') {
    // They fight and some fall; losses come off the volunteers who will come home
    const lost = p.troops * 0.005;
    p.troops = Math.max(0, p.troops - lost);
  }
}

/* ---------- What each leader knows ---------- */

// Our own programmes, every open or exposed one, and covert ones our spies have uncovered
export function aidFor(s, cid) {
  const me = s.countries[cid];
  return (s.aid ?? []).filter((p) => p.from === cid || !p.covert || (me && (me.intel[p.from] ?? -1) > s.week))
    .map((p) => ({ id: p.id, from: p.from, to: p.to, rebels: p.rebels, kind: p.kind, size: p.size, covert: p.covert, exposed: p.exposed, since: p.since, sent: p.from === cid ? p.sent : null, troops: p.from === cid ? Math.round(p.troops) : null }));
}

/* ---------- Computer-run countries ---------- */

export function aiAid(s, c) {
  if (enemiesOf(s, c.id).size) return; // busy with our own war
  const mine = (s.aid ?? []).filter((p) => p.from === c.id);
  if (mine.length >= 3) return;
  const rel = (a, b) => s.rel[a < b ? `${a}|${b}` : `${b}|${a}`] ?? 0;
  // Help a friend who was invaded by a rival
  for (const w of s.wars) {
    const victim = w.b;
    const aggressor = w.a;
    if (victim === c.id || aggressor === c.id || !alive(s, victim)) continue;
    if (rel(c.id, victim) < 35 || rel(c.id, aggressor) > -25) continue;
    if (mine.some((p) => p.to === victim)) continue;
    const size = c.gdp > 5000 ? 2 : c.gdp > 1500 ? 1 : 0;
    if (!startAid(s, c, { to: victim, kind: 'weapons', size, covert: c.gov !== 'democracy' && rel(c.id, aggressor) > -60 })) return;
  }
  // Stir up trouble for a bitter rival
  if (chance(s, c.gov === 'democracy' ? 0.05 : 0.2)) {
    for (const reg of Object.values(s.regions)) {
      if (!reg.revolt || !s.countries[reg.ctrl] || reg.ctrl === c.id) continue;
      if (rel(c.id, reg.ctrl) > -55 || mine.some((p) => p.rebels === reg.id)) continue;
      if (!startAid(s, c, { rebels: reg.id, kind: chance(s, 0.5) ? 'weapons' : 'money', size: 0, covert: true })) return;
    }
  }
}
