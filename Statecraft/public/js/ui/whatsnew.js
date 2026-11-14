// A one-time tour of what's new, the first time a player enters a game after an update. Each card says what the
// system does in a sentence and opens the place to try it.

import { h } from './dom.js';
import { modal } from './dialogs.js';

const KEY = 'statecraft.whatsnew';
const VERSION = '2026-11-crises';

const ITEMS = [
  ['📈', 'Money and markets', 'Your currency, stock market and credit rating move with your policies and the world. Spend too freely and the markets stop lending: then it\u2019s the IMF (with conditions), austerity, the printing press or default.', ['economy', 'markets']],
  ['🦠', 'Global crises', 'Pandemics, financial crashes, famines and terror attacks. Lock down or stay open, fund and share a vaccine, bail out the banks, join a world stimulus, send food aid.', ['world', 'crises']],
  ['🎖', 'Coups and regime change', 'Keep the army loyal or the generals may take over. Fund plotters abroad through your spies, or install a friendly government as a peace term.', ['government', 'power']],
  ['🤫', 'Public or secret alliances', 'When you found an alliance, choose: public (it deters attackers) or secret (only members know).', ['diplomacy', 'alliances']],
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
      h('p.muted.small', 'What changed since you last played. Decisions a crisis forces on you appear at the top of the Cabinet. The ? button explains everything.'),
      h('div.list', ITEMS.map(card))),
    actions: [{ label: 'Got it', kind: 'primary' }],
  });
}
