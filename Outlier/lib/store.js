// Where game data lives: Firestore in production, or a local folder (dev-data/) for playing offline.
// Both keep each document as { payload, opensAt? } so the browser, the server and the seed read them the same way.
// Paths look like "daily/2026-10-30" or "answerKeys/fruits".

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export class DirStore {
  constructor(root) {
    this.root = root;
    this.label = `the local folder ${root}`;
  }

  #file(docPath) {
    if (!/^[A-Za-z]+\/[A-Za-z0-9-]+$/.test(docPath)) throw new Error(`Bad document path: ${docPath}`);
    return path.join(this.root, `${docPath}.json`);
  }

  // { payload, opensAt } or null
  async readRaw(docPath) {
    try {
      return JSON.parse(await readFile(this.#file(docPath), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async read(docPath) {
    return (await this.readRaw(docPath))?.payload ?? null;
  }

  async list(collection) {
    const ids = await this.ids(collection);
    return Promise.all(ids.map((id) => this.read(`${collection}/${id}`)));
  }

  async ids(collection) {
    try {
      return (await readdir(path.join(this.root, collection)))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async write(docs) {
    for (const { path: docPath, payload, opensAt } of docs) {
      const file = this.#file(docPath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(opensAt == null ? { payload } : { payload, opensAt }));
    }
  }

  async remove(docPaths) {
    for (const docPath of docPaths) await rm(this.#file(docPath), { force: true });
  }
}

export class FirestoreStore {
  constructor(db, Timestamp, projectId) {
    this.db = db;
    this.Timestamp = Timestamp;
    this.label = `Firestore (project ${projectId})`;
  }

  async read(docPath) {
    const snap = await this.db.doc(docPath).get();
    return snap.exists ? JSON.parse(snap.get('payload')) : null;
  }

  async list(collection) {
    const snap = await this.db.collection(collection).get();
    return snap.docs.map((d) => JSON.parse(d.get('payload')));
  }

  async ids(collection) {
    const refs = await this.db.collection(collection).listDocuments();
    return refs.map((r) => r.id);
  }

  // Firestore takes at most 500 writes per batch
  async write(docs) {
    for (let i = 0; i < docs.length; i += 400) {
      const batch = this.db.batch();
      for (const { path: docPath, payload, opensAt } of docs.slice(i, i + 400)) {
        const data = { payload: JSON.stringify(payload) };
        if (opensAt != null) data.opensAt = this.Timestamp.fromMillis(opensAt);
        batch.set(this.db.doc(docPath), data);
      }
      await batch.commit();
    }
  }

  async remove(docPaths) {
    for (let i = 0; i < docPaths.length; i += 400) {
      const batch = this.db.batch();
      for (const docPath of docPaths.slice(i, i + 400)) batch.delete(this.db.doc(docPath));
      await batch.commit();
    }
  }
}

// Firestore from the environment, or null when no Firebase settings are present.
// FIREBASE_SERVICE_ACCOUNT holds the key's JSON (on Render); FIREBASE_SERVICE_ACCOUNT_FILE points at the key file.
// FIRESTORE_EMULATOR_HOST plus FIREBASE_PROJECT_ID uses a local emulator instead (for testing).
export async function firestoreFromEnv(defaultKeyFile) {
  let options = null;
  const { initializeApp, cert } = await import('firebase-admin/app');
  if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_PROJECT_ID) {
    options = { projectId: process.env.FIREBASE_PROJECT_ID };
  } else {
    const account = readServiceAccount(defaultKeyFile);
    if (account) options = { credential: cert(account), projectId: account.project_id };
  }
  if (!options) return null;
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  initializeApp(options);
  return new FirestoreStore(getFirestore(), Timestamp, options.projectId);
}

function readServiceAccount(defaultKeyFile) {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (json) {
    try {
      return JSON.parse(json);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole key file, from { to }.');
    }
  }
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || defaultKeyFile;
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && !process.env.FIREBASE_SERVICE_ACCOUNT_FILE) return null;
    throw new Error(`Could not read the Firebase key file ${file}: ${err.message}`);
  }
}
