// Keeps the 3-D scene in step with the race: builds the course once, adds a model for every boat, puts each one on
// the sea where the simulation says it is (riding the swell, banking into turns, its turrets tracking), draws the
// shots in flight, and turns what happens (a shot fired, a hit, a boat sunk) into flashes, smoke and spray.

import * as THREE from 'three';
import { makeOcean } from './ocean.js';
import { makeBoat, makePylon, makeStartBanner, makeIsland, makeRock, makeCrate, makeMissile } from './models.js';
import { Effects } from './fx.js';
import { GATE_HALF } from '../sim/track.js';
import { heightAt } from '../sim/waves.js';

function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '600 30px Inter, system-ui, sans-serif';
  x.textAlign = 'center';
  x.lineWidth = 6;
  x.strokeStyle = 'rgba(0,0,0,0.75)';
  x.strokeText(text, 128, 42);
  x.fillStyle = color;
  x.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(12, 3, 1);
  return s;
}

export class View {
  constructor(stage, world, me) {
    this.stage = stage;
    this.world = world;
    this.me = me;
    const scene = stage.scene;
    const def = world.course.def;
    stage.setTrack(def);
    this.ocean = makeOcean(world.waves, def);
    scene.add(this.ocean.mesh);
    this.fx = new Effects(scene);
    this.course = new THREE.Group();
    scene.add(this.course);
    for (const o of world.course.islands) this.course.add(makeIsland(o, def.island));
    for (const o of world.course.rocks) this.course.add(makeRock(o, def.island));
    // Gates: two pylons each, a chequered banner over the start
    this.gates = world.course.gates.map((g) => {
      const px = g.dz;
      const pz = -g.dx;
      const pair = [-1, 1].map((s) => {
        const p = makePylon(g.i === 0 ? 0xf4f4f4 : 0xff6a13);
        p.position.set(g.x + px * GATE_HALF * s, 0, g.z + pz * GATE_HALF * s);
        this.course.add(p);
        return p;
      });
      if (g.i === 0) {
        const banner = makeStartBanner(GATE_HALF * 2);
        banner.position.set(g.x, 0, g.z);
        // Facing down the course, so it spans the gate from pylon to pylon
        banner.rotation.y = Math.atan2(g.dx, g.dz);
        this.course.add(banner);
      }
      return { g, pair };
    });
    this.crates = new Map();
    for (const p of world.pickups.values()) {
      const m = makeCrate(p.kind);
      m.position.set(p.x, 0, p.z);
      this.course.add(m);
      this.crates.set(p.id, m);
    }
    this.boats = new Map();
    this.missiles = new Map();
    this.shield = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.18, depthWrite: false });
  }

  #boat(b) {
    let v = this.boats.get(b.id);
    if (!v) {
      const group = makeBoat(b.cls, b.k, b.color);
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(b.k.length * 0.62, 20, 14), this.shield);
      bubble.scale.set(0.45, 0.35, 1);
      bubble.visible = false;
      group.add(bubble);
      const tag = b.id === this.me ? null : nameTag(b.name, b.color);
      if (tag) { tag.position.y = 7; group.add(tag); }
      this.stage.scene.add(group);
      v = { group, bubble, tag };
      this.boats.set(b.id, v);
    }
    return v;
  }

  removeBoat(id) {
    const v = this.boats.get(id);
    if (v) this.stage.scene.remove(v.group);
    this.boats.delete(id);
    this.fx.dropWake(id);
  }

  // Everything that happened this frame: effects, and what the caller wants to know (shake, sound)
  events(list, onEvent) {
    const w = this.world;
    for (const e of list) {
      if (e.t === 'fire') {
        const b = w.boats.get(e.owner);
        if (b) this.fx.muzzle(e.x, e.y, e.z, e.w, Math.sin(b.h), Math.cos(b.h));
      } else if (e.t === 'impact') {
        const sea = heightAt(w.waves, e.x, e.z, w.t);
        this.fx.explode(e.x, e.y, e.z, e.w, Boolean(e.boat), sea);
      } else if (e.t === 'sunk') {
        const b = w.boats.get(e.id);
        if (b) this.fx.explode(b.x, b.y + 1, b.z, 'boat', true, heightAt(w.waves, b.x, b.z, w.t));
      } else if (e.t === 'crash' && e.hard > 6) {
        const sea = heightAt(w.waves, e.x, e.z, w.t);
        for (let i = 0; i < 14; i++) this.fx.smoke.emit(e.x, sea + 0.5, e.z, (Math.random() - 0.5) * 8, 5 + Math.random() * 6, (Math.random() - 0.5) * 8, { size: 1.4, grow: 2, life: 1.2, color: [0.95, 0.97, 1], alpha: 0.7, gravity: 12 });
      } else if (e.t === 'pickup') {
        const p = w.pickups.get(e.id);
        if (p) for (let i = 0; i < 18; i++) this.fx.glow.emit(p.x, 1.5, p.z, (Math.random() - 0.5) * 10, 3 + Math.random() * 6, (Math.random() - 0.5) * 10, { size: 0.6, life: 0.6, color: p.kind === 'repair' ? [0.3, 1, 0.5] : [1, 0.8, 0.3], gravity: 8 });
      }
      onEvent?.(e);
    }
  }

  update(dt) {
    const w = this.world;
    const t = w.t;
    const me = w.boats.get(this.me);
    this.ocean.update(t, this.stage.camera);
    for (const b of w.boats.values()) {
      const v = this.#boat(b);
      const g = v.group;
      const sunkFor = b.dead ? t - (b.respawnAt - 3) : 0;
      g.visible = !(b.dead && sunkFor > 2.7);
      g.position.set(b.x, b.y, b.z);
      g.rotation.set(-b.pitch, b.h, b.roll, 'YXZ');
      g.userData.hmg.rotation.y = b.aim?.yaw ?? 0;
      g.userData.cannon.rotation.y = b.aim?.yaw ?? 0;
      g.userData.radar.rotation.y = t * 4;
      v.bubble.visible = t < b.shieldUntil && Math.floor(t * 8) % 2 === 0;
      this.fx.boat(b, w.waves, t, dt);
    }
    for (const id of [...this.boats.keys()]) if (!w.boats.has(id)) this.removeBoat(id);
    // Missiles in flight
    const seen = new Set();
    for (const s of w.shots.values()) {
      if (s.w !== 'missile') continue;
      seen.add(s.id);
      let m = this.missiles.get(s.id);
      if (!m) { m = makeMissile(); this.stage.scene.add(m); this.missiles.set(s.id, m); }
      m.position.set(s.x, s.y, s.z);
      m.rotation.set(0, Math.atan2(s.vx, s.vz), 0);
      this.fx.missileTrail(s, dt);
    }
    for (const [id, m] of this.missiles) if (!seen.has(id)) { this.stage.scene.remove(m); this.missiles.delete(id); }
    this.fx.shots(w.shots.values(), this.stage.camera);
    // Crates bob and turn; taken ones are gone until they come back
    for (const [id, m] of this.crates) {
      const p = w.pickups.get(id);
      m.visible = !p.until;
      if (m.visible) {
        m.position.y = heightAt(w.waves, p.x, p.z, t) + 0.6;
        m.userData.box.rotation.y = t * 0.8;
      }
    }
    // The gate we are heading for glows; the rest are dim
    for (const { g, pair } of this.gates) {
      const next = me && g.i === me.next;
      for (const p of pair) {
        p.position.y = heightAt(w.waves, p.position.x, p.position.z, t) * 0.6 - 0.4;
        p.userData.mat.emissiveIntensity = next ? 0.55 + 0.35 * Math.sin(t * 6) : 0;
        p.userData.lamp.material.color.set(next ? 0x6bff8f : 0xffffff);
      }
    }
    this.fx.setScale(this.stage.height);
    this.fx.update(dt);
    if (me) this.stage.follow(me.x, me.z);
  }
}
