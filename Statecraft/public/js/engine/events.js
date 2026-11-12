// Covert operations and the random events of a turbulent world.

import { RESOURCES, RESOURCE_INFO } from './data/regions.js';
import { REGION_NAMES } from './names.js';
import { clamp, rand, chance, pick, news, alert, nameOf, alive, addRel, nextId, enemiesOf } from './core.js';

const regionName = (id) => REGION_NAMES[id] ?? id;

/* ---------- Intelligence ---------- */

export const INTEL = {
  spy: { name: 'Gather intelligence', cost: 0.2, note: 'See their forces, treasury, plans and nuclear programme for six months.' },
  sabotage: { name: 'Sabotage', cost: 1, region: true, note: 'Wreck oil fields, mines, fabs or factories in one of their provinces.' },
  cyber: { name: 'Cyberattack', cost: 0.5, note: 'Knock out power grids and banks: their output falls for two months.' },
  steal: { name: 'Steal technology', cost: 1, note: 'Lift research from a field where they lead you.' },
  destabilize: { name: 'Fund the opposition', cost: 0.5, note: 'Stir protests: their approval and stability fall.' },
};

export function covertOp(s, c, op, target, regionId) {
  const def = INTEL[op];
  const t = s.countries[target];
  if (!def || !t || target === c.id || !alive(s, target)) return 'Pick an operation and a country.';
  const key = `intel:${op}:${target}`;
  if ((c.cooldown[key] ?? -1) > s.week) return `Our agents need ${c.cooldown[key] - s.week} more weeks before trying that again.`;
  const cost = def.cost * (0.5 + Math.min(1, c.gdp / 2000) * 0.5);
  if (c.treasury < cost) return 'Not enough money in the treasury.';
  if (def.region) {
    const reg = s.regions[regionId];
    if (!reg || reg.ctrl !== target) return `Pick a province held by ${t.name}.`;
  }
  c.treasury -= cost;
  c.cooldown[key] = s.week + 8;
  const edge = c.tech.cyber - t.tech.cyber;
  const success = chance(s, clamp(0.55 + 0.06 * edge, 0.1, 0.92));
  const caught = chance(s, clamp(0.3 - 0.04 * edge + (success ? 0 : 0.2), 0.05, 0.75));
  let result = '';
  if (success) {
    switch (op) {
      case 'spy':
        c.intel[target] = s.week + 26;
        result = `Our agents have penetrated ${t.name}'s government. Full intelligence for six months.`;
        break;
      case 'sabotage': {
        const reg = s.regions[regionId];
        reg.dmg = Math.min(0.9, reg.dmg + 0.15);
        const what = Object.keys(reg.res).map((r) => RESOURCE_INFO[r].name.toLowerCase()).join(', ') || 'industry';
        result = `Saboteurs struck ${regionName(regionId)}: ${what} output is down.`;
        news(s, `Explosions at key facilities in ${regionName(regionId)} (${t.name}). The cause is unknown.`, 'incident', [target]);
        break;
      }
      case 'cyber':
        s.modifiers.push({ id: nextId(s, 'm'), cid: target, kind: 'gdp', value: -0.012, until: s.week + 8 });
        result = `Our cyberattack crippled ${t.name}'s grid and banks.`;
        news(s, `A massive cyberattack paralyses power and banking in ${t.name}.`, 'incident', [target]);
        break;
      case 'steal': {
        const fields = Object.keys(c.tech).filter((f) => t.tech[f] > c.tech[f]);
        if (!fields.length) { result = `${t.name} has nothing we don't already know.`; break; }
        const f = pick(s, fields);
        c.progress[f] += 0.6 * 1.5 * Math.pow(1.55, c.tech[f]);
        result = `Our agents stole ${f} research from ${t.name}.`;
        break;
      }
      case 'destabilize':
        t.approval = Math.max(0, t.approval - 4);
        t.stability = Math.max(0, t.stability - 7);
        result = `Opposition groups in ${t.name} are on the streets.`;
        news(s, `Large anti-government protests break out in ${t.name}.`, 'unrest', [target]);
        break;
    }
  } else {
    result = `The operation against ${t.name} failed.`;
  }
  if (caught) {
    addRel(s, c.id, target, -25);
    c.rep = Math.max(0, c.rep - 5);
    alert(s, target, `Our counter-intelligence caught ${c.name} attempting: ${def.name.toLowerCase()}.`, 'bad');
    news(s, `${t.name} accuses ${c.name} of ${op === 'cyber' ? 'a cyberattack' : 'espionage'}.`, 'incident', [c.id, target]);
    result += ' Our agents were exposed.';
  }
  alert(s, c.id, result, success ? 'good' : 'warn');
  return null;
}

/* ---------- World events ---------- */

const QUAKES = ['jpn-kn', 'jpn-ks', 'jpn-th', 'tur-is', 'tur-ea', 'irn-th', 'chl-sa', 'idn-jk', 'idn-sm', 'mex-mx', 'usa-ca', 'phl-mn', 'twn-tc', 'ita-ca', 'per-li', 'pak-kp', 'chn-sc', 'col-bo'];
const STORMS = ['usa-se', 'usa-tx', 'mex-yu', 'phl-vi', 'jpn-ky', 'chn-gd', 'bgd-kh', 'ind-ap', 'vnm-ct', 'twn-ts'];

export function eventsTick(s) {
  const countries = Object.values(s.countries).filter((c) => alive(s, c.id));
  if (!countries.length) return;
  const roll = rand(s);

  if (roll < 0.0025) {
    s.modifiers.push({ id: nextId(s, 'm'), cid: 'all', kind: 'growth', value: -1.8, until: s.week + 30 });
    news(s, 'Global recession: a banking crisis spreads from market to market. Growth is slowing everywhere.', 'economy');
  } else if (roll < 0.0035) {
    s.modifiers.push({ id: nextId(s, 'm'), cid: 'all', kind: 'growth', value: -3, until: s.week + 26 });
    s.modifiers.push({ id: nextId(s, 'm'), cid: 'all', kind: 'approval', value: -4, until: s.week + 26 });
    news(s, 'A new pandemic is spreading worldwide. Borders tighten and economies stall.', 'disaster');
  } else if (roll < 0.0135) {
    const id = pick(s, QUAKES);
    const reg = s.regions[id];
    if (reg) {
      reg.dmg = Math.min(0.9, reg.dmg + 0.08);
      news(s, `A major earthquake strikes ${regionName(id)} (${nameOf(s, reg.owner)}).`, 'disaster', [reg.owner]);
      alert(s, reg.owner, `Earthquake in ${regionName(id)}: damage ${Math.round(reg.dmg * 100)}%. Infrastructure spending will speed recovery.`, 'bad', { region: id });
    }
  } else if (roll < 0.0255) {
    const id = pick(s, STORMS);
    const reg = s.regions[id];
    if (reg) {
      reg.dmg = Math.min(0.9, reg.dmg + 0.05);
      news(s, `A powerful storm batters ${regionName(id)} (${nameOf(s, reg.owner)}).`, 'disaster', [reg.owner]);
      alert(s, reg.owner, `A storm hit ${regionName(id)}.`, 'bad', { region: id });
    }
  } else if (roll < 0.0325) {
    const options = Object.values(s.regions).filter((r) => r.res.oil || r.res.gas || r.res.metal || r.res.rare);
    const reg = pick(s, options);
    const r = pick(s, Object.keys(reg.res).filter((k) => ['oil', 'gas', 'metal', 'rare'].includes(k)));
    reg.res[r][1] = Math.round(reg.res[r][1] * 1.35 * 100 + 10) / 100;
    news(s, `Geologists announce a large new ${RESOURCE_INFO[r].name.toLowerCase()} find in ${regionName(reg.id)}.`, 'economy', [reg.owner]);
    alert(s, reg.owner, `New ${RESOURCE_INFO[r].name.toLowerCase()} reserves found in ${regionName(reg.id)}: develop them to raise output.`, 'good', { region: reg.id });
  } else if (roll < 0.0395) {
    const c = pick(s, countries.filter((x) => x.tech.industry >= 8));
    if (c) {
      s.modifiers.push({ id: nextId(s, 'm'), cid: c.id, kind: 'growth', value: 0.8, until: s.week + 52 });
      news(s, `A technology boom is lifting ${c.name}'s economy.`, 'economy', [c.id]);
    }
  } else if (roll < 0.047) {
    const c = pick(s, countries);
    if (c.approval < 40) {
      s.modifiers.push({ id: nextId(s, 'm'), cid: c.id, kind: 'stability', value: -10, until: s.week + 8 });
      news(s, `General strike in ${c.name}: unions shut down ports and factories.`, 'unrest', [c.id]);
      alert(s, c.id, 'A general strike has broken out. Higher welfare spending or lower taxes would calm things.', 'bad');
    }
  } else if (roll < 0.052) {
    const dry = pick(s, ['usa-pl', 'ind-up', 'chn-bj', 'arg-pa', 'aus-ns', 'bra-mt', 'rus-so', 'can-pr', 'm-ukraine']);
    const reg = s.regions[dry];
    if (reg?.res.food) {
      const before = reg.res.food[0];
      reg.res.food[0] = Math.round(before * 0.7);
      s.modifiers.push({ id: nextId(s, 'm'), cid: '__restore', kind: 'drought', region: dry, value: before, until: s.week + 26 });
      news(s, `Drought withers the harvest in ${regionName(dry)}. Grain prices are climbing.`, 'disaster', [reg.owner]);
    }
  }
  // Droughts end
  for (const m of s.modifiers) {
    if (m.kind === 'drought' && m.until <= s.week + 1 && s.regions[m.region]?.res.food) s.regions[m.region].res.food[0] = Math.max(s.regions[m.region].res.food[0], m.value);
  }
  // Wars push people out
  for (const c of countries) {
    if (enemiesOf(s, c.id).size && chance(s, 0.004)) news(s, `Refugees stream out of the war zones of ${c.name}.`, 'war', [c.id]);
  }
  // Damage slowly mends; occupation breeds resistance
  for (const reg of Object.values(s.regions)) {
    if (reg.dmg > 0 && !reg.battle) {
      const owner = s.countries[reg.ctrl];
      const fix = 0.002 + (owner ? owner.spend.infra * 0.0006 : 0.001);
      reg.dmg = Math.max(0, reg.dmg - fix);
    }
    if (reg.ctrl !== reg.owner) reg.unrest = Math.min(90, reg.unrest + 0.3);
    else reg.unrest = Math.max(0, reg.unrest - 0.8);
  }
}

export { RESOURCES };
