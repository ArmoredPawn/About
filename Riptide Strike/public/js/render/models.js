// Everything on the water and in the air, modelled in code: the ships (the interceptor's deep-V planing hull with
// cockpit, outboards and deck guns; the corvette's and destroyer's stealthy superstructures, gun turrets, rotary
// close-in guns, missile cells and drone decks; the carrier's flight deck, island and parked jets), strike jets and
// drones, missiles and bombs, the race pylons, islands with beaches, grass, cliffs and palms, rocks, and the
// floating supply crates.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng } from '../sim/track.js';

const mats = new Map();
function mat(key, make) { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); }
const gunmetal = () => mat('gun', () => new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.75, roughness: 0.38 }));
const darkMetal = () => mat('dark', () => new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.45 }));
const white = () => mat('white', () => new THREE.MeshPhysicalMaterial({ color: 0xf2f4f5, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
const glass = () => mat('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x223040, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.55, envMapIntensity: 1.6 }));
const rubber = () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.85 }));

/* ---------- Boats ---------- */

// The hull: cross-sections from transom to bow, lofted into a surface. Painted the boat's colour above the chine
// line, white below, with a dark boot stripe at the waterline.
function hullGeometry(L, B, D, H, color, scheme = 'racer') {
  const stations = 28;
  const side = 6;
  const pos = [];
  const col = [];
  const c = new THREE.Color(color);
  const w = new THREE.Color(0xf4f6f7);
  const boot = new THREE.Color(0x101418);
  // Warships: naval grey, a band of the ship's colour along the deck edge, red antifouling below the waterline
  const grey = new THREE.Color(0x6c757d);
  const antifoul = new THREE.Color(0x6e2a26);
  const ring = [];
  for (let s = 0; s <= stations; s++) {
    const u = s / stations;
    const z = -L / 2 + u * L;
    const half = (B / 2) * (u < 0.6 ? 1 - 0.05 * (0.6 - u) : Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.4) ** 1.8))) + (u >= 0.999 ? 0 : 0.001);
    const keel = D * (u < 0.7 ? 1 : 1 - ((u - 0.7) / 0.3) ** 1.4 * 0.9);
    const sheer = H + (u > 0.55 ? ((u - 0.55) / 0.45) ** 2 * H * 0.55 : 0);
    // Deck edge, topsides, chine, bottom, keel (one side; the other mirrors it)
    const pts = [[half, sheer], [half * 1.01, sheer * 0.35], [half * 0.97, -keel * 0.18], [half * 0.82, -keel * 0.26], [half * 0.42, -keel * 0.62], [0, -keel]];
    const row = [];
    for (let k = 0; k < side; k++) row.push(pts[k]);
    for (let k = side - 2; k >= 0; k--) row.push([-pts[k][0], pts[k][1]]);
    ring.push({ z, row, sheer });
  }
  const paint = scheme === 'navy'
    ? (y, sheer) => (y > sheer * 0.8 ? c : y > 0.05 ? grey : y > -0.25 ? boot : antifoul)
    : (y) => (y > 0.05 ? c : y > -0.12 ? boot : w);
  // The sides: one ring of vertices per station, joined to the next (shared vertices, so the hull shades smoothly)
  const per = ring[0].row.length;
  for (const r of ring) for (const [x, y] of r.row) { pos.push(x, y, r.z); const cc = paint(y, r.sheer); col.push(cc.r, cc.g, cc.b); }
  const idx = [];
  for (let s = 0; s < stations; s++) {
    for (let k = 0; k < per - 1; k++) {
      const a0 = s * per + k;
      const b0 = (s + 1) * per + k;
      idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  // The transom: a flat stern face with vertices of its own
  const base = pos.length / 3;
  const t0 = ring[0];
  for (const [x, y] of t0.row) { pos.push(x, y, t0.z); const cc = paint(y, t0.sheer); col.push(cc.r, cc.g, cc.b); }
  for (let k = 1; k < per - 1; k++) idx.push(base, base + k + 1, base + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, deckAt: (u) => { const r = ring[Math.round(u * stations)]; return { half: r.row[0][0], y: r.row[0][1], z: r.z }; } };
}

// The deck: a flat, slightly cambered surface inside the sheer line
function deckGeometry(hull, L) {
  const shape = new THREE.Shape();
  const n = 20;
  const pts = [];
  for (let s = 0; s <= n; s++) { const d = hull.deckAt(s / n); pts.push([d.half * 0.98, d.z, d.y]); }
  // Drawn in the plane with y = −z, then laid flat (facing up)
  shape.moveTo(-pts[0][0], -pts[0][1]);
  for (const [x, z] of pts) shape.lineTo(x, -z);
  for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(-pts[i][0], -pts[i][1]);
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  // Follow the sheer: raise each vertex to the deck height at its station
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const z = pa.getZ(i);
    const u = Math.max(0, Math.min(1, (z + L / 2) / L));
    const d = hull.deckAt(u);
    pa.setY(i, d.y - 0.02 + 0.04 * (1 - Math.abs(pa.getX(i)) / Math.max(0.1, d.half)));
  }
  g.computeVertexNormals();
  return g;
}

// Any ship: the interceptor is a racing powerboat; the rest are warships
export function makeBoat(cls, k, color, number = 1) {
  return cls === 'interceptor' ? makeRacer(cls, k, color) : makeWarship(cls, k, color, number);
}

function makeRacer(cls, k, color) {
  const L = k.length;
  const B = k.beam;
  const D = B * 0.3;
  const H = B * 0.34;
  const group = new THREE.Group();
  const hullMat = mat(`hull${color}`, () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide }));
  const hull = hullGeometry(L, B, D, H, color);
  const hullMesh = new THREE.Mesh(hull.geometry, hullMat);
  hullMesh.castShadow = true;
  group.add(hullMesh);
  const deckMat = mat(`deck${cls}`, () => new THREE.MeshStandardMaterial({ color: cls === 'patrol' ? 0x6b7166 : 0xd9d6cf, roughness: 0.75 }));
  const deck = new THREE.Mesh(deckGeometry(hull, L), deckMat);
  deck.receiveShadow = true;
  group.add(deck);
  const paintMat = mat(`paint${color}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }));

  // The cockpit: a low cabin with a raked windscreen
  const cabinW = B * 0.62;
  const cabinL = L * (cls === 'patrol' ? 0.34 : 0.26);
  const cabinH = cls === 'patrol' ? 1.6 : 1.05;
  const cz = -L * 0.08;
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(cabinW, cabinH, cabinL, 3, 0.25), cls === 'patrol' ? gunmetal() : paintMat);
  const deckY = hull.deckAt(0.45).y;
  cabin.position.set(0, deckY + cabinH / 2, cz);
  cabin.castShadow = true;
  group.add(cabin);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.96, cabinH * 0.75, 0.06), glass());
  screen.position.set(0, deckY + cabinH * 0.95, cz + cabinL / 2 - 0.1);
  screen.rotation.x = -0.65;
  group.add(screen);
  // A radar mast with a turning scanner
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 8), gunmetal());
  mast.position.set(0, deckY + cabinH + 0.8, cz - cabinL * 0.25);
  group.add(mast);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.18), white());
  radar.position.set(0, deckY + cabinH + 1.62, cz - cabinL * 0.25);
  group.add(radar);

  // Twin outboard motors on the transom
  for (const s of [-1, 1]) {
    const eng = new THREE.Group();
    const cowl = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.9, 0.8, 2, 0.15), cls === 'interceptor' ? paintMat : darkMetal());
    cowl.position.y = 0.9;
    cowl.castShadow = true;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.35), darkMetal());
    leg.position.y = -0.1;
    eng.add(cowl, leg);
    eng.position.set(s * B * 0.2, 0, -L / 2 - 0.3);
    group.add(eng);
  }

  // The 12.7 mm machine gun on the bow, on a turning mount
  const hmg = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.25, 16), gunmetal());
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 1.0), darkMetal());
  body.position.set(0, 0.42, 0.1);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.4, 10), darkMetal());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.45, 1.25);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), gunmetal());
  shield.position.set(0, 0.45, 0.45);
  hmg.add(ring, body, barrel, shield);
  const bow = hull.deckAt(0.78);
  hmg.position.set(0, bow.y + 0.1, bow.z);
  hmg.traverse((m) => { m.castShadow = true; });
  group.add(hmg);

  // The 30 mm autocannon turret on the cabin roof
  const cannon = new THREE.Group();
  const turret = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.5, 1.3, 2, 0.12), gunmetal());
  turret.position.y = 0.25;
  const cBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 12), darkMetal());
  cBarrel.rotation.x = Math.PI / 2;
  cBarrel.position.set(0, 0.32, 1.6);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 10), darkMetal());
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.32, 2.7);
  cannon.add(turret, cBarrel, brake);
  cannon.position.set(0, deckY + cabinH, cz + cabinL * 0.1);
  cannon.traverse((m) => { m.castShadow = true; });
  group.add(cannon);

  // A missile pod on each side: four tubes, angled up
  for (const s of [-1, 1]) {
    const pod = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 1.9), gunmetal());
    pod.add(box);
    for (const [ox, oy] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) {
      const tube = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), rubber());
      tube.position.set(ox, oy, 0.96);
      pod.add(tube);
    }
    const at = hull.deckAt(0.22);
    pod.position.set(s * (at.half - 0.35), at.y + 0.45, at.z + 0.4);
    pod.rotation.x = -0.12;
    pod.castShadow = true;
    group.add(pod);
  }
  // A racing number panel on each side of the cabin
  group.userData = { hmg, cannon, radar, length: L, beam: B };
  return group;
}

/* ---------- Warships ---------- */

const navyGrey = () => mat('navy', () => new THREE.MeshStandardMaterial({ color: 0x737d86, roughness: 0.66, metalness: 0.15 }));
const navyDark = () => mat('navyDark', () => new THREE.MeshStandardMaterial({ color: 0x3e464e, roughness: 0.7, metalness: 0.2 }));
const deckMat = () => mat('deckNavy', () => new THREE.MeshStandardMaterial({ color: 0x4a5056, roughness: 0.92 }));
const domeMat = () => mat('dome', () => new THREE.MeshStandardMaterial({ color: 0xe9ecee, roughness: 0.5 }));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A block whose top is narrower than its base: the faceted look of a stealth warship
function stealthBlock(w, h, l, taper = 0.22, m = navyGrey()) {
  const g = new THREE.BoxGeometry(w, h, l);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (1 - taper)); p.setZ(i, p.getZ(i) * (1 - taper * 0.45)); }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A naval gun: a faceted turret and a long barrel, on a turning mount
function navalGun(scale) {
  const pivot = new THREE.Group();
  const turret = stealthBlock(2.4 * scale, 1.4 * scale, 3.2 * scale, 0.32);
  turret.position.y = 0.7 * scale;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.17 * scale, 4.8 * scale, 12), navyDark());
  barrel.rotation.x = Math.PI / 2 - 0.05;
  barrel.position.set(0, 0.8 * scale, 3.6 * scale);
  barrel.castShadow = true;
  pivot.add(turret, barrel);
  return pivot;
}

// A close-in weapon system: a white radar dome over a six-barrelled rotary cannon
function ciws(scale = 1) {
  const pivot = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * scale, 1.1 * scale, 0.9 * scale, 16), navyGrey());
  base.position.y = 0.45 * scale;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75 * scale, 0.75 * scale, 1.2 * scale, 16), domeMat());
  body.position.y = 1.5 * scale;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.75 * scale, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat());
  dome.position.y = 2.1 * scale;
  const guns = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 2.4 * scale, 6), navyDark());
    tube.rotation.x = Math.PI / 2;
    tube.position.set(Math.cos(a) * 0.16 * scale, Math.sin(a) * 0.16 * scale, 0);
    guns.add(tube);
  }
  guns.position.set(0, 1.1 * scale, 1.5 * scale);
  pivot.add(base, body, dome, guns);
  pivot.traverse((m) => { m.castShadow = true; });
  pivot.userData.spin = guns;
  return pivot;
}

// A mast with radar panels and a turning scanner
function mast(height, scale = 1) {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6 * scale, height, 4), navyGrey());
  cone.rotation.y = Math.PI / 4;
  cone.position.y = height / 2;
  cone.castShadow = true;
  g.add(cone);
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1 * scale, 1.1 * scale, 0.1), navyDark());
    panel.position.set(s * 0.55 * scale, height * 0.45, 0.62 * scale);
    panel.rotation.y = s * 0.6;
    g.add(panel);
  }
  const scanner = new THREE.Mesh(new THREE.BoxGeometry(2.6 * scale, 0.22 * scale, 0.5 * scale), domeMat());
  scanner.position.y = height + 0.3;
  g.add(scanner);
  g.userData.scanner = scanner;
  return g;
}

function hullNumber(number) {
  return canvasTex(256, 128, (x, w, h) => {
    x.font = '900 100px Inter, system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillStyle = '#f1f3f4';
    x.strokeStyle = 'rgba(0,0,0,0.6)';
    x.lineWidth = 6;
    x.strokeText(String(number).padStart(2, '0'), w / 2, h * 0.8);
    x.fillText(String(number).padStart(2, '0'), w / 2, h * 0.8);
  });
}

// A deck pad for drones (or a helicopter): a circle and an H
function landingPad(size) {
  const tex = canvasTex(256, 256, (x) => {
    x.fillStyle = '#3c4247'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#f2d34a'; x.lineWidth = 10; x.beginPath(); x.arc(128, 128, 100, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#ffffff'; x.fillRect(84, 70, 22, 116); x.fillRect(150, 70, 22, 116); x.fillRect(84, 117, 88, 22);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

// Vertical launch cells: a grid of hatches in the deck
function vlsGrid(w, l) {
  const tex = canvasTex(256, 256, (x) => {
    x.fillStyle = '#2f3439'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = '#4b5258'; x.fillRect(12 + i * 61, 12 + j * 61, 50, 50); x.strokeStyle = '#1b1e21'; x.lineWidth = 3; x.strokeRect(12 + i * 61, 12 + j * 61, 50, 50); }
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, l), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  m.receiveShadow = true;
  return m;
}

// The carrier's flight deck: dark non-skid, white edge lines, a yellow centre line, the angled landing area and
// its number at the bow
function flightDeckTexture(number) {
  return canvasTex(256, 1024, (x, w, h) => {
    x.fillStyle = '#34393e'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    x.strokeStyle = '#e8e8e8'; x.lineWidth = 5; x.setLineDash([]);
    x.strokeRect(10, 10, w - 20, h - 20);
    x.strokeStyle = '#f2c23a'; x.lineWidth = 4; x.setLineDash([30, 22]);
    x.beginPath(); x.moveTo(w * 0.45, h * 0.97); x.lineTo(w * 0.45, h * 0.05); x.stroke();
    x.strokeStyle = '#ffffff'; x.setLineDash([24, 18]);
    x.beginPath(); x.moveTo(w * 0.3, h * 0.95); x.lineTo(w * 0.62, h * 0.4); x.stroke();
    x.setLineDash([]);
    x.fillStyle = '#ffffff';
    x.font = '900 120px Inter, system-ui, sans-serif';
    x.textAlign = 'center';
    x.save(); x.translate(w * 0.5, h * 0.16); x.rotate(Math.PI); x.fillText(String(number).padStart(2, '0'), 0, 40); x.restore();
    // Catapult tracks at the bow
    x.strokeStyle = '#1e2226'; x.lineWidth = 4;
    for (const cx of [w * 0.35, w * 0.6]) { x.beginPath(); x.moveTo(cx, h * 0.04); x.lineTo(cx, h * 0.3); x.stroke(); }
  });
}

function makeWarship(cls, k, color, number) {
  const L = k.length;
  const B = k.beam;
  const D = B * 0.38;
  const H = B * 0.34;
  const group = new THREE.Group();
  const hull = hullGeometry(L, B, D, H, color, 'navy');
  const hullMat = mat('navyHull', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.15, side: THREE.DoubleSide }));
  const hullMesh = new THREE.Mesh(hull.geometry, hullMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  group.add(hullMesh);
  const deck = new THREE.Mesh(deckGeometry(hull, L), deckMat());
  deck.receiveShadow = true;
  group.add(deck);
  const at = (u) => hull.deckAt(u);
  // Hull numbers on both bows
  const num = new THREE.MeshBasicMaterial({ map: hullNumber(number), transparent: true, depthWrite: false });
  for (const s of [-1, 1]) {
    const bow = at(0.8);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(B * 0.55, B * 0.28), num);
    plate.position.set(s * (bow.half + 0.05), bow.y * 0.55, bow.z);
    plate.rotation.y = s * Math.PI / 2;
    group.add(plate);
  }
  let gunPivot;
  let cannonPivot;
  let radar;
  if (cls === 'carrier') {
    // The flight deck, overhanging the hull, raised on the hangar
    const deckY = H + 3.2;
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(B * 0.92, 3.2, L * 0.8), navyGrey());
    hangar.position.set(0, H + 1.6, -L * 0.04);
    hangar.castShadow = true;
    group.add(hangar);
    const fd = new THREE.Mesh(new THREE.BoxGeometry(B * 1.45, 0.8, L * 0.97), [navyDark(), navyDark(), new THREE.MeshStandardMaterial({ map: flightDeckTexture(number), roughness: 0.9 }), navyDark(), navyDark(), navyDark()]);
    fd.position.set(B * 0.12, deckY + 0.4, -L * 0.01);
    fd.castShadow = true;
    fd.receiveShadow = true;
    group.add(fd);
    // The island: bridge, funnel and mast, on the starboard side
    const island = stealthBlock(4.6, 9, 15, 0.18);
    island.position.set(-B * 0.55, deckY + 5.3, -L * 0.06);
    group.add(island);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4.7, 1.1, 6), glass());
    bridge.position.set(-B * 0.55, deckY + 8.4, -L * 0.06 + 4.5);
    group.add(bridge);
    const m = mast(9, 1.2);
    m.position.set(-B * 0.55, deckY + 9.8, -L * 0.09);
    group.add(m);
    radar = m.userData.scanner;
    // Strike jets parked along the port side, and one on the catapult
    for (let i = 0; i < 4; i++) {
      const jet = makeJet(color);
      jet.position.set(B * 0.5, deckY + 1.8, -L * 0.32 + i * 9);
      jet.rotation.y = 0.55;
      group.add(jet);
    }
    const ready = makeJet(color);
    ready.position.set(B * 0.12, deckY + 1.8, L * 0.32);
    group.add(ready);
    // Close-in guns on the bow sponsons; a 57 mm gun on the forecastle
    gunPivot = ciws(1.3);
    gunPivot.position.set(-B * 0.5, deckY + 0.8, L * 0.44);
    group.add(gunPivot);
    const aft = ciws(1.3);
    aft.position.set(B * 0.75, deckY + 0.8, -L * 0.44);
    aft.rotation.y = Math.PI;
    group.add(aft);
    cannonPivot = navalGun(1.1);
    cannonPivot.position.set(0, at(0.95).y, L * 0.47);
    group.add(cannonPivot);
    for (const s of [-1, 1]) {
      const launcher = stealthBlock(2.6, 2.2, 4.5, 0.15);
      launcher.position.set(s * B * 0.62, deckY - 1.5, -L * 0.42);
      group.add(launcher);
    }
  } else {
    const big = cls === 'destroyer';
    const deckY = at(0.4).y;
    // The superstructure: a stealthy block with a slanted bridge and an integrated mast
    const supL = L * (big ? 0.32 : 0.34);
    const sup = stealthBlock(B * 0.82, big ? 6.5 : 5, supL, 0.24);
    sup.position.set(0, deckY + (big ? 3.25 : 2.5), -L * 0.02);
    group.add(sup);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(B * 0.6, 0.8, 0.15), glass());
    windows.position.set(0, deckY + (big ? 5.6 : 4.3), -L * 0.02 + supL * 0.42);
    windows.rotation.x = -0.35;
    group.add(windows);
    const m = mast(big ? 10 : 8);
    m.position.set(0, deckY + (big ? 6.5 : 5), -L * 0.02);
    group.add(m);
    radar = m.userData.scanner;
    if (big) {
      const funnel = stealthBlock(B * 0.38, 3.5, 5, 0.3, navyDark());
      funnel.position.set(0, deckY + 1.75, -L * 0.22);
      group.add(funnel);
      // Vertical launch cells forward of the bridge, for the cruise missiles
      const vls = vlsGrid(B * 0.55, L * 0.12);
      vls.position.set(0, at(0.6).y + 0.2, L * 0.08 + 3);
      group.add(vls);
    } else {
      // Angled anti-ship missile canisters amidships
      for (const s of [-1, 1]) {
        const rack = new THREE.Group();
        for (let i = 0; i < 2; i++) {
          const can = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 4.2), navyDark());
          can.position.set(i * 0.9 - 0.45, 0, 0);
          can.castShadow = true;
          rack.add(can);
        }
        rack.rotation.x = -0.32;
        rack.rotation.y = s * 0.5;
        rack.position.set(s * B * 0.26, deckY + 1.4, L * 0.08);
        group.add(rack);
      }
    }
    // The main gun forward, the close-in gun on the superstructure, a drone deck aft
    cannonPivot = navalGun(big ? 1.2 : 0.9);
    cannonPivot.position.set(0, at(0.84).y, L * 0.34);
    group.add(cannonPivot);
    gunPivot = ciws(big ? 1.1 : 0.9);
    gunPivot.position.set(0, deckY + (big ? 6.5 : 5), -L * 0.12 - supL * 0.25);
    group.add(gunPivot);
    const pad = landingPad(B * 0.85);
    pad.position.set(0, at(0.1).y + 0.06, -L * 0.4);
    group.add(pad);
    const drone = makeDrone(color);
    drone.scale.setScalar(0.55);
    drone.position.set(0, at(0.1).y + 1, -L * 0.4);
    group.add(drone);
  }
  group.userData = { hmg: gunPivot, cannon: cannonPivot, radar, length: L, beam: B, spin: gunPivot.userData.spin };
  return group;
}

/* ---------- Aircraft ---------- */

const jetMat = () => mat('jet', () => new THREE.MeshStandardMaterial({ color: 0x8b949c, roughness: 0.45, metalness: 0.4 }));

// A strike jet: about 15 m, swept wings, twin fins, a canopy and a glowing exhaust
export function makeJet(color = '#e63946') {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 13, 12), jetMat());
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3, 12), jetMat());
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 8;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), glass());
  canopy.scale.set(1, 0.8, 2.6);
  canopy.position.set(0, 0.6, 4);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 2.5); wingShape.lineTo(6.2, -2.5); wingShape.lineTo(6.2, -3.6); wingShape.lineTo(0, -3.2); wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, jetMat());
    wing.scale.x = s;
    wing.position.y = -0.1;
    g.add(wing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 2.4), mat(`fin${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.5 })));
    fin.position.set(s * 0.9, 1.3, -5.2);
    fin.rotation.z = s * -0.35;
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -8;
  g.add(body, nose, canopy, flame);
  g.traverse((m) => { if (m.isMesh && m !== flame) m.castShadow = true; });
  g.userData.flame = flame;
  return g;
}

// A strike drone: long straight wings, a V tail and a pusher propeller
export function makeDrone(color = '#e63946') {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, 8, 10), jetMat());
  body.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(18, 0.12, 1.1), jetMat());
  wing.position.set(0, 0.25, 0.5);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2, 0.14, 1.12), mat(`fin${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.5 })));
  stripe.position.set(0, 0.26, 0.5);
  for (const s of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.8), jetMat());
    tail.position.set(s * 0.9, 0.6, -3.6);
    tail.rotation.z = s * 0.6;
    g.add(tail);
  }
  const prop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.15), darkMetal());
  prop.position.z = -4.1;
  g.add(body, wing, stripe, prop);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.userData.prop = prop;
  return g;
}

/* ---------- The race course ---------- */

// An inflatable race pylon: tall, banded, with a light on top
export function makePylon(color = 0xff6a13) {
  const g = new THREE.Group();
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.5, emissive: new THREE.Color(color), emissiveIntensity: 0 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 9, 24), m);
  body.position.y = 4.2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.05, 1.2, 24), white());
  band.position.y = 5.8;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
  cap.position.y = 8.7;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  lamp.position.y = 10.4;
  for (const x of [body, band, cap]) x.castShadow = true;
  g.add(body, band, cap, lamp);
  g.userData = { mat: m, lamp };
  return g;
}

// A banner across the start and finish: a chequered flag strung between two masts
export function makeStartBanner(width) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fafafa'; x.fillRect(i * 16, j * 16, 16, 16); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(width, 3), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  banner.position.y = 15;
  g.add(banner);
  for (const s of [-1, 1]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 17, 8), gunmetal());
    mast.position.set((s * width) / 2, 8, 0);
    g.add(mast);
  }
  return g;
}

/* ---------- Islands and rocks ---------- */

function noise3(seed) {
  const r = rng(seed);
  const perm = Array.from({ length: 512 }, () => r());
  const h = (x, y, z) => perm[((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 511];
  const lerp = (a, b, t) => a + (b - a) * t;
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
    const xf = s(x - xi); const yf = s(y - yi); const zf = s(z - zi);
    const c = (dx, dy, dz) => h(xi + dx, yi + dy, zi + dz);
    return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
  };
}

const landMat = () => mat('land', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: false }));

export function makeIsland(o, style) {
  const n = noise3(o.seed);
  const g = new THREE.IcosahedronGeometry(1, 5);
  const p = g.attributes.position;
  const sand = new THREE.Color(style.sand);
  const grass = new THREE.Color(style.grass);
  const rock = new THREE.Color(style.rock);
  const cols = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const f = 0.75 + 0.5 * n(x * 1.6 + 5, y * 1.6, z * 1.6) + 0.18 * n(x * 5, y * 5 + 9, z * 5);
    const up = Math.max(0, y);
    const height = up > 0 ? Math.pow(up, 1.25) * o.h * f : y * 14;
    p.setXYZ(i, x * o.r * f, height - 0.6, z * o.r * f);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const steep = 1 - nrm.getY(i);
    let c;
    if (y < 1.6) c = sand;
    else if (steep > 0.45 || y > o.h * 0.75) c = rock;
    else c = grass.clone().lerp(rock, Math.min(1, steep * 1.2));
    const v = 0.9 + 0.2 * n(p.getX(i) * 0.08, y * 0.08, p.getZ(i) * 0.08);
    cols.push(c.r * v, c.g * v, c.b * v);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(g, landMat());
  mesh.position.set(o.x, 0, o.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  if (style.palms && o.r > 35) group.add(palms(o, rng(o.seed + 1), p));
  return group;
}

// Palm trees on the beach and the lower slopes
function palms(o, r, pos) {
  const group = new THREE.Group();
  const trunkMat = mat('trunk', () => new THREE.MeshStandardMaterial({ color: 0x7a5c3c, roughness: 0.95 }));
  const leafMat = mat('leaf', () => new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 0.8, side: THREE.DoubleSide }));
  const count = Math.min(14, Math.floor(o.r / 9));
  for (let i = 0; i < count; i++) {
    const v = Math.floor(r() * pos.count);
    const y = pos.getY(v);
    if (y < 1.2 || y > 12) continue;
    const tree = new THREE.Group();
    const h = 7 + r() * 5;
    const lean = (r() - 0.5) * 0.4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, h, 7), trunkMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    tree.add(trunk);
    for (let f = 0; f < 7; f++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 4.5, 1, 3), leafMat);
      const lp = leaf.geometry.attributes.position;
      for (let k = 0; k < lp.count; k++) lp.setZ(k, -Math.pow((lp.getY(k) + 2.25) / 4.5, 2) * 1.6);
      leaf.geometry.translate(0, 2.25, 0);
      leaf.rotation.set(-1.0, (f / 7) * Math.PI * 2, 0, 'YXZ');
      leaf.position.y = h;
      leaf.castShadow = true;
      tree.add(leaf);
    }
    tree.rotation.z = lean;
    tree.position.set(o.x + pos.getX(v), y - 0.3, o.z + pos.getZ(v));
    group.add(tree);
  }
  return group;
}

export function makeRock(o, style) {
  const n = noise3(o.seed);
  const g = new THREE.DodecahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const f = 0.7 + 0.6 * n(x * 2 + 3, y * 2, z * 2);
    p.setXYZ(i, x * o.r * f, y > 0 ? y * o.h * f : y * 4, z * o.r * f);
  }
  g.computeVertexNormals();
  const m = mat(`rock${style.rock}`, () => new THREE.MeshStandardMaterial({ color: style.rock, roughness: 0.95 }));
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(o.x, -0.3, o.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/* ---------- Supply crates ---------- */

function crateTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = kind === 'repair' ? '#1f8f4e' : '#9a6a14';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(0,0,0,0.35)';
  x.lineWidth = 8;
  x.strokeRect(4, 4, 120, 120);
  x.fillStyle = '#fff';
  if (kind === 'repair') { x.fillRect(52, 26, 24, 76); x.fillRect(26, 52, 76, 24); } else {
    for (const ox of [34, 58, 82]) { x.fillRect(ox - 7, 46, 14, 50); x.beginPath(); x.moveTo(ox - 7, 46); x.lineTo(ox, 28); x.lineTo(ox + 7, 46); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeCrate(kind) {
  const m = mat(`crate${kind}`, () => new THREE.MeshStandardMaterial({ map: crateTexture(kind), roughness: 0.6, emissive: new THREE.Color(kind === 'repair' ? 0x0d6a33 : 0x6a4500), emissiveIntensity: 0.35 }));
  const box = new THREE.Mesh(new RoundedBoxGeometry(2.2, 2.2, 2.2, 2, 0.2), m);
  box.castShadow = true;
  const float = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.35, 10, 24), mat('float', () => new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 })));
  float.rotation.x = Math.PI / 2;
  float.position.y = -0.9;
  const g = new THREE.Group();
  g.add(box, float);
  g.userData = { box };
  return g;
}

/* ---------- Ordnance ---------- */

// A missile, at the size of its type: an anti-ship missile is about 4 m, a heavy cruise missile about 7 m
export function makeMissile(size = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3, 12), white());
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 12), gunmetal());
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.85;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.25, 12), mat('band', () => new THREE.MeshStandardMaterial({ color: 0xd8a018, roughness: 0.5 })));
  band.rotation.x = Math.PI / 2;
  band.position.z = 1.1;
  g.add(body, nose, band);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.5), gunmetal());
    fin.position.z = -1.25;
    fin.rotation.z = (i / 4) * Math.PI * 2;
    fin.translateY(0.33);
    g.add(fin);
    // Small wings forward of the fins, on the bigger missiles
    if (size > 2) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.7), gunmetal());
      wing.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
      wing.translateY(0.5);
      g.add(wing);
    }
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.8, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -2.4;
  g.add(flame);
  g.scale.setScalar(size);
  g.traverse((m) => { if (m.isMesh && m !== flame) m.castShadow = true; });
  return g;
}

// A free-fall bomb, olive drab with a yellow nose band and a box tail
export function makeBomb(size = 1) {
  const g = new THREE.Group();
  const drab = mat('bomb', () => new THREE.MeshStandardMaterial({ color: 0x4b5233, roughness: 0.6, metalness: 0.2 }));
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.6, 4, 10), drab);
  body.rotation.x = Math.PI / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.12, 10), mat('band', () => new THREE.MeshStandardMaterial({ color: 0xd8a018, roughness: 0.5 })));
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.7;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.45), drab);
  tail.position.z = -1.15;
  g.add(body, band, tail);
  g.scale.setScalar(size * 1.4);
  return g;
}
