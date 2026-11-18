// The boats and what they carry. Every boat mounts the same three weapons, modelled on real ones: a 12.7 mm heavy
// machine gun on the bow (fast, short-ranged, overheats), a 30 mm autocannon (explosive shells on an arc), and a
// pod of fire-and-forget anti-ship missiles that need a lock. The classes trade speed for armour.

export const BOATS = {
  interceptor: {
    name: 'Interceptor', note: 'A 12 m stepped-hull racer: the fastest boat on the water, and the thinnest armour.',
    hp: 80, top: 46, accel: 15, turn: 1.25, grip: 3.2, mass: 0.8, length: 12, beam: 2.8, missiles: 3, shells: 50,
  },
  gunboat: {
    name: 'Gunboat', note: 'A 14 m strike craft: balanced speed, armour and firepower.',
    hp: 110, top: 41, accel: 12.5, turn: 1.1, grip: 3.6, mass: 1, length: 14, beam: 3.3, missiles: 4, shells: 70,
  },
  patrol: {
    name: 'Armoured Patrol', note: 'A 16 m armoured patrol boat: slow to start, hard to stop, and carries the most ammunition.',
    hp: 150, top: 36, accel: 10, turn: 0.95, grip: 4, mass: 1.35, length: 16, beam: 3.8, missiles: 6, shells: 100,
  },
};

export const WEAPONS = {
  hmg: {
    name: '12.7 mm heavy machine gun', short: 'HMG', rate: 11, speed: 880, life: 0.55, damage: 1.1, spread: 0.012,
    heatPerShot: 0.05, cool: 0.32, gravity: 2,
  },
  cannon: {
    name: '30 mm autocannon', short: 'Cannon', rate: 1.5, speed: 420, life: 2.6, damage: 11, splash: 6, splashDamage: 6,
    spread: 0.006, gravity: 9.81,
  },
  missile: {
    name: 'Anti-ship missile', short: 'Missile', rate: 1.2, speed: 165, launch: 55, accel: 140, life: 7, damage: 38,
    splash: 11, splashDamage: 16, turn: 1.9, lockTime: 1.1, lockRange: 750, lockCone: 0.42, reload: 14,
  },
};

// Where on the boat each weapon fires from (metres: forward of centre, height above the water)
export const MOUNTS = { hmg: [0.42, 2.1], cannon: [0.05, 2.9], missile: [-0.2, 2.2] };

export const AIM_CONE = 0.55; // radians either side of the bow the turrets swing to track a target
export const AIM_RANGE = 520;
// Weapons are locked on the starting grid: they arm at the first gate
export const ARM_GATE = 1;
export const RESPAWN = 3; // seconds after being sunk
export const SHIELD = 2.5; // seconds of protection after respawning
export const BOAT_COLORS = ['#e63946', '#2a9df4', '#f4a261', '#2ec4b6', '#9b5de5', '#f1c40f', '#ff6fb5', '#e8eef2'];
