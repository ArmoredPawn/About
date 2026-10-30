// The answer lists the multiplayer server scores against, kept in memory.
// Reloads when the seed script publishes a new version (checked every few minutes: one small read).

import { keyMap, examples } from './prompts.js';
import { pastDailyIds } from './schedule.js';

const CHECK_EVERY_MS = 5 * 60_000;

export class Content {
  constructor(store, { log = console } = {}) {
    this.store = store;
    this.log = log;
    this.version = null;
    this.prompts = new Map();
    this.schedule = {};
    this.unlimited = [];
  }

  get ready() {
    return this.version !== null;
  }

  // Loads everything if the published version changed. Returns true when it did.
  async refresh() {
    const meta = await this.store.read('meta/server');
    if (!meta) throw new Error('Nothing has been published yet: run the seed script.');
    if (meta.version === this.version) return false;
    const prompts = new Map();
    for (const raw of await this.store.list('answerKeys')) {
      prompts.set(raw.id, { id: raw.id, text: raw.text, keys: keyMap(raw), examples: examples(raw) });
    }
    this.prompts = prompts;
    this.schedule = meta.schedule;
    this.unlimited = meta.unlimited;
    this.version = meta.version;
    this.log.log(`[content] loaded ${prompts.size} prompts (version ${meta.version})`);
    return true;
  }

  // Keeps retrying until the first load works, then checks for new versions
  start() {
    const tick = async () => {
      try {
        await this.refresh();
      } catch (err) {
        this.log.error(`[content] ${err.message}`);
      }
      setTimeout(tick, this.ready ? CHECK_EVERY_MS : 15_000).unref();
    };
    return tick();
  }

  // Prompts a room may use: Unlimited ones plus past dailies, never today's or a future one
  pool(today) {
    const ids = new Set([...this.unlimited, ...pastDailyIds(this.schedule, today)]);
    return [...ids].map((id) => this.prompts.get(id)).filter(Boolean);
  }
}
