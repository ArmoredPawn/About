// The world map: provinces, map modes, armies, fleets, operation arrows, front lines, pan and zoom, and picking
// targets.
// Between weekly updates, armies glide toward their new positions and front lines creep forward, so the war
// plays out continuously rather than in jumps.

import { GEO, ORDER, MAP_SIZE } from '../engine/data/geo.js';
import { PROVINCES } from '../engine/data/regions.js';
import { CHOKEPOINTS } from '../engine/data/world.js';
import { route } from '../engine/military.js';
import { NODES } from '../engine/navy.js';
import { PIPELINES, PIPELINE_PROJECTS } from '../engine/data/energy.js';
import { riskOf } from '../engine/climate.js';

const PIPE_DEFS = Object.fromEntries([...PIPELINES, ...PIPELINE_PROJECTS].map((p) => [p.id, p]));
import { svg, colorOf, RES_COLORS, RES_LETTERS, regionName } from './dom.js';

const W = MAP_SIZE.w;
const H = MAP_SIZE.h;
const NEUTRAL = '#2a3142';
const NEUTRAL_LIGHT = '#343c50';
const CAPITALS = Object.fromEntries(PROVINCES.filter((p) => p.capital).map((p) => [p.country, p.id]));
const INDEX = Object.fromEntries(ORDER.map((id, i) => [id, i]));

export class WorldMap {
  constructor(el, { onRegion, onArmy, onFleet, onHover, onContext, onTargetHint }) {
    this.el = el;
    this.onRegion = onRegion;
    this.onArmy = onArmy;
    this.onFleet = onFleet;
    this.onHover = onHover;
    this.onContext = onContext;
    this.onTargetHint = onTargetHint;
    this.tickMs = 9000;
    this.armyNodes = new Map();
    this.fleetNodes = new Map();
    this.selectedFleet = null;
    // What the map shows on top of the land: switched in the map tools
    this.layers = { armies: true, fleets: true, pipelines: true };
    this.fronts = new Map();
    this.samples = new Map();
    this.enemyKey = '';
    this.state = null;
    this.mode = 'political';
    this.resource = 'oil';
    this.view = { cx: W / 2, cy: H / 2 + 40, k: 1 };
    this.selected = null;
    this.selectedArmy = null;
    this.targeting = null;
    this.uses = new Map();
    this.fills = new Map();
  }

  async load() {
    const res = await fetch('data/map.json');
    const data = await res.json();
    const el = this.el;
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.defs = svg('defs');
    this.d = Object.fromEntries(ORDER.map((id) => [id, data.regions[id] ?? '']));
    markerDefs = this.defs;
    el.append(this.defs);
    el.append(svg('rect', { class: 'ocean', x: -W, y: -H, width: W * 3, height: H * 3 }));
    el.append(svg('path', { class: 'graticule', d: data.graticule }));
    this.gRegions = svg('g');
    this.gOcc = svg('g', { class: 'fronts', 'pointer-events': 'none' });
    this.gEnemy = svg('g', { class: 'enemy-outline', 'pointer-events': 'none' });
    this.gSel = svg('g', { 'pointer-events': 'none' });
    this.gRes = svg('g');
    this.gLabels = svg('g');
    this.gArrows = svg('g');
    this.gBattles = svg('g');
    this.gArmies = svg('g');
    this.gSeas = svg('g', { class: 'seas' });
    this.gLines = svg('g', { class: 'pipelines' });
    this.gFleets = svg('g');
    this.gPreview = svg('g', { 'pointer-events': 'none' });
    el.append(this.gRegions, this.gOcc, this.gEnemy, this.gLines, this.gRes, this.gSeas, this.gLabels, this.gArrows, this.gBattles, this.gFleets, this.gArmies, this.gSel, this.gPreview);
    for (const id of ORDER) {
      const u = svg('path', { d: this.d[id], class: 'region', 'data-id': id, fill: NEUTRAL });
      this.uses.set(id, u);
      this.gRegions.append(u);
    }
    this.#wire();
    this.#apply();
    new ResizeObserver(() => this.#apply()).observe(el);
  }

  /* ---------- Drawing ---------- */

  // live: a real-time step (every second or so) rather than a full weekly update
  update(state, { tick = false, live = false } = {}) {
    this.state = state;
    this.moving = tick || live;
    this.#paint();
    this.#drawEnemies();
    this.#drawLabels();
    this.#drawArmies();
    this.#drawFleets();
    this.#drawPipelines();
    this.#drawBattles();
    this.#drawOverlays();
    this.#animate();
  }

  // Oil (amber) and gas (blue) pipelines; dashed while shut, cut by war, wrecked or still being built
  #drawPipelines() {
    const s = this.state;
    const unit = this.#unit();
    const out = [];
    for (const p of s.pipelines ?? []) {
      const d = PIPE_DEFS[p.id];
      const pts = [d.from, ...(d.via ?? []), d.to].map((id) => GEO[id]).filter(Boolean);
      if (pts.length < 2) continue;
      const color = d.res === 'gas' ? '#5ec3e6' : '#d89a3a';
      const live = p.status === 'open' && p.flowing;
      const path = pts.map((g, i) => `${i ? 'L' : 'M'}${g.x} ${g.y}`).join('');
      out.push(svg('path', {
        class: 'pipeline', d: path, stroke: color, 'stroke-width': (live ? 2.2 : 1.6) / unit, opacity: live ? 0.85 : 0.5,
        'stroke-dasharray': live ? null : `${4 / unit} ${3 / unit}`,
      }, svg('title', {}, `${d.name} pipeline (${d.res}): ${p.status === 'building' ? `being built, ${p.left} weeks left` : p.status === 'sabotaged' ? 'wrecked by sabotage' : p.status === 'shut' ? 'shut' : live ? 'flowing' : 'cut by war'}`)));
    }
    this.gLines.replaceChildren(...out);
  }

  setLayers(layers) {
    this.layers = { ...this.layers, ...layers };
    this.gArmies.style.display = this.layers.armies ? '' : 'none';
    this.gArrows.style.display = this.layers.armies ? '' : 'none';
    this.gFleets.style.display = this.layers.fleets ? '' : 'none';
    this.gLines.style.display = this.layers.pipelines ? '' : 'none';
  }

  setMode(mode, resource) {
    this.mode = mode;
    if (resource) this.resource = resource;
    if (this.state) { this.#paint(); this.#drawOverlays(); }
  }

  #region(id) {
    const row = this.state.regions[INDEX[id]];
    return row && { owner: row[0], ctrl: row[1], dmg: row[2], infra: row[3], fort: row[4], battleBy: row[5], prog: row[6], unrest: row[7], gar: row[8], gdp: row[9], pop: row[10], rebels: row[11] ?? 0, from: row[12] || null, loyalty: row[13] ?? 50, policy: row[14] ?? 'integrate', people: row[15] ?? row[0] };
  }

  #paint() {
    const s = this.state;
    const me = s.me;
    const occ = [];
    let maxRes = 0;
    let maxDensity = 0;
    if (this.mode === 'resources') for (const id of ORDER) maxRes = Math.max(maxRes, s.resources[id]?.[this.resource]?.[0] ?? 0);
    if (this.mode === 'economy') for (const id of ORDER) { const r = this.#region(id); maxDensity = Math.max(maxDensity, r.gdp / Math.max(30, GEO[id].area)); }
    const rel = relationIndex(s);
    for (const id of ORDER) {
      const r = this.#region(id);
      let fill;
      switch (this.mode) {
        case 'alliances': fill = blocColor(s, rel, r.ctrl); break;
        case 'resources': {
          const amount = s.resources[id]?.[this.resource]?.[0] ?? 0;
          const potential = s.resources[id]?.[this.resource]?.[1] ?? 0;
          if (amount > 0) fill = mix(NEUTRAL_LIGHT, RES_COLORS[this.resource], 0.35 + 0.65 * Math.sqrt(amount / maxRes));
          else if (potential > 0) fill = mix(NEUTRAL, RES_COLORS[this.resource], 0.25);
          else fill = '#1c2230';
          break;
        }
        case 'economy': {
          const d = r.gdp / Math.max(30, GEO[id].area);
          fill = mix('#1a2133', '#7fb6ff', Math.min(1, Math.log1p(d * 40) / Math.log1p(maxDensity * 40)));
          break;
        }
        case 'climate': {
          // How exposed each province is to a warmer world: heat, drought, floods and fire
          fill = mix('#2b3a4a', '#e0662f', riskOf(id).total);
          break;
        }
        case 'loyalty': {
          // Red where people hate their rulers, green where they are content; conquered land is hatched darker
          const v = r.loyalty;
          fill = v >= 50 ? mix('#c9a227', '#3fae6e', (v - 50) / 50) : mix('#c23b3b', '#c9a227', v / 50);
          if (r.people !== r.ctrl) fill = mix(fill, '#1a1f2c', 0.35);
          break;
        }
        case 'relations': {
          if (r.ctrl === me) fill = '#8f95ff';
          else if (!s.countries[r.ctrl]) fill = NEUTRAL;
          else {
            const v = s.rel[r.ctrl] ?? 0;
            fill = v >= 0 ? mix('#3a4154', '#4cc38a', v / 100) : mix('#3a4154', '#e5484d', -v / 100);
          }
          break;
        }
        default: fill = politicalColor(s, r.ctrl);
      }
      if (this.fills.get(id) !== fill) {
        this.uses.get(id).setAttribute('fill', fill);
        this.fills.set(id, fill);
      }
      if (r.battleBy && r.prog > 0 && this.mode !== 'resources' && this.mode !== 'economy') occ.push(id);
    }
    this.#syncFronts(occ);
  }

  /* ---------- Front lines inside contested provinces ---------- */

  // Points around a province's outline, for measuring how far a front has moved across it
  #outline(id) {
    if (this.samples.has(id)) return this.samples.get(id);
    const el = this.uses.get(id);
    const pts = [];
    try {
      const len = el.getTotalLength();
      for (let i = 0; i < 72; i++) { const p = el.getPointAtLength((len * i) / 72); pts.push([p.x, p.y]); }
    } catch { pts.push([GEO[id].x - 5, GEO[id].y - 5], [GEO[id].x + 5, GEO[id].y + 5]); }
    this.samples.set(id, pts);
    return pts;
  }

  // Which way the attack is coming from: the attacker's own province, or the provinces it holds next door
  #attackFrom(id, by) {
    const s = this.state;
    const r = this.#region(id);
    const sameSide = (h) => h === by || s.alliances.some((al) => al.kind === 'military' && al.members.includes(h) && al.members.includes(by));
    if (r.from && GEO[r.from] && sameSide(this.#region(r.from)?.ctrl)) return GEO[r.from];
    const near = GEO[id].adj.filter((x) => sameSide(this.#region(x)?.ctrl));
    if (near.length) return { x: near.reduce((t, x) => t + GEO[x].x, 0) / near.length, y: near.reduce((t, x) => t + GEO[x].y, 0) / near.length };
    const army = s.armies.find((a) => a.owner === by && (a.attacking === id || a.sea?.to === id));
    const src = army ? GEO[army.sea?.from ?? army.region] : null;
    return src && src !== GEO[id] ? src : { x: GEO[id].x - 10, y: GEO[id].y };
  }

  #syncFronts(ids) {
    const now = performance.now();
    const live = new Set(ids);
    for (const [id, f] of this.fronts) if (!live.has(id)) { f.g.remove(); this.fronts.delete(id); }
    for (const id of ids) {
      const r = this.#region(id);
      let f = this.fronts.get(id);
      const color = this.mode === 'alliances' ? blocColor(this.state, relationIndex(this.state), r.battleBy) : politicalColor(this.state, r.battleBy);
      if (!f || f.by !== r.battleBy) {
        f?.g.remove();
        const clipId = `front-${id}`;
        const clip = svg('clipPath', { id: clipId }, svg('path', { d: this.d[id] }));
        const area = svg('polygon', { fill: color, opacity: 0.95 });
        const shade = svg('polyline', { class: 'front-shadow' });
        const line = svg('polyline', { class: 'front-line' });
        const labelA = svg('text', { class: 'front-label' });
        const labelB = svg('text', { class: 'front-label' });
        const g = svg('g', { 'clip-path': `url(#${clipId})` }, area, shade, line);
        const outer = svg('g', {}, clip, g, labelA, labelB);
        this.gOcc.append(outer);
        f = { g: outer, area, shade, line, labelA, labelB, by: r.battleBy, shown: r.prog, from: r.prog, to: r.prog, t0: now };
        this.fronts.set(id, f);
      }
      f.area.setAttribute('fill', color);
      if (f.to !== r.prog) { f.from = f.shown; f.to = r.prog; f.t0 = now; }
      f.origin = this.#attackFrom(id, r.battleBy);
      f.holder = r.ctrl;
      this.#placeFront(id, f);
    }
  }

  // The frame for a front across a province: t runs along the attack (lo = the edge it comes in from,
  // hi = the far edge), u across it. `value` is the battle's progress, 0-100.
  #frontFrame(id, origin, value) {
    const g = GEO[id];
    let dx = g.x - origin.x;
    let dy = g.y - origin.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy;
    const ny = dx;
    let lo = Infinity;
    let hi = -Infinity;
    let wlo = Infinity;
    let whi = -Infinity;
    for (const [x, y] of this.#outline(id)) {
      const t = x * dx + y * dy;
      const u = x * nx + y * ny;
      lo = Math.min(lo, t); hi = Math.max(hi, t); wlo = Math.min(wlo, u); whi = Math.max(whi, u);
    }
    const v = Math.max(0.02, Math.min(1, value / 100));
    const front = lo + (hi - lo) * v;
    // Where the front actually crosses the province: the outline points closest to the line
    let clo = Infinity;
    let chi = -Infinity;
    const band = Math.max(0.6, (hi - lo) * 0.05);
    for (const [x, y] of this.#outline(id)) {
      if (Math.abs(x * dx + y * dy - front) > band) continue;
      const u = x * nx + y * ny;
      clo = Math.min(clo, u); chi = Math.max(chi, u);
    }
    if (!(chi > clo)) { clo = wlo; chi = whi; }
    const mid = (clo + chi) / 2;
    // A ragged front, not a ruler line: each province has its own pattern of bulges and dents, which shifts
    // as the fighting moves, with a salient where the attack pushes hardest. It flattens out at the edges so
    // it never pokes past the province.
    const seed = [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const ph = (k) => ((seed >>> (k * 5)) % 628) / 100;
    const width = Math.max(1, whi - wlo);
    const depthT = hi - lo;
    const edge = Math.min(1, v * 100 / 12, (1 - v) * 100 / 12);
    const amp = depthT * 0.08 * edge;
    const p = value / 100;
    const jag = (u) => {
      const x = (u - wlo) / width * Math.PI * 2;
      const wave = 0.5 * Math.sin(x * 2.3 + ph(1) + p * 4.4) + 0.32 * Math.sin(x * 5.2 + ph(2) - p * 6.1) + 0.18 * Math.sin(x * 11.7 + ph(3) + p * 9.3);
      const salient = 0.9 * Math.exp(-(((u - mid) / (width * 0.22)) ** 2));
      return amp * (wave + salient);
    };
    const at = (t, u) => [t * dx + u * nx, t * dy + u * ny];
    return { dx, dy, nx, ny, lo, hi, wlo, whi, front, mid, jag, at, depth: depthT };
  }

  #placeFront(id, f) {
    const F = this.#frontFrame(id, f.origin, f.shown);
    const { lo, wlo, whi, front, at, jag, mid, hi } = F;
    const pad = (hi - lo) + (whi - wlo) + 10;
    const line = [];
    const n = 36;
    for (let i = 0; i <= n; i++) {
      const u = wlo - 2 + ((whi - wlo + 4) * i) / n;
      line.push(at(front + jag(u), u));
    }
    const pts = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    f.area.setAttribute('points', pts([at(lo - pad, wlo - pad), at(front, wlo - pad), ...line, at(front, whi + pad), at(lo - pad, whi + pad)]));
    for (const ln of [f.shade, f.line]) ln.setAttribute('points', pts(line));
    // Name each side once zoomed in: "Spain holds this side, Portugal that one". Off to one side of the
    // middle, where the attacking army stands.
    const unit = this.#unit();
    const show = unit >= 2;
    const off = Math.min(18 / unit, (hi - lo) * 0.25 + 4 / unit);
    const lu = Math.min(whi - 4 / unit, mid + 30 / unit);
    const name = (x) => shortName(this.state.countries[x]?.name ?? this.state.minors[x]?.name ?? '');
    for (const [el, t, who] of [[f.labelA, front + jag(lu) - off, f.by], [f.labelB, front + jag(lu) + off, f.holder]]) {
      el.setAttribute('display', show ? 'inline' : 'none');
      if (!show) continue;
      const [x, y] = at(t, lu);
      el.setAttribute('x', x); el.setAttribute('y', y);
      el.setAttribute('font-size', 9 / unit);
      el.setAttribute('stroke-width', 2.2 / unit);
      el.textContent = name(who);
    }
  }

  /* ---------- Enemies: a red line around everything held by a country at war with us ---------- */

  #drawEnemies() {
    const s = this.state;
    const enemies = relationIndex(s).enemies;
    const ids = enemies.size ? ORDER.filter((id) => enemies.has(this.#region(id).ctrl)) : [];
    const key = ids.join(',');
    if (key === this.enemyKey) return;
    this.enemyKey = key;
    if (!ids.length) { this.gEnemy.replaceChildren(); return; }
    const mask = svg('mask', { id: 'enemy-mask', maskUnits: 'userSpaceOnUse', x: -W, y: -H, width: W * 3, height: H * 3 },
      svg('rect', { x: -W, y: -H, width: W * 3, height: H * 3, fill: 'white' }),
      ...ids.map((id) => svg('path', { d: this.d[id], fill: 'black' })));
    this.gEnemy.replaceChildren(mask, svg('g', { mask: 'url(#enemy-mask)' }, ...ids.map((id) => svg('path', { d: this.d[id], class: 'enemy-edge' }))));
  }

  /* ---------- Animation between weekly updates ---------- */

  #animate() {
    cancelAnimationFrame(this.animRaf);
    const step = () => {
      const now = performance.now();
      let busy = false;
      for (const [id, f] of this.fronts) {
        const k = Math.min(1, (now - f.t0) / ((this.stepMs ?? this.tickMs) * 0.95));
        const shown = f.from + (f.to - f.from) * k;
        if (Math.abs(shown - f.shown) > 0.05) { f.shown = shown; this.#placeFront(id, f); }
        if (k < 1) busy = true;
      }
      for (const n of [...this.armyNodes.values(), ...this.fleetNodes.values()]) {
        const k = Math.min(1, (now - n.t0) / n.dur);
        const e = k * (2 - k) * 0.35 + k * 0.65;
        n.x = n.fx + (n.tx - n.fx) * e;
        n.y = n.fy + (n.ty - n.fy) * e;
        n.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
        if (k < 1) busy = true;
      }
      if (busy) this.animRaf = requestAnimationFrame(step);
    };
    this.animRaf = requestAnimationFrame(step);
  }

  #drawLabels() {
    const s = this.state;
    const k = this.view.k;
    const unit = this.#unit();
    const out = [];
    const groups = new Map();
    for (const id of ORDER) {
      const r = this.#region(id);
      if (!s.countries[r.owner]) continue;
      (groups.get(r.owner) ?? groups.set(r.owner, []).get(r.owner)).push(id);
    }
    for (const [cid, ids] of groups) {
      const anchorId = ids.includes(CAPITALS[cid]) ? CAPITALS[cid] : ids.reduce((m, id) => (GEO[id].area > GEO[m].area ? id : m), ids[0]);
      const a = GEO[anchorId];
      let sx = 0, sy = 0, sw = 0, area = 0;
      for (const id of ids) {
        const g = GEO[id];
        if (Math.hypot(g.x - a.x, g.y - a.y) > 160) continue;
        sx += g.x * g.area; sy += g.y * g.area; sw += g.area; area += g.area;
      }
      if (!sw) continue;
      const screen = Math.max(9, Math.min(17, Math.sqrt(area) * 0.16 * k));
      // Only label a country that is wide enough on screen to hold its name
      if (Math.sqrt(area) * unit * 1.5 < screen * shortName(s.countries[cid].name).length * 0.55) continue;
      out.push(svg('text', { class: 'country-label', x: sx / sw, y: sy / sw, 'font-size': screen / unit, 'stroke-width': 2.6 / unit }, shortName(s.countries[cid].name)));
    }
    // Smaller labels appear once places are big enough on screen to hold them
    if (unit >= 1.2) {
      for (const id of ORDER) {
        const r = this.#region(id);
        const g = GEO[id];
        const onScreen = g.area * unit * unit;
        if (s.minors[id] && r.owner === id && onScreen > 400) {
          out.push(svg('text', { class: 'region-label', x: g.x, y: g.y, 'font-size': 10 / unit, 'stroke-width': 1.8 / unit }, s.minors[id].name));
        } else if (unit >= 2.4 && s.countries[r.owner] && !s.countries[id] && onScreen > 2500) {
          out.push(svg('text', { class: 'region-label', x: g.x, y: g.y + 12 / unit, 'font-size': 9 / unit, 'stroke-width': 1.8 / unit }, provinceShort(id)));
        }
      }
    }
    this.gLabels.replaceChildren(...out);
  }

  #drawArmies() {
    const s = this.state;
    const unit = this.#unit();
    const byRegion = new Map();
    for (const a of s.armies) {
      const at = a.sea ? (a.attacking ?? a.sea.to) : a.region;
      (byRegion.get(at) ?? byRegion.set(at, []).get(at)).push(a);
    }
    // Armies attacking each province, side by side along its front
    const atFront = new Map();
    for (const a of s.armies) if (a.attacking && !a.sea) (atFront.get(a.attacking) ?? atFront.set(a.attacking, []).get(a.attacking)).push(a.id);
    const arrows = [];
    const friendly = (owner) => owner === s.me || s.alliances.some((al) => al.kind === 'military' && al.members.includes(owner) && al.members.includes(s.me));
    for (const a of s.armies) {
      const pts = [];
      const from = GEO[a.sea ? a.sea.from ?? a.region : a.region];
      if (a.exact && a.sea && a.sea.from) {
        pts.push(GEO[a.sea.from], GEO[a.sea.to]);
        arrows.push(arrowPath(pts, colorOf(a.owner), unit, true));
      } else if (a.exact && a.path?.length) {
        // Ours and our allies', and an enemy's when our spies are deep inside its government
        pts.push(from, ...a.path.map((id) => GEO[id]));
        arrows.push(arrowPath(pts, colorOf(a.owner), unit, a.op?.kind !== 'attack'));
      } else if (a.attacking && !a.sea) {
        arrows.push(arrowPath([from, GEO[a.attacking]], colorOf(a.owner), unit, false));
      }
    }
    const now = performance.now();
    const seen = new Set();
    for (const [at, list] of byRegion) {
      const g = GEO[at];
      list.forEach((a, i) => {
        const w = 34 / unit;
        const hgt = 14 / unit;
        let cx = g.x + (i % 2) * (w + 2 / unit) - (list.length > 1 ? (w + 2 / unit) / 2 : 0);
        let cy = g.y + Math.floor(i / 2) * (hgt + 2 / unit) + 6 / unit;
        // Attacking armies stand right on the front line and advance with it as the battle goes their way
        if (a.attacking && !a.sea && GEO[a.attacking]) {
          const r = this.#region(a.attacking);
          const origin = r.battleBy ? this.#attackFrom(a.attacking, r.battleBy) : g;
          const F = this.#frontFrame(a.attacking, origin === GEO[a.attacking] ? g : origin, r.battleBy ? r.prog : 0);
          const side = atFront.get(a.attacking);
          const j = side.indexOf(a.id);
          const u = F.mid + (j - (side.length - 1) / 2) * (w + 3 / unit);
          [cx, cy] = F.at(F.front + F.jag(u) - hgt * 0.75, u);
        }
        if (a.sea && a.sea.from && a.sea.left != null && !a.attacking) {
          const f = GEO[a.sea.from];
          const k = 1 / (1 + Math.max(0, a.sea.left));
          cx = f.x + (g.x - f.x) * k;
          cy = f.y + (g.y - f.y) * k;
        }
        seen.add(a.id);
        const mine = friendly(a.owner);
        let n = this.armyNodes.get(a.id);
        if (!n) {
          n = { g: svg('g', { 'data-army': a.id }), x: cx, y: cy, fx: cx, fy: cy, tx: cx, ty: cy, t0: now, dur: 1 };
          this.armyNodes.set(a.id, n);
          this.gArmies.append(n.g);
        }
        if (Math.abs(n.tx - cx) > 0.01 || Math.abs(n.ty - cy) > 0.01) {
          n.fx = n.x; n.fy = n.y; n.tx = cx; n.ty = cy; n.t0 = now;
          n.dur = this.moving ? (this.stepMs ?? this.tickMs) * 0.95 : 250;
        }
        n.g.setAttribute('class', `army${this.selectedArmy === a.id ? ' sel' : ''}${mine ? '' : ' foe'}`);
        n.g.setAttribute('opacity', a.sea ? '0.85' : '1');
        n.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
        n.g.replaceChildren(
          svg('rect', { x: -w / 2, y: -hgt / 2, width: w, height: hgt, rx: 3 / unit, fill: colorOf(a.owner) }),
          svg('text', { x: 0, y: 0, 'font-size': 9 / unit }, (a.exact || a.seen ? '' : '~') + armyLabel(a.troops)),
          svg('title', {}, `${a.name} (${s.countries[a.owner]?.name ?? ''})${a.status ? `: ${a.status}` : ''}`));
      });
    }
    for (const [id, n] of this.armyNodes) if (!seen.has(id)) { n.g.remove(); this.armyNodes.delete(id); }
    this.gArrows.replaceChildren(...arrows);
  }

  /* ---------- Fleets and the seas ---------- */

  // Sea names on the water; clicking one (or a strait) while a fleet is selected sends it there
  #drawSeas() {
    const unit = this.#unit();
    const out = [];
    for (const [key, n] of Object.entries(NODES)) {
      if (n.kind !== 'sea') continue;
      out.push(svg('text', { class: 'sea-name', x: n.x, y: n.y - 8 / unit, 'font-size': 11 / unit, 'data-node': key }, n.name));
    }
    this.gSeas.replaceChildren(...out);
  }

  #drawFleets() {
    const s = this.state;
    const unit = this.#unit();
    const fleets = s.fleets ?? [];
    const friendly = (owner) => owner === s.me || s.alliances.some((al) => al.kind === 'military' && al.members.includes(owner) && al.members.includes(s.me));
    const w = 40 / unit;
    const hgt = 13 / unit;
    // Fleets at (nearly) the same spot are fanned out side by side so none hides another
    const placed = [];
    const spot = new Map();
    const order = [...fleets].sort((a, b) => (a.owner === s.me ? -1 : 0) - (b.owner === s.me ? -1 : 0) || (a.id < b.id ? -1 : 1));
    for (const f of order) {
      const near = placed.filter((p) => Math.abs(p.x - f.x) < w * 0.9 && Math.abs(p.y - f.y) < hgt * 0.9).length;
      const cx = f.x + (near % 2) * (w + 2 / unit) - (near ? (w + 2 / unit) / 2 : 0);
      const cy = f.y + Math.floor(near / 2) * (hgt + 2 / unit);
      spot.set(f.id, [cx, cy]);
      placed.push({ x: f.x, y: f.y });
    }
    const now = performance.now();
    const seen = new Set();
    for (const f of fleets) {
      const [cx, cy] = spot.get(f.id);
      seen.add(f.id);
      let n = this.fleetNodes.get(f.id);
      if (!n) {
        n = { g: svg('g', { 'data-fleet': f.id }), x: cx, y: cy, fx: cx, fy: cy, tx: cx, ty: cy, t0: now, dur: 1 };
        this.fleetNodes.set(f.id, n);
        this.gFleets.append(n.g);
      }
      // Never glide across the whole map where a fleet crosses the Pacific edge
      if (Math.abs(n.tx - cx) > W / 2) { n.x = n.fx = n.tx = cx; n.y = n.fy = n.ty = cy; }
      if (Math.abs(n.tx - cx) > 0.01 || Math.abs(n.ty - cy) > 0.01) {
        n.fx = n.x; n.fy = n.y; n.tx = cx; n.ty = cy; n.t0 = now;
        n.dur = this.moving ? (this.stepMs ?? this.tickMs) * 0.95 : 250;
      }
      const mine = friendly(f.owner);
      n.g.setAttribute('class', `fleet${this.selectedFleet === f.id ? ' sel' : ''}${mine ? '' : ' foe'}${f.battle ? ' fighting' : ''}`);
      n.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
      const label = `⚓ ${f.ships}${f.carriers ? ` +${f.carriers}✈` : ''}`;
      n.g.replaceChildren(
        svg('rect', { x: -w / 2, y: -hgt / 2, width: w, height: hgt, rx: hgt / 2, fill: colorOf(f.owner) }),
        svg('text', { x: 0, y: 0, 'font-size': 8.5 / unit }, label),
        svg('title', {}, `${f.name} (${s.countries[f.owner]?.name ?? ''}): ${f.ships} warships${f.carriers ? `, ${f.carriers} aircraft carriers` : ''}${f.status ? ` · ${f.status}` : ''}`));
    }
    for (const [id, n] of this.fleetNodes) if (!seen.has(id)) { n.g.remove(); this.fleetNodes.delete(id); }
    // Our fleets' courses: a dotted line along the route, to a ring where it will stop
    const lines = [];
    for (const f of fleets) {
      if (f.owner !== s.me || !f.route?.length) continue;
      const pts = [[f.x, f.y], ...f.route];
      // Draw each leg on the copy of the map it falls on (routes across the Pacific edge run past 0 or 2,000)
      for (const shift of [0, -W, W]) {
        const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x + shift} ${y}`).join('');
        lines.push(svg('path', { d, class: 'fleet-route', stroke: colorOf(f.owner), 'stroke-width': 2 / unit, 'stroke-dasharray': `${4 / unit} ${3 / unit}` }));
      }
      const [ex, ey] = f.route[f.route.length - 1];
      lines.push(svg('circle', { cx: ((ex % W) + W) % W, cy: ey, r: 5 / unit, class: 'fleet-dest', stroke: colorOf(f.owner), 'stroke-width': 1.5 / unit }));
    }
    this.gFleetArrows ??= (() => { const g = svg('g', { 'pointer-events': 'none' }); this.gFleets.before(g); return g; })();
    this.gFleetArrows.replaceChildren(...lines);
    this.#drawSeas();
  }

  selectFleet(id) {
    this.selectedFleet = id;
    if (this.state) this.#drawFleets();
  }

  #drawBattles() {
    const unit = this.#unit();
    const out = [];
    for (const id of ORDER) {
      const r = this.#region(id);
      if (!r.battleBy) continue;
      const g = GEO[id];
      const rad = 9 / unit;
      const prog = Math.max(0.02, r.prog / 100);
      const end = [g.x + rad * Math.sin(prog * 2 * Math.PI), g.y - rad * Math.cos(prog * 2 * Math.PI)];
      out.push(svg('g', { class: 'battle' },
        svg('circle', { cx: g.x, cy: g.y - 16 / unit, r: rad, fill: 'rgb(12 14 22 / 0.85)', stroke: '#e5484d', 'stroke-width': 1 / unit }),
        svg('path', { d: `M${g.x} ${g.y - 16 / unit - rad}A${rad} ${rad} 0 ${prog > 0.5 ? 1 : 0} 1 ${end[0]} ${end[1] - 16 / unit}`, fill: 'none', stroke: colorOf(r.battleBy), 'stroke-width': 2.2 / unit }),
        svg('text', { x: g.x, y: g.y - 16 / unit, 'font-size': 10 / unit, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff' }, '⚔')));
    }
    for (const id of ORDER) {
      const r = this.#region(id);
      if (!r.rebels) continue;
      const g = GEO[id];
      const rad = 7 / unit;
      out.push(svg('g', { class: 'revolt' },
        svg('circle', { cx: g.x + 14 / unit, cy: g.y - 14 / unit, r: rad, fill: 'rgb(40 16 8 / 0.9)', stroke: '#ff9a3c', 'stroke-width': 1 / unit }),
        svg('text', { x: g.x + 14 / unit, y: g.y - 14 / unit, 'font-size': 9 / unit, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, '🔥'),
        svg('title', {}, `Uprising in ${regionName(id)}: about ${Math.round(r.rebels)}K rebels`)));
    }
    this.gBattles.replaceChildren(...out);
  }

  #drawOverlays() {
    const s = this.state;
    const unit = this.#unit();
    const out = [];
    if (this.mode === 'resources') {
      for (const id of ORDER) {
        const amt = s.resources[id]?.[this.resource];
        if (!amt || !(amt[0] > 0 || amt[1] > 0)) continue;
        const g = GEO[id];
        const r = 7 / unit;
        out.push(svg('g', { class: 'res-icon' },
          svg('circle', { cx: g.x, cy: g.y, r, fill: amt[0] > 0 ? RES_COLORS[this.resource] : 'none', stroke: RES_COLORS[this.resource], 'stroke-width': amt[0] > 0 ? 0.5 / unit : 1.2 / unit }),
          amt[0] > 0 ? svg('text', { x: g.x, y: g.y, 'font-size': 6.5 / unit }, RES_LETTERS[this.resource]) : null,
          svg('title', {}, `${regionName(id)}: ${amt[0]} now${amt[1] > amt[0] ? `, ${amt[1]} possible` : ''}`)));
      }
    }
    for (const [key, cp] of Object.entries(CHOKEPOINTS)) {
      const g = NODES[key] ?? GEO[cp.regions[0]];
      if (!g) continue;
      const st = s.chokepoints[key];
      const closed = Boolean(st?.closedBy) || Object.values(st?.patrols ?? {}).some((p) => p.mode === 'all');
      const r = 5 / unit;
      out.push(svg('g', { class: 'chokepoint', 'data-node': key },
        svg('rect', { 'data-node': key, x: g.x - r, y: g.y - r, width: r * 2, height: r * 2, rx: 1.5 / unit, fill: closed ? '#e5484d' : 'rgb(12 14 22 / 0.8)', stroke: closed ? '#fff' : '#5ec3e6', 'stroke-width': 0.8 / unit, transform: `rotate(45 ${g.x} ${g.y})` }),
        svg('title', {}, `${cp.name}${closed ? ' (CLOSED)' : ''}`)));
    }
    this.gRes.replaceChildren(...out);
  }

  /* ---------- Selection and targeting ---------- */

  select(id) {
    this.selected = id;
    this.gSel.replaceChildren(...(id ? [svg('path', { d: this.d[id], class: 'outline', fill: 'rgb(255 255 255 / 0.08)', stroke: '#fff', 'stroke-width': 2 })] : []));
  }

  selectArmy(id) {
    this.selectedArmy = id;
    if (this.state) this.#drawArmies();
  }

  startTargeting(opts) {
    this.targeting = opts;
    this.el.classList.add('targeting');
  }

  stopTargeting() {
    this.targeting = null;
    this.el.classList.remove('targeting');
    this.gPreview.replaceChildren();
  }

  #preview(id) {
    const t = this.targeting;
    if (!t || !id) { this.gPreview.replaceChildren(); this.onTargetHint?.(null); return; }
    const ok = !t.filter || t.filter(id);
    this.onTargetHint?.(ok ? null : t.reason?.(id) ?? null);
    const unit = this.#unit();
    const nodes = [svg('path', { d: this.d[id], class: 'outline', fill: ok ? 'rgb(255 255 255 / 0.18)' : 'rgb(229 72 77 / 0.25)', stroke: ok ? '#fff' : '#e5484d', 'stroke-width': 1.5 })];
    if (ok && t.from) {
      let pts = null;
      const custom = t.path?.(id);
      if (custom) pts = [GEO[t.from], ...custom.map((x) => GEO[x])];
      else if (t.path) pts = null;
      else if (t.kind === 'invade') pts = [GEO[t.from], GEO[id]];
      else {
        const path = route(fauxState(this.state), this.state.me, t.from, id, { offensive: t.kind === 'attack' });
        if (path) pts = [GEO[t.from], ...path.map((x) => GEO[x])];
      }
      if (pts && pts.length > 1) nodes.push(arrowPath(pts, '#ffffff', unit, t.kind !== 'attack'));
    }
    this.gPreview.replaceChildren(...nodes);
  }

  /* ---------- Pan and zoom ---------- */

  #unit() {
    // screen pixels per map unit at the current zoom
    const rect = this.el.getBoundingClientRect();
    const vbW = W / this.view.k;
    const vbH = vbW * (rect.height / Math.max(1, rect.width));
    return Math.min(rect.width / vbW, rect.height / vbH) || 1;
  }

  #apply() {
    const rect = this.el.getBoundingClientRect();
    if (!rect.width) return;
    const vbW = W / this.view.k;
    const vbH = vbW * (rect.height / rect.width);
    const v = this.view;
    v.cx = Math.max(0, Math.min(W, v.cx));
    v.cy = Math.max(-vbH / 4, Math.min(H + vbH / 4, v.cy));
    this.el.setAttribute('viewBox', `${v.cx - vbW / 2} ${v.cy - vbH / 2} ${vbW} ${vbH}`);
    this.el.classList.toggle('zoomed', this.#unit() >= 2.4);
    if (this.state) {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => { this.moving = false; this.#drawLabels(); this.#drawArmies(); this.#drawFleets(); this.#drawPipelines(); this.#drawBattles(); this.#drawOverlays(); for (const [id, f] of this.fronts) this.#placeFront(id, f); });
    }
  }

  #toMap(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    const vbW = W / this.view.k;
    const vbH = vbW * (rect.height / rect.width);
    return [this.view.cx - vbW / 2 + ((clientX - rect.left) / rect.width) * vbW, this.view.cy - vbH / 2 + ((clientY - rect.top) / rect.height) * vbH];
  }

  zoomBy(factor, clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    clientX ??= rect.left + rect.width / 2;
    clientY ??= rect.top + rect.height / 2;
    const [mx, my] = this.#toMap(clientX, clientY);
    const k = Math.max(1, Math.min(40, this.view.k * factor));
    const vbW = W / k;
    const vbH = vbW * (rect.height / rect.width);
    this.view.k = k;
    this.view.cx = mx - ((clientX - rect.left) / rect.width - 0.5) * vbW;
    this.view.cy = my - ((clientY - rect.top) / rect.height - 0.5) * vbH;
    this.#apply();
  }

  // Centre on a sea, a strait, or a point
  focusPoint(node) {
    const n = typeof node === 'string' ? NODES[node] : node;
    if (!n) return;
    this.view.k = Math.max(this.view.k, 2.5);
    this.view.cx = n.x;
    this.view.cy = n.y;
    this.#apply();
  }

  focus(ids) {
    const pts = ids.map((id) => GEO[id]).filter(Boolean);
    if (!pts.length) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const spanX = Math.max(60, Math.max(...xs) - Math.min(...xs)) * 1.8;
    const spanY = Math.max(40, Math.max(...ys) - Math.min(...ys)) * 1.8;
    const rect = this.el.getBoundingClientRect();
    const aspect = rect.height / Math.max(1, rect.width);
    this.view.k = Math.max(1, Math.min(16, Math.min(W / spanX, W * aspect / spanY)));
    this.view.cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    this.view.cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    this.#apply();
  }

  #wire() {
    const el = this.el;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let hover = null;

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY);
    }, { passive: false });

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false, target: e.target };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: this.view.k };
        drag = null;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomBy((pinch.k * d) / pinch.d / this.view.k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; el.classList.add('dragging'); }
        if (drag.moved) {
          const rect = el.getBoundingClientRect();
          const scale = (W / this.view.k) / rect.width;
          this.view.cx = drag.cx - dx * scale;
          this.view.cy = drag.cy - dy * scale;
          this.#apply();
          return;
        }
      }
      const id = e.target?.dataset?.id ?? null;
      if (id !== hover) {
        if (hover) this.uses.get(hover)?.classList.remove('hover');
        hover = id;
        if (id) this.uses.get(id)?.classList.add('hover');
        this.onHover?.(id);
        if (this.targeting) this.#preview(id);
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag || pointers.size) return;
      const d = drag;
      drag = null;
      el.classList.remove('dragging');
      if (d.moved) return;
      const armyEl = d.target.closest?.('[data-army]');
      const fleetEl = d.target.closest?.('[data-fleet]');
      const nodeEl = d.target.closest?.('[data-node]');
      const id = d.target.dataset?.id;
      if (this.targeting) {
        if (armyEl && this.targeting.onArmy?.(armyEl.dataset.army)) return;
        if (fleetEl && this.targeting.onFleet?.(fleetEl.dataset.fleet)) return;
        if (nodeEl && this.targeting.onNode?.(nodeEl.dataset.node)) return;
        if (!id && !armyEl && !fleetEl && !nodeEl && this.targeting.onWater) { const [mx, my] = this.#toMap(d.x, d.y); this.targeting.onWater(((mx % W) + W) % W, my); return; }
        if (id && (!this.targeting.filter || this.targeting.filter(id))) this.targeting.onPick(id);
        else if (id) this.targeting.onReject?.(id);
        return;
      }
      if (fleetEl) return this.onFleet?.(fleetEl.dataset.fleet);
      if (armyEl) return this.onArmy?.(armyEl.dataset.army);
      if (nodeEl) return;
      this.onRegion?.(id ?? null);
    };
    el.addEventListener('pointerup', end);
    // Right-click: a quick order for the selected army
    el.addEventListener('contextmenu', (e) => {
      const id = e.target?.dataset?.id;
      if (!id || this.targeting) return;
      e.preventDefault();
      this.onContext?.(id);
    });
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => { if (hover) this.uses.get(hover)?.classList.remove('hover'); hover = null; this.onHover?.(null); });
  }
}

/* ---------- Colours ---------- */

function politicalColor(s, owner) {
  if (s.countries[owner]) return s.countries[owner].exile ? NEUTRAL : colorOf(owner);
  const m = s.minors[owner];
  if (m?.puppetOf) return mix(NEUTRAL_LIGHT, colorOf(m.puppetOf), 0.45);
  return NEUTRAL;
}

function relationIndex(s) {
  const allies = new Set();
  const partners = new Set();
  for (const al of s.alliances) {
    if (!al.members.includes(s.me)) continue;
    for (const m of al.members) (al.kind === 'military' ? allies : partners).add(m);
  }
  const enemies = new Set();
  for (const w of s.wars) {
    if (w.a === s.me) enemies.add(w.b);
    if (w.b === s.me) enemies.add(w.a);
  }
  return { allies, partners, enemies };
}

function blocColor(s, rel, owner) {
  if (owner === s.me) return '#8f95ff';
  if (rel.enemies.has(owner)) return '#e5484d';
  if (rel.allies.has(owner)) return '#4f8fe0';
  if (rel.partners.has(owner)) return '#3f9e7a';
  const m = s.minors[owner];
  if (m?.puppetOf === s.me) return '#6a70c8';
  if (s.countries[owner]) {
    const v = s.rel[owner] ?? 0;
    return v >= 0 ? mix('#3a4154', '#3f9e7a', v / 140) : mix('#3a4154', '#b0444a', -v / 120);
  }
  return NEUTRAL;
}

export function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/* ---------- Helpers ---------- */

const markers = new Set();
let markerDefs = null;
function arrowMarker(id, color = '#ffffff') {
  return svg('marker', { id, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' },
    svg('path', { d: 'M0 0L10 5L0 10z', fill: color }));
}
function markerFor(color) {
  const id = `head-${color.replace('#', '')}`;
  if (!markers.has(id) && markerDefs) {
    markerDefs.append(arrowMarker(id, color));
    markers.add(id);
  }
  return id;
}

function arrowPath(points, color, unit, dashed) {
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    const mx = (p.x + q.x) / 2 - (q.y - p.y) * 0.12;
    const my = (p.y + q.y) / 2 + (q.x - p.x) * 0.12;
    d += `Q${mx} ${my} ${q.x} ${q.y}`;
  }
  return svg('path', {
    class: 'arrow', d, stroke: color, 'stroke-width': 3.2 / unit, 'stroke-dasharray': dashed ? `${5 / unit} ${4 / unit}` : null,
    'marker-end': `url(#${markerFor(color)})`, opacity: 0.9,
  });
}

export function fauxState(s) {
  const regions = {};
  for (const id of ORDER) {
    const row = s.regions[INDEX[id]];
    regions[id] = { id, ctrl: row[1], owner: row[0] };
  }
  return {
    regions,
    wars: s.wars,
    alliances: Object.fromEntries(s.alliances.map((a) => [a.id, a])),
    treaties: s.treaties,
    minors: Object.fromEntries(Object.entries(s.minors).map(([id, m]) => [id, { puppetOf: m.puppetOf }])),
    countries: s.countries,
    fleets: Object.fromEntries((s.fleets ?? []).map((f) => [f.id, f])),
  };
}

function armyLabel(k) {
  if (k >= 1000) return `${(k / 1000).toFixed(1)}M`;
  return `${Math.round(k)}K`;
}

const SHORT = { 'United States': 'USA', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE', 'South Korea': 'S. Korea', 'South Africa': 'S. Africa', 'Saudi Arabia': 'Saudi Arabia' };
function shortName(n) { return SHORT[n] ?? n; }
function provinceShort(id) {
  const name = regionName(id);
  return name.replace(/\s*\(.*\)$/, '');
}

export { CAPITALS, INDEX };
