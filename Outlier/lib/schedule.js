// Which daily prompts go on which day. Re-running the seed never changes today or any earlier day;
// later days are refilled from the current daily prompts, in the order they appear in the content files.

import { DAILY_PROMPTS, addDays } from '../public/js/shared.js';

export function planSchedule({ schedule = {}, dailyIds, today, perDay = DAILY_PROMPTS }) {
  const known = new Set(dailyIds);
  const next = {};
  const used = new Set();
  const future = [];

  for (const day of Object.keys(schedule).sort()) {
    if (day <= today) {
      next[day] = [...schedule[day]];
      next[day].forEach((id) => used.add(id));
    } else {
      future.push(...schedule[day].filter((id) => known.has(id)));
    }
  }
  future.forEach((id) => used.add(id));
  const queue = [...new Set(future), ...dailyIds.filter((id) => !used.has(id))];

  // Only whole days are scheduled; spare prompts wait for more to arrive
  let day = next[today] ? addDays(today, 1) : today;
  while (queue.length >= perDay) {
    next[day] = queue.splice(0, perDay);
    day = addDays(day, 1);
  }
  return { schedule: next, spare: queue };
}

// Prompts players may already have seen in a daily: everything on a day before today
export function pastDailyIds(schedule, today) {
  return Object.entries(schedule).filter(([day]) => day < today).flatMap(([, ids]) => ids);
}

export function lastDay(schedule) {
  return Object.keys(schedule).sort().at(-1) ?? null;
}
