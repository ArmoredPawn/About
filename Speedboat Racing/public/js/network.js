// Multiplayer Network Client for Hydro Rush
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

    // Throttle boat state updates (30Hz)
    this.lastSyncTime = 0;
    this.syncInterval = 1000 / 30;

    // Check BroadcastChannel support
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel('hydro_rush_channel');
      this.broadcastChannel.onmessage = (e) => this.handleBroadcastMessage(e.data);
    }
  }

  connect(customUrl = null) {
    return new Promise((resolve) => {
      let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let host = window.location.host;

      // If launched from file:// or empty host, use default localhost:3000
      if (!host || window.location.protocol === 'file:') {
        host = 'localhost:3000';
      }

      const wsUrl = customUrl || `${protocol}//${host}`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.connected = true;
          this.useBroadcastFallback = false;
          this.onConnected(true);
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (e) {
            console.error('Network parse error:', e);
          }
        };

        this.ws.onerror = () => {
          // Fall back to BroadcastChannel for local/multi-tab play
          if (!this.connected) {
            this.useBroadcastFallback = true;
            this.onConnected(false);
            resolve(false);
          }
        };

        this.ws.onclose = () => {
          this.connected = false;
        };

        // Timeout fallback after 2.5s
        setTimeout(() => {
          if (!this.connected) {
            this.useBroadcastFallback = true;
            this.onConnected(false);
            resolve(false);
          }
        }, 2500);
      } catch {
        this.useBroadcastFallback = true;
        this.onConnected(false);
        resolve(false);
      }
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
