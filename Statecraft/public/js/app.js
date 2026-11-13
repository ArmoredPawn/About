// Statecraft's interface: menus, the lobby, the situation room and the final verdict.

import { $, h, flag, money, pct, nationName, regionName, colorOf, RES_COLORS, RES_LETTERS } from './ui/dom.js';
import { RemoteLink, LocalLink, hasSavedRoom, loadSolo, clearSolo, serverBase } from './net.js';
import { WorldMap, INDEX, CAPITALS } from './ui/map.js';
import { renderHud, liveDate } from './ui/hud.js';
import { Chat } from './ui/chat.js';
import { toast, confirmBox, closeModal } from './ui/dialogs.js';
import { showRegion, showArmy, closeInspector, airStrike, missile } from './ui/inspector.js';
import { overview } from './ui/panels/overview.js';
import { economy } from './ui/panels/economy.js';
import { military } from './ui/panels/military.js';
import { diplomacy } from './ui/panels/diplomacy.js';
import { research } from './ui/panels/research.js';
import { world } from './ui/panels/world.js';
import { government } from './ui/panels/government.js';
import { market } from './ui/panels/market.js';
import { spies } from './ui/panels/spies.js';
import { news } from './ui/panels/news.js';
import { SPEEDS } from './engine/room.js';
import { rangeProblem } from './engine/science.js';
import { RESOURCES, RESOURCE_INFO } from './engine/data/regions.js';
import { GEO } from './engine/data/geo.js';
import { route } from './engine/military.js';
import { fauxState } from './ui/map.js';
import { sendArmy, canGo, goBlocker, goPath } from './ui/attack.js';

const NAME_KEY = 'statecraft.name';
const TABS = [
  ['overview', 'Cabinet', '<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6"/>', overview],
  ['government', 'Govern', '<path d="M12 3v3M5 21V11h14v10M3 21h18M8 11V8h8v3"/><path d="M10 21v-5h4v5"/>', government],
  ['economy', 'Economy', '<path d="M3 20h18M6 16V9M11 16V5M16 16v-5M21 16V8"/>', economy],
  ['market', 'Market', '<path d="M3 9l2-5h14l2 5M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v8h14v-8"/>', market],
  ['military', 'Military', '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>', military],
  ['diplomacy', 'Diplomacy', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3 3-4 6-4 9s1 6 4 9M12 3c3 3 4 6 4 9s-1 6-4 9"/>', diplomacy],
  ['spies', 'Spies', '<circle cx="8" cy="15" r="3"/><circle cx="16" cy="15" r="3"/><path d="M11 15h2M3 10h18M6 10l2-6h8l2 6"/>', spies],
  ['research', 'Research', '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>', research],
  ['news', 'News', '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h4"/>', news],
  ['world', 'World', '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>', world],
];
const MODES = [['political', 'Political'], ['alliances', 'Blocs'], ['resources', 'Resources'], ['economy', 'Economy'], ['relations', 'Relations']];

const app = {
  net: null,
  screen: 'menu',
  state: null,
  lobby: null,
  myName: '',
  solo: false,
  tab: 'overview',
  subs: {},
  ui: {},
  drafts: {},
  req: 0,
  pending: new Map(),
  selection: null,
  panelBusy: false,
  panelDirty: false,
  finalShown: false,
  focused: false,
  newsLog: new Map(),
  lastTick: 0,
  tickMs: SPEEDS.normal,
};

/* ---------- The context handed to every panel ---------- */

const ctx = {
  get state() { return app.state; },
  get lobby() { return app.lobby; },
  get net() { return app.net; },
  get myName() { return app.myName; },
  get screen() { return app.screen; },
  get ui() { return app.ui; },
  regionIndex: INDEX,
  chat: null,
  send(cmd) {
    return new Promise((resolve) => {
      const req = ++app.req;
      app.pending.set(req, resolve);
      app.net.send({ type: 'cmd', req, cmd });
      setTimeout(() => { if (app.pending.delete(req)) resolve('No answer from the server.'); }, 15000);
    });
  },
  sub: (tab, fallback) => app.subs[tab] ?? fallback,
  setSub(tab, sub) { app.subs[tab] = sub; renderPanel(true); },
  draft(key, init) { return (app.drafts[key] ??= init()); },
  clearDraft(key) { delete app.drafts[key]; },
  rerender: () => renderPanel(true),
  go(tab, sub) { app.tab = tab; if (sub) app.subs[tab] = sub; if (tab !== 'diplomacy') app.ui.dossier = null; openPanel(); renderRail(); renderPanel(true); },
  openCountry(id) { app.ui.dossier = id; ctx.go('diplomacy'); },
  openRegion(id, focus) { selectRegion(id); if (focus) map.focus([id]); },
  focusCountry(id) {
    // Frame the homeland around the capital, not far-flung islands (Guam, Hawaii, French Guiana)
    const ids = Object.entries(INDEX).filter(([, i]) => app.state.regions[i][0] === id).map(([rid]) => rid);
    const anchor = GEO[CAPITALS[id]] && ids.includes(CAPITALS[id]) ? GEO[CAPITALS[id]] : GEO[ids[0] ?? id];
    const near = anchor ? ids.filter((rid) => Math.hypot(GEO[rid].x - anchor.x, GEO[rid].y - anchor.y) < 180) : ids;
    map.focus(near.length ? near : [id]);
  },
  // Selecting one of our armies puts the map straight into "send it" mode: click anywhere and it goes there
  selectArmy(id, focus) {
    const a = app.state.armies.find((x) => x.id === id);
    if (!a) return;
    ctx.endTarget();
    app.selection = { army: id };
    map.selectArmy(id);
    map.select(null);
    showArmy(ctx, id);
    if (focus) map.focus([a.sea?.to ?? a.region]);
    if (a.owner === app.state.me && !a.sea) ctx.orderArmy(a, { keep: true });
  },
  closeSelection,
  orderArmy(army, { keep = false } = {}) {
    // The army keeps moving while the leader chooses: always work from where it is now
    const live = () => app.state.armies.find((x) => x.id === army.id) ?? army;
    ctx.target({
      keep,
      text: `Click anywhere on the map to send ${army.name} there`,
      get from() { return live().region; },
      kind: 'attack',
      filter: (id) => canGo(ctx, live(), id),
      reason: (id) => goBlocker(ctx, live(), id),
      onReject: (id) => sendArmy(ctx, live(), id),
      path: (id) => goPath(ctx, live(), id),
      // Clicking an army: one of ours selects it instead; a foreign one is a target like its province
      onArmy: (aid) => {
        const x = app.state.armies.find((y) => y.id === aid);
        if (!x) return false;
        if (x.owner === app.state.me) { if (aid !== army.id) ctx.selectArmy(aid); return true; }
        if (!x.sea) { ctx.endTarget(); sendArmy(ctx, live(), x.region); }
        return true;
      },
      onPick: (id) => { ctx.endTarget(); sendArmy(ctx, live(), id); },
    });
  },
  strikeTarget(kind) {
    const s = app.state;
    const enemy = (id) => {
      const ctrl = s.regions[INDEX[id]][1];
      return s.wars.some((w) => (w.a === s.me && w.b === ctrl) || (w.b === s.me && w.a === ctrl));
    };
    const why = (id) => (!enemy(id) ? `${regionName(id)} isn't held by a country we are at war with.` : rangeProblem(fauxState(s), s.you, id, kind === 'missile' ? 'missile' : 'air'));
    ctx.target({
      text: kind === 'missile' ? 'Pick an enemy-held province to strike' : 'Pick an enemy-held province to bomb',
      filter: (id) => !why(id),
      reason: why,
      onReject: (id) => hint(why(id), 'bad', 7000),
      onPick: (id) => { ctx.endTarget(); (kind === 'missile' ? missile : airStrike)(ctx, id); },
    });
  },
  target(opts) {
    if (!opts.keep) closeInspector();
    map.startTargeting(opts);
    $('target-bar').replaceChildren(h('span', opts.text), opts.extra ?? '', h('button.btn.small', { onclick: () => ctx.endTarget() }, 'Cancel'));
    $('target-bar').hidden = false;
    if (window.matchMedia('(max-width: 900px)').matches) closePanel();
  },
  endTarget() {
    map.stopTargeting();
    $('target-bar').hidden = true;
    hint(null);
  },
  mapMode(mode, res) {
    app.ui.mapMode = mode;
    if (res) app.ui.resource = res;
    map.setMode(mode, res);
    renderMapTools();
  },
  toast: (text, kind, onClick) => toast(text, kind, onClick),
  hint: (text, kind, ms) => hint(text, kind, ms),
  newsLog: () => [...app.newsLog.values()].sort((a, b) => b.id - a.id),
  tickAge: () => (app.lastTick ? (performance.now() - app.lastTick) / app.tickMs : 0),
  chatUnread: () => ctx.chat?.unread() ?? 0,
  toggleChat: (force) => ctx.chat.toggle(force),
  refreshHud: () => { if (app.screen === 'game' && app.state) renderHud(ctx); },
  leave,
};

const map = new WorldMap($('map'), {
  onRegion: (id) => (id ? selectRegion(id) : closeSelection()),
  onArmy: (id) => ctx.selectArmy(id),
  onContext: (id) => quickOrder(id),
  onTargetHint: (text) => hint(text, 'bad', 0),
});

// Messages along the bottom of the map: why an order can't be carried out, and other short notices
let hintTimer = null;
function hint(text, kind = 'bad', ms = 6000) {
  const el = $('map-hint');
  clearTimeout(hintTimer);
  if (!text) { el.hidden = true; return; }
  el.textContent = text;
  el.className = `map-hint ${kind}`;
  el.hidden = false;
  if (ms) hintTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Right-click with an army selected: send it there too
function quickOrder(id) {
  const s = app.state;
  const armyId = app.selection?.army;
  const a = s?.armies.find((x) => x.id === armyId && x.owner === s.me);
  if (!a) return hint('Click one of your armies first, then click where it should go.', 'info');
  ctx.endTarget();
  sendArmy(ctx, a, id);
}
ctx.chat = new Chat(ctx);
const mapReady = map.load();
// A handle for automated tests and the curious; the server still checks every command
window.statecraft = { ctx, map };

/* ---------- Screens ---------- */

function show(screen) {
  app.screen = screen;
  $('app').dataset.screen = screen;
}

function menu() {
  show('menu');
  const saved = loadSolo();
  $('solo-continue').hidden = !saved;
  if (saved) {
    const c = Object.values(saved.state.countries).find((x) => x.human);
    $('solo-meta').textContent = c ? `Saved: ${c.name}, week ${saved.state.week} of ${saved.state.settings.years * 52}.` : '';
  } else $('solo-meta').textContent = '';
  if (!serverBase()) {
    $('menu-status').textContent = 'The multiplayer server isn\'t set up yet. Solo play works now.';
  }
}

function connect(kind) {
  app.net?.leave?.();
  app.finalShown = false;
  app.focused = false;
  app.state = null;
  app.lobby = null;
  app.drafts = {};
  app.ui = {};
  app.newsLog = new Map();
  ctx.chat.reset();
  app.solo = kind === 'local';
  const Link = kind === 'local' ? LocalLink : RemoteLink;
  app.net = new Link(onMessage, onStatus);
  return app.net;
}

function onStatus(status) {
  const text = {
    connecting: 'Connecting…',
    waking: 'Waking the server up. On the free plan this can take up to a minute…',
    reconnecting: 'Connection lost. Reconnecting…',
    'no-server': 'The multiplayer server isn\'t set up yet. Try solo play.',
    open: '',
  }[status] ?? '';
  $('menu-status').textContent = text;
  $('lobby-status').textContent = status === 'reconnecting' ? text : $('lobby-status').textContent;
  if (status === 'reconnecting' && app.screen === 'game') toast('Connection lost. Reconnecting…', 'warn');
}

function onMessage(msg) {
  switch (msg.type) {
    case 'joined':
      if (!msg.solo) history.replaceState(null, '', `?room=${msg.code}`);
      break;
    case 'lobby':
      app.lobby = msg;
      app.myName = msg.players.find((p) => p.id === msg.you)?.name ?? app.myName;
      if (msg.phase === 'lobby') {
        app.state = null;
        app.finalShown = false;
        show('lobby');
        renderLobby();
      }
      break;
    case 'state':
      onState(msg);
      break;
    case 'cmdResult': {
      const resolve = app.pending.get(msg.req);
      app.pending.delete(msg.req);
      if (msg.error) { hint(msg.error, 'bad', 8000); if ($('modal').open) toast(msg.error, 'warn'); }
      resolve?.(msg.error ?? null);
      break;
    }
    case 'chatInit': ctx.chat.init(msg.channels); break;
    case 'channels': ctx.chat.setChannels(msg.channels); break;
    case 'chat': ctx.chat.receive(msg.msg, msg.channel); break;
    case 'alert': onAlert(msg.item); break;
    case 'news': onNews(msg.item); break;
    case 'error':
      if (app.screen === 'menu') $('menu-status').textContent = msg.message;
      else toast(msg.message, 'warn');
      if (msg.code === 'resume-failed') menu();
      break;
    default:
  }
}

function onState(s) {
  const first = !app.state;
  const ticked = app.state && s.week !== app.state.week;
  if (ticked || first) app.lastTick = performance.now();
  app.tickMs = SPEEDS[s.speed] ?? SPEEDS.normal;
  map.tickMs = app.tickMs;
  app.ticked = Boolean(ticked);
  for (const n of s.news ?? []) app.newsLog.set(n.id, n);
  if (app.newsLog.size > 1500) for (const k of [...app.newsLog.keys()].slice(0, app.newsLog.size - 1500)) app.newsLog.delete(k);
  app.state = s;
  if (s.phase === 'over' || s.over) {
    if (!app.finalShown) { app.finalShown = true; renderFinal(); show('final'); }
  } else if (app.screen !== 'game') show('game');
  if (app.screen === 'game' || first) renderGame();
  if (!app.focused && s.you) {
    app.focused = true;
    mapReady.then(() => ctx.focusCountry(s.me));
    if (first && s.week <= 1) toast(`You lead ${s.countries[s.me].name}. Open the Cabinet for your briefing.`, 'info');
  }
}

function onAlert(item) {
  const kind = item.kind === 'war' ? 'war' : item.kind;
  const go = item.region ? () => ctx.openRegion(item.region, true) : item.proposal ? () => ctx.go('overview') : item.resolution ? () => ctx.go('diplomacy', 'un') : item.settle ? () => ctx.openCountry(item.settle) : null;
  toast(item.text, kind, go);
}

function onNews(item) {
  if (!app.state) return;
  if (item.kind === 'nuclear') toast(item.text, 'nuclear');
  else if (item.kind === 'war' && /declares war/.test(item.text) && !item.about?.includes(app.state.me)) toast(item.text, 'war');
}

/* ---------- Lobby ---------- */

function renderLobby() {
  const l = app.lobby;
  const isHost = l.hostId === l.you;
  $('lobby-code').textContent = l.code;
  $('lobby-count').textContent = `${l.players.length}/${l.max}`;
  $('lobby-players').replaceChildren(...l.players.map((p) => h('li', { class: p.connected ? '' : 'away' }, h('span.dot'), h('span.grow', p.name, p.id === l.you ? h('span.faint', ' (you)') : null), p.id === l.hostId ? h('span.chip.accent', 'Host') : null)));
  const seg = (label, options, value, key, fmt) => h('div.field', h('span', label), h('div.seg', options.map((o) => h('button', {
    'aria-pressed': String(o === value), disabled: !isHost, onclick: () => app.net.send({ type: 'settings', [key]: o }),
  }, fmt(o)))));
  $('lobby-settings').replaceChildren(
    seg('Length', l.years, l.settings.years, 'years', (y) => `${y} years`),
    seg('Speed (a week passes every…)', l.speeds, l.settings.speed, 'speed', (sp) => ({ slow: '15 s', normal: '9 s', fast: '5 s', blitz: '2.5 s' }[sp] ?? sp)),
    seg('Countries handed out from', l.pools, l.settings.pool, 'pool', (p) => `Top ${p}`),
    h('p.muted.small', `Each leader gets a random country from the ${l.settings.pool} largest economies. The world runs in real time with no pausing: a ${l.settings.years}-year game at this speed lasts about ${Math.round((l.settings.years * 52 * { slow: 15, normal: 9, fast: 5, blitz: 2.5 }[l.settings.speed]) / 60)} minutes.`));
  $('start').hidden = !isHost;
  $('start').disabled = l.settings.pool < l.players.length;
  $('lobby-status').textContent = isHost ? (l.settings.pool < l.players.length ? 'More leaders than countries: pick a bigger pool.' : 'Start when everyone is in. Others can still join until then.') : 'Waiting for the host to start…';
  ctx.chat.render();
}

/* ---------- The game ---------- */

function renderGame() {
  renderHud(ctx);
  renderRail();
  renderPanel();
  renderMapTools();
  mapReady.then(() => {
    map.update(app.state, { tick: app.ticked });
    if (app.selection?.region) showRegion(ctx, app.selection.region);
    else if (app.selection?.army) {
      if (app.state.armies.some((a) => a.id === app.selection.army)) showArmy(ctx, app.selection.army);
      else closeSelection();
    }
  });
}

function renderRail() {
  const s = app.state;
  const badges = {
    overview: s ? s.proposals.filter((p) => p.to === s.me).length : 0,
    diplomacy: s ? s.un.filter((r) => !r.done && !r.votes[s.me]).length : 0,
    government: s?.you ? (s.you.protests ?? []).filter((p) => p.size >= 30).length + (s.you.civilWar ? 1 : 0) : 0,
    spies: s?.you ? (s.you.reports ?? []).filter((r) => r.w >= s.week - 1).length : 0,
  };
  const panelOpen = !$('game').classList.contains('panel-closed');
  $('rail').replaceChildren(...TABS.map(([id, label, icon]) => {
    const b = h('button', { 'aria-current': String(panelOpen && app.tab === id), title: label, onclick: () => {
      if (app.tab === id && panelOpen) closePanel();
      else { app.tab = id; if (id === 'diplomacy') app.ui.dossier = app.ui.dossier ?? null; openPanel(); renderPanel(true); }
      renderRail();
    } });
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    b.append(label);
    if (badges[id]) b.append(h('span.badge', String(badges[id])));
    return b;
  }), h('div.spacer'));
}

function openPanel() { $('game').classList.remove('panel-closed'); }
function closePanel() { $('game').classList.add('panel-closed'); renderRail(); }

function renderPanel(force = false) {
  if (!app.state) return;
  if (app.panelBusy && !force) { app.panelDirty = true; return; }
  const body = $('panel-body');
  const scroll = body.scrollTop;
  const tab = TABS.find(([id]) => id === app.tab) ?? TABS[0];
  let content;
  try {
    content = tab[3](ctx);
  } catch (err) {
    console.error(err);
    content = h('div.warning.bad', `Something went wrong drawing this panel: ${err.message}`);
  }
  body.replaceChildren(content);
  body.scrollTop = force ? 0 : scroll;
  if (force && app.lastTab === app.tab && app.lastSub === app.subs[app.tab]) body.scrollTop = scroll;
  app.lastTab = app.tab;
  app.lastSub = app.subs[app.tab];
  app.panelDirty = false;
}

// Don't redraw the panel under the leader's fingers: wait until they finish with a slider or field
{
  const panel = $('panel');
  const idle = () => { app.panelBusy = false; if (app.panelDirty) setTimeout(() => { if (!app.panelBusy) renderPanel(); }, 250); };
  panel.addEventListener('pointerdown', () => { app.panelBusy = true; });
  panel.addEventListener('pointerup', () => { if (!panel.contains(document.activeElement) || !document.activeElement.matches('input:not([type=range]),select,textarea')) idle(); });
  panel.addEventListener('focusin', (e) => { if (e.target.matches('input:not([type=range]),select,textarea')) app.panelBusy = true; });
  panel.addEventListener('focusout', idle);
}

function renderMapTools() {
  const mode = app.ui.mapMode ?? 'political';
  const res = app.ui.resource ?? 'oil';
  const seg = h('div.seg', MODES.map(([id, label]) => h('button', { 'aria-pressed': String(id === mode), onclick: () => ctx.mapMode(id) }, label)));
  const sel = mode === 'resources'
    ? h('select', { 'aria-label': 'Resource', onchange: (e) => ctx.mapMode('resources', e.target.value) }, RESOURCES.map((r) => h('option', { value: r, selected: r === res }, RESOURCE_INFO[r].name)))
    : null;
  $('map-tools').replaceChildren(seg, sel ?? '');
  const legend = [];
  const item = (color, text, hatch) => h('div.row', h('span.swatch', { style: { background: hatch ? `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 4px)` : color } }), text);
  if (mode === 'political') legend.push(item('#e5e7ef', 'Land is coloured by who holds it now'), h('div.row', h('span.swatch', { style: { background: 'transparent', border: '2px dashed #ffffff' } }), 'Front line: who holds which side of a contested province'), h('div.row', h('span.swatch', { style: { background: 'transparent', border: '2px solid #ff3b3b' } }), 'Countries at war with you'), item('#2a3142', 'Minor nations (computer-run)'));
  if (mode === 'alliances') legend.push(item('#8f95ff', 'You'), item('#4f8fe0', 'Military allies'), item('#3f9e7a', 'Trade partners / friendly'), item('#e5484d', 'At war with you'), item('#b0444a', 'Hostile'));
  if (mode === 'resources') legend.push(h('div.row', h('span.res-dot', { style: { background: RES_COLORS[res], width: '14px', height: '14px', fontSize: '7px' } }, RES_LETTERS[res]), `${RESOURCE_INFO[res].name} (${RESOURCE_INFO[res].unit}). Brighter = more`), h('div.faint', 'Hollow circles: untapped reserves to develop'));
  if (mode === 'economy') legend.push(item('#7fb6ff', 'Economic output per area'));
  if (mode === 'relations') legend.push(item('#4cc38a', 'Friendly toward you'), item('#e5484d', 'Hostile toward you'));
  $('legend').replaceChildren(...legend);
}

function selectRegion(id) {
  app.selection = { region: id };
  map.select(id);
  map.selectArmy(null);
  showRegion(ctx, id);
}

function closeSelection() {
  if (app.selection?.army) ctx.endTarget();
  app.selection = null;
  map.select(null);
  map.selectArmy(null);
  closeInspector();
}

/* ---------- Final ---------- */

function renderFinal() {
  const s = app.state;
  const ranks = s.final ?? s.ranks;
  const name = (r) => h('span.row.gap', flag(r.id), h('span', nationName(s, r.id)), r.human ? h('span.chip.accent', r.human) : null);
  const humans = ranks.filter((r) => r.human);
  const podium = (humans.length >= 3 ? humans : ranks).slice(0, 3);
  const byGrowth = [...ranks].sort((a, b) => b.growth - a.growth).slice(0, 8);
  const byLand = [...ranks].sort((a, b) => b.gained - a.gained).slice(0, 8);
  $('final-date').textContent = `${s.date} · ${s.week} weeks of history`;
  const table = (title, rows, value) => h('div.card', h('h2', { style: { marginBottom: '10px' } }, title), h('table.tbl', h('tbody', rows.map((r, i) => h('tr', { class: r.id === s.me ? 'me' : '' }, h('td', i + 1), h('td', name(r)), h('td.num', value(r)))))));
  $('final-body').replaceChildren(
    h('div.podium', podium.map((r, i) => h('div.card', h('div.muted.small', ['First', 'Second', 'Third'][i]), flag(r.id, true), h('h2', nationName(s, r.id)), r.human ? h('div.muted', r.human) : null, h('div.small', `Power ${r.power.toFixed(1)} · ${money(r.gdp)}`)))),
    h('div.final-tables',
      table('Most powerful', ranks.slice(0, 8), (r) => r.power.toFixed(1)),
      table('Fastest growing', byGrowth, (r) => pct(r.growth, 1, true)),
      table('Territory gained', byLand, (r) => (r.gained > 0 ? `+${r.gained}` : String(r.gained)))),
  );
  const isHost = app.lobby?.hostId === app.lobby?.you;
  $('final-again').hidden = !isHost && !app.solo;
}

/* ---------- Leaving ---------- */

async function leave() {
  if (app.screen === 'game' && !app.state?.over) {
    const ok = await confirmBox('Leave the game?', app.solo ? 'Your game is saved; continue it from the main menu.' : 'The computer will take over your country.', { ok: 'Leave' });
    if (!ok) return;
  }
  app.net?.leave?.();
  app.net = null;
  history.replaceState(null, '', location.pathname);
  closeModal();
  ctx.endTarget();
  closeSelection();
  menu();
}

/* ---------- Menu wiring ---------- */

const nameInput = $('name');
try { nameInput.value = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* storage unavailable */ }
const myName = () => {
  const n = nameInput.value.trim();
  try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
  return n;
};

$('create').addEventListener('click', () => {
  const name = myName();
  if (!name) { $('menu-status').textContent = 'Enter your name first.'; nameInput.focus(); return; }
  const net = connect('remote');
  if (!net.available) return onStatus('no-server');
  app.myName = name;
  net.session = null;
  net.open();
  net.send({ type: 'create', name });
});

$('join').addEventListener('click', () => {
  const name = myName();
  const code = $('code').value.trim().toUpperCase();
  if (!name) { $('menu-status').textContent = 'Enter your name first.'; nameInput.focus(); return; }
  if (code.length !== 4) { $('menu-status').textContent = 'Enter the four-letter game code.'; $('code').focus(); return; }
  const net = connect('remote');
  if (!net.available) return onStatus('no-server');
  app.myName = name;
  net.session = null;
  net.open();
  net.send({ type: 'join', code, name });
});
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });

$('solo').addEventListener('click', async () => {
  if (loadSolo() && !(await confirmBox('Start a new solo game?', 'Your saved solo game will be replaced.', { ok: 'Start new' }))) return;
  clearSolo();
  const net = connect('local');
  app.myName = myName() || 'You';
  net.open({ name: app.myName });
});
$('solo-continue').addEventListener('click', () => {
  const net = connect('local');
  app.myName = Object.values(loadSolo()?.state.countries ?? {}).find((c) => c.human)?.human.name ?? 'You';
  net.open({ name: app.myName, restore: true });
  toast('Game loaded. The world carries on from where you left it.', 'info');
});
$('help-btn').addEventListener('click', () => $('help').showModal());
$('help').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === $('help')) $('help').close(); });

$('lobby-leave').addEventListener('click', leave);
$('copy-link').addEventListener('click', async () => {
  const link = (window.top !== window ? document.referrer.split('?')[0] || location.href.split('?')[0] : location.href.split('?')[0]) + `?room=${app.lobby?.code}`;
  try { await navigator.clipboard.writeText(link); toast('Invite link copied.', 'good'); } catch { toast(link, 'info'); }
});
$('start').addEventListener('click', () => app.net.send({ type: 'start' }));
$('final-map').addEventListener('click', () => { show('game'); renderGame(); });
$('final-again').addEventListener('click', () => {
  if (app.solo) { clearSolo(); $('solo').click(); return; }
  app.net.send({ type: 'again' });
});
$('final-menu').addEventListener('click', () => { app.net?.leave?.(); app.net = null; history.replaceState(null, '', location.pathname); menu(); });

$('zoom').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.zoom === 'in') map.zoomBy(1.6);
  if (b.dataset.zoom === 'out') map.zoomBy(1 / 1.6);
  if (b.dataset.zoom === 'home' && app.state) ctx.focusCountry(app.state.me);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('modal').open || $('help').open) return;
  if (!$('target-bar').hidden) ctx.endTarget();
  else if (app.selection) closeSelection();
  else if (ctx.chat.open) ctx.chat.toggle(false);
});

/* ---------- The live clock: the date runs day by day between weekly updates ---------- */

setInterval(() => {
  if (app.screen !== 'game' || !app.state || app.state.over) return;
  const el = document.getElementById('hud-date');
  if (el) el.textContent = liveDate(app.state, ctx.tickAge());
}, 1000);

/* ---------- Start ---------- */

const invite = new URLSearchParams(location.search).get('room');
menu();
if (window.matchMedia('(max-width: 900px)').matches) $('game').classList.add('panel-closed');
if (invite) {
  $('code').value = invite.toUpperCase();
  $('menu-status').textContent = 'Enter your name and press Join.';
  if (hasSavedRoom()) {
    const net = connect('remote');
    if (net.available) net.open();
  } else {
    nameInput.focus();
  }
}

export { colorOf, CAPITALS };
