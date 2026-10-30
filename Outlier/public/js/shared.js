// Answer matching, rarity tiers and the daily calendar.
// Shared by the browser game, the multiplayer server and the seed script (ES module, no dependencies).

export const TIERS = [
  { id: 'common', label: 'Common', points: 10, emoji: '⬜' },
  { id: 'familiar', label: 'Familiar', points: 25, emoji: '🟦' },
  { id: 'uncommon', label: 'Uncommon', points: 50, emoji: '🟩' },
  { id: 'rare', label: 'Rare', points: 75, emoji: '🟨' },
  { id: 'outlier', label: 'Outlier', points: 100, emoji: '🟪' },
];
export const MISS_EMOJI = '⬛';

export const DAILY_PROMPTS = 5;
export const UNLIMITED_ROUNDS = 7;
export const SECONDS_PER_PROMPT = 20;
// The daily puzzle changes at midnight in this time zone
export const DAILY_TIME_ZONE = 'America/New_York';

// The comparable form of an answer: no accents, case, punctuation, spaces or leading article
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // so "C++" and "C#" don't both become "C"
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' sharp ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) (?=\S)/, '')
    .replace(/ /g, '');
}

// Keys to look a typed answer up under, best first: as typed, then singular and plural forms,
// so "cherries" finds "Cherry" and "box" finds "Boxes" while "capes" still finds "Cape" before "Cap"
export function lookupKeys(key) {
  const keys = [key];
  if (key.length > 4 && key.endsWith('ies')) keys.push(`${key.slice(0, -3)}y`);
  if (key.length > 2 && key.endsWith('s')) keys.push(key.slice(0, -1));
  if (key.length > 3 && key.endsWith('es')) keys.push(key.slice(0, -2));
  keys.push(`${key}s`, `${key}es`);
  if (key.length > 2 && key.endsWith('y')) keys.push(`${key.slice(0, -1)}ies`);
  return [...new Set(keys)];
}

// Answer lists sent to browsers hold these scrambled keys, not the answers themselves
export async function hashKey(salt, key) {
  const bytes = new TextEncoder().encode(`${salt}:${key}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Dates (YYYY-MM-DD strings in the daily time zone) ---------- */

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function dayOf(ms) {
  return dayFormat.format(new Date(ms));
}

export function todayKey(now = Date.now()) {
  return dayOf(now);
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The instant a day starts in the daily time zone. New York is 4 or 5 hours behind UTC,
// and clocks change at 2am, so midnight is always one of those two candidates.
export function dayStartMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  for (const hours of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, hours);
    if (dayOf(ms) === day && dayOf(ms - 1) !== day) return ms;
  }
  throw new Error(`Could not find the start of ${day}`);
}
