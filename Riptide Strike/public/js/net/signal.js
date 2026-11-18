// Introductions by room code. A host claims a four-letter code; someone joining leaves a connection offer under
// it; the host answers it; then the two browsers talk directly (peer.js) and this is no longer needed.
//
// Online this is a Firestore collection (boatRooms), used through its REST API: no Firebase library, no login. On
// this computer (npm run dev) it is the dev server's own /signal API, so multiplayer can be tried without Firebase.

import { CONFIG } from '../config.js';

const LOCAL = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname) && !new URLSearchParams(location.search).has('firebase');
const COL = 'boatRooms';

const enc = (o) => ({
  fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : { integerValue: String(Math.round(v)) }])),
});
const dec = (doc) => (doc ? { ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([k, v]) => [k, v.stringValue ?? v.booleanValue ?? (v.integerValue != null ? Number(v.integerValue) : null)])), id: doc.name?.split('/').pop() } : null);

async function call(method, path, body) {
  const base = LOCAL ? `${location.origin}/signal` : `https://firestore.googleapis.com/v1/projects/${CONFIG.firebaseProjectId}/databases/(default)/documents`;
  const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404) return null;
  if (r.status === 409 || (r.status === 400 && /FAILED_PRECONDITION|ALREADY_EXISTS/.test(await r.clone().text()))) return { conflict: true };
  if (r.status === 403) throw new Error('The game\'s Firebase rules don\'t allow rooms yet (see the README).');
  if (!r.ok) throw new Error(`Room service error ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

// Claim a room code: false if someone else holds it
export async function createRoom(code, host) {
  const r = await call('PATCH', `/${COL}/${code}?currentDocument.exists=false`, enc({ host, created: Date.now(), open: true }));
  if (r?.conflict) {
    // A room left behind more than six hours ago can be taken over
    const old = await roomInfo(code);
    if (old && Date.now() - (old.created ?? 0) > 6 * 3600e3) return Boolean(await call('PATCH', `/${COL}/${code}`, enc({ host, created: Date.now(), open: true })));
    return false;
  }
  return Boolean(r);
}

export async function roomInfo(code) { return dec(await call('GET', `/${COL}/${code}`)); }
export async function setOpen(code, host, open) { await call('PATCH', `/${COL}/${code}`, enc({ host, created: Date.now(), open })); }
export async function closeRoom(code) { await call('DELETE', `/${COL}/${code}`).catch(() => {}); }

// A joiner's offer, and the host's answer to it
export async function postOffer(code, peer, name, offer) {
  const r = await call('PATCH', `/${COL}/${code}/peers/${peer}?currentDocument.exists=false`, enc({ offer, name: name.slice(0, 30), created: Date.now() }));
  return Boolean(r && !r.conflict);
}
export async function listPeers(code) {
  const r = await call('GET', `/${COL}/${code}/peers?pageSize=40`);
  return (r?.documents ?? []).map(dec);
}
export async function postAnswer(code, peer, answer) { await call('PATCH', `/${COL}/${code}/peers/${peer}?updateMask.fieldPaths=answer`, enc({ answer })); }
export async function getPeer(code, peer) { return dec(await call('GET', `/${COL}/${code}/peers/${peer}`)); }
export async function dropPeer(code, peer) { await call('DELETE', `/${COL}/${code}/peers/${peer}`).catch(() => {}); }

export const usingLocal = LOCAL;
