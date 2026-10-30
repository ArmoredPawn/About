// Small helpers shared by every screen.

import { TIERS } from './shared.js';

export const $ = (id) => document.getElementById(id);

export function show(screen) {
  $('app').dataset.screen = screen;
  window.scrollTo(0, 0);
}

let toastTimer;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A coloured "Rare · +75" badge; no tier means no answer
export function tierBadge(el, tier) {
  el.dataset.tier = tier ?? 'miss';
  el.innerHTML = tier == null ? 'No answer · <b>0</b>' : `${TIERS[tier].label} · <b>+${TIERS[tier].points}</b>`;
}

export function picksHtml(examples) {
  if (!examples?.length) return '';
  return `Rarer picks: ${examples.map((e) => `<b>${escapeHtml(e.name)}</b> (${TIERS[e.tier].label})`).join(' · ')}`;
}

export function feedback(el, message, bad = false) {
  el.textContent = message;
  el.classList.toggle('bad', bad);
}

export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// The address people should open: the site page around the game when it's shown in a frame
export function pageUrl() {
  try {
    return window.top.location.href.split(/[?#]/)[0];
  } catch {
    return location.href.split(/[?#]/)[0];
  }
}

// The shrinking bar and seconds above the answer box
export class Countdown {
  constructor(wrap, fill, num) {
    this.wrap = wrap;
    this.fill = fill;
    this.num = num;
    this.end = 0;
    this.frame = 0;
    this.timeout = 0;
  }

  get expired() {
    return performance.now() >= this.end;
  }

  start(remainingMs, totalMs, onDone) {
    this.stop();
    this.end = performance.now() + remainingMs;
    this.total = totalMs;
    if (onDone) {
      this.timeout = setTimeout(() => {
        this.stop();
        this.fill.style.transform = 'scaleX(0)';
        this.num.textContent = '0';
        onDone();
      }, Math.max(0, remainingMs));
    }
    const tick = () => {
      const left = Math.max(0, this.end - performance.now());
      this.fill.style.transform = `scaleX(${left / this.total})`;
      this.num.textContent = Math.ceil(left / 1000);
      this.wrap.classList.toggle('low', left < 5000);
      if (left > 0) this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timeout);
  }
}
