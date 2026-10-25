/* Europe at War, 1939–1945 — interactive map.
   Plain browser script: depends on d3, topojson-client and the data files loaded before it. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ dates
  const DAY_MS = 864e5;
  const T0 = Date.UTC(1939, 8, 1);
  const dayOf = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d || 1) - T0) / DAY_MS);
  };
  const END = dayOf("1945-05-08");
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dateOf = (day) => new Date(T0 + Math.floor(day) * DAY_MS);
  const fmtDay = (day) => { const d = dateOf(day); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const fmtLong = (iso) => { const d = dateOf(dayOf(iso)); return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const fmtRange = (a, b) => (!b || a === b || dayOf(b) - dayOf(a) <= 1) ? fmtLong(a) : `${fmtLong(a)} – ${fmtLong(b)}`;
  const clampDay = (d) => Math.max(0, Math.min(END, d));

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem("ww2map:" + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem("ww2map:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  // ------------------------------------------------------------------ geometry
  const WORLD = window.WW2_WORLD;
  const allFeatures = topojson.feature(WORLD, WORLD.objects.countries).features;
  const features = allFeatures.filter((f) => {
    const [[x0, y0], [x1, y1]] = d3.geoBounds(f);
    if (y1 < 10 || y0 > 85) return false;
    if (x0 > x1) return true; // crosses the antimeridian (Russia)
    return x1 > -90 && x0 < 100;
  });
  features.forEach((f) => { f.properties.key = f.properties.name; });
  const land = topojson.merge(WORLD, WORLD.objects.countries.geometries);
  const borderMesh = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);
  const graticule = d3.geoGraticule().step([10, 10]).extent([[-80, 20], [100, 85]])();

  // ------------------------------------------------------------------ control timelines
  const CONTROL = {};
  for (const [name, rows] of Object.entries(window.WW2_CONTROL)) {
    CONTROL[name] = rows.map(([d, status, label]) => ({ d: dayOf(d), status, label }));
  }
  function controlAt(name, day) {
    const rows = CONTROL[name];
    if (!rows) return { status: "other", label: null };
    let cur = rows[0];
    for (const r of rows) { if (r.d <= day) cur = r; else break; }
    return cur;
  }
  const PINNED = {};
  for (const [name, [a, b]] of Object.entries(window.WW2_PINNED)) PINNED[name] = [dayOf(a), dayOf(b)];
  const isPinned = (name, day) => { const p = PINNED[name]; return !!p && day >= p[0] && day < p[1]; };

  const STATUS_NAMES = { axis: "Axis or aligned", occupied: "Axis-occupied", allied: "Western Allies", soviet: "Soviet Union", neutral: "Neutral", other: "Outside the European war" };

  // ------------------------------------------------------------------ zones (fronts & regions)
  const lineLength = (pts) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += segLen(pts[i - 1], pts[i]);
    return len;
  };
  function segLen(a, b) {
    const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]);
  }
  function resample(pts, n) {
    if (pts.length === 1) return Array.from({ length: n }, () => pts[0].slice());
    const total = lineLength(pts) || 1;
    const out = [];
    let i = 1, acc = 0;
    for (let s = 0; s < n; s++) {
      const target = (s / (n - 1)) * total;
      while (i < pts.length - 1 && acc + segLen(pts[i - 1], pts[i]) < target) { acc += segLen(pts[i - 1], pts[i]); i++; }
      const L = segLen(pts[i - 1], pts[i]) || 1;
      const t = Math.max(0, Math.min(1, (target - acc) / L));
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
    }
    return out;
  }
  const lerpPts = (a, b, t) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
  const smooth = (t) => t * t * (3 - 2 * t);

  const ZONES = window.WW2_ZONES.map((z) => {
    if (z.kind === "region") {
      let rings = z.rings || (z.ring ? [z.ring] : null);
      if (z.circle) {
        const [lon, lat, km] = z.circle;
        rings = [d3.geoCircle().center([lon, lat]).radius(km / 111.2).precision(8)().coordinates[0]];
      }
      return { ...z, rings, states: z.states.map(([d, status, label]) => ({ d: dayOf(d), status, label: label || z.name })) };
    }
    const kfs = z.keyframes.map((k) => ({ d: dayOf(k.date), segs: k.segs, closure: k.closure || z.closure, dashed: !!k.dashed }));
    const nSegs = kfs[0].segs.length;
    const segN = [];
    for (let s = 0; s < nSegs; s++) segN.push(Math.max(16, 4 * d3.max(kfs, (k) => k.segs[s].length)));
    const closeN = Math.max(12, 4 * d3.max(kfs, (k) => k.closure.length));
    kfs.forEach((k) => {
      k.rs = k.segs.map((seg, s) => resample(seg, segN[s]));
      k.rc = resample(k.closure, closeN);
    });
    const quiet = (z.quiet || []).map((q) => ({ box: q.box, from: q.from ? dayOf(q.from) : -Infinity }));
    return { ...z, kfs, quiet, endDay: z.end ? dayOf(z.end) : Infinity };
  });

  // Returns { line, polygon, status, label, dashed } for a front, or null when inactive.
  function frontAt(z, day) {
    const k = z.kfs;
    if (day < k[0].d || day >= z.endDay) return null;
    let i = 0;
    while (i < k.length - 1 && k[i + 1].d <= day) i++;
    let segs, close;
    if (i === k.length - 1) { segs = k[i].rs; close = k[i].rc; }
    else {
      const t = smooth((day - k[i].d) / (k[i + 1].d - k[i].d));
      segs = k[i].rs.map((s, j) => lerpPts(s, k[i + 1].rs[j], t));
      close = lerpPts(k[i].rc, k[i + 1].rc, t);
    }
    const line = [].concat(...segs);
    return { line, polygon: line.concat(close), status: z.side, label: z.label, dashed: k[i].dashed };
  }
  function regionAt(z, day) {
    let cur = null;
    for (const s of z.states) { if (s.d <= day) cur = s; else break; }
    return cur && cur.status ? cur : null;
  }

  // ------------------------------------------------------------------ items on the map
  const theaterOf = (lon, lat) => (lon >= 14 && lat < 46.5 && lon < 30 ? "balkans" : lon >= 15 ? "east" : "west");
  const WIKI = {
    homearmy: "Home Army", partisans: "Yugoslav Partisans", sovietpartisans: "Soviet partisans", gorgopotamos: "Operation Harling",
    whiterose: "White Rose", vemork: "Norwegian heavy water sabotage", denmark: "Rescue of the Danish Jews", vercors: "Battle of Vercors",
    july20: "20 July plot", warsawrising: "Warsaw Uprising", slovak: "Slovak National Uprising", italianpartisans: "Italian resistance movement",
    lodz: "Łódź Ghetto", auschwitz: "Auschwitz concentration camp", warsawghetto: "Warsaw Ghetto", ponary: "Ponary massacre", babiyar: "Babi Yar",
    jasenovac: "Jasenovac concentration camp", rumbula: "Rumbula massacre", chelmno: "Chełmno extermination camp", wannsee: "Wannsee Conference",
    belzec: "Bełżec extermination camp", sobibor: "Sobibor extermination camp", treblinka: "Treblinka extermination camp",
    majdanek: "Majdanek concentration camp", drancy: "Drancy internment camp", westerbork: "Westerbork transit camp",
    theresienstadt: "Theresienstadt Ghetto", dachau: "Dachau concentration camp", buchenwald: "Buchenwald concentration camp",
    belsen: "Bergen-Belsen concentration camp", deathmarch: "Death marches during the Holocaust", ravensbruck: "Ravensbrück concentration camp",
    mauthausen: "Mauthausen concentration camp", hannibal: "Operation Hannibal", roadoflife: "Road of Life",
    eastprussia: "Flight and expulsion of Germans (1944–1950)", danishjews: "Rescue of the Danish Jews", karelia40: "Evacuation of Finnish Karelia"
  };
  const LAYER_OF = { battle: "battles", naval: "battles", milestone: "battles", bombing: "bombing", resistance: "resistance", holocaust: "holocaust" };

  const ITEMS = [].concat(
    window.WW2_EVENTS.map((e) => ({ ...e })),
    window.WW2_RESISTANCE.map((e) => ({ ...e, type: "resistance", wiki: WIKI[e.id] })),
    window.WW2_HOLOCAUST.map((e) => ({ ...e, type: "holocaust", theater: e.id === "jasenovac" ? "balkans" : theaterOf(e.at[0], e.at[1]), wiki: WIKI[e.id] }))
  ).map((e) => ({ ...e, layer: LAYER_OF[e.type], s: dayOf(e.start), e: dayOf(e.end || e.start) }));
  ITEMS.sort((a, b) => a.s - b.s);

  const FLOWS = window.WW2_REFUGEES.map((f) => ({ ...f, type: "refugee", layer: "refugees", wiki: WIKI[f.id], s: dayOf(f.start), e: dayOf(f.end), at: f.path[f.path.length - 1] }));
  const BRIEFS = window.WW2_BRIEFS.map(([d, a, b]) => ({ d: dayOf(d), date: d, bullets: [a, b].filter(Boolean) })).sort((x, y) => x.d - y.d);
  const briefIndexAt = (day) => { let i = 0; for (let j = 0; j < BRIEFS.length; j++) { if (BRIEFS[j].d <= day) i = j; else break; } return i; };

  // ------------------------------------------------------------------ armies
  const SIDE_NAME = { axis: "Axis", allied: "Allied", soviet: "Soviet" };
  const toKf = (rows) => (rows || []).map(([d, v]) => [dayOf(d), v]);
  const UNITS = window.WW2_ARMIES.map((u) => {
    const kf = u.path.map(([d, lon, lat, name]) => ({ d: dayOf(d), p: [lon, lat], name }));
    return { ...u, kf, s: kf[0].d, e: u.end ? dayOf(u.end) : END, troopKf: toKf(u.troops), noteKf: toKf(u.note) };
  });
  // Piecewise-linear value of [day, n] keyframes; `before` is returned ahead of the first one.
  function seriesAt(kf, day, before) {
    if (!kf.length || day < kf[0][0]) return before;
    for (let i = 1; i < kf.length; i++) {
      if (day < kf[i][0]) return kf[i - 1][1] + (kf[i][1] - kf[i - 1][1]) * (day - kf[i - 1][0]) / (kf[i][0] - kf[i - 1][0]);
    }
    return kf[kf.length - 1][1];
  }
  const troopsAt = (u, day) => seriesAt(u.troopKf, day, u.troopKf[0][1]);
  const noteAt = (u, day) => {
    let t = null;
    for (const [d, text] of u.noteKf) { if (d <= day) t = text; else break; }
    return t;
  };
  // Compact strength for the unit symbol ("1.45M", "390K") and a rounded full figure for text.
  const fmtStrength = (n) => (n >= 995000 ? `${+(n / 1e6).toFixed(2)}M` : n < 500 ? "0" : `${Math.round(n / 1000)}K`);
  const fmtMen = (n) => (Math.round(n / 1000) * 1000).toLocaleString("en-US");
  function unitAt(u, day) {
    if (day < u.s || day > u.e) return null;
    const k = u.kf;
    let i = 0, name = u.name;
    while (i < k.length - 1 && k[i + 1].d <= day) i++;
    for (let j = 0; j <= i; j++) if (k[j].name) name = k[j].name;
    if (i === k.length - 1) return { p: k[i].p, name };
    const t = smooth((day - k[i].d) / (k[i + 1].d - k[i].d));
    return { p: [k[i].p[0] + (k[i + 1].p[0] - k[i].p[0]) * t, k[i].p[1] + (k[i + 1].p[1] - k[i].p[1]) * t], name };
  }

  // ------------------------------------------------------------------ Battle of Britain and the U-boat war
  const BOB = window.WW2_BOB;
  BOB.s = dayOf(BOB.start); BOB.e = dayOf(BOB.end);
  BOB.phases.forEach((ph) => { ph.s = dayOf(ph.start); ph.e = dayOf(ph.end); });
  const UB = window.WW2_UBOATS;
  UB.s = dayOf(UB.start); UB.e = dayOf(UB.end);
  UB.str = UB.strength.map(([d, n]) => [dayOf(d), n]);
  UB.eras.forEach((er) => { er.s = dayOf(er.start); });
  UB.routes.forEach((r) => { r.s = dayOf(r.start); });
  const UB_MAX = 26;
  function uboatStrength(day) {
    const s = UB.str;
    if (day <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (day <= s[i][0]) return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * (day - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
    }
    return s[s.length - 1][1];
  }
  // Seeded positions for each era's U-boats, kept off land.
  (function placeBoats() {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    UB.eras.forEach((er) => {
      const total = d3.sum(er.boxes, (b) => b[2]);
      er.pos = [];
      for (let i = 0; i < UB_MAX; i++) {
        let r = rnd() * total, box = er.boxes[0];
        for (const b of er.boxes) { if (r < b[2]) { box = b; break; } r -= b[2]; }
        let p;
        for (let tries = 0; tries < 30; tries++) {
          p = [box[0][0] + rnd() * (box[1][0] - box[0][0]), box[0][1] + rnd() * (box[1][1] - box[0][1])];
          if (!d3.geoContains(land, p)) break;
        }
        er.pos.push(p);
      }
    });
  })();
  // Boats glide to new hunting grounds over a month when the era changes, and drift while on patrol.
  function uboatState(day) {
    let i = 0;
    while (i < UB.eras.length - 1 && UB.eras[i + 1].s <= day) i++;
    const er = UB.eras[i], prev = UB.eras[Math.max(0, i - 1)];
    const t = i === 0 ? 1 : smooth(Math.min(1, (day - er.s) / 30));
    const pos = er.pos.map((p, j) => {
      const q = prev.pos[j];
      return [q[0] + (p[0] - q[0]) * t + 0.6 * Math.sin(day / 11 + j * 1.7), q[1] + (p[1] - q[1]) * t + 0.3 * Math.cos(day / 13 + j)];
    });
    return { era: er, pos, n: uboatStrength(day) };
  }
  const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Troop strengths per campaign, and cumulative Allied shipping losses.
  const FORCES = window.WW2_FORCES.map((f) => ({ ...f, s: dayOf(f.start), e: dayOf(f.end) }));
  const fmtTroops = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)} million` : `${Math.round(n / 1000)},000`);
  const LOSSES = window.WW2_SHIPPING_LOSSES.map(([a, b, t]) => ({ s: dayOf(a), e: dayOf(b), t }));
  // National armed-forces totals, summed per side for the "Men under arms" panel.
  const MANPOWER = window.WW2_MANPOWER.map((c) => ({ ...c, strength: toKf(c.strength), called: toKf(c.called), dead: toKf(c.dead) }));
  const BARBAROSSA = dayOf("1941-06-22");
  function manpowerAt(side, day) {
    const m = { strength: 0, called: 0, dead: 0 };
    for (const c of MANPOWER) if (c.side === side) for (const k in m) m[k] += seriesAt(c[k], day, 0);
    return m;
  }
  function shippingLost(day) {
    let sum = 0;
    for (const y of LOSSES) {
      if (day >= y.e) sum += y.t;
      else if (day > y.s) sum += y.t * (day - y.s) / (y.e - y.s);
    }
    return sum;
  }
  const MERCHANT = "M-6.5,-2.6 L4.5,-2.6 L8.5,0 L4.5,2.6 L-6.5,2.6 Z M-3,-1.2 L0.5,-1.2 L0.5,1.2 L-3,1.2 Z";
  const ESCORT = "M-8,-1.5 L5,-1.5 L10,0 L5,1.5 L-8,1.5 Z";
  const PLANE = "M7,0 L-3,-1.2 L-5,-6 L-7,-6 L-5.5,-1.2 L-8,-1.2 L-9.5,-3.5 L-10.5,-3.5 L-10,0 L-10.5,3.5 L-9.5,3.5 L-8,1.2 L-5.5,1.2 L-7,6 L-5,6 L-3,1.2 Z";
  const SUB = "M-10,0 C-8,-2.6 6,-2.6 10,0 C6,2.6 -8,2.6 -10,0 Z M-2.5,-2 L-1.8,-5 L2,-5 L2.6,-2 Z";

  const SYMBOLS = {
    battle: d3.symbol(d3.symbolDiamond, 120)(),
    naval: d3.symbol(d3.symbolSquare, 72)(),
    milestone: d3.symbol(d3.symbolStar, 130)(),
    bombing: d3.symbol(d3.symbolWye, 110)(),
    resistance: d3.symbol(d3.symbolTriangle, 95)(),
    holocaust: d3.symbol(d3.symbolCircle, 70)()
  };

  const LAYERS = [
    { id: "fronts", name: "Front lines", key: '<svg class="key" viewBox="0 0 22 12"><path d="M1 8 L7 4 L13 7 L21 3" fill="none" stroke="var(--front)" stroke-width="2"/></svg>' },
    { id: "armies", name: "Armies", key: '<svg class="key" viewBox="0 0 22 12"><rect x="4" y="1.5" width="14" height="9" fill="var(--allied)" stroke="var(--front)" stroke-width="1"/><path d="M4 1.5L18 10.5M4 10.5L18 1.5" stroke="var(--panel-solid)" stroke-width="1"/></svg>' },
    { id: "manpower", name: "Men under arms", key: '<svg class="key" viewBox="0 0 22 12"><rect x="1" y="2" width="15" height="3" fill="var(--axis)"/><rect x="1" y="7" width="20" height="3" fill="var(--allied)"/></svg>' },
    { id: "battles", name: "Major battles", key: `<svg class="key" viewBox="-11 -6 22 12"><path d="${SYMBOLS.battle}" transform="scale(.7)" fill="var(--battle)"/></svg>` },
    { id: "bombing", name: "Bombing campaigns", key: `<svg class="key" viewBox="-11 -6 22 12"><path d="${SYMBOLS.bombing}" transform="scale(.7)" fill="var(--bomb)"/></svg>` },
    { id: "airsea", name: "Battle of Britain & U-boats", key: `<svg class="key" viewBox="-11 -6 22 12"><path d="${SUB}" transform="scale(.9)" fill="var(--axis)"/></svg>` },
    { id: "resistance", name: "Resistance movements", key: `<svg class="key" viewBox="-11 -6 22 12"><path d="${SYMBOLS.resistance}" transform="scale(.7)" fill="var(--resist)"/></svg>` },
    { id: "holocaust", name: "The Holocaust", key: '<svg class="key" viewBox="-11 -6 22 12"><circle r="4" fill="none" stroke="var(--memorial)" stroke-width="1.8"/></svg>' },
    { id: "refugees", name: "Refugee movements", key: '<svg class="key" viewBox="0 0 22 12"><path d="M1 9 Q 10 1 20 5" fill="none" stroke="var(--refugee)" stroke-width="2.5" stroke-dasharray="1 4" stroke-linecap="round"/></svg>' }
  ];
  const THEATERS = [
    { id: "all", name: "All of Europe", box: [[-11, 31], [46, 69]] },
    { id: "west", name: "Western Front", box: [[-6, 42.5], [15, 58.5]] },
    { id: "east", name: "Eastern Front", box: [[14, 43], [48, 64]] },
    { id: "italy", name: "Italy", box: [[6, 36.3], [19.5, 47.2]] },
    { id: "balkans", name: "Balkans", box: [[13, 34.5], [30, 47.5]] },
    { id: "atlantic", name: "North Atlantic", box: [[-72, 34], [20, 74]] },
    { id: "africa", name: "North Africa", box: [[-8, 28], [36, 39.5]] }
  ];

  // ------------------------------------------------------------------ shared SVG defs (hatch, arrowheads)
  const defsSvg = d3.select("body").append("svg").attr("width", 0).attr("height", 0).style("position", "absolute").attr("aria-hidden", "true");
  const defs = defsSvg.append("defs");
  const hatch = defs.append("pattern").attr("id", "hatch").attr("patternUnits", "userSpaceOnUse").attr("width", 5).attr("height", 5).attr("patternTransform", "rotate(45)");
  hatch.append("rect").attr("width", 5).attr("height", 5).style("fill", "var(--occupied)");
  hatch.append("rect").attr("width", 1.6).attr("height", 5).style("fill", "var(--hatch)");
  defs.append("marker").attr("id", "arrow").attr("viewBox", "0 0 10 10").attr("refX", 5).attr("refY", 5)
    .attr("markerWidth", 4).attr("markerHeight", 4).attr("orient", "auto-start-reverse").attr("markerUnits", "strokeWidth")
    .append("path").attr("d", "M0 0 L10 5 L0 10 z").attr("class", "refugee-head");

  // ------------------------------------------------------------------ map view
  let viewSeq = 0;
  class MapView {
    constructor(container, app) {
      this.app = app;
      this.uid = "v" + (++viewSeq);
      this.container = container;
      this.day = 0;
      this.k = 1;
      this.lastStatus = new Map();
      this.xy = new Map();
      this.vis = new Map();
      this.svg = d3.select(container).insert("svg", ":first-child").attr("role", "img").attr("aria-label", "Map of Europe");
      const svg = this.svg;
      this.root = svg.append("g");
      this.gCountries = this.root.append("g");
      this.gZones = this.root.append("g");
      this.gFronts = this.root.append("g");
      // Overlays are drawn freely and then masked by the sea, which keeps them on land.
      this.seaMask = this.root.append("path").attr("class", "sea-mask").attr("fill-rule", "evenodd");
      this.gGrat = this.root.append("path").attr("class", "graticule").datum(graticule);
      this.gPinned = this.root.append("g");
      this.gBorders = this.root.append("path").attr("class", "borders").datum(borderMesh);
      this.gFlows = this.root.append("g");
      this.gAir = this.root.append("g").attr("class", "airsea");
      this.gUnits = this.root.append("g").attr("class", "units");
      this.gForces = this.root.append("g").attr("class", "forces");
      this.gMarkers = this.root.append("g");
      this.gLabels = this.root.append("g");

      this.countryPaths = this.gCountries.selectAll("path").data(features).join("path").attr("class", "country st-other");
      this.pinnedPaths = this.gPinned.selectAll("path").data(features.filter((f) => PINNED[f.properties.key])).join("path").attr("class", "country");
      this.zonePaths = this.gZones.selectAll("path").data(ZONES).join("path").attr("class", "zone").attr("fill-rule", "evenodd");
      this.frontHalo = this.gFronts.selectAll("path.front-halo").data(ZONES.filter((z) => z.kind === "front")).join("path").attr("class", "front-halo");
      this.frontPaths = this.gFronts.selectAll("path.front").data(ZONES.filter((z) => z.kind === "front")).join("path").attr("class", "front");

      this.flowSel = this.gFlows.selectAll("g").data(FLOWS).join("g").attr("class", "flow");
      this.flowSel.append("path").attr("class", "refugee-base").attr("marker-end", "url(#arrow)").style("stroke-width", (d) => 2 + d.weight * 1.4);
      this.flowSel.append("path").attr("class", "refugee").style("stroke-width", (d) => 1.5 + d.weight * 0.8);
      this.flowSel.on("click", (ev, d) => app.openCard(d));

      this.markers = this.gMarkers.selectAll("g").data(ITEMS, (d) => d.id).join("g")
        .attr("class", (d) => `marker ${d.type}`).attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", (d) => `${d.title}, ${fmtRange(d.start, d.end)}`);
      this.markers.append("circle").attr("class", "pulse").attr("r", 4);
      this.markers.append("circle").attr("class", "hit").attr("r", 12);
      this.markers.append("path").attr("class", "sym").attr("d", (d) => SYMBOLS[d.type]);
      this.markers.on("click", (ev, d) => { ev.stopPropagation(); app.openCard(d); })
        .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); app.openCard(d); } })
        .on("mouseenter", (ev, d) => app.showTip(ev, `<b>${d.title}</b><span>${fmtRange(d.start, d.end)}</span>`, null))
        .on("mouseleave", () => app.hideTip());

      this.unitName = new Map();
      this.unitXY = new Map();
      this.units = this.gUnits.selectAll("g").data(UNITS, (u) => u.id).join("g").attr("class", (u) => `unit ${u.side}`)
        .on("mouseenter", (ev, u) => app.showTip(ev, `<b>${this.unitName.get(u) || u.name}</b>About ${fmtMen(troopsAt(u, this.day))} troops (estimate)<br><span>${u.cmd ? "Commander: " + u.cmd : SIDE_NAME[u.side] + (u.size === "group" ? " army group" : " army")}</span>`, u.side))
        .on("mouseleave", () => app.hideTip());
      this.units.append("rect").attr("x", -12).attr("y", -7.5).attr("width", 24).attr("height", 15);
      this.units.filter((u) => u.arm === "inf").append("path").attr("class", "glyph").attr("d", "M-12,-7.5L12,7.5M-12,7.5L12,-7.5");
      this.units.filter((u) => u.arm === "armor").append("ellipse").attr("class", "glyph").attr("rx", 7.5).attr("ry", 3.8);
      // Troop strength sits where the echelon marks would; renderUnits keeps it current.
      this.units.append("text").attr("class", "echelon").attr("y", -10).text((u) => fmtStrength(u.troopKf[0][1]));

      this.zoom = d3.zoom().scaleExtent([0.6, 14]).on("zoom", (ev) => this.onZoom(ev));
      svg.call(this.zoom).on("dblclick.zoom", null);
      svg.on("mousemove", (ev) => this.onHover(ev)).on("mouseleave", () => app.hideTip());
      svg.on("click", () => app.closeCard());
      this.resize();
    }

    resize() {
      const { width, height } = this.container.getBoundingClientRect();
      this.width = Math.max(200, width); this.height = Math.max(200, height);
      this.svg.attr("viewBox", `0 0 ${this.width} ${this.height}`);
      const narrow = this.width < 700;
      const pad = { t: narrow ? 120 : 110, b: narrow ? 90 : 96, l: 20, r: narrow ? 20 : 40 };
      this.projection = d3.geoConicConformal().rotate([-15, 0]).parallels([38, 62]);
      this.fitBox(this.homeBox(), pad);
      this.path = d3.geoPath(this.projection);
      if (this.path.digits) this.path.digits(1);
      this.seaMask.attr("d", "M-20000,-20000H20000V20000H-20000Z" + this.path(land));
      this.gGrat.attr("d", this.path);
      this.countryPaths.attr("d", this.path);
      this.pinnedPaths.attr("d", this.path);
      this.gBorders.attr("d", this.path);
      this.pad = pad;
      ITEMS.forEach((d) => this.xy.set(d, this.projection(d.at)));
      this.buildAir();
      this.buildForces();
      this.render(this.day, true);
    }

    // Phones in portrait get a tighter starting view of the continent.
    homeBox() { return this.width < 560 && this.height > this.width ? [[-4, 40], [36, 62]] : THEATERS[0].box; }

    fitBox(box, pad) {
      const [[x0, y0], [x1, y1]] = box;
      const pts = [];
      for (let i = 0; i <= 8; i++) { pts.push([x0 + (x1 - x0) * i / 8, y0], [x0 + (x1 - x0) * i / 8, y1]); }
      this.projection.fitExtent([[pad.l, pad.t], [this.width - pad.r, this.height - pad.b]], { type: "MultiPoint", coordinates: pts });
    }

    // Zoom transform that frames `box` (in the base projection's pixel space).
    transformFor(box) {
      const [[x0, y0], [x1, y1]] = box;
      const pts = [];
      for (let i = 0; i <= 8; i++) { pts.push(this.projection([x0 + (x1 - x0) * i / 8, y0]), this.projection([x0 + (x1 - x0) * i / 8, y1])); }
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const bx0 = d3.min(xs), bx1 = d3.max(xs), by0 = d3.min(ys), by1 = d3.max(ys);
      const p = this.pad;
      const availW = this.width - p.l - p.r, availH = this.height - p.t - p.b;
      const k = Math.min(availW / (bx1 - bx0), availH / (by1 - by0));
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      return d3.zoomIdentity.translate(p.l + availW / 2 - k * cx, p.t + availH / 2 - k * cy).scale(k);
    }

    zoomTo(box, animate) {
      const t = this.transformFor(box);
      (animate ? this.svg.transition().duration(900).ease(d3.easeCubicInOut) : this.svg).call(this.zoom.transform, t);
    }

    onZoom(ev) {
      const t = ev.transform;
      this.k = t.k;
      this.root.attr("transform", t);
      this.placeMarkers();
      if (this.app.activeView === this || !ev.sourceEvent) hatch.attr("patternTransform", `rotate(45) scale(${1 / Math.sqrt(t.k)})`);
      if (ev.sourceEvent) this.app.syncZoom(this, t);
      this.layoutLabels();
    }

    placeMarkers() {
      const s = 1 / this.k;
      this.markers.attr("transform", (d) => { const p = this.xy.get(d); return `translate(${p[0]},${p[1]}) scale(${s})`; });
      if (this.bobG) { this.renderUnits(this.day); this.renderAir(this.day); this.renderForces(this.day); }
    }

    // Static pieces of the air and sea layer, in projected coordinates.
    buildAir() {
      const P = this.projection;
      const g = this.gAir;
      g.selectAll("*").remove();
      const pin = (sel, at) => sel.classed("pin", true).datum({ at, xy: P(at) });
      const curve = (a, b, bend) => {
        const p0 = P(a), p1 = P(b);
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
        const c = [(p0[0] + p1[0]) / 2 - dy * bend, (p0[1] + p1[1]) / 2 + dx * bend];
        return `M${p0}Q${c} ${p1}`;
      };

      // Battle of Britain: radar cover, raids by phase, the two air forces.
      const bob = this.bobG = g.append("g").attr("class", "bob");
      const cover = BOB.radar.map((c) => "M" + d3.geoCircle().center(c).radius(BOB.radarKm / 111.2).precision(6)().coordinates[0].map((p) => P(p)).join("L") + "Z").join("");
      bob.append("path").attr("class", "radar-cover").attr("d", cover);
      BOB.radar.forEach((c) => pin(bob.append("g"), c).append("path").attr("class", "radar-site").attr("d", "M0,-4.5L4,3L-4,3Z"));
      this.phaseG = bob.selectAll("g.phase").data(BOB.phases).join("g").attr("class", "phase");
      this.phaseG.each(function (ph) {
        const pg = d3.select(this);
        ph.raids.forEach(([a, b], i) => {
          const d = curve(a, b, i % 2 ? 0.16 : -0.16);
          pg.append("path").attr("class", "raid").attr("d", d);
          for (let n = 0; n < (REDUCED_MOTION ? 0 : 2); n++) {
            const plane = pg.append("g").attr("class", "plane");
            plane.append("animateMotion").attr("dur", "3.6s").attr("repeatCount", "indefinite").attr("rotate", "auto")
              .attr("begin", `-${(i * 0.7 + n * 1.8).toFixed(1)}s`).attr("path", d);
            plane.append("g").attr("class", "pscale").append("path").attr("d", PLANE);
          }
        });
      });
      this.bobLabels = bob.append("g");
      BOB.labels.forEach((l) => {
        const t = pin(this.bobLabels.append("g"), l.at).append("text").attr("class", "air-label");
        t.append("tspan").attr("class", "t1").attr("x", 0).text(l.title);
        t.append("tspan").attr("x", 0).attr("dy", "1.25em").text(l.text);
      });
      const pl = pin(bob.append("g"), BOB.phaseLabelAt).append("text").attr("class", "air-label phase-label").attr("text-anchor", "end");
      pl.append("tspan").attr("class", "t1").attr("x", 0).text("Battle of Britain");
      this.phaseText = pl.append("tspan").attr("x", 0).attr("dy", "1.25em");

      // U-boats: convoy routes, boats on patrol, ships going down, and the fleet's size.
      const ub = this.ubG = g.append("g").attr("class", "uboats");
      // Each route carries two convoys: merchant ships in columns with escorts on the flanks.
      this.routes = ub.selectAll("g.route").data(UB.routes).join("g").attr("class", "route");
      this.routes.each(function (r) {
        const rg = d3.select(this);
        const d = d3.line().curve(d3.curveCatmullRom)(r.path.map((p) => P(p)));
        const path = rg.append("path").attr("class", "convoy").attr("d", d);
        if (REDUCED_MOTION) return;
        const dur = Math.max(24, path.node().getTotalLength() / 16);
        for (let c = 0; c < 2; c++) {
          const cg = rg.append("g").attr("class", "convoy-group");
          cg.append("animateMotion").attr("dur", `${dur.toFixed(1)}s`).attr("repeatCount", "indefinite").attr("rotate", "auto")
            .attr("begin", `-${(dur * (c * 0.5 + 0.15)).toFixed(1)}s`).attr("path", d);
          const inner = cg.append("g").attr("class", "pscale");
          for (const x of [-17, 0, 17]) for (const y of [-6.5, 6.5]) inner.append("path").attr("class", "merchant").attr("d", MERCHANT).attr("transform", `translate(${x},${y})`);
          for (const [x, y] of [[33, 0], [-3, -17], [-3, 17]]) inner.append("path").attr("class", "escort").attr("d", ESCORT).attr("transform", `translate(${x},${y})`);
        }
      });
      this.subs = ub.selectAll("g.sub").data(d3.range(UB_MAX)).join("g").attr("class", "sub");
      this.subs.append("path").attr("d", SUB);
      this.sinks = ub.selectAll("g.sinking").data(d3.range(4)).join("g").attr("class", "sinking");
      this.sinks.append("circle").attr("cx", 14).attr("cy", -6).attr("r", 3).style("animation-delay", (i) => `${i * 0.9}s`);
      const stat = pin(ub.append("g"), UB.statsAt).append("text").attr("class", "air-label ub-label").attr("text-anchor", "middle");
      this.ubStat1 = stat.append("tspan").attr("class", "t1").attr("x", 0);
      this.ubStat2 = stat.append("tspan").attr("x", 0).attr("dy", "1.25em");
      this.ubStat3 = stat.append("tspan").attr("class", "t3").attr("x", 0).attr("dy", "1.35em");
    }

    // Place army symbols; where several crowd together, nudge them apart on screen.
    // Troop-strength panels: one bar per side, scaled to the larger force.
    buildForces() {
      const g = this.gForces;
      g.selectAll("*").remove();
      const W = 214, PAD = 9, ROW = 27, BAR = 118;
      this.forcePanels = g.selectAll("g.force").data(FORCES).join("g").attr("class", "force");
      this.forcePanels.each(function (f) {
        const pg = d3.select(this);
        const h = PAD + 14 + f.sides.length * ROW + 2;
        const x0 = f.anchor === "end" ? -W : 0;
        f._box = [x0, 0, W, h];
        const max = d3.max(f.sides, (sd) => sd.n);
        pg.append("rect").attr("class", "force-bg").attr("x", x0).attr("y", 0).attr("width", W).attr("height", h).attr("rx", 3);
        pg.append("text").attr("class", "force-title").attr("x", x0 + PAD).attr("y", PAD + 8).text(`${f.title} · troops`);
        f.sides.forEach((sd, i) => {
          const y = PAD + 14 + i * ROW;
          pg.append("text").attr("class", "force-name").attr("x", x0 + PAD).attr("y", y + 10).text(sd.name);
          pg.append("rect").attr("class", `force-bar st-${sd.side}`).attr("x", x0 + PAD).attr("y", y + 14).attr("height", 7).attr("width", Math.max(3, BAR * sd.n / max));
          pg.append("text").attr("class", "force-num").attr("x", x0 + PAD + Math.max(3, BAR * sd.n / max) + 6).attr("y", y + 21).text(fmtTroops(sd.n));
        });
      });
    }

    renderForces(day) {
      const app = this.app, th = app.theater, iday = Math.floor(day);
      const ps = this.k < 1.3 ? 0.85 : 1;
      const s = ps / this.k;
      const t = d3.zoomTransform(this.svg.node());
      this.forceBoxes = [];
      this.forcePanels.each((f, i, nodes) => {
        const el = nodes[i];
        const on = app.layers.armies && iday >= f.s && iday <= f.e && (th === "all" || f.theater === th);
        if (!on) { el.style.display = "none"; return; }
        const xy = this.projection(f.at);
        const sx = t.applyX(xy[0]), sy = t.applyY(xy[1]);
        const [bx, , bw, bh] = f._box.map((v) => v * ps);
        if (sx + bx < 0 || sx + bx + bw > this.width || sy < 0 || sy + bh > this.height) { el.style.display = "none"; return; }
        el.style.display = "";
        el.setAttribute("transform", `translate(${xy[0]},${xy[1]}) scale(${s})`);
        this.forceBoxes.push([sx + bx, sy, sx + bx + bw, sy + bh]);
      });
    }

    renderUnits(day) {
      const app = this.app, th = app.theater;
      const us = this.width < 600 ? 0.72 : 1;
      const s = us / this.k;
      const t = d3.zoomTransform(this.svg.node());
      const live = [];
      this.units.each((u, i, nodes) => {
        const el = nodes[i];
        const st = app.layers.armies && (th === "all" || u.theater === th) ? unitAt(u, day) : null;
        if (!st) { el.style.display = "none"; this.unitXY.delete(u); return; }
        el.style.display = "";
        this.unitName.set(u, st.name);
        const str = fmtStrength(troopsAt(u, day));
        if (el._str !== str) { el._str = str; el.lastChild.textContent = str; }
        const xy = this.projection(st.p);
        live.push({ u, el, x: t.applyX(xy[0]), y: t.applyY(xy[1]) });
      });
      for (let iter = 0; iter < 8; iter++) {
        for (let a = 0; a < live.length; a++) {
          for (let b = a + 1; b < live.length; b++) {
            const A = live[a], B = live[b];
            const dx = B.x - A.x, dy = B.y - A.y;
            const ox = 28 * us - Math.abs(dx), oy = 22 * us - Math.abs(dy);
            if (ox <= 0 || oy <= 0) continue;
            if (ox < oy) { const m = (ox / 2) * (dx < 0 ? -1 : 1); A.x -= m; B.x += m; }
            else { const m = (oy / 2) * (dy < 0 ? -1 : 1); A.y -= m; B.y += m; }
          }
        }
      }
      for (const L of live) {
        this.unitXY.set(L.u, [L.x, L.y]);
        L.el.setAttribute("transform", `translate(${t.invertX(L.x)},${t.invertY(L.y)}) scale(${s})`);
      }
    }

    renderAir(day) {
      const app = this.app, th = app.theater, s = 1 / this.k, iday = Math.floor(day);
      const bobOn = app.layers.airsea && (th === "all" || th === "west") && iday >= BOB.s && iday <= BOB.e;
      this.bobG.style("display", bobOn ? null : "none");
      if (bobOn) {
        this.phaseG.style("display", (ph) => (iday >= ph.s && iday <= ph.e ? null : "none"));
        const ph = BOB.phases.find((p) => iday >= p.s && iday <= p.e) || BOB.phases[0];
        if (this._phase !== ph) { this._phase = ph; this.phaseText.text(ph.name); }
        this.bobLabels.style("display", this.k >= 1.6 ? null : "none");
      }
      const ubOn = app.layers.airsea && (th === "all" || th === "atlantic") && iday >= UB.s && iday <= UB.e;
      this.ubG.style("display", ubOn ? null : "none");
      if (ubOn) {
        const st = uboatState(day);
        const n = Math.max(1, Math.min(UB_MAX, Math.round(st.n / UB.perIcon)));
        const xys = st.pos.map((p) => this.projection(p));
        this.subs.each((i, j, nodes) => {
          const el = nodes[j];
          if (i >= n) { el.style.display = "none"; return; }
          el.style.display = "";
          el.setAttribute("transform", `translate(${xys[i][0]},${xys[i][1]}) scale(${s})`);
        });
        this.sinks.each((i, j, nodes) => {
          const xy = xys[(i * 5) % n];
          nodes[j].setAttribute("transform", `translate(${xy[0]},${xy[1]}) scale(${s})`);
        });
        this.routes.style("display", (r) => (iday >= r.s ? null : "none"));
        const label = `≈ ${Math.round(st.n / 5) * 5} U-boats in service`;
        if (this._ubLabel !== label) { this._ubLabel = label; this.ubStat1.text(label); }
        if (this._era !== st.era) { this._era = st.era; this.ubStat2.text(st.era.name); }
        const lost = `≈ ${(shippingLost(day) / 1e6).toFixed(1)} million tons of Allied shipping sunk so far`;
        if (this._lost !== lost) { this._lost = lost; this.ubStat3.text(lost); }
      }
      this.gAir.selectAll(".pin").attr("transform", (d) => `translate(${d.xy[0]},${d.xy[1]}) scale(${s})`);
      this.gAir.selectAll(".pscale").attr("transform", `scale(${s})`);
      // Hide any air-war caption that would run off the edge of the screen.
      const t = d3.zoomTransform(this.svg.node());
      this.gAir.selectAll("text.air-label").each((d, i, nodes) => {
        const el = nodes[i];
        const w = d3.max(el.querySelectorAll("tspan"), (ts) => ts.textContent.length) * 5.9;
        const x = t.applyX(d.xy[0]);
        const anchor = el.getAttribute("text-anchor") || "start";
        const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
        el.style.visibility = x0 < 4 || x0 + w > this.width - 4 ? "hidden" : "";
      });
    }

    projectRing(ring) { return ring.map((p) => this.projection(p)); }

    render(day, force) {
      this.day = day;
      const app = this.app;
      const iday = Math.floor(day);

      // Base country fills; only touch the DOM when a status changes.
      const changed = force || this.lastDay !== iday;
      if (changed) {
        this.countryPaths.each((f, i, nodes) => {
          const c = controlAt(f.properties.key, iday);
          if (force || this.lastStatus.get(f) !== c.status) {
            nodes[i].setAttribute("class", "country st-" + c.status);
            this.lastStatus.set(f, c.status);
          }
        });
        this.pinnedPaths.each((f, i, nodes) => {
          const on = isPinned(f.properties.key, iday);
          nodes[i].style.display = on ? "" : "none";
          if (on) nodes[i].setAttribute("class", "country st-" + controlAt(f.properties.key, iday).status);
        });
      }
      this.lastDay = iday;

      // Zones and fronts.
      this.zoneState = [];
      const showFronts = app.layers.fronts;
      const theater = app.theater;
      this.zonePaths.each((z, i, nodes) => {
        const el = nodes[i];
        let st = null, d = "";
        if (z.kind === "region") {
          st = regionAt(z, iday);
          if (st) {
            const rings = z.rings.map((r) => this.projectRing(r));
            d = rings.map((r) => "M" + r.join("L") + "Z").join("");
            this.zoneState.push({ z, rings, status: st.status, label: st.label });
          }
        } else {
          const f = frontAt(z, day);
          z._now = f;
          if (f) {
            st = f;
            const poly = this.projectRing(f.polygon);
            d = "M" + poly.join("L") + "Z";
            this.zoneState.push({ z, rings: [poly], status: f.status, label: f.label });
          }
        }
        el.setAttribute("d", d);
        if (st) el.setAttribute("class", "zone st-" + st.status);
      });
      const frontD = (z) => {
        const f = z._now;
        if (!f || !showFronts) return "";
        const min = z.strokeMinLat;
        const quiet = z.quiet.filter((q) => iday >= q.from).map((q) => q.box);
        const isQuiet = (p) => quiet.some(([[x0, y0], [x1, y1]]) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1);
        let out = "", run = [];
        const flush = () => { if (run.length > 1) out += "M" + run.join("L"); run = []; };
        for (const p of f.line) {
          if ((min != null && p[1] < min) || (quiet.length && isQuiet(p))) { flush(); continue; }
          run.push(this.projection(p));
        }
        flush();
        return out;
      };
      this.frontPaths.attr("d", frontD)
        .attr("class", (z) => "front" + (z._now && z._now.dashed ? " dashed" : "") + (theater !== "all" && z.theater !== theater ? " dim" : ""));
      this.frontHalo.attr("d", frontD).attr("class", (z) => "front-halo" + (theater !== "all" && z.theater !== theater ? " dim" : ""));

      // Refugee flows.
      const line = d3.line().curve(d3.curveCatmullRom.alpha(0.5));
      this.flowSel.style("display", (f) => app.layers.refugees && iday >= f.s && iday <= f.e + 20 ? "" : "none");
      if (force || !this._flowsDrawn) {
        this.flowSel.selectAll("path").attr("d", (f) => line(f.path.map((p) => this.projection(p))));
        this._flowsDrawn = true;
      }

      // Markers.
      this.markers.each((d, i, nodes) => {
        const visible = app.layers[d.layer] && iday >= d.s && (theater === "all" || d.theater === theater);
        const active = iday <= d.e + 14;
        const el = nodes[i];
        el.style.display = visible ? "" : "none";
        el.classList.toggle("past", visible && !active);
        el.classList.toggle("selected", app.selected === d);
        this.vis.set(d, { visible, active: visible && active });
      });
      if (force) this.placeMarkers();
      this.renderUnits(day);
      this.renderAir(day);
      this.renderForces(day);
      this.layoutLabels();
    }

    // Greedy label placement: newest active events first, skip overlaps.
    layoutLabels() {
      const app = this.app;
      const k = this.k;
      const t = d3.zoomTransform(this.svg.node());
      const vis = (d) => this.vis.get(d) || {};
      const cands = ITEMS.filter((d) => vis(d).visible && (vis(d).active || app.selected === d) && (d.type !== "holocaust" || k >= 2.2 || app.selected === d));
      cands.sort((a, b) => (app.selected === b) - (app.selected === a) || b.s - a.s);
      const placed = [];
      const out = [];
      const W = this.width, H = this.height;
      const hit = (list, box) => list.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      const symbols = [...this.unitXY.values()].map((xy) => [xy[0] - 13, xy[1] - 15, xy[0] + 13, xy[1] + 8.5]).concat(this.forceBoxes || []);
      const overlaps = (box) => hit(placed, box) || hit(symbols, box);
      for (const d of cands) {
        const xy = this.xy.get(d);
        const sx = t.applyX(xy[0]), sy = t.applyY(xy[1]);
        if (sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20) continue;
        const w = d.title.length * 6.3 + 6, h = 14;
        const options = [[11, 4, "start"], [-11, 4, "end"], [0, -12, "middle"], [0, 20, "middle"]];
        // First look for a spot clear of everything; failing that, allow covering army symbols.
        let done = false;
        for (const strict of [true, false]) {
          for (const [dx, dy, anchor] of options) {
            const x0 = anchor === "start" ? sx + dx : anchor === "end" ? sx + dx - w : sx - w / 2;
            const box = [x0, sy + dy - 11, x0 + w, sy + dy - 11 + h];
            if (box[0] < 4 || box[2] > W - 4) continue;
            if (strict ? overlaps(box) : hit(placed, box)) continue;
            placed.push(box);
            out.push({ d, x: sx + dx, y: sy + dy, anchor, text: d.title, cls: "mlabel" + (d.type === "holocaust" ? " holocaust" : "") });
            done = true;
            break;
          }
          if (done) break;
        }
        if (out.length > 26) break;
      }
      const units = [...this.unitXY].sort((a, b) => (b[0].size === "group") - (a[0].size === "group"));
      for (const [u, [sx, sy]] of units) {
        if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
        const note = noteAt(u, Math.floor(this.day));
        const text = (this.unitName.get(u) || u.name) + (note ? ` · ${note}` : "");
        const w = text.length * 5.4 + 4, h = 12;
        const options = [[0, 20, "middle"], [15, 4, "start"], [-15, 4, "end"], [0, -18, "middle"]];
        for (const [dx, dy, anchor] of options) {
          const x0 = anchor === "start" ? sx + dx : anchor === "end" ? sx + dx - w : sx - w / 2;
          const box = [x0, sy + dy - 9.5, x0 + w, sy + dy - 9.5 + h];
          if (box[0] < 4 || box[2] > W - 4 || overlaps(box)) continue;
          placed.push(box);
          out.push({ d: u, x: sx + dx, y: sy + dy, anchor, text, cls: "ulabel " + u.side });
          break;
        }
      }
      // Labels live in the zoomed group, so convert back from screen space.
      this.gLabels.selectAll("text").data(out, (o) => o.cls + o.d.id).join("text")
        .attr("class", (o) => o.cls)
        .attr("text-anchor", (o) => o.anchor)
        .attr("transform", (o) => `translate(${t.invertX(o.x)},${t.invertY(o.y)}) scale(${1 / k})`)
        .text((o) => o.text);
    }

    pop(item) {
      const node = this.markers.filter((d) => d === item).node();
      if (!node) return;
      node.classList.remove("pop");
      void node.getBoundingClientRect();
      node.classList.add("pop");
    }

    onHover(ev) {
      if (ev.target.closest && ev.target.closest(".marker, .flow")) return;
      const datum = d3.select(ev.target).datum();
      if (!datum || !datum.properties) { this.app.hideTip(); return; }
      const name = datum.properties.key;
      const iday = Math.floor(this.day);
      let status, label;
      if (isPinned(name, iday)) {
        ({ status, label } = controlAt(name, iday));
      } else {
        const p = d3.pointer(ev, this.root.node());
        const hit = this.zoneState.slice().reverse().find((s) => {
          let inside = false;
          for (const r of s.rings) if (d3.polygonContains(r, p)) inside = !inside;
          return inside;
        });
        if (hit) { status = hit.status; label = hit.label; }
        else ({ status, label } = controlAt(name, iday));
      }
      const disp = name === "N. Cyprus" ? "Cyprus" : name;
      this.app.showTip(ev, `<b>${disp}</b><span>${label || STATUS_NAMES[status]}</span>`, status);
    }
  }

  // ------------------------------------------------------------------ app
  const app = {
    day: 0,
    playing: false,
    speedIdx: 0,
    theater: "all",
    selected: null,
    layers: Object.assign({ fronts: true, armies: true, manpower: true, battles: true, bombing: true, airsea: true, resistance: true, holocaust: false, refugees: true }, store.get("layers", {})),
    comparing: false,
    views: [],
    activeView: null
  };
  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), date: $("date-label"), slider: $("slider"), play: $("play"), playIcon: $("play-icon"),
    speed: $("speed"), ticks: $("ticks"), years: $("years"), tooltip: $("tooltip"), stage: $("stage"),
    card: $("card"), controls: $("controls")
  };
  // Base run times. Playback also slows wherever briefings come close together, so each one
  // stays on screen for at least `hold` seconds; quiet stretches of the war pass at full speed.
  const SPEEDS = [{ label: "1×", secs: 80, hold: 1.6 }, { label: "2×", secs: 40, hold: 0.9 }, { label: "½×", secs: 160, hold: 3 }];
  const briefEl = { list: $("brief-list"), when: $("brief-when"), next: $("brief-next"), bar: $("brief-bar") };
  let shownBrief = -1, shownAt = 0;
  app.pace = 1;

  // Show the briefing for the current date; it stays until the next one's date arrives.
  function updateBrief() {
    const iday = Math.floor(app.day);
    const idx = briefIndexAt(iday);
    const now = performance.now();
    if (idx !== shownBrief) {
      const b = BRIEFS[idx];
      briefEl.list.innerHTML = "";
      b.bullets.forEach((t) => { const li = document.createElement("li"); li.textContent = t; briefEl.list.appendChild(li); });
      briefEl.when.textContent = fmtLong(b.date);
      if (app.playing && idx > shownBrief) app.pace = 0.6;
      shownBrief = idx;
      shownAt = now;
      briefEl.list.parentElement.classList.remove("fresh");
      void briefEl.list.offsetWidth;
      briefEl.list.parentElement.classList.add("fresh");
    }
    const b = BRIEFS[shownBrief], nx = BRIEFS[shownBrief + 1];
    if (nx) {
      const left = Math.max(0, nx.d - iday);
      briefEl.next.textContent = left === 0 ? "next briefing today" : `next briefing in ${left} day${left === 1 ? "" : "s"}`;
      briefEl.bar.style.width = (Math.min(1, Math.max(0, (iday - b.d) / (nx.d - b.d))) * 100).toFixed(1) + "%";
    } else {
      briefEl.next.textContent = "";
      briefEl.bar.style.width = "100%";
    }
  }

  // Men under arms per side, with what was called up and lost over the last 30 days.
  const MP_SIDES = [{ id: "axis", name: "Axis" }, { id: "allied", name: "Western Allies" }, { id: "soviet", name: "Soviet Union" }];
  const MP_MAX = 24e6; // fixed bar scale, a little above the Western Allies' peak
  const mpEl = { box: $("manpower"), foot: $("mp-foot") };
  $("mp-rows").innerHTML = MP_SIDES.map((s) => `<div class="mp-row"><div class="mp-top"><span class="mp-name">${s.name}<small></small></span><b></b></div><span class="mp-bar"><i class="st-${s.id}"></i></span><div class="mp-sub"></div></div>`).join("");
  mpEl.rows = [...$("mp-rows").children].map((r) => ({ tag: r.querySelector("small"), n: r.querySelector("b"), bar: r.querySelector("i"), sub: r.querySelector(".mp-sub") }));
  const setHtml = (node, html) => { if (node._html !== html) { node._html = html; node.innerHTML = html; } };
  function updateManpower() {
    mpEl.box.hidden = !app.layers.manpower;
    if (mpEl.box.hidden) return;
    const day = app.day, before = Math.max(0, day - 30);
    const now = MP_SIDES.map((s) => manpowerAt(s.id, day));
    MP_SIDES.forEach((s, i) => {
      const m = now[i], ago = manpowerAt(s.id, before), r = mpEl.rows[i];
      setHtml(r.n, fmtMen(m.strength));
      setHtml(r.tag, s.id === "soviet" && day < BARBAROSSA ? "not yet allied" : "");
      r.bar.style.width = (Math.min(1, m.strength / MP_MAX) * 100).toFixed(2) + "%";
      setHtml(r.sub, `called up ${fmtStrength(m.called)} <em>+${fmtStrength(m.called - ago.called)}</em> · dead ${fmtStrength(m.dead)} <em>+${fmtStrength(m.dead - ago.dead)}</em>`);
    });
    const axis = now[0].strength, allies = now[1].strength + (day >= BARBAROSSA ? now[2].strength : 0);
    setHtml(mpEl.foot, `${day >= BARBAROSSA ? "Allies" : "Western Allies"} <b>${fmtStrength(allies)}</b> vs Axis <b>${fmtStrength(axis)}</b>, ${(allies / axis).toFixed(1)} to 1 · <em>+</em> = last 30 days`);
  }

  app.setDay = function (day, opts = {}) {
    const prev = app.day;
    app.day = clampDay(day);
    const view = app.views[0];
    view.render(app.day);
    el.date.textContent = fmtDay(app.day);
    updateBrief();
    updateManpower();
    if (!opts.fromSlider) el.slider.value = Math.round(app.day);
    el.slider.style.setProperty("--pct", (app.day / END * 100).toFixed(2) + "%");
    if (opts.popNew && app.day > prev) {
      for (const it of ITEMS) if (it.s > prev && it.s <= app.day && (view.vis.get(it) || {}).visible) view.pop(it);
    }
  };

  app.showTip = function (ev, html, status) {
    const r = el.stage.getBoundingClientRect();
    el.tooltip.innerHTML = html;
    el.tooltip.style.setProperty("--tt", status ? `var(--${status === "other" ? "line" : status})` : "var(--accent)");
    el.tooltip.hidden = false;
    const tw = el.tooltip.offsetWidth, th = el.tooltip.offsetHeight;
    let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
    if (x + tw > r.width - 8) x = ev.clientX - r.left - tw - 14;
    if (y + th > r.height - 8) y = ev.clientY - r.top - th - 14;
    el.tooltip.style.left = x + "px";
    el.tooltip.style.top = y + "px";
  };
  app.hideTip = () => { el.tooltip.hidden = true; };

  app.syncZoom = function (src, t) {
    app.activeView = src;
    for (const v of app.views) if (v !== src && v.svg) {
      v.root.attr("transform", t);
      v.k = t.k;
      v.svg.node().__zoom = t;
      v.placeMarkers();
      v.layoutLabels();
    }
  };

  // ---------------- play
  let rafId = null, lastTs = null;
  function tick(ts) {
    if (!app.playing) return;
    if (lastTs != null) {
      const dt = Math.min(0.1, (ts - lastTs) / 1000);
      const sp = SPEEDS[app.speedIdx];
      app.pace = Math.min(1, app.pace + dt / 1.2);
      let rate = END / sp.secs * app.pace;
      // Don't reach the next briefing until this one has had its time on screen.
      const nx = BRIEFS[shownBrief + 1];
      const left = sp.hold - (ts - shownAt) / 1000;
      if (nx && left > 0) rate = Math.min(rate, Math.max(0, nx.d - 0.01 - app.day) / left);
      const next = app.day + dt * rate;
      app.setDay(next, { popNew: true });
      if (next >= END) { stop(); return; }
    }
    lastTs = ts;
    rafId = requestAnimationFrame(tick);
  }
  function play() {
    if (app.comparing) return;
    if (app.day >= END) app.setDay(0);
    app.playing = true; lastTs = null;
    el.playIcon.setAttribute("d", "M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z");
    el.play.setAttribute("aria-label", "Pause");
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    app.playing = false;
    cancelAnimationFrame(rafId);
    el.playIcon.setAttribute("d", "M7 4.5v15l12-7.5z");
    el.play.setAttribute("aria-label", "Play the war");
  }
  el.play.addEventListener("click", () => (app.playing ? stop() : play()));
  el.speed.addEventListener("click", () => {
    app.speedIdx = (app.speedIdx + 1) % SPEEDS.length;
    el.speed.textContent = SPEEDS[app.speedIdx].label;
  });
  el.slider.max = END;
  el.slider.addEventListener("input", () => { stop(); app.setDay(+el.slider.value, { fromSlider: true }); });

  // ---------------- timeline ticks and year labels
  function buildTimeline() {
    el.years.innerHTML = "";
    for (let y = 1940; y <= 1945; y++) {
      const s = document.createElement("span");
      s.style.left = (dayOf(`${y}-01-01`) / END * 100) + "%";
      s.textContent = y;
      el.years.appendChild(s);
    }
    el.ticks.innerHTML = "";
    for (const it of ITEMS) {
      if (it.type === "holocaust" || !app.layers[it.layer]) continue;
      if (app.theater !== "all" && it.theater !== app.theater) continue;
      const i = document.createElement("i");
      i.style.left = (it.s / END * 100) + "%";
      if (it.type === "battle" || it.type === "milestone") i.className = "major";
      el.ticks.appendChild(i);
    }
  }

  // ---------------- options panel
  function buildOptions() {
    const th = $("theaters");
    th.innerHTML = THEATERS.map((t) => `<button class="chip" role="radio" data-id="${t.id}" aria-checked="${t.id === app.theater}">${t.name}</button>`).join("");
    th.addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip"); if (!b) return;
      setTheater(b.dataset.id);
    });
    const ly = $("layers");
    ly.innerHTML = LAYERS.map((l) => `<label class="layer"><input type="checkbox" id="layer-${l.id}" data-id="${l.id}" ${app.layers[l.id] ? "checked" : ""}><span>${l.name}</span>${l.key}</label>`).join("");
    ly.addEventListener("change", (ev) => {
      const id = ev.target.dataset.id; if (!id) return;
      app.layers[id] = ev.target.checked;
      store.set("layers", app.layers);
      updateHolocaustNote();
      updateManpower();
      buildTimeline();
      renderAll(true);
    });
    $("holocaust-note").textContent = window.WW2_HOLOCAUST_NOTE;
    updateHolocaustNote();
    $("controls-toggle").addEventListener("click", (ev) => setControlsOpen(ev.currentTarget.getAttribute("aria-expanded") !== "true"));
    if (window.innerWidth < 760) setControlsOpen(false);
  }
  function setControlsOpen(open) {
    $("controls-toggle").setAttribute("aria-expanded", open);
    $("controls-body").hidden = !open;
  }
  const updateHolocaustNote = () => { $("holocaust-note").hidden = !app.layers.holocaust; };

  function setTheater(id) {
    app.theater = id;
    document.querySelectorAll("#theaters .chip").forEach((c) => c.setAttribute("aria-checked", c.dataset.id === id));
    app.views.forEach((v) => v.zoomTo(id === "all" ? v.homeBox() : THEATERS.find((t) => t.id === id).box, true));
    buildTimeline();
    renderAll(false);
  }

  function renderAll(force) {
    if (app.comparing) { app.views[0].render(app.cmp[0], force); app.views[1].render(app.cmp[1], force); }
    else app.views[0].render(app.day, force);
  }

  // ---------------- event card
  const imageCache = new Map();
  async function fetchImage(title) {
    if (imageCache.has(title)) return imageCache.get(title);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const p = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.thumbnail ? { src: j.thumbnail.source, page: j.content_urls && j.content_urls.desktop.page } : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    imageCache.set(title, p);
    return p;
  }

  // A small locator map showing who held what on the item's start date.
  function locatorSvg(item) {
    const w = 640, h = 360;
    const [lon, lat] = item.at;
    const proj = d3.geoConicConformal().rotate([-lon, 0]).parallels([lat - 5, lat + 5]).center([0, lat]).scale(1700).translate([w / 2, h / 2]);
    const path = d3.geoPath(proj);
    const day = clampDay(item.s);
    const near = features.filter((f) => { const c = d3.geoCentroid(f); return Math.abs(c[0] - lon) < 25 && Math.abs(c[1] - lat) < 18 || f.properties.key === "Russia"; });
    const body = near.map((f) => `<path class="country st-${controlAt(f.properties.key, day).status}" d="${path(f)}"/>`).join("");
    const [x, y] = proj(item.at);
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Locator map"><rect width="${w}" height="${h}" fill="var(--sea)"/>${body}<path class="borders" d="${path(borderMesh)}"/><circle cx="${x}" cy="${y}" r="16" fill="none" stroke="var(--accent)" stroke-width="3"/><circle cx="${x}" cy="${y}" r="4" fill="var(--accent)"/></svg>`;
  }

  const KIND_LABEL = { battle: "Battle", naval: "Naval war", milestone: "Milestone", bombing: "Bombing campaign", resistance: "Resistance", holocaust: "The Holocaust", refugee: "Refugee movement" };
  const THEATER_LABEL = Object.fromEntries(THEATERS.map((t) => [t.id, t.name]));

  app.openCard = function (item) {
    app.selected = item;
    const c = el.card;
    c.classList.toggle("holocaust", item.type === "holocaust");
    $("card-kicker").innerHTML = `<span>${item.kind || KIND_LABEL[item.type]}</span>${item.theater ? `<span>${THEATER_LABEL[item.theater]}</span>` : ""}`;
    $("card-title").textContent = item.title;
    $("card-meta").textContent = [fmtRange(item.start, item.end), item.place].filter(Boolean).join(" · ");
    $("card-summary").textContent = item.summary;
    const figs = [];
    if (item.casualties) figs.push(["Casualties", item.casualties]);
    if (item.victims) figs.push(["Victims", item.victims]);
    if (item.people) figs.push(["People", item.people]);
    $("card-figs").innerHTML = figs.map(([k, v]) => `<dt>${k}</dt><dd></dd>`).join("");
    $("card-figs").querySelectorAll("dd").forEach((dd, i) => { dd.textContent = figs[i][1]; });
    const why = item.why || item.note;
    $("card-why").hidden = !why;
    $("card-why-label").textContent = item.type === "holocaust" ? "Remembrance" : "Why it mattered";
    $("card-why-text").textContent = why || "";
    const link = $("card-link");
    link.hidden = !item.wiki;
    if (item.wiki) link.href = "https://en.wikipedia.org/wiki/" + encodeURIComponent(item.wiki.replace(/ /g, "_"));

    const media = $("card-media");
    media.innerHTML = locatorSvg(item);
    if (item.wiki && item.type !== "holocaust") {
      const want = item;
      fetchImage(item.wiki).then((img) => {
        if (!img || app.selected !== want) return;
        const im = new Image();
        im.alt = item.title;
        im.onload = () => {
          if (app.selected !== want) return;
          media.innerHTML = "";
          media.appendChild(im);
          if (img.page) { const a = document.createElement("a"); a.className = "credit"; a.href = img.page; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Image: Wikipedia"; media.appendChild(a); }
        };
        im.src = img.src;
      });
    }
    c.hidden = false;
    c.scrollTop = 0;
    el.controls.hidden = window.innerWidth >= 760;
    renderAll(false);
  };
  app.closeCard = function () {
    if (el.card.hidden) return;
    el.card.hidden = true;
    el.controls.hidden = false;
    app.selected = null;
    renderAll(false);
  };
  $("card-close").addEventListener("click", app.closeCard);

  // ---------------- compare mode
  const monthDay = (v) => { const [y, m] = v.split("-").map(Number); return clampDay(dayOf(`${y}-${String(m).padStart(2, "0")}-15`)); };
  const PRESETS = [["1941-06", "1944-06", "Jun 1941 / Jun 1944"], ["1942-11", "1943-11", "Axis high tide / a year later"], ["1940-06", "1944-09", "Fall of France / Liberation"], ["1939-09", "1945-05", "Start / End"]];
  app.cmp = [monthDay("1941-06"), monthDay("1944-06")];
  function setCompare(on) {
    stop();
    app.comparing = on;
    el.app.classList.toggle("comparing", on);
    $("compare-toggle").setAttribute("aria-pressed", on);
    $("pane-b").hidden = !on;
    $("pane-a-tag").hidden = !on;
    $("tl-main").hidden = on;
    $("tl-compare").hidden = !on;
    if (on && !app.views[1]) app.views[1] = new MapView($("pane-b"), app);
    setControlsOpen(!on && window.innerWidth >= 760);
    app.views.forEach((v, i) => {
      if (i > 0 && !on) return;
      v.resize();
      v.svg.call(v.zoom.transform, v.transformFor(app.theater === "all" ? v.homeBox() : THEATERS.find((x) => x.id === app.theater).box));
    });
    if (on) updateCompare(); else app.setDay(app.day);
  }
  function updateCompare() {
    app.cmp = [monthDay($("cmp-a").value || "1941-06"), monthDay($("cmp-b").value || "1944-06")];
    app.views[0].render(app.cmp[0], true);
    app.views[1].render(app.cmp[1], true);
    $("pane-a-tag").textContent = fmtMonth(app.cmp[0]);
    $("pane-b-tag").textContent = fmtMonth(app.cmp[1]);
  }
  const fmtMonth = (day) => { const d = dateOf(day); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  $("compare-toggle").addEventListener("click", () => setCompare(!app.comparing));
  $("cmp-a").addEventListener("change", updateCompare);
  $("cmp-b").addEventListener("change", updateCompare);
  $("cmp-swap").addEventListener("click", () => { const a = $("cmp-a").value; $("cmp-a").value = $("cmp-b").value; $("cmp-b").value = a; updateCompare(); });
  $("presets").innerHTML = PRESETS.map(([a, b, n]) => `<button class="btn" data-a="${a}" data-b="${b}">${n}</button>`).join("");
  $("presets").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    $("cmp-a").value = b.dataset.a; $("cmp-b").value = b.dataset.b; updateCompare();
  });

  // ---------------- keyboard
  document.addEventListener("keydown", (ev) => {
    if (ev.target.matches("input, textarea, select") && ev.target.id !== "slider") return;
    if (ev.key === "Escape") { app.closeCard(); return; }
    if (app.comparing) return;
    if (ev.key === " " && !ev.target.closest("button, [role=button]")) { ev.preventDefault(); app.playing ? stop() : play(); }
    if (ev.target.id === "slider") return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      ev.preventDefault(); stop();
      const d = dateOf(app.day);
      const step = ev.key === "ArrowRight" ? 1 : -1;
      app.setDay(Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1) - T0) / DAY_MS));
    }
  });

  // ---------------- boot
  buildOptions();
  buildTimeline();
  app.views[0] = new MapView($("pane-a"), app);
  app.activeView = app.views[0];
  app.setDay(0);
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      app.views.forEach((v, i) => { if (i === 0 || app.comparing) v.resize(); });
      setTheater(app.theater);
    }, 150);
  });
  window.WW2_APP = app;
})();
