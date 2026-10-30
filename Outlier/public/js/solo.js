// Daily and Unlimited: one player, scored in the browser against scrambled answer keys.

import { TIERS, MISS_EMOJI, SECONDS_PER_PROMPT, normalize, lookupKeys, hashKey, todayKey, addDays, dayStartMs } from './shared.js';
import { getDoc, store, NotSetUpError } from './data.js';
import { $, show, toast, escapeHtml, tierBadge, picksHtml, feedback, shake, copyText, pageUrl, Countdown } from './ui.js';

const TOTAL_MS = SECONDS_PER_PROMPT * 1000;
const countdown = new Countdown($('timer'), $('timer-fill'), $('timer-num'));
let session = null; // the game being played
let tried = new Set(); // answers already tried on this prompt
let locked = false; // this prompt is answered or out of time
let nextDailyTimer = 0;

/* ---------- Starting ---------- */

export async function startDaily() {
  const day = todayKey();
  const saved = store.get(`daily.${day}`, null);
  if (saved?.done) return dailySummary(day, saved.answers);

  const doc = await load(() => getDoc(`daily/${day}`), startDaily);
  if (doc === undefined) return;
  if (!doc) {
    return notice("Today's puzzle isn't out yet",
      'New prompts are published every day at midnight Eastern time. Try Unlimited in the meantime.',
      'Play Unlimited', startUnlimited);
  }
  session = {
    mode: 'daily',
    day,
    prompts: doc.prompts,
    answers: saved?.answers ?? [],
    startedAt: saved?.startedAt ?? null,
  };
  playCurrent();
}

export async function startUnlimited() {
  const meta = await load(() => getDoc('meta/public'), startUnlimited);
  if (meta === undefined) return;
  if (!meta?.unlimited?.length) return notice('No Unlimited prompts yet', 'Check back soon.');
  session = { mode: 'unlimited', ids: meta.unlimited, prompts: [], answers: [], upcoming: null };
  const first = await load(() => drawPrompt(), startUnlimited);
  if (!first) return;
  session.prompts.push(first);
  playCurrent();
}

// Runs a load and shows a message instead if it fails; undefined means it failed
async function load(task, retry) {
  try {
    return await task();
  } catch (err) {
    if (err instanceof NotSetUpError) {
      notice('Not set up yet', 'The puzzles are not connected yet. Come back soon.');
    } else {
      console.error(err);
      notice("Couldn't load the puzzle", 'Check your connection and try again.', 'Try again', retry);
    }
    return undefined;
  }
}

// The next Unlimited prompt from a shuffled bag kept in this browser, so prompts don't repeat until all are played
async function drawPrompt() {
  for (let attempt = 0; attempt < 3; attempt++) {
    let bag = store.get('unlimited.bag', []).filter((id) => session.ids.includes(id));
    if (!bag.length) bag = shuffle(session.ids);
    const id = bag.shift();
    store.set('unlimited.bag', bag);
    const doc = await getDoc(`unlimited/${id}`);
    if (doc) return doc;
  }
  throw new Error('Could not load an Unlimited prompt');
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Playing a prompt ---------- */

function current() {
  return session.prompts[session.answers.length];
}

function playCurrent() {
  const p = current();
  const daily = session.mode === 'daily';
  // Daily keeps the clock running across reloads, so leaving the page doesn't buy extra time
  let remaining = TOTAL_MS;
  if (daily) {
    session.startedAt ??= Date.now();
    saveDaily();
    remaining = TOTAL_MS - (Date.now() - session.startedAt);
  }

  show('play');
  locked = false;
  tried = new Set();
  $('play-mode').textContent = daily ? `Daily · ${dayLabel(session.day)}` : 'Unlimited';
  $('prompt-count').textContent = daily ? `Prompt ${session.answers.length + 1} of ${session.prompts.length}` : `Prompt ${session.answers.length + 1}`;
  $('prompt-text').textContent = p.text;
  $('result').hidden = true;
  $('answer-form').hidden = false;
  $('answer').value = '';
  $('answer').disabled = false;
  feedback($('feedback'), '');
  renderProgress();

  if (remaining <= 0) return lock(null);
  countdown.start(remaining, TOTAL_MS, () => lock(null));
  $('answer').focus();
  if (!daily && !session.upcoming) session.upcoming = drawPrompt().catch(() => null);
}

async function submit() {
  if (locked) return;
  const p = current();
  const input = $('answer');
  const text = input.value.trim();
  const key = normalize(text);
  if (!key) return feedback($('feedback'), 'Type an answer first.');
  if (countdown.expired) return;
  if (tried.has(key)) {
    feedback($('feedback'), `You already tried "${text}".`, true);
    return shake($('answer-form'));
  }
  tried.add(key);
  let tier;
  for (const k of lookupKeys(key)) {
    tier = p.keys[await hashKey(p.salt, k)];
    if (tier !== undefined) break;
  }
  if (locked) return;
  if (tier === undefined) {
    feedback($('feedback'), `"${text}" isn't on the list. Try another.`, true);
    shake($('answer-form'));
    input.select();
    return;
  }
  lock({ text, tier });
}

function lock(answer) {
  if (locked) return;
  locked = true;
  countdown.stop();
  const p = current();
  const entry = { prompt: p.text, text: answer?.text ?? null, tier: answer?.tier ?? null, points: answer ? TIERS[answer.tier].points : 0 };
  session.answers.push(entry);
  session.startedAt = null;

  if (session.mode === 'daily') {
    saveDaily();
    if (finished()) recordDaily();
  } else {
    const stats = store.get('unlimited.stats', { rounds: 0, points: 0 });
    store.set('unlimited.stats', { rounds: stats.rounds + 1, points: stats.points + entry.points });
  }

  $('answer').disabled = true;
  $('answer-form').hidden = true;
  feedback($('feedback'), '');
  tierBadge($('result-badge'), entry.tier);
  $('result-answer').textContent = entry.text ?? "Time's up";
  // Don't suggest the answer the player just gave
  const given = entry.text == null ? [] : lookupKeys(normalize(entry.text));
  $('result-picks').innerHTML = picksHtml(p.examples.filter((e) => !given.includes(normalize(e.name))));
  $('end-btn').hidden = session.mode !== 'unlimited';
  $('result').hidden = false;
  renderProgress();
  $('next-btn').focus();
}

async function next() {
  if (!session || !locked) return;
  if (session.mode === 'daily') {
    if (finished()) return dailySummary(session.day, session.answers);
    return playCurrent();
  }
  $('next-btn').disabled = true;
  try {
    const doc = (await session.upcoming) ?? (await drawPrompt());
    session.upcoming = null;
    session.prompts.push(doc);
    playCurrent();
  } catch {
    toast("Couldn't load the next prompt. Try again.");
    session.upcoming = null;
  } finally {
    $('next-btn').disabled = false;
  }
}

function finished() {
  return session.answers.length >= session.prompts.length;
}

function total(answers) {
  return answers.reduce((sum, a) => sum + a.points, 0);
}

function renderProgress() {
  $('play-score').textContent = total(session.answers);
  const dots = $('dots');
  dots.hidden = session.mode !== 'daily';
  if (dots.hidden) return;
  dots.innerHTML = session.prompts.map((_, i) => {
    const a = session.answers[i];
    if (a) return `<li data-tier="${a.tier ?? 'miss'}" title="${a.points} points"></li>`;
    return `<li class="${i === session.answers.length ? 'current' : ''}"></li>`;
  }).join('');
}

/* ---------- Daily progress and stats ---------- */

function saveDaily() {
  store.set(`daily.${session.day}`, { answers: session.answers, startedAt: session.startedAt, done: finished() });
}

function recordDaily() {
  const history = store.get('history', {});
  history[session.day] = total(session.answers);
  store.set('history', history);
}

export function dailyStats() {
  const history = store.get('history', {});
  const days = Object.keys(history).sort();
  const scores = Object.values(history);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  // The current streak counts if the last day played was today or yesterday
  const today = todayKey();
  const streak = prev === today || prev === addDays(today, -1) ? run : 0;
  return {
    played: days.length,
    streak,
    bestStreak: best,
    bestScore: scores.length ? Math.max(...scores) : 0,
  };
}

export function dailyStatus() {
  const day = todayKey();
  const saved = store.get(`daily.${day}`, null);
  if (saved?.done) return { done: true, score: total(saved.answers) };
  if (saved?.answers?.length || saved?.startedAt) return { inProgress: true, answered: saved.answers.length };
  return {};
}

function dayLabel(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/* ---------- Summaries ---------- */

function dailySummary(day, answers) {
  const score = total(answers);
  $('summary-eyebrow').textContent = `Daily · ${dayLabel(day)}`;
  $('summary-score').textContent = `${score} / ${answers.length * 100}`;
  renderSummaryList(answers);

  const shareText = `Outlier · ${dayLabel(day)}\n${answers.map((a) => (a.tier == null ? MISS_EMOJI : TIERS[a.tier].emoji)).join('')} ${score}\n${pageUrl()}`;
  $('share-box').hidden = false;
  $('share-text').hidden = true;
  $('share-text').value = shareText;

  const s = dailyStats();
  $('stats').innerHTML = [
    ['Played', s.played], ['Streak', s.streak], ['Best streak', s.bestStreak], ['Best score', s.bestScore],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');

  clearInterval(nextDailyTimer);
  const tick = () => {
    const ms = dayStartMs(addDays(todayKey(), 1)) - Date.now();
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    $('next-daily').textContent = todayKey() === day ? `Next puzzle in ${h}h ${m}m.` : 'A new puzzle is out.';
  };
  tick();
  nextDailyTimer = setInterval(tick, 30_000);

  $('summary-unlimited').hidden = false;
  show('summary');
}

function unlimitedSummary() {
  countdown.stop();
  const answers = session.answers;
  const score = total(answers);
  $('summary-eyebrow').textContent = 'Unlimited';
  $('summary-score').textContent = score;
  renderSummaryList(answers);
  $('share-box').hidden = true;
  const life = store.get('unlimited.stats', { rounds: 0, points: 0 });
  $('stats').innerHTML = [
    ['This session', answers.length], ['Average', answers.length ? Math.round(score / answers.length) : 0],
    ['All prompts', life.rounds], ['All-time average', life.rounds ? Math.round(life.points / life.rounds) : 0],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  $('next-daily').textContent = '';
  $('summary-unlimited').hidden = true;
  session = null;
  show('summary');
}

function renderSummaryList(answers) {
  $('summary-list').innerHTML = answers.map((a) => `
    <li>
      <span class="s-prompt">${escapeHtml(a.prompt)}</span>
      <span class="s-answer">${a.text == null ? 'No answer' : escapeHtml(a.text)}</span>
      <span class="tier-badge" data-tier="${a.tier ?? 'miss'}">${a.tier == null ? 'No answer · <b>0</b>' : `${TIERS[a.tier].label} · <b>+${a.points}</b>`}</span>
    </li>`).join('');
}

function notice(title, text, actionLabel, action) {
  $('notice-title').textContent = title;
  $('notice-text').textContent = text;
  const btn = $('notice-action');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel ?? '';
  btn.onclick = action ?? null;
  show('notice');
}

// Leaving the prompt screen (back to the menu); a Daily's clock keeps running
export function stop() {
  countdown.stop();
  clearInterval(nextDailyTimer);
}

/* ---------- Wiring ---------- */

$('answer-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
$('next-btn').addEventListener('click', next);
$('end-btn').addEventListener('click', unlimitedSummary);
$('summary-unlimited').addEventListener('click', startUnlimited);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || $('app').dataset.screen !== 'play' || !locked || e.target.tagName === 'BUTTON') return;
  e.preventDefault();
  next();
});
$('share-btn').addEventListener('click', async () => {
  const text = $('share-text').value;
  if (await copyText(text)) return toast('Copied. Paste it anywhere.');
  const box = $('share-text');
  box.hidden = false;
  box.select();
  toast('Copy the text below.');
});
