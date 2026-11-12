import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// --- HTTP SERVER FOR STATIC FILES ---
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let reqPath = decodeURIComponent(url.pathname);
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    if (reqPath === '/vendor/three.module.js') {
      try {
        const threePath = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
        const content = await readFile(threePath);
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(content);
        return;
      } catch (err) {
        // Fall through
      }
    }

    const safePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
    if (!safePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const content = await readFile(safePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Fallback for single page app routing if needed
        try {
          const indexHtml = await readFile(path.join(PUBLIC_DIR, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexHtml);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// --- WEBSOCKET SERVER & ROOM MANAGER ---
const wss = new WebSocketServer({ server });

const ROOMS = new Map(); // roomCode -> Room Object

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ROOMS.has(code) ? generateRoomCode() : code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substring(2, 9);
}

class Room {
  constructor(code, hostId, hostName, hostColor, hostModel, options = {}) {
    this.code = code;
    this.hostId = hostId;
    this.state = 'lobby'; // 'lobby' | 'starting' | 'racing' | 'finished'
    this.trackId = options.trackId || 'coral_atoll';
    this.laps = Number(options.laps) || 2;
    this.obstacleDensity = options.obstacleDensity || 'mayhem'; // Default to mayhem for lots of obstacles!
    this.botCount = Number(options.botCount) || 0;
    this.seed = Math.floor(Math.random() * 1000000);
    this.startTime = null;
    this.players = new Map();
    this.results = [];
    this.createdAt = Date.now();
    this.emptyTimeout = null;

    this.addPlayer(hostId, hostName, hostColor, hostModel, null, true);
  }

  addPlayer(playerId, name, color, model, ws, isHost = false) {
    if (this.emptyTimeout) {
      clearTimeout(this.emptyTimeout);
      this.emptyTimeout = null;
    }

    const player = {
      id: playerId,
      name: (name || 'Racer ' + (this.players.size + 1)).trim().slice(0, 16),
      color: color || '#00e5ff',
      model: model || 'viper',
      ready: isHost, // Host is ready by default
      isHost,
      ws,
      state: null,
      finished: false,
      finishTime: null,
      bestLap: null,
      stats: { obstaclesHit: 0, boostsUsed: 0, maxSpeed: 0 },
    };

    this.players.set(playerId, player);
    return player;
  }

  removePlayer(playerId) {
    const wasHost = this.hostId === playerId;
    this.players.delete(playerId);

    if (this.players.size === 0) {
      // Clean up room after 2 minutes of being empty
      this.emptyTimeout = setTimeout(() => {
        ROOMS.delete(this.code);
      }, 120000);
      return;
    }

    if (wasHost) {
      // Reassign host to the first connected player
      const nextHost = this.players.values().next().value;
      if (nextHost) {
        this.hostId = nextHost.id;
        nextHost.isHost = true;
      }
    }
  }

  getPublicState() {
    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      trackId: this.trackId,
      laps: this.laps,
      obstacleDensity: this.obstacleDensity,
      botCount: this.botCount,
      seed: this.seed,
      startTime: this.startTime,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        model: p.model,
        ready: p.ready,
        isHost: p.isHost,
        finished: p.finished,
        finishTime: p.finishTime,
      })),
      results: this.results,
    };
  }

  broadcast(message, excludeWs = null) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player.ws && player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    }
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.currentRoomCode = null;
  ws.playerId = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(ws, msg);
    } catch (err) {
      console.error('Bad WS payload:', err);
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('WS client error:', err);
  });
});

function handleMessage(ws, msg) {
  const { type } = msg;

  if (type === 'create_room') {
    let code = (msg.code || '').trim().toUpperCase();
    if (!code || code.length < 3 || ROOMS.has(code)) {
      code = generateRoomCode();
    }
    const playerId = generatePlayerId();
    const room = new Room(code, playerId, msg.name, msg.color, msg.model, msg.options || {});
    ROOMS.set(code, room);

    const player = room.players.get(playerId);
    player.ws = ws;
    ws.currentRoomCode = code;
    ws.playerId = playerId;

    ws.send(JSON.stringify({
      type: 'room_joined',
      code,
      playerId,
      isHost: true,
      roomState: room.getPublicState(),
    }));
    return;
  }

  if (type === 'join_room') {
    const code = (msg.code || '').trim().toUpperCase();
    const room = ROOMS.get(code);

    if (!room) {
      ws.send(JSON.stringify({ type: 'error', message: `Room "${code}" not found. Check the code and try again!` }));
      return;
    }

    if (room.state === 'racing') {
      ws.send(JSON.stringify({ type: 'error', message: `Race in room "${code}" is already in progress!` }));
      return;
    }

    if (room.players.size >= 8) {
      ws.send(JSON.stringify({ type: 'error', message: `Room "${code}" is full (maximum 8 players).` }));
      return;
    }

    const playerId = generatePlayerId();
    const player = room.addPlayer(playerId, msg.name, msg.color, msg.model, ws, false);
    ws.currentRoomCode = code;
    ws.playerId = playerId;

    ws.send(JSON.stringify({
      type: 'room_joined',
      code,
      playerId,
      isHost: false,
      roomState: room.getPublicState(),
    }));

    room.broadcast({
      type: 'room_update',
      roomState: room.getPublicState(),
    }, ws);
    return;
  }

  const room = ws.currentRoomCode ? ROOMS.get(ws.currentRoomCode) : null;
  const player = room && ws.playerId ? room.players.get(ws.playerId) : null;
  if (!room || !player) return;

  if (type === 'update_settings') {
    if (!player.isHost) return;
    if (msg.trackId) room.trackId = msg.trackId;
    if (msg.laps) room.laps = Math.min(10, Math.max(1, Number(msg.laps)));
    if (msg.obstacleDensity) room.obstacleDensity = msg.obstacleDensity;
    if (msg.botCount !== undefined) room.botCount = Math.min(8, Math.max(0, Number(msg.botCount)));

    room.broadcast({
      type: 'room_update',
      roomState: room.getPublicState(),
    });
    return;
  }

  if (type === 'update_player') {
    if (msg.name) player.name = msg.name.trim().slice(0, 16);
    if (msg.color) player.color = msg.color;
    if (msg.model) player.model = msg.model;
    if (msg.ready !== undefined) player.ready = Boolean(msg.ready);

    room.broadcast({
      type: 'room_update',
      roomState: room.getPublicState(),
    });
    return;
  }

  if (type === 'start_race') {
    if (!player.isHost) return;
    if (room.state === 'racing' || room.state === 'starting') return;

    room.state = 'starting';
    room.seed = Math.floor(Math.random() * 1000000);
    room.results = [];
    for (const p of room.players.values()) {
      p.finished = false;
      p.finishTime = null;
      p.bestLap = null;
      p.stats = { obstaclesHit: 0, boostsUsed: 0, maxSpeed: 0 };
    }

    const countdownMs = 3500;
    room.startTime = Date.now() + countdownMs;

    room.broadcast({
      type: 'race_starting',
      startTime: room.startTime,
      seed: room.seed,
      trackId: room.trackId,
      laps: room.laps,
      obstacleDensity: room.obstacleDensity,
      botCount: room.botCount,
    });

    setTimeout(() => {
      if (room.state === 'starting') {
        room.state = 'racing';
        room.broadcast({ type: 'race_started' });
      }
    }, countdownMs);
    return;
  }

  if (type === 'boat_sync') {
    // Relay boat movement to other racers
    player.state = msg.state;
    room.broadcast({
      type: 'boat_sync',
      playerId: player.id,
      state: msg.state,
    }, ws);
    return;
  }

  if (type === 'obstacle_event') {
    // Sync obstacle destruction/activation (e.g. mine exploded, crate smashed)
    room.broadcast({
      type: 'obstacle_event',
      playerId: player.id,
      obstacleId: msg.obstacleId,
      action: msg.action,
      data: msg.data,
    });
    return;
  }

  if (type === 'finish_race') {
    if (player.finished) return;
    player.finished = true;
    player.finishTime = msg.totalTime;
    player.bestLap = msg.bestLap;
    if (msg.stats) player.stats = msg.stats;

    const rank = room.results.length + 1;
    const resultEntry = {
      rank,
      id: player.id,
      name: player.name,
      color: player.color,
      model: player.model,
      totalTime: player.totalTime,
      bestLap: player.bestLap,
      stats: player.stats,
    };
    room.results.push(resultEntry);

    room.broadcast({
      type: 'player_finished',
      entry: resultEntry,
      results: room.results,
    });

    // If all real players finished, mark race as finished
    const allFinished = Array.from(room.players.values()).every(p => p.finished);
    if (allFinished) {
      room.state = 'finished';
      room.broadcast({
        type: 'race_finished',
        results: room.results,
      });
    }
    return;
  }

  if (type === 'play_again') {
    if (!player.isHost) return;
    room.state = 'lobby';
    room.startTime = null;
    room.results = [];
    for (const p of room.players.values()) {
      p.ready = p.isHost;
      p.finished = false;
      p.finishTime = null;
      p.state = null;
    }

    room.broadcast({
      type: 'room_reset',
      roomState: room.getPublicState(),
    });
    return;
  }

  if (type === 'chat') {
    const text = (msg.text || '').trim().slice(0, 60);
    if (!text) return;
    room.broadcast({
      type: 'chat',
      playerId: player.id,
      name: player.name,
      color: player.color,
      text,
    });
  }
}

function handleDisconnect(ws) {
  if (!ws.currentRoomCode || !ws.playerId) return;
  const room = ROOMS.get(ws.currentRoomCode);
  if (!room) return;

  const player = room.players.get(ws.playerId);
  const name = player ? player.name : 'A racer';
  room.removePlayer(ws.playerId);

  if (room.players.size > 0) {
    room.broadcast({
      type: 'player_left',
      playerId: ws.playerId,
      name,
      roomState: room.getPublicState(),
    });
  }
}

// Heartbeat ping interval
const interval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 25000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Speedboat Racing server running on http://localhost:${PORT}`);
});
