// Everything on the water, modelled in code: the boats (a deep-V planing hull, deck, cockpit and windscreen, twin
// outboards, a machine gun on the bow, a 30 mm turret on the cabin roof and a missile pod on each side), the race
// pylons, islands with beaches, grass, cliffs and palms, rocks, and the floating supply crates.

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
function hullGeometry(L, B, D, H, color) {
  const stations = 28;
  const side = 6;
  const pos = [];
  const col = [];
  const c = new THREE.Color(color);
  const w = new THREE.Color(0xf4f6f7);
  const boot = new THREE.Color(0x101418);
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
    ring.push({ z, row });
  }
  const paint = (y) => (y > 0.05 ? c : y > -0.12 ? boot : w);
  // The sides: one ring of vertices per station, joined to the next (shared vertices, so the hull shades smoothly)
  const per = ring[0].row.length;
  for (const r of ring) for (const [x, y] of r.row) { pos.push(x, y, r.z); const cc = paint(y); col.push(cc.r, cc.g, cc.b); }
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
  for (const [x, y] of t0.row) { pos.push(x, y, t0.z); const cc = paint(y); col.push(cc.r, cc.g, cc.b); }
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

export function makeBoat(cls, k, color) {
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

export function makeMissile() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.6, 10), white());
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10), gunmetal());
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.55;
  g.add(body, nose);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.45, 0.4), gunmetal());
    fin.position.z = -1.1;
    fin.rotation.z = (i / 4) * Math.PI * 2;
    fin.translateY(0.25);
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.4, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -2;
  g.add(flame);
  return g;
}
