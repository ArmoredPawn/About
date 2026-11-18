// The heads-up display: position and lap, speed and hull, the three weapons (machine-gun heat, shells, missiles and
// their lock), where the guns are aimed and what is locked, an arrow to the next gate, a map of the course, the
// kill feed, the countdown and the results.

import * as THREE from 'three';
import { WEAPONS } from './sim/boats.js';

const $ = (id) => document.getElementById(id);
const KNOTS = 1.944;
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const time = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Hud {
  constructor(world, me, camera) {
    this.world = world;
    this.me = me;
    this.camera = camera;
    this.feedItems = [];
    this.toastT = 0;
    this.v = new THREE.Vector3();
    this.map = $('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.#fitMap();
    $('hud').hidden = false;
    $('results').hidden = true;
  }

  #fitMap() {
    const c = this.world.course;
    const xs = c.line.pts.map((p) => p.x);
    const zs = c.line.pts.map((p) => p.z);
    const pad = 60;
    this.box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, z0: Math.min(...zs) - pad, z1: Math.max(...zs) + pad };
    const W = this.map.width;
    const H = this.map.height;
    this.scale = Math.min(W / (this.box.x1 - this.box.x0), H / (this.box.z1 - this.box.z0));
    // Drawn with +x to the left, as the world looks from behind a boat heading +z
    this.mx = (x) => W / 2 - (x - (this.box.x0 + this.box.x1) / 2) * this.scale;
    this.mz = (z) => H / 2 - (z - (this.box.z0 + this.box.z1) / 2) * this.scale;
  }

  toast(text, kind = '') {
    const el = $('toast');
    el.textContent = text;
    el.className = `toast show ${kind}`;
    this.toastT = 2.2;
  }

  feed(html) {
    this.feedItems.unshift({ html, t: 6 });
    this.feedItems = this.feedItems.slice(0, 5);
  }

  // What happened, in words
  event(e, nameOf) {
    const me = this.me;
    if (e.t === 'sunk') {
      const how = { hmg: 'machine-gunned', cannon: 'shelled', missile: 'hit with a missile', ram: 'rammed', island: 'ran aground', rock: 'hit a rock' }[e.w] ?? 'sank';
      this.feed(e.by && e.by !== e.id ? `<b>${esc(nameOf(e.by))}</b> ${how} <b>${esc(nameOf(e.id))}</b>` : `<b>${esc(nameOf(e.id))}</b> ${how}`);
      if (e.id === me) this.toast('Sunk! Back in 3 seconds', 'bad');
      else if (e.by === me) this.toast(`You sank ${nameOf(e.id)}`, 'good');
    } else if (e.t === 'lap' && e.id === me) this.toast(e.lap === this.world.laps ? 'Final lap!' : `Lap ${e.lap}`, 'good');
    else if (e.t === 'finish') this.feed(`<b>${esc(nameOf(e.id))}</b> finished in ${time(e.time)}`);
    else if (e.t === 'go') this.toast('GO!', 'good');
    else if (e.t === 'gate' && e.id === me && e.gate === 1) this.toast('Weapons hot', 'warn');
    else if (e.t === 'overheat' && e.id === me) this.toast('Machine gun overheated', 'warn');
    else if (e.t === 'pickup' && e.boat === me) this.toast(e.kind === 'repair' ? 'Hull repaired' : 'Ammunition taken on', 'good');
    else if (e.t === 'damaged' && e.id === me) this.hurt = 0.5;
  }

  #place(el, x, y, z) {
    this.v.set(x, y, z).project(this.camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) { el.style.display = 'none'; return false; }
    el.style.display = 'block';
    el.style.transform = `translate(${((this.v.x + 1) / 2) * innerWidth}px, ${((1 - this.v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
    return true;
  }

  update(dt) {
    const w = this.world;
    const b = w.boats.get(this.me);
    if (!b) return;
    const standings = w.standings();
    const pos = standings.indexOf(b) + 1;
    $('h-pos').innerHTML = `${pos}<small>/${standings.length}</small>`;
    $('h-lap').textContent = b.finished ? 'Finished' : `Lap ${Math.min(b.lap, w.laps)}/${w.laps}`;
    $('h-time').textContent = time(Math.max(0, w.clock));
    $('h-speed').textContent = Math.round(Math.abs(b.speed) * KNOTS);
    $('h-hull').style.width = `${(b.hp / b.k.hp) * 100}%`;
    $('h-hull').className = `fill ${b.hp < b.k.hp * 0.25 ? 'bad' : b.hp < b.k.hp * 0.5 ? 'warn' : ''}`;
    $('h-hull-n').textContent = Math.ceil(b.hp);
    $('h-heat').style.width = `${b.heat * 100}%`;
    $('h-heat').className = `fill ${b.overheated ? 'bad' : b.heat > 0.7 ? 'warn' : 'hot'}`;
    $('h-shells').textContent = b.shells;
    $('h-missiles').textContent = b.missiles;
    $('h-reload').style.width = `${b.missiles < b.k.missiles ? (b.reload / WEAPONS.missile.reload) * 100 : 0}%`;
    const lock = b.lock;
    $('h-lock').textContent = lock.locked ? 'LOCKED' : lock.target ? `LOCKING ${Math.round((lock.t / WEAPONS.missile.lockTime) * 100)}%` : 'NO LOCK';
    $('h-lock').className = `lock ${lock.locked ? 'on' : lock.target ? 'trying' : ''}`;
    // The standings
    $('h-board').innerHTML = standings.slice(0, 8).map((o, i) => `<li class="${o.id === this.me ? 'me' : ''}${o.dead ? ' dead' : ''}"><span class="pn">${i + 1}</span><span class="dot" style="background:${o.color}"></span><span class="nm">${esc(o.name)}</span><span class="k">${o.kills ? `${o.kills}✕` : ''}</span></li>`).join('');
    // Where the guns are pointed, and the locked target
    const aimD = b.aim.target ? b.aim.dist : 160;
    const ay = b.h + b.aim.yaw;
    this.#place($('h-aim'), b.x + Math.sin(ay) * aimD, b.y + 2, b.z + Math.cos(ay) * aimD);
    const tgt = lock.target ? w.boats.get(lock.target) : null;
    if (tgt && !b.dead) {
      this.#place($('h-reticle'), tgt.x, tgt.y + 2, tgt.z);
      $('h-reticle').className = `reticle ${lock.locked ? 'on' : ''}`;
    } else $('h-reticle').style.display = 'none';
    // The next gate: an arrow pointing to it from the camera's view, and how far
    const g = w.course.gates[b.next];
    const camYaw = Math.atan2(this.camera.getWorldDirection(this.v).x, this.v.z);
    const ang = Math.atan2(g.x - b.x, g.z - b.z) - camYaw;
    $('h-arrow').style.transform = `rotate(${-ang}rad)`;
    $('h-gate').textContent = b.finished ? '' : `${g.i === 0 ? 'Finish line' : `Gate ${g.i}`} · ${Math.round(Math.hypot(g.x - b.x, g.z - b.z))} m`;
    // Warnings
    const warn = b.dead ? `Sunk: back in ${Math.max(0, Math.ceil(b.respawnAt - w.t))}` : w.phase === 'race' && !b.armed && !b.finished ? 'Weapons lock until gate 1' : b.offCourse ? 'Off course: head for the glowing gate' : b.overheated ? 'Machine gun overheated' : '';
    $('h-warn').textContent = warn;
    $('h-warn').hidden = !warn;
    // Countdown
    const cd = $('countdown');
    if (w.phase === 'countdown') { cd.hidden = false; cd.textContent = Math.ceil(w.countdown); } else cd.hidden = true;
    // Kill feed
    for (const f of this.feedItems) f.t -= dt;
    this.feedItems = this.feedItems.filter((f) => f.t > 0);
    $('feed').innerHTML = this.feedItems.map((f) => `<li style="opacity:${Math.min(1, f.t)}">${f.html}</li>`).join('');
    // Toasts and the red flash when we are hit
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').className = 'toast'; }
    this.hurt = Math.max(0, (this.hurt ?? 0) - dt);
    $('vignette').style.opacity = String(Math.min(0.85, this.hurt * 1.6 + (b.hp < b.k.hp * 0.25 ? 0.35 : 0)));
    this.#drawMap(b);
  }

  #drawMap(me) {
    const x = this.mapCtx;
    const c = this.world.course;
    const W = this.map.width;
    const H = this.map.height;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(8,16,28,0.55)';
    x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(180,170,140,0.55)';
    for (const o of [...c.islands, ...c.rocks]) {
      const r = Math.max(1.5, o.r * this.scale);
      x.beginPath(); x.arc(this.mx(o.x), this.mz(o.z), r, 0, Math.PI * 2); x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,0.5)';
    x.lineWidth = 3;
    x.beginPath();
    c.line.pts.forEach((p, i) => (i ? x.lineTo(this.mx(p.x), this.mz(p.z)) : x.moveTo(this.mx(p.x), this.mz(p.z))));
    x.closePath();
    x.stroke();
    for (const g of c.gates) {
      x.fillStyle = g.i === me.next ? '#6bff8f' : g.i === 0 ? '#fff' : '#ff8a3d';
      x.beginPath(); x.arc(this.mx(g.x), this.mz(g.z), g.i === me.next ? 5 : 3, 0, Math.PI * 2); x.fill();
    }
    for (const b of this.world.boats.values()) {
      if (b.dead) continue;
      const px = this.mx(b.x);
      const pz = this.mz(b.z);
      x.save();
      x.translate(px, pz);
      // The map is drawn with +x to the left, so heading h points at angle −h
      x.rotate(-b.h);
      x.fillStyle = b.color;
      x.strokeStyle = b.id === this.me ? '#fff' : 'rgba(0,0,0,0.6)';
      x.lineWidth = b.id === this.me ? 2 : 1;
      x.beginPath(); x.moveTo(0, -7); x.lineTo(4.5, 5); x.lineTo(-4.5, 5); x.closePath(); x.fill(); x.stroke();
      x.restore();
    }
  }

  results(list, onAgain) {
    const box = $('results');
    box.hidden = false;
    $('results-rows').innerHTML = list.map((r, i) => `<tr class="${r.id === this.me ? 'me' : ''}"><td>${ord(i + 1)}</td><td><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</td><td>${r.finished ? time(r.finishTime) : 'DNF'}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('');
    $('results-again').onclick = onAgain;
  }

  hide() { $('hud').hidden = true; $('results').hidden = true; }
}
