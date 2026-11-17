// How to Play: the rules, in tabs, with diagrams of the ideas that are easier to see than to read: the odds of a
// battle, the front moving through cities, pincers, encirclement, doctrine, catching a cargo at sea, shipping lines
// and the map's zoom levels.

import { $, h, svg, fill } from './dom.js';
import { MATCHUPS, AXES } from '../engine/doctrine.js';

const TOPICS = [
  ['start', 'Start here'],
  ['economy', 'Economy & trade'],
  ['war', 'War on land'],
  ['encircle', 'Encirclement'],
  ['doctrine', 'Doctrine'],
  ['navy', 'Navy & shipping'],
  ['diplomacy', 'Diplomacy & spies'],
  ['map', 'The map'],
];
let current = 'start';

export function openHelp(topic) {
  if (topic && TOPICS.some(([k]) => k === topic)) current = topic;
  render();
  const dlg = $('help');
  if (!dlg.open) dlg.showModal();
}

function render() {
  const body = $('help').querySelector('.help-body');
  const nav = h('nav.help-tabs', { role: 'tablist' }, TOPICS.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': String(k === current), onclick: () => { current = k; render(); body.scrollTop = 0; } }, label)));
  fill(body, nav, h('div.help-page', PAGES[current]()));
}

/* ---------- Diagram helpers ---------- */

const fig = (caption, el) => h('figure.help-fig', el, caption ? h('figcaption', caption) : null);
const box = (vb, ...kids) => svg('svg', { viewBox: vb, class: 'diagram', role: 'img' }, ...kids);
const text = (x, y, s, cls = 'd-text', extra = {}) => svg('text', { x, y, class: cls, ...extra }, s);
const arrow = (d, cls = 'd-arrow') => svg('path', { d, class: cls, 'marker-end': 'url(#d-head)' });
const defs = () => svg('defs', {}, svg('marker', { id: 'd-head', viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0L10 5L0 10z', class: 'd-head' })));

/* ---------- Pages ---------- */

const PAGES = {
  start: () => [
    h('p.lead', 'You lead one of the world\'s 50 largest economies. The world runs in real time and never pauses: armies march, fronts shift and the date ticks forward whether you act or not. The game ends only when one country has conquered the whole world.'),
    fig('Everything feeds everything else. Money buys armies and oil; wars cost money, lives and approval; standing decides who will trade with you and stand by you.', loopDiagram()),
    h('h3', 'Your first ten minutes'),
    h('ol.steps',
      h('li', h('b', 'Read the Cabinet'), ' (the first tab on the left): your briefing, anything that needs a decision, and what is going wrong.'),
      h('li', h('b', 'Set the budget'), ' (Economy → Budget): taxes, six spending lines and the interest rate. Infrastructure, education and research grow the economy; deficits pile up debt.'),
      h('li', h('b', 'Check your resources'), ' (Economy → Resources): oil, gas, chips and the rest. Buy what you are short of (Market → Buy) or open a shipping line to a supplier (Economy → Routes).'),
      h('li', h('b', 'Make friends'), ' (Diplomacy): alliances, free trade and non-aggression pacts. Every game starts with no alliances at all.'),
      h('li', h('b', 'Know your army'), ' (Military): what you can deploy, your navy, and your doctrine, the way your armies fight.')),
    h('p', 'Every other nation on Earth, about 150 of them, is run by the computer with its own economy, army, navy and diplomacy. They trade, build alliances, spy, pick fights with weak neighbours, and fight back hard when invaded.'),
    h('h3', 'What\'s new'),
    h('ul',
      h('li', h('b', 'Encirclement'), ': cut an enemy army off from home and it weakens every week until it breaks out, is relieved, is kept alive by an airlift, or surrenders. See Encirclement.'),
      h('li', h('b', 'Doctrine'), ' (Military → Doctrine): build your own way of war from five choices, master it in battle, and invent new ones like Blitzkrieg.'),
      h('li', h('b', 'Pincers and breakthroughs'), ': attack a province from two sides for a big bonus; armoured armies tear through lines and keep rolling.'),
      h('li', h('b', 'Street fighting and home guards'), ': invaded countries fight for every city, and their people take up arms.'),
      h('li', h('b', 'Allies fight beside you'), ': computer-run allies send armies to your front; tick "Support the front" on an army and it helps wherever the fighting is next to it and keeps to the line as the front moves. Computer-run armies always do: attack a province and the defenders next door move in, and when it falls they fall back onto the new line.'),
      h('li', h('b', 'Shipping lines'), ' (Economy → Routes): place two points on the map to open a public or private line.'),
      h('li', h('b', 'Catching cargo'), ': choose from every fleet that can reach a ship, best first, or put a new fleet to sea from the nearest port. Fleets can hunt shipping across a whole sea, and choose to seize or sink.'),
      h('li', h('b', 'Cities'), ': every country has its towns as well as its great cities, thousands in all. Zoom in and more appear; click any to see what it makes and who is fighting for it.')),
  ],

  economy: () => [
    h('p', 'The economy pays for everything. Its growth comes from what you spend and from trade; it shrinks with high taxes, high interest rates, war damage, shortages and sanctions.'),
    fig('A budget in one picture: taxes come in, six spending lines go out, and whatever is left over (or missing) changes your debt.', budgetDiagram()),
    h('ul',
      h('li', h('b', 'Economy'), ': taxes, spending and the interest rate. Infrastructure, education and research grow the economy; deficits pile up debt.'),
      h('li', h('b', 'Markets'), ' (Economy → Markets): your currency, stock market and credit rating move with your rates, inflation, debt, stability and wars. Borrow too much and you face a debt crisis: the IMF, austerity, printing money, or default.'),
      h('li', h('b', 'Resources'), ' are where they really are: Texas and West Siberian oil, Taiwan\'s chip fabs, Chinese rare earths. Capture a province and its output is yours.'),
      h('li', h('b', 'Market'), ': buy from the country you choose (or around sanctions through intermediaries, at a premium and a risk), sell your surplus, or list it for other leaders. Every cargo sails a real lane or goes overland, and can be stopped on the way.'),
      h('li', h('b', 'Oil & pipelines'), ': found a cartel to cut output and embargo a country, shut or sabotage pipelines, release strategic reserves.')),
    h('h3', 'Shipping lines (Economy → Routes)'),
    fig('A private line from Cuba to Panama passes Jamaica\'s and Colombia\'s waters. Those countries are far likelier to spot it than anyone else; once they have, their coastguards can board its cargoes as they pass.', routeDiagram()),
    h('ol.steps',
      h('li', 'Press ', h('b', 'Open a new line'), ' and click one of your ports (a coastal province, or the sea just off it).'),
      h('li', 'Click a port abroad. The line is drawn on the map with its length, cost and whose waters it crosses.'),
      h('li', 'Choose ', h('b', 'public'), ' (announced, on every map, lifts trade for both) or ', h('b', 'private'), ' (secret: its ships are on no one else\'s map), and open it.')),
    h('p', 'All trade between you and that country then sails the line, about a fifth faster than usual. A private line crossing another country\'s waters (about 200 nautical miles off its coast) is noticed by that country far more often than by anyone else, and its spies inside your country count four times over. Lines close if either port changes hands, or the two countries go to war.'),
  ],

  war: () => [
    h('p', 'Armies fight on the map itself, not province by province. Each army stands at a point. Provinces are what the economy counts (output, resources, cities, garrisons, forts); the ground between them changes hands 50 km at a time as armies advance, so a front can run through the middle of a province, and each side gets the output of what it holds.'),
    fig('Only armies hold ground. An army holds the land around it (its zone, about 80 to 180 km); an advancing army takes every enemy cell around it that no enemy army holds. Where they meet and one means to attack, they fight, and the front moves.', zocDiagram()),
    h('h3', 'Giving orders'),
    h('ol.steps',
      h('li', h('b', 'Justify the war'), ' (a country\'s dossier). The case takes about 45 seconds and is prepared in secret.'),
      h('li', h('b', 'Form an army'), ' (Military → Troops, or a province\'s card). More troops than you have free drafts reservists.'),
      h('li', h('b', 'Click it, then click anywhere.'), ' The route is drawn as you move the pointer. Declaring war and attacking can be one step.')),
    h('div.help-cards',
      h('div', h('b', '► Move'), h('span', 'Click our side\'s ground: the army marches there over friendly land and holds it. It won\'t start a fight, and stops short of an enemy army.')),
      h('div', h('b', '▲ Advance'), h('span', 'Click enemy ground: it pushes there, taking the land it crosses and attacking any army in its way.')),
      h('div', h('b', '⚔ Attack an army'), h('span', 'Click an enemy army: it goes after that army and fights it (a pursuit ends about 1,400 km on).')),
      h('div', h('b', '■ Hold'), h('span', 'The "Hold here" button: it stops and holds the ground around it. It defends if attacked, but never attacks.'))),
    h('h3', 'War is not the same as fighting'),
    h('p', 'Being at war doesn\'t start a battle. A battle starts only when an army that means to attack (advancing, or attacking an army) comes within about 180 km of an enemy army. Two countries can be at war for months with their armies facing each other across the border, as in the Phoney War of 1939, until one of them attacks. Computer-run countries hold their line the same way and attack when the odds are good, to take back their land, or in an offensive they have planned.'),
    h('h3', 'Land with no army on it'),
    h('p', 'Only armies hold ground. Where an enemy has no army, an advancing army marches straight through and takes the land as it goes, slowed (and bled a little) by the province\'s garrison and home guard, but not stopped: Barbarossa took hundreds of kilometres a week this way. Keep armies on every stretch of the front you care about; a gap between them is a way through.'),
    h('h3', 'The odds of a battle'),
    fig('Attack against defence. Numbers count most; ground, forts, air power, supply, organisation, doctrine and generals shift the odds.', oddsDiagram()),
    h('ul',
      h('li', 'At better than even odds the attacker pushes the defender back: about 120 km a week at even odds, several times that at 3:1, faster still for armour that breaks through. The attackers follow and take the ground in between.'),
      h('li', 'Held at 0.8 to 1, it stalls. Below 0.8 the attackers are pushed back; under half the defenders\' strength for a week, the attack is called off. A defender with nowhere to fall back to (the ground behind it is the enemy\'s) takes far heavier losses.'),
      h('li', 'Defending on its own ground an army has the province\'s forts, part of its garrison and its home guard beside it, and an army that has held its position for a while is dug in. Friendly armies standing right next to it join the defence.'),
      h('li', 'Mountains, forests, marshes and forts help a defender, but can\'t make up for being outnumbered three to one. Ground thought impassable, like the Ardennes, is lightly held: strike through it before it is fortified.')),
    h('h3', 'Cities, street fighting and the home guard'),
    fig('A city falls with the ground it stands on, and its output goes to whoever holds it. A big city where the defenders stand means street fighting: the attack slows to a crawl.', frontDiagram()),
    h('p', 'A people defending its own homeland takes up arms: every province raises a home guard, about 4,000 for each million people (many more under a people\'s war doctrine). It fights beside the garrison and is used up as the fighting goes on.'),
    h('h3', 'Pincers and breakthroughs'),
    fig('Two armies attacking the same army from directions at least 70° apart: it can\'t face both ways.', pincerDiagram()),
    h('ul',
      h('li', h('b', 'Pincer'), ': attack hits 15% or more harder (far more with an armoured-manoeuvre doctrine), and the defenders lose men and organisation faster.'),
      h('li', h('b', 'Breakthrough'), ' (on each army\'s card): how mechanised it is, and its doctrine. Winning at good odds, a high-breakthrough army pushes much faster.'),
      h('li', 'Use them together: pin an enemy army from the front, swing armour round its flank into the empty ground behind it, and close the ring. That is how pockets are made.')),
    h('h3', 'Allies and support'),
    h('p', 'Computer-run allies at war with your enemy send expeditionary armies to your front and fight beside you. Tick ', h('b', 'Support the front'), ' on any army: it moves up to the line wherever the front has gone, stands beside any of our (or our allies\') armies under attack nearby, and joins our allies\' attacks next to it. ', h('b', 'Automatic capture'), ' keeps an army advancing on one enemy province after another.'),
    h('h3', 'Supply, oil and the air'),
    h('ul',
      h('li', 'Supply runs over our side\'s ground back to the capital: the further an army is from home, the shorter it is. Armies far from home also need money, factories and troops guarding the supply lines (Military → Logistics). They burn oil holding, marching and (most of all) fighting.'),
      h('li', 'Air campaigns: close air support (the attack hits harder), interdiction (enemy supply cut), strategic bombing (industry wrecked). Missiles hit armies, forts, airbases or industry. Both only reach so far from your bases.'),
      h('li', 'Nuclear weapons end most arguments, and most of the world\'s goodwill.')),
  ],

  encircle: () => [
    h('p', 'Every bit of ground a country holds draws its supply over its own side\'s ground from the capital and the heartland. When spearheads close a ring around a stretch of ground, everything inside is a ', h('b', 'pocket'), ', ringed in red on the map.'),
    fig('Two enemy thrusts meet behind the front. The armies inside are cut off from home.', pocketDiagram()),
    h('h3', 'The pocket\'s clock'),
    h('ul',
      h('li', 'Every week inside: organisation falls about 10 points, about 2.5% of the men are lost, and the tanks run out of fuel.'),
      h('li', 'After three weeks, an army at the end of its strength may surrender. Political commissars (a doctrine) never surrender, and the Hedgehog defence holds out far longer.'),
      h('li', 'Ground inside a ring with no army to hold it falls to the encircler within a week: its garrisons give up. That is how a breakthrough swallows whole regions.'),
      h('li', 'A pocket on a coast whose waters the enemy doesn\'t hold is supplied by ship instead (dashed ring): cut off by land, but not starving. An exclave whose waters the enemy holds (Kaliningrad, with Poland\'s navy offshore) is a pocket from the first day of a war.')),
    h('h3', 'Four ways out (on the army\'s card)'),
    h('div.help-cards',
      h('div', h('b', '⇢ Break out'), h('span', 'Attack toward the nearest of our lines with everything: a quarter harder for three weeks, at a heavy price.')),
      h('div', h('b', '✈ Airlift'), h('span', 'Fly supplies in with aircraft from your air force, within range of your bases. About 1 aircraft keeps 800 men going (twice that with the Air transport doctrine). The enemy shoots some down every week, as at Stalingrad.')),
      h('div', h('b', '⇠ Relief'), h('span', 'Attack from outside to reopen a corridor. The moment our ground links the pocket back to home, it is relieved.')),
      h('div', h('b', '⚐ Surrender'), h('span', 'Ends the suffering. The army and its men are lost.'))),
    h('p', 'Computer-run countries break out, airlift and surrender too.'),
  ],

  doctrine: () => [
    h('p', 'A doctrine is how your armies fight. You build one from five choices, name it, and have the general staff develop it (weeks of staff work, then months of training). Germany did not invent tanks; it invented a way of using them.'),
    fig('Five choices make a doctrine. Fighting by it builds mastery; the right combination, mastered, becomes a new way of war.', doctrineDiagram()),
    h('ul',
      h('li', h('b', 'Attack'), ': broad front, deep battle, armoured manoeuvre, or infiltration.'),
      h('li', h('b', 'Defence'), ': fortified line, elastic defence, mobile defence, or people\'s war.'),
      h('li', h('b', 'Air power'), ': close support, air superiority, strategic bombing, or air transport.'),
      h('li', h('b', 'Logistics'), ': rail and depots, motor transport, or living off the land.'),
      h('li', h('b', 'Command'), ': mission command, central control, political commissars, or a general staff that plans everything.')),
    h('h3', 'Attack against defence'),
    fig('What each kind of attack can expect against each kind of defence (green: better for the attacker). Find out how your enemy fights, from spies or a month of war, then build what beats it.', matrixDiagram()),
    h('h3', 'Mastery and invention'),
    h('ul',
      h('li', 'A new concept fights at half strength at first, then trains up over a few months.'),
      h('li', 'Mastery (up to a third more effect) comes from fighting by it, fastest when you are losing: a beaten army learns. Peacetime exercises build a little.'),
      h('li', 'Seven combinations become something new once mastered: Blitzkrieg, Deep operations, AirLand Battle, Hedgehog defence, Protracted war, Battle of materiel and Vertical envelopment. The first country to develop each is its pioneer and fights it best.'),
      h('li', 'Computer-run countries beaten by a doctrine their defence can\'t answer rethink it.')),
  ],

  navy: () => [
    h('p', 'Every fleet sits at its exact spot on the water. Click it, then click anywhere on the sea, a strait (◆) or a coast: it sails the shortest way round the land and holds position, blockades an enemy coast, patrols a strait, or hunts shipping across that whole sea. Enemy fleets within about 450 km fight.'),
    h('h3', 'Stopping a cargo'),
    fig('A fleet can only stop a ship it reaches. It sails to a point on the ship\'s route ahead of it and waits there. Warships of the buyer, the seller and their allies near the ship escort it.', interceptDiagram()),
    h('ol.steps',
      h('li', 'Pick a ship (Market → Shipping, or click one on the map) and choose ', h('b', 'Seize'), ' (take the cargo home) or ', h('b', 'Sink'), ' (surer; the cargo is lost to everyone).'),
      h('li', 'You are shown every fleet that can reach it before it docks, ', h('b', 'best first'), ': the surest to succeed, then the soonest. If warships are waiting in port, you can also ', h('b', 'form a new fleet'), ' at the port nearest the ship\'s route and send it at once.'),
      h('li', 'If the escorts near it are stronger, it gets through. Otherwise you have the odds shown. You hear whether it worked; the cargo\'s owners only hear if it did.')),
    h('p', 'In peacetime, stopping a cargo is piracy: both countries turn hostile, sinking more so.'),
    h('h3', 'Hunting shipping across a sea'),
    fig('A fleet sent to hunt shipping waits on the sea lanes and goes after every enemy cargo it can catch anywhere in that ocean, as the U-boats did in the Atlantic.', raidDiagram()),
    h('ul',
      h('li', 'Click a fleet, click the sea, and choose ', h('b', 'Hunt enemy shipping'), ' (or enemy and sanctioned shipping).'),
      h('li', 'Every fleet has a standing order for enemy cargo (its card): ', h('b', 'Seize it'), ' or ', h('b', 'Sink it'), '. It applies when hunting, when blockading, and whenever an enemy cargo passes it at war.'),
      h('li', 'Cargo ships make about 2,200 km a week, so a crossing of the Atlantic takes about three weeks. A fleet placed across the lanes catches what comes its way.')),
    h('h3', 'Straits, blockades and landings'),
    h('ul',
      h('li', 'Hold a strait\'s shores to close it, charge a toll, or attack enemy cargoes. Any fleet can patrol one, to escort friends or stop others.'),
      h('li', 'A blockade starves a country of almost all its sea trade. Its fleets and coastal missiles fight back.'),
      h('li', 'To land an army overseas you need a fleet off that coast at least as strong as the enemy\'s, or a prepared landing (weeks of build-up, which spies and satellites see coming).')),
  ],

  diplomacy: () => [
    h('ul',
      h('li', 'Message other leaders, or start group chats; every alliance gets its own chat. Alliances and trade blocs can be ', h('b', 'public'), ' (announced: it deters attackers) or ', h('b', 'secret'), ' (revealed when a member goes to war for another).'),
      h('li', 'Propose alliances, free trade, non-aggression pacts, military access, resource deals and loans. A resource deal can be secret, and exclusive. Impose sanctions and tariffs, or table UN resolutions with P5 vetoes.'),
      h('li', h('b', 'Arm & fund'), ' a country at war, or rebels in someone else\'s, openly or covertly.'),
      h('li', h('b', 'Spies'), ': plant agents abroad. Once settled in they report armies on the move, weapons, secret pacts and war plans, show their armies on your map, reveal their doctrine, and can uncover their secret shipping lines. Counter-intelligence catches (or turns) them.'),
      h('li', h('b', 'Coups'), ': back officers who want to overthrow a government; a coup that succeeds leaves one that owes you.'),
      h('li', h('b', 'Peoples'), ': conquered peoples resist with partisans and uprisings; independence movements can be granted autonomy, cracked down on, or offered a referendum.'),
      h('li', h('b', 'Crises'), ': pandemics, financial crashes, famines and terror attacks force choices with deadlines.')),
  ],

  map: () => [
    fig('The map changes as you zoom: the world and its fronts; provinces, armies and fleets; then a close-up of every city.', zoomDiagram()),
    h('ul',
      h('li', 'Drag to pan; scroll or pinch to zoom. The ⌂ button flies home.'),
      h('li', 'Zoom in and the map becomes the ', h('b', 'city close-up'), ': every city in the colour of whoever holds it, with its output. ', h('b', 'Click a city'), ' for what it makes, its share of the economy, the garrison and home guard, and who is fighting for it. A pulsing ring means street fighting.'),
      h('li', 'The Auto / Strategic / Cities switch above the map sets when the close-up shows.'),
      h('li', 'Click a province for its card; click an army or a fleet, then click where it should go (Esc cancels); right-click sends the selected army.'),
      h('li', 'The buttons above the map switch map modes (political, alliances, resources, economy, loyalty, climate) and layers (armies, fleets, pipelines, trade lanes and shipping lines).'),
      h('li', 'On the map: a yellow front line inside contested provinces; ⚔ battles (with Pincer or Street fighting tags); a red ring round encircled pockets; dashed coloured lanes for trade and solid ones for shipping lines.')),
  ],
};

/* ---------- The diagrams ---------- */

function loopDiagram() {
  const node = (x, y, title, sub, cls) => svg('g', {},
    svg('rect', { x: x - 78, y: y - 26, width: 156, height: 52, rx: 10, class: `d-box ${cls}` }),
    text(x, y - 4, title, 'd-title', { 'text-anchor': 'middle' }),
    text(x, y + 14, sub, 'd-sub', { 'text-anchor': 'middle' }));
  return box('0 0 600 250', defs(),
    node(300, 38, 'Economy', 'money · oil · chips', 'blue'),
    node(510, 125, 'Military', 'armies · fleets · air', 'red'),
    node(300, 212, 'War & diplomacy', 'fronts · deals · spies', 'amber'),
    node(90, 125, 'Standing', 'approval · allies · rep', 'green'),
    arrow('M380 50 Q470 60 492 96'), arrow('M500 154 Q470 200 380 206'), arrow('M220 206 Q130 196 106 154'), arrow('M100 96 Q130 50 220 44'),
    text(300, 130, 'The world never pauses', 'd-sub', { 'text-anchor': 'middle' }));
}

function budgetDiagram() {
  const lines = ['Defence', 'Infrastructure', 'Education', 'Health', 'Research', 'Welfare'];
  return box('0 0 600 200', defs(),
    svg('rect', { x: 20, y: 70, width: 130, height: 60, rx: 10, class: 'd-box green' }),
    text(85, 96, 'Taxes', 'd-title', { 'text-anchor': 'middle' }), text(85, 114, '% of GDP', 'd-sub', { 'text-anchor': 'middle' }),
    ...lines.flatMap((l, i) => [
      arrow(`M152 100 C220 100 220 ${22 + i * 30} 290 ${22 + i * 30}`, 'd-arrow thin'),
      svg('rect', { x: 292, y: 10 + i * 30, width: 120, height: 24, rx: 6, class: `d-box ${i === 0 ? 'red' : i < 3 || i === 4 ? 'blue' : 'amber'}` }),
      text(352, 26 + i * 30, l, 'd-sub', { 'text-anchor': 'middle' }),
    ]),
    arrow('M414 70 L470 70', 'd-arrow thin'), text(478, 66, 'Growth', 'd-title'), text(478, 82, 'infra · edu · research', 'd-sub'),
    arrow('M414 150 L470 150', 'd-arrow thin'), text(478, 146, 'Deficit → debt', 'd-title'), text(478, 162, 'too much: a debt crisis', 'd-sub'));
}

function oddsDiagram() {
  const x = (v) => 40 + (v / 3) * 520;
  return box('0 0 600 120',
    svg('rect', { x: x(0), y: 40, width: x(0.8) - x(0), height: 26, class: 'd-zone bad' }),
    svg('rect', { x: x(0.8), y: 40, width: x(1) - x(0.8), height: 26, class: 'd-zone warn' }),
    svg('rect', { x: x(1), y: 40, width: x(3) - x(1), height: 26, class: 'd-zone good' }),
    text((x(0) + x(0.8)) / 2, 58, 'Thrown back', 'd-sub', { 'text-anchor': 'middle' }),
    text((x(0.8) + x(1)) / 2, 32, 'Stalled', 'd-sub', { 'text-anchor': 'middle' }),
    text((x(1) + x(3)) / 2, 58, 'Advancing: faster the higher', 'd-sub', { 'text-anchor': 'middle' }),
    ...[0, 0.8, 1, 2, 3].map((v) => svg('g', {}, svg('line', { x1: x(v), x2: x(v), y1: 68, y2: 76, class: 'd-tick' }), text(x(v), 92, `${v}:1`, 'd-sub', { 'text-anchor': 'middle' }))),
    text(x(1), 112, '≈ a month', 'd-faint', { 'text-anchor': 'middle' }), text(x(3), 112, '≈ a week', 'd-faint', { 'text-anchor': 'end' }));
}

function frontDiagram() {
  const front = 'M300 20 C285 60 320 80 298 110 C280 140 322 160 300 200';
  return box('0 0 600 220', defs(),
    svg('rect', { x: 60, y: 20, width: 480, height: 180, rx: 14, class: 'd-land' }),
    svg('path', { d: `M60 20 L300 20 C285 60 320 80 298 110 C280 140 322 160 300 200 L60 200 Z`, class: 'd-held' }),
    svg('path', { d: front, class: 'd-front' }),
    arrow('M90 110 L200 110', 'd-arrow big'),
    text(130, 98, 'Attack', 'd-title'),
    ...[[150, 60, 'fallen'], [230, 160, 'fallen'], [318, 110, 'street'], [420, 60, ''], [460, 160, '']].map(([cx, cy, k]) => svg('g', {},
      k === 'street' ? svg('circle', { cx, cy, r: 18, class: 'd-ring' }) : null,
      svg('circle', { cx, cy, r: 7, class: `d-city ${k}` }))),
    text(150, 82, 'taken', 'd-sub', { 'text-anchor': 'middle' }),
    text(318, 142, 'street fighting', 'd-sub', { 'text-anchor': 'middle' }),
    text(440, 110, 'still held', 'd-sub', { 'text-anchor': 'middle' }));
}

function zocDiagram() {
  const army = (x, y, cls, label) => svg('g', {}, svg('rect', { x: x - 26, y: y - 10, width: 52, height: 20, rx: 4, class: `d-box ${cls}` }), text(x, y + 4, label, 'd-title', { 'text-anchor': 'middle' }));
  return box('0 0 600 220', defs(),
    svg('rect', { x: 0, y: 0, width: 600, height: 220, class: 'd-land' }),
    svg('path', { d: 'M0 0 L300 0 C290 50 330 90 300 120 C270 150 310 190 300 220 L0 220 Z', class: 'd-held' }),
    svg('path', { d: 'M300 0 C290 50 330 90 300 120 C270 150 310 190 300 220', class: 'd-front' }),
    svg('circle', { cx: 240, cy: 70, r: 55, class: 'd-escort' }),
    svg('circle', { cx: 380, cy: 60, r: 50, class: 'd-raid' }),
    army(240, 70, 'blue', '▲ 300K'),
    army(380, 60, 'red', '■ 200K'),
    arrow('M268 70 L350 62', 'd-arrow big'),
    text(310, 40, 'battle', 'd-faint', { 'text-anchor': 'middle' }),
    army(160, 175, 'blue', '▲ 150K'),
    arrow('M190 175 Q300 190 420 165', 'd-arrow good'),
    text(430, 150, 'no army here: marched through', 'd-sub'),
    text(20, 210, 'our ground', 'd-faint'), text(520, 210, 'enemy ground', 'd-faint'),
    text(240, 140, 'zone it holds', 'd-faint', { 'text-anchor': 'middle' }));
}

function pincerDiagram() {
  return box('0 0 600 200', defs(),
    svg('polygon', { points: '300,40 360,75 360,135 300,170 240,135 240,75', class: 'd-target' }),
    text(300, 110, 'Target', 'd-title', { 'text-anchor': 'middle' }),
    arrow('M80 160 Q150 150 232 128', 'd-arrow big'),
    arrow('M520 40 Q450 50 368 80', 'd-arrow big'),
    svg('path', { d: 'M265 120 A40 40 0 0 1 335 88', class: 'd-angle' }),
    text(300, 64, '≥ 70°', 'd-sub', { 'text-anchor': 'middle' }),
    text(70, 186, 'Army A', 'd-sub'), text(470, 30, 'Army B', 'd-sub'),
    text(420, 160, '+15% or more', 'd-title'), text(420, 178, 'defenders lose men faster', 'd-sub'));
}

function pocketDiagram() {
  const cell = (x, y, cls) => svg('rect', { x, y, width: 56, height: 46, rx: 6, class: `d-cell ${cls}` });
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
    const x = 20 + c * 62;
    const y = 16 + r * 52;
    const inPocket = c >= 4 && c <= 5 && r >= 1 && r <= 2;
    const enemy = (c >= 6) || (c >= 4 && (r === 0 || r === 3));
    cells.push(cell(x, y, inPocket ? 'pocket' : enemy ? 'enemy' : 'home'));
  }
  return box('0 0 540 240', defs(), ...cells,
    svg('rect', { x: 262, y: 64, width: 118, height: 98, rx: 10, class: 'd-pocket' }),
    text(321, 108, 'POCKET', 'd-title', { 'text-anchor': 'middle' }), text(321, 126, '−10 org / week', 'd-sub', { 'text-anchor': 'middle' }),
    text(60, 236, 'Home (supplied)', 'd-sub'), text(420, 236, 'Enemy', 'd-sub'),
    arrow('M300 40 L300 64', 'd-arrow enemy'), arrow('M300 190 L300 164', 'd-arrow enemy'),
    arrow('M262 110 L210 110', 'd-arrow good'), text(150, 104, 'break out', 'd-sub'),
    svg('path', { d: 'M120 30 Q220 0 300 70', class: 'd-dotted' }), text(96, 26, '✈ airlift', 'd-sub'),
    arrow('M150 200 Q220 230 268 160', 'd-arrow good'), text(110, 218, 'relief', 'd-sub'));
}

function doctrineDiagram() {
  const cols = [['Attack', 'Armoured manoeuvre'], ['Defence', 'Mobile defence'], ['Air', 'Close support'], ['Logistics', 'Motor transport'], ['Command', 'Mission command']];
  return box('0 0 600 220', defs(),
    ...cols.flatMap(([t, v], i) => [
      svg('rect', { x: 14, y: 12 + i * 40, width: 190, height: 32, rx: 8, class: 'd-box blue' }),
      text(24, 26 + i * 40, t, 'd-faint'), text(24, 39 + i * 40, v, 'd-sub'),
      arrow(`M206 ${28 + i * 40} C240 ${28 + i * 40} 240 110 262 110`, 'd-arrow thin'),
    ]),
    svg('rect', { x: 264, y: 84, width: 130, height: 52, rx: 10, class: 'd-box amber' }),
    text(329, 106, 'Our doctrine', 'd-title', { 'text-anchor': 'middle' }), text(329, 123, 'trained · mastered', 'd-sub', { 'text-anchor': 'middle' }),
    arrow('M396 110 L446 110', 'd-arrow'), text(421, 98, 'battle', 'd-faint', { 'text-anchor': 'middle' }),
    svg('rect', { x: 448, y: 78, width: 140, height: 64, rx: 10, class: 'd-box green' }),
    text(518, 102, 'Blitzkrieg', 'd-title', { 'text-anchor': 'middle' }), text(518, 120, 'a new way of war', 'd-sub', { 'text-anchor': 'middle' }),
    text(518, 136, '★ first = pioneer', 'd-faint', { 'text-anchor': 'middle' }));
}

function matrixDiagram() {
  const offs = Object.keys(AXES.offence.options);
  const defs2 = Object.keys(AXES.defence.options);
  return h('table.matrix.help-matrix',
    h('thead', h('tr', h('th', ''), defs2.map((d) => h('th', AXES.defence.options[d].name)))),
    h('tbody', offs.map((o) => h('tr', h('th', AXES.offence.options[o].name), defs2.map((d) => {
      const v = MATCHUPS[o][d];
      return h('td', { style: { background: v > 0 ? `rgb(76 195 138 / ${0.15 + v * 2.5})` : v < 0 ? `rgb(229 72 77 / ${0.15 + -v * 3})` : 'transparent' } }, `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.round(Math.abs(v) * 100)}%`);
    })))));
}

function interceptDiagram() {
  return box('0 0 600 200', defs(),
    svg('rect', { x: 0, y: 0, width: 600, height: 200, class: 'd-sea' }),
    svg('path', { d: 'M30 170 L30 200 L0 200 L0 150 Z', class: 'd-land' }),
    svg('path', { d: 'M570 20 L600 0 L600 60 Z', class: 'd-land' }),
    svg('path', { d: 'M40 160 C200 150 380 80 560 36', class: 'd-lane' }),
    svg('circle', { cx: 150, cy: 150, r: 7, class: 'd-ship' }), text(120, 136, 'cargo', 'd-sub'),
    arrow('M162 146 L240 128', 'd-arrow thin'),
    svg('circle', { cx: 380, cy: 92, r: 26, class: 'd-escort' }), text(380, 134, 'escorts count here', 'd-faint', { 'text-anchor': 'middle' }),
    svg('circle', { cx: 380, cy: 92, r: 5, class: 'd-meet' }),
    svg('rect', { x: 420, y: 160, width: 44, height: 16, rx: 8, class: 'd-fleet' }), text(470, 172, 'our fleet', 'd-sub'),
    svg('path', { d: 'M440 160 Q420 120 386 98', class: 'd-dotted' }),
    text(300, 70, 'meets it ahead of the ship', 'd-title', { 'text-anchor': 'middle' }));
}

function raidDiagram() {
  return box('0 0 600 200', defs(),
    svg('rect', { x: 0, y: 0, width: 600, height: 200, class: 'd-sea' }),
    svg('ellipse', { cx: 300, cy: 100, rx: 220, ry: 80, class: 'd-raid' }),
    text(300, 34, 'the whole sea it was sent to', 'd-faint', { 'text-anchor': 'middle' }),
    ...[['M0 60 C200 70 400 40 600 50', 1], ['M0 120 C220 110 380 140 600 130', 0], ['M0 170 C200 150 420 180 600 160', 1]].map(([d]) => svg('path', { d, class: 'd-lane' })),
    svg('rect', { x: 278, y: 92, width: 44, height: 16, rx: 8, class: 'd-fleet' }),
    svg('path', { d: 'M300 92 Q290 70 250 64', class: 'd-dotted' }), svg('circle', { cx: 250, cy: 63, r: 6, class: 'd-ship hit' }),
    svg('path', { d: 'M300 108 Q330 130 380 136', class: 'd-dotted' }), svg('circle', { cx: 380, cy: 137, r: 6, class: 'd-ship hit' }),
    svg('circle', { cx: 520, cy: 163, r: 6, class: 'd-ship' }), text(470, 190, 'out of reach', 'd-faint'));
}

function routeDiagram() {
  return box('0 0 600 220', defs(),
    svg('rect', { x: 0, y: 0, width: 600, height: 220, class: 'd-sea' }),
    svg('path', { d: 'M20 30 Q120 10 210 40 L200 60 Q110 40 30 55 Z', class: 'd-land' }), text(60, 22, 'Cuba', 'd-sub'),
    svg('path', { d: 'M260 110 Q300 96 340 112 L330 126 Q300 118 268 124 Z', class: 'd-land' }),
    svg('path', { d: 'M300 112 m-70 0 a70 34 0 1 0 140 0 a70 34 0 1 0 -140 0', class: 'd-eez' }), text(300, 160, "Jamaica's waters", 'd-faint', { 'text-anchor': 'middle' }),
    svg('path', { d: 'M420 200 Q500 170 590 180 L590 220 L420 220 Z', class: 'd-land' }), text(520, 212, 'Panama / Colombia', 'd-sub', { 'text-anchor': 'middle' }),
    svg('path', { d: 'M150 50 C230 90 300 96 360 130 C420 160 470 175 500 182', class: 'd-route private' }),
    svg('circle', { cx: 150, cy: 50, r: 6, class: 'd-port' }), svg('circle', { cx: 500, cy: 182, r: 6, class: 'd-port' }),
    text(320, 86, '👁 likely to be spotted here', 'd-title', { 'text-anchor': 'start' }),
    text(40, 110, 'private line: hidden', 'd-sub'), text(40, 126, 'from everyone else', 'd-faint'));
}

function zoomDiagram() {
  const pane = (x, title, kids) => svg('g', {}, svg('rect', { x, y: 18, width: 170, height: 150, rx: 10, class: 'd-pane' }), text(x + 85, 190, title, 'd-sub', { 'text-anchor': 'middle' }), ...kids);
  return box('0 0 600 200', defs(),
    pane(10, 'The world: countries, fronts', [svg('path', { d: 'M30 60 Q70 40 110 60 T160 70 L150 130 Q100 150 40 130 Z', class: 'd-land' }), svg('path', { d: 'M95 50 C90 80 110 100 96 140', class: 'd-front' })]),
    arrow('M184 92 L210 92'),
    pane(214, 'Provinces, armies, fleets', [svg('rect', { x: 230, y: 40, width: 60, height: 50, class: 'd-cell home' }), svg('rect', { x: 292, y: 40, width: 60, height: 50, class: 'd-cell enemy' }), svg('rect', { x: 230, y: 92, width: 60, height: 50, class: 'd-cell home' }), svg('rect', { x: 292, y: 92, width: 60, height: 50, class: 'd-cell home' }), svg('rect', { x: 246, y: 60, width: 28, height: 12, rx: 3, class: 'd-fleet' })]),
    arrow('M388 92 L414 92'),
    pane(418, 'Close-up: every city', [svg('rect', { x: 434, y: 34, width: 138, height: 118, rx: 6, class: 'd-land' }), svg('circle', { cx: 470, cy: 70, r: 9, class: 'd-city' }), svg('circle', { cx: 530, cy: 110, r: 6, class: 'd-city fallen' }), svg('circle', { cx: 500, cy: 130, r: 4, class: 'd-city' }), svg('circle', { cx: 470, cy: 70, r: 18, class: 'd-ring' }), text(484, 58, 'click a city', 'd-faint')]));
}
