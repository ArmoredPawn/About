// Space: satellites that change how wars are fought, and the race to the Moon and Mars.
//
// Spy satellites (four or more) let a country see every army and fleet on Earth in exact numbers. Navigation
// satellites (a constellation of six or more: GPS, BeiDou, GLONASS, Galileo) make missiles, bombs and attacks
// more accurate; countries without their own borrow an ally's, or a neutral power's civilian signal, which an
// enemy can switch off. Communications satellites (four or more) keep armies and fleets organised.
// Anti-satellite missiles can blind an enemy, but every kill leaves debris that threatens everyone's
// satellites. Crewed flight, a space station, a Moon landing and a Mars mission bring prestige, more so for
// whoever gets there first.

import { clamp, chance, rand, news, alert, alive, atWar, allied, addRel, money } from './core.js';

export const SATS = {
  spy: { name: 'Spy satellites', one: 'spy satellite', need: 4, cost: 2, years: 6, note: 'Four or more: every army and fleet on Earth in exact numbers.' },
  nav: { name: 'Navigation satellites', one: 'navigation satellite', need: 6, cost: 0.8, years: 15, note: 'Six or more: our own GPS. Missiles, bombs and attacks hit harder, and no enemy can switch it off.' },
  comms: { name: 'Communications satellites', one: 'communications satellite', need: 4, cost: 0.5, years: 11, note: 'Four or more: armies and fleets recover their organisation a quarter faster.' },
};
export const LAUNCH_WEEKS = 12;
export const MIN_LAUNCH_TECH = 5;

export const PROGRAMMES = {
  crewed: { name: 'Crewed spaceflight', tech: 6, cost: 8, weeks: 104, needs: null, note: 'Astronauts in orbit on our own rockets.' },
  station: { name: 'Space station', tech: 7, cost: 40, weeks: 260, needs: 'crewed', note: 'A permanent home in orbit for research.' },
  moon: { name: 'Moon landing', tech: 8, cost: 60, weeks: 260, needs: 'crewed', note: 'Our astronauts walk on the Moon.' },
  mars: { name: 'Mars mission', tech: 10, cost: 150, weeks: 416, needs: 'moon', note: 'The first people on another planet.' },
};

// Satellites and space achievements as of 2027 (Galileo is split between the big EU members). Programmes under
// way: NASA's Artemis landing and China's crewed lunar programme, both aiming for the end of the decade.
const START = {
  usa: { spy: 12, nav: 31, comms: 30, done: ['crewed', 'station'], prog: { moon: 90 } },
  chn: { spy: 10, nav: 30, comms: 15, done: ['crewed', 'station'], prog: { moon: 160 } },
  rus: { spy: 6, nav: 24, comms: 8, done: ['crewed', 'station'] },
  fra: { spy: 3, nav: 10, comms: 4 },
  deu: { spy: 3, nav: 10, comms: 2 },
  ita: { spy: 2, nav: 8, comms: 2 },
  jpn: { spy: 8, nav: 7, comms: 4 },
  ind: { spy: 4, nav: 7, comms: 6, prog: { crewed: 40 } },
  isr: { spy: 6, nav: 0, comms: 2 },
  gbr: { spy: 1, nav: 0, comms: 5 },
  kor: { spy: 4, nav: 0, comms: 2 },
  irn: { spy: 1, nav: 0, comms: 0 },
  tur: { spy: 2, nav: 0, comms: 2 },
  esp: { spy: 1, nav: 0, comms: 2 },
  can: { spy: 0, nav: 0, comms: 3 },
  bra: { spy: 0, nav: 0, comms: 2 },
};

const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);

export function initSpace(s) {
  s.space ??= { debris: 0, firsts: {} };
  for (const c of Object.values(s.countries)) {
    if (c.space) continue;
    const st = START[c.id] ?? {};
    c.space = {
      sats: { spy: st.spy ?? 0, nav: st.nav ?? 0, comms: st.comms ?? 0 },
      // What a computer-run country keeps in orbit: at least what it had in 2027
      goal: { spy: st.spy ?? 0, nav: st.nav ?? 0, comms: st.comms ?? 0 },
      building: [],
      done: Object.fromEntries((st.done ?? []).map((k) => [k, -1])),
      prog: Object.fromEntries(Object.entries(st.prog ?? {}).map(([k, left]) => [k, { left, total: PROGRAMMES[k].weeks }])),
    };
  }
}

/* ---------- What satellites do ---------- */

const sats = (s, id, kind) => s.countries[id]?.space?.sats?.[kind] ?? 0;
export const canLaunch = (c) => (c.tech?.missile ?? 0) >= MIN_LAUNCH_TECH;

// Does this country see every army and fleet in exact numbers?
export const satSees = (s, id) => sats(s, id, 'spy') >= SATS.spy.need;

// 1 with a navigation constellation of our own (or an ally's), 0.5 borrowing a neutral power's civilian
// signal, 0 when everyone who runs one is at war with us
export function gpsCoverage(s, id) {
  if (!s.countries[id]) return 0;
  const owners = Object.keys(s.countries).filter((x) => sats(s, x, 'nav') >= SATS.nav.need && alive(s, x));
  if (owners.some((x) => x === id || allied(s, x, id))) return 1;
  return owners.some((x) => !atWar(s, x, id)) ? 0.5 : 0;
}
export const commsReady = (s, id) => sats(s, id, 'comms') >= SATS.comms.need;

/* ---------- Orders ---------- */

export function launchSatellite(s, c, { kind }) {
  const def = SATS[kind];
  if (!def) return 'Pick a kind of satellite.';
  if (!canLaunch(c)) return `We need rockets: Missiles research level ${MIN_LAUNCH_TECH} or more.`;
  if (c.space.building.length >= 4) return 'Our launch sites are busy: four satellites at a time.';
  const cost = def.cost * costFactor(c);
  if (c.treasury < cost) return `It costs ${money(cost)}.`;
  c.treasury -= cost;
  c.space.building.push({ kind, left: LAUNCH_WEEKS });
  return null;
}

export function startProgramme(s, c, { kind }) {
  const def = PROGRAMMES[kind];
  if (!def) return 'Pick a programme.';
  if (c.space.done[kind] != null) return `We have already achieved: ${def.name.toLowerCase()}.`;
  if (c.space.prog[kind]) return 'It is already under way.';
  if ((c.tech.missile ?? 0) < def.tech) return `It needs Missiles research level ${def.tech}.`;
  if (def.needs && c.space.done[def.needs] == null) return `First: ${PROGRAMMES[def.needs].name.toLowerCase()}.`;
  c.space.prog[kind] = { left: def.weeks, total: def.weeks };
  news(s, `${c.name} announces a ${def.name.toLowerCase()} programme.`, 'economy', [c.id]);
  return null;
}

export function cancelProgramme(s, c, { kind }) {
  if (!c.space.prog[kind]) return 'There is no such programme.';
  delete c.space.prog[kind];
  news(s, `${c.name} cancels its ${PROGRAMMES[kind].name.toLowerCase()} programme.`, 'economy', [c.id]);
  return null;
}

export const ASAT_COST = 1;
export const ASAT_TECH = 7;
// Shoot down one of another country's satellites. Every kill scatters debris that endangers all satellites.
export function antiSatellite(s, c, { target, kind }) {
  const t = s.countries[target];
  if (!t || target === c.id) return 'Pick a country.';
  if (!SATS[kind] || sats(s, target, kind) < 1) return `${t.name} has no ${SATS[kind]?.name.toLowerCase() ?? 'satellites of that kind'}.`;
  if ((c.tech.missile ?? 0) < ASAT_TECH) return `Anti-satellite missiles need Missiles research level ${ASAT_TECH}.`;
  const cost = ASAT_COST * costFactor(c);
  if (c.treasury < cost) return `It costs ${money(cost)}.`;
  if ((c.cooldown.asat ?? -1) > s.week) return `The next interceptor is ready in ${c.cooldown.asat - s.week} weeks.`;
  c.treasury -= cost;
  c.cooldown.asat = s.week + 4;
  const hit = chance(s, 0.8);
  if (hit) {
    const kills = Math.min(sats(s, target, kind), 1 + Math.floor(rand(s) * 2));
    t.space.sats[kind] -= kills;
    s.space.debris = Math.min(1, s.space.debris + 0.06 * kills);
  }
  const war = atWar(s, c.id, target);
  c.rep = Math.max(0, c.rep - (war ? 6 : 15));
  addRel(s, c.id, target, war ? -10 : -35);
  news(s, hit
    ? `${c.name} shoots down ${t.name}'s ${SATS[kind].one}. A cloud of debris spreads through orbit, threatening every satellite.`
    : `${c.name} fires an anti-satellite missile at ${t.name}'s ${SATS[kind].one}, and misses.`, 'war', [c.id, target]);
  alert(s, target, hit ? `${c.name} has destroyed our ${SATS[kind].name.toLowerCase()} in orbit.` : `${c.name} tried to shoot down one of our satellites.`, 'war');
  return null;
}

/* ---------- Once a week ---------- */

export function spaceTick(s) {
  initSpace(s);
  const sp = s.space;
  // Debris slowly falls back to Earth
  sp.debris = Math.max(0, sp.debris * 0.996 - 0.0005);
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id) || !c.space) continue;
    // Satellites wear out (spy satellites in low orbit after about six years, navigation ones after fifteen),
    // sooner in a cloud of debris
    for (const kind of Object.keys(SATS)) {
      const n = c.space.sats[kind];
      if (!n) continue;
      const lost = n * (1 / (SATS[kind].years * 52) + 0.012 * sp.debris);
      const whole = Math.floor(lost);
      c.space.sats[kind] -= whole + (chance(s, lost - whole) ? 1 : 0);
      if (c.space.sats[kind] < 0) c.space.sats[kind] = 0;
    }
    // Launches
    for (const b of c.space.building) b.left--;
    for (const b of c.space.building.filter((x) => x.left <= 0)) {
      const fail = clamp(0.12 - 0.01 * (c.tech.missile ?? 5), 0.02, 0.1) + sp.debris * 0.1;
      if (chance(s, fail)) alert(s, c.id, `A rocket carrying our ${SATS[b.kind].one} failed on launch.`, 'bad');
      else {
        c.space.sats[b.kind]++;
        if (c.space.sats[b.kind] === SATS[b.kind].need) alert(s, c.id, `With ${SATS[b.kind].need} ${SATS[b.kind].name.toLowerCase()} in orbit: ${SATS[b.kind].note}`, 'good');
      }
    }
    c.space.building = c.space.building.filter((x) => x.left > 0);
    // Programmes cost money every week; with an empty treasury they stall
    for (const [kind, p] of Object.entries(c.space.prog)) {
      const def = PROGRAMMES[kind];
      const weekly = def.cost * costFactor(c) / def.weeks;
      if (c.treasury < weekly * 4) { p.stalled = true; continue; }
      p.stalled = false;
      c.treasury -= weekly;
      if (--p.left > 0) continue;
      delete c.space.prog[kind];
      c.space.done[kind] = s.week;
      const first = !sp.firsts[kind] && kind !== 'crewed' && kind !== 'station';
      if (first) sp.firsts[kind] = { by: c.id, week: s.week };
      c.rep = Math.min(100, c.rep + (first ? 10 : 4));
      c.approval = Math.min(100, c.approval + (first ? 10 : 5));
      const line = {
        crewed: `${c.name} launches its first astronauts into orbit.`,
        station: `${c.name}'s space station is complete and crewed.`,
        moon: first ? `${c.name}'s astronauts walk on the Moon, the first humans there since 1972.` : `${c.name}'s astronauts land on the Moon.`,
        mars: first ? `History: ${c.name}'s astronauts land on Mars, the first people on another planet.` : `${c.name}'s astronauts land on Mars.`,
      }[kind];
      news(s, line, 'economy', [c.id]);
      alert(s, c.id, `${PROGRAMMES[kind].name} achieved${first ? ', first in the world' : ''}. Our standing and approval rise.`, 'good');
    }
  }
}

/* ---------- Computer-run countries ---------- */

export function aiSpace(s, c) {
  if (!c.space || !canLaunch(c) || c.treasury < c.gdp * 0.01) return;
  const goal = c.space.goal ?? {};
  const wants = {
    spy: Math.max(goal.spy ?? 0, c.gdp > 1500 ? 4 : c.gdp > 600 ? 2 : 0),
    nav: Math.max(goal.nav ?? 0, c.gdp > 8000 ? 6 : 0),
    comms: Math.max(goal.comms ?? 0, c.gdp > 1000 ? 4 : 0),
  };
  // Keep every constellation topped up, most-needed first
  const short = Object.entries(wants).map(([kind, n]) => [kind, n - c.space.sats[kind] - c.space.building.filter((b) => b.kind === kind).length]).filter(([, gap]) => gap > 0).sort((a, b) => b[1] - a[1]);
  for (const [kind] of short) if (launchSatellite(s, c, { kind })) break;
  // Great powers race for the Moon and Mars
  if (c.gdp > 4000 && chance(s, 0.08)) {
    for (const kind of ['crewed', 'station', 'moon', 'mars']) {
      if (c.space.done[kind] != null || c.space.prog[kind]) continue;
      if (!startProgramme(s, c, { kind })) break;
    }
  }
  // At war with a satellite power: blind its spy satellites
  if ((c.tech.missile ?? 0) >= ASAT_TECH && chance(s, 0.05)) {
    const target = Object.values(s.countries).find((t) => atWar(s, c.id, t.id) && (t.space?.sats.spy ?? 0) >= SATS.spy.need);
    if (target) antiSatellite(s, c, { target: target.id, kind: 'spy' });
  }
}

/* ---------- What each leader sees ---------- */

// Satellites in orbit are tracked by everyone, and space programmes are public
export function spaceOf(c) {
  if (!c.space) return null;
  return { sats: { ...c.space.sats }, done: { ...c.space.done }, prog: Object.fromEntries(Object.entries(c.space.prog).map(([k, p]) => [k, { left: p.left, total: p.total, stalled: Boolean(p.stalled) }])) };
}
