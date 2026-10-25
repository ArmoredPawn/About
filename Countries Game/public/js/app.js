import { BY_CODE, resolveCountry } from './countries.js';
import { THEME_LABELS } from './bank/index.js';
import { deckProgress, drawRound, resetDeck } from './deck.js';
import { API_BASE } from './config.js';

const REQUEST_TIMEOUT_MS = 20_000;
// When a round server is available, this share of rounds comes from it and
// the rest from the built-in bank.
const SERVER_SHARE = 0.5;

const $ = (id) => document.getElementById(id);
const els = {
  round: $('round'),
  badge: $('badge'),
  themeLabel: $('theme-label'),
  lives: $('lives'),
  title: $('title'),
  desc: $('desc'),
  source: $('source'),
  form: $('guess-form'),
  input: $('guess'),
  guessBtn: $('guess-btn'),
  feedback: $('feedback'),
  progressBar: $('progress-bar'),
  progressLabel: $('progress-label'),
  slots: $('slots'),
  wrong: $('wrong'),
  wrongList: $('wrong-list'),
  result: $('result'),
  resultScore: $('result-score'),
  resultNote: $('result-note'),
  skip: $('skip'),
  giveUp: $('give-up'),
  share: $('share'),
  next: $('next'),
  error: $('error'),
  retry: $('retry'),
  statPlayed: $('stat-played'),
  statAvg: $('stat-avg'),
  statPerfect: $('stat-perfect'),
  deckStatus: $('deck-status'),
  reshuffle: $('reshuffle'),
};

// ---------- Persistence (best effort: the game works without storage) ----------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`ranked:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ranked:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

const settings = { dir: 'mix', lives: 3, theme: 'all', ...store.get('settings', {}) };
if (settings.theme !== 'all' && !THEME_LABELS[settings.theme]) settings.theme = 'all';
const stats = { played: 0, found: 0, perfect: 0, ...store.get('stats', {}) };
const seen = new Set(store.get('seen', []));
let recent = store.get('recent', []);

// ---------- Round state ----------

let round = null;
let answerByCode = new Map();
let found = new Set();
let wrong = [];
let livesLeft = 3;
let maxLives = 3;
let over = true;
let prefetched = null; // { key, promise } for a server round

const flagUrl = (code, width) => `https://flagcdn.com/w${width}/${code.toLowerCase()}.png`;

function flagImg(code, className) {
  const img = document.createElement('img');
  img.className = className;
  img.src = flagUrl(code, 40);
  img.srcset = `${flagUrl(code, 80)} 2x`;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  return img;
}

// ---------- Choosing rounds ----------

// Static hosts (GitHub Pages) have no server unless API_BASE points at one.
function roundUrl() {
  if (API_BASE) return `${API_BASE.replace(/\/+$/, '')}/api/round`;
  return location.hostname.endsWith('github.io') ? null : 'api/round';
}

// Turns false once the server answers 204 (nothing to add), so we stop asking.
let serverRounds = Boolean(roundUrl());

const filters = () => ({ dir: settings.dir, theme: settings.theme });
const useServer = () => serverRounds && settings.theme === 'all';
const requestKey = () => settings.dir;

async function fetchServerRound(exclude) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ dir: settings.dir, recent: JSON.stringify(exclude) });
    const res = await fetch(`${roundUrl()}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status === 204) {
      serverRounds = false;
      return null;
    }
    if (res.ok) return await res.json();
  } catch {
    /* unreachable or slow: the bank covers it */
  } finally {
    clearTimeout(timer);
  }
  return null;
}

function prefetchNext() {
  if (!useServer()) {
    prefetched = null;
    return;
  }
  if (prefetched && prefetched.key === requestKey()) return; // still unused
  prefetched = { key: requestKey(), promise: fetchServerRound(recent.slice(0, 15)) };
}

function deckRound() {
  const { round: next, relaxed, newCycle } = drawRound(filters(), seen, round?.id ?? null);
  store.set('seen', [...seen]);
  let note = '';
  if (relaxed) {
    const label = THEME_LABELS[settings.theme] ?? 'this selection';
    note = `There are no ${settings.dir} 10 rounds in ${label}, so here's a ${next.direction} 10.`;
  } else if (newCycle) {
    note = 'You’ve played every category in this selection, so the deck has been reshuffled.';
  }
  return { round: next, note };
}

async function takeRound() {
  if (useServer() && Math.random() < SERVER_SHARE) {
    const promise = prefetched?.key === requestKey() ? prefetched.promise : fetchServerRound(recent);
    prefetched = null;
    const generated = await promise;
    if (generated) return { round: generated, note: '' };
  }
  return deckRound();
}

// ---------- Rendering ----------

function setLoading() {
  els.round.setAttribute('aria-busy', 'true');
  els.round.dataset.direction = '';
  els.badge.textContent = 'Loading';
  els.themeLabel.hidden = true;
  els.title.innerHTML = '<span class="skeleton skeleton-title"></span>';
  els.desc.innerHTML = '<span class="skeleton skeleton-line"></span>';
  els.source.textContent = '';
  els.lives.replaceChildren();
  els.slots.replaceChildren(
    ...Array.from({ length: 10 }, (_, i) => {
      const li = document.createElement('li');
      li.className = 'slot skeleton-slot';
      li.innerHTML = `<span class="slot-rank">${i + 1}</span><span class="slot-body"></span>`;
      return li;
    }),
  );
  els.feedback.textContent = 'Picking a category…';
  els.feedback.className = 'feedback';
  setProgress();
  els.result.hidden = true;
  els.wrong.hidden = true;
  els.error.hidden = true;
  els.next.hidden = true;
  els.share.hidden = true;
  els.skip.hidden = false;
  els.skip.disabled = true;
  els.giveUp.hidden = false;
  els.giveUp.disabled = true;
  setInputEnabled(false);
}

function setInputEnabled(enabled) {
  els.input.disabled = !enabled;
  els.guessBtn.disabled = !enabled;
}

function renderLives() {
  if (maxLives === 0) {
    const span = document.createElement('span');
    span.className = 'lives-unlimited';
    span.textContent = 'Unlimited strikes';
    els.lives.replaceChildren(span);
    els.lives.setAttribute('aria-label', 'Unlimited strikes');
    return;
  }
  els.lives.replaceChildren(
    ...Array.from({ length: maxLives }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = i < livesLeft ? 'life' : 'life spent';
      return dot;
    }),
  );
  els.lives.setAttribute('aria-label', `${livesLeft} of ${maxLives} strikes left`);
}

function setProgress() {
  const count = found.size;
  els.progressBar.style.width = `${count * 10}%`;
  els.progressLabel.textContent = `${count} of 10 found`;
}

function fillSlot(answer, state) {
  const li = els.slots.children[answer.rank - 1];
  li.className = `slot ${state}`;
  const body = document.createElement('span');
  body.className = 'slot-body';
  const text = document.createElement('span');
  text.className = 'slot-text';
  const name = document.createElement('span');
  name.className = 'slot-name';
  name.textContent = answer.country;
  text.append(name);
  if (answer.value) {
    const value = document.createElement('span');
    value.className = 'slot-value';
    value.textContent = answer.value;
    text.append(value);
  }
  body.append(flagImg(answer.code, 'slot-flag'), text);
  li.replaceChildren(li.firstElementChild, body);
  li.setAttribute('aria-label', `${answer.rank}. ${answer.country}${answer.value ? `, ${answer.value}` : ''}`);
}

function renderRound() {
  const isTop = round.direction === 'top';
  els.round.dataset.direction = round.direction;
  els.round.setAttribute('aria-busy', 'false');
  els.badge.textContent = isTop ? 'Top 10' : 'Bottom 10';
  const themeLabel = THEME_LABELS[round.theme];
  els.themeLabel.hidden = !themeLabel;
  els.themeLabel.textContent = themeLabel ?? '';
  els.title.textContent = round.title;
  els.desc.textContent = round.description || '';
  els.source.textContent = round.source ? `Source: ${round.source}` : '';
  els.slots.replaceChildren(
    ...round.answers.map((a) => {
      const li = document.createElement('li');
      li.className = 'slot';
      li.innerHTML = `<span class="slot-rank">${a.rank}</span><span class="slot-body"></span>`;
      li.setAttribute('aria-label', `${a.rank}. not found yet`);
      return li;
    }),
  );
  els.wrongList.replaceChildren();
  renderLives();
  setProgress();
  setFeedback(isTop ? 'Name a country in the top 10.' : 'Name a country in the bottom 10.');
}

function renderWrong() {
  els.wrong.hidden = wrong.length === 0;
  els.wrongList.replaceChildren(
    ...wrong.map((code) => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.append(flagImg(code, ''), document.createTextNode(BY_CODE.get(code)));
      return li;
    }),
  );
}

function renderStats() {
  els.statPlayed.textContent = stats.played;
  els.statAvg.textContent = stats.played ? (stats.found / stats.played).toFixed(1) : '–';
  els.statPerfect.textContent = stats.perfect;
}

function renderDeckStatus() {
  const { seen: played, total } = deckProgress(filters(), seen);
  els.deckStatus.textContent = `${played} of ${total} categories played`;
  els.reshuffle.disabled = played === 0;
}

let feedbackTimer;
function setFeedback(message, tone = '') {
  clearTimeout(feedbackTimer);
  els.feedback.textContent = message;
  els.feedback.className = `feedback ${tone}`;
}

function shake() {
  els.form.classList.remove('shake');
  void els.form.offsetWidth; // restart the animation
  els.form.classList.add('shake');
}

// ---------- Game flow ----------

async function startRound() {
  over = true;
  setLoading();
  let note;
  try {
    ({ round, note } = await takeRound());
  } catch (err) {
    console.error(err);
    els.feedback.textContent = '';
    els.error.hidden = false;
    els.skip.hidden = true;
    els.giveUp.hidden = true;
    els.round.setAttribute('aria-busy', 'false');
    return;
  }

  answerByCode = new Map(round.answers.map((a) => [a.code, a]));
  found = new Set();
  wrong = [];
  maxLives = Number(settings.lives);
  livesLeft = maxLives;
  over = false;

  recent = [round.title, ...recent.filter((t) => t !== round.title)].slice(0, 15);
  store.set('recent', recent);

  renderRound();
  renderWrong();
  renderDeckStatus();
  if (note) setFeedback(note);
  els.skip.disabled = false;
  els.giveUp.disabled = false;
  setInputEnabled(true);
  els.input.value = '';
  els.input.focus();
  prefetchNext();
}

function submitGuess(text) {
  if (over) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  const codes = resolveCountry(trimmed);
  if (codes.length === 0) {
    setFeedback(`“${trimmed}” isn't a country we recognise.`, 'bad');
    shake();
    return;
  }

  const code = codes.find((c) => answerByCode.has(c)) ?? codes[0];
  const name = BY_CODE.get(code);
  els.input.value = '';

  if (found.has(code)) {
    setFeedback(`You already found ${name}.`);
    return;
  }
  if (wrong.includes(code)) {
    setFeedback(`You already tried ${name}.`);
    return;
  }

  const answer = answerByCode.get(code);
  if (answer) {
    found.add(code);
    fillSlot(answer, 'found');
    setProgress();
    setFeedback(`${name} is #${answer.rank}${answer.value ? ` (${answer.value})` : ''}.`, 'good');
    if (found.size === round.answers.length) endRound();
    return;
  }

  wrong.push(code);
  renderWrong();
  shake();
  if (maxLives > 0) {
    livesLeft -= 1;
    renderLives();
  }
  if (maxLives > 0 && livesLeft <= 0) {
    setFeedback(`${name} isn't on the list. Out of strikes!`, 'bad');
    endRound();
  } else {
    const left = maxLives > 0 ? ` ${livesLeft} ${livesLeft === 1 ? 'strike' : 'strikes'} left.` : '';
    setFeedback(`${name} isn't on the list.${left}`, 'bad');
  }
}

function resultNote(score) {
  if (score === 10) return 'Perfect round. Every single one.';
  if (score >= 8) return 'Excellent. Only a couple slipped past you.';
  if (score >= 5) return 'Solid round.';
  if (score >= 2) return 'A tough one. Check the answers above.';
  return 'Brutal category. Better luck next round.';
}

function endRound() {
  if (over) return;
  over = true;
  els.input.value = '';
  setInputEnabled(false);

  for (const answer of round.answers) {
    if (!found.has(answer.code)) fillSlot(answer, 'missed');
  }

  const score = found.size;
  stats.played += 1;
  stats.found += score;
  if (score === 10) stats.perfect += 1;
  store.set('stats', stats);
  renderStats();

  els.resultScore.textContent = `${score} / 10`;
  els.resultNote.textContent = resultNote(score);
  els.result.hidden = false;
  els.skip.hidden = true;
  els.giveUp.hidden = true;
  els.share.hidden = false;
  els.next.hidden = false;
  els.next.focus();
}

function shareText() {
  const grid = round.answers.map((a) => (found.has(a.code) ? '🟩' : '⬛')).join('');
  const label = round.direction === 'top' ? 'Top 10' : 'Bottom 10';
  return `Ranked: ${label} ${round.title}\n${found.size}/10 ${grid}\n${location.origin}${location.pathname}`;
}

async function copyResult() {
  try {
    await navigator.clipboard.writeText(shareText());
    els.share.textContent = 'Copied!';
  } catch {
    els.share.textContent = 'Copy failed';
  }
  setTimeout(() => { els.share.textContent = 'Copy result'; }, 1600);
}

// ---------- Settings ----------

function initSettings() {
  const current = { dir: settings.dir, lives: String(settings.lives), theme: settings.theme };
  for (const [name, value] of Object.entries(current)) {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }
  document.querySelectorAll('input[name="dir"], input[name="lives"], input[name="theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      settings[input.name] = input.name === 'lives' ? Number(input.value) : input.value;
      store.set('settings', settings);
      renderDeckStatus();
      if (input.name === 'dir' && !over) prefetchNext();
    });
  });
  els.reshuffle.addEventListener('click', () => {
    resetDeck(filters(), seen);
    store.set('seen', [...seen]);
    renderDeckStatus();
  });
}

// ---------- Wire up ----------

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitGuess(els.input.value);
});
els.skip.addEventListener('click', () => {
  if (!over) startRound();
});
els.giveUp.addEventListener('click', () => {
  setFeedback('Here are the ones you missed.');
  endRound();
});
els.next.addEventListener('click', startRound);
els.retry.addEventListener('click', startRound);
els.share.addEventListener('click', copyResult);

initSettings();
renderStats();
renderDeckStatus();
startRound();
