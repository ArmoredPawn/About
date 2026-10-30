// Play with friends: a live room on the multiplayer server (server.js). The server scores every answer;
// this page only shows what it sends.

import { SERVER, store } from './data.js';
import { $, show, toast, escapeHtml, tierBadge, picksHtml, feedback, shake, copyText, pageUrl, Countdown } from './ui.js';
import { TIERS } from './shared.js';

const ROUND_OPTIONS = [5, 7, 10];
const SECOND_OPTIONS = [15, 20, 30];
const GIVE_UP_MS = 120_000; // stop trying to reach a sleeping server after this
const screen = $('screen-mp');
const countdown = new Countdown($('q-timer-fill').closest('.timer'), $('q-timer-fill'), $('q-timer-num'));

let ws = null;
let state = null; // the latest snapshot from the server
let pending = null; // create/join waiting for the connection
let wanted = false; // keep the connection open (and reconnect if it drops)
let retries = 0;
let firstTry = 0;
let shownRound = -1;
let nextTimer = 0;

// The room this tab is in, so a reload or dropped connection can rejoin it
const saved = {
  get() { try { return JSON.parse(sessionStorage.getItem('outlier.room')); } catch { return null; } },
  set(v) { try { sessionStorage.setItem('outlier.room', JSON.stringify(v)); } catch { /* blocked: no rejoin */ } },
  clear() { try { sessionStorage.removeItem('outlier.room'); } catch { /* blocked */ } },
};

export function hasSavedRoom() {
  return Boolean(saved.get());
}

export function open(code) {
  show('mp');
  $('mp-name').value ||= store.get('name', '');
  if (code) $('mp-code').value = code.toUpperCase().slice(0, 4);
  if (!SERVER) {
    view('entry');
    status('Playing with friends is not set up yet. Come back soon.');
    setEntryBusy(true);
    return;
  }
  if (state) return render();
  view('entry');
  // Wake the server early: on Render's free plan it sleeps when unused and takes up to a minute to start
  fetch(`${SERVER}/healthz`, { cache: 'no-store' }).catch(() => {});
  if (saved.get()) connect();
  else ($('mp-name').value ? $('mp-code').value ? $('mp-join') : $('mp-create') : $('mp-name')).focus();
}

// Leaving the multiplayer screen for the menu
export function close() {
  if (state && !confirm('Leave this room?')) return false;
  leave();
  return true;
}

/* ---------- Connection ---------- */

function connect() {
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  wanted = true;
  firstTry ||= Date.now();
  if (!state) status('Connecting to the game server…');
  const socket = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/ws`);
  ws = socket;
  socket.onopen = () => {
    if (socket !== ws) return socket.close();
    retries = 0;
    firstTry = 0;
    status(null);
    const room = saved.get();
    if (room) send({ type: 'resume', code: room.code, token: room.token });
    else if (pending) send(pending);
  };
  socket.onmessage = (e) => {
    if (socket !== ws) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  };
  // A socket replaced by a newer one (after Leave, say) is ignored when it finally closes
  socket.onclose = () => {
    if (socket !== ws) return;
    ws = null;
    if (!wanted) return;
    if (!state && Date.now() - firstTry > GIVE_UP_MS) {
      wanted = false;
      firstTry = 0;
      pending = null;
      setEntryBusy(false);
      return status("Couldn't reach the game server. Try again in a minute.");
    }
    status(state
      ? 'Connection lost. Reconnecting…'
      : 'Waking up the game server. The first connection after a quiet spell can take up to a minute…');
    const delay = Math.min(1000 * 2 ** retries, 8000);
    retries++;
    setTimeout(connect, delay);
  };
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handle(msg) {
  if (msg.type === 'joined') {
    saved.set({ code: msg.code, token: msg.token });
    pending = null;
    setEntryBusy(false);
  } else if (msg.type === 'state') {
    state = msg;
    render();
  } else if (msg.type === 'guess') {
    onGuess(msg);
  } else if (msg.type === 'error') {
    onError(msg);
  }
}

function onError(msg) {
  if (msg.code === 'resume-failed') {
    saved.clear();
    state = null;
    if (pending) return send(pending);
    view('entry');
    if ($('app').dataset.screen === 'mp') feedback($('mp-error'), 'That game has ended. Start a new room or join another.', true);
    return;
  }
  if (!state) {
    pending = null;
    setEntryBusy(false);
    return feedback($('mp-error'), msg.message, true);
  }
  toast(msg.message);
}

function leave() {
  send({ type: 'leave' });
  saved.clear();
  state = null;
  pending = null;
  wanted = false;
  shownRound = -1;
  countdown.stop();
  clearInterval(nextTimer);
  ws?.close();
  ws = null;
  status(null);
  view('entry');
}

/* ---------- Joining ---------- */

function startEntry(kind) {
  const name = $('mp-name').value.trim();
  if (!name) {
    $('mp-name').focus();
    return feedback($('mp-error'), 'Enter your name first.', true);
  }
  store.set('name', name);
  let msg;
  if (kind === 'join') {
    const code = $('mp-code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) {
      $('mp-code').focus();
      return feedback($('mp-error'), 'Room codes are four letters.', true);
    }
    msg = { type: 'join', code, name };
  } else {
    msg = { type: 'create', name };
  }
  feedback($('mp-error'), '');
  saved.clear();
  pending = msg;
  setEntryBusy(true);
  if (ws?.readyState === WebSocket.OPEN) send(msg);
  else connect();
}

function setEntryBusy(busy) {
  $('mp-create').disabled = busy;
  $('mp-join').disabled = busy;
}

function status(text) {
  $('mp-status').hidden = !text;
  $('mp-status').textContent = text ?? '';
}

function view(name) {
  screen.dataset.view = name;
}

/* ---------- Showing the room ---------- */

function me() {
  return state.players.find((p) => p.id === state.you);
}

function isHost() {
  return state.hostId === state.you;
}

function render() {
  if ($('app').dataset.screen !== 'mp') return;
  view(state.phase === 'lobby' ? 'lobby' : state.phase);
  if (state.phase !== 'question') countdown.stop();
  if (state.phase !== 'results') clearInterval(nextTimer);
  ({ lobby: renderLobby, question: renderQuestion, results: renderResults, final: renderFinal })[state.phase]();
}

function nameTag(p) {
  const tags = [];
  if (p.id === state.you) tags.push('you');
  if (!p.connected) tags.push('offline');
  return tags.length ? ` <span class="tag">${tags.join(' · ')}</span>` : '';
}

function renderLobby() {
  shownRound = -1;
  $('room-code').textContent = state.code;
  $('player-count').textContent = `${state.players.length} / 10`;
  $('lobby-players').innerHTML = state.players.map((p) => `
    <li class="${p.connected ? '' : 'offline'}">${escapeHtml(p.name)}${p.id === state.hostId ? ' <span class="tag host">host</span>' : ''}${nameTag(p)}</li>`).join('');

  const host = isHost();
  renderSeg($('rounds-seg'), ROUND_OPTIONS, state.settings.rounds, (rounds) => send({ type: 'settings', rounds }), host);
  renderSeg($('seconds-seg'), SECOND_OPTIONS, state.settings.seconds, (seconds) => send({ type: 'settings', seconds }), host);
  $('start-btn').hidden = !host;
  const hostName = state.players.find((p) => p.id === state.hostId)?.name ?? 'the host';
  $('lobby-hint').textContent = host
    ? (state.players.length === 1 ? 'Send the code to your friends. You can also start on your own.' : 'Start whenever everyone is in.')
    : `Waiting for ${hostName} to start the game.`;
}

// Built once, then only updated, so a button keeps focus and clicks when the room changes
function renderSeg(el, options, value, onPick, enabled) {
  if (!el.children.length) {
    el.innerHTML = options.map((n) => `<button type="button" role="radio" data-value="${n}">${n}</button>`).join('');
  }
  for (const btn of el.children) {
    btn.setAttribute('aria-checked', String(Number(btn.dataset.value) === value));
    btn.disabled = !enabled;
  }
  el.onclick = (e) => {
    const btn = e.target.closest('button');
    if (btn && enabled) onPick(Number(btn.dataset.value));
  };
}

function renderQuestion() {
  const mine = me();
  $('q-code').textContent = state.code;
  $('q-round').textContent = `Prompt ${state.round} of ${state.rounds}`;
  $('q-score').textContent = mine.score;
  $('q-prompt').textContent = state.prompt;

  if (shownRound !== state.round) {
    shownRound = state.round;
    $('q-answer').value = '';
    feedback($('q-feedback'), '');
    countdown.start(state.remainingMs, state.settings.seconds * 1000);
    if (!mine.answer) setTimeout(() => $('q-answer').focus(), 0);
  }

  $('q-form').hidden = Boolean(mine.answer);
  $('q-locked').hidden = !mine.answer;
  if (mine.answer) {
    tierBadge($('q-badge'), mine.answer.tier);
    $('q-locked-answer').textContent = mine.answer.name;
    feedback($('q-feedback'), '');
  }
  $('q-players').innerHTML = state.players.map((p) => `
    <li class="${p.answered ? 'done' : ''} ${p.connected ? '' : 'offline'}">${escapeHtml(p.name)}</li>`).join('');
}

function onGuess(msg) {
  if (msg.ok) return;
  const messages = {
    'not-on-list': `"${msg.text}" isn't on the list. Try another.`,
    empty: 'Type an answer first.',
    'slow-down': 'One moment…',
  };
  feedback($('q-feedback'), messages[msg.reason] ?? 'Try another.', msg.reason !== 'slow-down');
  if (msg.reason === 'not-on-list') {
    shake($('q-form'));
    $('q-answer').select();
  }
}

function renderResults() {
  $('r-code').textContent = state.code;
  $('r-round').textContent = `Prompt ${state.round} of ${state.rounds}`;
  $('r-prompt').textContent = state.prompt;
  const byPoints = [...state.players].sort((a, b) => (b.answer?.points ?? 0) - (a.answer?.points ?? 0));
  $('r-answers').innerHTML = byPoints.map((p) => {
    const a = p.answer;
    return `<li>
      <span class="who">${escapeHtml(p.name)}</span>
      <span class="what">${a ? escapeHtml(a.name) : '—'}</span>
      <span class="tier-badge" data-tier="${a ? a.tier : 'miss'}">${a ? `${TIERS[a.tier].label} · <b>+${a.points}</b>` : 'No answer · <b>0</b>'}</span>
    </li>`;
  }).join('');
  // Rare answers nobody in the room gave
  const given = new Set(state.players.map((p) => p.answer?.name).filter(Boolean));
  $('r-picks').innerHTML = picksHtml(state.examples.filter((e) => !given.has(e.name)));
  $('r-scores').innerHTML = scoreRows();

  clearInterval(nextTimer);
  const end = performance.now() + state.remainingMs;
  const last = state.round >= state.rounds;
  const tick = () => {
    const s = Math.max(0, Math.ceil((end - performance.now()) / 1000));
    $('r-next').textContent = `${last ? 'Final scores' : 'Next prompt'} in ${s}s`;
  };
  tick();
  nextTimer = setInterval(tick, 250);
}

function scoreRows() {
  return [...state.players].sort((a, b) => b.score - a.score).map((p) => `
    <li class="${p.id === state.you ? 'you' : ''}"><span class="name">${escapeHtml(p.name)}${p.connected ? '' : ' <span class="tag">offline</span>'}</span><span class="pts">${p.score}</span></li>`).join('');
}

function renderFinal() {
  shownRound = -1;
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const top = ranked.filter((p) => p.score === ranked[0].score);
  $('f-title').textContent = ranked.length === 1 ? `You scored ${ranked[0].score}`
    : top.length > 1 ? "It's a tie!" : `${top[0].name} wins!`;
  $('f-scores').innerHTML = scoreRows();
  $('again-btn').hidden = !isHost();
  const hostName = state.players.find((p) => p.id === state.hostId)?.name ?? 'the host';
  $('f-hint').textContent = isHost() ? 'Play again keeps everyone in the room.' : `Waiting for ${hostName} to start another game.`;
}

/* ---------- Wiring ---------- */

$('mp-form').addEventListener('submit', (e) => {
  e.preventDefault();
  // Enter in the code box joins; otherwise the button pressed decides
  const kind = e.submitter?.value ?? (document.activeElement === $('mp-code') && $('mp-code').value ? 'join' : 'create');
  startEntry(kind);
});
$('mp-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('start-btn').addEventListener('click', () => send({ type: 'start' }));
$('again-btn').addEventListener('click', () => send({ type: 'again' }));
$('leave-btn').addEventListener('click', leave);
$('f-leave-btn').addEventListener('click', leave);
$('invite-btn').addEventListener('click', async () => {
  const link = `${pageUrl()}?room=${state.code}`;
  toast(await copyText(link) ? 'Invite link copied.' : `Share this link: ${link}`);
});
$('q-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('q-answer').value.trim();
  if (!text) return feedback($('q-feedback'), 'Type an answer first.');
  send({ type: 'answer', text });
});
