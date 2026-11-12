// AI Bot Racers for Hydro Rush
import { BoatPhysics } from './physics.js';
import { nearestPathIndex } from './tracks.js';

const BOT_NAMES = [
  'Aqua Viper',
  'Wave Rider',
  'Tsunami Tom',
  'Riptide Rex',
  'Nautilus',
  'Hydro Siren',
  'Canyon Barracuda',
  'Coral Ghost',
];

const BOT_COLORS = [
  '#ff007f', // Neon Pink
  '#ffbe0b', // Electric Gold
  '#06d6a0', // Mint Cyan
  '#118ab2', // Ocean Deep
  '#8338ec', // Cyber Purple
  '#fb5607', // Blaze Orange
];

export class BotRacer {
  constructor(id, name, color, model, startPos, track) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.model = model;
    this.isBot = true;

    this.physics = new BoatPhysics({
      model,
      x: startPos.x,
      y: startPos.y,
      angle: startPos.angle,
    });

    this.track = track;
    this.lookaheadDist = 260 + Math.random() * 80;
    this.aggressiveness = 0.7 + Math.random() * 0.5;
    this.targetOffset = (Math.random() - 0.5) * 80; // Prefers slightly left or right of center
    this.pathIndex = -1;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.boostCooldown = 4 + Math.random() * 6;
  }

  update(dt, obstacles) {
    if (!this.track) return;
    const checkpoints = this.track.checkpoints;

    // Steer for a point on the course centreline a little ahead (falls back to the next waypoint)
    let targetX;
    let targetY;
    const path = this.track.path;
    if (path) {
      this.pathIndex = nearestPathIndex(path, this.physics.x, this.physics.y, this.pathIndex);
      const ahead = Math.round((140 + this.physics.speed * 0.35) / path.step);
      const tp = path.points[(this.pathIndex + ahead) % path.points.length];
      targetX = tp.x + tp.nx * this.targetOffset;
      targetY = tp.y + tp.ny * this.targetOffset;
    } else {
      const targetCp = checkpoints[this.physics.currentCp];
      targetX = targetCp.x + targetCp.nx * this.targetOffset;
      targetY = targetCp.y + targetCp.ny * this.targetOffset;
    }

    // --- OBSTACLE AVOIDANCE RAYCAST ---
    let avoidSteer = 0;
    const forwardX = Math.cos(this.physics.angle);
    const forwardY = Math.sin(this.physics.angle);

    for (const obs of obstacles) {
      if (!obs.active) continue;

      const dx = obs.x - this.physics.x;
      const dy = obs.y - this.physics.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 280) {
        // Dot product with forward vector
        const dot = (dx * forwardX + dy * forwardY) / dist;
        if (dot > 0.6) { // In front of boat
          const cross = forwardX * dy - forwardY * dx; // Positive if obstacle is to the right
          
          if (obs.type === 'ramp' || obs.type === 'boost_pad') {
            // Steer TOWARDS ramps and boost pads!
            avoidSteer += cross > 0 ? 0.6 : -0.6;
          } else if (obs.type === 'mine' || obs.type === 'rock' || obs.type === 'whirlpool' || obs.type === 'log') {
            // Steer AWAY from hazards!
            const dangerFactor = (1 - dist / 280) * 1.5;
            avoidSteer += (cross > 0 ? -1 : 1) * dangerFactor;
          }
        }
      }
    }

    // Desired angle to target
    const toTargetX = targetX - this.physics.x;
    const toTargetY = targetY - this.physics.y;
    const desiredAngle = Math.atan2(toTargetY, toTargetX);

    let angleDiff = desiredAngle - this.physics.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    let steer = Math.max(-1, Math.min(1, angleDiff * 1.8 + avoidSteer));

    // Throttle calculation
    let throttle = 1.0;
    // Slow down slightly on sharp corners
    if (Math.abs(angleDiff) > 0.9) {
      throttle = 0.65;
    }

    // Boost usage logic
    let boostRequest = false;
    this.boostCooldown -= dt;
    if (this.boostCooldown <= 0 && Math.abs(angleDiff) < 0.3 && this.physics.speed > 350) {
      boostRequest = true;
      this.boostCooldown = 8 + Math.random() * 8;
    }

    // Wedged against rocks: back off for a moment, turning away, then carry on
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      throttle = -1;
      steer = angleDiff > 0 ? -1 : 1;
      boostRequest = false;
    } else if (this.physics.speed < 40 && this.physics.spinOutTimer <= 0) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.2) {
        this.stuckTimer = 0;
        this.reverseTimer = 1.0;
      }
    } else {
      this.stuckTimer = 0;
    }

    this.physics.applyInput(throttle, steer, boostRequest, dt);
    this.physics.update(dt, this.track);
  }
}

export function createBots(count, track, startIndex = 1) {
  const bots = [];
  const models = ['viper', 'mako', 'phantom', 'titan'];

  for (let i = 0; i < count; i++) {
    const slot = startIndex + i;
    const startPos = track.starterGrid[slot] || track.starterGrid[slot % track.starterGrid.length];
    const name = BOT_NAMES[i % BOT_NAMES.length];
    const color = BOT_COLORS[i % BOT_COLORS.length];
    const model = models[i % models.length];

    bots.push(new BotRacer(`bot_${i + 1}`, name, color, model, startPos, track));
  }
  return bots;
}
