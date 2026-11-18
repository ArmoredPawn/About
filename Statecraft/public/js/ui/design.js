// The design bureau: design our own tanks, armoured vehicles, combat aircraft and warships, part by part, on a
// blueprint that covers the map. Save and name a design, then order the factories to build it.

import { h, svg, money } from './dom.js';
import { DESIGN_KINDS, designStats, defaultParts, MAX_DESIGNS } from '../engine/designs.js';
import { BUILD, lineProblem, hasLine, LINE_SETUP } from '../engine/economy.js';
import { TECH_FIELDS } from '../engine/data/world.js';
import { GEO, ORDER } from '../engine/data/geo.js';
import { modal, confirmBox } from './dialogs.js';

const ICONS = { tanks: '🛡', vehicles: '🚚', aircraft: '✈', ships: '⚓' };
const costFactor = (c) => 0.45 + 0.55 * Math.min(1.2, (c.gdp / Math.max(0.01, c.pop)) / 60);

// Open the bureau. design: an existing design to edit (its kind and parts), or a kind to start a new one of.
export function openDesigner(ctx, { kind = 'tanks', design = null } = {}) {
  const s = ctx.state;
  const root = document.getElementById('game');
  document.querySelector('.design-studio')?.remove();
  let st = {
    kind: design?.kind ?? kind,
    parts: { ...(design?.parts ?? defaultParts(design?.kind ?? kind)) },
    name: design?.name ?? '',
    id: design && !(design.built > 0) ? design.id : null,
  };
  const el = h('div.design-studio', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Design bureau' });
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.getElementById('modal')?.open) close(); };
  document.addEventListener('keydown', onKey);

  const render = () => {
    const me = ctx.state.you;
    const k = DESIGN_KINDS[st.kind];
    const stats = designStats(st.kind, st.parts, me.tech);
    const b = BUILD[st.kind];
    const mine = Object.values(me.designs ?? {});
    const nameIn = h('input', { type: 'text', maxlength: 40, placeholder: `Name your ${k.name.toLowerCase()} (e.g. ${({ tanks: 'Leopard 3', vehicles: 'Mule 8x8', aircraft: 'Falcon II', ships: 'Sentinel class' })[st.kind]})`, value: st.name, oninput: (e) => { st.name = e.target.value; } });
    const save = async (order) => {
      const err = await ctx.send({ type: 'designSave', kind: st.kind, name: st.name, parts: st.parts, id: st.id ?? undefined });
      if (err) return;
      ctx.toast(`${st.name} saved${st.id ? '' : ' to our designs'}.`, 'good');
      const saved = Object.values(ctx.state.you.designs ?? {}).find((d) => d.name.toLowerCase() === st.name.trim().toLowerCase());
      if (saved) st.id = saved.built > 0 ? null : saved.id;
      if (order && saved) orderDialog(ctx, saved);
      render();
    };
    el.replaceChildren(
      h('header.ds-head',
        h('div', h('h2', 'Design bureau'), h('span.muted.small', `${mine.length}/${MAX_DESIGNS} designs · parts with a lock need more research`)),
        h('button.icon-btn.ds-close', { type: 'button', 'aria-label': 'Close the design bureau', onclick: close }, '✕')),
      h('div.ds-body',
        // What to design, and our designs
        h('aside.ds-side',
          h('div.ds-kinds', Object.entries(DESIGN_KINDS).map(([key, d]) => h('button.ds-kind', {
            'aria-pressed': String(key === st.kind),
            onclick: () => { if (key !== st.kind) { st = { kind: key, parts: defaultParts(key), name: '', id: null }; render(); } },
          }, h('span', { 'aria-hidden': 'true' }, ICONS[key]), d.name))),
          h('h3', 'Our designs'),
          mine.length ? h('div.ds-list', mine.map((d) => {
            const ds = designStats(d.kind, d.parts);
            return h('div.ds-saved', { class: d.id === st.id ? 'on' : '' },
              h('div.row.between', h('b', `${ICONS[d.kind]} ${d.name}`), h('span.mono.small', `×${ds.edge.toFixed(2)}`)),
              h('div.faint.small', `${DESIGN_KINDS[d.kind].name}${d.built ? ` · ${d.built.toLocaleString('en')} built` : ' · not built yet'}`),
              h('div.row.gap.small', { style: { marginTop: '6px' } },
                h('button.btn.small', { onclick: () => { st = { kind: d.kind, parts: { ...d.parts }, name: d.built ? `${d.name} II` : d.name, id: d.built ? null : d.id }; render(); } }, d.built ? 'Improve' : 'Edit'),
                h('button.btn.small.primary', { onclick: () => orderDialog(ctx, d) }, 'Build…'),
                h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Delete ${d.name}?`, 'Units already built stay in service.')) { await ctx.send({ type: 'designDelete', id: d.id }); if (st.id === d.id) st.id = null; render(); } } }, 'Delete')));
          })) : h('p.muted.small', 'None yet. Pick parts on the right, name the design and save it.')),
        // The blueprint and its figures
        h('section.ds-main',
          h('div.ds-blueprint', blueprint(st.kind, st.parts)),
          h('div.ds-stats',
            ...k.axes.map((label, i) => h('div.ds-stat', h('span', label), h('div.ds-bar', h('i', { style: { width: `${stats.axes[i] * 10}%` } })), h('b.mono', stats.axes[i].toFixed(1)))),
            h('div.ds-figures',
              h('div.kpi', h('span', 'Rating'), h('b', `×${stats.edge.toFixed(2)}`), h('small', stats.edge >= 1 ? 'better than the standard model' : 'worse than the standard model')),
              h('div.kpi', h('span', 'Cost per order'), h('b', money(b.cost * stats.cost * costFactor(me))), h('small', `${b.batch} ${b.unit}, ×${stats.cost.toFixed(2)} the standard`)),
              h('div.kpi', h('span', 'Build time'), h('b', `${Math.max(1, Math.round(b.weeks * stats.weeks))} wk`), h('small', `standard ${b.weeks} weeks`))),
            h('p.muted.small', ratingNote(st.kind)),
            stats.locked.length ? h('div.warning.bad', `Not yet: ${stats.locked.join('; ')}.`) : null),
          h('div.ds-save', nameIn,
            h('button.btn', { disabled: Boolean(stats.locked.length), onclick: () => save(false) }, st.id ? 'Save changes' : 'Save design'),
            h('button.btn.primary', { disabled: Boolean(stats.locked.length), onclick: () => save(true) }, 'Save & build…'))),
        // The parts
        h('aside.ds-parts', Object.entries(k.slots).map(([slot, def]) => h('div.ds-slot',
          h('h3', def.name),
          h('div.ds-options', Object.entries(def.options).map(([key, o]) => {
            const lock = o.tech && (me.tech?.[o.tech[0]] ?? 0) < o.tech[1];
            return h('button.ds-option', {
              type: 'button', 'aria-pressed': String(st.parts[slot] === key), class: lock ? 'locked' : '',
              title: lock ? `Needs ${TECH_FIELDS[o.tech[0]].name} level ${o.tech[1]} (we have ${me.tech?.[o.tech[0]] ?? 0})` : o.note,
              onclick: () => { st.parts[slot] = key; render(); },
            }, h('b', `${lock ? '🔒 ' : ''}${o.name}`), h('span', o.note), h('span.faint', partDelta(k.axes, o)));
          })))))));
  };
  render();
  root.append(el);
}

function partDelta(axes, o) {
  const bits = o.axes.map((v, i) => (v ? `${v > 0 ? '+' : ''}${v} ${axes[i].toLowerCase()}` : null)).filter(Boolean);
  if (o.cost !== 1) bits.push(`cost ×${o.cost}`);
  return bits.join(' · ') || 'standard';
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

// A side view (a top view for aircraft) drawn from the parts, in white on blueprint blue
export function blueprint(kind, p, { small = false } = {}) {
  const draw = { tanks: tank, vehicles: vehicle, aircraft: plane, ships: ship }[kind];
  return svg('svg', { viewBox: '0 0 400 220', class: `blueprint${small ? ' small' : ''}`, role: 'img', 'aria-label': `Blueprint of the ${DESIGN_KINDS[kind].name.toLowerCase()}` },
    svg('defs', {}, svg('pattern', { id: 'bp-grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, svg('path', { d: 'M20 0H0V20', fill: 'none', class: 'bp-grid' }))),
    svg('rect', { x: 0, y: 0, width: 400, height: 220, fill: 'url(#bp-grid)' }),
    svg('g', { class: 'bp' }, ...draw(p)));
}

const R = (x, y, w, hh, rx = 0, cls = '') => svg('rect', { x, y, width: w, height: hh, rx, class: cls });
const P = (d, cls = '') => svg('path', { d, class: cls });
const C = (cx, cy, r, cls = '') => svg('circle', { cx, cy, r, class: cls });
const T = (x, y, text) => svg('text', { x, y, class: 'bp-note' }, text);

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
  out.push(T(14, 206, `${{ light: 'Light', medium: 'Medium', heavy: 'Heavy' }[p.hull]} tank · ${({ g90: '90', g105: '105', g120: '120', g130: '130' })[p.gun]} mm`));
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
  out.push(T(14, 206, `${({ truck: 'Logistics truck', apc: 'Armoured carrier', ifv: 'Infantry fighting vehicle', mrap: 'Mine-protected vehicle' })[p.role]} · ${p.drive === 'tracks' ? 'tracked' : 'wheeled'}`));
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
  out.push(T(14, 206, `${({ fighter: 'Air superiority fighter', multirole: 'Multirole fighter', attack: 'Ground-attack aircraft', bomber: 'Bomber' })[p.role]} · ${({ swept: 'swept wing', delta: 'delta canard', stealth: 'stealth' })[p.airframe]}`));
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
  out.push(T(14, 206, `${({ corvette: 'Corvette', frigate: 'Frigate', destroyer: 'Destroyer', cruiser: 'Cruiser' })[p.hull]} · ${({ diesel: 'diesel', turbine: 'gas turbine', nuclear: 'nuclear' })[p.propulsion]}`));
  return out;
}
