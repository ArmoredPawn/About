// Speedboat physics and hydrodynamic simulation for Hydro Rush

export const BOAT_MODELS = {
  viper: {
    id: 'viper',
    name: 'Viper GT',
    desc: 'High-performance catamaran. Balanced top speed and precision handling.',
    maxSpeed: 640,
    boostSpeed: 880,
    accel: 520,
    brake: 380,
    turnSpeed: 3.2,
    driftFriction: 0.88, // Lower = more drift
    mass: 1.0,
    hullLength: 46,
    hullWidth: 22,
  },
  mako: {
    id: 'mako',
    name: 'Mako Shark',
    desc: 'Streamlined needle hull. Extreme top speed, requires planning on turns.',
    maxSpeed: 700,
    boostSpeed: 960,
    accel: 460,
    brake: 320,
    turnSpeed: 2.7,
    driftFriction: 0.92,
    mass: 1.2,
    hullLength: 50,
    hullWidth: 20,
  },
  phantom: {
    id: 'phantom',
    name: 'Hydro Phantom',
    desc: 'Twin-engine sprint boat. Lightning acceleration and razor-sharp drifting.',
    maxSpeed: 620,
    boostSpeed: 840,
    accel: 600,
    brake: 450,
    turnSpeed: 3.8,
    driftFriction: 0.82,
    mass: 0.85,
    hullLength: 42,
    hullWidth: 24,
  },
  titan: {
    id: 'titan',
    name: 'Titan Surge',
    desc: 'Reinforced armored hull. Heavy weight smashes through crates and shrugs off hits.',
    maxSpeed: 600,
    boostSpeed: 820,
    accel: 480,
    brake: 400,
    turnSpeed: 2.8,
    driftFriction: 0.94,
    mass: 1.6,
    hullLength: 48,
    hullWidth: 26,
  },
};

export class BoatPhysics {
  constructor(options = {}) {
    this.modelId = options.model || 'viper';
    this.specs = BOAT_MODELS[this.modelId] || BOAT_MODELS.viper;

    this.x = options.x || 0;
    this.y = options.y || 0;
    this.z = 0; // Altitude above water
    this.vz = 0; // Vertical velocity

    this.vx = 0;
    this.vy = 0;
    this.angle = options.angle || 0; // Radians
    this.angularVelocity = 0;

    this.speed = 0;
    this.driftAngle = 0;
    this.isAirborne = false;
    this.isBoosting = false;
    this.boostTimer = 0;
    this.boostGauge = 100; // 0 to 100
    this.maxBoostGauge = 100;

    this.throttle = 0; // -1 to 1
    this.steer = 0; // -1 to 1
    this.isDrifting = false;

    this.spinOutTimer = 0;
    this.screenShake = 0;
    this.inOilTimer = 0;

    // Race progress
    this.lap = 1;
    this.currentCp = 0;
    this.progress = 0;
    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.currentLapStartTime = 0;

    // Wake generator state
    this.wakeEmitTimer = 0;
  }

  setModel(modelId) {
    if (BOAT_MODELS[modelId]) {
      this.modelId = modelId;
      this.specs = BOAT_MODELS[modelId];
    }
  }

  applyInput(throttle, steer, boostRequest, dt) {
    if (this.spinOutTimer > 0) {
      this.throttle = 0;
      this.steer = 0;
      return;
    }

    this.throttle = Math.max(-1, Math.min(1, throttle));
    this.steer = Math.max(-1, Math.min(1, steer));

    // Boost logic
    if (boostRequest && this.boostGauge > 10 && !this.isBoosting) {
      this.isBoosting = true;
    }

    if (this.isBoosting) {
      this.boostGauge = Math.max(0, this.boostGauge - 35 * dt);
      if (this.boostGauge <= 0 || (!boostRequest && this.boostTimer <= 0)) {
        this.isBoosting = false;
      }
    } else {
      // Passive boost recharge
      this.boostGauge = Math.min(this.maxBoostGauge, this.boostGauge + 8 * dt);
    }

    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      this.isBoosting = true;
    }
  }

  update(dt, track) {
    if (this.spinOutTimer > 0) {
      this.spinOutTimer -= dt;
      this.angle += 8 * dt;
    }

    if (this.inOilTimer > 0) {
      this.inOilTimer -= dt;
    }

    // Vertical physics (Jumping off ramps)
    if (this.isAirborne) {
      const gravity = -55;
      this.vz += gravity * dt;
      this.z += this.vz * dt;

      if (this.z <= 0) {
        this.z = 0;
        this.vz = 0;
        this.isAirborne = false;
        this.justLanded = true;
        this.screenShake = 6;
      }
    }

    const forwardX = Math.cos(this.angle);
    const forwardY = Math.sin(this.angle);
    const rightX = -forwardY;
    const rightY = forwardX;

    // Current velocity in boat local coordinates
    const forwardSpeed = this.vx * forwardX + this.vy * forwardY;
    const lateralSpeed = this.vx * rightX + this.vy * rightY;

    // Steering: Rudders only steer effectively when water is flowing over them!
    const effectiveSpeed = Math.abs(forwardSpeed);
    const rudderAuthority = Math.min(1.0, 0.2 + (effectiveSpeed / 200) * 0.8);
    const turnRate = this.specs.turnSpeed * rudderAuthority * (forwardSpeed >= -10 ? 1 : -1);

    if (this.spinOutTimer <= 0) {
      this.angle += this.steer * turnRate * dt;
    }

    // Acceleration & Throttle
    const targetMaxSpeed = this.isBoosting ? this.specs.boostSpeed : this.specs.maxSpeed;
    let thrust = 0;

    if (this.throttle > 0) {
      thrust = this.throttle * (this.isBoosting ? this.specs.accel * 1.6 : this.specs.accel);
    } else if (this.throttle < 0) {
      thrust = this.throttle * this.specs.brake;
    }

    // Apply thrust along boat heading
    this.vx += forwardX * thrust * dt;
    this.vy += forwardY * thrust * dt;

    // Hydrodynamic Drag
    // Longitudinal drag (water resistance against boat nose)
    const longDragCoeff = 0.55;
    const longDrag = -forwardSpeed * Math.abs(forwardSpeed) * 0.0009 - forwardSpeed * longDragCoeff;

    // Lateral drag (keel resistance: pushes boat straight, resists sliding)
    // In oil slick, lateral grip drops drastically!
    const keelGrip = this.inOilTimer > 0 ? 0.15 : this.specs.driftFriction;
    const lateralDrag = -lateralSpeed * (18.0 * keelGrip);

    // Apply hydrodynamic forces
    this.vx += (forwardX * longDrag + rightX * lateralDrag) * dt;
    this.vy += (forwardY * longDrag + rightY * lateralDrag) * dt;

    // Update positions
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Calculate overall speed and drift
    this.speed = Math.hypot(this.vx, this.vy);
    const velAngle = Math.atan2(this.vy, this.vx);
    let angleDiff = velAngle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this.driftAngle = angleDiff;
    this.isDrifting = this.speed > 200 && Math.abs(this.driftAngle) > 0.35;

    // Decay screenshake
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - 18 * dt);
    }

    // Checkpoint & Lap Tracking
    if (track && track.checkpoints) {
      this.updateRaceProgress(track);
    }
  }

  updateRaceProgress(track) {
    const checkpoints = track.checkpoints;
    const numCp = checkpoints.length;
    const targetCp = checkpoints[this.currentCp];

    // Distance to current target checkpoint
    const dx = this.x - targetCp.x;
    const dy = this.y - targetCp.y;
    const distToCp = Math.hypot(dx, dy);

    // Check if passed target checkpoint (dot product with segment direction)
    const forwardX = Math.cos(targetCp.angle);
    const forwardY = Math.sin(targetCp.angle);
    const proj = dx * forwardX + dy * forwardY;

    if (distToCp < targetCp.width * 0.9 || (proj > 0 && distToCp < 350)) {
      // Advanced checkpoint!
      const prevCp = this.currentCp;
      this.currentCp = (this.currentCp + 1) % numCp;

      // Completed a lap if wrapped around to checkpoint 0
      if (prevCp === numCp - 1 && this.currentCp === 0) {
        this.lap++;
      }
    }

    // Continuous progress metric for ranking
    const currCpObj = checkpoints[this.currentCp];
    const nextCpIndex = (this.currentCp + 1) % numCp;
    const nextCpObj = checkpoints[nextCpIndex];

    const segDx = nextCpObj.x - currCpObj.x;
    const segDy = nextCpObj.y - currCpObj.y;
    const segLenSq = segDx * segDx + segDy * segDy;

    let segT = 0;
    if (segLenSq > 0) {
      segT = ((this.x - currCpObj.x) * segDx + (this.y - currCpObj.y) * segDy) / segLenSq;
      segT = Math.max(0, Math.min(1, segT));
    }

    this.progress = (this.lap - 1) * numCp + this.currentCp + segT;
  }

  launchRamp(power = 1.0) {
    if (this.isAirborne) return;
    this.isAirborne = true;
    this.z = 4;
    this.vz = 26 * power;
    // Speed burst on ramp launch
    const fX = Math.cos(this.angle);
    const fY = Math.sin(this.angle);
    this.vx += fX * 120 * power;
    this.vy += fY * 120 * power;
  }

  applyExplosion(blastX, blastY, blastRadius = 140) {
    const dx = this.x - blastX;
    const dy = this.y - blastY;
    const dist = Math.hypot(dx, dy) || 1;

    if (dist > blastRadius) return;

    const force = (1 - dist / blastRadius) * 650;
    const nx = dx / dist;
    const ny = dy / dist;

    this.vx += nx * force;
    this.vy += ny * force;
    this.spinOutTimer = 1.2;
    this.screenShake = 14;
    this.speed *= 0.3;
  }

  triggerBoost(duration = 2.5) {
    this.boostTimer = Math.max(this.boostTimer, duration);
    this.isBoosting = true;
    const fX = Math.cos(this.angle);
    const fY = Math.sin(this.angle);
    this.vx += fX * 260;
    this.vy += fY * 260;
  }

  enterOil() {
    this.inOilTimer = 2.0;
  }
}
