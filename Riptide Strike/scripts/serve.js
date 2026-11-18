// A small local server for trying the game on this computer: it serves public/ and stands in for the Firestore
// room service at /signal (in memory), so rooms work between tabs and between devices on the same network without
// touching Firebase. Run: npm run dev, then open http://localhost:8080
//
// The /signal API copies the shape of Firestore's REST API that the game uses: documents with typed fields,
// PATCH to create (with currentDocument.exists=false) or update (with updateMask), GET, list and DELETE.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const docs = new Map(); // 'boatRooms/ABCD' or 'boatRooms/ABCD/peers/xyz' → { fields }

function signal(req, res, url, body) {
  const key = url.pathname.replace(/^\/signal\//, '');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj ? JSON.stringify(obj) : ''); };
  if (req.method === 'GET') {
    if (docs.has(key)) return send(200, { name: key, fields: docs.get(key) });
    // A collection: its documents, one level down
    const list = [...docs.keys()].filter((k) => k.startsWith(`${key}/`) && !k.slice(key.length + 1).includes('/'));
    if (key.split('/').length % 2 === 1 && list.length) return send(200, { documents: list.map((k) => ({ name: k, fields: docs.get(k) })) });
    if (key.endsWith('/peers')) return send(200, {});
    return send(404, { error: { status: 'NOT_FOUND' } });
  }
  if (req.method === 'DELETE') { docs.delete(key); return send(200, {}); }
  if (req.method === 'PATCH') {
    const fields = JSON.parse(body || '{}').fields ?? {};
    if (url.searchParams.get('currentDocument.exists') === 'false' && docs.has(key)) return send(409, { error: { status: 'ALREADY_EXISTS' } });
    const mask = url.searchParams.getAll('updateMask.fieldPaths');
    if (mask.length) {
      if (!docs.has(key)) return send(404, { error: { status: 'NOT_FOUND' } });
      const cur = docs.get(key);
      for (const f of mask) cur[f] = fields[f];
    } else docs.set(key, fields);
    return send(200, { name: key, fields: docs.get(key) });
  }
  send(405, null);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/signal/')) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => signal(req, res, url, body));
    return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Riptide Strike: http://localhost:${PORT}`));
