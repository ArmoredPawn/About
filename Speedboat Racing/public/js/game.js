// Main Game Controller for Hydro Rush
import { BoatPhysics, BOAT_MODELS } from './physics.js';
import { buildTrack } from './tracks.js';
import { createBots } from './ai.js';
import { sounds } from './audio.js';

export class Game {
  constructor(renderer, network, ui) {
    this.renderer = renderer;
    this.network = network;
    this.ui = ui;

    this.state = 'idle'; // 'idle' | 'starting' | 'racing' | 'finished'
    this.track = null;
    this.localBoat = null;
    this.remoteBoats = new Map(); // playerId -> { id, name, color, model, physics, isLocal: false }
    this.botRacers = [];

    this.input = {
      up: false,
      down: false,
      left: false,
      right: false,
      boost: false,
    };

    this.raceStartTime = 0;
    this.raceTimer = 0;
    this.totalLaps = 2;
    this.countdownTimeRemaining = 0;
    this.hasFinished = false;

    // Stats
    this.stats = {
      obstaclesHit: 0,
      boostsUsed: 0,
      maxSpeed: 0,
    };

    this.lastFrameTime = performance.now();
    this.setupInputListeners();
  }

  setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      sounds.ensureContext();
      if (['ArrowUp', 'KeyW'].includes(e.code)) this.input.up = true;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.input.down = true;
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.input.left = true;
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.input.right = true;
      if (['Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        this.input.boost = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['ArrowUp', 'KeyW'].includes(e.code)) this.input.up = false;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.input.down = false;
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.input.left = false;
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.input.right = false;
      if (['Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        this.input.boost = false;
      }
    });
  }

  initRace(trackId, obstacleDensity, laps, botCount, seed, players, localPlayerId) {
    this.state = 'starting';
    this.hasFinished = false;
    this.totalLaps = laps || 2;
    this.raceTimer = 0;
    this.stats = { obstaclesHit: 0, boostsUsed: 0, maxSpeed: 0 };

    // Build course with obstacles
    this.track = buildTrack(trackId, obstacleDensity, seed);

    // Setup local boat and remote boats
    this.remoteBoats.clear();
    this.botRacers = [];

    // Find local player slot
    let localSlot = 0;
    players.forEach((p, index) => {
      if (p.id === localPlayerId) {
        localSlot = index;
      }
    });

    const startPos = this.track.starterGrid[localSlot] || this.track.starterGrid[0];
    const localPlayerData = players.find(p => p.id === localPlayerId) || {
      id: localPlayerId,
      name: 'Racer',
      color: '#00e5ff',
      model: 'viper',
    };

    this.localBoat = {
      id: localPlayerId,
      name: localPlayerData.name,
      color: localPlayerData.color,
      model: localPlayerData.model,
      physics: new BoatPhysics({
        model: localPlayerData.model,
        x: startPos.x,
        y: startPos.y,
        angle: startPos.angle,
      }),
      isLocal: true,
    };

    // Setup other real players
    players.forEach((p, index) => {
      if (p.id !== localPlayerId) {
        const slot = index;
        const pos = this.track.starterGrid[slot] || this.track.starterGrid[0];
        this.remoteBoats.set(p.id, {
          id: p.id,
          name: p.name,
          color: p.color,
          model: p.model,
          physics: new BoatPhysics({
            model: p.model,
            x: pos.x,
            y: pos.y,
            angle: pos.angle,
          }),
          isLocal: false,
        });
      }
    });

    // Add AI bot racers if requested
    const startBotIndex = players.length;
    if (botCount > 0) {
      this.botRacers = createBots(botCount, this.track, startBotIndex);
    }
  }

  startCountdown(targetStartTime) {
    this.raceStartTime = targetStartTime;
    this.state = 'starting';

    let lastBeepSec = 4;
    const interval = setInterval(() => {
      const remainingMs = this.raceStartTime - Date.now();
      const sec = Math.ceil(remainingMs / 1000);

      if (sec !== lastBeepSec && sec > 0 && sec <= 3) {
        lastBeepSec = sec;
        sounds.playCountdownBeep(false);
      }

      if (remainingMs <= 0) {
        clearInterval(interval);
        this.state = 'racing';
        sounds.playCountdownBeep(true);
      }
    }, 100);
  }

  update(now) {
    const dt = Math.min(0.06, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (!this.track || !this.localBoat) return;

    // Update obstacles
    if (this.track.obstacles) {
      this.track.obstacles.forEach(obs => obs.update(dt));
    }

    // Update renderer particle systems
    this.renderer.update(dt);

    if (this.state === 'starting') {
      const rem = Math.max(0, (this.raceStartTime - Date.now()) / 1000);
      this.countdownTimeRemaining = rem;
    } else if (this.state === 'racing') {
      this.raceTimer += dt;

      // Local player input & physics
      let throttle = 0;
      if (this.input.up) throttle += 1;
      if (this.input.down) throttle -= 0.8;

      let steer = 0;
      if (this.input.left) steer -= 1;
      if (this.input.right) steer += 1;

      const boostRequest = this.input.boost;
      if (boostRequest && this.localBoat.physics.boostGauge > 10 && !this.localBoat.physics.isBoosting) {
        sounds.playBoost();
        this.stats.boostsUsed++;
      }

      this.localBoat.physics.applyInput(throttle, steer, boostRequest, dt);
      this.localBoat.physics.update(dt, this.track);

      // Track max speed
      if (this.localBoat.physics.speed > this.stats.maxSpeed) {
        this.stats.maxSpeed = Math.round(this.localBoat.physics.speed);
      }

      // Engine audio modulation
      const speedNorm = this.localBoat.physics.speed / this.localBoat.physics.specs.maxSpeed;
      sounds.updateEngine(speedNorm, throttle, this.localBoat.physics.isBoosting);

      // Wake trails
      this.renderer.addWakePoint(
        this.localBoat.physics.x,
        this.localBoat.physics.y,
        this.localBoat.physics.angle,
        this.localBoat.physics.speed,
        this.localBoat.physics.isDrifting
      );

      // Landing splash check
      if (this.localBoat.physics.justLanded) {
        this.localBoat.physics.justLanded = false;
        sounds.playSplash();
        this.renderer.createSplash(this.localBoat.physics.x, this.localBoat.physics.y, 35, 180);
      }

      // Check Obstacle Collisions
      this.handleObstacleCollisions(this.localBoat.physics);

      // Update AI bots
      this.botRacers.forEach(bot => {
        bot.update(dt, this.track.obstacles);
        this.handleObstacleCollisions(bot.physics, bot.id);
        this.renderer.addWakePoint(
          bot.physics.x,
          bot.physics.y,
          bot.physics.angle,
          bot.physics.speed,
          bot.physics.isDrifting
        );
      });

      // Handle Boat vs Boat collisions
      this.handleBoatCollisions();

      // Check Lap / Finish Line
      this.checkRaceFinish();

      // Broadcast position to network
      this.network.syncBoat({
        x: this.localBoat.physics.x,
        y: this.localBoat.physics.y,
        vx: this.localBoat.physics.vx,
        vy: this.localBoat.physics.vy,
        z: this.localBoat.physics.z,
        angle: this.localBoat.physics.angle,
        speed: this.localBoat.physics.speed,
        drift: this.localBoat.physics.isDrifting,
        boost: this.localBoat.physics.isBoosting,
        lap: this.localBoat.physics.lap,
        checkpoint: this.localBoat.physics.currentCp,
        progress: this.localBoat.physics.progress,
      });
    }

    // Collect all boats for rendering & leaderboard
    const allBoats = [this.localBoat, ...this.remoteBoats.values(), ...this.botRacers];

    // Sort by race progress (highest progress = 1st place)
    allBoats.sort((a, b) => b.physics.progress - a.physics.progress);

    // Render frame
    const isCountdown = this.state === 'starting';
    this.renderer.render(this.track, this.localBoat, allBoats, isCountdown, this.countdownTimeRemaining);

    // Update HUD & UI
    this.ui.updateHUD(this.localBoat, allBoats, this.raceTimer, this.totalLaps, this.state, this.countdownTimeRemaining);
    this.renderer.renderMinimap(this.ui.minimapCanvas, this.track, allBoats, this.localBoat.id);
  }

  handleObstacleCollisions(p, entityId = 'local') {
    if (!this.track || !this.track.obstacles) return;

    for (const obs of this.track.obstacles) {
      if (!obs.active) continue;

      const dx = p.x - obs.x;
      const dy = p.y - obs.y;
      const dist = Math.hypot(dx, dy);

      // If boat is flying in the air (z > 12), it flies right over surface obstacles!
      if (p.isAirborne && p.z > 14 && obs.type !== 'tentacle') {
        continue;
      }

      switch (obs.type) {
        case 'rock': {
          const minDist = obs.radius + p.specs.hullWidth / 2;
          if (dist < minDist) {
            // Elastic ricochet
            const nx = dx / dist;
            const ny = dy / dist;
            p.x = obs.x + nx * minDist;
            p.y = obs.y + ny * minDist;

            const dot = p.vx * nx + p.vy * ny;
            if (dot < 0) {
              p.vx = (p.vx - 1.6 * dot * nx) * 0.65;
              p.vy = (p.vy - 1.6 * dot * ny) * 0.65;
              if (entityId === 'local') {
                sounds.playRockHit();
                p.screenShake = 12;
                this.renderer.createSplash(p.x, p.y, 16, 120);
                this.stats.obstaclesHit++;
              }
            }
          }
          break;
        }

        case 'buoy': {
          const minDist = obs.radius + p.specs.hullWidth / 2;
          if (dist < minDist) {
            const nx = dx / dist;
            const ny = dy / dist;
            obs.vx -= nx * 140;
            obs.vy -= ny * 140;
            p.vx += nx * 60;
            p.vy += ny * 60;
            if (entityId === 'local') {
              sounds.playBump();
              this.renderer.createSplash(obs.x, obs.y, 8, 80);
            }
          }
          break;
        }

        case 'crate': {
          const minDist = obs.radius + p.specs.hullWidth / 2;
          if (dist < minDist) {
            obs.smash();
            this.renderer.createCrateSplinters(obs.x, obs.y);
            sounds.playRockHit();
            p.vx *= 0.85;
            p.vy *= 0.85;
            if (entityId === 'local') {
              this.stats.obstaclesHit++;
              this.network.sendObstacleEvent(obs.id, 'crate_smash');
            }
          }
          break;
        }

        case 'mine': {
          const minDist = obs.radius + p.specs.hullWidth / 2;
          if (dist < minDist) {
            obs.detonate();
            this.renderer.createExplosion(obs.x, obs.y);
            sounds.playExplosion();
            p.applyExplosion(obs.x, obs.y, 180);
            if (entityId === 'local') {
              this.stats.obstaclesHit++;
              this.network.sendObstacleEvent(obs.id, 'mine_detonate', { x: obs.x, y: obs.y });
            }
          }
          break;
        }

        case 'whirlpool': {
          if (dist < obs.pullRadius) {
            // Gravitational suction toward vortex center
            const pullFactor = (1 - dist / obs.pullRadius);
            const suction = obs.pullStrength * pullFactor;
            const nx = -dx / dist;
            const ny = -dy / dist;

            // Lateral swirl vector
            const swirlX = -ny;
            const swirlY = nx;

            p.vx += (nx * suction + swirlX * suction * 0.8) * 0.02;
            p.vy += (ny * suction + swirlY * suction * 0.8) * 0.02;

            if (dist < obs.radius * 0.4) {
              p.spinOutTimer = 0.8;
              p.speed *= 0.6;
            }
          }
          break;
        }

        case 'ramp': {
          // Check if boat is driving on ramp from the back
          const rampAngle = obs.angle;
          const toObsX = p.x - obs.x;
          const toObsY = p.y - obs.y;
          // Rotate into ramp local space
          const cosA = Math.cos(-rampAngle);
          const sinA = Math.sin(-rampAngle);
          const localX = toObsX * cosA - toObsY * sinA;
          const localY = toObsX * sinA + toObsY * cosA;

          if (Math.abs(localX) < obs.width / 2 + 10 && Math.abs(localY) < obs.height / 2 + 10) {
            if (!p.isAirborne && p.speed > 160) {
              p.launchRamp(1.1);
              sounds.playJump();
              this.renderer.createSplash(p.x, p.y, 25, 140);
            }
          }
          break;
        }

        case 'boost_pad': {
          const toObsX = p.x - obs.x;
          const toObsY = p.y - obs.y;
          const distPad = Math.hypot(toObsX, toObsY);
          if (distPad < 35 && !p.isAirborne) {
            p.triggerBoost(2.5);
            sounds.playBoost();
            this.renderer.createSplash(p.x, p.y, 20, 160, 'rgba(0, 245, 212, 0.8)');
          }
          break;
        }

        case 'oil_slick': {
          if (dist < obs.radius && !p.isAirborne) {
            p.enterOil();
          }
          break;
        }

        case 'tentacle': {
          const minDist = obs.radius + p.specs.hullWidth / 2;
          if (dist < minDist) {
            p.vx += (dx / dist) * 450;
            p.vy += (dy / dist) * 450;
            p.spinOutTimer = 0.6;
            sounds.playRockHit();
            this.renderer.createSplash(p.x, p.y, 20, 140);
          }
          break;
        }
      }
    }
  }

  handleBoatCollisions() {
    const boats = [this.localBoat, ...this.remoteBoats.values(), ...this.botRacers];

    for (let i = 0; i < boats.length; i++) {
      for (let j = i + 1; j < boats.length; j++) {
        const b1 = boats[i].physics;
        const b2 = boats[j].physics;

        // Ignore boats if one is flying high above the other
        if (Math.abs(b1.z - b2.z) > 15) continue;

        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 28;

        if (dist < minDist && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;

          // Push apart
          const overlap = minDist - dist;
          b1.x -= nx * overlap * 0.5;
          b1.y -= ny * overlap * 0.5;
          b2.x += nx * overlap * 0.5;
          b2.y += ny * overlap * 0.5;

          // Momentum bounce
          const relVx = b2.vx - b1.vx;
          const relVy = b2.vy - b1.vy;
          const velAlongNormal = relVx * nx + relVy * ny;

          if (velAlongNormal < 0) {
            const restitution = 0.7;
            const impulse = -(1 + restitution) * velAlongNormal;
            b1.vx -= nx * impulse * 0.5;
            b1.vy -= ny * impulse * 0.5;
            b2.vx += nx * impulse * 0.5;
            b2.vy += ny * impulse * 0.5;

            if (boats[i].isLocal || boats[j].isLocal) {
              sounds.playBump();
              this.renderer.createSplash((b1.x + b2.x) / 2, (b1.y + b2.y) / 2, 12, 100);
            }
          }
        }
      }
    }
  }

  checkRaceFinish() {
    if (this.hasFinished) return;

    if (this.localBoat.physics.lap > this.totalLaps) {
      this.hasFinished = true;
      sounds.playCheer();

      const totalTimeFormatted = this.formatTime(this.raceTimer);
      this.network.finishRace(totalTimeFormatted, totalTimeFormatted, this.stats);
      this.ui.showRaceFinished(this.stats, totalTimeFormatted);
    }
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds * 100) % 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  syncRemoteBoat(playerId, state) {
    const boat = this.remoteBoats.get(playerId);
    if (!boat) return;

    // Smooth interpolation to avoid teleporting
    const p = boat.physics;
    p.x += (state.x - p.x) * 0.45;
    p.y += (state.y - p.y) * 0.45;
    p.vx = state.vx;
    p.vy = state.vy;
    p.z = state.z || 0;
    p.angle = state.angle;
    p.speed = state.speed;
    p.isDrifting = state.drift;
    p.isBoosting = state.boost;
    p.lap = state.lap;
    p.currentCp = state.checkpoint;
    p.progress = state.progress;

    // Remote wake points
    this.renderer.addWakePoint(p.x, p.y, p.angle, p.speed, p.isDrifting);
  }

  handleObstacleNetworkEvent(event) {
    if (!this.track || !this.track.obstacles) return;
    const obs = this.track.obstacles.find(o => o.id === event.obstacleId);
    if (!obs) return;

    if (event.action === 'mine_detonate') {
      obs.detonate();
      this.renderer.createExplosion(obs.x, obs.y);
      sounds.playExplosion();
    } else if (event.action === 'crate_smash') {
      obs.smash();
      this.renderer.createCrateSplinters(obs.x, obs.y);
      sounds.playRockHit();
    }
  }
}
