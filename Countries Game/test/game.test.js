import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, resolveCountry, normalize } from '../public/js/countries.js';
import { finalizeRound } from '../public/js/rounds.js';
import { BANK, THEMES as BANK_THEMES, THEME_LABELS } from '../public/js/bank/index.js';
import { deckProgress, drawRound, eligibleRounds, randomIndex, resetDeck } from '../public/js/deck.js';
import { THEMES, _extractText, parseJson } from '../lib/generator.js';

test('country codes and names are unique', () => {
  const codes = new Set(COUNTRIES.map(([code]) => code));
  const names = new Set(COUNTRIES.map(([, name]) => normalize(name)));
  assert.equal(codes.size, COUNTRIES.length);
  assert.equal(names.size, COUNTRIES.length);
});

test('every name and alias resolves to its own country', () => {
  for (const [code, name, ...aliases] of COUNTRIES) {
    for (const key of [name, ...aliases]) {
      assert.deepEqual(resolveCountry(key), [code], `${key} should resolve to ${code}`);
    }
  }
});

test('common spellings resolve', () => {
  const cases = {
    'U.S.A.': 'US',
    'the united states': 'US',
    'UK': 'GB',
    'St. Lucia': 'LC',
    'St Kitts & Nevis': 'KN',
    'Ivory Coast': 'CI',
    "cote d'ivoire": 'CI',
    'Türkiye': 'TR',
    'czech republic': 'CZ',
    '  BRAZIL  ': 'BR',
    'Sao Tome and Principe': 'ST',
    'burma': 'MM',
  };
  for (const [input, code] of Object.entries(cases)) {
    assert.deepEqual(resolveCountry(input), [code], input);
  }
});

test('small typos are forgiven, risky ones are not', () => {
  assert.deepEqual(resolveCountry('Argentinia'), ['AR']);
  assert.deepEqual(resolveCountry('Phillipines'), ['PH']);
  assert.deepEqual(resolveCountry('Columbia'), ['CO']);
  assert.deepEqual(resolveCountry('Kazakstan'), ['KZ']);
  // Distinct real countries must never be confused.
  assert.deepEqual(resolveCountry('Iran'), ['IR']);
  assert.deepEqual(resolveCountry('Iraq'), ['IQ']);
  assert.deepEqual(resolveCountry('Niger'), ['NE']);
  assert.deepEqual(resolveCountry('Austria'), ['AT']);
  assert.deepEqual(resolveCountry('Australia'), ['AU']);
  assert.deepEqual(resolveCountry('Slovenia'), ['SI']);
  assert.deepEqual(resolveCountry('Gambia'), ['GM']);
  assert.deepEqual(resolveCountry('Zambia'), ['ZM']);
  assert.deepEqual(resolveCountry('Sudan'), ['SD']);
  assert.deepEqual(resolveCountry('Guinea'), ['GN']);
  assert.deepEqual(resolveCountry('Dominica'), ['DM']);
  // Nonsense and too-short inputs.
  assert.deepEqual(resolveCountry('Atlantis'), []);
  assert.deepEqual(resolveCountry('Irna'), []);
  assert.deepEqual(resolveCountry(''), []);
});

test('ambiguous names return every candidate', () => {
  assert.deepEqual(resolveCountry('Congo'), ['CD', 'CG']);
  assert.deepEqual(resolveCountry('Korea'), ['KR', 'KP']);
});

test('the bank has at least 150 rounds, all valid', () => {
  assert.ok(BANK.length >= 150, `only ${BANK.length} rounds`);
  for (const round of BANK) {
    const label = `${round.direction} ${round.title}`;
    assert.ok(['top', 'bottom'].includes(round.direction), label);
    assert.ok(round.title && round.description && round.source, `${label}: missing text`);
    assert.equal(round.answers.length, 10, `${label}: needs exactly 10 answers`);
    // Every answer must name exactly one known country, with no duplicates.
    for (const [country, value] of round.answers) {
      assert.equal(resolveCountry(country).length, 1, `${label}: unknown country "${country}"`);
      assert.ok(value, `${label}: ${country} has no value`);
    }
    const result = finalizeRound(round, round.direction);
    assert.equal(result.answers.length, 10, label);
    // Names should be written the way the game displays them, so a typo in
    // the data can't silently fuzzy-match a different country.
    for (const [i, [country]] of round.answers.entries()) {
      const shown = result.answers[i].country;
      assert.ok(
        normalize(country) === normalize(shown) || resolveCountry(country)[0] === result.answers[i].code,
        `${label}: "${country}" resolved to ${shown}`,
      );
    }
  }
});

test('bank round ids are unique and every theme has rounds', () => {
  const ids = BANK.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate round id');
  for (const { id, rounds } of BANK_THEMES) {
    assert.ok(rounds.length > 0, `theme ${id} is empty`);
    assert.ok(THEME_LABELS[id]);
  }
});

test('bank answers never rely on fuzzy matching', () => {
  // Every name in the data should be an exact name or alias, not a typo.
  const exactKeys = new Set();
  for (const [, name, ...aliases] of COUNTRIES) {
    for (const key of [name, ...aliases]) exactKeys.add(normalize(key));
  }
  for (const round of BANK) {
    for (const [country] of round.answers) {
      assert.ok(exactKeys.has(normalize(country)), `${round.title}: "${country}" is not an exact name`);
    }
  }
});

test('finalizeRound accepts model output and rejects bad output', () => {
  const answers = ['USA', 'China', 'Japan', 'Germany', 'India', 'UK', 'France', 'Italy', 'Canada', 'Brazil'].map(
    (country, i) => ({ country, value: `${10 - i}` }),
  );
  const round = finalizeRound({ title: 'GDP', description: 'd', source: 's', answers }, 'top');
  assert.equal(round.answers[0].country, 'United States');
  assert.equal(round.answers[5].code, 'GB');

  assert.throws(() => finalizeRound({ title: 'x', answers: answers.slice(0, 9) }, 'top'));
  assert.throws(() => finalizeRound({ title: 'x', answers: [...answers.slice(0, 9), { country: 'Hong Kong' }] }, 'top'));
  assert.throws(() => finalizeRound({ title: 'x', answers: [...answers.slice(0, 9), { country: 'America' }] }, 'top'));
  assert.throws(() => finalizeRound({ title: 'x', answers: [...answers.slice(0, 9), { country: 'Congo' }] }, 'top'));
});

test('themes cover both directions', () => {
  const dirs = new Set(THEMES.map(([, d]) => d));
  assert.ok(THEMES.some(([, d]) => d === 'both' || d === 'bottom'));
  for (const d of dirs) assert.ok(['both', 'top', 'bottom'].includes(d));
});

test('model text is extracted from either API shape', () => {
  const interactions = { steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"a":1}' }] }] };
  const legacy = { candidates: [{ content: { parts: [{ text: '{"a":2}' }] } }] };
  assert.equal(_extractText(interactions), '{"a":1}');
  assert.equal(_extractText(legacy), '{"a":2}');
  assert.deepEqual(parseJson('```json\n{"a":3}\n```'), { a: 3 });
});

test('randomIndex stays in range', () => {
  for (let i = 0; i < 1000; i++) {
    const n = randomIndex(7);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 7);
  }
  assert.equal(randomIndex(1), 0);
});

test('deck deals every eligible round once before repeating', () => {
  const seen = new Set();
  const filters = { dir: 'mix', theme: 'all' };
  const dealt = new Set();
  let last = null;
  for (let i = 0; i < BANK.length; i++) {
    const { round, newCycle } = drawRound(filters, seen, last);
    assert.equal(newCycle, false, `cycle restarted early at draw ${i}`);
    assert.ok(!dealt.has(round.id), `repeat of ${round.id} at draw ${i}`);
    dealt.add(round.id);
    last = round.id;
  }
  assert.equal(dealt.size, BANK.length);
  assert.deepEqual(deckProgress(filters, seen), { seen: BANK.length, total: BANK.length });

  // The next draw starts a new cycle and never repeats the round just played.
  const { round, newCycle } = drawRound(filters, seen, last);
  assert.equal(newCycle, true);
  assert.notEqual(round.id, last);
  assert.equal(deckProgress(filters, seen).seen, 1);
});

test('deck filters by theme and direction', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const { round } = drawRound({ dir: 'bottom', theme: 'regions' }, seen);
    assert.equal(round.direction, 'bottom');
    assert.equal(round.theme, 'regions');
  }
  // Sport has no bottom-10 rounds, so the direction filter is relaxed.
  const { pool, relaxed } = eligibleRounds({ dir: 'bottom', theme: 'sport' });
  assert.equal(relaxed, true);
  assert.ok(pool.length > 0 && pool.every((r) => r.theme === 'sport'));
  assert.equal(drawRound({ dir: 'bottom', theme: 'sport' }, new Set()).relaxed, true);
});

test('resetDeck only forgets rounds in the current selection', () => {
  const seen = new Set(BANK.map((r) => r.id));
  resetDeck({ dir: 'mix', theme: 'food' }, seen);
  const food = BANK.filter((r) => r.theme === 'food');
  assert.ok(food.every((r) => !seen.has(r.id)));
  assert.equal(seen.size, BANK.length - food.length);
});
