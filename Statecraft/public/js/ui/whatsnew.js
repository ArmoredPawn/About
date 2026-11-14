// A one-time tour of what's new, the first time a player enters a game after an update. Each card says what the
// system does in a sentence and opens the place to try it.

import { h } from './dom.js';
import { modal } from './dialogs.js';

const KEY = 'statecraft.whatsnew';
const VERSION = '2026-11-world';

const ITEMS = [
  ['🌍', 'The whole world plays', 'All 150 smaller nations are now countries with their own economy, army and navy, run by the computer. They found regional trade blocs, ask great powers for protection and fight old feuds. Only the 50 largest can be led by a person.', ['diplomacy', 'countries']],
  ['🤝', 'A world to build', 'No alliances and no oil cartel exist at the start: found them yourself, or watch others do it.', ['diplomacy', 'alliances']],
  ['🛂', 'Ask before you march through', 'An army whose road crosses another country asks it for access. If it agrees, the army marches on; if it refuses, the way is shut until you beat it in a war.', ['military', 'armies']],
  ['⚓', 'Fleets where they really are', 'Every fleet sits at its exact spot on the water. Form one at any of your ports, click it, then click anywhere on the sea.', ['military', 'navy']],
  ['✈', 'Air war and missiles', 'Give your armies close air support, cut the enemy’s supply lines, or bomb its industry. Fire missiles at armies, forts, airbases or factories, and see what they hit.', ['military', 'ops']],
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
      h('p.muted.small', 'What changed since you last played. The ? button explains everything, including navies, peoples, arm & fund, oil, climate and space.'),
      h('div.list', ITEMS.map(card))),
    actions: [{ label: 'Got it', kind: 'primary' }],
  });
}
