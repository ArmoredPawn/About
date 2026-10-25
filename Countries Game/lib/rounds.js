// Generates fresh rounds for the game. Returns null when it can't (no key,
// rate limit, bad output); the browser then plays from its built-in bank.

import { finalizeRound, pickDirection, sameTitle } from '../public/js/rounds.js';
import { THEMES, isConfigured, requestRound } from './generator.js';

const GENERATION_LIMIT = Number(process.env.ROUND_RATE_LIMIT) || 40; // per IP per window
const WINDOW_MS = 15 * 60 * 1000;
const usage = new Map(); // ip -> { count, resetAt }

function allowGeneration(ip) {
  const now = Date.now();
  const entry = usage.get(ip);
  if (!entry || entry.resetAt <= now) {
    usage.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= GENERATION_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of usage) if (entry.resetAt <= now) usage.delete(ip);
}, WINDOW_MS).unref();

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function pickTheme(direction, recent) {
  const fits = THEMES.filter(([, dirs]) => dirs === 'both' || dirs === direction);
  const fresh = fits.filter(([name]) => !recent.some((r) => sameTitle(r, name)));
  return pick(fresh.length ? fresh : fits)[0];
}

export async function getRound({ direction: requested, recent = [], ip = 'unknown' }) {
  const direction = pickDirection(requested);

  if (isConfigured() && allowGeneration(ip)) {
    const theme = pickTheme(direction, recent);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await requestRound({ direction, theme, avoid: recent });
        const round = finalizeRound(raw, direction);
        if (recent.some((t) => sameTitle(t, round.title)) && attempt === 0) continue;
        return round;
      } catch (err) {
        console.warn(`[rounds] generation failed (attempt ${attempt + 1}): ${err.message}`);
        if (err.status && ![400, 404].includes(err.status)) break;
      }
    }
  }

  return null;
}
