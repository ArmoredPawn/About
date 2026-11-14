// A one-time tour of what's new, the first time a player enters a game after an update. Each card says what the
// system does in a sentence and opens the place to try it.

import { h } from './dom.js';
import { modal } from './dialogs.js';

const KEY = 'statecraft.whatsnew';
const VERSION = '2026-11-navies';

const ITEMS = [
  ['⚓', 'Navies on the map', 'Fleets sail the seas and straits. Click a fleet, then a sea or a coast: hold it, blockade an enemy, or patrol a strait. Landings need a fleet off the coast.', ['military', 'navy']],
  ['🏳', 'Peoples and loyalty', 'Conquered peoples resist, and independence movements can be won over, held down or put to a referendum.', ['government', 'peoples']],
  ['📦', 'Arm & fund', 'Send weapons, money or volunteers to someone else\'s war, or to rebels, openly or covertly.', ['diplomacy', 'aid']],
  ['🛢', 'Oil & pipelines', 'OPEC+ cuts output and can embargo you; pipelines get fuel past blockades and closed straits.', ['market', 'energy']],
  ['🌡', 'Climate', 'Emissions warm the world for good: more disasters, failing harvests. Tax carbon and make pledges.', ['world', 'climate']],
  ['🛰', 'Space', 'Spy satellites count every army on Earth; your own GPS guides missiles. Race for the Moon and Mars.', ['research', 'space']],
];

export function whatsNew(ctx, { force = false } = {}) {
  let seen = null;
  try { seen = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (seen === VERSION && !force) return;
  try { localStorage.setItem(KEY, VERSION); } catch { /* private mode */ }
  let dlg = null;
  const card = ([icon, title, text, [tab, sub]]) => h('div.item.whatsnew',
    h('div.item-head', h('span.whatsnew-icon', { 'aria-hidden': 'true' }, icon), h('span.name', title),
      h('button.btn.small', { style: { marginLeft: 'auto' }, onclick: () => { dlg?.close(); ctx.go(tab, sub); } }, 'Show me')),
    h('div.meta', text));
  dlg = modal({
    title: 'New in Statecraft',
    body: h('div.stack',
      h('p.muted.small', 'Six new ways to run the world. Each has its own tab; the Cabinet warns you when one needs attention, and the ? button explains everything.'),
      h('div.list', ITEMS.map(card))),
    actions: [{ label: 'Got it', kind: 'primary' }],
  });
}
