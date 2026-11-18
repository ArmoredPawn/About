// The card that opens over the map for a province, an army or a fleet.

import { citiesIn } from '../engine/cities.js';
import { cityCell, holderAt, dist as mapDist } from '../engine/land.js';
import { fauxState } from './map.js';
import { $, h, flag, money, nationName, regionName, troops, num, people, RES_COLORS, RES_LETTERS, fill } from './dom.js';
import { RESOURCE_INFO, TERRAIN, PROVINCES } from '../engine/data/regions.js';
import { GEO } from '../engine/data/geo.js';
import { CHOKEPOINTS } from '../engine/data/world.js';
import { MINOR_TERRAIN } from '../engine/names.js';
import { PROJECT_WEEKS } from '../engine/economy.js';
import { modal, numberField, selectField, confirmBox } from './dialogs.js';
import { armyCard, myArmies, formArmy, suppliesBlock } from './panels/military.js';
import { declareWar, aidDialog as moneyDialog } from './panels/diplomacy.js';
import { attackDialog, attackable } from './attack.js';
import { fleetCard, formDialog } from './panels/navy.js';
import { provincePeople } from './panels/peoples.js';
import { aidDialog as armDialog } from './panels/proxy.js';
import { airDialog, missileDialog } from './panels/air.js';
import { nodeName, PORTS } from '../engine/navy.js';
import { subregions, GOING } from '../engine/terrain.js';

const TERRAIN_OF = Object.fromEntries(PROVINCES.map((p) => [p.id, p.terrain]));

export function closeInspector() {
  $('inspector').hidden = true;
}

// The cities of a province: output, share of the national economy, and which have fallen in a battle
function provinceCities(ctx, id, { owner, ctrl, gdp, pop }) {
  const s = ctx.state;
  const list = citiesIn(id, pop);
  if (!list.length) return null;
  // Who holds each city: whoever holds the ground it stands on
  const faux = fauxState(s);
  const holderOf = (c) => holderAt(faux, cityCell(id, c.name)) ?? ctrl;
  const fallen = new Set(list.filter((c) => holderOf(c) !== ctrl).map((c) => c.name));
  // Each city's output goes to whoever holds it: its share is of that country's economy
  const gdpOf = (x) => s.countries[x]?.gdp ?? null;
  const row = (c) => {
    const holder = holderOf(c);
    const national = gdpOf(holder);
    const size = c.pop >= 1000 ? `${(c.pop / 1000).toFixed(1)}M` : `${Math.round(c.pop)}K`;
    return h('div.row.between.small.city-row', { style: { padding: '2px 0', cursor: 'pointer' }, title: 'Open the city', onclick: () => ctx.openCity(id, c.name) },
      h('span', c.capital ? '◆ ' : '', h('b', c.name), h('span.faint', ` ${size} people`), fallen.has(c.name) ? h('span.chip.bad', { style: { marginLeft: '6px' } }, `held by ${nationName(s, holder)}`) : holder !== owner ? h('span.chip.warn', { style: { marginLeft: '6px' } }, `held by ${nationName(s, holder)}`) : null),
      h('span.mono', `${money(c.share * gdp)}${national ? ` · ${((c.share * gdp) / national * 100).toFixed(1)}% of ${nationName(s, holder)}` : ''}`));
  };
  // The biggest cities, and the rest of the towns behind a toggle (those already taken in a battle always shown)
  const TOP = 8;
  const top = list.filter((c, i) => i < TOP || fallen.has(c.name));
  const rest = list.filter((c, i) => i >= TOP && !fallen.has(c.name));
  return h('div', h('h3.small.muted', { style: { margin: '10px 0 6px' } }, `CITIES (${list.length})`),
    top.map(row),
    rest.length ? h('details', h('summary.small.muted', { style: { cursor: 'pointer', padding: '2px 0' } }, `${rest.length} more town${rest.length > 1 ? 's' : ''}`), rest.map(row)) : null,
    h('p.muted.small', { style: { marginTop: '4px' } }, 'Output a year, and the share of the economy of the country that holds it: an occupied city works for its occupier. The front takes the cities one by one as armies advance, each lost to the defender as it falls. Zoom in on the map for the city close-up.'));
}

export function showRegion(ctx, id) {
  const s = ctx.state;
  const row = s.regions[ctx.regionIndex[id]];
  if (!row) return closeInspector();
  const [owner, ctrl, dmg, infra, fort, battleBy, prog, unrest, gar, gdp, pop, rebels] = row;
  const me = s.me;
  const atWarWith = (x) => s.wars.some((w) => (w.a === me && w.b === x) || (w.b === me && w.a === x));
  const occupied = owner !== ctrl;
  const terrain = TERRAIN[TERRAIN_OF[id] ?? MINOR_TERRAIN[id] ?? 'plains'];
  const res = s.resources[id] ?? {};
  const armiesHere = s.armies.filter((a) => a.region === id && !a.sea);
  const mineHeld = ctrl === me;
  const mineOwned = owner === me;
  const enemyHeld = atWarWith(ctrl);
  const cps = Object.entries(CHOKEPOINTS).filter(([, cp]) => cp.regions.includes(id));
  const projects = s.you?.projects.filter((p) => p.region === id) ?? [];

  const fact = (label, value) => h('div', h('span', label), h('b', value));
  const actions = [];
  if (mineHeld && mineOwned) {
    actions.push(h('button.btn.small', { onclick: () => buildInfra(ctx, id, gdp) }, `Infrastructure (${infra}/10)`));
    actions.push(h('button.btn.small', { onclick: () => fortify(ctx, id, fort) }, `Fortify (${fort}/5)`));
    actions.push(h('button.btn.small', { onclick: () => formArmy(ctx, id) }, 'Form army here'));
    if (PORTS[id]) actions.push(h('button.btn.small', { onclick: () => formDialog(ctx, id) }, 'Form a fleet here'));
  }
  if (mineHeld && !mineOwned) {
    actions.push(h('button.btn.small', { onclick: () => fortify(ctx, id, fort) }, `Fortify (${fort}/5)`));
    if (!s.minors[owner]?.capitulated) actions.push(h('button.btn.small.danger', { onclick: async () => { if (await confirmBox(`Annex ${regionName(id)}?`, 'It becomes part of your country. Its old owner will claim it back, and most countries will refuse to recognise the annexation.', { ok: 'Annex', danger: true })) ctx.send({ type: 'annex', region: id }); } }, 'Annex'));
  }
  if (!enemyHeld && attackable(ctx, id)) {
    actions.push(h('button.btn.small.primary', { onclick: () => attackDialog(ctx, { target: id }) }, 'Attack…'));
    actions.push(h('button.btn.small.danger', { onclick: () => declareWar(ctx, ctrl) }, `Declare war on ${nationName(s, ctrl)}…`));
  }
  if (enemyHeld) {
    actions.push(h('button.btn.small.primary', { onclick: () => attackDialog(ctx, { target: id }) }, mineOwned ? 'Liberate…' : 'Attack…'));
    actions.push(h('button.btn.small', { onclick: () => airStrike(ctx, id) }, 'Air campaign…'));
    actions.push(h('button.btn.small', { onclick: () => missile(ctx, id) }, 'Missile strike…'));
    if (s.you?.nukes > 0) actions.push(h('button.btn.small.danger', { onclick: () => nuke(ctx, id) }, '☢ Nuclear strike…'));
  }
  if (mineHeld) actions.push(h('button.btn.small', { onclick: () => pickArmy(ctx, id) }, 'Send an army to hold it…'));
  if (!mineOwned) actions.push(h('button.btn.small.ghost', { onclick: () => ctx.openCountry(owner) }, `${nationName(s, owner)} dossier`));
  // Money as aid, at once, to the country that holds it
  if (ctrl !== me && s.countries[ctrl] && !s.countries[ctrl].exile && !atWarWith(ctrl)) actions.push(h('button.btn.small.ghost', { onclick: () => moneyDialog(ctx, ctrl) }, `💸 Send money to ${nationName(s, ctrl)}…`));
  if (cps.length) actions.push(h('button.btn.small.ghost', { onclick: () => ctx.go('market', 'straits') }, 'Strait: tolls & patrols…'));
  for (const [key, cp] of cps) {
    if (ctrl !== me) continue;
    const closedBy = s.chokepoints[key]?.closedBy;
    actions.push(closedBy === me
      ? h('button.btn.small', { onclick: () => ctx.send({ type: 'strait', key, close: false }) }, `Reopen the ${cp.name}`)
      : closedBy ? null : h('button.btn.small.danger', { onclick: async () => { if (await confirmBox(`Close the ${cp.name}?`, `${cp.note} Prices will spike and you will lose standing.`, { ok: 'Close it', danger: true })) ctx.send({ type: 'strait', key, close: true }); } }, `Close the ${cp.name}`));
  }

  fill($('inspector'),
    h('button.icon-btn.close', { onclick: () => ctx.closeSelection(), 'aria-label': 'Close' }, '✕'),
    h('h2', regionName(id)),
    h('div.row.gap.sub', flag(owner), h('span', nationName(s, owner)), occupied ? h('span.chip.bad', `Held by ${nationName(s, ctrl)}`) : null, GEO[id].coast ? h('span.chip', 'Coastal') : h('span.chip', 'Landlocked')),
    battleBy ? h('div.warning.bad', { style: { marginTop: '10px' } }, `The front runs through it: ${nationName(s, battleBy)} holds about ${prog}% of its ground and ${nationName(s, ctrl)} the rest. The dashed white line on the map is the front; each side gets the output of what it holds.${(s.fights ?? []).some((b) => b.region === id) ? ' There is fighting here now.' : ''}`, h('div', { style: { marginTop: '6px' } }, h('button.btn.small', { onclick: () => ctx.closeUp?.(id) }, 'Close-up'))) : null,
    rebels > 0 ? h('div.warning.bad', { style: { marginTop: '10px' } }, `🔥 Uprising: about ${troops(rebels)} armed rebels.`,
      ctrl === me ? h('div.actions',
        h('button.btn.small', { onclick: () => pickArmy(ctx, id) }, 'Send an army'),
        h('button.btn.small', { onclick: () => ctx.send({ type: 'uprising', region: id, action: 'crush' }) }, 'Crack down'),
        h('button.btn.small', { onclick: () => ctx.send({ type: 'uprising', region: id, action: 'amnesty' }) }, 'Offer amnesty'))
        : h('div.actions', h('button.btn.small', { onclick: () => armDialog(ctx, { rebels: id }) }, 'Arm & fund the rebels…'))) : null,
    h('div.facts',
      fact('Population', people(pop)), fact('Output', money(gdp)),
      h('div', h('span', 'Terrain'), h('b', `${terrain.name} (×${(terrain.defend ** 0.75).toFixed(2)} defence)`), h('button.btn.small.ghost', { style: { marginTop: '2px', padding: '2px 6px' }, onclick: () => ground(ctx, id) }, 'Ground & passes…')), fact('Garrison', mineHeld || ctrl === me ? troops(gar) : `~${troops(Math.round(gar / 10) * 10)}`),
      fact('Infrastructure', `${infra}/10`), fact('Fortifications', `${fort}/5`),
      fact('War damage', `${dmg}%`), fact('Unrest', `${unrest}%`)),
    row[16] ? h('div.warning.bad', { style: { marginTop: '10px' } }, `☢ Radioactive fallout until week ${row[16]}: nothing can be mined, farmed or built here, and troops inside sicken.`) : null,
    provinceCities(ctx, id, { owner, ctrl, gdp, pop }),
    provincePeople(ctx, id),
    Object.keys(res).length ? h('div', h('h3.small.muted', { style: { margin: '10px 0 6px' } }, 'RESOURCES'), Object.entries(res).map(([r, [cur, pot]]) => {
      const info = RESOURCE_INFO[r];
      const developing = projects.some((p) => p.res === r);
      return h('div.res-row',
        h('span.res-dot', { style: { background: RES_COLORS[r] } }, RES_LETTERS[r]),
        h('span.grow', info.name, h('span.faint', ` ${cur}${pot > cur ? ` → ${pot}` : ''} ${info.unit}`)),
        mineOwned && mineHeld && pot > cur ? h('button.btn.small', { disabled: developing, onclick: () => develop(ctx, id, r, cur, pot) }, developing ? 'Developing' : 'Develop') : null);
    })) : h('p.muted.small', 'No major natural resources.'),
    projects.length ? h('div.meta', { style: { marginTop: '8px' } }, projects.map((p) => `${p.kind === 'develop' ? RESOURCE_INFO[p.res].name : p.kind === 'infra' ? 'Infrastructure' : 'Fortifications'}: ${Math.ceil(p.left)} weeks left`).join(' · ')) : null,
    armiesHere.length ? h('div', { style: { marginTop: '10px' } }, h('h3.small.muted', { style: { marginBottom: '6px' } }, 'ARMIES HERE'),
      h('div.list', armiesHere.map((a) => a.owner === me ? armyCard(ctx, a, true) : foreignArmy(ctx, a)))) : null,
    actions.length ? h('div.row.wrap.gap', { style: { marginTop: '12px' } }, actions) : null,
  );
  $('inspector').hidden = false;
}

// A city, close up: who holds it, what it makes, who is fighting for it, and what we can do about it
export function showCity(ctx, id, name) {
  const s = ctx.state;
  const row = s.regions[ctx.regionIndex[id]];
  if (!row) return closeInspector();
  const [owner, ctrl, dmg, , fort, , , , gar, gdp, pop] = row;
  const list = citiesIn(id, pop);
  const city = list.find((c) => c.name === name);
  if (!city) return showRegion(ctx, id);
  const me = s.me;
  // Who holds the city: whoever holds the ground it stands on
  const faux = fauxState(s);
  const cell = cityCell(id, name);
  const holder = holderAt(faux, cell) ?? ctrl;
  const fallen = holder !== owner;
  // The nearest battle, and how far the front is
  const near = (s.fights ?? []).map((b) => ({ b, d: mapDist(b.x, b.y, city.x, city.y) })).sort((a, b) => a.d - b.d)[0];
  const output = city.share * gdp * (1 - dmg / 100);
  const national = s.countries[holder]?.gdp;
  const info = s.battleInfo?.[id];
  const street = info?.street === name;
  const atWarWith = (x) => s.wars.some((w) => (w.a === me && w.b === x) || (w.b === me && w.a === x));
  const res = s.resources[id] ?? {};
  // A city's share of the province's people: roughly its share of the garrison and the home guard too
  const popShare = Math.min(1, city.pop / Math.max(1, pop * 1000));
  const fact = (label, value) => h('div', h('span', label), h('b', value));
  const armies = s.armies.filter((a) => !a.sea && a.x != null && mapDist(a.x, a.y, city.x, city.y) < 12);
  const status = street ? `Street fighting: ${nationName(s, holder)}'s defenders are fighting for every block`
    : near && near.d < 10 ? `Fighting about ${Math.round(near.d * 20)} km away: ${nationName(s, near.b.by)} is attacking ${nationName(s, near.b.holder)} (${near.b.ratio}:1)`
      : fallen ? `Held by ${nationName(s, holder)}${holder === ctrl ? '' : ': taken in the fighting'}`
        : holder === owner ? 'Quiet' : `Occupied by ${nationName(s, holder)}`;
  const actions = [];
  if (atWarWith(holder)) {
    actions.push(h('button.btn.small.primary', { onclick: () => attackDialog(ctx, { target: id }) }, 'Attack the province…'));
    actions.push(h('button.btn.small', { onclick: () => airStrike(ctx, id) }, 'Bomb its industry…'));
    actions.push(h('button.btn.small', { onclick: () => missile(ctx, id) }, 'Missile strike…'));
  }
  if (holder === me) actions.push(h('button.btn.small', { onclick: () => fortify(ctx, id, fort) }, `Fortify the province (${fort}/5)`));
  actions.push(h('button.btn.small.ghost', { onclick: () => ctx.openRegion(id) }, `${regionName(id)} (province)`));
  fill($('inspector'),
    h('button.icon-btn.close', { onclick: () => ctx.closeSelection(), 'aria-label': 'Close' }, '✕'),
    h('div.faint.small', { style: { textTransform: 'uppercase', letterSpacing: '0.06em' } }, city.capital ? 'Capital city' : 'City'),
    h('h2', name),
    h('div.row.gap.sub', flag(holder), h('span', nationName(s, holder)), h('span.faint', `· ${regionName(id)}`), holder !== owner ? h('span.chip.warn', `${nationName(s, owner)}'s`) : null),
    h('div', { class: `warning ${street || fallen ? 'bad' : near && near.d < 10 ? 'warn' : ''}`, style: { marginTop: '10px' } }, status),
    h('div.facts',
      fact('People', people(city.pop / 1000)),
      fact('Output', `${money(output)} a year`),
      fact('Share of the province', `${Math.round(city.share * 100)}%`),
      fact(`Share of ${nationName(s, holder)}`, national ? `${((output / national) * 100).toFixed(2)}%` : '—'),
      fact('Garrison nearby', holder === me ? troops(gar * popShare) : `~${troops(Math.max(1, Math.round((gar * popShare) / 5) * 5))}`),
      fact('Home guard', info?.militia >= 1 && !fallen ? troops(info.militia * popShare * 2) : '—'),
      fact('War damage', `${dmg}%`),
      fact('Fortifications', `${fort}/5`)),
    Object.keys(res).length ? h('div', h('h3.small.muted', { style: { margin: '10px 0 6px' } }, 'WHAT THE PROVINCE AROUND IT PRODUCES'),
      h('div.row.wrap.gap', Object.entries(res).filter(([, [cur]]) => cur > 0).map(([r, [cur]]) => h('span.chip', h('span.res-dot', { style: { background: RES_COLORS[r], display: 'inline-grid', width: '14px', height: '14px', marginRight: '4px' } }, RES_LETTERS[r]), `${RESOURCE_INFO[r].name} ${cur}`)))) : null,
    armies.length ? h('div', { style: { marginTop: '10px' } }, h('h3.small.muted', { style: { marginBottom: '6px' } }, 'ARMIES FIGHTING HERE'),
      h('div.list', armies.map((a) => (a.owner === me ? armyCard(ctx, a, true) : foreignArmy(ctx, a))))) : null,
    h('p.muted.small', { style: { marginTop: '8px' } }, 'A city works for whoever holds it. In a battle the front takes the cities one by one, and a big city in its path means street fighting: the attack slows to a crawl while its defenders hold out.'),
    h('div.row.wrap.gap', { style: { marginTop: '12px' } }, actions));
  $('inspector').hidden = false;
}

export function showArmy(ctx, id) {
  const s = ctx.state;
  const a = s.armies.find((x) => x.id === id);
  if (!a) return closeInspector();
  fill($('inspector'),
    h('button.icon-btn.close', { onclick: () => ctx.closeSelection(), 'aria-label': 'Close' }, '✕'),
    h('h2', a.name),
    h('div.row.gap.sub', flag(a.owner), h('span', nationName(s, a.owner)), h('span.faint', a.sea ? 'at sea' : regionName(a.region))),
    h('div', { style: { marginTop: '10px' } }, a.owner === s.me ? armyCard(ctx, a, true) : foreignArmy(ctx, a)),
    a.owner === s.me && !a.sea ? h('p.muted.small', { style: { marginTop: '8px' } }, 'Click any province to send this army there. It marches through friendly ground, fights its way through enemy ground, and goes at once: orders don\'t wait for it to regroup.') : null,
  );
  $('inspector').hidden = false;
}

export function showFleet(ctx, id) {
  const s = ctx.state;
  const f = (s.fleets ?? []).find((x) => x.id === id);
  if (!f) return closeInspector();
  fill($('inspector'),
    h('button.icon-btn.close', { onclick: () => ctx.closeSelection(), 'aria-label': 'Close' }, '✕'),
    h('h2', f.name),
    h('div.row.gap.sub', flag(f.owner), h('span', nationName(s, f.owner)), h('span.faint', `${f.moving ? 'at sea ' : ''}in the ${nodeName(f.at)}`)),
    h('div', { style: { marginTop: '10px' } }, fleetCard(ctx, f, true)),
    f.owner === s.me ? h('p.muted.small', { style: { marginTop: '8px' } }, 'Click anywhere on the water, a strait (◆) or a coast to send this fleet there, then choose what it does.') : null,
  );
  $('inspector').hidden = false;
}

// The ground inside a province, and whether infantry and tanks can get through it
function ground(ctx, id) {
  const list = subregions(id);
  const chip = (g) => h('span.chip', { class: { good: 'good', slow: '', hard: 'warn', none: 'bad' }[g] }, GOING[g].name);
  modal({
    title: `${regionName(id)}: the ground`,
    body: h('div.stack',
      h('p.muted.small', 'Armies cross a province along its easiest ground. Forest, mountains, marsh and jungle slow them and favour the defender; open plains and desert suit tanks.'),
      h('div.list', list.map((x) => h('div.item',
        h('div.item-head', h('span.name', x.name), h('span.muted.small', x.terrainName)),
        h('div.row.wrap.gap', { style: { marginTop: '6px' } }, h('span.small.muted', 'Infantry'), chip(x.inf), h('span.small.muted', 'Armour'), chip(x.arm)),
        h('div.meta', x.note),
        x.surprise ? h('div.warning', { style: { marginTop: '6px' } }, 'Widely thought impassable, so defenders leave it thin. An attack through here hits hard for its first weeks, unless an army is holding the province or it is well fortified.') : null)))),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
}

function foreignArmy(ctx, a) {
  const s = ctx.state;
  const atWar = s.wars.some((w) => (w.a === s.me && w.b === a.owner) || (w.b === s.me && w.a === a.owner));
  return h('div.item',
    h('div.item-head', flag(a.owner), h('span.name', a.name), h('span.mono.small', `${a.exact || a.seen ? '' : '~'}${troops(a.troops)}`)),
    h('div.meta', `${a.gen?.name ?? 'Unknown general'} · ${a.exact || a.seen ? '' : 'about '}${num(a.tanks)} tanks`),
    a.status ? h('div.meta', a.status) : a.attacking ? h('div.meta.bad', `Attacking ${regionName(a.attacking)}`) : null,
    // Our spies inside its country see what it eats and whether it has run out
    a.needs ? h('div', h('div.meta.good', '🕵 Our spies report its supplies:'), suppliesBlock(ctx, a, false)) : a.lineCut ? h('div.meta.bad', '✂ Its supply line is cut.') : null,
    a.exact ? null : h('div.meta.faint', a.spied ? 'Our spies inside its country count it exactly.' : a.seen ? 'One of our spy satellites is over it: exact numbers. Agents inside their government would reveal their plans and supplies.' : 'Spy satellites (Research → Space) would count it exactly; spies inside its country would show its supplies.'),
    h('div.actions',
      atWar && a.abroad && !a.lineCut ? h('button.btn.small.danger', { title: 'Bomb the depots, bridges and convoys behind it', onclick: () => ctx.cutSupply(a) }, '✂ Cut its supply line…') : null,
      s.countries[a.owner] ? h('button.btn.small.ghost', { onclick: () => ctx.openCountry(a.owner) }, 'Dossier') : null));
}

/* ---------- Actions ---------- */

// Sends one of our armies to hold a province (attacks go through attackDialog)
function pickArmy(ctx, target) {
  const s = ctx.state;
  const list = myArmies(s).filter((a) => !a.sea);
  if (!list.length) {
    ctx.toast('Form an army group first: click "Form army here" on one of your provinces.', 'warn');
    return;
  }
  const sel = selectField('Army group', list.map((a) => [a.id, `${a.name} · ${troops(a.troops)} · ${regionName(a.region)}`]));
  modal({
    title: `Hold ${regionName(target)}`,
    body: h('div.stack', sel.el, h('p.muted.small', 'The army moves through friendly ground and digs in.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Hold', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'armyOrder', id: sel.input.value, kind: 'hold', target })) || false }],
  });
}

function develop(ctx, id, r, cur, pot) {
  const me = ctx.state.you;
  const info = RESOURCE_INFO[r];
  const cost = (pot - cur) * info.value * 0.8 * (0.45 + 0.55 * Math.min(1.2, (me.gdp / me.pop) / 60));
  modal({
    title: `Develop ${info.name.toLowerCase()} in ${regionName(id)}`,
    body: h('div.stack', h('p', `Raise output from ${cur} to ${pot} ${info.unit} a year.`), h('p.muted', `Costs about ${money(cost)} from reserves (${money(me.treasury)}) and takes ${PROJECT_WEEKS[r]} weeks.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Start', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'develop', region: id, res: r })) || false }],
  });
}

function buildInfra(ctx, id, gdp) {
  modal({
    title: `Infrastructure in ${regionName(id)}`,
    body: h('div.stack', h('p', 'Roads, rail, ports and power: the province\'s output rises 2%, armies move faster through it, and war damage heals sooner.'), h('p.muted', `Costs about ${money(gdp * 0.03 + 1)} and takes 26 weeks.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Build', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'infra', region: id })) || false }],
  });
}

function fortify(ctx, id, fort) {
  const me = ctx.state.you;
  const cost = (fort + 1) * 0.6 * (0.45 + 0.55 * Math.min(1.2, (me.gdp / me.pop) / 60));
  modal({
    title: `Fortify ${regionName(id)}`,
    body: h('div.stack', h('p', 'Trenches, bunkers and minefields: each level makes the province 15% harder to take.'), h('p.muted', `Costs ${money(cost)} from defence funds and takes 12 weeks.`)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Fortify', kind: 'primary', onClick: async () => !(await ctx.send({ type: 'fortify', region: id })) || false }],
  });
}

export function airStrike(ctx, id) {
  airDialog(ctx, id);
}

export function missile(ctx, id) {
  missileDialog(ctx, id);
}

async function nuke(ctx, id) {
  const ok = await confirmBox(`Use a nuclear weapon on ${regionName(id)}?`,
    h('div.stack', h('p', 'Millions will die. Every country will turn against you, your standing will collapse, and nuclear-armed enemies or their allies may strike back.'), h('p.bad', 'This cannot be undone.')),
    { ok: 'Launch', danger: true });
  if (ok) ctx.send({ type: 'nuke', region: id });
}
