// Decisions a leader must take: a crisis reaches the country, the markets turn, the generals plot. Each one has a
// few options and a deadline; when it runs out, the most cautious option is taken. Computer-run countries decide
// at once. Each system registers how its decisions play out (apply) and how the computer picks (ai).

import { alert, nextId } from './core.js';

const HANDLERS = {};

export function register(key, { apply, ai }) {
  HANDLERS[key] = { apply, ai };
}

// Put a decision before a country's leader. options: [{ id, label, note, tone }]; the first is the default.
export function ask(s, c, key, { title, text, options, weeks = 4, data = {}, once = null }) {
  c.decisions ??= [];
  if (once && c.decisions.some((d) => d.once === once)) return null;
  const d = { id: nextId(s, 'd'), key, title, text, options, data, once, since: s.week, until: s.week + weeks };
  if (!c.human) {
    const pick = HANDLERS[key]?.ai?.(s, c, d) ?? options[0].id;
    HANDLERS[key]?.apply(s, c, d, pick);
    return null;
  }
  c.decisions.push(d);
  alert(s, c.id, `Decision needed: ${title}`, 'decision', { decision: d.id });
  return d;
}

export function decide(s, c, id, option) {
  const d = (c.decisions ?? []).find((x) => x.id === id);
  if (!d) return 'That decision has already been taken.';
  if (!d.options.some((o) => o.id === option)) return 'Pick one of the options.';
  c.decisions = c.decisions.filter((x) => x !== d);
  return HANDLERS[d.key]?.apply(s, c, d, option) ?? null;
}

// Deadlines pass: the default is taken
export function decisionsTick(s) {
  for (const c of Object.values(s.countries)) {
    if (!c.decisions?.length) continue;
    for (const d of [...c.decisions]) {
      if (d.until > s.week) continue;
      c.decisions = c.decisions.filter((x) => x !== d);
      HANDLERS[d.key]?.apply(s, c, d, d.options[0].id);
      alert(s, c.id, `No answer in time on "${d.title}": the cabinet chose "${d.options[0].label}".`, 'warn');
    }
    // A leader who leaves hands open decisions to the computer
    if (!c.human && c.decisions.length) for (const d of [...c.decisions]) decide(s, c, d.id, HANDLERS[d.key]?.ai?.(s, c, d) ?? d.options[0].id);
  }
}
