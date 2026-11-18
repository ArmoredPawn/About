// Designs: a country's own tanks, armoured vehicles, aircraft and warships. A design is a choice of parts, one per
// slot; the best parts need research. Factories then build to a design (Military, Weapons): each batch costs and
// takes what the design does, and every unit built to it changes how good that arm of the forces is (its edge,
// 0.75 to 1.4 against a standard model's 1). Vehicles are an arm of their own: trucks and armoured carriers that
// make armies march faster and keep them supplied.

import { TECH_FIELDS } from './data/world.js';
import { clamp, nextId } from './core.js';

export const MAX_DESIGNS = 16;

// Each option: what it adds on four axes (firepower, protection, mobility, a fourth that depends on the kind), what
// it does to the price and the build time, and the research it needs
const opt = (name, note, axes, cost = 1, weeks = 1, tech = null) => ({ name, note, axes, cost, weeks, tech });

export const DESIGN_KINDS = {
  tanks: {
    name: 'Tank', plural: 'tanks', axes: ['Firepower', 'Protection', 'Mobility', 'Reliability'],
    slots: {
      hull: { name: 'Hull', options: {
        light: opt('Light hull', '30 tonnes: fast and cheap, thinly armoured.', [0, -2, 3, 1], 0.75, 0.85),
        medium: opt('Medium hull', '50 tonnes: the all-rounder.', [0, 0, 0, 0]),
        heavy: opt('Heavy hull', '70 tonnes: a fortress that drinks fuel.', [0, 3, -2, -1], 1.3, 1.15, ['army', 6]),
      } },
      gun: { name: 'Main gun', options: {
        g90: opt('90 mm gun', 'Enough against light armour.', [-2, 0, 1, 1], 0.85),
        g105: opt('105 mm rifled gun', 'The old standard.', [0, 0, 0, 0]),
        g120: opt('120 mm smoothbore', 'Today\'s main battle tank gun.', [2, 0, -0.5, 0], 1.12, 1, ['army', 5]),
        g130: opt('130 mm smoothbore', 'Outranges every tank in service.', [3, 0, -1, -0.5], 1.25, 1.1, ['army', 8]),
      } },
      armour: { name: 'Armour', options: {
        steel: opt('Rolled steel', 'Simple to make and repair.', [0, 0, 0, 1], 0.9),
        composite: opt('Composite (Chobham)', 'Ceramic layers that defeat shaped charges.', [0, 2, -0.5, 0], 1.15, 1.05, ['army', 5]),
        era: opt('Composite + reactive', 'Explosive tiles that break up incoming rounds.', [0, 3, -0.5, -0.5], 1.25, 1.1, ['army', 7]),
        aps: opt('Active protection', 'Radar and interceptors shoot down missiles in flight.', [0, 4, -0.5, -1], 1.45, 1.15, ['army', 9]),
      } },
      engine: { name: 'Engine', options: {
        diesel: opt('Diesel, 1,000 hp', 'Reliable and frugal.', [0, 0, 0, 1], 0.95),
        diesel15: opt('Diesel, 1,500 hp', 'Hauls a heavy tank at speed.', [0, 0, 1.5, 0], 1.08, 1, ['industry', 6]),
        turbine: opt('Gas turbine, 1,500 hp', 'Very fast; burns a lot of fuel.', [0, 0, 2.5, -1], 1.15, 1.05, ['industry', 7]),
        hybrid: opt('Hybrid electric', 'Fast, quiet and frugal.', [0, 0, 2, 1], 1.3, 1.1, ['industry', 9]),
      } },
      extras: { name: 'Systems', options: {
        none: opt('Basic sights', 'Nothing extra.', [0, 0, 0, 0.5], 0.95),
        thermal: opt('Thermal sights', 'Fights at night and through smoke.', [1, 0.5, 0, 0], 1.06, 1, ['army', 4]),
        network: opt('Battle network', 'Every tank sees what the others see.', [1.5, 0.5, 0.5, 0], 1.12, 1.05, ['cyber', 6]),
        autoloader: opt('Autoloader', 'A crew of three, a smaller turret, faster fire.', [1, 0.5, 0.5, -0.5], 1.08, 1, ['industry', 6]),
      } },
    },
  },
  vehicles: {
    name: 'Armoured vehicle', plural: 'vehicles', axes: ['Firepower', 'Protection', 'Mobility', 'Capacity'],
    slots: {
      role: { name: 'Role', options: {
        truck: opt('Logistics truck', 'Carries fuel, food and shells to the front.', [-2, -2, 1, 3], 0.6, 0.7),
        apc: opt('Armoured carrier', 'Takes a squad into battle under armour.', [0, 0, 0, 1]),
        ifv: opt('Infantry fighting vehicle', 'Carries a squad and fights beside it.', [1.5, 0.5, 0, 0], 1.3, 1.1, ['army', 5]),
        mrap: opt('Mine-protected vehicle', 'Built to survive roadside bombs.', [-0.5, 2, -0.5, 1], 1.15, 1, ['army', 4]),
      } },
      drive: { name: 'Drive', options: {
        wheels: opt('Wheels, 8×8', 'Fast on roads, cheap to run.', [0, 0, 2, 0.5], 0.9),
        tracks: opt('Tracks', 'Goes anywhere, slowly.', [0, 1, -0.5, 0], 1.1),
        hybrid: opt('Hybrid drive', 'Quiet, fast and frugal.', [0, 0, 2.5, 1], 1.25, 1.05, ['industry', 8]),
      } },
      armour: { name: 'Armour', options: {
        light: opt('Light armour', 'Stops rifle fire.', [0, -1, 1, 0.5], 0.85),
        medium: opt('Medium armour', 'Stops heavy machine guns and shell splinters.', [0, 1, 0, 0], 1.05),
        heavy: opt('Heavy armour', 'Stops cannon fire.', [0, 2.5, -1.5, -0.5], 1.25, 1.1, ['army', 6]),
      } },
      weapon: { name: 'Weapon', options: {
        mg: opt('Machine gun', 'For self-defence.', [0, 0, 0, 0.5], 0.95),
        cannon: opt('30 mm autocannon', 'Shreds light vehicles.', [2, 0, -0.5, -0.5], 1.15, 1, ['army', 4]),
        atgm: opt('Anti-tank missiles', 'Kills tanks from 4 km.', [3, 0, -0.5, -0.5], 1.3, 1.05, ['missile', 5]),
        drone: opt('Drone launcher', 'Scouts and strikes over the next hill.', [2.5, 0.5, 0, 0], 1.3, 1.05, ['cyber', 7]),
      } },
    },
  },
  aircraft: {
    name: 'Combat aircraft', plural: 'aircraft', axes: ['Air combat', 'Strike', 'Range & speed', 'Stealth'],
    slots: {
      role: { name: 'Role', options: {
        fighter: opt('Air superiority fighter', 'Wins the sky.', [3, -1, 1, 0], 1.05),
        multirole: opt('Multirole', 'Fights and bombs.', [1, 1, 0, 0]),
        attack: opt('Ground attack', 'Low, slow and deadly to tanks.', [-1, 3, -1, -0.5], 0.85, 0.9),
        bomber: opt('Bomber', 'Carries a huge load a long way.', [-2, 3.5, 1.5, -1], 1.6, 1.3, ['air', 6]),
      } },
      engine: { name: 'Engines', options: {
        single: opt('One engine', 'Light and cheap.', [0, -0.5, 0, 0.5], 0.8, 0.9),
        twin: opt('Two engines', 'Power and a second chance.', [0.5, 0.5, 1, 0], 1.1),
        supercruise: opt('Supercruise engines', 'Supersonic without afterburner.', [1.5, 0, 2, 0.5], 1.35, 1.1, ['air', 8]),
      } },
      airframe: { name: 'Airframe', options: {
        swept: opt('Swept wing', 'Conventional and proven.', [0, 0, 0, 0], 0.95),
        delta: opt('Delta canard', 'Agile at every speed.', [1, 0, 0.5, 0], 1.08, 1, ['air', 5]),
        stealth: opt('Stealth shape', 'Barely shows on radar.', [0.5, 0.5, 0, 3], 1.5, 1.25, ['air', 8]),
      } },
      sensors: { name: 'Radar & sensors', options: {
        pulse: opt('Pulse-Doppler radar', 'The old standard.', [0, 0, 0, 0], 0.95),
        aesa: opt('AESA radar', 'Sees first, jams and shoots first.', [1.5, 1, 0, 0.5], 1.15, 1.05, ['air', 6]),
        fusion: opt('Sensor fusion', 'Every sensor, and every friend, in one picture.', [2, 1.5, 0, 1], 1.3, 1.1, ['cyber', 8]),
      } },
      weapons: { name: 'Weapons', options: {
        bombs: opt('Unguided bombs', 'Cheap and plentiful.', [0, 0.5, 0, 0], 0.95),
        guided: opt('Guided bombs', 'Hits what it is aimed at.', [0, 2, 0, 0], 1.1, 1, ['missile', 5]),
        cruise: opt('Stand-off missiles', 'Strikes from beyond the air defences.', [0.5, 2.5, 0.5, 0.5], 1.25, 1.05, ['missile', 7]),
      } },
    },
  },
  ships: {
    name: 'Warship', plural: 'warships', axes: ['Firepower', 'Air defence', 'Speed', 'Endurance'],
    slots: {
      hull: { name: 'Hull', options: {
        corvette: opt('Corvette', '2,000 tonnes: coastal, cheap and quick to build.', [-1.5, -1, 1.5, -1.5], 0.6, 0.6),
        frigate: opt('Frigate', '6,000 tonnes: the workhorse.', [0, 0, 0, 0]),
        destroyer: opt('Destroyer', '9,000 tonnes: a fleet\'s shield.', [1, 1.5, 0, 1], 1.35, 1.2, ['naval', 5]),
        cruiser: opt('Cruiser', '15,000 tonnes: a floating arsenal.', [2.5, 2, -1, 1.5], 1.8, 1.4, ['naval', 7]),
      } },
      propulsion: { name: 'Propulsion', options: {
        diesel: opt('Diesel', 'Economical.', [0, 0, -0.5, 1], 0.9),
        turbine: opt('Gas turbine', 'Fast.', [0, 0, 1.5, 0], 1.08),
        nuclear: opt('Nuclear reactor', 'Sails for years without refuelling.', [0, 0, 1, 3], 1.6, 1.25, ['nuclear', 7]),
      } },
      weapons: { name: 'Main weapons', options: {
        guns: opt('Guns and torpedoes', 'Close-range punch.', [0, 0, 0, 0], 0.9),
        vls: opt('Missile cells (VLS)', 'Dozens of anti-ship and land-attack missiles.', [2, 1, 0, 0], 1.25, 1.05, ['missile', 5]),
        hypersonic: opt('Hypersonic missiles', 'Nearly impossible to intercept.', [3.5, 0, 0, 0], 1.45, 1.15, ['missile', 9]),
      } },
      sensors: { name: 'Radar', options: {
        basic: opt('Search radar', 'Sees what is coming.', [0, 0, 0, 0], 0.95),
        aegis: opt('Phased-array (Aegis)', 'Tracks hundreds of targets at once.', [0.5, 2.5, 0, 0], 1.25, 1.1, ['naval', 6]),
        laser: opt('Phased array + lasers', 'Burns down drones and missiles.', [0.5, 3.5, 0, 0], 1.45, 1.15, ['naval', 9]),
      } },
      deck: { name: 'Deck', options: {
        none: opt('No helicopter', 'More room for weapons.', [0.5, 0, 0, 0], 0.97),
        helo: opt('Helicopter deck', 'Hunts submarines over the horizon.', [0, 0.5, 0, 0.5], 1.05),
        drones: opt('Drone deck', 'Swarms that scout and strike.', [1, 0.5, 0, 0.5], 1.15, 1.05, ['cyber', 7]),
      } },
    },
  },
};

// A design's figures: its four axes (0 to 10), cost and build-time multipliers, edge, and any part it can't use yet
export function designStats(kind, parts, tech = null) {
  const k = DESIGN_KINDS[kind];
  if (!k) return null;
  const axes = [5, 5, 5, 5];
  let cost = 1;
  let weeks = 1;
  const locked = [];
  for (const [slot, def] of Object.entries(k.slots)) {
    const o = def.options[parts?.[slot]] ?? def.options[Object.keys(def.options)[1] ?? Object.keys(def.options)[0]];
    o.axes.forEach((v, i) => { axes[i] += v; });
    cost *= o.cost;
    weeks *= o.weeks;
    if (tech && o.tech && (tech[o.tech[0]] ?? 0) < o.tech[1]) locked.push(`${o.name} needs ${TECH_FIELDS[o.tech[0]].name} level ${o.tech[1]}`);
  }
  const clamped = axes.map((v) => clamp(Math.round(v * 10) / 10, 0, 10));
  // How much better than the standard model (5 on every axis), with the main role counting double
  const score = clamped.reduce((t, v, i) => t + (v - 5) * (i === 0 ? 1.5 : 1), 0);
  const edge = clamp(1 + score * 0.035, 0.75, 1.4);
  return { axes: clamped, cost: Math.round(cost * 100) / 100, weeks: Math.round(weeks * 100) / 100, edge: Math.round(edge * 100) / 100, locked };
}

// The parts a new design starts with: the standard option in every slot
export function defaultParts(kind) {
  const k = DESIGN_KINDS[kind];
  return Object.fromEntries(Object.entries(k.slots).map(([slot, def]) => {
    const keys = Object.keys(def.options);
    return [slot, keys[1] ?? keys[0]];
  }));
}

export function saveDesign(s, c, { kind, name, parts, id }) {
  const k = DESIGN_KINDS[kind];
  if (!k) return 'Pick what to design.';
  name = String(name ?? '').trim().slice(0, 40);
  if (!name) return 'Give the design a name.';
  const clean = {};
  for (const [slot, def] of Object.entries(k.slots)) {
    if (!def.options[parts?.[slot]]) return `Pick a ${def.name.toLowerCase()}.`;
    clean[slot] = parts[slot];
  }
  const st = designStats(kind, clean, c.tech);
  if (st.locked.length) return `Not yet: ${st.locked.join('; ')}.`;
  c.designs ??= {};
  if (id) {
    const d = c.designs[id];
    if (!d) return 'That design is gone.';
    if (d.built > 0) return 'Factories are already building that design: save your changes as a new one.';
    Object.assign(d, { name, parts: clean, kind });
    return null;
  }
  if (Object.keys(c.designs).length >= MAX_DESIGNS) return `You can keep ${MAX_DESIGNS} designs. Delete one first.`;
  if (Object.values(c.designs).some((d) => d.name.toLowerCase() === name.toLowerCase())) return 'You already have a design by that name.';
  const nid = nextId(s, 'ds');
  c.designs[nid] = { id: nid, kind, name, parts: clean, since: s.week, built: 0 };
  return null;
}

export function deleteDesign(s, c, { id }) {
  if (!c.designs?.[id]) return 'No such design.';
  if (c.queue.some((o) => o.design === id)) return 'Factories are still building it. Cancel those orders first.';
  delete c.designs[id];
  return null;
}

// What an arm of the forces is worth against a standard one (1)
export const edgeOf = (c, kind) => c?.edge?.[kind] ?? 1;

// New units built to a design join the rest: the arm's edge moves toward the design's, by the share they make up
export function delivered(c, kind, qty, design) {
  const st = design ? designStats(design.kind, design.parts) : null;
  const edge = st?.edge ?? 1;
  const before = Math.max(0, (c[kind] ?? 0) - qty);
  c.edge ??= {};
  const was = c.edge[kind] ?? 1;
  c.edge[kind] = Math.round(((was * before + edge * qty) / Math.max(1, before + qty)) * 1000) / 1000;
  if (design) design.built = (design.built ?? 0) + qty;
}

