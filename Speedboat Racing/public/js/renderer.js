// Canvas Renderer and Particle System for Hydro Rush

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.wakeTrails = [];
    this.waterTime = 0;

    this.camera = {
      x: 0,
      y: 0,
      zoom: 1.0,
      targetZoom: 1.0,
    };

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  addParticle(p) {
    this.particles.push(p);
  }

  createSplash(x, y, count = 20, speed = 120, color = 'rgba(255, 255, 255, 0.8)') {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.7) * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: 3 + Math.random() * 4,
        maxLife: 0.4 + Math.random() * 0.4,
        life: 0,
        color,
        type: 'splash',
      });
    }
  }

  createExplosion(x, y) {
    // Fire & blast particles
    for (let i = 0; i < 35; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 240;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: 8 + Math.random() * 12,
        maxLife: 0.6 + Math.random() * 0.5,
        life: 0,
        color: Math.random() > 0.4 ? '#ff5400' : (Math.random() > 0.5 ? '#ffbe0b' : '#ff0054'),
        type: 'fire',
      });
    }

    // Smoke clouds
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 90;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: 14 + Math.random() * 16,
        maxLife: 1.0 + Math.random() * 0.8,
        life: 0,
        color: 'rgba(70, 70, 75, 0.6)',
        type: 'smoke',
      });
    }
  }

  createCrateSplinters(x, y) {
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 140;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: 4 + Math.random() * 5,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10,
        maxLife: 0.8 + Math.random() * 0.5,
        life: 0,
        color: '#b08968',
        type: 'wood',
      });
    }
  }

  addWakePoint(x, y, angle, speed, isDrifting) {
    if (speed < 40) return;
    const fX = Math.cos(angle);
    const fY = Math.sin(angle);
    const rX = -fY;
    const rY = fX;

    // Twin hull wake emitters
    const wakeOffset = 9;
    const rearDist = -20;

    const p1X = x + fX * rearDist + rX * wakeOffset;
    const p1Y = y + fY * rearDist + rY * wakeOffset;
    const p2X = x + fX * rearDist - rX * wakeOffset;
    const p2Y = y + fY * rearDist - rY * wakeOffset;

    const life = Math.min(2.0, 0.6 + (speed / 600) * 1.4);
    const size = 5 + (speed / 500) * 8;

    this.wakeTrails.push({
      x: p1X,
      y: p1Y,
      size,
      life: 0,
      maxLife: life,
      isDrift: isDrifting,
    });

    this.wakeTrails.push({
      x: p2X,
      y: p2Y,
      size,
      life: 0,
      maxLife: life,
      isDrift: isDrifting,
    });
  }

  update(dt) {
    this.waterTime += dt;

    // Update wake trails
    for (let i = this.wakeTrails.length - 1; i >= 0; i--) {
      const w = this.wakeTrails[i];
      w.life += dt;
      w.size += dt * 14;
      if (w.life >= w.maxLife) {
        this.wakeTrails.splice(i, 1);
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.9, dt * 60);
      p.vy *= Math.pow(0.9, dt * 60);
      if (p.rotSpeed) p.rotation += p.rotSpeed * dt;

      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }
  }

  render(track, localBoat, allBoats, isCountdown, countdownSec) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Update camera smooth follow
    if (localBoat) {
      const forwardX = Math.cos(localBoat.physics.angle);
      const forwardY = Math.sin(localBoat.physics.angle);
      const lookahead = Math.min(200, (localBoat.physics.speed / 700) * 180);

      const targetCamX = localBoat.physics.x + forwardX * lookahead;
      const targetCamY = localBoat.physics.y + forwardY * lookahead;

      this.camera.x += (targetCamX - this.camera.x) * 0.12;
      this.camera.y += (targetCamY - this.camera.y) * 0.12;

      // Dynamic zoom: zooms out slightly at top speeds for high speed reaction time
      const speedNorm = localBoat.physics.speed / 900;
      this.camera.targetZoom = 1.0 - speedNorm * 0.22;
      this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.08;
    }

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Apply screenshake
    let shakeX = 0;
    let shakeY = 0;
    if (localBoat && localBoat.physics.screenShake > 0) {
      const s = localBoat.physics.screenShake;
      shakeX = (Math.random() - 0.5) * s * 2;
      shakeY = (Math.random() - 0.5) * s * 2;
    }

    // World transform
    ctx.translate(w / 2 + shakeX, h / 2 + shakeY);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Water Background
    this.renderWater(ctx, track);

    // 2. Track Boundaries & Waypoint Path
    this.renderTrackPath(ctx, track);

    // 3. Wake Trails
    this.renderWakeTrails(ctx);

    // 4. Obstacles
    this.renderObstacles(ctx, track.obstacles);

    // 5. Particles (under boats)
    this.renderParticles(ctx, 'splash');
    this.renderParticles(ctx, 'wood');

    // 6. Speedboats
    allBoats.forEach(boat => {
      this.renderBoat(ctx, boat);
    });

    // 7. Particles (above boats: fire, smoke)
    this.renderParticles(ctx, 'fire');
    this.renderParticles(ctx, 'smoke');

    ctx.restore();

    // 8. Screen space speed streak effect during nitro boost
    if (localBoat && localBoat.physics.isBoosting) {
      this.renderSpeedLines(ctx, w, h);
    }
  }

  renderWater(ctx, track) {
    const waterColor = track.waterColor || '#0a84b3';
    const deepColor = track.deepWaterColor || '#004e75';

    // Base water fill across full track area
    ctx.fillStyle = waterColor;
    ctx.fillRect(-1000, -1000, track.width + 2000, track.height + 2000);

    // Procedural wave caustics
    const t = this.waterTime;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2.5;

    const startX = Math.floor((this.camera.x - 1200) / 160) * 160;
    const endX = this.camera.x + 1200;
    const startY = Math.floor((this.camera.y - 1000) / 160) * 160;
    const endY = this.camera.y + 1000;

    for (let x = startX; x < endX; x += 160) {
      for (let y = startY; y < endY; y += 160) {
        const waveOffset = Math.sin(x * 0.01 + t * 1.5) * 12 + Math.cos(y * 0.01 + t * 1.8) * 12;
        ctx.beginPath();
        ctx.arc(x + waveOffset, y + waveOffset, 45, 0, Math.PI * 1.2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  renderTrackPath(ctx, track) {
    const checkpoints = track.checkpoints;
    if (!checkpoints || checkpoints.length === 0) return;

    // Draw track corridor boundaries
    ctx.save();

    // Left and right boundary lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 6;
    ctx.setLineDash([20, 20]);

    // Outer boundary Left
    ctx.beginPath();
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const lx = cp.x - cp.nx * (cp.width / 2);
      const ly = cp.y - cp.ny * (cp.width / 2);
      if (i === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    }
    ctx.closePath();
    ctx.stroke();

    // Outer boundary Right
    ctx.beginPath();
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const rx = cp.x + cp.nx * (cp.width / 2);
      const ry = cp.y + cp.ny * (cp.width / 2);
      if (i === 0) ctx.moveTo(rx, ry);
      else ctx.lineTo(rx, ry);
    }
    ctx.closePath();
    ctx.stroke();

    // Checkered Start / Finish Line
    const startCp = checkpoints[0];
    const halfW = startCp.width / 2;
    const sx1 = startCp.x - startCp.nx * halfW;
    const sy1 = startCp.y - startCp.ny * halfW;
    const sx2 = startCp.x + startCp.nx * halfW;
    const sy2 = startCp.y + startCp.ny * halfW;

    ctx.setLineDash([]);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();

    // Secondary checkered stripes
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ff0054';
    ctx.setLineDash([16, 16]);
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();

    ctx.restore();
  }

  renderWakeTrails(ctx) {
    ctx.save();
    for (const w of this.wakeTrails) {
      const alpha = (1 - w.life / w.maxLife) * 0.45;
      ctx.fillStyle = w.isDrift ? `rgba(220, 245, 255, ${alpha * 1.3})` : `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  renderObstacles(ctx, obstacles) {
    if (!obstacles) return;

    for (const obs of obstacles) {
      if (!obs.active) continue;

      ctx.save();
      ctx.translate(obs.x, obs.y);

      switch (obs.type) {
        case 'rock': {
          // Rocky reef with foam edge
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius + 6, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = obs.color || '#495057';
          ctx.beginPath();
          // Organic polygon rock shape
          const sides = 7;
          for (let s = 0; s < sides; s++) {
            const a = (s / sides) * Math.PI * 2;
            const r = obs.radius * (0.8 + 0.25 * Math.sin(s * 2.3 + obs.id.length));
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#1b1d20';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Highlight
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.beginPath();
          ctx.arc(-obs.radius * 0.2, -obs.radius * 0.2, obs.radius * 0.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        case 'buoy': {
          // Bobbing water ripple
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius + 4, 0, Math.PI * 2);
          ctx.stroke();

          // Buoy body
          ctx.fillStyle = obs.color;
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Center blinking light
          const blink = Math.sin(this.waterTime * 5 + obs.x) > 0;
          ctx.fillStyle = blink ? '#ffffff' : '#333333';
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius * 0.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        case 'crate': {
          ctx.rotate(obs.rotation || 0);
          const s = obs.radius * 1.5;
          ctx.fillStyle = '#b08968';
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.strokeStyle = '#582f0e';
          ctx.lineWidth = 2;
          ctx.strokeRect(-s / 2, -s / 2, s, s);

          // Crate cross braces
          ctx.beginPath();
          ctx.moveTo(-s / 2, -s / 2);
          ctx.lineTo(s / 2, s / 2);
          ctx.moveTo(s / 2, -s / 2);
          ctx.lineTo(-s / 2, s / 2);
          ctx.stroke();
          break;
        }

        case 'log': {
          ctx.rotate(obs.rotation || 0);
          ctx.fillStyle = '#6f4e37';
          ctx.beginPath();
          ctx.roundRect(-obs.length / 2, -obs.width / 2, obs.length, obs.width, 6);
          ctx.fill();
          ctx.strokeStyle = '#3d2616';
          ctx.lineWidth = 2;
          ctx.stroke();
          // Log rings
          ctx.fillStyle = '#8a5a36';
          ctx.beginPath();
          ctx.arc(obs.length / 2 - 4, 0, obs.width / 2 - 2, 0, Math.PI * 2);
          ctx.arc(-obs.length / 2 + 4, 0, obs.width / 2 - 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        case 'mine': {
          // Spiked Naval Mine
          ctx.fillStyle = '#212529';
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius, 0, Math.PI * 2);
          ctx.fill();

          // Spikes
          ctx.strokeStyle = '#212529';
          ctx.lineWidth = 4;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * obs.radius, Math.sin(a) * obs.radius);
            ctx.lineTo(Math.cos(a) * (obs.radius + 8), Math.sin(a) * (obs.radius + 8));
            ctx.stroke();
          }

          // Pulsing red danger LED
          const blink = (Math.sin(obs.blinkTimer) + 1) / 2;
          ctx.fillStyle = `rgba(255, 0, 50, ${0.4 + blink * 0.6})`;
          ctx.beginPath();
          ctx.arc(0, 0, 8, 0, Math.PI * 2);
          ctx.fill();

          // Danger warning halo
          ctx.strokeStyle = `rgba(255, 0, 50, ${blink * 0.4})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius + 12 + blink * 8, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }

        case 'whirlpool': {
          // Swirling vortex rings
          ctx.rotate(obs.currentAngle);
          for (let r = 1; r <= 3; r++) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 - r * 0.05})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, obs.radius * (r * 0.6), 0, Math.PI * 1.6);
            ctx.stroke();
          }

          // Dark abyss center
          ctx.fillStyle = '#03071e';
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius * 0.35, 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        case 'ramp': {
          ctx.rotate(obs.angle);
          // Ramp base
          ctx.fillStyle = '#ffbe0b';
          ctx.fillRect(-obs.width / 2, -obs.height / 2, obs.width, obs.height);
          ctx.strokeStyle = '#d90429';
          ctx.lineWidth = 3;
          ctx.strokeRect(-obs.width / 2, -obs.height / 2, obs.width, obs.height);

          // Arrow chevrons
          ctx.fillStyle = '#d90429';
          for (let y = -obs.height / 3; y <= obs.height / 3; y += 18) {
            ctx.beginPath();
            ctx.moveTo(-14, y - 6);
            ctx.lineTo(0, y + 6);
            ctx.lineTo(14, y - 6);
            ctx.lineTo(0, y - 1);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }

        case 'boost_pad': {
          ctx.rotate(obs.angle);
          ctx.fillStyle = 'rgba(0, 229, 255, 0.4)';
          ctx.fillRect(-obs.width / 2, -obs.height / 2, obs.width, obs.height);
          ctx.strokeStyle = '#00f5d4';
          ctx.lineWidth = 3;
          ctx.strokeRect(-obs.width / 2, -obs.height / 2, obs.width, obs.height);

          // Animated glowing neon chevrons
          const pulseOffset = Math.sin(obs.pulse) * 6;
          ctx.fillStyle = '#00f5d4';
          for (let y = -obs.height / 3; y <= obs.height / 3; y += 18) {
            ctx.beginPath();
            ctx.moveTo(-12, y - 5 + pulseOffset);
            ctx.lineTo(0, y + 6 + pulseOffset);
            ctx.lineTo(12, y - 5 + pulseOffset);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }

        case 'oil_slick': {
          // Iridescent swirling oil spill
          const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, obs.radius);
          grad.addColorStop(0, 'rgba(15, 10, 30, 0.85)');
          grad.addColorStop(0.5, 'rgba(114, 9, 183, 0.6)');
          grad.addColorStop(0.8, 'rgba(67, 97, 238, 0.4)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius, 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        case 'tentacle': {
          // Sweeping kraken tentacle
          ctx.fillStyle = '#7209b7';
          ctx.beginPath();
          ctx.arc(0, 0, obs.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#f72585';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Suction suckers
          ctx.fillStyle = '#f72585';
          ctx.beginPath();
          ctx.arc(-8, -4, 5, 0, Math.PI * 2);
          ctx.arc(8, 4, 5, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }

      ctx.restore();
    }
  }

  renderBoat(ctx, boat) {
    const p = boat.physics;
    ctx.save();

    // 1. Shadow (especially offset when airborne)
    const shadowDist = 8 + p.z * 1.2;
    const shadowScale = 1.0 - Math.min(0.4, p.z * 0.015);

    ctx.save();
    ctx.translate(p.x + shadowDist * 0.6, p.y + shadowDist * 0.9);
    ctx.rotate(p.angle);
    ctx.scale(shadowScale, shadowScale);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.drawHullPath(ctx, p.specs);
    ctx.fill();
    ctx.restore();

    // 2. Boat Body
    ctx.translate(p.x, p.y - p.z * 1.2);
    ctx.rotate(p.angle);

    // Airborne scale pop
    if (p.isAirborne) {
      const airScale = 1.0 + Math.min(0.25, p.z * 0.01);
      ctx.scale(airScale, airScale);
    }

    // Engine thrust & turbo boost flames
    if (p.isBoosting || p.throttle > 0.1) {
      this.drawEngineThruster(ctx, p.isBoosting);
    }

    // Main hull
    this.drawHull(ctx, boat);

    // Racer label & rank tag
    ctx.restore();

    // 3. World space racer name tag
    ctx.save();
    ctx.translate(p.x, p.y - p.z * 1.2 - 38);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(-45, -12, 90, 22, 6);
    ctx.fill();
    ctx.strokeStyle = boat.color || '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(boat.name || 'Racer', 0, 0);
    ctx.restore();
  }

  drawHullPath(ctx, specs) {
    const hl = specs.hullLength / 2;
    const hw = specs.hullWidth / 2;

    ctx.beginPath();
    // Sleek aerodynamic speedboat prow
    ctx.moveTo(hl + 4, 0); // Bow tip
    ctx.lineTo(hl * 0.4, hw); // Forward starboard
    ctx.lineTo(-hl, hw * 0.9); // Stern starboard
    ctx.lineTo(-hl * 0.8, 0); // Motor transom indent
    ctx.lineTo(-hl, -hw * 0.9); // Stern port
    ctx.lineTo(hl * 0.4, -hw); // Forward port
    ctx.closePath();
  }

  drawHull(ctx, boat) {
    const p = boat.physics;
    const specs = p.specs;
    const hl = specs.hullLength / 2;
    const hw = specs.hullWidth / 2;

    // Outer hull outline
    this.drawHullPath(ctx, specs);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#1b263b';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Custom Livery Color Accent
    ctx.fillStyle = boat.color || '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(hl * 0.6, 0);
    ctx.lineTo(hl * 0.1, hw * 0.7);
    ctx.lineTo(-hl * 0.7, hw * 0.6);
    ctx.lineTo(-hl * 0.6, 0);
    ctx.lineTo(-hl * 0.7, -hw * 0.6);
    ctx.lineTo(hl * 0.1, -hw * 0.7);
    ctx.closePath();
    ctx.fill();

    // Dark Cockpit & Windshield
    ctx.fillStyle = '#0d1b2a';
    ctx.beginPath();
    ctx.moveTo(hl * 0.3, 0);
    ctx.lineTo(hl * 0.05, hw * 0.45);
    ctx.lineTo(-hl * 0.35, hw * 0.4);
    ctx.lineTo(-hl * 0.35, -hw * 0.4);
    ctx.lineTo(hl * 0.05, -hw * 0.45);
    ctx.closePath();
    ctx.fill();

    // Windshield glass reflection
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo(hl * 0.25, 0);
    ctx.lineTo(hl * 0.08, hw * 0.35);
    ctx.lineTo(-hl * 0.1, hw * 0.3);
    ctx.lineTo(hl * 0.05, 0);
    ctx.closePath();
    ctx.fill();

    // Outboard Marine Engine Block
    ctx.fillStyle = '#212529';
    ctx.fillRect(-hl - 5, -hw * 0.35, 7, hw * 0.7);
    ctx.strokeStyle = '#adb5bd';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-hl - 5, -hw * 0.35, 7, hw * 0.7);
  }

  drawEngineThruster(ctx, isBoosting) {
    const flameLen = isBoosting ? 32 + Math.random() * 14 : 14 + Math.random() * 6;
    const flameWidth = isBoosting ? 14 : 8;

    // Turbo fire plume
    ctx.fillStyle = isBoosting ? '#00f5d4' : '#ff5400';
    ctx.beginPath();
    ctx.moveTo(-24, -flameWidth / 2);
    ctx.lineTo(-24 - flameLen, 0);
    ctx.lineTo(-24, flameWidth / 2);
    ctx.closePath();
    ctx.fill();

    // Inner bright core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-24, -flameWidth / 4);
    ctx.lineTo(-24 - flameLen * 0.5, 0);
    ctx.lineTo(-24, flameWidth / 4);
    ctx.closePath();
    ctx.fill();
  }

  renderParticles(ctx, type) {
    for (const p of this.particles) {
      if (p.type !== type) continue;
      const alpha = 1 - p.life / p.maxLife;

      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.rotation) ctx.rotate(p.rotation);

      if (p.type === 'splash') {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'wood') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      } else if (p.type === 'fire') {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1 + (p.life / p.maxLife) * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'smoke') {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1 + (p.life / p.maxLife) * 1.2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  renderSpeedLines(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 245, 212, 0.25)';
    ctx.lineWidth = 2.5;

    const count = 16;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.1;
      const rInner = Math.min(w, h) * 0.35 + Math.random() * 50;
      const rOuter = Math.min(w, h) * 0.55;

      const x1 = w / 2 + Math.cos(angle) * rInner;
      const y1 = h / 2 + Math.sin(angle) * rInner;
      const x2 = w / 2 + Math.cos(angle) * rOuter;
      const y2 = h / 2 + Math.sin(angle) * rOuter;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderMinimap(minimapCanvas, track, allBoats, localBoatId) {
    if (!minimapCanvas || !track) return;
    const mctx = minimapCanvas.getContext('2d');
    const mw = minimapCanvas.width;
    const mh = minimapCanvas.height;

    mctx.clearRect(0, 0, mw, mh);

    // Background
    mctx.fillStyle = 'rgba(5, 25, 35, 0.85)';
    mctx.fillRect(0, 0, mw, mh);

    const scaleX = (mw - 24) / track.width;
    const scaleY = (mh - 24) / track.height;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (mw - track.width * scale) / 2;
    const offsetY = (mh - track.height * scale) / 2;

    const toMapX = (x) => offsetX + x * scale;
    const toMapY = (y) => offsetY + y * scale;

    // Draw track circuit line
    mctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    mctx.lineWidth = 4;
    mctx.beginPath();
    track.checkpoints.forEach((cp, i) => {
      const mx = toMapX(cp.x);
      const my = toMapY(cp.y);
      if (i === 0) mctx.moveTo(mx, my);
      else mctx.lineTo(mx, my);
    });
    mctx.closePath();
    mctx.stroke();

    // Start line marker
    const startCp = track.checkpoints[0];
    mctx.fillStyle = '#ffbe0b';
    mctx.beginPath();
    mctx.arc(toMapX(startCp.x), toMapY(startCp.y), 4, 0, Math.PI * 2);
    mctx.fill();

    // Obstacles markers (Mines in red, Ramps in yellow)
    if (track.obstacles) {
      for (const obs of track.obstacles) {
        if (!obs.active) continue;
        if (obs.type === 'mine') {
          mctx.fillStyle = '#ff0054';
          mctx.fillRect(toMapX(obs.x) - 1.5, toMapY(obs.y) - 1.5, 3, 3);
        } else if (obs.type === 'ramp') {
          mctx.fillStyle = '#ffbe0b';
          mctx.fillRect(toMapX(obs.x) - 2, toMapY(obs.y) - 2, 4, 4);
        } else if (obs.type === 'whirlpool') {
          mctx.fillStyle = '#7209b7';
          mctx.beginPath();
          mctx.arc(toMapX(obs.x), toMapY(obs.y), 4, 0, Math.PI * 2);
          mctx.stroke();
        }
      }
    }

    // Boats
    allBoats.forEach(b => {
      const isLocal = b.id === localBoatId;
      const bx = toMapX(b.physics.x);
      const by = toMapY(b.physics.y);

      mctx.fillStyle = b.color || '#00e5ff';
      mctx.beginPath();
      mctx.arc(bx, by, isLocal ? 5 : 3.5, 0, Math.PI * 2);
      mctx.fill();

      if (isLocal) {
        mctx.strokeStyle = '#ffffff';
        mctx.lineWidth = 1.5;
        mctx.stroke();
      }
    });
  }
}
