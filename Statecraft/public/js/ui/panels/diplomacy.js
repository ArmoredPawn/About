// Foreign affairs: every country's dossier, proposals, alliances, the UN and the world's straits.

import { h, flag, money, pct, nationName, regionName, troops, num, relBar } from '../dom.js';
import { RESOURCES, RESOURCE_INFO } from '../../engine/data/regions.js';
import { TECH_FIELDS, CHOKEPOINTS } from '../../engine/data/world.js';
import { modal, numberField, selectField, confirmBox } from '../dialogs.js';
import { proposalCard } from './overview.js';
import { describeProposal } from '../describe.js';

const TARIFFS = [0, 10, 25, 50, 100];

export function diplomacy(ctx) {
  const dossierId = ctx.ui.dossier;
  if (dossierId) return dossier(ctx, dossierId);
  const tab = ctx.sub('diplomacy', 'countries');
  const tabs = [['countries', 'Countries'], ['proposals', 'Proposals'], ['alliances', 'Alliances'], ['un', 'UN'], ['world', 'Straits & more']];
  return h('div',
    h('div.panel-title', h('h2', 'Diplomacy'), h('span.muted.small', `Standing ${Math.round(ctx.state.you.rep)}`)),
    h('div.tabs', { role: 'tablist' }, tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => ctx.setSub('diplomacy', id) }, label,
      id === 'proposals' && ctx.state.proposals.some((p) => p.to === ctx.state.me) ? ' •' : '',
      id === 'un' && ctx.state.un.some((r) => !r.done && !r.votes[ctx.state.me]) ? ' •' : ''))),
    { countries, proposals, alliances, un, world }[tab](ctx));
}

/* ---------- Relationship helpers ---------- */

export function relations(s, id) {
  const me = s.me;
  const tags = [];
  if (s.wars.some((w) => (w.a === me && w.b === id) || (w.b === me && w.a === id))) tags.push(['At war', 'bad']);
  for (const al of s.alliances) if (al.members.includes(me) && al.members.includes(id)) tags.push([al.name, al.kind === 'military' ? 'accent' : 'good']);
  for (const t of s.treaties) {
    if (!((t.a === me && t.b === id) || (t.b === me && t.a === id))) continue;
    const label = { fta: 'Free trade', nap: 'Non-aggression', access: 'Military access', armistice: 'Armistice' }[t.kind];
    if (label) tags.push([label, t.kind === 'armistice' ? 'warn' : '']);
  }
  if (s.sanctions.includes(`${me}>${id}`)) tags.push(['We sanction', 'warn']);
  if (s.sanctions.includes(`${id}>${me}`)) tags.push(['Sanctions us', 'bad']);
  if (s.minors[id]?.puppetOf === me) tags.push(['Our puppet', 'accent']);
  return tags;
}

/* ---------- Countries ---------- */

function countries(ctx) {
  const s = ctx.state;
  const q = (ctx.ui.search ?? '').toLowerCase();
  const sort = ctx.ui.sort ?? 'power';
  const list = Object.entries(s.countries).filter(([id, c]) => id !== s.me && (!q || c.name.toLowerCase().includes(q) || (c.human ?? '').toLowerCase().includes(q)));
  list.sort(([a, ca], [b, cb]) => sort === 'relations' ? (s.rel[b] ?? 0) - (s.rel[a] ?? 0) : sort === 'name' ? ca.name.localeCompare(cb.name) : (s.ranks.find((r) => r.id === a)?.rank ?? 99) - (s.ranks.find((r) => r.id === b)?.rank ?? 99));
  const search = h('input', { placeholder: 'Search countries or leaders', value: ctx.ui.search ?? '', 'aria-label': 'Search' });
  search.addEventListener('input', () => { ctx.ui.search = search.value; ctx.rerender(); setTimeout(() => { const el = document.querySelector('#panel-body input'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, 0); });
  return h('div',
    h('div.row.gap', search, h('select', { style: { width: 'auto' }, onchange: (e) => { ctx.ui.sort = e.target.value; ctx.rerender(); } }, [['power', 'By power'], ['relations', 'By relations'], ['name', 'A–Z']].map(([v, l]) => h('option', { value: v, selected: v === sort }, l)))),
    h('div.list', { style: { marginTop: '10px' } }, list.map(([id, c]) => h('div.item.clickable', { onclick: () => ctx.openCountry(id) },
      h('div.item-head', flag(id), h('span.name', c.name), c.human ? h('span.chip.accent', c.human) : null, relBar(s.rel[id] ?? 0)),
      h('div.row.wrap.gap', { style: { marginTop: '6px' } }, h('span.muted.small', `${money(c.gdp)} · ${troops(c.mil.troops)} troops`), ...relations(s, id).map(([t, k]) => h('span.chip', { class: k }, t)))))));
}

/* ---------- Dossier ---------- */

export function dossier(ctx, id) {
  const s = ctx.state;
  const back = h('button.btn.small.ghost', { onclick: () => { ctx.ui.dossier = null; ctx.rerender(); } }, '← All countries');
  if (s.minors[id]) return minorDossier(ctx, id, back);
  const c = s.countries[id];
  const me = s.you;
  const atWar = s.wars.some((w) => (w.a === s.me && w.b === id) || (w.b === s.me && w.a === id));
  const myWars = s.wars.filter((w) => w.a === s.me || w.b === s.me).map((w) => (w.a === s.me ? w.b : w.a)).filter((e) => e !== id);
  const myAlliances = s.alliances.filter((a) => a.members.includes(s.me) && !a.members.includes(id));
  const tariff = s.tariffs[`${s.me}>${id}`] ?? 0;
  const sanctioning = s.sanctions.includes(`${s.me}>${id}`);
  const cool = me.cooldown[`emb:${id}`] ?? -1;
  const embassyReady = cool <= s.week;
  const intel = c.intel;

  const stat = (label, value) => h('div.kpi', h('span', label), h('b', value));
  return h('div',
    h('div.row.between', back, h('button.btn.small.ghost', { onclick: () => ctx.focusCountry(id) }, 'Show on map')),
    h('div.panel-title', { style: { marginTop: '10px' } },
      h('div.row.gap', flag(id, true), h('div', h('h2', c.name), h('div.muted.small', c.exile ? 'Government in exile' : `${c.title}: ${c.human ?? 'computer-run'} · ${{ democracy: 'Democracy', hybrid: 'Hybrid regime', autocracy: 'Autocracy' }[c.gov]}`)))),
    h('div.row.wrap.gap', relBar(s.rel[id] ?? 0), h('span.small.muted', `Relations ${s.rel[id] > 0 ? '+' : ''}${s.rel[id] ?? 0}`), ...relations(s, id).map(([t, k]) => h('span.chip', { class: k }, t))),
    intel ? h('div.warning.good', { style: { marginTop: '10px' } }, 'Our agents are inside their government: you see their full picture.') : null,
    h('div.kpis', { style: { marginTop: '12px' } },
      stat('GDP', money(c.gdp)), stat('Growth', pct(c.growth, 1, true)), stat('Population', `${Math.round(c.pop)}M`),
      stat('Approval', c.approval != null ? `${c.approval}%` : 'unknown'), stat('Stability', c.stability != null ? String(c.stability) : 'unknown'), stat('Standing', String(c.rep)),
      stat('Troops', troops(c.mil.troops)), stat('Tanks', num(c.mil.tanks)), stat('Aircraft', num(c.mil.aircraft)),
      stat('Warships', num(c.mil.ships)), c.mil.carriers ? stat('Carriers', num(c.mil.carriers)) : null, stat('Missiles', num(c.mil.missiles)), stat('Warheads', c.mil.nukes ? num(c.mil.nukes) : c.nukeProgram ? (typeof c.nukeProgram === 'number' ? `programme ${c.nukeProgram}%` : 'programme!') : 'none'),
      intel ? stat('Reserves', money(c.treasury)) : null, stat('Debt', `${c.debt}%`), stat('Inflation', pct(c.infl)),
      stat('Conscription', { volunteer: 'Volunteers', selective: 'Selective', national: 'National service', total: 'Total draft' }[c.conscription] ?? '—')),
    c.civilWar ? h('div.warning.bad', { style: { marginTop: '10px' } }, `${c.name} is in civil war.`) : null,
    c.protests?.length ? h('div.warning', { style: { marginTop: '10px' } }, `Protests: ${c.protests.map((p) => `${({ schools: 'school cuts', hospitals: 'hospital cuts', pensions: 'pension cuts', taxes: 'taxes', prices: 'cost of living', shortages: 'shortages', jobs: 'jobs', war: 'the war', draft: 'the draft', rights: 'repression', opposition: 'opposition rallies', occupation: 'occupation' })[p.cause] ?? p.cause} (${p.size}%)`).join(', ')}.`) : null,
    c.exile ? null : h('div.section', h('h3', 'Talk'),
      c.human
        ? h('button.btn.small.primary', { onclick: () => ctx.chat.directTo(id) }, `Message ${c.human}`)
        : h('p.muted.small', 'This country is run by the computer. It judges proposals on their merits and its relations with you.')),
    c.exile ? null : h('div.section', h('h3', 'Propose'),
      h('div.row.wrap.gap',
        atWar ? null : h('button.btn.small', { onclick: () => ctx.send({ type: 'propose', to: id, kind: 'fta' }) }, 'Free trade'),
        atWar ? null : h('button.btn.small', { onclick: () => ctx.send({ type: 'propose', to: id, kind: 'nap' }) }, 'Non-aggression pact'),
        atWar ? null : h('button.btn.small', { onclick: () => ctx.send({ type: 'propose', to: id, kind: 'access' }) }, 'Military access'),
        !atWar && myAlliances.length ? h('button.btn.small', { onclick: () => inviteDialog(ctx, id, myAlliances) }, 'Invite to alliance…') : null,
        atWar ? null : h('button.btn.small', { onclick: () => dealDialog(ctx, id) }, 'Resource deal…'),
        atWar ? null : h('button.btn.small', { onclick: () => loanDialog(ctx, id) }, 'Offer a loan…'),
        !atWar && myWars.length ? h('button.btn.small', { onclick: () => joinWarDialog(ctx, id, myWars) }, 'Ask to join our war…') : null,
        atWar ? h('button.btn.small.primary', { onclick: () => peaceDialog(ctx, id) }, 'Offer peace…') : null)),
    c.exile || atWar ? null : h('div.section', h('h3', 'Give'),
      h('div.row.wrap.gap',
        h('button.btn.small', { onclick: () => aidDialog(ctx, id) }, 'Send aid…'),
        h('button.btn.small', { onclick: () => techDialog(ctx, id) }, 'Share technology…'))),
    c.exile ? null : h('div.section', h('h3', 'Pressure'),
      h('div.row.wrap.gap',
        h('button.btn.small', { disabled: !embassyReady, onclick: () => ctx.send({ type: 'embassy', target: id, action: 'improve' }) }, 'Improve relations'),
        h('button.btn.small', { disabled: !embassyReady, onclick: () => ctx.send({ type: 'embassy', target: id, action: 'condemn' }) }, 'Condemn publicly'),
        h('button.btn.small', { disabled: !embassyReady, onclick: () => ctx.send({ type: 'embassy', target: id, action: 'expel' }) }, 'Expel diplomats'),
        h('button.btn.small', { class: sanctioning ? 'danger' : '', onclick: () => ctx.send({ type: 'sanction', target: id, on: !sanctioning }) }, sanctioning ? 'Lift sanctions' : 'Impose sanctions')),
      embassyReady ? null : h('p.muted.small', { style: { marginTop: '6px' } }, `Diplomats ready again in ${cool - s.week} weeks.`),
      h('div.row.gap', { style: { marginTop: '10px' } }, h('span.small', 'Tariff on their goods'),
        h('div.seg.grow', TARIFFS.map((t) => h('button', { 'aria-pressed': String(t === tariff), onclick: () => ctx.send({ type: 'tariff', target: id, level: t }) }, `${t}%`))))),
    c.exile ? null : h('div.section', h('h3', 'Intelligence'),
      h('p.muted.small', me.spies?.[id] ? `${me.spies[id].agents} of our agents are inside ${c.name}.` : `We have no agents in ${c.name}.`),
      h('div.row.wrap.gap', { style: { marginTop: '6px' } },
        h('button.btn.small', { onclick: () => { ctx.ui.opTarget = id; ctx.go('spies', 'ops'); } }, 'Covert operations…'),
        me.spies?.[id] ? h('button.btn.small', { onclick: () => { ctx.ui.spyFilter = id; ctx.go('spies', 'reports'); } }, 'Agent reports') : null,
        h('button.btn.small.ghost', { onclick: () => { ctx.ui.newsCountry = id; ctx.go('news', 'world'); } }, 'News about them'))),
    c.exile ? null : h('div.section', h('h3', 'War'),
      atWar
        ? h('p.muted.small', 'Plan operations from the Military tab or by clicking their provinces on the map.')
        : h('button.btn.danger', { onclick: () => declareWar(ctx, id) }, `Declare war on ${c.name}…`)),
  );
}

function minorDossier(ctx, id, back) {
  const s = ctx.state;
  const m = s.minors[id];
  const atWar = s.wars.some((w) => (w.a === s.me && w.b === id) || (w.b === s.me && w.a === id));
  const res = s.resources[id];
  return h('div',
    h('div.row.between', back, h('button.btn.small.ghost', { onclick: () => ctx.focusCountry(id) }, 'Show on map')),
    h('div.panel-title', { style: { marginTop: '10px' } }, h('div', h('h2', m.name), h('div.muted.small', m.annexed ? 'Annexed' : m.puppetOf ? `Puppet of ${nationName(s, m.puppetOf)}` : m.capitulated ? 'Surrendered' : 'Independent, run by the computer'))),
    h('div.kpis', h('div.kpi', h('span', 'GDP'), h('b', money(m.gdp))), h('div.kpi', h('span', 'Population'), h('b', `${m.pop}M`)), h('div.kpi', h('span', 'Troops'), h('b', troops(m.troops)))),
    m.guarantor ? h('div.warning.info', { style: { marginTop: '10px' } }, `${nationName(s, m.guarantor)} is committed to its defence.`) : null,
    m.nukes ? h('div.warning.bad', { style: { marginTop: '10px' } }, `It has about ${m.nukes} nuclear warheads.`) : null,
    res ? h('div.section', h('h3', 'Resources'), h('div.list', Object.entries(res).map(([r, [cur, pot]]) => h('div.meta', `${RESOURCE_INFO[r].name}: ${cur}${pot > cur ? ` (up to ${pot})` : ''} ${RESOURCE_INFO[r].unit}`)))) : null,
    m.settle ? h('div.section', h('h3', 'It has surrendered to you'),
      h('div.row.gap', h('button.btn.primary', { onclick: () => ctx.send({ type: 'settle', minor: id, how: 'puppet' }) }, 'Install a friendly government'), h('button.btn.danger', { onclick: () => ctx.send({ type: 'settle', minor: id, how: 'annex' }) }, 'Annex it')),
      h('p.muted.small', { style: { marginTop: '6px' } }, 'A puppet pays tribute and keeps its own forces; annexation adds it to your country but costs more standing and brings unrest.')) : null,
    h('div.section', h('h3', 'War'),
      atWar ? h('p.muted.small', 'At war. Take its land to force a surrender.') : m.annexed || m.puppetOf === s.me ? null : h('button.btn.danger', { onclick: () => declareWar(ctx, id) }, `Invade ${m.name}…`)),
  );
}

// One click: any alliance or trade bloc we share with them is left as part of declaring war
export async function declareWar(ctx, id) {
  const s = ctx.state;
  const shared = s.alliances.filter((al) => al.members.includes(s.me) && al.members.includes(id));
  const defenders = new Set();
  for (const al of s.alliances) if (al.kind === 'military' && al.members.includes(id)) for (const m of al.members) if (m !== id && m !== s.me) defenders.add(m);
  const g = s.minors[id]?.guarantor;
  if (g && g !== s.me) defenders.add(g);
  const claim = s.you.claims.some((rid) => s.regions[ctx.regionIndex[rid]]?.[1] === id);
  const body = h('div.stack',
    h('p', `War with ${nationName(s, id)} will cost world standing${claim ? ' (less, since you have a claim on its land)' : ''} and may bring sanctions from its friends.`),
    shared.length ? h('div.warning.warn', `You'll leave ${shared.map((al) => al.name).join(' and ')} as you declare war. Its other members will think less of you.`) : null,
    defenders.size ? h('div.warning.bad', `Its allies may join the war: ${[...defenders].map((d) => nationName(s, d)).join(', ')}.`) : h('div.warning.info', 'It has no allies bound to defend it.'),
    s.treaties.some((t) => t.kind === 'nap' && ((t.a === s.me && t.b === id) || (t.b === s.me && t.a === id))) ? h('div.warning.bad', 'You have a non-aggression pact with them. Breaking it will badly damage your standing.') : null);
  if (!(await confirmBox(`Declare war on ${nationName(s, id)}?`, body, { ok: shared.length ? 'Leave & declare war' : 'Declare war', danger: true }))) return;
  if (!(await ctx.send({ type: 'war', target: id }))) ctx.toast(`We are at war with ${nationName(s, id)}. Pick an army group and press Attack, or click one of its provinces.`, 'war');
}

function inviteDialog(ctx, id, alliances) {
  const sel = selectField('Alliance', alliances.map((a) => [a.id, `${a.name} (${a.kind === 'military' ? 'military' : 'trade bloc'})`]));
  modal({ title: `Invite ${nationName(ctx.state, id)}`, body: sel.el, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Invite', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'allianceInvite', id: sel.input.value, to: id })) || false }] });
}

function dealDialog(ctx, id) {
  const s = ctx.state;
  const me = s.you;
  const who = selectField('Who sells', [[s.me, `We sell to ${nationName(s, id)}`], [id, `${nationName(s, id)} sells to us`]], s.me);
  const res = selectField('Resource', RESOURCES.map((r) => [r, `${RESOURCE_INFO[r].name} (${RESOURCE_INFO[r].unit} a year)`]), 'oil');
  const qty = numberField('Amount a year', { value: 1, min: 0.01, step: 'any' });
  const price = numberField('Price a year', { value: 0, min: 0, step: 'any', suffix: '$ billions' });
  const weeks = numberField('Length', { value: 104, min: 4, max: 520, step: 1, suffix: 'weeks' });
  const hint = h('p.muted.small');
  const suggest = () => {
    const r = res.input.value;
    const info = RESOURCE_INFO[r];
    const surplus = (me.prod[r] ?? 0) - (me.demand[r] ?? 0);
    if (!qty.input.dataset.touched) qty.input.value = Math.max(0.01, Math.abs(surplus) > 0 ? Math.round(Math.abs(surplus) * 0.25 * 100) / 100 : 1);
    const value = Number(qty.input.value) * info.value * s.market.price[r];
    if (!price.input.dataset.touched) price.input.value = Math.round(value * 10) / 10;
    hint.textContent = `World market value: ${money(value)} a year. We produce ${fmt(me.prod[r])} and need ${fmt(me.demand[r])} ${info.unit}. Deliveries come from stocks each week.`;
  };
  qty.input.addEventListener('input', () => { qty.input.dataset.touched = '1'; suggest(); });
  price.input.addEventListener('input', () => { price.input.dataset.touched = '1'; });
  res.input.addEventListener('change', () => { delete qty.input.dataset.touched; delete price.input.dataset.touched; suggest(); });
  suggest();
  modal({
    title: `Resource deal with ${nationName(s, id)}`,
    body: h('div.stack', who.el, res.el, qty.el, price.el, weeks.el, hint),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Propose', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'propose', to: id, kind: 'deal', terms: { seller: who.input.value, res: res.input.value, qty: Number(qty.input.value), price: Number(price.input.value), weeks: Number(weeks.input.value) } })) || false }],
  });
}

function fmt(v) { return v == null ? '0' : v >= 10 ? Math.round(v).toString() : v.toFixed(2); }

function loanDialog(ctx, id) {
  const me = ctx.state.you;
  const amount = numberField('Amount', { value: Math.round(Math.min(me.treasury, ctx.state.countries[id].gdp * 0.02)), min: 1, max: Math.floor(me.treasury), suffix: '$ billions' });
  const years = numberField('Repaid over', { value: 10, min: 1, max: 30, step: 1, suffix: 'years' });
  const rate = numberField('Interest', { value: 4, min: 0, max: 25, step: 0.25, suffix: '%' });
  modal({
    title: `Offer ${nationName(ctx.state, id)} a loan`,
    body: h('div.stack', h('p.muted.small', `Lent from our reserves (${money(me.treasury)}). Repayments arrive every week.`), amount.el, years.el, rate.el),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Offer', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'propose', to: id, kind: 'loan', terms: { amount: Number(amount.input.value), years: Number(years.input.value), rate: Number(rate.input.value) } })) || false }],
  });
}

function joinWarDialog(ctx, id, enemies) {
  const sel = selectField('Against', enemies.map((e) => [e, nationName(ctx.state, e)]));
  modal({ title: `Ask ${nationName(ctx.state, id)} to join the war`, body: sel.el, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Ask', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'propose', to: id, kind: 'joinWar', terms: { enemy: sel.input.value } })) || false }] });
}

function aidDialog(ctx, id) {
  const me = ctx.state.you;
  const amount = numberField('Amount', { value: Math.round(Math.min(me.treasury * 0.1, 10)), min: 0.1, max: Math.floor(me.treasury), suffix: '$ billions' });
  modal({ title: `Send aid to ${nationName(ctx.state, id)}`, body: h('div.stack', h('p.muted.small', `From reserves of ${money(me.treasury)}. Improves relations.`), amount.el), actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Send', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'aid', to: id, amount: Number(amount.input.value) })) || false }] });
}

function techDialog(ctx, id) {
  const me = ctx.state.you;
  const sel = selectField('Field', Object.entries(TECH_FIELDS).map(([f, d]) => [f, `${d.name} (we are level ${me.tech[f]})`]));
  modal({ title: `Share technology with ${nationName(ctx.state, id)}`, body: h('div.stack', h('p.muted.small', 'Gives them half a level of progress in a field where we lead.'), sel.el), actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Share', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'tech', to: id, field: sel.input.value })) || false }] });
}

/* ---------- Peace ---------- */

export function peaceDialog(ctx, foe) {
  const s = ctx.state;
  const kind = selectField('Kind of settlement', [['white', 'Peace: everyone goes home'], ['terms', 'Peace with terms'], ['armistice', 'Armistice: freeze the front line']], 'white');
  const disputed = [];
  for (const [id, i] of Object.entries(ctx.regionIndex)) {
    const [owner, ctrl] = s.regions[i];
    if (owner === foe && ctrl === s.me) disputed.push([id, s.me]);
    if (owner === s.me && ctrl === foe) disputed.push([id, foe]);
  }
  const boxes = disputed.map(([id, to]) => [id, to, h('input', { type: 'checkbox', checked: to === s.me })]);
  const payer = selectField('Reparations paid by', [['', 'No reparations'], [foe, nationName(s, foe)], [s.me, 'Us']], '');
  const amount = numberField('Reparations a year', { value: 0, min: 0, suffix: '$ billions' });
  const terms = h('div.stack',
    disputed.length ? h('div.field', h('span', 'Provinces that change hands (ticked) — the rest return to their owner'),
      h('div.choice-grid', boxes.map(([id, to, box]) => h('label.choice', box, h('span', `${regionName(id)} → ${to === s.me ? 'us' : nationName(s, foe)}`))))) : h('p.muted.small', 'Neither side occupies the other\'s land.'),
    payer.el, amount.el);
  const sync = () => { terms.hidden = kind.input.value !== 'terms'; };
  kind.input.addEventListener('change', sync);
  sync();
  modal({
    title: `Peace with ${nationName(s, foe)}`,
    body: h('div.stack', kind.el, terms),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Propose', kind: 'primary', onClick: async () => {
        const t = {};
        if (kind.input.value === 'armistice') t.armistice = true;
        if (kind.input.value === 'terms') {
          t.cede = boxes.filter(([, , b]) => b.checked).map(([region, to]) => ({ region, to }));
          if (payer.input.value && Number(amount.input.value) > 0) t.reparations = { from: payer.input.value, amount: Number(amount.input.value), years: 5 };
        }
        return !(await ctx.send({ type: 'propose', to: foe, kind: 'peace', terms: t })) || false;
      },
    }],
  });
}

/* ---------- Proposals ---------- */

function proposals(ctx) {
  const s = ctx.state;
  const incoming = s.proposals.filter((p) => p.to === s.me);
  const outgoing = s.proposals.filter((p) => p.from === s.me);
  return h('div',
    h('div.section', h('h3', 'Waiting for your answer'), incoming.length ? h('div.list', incoming.map((p) => proposalCard(ctx, p))) : h('div.empty', 'Nothing waiting.')),
    h('div.section', h('h3', 'Sent by you'), outgoing.length ? h('div.list', outgoing.map((p) => h('div.item', h('div.item-head', flag(p.to), h('span.name', nationName(s, p.to)), h('span.muted.small', `until week ${p.expires}`)), h('div.meta', describeProposal(s, p))))) : h('div.empty', 'None. Open a country to propose a deal.')));
}

/* ---------- Alliances ---------- */

function alliances(ctx) {
  const s = ctx.state;
  const mine = s.alliances.filter((a) => a.members.includes(s.me));
  const others = s.alliances.filter((a) => !a.members.includes(s.me));
  const card = (a, member) => h('div.item',
    h('div.item-head', h('span.name', a.name), a.secret ? h('span.chip.warn', 'Secret') : null, h('span.chip', { class: a.kind === 'military' ? 'accent' : 'good' }, a.kind === 'military' ? 'Military' : 'Trade bloc')),
    h('div.row.wrap.gap', { style: { marginTop: '6px' } }, a.members.map((m) => h('span.chip', { style: { cursor: 'pointer' }, onclick: () => ctx.openCountry(m) }, flag(m), nationName(s, m)))),
    member ? h('div.actions',
      h('button.btn.small', { onclick: () => inviteMany(ctx, a) }, 'Invite…'),
      a.secret ? h('button.btn.small', { onclick: async () => { if (await confirmBox(`Make ${a.name} public?`, 'The world will learn who is in it. A public pact deters attackers; it can\'t be made secret again.')) ctx.send({ type: 'allianceReveal', id: a.id }); } }, 'Announce it') : null,
      a.members.some((m) => m !== s.me && s.countries[m]?.human) ? h('button.btn.small', { onclick: () => { ctx.chat.toggle(true); ctx.chat.show(`al:${a.id}`); } }, 'Alliance chat') : null,
      h('button.btn.small.ghost', { onclick: async () => { if (await confirmBox(`Leave ${a.name}?`, 'Its members will think less of you, and you lose their protection.')) ctx.send({ type: 'allianceLeave', id: a.id }); } }, 'Leave')) : null);
  return h('div',
    h('button.btn.primary.block', { onclick: () => newAlliance(ctx) }, '＋ Found an alliance or trade bloc'),
    h('p.muted.small', { style: { marginTop: '6px' } }, 'Military allies are called to fight when a member is attacked. Trade blocs give free trade between members. Every alliance gets a chat for its leaders.'),
    h('div.section', h('h3', 'Ours'), mine.length ? h('div.list', mine.map((a) => card(a, true))) : h('div.empty', 'We are in no alliances.')),
    h('div.section', h('h3', 'Others'), others.length ? h('div.list', others.map((a) => card(a, false))) : h('div.empty', 'None.')));
}

function pickCountries(ctx, exclude = []) {
  const s = ctx.state;
  return Object.entries(s.countries).filter(([id, c]) => id !== s.me && !exclude.includes(id) && !c.exile)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id, c]) => [id, h('input', { type: 'checkbox', value: id }), c]);
}

function newAlliance(ctx) {
  const name = h('input', { maxlength: 40, placeholder: 'e.g. Indo-Pacific Pact' });
  const kind = selectField('Kind', [['military', 'Military alliance (mutual defence)'], ['economic', 'Trade bloc (free trade)']], 'military');
  const secret = h('input', { type: 'checkbox' });
  const boxes = pickCountries(ctx);
  modal({
    title: 'Found an alliance',
    body: h('div.stack', h('label.field', h('span', 'Name'), name), kind.el,
      h('label.choice', secret, h('span', h('b', 'Secret pact'), h('span.muted', ': only members (and spies inside them) know. It is revealed if a member goes to war for another.'))),
      h('div.field', h('span', 'Invite'), h('div.choice-grid', boxes.map(([id, box, c]) => h('label.choice', box, flag(id), c.name, c.human ? h('span.faint', ' ★') : null))))),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Found it', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'allianceCreate', name: name.value, kind: kind.input.value, secret: secret.checked, invite: boxes.filter(([, b]) => b.checked).map(([id]) => id) })) || false }],
  });
}

function inviteMany(ctx, a) {
  const boxes = pickCountries(ctx, a.members);
  modal({
    title: `Invite to ${a.name}`,
    body: h('div.choice-grid', boxes.map(([id, box, c]) => h('label.choice', box, flag(id), c.name))),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Invite', kind: 'primary', onClick: async () => { for (const [id, b] of boxes) if (b.checked) await ctx.send({ type: 'allianceInvite', id: a.id, to: id }); } }],
  });
}

/* ---------- The UN ---------- */

function un(ctx) {
  const s = ctx.state;
  const open = s.un.filter((r) => !r.done);
  const past = s.un.filter((r) => r.done).slice(-8).reverse();
  const verbs = { condemn: 'Condemn', sanction: 'Sanction', ceasefire: 'Ceasefire demand on' };
  const target = selectField('Country', Object.entries(s.countries).filter(([id, c]) => id !== s.me && !c.exile).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, c]) => [id, c.name]));
  const kind = selectField('Resolution', [['condemn', 'Condemn (standing falls)'], ['sanction', 'Sanctions (every yes vote sanctions them)'], ['ceasefire', 'Demand a ceasefire']], 'condemn');
  const wait = (s.you.cooldown.un ?? -1) - s.week;
  return h('div',
    h('p.muted.small', 'Every country votes; a resolution passes with more yes than no votes, unless a permanent member (US, China, Russia, UK, France) votes no.'),
    h('div.section', h('h3', 'Open votes'), open.length ? h('div.list', open.map((r) => h('div.item',
      h('div.item-head', flag(r.target), h('span.name', `${verbs[r.kind]} ${nationName(s, r.target)}`), h('span.muted.small', `closes week ${r.ends}`)),
      h('div.meta', `Tabled by ${nationName(s, r.by)} · ${r.count} votes cast`),
      h('div.actions', ['yes', 'no', 'abstain'].map((v) => h('button.btn.small', { class: r.votes[s.me] === v ? 'primary' : '', onclick: () => ctx.send({ type: 'unVote', id: r.id, vote: v }) }, v[0].toUpperCase() + v.slice(1))))))) : h('div.empty', 'No votes open.')),
    h('div.section', h('h3', 'Table a resolution'), h('div.stack', target.el, kind.el, h('button.btn.small', { disabled: wait > 0, onclick: () => ctx.send({ type: 'unPropose', kind: kind.input.value, target: target.input.value }) }, wait > 0 ? `Available in ${wait} weeks` : 'Table it'))),
    h('div.section', h('h3', 'Recent results'), past.length ? h('div.list', past.map((r) => h('div.item', h('div.item-head', h('span.name', `${verbs[r.kind]} ${nationName(s, r.target)}`), h('span.chip', { class: r.passed ? 'good' : 'bad' }, r.passed ? 'Passed' : r.vetoes?.length ? 'Vetoed' : 'Failed')), h('div.meta', `${r.tally?.yes ?? 0} yes · ${r.tally?.no ?? 0} no · ${r.tally?.abstain ?? 0} abstain${r.vetoes?.length ? ` · veto: ${r.vetoes.map((v) => nationName(s, v)).join(', ')}` : ''}`)))) : h('div.empty', 'No votes yet.')));
}

/* ---------- Straits and surrendered nations ---------- */

function world(ctx) {
  const s = ctx.state;
  const settle = Object.entries(s.minors).filter(([, m]) => m.settle);
  const puppets = Object.entries(s.minors).filter(([, m]) => m.puppetOf === s.me);
  return h('div',
    settle.length ? h('div.section', h('h3', 'Surrendered to you'), h('div.list', settle.map(([id, m]) => h('div.item.clickable', { onclick: () => ctx.openCountry(id) }, h('div.item-head', h('span.name', m.name), h('span.chip.good', 'Decide')))))) : null,
    h('div.section', h('h3', 'Shipping chokepoints'),
      h('p.muted.small', 'Hold a strait and you can close it, charge a toll or turn it on enemy shipping; any navy in reach can patrol one.'),
      h('button.btn.small', { style: { margin: '6px 0' }, onclick: () => ctx.go('market', 'straits') }, 'Tolls, patrols and policies…'),
      h('div.list', { style: { marginTop: '8px' } }, Object.entries(CHOKEPOINTS).map(([key, cp]) => {
        const closedBy = s.chokepoints[key]?.closedBy;
        const holders = [...new Set(cp.regions.map((r) => s.regions[ctx.regionIndex[r]]?.[1]).filter(Boolean))];
        const mine = holders.includes(s.me);
        return h('div.item',
          h('div.item-head', h('span.name', cp.name), h('span.chip', { class: closedBy ? 'bad' : 'good' }, closedBy ? `Closed by ${nationName(s, closedBy)}` : 'Open')),
          h('div.meta', cp.note),
          h('div.meta', `Shores held by ${holders.map((x) => nationName(s, x)).join(', ')}`),
          mine ? h('div.actions', closedBy === s.me
            ? h('button.btn.small', { onclick: () => ctx.send({ type: 'strait', key, close: false }) }, 'Reopen')
            : closedBy ? null : h('button.btn.small.danger', { onclick: async () => { if (await confirmBox(`Close the ${cp.name}?`, 'Shipping prices will spike, trading partners will be furious and world standing will fall.', { ok: 'Close it', danger: true })) ctx.send({ type: 'strait', key, close: true }); } }, 'Close it')) : null);
      }))),
    puppets.length ? h('div.section', h('h3', 'Our puppet states'), h('div.row.wrap.gap', puppets.map(([id, m]) => h('span.chip', m.name)))) : null,
    h('div.section', h('h3', 'Annex occupied land'), h('p.muted.small', 'Click a province your forces occupy and choose "Annex". Most of the world will refuse to recognise it.')),
  );
}
