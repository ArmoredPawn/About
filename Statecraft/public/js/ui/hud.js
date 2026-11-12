// The bar across the top: your country, the clock and the numbers that matter most.

import { $, h, flag, money, pct, tone } from './dom.js';

export function renderHud(ctx) {
  const s = ctx.state;
  const lobby = ctx.lobby;
  const me = s.you;
  const c = s.countries[s.me];
  const isHost = lobby?.hostId === lobby?.you;
  const total = s.years * 52;
  const speedNames = { slow: 'Slow', normal: 'Normal', fast: 'Fast', blitz: 'Blitz' };

  const clock = h('div.hud-clock',
    isHost && !s.over ? h('button.icon-btn', { title: s.paused ? 'Resume' : 'Pause', 'aria-label': s.paused ? 'Resume' : 'Pause', onclick: () => ctx.net.send({ type: 'pause', on: !s.paused }) }, s.paused ? '▶' : '❚❚') : null,
    h('div',
      h('div.date', s.date),
      h('div.progress', { title: `Week ${s.week} of ${total}` }, h('i', { style: { width: `${Math.min(100, (s.week / total) * 100)}%` } }))),
    isHost && !s.over
      ? h('select', { 'aria-label': 'Game speed', style: { width: 'auto', minHeight: '28px', padding: '2px 6px', fontSize: '12px' }, onchange: (e) => ctx.net.send({ type: 'speed', speed: e.target.value }) },
        (lobby.speeds ?? Object.keys(speedNames)).map((sp) => h('option', { value: sp, selected: sp === s.speed }, speedNames[sp] ?? sp)))
      : h('span.chip', s.paused ? 'Paused' : speedNames[s.speed] ?? ''),
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
