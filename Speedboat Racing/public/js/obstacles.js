// Obstacle system for Hydro Rush
export class Obstacle {
  constructor(data) {
    this.id = data.id || ('obs_' + Math.random().toString(36).substr(2, 9));
    this.type = data.type; // 'rock' | 'buoy' | 'crate' | 'log' | 'mine' | 'whirlpool' | 'ramp' | 'boost_pad' | 'oil_slick' | 'tentacle'
    this.x = data.x;
    this.y = data.y;
    this.radius = data.radius || 24;
    this.rotation = data.rotation || 0;
    this.color = data.color || '#888';
    this.active = true;
    this.respawnTimer = 0;
    this.seed = data.seed || 1;
    this.options = data.options || {};

    // Specific obstacle properties
    if (this.type === 'whirlpool') {
      this.pullRadius = data.pullRadius || 180;
      this.pullStrength = data.pullStrength || 280;
      this.spinSpeed = data.spinSpeed || 2.5;
      this.currentAngle = 0;
    } else if (this.type === 'mine') {
      this.blinkTimer = 0;
      this.exploded = false;
      this.blastRadius = 140;
    } else if (this.type === 'buoy') {
      this.color = data.subType === 'green' ? '#00e676' : '#ff1744';
      this.vx = 0;
      this.vy = 0;
      this.baseX = data.x;
      this.baseY = data.y;
    } else if (this.type === 'crate') {
      this.health = 1;
      this.vx = 0;
      this.vy = 0;
    } else if (this.type === 'log') {
      this.length = data.length || 60;
      this.width = 16;
    } else if (this.type === 'ramp') {
      this.width = data.width || 48;
      this.height = data.height || 64;
      this.angle = data.angle || 0;
    } else if (this.type === 'boost_pad') {
      this.width = data.width || 44;
      this.height = data.height || 56;
      this.angle = data.angle || 0;
      this.pulse = 0;
    } else if (this.type === 'oil_slick') {
      this.radius = data.radius || 70;
    } else if (this.type === 'tentacle') {
      this.patrolDist = data.patrolDist || 160;
      this.patrolSpeed = data.patrolSpeed || 1.2;
      this.baseX = data.x;
      this.baseY = data.y;
      this.patrolAngle = data.patrolAngle || 0;
      this.phase = Math.random() * Math.PI * 2;
    }
  }

  update(dt) {
    if (!this.active) {
      if (this.respawnTimer > 0) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.active = true;
          this.exploded = false;
        }
      }
      return;
    }

    if (this.type === 'whirlpool') {
      this.currentAngle += this.spinSpeed * dt;
    } else if (this.type === 'mine') {
      this.blinkTimer += dt * 4;
    } else if (this.type === 'boost_pad') {
      this.pulse = (this.pulse + dt * 5) % (Math.PI * 2);
    } else if (this.type === 'buoy') {
      // Spring back to base position
      const dx = this.baseX - this.x;
      const dy = this.baseY - this.y;
      this.vx += dx * 4 * dt;
      this.vy += dy * 4 * dt;
      this.vx *= Math.pow(0.85, dt * 60);
      this.vy *= Math.pow(0.85, dt * 60);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    } else if (this.type === 'crate') {
      this.vx *= Math.pow(0.9, dt * 60);
      this.vy *= Math.pow(0.9, dt * 60);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    } else if (this.type === 'tentacle') {
      this.phase += this.patrolSpeed * dt;
      const offset = Math.sin(this.phase) * this.patrolDist;
      this.x = this.baseX + Math.cos(this.patrolAngle) * offset;
      this.y = this.baseY + Math.sin(this.patrolAngle) * offset;
    }
  }

  detonate() {
    if (this.type !== 'mine' || this.exploded) return false;
    this.exploded = true;
    this.active = false;
    this.respawnTimer = 6.0; // Respawns after 6 seconds
    return true;
  }

  smash() {
    if (this.type !== 'crate' || !this.active) return false;
    this.active = false;
    this.respawnTimer = 5.0;
    return true;
  }
}
