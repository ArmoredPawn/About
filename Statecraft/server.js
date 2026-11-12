// The multiplayer server: live games over a WebSocket at /ws, plus /healthz.
// Locally (`npm run dev`) it also serves the game itself at http://localhost:3001.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadEnv } from './lib/env.js';
import { Rooms } from './lib/rooms.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3001;
// Sites allowed to open a game connection, e.g. the GitHub Pages copy of the game. Empty allows any.
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
);
const SERVE_GAME = process.env.SERVE_GAME !== '0';

const rooms = new Rooms();
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  if (url.pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ ok: true, ...rooms.stats }), {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
    });
  }
  if (SERVE_GAME) return serveStatic(res, url.pathname);
  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 8 * 1024,
  perMessageDeflate: { threshold: 1024 },
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

// Drops connections that stopped answering (a laptop that went to sleep); the leader can reconnect
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 25_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Statecraft server running at http://localhost:${PORT}`);
});
