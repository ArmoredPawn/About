// Military → Doctrine: the way our armies fight, built from five choices; what it is worth against the enemies we
// face; the new ways of war its pieces can become; and the staff work to change it.

import { h, nationName, bar, money } from '../dom.js';
import { confirmBox } from '../dialogs.js';
import { AXES, AXIS_KEYS, MATCHUPS, SYNERGIES, draftWeeks, draftCost } from '../../engine/doctrine.js';

// Effects in words, for the option cards
const FX_WORDS = {
  attack: 'attack', defend: 'defence', mass: 'weight of numbers', attackLoss: 'losses attacking', defendLoss: 'losses defending', tempo: 'speed of advance',
  speed: 'march speed', fuel: 'fuel burned', breakthrough: 'breakthrough', pincer: 'pincer attacks', orgRecover: 'recovery', roughAttack: 'attack in rough ground',
  surprise: 'surprise', armor: 'tank power', fort: 'fortifications', vsBreakthrough: 'stopping breakthroughs', counter: 'counter-attacks', armorDefend: 'tanks in defence',
  militia: 'home guard', partisans: 'partisans in occupied land', urban: 'street fighting', cas: 'close air support', airEdge: 'air superiority', strategic: 'strategic bombing',
  airlift: 'airlifts', reach: 'supply far from home', forage: 'supply in enemy land', hatred: 'hatred of occupied peoples', noSurrender: 'never surrenders',
  pocket: 'holding out surrounded', setPiece: 'prepared attacks',
};
// Effects where more is worse for us
const BAD_UP = new Set(['attackLoss', 'defendLoss', 'fuel', 'hatred']);

function fxChips(fx) {
  return h('span.fx-chips', Object.entries(fx).map(([k, v]) => {
    const word = FX_WORDS[k] ?? k;
    if (k === 'noSurrender') return h('span.fx.good', word);
    if (k === 'hatred') return h('span.fx.bad', 'occupied peoples hate us');
    const good = BAD_UP.has(k) ? v < 0 : v > 0;
    const amount = k === 'militia' ? `×${(1 + 2 * v).toFixed(1)}` : k === 'airlift' ? `×${(1 + v).toFixed(1)}` : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;
    return h('span.fx', { class: good ? 'good' : 'bad' }, `${amount} ${word}`);
  }));
}

const pickName = (axis, key) => AXES[axis].options[key]?.name ?? key;
const pctText = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.round(Math.abs(v) * 100)}%`;

export function doctrine(ctx) {
  const s = ctx.state;
  const mine = s.doctrines?.[s.me];
  if (!mine?.known) return h('div.empty', 'Our general staff has no doctrine on file yet. It will be ready next week.');
  const draft = ctx.draft('doctrine', () => ({ picks: { ...(mine.draft?.picks ?? mine.picks) }, name: mine.draft?.name ?? mine.name }));
  const enemies = [...new Set(s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a)))];
  return h('div',
    current(ctx, mine),
    mine.draft ? underWay(ctx, mine) : null,
    matchups(ctx, mine, enemies),
    innovations(ctx, mine),
    builder(ctx, mine, draft));
}

/* ---------- Our doctrine now ---------- */

function current(ctx, d) {
  return h('div.section',
    h('div.doctrine-head',
      h('div', h('div.faint.small', 'Our doctrine'), h('h3', { style: { margin: '2px 0 0' } }, d.name)),
      d.innovations.length ? h('div.chips', d.innovations.map((id) => { const syn = SYNERGIES.find((x) => x.id === id); return syn ? h('span.chip.accent', { title: syn.note }, `${d.pioneer?.includes(id) ? '★ ' : ''}${syn.name}`) : null; })) : null),
    h('div.doctrine-grid', AXIS_KEYS.map((axis) => {
      const key = d.picks[axis];
      const ready = d.ready?.[axis] ?? 1;
      const skill = d.mastery?.[key] ?? 0;
      return h('div.doctrine-cell',
        h('div.faint.small', AXES[axis].name),
        h('b', pickName(axis, key)),
        h('div.row.gap.small', { title: 'Training: a new concept fights at half strength at first' }, h('span.faint', 'Trained'), h('div.grow', bar(ready * 100, 100, ready < 0.5 ? 'warn' : 'good')), h('span.mono', `${Math.round(ready * 100)}%`)),
        h('div.row.gap.small', { title: 'Mastery comes from fighting by it (fastest when losing) and, slowly, from peacetime exercises. It strengthens every effect by up to a third.' }, h('span.faint', 'Mastery'), h('div.grow', bar(skill * 100, 100, 'accent')), h('span.mono', `${Math.round(skill * 100)}`)));
    })),
    h('p.muted.small', 'A doctrine is how our armies fight: five choices that change how hard they hit, how fast they move, how they defend, what the air force does and how they are supplied and led. Each week of battle by a concept builds mastery of it, and the right combinations, once mastered, become a new way of war.'));
}

function underWay(ctx, d) {
  const s = ctx.state;
  const total = Math.max(1, d.draft.ready - d.draft.since);
  const done = Math.min(1, (s.week - d.draft.since) / total);
  return h('div.item', { style: { marginTop: '10px' } },
    h('div.item-head', h('span.name', `In development: "${d.draft.name}"`), h('span.muted.small', { style: { marginLeft: 'auto' } }, `ready in week ${d.draft.ready}`)),
    h('div.meta', AXIS_KEYS.filter((k) => d.draft.picks[k] !== d.picks[k]).map((k) => `${AXES[k].name}: ${pickName(k, d.picks[k])} → ${pickName(k, d.draft.picks[k])}`).join(' · ')),
    h('div.row.gap.small', { style: { marginTop: '6px' } }, h('div.grow', bar(done * 100, 100, 'accent')), h('span.mono', `${Math.round(done * 100)}%`)),
    h('div.actions', h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox('Shelve the new doctrine?', 'The staff work done so far, and its cost, are lost.', { ok: 'Shelve it', danger: true })) ctx.send({ type: 'doctrineCancel' }); } }, 'Shelve it')));
}

/* ---------- Against our enemies ---------- */

function matchups(ctx, mine, enemies) {
  const s = ctx.state;
  const rows = enemies.map((e) => {
    const d = s.doctrines?.[e];
    if (!d?.known) return h('tr', h('td', nationName(s, e)), h('td.faint', { colspan: 2 }, 'Unknown: plant spies, or fight it for a month, to learn how it fights'));
    const ours = MATCHUPS[mine.picks.offence]?.[d.picks.defence] ?? 0;
    const theirs = MATCHUPS[d.picks.offence]?.[mine.picks.defence] ?? 0;
    return h('tr',
      h('td', h('b', nationName(s, e)), h('div.faint.small', `${pickName('offence', d.picks.offence)} · ${pickName('defence', d.picks.defence)}`)),
      h('td.num', { class: ours > 0 ? 'good' : ours < 0 ? 'bad' : '', title: `Our ${pickName('offence', mine.picks.offence).toLowerCase()} against their ${pickName('defence', d.picks.defence).toLowerCase()}` }, pctText(ours)),
      h('td.num', { class: theirs > 0 ? 'bad' : theirs < 0 ? 'good' : '', title: `Their ${pickName('offence', d.picks.offence).toLowerCase()} against our ${pickName('defence', mine.picks.defence).toLowerCase()}` }, pctText(theirs)));
  });
  return h('div.section', h('h3', 'Attack against defence'),
    matrix(mine, enemies.map((e) => s.doctrines?.[e]).filter((d) => d?.known)),
    enemies.length ? h('table.tbl', { style: { marginTop: '10px' } }, h('thead', h('tr', h('th', 'Enemy'), h('th.num', 'Our attacks'), h('th.num', 'Their attacks'))), h('tbody', rows)) : null);
}

// Every attack concept against every defence: what an attacker can expect. Ours highlighted.
function matrix(mine, known) {
  const offs = Object.keys(AXES.offence.options);
  const defs = Object.keys(AXES.defence.options);
  const theirDef = new Set(known.map((d) => d.picks.defence));
  const theirOff = new Set(known.map((d) => d.picks.offence));
  return h('div.matrix-wrap',
    h('table.matrix',
      h('thead', h('tr', h('th', h('span.faint.small', 'attack ↓  defence →')), defs.map((d) => h('th', { class: d === mine.picks.defence ? 'ours' : theirDef.has(d) ? 'theirs' : '' }, AXES.defence.options[d].name)))),
      h('tbody', offs.map((o) => h('tr',
        h('th', { class: o === mine.picks.offence ? 'ours' : theirOff.has(o) ? 'theirs' : '' }, AXES.offence.options[o].name),
        defs.map((d) => {
          const v = MATCHUPS[o][d];
          const hue = v > 0 ? `rgb(76 195 138 / ${0.15 + v * 2.5})` : v < 0 ? `rgb(229 72 77 / ${0.15 + -v * 3})` : 'transparent';
          const mark = (o === mine.picks.offence && theirDef.has(d)) || (d === mine.picks.defence && theirOff.has(o));
          return h('td', { style: { background: hue }, class: mark ? 'live' : '' }, pctText(v));
        }))))),
    h('p.faint.small', 'Green: the attacker does better than usual; red: worse. Our concepts are underlined, the enemy\'s outlined. Armoured manoeuvre tears through a fortified line but bleeds against an elastic defence; infiltration beats static lines and drowns in a people\'s war.'));
}

/* ---------- New ways of war ---------- */

function innovations(ctx, mine) {
  const cards = SYNERGIES.map((syn) => {
    const have = mine.innovations.includes(syn.id);
    const parts = Object.entries(syn.needs);
    const match = parts.filter(([axis, key]) => mine.picks[axis] === key).length;
    const skill = parts.reduce((t, [, key]) => t + (mine.mastery?.[key] ?? 0), 0) / parts.length;
    return h('div.syn-card', { class: have ? 'have' : match === parts.length ? 'close' : '' },
      h('div.row.gap', h('b', syn.name), have ? h('span.chip.good', mine.pioneer?.includes(syn.id) ? '★ Pioneers' : 'Mastered') : h('span.faint.small', { style: { marginLeft: 'auto' } }, `${match}/${parts.length} pieces`)),
      h('div.small.muted', syn.note),
      h('div.small', parts.map(([axis, key]) => h('span.need', { class: mine.picks[axis] === key ? 'ok' : '' }, pickName(axis, key)))),
      !have && match === parts.length ? h('div.row.gap.small', h('span.faint', 'Mastery'), h('div.grow', bar(Math.min(100, (skill / 0.42) * 100), 100, 'accent')), h('span.faint', skill >= 0.42 ? 'any week now' : 'fight by it to master it')) : null,
      h('div', fxChips(syn.fx)));
  });
  return h('div.section', h('h3', 'New ways of war'),
    h('p.muted.small', 'Put the right pieces together and master them in battle, and the generals develop something new. The first country to develop each one is its pioneer and fights it best.'),
    h('div.syn-grid', cards));
}

/* ---------- Building a new one ---------- */

function builder(ctx, mine, draft) {
  const s = ctx.state;
  const me = s.you;
  const summary = h('div.doctrine-cost');
  const nameInput = h('input', { value: draft.name, maxlength: 32, placeholder: 'Name it' });
  nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
  const refresh = () => {
    const changes = AXIS_KEYS.filter((k) => draft.picks[k] !== mine.picks[k]).length;
    const unlocks = SYNERGIES.filter((syn) => Object.entries(syn.needs).every(([axis, key]) => draft.picks[axis] === key) && !mine.innovations.includes(syn.id));
    summary.replaceChildren(
      changes ? h('span', `${changes} change${changes > 1 ? 's' : ''}: ${draftWeeks(me, changes)} weeks of staff work and exercises, ${money(draftCost(me, changes))}. The old doctrine stays in force until then; the new one then needs a few months of training.`) : h('span.faint', 'Pick a different concept on any line to draft a new doctrine.'),
      unlocks.length ? h('div.good.small', `Could become: ${unlocks.map((x) => x.name).join(', ')}`) : null);
  };
  const rows = AXIS_KEYS.map((axis) => {
    const opts = Object.entries(AXES[axis].options);
    const row = h('div.pick-row');
    const paint = () => {
      row.replaceChildren(...opts.map(([key, opt]) => {
        const card = h('button.doc-opt', { type: 'button', 'aria-pressed': String(draft.picks[axis] === key), class: key === mine.picks[axis] ? 'current' : '' },
          h('b', opt.name, key === mine.picks[axis] ? h('span.faint.small', ' (now)') : null),
          h('span.small.muted', opt.note),
          fxChips(opt.fx));
        card.addEventListener('click', () => { draft.picks[axis] = key; paint(); refresh(); });
        return card;
      }));
    };
    paint();
    return h('div.section', h('div.faint.small', `${AXES[axis].name}: ${AXES[axis].short}`), row);
  });
  refresh();
  return h('div.section', h('h3', 'Build a new doctrine'),
    ...rows,
    h('label.field', h('span', 'Name'), nameInput),
    summary,
    h('div.actions',
      h('button.btn.primary', { disabled: Boolean(mine.draft), onclick: async () => {
        const err = await ctx.send({ type: 'doctrine', picks: draft.picks, name: draft.name });
        if (!err) { ctx.clearDraft('doctrine'); ctx.toast('The general staff is developing the new doctrine.', 'good'); }
      } }, mine.draft ? 'A doctrine is already being developed' : 'Develop this doctrine'),
      h('button.btn.ghost', { onclick: () => { ctx.clearDraft('doctrine'); ctx.rerender(); } }, 'Reset')));
}
