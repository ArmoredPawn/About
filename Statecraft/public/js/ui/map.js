// The world map: provinces, map modes, armies, fleets, operation arrows, front lines, pan and zoom, and picking
// targets.
// Between weekly updates, armies glide toward their new positions and front lines creep forward, so the war
// plays out continuously rather than in jumps.

import { GEO, ORDER, MAP_SIZE } from '../engine/data/geo.js';
import { PROVINCES, RESOURCE_INFO } from '../engine/data/regions.js';
import { CHOKEPOINTS } from '../engine/data/world.js';
import { route } from '../engine/military.js';
import { NODES, PORTS, seaRoute, mapDistance } from '../engine/navy.js';
import { PIPELINES, PIPELINE_PROJECTS } from '../engine/data/energy.js';
import { riskOf } from '../engine/climate.js';
import { citiesIn, CITIES_OF } from '../engine/cities.js';
import { cityCell, GW as GRID_W, CELL as GRID_CELL } from '../engine/land.js';
import { LandView } from './land-view.js';

const PIPE_DEFS = Object.fromEntries([...PIPELINES, ...PIPELINE_PROJECTS].map((p) => [p.id, p]));
import { svg, colorOf, RES_COLORS, RES_LETTERS, regionName } from './dom.js';

const W = MAP_SIZE.w;
const H = MAP_SIZE.h;
const NEUTRAL = '#2a3142';
const NEUTRAL_LIGHT = '#343c50';
const CAPITALS = Object.fromEntries(PROVINCES.filter((p) => p.capital).map((p) => [p.country, p.id]));
const INDEX = Object.fromEntries(ORDER.map((id, i) => [id, i]));

// How far in (screen pixels per map unit) the automatic view turns into the city close-up
const CITY_ZOOM = 3;

export class WorldMap {
  constructor(el, { onRegion, onArmy, onFleet, onCargo, onCity, onHover, onContext, onTargetHint, onViewChange }) {
    this.onCargo = onCargo;
    this.onCity = onCity;
    this.routePreview = null;
    this.onViewChange = onViewChange;
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
    this.layers = { armies: true, fleets: true, pipelines: true, trade: true };
    // 'auto': the strategic map, turning into the city close-up as you zoom in; 'strategic': provinces and armies
    // only; 'cities': every city with its output, and a ragged, close-up front, at any zoom
    this.view2 = 'auto';
    this.cityShown = false;
    this.tradeShips = new Map();
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
    // Who holds each cell of ground, the occupied land and the front lines (land-view.js)
    this.land = new LandView();
    this.pointPreview = null;
  }

  async load() {
    const res = await fetch('data/map.json');
    const data = await res.json();
    const el = this.el;
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.defs = svg('defs');
    this.d = Object.fromEntries(ORDER.map((id) => [id, data.regions[id] ?? '']));
    markerDefs = this.defs;
    // Fine diagonal stripes over ground an army has taken from its owner
    this.defs.append(svg('pattern', { id: 'occ-hatch', width: 3, height: 3, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('rect', { width: 0.9, height: 3, fill: 'rgb(0 0 0 / 0.28)' })));
    el.append(this.defs);
    el.append(svg('rect', { class: 'ocean', x: -W, y: -H, width: W * 3, height: H * 3 }));
    el.append(svg('path', { class: 'graticule', d: data.graticule }));
    this.gRegions = svg('g');
    this.gOcc = svg('g', { class: 'fronts', 'pointer-events': 'none' });
    this.gEnemy = svg('g', { class: 'enemy-outline', 'pointer-events': 'none' });
    this.gSel = svg('g', { 'pointer-events': 'none' });
    this.gRes = svg('g');
    this.gLabels = svg('g');
    this.gCities = svg('g', { class: 'cities' });
    this.gArrows = svg('g');
    this.gBattles = svg('g');
    this.gArmies = svg('g');
    this.gSeas = svg('g', { class: 'seas' });
    this.gLines = svg('g', { class: 'pipelines' });
    this.gTrade = svg('g', { class: 'trade' });
    this.gFleets = svg('g');
    this.gPreview = svg('g', { 'pointer-events': 'none' });
    this.gPockets = svg('g', { class: 'pockets', 'pointer-events': 'none' });
    this.gRoutes = svg('g', { class: 'routes' });
    this.gRoutePreview = svg('g', { class: 'route-preview', 'pointer-events': 'none' });
    this.gIntel = svg('g', { class: 'intel-overlay', 'pointer-events': 'none' });
    el.append(this.gRegions, this.gOcc, this.gEnemy, this.gPockets, this.gLines, this.gTrade, this.gRoutes, this.gRes, this.gSeas, this.gCities, this.gLabels, this.gIntel, this.gArrows, this.gBattles, this.gFleets, this.gArmies, this.gSel, this.gPreview, this.gRoutePreview);
    for (const id of ORDER) {
      const u = svg('path', { d: this.d[id], class: 'region', 'data-id': id, fill: NEUTRAL });
      this.uses.set(id, u);
      this.gRegions.append(u);
    }
    this.#wire();
    this.#apply();
    new ResizeObserver(() => { this.size = null; this.#apply(); }).observe(el);
  }

  /* ---------- Drawing ---------- */

  // live: a real-time step (every second or so) rather than a full weekly update
  // Every update from the game moves the war along, so armies glide to where they now stand (a mid-week update
  // used to make them jump). A real-time step changes only armies, fleets, cargo ships and battles: the rest of
  // the map is left as it is.
  update(state, { live = false } = {}) {
    this.state = state;
    this.moving = true;
    this.land.sync(state);
    this.#paint();
    this.#drawEnemies();
    this.#drawArmies();
    this.#drawFleets();
    if (!live) { this.#drawLabels(); this.#drawPipelines(); this.#drawTrade(); this.#drawRoutes(); this.#drawPockets(); this.#drawOverlays(); }
    else this.#moveShips();
    this.#drawBattles();
    // Cities change hands as the front passes them, so the close-up follows the battles
    if (!live || (state.fights ?? []).length) this.#drawCities();
    this.#animate();
  }

  // Strategic, city, or automatic (cities once zoomed in)
  setView(view) {
    this.view2 = ['cities', 'strategic'].includes(view) ? view : 'auto';
    this.#syncView();
    if (this.state) { this.#drawCities(); this.#drawFront(true); }
  }

  // Whether the city close-up is showing now
  get cityView() { return this.cityShown; }

  #syncView() {
    const on = this.view2 === 'cities' || (this.view2 === 'auto' && this.#unit() >= CITY_ZOOM);
    if (on === this.cityShown) return false;
    this.cityShown = on;
    this.el.classList.toggle('city-view', on);
    this.onViewChange?.(on);
    return true;
  }

  // Fly in to the city close-up of a province (a battle, usually)
  closeUp(id) {
    this.focus([id]);
    const unit = this.#unit();
    if (unit < CITY_ZOOM * 1.6) this.zoomBy((CITY_ZOOM * 1.6) / unit);
  }

  /* ---------- Cities (the close-up view) ---------- */

  // The cities of a province as the map sees them: output ($B a year), share of the nation's output, and who
  // holds each (in a battle, the cities the front has passed belong to the attacker)
  #cityInfo(id) {
    const r = this.#region(id);
    if (!r) return [];
    const list = citiesIn(id, r.pop);
    if (!list.length) return [];
    // A city's output goes to whoever holds the ground it stands on, so its share is of that country's economy
    return list.map((c) => {
      const cell = cityCell(id, c.name);
      const holder = cell >= 0 ? this.land.holder(this.state, cell) ?? r.ctrl : r.ctrl;
      const national = this.state.countries[holder]?.gdp ?? this.state.minors?.[holder]?.gdp ?? null;
      return { ...c, output: c.share * r.gdp, national: national ? (c.share * r.gdp) / national : null, holder, fallen: holder !== r.owner };
    });
  }

  #drawCities() {
    if (!this.cityShown || !this.state) { this.gCities.replaceChildren(); this.citiesKey = null; return; }
    const unit = this.#unit();
    const rect = this.#size();
    const vbW = W / this.view.k;
    const vbH = vbW * (rect.height / Math.max(1, rect.width));
    const x0 = this.view.cx - vbW / 2 - 10;
    const x1 = this.view.cx + vbW / 2 + 10;
    const y0 = this.view.cy - vbH / 2 - 10;
    const y1 = this.view.cy + vbH / 2 + 10;
    const money = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : v >= 1 ? `$${Math.round(v)}B` : `$${Math.round(v * 1000)}M`);
    const out = [];
    const labels = [];
    const near = [];
    for (const [id] of CITIES_OF) {
      const g = GEO[id];
      if (!g || g.x < x0 - 60 || g.x > x1 + 60 || g.y < y0 - 60 || g.y > y1 + 60) continue;
      near.push(id);
    }
    // Nothing the close-up shows has changed (the view, who holds what, how far each battle has got): leave it.
    // It is asked to redraw every second while there is fighting anywhere in the world.
    const st = this.state;
    const key = [unit, x0, y0, x1, y1, st.week, this.land.rev, ...near.map((id) => {
      const r = this.#region(id);
      return `${r.ctrl}${politicalColor(st, r.ctrl)}${r.gdp}${st.battleInfo?.[id]?.street ?? ''}`;
    })].join('|');
    if (key === this.citiesKey) return;
    this.citiesKey = key;
    // Every city in view, biggest first; towns appear as you zoom in, wherever they have room on the screen
    const seen = [];
    for (const id of near) {
      for (const c of this.#cityInfo(id)) if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) seen.push([id, c]);
    }
    seen.sort((a, b) => Number(b[1].capital) - Number(a[1].capital) || b[1].pop - a[1].pop);
    const gap = 9 / unit;
    const dots = new Map();
    const crowded = (x, y, d, grid) => {
      const gx = Math.floor(x / d);
      const gy = Math.floor(y / d);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const [ox, oy] of grid.get(`${gx + i},${gy + j}`) ?? []) if (Math.hypot(ox - x, oy - y) < d) return true;
      }
      return false;
    };
    const shown = [];
    for (const [id, c] of seen) {
      const street = this.state.battleInfo?.[id]?.street === c.name;
      if (!street && !c.capital && crowded(c.x, c.y, gap, dots)) continue;
      const k = `${Math.floor(c.x / gap)},${Math.floor(c.y / gap)}`;
      (dots.get(k) ?? dots.set(k, []).get(k)).push([c.x, c.y]);
      shown.push([id, c]);
    }
    // Labels where they fit: biggest first, never over another
    const boxes = [];
    const fits = (b) => !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    // A city's markers are kept and reused while they look the same, rather than built afresh every time
    const old = this.cityNodes ?? new Map();
    const kept = new Map();
    const reuse = (k, sig, make) => {
      const had = old.get(k);
      const node = had?.sig === sig ? had.node : make();
      kept.set(k, { sig, node });
      return node;
    };
    for (const [id, c] of shown) {
      const r = Math.max(1.6, Math.min(7, Math.sqrt(c.pop / 120))) / unit;
      const color = politicalColor(this.state, c.holder);
      const street = this.state.battleInfo?.[id]?.street === c.name;
      const title = `${c.name}${c.capital ? ' (capital)' : ''}: ${(c.pop / 1000).toFixed(1)} million people, about ${money(c.output)} of output a year${c.national != null ? ` (${(c.national * 100).toFixed(1)}% of ${this.state.countries[c.holder]?.name ?? this.state.minors?.[c.holder]?.name ?? 'its holder'}'s economy)` : ''}. ${c.fallen ? `Taken by ${this.state.countries[c.holder]?.name ?? c.holder} in the fighting.` : `Held by ${this.state.countries[c.holder]?.name ?? this.state.minors?.[c.holder]?.name ?? c.holder}.`}${street ? ' Street fighting here now.' : ''} Click for details.`;
      const ck = `${id}|${c.name}`;
      if (street) out.push(reuse(`${ck}|ring`, String(unit), () => svg('circle', { class: 'street-ring', cx: c.x, cy: c.y, r: r * 4, 'stroke-width': 1.6 / unit, 'pointer-events': 'none' })));
      out.push(reuse(ck, `${unit}|${color}|${c.fallen}|${street}|${title}`, () => svg('g', { class: `city${c.fallen ? ' fallen' : ''}${street ? ' street' : ''}`, 'data-id': id, 'data-city': c.name },
        // The city's built-up area, in the colour of whoever holds it
        svg('circle', { class: 'city-area', 'data-id': id, cx: c.x, cy: c.y, r: r * 2.6, fill: color }),
        c.capital
          ? svg('rect', { 'data-id': id, x: c.x - r, y: c.y - r, width: r * 2, height: r * 2, fill: color, stroke: '#fff', 'stroke-width': 1.2 / unit, transform: `rotate(45 ${c.x} ${c.y})` })
          : svg('circle', { 'data-id': id, cx: c.x, cy: c.y, r, fill: color, stroke: c.fallen ? '#ff5a5a' : '#0b0f1a', 'stroke-width': (c.fallen ? 1.4 : 1) / unit }),
        svg('title', {}, title))));
      // Names (and output) once there is room for them
      const big = c.pop >= 4000 || c.capital;
      const tag = unit >= 2.3 ? money(c.output) : '';
      const fs = 8.5 / unit;
      const box = [c.x + r, c.y - fs * 0.7, c.x + r + 2 / unit + fs * 0.56 * (c.name.length + (tag ? tag.length + 1 : 0)), c.y + fs * 0.45];
      if ((unit >= 3.2 || (unit >= 1.6 && big) || (unit >= 2.3 && c.pop >= 1500)) && labels.length < 400 && fits(box)) {
        boxes.push(box);
        labels.push(reuse(`${ck}|label`, `${unit}|${tag}`, () => svg('text', { class: 'city-label', x: c.x + r + 2 / unit, y: c.y, 'font-size': 8.5 / unit, 'stroke-width': 2.4 / unit },
          c.name, tag ? svg('tspan', { class: 'city-output', dx: 3 / unit }, tag) : null)));
      }
    }
    this.cityNodes = kept;
    this.gCities.replaceChildren(...out, ...labels);
  }

  /* ---------- Cargo ships between weekly updates ---------- */

  #moveShips() {
    const s = this.state;
    for (const sh of s.shipments ?? []) {
      const n = this.tradeShips.get(sh.id);
      if (!n || sh.x == null) continue;
      this.#sail(n, ((sh.x % W) + W) % W, sh.y);
    }
  }

  // Sends a cargo ship gliding to a new spot over the next real-time step. It is moved by the animation loop with
  // a transform attribute, not a CSS transition: the browser lifts every SVG element with an animated CSS
  // transform into a layer of its own, and with dozens of ships that made each frame of the map crawl.
  #sail(n, x, y) {
    const a = n.glide;
    if (a && a.tx === x && a.ty === y) return;
    const now = performance.now();
    // The first sighting, or a crossing of the Pacific edge, puts it straight there
    if (!a || Math.abs(a.tx - x) > W / 2) {
      n.glide = { x, y, fx: x, fy: y, tx: x, ty: y, t0: now, dur: 1 };
      n.setAttribute('transform', `translate(${x} ${y})`);
      return;
    }
    Object.assign(a, { fx: a.x, fy: a.y, tx: x, ty: y, t0: now, dur: (this.stepMs ?? 1000) * 1.05 });
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
        class: 'pipeline', d: path, stroke: color, 'stroke-width': (live ? 2.2 : 1.6) / unit, 'stroke-opacity': live ? 0.85 : 0.5,
        'stroke-dasharray': live ? null : `${4 / unit} ${3 / unit}`,
      }, svg('title', {}, `${d.name} pipeline (${d.res}): ${p.status === 'building' ? `being built, ${p.left} weeks left` : p.status === 'sabotaged' ? 'wrecked by sabotage' : p.status === 'shut' ? 'shut' : live ? 'flowing' : 'cut by war'}`)));
    }
    this.gLines.replaceChildren(...out);
  }

  // Cargoes at sea: each shipment's real route between the seller's and the buyer's ports (round the land and
  // through the straits), coloured by what it carries, with the ship where it is now. Our own trade stands out;
  // our standing resource deals show as faint lanes.
  #drawTrade() {
    const s = this.state;
    if (!s?.shipments) return;
    const unit = this.#unit();
    // Most updates change nothing about the lanes (they come every second in a war): then only the ships move
    const key = JSON.stringify([unit, s.me, this.tradeRoutes?.size ?? 0, s.trade,
      s.shipments.map((sh) => [sh.id, sh.mode, sh.lane, sh.path?.length ?? 0, sh.seller, sh.buyer, sh.res, sh.private, sh.seen, sh.deal, sh.left, sh.hunter?.name, sh.x == null])]);
    if (key === this.tradeKey) { this.#moveShips(); return; }
    this.tradeKey = key;
    const portsOf = new Map();
    const ports = (cid) => {
      if (!portsOf.has(cid)) {
        const list = [];
        for (const id of ORDER) {
          if (!PORTS[id]) continue;
          const r = this.#region(id);
          if (r?.ctrl === cid) list.push([id, r.gdp]);
        }
        portsOf.set(cid, list.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id));
      }
      return portsOf.get(cid);
    };
    // The pair of ports closest to each other, and the sea route between them (remembered: it doesn't change)
    const lane = (a, b) => {
      let best = null;
      for (const pa of ports(a)) for (const pb of ports(b)) {
        const d = mapDistance(PORTS[pa][0], PORTS[pa][1], PORTS[pb][0], PORTS[pb][1]);
        if (!best || d < best[2]) best = [pa, pb, d];
      }
      if (!best) return null;
      return this.#seaLane(best[0], best[1]) ?? null;
    };
    const at = (r, t) => {
      const want = r.cum[r.cum.length - 1] * Math.max(0, Math.min(1, t));
      let i = 1;
      while (i < r.cum.length - 1 && r.cum[i] < want) i++;
      const seg = r.cum[i] - r.cum[i - 1] || 1;
      const k = (want - r.cum[i - 1]) / seg;
      const [x0, y0] = r.pts[i - 1];
      const [x1, y1] = r.pts[i];
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    };
    const wrap = (x) => ((x % W) + W) % W;
    const path = (r) => [0, -W, W].map((shift) => r.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x + shift} ${y}`).join('')).join('');
    const pathGeom = (pts) => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum };
    };
    const lines = [];
    // The world's main trade: a lane per big flow, thicker for more, its dashes flowing toward the buyer
    const money = (v) => (v >= 1 ? `$${Math.round(v)}B` : `$${Math.round(v * 1000)}M`);
    for (const [from, to, res, value] of s.trade ?? []) {
      const r = lane(from, to);
      if (!r) continue;
      const ours = from === s.me || to === s.me;
      const w = Math.max(1.4, Math.min(6, Math.sqrt(value) * 0.5));
      lines.push(svg('path', {
        class: `trade-flow${ours ? ' ours' : ''}`, d: path(r), stroke: RES_COLORS[res] ?? '#9aa4b8', 'stroke-width': w / unit,
        'stroke-dasharray': `${6 / unit} ${6 / unit}`,
      }, svg('title', {}, `${s.countries[from]?.name ?? from} → ${s.countries[to]?.name ?? to}: ${RESOURCE_INFO[res]?.name ?? res}, about ${money(value)} a year`)));
    }
    const seen = new Set();
    // A cargo's own way: the route its seller planned, else its lane between the two ports, else the lane between
    // the two countries
    const ownLane = (sh) => {
      if (sh.path?.length >= 2) return pathGeom(sh.path);
      if (sh.mode !== 'sea') return null;
      if (!sh.lane || !PORTS[sh.lane.from] || !PORTS[sh.lane.to]) return lane(sh.seller, sh.buyer);
      const r = this.#seaLane(sh.lane.from, sh.lane.to);
      if (r === undefined) return null; // still being found
      return r ?? lane(sh.seller, sh.buyer);
    };
    for (const sh of s.shipments) {
      if (sh.mode !== 'sea' && !sh.path) continue;
      const r = ownLane(sh);
      // A ship whose lane is still being found is shown where it is, and its lane joins it shortly
      if (!r && sh.x == null) continue;
      const ours = sh.buyer === s.me || sh.seller === s.me;
      const color = RES_COLORS[sh.res] ?? '#9aa4b8';
      const info = RESOURCE_INFO[sh.res];
      const how = { spies: ', seen by our spies', satellite: ', seen from orbit', ships: ', spotted by our warships' }[sh.seen] ?? '';
      const title = `${s.countries[sh.seller]?.name ?? sh.seller} → ${s.countries[sh.buyer]?.name ?? sh.buyer}: ${info?.name ?? sh.res}${sh.mode === 'land' ? ' by road and rail' : ''}${sh.private ? ` (private${how})` : sh.exposed ? ' (exposed secret)' : sh.deal ? ' (deal convoy)' : ''}, arriving in ${sh.left} week${sh.left === 1 ? '' : 's'}${sh.straits?.length ? `, via ${sh.straits.map((k) => CHOKEPOINTS[k]?.name ?? k).join(', ')}` : ''}`;
      if (r) lines.push(svg('path', {
        class: `trade-lane${ours ? ' ours' : ''}${sh.private ? ' private' : ''}${sh.path ? ' planned' : ''}`, d: path(r), stroke: color, 'stroke-width': (ours ? 1.8 : 1.1) / unit,
        'stroke-dasharray': sh.private ? `${2 / unit} ${3 / unit}` : `${5 / unit} ${4 / unit}`,
      }, svg('title', {}, title)));
      // The ship, gliding along the route over the week
      seen.add(sh.id);
      const p = sh.x != null ? [sh.x, sh.y] : at(r, (sh.total - sh.left) / Math.max(1, sh.total));
      let n = this.tradeShips.get(sh.id);
      if (!n) {
        n = svg('g', { class: `trade-ship${ours ? ' ours' : ''}${sh.mode === 'land' ? ' land' : ''}`, 'data-cargo': sh.id });
        this.tradeShips.set(sh.id, n);
      }
      n.classList.toggle('hunted', Boolean(sh.hunter));
      // Redrawing the map (a pan, a zoom) must not restart a ship's glide toward the same spot
      const x = wrap(p[0]);
      this.#sail(n, x, p[1]);
      const tip = `${title}${sh.hunter ? ` · ${sh.hunter.name} is after it` : ours ? '' : ' · click to stop it'}`;
      const key = `${unit}|${ours}|${color}|${Boolean(sh.hunter)}|${tip}`;
      if (n.dataset.key !== key) {
        n.dataset.key = key;
        n.replaceChildren(
          ours ? null : svg('circle', { r: 9 / unit, fill: 'transparent' }), // easier to click
          sh.hunter ? svg('circle', { class: 'hunt-ring', r: 7 / unit, fill: 'none', stroke: '#ff5a5a', 'stroke-width': 1.4 / unit }) : null,
          sh.mode === 'land'
            ? svg('rect', { x: -(ours ? 4 : 3) / unit, y: -(ours ? 3 : 2.2) / unit, width: (ours ? 8 : 6) / unit, height: (ours ? 6 : 4.4) / unit, rx: 1 / unit, fill: color, stroke: '#0b0f1a', 'stroke-width': 1.2 / unit })
            : svg('circle', { r: (ours ? 4 : 3) / unit, fill: color, stroke: '#0b0f1a', 'stroke-width': 1.2 / unit }),
          sh.private ? svg('circle', { r: (ours ? 6.5 : 5.5) / unit, fill: 'none', stroke: '#ffd166', 'stroke-width': 0.9 / unit, 'stroke-dasharray': `${1.5 / unit} ${1.5 / unit}` }) : null,
          svg('title', {}, tip));
      }
    }
    for (const [id, n] of this.tradeShips) if (!seen.has(id)) { n.remove(); this.tradeShips.delete(id); }
    this.gTrade.replaceChildren(...lines, ...this.tradeShips.values());
  }

  // The sea route between two ports, as { pts, cum } (cum: distance along it), null if there is none, or
  // undefined while it is still being found. Routes are found in a background worker, and the lanes are
  // redrawn as they come in; where workers are missing, they are found here.
  #seaLane(a, b) {
    const key = `${a}>${b}`;
    this.tradeRoutes ??= new Map();
    if (this.tradeRoutes.has(key)) return this.tradeRoutes.get(key);
    const from = PORTS[a];
    const keep = (way) => {
      if (!way) { this.tradeRoutes.set(key, null); return null; }
      const pts = [from, ...way];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const r = { pts, cum };
      this.tradeRoutes.set(key, r);
      return r;
    };
    if (this.routeWorker === undefined) {
      this.routeWaiting = new Map();
      try {
        this.routeWorker = new Worker(new URL('./route-worker.js', import.meta.url), { type: 'module' });
        this.routeWorker.addEventListener('message', ({ data }) => {
          this.routeWaiting.get(data.key)?.(data.way);
          this.routeWaiting.delete(data.key);
          // Draw the new lanes a moment later, a batch at a time
          if (!this.routeRedraw) this.routeRedraw = setTimeout(() => { this.routeRedraw = null; if (this.state) this.#drawTrade(); }, 150);
        });
        // A worker that can't start: find the rest here
        this.routeWorker.addEventListener('error', () => {
          this.routeWorker = null;
          for (const k of this.routeWaiting.keys()) this.tradeRoutes.delete(k);
          this.routeWaiting.clear();
          if (this.state) this.#drawTrade();
        });
      } catch {
        this.routeWorker = null;
      }
    }
    if (!this.routeWorker) return keep(seaRoute(from, PORTS[b]));
    if (!this.routeWaiting.has(key)) {
      this.routeWaiting.set(key, keep);
      this.routeWorker.postMessage({ key, from, to: PORTS[b] });
    }
    return undefined;
  }

  // The routes our resource deals' convoys follow, as their sellers planned them
  #drawRoutes() {
    const s = this.state;
    const unit = this.#unit();
    const out = [];
    for (const t of s.treaties ?? []) {
      if (t.kind !== 'deal' || !t.route?.pts?.length || !(t.a === s.me || t.b === s.me)) continue;
      const pts = t.route.pts;
      const d = [0, -W, W].map((shift) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x + shift} ${y}`).join('')).join('');
      const name = `${s.countries[t.a]?.name ?? t.a} → ${s.countries[t.b]?.name ?? t.b}: ${RESOURCE_INFO[t.res]?.name ?? t.res} deal, ${t.route.km.toLocaleString('en')} km ${t.route.mode === 'land' ? 'overland' : 'by sea'}${t.secret && !t.exposed ? ' (secret)' : ''}`;
      out.push(svg('path', { class: `route-line ours${t.secret && !t.exposed ? ' private' : ''}`, d, stroke: RES_COLORS[t.res] ?? '#9aa4b8', 'stroke-width': 1.6 / unit, 'stroke-dasharray': t.secret && !t.exposed ? `${1.5 / unit} ${3 / unit}` : `${8 / unit} ${3 / unit}` }, svg('title', {}, name)));
      for (const [x, y] of pts.slice(1, -1)) out.push(svg('circle', { class: 'route-check', cx: ((x % W) + W) % W, cy: y, r: 2.2 / unit, 'stroke-width': 0.8 / unit }, svg('title', {}, name)));
    }
    this.gRoutes.replaceChildren(...out);
    this.#drawRoutePreview();
  }

  // A route being planned: { pts (unwrapped, from the start through the checkpoints to the end), bad (the number
  // of the leg that doesn't work, or 0) }. fit: zoom the map to it.
  previewRoute(p, fit = false) {
    this.routePreview = p;
    this.#drawRoutePreview();
    if (fit && p?.pts?.length) {
      const xs = p.pts.map((q) => q[0]);
      const ys = p.pts.map((q) => q[1]);
      this.#fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
  }

  #drawRoutePreview() {
    const p = this.routePreview;
    if (!p?.pts?.length || !this.state) { this.gRoutePreview.replaceChildren(); return; }
    const unit = this.#unit();
    const out = [];
    const pts = p.pts;
    for (const shift of [0, -W, W]) {
      for (let i = 1; i < pts.length; i++) {
        const bad = p.bad === i;
        out.push(svg('line', { class: `route-leg${bad ? ' bad' : ''}`, x1: pts[i - 1][0] + shift, y1: pts[i - 1][1], x2: pts[i][0] + shift, y2: pts[i][1], 'stroke-width': (bad ? 3.2 : 2.6) / unit, 'stroke-dasharray': bad ? `${3 / unit} ${2 / unit}` : null }));
      }
      pts.forEach(([x, y], i) => {
        const end = i === 0 || i === pts.length - 1;
        out.push(svg('circle', { class: `route-end preview${end ? '' : ' check'}`, cx: x + shift, cy: y, r: (end ? 6 : 5) / unit, 'stroke-width': 1.6 / unit }));
        out.push(svg('text', { class: 'route-num', x: x + shift, y: y + 2.6 / unit, 'font-size': 7 / unit }, end ? (i === 0 ? 'A' : 'B') : String(i)));
      });
    }
    this.gRoutePreview.replaceChildren(...out);
  }

  // What our spies (or nothing) show of an enemy while a strike is being aimed: each province's output and the
  // armies in it, as rings sized by output. info: [{ id, gdp, troops }] or null to clear it.
  setIntel(info) {
    this.intel = info;
    this.#drawIntel();
  }
  #drawIntel() {
    const list = this.intel;
    if (!list?.length || !this.state) { this.gIntel.replaceChildren(); return; }
    const unit = this.#unit();
    const top = Math.max(1, ...list.map((r) => r.gdp));
    const out = [];
    for (const r of list) {
      const g = GEO[r.id];
      if (!g) continue;
      const rad = (4 + 14 * Math.sqrt(r.gdp / top)) / unit;
      out.push(svg('circle', { class: 'intel-ring', cx: g.x, cy: g.y, r: rad, 'stroke-width': 1.2 / unit }));
      if (unit >= 0.6) out.push(svg('text', { class: 'intel-label', x: g.x, y: g.y - rad - 2 / unit, 'font-size': 7.5 / unit, 'stroke-width': 2.2 / unit }, `$${r.gdp >= 10 ? Math.round(r.gdp) : r.gdp.toFixed(1)}B${r.troops ? ` · ${Math.round(r.troops)}K troops` : ''}`));
    }
    this.gIntel.replaceChildren(...out);
  }

  focusRoutes(list) {
    const pts = (list ?? []).flatMap((r) => r.pts ?? []);
    if (!pts.length) return;
    this.#fitBox(Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1])));
  }

  #fitBox(x0, y0, x1, y1) {
    const rect = this.el.getBoundingClientRect();
    const aspect = rect.height / Math.max(1, rect.width);
    const spanX = Math.max(60, x1 - x0) * 1.3;
    const spanY = Math.max(40, y1 - y0) * 1.3;
    this.view.k = Math.max(1, Math.min(16, Math.min(W / spanX, W * aspect / spanY)));
    this.view.cx = (x0 + x1) / 2;
    this.view.cy = (y0 + y1) / 2;
    this.#apply();
  }

  // Encircled forces: a red ring around every pocket (dashed where it is still supplied by sea)
  #drawPockets() {
    const s = this.state;
    const out = [];
    const unit = this.#unit();
    for (const p of s.pockets ?? []) {
      // The ground inside the ring, cell by cell, clipped to the coast, with its outline drawn red
      let d = '';
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const [i, len] of p.runs ?? []) {
        let start = i;
        let left = len;
        while (left > 0) {
          const gx = start % GRID_W;
          const gy = Math.floor(start / GRID_W);
          const run = Math.min(left, GRID_W - gx);
          d += `M${gx * GRID_CELL} ${gy * GRID_CELL}h${run * GRID_CELL}v${GRID_CELL}h${-run * GRID_CELL}z`;
          sx += (gx + run / 2) * GRID_CELL * run;
          sy += (gy + 0.5) * GRID_CELL * run;
          n += run;
          start += run;
          left -= run;
        }
      }
      if (!n) continue;
      out.push(svg('path', { d, class: `pocket-area${p.sea ? ' sea' : ''}` }));
      out.push(svg('text', { class: 'pocket-label', x: sx / n, y: sy / n - 14 / unit, 'font-size': 10 / unit, 'stroke-width': 2.4 / unit }, `${p.sea ? '⚓ Cut off' : '⭕ Encircled'}: ${p.name} (${s.countries[p.holder]?.name ?? p.holder})`));
    }
    this.gPockets.replaceChildren(...out);
  }

  setLayers(layers) {
    this.layers = { ...this.layers, ...layers };
    this.gArmies.style.display = this.layers.armies ? '' : 'none';
    this.gArrows.style.display = this.layers.armies ? '' : 'none';
    this.gFleets.style.display = this.layers.fleets ? '' : 'none';
    this.gLines.style.display = this.layers.pipelines ? '' : 'none';
    this.gTrade.style.display = this.layers.trade ? '' : 'none';
    this.gRoutes.style.display = this.layers.trade ? '' : 'none';
  }

  setMode(mode, resource) {
    this.mode = mode;
    if (resource) this.resource = resource;
    if (this.state) { this.#paint(); this.#drawOverlays(); }
  }

  #region(id) {
    const row = this.state.regions[INDEX[id]];
    return row && { owner: row[0], ctrl: row[1], dmg: row[2], infra: row[3], fort: row[4], battleBy: row[5], prog: row[6], unrest: row[7], gar: row[8], gdp: row[9], pop: row[10], rebels: row[11] ?? 0, from: row[12] || null, loyalty: row[13] ?? 50, policy: row[14] ?? 'integrate', people: row[15] ?? row[0], fallout: row[16] ?? 0 };
  }

  #paint() {
    const s = this.state;
    const me = s.me;
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
    }
    this.#drawFront();
  }

  /* ---------- The front: occupied ground and the lines where armies meet ---------- */

  // Ground taken by armies is painted in the colour of whoever holds it now (clipped to the coastline), and a front
  // line runs wherever two countries at war meet. It changes only when ground changes hands.
  #drawFront(force = false) {
    const s = this.state;
    const geom = this.land.geometry(s);
    const unit = this.#unit();
    const showFills = !['resources', 'economy', 'climate'].includes(this.mode);
    const colors = [...geom.fills.keys()].map((h) => this.#holderColor(h)).join(',');
    const key = `${this.land.geomKey}|${this.mode}|${colors}|${unit}`;
    if (!force && key === this.frontKey) return;
    this.frontKey = key;
    const out = [];
    if (showFills && geom.fills.size) {
      // The coast is kept: occupied cells are clipped to the provinces they lie in
      const clip = svg('clipPath', { id: 'occ-clip' }, ...[...geom.regions].map((k) => svg('path', { d: this.d[ORDER[k]] })));
      const fills = [...geom.fills].map(([h, d]) => svg('path', { d, class: 'occ-fill', fill: this.#holderColor(h) }, svg('title', {}, `Held by ${s.countries[h]?.name ?? s.minors?.[h]?.name ?? h}`)));
      out.push(clip, svg('g', { 'clip-path': 'url(#occ-clip)' }, ...fills, ...[...geom.fills.values()].map((d) => svg('path', { d, class: 'occ-hatch', fill: 'url(#occ-hatch)' }))));
    }
    const line = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const d = geom.fronts.map(line).join('');
    if (d) {
      out.push(svg('path', { d, class: 'front-shadow', 'stroke-width': 4.2 / unit }));
      out.push(svg('path', { d, class: 'front-line', 'stroke-width': 1.8 / unit }));
    }
    this.gOcc.replaceChildren(...out);
  }

  #holderColor(h) {
    return this.mode === 'alliances' ? blocColor(this.state, relationIndex(this.state), h) : politicalColor(this.state, h);
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
      // Cargo ships sail at an even speed
      for (const n of this.tradeShips.values()) {
        const a = n.glide;
        if (!a || (a.x === a.tx && a.y === a.ty)) continue;
        const k = Math.min(1, (now - a.t0) / a.dur);
        a.x = k >= 1 ? a.tx : a.fx + (a.tx - a.fx) * k;
        a.y = k >= 1 ? a.ty : a.fy + (a.ty - a.fy) * k;
        n.setAttribute('transform', `translate(${a.x} ${a.y})`);
        if (k < 1) busy = true;
      }
      for (const n of [...this.armyNodes.values(), ...this.fleetNodes.values()]) {
        if (n.x === n.tx && n.y === n.ty) continue;
        const k = Math.min(1, (now - n.t0) / n.dur);
        const e = k * (2 - k) * 0.35 + k * 0.65;
        n.x = k >= 1 ? n.tx : n.fx + (n.tx - n.fx) * e;
        n.y = k >= 1 ? n.ty : n.fy + (n.ty - n.fy) * e;
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
    // Labels follow who owns what and the zoom; unchanged, they are left alone
    const key = `${k}|${unit}|${s.regions.map((r) => r[0]).join(',')}|${Object.values(s.countries).map((c) => c.name).join(',')}`;
    if (key === this.labelsKey) return;
    this.labelsKey = key;
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
    const arrows = [];
    const rings = [];
    const friendly = (owner) => owner === s.me || s.alliances.some((al) => al.kind === 'military' && al.members.includes(owner) && al.members.includes(s.me));
    const byId = new Map(s.armies.map((a) => [a.id, a]));
    const w = 34 / unit;
    const hgt = 14 / unit;
    // Where each army stands; armies at sea are drawn on the way to their landing
    const spot = new Map();
    const placed = [];
    for (const a of [...s.armies].sort((x, y) => (x.owner === s.me ? -1 : 0) - (y.owner === s.me ? -1 : 0))) {
      let x = a.x ?? GEO[a.region]?.x;
      let y = a.y ?? GEO[a.region]?.y;
      if (a.sea && a.sea.from && GEO[a.sea.to]) {
        const f = GEO[a.sea.from];
        const g = GEO[a.sea.to];
        const k = 1 / (1 + Math.max(0, a.sea.left ?? 1));
        x = f.x + (g.x - f.x) * k;
        y = f.y + (g.y - f.y) * k;
      }
      if (x == null) continue;
      // Armies standing together are fanned out so none hides another
      const near = placed.filter((p) => Math.abs(p[0] - x) < w * 0.9 && Math.abs(p[1] - y) < hgt * 0.9).length;
      placed.push([x, y]);
      spot.set(a.id, [x + (near % 2) * (w + 2 / unit) - (near ? (w + 2 / unit) / 2 : 0), y + Math.floor(near / 2) * (hgt + 2 / unit)]);
    }
    for (const a of s.armies) {
      const at = spot.get(a.id);
      if (!at) continue;
      if (a.exact && a.sea && a.sea.from && GEO[a.sea.to]) {
        arrows.push(arrowPath([{ x: at[0], y: at[1] }, GEO[a.sea.to]], colorOf(a.owner), unit, true));
      } else if (a.exact && a.path?.length && !a.battle) {
        // Ours and our allies', and an enemy's when our spies are deep inside its government: its route
        const pts = [{ x: a.x, y: a.y }, ...a.path.map(([x, y]) => ({ x, y }))];
        arrows.push(routeLine(pts, colorOf(a.owner), unit, a.op?.kind === 'move' || a.op?.kind === 'hold'));
      }
      // Attacking: an arrow at the army it is fighting
      const fight = a.battle ? (s.fights ?? []).find((b) => b.id === a.battle) : null;
      if (fight && fight.def !== a.id) {
        const d = byId.get(fight.def);
        if (d?.x != null) arrows.push(arrowPath([{ x: a.x, y: a.y }, { x: (a.x + d.x * 2) / 3, y: (a.y + d.y * 2) / 3 }], colorOf(a.owner), unit, false));
      }
      // The ground the selected army holds around it
      if (this.selectedArmy === a.id && a.zoc && !a.sea) rings.push(svg('circle', { class: 'zoc-ring', cx: a.x, cy: a.y, r: a.zoc, stroke: colorOf(a.owner), 'stroke-width': 1.2 / unit }));
    }
    const now = performance.now();
    const seen = new Set();
    for (const a of s.armies) {
      const at = spot.get(a.id);
      if (!at) continue;
      const [cx, cy] = at;
      seen.add(a.id);
      const mine = friendly(a.owner);
      let n = this.armyNodes.get(a.id);
      if (!n) {
        n = { g: svg('g', { 'data-army': a.id }), x: cx, y: cy, fx: cx, fy: cy, tx: cx, ty: cy, t0: now, dur: 1 };
        this.armyNodes.set(a.id, n);
        this.gArmies.append(n.g);
      }
      if (Math.abs(n.x - cx) > W / 2) { n.x = n.fx = n.tx = cx; n.y = n.fy = n.ty = cy; }
      if (Math.abs(n.tx - cx) > 0.01 || Math.abs(n.ty - cy) > 0.01) {
        n.fx = n.x; n.fy = n.y; n.tx = cx; n.ty = cy; n.t0 = now;
        n.dur = this.moving ? (this.stepMs ?? this.tickMs) * 0.95 : 250;
      }
      n.g.setAttribute('class', `army${this.selectedArmy === a.id ? ' sel' : ''}${mine ? '' : ' foe'}${a.battle ? ' fighting' : ''}${a.pocket ? ' trapped' : ''}`);
      n.g.setAttribute('opacity', a.sea ? '0.85' : '1');
      n.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
      // Rebuilt only when what it shows changes: rebuilding it every second made its tooltip flicker
      const text = (a.exact || a.seen ? '' : '~') + armyLabel(a.troops);
      const tip = `${a.name} (${s.countries[a.owner]?.name ?? ''})${a.status ? `: ${a.status}` : ''}`;
      const key = `${unit}|${colorOf(a.owner)}|${text}|${tip}|${a.op?.kind}`;
      if (n.key !== key) {
        n.key = key;
        const stance = a.op?.kind === 'advance' || a.op?.kind === 'attack' ? '▲' : a.op?.kind === 'hold' ? '■' : '►';
        n.g.replaceChildren(
          svg('rect', { x: -w / 2, y: -hgt / 2, width: w, height: hgt, rx: 3 / unit, fill: colorOf(a.owner) }),
          svg('text', { x: 0, y: 0, 'font-size': 9 / unit }, a.exact ? `${stance} ${text}` : text),
          svg('title', {}, tip));
      }
    }
    for (const [id, n] of this.armyNodes) if (!seen.has(id)) { n.g.remove(); this.armyNodes.delete(id); }
    this.gArrows.replaceChildren(...rings, ...arrows);
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
      const tip = `${f.name} (${s.countries[f.owner]?.name ?? ''}): ${f.ships} warships${f.carriers ? `, ${f.carriers} aircraft carriers` : ''}${f.status ? ` · ${f.status}` : ''}`;
      const key = `${unit}|${colorOf(f.owner)}|${label}|${tip}`;
      if (n.key !== key) {
        n.key = key;
        n.g.replaceChildren(
          svg('rect', { x: -w / 2, y: -hgt / 2, width: w, height: hgt, rx: hgt / 2, fill: colorOf(f.owner) }),
          svg('text', { x: 0, y: 0, 'font-size': 8.5 / unit }, label),
          svg('title', {}, tip));
      }
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

  // A battle where two armies meet: crossed swords, a ring in the attacker's colour showing the odds (full at 2:1
  // or better), and what is special about it
  #drawBattles() {
    const unit = this.#unit();
    const out = [];
    const s = this.state;
    for (const b of s.fights ?? []) {
      if (b.x == null) continue;
      const rad = 8 / unit;
      const share = Math.max(0.03, Math.min(1, (b.ratio ?? 1) / 2));
      const cy = b.y;
      const end = [b.x + rad * Math.sin(share * 2 * Math.PI), cy - rad * Math.cos(share * 2 * Math.PI)];
      const tags = [b.pincer ? 'Pincer' : null, b.street ? `Street fighting: ${b.street}` : null, b.militia >= 1 ? `${Math.round(b.militia)}K home guard` : null].filter(Boolean);
      const name = (x) => s.countries[x]?.name ?? s.minors?.[x]?.name ?? x;
      const tip = `${name(b.by)} attacking ${name(b.holder)}: ${b.trend === 'advancing' ? 'pushing them back' : b.trend === 'stalled' ? 'held up' : 'thrown back'} (odds ${b.ratio}:1, about ${b.attackTroops}K against ${b.defendTroops}K)${tags.length ? `. ${tags.join('; ')}` : ''}`;
      if (tags.length && unit >= 1.4) out.push(svg('text', { class: 'battle-tag', x: b.x, y: cy - 14 / unit, 'font-size': 8 / unit, 'stroke-width': 2.2 / unit, 'text-anchor': 'middle' }, tags.join(' · ')));
      out.push(svg('g', { class: `battle${b.pincer ? ' pincer' : ''} ${b.trend ?? ''}` },
        svg('circle', { cx: b.x, cy, r: rad, fill: 'rgb(12 14 22 / 0.85)', stroke: '#e5484d', 'stroke-width': 1 / unit }),
        svg('path', { d: `M${b.x} ${cy - rad}A${rad} ${rad} 0 ${share > 0.5 ? 1 : 0} 1 ${end[0]} ${end[1]}`, fill: 'none', stroke: colorOf(b.by), 'stroke-width': 2.2 / unit }),
        svg('text', { x: b.x, y: cy, 'font-size': 9 / unit, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff' }, '⚔'),
        svg('title', {}, tip)));
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
    // Provinces poisoned by fallout
    for (const id of ORDER) {
      const r = this.#region(id);
      if (!r.fallout) continue;
      const g = GEO[id];
      out.push(svg('g', { class: 'fallout', 'pointer-events': 'none' },
        svg('circle', { cx: g.x, cy: g.y, r: 9 / unit, fill: 'rgb(214 236 64 / 0.85)', stroke: '#1a1f10', 'stroke-width': 1 / unit }),
        svg('text', { x: g.x, y: g.y + 0.5 / unit, 'font-size': 11 / unit, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#1a1f10' }, '☢')));
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
    clearTimeout(this.pointTimer);
  }

  // The way an army would go to the point under the pointer (targeting.pointPath gives it), drawn at most a few
  // times a second
  #previewPoint(mx, my) {
    const t = this.targeting;
    if (!t?.pointPath) return;
    clearTimeout(this.pointTimer);
    this.pointTimer = setTimeout(() => {
      if (this.targeting !== t) return;
      const res = t.pointPath(((mx % W) + W) % W, my);
      const unit = this.#unit();
      if (!res) { this.gPreview.replaceChildren(); this.onTargetHint?.(null); return; }
      this.onTargetHint?.(res.why ?? null);
      const nodes = [];
      if (res.path?.length) {
        const pts = [res.from, ...res.path].map(([x, y]) => ({ x, y }));
        nodes.push(routeLine(pts, res.attack ? '#ff8a80' : '#ffffff', unit, !res.attack));
      }
      nodes.push(svg('circle', { cx: res.to?.[0] ?? mx, cy: res.to?.[1] ?? my, r: 5 / unit, class: `target-dot${res.why ? ' bad' : res.attack ? ' attack' : ''}`, 'stroke-width': 1.5 / unit }));
      if (res.label && unit >= 1) nodes.push(svg('text', { class: 'target-label', x: (res.to?.[0] ?? mx) + 8 / unit, y: res.to?.[1] ?? my, 'font-size': 9 / unit, 'stroke-width': 2.4 / unit }, res.label));
      this.gPreview.replaceChildren(...nodes);
    }, 60);
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

  // The map's size on screen, remembered until it is resized: measuring it right after the map has been redrawn
  // forces the browser to lay the whole page out again, which made every animation frame stutter
  #size() {
    if (!this.size) {
      const r = this.el.getBoundingClientRect();
      this.size = { width: r.width, height: r.height };
    }
    return this.size;
  }

  #unit() {
    // screen pixels per map unit at the current zoom
    const rect = this.#size();
    const vbW = W / this.view.k;
    const vbH = vbW * (rect.height / Math.max(1, rect.width));
    return Math.min(rect.width / vbW, rect.height / vbH) || 1;
  }

  #apply() {
    const rect = this.el.getBoundingClientRect();
    this.size = rect.width ? { width: rect.width, height: rect.height } : null;
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
      this.#syncView();
      this.raf = requestAnimationFrame(() => {
        this.moving = false;
        // Dragging the map only changes which cities are in view; everything else is sized for the zoom, so it
        // is redrawn only when the zoom changes
        const unit = this.#unit();
        if (unit === this.drawnUnit) { this.#drawCities(); return; }
        this.drawnUnit = unit;
        this.#drawLabels(); this.#drawArmies(); this.#drawFleets(); this.#drawPipelines(); this.#drawTrade(); this.#drawRoutes(); this.#drawPockets(); this.#drawBattles(); this.#drawOverlays(); this.#drawIntel(); this.#drawCities();
        this.#drawFront(true);
      });
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
      // What was clicked is read now: armies, fleets, ships and cities are redrawn every second, and a click
      // that spanned a redraw used to land on a marker no longer on the map (and deselect everything)
      if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false, hit: hitOf(e.target) };
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
      if (this.targeting?.pointPath) { const [mx, my] = this.#toMap(e.clientX, e.clientY); this.#previewPoint(mx, my); }
      if (id !== hover) {
        if (hover) this.uses.get(hover)?.classList.remove('hover');
        hover = id;
        if (id) this.uses.get(id)?.classList.add('hover');
        this.onHover?.(id);
        if (this.targeting && !this.targeting.pointPath) this.#preview(id);
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
      const { army, fleet, node, cargo, city, id } = d.hit;
      if (this.targeting) {
        if (army && this.targeting.onArmy?.(army)) return;
        if (fleet && this.targeting.onFleet?.(fleet)) return;
        if (node && this.targeting.onNode?.(node)) return;
        // Armies go to the exact point clicked
        if (this.targeting.onPoint && (id || d.hit.city)) { const [mx, my] = this.#toMap(d.x, d.y); this.targeting.onPoint(((mx % W) + W) % W, my, id ?? d.hit.city?.id); return; }
        if (!id && !army && !fleet && !node && this.targeting.onWater) { const [mx, my] = this.#toMap(d.x, d.y); this.targeting.onWater(((mx % W) + W) % W, my); return; }
        if (id && (!this.targeting.filter || this.targeting.filter(id))) this.targeting.onPick(id);
        else if (id) this.targeting.onReject?.(id);
        return;
      }
      if (fleet) return this.onFleet?.(fleet);
      if (army) return this.onArmy?.(army);
      if (cargo && this.onCargo) return this.onCargo(cargo);
      if (city && this.onCity) return this.onCity(city.id, city.name);
      if (node) return;
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

// What a click landed on, read at once: the marker may be redrawn before the button comes back up
function hitOf(target) {
  const cityEl = target?.closest?.('[data-city]');
  return {
    army: target?.closest?.('[data-army]')?.dataset.army ?? null,
    fleet: target?.closest?.('[data-fleet]')?.dataset.fleet ?? null,
    node: target?.closest?.('[data-node]')?.dataset.node ?? null,
    cargo: target?.closest?.('[data-cargo]')?.dataset.cargo ?? null,
    city: cityEl ? { id: cityEl.dataset.id, name: cityEl.dataset.city } : null,
    id: target?.dataset?.id ?? null,
  };
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
    'marker-end': `url(#${markerFor(color)})`, 'stroke-opacity': 0.9,
  });
}

// An army's route over the land: a dotted (march) or solid (attack) line through its waypoints, with an arrowhead
function routeLine(points, color, unit, dashed) {
  const x0 = points[0].x;
  let d = '';
  let px = x0;
  points.forEach((p, i) => {
    let x = p.x;
    while (x - px > W / 2) x -= W;
    while (px - x > W / 2) x += W;
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${p.y.toFixed(1)}`;
    px = x;
  });
  return svg('path', {
    class: 'arrow route', d, stroke: color, 'stroke-width': 2.6 / unit, 'stroke-dasharray': dashed ? `${4 / unit} ${3 / unit}` : null,
    'stroke-linejoin': 'round', 'marker-end': `url(#${markerFor(color)})`, opacity: 0.9,
  });
}

// Enough of the game state to run the engine's own checks and path-finding in the browser: who controls each
// province, the ground armies hold (rebuilt only when it changes), the wars and alliances, and the armies
let fauxOcc = { rev: null, occ: {} };
export function fauxState(s) {
  const regions = {};
  for (const id of ORDER) {
    const row = s.regions[INDEX[id]];
    regions[id] = { id, ctrl: row[1], owner: row[0], infra: row[3], fort: row[4], gdp: row[9], pop: row[10] };
  }
  if (fauxOcc.rev !== s.occRev) {
    const occ = {};
    for (const [i, n, h] of s.occ ?? []) for (let k = 0; k < n; k++) occ[i + k] = h;
    fauxOcc = { rev: s.occRev, occ };
  }
  return {
    regions,
    occ: fauxOcc.occ,
    week: s.week,
    wars: s.wars,
    alliances: Object.fromEntries(s.alliances.map((a) => [a.id, a])),
    treaties: s.treaties,
    minors: Object.fromEntries(Object.entries(s.minors).map(([id, m]) => [id, { puppetOf: m.puppetOf }])),
    countries: s.countries,
    fleets: Object.fromEntries((s.fleets ?? []).map((f) => [f.id, f])),
    armies: Object.fromEntries((s.armies ?? []).map((a) => [a.id, a])),
    battles: {},
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
