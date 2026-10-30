// Loading puzzles, and what this browser remembers.

import { CONFIG } from './config.js';

const onLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
export const SERVER = CONFIG.serverUrl.trim().replace(/\/+$/, '') || (onLocalhost ? location.origin : '');
const PROJECT = CONFIG.firebaseProjectId.trim();

export class NotSetUpError extends Error {}

// A published document (see lib/publish.js), or null if it doesn't exist or isn't open yet.
// From Firestore's REST API when a project is set, otherwise from the local server.
export async function getDoc(path) {
  let url;
  if (PROJECT) url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT)}/databases/(default)/documents/${path}`;
  else if (onLocalhost) url = `${location.origin}/dev/doc/${path}`;
  else throw new NotSetUpError('Firebase is not set up');

  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Loading ${path} failed (${res.status})`);
  const body = await res.json();
  return PROJECT ? JSON.parse(body.fields.payload.stringValue) : body;
}

// Saved in this browser only: daily progress and history, Unlimited stats, your name
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`outlier.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`outlier.${key}`, JSON.stringify(value)); } catch { /* storage blocked: skip */ }
  },
};
