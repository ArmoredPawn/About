// Reads and checks prompt files, and turns a prompt into the two forms that get stored:
// the full answer key (server only) and the scrambled version browsers download.

import { TIERS, normalize, lookupKeys, hashKey } from '../public/js/shared.js';

const TIER_IDS = TIERS.map((t) => t.id);
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_ANSWERS = 10;

// One prompt from a content file. Each answer is "Display name" or "Display name|alias|alias".
// Throws with a message naming the prompt when something is wrong.
export function parsePrompt(raw, where = 'content') {
  const label = `${where}: ${raw?.id ?? '(prompt with no id)'}`;
  const fail = (msg) => { throw new Error(`${label}: ${msg}`); };

  if (!raw || typeof raw !== 'object') fail('is not an object');
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) fail('id must be lowercase words joined by hyphens');
  if (raw.pool !== 'daily' && raw.pool !== 'unlimited') fail('pool must be "daily" or "unlimited"');
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 120) fail('prompt must be 1-120 characters');
  if (!raw.answers || typeof raw.answers !== 'object') fail('answers is missing');

  const answers = [];
  for (const [tierId, list] of Object.entries(raw.answers)) {
    const tier = TIER_IDS.indexOf(tierId);
    if (tier === -1) fail(`unknown tier "${tierId}" (use ${TIER_IDS.join(', ')})`);
    if (!Array.isArray(list)) fail(`answers.${tierId} must be a list`);
    for (const entry of list) {
      if (typeof entry !== 'string') fail(`answers.${tierId} has a non-text entry`);
      const [name, ...aliases] = entry.split('|').map((s) => s.trim());
      if (!name) fail(`answers.${tierId} has an empty entry`);
      answers.push({ name, aliases: aliases.filter(Boolean), tier });
    }
  }
  if (answers.length < MIN_ANSWERS) fail(`needs at least ${MIN_ANSWERS} answers, has ${answers.length}`);

  const prompt = { id: raw.id, pool: raw.pool, text: raw.prompt.trim(), answers };
  keyMap(prompt, fail);
  return prompt;
}

// Comparable key -> { name, tier }. Two different answers may not share a key.
export function keyMap(prompt, fail = (msg) => { throw new Error(`${prompt.id}: ${msg}`); }) {
  const map = new Map();
  for (const answer of prompt.answers) {
    for (const form of [answer.name, ...answer.aliases]) {
      const key = normalize(form);
      if (!key) fail(`"${form}" has no letters or digits`);
      const prev = map.get(key);
      if (prev && prev !== answer) fail(`"${form}" matches both "${prev.name}" and "${answer.name}"`);
      map.set(key, answer);
    }
  }
  return map;
}

// Pairs of answers that differ only by a plural ending, like "Cherry" and "Cherries" (usually the same
// answer listed twice) or "Xbox One" and "Xbox One S" (fine). The seed script lists them as warnings.
export function pluralTwins(prompt) {
  const map = keyMap(prompt);
  const pairs = [];
  for (const [key, answer] of map) {
    for (const k of lookupKeys(key).slice(1)) {
      const other = map.get(k);
      if (other && other !== answer && answer.name < other.name) pairs.push([answer.name, other.name]);
    }
  }
  return pairs;
}

// Checks every prompt and that no id is used twice
export function parseAll(files) {
  const prompts = [];
  const seen = new Map();
  for (const { name, data } of files) {
    if (!Array.isArray(data)) throw new Error(`${name}: must be a list of prompts`);
    for (const raw of data) {
      const prompt = parsePrompt(raw, name);
      if (seen.has(prompt.id)) throw new Error(`${name}: id "${prompt.id}" is also used in ${seen.get(prompt.id)}`);
      seen.set(prompt.id, name);
      prompts.push(prompt);
    }
  }
  return prompts;
}

// What a browser gets: the prompt, scrambled answer keys mapped to tier numbers,
// and a few rare answers to show once the player has answered
export async function publicPrompt(prompt) {
  const salt = prompt.id;
  const keys = {};
  for (const [key, answer] of keyMap(prompt)) {
    const hash = await hashKey(salt, key);
    if (hash in keys && keys[hash] !== answer.tier) throw new Error(`${prompt.id}: two answers scramble to the same key`);
    keys[hash] = answer.tier;
  }
  return { id: prompt.id, text: prompt.text, salt, keys, examples: examples(prompt) };
}

// The first answer listed in each of the top three tiers
export function examples(prompt) {
  const picks = [];
  for (let tier = TIERS.length - 1; tier >= TIERS.length - 3; tier--) {
    const answer = prompt.answers.find((a) => a.tier === tier);
    if (answer) picks.push({ name: answer.name, tier });
  }
  return picks;
}
