// Round validation shared by the server and the browser.

import { BY_CODE, resolveCountry } from './countries.js';

const clip = (value, max) => String(value ?? '').trim().slice(0, max);
export const sameTitle = (a, b) => a.toLowerCase() === b.toLowerCase();

export function pickDirection(requested) {
  return requested === 'top' || requested === 'bottom' ? requested : Math.random() < 0.6 ? 'top' : 'bottom';
}

/** Turn a generated or built-in round into the shape the game uses, or throw. */
export function finalizeRound(raw, direction) {
  const title = clip(raw?.title, 60);
  if (!title) throw new Error('Round has no title');
  if (!Array.isArray(raw?.answers) || raw.answers.length < 10) throw new Error('Round needs 10 answers');

  const seen = new Set();
  const answers = raw.answers.slice(0, 10).map((entry, i) => {
    const [country, value] = Array.isArray(entry) ? entry : [entry?.country, entry?.value];
    const codes = resolveCountry(country ?? '');
    if (codes.length !== 1) throw new Error(`Unrecognised country: ${country}`);
    const code = codes[0];
    if (seen.has(code)) throw new Error(`Duplicate country: ${country}`);
    seen.add(code);
    return { rank: i + 1, code, country: BY_CODE.get(code), value: clip(value, 40) };
  });

  return {
    title,
    direction,
    description: clip(raw.description, 200),
    source: clip(raw.source, 80),
    answers,
  };
}
