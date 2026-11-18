// The fleet: fast warships, from a 16 m interceptor to a 72 m strike carrier, all built for speed. Bigger ships
// are tougher and hit harder but are slower to get going and to turn; the carrier launches strike jets.
//
// Every ship carries four weapons, one per slot, chosen to suit its size:
//   gun      a machine gun or a rotary close-in weapon system: fast, short-ranged, overheats on long bursts
//   cannon   a naval gun firing explosive shells on an arc, with splash damage
//   missile  fire-and-forget anti-ship missiles (or, on the destroyer, heavy cruise missiles): hold a target ahead
//            to lock on, and they skim the water and turn onto it
//   air      a strike drone, or (from the carrier) a strike jet, that flies out to the target and bombs it

export const BOATS = {
  interceptor: {
    name: 'Interceptor', role: 'Fast attack boat', note: 'A 16 m stepped-hull racer: the quickest ship afloat, with the thinnest armour.',
    hp: 120, top: 48, accel: 17, turn: 1.25, grip: 3.2, mass: 1, length: 16, beam: 3.8,
    loadout: { gun: 'hmg', cannon: 'c30', missile: 'asm', air: 'drone' }, ammo: { cannon: 60, missile: 3, air: 1 },
    stats: { speed: 10, armour: 3, guns: 4, air: 2 },
  },
  corvette: {
    name: 'Corvette', role: 'Stealth corvette', note: 'A 30 m angular stealth warship with a 57 mm gun, a rotary cannon, anti-ship missiles and two strike drones.',
    hp: 210, top: 44, accel: 13, turn: 1.0, grip: 3.6, mass: 2.4, length: 30, beam: 7,
    loadout: { gun: 'ciws', cannon: 'c57', missile: 'asm', air: 'drone' }, ammo: { cannon: 80, missile: 6, air: 2 },
    stats: { speed: 8, armour: 5, guns: 6, air: 4 },
  },
  destroyer: {
    name: 'Destroyer', role: 'Missile destroyer', note: 'A 48 m fast destroyer: a 76 mm gun forward and a deck of vertical launch cells for heavy cruise missiles.',
    hp: 310, top: 41, accel: 10, turn: 0.82, grip: 4, mass: 4, length: 48, beam: 10,
    loadout: { gun: 'ciws', cannon: 'c76', missile: 'cruise', air: 'drone' }, ammo: { cannon: 90, missile: 6, air: 2 },
    stats: { speed: 7, armour: 7, guns: 9, air: 4 },
  },
  carrier: {
    name: 'Strike Carrier', role: 'Fast aircraft carrier', note: 'A 72 m wave-piercing carrier: a full flight deck of strike jets that bomb anything you lock on to.',
    hp: 430, top: 38, accel: 8, turn: 0.66, grip: 4.4, mass: 7, length: 72, beam: 18,
    loadout: { gun: 'ciws', cannon: 'c57', missile: 'asm', air: 'jet' }, ammo: { cannon: 60, missile: 4, air: 4 },
    stats: { speed: 6, armour: 10, guns: 5, air: 10 },
  },
};

export const SLOTS = ['gun', 'cannon', 'missile', 'air'];

export const WEAPONS = {
  // Guns
  hmg: { slot: 'gun', name: '12.7 mm machine gun', rate: 11, speed: 880, life: 0.6, damage: 1.8, spread: 0.012, heatPerShot: 0.05, cool: 0.32, gravity: 2 },
  ciws: { slot: 'gun', name: '30 mm rotary cannon', rate: 18, speed: 1000, life: 0.75, damage: 1.3, spread: 0.01, heatPerShot: 0.034, cool: 0.3, gravity: 2, tracer: 1.6 },
  // Naval guns
  c30: { slot: 'cannon', name: '30 mm autocannon', rate: 1.6, speed: 430, life: 2.6, damage: 16, splash: 7, splashDamage: 8, spread: 0.006, gravity: 9.81, size: 1 },
  c57: { slot: 'cannon', name: '57 mm naval gun', rate: 1.3, speed: 470, life: 3, damage: 26, splash: 10, splashDamage: 12, spread: 0.005, gravity: 9.81, size: 1.5 },
  c76: { slot: 'cannon', name: '76 mm naval gun', rate: 1.0, speed: 500, life: 3.4, damage: 36, splash: 13, splashDamage: 16, spread: 0.004, gravity: 9.81, size: 2 },
  // Missiles
  asm: { slot: 'missile', name: 'Anti-ship missile', rate: 1.2, speed: 170, launch: 55, accel: 140, life: 7, damage: 60, splash: 13, splashDamage: 22, turn: 1.9, lockTime: 1.1, lockRange: 800, lockCone: 0.42, reload: 14, size: 1.4 },
  cruise: { slot: 'missile', name: 'Heavy cruise missile', rate: 0.8, speed: 150, launch: 35, accel: 90, life: 11, damage: 115, splash: 24, splashDamage: 40, turn: 1.2, lockTime: 1.6, lockRange: 1300, lockCone: 0.5, reload: 18, size: 2.6, vertical: true },
  // Aircraft, and the bombs they drop
  drone: { slot: 'air', name: 'Strike drone', speed: 95, life: 26, altitude: 45, bombs: 2, bomb: 'bomb', reload: 20, rate: 0.6, size: 1 },
  jet: { slot: 'air', name: 'Strike jet', speed: 165, life: 30, altitude: 70, bombs: 4, bomb: 'heavybomb', reload: 22, rate: 0.7, size: 1 },
  bomb: { slot: 'none', name: '250 kg bomb', life: 12, damage: 40, splash: 15, splashDamage: 22, gravity: 9.81, size: 1 },
  heavybomb: { slot: 'none', name: '500 kg bomb', life: 12, damage: 55, splash: 20, splashDamage: 30, gravity: 9.81, size: 1.5 },
};

// Where on a ship each slot fires from: [forward, as a share of the length; height above the water, in metres]
export function mountOf(k, slot) {
  const H = k.beam * 0.34;
  if (k.length <= 20) return { gun: [0.42, H + 1.6], cannon: [0.05, H + 2.4], missile: [-0.2, H + 1.6], air: [-0.38, H + 1] }[slot];
  if (k.length >= 60) return { gun: [0.46, H + 6], cannon: [0.47, H + 2.5], missile: [-0.42, H + 5], air: [0.2, H + 3.5] }[slot];
  return { gun: [-0.12, H + 7], cannon: [0.34, H + 2.6], missile: [0.08, H + 2.4], air: [-0.4, H + 1.6] }[slot];
}

export const AIM_CONE = 0.55; // radians either side of the bow the guns swing to track a target
export const AIM_RANGE = 620;
// Weapons are locked on the starting grid: they arm at the first gate
export const ARM_GATE = 1;
export const RESPAWN = 3; // seconds after being sunk
export const SHIELD = 2.5; // seconds of protection after respawning
export const BOAT_COLORS = ['#e63946', '#2a9df4', '#f4a261', '#2ec4b6', '#9b5de5', '#f1c40f', '#ff6fb5', '#e8eef2'];
export const MAX_LENGTH = 72;
