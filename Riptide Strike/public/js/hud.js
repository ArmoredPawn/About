// The heads-up display. Built here, into #hud:
//   top left      position, lap and race time, and the standings
//   top centre    the next gate (an arrow and its distance), and the target we are aiming at or locked onto
//   top right     a map of the course, and the kill feed
//   bottom left   a speed gauge, the throttle and the hull
//   bottom centre the four weapons: ammunition, heat, reloads, the missile lock and aircraft ready
//   centre        where the guns are pointed, the lock brackets on the target, hit markers, the direction damage
//                 came from, and a warning when a missile is coming for us
// plus the countdown, messages, and the results.

import * as THREE from 'three';
import { WEAPONS, SLOTS, BOATS } from './sim/boats.js';
import { SHIPS, SLOT_ICONS, SLOT_NAMES, SLOT_KEYS } from './icons.js';

const $ = (id) => document.getElementById(id);
const KNOTS = 1.944;
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'ST' : n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH'}`;
const time = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ARC = 251.3; // the speed gauge's arc length (a 270° arc of radius 53.3)

export class Hud {
  constructor(world, me, camera) {
    this.world = world;
    this.me = me;
    this.camera = camera;
    this.feedItems = [];
    this.toastT = 0;
    this.hitT = 0;
    this.killT = 0;
    this.hurts = [];
    this.v = new THREE.Vector3();
    this.slowT = 0;
    this.#build();
    this.map = $('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.#fitMap();
    $('hud').hidden = false;
  }

  #build() {
    const b = this.world.boats.get(this.me);
    const slots = SLOTS.map((s) => {
      const W = WEAPONS[b.k.loadout[s]];
      return `<div class="slot" id="w-${s}">
        <div class="slot-top"><span class="ico">${SLOT_ICONS[s]}</span><kbd>${SLOT_KEYS[s]}</kbd></div>
        <div class="slot-name">${esc(W.name)}</div>
        <div class="slot-count mono" id="w-${s}-n"></div>
        <div class="slot-bar"><i id="w-${s}-bar"></i></div>
      </div>`;
    }).join('');
    $('hud').innerHTML = `
      <div class="hud-tl panel-g">
        <div class="pos"><b id="h-pos">1</b><span id="h-of">/1</span></div>
        <div class="lapline"><span id="h-lap">LAP 1/3</span><span class="mono" id="h-time">0:00.0</span></div>
        <ol id="h-board" class="board"></ol>
      </div>
      <div class="hud-tc">
        <div class="compass panel-g"><span id="h-arrow" class="arrow">▲</span><span id="h-gate"></span></div>
        <div id="h-target" class="target panel-g" hidden>
          <div class="t-head"><span id="h-t-ship" class="t-ship"></span><b id="h-t-name"></b><span id="h-t-cls" class="faint"></span><span id="h-t-dist" class="mono t-dist"></span></div>
          <div class="t-bar"><i id="h-t-hp"></i></div>
          <div id="h-t-lock" class="t-lock"></div>
        </div>
      </div>
      <div class="hud-tr">
        <canvas id="minimap" width="440" height="440"></canvas>
        <ul id="feed" class="feed"></ul>
      </div>
      <div class="hud-bl panel-g">
        <svg class="gauge" viewBox="0 0 120 120" aria-hidden="true">
          <path class="g-bg" d="M 22.3 97.7 A 53.3 53.3 0 1 1 97.7 97.7"/>
          <path id="g-fill" class="g-fill" d="M 22.3 97.7 A 53.3 53.3 0 1 1 97.7 97.7" stroke-dasharray="0 ${ARC}"/>
        </svg>
        <div class="g-read"><b id="h-speed" class="mono">0</b><span>KNOTS</span></div>
        <div class="throttle"><i id="h-throttle"></i></div>
        <div class="hull"><div class="hull-head"><span>HULL</span><b id="h-hull-n" class="mono">100%</b></div><div class="hull-bar"><i id="h-hull"></i></div></div>
      </div>
      <div class="hud-bc">${slots}</div>
      <div id="h-aim" class="aim"></div>
      <div id="h-reticle" class="reticle"><i></i><i></i><i></i><i></i><span id="h-ret-txt"></span></div>
      <div id="h-hit" class="hitmark"></div>
      <div id="h-hurt" class="hurt"></div>
      <div id="h-incoming" class="incoming" hidden>⚠ MISSILE INCOMING</div>
      <div id="h-warn" class="warn" hidden></div>
      <div id="countdown" class="countdown" hidden></div>
      <div id="toast" class="toast"></div>
      <div id="vignette" class="vignette"></div>`;
  }

  #fitMap() {
    const c = this.world.course;
    const xs = c.line.pts.map((p) => p.x);
    const zs = c.line.pts.map((p) => p.z);
    const pad = 80;
    this.box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, z0: Math.min(...zs) - pad, z1: Math.max(...zs) + pad };
    const W = this.map.width;
    const H = this.map.height;
    this.scale = Math.min(W / (this.box.x1 - this.box.x0), H / (this.box.z1 - this.box.z0));
    // Drawn with +x to the left, as the world looks from behind a ship heading +z
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

  // What happened, in words, and the markers for it
  event(e, nameOf) {
    const me = this.me;
    if (e.t === 'sunk') {
      const how = { hmg: 'machine-gunned', ciws: 'shredded', c30: 'shelled', c57: 'shelled', c76: 'shelled', asm: 'torpedoed with a missile', cruise: 'hit with a cruise missile', bomb: 'bombed', heavybomb: 'bombed', ram: 'rammed', island: 'ran aground', rock: 'hit a rock' }[e.w] ?? 'sank';
      this.feed(e.by && e.by !== e.id ? `<b>${esc(nameOf(e.by))}</b> ${how} <b>${esc(nameOf(e.id))}</b>` : `<b>${esc(nameOf(e.id))}</b> ${how}`);
      if (e.id === me) this.toast('SUNK — BACK IN 3', 'bad');
      else if (e.by === me) { this.toast(`YOU SANK ${nameOf(e.id).toUpperCase()}`, 'good'); this.killT = 0.8; }
    } else if (e.t === 'lap' && e.id === me) this.toast(e.lap === this.world.laps ? 'FINAL LAP' : `LAP ${e.lap}`, 'good');
    else if (e.t === 'finish') this.feed(`<b>${esc(nameOf(e.id))}</b> finished in ${time(e.time)}`);
    else if (e.t === 'go') this.toast('GO!', 'good');
    else if (e.t === 'gate' && e.id === me && e.gate === 1) this.toast('WEAPONS HOT', 'warn');
    else if (e.t === 'overheat' && e.id === me) this.toast('GUN OVERHEATED', 'warn');
    else if (e.t === 'pickup' && e.boat === me) this.toast(e.kind === 'repair' ? 'HULL REPAIRED' : 'REARMED', 'good');
    else if (e.t === 'damaged' && e.id === me) {
      this.flash = 0.5;
      if (e.fx != null) this.hurts.push({ x: e.fx, z: e.fz, t: 1.2 });
    }
    // Our shot struck a ship
    if ((e.t === 'hit' && e.by === me) || (e.t === 'impact' && e.owner === me && e.boat) || (e.t === 'impact' && e.owner === me && e.downed)) this.hitT = 0.25;
  }

  #place(el, x, y, z) {
    this.v.set(x, y, z).project(this.camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.15 || Math.abs(this.v.y) > 1.15) { el.style.display = 'none'; return false; }
    el.style.display = 'block';
    el.style.transform = `translate(${((this.v.x + 1) / 2) * innerWidth}px, ${((1 - this.v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
    return true;
  }

  update(dt) {
    const w = this.world;
    const b = w.boats.get(this.me);
    if (!b) return;
    // The slower parts, five times a second
    this.slowT -= dt;
    const slow = this.slowT <= 0;
    if (slow) this.slowT = 0.2;
    const standings = slow ? w.standings() : null;
    if (slow) {
      const pos = standings.indexOf(b) + 1;
      $('h-pos').textContent = ord(pos);
      $('h-of').textContent = `/${standings.length}`;
      $('h-lap').textContent = b.finished ? 'FINISHED' : `LAP ${Math.min(b.lap, w.laps)}/${w.laps}`;
      $('h-board').innerHTML = standings.slice(0, 8).map((o, i) => `<li class="${o.id === this.me ? 'me' : ''}${o.dead ? ' dead' : ''}"><span class="pn">${i + 1}</span><span class="dot" style="background:${o.color}"></span><span class="nm">${esc(o.name)}</span><span class="cl">${SHIPS[o.cls]}</span><span class="k">${o.kills ? `${o.kills}✕` : ''}</span></li>`).join('');
      for (const f of this.feedItems) f.t -= 0.2;
      this.feedItems = this.feedItems.filter((f) => f.t > 0);
      $('feed').innerHTML = this.feedItems.map((f) => `<li style="opacity:${Math.min(1, f.t)}">${f.html}</li>`).join('');
    }
    $('h-time').textContent = time(Math.max(0, w.clock));
    // Speed, throttle, hull
    const kn = Math.abs(b.speed) * KNOTS;
    $('h-speed').textContent = Math.round(kn);
    $('g-fill').setAttribute('stroke-dasharray', `${(Math.min(1, kn / 100) * ARC).toFixed(1)} ${ARC}`);
    $('h-throttle').style.transform = `scaleX(${Math.max(0, b.throttle).toFixed(2)})`;
    const hull = b.hp / b.k.hp;
    $('h-hull').style.width = `${hull * 100}%`;
    $('h-hull').className = hull < 0.25 ? 'bad' : hull < 0.5 ? 'warn' : '';
    $('h-hull-n').textContent = w.t < b.shieldUntil ? 'SHIELD' : `${Math.ceil(hull * 100)}%`;
    // The weapons
    const L = b.k.loadout;
    const set = (s, count, bar, state = '') => {
      $(`w-${s}-n`).textContent = count;
      $(`w-${s}-bar`).style.width = `${Math.max(0, Math.min(1, bar)) * 100}%`;
      $(`w-${s}`).className = `slot ${state}${b.input?.[s] ? ' firing' : ''}${b.armed ? '' : ' locked'}`;
    };
    set('gun', b.overheated ? 'HOT' : '∞', b.heat, b.overheated ? 'bad' : b.heat > 0.7 ? 'warn' : '');
    set('cannon', b.ammo.cannon, b.ammo.cannon / b.k.ammo.cannon, b.ammo.cannon ? '' : 'empty');
    const mW = WEAPONS[L.missile];
    set('missile', b.ammo.missile, b.ammo.missile < b.k.ammo.missile ? b.reload.missile / mW.reload : 1, b.lock.locked ? 'ready' : b.ammo.missile ? '' : 'empty');
    const aW = WEAPONS[L.air];
    set('air', `${b.ammo.air}/${b.k.ammo.air}`, b.ammo.air < b.k.ammo.air ? b.reload.air / aW.reload : 1, b.ammo.air ? '' : 'empty');
    // Where the guns point
    const aimD = b.aim.target && !b.aim.air ? b.aim.dist : 180;
    const ay = b.h + b.aim.yaw;
    this.#place($('h-aim'), b.x + Math.sin(ay) * aimD, b.aim.air ? (b.aim.y ?? b.y + 20) : b.y + 3, b.z + Math.cos(ay) * aimD);
    $('h-aim').classList.toggle('aa', Boolean(b.aim.air));
    // The target: the locked ship, else the one in the sights
    const lockT = b.lock.target ? w.boats.get(b.lock.target) : null;
    const tgt = lockT ?? (b.aim.target && !b.aim.air ? w.boats.get(b.aim.target) : null);
    if (tgt && !b.dead) {
      $('h-target').hidden = false;
      if (slow) {
        $('h-t-ship').innerHTML = SHIPS[tgt.cls];
        $('h-t-name').textContent = tgt.name;
        $('h-t-cls').textContent = BOATS[tgt.cls].name;
      }
      $('h-t-dist').textContent = `${Math.round(Math.hypot(tgt.x - b.x, tgt.z - b.z))} m`;
      $('h-t-hp').style.width = `${(tgt.hp / tgt.k.hp) * 100}%`;
      $('h-t-lock').textContent = lockT ? (b.lock.locked ? `LOCKED · ${WEAPONS[L.missile].name.toUpperCase()} READY` : `LOCKING ${Math.round((b.lock.t / mW.lockTime) * 100)}%`) : 'IN THE SIGHTS';
      $('h-t-lock').className = `t-lock ${b.lock.locked ? 'on' : lockT ? 'trying' : ''}`;
    } else $('h-target').hidden = true;
    if (lockT && !b.dead) {
      const size = Math.max(46, Math.min(160, (lockT.k.length * 900) / Math.max(60, Math.hypot(lockT.x - b.x, lockT.z - b.z))));
      const r = $('h-reticle');
      r.style.width = r.style.height = `${size}px`;
      this.#place(r, lockT.x, lockT.y + lockT.k.beam * 0.4, lockT.z);
      r.className = `reticle ${b.lock.locked ? 'on' : ''}`;
      $('h-ret-txt').textContent = b.lock.locked ? 'LOCK' : '';
    } else $('h-reticle').style.display = 'none';
    // Hit marker
    this.hitT = Math.max(0, this.hitT - dt);
    this.killT = Math.max(0, this.killT - dt);
    $('h-hit').className = `hitmark ${this.hitT > 0 ? 'show' : ''} ${this.killT > 0 ? 'kill' : ''}`;
    // Where damage came from: a red arc on that side of the screen
    const camYaw = Math.atan2(this.camera.getWorldDirection(this.v).x, this.v.z);
    for (const h of this.hurts) h.t -= dt;
    this.hurts = this.hurts.filter((h) => h.t > 0).slice(-4);
    $('h-hurt').innerHTML = this.hurts.map((h) => `<i style="transform: rotate(${-(Math.atan2(h.x - b.x, h.z - b.z) - camYaw)}rad); opacity:${Math.min(1, h.t)}"></i>`).join('');
    // A missile coming for us
    let inbound = false;
    for (const s of w.shots.values()) if (WEAPONS[s.w]?.slot === 'missile' && s.target === this.me && s.owner !== this.me) { inbound = true; break; }
    $('h-incoming').hidden = !inbound || b.dead;
    this.inbound = inbound;
    // The next gate
    const g = w.course.gates[b.next];
    const ang = Math.atan2(g.x - b.x, g.z - b.z) - camYaw;
    $('h-arrow').style.transform = `rotate(${-ang}rad)`;
    $('h-gate').textContent = b.finished ? 'FINISHED' : `${g.i === 0 ? 'FINISH' : `GATE ${g.i}`} · ${Math.round(Math.hypot(g.x - b.x, g.z - b.z))} m`;
    // Warnings
    const warn = b.dead ? `SUNK — BACK IN ${Math.max(0, Math.ceil(b.respawnAt - w.t))}` : w.phase === 'race' && !b.armed && !b.finished ? 'WEAPONS ARM AT GATE 1' : b.offCourse ? 'OFF COURSE — HEAD FOR THE GREEN GATE' : '';
    $('h-warn').textContent = warn;
    $('h-warn').hidden = !warn;
    // Countdown
    const cd = $('countdown');
    if (w.phase === 'countdown') {
      cd.hidden = false;
      const n = Math.ceil(w.countdown);
      if (cd.dataset.n !== String(n)) { cd.dataset.n = String(n); cd.textContent = n > 3 ? 'READY' : n; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop'); }
    } else cd.hidden = true;
    // Toasts and the red flash when we are hit
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').className = 'toast'; }
    this.flash = Math.max(0, (this.flash ?? 0) - dt);
    $('vignette').style.opacity = String(Math.min(0.85, this.flash * 1.4 + (hull < 0.25 ? 0.35 : 0)));
    this.#drawMap(b);
  }

  #drawMap(me) {
    const x = this.mapCtx;
    const c = this.world.course;
    const W = this.map.width;
    const H = this.map.height;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(180,170,140,0.6)';
    for (const o of [...c.islands, ...c.rocks]) {
      const r = Math.max(2, o.r * this.scale);
      x.beginPath(); x.arc(this.mx(o.x), this.mz(o.z), r, 0, Math.PI * 2); x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,0.18)';
    x.lineWidth = Math.max(6, 100 * this.scale);
    x.lineJoin = 'round';
    const path = () => { x.beginPath(); c.line.pts.forEach((p, i) => (i ? x.lineTo(this.mx(p.x), this.mz(p.z)) : x.moveTo(this.mx(p.x), this.mz(p.z)))); x.closePath(); };
    path(); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.65)'; x.lineWidth = 2.5; path(); x.stroke();
    for (const g of c.gates) {
      const next = g.i === me.next;
      x.fillStyle = next ? '#6bff8f' : g.i === 0 ? '#fff' : '#ff8a3d';
      x.beginPath(); x.arc(this.mx(g.x), this.mz(g.z), next ? 9 : 5, 0, Math.PI * 2); x.fill();
      if (next) { x.strokeStyle = 'rgba(107,255,143,0.5)'; x.lineWidth = 3; x.beginPath(); x.arc(this.mx(g.x), this.mz(g.z), 15 + 4 * Math.sin(this.world.t * 5), 0, Math.PI * 2); x.stroke(); }
    }
    // Aircraft and missiles
    for (const s of this.world.shots.values()) {
      const slot = WEAPONS[s.w]?.slot;
      if (slot !== 'air' && slot !== 'missile') continue;
      x.fillStyle = s.owner === this.me ? '#9fe3ff' : '#ff6b5e';
      x.fillRect(this.mx(s.x) - 2.5, this.mz(s.z) - 2.5, 5, 5);
    }
    for (const b of this.world.boats.values()) {
      if (b.dead) continue;
      x.save();
      x.translate(this.mx(b.x), this.mz(b.z));
      // The map is drawn with +x to the left, so heading h points at angle −h
      x.rotate(-b.h);
      const s = 1 + b.k.length / 40;
      x.fillStyle = b.color;
      x.strokeStyle = b.id === this.me ? '#fff' : 'rgba(0,0,0,0.7)';
      x.lineWidth = b.id === this.me ? 3 : 1.5;
      x.beginPath(); x.moveTo(0, -12 * s); x.lineTo(8 * s, 9 * s); x.lineTo(-8 * s, 9 * s); x.closePath(); x.fill(); x.stroke();
      x.restore();
    }
  }

  results(list, { again, againText, menu, note }) {
    const box = $('results');
    box.hidden = false;
    const top = list.slice(0, 3);
    $('podium').innerHTML = [1, 0, 2].filter((i) => top[i]).map((i) => `<div class="step s${i + 1}${top[i].id === this.me ? ' me' : ''}"><div class="ship" style="color:${top[i].color}">${SHIPS[top[i].cls]}</div><b>${esc(top[i].name)}</b><span class="mono">${top[i].finished ? time(top[i].finishTime) : 'DNF'}</span><div class="block">${i + 1}</div></div>`).join('');
    $('results-rows').innerHTML = list.map((r, i) => `<tr class="${r.id === this.me ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</td><td class="faint">${esc(BOATS[r.cls]?.name ?? '')}</td><td class="mono">${r.finished ? time(r.finishTime) : 'DNF'}</td><td class="mono">${r.kills}</td><td class="mono">${r.deaths}</td></tr>`).join('');
    const best = [...list].sort((a, b) => b.kills - a.kills)[0];
    $('results-msg').innerHTML = [best?.kills ? `Top gun: <b>${esc(best.name)}</b>, ${best.kills} sunk.` : '', note ?? ''].filter(Boolean).join(' ');
    $('results-again').textContent = againText;
    $('results-again').disabled = !again;
    $('results-again').onclick = again;
    $('results-menu').onclick = menu;
  }

  hide() { $('hud').hidden = true; $('hud').innerHTML = ''; $('results').hidden = true; }
}
