// Military doctrine: how a country's armies fight. A leader builds a doctrine from five choices (how to attack,
// how to defend, what the air force is for, how the armies are supplied, and how they are commanded), names it
// and has the staff college develop it. A new doctrine takes weeks of staff work and exercises before the army
// fights by it, and more weeks of training before it fights well by it.
//
// Doctrines get better with use: every week of fighting by a concept builds mastery of it, and a beaten army
// learns fastest. Some combinations are more than the sum of their parts: put the right pieces together, master
// them, and the generals develop a new way of war (Blitzkrieg, Deep Operations, AirLand Battle...). The first
// country to develop each one is its pioneer.
//
// Every offensive concept fares better against some defences than others: mobile armoured warfare tears through a
// fortified line (France, 1940) but bleeds against an elastic defence that gives ground and strikes back
// (Kursk, 1943). Knowing the enemy's doctrine, from spies or from fighting it, tells a leader what to build.

import { clamp, news, alert, nameOf, alive, enemiesOf, money, chance } from './core.js';
import { costFactor } from './economy.js';

/* ---------- The choices ---------- */

export const AXES = {
  offence: {
    name: 'Attack', short: 'How the army attacks',
    options: {
      broad: { name: 'Broad front', note: 'Attack everywhere at once with mass and massed artillery. Steady, grinding gains, fewer losses for the ground taken.', fx: { mass: 0.4, attackLoss: -0.12, tempo: -0.08 } },
      deep: { name: 'Deep battle', note: 'Break the line on several sectors at once and pour a second echelon through the gaps. Rewards numbers and reserves.', fx: { attack: 0.05, breakthrough: 0.2, orgRecover: 0.12, pincer: 0.1 } },
      maneuver: { name: 'Armoured manoeuvre', note: 'Tanks, motorised infantry and aircraft punch one hole and race through it to encircle, not to push. Burns fuel; brilliant on open ground.', fx: { breakthrough: 0.45, pincer: 0.25, tempo: 0.22, speed: 0.15, fuel: 0.2, roughAttack: -0.1 } },
      infiltration: { name: 'Infiltration', note: 'Small assault groups slip through forests, hills and gaps and strike the defenders from behind. Strong in rough ground and at night, weak in the open.', fx: { roughAttack: 0.22, surprise: 0.3, armor: -0.15, attackLoss: -0.05 } },
    },
  },
  defence: {
    name: 'Defence', short: 'How the army defends',
    options: {
      static: { name: 'Fortified line', note: 'Dig in and hold every metre. Fortifications count for half as much again, but a line broken through is hard to mend.', fx: { fort: 0.5, defend: 0.05, vsBreakthrough: -0.2 } },
      elastic: { name: 'Elastic defence', note: 'A thin forward line and strong reserves behind it: give ground, then counter-attack the spearhead as it overreaches.', fx: { counter: 0.45, defendLoss: -0.15, vsBreakthrough: 0.25 } },
      mobile: { name: 'Mobile defence', note: 'Hold the armour back and strike at whatever breaks through. Needs tanks and fuel.', fx: { counter: 0.25, vsBreakthrough: 0.35, armorDefend: 0.25 } },
      people: { name: "People's war", note: 'Arm the people. Every town fights, every village hides a militia, and occupied land rises behind the enemy. Civilians pay for it.', fx: { militia: 1, partisans: 0.6, urban: 0.3, defendLoss: 0.05 } },
    },
  },
  air: {
    name: 'Air power', short: 'What the air force is for',
    options: {
      support: { name: 'Close support', note: 'Dive-bombers and attack aircraft fly for the troops: close air support hits much harder.', fx: { cas: 0.6 } },
      superiority: { name: 'Air superiority', note: 'First win the sky, then everything else: the air force counts for more over every battlefield.', fx: { airEdge: 0.4 } },
      strategic: { name: 'Strategic bombing', note: 'Bomb the enemy\'s factories, oil and cities: strategic bombing does far more damage.', fx: { strategic: 0.7 } },
      transport: { name: 'Air transport', note: 'Transport fleets and airborne troops: an airlift keeps a surrounded army fed twice as well.', fx: { airlift: 1, speed: 0.04 } },
    },
  },
  supply: {
    name: 'Logistics', short: 'How the armies are supplied',
    options: {
      rail: { name: 'Rail and depots', note: 'Railheads and great depots: supply holds up far from home, but the army moves at the speed of the trains.', fx: { reach: 0.35, speed: -0.05 } },
      motor: { name: 'Motor transport', note: 'Lorries everywhere: the army moves faster and keeps up with its tanks, but burns more fuel.', fx: { speed: 0.12, fuel: 0.12, reach: 0.15 } },
      forage: { name: 'Live off the land', note: 'Take what the army needs from where it is: supply never runs as short in enemy country, but the people there hate it.', fx: { forage: 0.2, hatred: 1 } },
    },
  },
  command: {
    name: 'Command', short: 'How the army is led',
    options: {
      mission: { name: 'Mission command', note: 'Officers are told what to achieve, not how: units recover and exploit gaps faster.', fx: { orgRecover: 0.2, breakthrough: 0.1, tempo: 0.05 } },
      central: { name: 'Central control', note: 'Every move planned from the top: steadier, fewer losses, but slower to seize a chance.', fx: { attackLoss: -0.08, defendLoss: -0.06, defend: 0.04, tempo: -0.06 } },
      commissar: { name: 'Political commissars', note: 'Party officers beside every commander: units never surrender and hold out far longer when surrounded, at a terrible price in lives.', fx: { noSurrender: 1, pocket: 0.45, attackLoss: 0.1 } },
      staff: { name: 'General staff', note: 'Exhaustive planning and war games: an attack prepared for two weeks or more hits much harder.', fx: { setPiece: 0.15, defend: 0.02 } },
    },
  },
};
export const AXIS_KEYS = Object.keys(AXES);

// What each kind of attack can expect against each kind of defence
export const MATCHUPS = {
  broad: { static: 0, elastic: 0.08, mobile: 0, people: -0.05 },
  deep: { static: 0.06, elastic: 0.04, mobile: -0.05, people: 0 },
  maneuver: { static: 0.2, elastic: -0.12, mobile: -0.1, people: -0.06 },
  infiltration: { static: 0.12, elastic: -0.04, mobile: -0.06, people: -0.12 },
};

// Combinations that, mastered, become a new way of war
export const SYNERGIES = [
  { id: 'blitz', name: 'Blitzkrieg', needs: { offence: 'maneuver', air: 'support', command: 'mission' }, fx: { breakthrough: 0.2, tempo: 0.15, pincer: 0.15 }, note: 'Tanks and dive-bombers working as one, with junior officers free to drive through any gap: France in six weeks, 1940.' },
  { id: 'deepop', name: 'Deep operations', needs: { offence: 'deep', supply: 'rail', command: 'central' }, fx: { attack: 0.06, mass: 0.2, pincer: 0.12 }, note: 'Fronts that attack in turn along the whole line, each blow drawing reserves from the next: Operation Bagration, 1944.' },
  { id: 'airland', name: 'AirLand Battle', needs: { offence: 'maneuver', air: 'superiority', supply: 'motor' }, fx: { attack: 0.07, airEdge: 0.2, breakthrough: 0.1 }, note: 'Strike the enemy\'s rear echelons from the air while the armour hits the front: the Gulf War, 1991.' },
  { id: 'hedgehog', name: 'Hedgehog defence', needs: { defence: 'elastic', supply: 'rail', command: 'staff' }, fx: { pocket: 0.35, counter: 0.2, defend: 0.04 }, note: 'Strongpoints that keep fighting when bypassed and are relieved by counter-attack: the winter of 1941–42.' },
  { id: 'protracted', name: 'Protracted war', needs: { offence: 'infiltration', defence: 'people', supply: 'forage' }, fx: { partisans: 0.5, militia: 0.6, surprise: 0.15 }, note: 'Trade space for time, bleed the invader in every village, strike only where he is weak: Mao, 1938.' },
  { id: 'materiel', name: 'Battle of materiel', needs: { offence: 'broad', defence: 'static', air: 'strategic' }, fx: { mass: 0.2, fort: 0.25, strategic: 0.2 }, note: 'Win by out-producing and out-shelling the enemy: the Western Front, 1918.' },
  { id: 'vertical', name: 'Vertical envelopment', needs: { offence: 'deep', air: 'transport', command: 'mission' }, fx: { pincer: 0.2, airlift: 0.5, surprise: 0.1 }, note: 'Airborne divisions dropped behind the line to seize the crossings the tanks need: Operation Market Garden, 1944.' },
];

// The doctrine a country starts with, from how its army is built and governed
export function defaultPicks(c) {
  const armour = (c.tanks ?? 0) / Math.max(1, c.troops ?? 1);
  const tech = c.tech?.army ?? 4;
  const air = c.tech?.air ?? 4;
  const known = {
    usa: { offence: 'maneuver', defence: 'mobile', air: 'superiority', supply: 'motor', command: 'mission' },
    rus: { offence: 'deep', defence: 'elastic', air: 'support', supply: 'rail', command: 'central' },
    chn: { offence: 'deep', defence: 'people', air: 'superiority', supply: 'rail', command: 'central' },
    deu: { offence: 'maneuver', defence: 'mobile', air: 'support', supply: 'motor', command: 'mission' },
    isr: { offence: 'maneuver', defence: 'mobile', air: 'superiority', supply: 'motor', command: 'mission' },
    gbr: { offence: 'maneuver', defence: 'mobile', air: 'superiority', supply: 'motor', command: 'mission' },
    fra: { offence: 'maneuver', defence: 'static', air: 'superiority', supply: 'motor', command: 'staff' },
    ind: { offence: 'broad', defence: 'static', air: 'support', supply: 'rail', command: 'central' },
    irn: { offence: 'infiltration', defence: 'people', air: 'strategic', supply: 'forage', command: 'commissar' },
    prk: { offence: 'broad', defence: 'people', air: 'support', supply: 'forage', command: 'commissar' },
    ukr: { offence: 'infiltration', defence: 'elastic', air: 'support', supply: 'rail', command: 'mission' },
    kor: { offence: 'maneuver', defence: 'static', air: 'superiority', supply: 'motor', command: 'staff' },
    tur: { offence: 'maneuver', defence: 'elastic', air: 'support', supply: 'motor', command: 'central' },
    pak: { offence: 'broad', defence: 'static', air: 'support', supply: 'rail', command: 'central' },
    vnm: { offence: 'infiltration', defence: 'people', air: 'support', supply: 'forage', command: 'central' },
  }[c.id];
  if (known) return { ...known };
  return {
    offence: armour > 2 && tech >= 6 ? 'maneuver' : tech <= 3 ? 'infiltration' : armour > 1 ? 'deep' : 'broad',
    defence: tech <= 3 ? 'people' : armour > 2 ? 'mobile' : c.gov === 'autocracy' ? 'static' : 'elastic',
    air: air >= 7 ? 'superiority' : 'support',
    supply: tech >= 6 ? 'motor' : tech <= 3 ? 'forage' : 'rail',
    command: c.gov === 'autocracy' && tech <= 4 ? 'commissar' : c.gov === 'democracy' && tech >= 5 ? 'mission' : 'central',
  };
}

export function initDoctrine(c) {
  if (c.doctrine?.picks) return;
  const picks = defaultPicks(c);
  const mastery = {};
  for (const k of AXIS_KEYS) mastery[picks[k]] = 0.3;
  c.doctrine = { name: 'Standing doctrine', picks, ready: Object.fromEntries(AXIS_KEYS.map((k) => [k, 1])), mastery, since: 0, draft: null, rev: 0 };
  c.innovations ??= {};
}

/* ---------- What a doctrine does in battle ---------- */

const cache = new Map();

// The combined effect of a country's doctrine on its armies, scaled by how ready and how practised it is:
// { attack, defend, mass, ... } as fractions (0.1 = +10%). Countries with none (rebels, the smallest states) get
// nothing.
export function fx(s, cid) {
  const c = s.countries[cid];
  if (!c?.doctrine?.picks) return NONE;
  const key = `${s.week}|${c.doctrine.rev ?? 0}`;
  const hit = cache.get(cid);
  if (hit && hit.key === key && hit.s === s) return hit.fx;
  const out = {};
  const add = (effects, k) => { for (const [name, v] of Object.entries(effects)) out[name] = (out[name] ?? 0) + v * k; };
  for (const axis of AXIS_KEYS) {
    const pick = c.doctrine.picks[axis];
    const opt = AXES[axis].options[pick];
    if (!opt) continue;
    // Not yet trained in it: half the effect at first. Well practised: up to 30% more.
    const ready = clamp(c.doctrine.ready?.[axis] ?? 1, 0, 1);
    const skill = clamp(c.doctrine.mastery?.[pick] ?? 0, 0, 1);
    add(opt.fx, (0.5 + 0.5 * ready) * (0.75 + 0.55 * skill));
  }
  for (const syn of SYNERGIES) if (c.innovations?.[syn.id] != null && hasAll(c.doctrine.picks, syn.needs)) add(syn.fx, 1 + (c.innovations[`${syn.id}:pioneer`] ? 0.15 : 0));
  out.offence = c.doctrine.picks.offence;
  out.defence = c.doctrine.picks.defence;
  cache.set(cid, { key, s, fx: out });
  return out;
}
const NONE = Object.freeze({});

const hasAll = (picks, needs) => Object.entries(needs).every(([axis, v]) => picks[axis] === v);

// The edge one country's way of attacking gives it against another's way of defending
export function matchup(s, attacker, defender) {
  const a = s.countries[attacker]?.doctrine?.picks?.offence;
  const d = s.countries[defender]?.doctrine?.picks?.defence;
  return (a && d && MATCHUPS[a]?.[d]) || 0;
}

/* ---------- Building a new doctrine ---------- */

// Weeks of staff work to adopt new choices: three for each axis changed, less with better army research
export const draftWeeks = (c, changes) => Math.max(2, Math.round(changes * 3 * (1.15 - 0.03 * (c.tech?.army ?? 5))));
export const draftCost = (c, changes) => changes * 0.25 * costFactor(c);

export function changesIn(c, picks) {
  return AXIS_KEYS.filter((k) => picks[k] && picks[k] !== c.doctrine.picks[k]).length;
}

export function planDoctrine(s, c, { picks, name }) {
  initDoctrine(c);
  if (!picks || typeof picks !== 'object') return 'Pick a concept for each part of the doctrine.';
  for (const k of AXIS_KEYS) if (!AXES[k].options[picks[k]]) return `Pick how the army handles ${AXES[k].name.toLowerCase()}.`;
  const changes = changesIn(c, picks);
  const clean = String(name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 32);
  if (!changes) {
    if (clean && clean !== c.doctrine.name) { c.doctrine.name = clean; return null; }
    return 'That is the doctrine we already fight by.';
  }
  const cost = draftCost(c, changes);
  if (cost > c.milFunds + c.treasury) return `Developing it costs ${money(cost)}; we have ${money(c.milFunds + c.treasury)}.`;
  const fromFunds = Math.min(c.milFunds, cost);
  c.milFunds -= fromFunds;
  c.treasury -= cost - fromFunds;
  const weeks = draftWeeks(c, changes);
  c.doctrine.draft = { picks: { ...picks }, name: clean || c.doctrine.name, since: s.week, ready: s.week + weeks, weeks, cost };
  return null;
}

export function cancelDoctrine(s, c) {
  if (!c.doctrine?.draft) return 'No new doctrine is being developed.';
  c.doctrine.draft = null;
  return null;
}

/* ---------- Every week ---------- */

// Drafts come into force; the army trains in its doctrine; fighting builds mastery; and mastered combinations
// become a new way of war
export function doctrineTick(s) {
  for (const c of Object.values(s.countries)) {
    if (!alive(s, c.id)) continue;
    initDoctrine(c);
    const d = c.doctrine;
    if (d.draft && d.draft.ready <= s.week) {
      for (const k of AXIS_KEYS) {
        if (d.draft.picks[k] === d.picks[k]) continue;
        d.picks[k] = d.draft.picks[k];
        d.ready[k] = 0;
        d.mastery[d.picks[k]] ??= 0.05;
      }
      d.name = d.draft.name;
      d.since = s.week;
      d.draft = null;
      d.rev = (d.rev ?? 0) + 1;
      alert(s, c.id, `The army now fights by our new doctrine, "${d.name}". It will take a few months of training before the troops have it down.`, 'good');
    }
    let changed = false;
    for (const k of AXIS_KEYS) {
      if ((d.ready[k] ?? 1) < 1) { d.ready[k] = Math.min(1, (d.ready[k] ?? 0) + 0.06); changed = true; }
    }
    // Fighting teaches: a week of battle by a concept, more when it goes badly (an army that is beaten learns
    // faster than one that wins)
    const f = c.fought;
    if (f) {
      const grow = (pick, weeks, lost) => {
        if (!pick || !(weeks > 0)) return;
        d.mastery[pick] = Math.min(1, (d.mastery[pick] ?? 0) + Math.min(0.05, weeks * (lost ? 0.03 : 0.018)));
        changed = true;
      };
      grow(d.picks.offence, f.attack, f.attackLost > f.attackWon);
      grow(d.picks.command, (f.attack ?? 0) + (f.defend ?? 0), false);
      grow(d.picks.defence, f.defend, f.defendLost > f.defendWon);
      grow(d.picks.air, f.air, false);
      grow(d.picks.supply, (f.attack ?? 0) * 0.5, false);
      c.fought = null;
    }
    // Peacetime exercises keep skills from rusting away, and slowly build them
    if (!enemiesOf(s, c.id).size) for (const k of AXIS_KEYS) d.mastery[d.picks[k]] = Math.min(0.45, (d.mastery[d.picks[k]] ?? 0) + 0.002);
    if (changed) d.rev = (d.rev ?? 0) + 1;
    innovate(s, c);
  }
}

// A doctrine whose pieces fit together and have been practised long enough becomes a new way of war
function innovate(s, c) {
  const d = c.doctrine;
  for (const syn of SYNERGIES) {
    if (c.innovations[syn.id] != null || !hasAll(d.picks, syn.needs)) continue;
    const skill = Object.values(syn.needs).reduce((t, pick) => t + (d.mastery[pick] ?? 0), 0) / Object.keys(syn.needs).length;
    if (skill < 0.42 || !chance(s, 0.25)) continue;
    c.innovations[syn.id] = s.week;
    const first = !Object.values(s.countries).some((o) => o.id !== c.id && o.innovations?.[syn.id] != null);
    if (first) c.innovations[`${syn.id}:pioneer`] = true;
    d.rev = (d.rev ?? 0) + 1;
    news(s, first
      ? `${c.name}'s generals have developed a new way of war: ${syn.name}. Military observers around the world take note.`
      : `${c.name}'s army has mastered ${syn.name}.`, 'war', [c.id]);
    alert(s, c.id, `Innovation: our doctrine has become ${syn.name}. ${syn.note}${first ? ' We are the first to develop it, and fight it best.' : ''}`, 'good');
  }
}

// Record a week (or part of one) of fighting for the doctrine's lessons
export function noteFighting(c, role, dt, won) {
  if (!c) return;
  c.fought ??= {};
  c.fought[role] = (c.fought[role] ?? 0) + dt;
  const key = `${role}${won ? 'Won' : 'Lost'}`;
  c.fought[key] = (c.fought[key] ?? 0) + dt;
}

/* ---------- The computer's generals ---------- */

// Beaten for months by an enemy whose way of attacking beats ours, a computer-run country rethinks its defence
export function aiDoctrine(s, c) {
  initDoctrine(c);
  if (c.doctrine.draft || !enemiesOf(s, c.id).size) return;
  for (const e of enemiesOf(s, c.id)) {
    const theirs = s.countries[e]?.doctrine?.picks?.offence;
    if (!theirs) continue;
    const now = MATCHUPS[theirs]?.[c.doctrine.picks.defence] ?? 0;
    if (now <= 0.05) continue;
    const best = Object.keys(AXES.defence.options).sort((a, b) => (MATCHUPS[theirs][a] ?? 0) - (MATCHUPS[theirs][b] ?? 0))[0];
    if (best === c.doctrine.picks.defence) continue;
    if (planDoctrine(s, c, { picks: { ...c.doctrine.picks, defence: best }, name: c.doctrine.name }) === null) {
      news(s, `${c.name}'s general staff, studying its defeats, adopts a new defensive doctrine.`, 'war', [c.id]);
    }
    return;
  }
}

/* ---------- What a leader sees ---------- */

// Our own doctrine in full; another country's only if our spies are inside it, or we have fought it for a month
export function doctrineView(s, viewer, cid) {
  const c = s.countries[cid];
  if (!c?.doctrine) return null;
  const me = s.countries[viewer];
  const own = viewer === cid;
  const spies = (me?.intel?.[cid] ?? -1) > s.week;
  const war = s.wars.find((w) => (w.a === viewer && w.b === cid) || (w.b === viewer && w.a === cid));
  const studied = war && s.week - war.since >= 4;
  if (!own && !spies && !studied) return { known: false, innovations: Object.keys(c.innovations ?? {}).filter((k) => !k.includes(':')) };
  const d = c.doctrine;
  return {
    known: true, name: d.name, picks: d.picks,
    ready: own ? d.ready : null, mastery: own || spies ? Object.fromEntries(Object.entries(d.mastery).map(([k, v]) => [k, Math.round(v * 100) / 100])) : null,
    draft: own ? d.draft : null,
    innovations: Object.keys(c.innovations ?? {}).filter((k) => !k.includes(':')),
    pioneer: Object.keys(c.innovations ?? {}).filter((k) => k.endsWith(':pioneer')).map((k) => k.split(':')[0]),
  };
}
