// Small DOM and formatting helpers shared by the interface.

import { COUNTRIES } from '../engine/data/countries.js';
import { REGION_NAMES } from '../engine/names.js';

export const $ = (id) => document.getElementById(id);

// h('div.card', { onclick }, child, 'text', [more]) builds an element
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

// Replaces an element's children, skipping empty slots (null, false)
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/* ---------- Names and flags ---------- */

export const regionName = (id) => REGION_NAMES[id] ?? id;

export function nationName(state, id) {
  if (!id) return '—';
  return state?.countries?.[id]?.name ?? state?.minors?.[id]?.name ?? COUNTRIES[id]?.name ?? regionName(id);
}

export function colorOf(id) {
  return COUNTRIES[id]?.color ?? '#5b6478';
}

export function flag(id, big = false) {
  const iso = COUNTRIES[id]?.iso2;
  if (!iso) {
    return h('span.flag', { class: big ? 'big' : '', style: { background: '#3a4152' }, 'aria-hidden': 'true' });
  }
  const img = h('img.flag', { class: big ? 'big' : '', src: `https://flagcdn.com/w80/${iso}.png`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => { img.replaceWith(h('span.flag', { class: big ? 'big' : '', style: { background: colorOf(id) } })); }, { once: true });
  return img;
}

/* ---------- Numbers ---------- */

export function money(b, digits) {
  if (b == null || Number.isNaN(b)) return '—';
  const sign = b < 0 ? '−' : '';
  const v = Math.abs(b);
  if (v >= 1000) return `${sign}$${(v / 1000).toFixed(digits ?? (v >= 10000 ? 1 : 2))}T`;
  if (v >= 10) return `${sign}$${v.toFixed(digits ?? 0)}B`;
  if (v >= 1) return `${sign}$${v.toFixed(digits ?? 1)}B`;
  return `${sign}$${Math.round(v * 1000)}M`;
}

export function pct(v, digits = 1, sign = false) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = sign && v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${Math.abs(v).toFixed(digits)}%`;
}

export function num(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function troops(k) {
  if (k == null) return '—';
  if (Math.abs(k) < 0.05) return '0';
  if (k >= 1000) return `${(k / 1000).toFixed(2)}M`;
  if (k >= 10) return `${Math.round(k)}K`;
  return `${k.toFixed(1)}K`;
}

export function people(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)}B`;
  if (m >= 10) return `${Math.round(m)}M`;
  if (m >= 1) return `${m.toFixed(1)}M`;
  return `${Math.round(m * 1000)}K`;
}

export function tone(v, good, bad) {
  if (v >= good) return 'good';
  if (v <= bad) return 'bad';
  return '';
}

// A tiny line chart
export function spark(values, color = 'var(--accent)') {
  const el = svg('svg', { class: 'spark', viewBox: '0 0 100 36', preserveAspectRatio: 'none' });
  if (!values || values.length < 2) return el;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${33 - ((v - min) / span) * 30}`);
  el.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }));
  return el;
}

export function bar(value, max = 100, kind = '') {
  return h('div.bar', { class: kind }, h('i', { style: { width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` } }));
}

export function relBar(v) {
  const w = Math.abs(v) / 2;
  const color = v >= 0 ? 'var(--good)' : 'var(--bad)';
  return h('span.relbar', { title: `Relations ${v > 0 ? '+' : ''}${v}` }, h('i', { style: { left: v >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: color } }));
}

export function timeAgo(t) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const RES_COLORS = {
  oil: '#e8a33c', gas: '#5ec3e6', coal: '#9a8f86', iron: '#d27a5c', food: '#9fd36b', rare: '#c08cff', uran: '#e4e65a', metal: '#f08ab8', chip: '#7ee0c8',
};
export const RES_LETTERS = { oil: 'O', gas: 'G', coal: 'C', iron: 'Fe', food: 'W', rare: 'RE', uran: 'U', metal: 'Cu', chip: 'Si' };
