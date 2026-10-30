import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, lookupKeys, hashKey, dayStartMs, todayKey, addDays, dayOf } from '../public/js/shared.js';
import { parsePrompt, parseAll, publicPrompt, keyMap, pluralTwins } from '../lib/prompts.js';
import { planSchedule, pastDailyIds } from '../lib/schedule.js';

test('normalize ignores case, accents, punctuation, spaces and articles', () => {
  assert.equal(normalize('  Côte d’Ivoire '), normalize("cote divoire"));
  assert.equal(normalize('The Gambia'), normalize('gambia'));
  assert.equal(normalize('Bosnia & Herzegovina'), normalize('bosnia and herzegovina'));
  assert.equal(normalize('São Tomé and Príncipe'), normalize('sao tome and principe'));
  assert.equal(normalize('!!!'), '');
  assert.equal(normalize('C++'), normalize('c plus plus'));
  assert.equal(normalize('C#'), normalize('C sharp'));
  assert.notEqual(normalize('C++'), normalize('C'));
  assert.notEqual(normalize('C#'), normalize('C'));
  assert.equal(normalize('a'), 'a');
});

// Looks a typed answer up the way the game does
const find = (stored, typed) => {
  const keys = new Map(stored.map((s) => [normalize(s), s]));
  return lookupKeys(normalize(typed)).map((k) => keys.get(k)).find(Boolean);
};

test('lookupKeys finds singular and plural forms either way round', () => {
  const pairs = [
    ['cherry', 'cherries'], ['movie', 'movies'], ['box', 'boxes'], ['glass', 'glasses'],
    ['horse', 'horses'], ['toy', 'toys'], ['key', 'keys'], ['bus', 'buses'], ['pie', 'pies'],
    ['potato', 'potatoes'], ['fly', 'flies'], ['shoe', 'shoes'], ['peach', 'peaches'],
    ['gas', 'gases'], ['dress', 'dresses'], ['monkey', 'monkeys'], ['hero', 'heroes'], ['Brussels sprout', 'brussels sprouts'],
  ];
  for (const [one, many] of pairs) {
    assert.equal(find([one], many), one, `typed ${many}, stored ${one}`);
    assert.equal(find([many], one), many, `typed ${one}, stored ${many}`);
  }
});

test('similar answers stay apart', () => {
  assert.equal(find(['Cap', 'Cape'], 'cape'), 'Cape');
  assert.equal(find(['Cap', 'Cape'], 'capes'), 'Cape');
  assert.equal(find(['Cap', 'Cape'], 'caps'), 'Cap');
  assert.equal(find(['Mil', 'Mile'], 'miles'), 'Mile');
  assert.equal(find(['Mil', 'Mile'], 'mil'), 'Mil');
  assert.equal(find(['Paris'], 'par'), undefined);
  assert.notEqual(normalize('Cape'), normalize('Cap'));
});

test('hashKey is stable and depends on the salt', async () => {
  const a = await hashKey('p1', 'egypt');
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, await hashKey('p1', 'egypt'));
  assert.notEqual(a, await hashKey('p2', 'egypt'));
});

test('days start at midnight New York time, through both clock changes', () => {
  assert.equal(new Date(dayStartMs('2026-07-04')).toISOString(), '2026-07-04T04:00:00.000Z');
  assert.equal(new Date(dayStartMs('2026-12-25')).toISOString(), '2026-12-25T05:00:00.000Z');
  assert.equal(new Date(dayStartMs('2026-03-08')).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(new Date(dayStartMs('2026-11-01')).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(todayKey(Date.parse('2026-10-30T03:59:00Z')), '2026-10-29');
  assert.equal(todayKey(Date.parse('2026-10-30T04:00:00Z')), '2026-10-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(dayOf(dayStartMs('2027-01-01') - 1), '2026-12-31');
});

const tenAnswers = { common: ['A1', 'A2', 'A3'], familiar: ['B1', 'B2'], uncommon: ['C1', 'C2'], rare: ['D1'], outlier: ['E1|E one', 'E2'] };
const raw = (over = {}) => ({ id: 'test-prompt', pool: 'daily', prompt: 'Name a test', answers: tenAnswers, ...over });

test('parsePrompt reads tiers and aliases', () => {
  const p = parsePrompt(raw());
  assert.equal(p.answers.length, 10);
  const map = keyMap(p);
  assert.equal(map.get(normalize('e one')).name, 'E1');
  assert.equal(map.get(normalize('a2')).tier, 0);
  assert.equal(map.get(normalize('E2')).tier, 4);
});

test('parsePrompt rejects bad content with a useful message', () => {
  assert.throws(() => parsePrompt(raw({ id: 'Bad Id' })), /id must be/);
  assert.throws(() => parsePrompt(raw({ pool: 'weekly' })), /pool must be/);
  assert.throws(() => parsePrompt(raw({ answers: { ...tenAnswers, legendary: ['X'] } })), /unknown tier "legendary"/);
  assert.throws(() => parsePrompt(raw({ answers: { common: ['A'] } })), /at least 10/);
  assert.throws(() => parsePrompt(raw({ answers: { ...tenAnswers, rare: ['D1', 'd-1'] } })), /"d-1" matches both "D1" and "d-1"/);
  const twins = parsePrompt(raw({ answers: { ...tenAnswers, rare: ['D1', 'Cherries'], common: ['A1', 'A2', 'A3', 'Cherry'] } }));
  assert.deepEqual(pluralTwins(twins), [['Cherries', 'Cherry']]);
  assert.throws(() => parseAll([{ name: 'a.json', data: [raw()] }, { name: 'b.json', data: [raw()] }]), /also used in a.json/);
});

test('publicPrompt scrambles every form and keeps the top picks for the reveal', async () => {
  const p = parsePrompt(raw());
  const pub = await publicPrompt(p);
  assert.equal(Object.keys(pub.keys).length, 11);
  assert.equal(pub.keys[await hashKey(p.id, normalize('E One'))], 4);
  assert.deepEqual(pub.examples.map((e) => e.name), ['E1', 'D1', 'C1']);
  assert.ok(!JSON.stringify(pub.keys).includes('A1'));
});

const ids = (n, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

test('planSchedule fills whole days starting today and keeps spares', () => {
  const { schedule, spare } = planSchedule({ dailyIds: ids(12), today: '2026-10-30', perDay: 5 });
  assert.deepEqual(schedule, { '2026-10-30': ids(5), '2026-10-31': ids(10).slice(5) });
  assert.deepEqual(spare, ['p11', 'p12']);
});

test('planSchedule never changes today or earlier days', () => {
  const first = planSchedule({ dailyIds: ids(15), today: '2026-10-30', perDay: 5 }).schedule;
  // Next day: p1 deleted, p7 deleted, three new prompts added
  const dailyIds = ids(15).filter((id) => id !== 'p1' && id !== 'p7').concat(ids(3, 'n'));
  const { schedule, spare } = planSchedule({ schedule: first, dailyIds, today: '2026-10-31', perDay: 5 });
  assert.deepEqual(schedule['2026-10-30'], ids(5), 'yesterday kept, even with p1 gone');
  assert.deepEqual(schedule['2026-10-31'], ['p6', 'p7', 'p8', 'p9', 'p10'], 'today kept');
  assert.deepEqual(schedule['2026-11-01'], ['p11', 'p12', 'p13', 'p14', 'p15']);
  assert.deepEqual(spare, ['n1', 'n2', 'n3']);
  assert.deepEqual(pastDailyIds(schedule, '2026-10-31'), ids(5));
});

test('planSchedule refills later days when a scheduled prompt is removed', () => {
  const first = planSchedule({ dailyIds: ids(15), today: '2026-10-30', perDay: 5 }).schedule;
  const dailyIds = ids(15).filter((id) => id !== 'p12').concat(['n1']);
  const { schedule } = planSchedule({ schedule: first, dailyIds, today: '2026-10-30', perDay: 5 });
  assert.deepEqual(schedule['2026-11-01'], ['p11', 'p13', 'p14', 'p15', 'n1']);
});

test('planSchedule picks up again today after the schedule ran out', () => {
  const first = planSchedule({ dailyIds: ids(5), today: '2026-10-01', perDay: 5 }).schedule;
  const { schedule } = planSchedule({ schedule: first, dailyIds: ids(10), today: '2026-10-30', perDay: 5 });
  assert.deepEqual(Object.keys(schedule), ['2026-10-01', '2026-10-30']);
});
