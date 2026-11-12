// The news: everything the world has seen happen, newest first, and everything about one country. Secret
// moves (hidden pacts, weapons quietly built) never appear here; your own briefings do, under Briefings.

import { h, flag, nationName } from '../dom.js';

const KINDS = { war: 'bad', nuclear: 'bad', strike: 'bad', peace: 'good', election: 'accent', un: 'accent', disaster: 'warn', unrest: 'warn', trade: '', economy: '', diplomacy: '', incident: 'warn', info: '' };
const LABELS = { war: 'War', nuclear: 'Nuclear', strike: 'Strike', peace: 'Peace', election: 'Election', un: 'UN', disaster: 'Disaster', unrest: 'Unrest', trade: 'Trade', economy: 'Economy', diplomacy: 'Diplomacy', incident: 'Incident', info: 'News' };

export function news(ctx) {
  const tab = ctx.sub('news', 'world');
  const tabs = [['world', 'World news'], ['briefings', 'Our briefings']];
  return h('div',
    h('div.panel-title', h('h2', 'News'), h('span.muted.small', ctx.state.date)),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('news', id) }, label))),
    tab === 'world' ? world(ctx) : briefings(ctx));
}

function world(ctx) {
  const s = ctx.state;
  const all = ctx.newsLog();
  const country = ctx.ui.newsCountry ?? '';
  const kind = ctx.ui.newsKind ?? '';
  const q = (ctx.ui.newsQ ?? '').toLowerCase();
  const items = all.filter((n) => (!country || n.about?.includes(country)) && (!kind || n.kind === kind) && (!q || n.text.toLowerCase().includes(q)));
  const nations = [...new Set(all.flatMap((n) => n.about ?? []))].filter((id) => s.countries[id] || s.minors[id]).sort((a, b) => nationName(s, a).localeCompare(nationName(s, b)));
  const search = h('input', { placeholder: 'Search the news', value: ctx.ui.newsQ ?? '', 'aria-label': 'Search the news' });
  search.addEventListener('input', () => { ctx.ui.newsQ = search.value; ctx.rerender(); setTimeout(() => { const el = document.querySelector('#panel-body input'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, 0); });
  return h('div',
    h('div.row.gap', search,
      h('select', { style: { width: 'auto' }, 'aria-label': 'Country', onchange: (e) => { ctx.ui.newsCountry = e.target.value; ctx.rerender(); } },
        h('option', { value: '', selected: !country }, 'Every country'),
        nations.map((id) => h('option', { value: id, selected: id === country }, nationName(s, id))))),
    h('div.row.wrap.gap', { style: { marginTop: '8px' } },
      h('button.btn.small', { class: !kind ? 'primary' : 'ghost', onclick: () => { ctx.ui.newsKind = ''; ctx.rerender(); } }, 'All'),
      ...['war', 'diplomacy', 'trade', 'unrest', 'economy', 'election', 'un', 'disaster'].map((k) => h('button.btn.small', { class: kind === k ? 'primary' : 'ghost', onclick: () => { ctx.ui.newsKind = k; ctx.rerender(); } }, LABELS[k]))),
    country ? h('div.row.between', { style: { marginTop: '10px' } },
      h('div.row.gap', flag(country, true), h('div', h('h3', nationName(s, country)), h('div.muted.small', `${items.length} reports`))),
      h('div.row.gap', s.countries[country] ? h('button.btn.small.ghost', { onclick: () => ctx.openCountry(country) }, 'Dossier') : null, h('button.btn.small.ghost', { onclick: () => ctx.focusCountry(country) }, 'Map'))) : null,
    h('div.list', { style: { marginTop: '10px' } }, items.length ? items.slice(0, 200).map((n) => item(ctx, n)) : [h('div.empty', 'Nothing yet.')]));
}

function item(ctx, n) {
  const s = ctx.state;
  return h('div.item',
    h('div.item-head', h('span.chip', { class: KINDS[n.kind] ?? '' }, LABELS[n.kind] ?? n.kind), h('span.muted.small', { style: { marginLeft: 'auto' } }, `week ${n.w}`)),
    h('div.meta', { style: { color: 'var(--ink)' } }, n.text),
    n.about?.length ? h('div.row.wrap.gap', { style: { marginTop: '6px' } }, [...new Set(n.about)].filter((id) => s.countries[id] || s.minors[id]).map((id) => h('button.chip', { style: { cursor: 'pointer' }, onclick: () => { ctx.ui.newsCountry = id; ctx.rerender(); } }, flag(id), nationName(s, id)))) : null);
}

function briefings(ctx) {
  const s = ctx.state;
  const items = [...(s.you.inbox ?? [])].reverse();
  return h('div',
    h('p.muted.small', 'Reports meant for you alone: from your generals, ministers, diplomats and trade officials.'),
    h('div.list', { style: { marginTop: '10px' } }, items.length ? items.map((m) => h('div.item', { class: m.region ? 'clickable' : '', onclick: m.region ? () => ctx.openRegion(m.region, true) : null },
      h('div.item-head', h('span.chip', { class: { good: 'good', bad: 'bad', war: 'bad', nuclear: 'bad', warn: 'warn', proposal: 'accent', un: 'accent' }[m.kind] ?? '' }, { good: 'Good news', bad: 'Setback', war: 'War', nuclear: 'Nuclear', warn: 'Notice', proposal: 'Proposal', un: 'UN' }[m.kind] ?? 'Report'), h('span.muted.small', { style: { marginLeft: 'auto' } }, `week ${m.w}`)),
      h('div.meta', { style: { color: 'var(--ink)' } }, m.text))) : [h('div.empty', 'No briefings yet.')]));
}
