// The multiplayer server: live rooms over a WebSocket at /ws, plus /healthz.
//
// With Firebase settings (FIREBASE_SERVICE_ACCOUNT) it reads the answer lists from Firestore; this is how it runs on Render.
// Without them it runs locally: answer lists come from dev-data/ (made by `npm run seed:local`) and it also serves
// the game itself at http://localhost:3000, standing in for GitHub Pages and Firestore.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadEnv } from './lib/env.js';
import { DirStore, firestoreFromEnv } from './lib/store.js';
import { Content } from './lib/content.js';
import { Rooms } from './lib/rooms.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
// Sites allowed to open a room connection, e.g. the GitHub Pages copy of the game. Empty allows any.
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
);

const firestore = await firestoreFromEnv();
const local = !firestore;
const store = firestore ?? new DirStore(path.join(ROOT, 'dev-data'));
const content = new Content(store);
const rooms = new Rooms({ content });
content.start();

const PUBLIC_DIR = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

async function serveStatic(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  const relative = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const filePath = path.resolve(PUBLIC_DIR, relative.replace(/^\/+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(filePath);
    send(res, 200, data, { 'Content-Type': TYPES[path.extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

// Local stand-in for the Firestore documents browsers may read, following the same rules as firestore.rules
async function serveDoc(res, collection, id) {
  const allowed = collection === 'daily' || collection === 'unlimited' || (collection === 'meta' && id === 'public');
  const doc = allowed && /^[A-Za-z0-9-]+$/.test(id) ? await store.readRaw(`${collection}/${id}`) : null;
  if (!doc || (doc.opensAt != null && Date.now() < doc.opensAt)) return send(res, 403, 'Not available');
  send(res, 200, JSON.stringify(doc.payload), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  if (url.pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ ok: true, ready: content.ready, ...rooms.stats }), {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
    });
  }
  if (local) {
    const doc = url.pathname.match(/^\/dev\/doc\/([a-z]+)\/([^/]+)$/i);
    if (doc) return serveDoc(res, doc[1], doc[2]);
    return serveStatic(res, url.pathname);
  }
  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 2048,
  verifyClient: ({ origin }) => ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin),
});

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  const session = rooms.connect({
    send: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
    close: () => ws.close(1008, 'Too many messages'),
  });
  ws.on('message', (data, isBinary) => { if (!isBinary) session.message(data.toString()); });
  ws.on('close', () => session.close());
  ws.on('error', () => ws.terminate());
});

// Drops connections that stopped answering (a phone that went to sleep), so the room can carry on
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 25_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Outlier server running at http://localhost:${PORT}`);
  console.log(local
    ? 'No Firebase settings: using dev-data/ and serving the game at the address above.'
    : `Using ${store.label}.`);
});
