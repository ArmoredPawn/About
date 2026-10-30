// Writes the prompts and the daily schedule to a store (see store.js). Used by scripts/seed.js.
//
//   answerKeys/{id}  full answer lists, read only by the multiplayer server
//   unlimited/{id}   scrambled prompt for Unlimited
//   daily/{day}      that day's scrambled prompts; browsers can open it from midnight New York time
//   meta/public      the list of Unlimited prompts
//   meta/server      the schedule and a version number, written last; the server reloads when it changes

import { todayKey, dayStartMs } from '../public/js/shared.js';
import { publicPrompt } from './prompts.js';
import { planSchedule, lastDay } from './schedule.js';

export async function publish({ prompts, store, now = Date.now() }) {
  const today = todayKey(now);
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const dailyIds = prompts.filter((p) => p.pool === 'daily').map((p) => p.id);
  const unlimitedIds = prompts.filter((p) => p.pool === 'unlimited').map((p) => p.id);

  const previous = (await store.read('meta/server')) ?? { schedule: {} };
  const { schedule, spare } = planSchedule({ schedule: previous.schedule, dailyIds, today });

  const docs = [];
  for (const p of prompts) docs.push({ path: `answerKeys/${p.id}`, payload: p });
  for (const id of unlimitedIds) docs.push({ path: `unlimited/${id}`, payload: await publicPrompt(byId.get(id)) });
  docs.push({ path: 'meta/public', payload: { unlimited: unlimitedIds } });

  // Earlier days are left exactly as published. Today's is rewritten so answer fixes reach players straight away.
  const kept = [];
  for (const [day, ids] of Object.entries(schedule)) {
    if (day < today) continue;
    if (!ids.every((id) => byId.has(id))) { kept.push(day); continue; }
    const payload = { day, prompts: await Promise.all(ids.map((id) => publicPrompt(byId.get(id)))) };
    docs.push({ path: `daily/${day}`, payload, opensAt: dayStartMs(day) });
  }

  // Documents for prompts that were deleted, moved to the other pool, or days no longer scheduled
  const stale = [
    ...(await store.ids('answerKeys')).filter((id) => !byId.has(id)).map((id) => `answerKeys/${id}`),
    ...(await store.ids('unlimited')).filter((id) => byId.get(id)?.pool !== 'unlimited').map((id) => `unlimited/${id}`),
    ...(await store.ids('daily')).filter((day) => day > today && !schedule[day]).map((day) => `daily/${day}`),
  ];

  await store.write(docs);
  await store.remove(stale);
  await store.write([{ path: 'meta/server', payload: { version: now, schedule, unlimited: unlimitedIds } }]);

  return {
    today,
    prompts: prompts.length,
    unlimited: unlimitedIds.length,
    daily: dailyIds.length,
    lastDay: lastDay(schedule),
    spare: spare.length,
    removed: stale.length,
    kept,
  };
}
