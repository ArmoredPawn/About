// Multiplayer Network Client for Hydro Rush
import { SERVER_URL } from './config.js';

const isLocalPage = () => !location.host || location.protocol === 'file:'
  || /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname);

// A separate multiplayer server, for pages on a static host
function usesRemoteServer() {
  return Boolean(SERVER_URL) && !isLocalPage() && new URL(SERVER_URL).origin !== location.origin;
}

function serverAddress() {
  if (usesRemoteServer()) return new URL(SERVER_URL).origin;
  if (!location.host || location.protocol === 'file:') return 'http://localhost:3000';
  return location.origin;
}

// Pokes a sleeping server over plain HTTP so it starts waking up
function wake() {
  fetch(`${serverAddress()}/healthz`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}

export class NetworkClient {
  constructor() {
    this.ws = null;
    this.broadcastChannel = null;
    this.useBroadcastFallback = false;
    this.roomCode = null;
    this.playerId = null;
    this.isHost = false;
    this.connected = false;

    // Callbacks
    this.onConnected = () => {};
    this.onRoomJoined = () => {};
    this.onRoomUpdate = () => {};
    this.onRaceStarting = () => {};
    this.onRaceStarted = () => {};
    this.onBoatSync = () => {};
    this.onObstacleEvent = () => {};
    this.onPlayerFinished = () => {};
    this.onRaceFinished = () => {};
    this.onRoomReset = () => {};
    this.onChat = () => {};
    this.onError = () => {};
    this.onWaking = () => {};

    // Throttle boat state updates (30Hz)
    this.lastSyncTime = 0;
    this.syncInterval = 1000 / 30;

    // Start waking the multiplayer server as soon as the page opens, so it is ready by the time anyone clicks
    if (usesRemoteServer()) wake();

    // Check BroadcastChannel support
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel('hydro_rush_channel');
      this.broadcastChannel.onmessage = (e) => this.handleBroadcastMessage(e.data);
    }
  }

  // Opens the connection. With a separate multiplayer server (SERVER_URL), which sleeps when idle on Render's
  // free plan, keeps trying for up to 90 seconds while it wakes instead of falling back to tabs-only play.
  connect(customUrl = null) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(true);
    if (!this.connecting) this.connecting = this.#connect(customUrl).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async #connect(customUrl) {
    const base = customUrl || serverAddress();
    const wsUrl = base.replace(/^http/, 'ws');
    if (customUrl || !usesRemoteServer()) {
      if (await this.#open(wsUrl, 2500)) return true;
      // No server: rooms work between tabs of this browser only
      this.useBroadcastFallback = true;
      this.onConnected(false);
      return false;
    }
    const deadline = Date.now() + 90000;
    let told = false;
    wake();
    while (Date.now() < deadline) {
      if (await this.#open(wsUrl, 5000)) return true;
      if (!told) { told = true; this.onWaking(); }
      wake();
      await new Promise((r) => setTimeout(r, 3000));
    }
    this.onConnected(false);
    this.onError('Could not reach the multiplayer server. It may still be starting up: try again in a minute, or race solo.');
    return false;
  }

  #open(url, timeoutMs) {
    return new Promise((resolve) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        ws.onopen = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
        resolve(false);
      }, timeoutMs);
      ws.onerror = () => { clearTimeout(timer); resolve(false); };
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        this.connected = true;
        this.useBroadcastFallback = false;
        ws.onerror = null;
        ws.onmessage = (event) => {
          try {
            this.handleMessage(JSON.parse(event.data));
          } catch (e) {
            console.error('Network parse error:', e);
          }
        };
        ws.onclose = () => {
          if (this.ws === ws) this.connected = false;
        };
        this.onConnected(true);
        resolve(true);
      };
    });
  }

  send(data) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else if (this.useBroadcastFallback && this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        ...data,
        _senderId: this.playerId,
        _roomCode: this.roomCode,
      });
    }
  }

  createRoom(name, color, model, options = {}) {
    this.send({
      type: 'create_room',
      name,
      color,
      model,
      options,
    });

    if (this.useBroadcastFallback) {
      // Simulate room creation locally
      const code = 'RUSH';
      this.playerId = 'local_' + Math.random().toString(36).substr(2, 6);
      this.roomCode = code;
      this.isHost = true;
      const roomState = {
        code,
        hostId: this.playerId,
        state: 'lobby',
        trackId: options.trackId || 'coral_atoll',
        laps: options.laps || 2,
        obstacleDensity: options.obstacleDensity || 'mayhem',
        botCount: options.botCount || 0,
        players: [{
          id: this.playerId,
          name,
          color,
          model,
          ready: true,
          isHost: true,
        }],
        results: [],
      };
      this.onRoomJoined({ code, playerId: this.playerId, isHost: true, roomState });
    }
  }

  joinRoom(code, name, color, model) {
    this.send({
      type: 'join_room',
      code: code.trim().toUpperCase(),
      name,
      color,
      model,
    });

    if (this.useBroadcastFallback) {
      this.roomCode = code.trim().toUpperCase();
      this.playerId = 'local_' + Math.random().toString(36).substr(2, 6);
      this.isHost = false;
      // Request host info via broadcast
      this.send({
        type: 'broadcast_request_sync',
        requester: { id: this.playerId, name, color, model },
      });
    }
  }

  updateSettings(settings) {
    this.send({
      type: 'update_settings',
      ...settings,
    });
  }

  updatePlayer(data) {
    this.send({
      type: 'update_player',
      ...data,
    });
  }

  startRace() {
    this.send({
      type: 'start_race',
    });

    if (this.useBroadcastFallback) {
      const countdownMs = 3500;
      const startTime = Date.now() + countdownMs;
      this.onRaceStarting({
        startTime,
        seed: Math.floor(Math.random() * 10000),
      });
      setTimeout(() => this.onRaceStarted(), countdownMs);
    }
  }

  syncBoat(state) {
    const now = performance.now();
    if (now - this.lastSyncTime < this.syncInterval) return;
    this.lastSyncTime = now;

    this.send({
      type: 'boat_sync',
      state,
    });
  }

  sendObstacleEvent(obstacleId, action, data = {}) {
    this.send({
      type: 'obstacle_event',
      obstacleId,
      action,
      data,
    });
  }

  finishRace(totalTime, bestLap, stats) {
    this.send({
      type: 'finish_race',
      totalTime,
      bestLap,
      stats,
    });
  }

  playAgain() {
    this.send({
      type: 'play_again',
    });
  }

  sendChat(text) {
    this.send({
      type: 'chat',
      text,
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'room_joined':
        this.roomCode = msg.code;
        this.playerId = msg.playerId;
        this.isHost = msg.isHost;
        this.onRoomJoined(msg);
        break;
      case 'room_update':
        this.onRoomUpdate(msg.roomState);
        break;
      case 'race_starting':
        this.onRaceStarting(msg);
        break;
      case 'race_started':
        this.onRaceStarted();
        break;
      case 'boat_sync':
        this.onBoatSync(msg.playerId, msg.state);
        break;
      case 'obstacle_event':
        this.onObstacleEvent(msg);
        break;
      case 'player_finished':
        this.onPlayerFinished(msg.entry, msg.results);
        break;
      case 'race_finished':
        this.onRaceFinished(msg.results);
        break;
      case 'room_reset':
        this.onRoomReset(msg.roomState);
        break;
      case 'chat':
        this.onChat(msg);
        break;
      case 'error':
        this.onError(msg.message);
        break;
    }
  }

  handleBroadcastMessage(msg) {
    if (msg._senderId === this.playerId) return;
    if (msg._roomCode && this.roomCode && msg._roomCode !== this.roomCode) return;

    if (msg.type === 'boat_sync') {
      this.onBoatSync(msg._senderId, msg.state);
    } else if (msg.type === 'obstacle_event') {
      this.onObstacleEvent(msg);
    } else if (msg.type === 'start_race') {
      this.onRaceStarting({
        startTime: Date.now() + 3500,
        seed: 42,
      });
      setTimeout(() => this.onRaceStarted(), 3500);
    }
  }
}
