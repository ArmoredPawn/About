// Effects: particles (fire, smoke, spray, sparks), tracer rounds, glowing shells, foam wakes behind the boats, and
// explosions: a fireball, black smoke, a column of white water, a flash of light and a ring spreading on the sea.

import * as THREE from 'three';
import { heightAt } from '../sim/waves.js';
import { WEAPONS } from '../sim/boats.js';

/* ---------- Particles ---------- */

// Four puffs in a 2 × 2 atlas, made once: billowing smoke (soft, lumpy edges) or flame (bright core, ragged tongues)
function puffAtlas(fire) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const x = c.getContext('2d');
  const img = x.createImageData(S * 2, S * 2);
  const hash = (i, j, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (u, v, s) => {
    const i = Math.floor(u); const j = Math.floor(v); const fu = u - i; const fv = v - j;
    const a = hash(i, j, s); const b = hash(i + 1, j, s); const cc = hash(i, j + 1, s); const d = hash(i + 1, j + 1, s);
    const su = fu * fu * (3 - 2 * fu); const sv = fv * fv * (3 - 2 * fv);
    return a + (b - a) * su + (cc - a) * sv + (a - b - cc + d) * su * sv;
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * S;
    const oy = Math.floor(cell / 2) * S;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const u = (px / S) * 2 - 1;
      const v = (py / S) * 2 - 1;
      let n = 0;
      let amp = 0.5;
      let f = 3;
      for (let o = 0; o < 4; o++) { n += amp * noise(u * f + 10, v * f + 10, cell + o * 7); amp *= 0.5; f *= 2; }
      const r = Math.hypot(u, v) + (n - 0.5) * (fire ? 0.7 : 0.55);
      const a = Math.max(0, Math.min(1, (1 - r) * (fire ? 2.2 : 1.6))) * (fire ? 1 : 0.55 + 0.45 * n);
      const k = ((oy + py) * S * 2 + ox + px) * 4;
      const shade = fire ? Math.min(1, 0.55 + (1 - r) * 0.9) : 0.75 + 0.25 * n;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = shade * 255;
      img.data[k + 3] = a * 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A pool of soft round particles drawn in one go. Each has a position, velocity, size, colour and life; additive
// pools glow (fire, sparks, muzzle flashes), the others are lit by nothing and fade (smoke, spray).
class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    // Each puff turns slowly and is one of four shapes
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.cell = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aRot = new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCell = new THREE.BufferAttribute(this.cell, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('rot', this.aRot);
    g.setAttribute('cell', this.aCell);
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('size', this.aSize);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, map: { value: puffAtlas(additive) } },
      vertexShader: `
        attribute float size; attribute vec4 color; attribute float rot; attribute float cell; varying vec4 vC; varying float vRot; varying float vCell; uniform float uScale;
        void main() { vC = color; vRot = rot; vCell = cell; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale / max(1.0, -mv.z); }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vC; varying float vRot; varying float vCell;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot); float s = sin(vRot);
          p = mat2(c, -s, s, c) * p + 0.5;
          if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
          vec4 t = texture2D(map, (p + vec2(mod(vCell, 2.0), floor(vCell / 2.0))) * 0.5);
          gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a);
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, { size = 1, grow = 0, life = 1, color = [1, 1, 1], alpha = 1, drag = 0, gravity = 0 } = {}) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color[0], color[1], color[2], alpha], i * 4);
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.age[i] = 0; this.drag[i] = drag; this.grav[i] = gravity; this.alpha0[i] = alpha;
    this.rot[i] = Math.random() * Math.PI * 2; this.spin[i] = (Math.random() - 0.5) * 1.2; this.cell[i] = Math.floor(Math.random() * 4);
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // Swap the last one in
        const j = --this.n;
        if (i !== j) {
          this.pos.copyWithin(i * 3, j * 3, j * 3 + 3); this.vel.copyWithin(i * 3, j * 3, j * 3 + 3); this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
          for (const a of [this.size, this.grow, this.life, this.age, this.drag, this.grav, this.alpha0, this.rot, this.spin, this.cell]) a[i] = a[j];
          i--;
        }
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = Math.max(0.05, this.size[i] + this.grow[i] * dt);
      this.rot[i] += this.spin[i] * dt;
      const f = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = this.alpha0[i] * (1 - f) * Math.min(1, this.age[i] * 12 + 0.2);
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aRot.needsUpdate = true; this.aCell.needsUpdate = true;
  }
}

/* ---------- Wakes ---------- */

// A foam trail behind a boat: a ribbon on the water that widens and fades as it ages
const WAKE_POINTS = 90;
function foamTexture(arms = false) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const img = x.createImageData(64, 256);
  for (let i = 0; i < 64 * 256; i++) {
    const u = (i % 64) / 63;
    // The churned water straight behind is foamy all across; the V-shaped arms that spread out from a fast hull
    // are bright lines at their outer edges
    const edge = arms ? Math.pow(Math.max(0, 1 - Math.min(u, 1 - u) / 0.14), 1.5) : Math.pow(Math.sin(u * Math.PI), 0.6);
    const n = Math.random();
    const v = Math.min(1, edge * (0.45 + 0.75 * n * n));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = v * 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

class Wake {
  constructor(scene, tex, arms = false) {
    this.arms = arms;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(WAKE_POINTS * 2 * 3);
    this.col = new Float32Array(WAKE_POINTS * 2 * 4);
    this.uv = new Float32Array(WAKE_POINTS * 2 * 2);
    const idx = [];
    for (let i = 0; i < WAKE_POINTS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.last = 0;
  }

  update(waves, t, b, dt) {
    this.last += dt;
    const speed = Math.abs(b.speed);
    if (this.last > 0.045 && !b.dead) {
      this.last = 0;
      const L = b.k.length * 0.5;
      // The arms of a Kelvin wake open at about 19.5 degrees each side, whatever the speed: so they spread sideways
      // at about a third of the ship's speed
      this.pts.unshift({ x: b.x - Math.sin(b.h) * L, z: b.z - Math.cos(b.h) * L, hx: Math.cos(b.h), hz: -Math.sin(b.h), born: t, strength: Math.min(1, speed / 18) * (this.arms ? Math.min(1, speed / 25) : 1), spread: this.arms ? Math.max(3.2, speed * 0.35) : 3.2 });
      if (this.pts.length > WAKE_POINTS) this.pts.pop();
    }
    const n = this.pts.length;
    for (let i = 0; i < WAKE_POINTS; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      if (!p) break;
      const age = t - p.born;
      const w = (b.k.beam * 0.45 + age * p.spread) * (i < n ? 1 : 0);
      const y = heightAt(waves, p.x, p.z, t) + 0.12;
      const a = Math.max(0, 1 - age / (this.arms ? 5 : 4)) * p.strength * (i < n ? 1 : 0) * (this.arms ? 0.6 : 0.85);
      this.pos.set([p.x - p.hx * w, y, p.z - p.hz * w, p.x + p.hx * w, y, p.z + p.hz * w], i * 6);
      this.col.set([1, 1, 1, a, 1, 1, 1, a], i * 8);
      this.uv.set([0, i * 0.12, 1, i * 0.12], i * 4);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }

  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

/* ---------- The effects, together ---------- */

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glow = new Particles(scene, 5000, true);
    this.smoke = new Particles(scene, 7000, false);
    this.foamTex = foamTexture();
    this.armsTex = foamTexture(true);
    this.wakes = new Map();
    // Fires that stay burning on a damaged ship, in fixed places on its deck, until it is repaired or sunk
    this.fires = new Map();
    // Wreckage: chunks of metal thrown out by a blast, tumbling, some trailing fire, falling into the sea
    this.debrisMax = 260;
    this.debris = [];
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.35, 0.7), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, metalness: 0.5 }), this.debrisMax);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = true;
    this.debrisMesh.count = 0;
    scene.add(this.debrisMesh);
    this.e = new THREE.Euler();
    // Tracers: thin bright streaks along each machine-gun round's flight
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 1), new THREE.MeshBasicMaterial({ color: 0xffd27a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), 600);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    scene.add(this.tracers);
    this.shells = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb35a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), 200);
    this.shells.frustumCulled = false;
    this.shells.count = 0;
    scene.add(this.shells);
    // Flashes: a few point lights, reused
    this.lights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xffa04a, 0, 90, 1.6); scene.add(l); return { l, t: 0, peak: 0 }; });
    // Shockwave rings on the water
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 0, 1);
    this.p = new THREE.Vector3();
  }

  wake(b) {
    if (!this.wakes.has(b.id)) this.wakes.set(b.id, [new Wake(this.scene, this.armsTex, true), new Wake(this.scene, this.foamTex)]);
    return this.wakes.get(b.id);
  }

  dropWake(id) { for (const w of this.wakes.get(id) ?? []) w.dispose(this.scene); this.wakes.delete(id); this.fires.delete(id); }

  // Throw out n chunks of wreckage from a point, of about size s
  wreckage(x, y, z, n, s = 1, vx = 0, vz = 0) {
    for (let i = 0; i < n; i++) {
      const d = { x, y, z, vx: vx + (Math.random() - 0.5) * 30 * Math.sqrt(s), vy: 8 + Math.random() * 18 * Math.sqrt(s), vz: vz + (Math.random() - 0.5) * 30 * Math.sqrt(s), rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6, sx: (Math.random() - 0.5) * 14, sy: (Math.random() - 0.5) * 14, sz: (Math.random() - 0.5) * 14, size: s * (0.3 + Math.random() * 0.9), burn: Math.random() < 0.4, life: 6 };
      if (this.debris.length >= this.debrisMax) this.debris.shift();
      this.debris.push(d);
    }
  }

  flash(x, y, z, peak = 60, color = 0xffa04a) {
    const f = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    f.l.position.set(x, y, z);
    f.l.color.set(color);
    f.peak = peak;
    f.t = 1;
  }

  ring(x, y, z, size, life = 1.4) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.set(x, y + 0.2, z);
    this.scene.add(m);
    this.rings.push({ m, age: 0, life, size });
  }

  // The bow throws spray; the hull churns the water behind it; a damaged boat smokes, or burns
  boat(b, waves, t, dt) {
    for (const w of this.wake(b)) w.update(waves, t, b, dt);
    if (b.dead) {
      if (Math.random() < dt * 30) this.smoke.emit(b.x, b.y + 1, b.z, (Math.random() - 0.5) * 2, 4 + Math.random() * 3, (Math.random() - 0.5) * 2, { size: 5, grow: 5, life: 4, color: [0.08, 0.08, 0.09], alpha: 0.7, drag: 0.4 });
      return;
    }
    const speed = Math.abs(b.speed);
    const fx = Math.sin(b.h);
    const fz = Math.cos(b.h);
    const L = b.k.length * 0.5;
    if (speed > 12 && Math.random() < dt * speed * 1.4) {
      for (const s of [-1, 1]) {
        const ox = fz * s;
        const oz = -fx * s;
        const bx = b.x + fx * L * 0.45 + ox * b.k.beam * 0.5;
        const bz = b.z + fz * L * 0.45 + oz * b.k.beam * 0.5;
        this.smoke.emit(bx, b.y + 0.3, bz, ox * (4 + speed * 0.15) + b.vx * 0.3, 2.5 + Math.random() * 3, oz * (4 + speed * 0.15) + b.vz * 0.3, { size: 1.2, grow: 2.4, life: 0.9, color: [0.95, 0.97, 1], alpha: 0.55, gravity: 9.8, drag: 0.8 });
      }
    }
    if (speed > 4 && Math.random() < dt * 25) {
      const sx = b.x - fx * L;
      const sz = b.z - fz * L;
      this.smoke.emit(sx + (Math.random() - 0.5) * 2, b.y + 0.4, sz + (Math.random() - 0.5) * 2, -fx * 3, 2 + Math.random() * 2, -fz * 3, { size: 1.6, grow: 3, life: 1.1, color: [0.95, 0.97, 1], alpha: 0.5, gravity: 6, drag: 1 });
    }
    // Damage: smoke from where the ship was hit, and below a quarter of its hull, flames. Each fire stays put on the
    // deck (it moves with the ship) until the ship is repaired.
    const hurt = b.hp / b.k.hp;
    let fires = this.fires.get(b.id);
    if (hurt > 0.6 && fires) { this.fires.delete(b.id); fires = null; }
    const want = hurt < 0.25 ? 3 : hurt < 0.5 ? 1 : 0;
    if (want) {
      if (!fires) this.fires.set(b.id, fires = []);
      while (fires.length < want) fires.push({ along: (Math.random() - 0.5) * b.k.length * 0.6, side: (Math.random() - 0.5) * b.k.beam * 0.5 });
    }
    if (fires) {
      const k = 1 + b.k.length / 30;
      const sy = b.y + b.k.beam * 0.36 + 1.2;
      for (let f = 0; f < fires.length; f++) {
        const spot = fires[f];
        const px = b.x + fx * spot.along + fz * spot.side;
        const pz = b.z + fz * spot.along - fx * spot.side;
        const burning = hurt < 0.25 || f > 0;
        if (Math.random() < dt * 9) {
          const g = burning ? 0.06 : 0.3;
          this.smoke.emit(px, sy + 1, pz, b.vx * 0.6 + (Math.random() - 0.5), 3 + Math.random() * 2, b.vz * 0.6 + (Math.random() - 0.5), { size: 1.8 * k, grow: 3.5 * k, life: 3, color: [g, g, g * 1.05], alpha: 0.65, drag: 0.6 });
        }
        if (burning && Math.random() < dt * 30) {
          this.glow.emit(px + (Math.random() - 0.5) * k, sy, pz + (Math.random() - 0.5) * k, b.vx * 0.9, 2 + Math.random() * 3, b.vz * 0.9, { size: 1.3 * k, grow: -0.5, life: 0.5, color: [1, 0.42 + Math.random() * 0.2, 0.08], alpha: 0.95, drag: 0.5 });
        }
        if (burning && Math.random() < dt * 2) this.flash(px, sy + 2, pz, 12 * k, 0xff7a2a);
      }
    }
  }

  // A weapon fires: a flash at the muzzle (bigger for bigger guns), smoke from a launch cell, steam off a deck
  muzzle(x, y, z, w, dx, dz) {
    const W = WEAPONS[w];
    const slot = W?.slot;
    const k = W?.size ?? 1;
    if (slot === 'gun') {
      for (let i = 0; i < 2; i++) this.glow.emit(x + dx * 0.5, y, z + dz * 0.5, dx * (8 + Math.random() * 10), Math.random() * 2, dz * (8 + Math.random() * 10), { size: w === 'ciws' ? 0.9 : 0.7, grow: -1, life: 0.07, color: [1, 0.75, 0.35], alpha: 1 });
    } else if (slot === 'cannon') {
      for (let i = 0; i < 6 * k; i++) this.glow.emit(x + dx, y, z + dz, dx * (10 + Math.random() * 12), Math.random() * 3, dz * (10 + Math.random() * 12), { size: 1.6 * k, grow: -1, life: 0.09, color: [1, 0.75, 0.35], alpha: 1 });
      for (let i = 0; i < 3 * k; i++) this.smoke.emit(x, y, z, dx * 6 + (Math.random() - 0.5) * 2, 1, dz * 6 + (Math.random() - 0.5) * 2, { size: 1.5 * k, grow: 4 * k, life: 1.4, color: [0.62, 0.62, 0.62], alpha: 0.45, drag: 1.4 });
      this.flash(x, y, z, 25 * k, 0xffc27a);
    } else if (slot === 'missile') {
      for (let i = 0; i < 14 * k; i++) this.smoke.emit(x, y, z, (Math.random() - 0.5) * 6 * k, (W.vertical ? 6 : 1) + Math.random() * 3, (Math.random() - 0.5) * 6 * k, { size: 2 * k, grow: 5 * k, life: 2.4, color: [0.86, 0.86, 0.86], alpha: 0.55, drag: 1.2 });
      this.flash(x, y, z, 35 * k, 0xffd08a);
    } else if (slot === 'air') {
      // The catapult's steam
      for (let i = 0; i < 16; i++) this.smoke.emit(x, y, z, dx * 10 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, dz * 10 + (Math.random() - 0.5) * 3, { size: 1.6, grow: 4, life: 1.2, color: [0.95, 0.96, 0.98], alpha: 0.5, drag: 1.6 });
    }
  }

  // Missiles trail flame and white smoke (thicker for a cruise missile); jets a faint vapour trail
  missileTrail(s, dt) {
    const k = WEAPONS[s.w]?.size ?? 1;
    if (Math.random() < dt * 90) this.smoke.emit(s.x, s.y, s.z, (Math.random() - 0.5) * 1.5, 0.6, (Math.random() - 0.5) * 1.5, { size: 1.1 * k, grow: 2.6 * k, life: 2.6, color: [0.9, 0.9, 0.9], alpha: 0.45, drag: 0.7 });
    if (Math.random() < dt * 60) this.glow.emit(s.x, s.y, s.z, -s.vx * 0.05, 0, -s.vz * 0.05, { size: 1.2 * k, grow: -2, life: 0.1, color: [1, 0.7, 0.3], alpha: 1 });
  }

  contrail(s, dt) {
    if (Math.random() < dt * 30) this.smoke.emit(s.x - s.vx * 0.05, s.y, s.z - s.vz * 0.05, 0, 0, 0, { size: 0.8, grow: 1.6, life: 1.6, color: [0.96, 0.97, 1], alpha: 0.25, drag: 0.2 });
  }

  // How big a blast each weapon makes
  #power(w) {
    if (w === 'boat') return 2.4;
    return { c30: 1, c57: 1.3, c76: 1.6, asm: 1.8, cruise: 2.8, bomb: 2.2, heavybomb: 2.8, drone: 1.1, jet: 1.5 }[w] ?? 1;
  }

  explode(x, y, z, w, onBoat, sea, power = null) {
    if (WEAPONS[w]?.slot === 'gun') {
      if (onBoat) for (let i = 0; i < 5; i++) this.glow.emit(x, y, z, (Math.random() - 0.5) * 14, Math.random() * 8, (Math.random() - 0.5) * 14, { size: 0.35, life: 0.25, color: [1, 0.8, 0.45], gravity: 20 });
      else if (y < sea + 2) for (let i = 0; i < 4; i++) this.smoke.emit(x, sea + 0.1, z, (Math.random() - 0.5) * 2, 4 + Math.random() * 5, (Math.random() - 0.5) * 2, { size: 0.5, grow: 1, life: 0.7, color: [0.95, 0.97, 1], alpha: 0.7, gravity: 14 });
      else for (let i = 0; i < 3; i++) this.glow.emit(x, y, z, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, { size: 0.5, life: 0.15, color: [1, 0.85, 0.5] });
      return;
    }
    const big = power ?? this.#power(w);
    const inAir = y > sea + 8;
    const onWater = !onBoat && !inAir;
    // The fireball
    for (let i = 0; i < 26 * big; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - (inAir ? 0.5 : 0)) * 0.9;
      const sp = (6 + Math.random() * 14) * big;
      this.glow.emit(x, y + 0.5, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp, { size: 2.2 * big, grow: 2.5 * big, life: 0.35 + Math.random() * 0.35, color: [1, 0.55 + Math.random() * 0.25, 0.18], alpha: 1, drag: 3.5 });
    }
    // Black smoke rising
    for (let i = 0; i < 16 * big; i++) this.smoke.emit(x + (Math.random() - 0.5) * 3 * big, y + 1, z + (Math.random() - 0.5) * 3 * big, (Math.random() - 0.5) * 5, (inAir ? 1 : 4) + Math.random() * 6, (Math.random() - 0.5) * 5, { size: 3 * big, grow: 4.5 * big, life: 3 + Math.random() * 2, color: [0.1, 0.09, 0.09], alpha: 0.7, drag: 0.9 });
    // A column of white water
    if (onWater || w === 'boat') {
      for (let i = 0; i < 40 * big; i++) this.smoke.emit(x + (Math.random() - 0.5) * 2 * big, sea + 0.2, z + (Math.random() - 0.5) * 2 * big, (Math.random() - 0.5) * 6 * big, (10 + Math.random() * 16) * Math.sqrt(big), (Math.random() - 0.5) * 6 * big, { size: 1.6 * big, grow: 2.5, life: 1.6 + Math.random() * 0.8, color: [0.93, 0.96, 1], alpha: 0.8, gravity: 13, drag: 0.3 });
      this.ring(x, sea, z, 14 * big);
    }
    // Wreckage
    if (onBoat || inAir || w === 'boat') this.wreckage(x, y + 1, z, Math.round((w === 'boat' ? 14 : 5) * big), w === 'boat' ? 1.4 : inAir ? 0.6 : 0.8);
    for (let i = 0; i < 10 * big; i++) this.smoke.emit(x, y + 0.5, z, (Math.random() - 0.5) * 30, 8 + Math.random() * 14, (Math.random() - 0.5) * 30, { size: 0.35 * big, life: 1.4, color: [0.12, 0.11, 0.1], alpha: 1, gravity: 18 });
    this.flash(x, y + 2, z, 90 * big);
  }

  // Shots in the air: tracers for gun rounds, glowing shells for the naval guns (sized by calibre). Missiles,
  // aircraft and bombs are models of their own.
  shots(list) {
    let t = 0;
    let s = 0;
    for (const p of list) {
      const W = WEAPONS[p.w];
      if (W?.slot === 'gun' && t < 600) {
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        this.v.set(p.vx / sp, p.vy / sp, p.vz / sp);
        this.q.setFromUnitVectors(this.up, this.v);
        const k = W.tracer ?? 1;
        this.s.set(k, k, 14 * k);
        this.m4.compose(this.p.set(p.x - this.v.x * 7, p.y - this.v.y * 7, p.z - this.v.z * 7), this.q, this.s);
        this.tracers.setMatrixAt(t++, this.m4);
      } else if (W?.slot === 'cannon' && s < 200) {
        this.s.setScalar(W.size ?? 1);
        this.m4.compose(this.p.set(p.x, p.y, p.z), this.q.identity(), this.s);
        this.shells.setMatrixAt(s++, this.m4);
      }
    }
    this.tracers.count = t;
    this.shells.count = s;
    this.tracers.instanceMatrix.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    // The wreckage tumbles, trails fire, and splashes down
    let n = 0;
    for (const d of this.debris) {
      d.life -= dt;
      d.vy -= 9.8 * dt;
      const k = Math.exp(-0.3 * dt);
      d.vx *= k; d.vz *= k;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += d.sx * dt; d.ry += d.sy * dt; d.rz += d.sz * dt;
      if (d.burn && Math.random() < dt * 40) this.glow.emit(d.x, d.y, d.z, 0, 0, 0, { size: d.size * 1.4, grow: -1, life: 0.35, color: [1, 0.5, 0.12], alpha: 0.9 });
      if (d.burn && Math.random() < dt * 20) this.smoke.emit(d.x, d.y, d.z, 0, 0.5, 0, { size: d.size, grow: 2, life: 1.4, color: [0.12, 0.11, 0.1], alpha: 0.4, drag: 1 });
      if (d.y < 0 && d.vy < 0) {
        for (let i = 0; i < 4; i++) this.smoke.emit(d.x, 0.1, d.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2, { size: 0.5 + d.size * 0.4, grow: 1, life: 0.7, color: [0.95, 0.97, 1], alpha: 0.7, gravity: 12 });
        d.life = 0;
      }
      if (d.life <= 0) continue;
      this.e.set(d.rx, d.ry, d.rz);
      this.q.setFromEuler(this.e);
      this.s.setScalar(d.size);
      this.m4.compose(this.p.set(d.x, d.y, d.z), this.q, this.s);
      this.debrisMesh.setMatrixAt(n++, this.m4);
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    this.debrisMesh.count = n;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    this.glow.update(dt);
    this.smoke.update(dt);
    for (const f of this.lights) { f.t = Math.max(0, f.t - dt * 5); f.l.intensity = f.peak * f.t * f.t; }
    for (const r of this.rings) {
      r.age += dt;
      const k = r.age / r.life;
      r.m.scale.setScalar(2 + k * r.size);
      r.m.material.opacity = 0.6 * (1 - k);
    }
    this.rings = this.rings.filter((r) => { if (r.age < r.life) return true; this.scene.remove(r.m); r.m.material.dispose(); return false; });
  }

  setScale(h) { this.glow.points.material.uniforms.uScale.value = h * 0.85; this.smoke.points.material.uniforms.uScale.value = h * 0.85; }
}
