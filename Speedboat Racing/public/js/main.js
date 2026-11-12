// Main Entry Point and UI Controller for Hydro Rush
import { Renderer } from './renderer.js';
import { NetworkClient } from './network.js';
import { Game } from './game.js';
import { BOAT_MODELS } from './physics.js';
import { sounds } from './audio.js';

class App {
  constructor() {
    this.canvas = document.getElementById('bg-canvas');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.previewCanvas = document.getElementById('boat-canvas-preview');

    this.renderer = new Renderer(this.canvas);
    this.network = new NetworkClient();
    this.game = new Game(this.renderer, this.network, this);

    this.currentScreen = 'screen-title';
    this.isSinglePlayer = false;
    this.singlePlayerSettings = null;
    this.playerProfile = {
      name: 'Captain Aqua',
      color: '#00f5d4',
      model: 'viper',
    };

    this.roomState = null;
    this.isReady = false;

    this.initUI();
    this.initNetworkCallbacks();
    this.startPreviewRenderLoop();
    this.checkUrlRoomParam();

    // Start main game animation loop
    const loop = (now) => {
      this.game.update(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
      this.currentScreen = screenId;
    }
  }

  initUI() {
    // Racer name input
    const nameInput = document.getElementById('player-name-input');
    nameInput.addEventListener('input', (e) => {
      this.playerProfile.name = e.target.value.trim() || 'Racer';
    });

    // Color Swatches
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        swatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        this.playerProfile.color = swatch.getAttribute('data-color');
      });
    });

    // Boat Model Cards
    const modelCards = document.querySelectorAll('.model-card');
    modelCards.forEach(card => {
      card.addEventListener('click', () => {
        modelCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.playerProfile.model = card.getAttribute('data-model');
        this.updateModelStatBars(this.playerProfile.model);
      });
    });

    // Single Player Modal & Launch
    const spModal = document.getElementById('modal-singleplayer');
    const btnOpenSp = document.getElementById('btn-open-sp');
    if (btnOpenSp) {
      btnOpenSp.addEventListener('click', () => {
        sounds.ensureContext();
        spModal.classList.add('active');
      });
    }

    const closeSpModal = () => spModal.classList.remove('active');
    document.getElementById('btn-close-sp-modal')?.addEventListener('click', closeSpModal);
    document.getElementById('btn-cancel-sp')?.addEventListener('click', closeSpModal);

    document.getElementById('btn-launch-sp')?.addEventListener('click', () => {
      closeSpModal();
      const trackId = document.getElementById('sp-select-track').value;
      const obstacleDensity = document.getElementById('sp-select-density').value;
      const laps = Number(document.getElementById('sp-select-laps').value);
      const botCount = Number(document.getElementById('sp-select-bots').value);

      this.startSinglePlayerRace({
        trackId,
        obstacleDensity,
        laps,
        botCount,
      });
    });

    // Create Room Button
    document.getElementById('btn-create-room').addEventListener('click', async () => {
      sounds.ensureContext();
      this.isSinglePlayer = false;
      await this.network.connect();
      this.network.createRoom(
        this.playerProfile.name,
        this.playerProfile.color,
        this.playerProfile.model,
        {
          trackId: 'coral_atoll',
          obstacleDensity: 'mayhem',
          laps: 2,
          botCount: 2,
        }
      );
    });

    // Join Room Button
    document.getElementById('btn-join-room').addEventListener('click', async () => {
      const codeInput = document.getElementById('join-code-input');
      const code = codeInput.value.trim().toUpperCase();
      if (!code) {
        alert('Please enter a 4-letter room code!');
        return;
      }
      sounds.ensureContext();
      this.isSinglePlayer = false;
      await this.network.connect();
      this.network.joinRoom(
        code,
        this.playerProfile.name,
        this.playerProfile.color,
        this.playerProfile.model
      );
    });

    // How to Play Modal
    const modal = document.getElementById('modal-how-to-play');
    document.getElementById('btn-how-to-play').addEventListener('click', () => {
      modal.classList.add('active');
    });
    document.getElementById('btn-close-modal').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    document.getElementById('btn-modal-ok').addEventListener('click', () => {
      modal.classList.remove('active');
    });

    // Copy Room Code & Link
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      if (!this.network.roomCode) return;
      navigator.clipboard.writeText(this.network.roomCode);
      this.showToast('Room code copied to clipboard!');
    });

    document.getElementById('btn-copy-link').addEventListener('click', () => {
      if (!this.network.roomCode) return;
      const url = `${window.location.origin}${window.location.pathname}?room=${this.network.roomCode}`;
      navigator.clipboard.writeText(url);
      this.showToast('Invite link copied to clipboard!');
    });

    // Host Settings Dropdowns
    const selectTrack = document.getElementById('select-track');
    const selectDensity = document.getElementById('select-density');
    const selectLaps = document.getElementById('select-laps');
    const selectBots = document.getElementById('select-bots');

    const updateHostSettings = () => {
      if (!this.network.isHost) return;
      this.network.updateSettings({
        trackId: selectTrack.value,
        obstacleDensity: selectDensity.value,
        laps: Number(selectLaps.value),
        botCount: Number(selectBots.value),
      });
    };

    selectTrack.addEventListener('change', updateHostSettings);
    selectDensity.addEventListener('change', updateHostSettings);
    selectLaps.addEventListener('change', updateHostSettings);
    selectBots.addEventListener('change', updateHostSettings);

    // Ready Toggle
    const btnReady = document.getElementById('btn-ready-toggle');
    btnReady.addEventListener('click', () => {
      this.isReady = !this.isReady;
      document.getElementById('ready-status-text').textContent = this.isReady ? 'Unready' : 'Ready Up';
      this.network.updatePlayer({ ready: this.isReady });
    });

    // Start Race Button
    document.getElementById('btn-start-race').addEventListener('click', () => {
      if (!this.network.isHost) return;
      sounds.ensureContext();
      this.network.startRace();
    });

    // Leave Lobby Button
    document.getElementById('btn-leave-lobby').addEventListener('click', () => {
      window.location.reload();
    });

    // Return to Lobby & Play Again Buttons
    document.getElementById('btn-play-again').addEventListener('click', () => {
      if (this.isSinglePlayer) {
        this.startSinglePlayerRace(this.singlePlayerSettings);
      } else if (this.network.isHost) {
        this.network.playAgain();
      } else {
        this.showScreen('screen-lobby');
      }
    });

    document.getElementById('btn-return-lobby').addEventListener('click', () => {
      if (this.isSinglePlayer) {
        this.showScreen('screen-title');
      } else {
        if (this.network.isHost) {
          this.network.playAgain();
        }
        this.showScreen('screen-lobby');
      }
    });

    // Sound Mute Toggle
    const soundBtn = document.getElementById('btn-toggle-sound');
    soundBtn.addEventListener('click', () => {
      const isMuted = sounds.toggleMute();
      soundBtn.textContent = isMuted ? '🔇 Sound: OFF' : '🔊 Sound: ON';
    });
  }

  updateModelStatBars(modelId) {
    const specs = BOAT_MODELS[modelId] || BOAT_MODELS.viper;
    document.getElementById('stat-speed').style.width = `${(specs.maxSpeed / 750) * 100}%`;
    document.getElementById('stat-accel').style.width = `${(specs.accel / 650) * 100}%`;
    document.getElementById('stat-turn').style.width = `${(specs.turnSpeed / 4.0) * 100}%`;
    document.getElementById('stat-armor').style.width = `${(specs.mass / 1.7) * 100}%`;
  }

  startSinglePlayerRace(settings) {
    sounds.ensureContext();
    this.isSinglePlayer = true;
    this.singlePlayerSettings = settings;

    const returnBtn = document.getElementById('btn-return-text');
    if (returnBtn) returnBtn.textContent = '🏠 Main Menu';

    this.showScreen('screen-game');

    const localPlayer = {
      id: 'local_player',
      name: this.playerProfile.name,
      color: this.playerProfile.color,
      model: this.playerProfile.model,
    };

    const seed = Math.floor(Math.random() * 1000000);
    this.game.initRace(
      settings.trackId,
      settings.obstacleDensity,
      settings.laps,
      settings.botCount,
      seed,
      [localPlayer],
      'local_player'
    );

    const countdownMs = 3500;
    this.game.startCountdown(Date.now() + countdownMs);
  }

  startPreviewRenderLoop() {
    const ctx = this.previewCanvas.getContext('2d');
    let angle = 0;

    const renderPreview = () => {
      if (this.currentScreen === 'screen-title') {
        angle += 0.015;
        ctx.clearRect(0, 0, 220, 220);

        ctx.save();
        ctx.translate(110, 110);
        ctx.rotate(angle);

        // Preview Boat
        const mockBoat = {
          color: this.playerProfile.color,
          name: '',
          physics: {
            specs: BOAT_MODELS[this.playerProfile.model] || BOAT_MODELS.viper,
            x: 0,
            y: 0,
            z: 0,
            angle: 0,
            speed: 0,
            throttle: 0,
            isAirborne: false,
            isBoosting: false,
          },
        };

        this.renderer.drawHull(ctx, mockBoat);
        ctx.restore();
      }
      requestAnimationFrame(renderPreview);
    };
    requestAnimationFrame(renderPreview);
  }

  checkUrlRoomParam() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      const input = document.getElementById('join-code-input');
      if (input) input.value = roomParam.toUpperCase();
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(0, 245, 212, 0.95)';
    toast.style.color = '#030712';
    toast.style.fontWeight = '800';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '999';
    toast.style.boxShadow = '0 6px 20px rgba(0, 245, 212, 0.4)';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  initNetworkCallbacks() {
    this.network.onRoomJoined = (data) => {
      this.roomState = data.roomState;
      document.getElementById('lobby-room-code').textContent = data.code;
      this.updateLobbyView(data.roomState);
      this.showScreen('screen-lobby');
    };

    this.network.onRoomUpdate = (state) => {
      this.roomState = state;
      this.updateLobbyView(state);
    };

    this.network.onRaceStarting = (data) => {
      this.isSinglePlayer = false;
      const returnBtn = document.getElementById('btn-return-text');
      if (returnBtn) returnBtn.textContent = '🏠 Return to Lobby';

      this.showScreen('screen-game');
      this.game.initRace(
        data.trackId || this.roomState.trackId,
        data.obstacleDensity || this.roomState.obstacleDensity,
        data.laps || this.roomState.laps,
        data.botCount !== undefined ? data.botCount : this.roomState.botCount,
        data.seed,
        this.roomState.players,
        this.network.playerId
      );
      this.game.startCountdown(data.startTime);
    };

    this.network.onRaceStarted = () => {
      this.game.state = 'racing';
    };

    this.network.onBoatSync = (playerId, state) => {
      this.game.syncRemoteBoat(playerId, state);
    };

    this.network.onObstacleEvent = (data) => {
      this.game.handleObstacleNetworkEvent(data);
    };

    this.network.onRoomReset = (state) => {
      this.roomState = state;
      this.updateLobbyView(state);
      this.showScreen('screen-lobby');
    };

    this.network.onError = (message) => {
      alert(message);
    };
  }

  updateLobbyView(state) {
    if (!state) return;

    // Update player count badge
    document.getElementById('player-count').textContent = state.players.length;

    // Configure host dropdowns if host or disable if guest
    const isHost = this.network.isHost;
    const settingsBar = document.getElementById('host-settings-bar');
    const startBtn = document.getElementById('btn-start-race');

    if (!isHost) {
      document.getElementById('select-track').value = state.trackId;
      document.getElementById('select-density').value = state.obstacleDensity;
      document.getElementById('select-laps').value = state.laps;
      document.getElementById('select-bots').value = state.botCount;
      document.getElementById('select-track').disabled = true;
      document.getElementById('select-density').disabled = true;
      document.getElementById('select-laps').disabled = true;
      document.getElementById('select-bots').disabled = true;
      startBtn.style.display = 'none';
    } else {
      document.getElementById('select-track').disabled = false;
      document.getElementById('select-density').disabled = false;
      document.getElementById('select-laps').disabled = false;
      document.getElementById('select-bots').disabled = false;
      startBtn.style.display = 'inline-flex';
    }

    // Render racers grid
    const grid = document.getElementById('racers-grid');
    grid.innerHTML = '';

    state.players.forEach(p => {
      const card = document.createElement('div');
      card.className = `racer-card ${p.ready ? 'is-ready' : ''}`;

      const isHostTag = p.isHost ? '<span class="racer-host-crown">👑 HOST</span>' : '';
      const specs = BOAT_MODELS[p.model] || BOAT_MODELS.viper;

      card.innerHTML = `
        ${isHostTag}
        <div class="racer-avatar-preview" style="background: ${p.color}; color: #030712;">
          🚤
        </div>
        <div class="racer-name">${this.escapeHtml(p.name)}</div>
        <div class="racer-boat-model">${specs.name}</div>
        <div class="racer-status-tag ${p.ready ? 'status-ready' : 'status-waiting'}">
          ${p.ready ? 'READY' : 'WAITING'}
        </div>
      `;
      grid.appendChild(card);
    });
  }

  updateHUD(localBoat, allBoats, timer, totalLaps, gameState, countdownSec) {
    if (!localBoat) return;

    // Rank & Lap
    const localRankIndex = allBoats.findIndex(b => b.id === localBoat.id);
    const rank = localRankIndex >= 0 ? localRankIndex + 1 : 1;

    const rankSuffixes = ['th', 'st', 'nd', 'rd'];
    const suffix = (rank % 10 <= 3 && rank % 100 - rank % 10 !== 10) ? rankSuffixes[rank % 10] : 'th';

    document.getElementById('hud-rank').textContent = `${rank}${suffix}`;
    document.getElementById('hud-total-racers').textContent = `/ ${allBoats.length}`;

    const currentLap = Math.min(totalLaps, localBoat.physics.lap);
    document.getElementById('hud-lap').textContent = `LAP ${currentLap} / ${totalLaps}`;

    // Timer
    document.getElementById('hud-timer').textContent = this.game.formatTime(timer);

    // Speed & Boost
    const knots = Math.round(localBoat.physics.speed * 0.15);
    document.getElementById('hud-speed').textContent = knots;
    document.getElementById('hud-boost-fill').style.width = `${localBoat.physics.boostGauge}%`;

    // Countdown Display
    const countdownEl = document.getElementById('hud-countdown');
    if (gameState === 'starting') {
      countdownEl.style.display = 'block';
      const sec = Math.ceil(countdownSec);
      if (sec > 0) {
        countdownEl.textContent = sec;
        countdownEl.style.color = '#ffffff';
      } else {
        countdownEl.textContent = 'GO!';
        countdownEl.style.color = '#00f5d4';
      }
    } else {
      countdownEl.style.display = 'none';
    }

    // Mini Leaderboard List
    const lbList = document.getElementById('hud-lb-list');
    lbList.innerHTML = '';
    allBoats.slice(0, 5).forEach((b, i) => {
      const item = document.createElement('div');
      item.className = `hud-lb-item ${b.id === localBoat.id ? 'is-local' : ''}`;
      item.innerHTML = `
        <span>${i + 1}. ${this.escapeHtml(b.name)}</span>
        <span style="font-size: 11px; opacity: 0.8;">Lap ${Math.min(totalLaps, b.physics.lap)}</span>
      `;
      lbList.appendChild(item);
    });
  }

  showRaceFinished(stats, totalTimeFormatted) {
    this.showScreen('screen-podium');

    const tbody = document.getElementById('podium-table-body');
    tbody.innerHTML = '';

    const allBoats = [this.game.localBoat, ...this.game.remoteBoats.values(), ...this.game.botRacers];
    allBoats.sort((a, b) => b.physics.progress - a.physics.progress);

    allBoats.forEach((b, idx) => {
      const tr = document.createElement('tr');
      if (idx === 0) tr.className = 'podium-row-1';

      const rankBadge = idx === 0 ? '<span class="badge-gold">🥇 1st</span>' : `${idx + 1}th`;
      const timeStr = b.isLocal ? totalTimeFormatted : `+${(idx * 1.8).toFixed(2)}s`;
      const maxSpd = b.isLocal ? `${stats.maxSpeed} knots` : '---';
      const obsHit = b.isLocal ? stats.obstaclesHit : Math.floor(Math.random() * 4);

      tr.innerHTML = `
        <td>${rankBadge}</td>
        <td style="font-weight: 700; color: ${b.color};">${this.escapeHtml(b.name)}</td>
        <td>${b.physics.specs.name}</td>
        <td>${timeStr}</td>
        <td>${maxSpd}</td>
        <td>${obsHit}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }
}

// Launch app once DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
