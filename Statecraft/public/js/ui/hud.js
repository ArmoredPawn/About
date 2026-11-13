// The bar across the top: your country, the clock and the numbers that matter most.

import { $, h, flag, money, pct, tone } from './dom.js';
import { START, WEEK_MS } from '../engine/core.js';

export function renderHud(ctx) {
  const s = ctx.state;
  const lobby = ctx.lobby;
  const me = s.you;
  const c = s.countries[s.me];
  // No time limit, so the bar under the date shows how much of the world you hold
  const held = s.ranks.find((r) => r.id === s.me)?.provinces ?? 0;
  const share = s.provinces ? (held / s.provinces) * 100 : 0;

  // The world runs in real time: no pause, no speed control. The date ticks forward day by day.
  const clock = h('div.hud-clock',
    h('span.live-dot', { title: 'Live: the world keeps moving' }),
    h('div',
      h('div.date', { id: 'hud-date' }, liveDate(s, ctx.tickAge?.() ?? 0)),
      h('div.progress', { title: `Week ${s.week} · you hold ${held} of ${s.provinces} provinces (${share.toFixed(1)}% of the world)` }, h('i', { style: { width: `${Math.min(100, share)}%` } }))),
  );

  const stats = me ? h('div.hud-stats',
    stat(money(me.gdp), 'GDP'),
    stat(pct(me.growth, 1, true), 'Growth', tone(me.growth, 2, 0)),
    stat(pct(me.infl), 'Inflation', me.infl > 8 ? 'bad' : me.infl > 4 ? 'warn' : ''),
    stat(money(me.treasury), 'Reserves', me.treasury < me.gdp * 0.005 ? 'warn' : ''),
    stat(`${Math.round(me.debtRatio)}%`, 'Debt/GDP', me.debtRatio > 120 ? 'warn' : ''),
    stat(`${Math.round(me.approval)}%`, 'Approval', tone(me.approval, 50, 30)),
    stat(`${Math.round(me.stability)}`, 'Stability', tone(me.stability, 60, 30)),
    stat(`#${s.ranks.find((r) => r.id === s.me)?.rank ?? '—'}`, 'Power rank'),
  ) : h('div.hud-stats');

  const unread = ctx.chatUnread();
  const actions = h('div.hud-actions',
    h('button.btn.small.rel', { onclick: () => ctx.toggleChat(), title: 'Diplomatic channels' }, '💬 Chat', unread ? h('span.badge', unread > 99 ? '99+' : String(unread)) : null),
    h('button.btn.small.ghost', { onclick: () => $('help').showModal(), title: 'How to play' }, '?'),
    h('button.btn.small.ghost', { onclick: () => ctx.leave(), title: 'Leave the game' }, 'Leave'),
  );

  $('hud').replaceChildren(
    h('div.hud-country', flag(s.me, true), h('div.names', h('strong', c?.name ?? 'Observer'), h('span', me ? `${c.title} ${ctx.myName}` + (me.exile ? ' · in exile' : '') : 'Watching'))),
    clock, stats, actions,
  );
}

function stat(value, label, cls = '') {
  return h('div.stat', h('b', { class: cls }, value), h('span', label));
}

// The date part-way through the current week: frac is 0 when the week begins, 1 when the next one is due
export function liveDate(s, frac) {
  const d = new Date(START + (s.week + Math.max(0, Math.min(0.999, frac))) * WEEK_MS);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
