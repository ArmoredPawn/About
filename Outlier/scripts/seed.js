// Checks the prompt files in content/prompts/ and publishes them.
//
//   npm run seed              publish to Firestore (key in service-account.json or .env)
//   npm run seed:local        publish to dev-data/ for playing on this computer without Firebase
//   npm run seed -- --check   only check the prompt files

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.js';
import { parseAll, pluralTwins } from '../lib/prompts.js';
import { publish } from '../lib/publish.js';
import { DirStore, firestoreFromEnv } from '../lib/store.js';
import { addDays, DAILY_PROMPTS } from '../public/js/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const args = new Set(process.argv.slice(2));

async function loadContent() {
  const dir = path.join(ROOT, 'content', 'prompts');
  let names;
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    throw new Error(`No prompt files found. Put them in ${dir}`);
  }
  const files = [];
  for (const name of names) {
    const text = await readFile(path.join(dir, name), 'utf8');
    try {
      files.push({ name, data: JSON.parse(text) });
    } catch (err) {
      throw new Error(`${name} is not valid JSON: ${err.message}`);
    }
  }
  return parseAll(files);
}

async function main() {
  const prompts = await loadContent();
  const daily = prompts.filter((p) => p.pool === 'daily').length;
  console.log(`Checked ${prompts.length} prompts: ${daily} daily, ${prompts.length - daily} unlimited.`);
  for (const p of prompts) {
    for (const [a, b] of pluralTwins(p)) console.log(`  Check ${p.id}: "${a}" and "${b}" differ only by a plural ending. Same answer twice?`);
  }
  if (args.has('--check')) return;

  const store = args.has('--local')
    ? new DirStore(path.join(ROOT, 'dev-data'))
    : await firestoreFromEnv(path.join(ROOT, 'service-account.json'));
  if (!store) {
    throw new Error('No Firebase key found. Save the key file as service-account.json in this folder (see README), '
      + 'or run `npm run seed:local` to play without Firebase.');
  }

  console.log(`Publishing to ${store.label}...`);
  const r = await publish({ prompts: prompts, store });
  console.log(`Done. ${r.unlimited} Unlimited prompts are live.`);
  if (r.lastDay) {
    const days = Math.round((Date.parse(r.lastDay) - Date.parse(r.today)) / 864e5) + 1;
    console.log(`Daily puzzles are scheduled through ${r.lastDay} (${days} day${days === 1 ? '' : 's'} from today).`);
    if (days < 7) console.log(`  Running low: add more daily prompts before ${addDays(r.lastDay, 1)}.`);
  } else {
    console.log(`No daily puzzles are scheduled: each day needs ${DAILY_PROMPTS} daily prompts.`);
  }
  if (r.spare) console.log(`${r.spare} daily prompt(s) are waiting for enough others to fill a day (${DAILY_PROMPTS} per day).`);
  if (r.removed) console.log(`Removed ${r.removed} document(s) for prompts that are gone or moved.`);
  if (r.kept.length) console.log(`Left unchanged (a prompt on that day was deleted): ${r.kept.join(', ')}`);
}

main().then(() => process.exit(0), (err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
