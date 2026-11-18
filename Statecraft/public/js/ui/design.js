// The design bureau: design our own tanks, armoured vehicles, combat aircraft and warships, part by part, on a
// blueprint that covers the map. Save and name a design, then order the factories to build it.

import { h, svg, money } from './dom.js';
import { DESIGN_KINDS, designStats, defaultParts, MAX_DESIGNS } from '../engine/designs.js';
import { BUILD, lineProblem, hasLine, LINE_SETUP } from '../engine/economy.js';
import { TECH_FIELDS } from '../engine/data/world.js';
import { GEO, ORDER } from '../engine/data/geo.js';
import { modal, confirmBox } from './dialogs.js';

const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);
const SHORT = { tanks: 'Tanks', vehicles: 'Vehicles', aircraft: 'Aircraft', ships: 'Warships' };
const EXAMPLE = { tanks: 'Leopard 3', vehicles: 'Mule 8x8', aircraft: 'Falcon II', ships: 'Sentinel class' };
const sign = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;

/* ---------- Small pieces shared by the bureau and the Research panel ---------- */

// Line icons for the four kinds, drawn on a 24-unit grid
const ICON_PATHS = {
  tanks: 'M3.5 15.5h16a2 2 0 0 1 0 4h-16a2 2 0 0 1 0-4z M4 15.5l1.2-3.5h12.3l2 3.5 M8 12l1-3h5.5l1 3 M15 10h7',
  vehicles: 'M2 7.5h11v9H2z M13 10.5h4.2l3.3 3.3v2.7H13 M5.5 19a1.8 1.8 0 1 0 0-.01 M16.5 19a1.8 1.8 0 1 0 0-.01',
  aircraft: 'M12 2.5c.9 0 1.4 1 1.4 2.4v4.4l7.1 4.2v2.2l-7.1-2.2v4.1l2.3 1.8v1.6L12 20.1l-3.7.9v-1.6l2.3-1.8v-4.1l-7.1 2.2v-2.2l7.1-4.2V4.9c0-1.4.5-2.4 1.4-2.4z',
  ships: 'M3 14.5h18l-2.6 4.5H5.6z M7 14.5v-3h9v3 M10 11.5V8h3.5v3.5 M11.7 8V4.5 M2.5 21.5c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8',
};
export const kindIcon = (kind) => svg('svg', { viewBox: '0 0 24 24', class: 'kind-icon', 'aria-hidden': 'true' }, svg('path', { d: ICON_PATHS[kind] }));

// What a design costs and takes for us, and how it rates
export function designFigures(me, d) {
  const st = designStats(d.kind, d.parts, me.tech);
  const b = BUILD[d.kind];
  return { st, b, each: b.cost * st.cost * costFactor(me), weeks: Math.max(1, Math.round(b.weeks * st.weeks)) };
}

// The four axes against the standard model (5): a meter with the standard marked, and how far off it we are
function axisRows(kind, axes, { compact = false } = {}) {
  return DESIGN_KINDS[kind].axes.map((label, i) => {
    const v = axes[i];
    const d = Math.round((v - 5) * 10) / 10;
    return h(`div.axis${compact ? '.compact' : ''}`,
      h('span.axis-name', label),
      h('div.axis-meter', { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 10, 'aria-valuenow': v, 'aria-label': label },
        h('i.axis-fill', { class: d > 0 ? 'up' : d < 0 ? 'down' : '', style: { width: `${v * 10}%` } }), h('i.axis-std')),
      h('b.mono', v.toFixed(1)),
      compact ? null : h('span.axis-delta.mono', { class: d > 0 ? 'good' : d < 0 ? 'bad' : 'faint' }, d ? sign(d) : '—'));
  });
}

const ratingChip = (edge) => h('span.rating', { class: edge > 1.005 ? 'up' : edge < 0.995 ? 'down' : '', title: 'Rating against the standard model (×1.00)' }, `×${edge.toFixed(2)}`);

// A design as a card: its blueprint, figures and what to do with it (the Research panel and the bureau's list)
export function designCard(ctx, d, { compact = false, current = false, onEdit } = {}) {
  const me = ctx.state.you;
  const f = designFigures(me, d);
  const edit = onEdit ?? (() => ctx.openDesigner({ design: d }));
  return h('article.design-card', { class: `${compact ? 'compact' : ''}${current ? ' current' : ''}` },
    blueprintFrame(d.kind, d.parts, { small: true }),
    h('div.dc-body',
      h('div.dc-head', kindIcon(d.kind), h('b.dc-name', { title: d.name }, d.name), ratingChip(f.st.edge)),
      h('div.dc-meta', `${DESIGN_KINDS[d.kind].name} · ${d.built ? `${d.built.toLocaleString('en')} built` : 'not built yet'}`),
      compact ? null : h('div.dc-axes', axisRows(d.kind, f.st.axes, { compact: true })),
      compact ? null : h('div.dc-figs',
        h('span', h('b', money(f.each)), ' an order'),
        h('span', h('b', `${f.weeks} wk`), ' to build'),
        h('span', h('b', `${f.b.batch}`), ` ${f.b.unit}`)),
      h('div.dc-actions',
        h('button.btn.small.primary', { disabled: Boolean(f.st.locked.length), title: f.st.locked.length ? `Not yet: ${f.st.locked.join('; ')}` : null, onclick: () => orderDialog(ctx, d) }, 'Build…'),
        h('button.btn.small', { onclick: edit }, d.built ? 'Improve' : 'Edit'),
        h('button.btn.small.ghost.dc-delete', { 'aria-label': `Delete ${d.name}`, title: 'Delete', onclick: async () => {
          if (await confirmBox(`Delete ${d.name}?`, 'Units already built stay in service.', { ok: 'Delete' })) await ctx.send({ type: 'designDelete', id: d.id });
        } }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: 'M4 7h16 M9 7V4.5h6V7 M6.5 7l1 13h9l1-13 M10 11v6 M14 11v6' }))))));
}

// The parts a new design starts with: the standard part in each slot, or the nearest one we can already build
function startingParts(kind, tech) {
  const parts = defaultParts(kind);
  for (const [slot, def] of Object.entries(DESIGN_KINDS[kind].slots)) {
    const ok = (key) => { const o = def.options[key]; return !o.tech || (tech?.[o.tech[0]] ?? 0) >= o.tech[1]; };
    if (!ok(parts[slot])) parts[slot] = Object.keys(def.options).find(ok) ?? parts[slot];
  }
  return parts;
}

/* ---------- The bureau ---------- */

// Open the bureau. design: an existing design to edit (its kind and parts), or a kind to start a new one of.
export function openDesigner(ctx, { kind = 'tanks', design = null } = {}) {
  const root = document.getElementById('game');
  document.querySelector('.design-studio')?.remove();
  const fresh = (k) => ({ kind: k, parts: startingParts(k, ctx.state.you.tech), name: '', id: null, from: null });
  const load = (d) => ({ kind: d.kind, parts: { ...d.parts }, name: d.built ? `${d.name} II` : d.name, id: d.built ? null : d.id, from: d.id });
  let st = design ? load(design) : fresh(kind);
  const el = h('div.design-studio', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Design bureau' });
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.getElementById('modal')?.open) close(); };
  document.addEventListener('keydown', onKey);

  const render = () => {
    // Keep where each column was scrolled to and what had focus: every change redraws the bureau
    const scrolls = [...el.querySelectorAll('[data-keep-scroll]')].map((n) => [n.dataset.keepScroll, n.scrollTop]);
    const focused = document.activeElement?.dataset?.focusKey;

    const me = ctx.state.you;
    const k = DESIGN_KINDS[st.kind];
    const stats = designStats(st.kind, st.parts, me.tech);
    const b = BUILD[st.kind];
    const mine = Object.values(me.designs ?? {});
    const each = b.cost * stats.cost * costFactor(me);
    const weeks = Math.max(1, Math.round(b.weeks * stats.weeks));
    const editing = st.id ? me.designs?.[st.id] : null;

    const title = h('b.tb-name', st.name.trim() || 'Unnamed design');
    const nameIn = h('input.ds-name', {
      type: 'text', maxlength: 40, value: st.name, 'aria-label': 'Design name', 'data-focus-key': 'name',
      placeholder: `Name your ${k.name.toLowerCase()} (e.g. ${EXAMPLE[st.kind]})`,
      oninput: (e) => { st.name = e.target.value; title.textContent = st.name.trim() || 'Unnamed design'; },
      onkeydown: (e) => { if (e.key === 'Enter' && !stats.locked.length) save(false); },
    });
    const save = async (order) => {
      if (!st.name.trim()) { ctx.toast('Give the design a name first.', 'warn'); nameIn.focus(); return; }
      const err = await ctx.send({ type: 'designSave', kind: st.kind, name: st.name, parts: st.parts, id: st.id ?? undefined });
      if (err) return;
      ctx.toast(`${st.name.trim()} saved${st.id ? '' : ' to our designs'}.`, 'good');
      const saved = Object.values(ctx.state.you.designs ?? {}).find((d) => d.name.toLowerCase() === st.name.trim().toLowerCase());
      if (saved) { st.id = saved.built > 0 ? null : saved.id; st.from = saved.id; }
      if (order && saved) orderDialog(ctx, saved);
      render();
    };
    const spec = blueprintSpec(st.kind, st.parts);
    const status = editing ? 'Saved · not built yet' : st.from && me.designs?.[st.from]?.built ? `Improving ${me.designs[st.from].name}` : 'Draft';

    el.replaceChildren(
      h('header.ds-head',
        h('div.ds-title', h('h2', 'Design bureau'), h('span.muted.small', `${mine.length} of ${MAX_DESIGNS} designs saved`)),
        h('div.ds-kinds', { role: 'group', 'aria-label': 'What to design' }, Object.keys(DESIGN_KINDS).map((key) => h('button.ds-kind', {
          type: 'button', 'aria-pressed': String(key === st.kind), title: DESIGN_KINDS[key].name, 'data-focus-key': `kind-${key}`,
          onclick: () => { if (key !== st.kind) { st = fresh(key); render(); } },
        }, kindIcon(key), h('span', SHORT[key])))),
        h('button.icon-btn.ds-close', { type: 'button', 'aria-label': 'Close the design bureau', title: 'Close (Esc)', onclick: close }, '✕')),
      h('div.ds-body',
        // The drawing, its figures, and saving it
        h('section.ds-main', { 'data-keep-scroll': 'main' },
          h('figure.ds-stage.bp-frame',
            h('div.ds-stage-art', blueprint(st.kind, st.parts, { dims: true })),
            h('figcaption.titleblock',
              h('div.tb-cell.tb-main', h('span', 'Designation'), title),
              h('div.tb-cell', h('span', 'Class'), h('b', spec.caption)),
              h('div.tb-cell', h('span', spec.span ? 'Length · span' : 'Length'), h('b.mono', spec.span ? `${spec.length} m · ${spec.span} m` : `${spec.length} m`)),
              h('div.tb-cell', h('span', 'Status'), h('b', status)))),
          h('div.ds-spec',
            h('div.ds-card.ds-perf',
              h('div.ds-card-head', h('h3', 'Performance'), h('span.faint.small', 'line = the standard model')),
              h('div.axes', axisRows(st.kind, stats.axes))),
            h('div.ds-figures',
              h('div.ds-fig.ds-fig-rating', h('span', 'Rating'), h('b', { class: stats.edge > 1.005 ? 'good' : stats.edge < 0.995 ? 'bad' : '' }, `×${stats.edge.toFixed(2)}`),
                h('small', stats.edge > 1.005 ? 'better than the standard model' : stats.edge < 0.995 ? 'worse than the standard model' : 'the standard model')),
              h('div.ds-fig', h('span', 'Cost per order'), h('b', money(each)), h('small', `${b.batch} ${b.unit} · ×${stats.cost.toFixed(2)} the standard`)),
              h('div.ds-fig', h('span', 'Build time'), h('b', `${weeks} weeks`), h('small', `the standard takes ${b.weeks}`)))),
          h('p.ds-note', ratingNote(st.kind)),
          stats.locked.length ? h('div.warning.bad', `Needs more research before it can be saved: ${stats.locked.join('; ')}.`) : null,
          h('div.ds-save', nameIn,
            h('div.ds-save-btns',
              h('button.btn', { disabled: Boolean(stats.locked.length), onclick: () => save(false) }, st.id ? 'Save changes' : 'Save design'),
              h('button.btn.primary', { disabled: Boolean(stats.locked.length), onclick: () => save(true) }, 'Save & build…')))),
        // The parts, slot by slot
        h('aside.ds-parts', { 'data-keep-scroll': 'parts', 'aria-label': 'Parts' },
          Object.entries(k.slots).map(([slot, def]) => {
            const chosen = def.options[st.parts[slot]];
            return h('section.ds-slot',
              h('div.ds-slot-head', h('h3', def.name), h('span', chosen?.name ?? '')),
              h('div.ds-options', { role: 'group', 'aria-label': def.name }, Object.entries(def.options).map(([key, o]) => {
                const have = o.tech ? (me.tech?.[o.tech[0]] ?? 0) : 0;
                const lock = o.tech && have < o.tech[1];
                return h('button.ds-option', {
                  type: 'button', 'aria-pressed': String(st.parts[slot] === key), class: lock ? 'locked' : '', 'data-focus-key': `${slot}-${key}`,
                  title: lock ? `Needs ${TECH_FIELDS[o.tech[0]].name} level ${o.tech[1]} (we have ${have})` : null,
                  onclick: () => { st.parts[slot] = key; render(); },
                },
                h('span.opt-top', h('i.opt-radio', { 'aria-hidden': 'true' }), h('b', o.name),
                  lock ? h('span.chip.warn.opt-lock', `🔒 ${TECH_FIELDS[o.tech[0]].name} ${o.tech[1]}`) : null),
                h('span.opt-note', o.note),
                h('span.opt-fx', partEffects(k.axes, o)));
              })));
          })),
        // Our designs
        h('aside.ds-side', { 'data-keep-scroll': 'side', 'aria-label': 'Our designs' },
          h('div.ds-side-head', h('h3', 'Our designs'), h('span.chip', String(mine.length)),
            h('button.btn.small.ghost', { style: { marginLeft: 'auto' }, onclick: () => { st = fresh(st.kind); render(); } }, '＋ New')),
          mine.length ? h('div.ds-list', mine.map((d) => designCard(ctx, d, {
            compact: true, current: d.id === st.from,
            onEdit: () => { st = load(d); render(); },
          }))) : h('div.ds-empty', kindIcon(st.kind), h('p', 'No designs yet.'), h('p.faint.small', 'Pick a part in each slot, name the design and save it. It appears here, ready to build.')))));

    for (const [key, top] of scrolls) { const n = el.querySelector(`[data-keep-scroll="${key}"]`); if (n) n.scrollTop = top; }
    if (focused) el.querySelector(`[data-focus-key="${focused}"]`)?.focus({ preventScroll: true });
  };
  // A design deleted from the list: redraw without it
  el.addEventListener('click', (e) => { if (e.target.closest('.dc-delete')) setTimeout(() => { if (st.from && !ctx.state.you.designs?.[st.from]) { st.from = null; st.id = null; } if (el.isConnected) render(); }, 350); });
  render();
  root.append(el);
}

// What a part changes: green for better, red for worse, amber for dearer or slower
function partEffects(axes, o) {
  const bits = o.axes.map((v, i) => (v ? h('span.fx', { class: v > 0 ? 'up' : 'down' }, `${sign(v)} ${axes[i].toLowerCase()}`) : null)).filter(Boolean);
  if (o.cost !== 1) bits.push(h('span.fx', { class: o.cost > 1 ? 'cost' : 'up' }, `cost ×${o.cost}`));
  if (o.weeks !== 1) bits.push(h('span.fx', { class: o.weeks > 1 ? 'cost' : 'up' }, `time ×${o.weeks}`));
  return bits.length ? bits : [h('span.fx', 'standard')];
}

function ratingNote(kind) {
  return {
    tanks: 'The rating multiplies what every tank of ours is worth in battle, in proportion to how many are built to this design.',
    vehicles: 'Vehicles make armies march faster and keep them supplied: full effect at ten for every thousand troops. The rating scales that effect.',
    aircraft: 'The rating multiplies the quality of our air force: air campaigns, air superiority over battles and cutting supply lines.',
    ships: 'The rating multiplies the strength of our fleets in battle, on blockades and against cargoes.',
  }[kind];
}

// Order the factories to build a design
export function orderDialog(ctx, d) {
  const s = ctx.state;
  const me = s.you;
  const b = BUILD[d.kind];
  const st = designStats(d.kind, d.parts);
  const coast = ORDER.some((id) => GEO[id]?.coast && s.regions[ctx.regionIndex[id]]?.[1] === s.me);
  const noLine = lineProblem(me, d.kind, coast);
  const each = b.cost * st.cost * costFactor(me);
  const tooling = !noLine && !hasLine(me, d.kind) ? b.cost * costFactor(me) * (LINE_SETUP - 1) : 0;
  const batches = h('input', { type: 'number', min: 1, max: 20, step: 1, value: 1 });
  const total = h('b');
  const upd = () => { total.textContent = money(each * Math.max(1, Number(batches.value) || 1) + tooling); };
  batches.addEventListener('input', upd);
  upd();
  modal({
    title: `Build ${d.name}`,
    body: h('div.stack',
      noLine ? h('div.warning.bad', noLine) : null,
      h('p', `${b.batch} ${b.unit} per order, ${Math.max(1, Math.round(b.weeks * st.weeks))} weeks each, ${money(each)} an order. Rating ×${st.edge.toFixed(2)}.`),
      tooling ? h('p.muted.small', `We have never built ${b.name.toLowerCase()}: the first order also pays ${money(tooling)} to set up the factories.`) : null,
      h('label.field', h('span', 'Orders'), batches),
      h('p', 'Total: ', total, h('span.muted.small', ` (defence funds ${money(me.milFunds)}, reserves ${money(me.treasury)})`))),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Order', kind: 'primary', disabled: Boolean(noLine), onClick: async () => {
      const err = await ctx.send({ type: 'build', kind: d.kind, batches: Math.max(1, Math.min(20, Number(batches.value) || 1)), design: d.id });
      if (!err) ctx.toast(`The factories are building ${d.name}.`, 'good');
      return !err || false;
    } }],
  });
}

/* ---------- The blueprint ---------- */

// The drawings below are made of rectangles, circles and paths; while one is drawn, every point it touches is
// recorded, so the whole drawing can be measured and fitted inside its frame however long the gun or the hull
let box = null;
const grow = (x, y) => { if (box) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); } };
function trackPath(d) {
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLQmlq])([^MLQZmlqz]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    if (cmd === 'q') { for (let i = 0; i + 3 < n.length; i += 4) { grow(x + n[i], y + n[i + 1]); x += n[i + 2]; y += n[i + 3]; grow(x, y); } continue; }
    for (let i = 0; i + 1 < n.length; i += 2) {
      x = rel ? x + n[i] : n[i];
      y = rel ? y + n[i + 1] : n[i + 1];
      grow(x, y);
    }
  }
}

const DRAW = { tanks: tank, vehicles: vehicle, aircraft: plane, ships: ship };
function drawn(kind, p) {
  box = [Infinity, Infinity, -Infinity, -Infinity];
  const nodes = DRAW[kind](p);
  const [x0, y0, x1, y1] = box;
  box = null;
  return { nodes, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const CAPTION = {
  tanks: (p) => `${({ light: 'Light', medium: 'Medium', heavy: 'Heavy' })[p.hull] ?? 'Medium'} tank · ${({ g90: '90', g105: '105', g120: '120', g130: '130' })[p.gun] ?? '105'} mm`,
  vehicles: (p) => `${({ truck: 'Logistics truck', apc: 'Armoured carrier', ifv: 'Infantry fighting vehicle', mrap: 'Mine-protected vehicle' })[p.role] ?? 'Armoured carrier'} · ${p.drive === 'tracks' ? 'tracked' : 'wheeled'}`,
  aircraft: (p) => `${({ fighter: 'Air superiority fighter', multirole: 'Multirole fighter', attack: 'Ground-attack aircraft', bomber: 'Bomber' })[p.role] ?? 'Multirole fighter'} · ${({ swept: 'swept wing', delta: 'delta canard', stealth: 'stealth' })[p.airframe] ?? 'swept wing'}`,
  ships: (p) => `${({ corvette: 'Corvette', frigate: 'Frigate', destroyer: 'Destroyer', cruiser: 'Cruiser' })[p.hull] ?? 'Frigate'} · ${({ diesel: 'diesel', turbine: 'gas turbine', nuclear: 'nuclear' })[p.propulsion] ?? 'diesel'}`,
};

// What the drawing shows, in words and metres (a drawing unit is a few centimetres on a tank, half a metre on a ship)
export function blueprintSpec(kind, p) {
  const d = drawn(kind, p);
  const r = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  if (kind === 'aircraft') {
    const big = p.role === 'bomber';
    const f = big ? 0.15 : 0.072;
    return { caption: CAPTION.aircraft(p), view: 'Plan view', length: r((big ? 300 : 250) * f), span: r((big ? 180 : 144) * f) };
  }
  if (kind === 'ships') return { caption: CAPTION.ships(p), view: 'Side elevation', length: r(({ corvette: 200, frigate: 260, destroyer: 300, cruiser: 340 }[p.hull] ?? 260) * 0.5) };
  return { caption: CAPTION[kind](p), view: 'Side elevation', length: r(d.w * (kind === 'tanks' ? 0.034 : 0.03)) };
}

// A side view (a top view for aircraft) drawn from the parts, in white on blueprint blue, always whole inside its frame.
// dims: a dimension line under the drawing.
export function blueprint(kind, p, { small = false, dims = false } = {}) {
  const W = 400;
  const H = 220;
  const d = drawn(kind, p);
  const pad = small ? 14 : 20;
  const below = dims ? 24 : 0;
  const sc = Math.min(small ? 1.12 : 1.3, (W - 2 * pad) / d.w, (H - 2 * pad - below) / d.h);
  const cx = W / 2;
  const cy = pad + (H - 2 * pad - below) / 2;
  const out = [svg('g', { class: 'bp', transform: `translate(${cx} ${cy}) scale(${sc}) translate(${-(d.x + d.w / 2)} ${-(d.y + d.h / 2)})` }, ...d.nodes)];
  if (dims) {
    const x0 = cx - (d.w * sc) / 2;
    const x1 = cx + (d.w * sc) / 2;
    const y = Math.min(H - 10, cy + (d.h * sc) / 2 + 14);
    out.push(svg('g', { class: 'bp-dims' },
      svg('path', { d: `M${x0} ${y - 12}V${y + 5} M${x1} ${y - 12}V${y + 5}`, class: 'bp-ext' }),
      svg('path', { d: `M${x0} ${y}H${x1} M${x0 + 6} ${y - 3}L${x0} ${y}L${x0 + 6} ${y + 3} M${x1 - 6} ${y - 3}L${x1} ${y}L${x1 - 6} ${y + 3}` })));
  }
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', class: `blueprint${small ? ' small' : ''}`, role: 'img', 'aria-label': `Blueprint: ${CAPTION[kind](p)}` }, ...out);
}

// The blueprint on its grid, with a caption strip
export function blueprintFrame(kind, p, { small = false } = {}) {
  const spec = blueprintSpec(kind, p);
  return h('figure.bp-frame', { class: small ? 'small' : '' },
    blueprint(kind, p, { small }),
    h('figcaption.bp-cap', h('span', spec.caption), h('span.mono', spec.span ? `${spec.length} × ${spec.span} m` : `${spec.length} m`)));
}

const R = (x, y, w, hh, rx = 0, cls = '') => { grow(x, y); grow(x + w, y + hh); return svg('rect', { x, y, width: w, height: hh, rx, class: cls }); };
const P = (d, cls = '') => { trackPath(d); return svg('path', { d, class: cls }); };
const C = (cx, cy, r, cls = '') => { grow(cx - r, cy - r); grow(cx + r, cy + r); return svg('circle', { cx, cy, r, class: cls }); };
const T = (x, y, text) => { grow(x, y - 11); grow(x + 9 * String(text).length, y + 2); return svg('text', { x, y, class: 'bp-note' }, text); };

function tank(p) {
  const len = { light: 190, medium: 220, heavy: 250 }[p.hull] ?? 220;
  const hh = { light: 30, medium: 36, heavy: 44 }[p.hull] ?? 36;
  const x0 = 200 - len / 2;
  const top = 150 - hh;
  const out = [];
  // Tracks and road wheels
  out.push(R(x0 - 6, 150, len + 12, 26, 13));
  const n = Math.round(len / 34);
  for (let i = 0; i < n; i++) out.push(C(x0 + 14 + i * ((len - 28) / (n - 1)), 163, 9, 'bp-thin'));
  // Hull, sloped glacis at the front (right)
  out.push(P(`M${x0} 150 L${x0} ${top + 6} L${x0 + len - 40} ${top} L${x0 + len + 8} ${top + hh * 0.55} L${x0 + len} 150 Z`));
  // Turret
  const tw = { light: 80, medium: 96, heavy: 110 }[p.hull] ?? 96;
  const tx = x0 + len * 0.36;
  const th = hh * 0.8;
  out.push(P(`M${tx} ${top} L${tx + 6} ${top - th} L${tx + tw - 10} ${top - th} L${tx + tw + 12} ${top - th * 0.45} L${tx + tw} ${top} Z`));
  if (p.extras === 'autoloader') out.push(R(tx - 22, top - th + 4, 24, th - 8, 3));
  // Gun
  const gl = { g90: 90, g105: 115, g120: 140, g130: 160 }[p.gun] ?? 115;
  const gw = { g90: 5, g105: 6, g120: 7, g130: 8 }[p.gun] ?? 6;
  out.push(R(tx + tw + 8, top - th * 0.62 - gw / 2, gl, gw, 1));
  out.push(R(tx + tw + 8 + gl * 0.55, top - th * 0.62 - gw / 2 - 1.5, 14, gw + 3, 2, 'bp-thin'));
  // Armour
  if (p.armour === 'composite' || p.armour === 'era' || p.armour === 'aps') out.push(P(`M${x0 + len - 36} ${top + 3} L${x0 + len + 4} ${top + hh * 0.55}`, 'bp-thin'));
  if (p.armour === 'era' || p.armour === 'aps') for (let i = 0; i < 5; i++) out.push(R(tx + 10 + i * 15, top - th + 6, 11, 8, 1, 'bp-thin'));
  if (p.armour === 'aps') { out.push(R(tx + tw * 0.45, top - th - 12, 18, 10, 2)); out.push(P(`M${tx + tw * 0.45 + 9} ${top - th - 12} l0 -10`, 'bp-thin')); }
  // Engine at the back
  if (p.engine === 'turbine') out.push(R(x0 - 14, top + 8, 14, 12, 2));
  else if (p.engine === 'hybrid') { out.push(R(x0 + 6, top + 8, 30, 14, 2, 'bp-thin')); out.push(P(`M${x0 + 16} ${top + 15} l6 -5 l0 10 l6 -5`, 'bp-thin')); }
  else out.push(P(`M${x0 + 8} ${top + 4} l0 -8 l10 0`, 'bp-thin'));
  // Systems
  if (p.extras === 'thermal') out.push(R(tx + tw - 26, top - th - 10, 16, 10, 2));
  if (p.extras === 'network') out.push(P(`M${tx + 20} ${top - th} l-6 -38`, 'bp-thin'), C(tx + 14, top - th - 40, 2.5));
  return out;
}

function vehicle(p) {
  const out = [];
  const wheels = p.drive !== 'tracks';
  if (p.role === 'truck') {
    out.push(R(80, 100, 170, 52, 3));
    out.push(P('M250 152 L250 92 L300 92 L318 120 L318 152 Z'));
    out.push(R(262, 98, 34, 20, 2, 'bp-thin'));
    for (const x of [110, 150, 280]) out.push(C(x, 160, 15), C(x, 160, 6, 'bp-thin'));
  } else {
    const tall = p.role === 'mrap' ? 18 : 0;
    const hullTop = 104 - tall;
    out.push(P(`M70 ${150} L70 ${hullTop + 10} L280 ${hullTop} L325 ${hullTop + 28} L320 150 ${p.role === 'mrap' ? 'L200 168' : ''} Z`));
    if (wheels) for (const x of [100, 150, 220, 275]) out.push(C(x, 160, 14), C(x, 160, 5, 'bp-thin'));
    else { out.push(R(64, 148, 266, 26, 13)); for (let i = 0; i < 6; i++) out.push(C(84 + i * 45, 161, 9, 'bp-thin')); }
    out.push(R(96, hullTop + 18, 22, 14, 2, 'bp-thin'), R(130, hullTop + 18, 22, 14, 2, 'bp-thin'));
    if (p.armour === 'heavy') out.push(P(`M78 ${hullTop + 40} L312 ${hullTop + 40}`, 'bp-thin'), P(`M78 ${hullTop + 46} L312 ${hullTop + 46}`, 'bp-thin'));
    if (p.armour === 'medium') out.push(P(`M78 ${hullTop + 42} L312 ${hullTop + 42}`, 'bp-thin'));
    const wy = hullTop - 2;
    if (p.weapon === 'mg') out.push(R(220, wy - 10, 14, 10, 2), R(234, wy - 7, 34, 3));
    if (p.weapon === 'cannon' || p.role === 'ifv') out.push(R(200, wy - 22, 54, 22, 4), R(254, wy - 14, 64, 5, 1));
    if (p.weapon === 'atgm') out.push(R(170, wy - 20, 40, 16, 3), R(176, wy - 26, 30, 6, 2, 'bp-thin'));
    if (p.weapon === 'drone') { out.push(R(150, wy - 16, 50, 14, 2)); out.push(P(`M150 ${wy - 34} l20 6 l20 -6 l-20 -4 Z`, 'bp-thin')); }
  }
  return out;
}

function plane(p) {
  const out = [];
  const big = p.role === 'bomber';
  const L = big ? 300 : 250;
  const nose = 200 - L / 2;
  // Top view, nose to the left
  const span = big ? 90 : 72;
  if (p.airframe === 'delta') out.push(P(`M${nose + 70} 110 L${nose + L - 40} ${110 - span} L${nose + L - 20} ${110 - span} L${nose + L - 30} 110 L${nose + L - 20} ${110 + span} L${nose + L - 40} ${110 + span} Z`));
  else if (p.airframe === 'stealth') out.push(P(`M${nose + 30} 110 L${nose + L - 70} ${110 - span} L${nose + L - 30} ${110 - span + 16} L${nose + L - 10} 110 L${nose + L - 30} ${110 + span - 16} L${nose + L - 70} ${110 + span} Z`));
  else out.push(P(`M${nose + 100} 102 L${nose + L - 70} ${110 - span} L${nose + L - 45} ${110 - span} L${nose + L - 60} 104 L${nose + L - 60} 116 L${nose + L - 45} ${110 + span} L${nose + L - 70} ${110 + span} L${nose + 100} 118 Z`));
  // Fuselage
  out.push(P(`M${nose} 110 Q${nose + 30} 96 ${nose + 60} 98 L${nose + L - 10} 100 L${nose + L} 110 L${nose + L - 10} 120 L${nose + 60} 122 Q${nose + 30} 124 ${nose} 110 Z`));
  out.push(P(`M${nose + 36} 106 Q${nose + 50} 104 ${nose + 62} 108 L${nose + 62} 112 Q${nose + 50} 116 ${nose + 36} 114 Z`, 'bp-thin'));
  // Tails
  if (p.airframe !== 'delta') out.push(P(`M${nose + L - 40} 100 L${nose + L - 8} 78 L${nose + L} 80 L${nose + L - 12} 104 Z M${nose + L - 40} 120 L${nose + L - 8} 142 L${nose + L} 140 L${nose + L - 12} 116 Z`, 'bp-thin'));
  // Engines
  const engines = p.engine === 'single' ? [110] : [103, 117];
  for (const y of engines) out.push(R(nose + L - 6, y - 4, 12, 8, 2));
  if (p.engine === 'supercruise') for (const y of engines) out.push(P(`M${nose + L + 6} ${y} l18 0`, 'bp-thin'));
  // Radar
  if (p.sensors !== 'pulse') out.push(C(nose + 16, 110, p.sensors === 'fusion' ? 7 : 5, 'bp-thin'));
  // Weapons under the wings
  const hard = p.airframe === 'stealth' ? [] : [-0.55, -0.3, 0.3, 0.55];
  for (const k of hard) {
    const y = 110 + k * span * 1.3;
    const x = nose + L * 0.52;
    if (p.weapons === 'bombs') out.push(C(x, y, 5));
    else if (p.weapons === 'guided') out.push(R(x - 12, y - 2.5, 24, 5, 2));
    else out.push(R(x - 20, y - 2.5, 40, 5, 2), P(`M${x + 20} ${y - 2.5} l5 2.5 l-5 2.5`, 'bp-thin'));
  }
  if (p.airframe === 'stealth') out.push(R(nose + L * 0.45, 104, 50, 12, 2, 'bp-thin'));
  return out;
}

function ship(p) {
  const out = [];
  const L = { corvette: 200, frigate: 260, destroyer: 300, cruiser: 340 }[p.hull] ?? 260;
  const x0 = 200 - L / 2;
  const deck = 120;
  // Hull, bow to the right
  out.push(P(`M${x0} ${deck} L${x0 + L} ${deck - 6} L${x0 + L - 26} ${deck + 34} L${x0 + 14} ${deck + 34} Z`));
  out.push(P(`M${x0 - 10} ${deck + 26} L${x0 + L + 10} ${deck + 26}`, 'bp-water'));
  // Superstructure
  const sx = x0 + L * 0.38;
  const sw = L * 0.26;
  out.push(R(sx, deck - 34, sw, 34, 2));
  out.push(R(sx + sw * 0.2, deck - 56, sw * 0.55, 22, 2));
  // Mast and radar
  const mx = sx + sw * 0.45;
  out.push(P(`M${mx} ${deck - 56} l0 -36`, 'bp-thin'));
  if (p.sensors === 'basic') out.push(R(mx - 14, deck - 94, 28, 4, 1));
  else { out.push(R(sx + sw * 0.25, deck - 54, 10, 14, 1, 'bp-thin'), R(sx + sw * 0.6, deck - 54, 10, 14, 1, 'bp-thin')); out.push(C(mx, deck - 94, 6, 'bp-thin')); }
  if (p.sensors === 'laser') out.push(R(sx + sw + 4, deck - 18, 14, 10, 2), P(`M${sx + sw + 18} ${deck - 13} l16 -10`, 'bp-thin'));
  // Funnel
  if (p.propulsion !== 'nuclear') out.push(P(`M${sx + sw + 10} ${deck} L${sx + sw + 14} ${deck - 30} L${sx + sw + 34} ${deck - 30} L${sx + sw + 36} ${deck} Z`, 'bp-thin'));
  else out.push(T(sx + sw + 8, deck - 6, '☢'));
  // Weapons forward
  const fx = x0 + L * 0.78;
  if (p.weapons === 'guns') out.push(R(fx - 14, deck - 16, 26, 12, 4), R(fx + 12, deck - 12, 34, 3));
  else {
    out.push(R(fx - 30, deck - 10, 50, 8, 1));
    for (let i = 0; i < 6; i++) out.push(P(`M${fx - 28 + i * 8} ${deck - 10} l0 8`, 'bp-thin'));
    out.push(R(fx + 26, deck - 16, 18, 10, 3), R(fx + 44, deck - 13, 20, 3));
    if (p.weapons === 'hypersonic') out.push(R(x0 + L * 0.2, deck - 14, 40, 8, 3), R(x0 + L * 0.2, deck - 24, 40, 8, 3));
  }
  // Stern deck
  if (p.deck === 'helo') { out.push(R(x0 + 10, deck - 4, 50, 4, 0, 'bp-thin')); out.push(T(x0 + 26, deck - 10, 'H')); out.push(R(x0 + 64, deck - 26, 30, 26, 2, 'bp-thin')); }
  if (p.deck === 'drones') { out.push(R(x0 + 10, deck - 4, 50, 4, 0, 'bp-thin')); out.push(P(`M${x0 + 20} ${deck - 18} l10 4 l10 -4 l-10 -3 Z M${x0 + 40} ${deck - 26} l10 4 l10 -4 l-10 -3 Z`, 'bp-thin')); }
  return out;
}
