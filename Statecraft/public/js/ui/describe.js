// Plain-English descriptions of proposals, matching the engine's.

import { RESOURCE_INFO } from '../engine/data/regions.js';
import { nationName, regionName, money } from './dom.js';

export function describeProposal(s, p) {
  const t = p.terms ?? {};
  switch (p.kind) {
    case 'alliance': return `joining ${s.alliances.find((a) => a.id === t.alliance)?.name ?? 'an alliance'}`;
    case 'fta': return 'a free trade agreement';
    case 'nap': return 'a non-aggression pact';
    case 'access': return 'mutual military access';
    case 'deal': {
      const info = RESOURCE_INFO[t.res];
      const buyer = t.seller === p.from ? p.to : p.from;
      return `${nationName(s, t.seller)} sells ${nationName(s, buyer)} ${t.qty} ${info.unit} of ${info.name.toLowerCase()} a year for ${money(Number(t.price))} a year, for ${t.weeks} weeks`;
    }
    case 'loan': return `a loan of ${money(Number(t.amount))} over ${t.years} years at ${t.rate}%`;
    case 'peace': {
      const parts = [t.armistice ? 'an armistice along the current front' : 'peace'];
      for (const c of t.cede ?? []) parts.push(`${regionName(c.region)} goes to ${nationName(s, c.to)}`);
      if (t.reparations?.amount) parts.push(`${nationName(s, t.reparations.from)} pays ${money(Number(t.reparations.amount))} a year for ${t.reparations.years ?? 5} years`);
      if (t.access) parts.push('military access for each other\'s troops');
      return parts.join('; ');
    }
    case 'joinWar': return `joining the war against ${nationName(s, t.enemy)}`;
    case 'callToArms': return `that you honour your alliance and defend ${nationName(s, t.ally)} against ${nationName(s, t.enemy)}`;
    default: return p.kind;
  }
}
