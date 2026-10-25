// Shuffle-bag randomisation over the built-in bank: rounds come up in random
// order and none repeats until every round matching the filters has been seen.

import { BANK } from './bank/index.js';
import { finalizeRound } from './rounds.js';

export function randomIndex(length) {
  if (globalThis.crypto?.getRandomValues) {
    // Rejection sampling keeps the pick unbiased.
    const limit = Math.floor(0x100000000 / length) * length;
    const buffer = new Uint32Array(1);
    do globalThis.crypto.getRandomValues(buffer);
    while (buffer[0] >= limit);
    return buffer[0] % length;
  }
  return Math.floor(Math.random() * length);
}

/**
 * Rounds matching the player's filters. If a combination has no rounds
 * (e.g. bottom-10 sport), the direction filter is dropped and `relaxed` is set.
 */
export function eligibleRounds({ dir = 'mix', theme = 'all' } = {}, bank = BANK) {
  const byTheme = theme === 'all' ? bank : bank.filter((r) => r.theme === theme);
  const themed = byTheme.length ? byTheme : bank;
  if (dir !== 'top' && dir !== 'bottom') return { pool: themed, relaxed: false };
  const byDir = themed.filter((r) => r.direction === dir);
  return byDir.length ? { pool: byDir, relaxed: false } : { pool: themed, relaxed: true };
}

/**
 * Draw the next round. `seen` is a Set of round ids and is updated in place.
 * When every eligible round has been seen, those ids are cleared and a new
 * cycle starts (never opening with the round that was just played).
 */
export function drawRound(filters, seen, lastId = null, bank = BANK) {
  const { pool, relaxed } = eligibleRounds(filters, bank);
  let fresh = pool.filter((r) => !seen.has(r.id));
  let newCycle = false;
  if (fresh.length === 0) {
    for (const r of pool) seen.delete(r.id);
    fresh = pool.length > 1 ? pool.filter((r) => r.id !== lastId) : pool;
    newCycle = true;
  }
  const picked = fresh[randomIndex(fresh.length)];
  seen.add(picked.id);
  const round = { ...finalizeRound(picked, picked.direction), id: picked.id, theme: picked.theme };
  return { round, relaxed, newCycle };
}

/** How many of the eligible rounds have been seen in the current cycle. */
export function deckProgress(filters, seen, bank = BANK) {
  const { pool } = eligibleRounds(filters, bank);
  return { seen: pool.filter((r) => seen.has(r.id)).length, total: pool.length };
}

/** Forget which eligible rounds were seen, starting a fresh shuffle. */
export function resetDeck(filters, seen, bank = BANK) {
  for (const r of eligibleRounds(filters, bank).pool) seen.delete(r.id);
}
