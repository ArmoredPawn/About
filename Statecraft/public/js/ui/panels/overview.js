// The cabinet briefing: the state of the nation, what needs attention, and the inbox.

import { h, flag, money, pct, tone, spark, nationName, regionName, troops } from '../dom.js';
import { RESOURCE_INFO } from '../../engine/data/regions.js';
import { describeProposal } from '../describe.js';
import { decisionCards } from '../decisions.js';

export function overview(ctx) {
  const s = ctx.state;
  const me = s.you;
  const c = s.countries[s.me];
  if (!me) return h('div.empty', 'You are watching this game.');
  const rank = s.ranks.find((r) => r.id === s.me);
  const weeksToElection = me.electionWeek != null ? me.electionWeek - s.week : null;

  return h('div',
    h('div.panel-title', h('div.row.gap', flag(s.me, true), h('div', h('h2', c.name), h('div.muted.small', `${c.title} ${ctx.myName} · ${govName(c.gov)}`))), h('span.chip.accent', `#${rank?.rank ?? '—'} power`)),
    me.exile ? h('div.warning.bad', 'Your government is in exile. You can still talk to other leaders.') : null,
    h('div.section',
      h('h3', 'State of the nation'),
      h('div.kpis',
        kpi('GDP', money(me.gdp), `${pct(me.growth, 1, true)} a year`),
        kpi('Population', `${me.pop >= 1000 ? (me.pop / 1000).toFixed(2) + 'B' : Math.round(me.pop) + 'M'}`, `$${Math.round((me.gdp / me.pop) * 1000).toLocaleString('en-US')} per person`),
        kpi('Inflation', pct(me.infl), `rate ${me.rate}%`),
        kpi('Reserves', money(me.treasury), `defence ${money(me.milFunds)}`),
        kpi('Debt', `${Math.round(me.debtRatio)}% GDP`, `${pct(me.deficit)} deficit`),
        kpi('Approval', `${Math.round(me.approval)}%`, weeksToElection != null ? `election in ${weeksToElection} wk` : 'no elections'),
        kpi('Stability', `${Math.round(me.stability)}`, me.stability < 30 ? 'unrest likely' : 'steady'),
        kpi('World standing', `${Math.round(me.rep)}`, me.rep < 25 ? 'pariah' : me.rep > 65 ? 'respected' : 'mixed'),
        kpi('Armed forces', troops(me.troops), me.nukes ? `${me.nukes} warheads` : `${me.mob ? ['', 'partial', 'full'][me.mob] + ' mobilisation' : 'peacetime'}`),
      )),
    decisionCards(ctx),
    h('div.section', h('h3', 'Needs your attention'), warnings(ctx)),
    inbox(ctx),
    h('div.section',
      h('h3', 'Trends'),
      h('div.row.between.small', h('span.muted', 'GDP'), h('span', money(me.gdp))), spark(me.history.gdp),
      h('div.row.between.small', { style: { marginTop: '8px' } }, h('span.muted', 'Approval'), h('span', `${Math.round(me.approval)}%`)), spark(me.history.approval, 'var(--good)'),
      h('div.row.between.small', { style: { marginTop: '8px' } }, h('span.muted', 'Inflation'), h('span', pct(me.infl))), spark(me.history.infl, 'var(--warn)')),
  );
}

function govName(g) {
  return { democracy: 'Democracy', hybrid: 'Hybrid regime', autocracy: 'Autocracy' }[g] ?? g;
}

function kpi(label, value, sub) {
  return h('div.kpi', h('span', label), h('b', value), sub ? h('small', sub) : null);
}

function warnings(ctx) {
  const s = ctx.state;
  const me = s.you;
  const out = [];
  const add = (kind, text, onClick) => out.push(h('div.warning', { class: kind, style: onClick ? { cursor: 'pointer' } : null, onclick: onClick }, text));

  for (const p of s.proposals.filter((x) => x.to === s.me)) {
    add(p.kind === 'callToArms' ? 'bad' : 'info', `${nationName(s, p.from)} asks: ${describeProposal(s, p)}. Answer below.`);
  }
  for (const r of s.un.filter((x) => !x.done && !x.votes[s.me])) add('info', `UN vote open: ${r.kind} ${nationName(s, r.target)}. Vote in Diplomacy.`, () => ctx.go('diplomacy', 'un'));
  for (const [id, m] of Object.entries(s.minors)) if (m.settle) add('good', `${m.name} has surrendered to you. Decide its fate.`, () => ctx.go('diplomacy', 'world'));
  for (const [r, v] of Object.entries(me.short ?? {})) if (v > 0.02) add('bad', `${RESOURCE_INFO[r].name} shortage: ${Math.round(v * 100)}% of needs unmet.`, () => ctx.go('economy', 'resources'));
  for (const [r, stock] of Object.entries(me.stock ?? {})) {
    const weeks = stock / Math.max(1e-6, me.demand[r] ?? 0);
    if ((me.demand[r] ?? 0) > 0 && weeks < 3 && !(me.short[r] > 0.02)) add('', `${RESOURCE_INFO[r].name} reserves are down to ${weeks.toFixed(1)} weeks.`, () => ctx.go('economy', 'resources'));
  }
  if (me.infl > Math.max(8, me.base.infl + 4)) add('', `Inflation is ${pct(me.infl)}. Raising interest rates or cutting the deficit would cool it.`, () => ctx.go('economy'));
  const lim = me.debtLimit ?? 150;
  if (me.debtRatio > lim * 0.85 && me.deficit > 3 && !me.finance?.debtCrisis) add(me.debtRatio > lim * 1.05 ? 'bad' : '', `Debt is ${Math.round(me.debtRatio)}% of GDP, near the ${Math.round(lim * 1.15)}% the markets will lend against while we keep borrowing (deficit ${pct(me.deficit)}). Cut the deficit below 3% to stay safe.`, () => ctx.go('economy', 'markets'));
  if (me.stability < 30) add('bad', `Stability is ${Math.round(me.stability)}. Protests and government crises are likely.`);
  if (me.approval < 30 && me.electionWeek != null && me.electionWeek - s.week < 26) add('bad', `An election is ${me.electionWeek - s.week} weeks away and approval is ${Math.round(me.approval)}%.`);
  // Markets, crises and the army
  const f = me.finance;
  if (f?.debtCrisis) add('bad', 'Debt crisis: the markets have stopped lending to us.', () => ctx.go('economy', 'markets'));
  if (f?.imf) add('', `IMF programme: the deficit must come down to 3% of GDP by week ${f.imf.until} (now ${pct(me.deficit)}).`, () => ctx.go('economy', 'markets'));
  if (f?.defaulted) add('bad', `In default until week ${f.defaulted.until}: we can't borrow.`, () => ctx.go('economy', 'markets'));
  if (f && f.fx < f.fxRef * 0.85) add('', `Our currency has fallen ${Math.round((1 - f.fx / f.fxRef) * 100)}% below its average: imports are getting dearer.`, () => ctx.go('economy', 'markets'));
  if (me.power?.plot) add('bad', 'Officers are plotting a coup against us.', () => ctx.go('government', 'power'));
  else if ((me.power?.risk ?? 0) >= 40) add('', `Coup risk is ${me.power.risk}%. Keep the army on side.`, () => ctx.go('government', 'power'));
  for (const x of s.crises?.active ?? []) {
    if (x.kind === 'pandemic' && (x.inf[s.me] ?? 0) > 0.5) add('bad', `The ${x.name} pandemic: ${x.inf[s.me]}% of our people are infected.`, () => ctx.go('world', 'crises'));
    if (x.kind === 'famine' && x.country === s.me) add('bad', 'Famine: our people are starving.', () => ctx.go('world', 'crises'));
    if (x.kind === 'crash' && x.hit >= 45) add('', `${x.name[0].toUpperCase()}${x.name.slice(1)} is dragging our economy down.`, () => ctx.go('world', 'crises'));
  }
  if (me.readiness < 1) add('', 'Defence funds ran out: military readiness is falling. Raise defence spending.', () => ctx.go('economy'));
  const enemies = s.wars.filter((w) => w.a === s.me || w.b === s.me);
  for (const w of enemies) {
    const foe = w.a === s.me ? w.b : w.a;
    const weeks = s.week - w.since;
    add('bad', weeks < 1 ? `At war with ${nationName(s, foe)}: the war has just begun.` : `At war with ${nationName(s, foe)} for ${weeks} week${weeks === 1 ? '' : 's'}.`, () => ctx.go('military'));
  }
  const lost = Object.values(s.regions).filter((r) => r[0] === s.me && r[1] !== s.me);
  if (lost.length) add('bad', `${lost.length} of our provinces are under enemy occupation.`);
  // The navy
  const blockaded = s.countries[s.me]?.blockaded ?? 0;
  if (blockaded >= 10) add('bad', `Enemy fleets are blockading us: ${blockaded}% of our sea trade is cut. Send our fleets to break it.`, () => ctx.go('military', 'navy'));
  const foes = new Set(enemies.map((w) => (w.a === s.me ? w.b : w.a)));
  const raiders = (s.fleets ?? []).filter((f) => foes.has(f.owner) && f.mission === 'blockade' && f.target === s.me);
  if (raiders.length && blockaded < 10) add('', `${raiders.length} enemy fleet${raiders.length > 1 ? 's are' : ' is'} sailing to blockade us.`, () => ctx.go('military', 'navy'));
  if ((me.refitUntil ?? -1) > s.week) add('', `Ships back from a lost sea battle are refitting in port for ${me.refitUntil - s.week} more weeks.`, () => ctx.go('military', 'navy'));
  // Peoples
  const restless = Object.entries(ctx.regionIndex).filter(([, i]) => s.regions[i][1] === s.me && (s.regions[i][13] ?? 50) < 20);
  if (restless.length) add('bad', `${restless.length} province${restless.length > 1 ? 's are' : ' is'} close to revolt (${restless.slice(0, 3).map(([id]) => regionName(id)).join(', ')}${restless.length > 3 ? '…' : ''}). Autonomy, better government or a crackdown can hold them.`, () => ctx.go('government', 'peoples'));
  if ((me.refugees ?? 0) / Math.max(1, me.pop) > 0.004) add('', `We are sheltering ${me.refugees >= 1 ? `${me.refugees.toFixed(1)} million` : `${Math.round(me.refugees * 1000)}K`} refugees, at ${money(me.refugeeCost ?? 0)} a year.`, () => ctx.go('government', 'peoples'));
  // Oil
  if (s.cartel?.embargo.includes(s.me)) add('bad', `${s.cartel.name} has embargoed our oil. Ration fuel and find other sellers.`, () => ctx.go('market', 'energy'));
  if (me.cartelCaught && me.cartelCheat) add('', `We have been caught breaking our ${s.cartel?.name ?? 'cartel'} quota. We risk being expelled.`, () => ctx.go('market', 'energy'));
  // Climate
  const p = me.pledgeDetail;
  if (p && !p.done && p.by - s.week < 104 && (me.emissions ?? 0) > (p.path ?? Infinity) * 1.05) add('', `Our climate pledge (${p.cut}% by ${p.year}) is off track and due in under two years. Breaking it costs standing.`, () => ctx.go('world', 'climate'));
  if (s.climate && s.climate.nextSummit - s.week <= 4 && s.climate.nextSummit >= s.week) add('info', 'A climate summit opens within a month: a pledge made now is noticed.', () => ctx.go('world', 'climate'));
  // Space
  const stalled = Object.entries(me.space?.prog ?? {}).filter(([, x]) => x.stalled);
  if (stalled.length) add('', 'A space programme has stalled: the treasury is too low to pay for it.', () => ctx.go('research', 'space'));
  if (!out.length) add('good', 'Nothing urgent. A good week to invest, trade and build alliances.');
  return h('div.stack-sm', out);
}

function inbox(ctx) {
  const s = ctx.state;
  const incoming = s.proposals.filter((p) => p.to === s.me);
  const items = [...(s.you.inbox ?? [])].reverse().slice(0, 30);
  return h('div.section',
    h('h3', 'Inbox'),
    incoming.length ? h('div.list', { style: { marginBottom: '10px' } }, incoming.map((p) => proposalCard(ctx, p))) : null,
    items.length ? h('div.list', items.map((m) => h('div.item', { class: m.region ? 'clickable' : '', onclick: m.region ? () => ctx.openRegion(m.region, true) : null },
      h('div.item-head', h('span.chip', { class: kindClass(m.kind) }, labelOf(m.kind)), h('span.muted.small', { style: { marginLeft: 'auto' } }, `week ${m.w}`)),
      h('div.meta', { style: { color: 'var(--ink)' } }, m.text)))) : h('div.empty', 'No reports yet.'));
}

export function proposalCard(ctx, p) {
  const s = ctx.state;
  return h('div.item',
    h('div.item-head', flag(p.from), h('span.name', nationName(s, p.from)), h('span.muted.small', `expires week ${p.expires}`)),
    h('div.meta', { style: { color: 'var(--ink)' } }, `Proposes ${describeProposal(s, p)}.`),
    h('div.actions',
      h('button.btn.small.primary', { onclick: () => ctx.send({ type: 'respond', id: p.id, accept: true }) }, p.kind === 'callToArms' ? 'Go to war' : 'Accept'),
      h('button.btn.small', { onclick: () => ctx.send({ type: 'respond', id: p.id, accept: false }) }, 'Decline'),
      s.countries[p.from]?.human ? h('button.btn.small.ghost', { onclick: () => ctx.chat.directTo(p.from) }, 'Reply') : null));
}

function kindClass(kind) {
  return { good: 'good', bad: 'bad', war: 'bad', nuclear: 'bad', warn: 'warn', proposal: 'accent', un: 'accent', decision: 'warn' }[kind] ?? '';
}
function labelOf(kind) {
  return { good: 'Good news', bad: 'Setback', war: 'War', nuclear: 'Nuclear', warn: 'Notice', proposal: 'Proposal', un: 'UN', info: 'Report', decision: 'Decision' }[kind] ?? 'Report';
}

export { regionName };
