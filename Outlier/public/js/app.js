// The menu, and moving between Daily, Unlimited and Play with friends.

import * as solo from './solo.js';
import * as multi from './multi.js';
import { $, show } from './ui.js';
import { DAILY_PROMPTS } from './shared.js';

function home() {
  if ($('app').dataset.screen === 'mp' && !multi.close()) return;
  solo.stop();
  renderMenu();
  show('home');
}

function renderMenu() {
  const status = solo.dailyStatus();
  const stats = solo.dailyStats();
  const parts = [];
  if (status.done) parts.push(`Played today: ${status.score} points`);
  else if (status.inProgress) parts.push(`In progress: ${status.answered} of ${DAILY_PROMPTS} answered`);
  if (stats.streak) parts.push(`${stats.streak}-day streak`);
  $('daily-meta').textContent = parts.join(' · ');
  const games = solo.unlimitedStats();
  $('unlimited-meta').textContent = games.played ? `${games.played} game${games.played === 1 ? '' : 's'} played · best ${games.best}` : '';
}

$('brand').addEventListener('click', home);
$('notice-home').addEventListener('click', home);
$('summary-home').addEventListener('click', home);
$('mode-daily').addEventListener('click', () => solo.startDaily());
$('mode-unlimited').addEventListener('click', () => solo.startUnlimited());
$('mode-multi').addEventListener('click', () => multi.open());
$('help-btn').addEventListener('click', () => $('help').showModal());

// An invite link (?room=ABCD) or a reload during a room opens Play with friends straight away
const invite = new URLSearchParams(location.search).get('room');
renderMenu();
if (invite || multi.hasSavedRoom()) multi.open(invite ?? undefined);
