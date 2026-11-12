import * as THREE from 'three';

// 3D Realistic WebGL Speedboat Renderer for Hydro Rush
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.cameraMode = 'cockpit'; // 'cockpit' (POV directly in front / at the bow) | 'chase' (behind boat)

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.2, 8000);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting
    this.setupLighting();

    // Ocean Mesh & Wave Simulation
    this.setupOcean();

    // Meshes cache
    this.boatMeshes = new Map(); // boatId -> THREE.Group
    this.obstacleMeshes = new Map(); // obstacleId -> THREE.Group
    this.particles = [];
    this.wakeMeshes = [];

    // Screen Shake
    this.screenShake = 0;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') {
        this.toggleCamera();
      }
    });
  }

  toggleCamera() {
    this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
    const btn = document.getElementById('btn-camera-toggle');
    if (btn) {
      btn.textContent = this.cameraMode === 'cockpit' ? '📹 View: Cockpit [C]' : '📹 View: Chase [C]';
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setupLighting() {
    // Atmospheric Sun
    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
    this.sunLight.position.set(400, 600, 400);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 1500;
    const d = 250;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunLight);

    // Sky & Ocean Ambience
    this.hemiLight = new THREE.HemisphereLight(0x70c0ff, 0x003366, 1.2);
    this.scene.add(this.hemiLight);

    // Fog
    this.scene.fog = new THREE.FogExp2(0x88ccee, 0.0006);
    this.scene.background = new THREE.Color(0x88ccee);
  }

  setupOcean() {
    // High-detail dynamic ocean wave plane
    this.oceanSize = 6000;
    this.oceanSegments = 96;
    this.oceanGeo = new THREE.PlaneGeometry(this.oceanSize, this.oceanSize, this.oceanSegments, this.oceanSegments);
    this.oceanGeo.rotateX(-Math.PI / 2);

    this.oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0a6c9e,
      roughness: 0.15,
      metalness: 0.55,
      transparent: true,
      opacity: 0.94,
      flatShading: true,
    });

    this.oceanMesh = new THREE.Mesh(this.oceanGeo, this.oceanMat);
    this.oceanMesh.receiveShadow = true;
    this.scene.add(this.oceanMesh);
  }

  // Multi-frequency realistic Gerstner wave displacement
  getWaveHeight(x, z, t) {
    const w1 = Math.sin(x * 0.02 + t * 2.2) * 0.45;
    const w2 = Math.cos(z * 0.015 + t * 1.8) * 0.35;
    const w3 = Math.sin((x + z) * 0.035 + t * 2.8) * 0.25;
    return w1 + w2 + w3;
  }

  createBoat3D(boat) {
    const group = new THREE.Group();
    const color = new THREE.Color(boat.color || '#00e5ff');
    const hullMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.2,
      metalness: 0.35,
    });
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.2,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x15181c,
      roughness: 0.4,
      metalness: 0.7,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x112233,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.65,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      roughness: 0.1,
      metalness: 0.95,
    });

    // 1. Lower Deep-V Hull
    const hullGeo = new THREE.ConeGeometry(2.2, 9.5, 5);
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.scale(1.0, 0.45, 1.0);
    const hullMesh = new THREE.Mesh(hullGeo, whiteMat);
    hullMesh.position.set(0, 0.45, 0);
    hullMesh.castShadow = true;
    group.add(hullMesh);

    // 2. Upper Deck in Custom Livery Color
    const deckGeo = new THREE.BoxGeometry(2.4, 0.4, 6.5);
    const deckMesh = new THREE.Mesh(deckGeo, hullMat);
    deckMesh.position.set(0, 0.75, -0.6);
    deckMesh.castShadow = true;
    group.add(deckMesh);

    // Pointed Bow Nose Deck
    const bowGeo = new THREE.ConeGeometry(1.2, 3.2, 4);
    bowGeo.rotateX(Math.PI / 2);
    bowGeo.scale(1.0, 0.25, 1.0);
    const bowMesh = new THREE.Mesh(bowGeo, hullMat);
    bowMesh.position.set(0, 0.75, 4.0);
    bowMesh.castShadow = true;
    group.add(bowMesh);

    // 3. Cockpit Tub
    const cockpitGeo = new THREE.BoxGeometry(1.7, 0.5, 2.8);
    const cockpitMesh = new THREE.Mesh(cockpitGeo, darkMat);
    cockpitMesh.position.set(0, 0.7, 0);
    group.add(cockpitMesh);

    // Dual Racing Bucket Seats
    [-0.45, 0.45].forEach(sx => {
      const seatGeo = new THREE.BoxGeometry(0.55, 0.7, 0.55);
      const seatMesh = new THREE.Mesh(seatGeo, darkMat);
      seatMesh.position.set(sx, 1.0, -0.2);
      group.add(seatMesh);
    });

    // Steering Wheel & Dashboard
    const dashGeo = new THREE.BoxGeometry(1.6, 0.35, 0.3);
    const dashMesh = new THREE.Mesh(dashGeo, darkMat);
    dashMesh.position.set(0, 1.05, 0.9);
    group.add(dashMesh);

    const wheelGeo = new THREE.TorusGeometry(0.2, 0.04, 8, 16);
    wheelGeo.rotateX(Math.PI / 4);
    const wheelMesh = new THREE.Mesh(wheelGeo, chromeMat);
    wheelMesh.position.set(-0.4, 1.25, 0.85);
    group.add(wheelMesh);

    // 4. Tinted Wraparound Windshield
    const shieldGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.65, 12, 1, true, 0, Math.PI);
    shieldGeo.rotateY(Math.PI / 2);
    shieldGeo.scale(0.9, 1.0, 1.2);
    const shieldMesh = new THREE.Mesh(shieldGeo, glassMat);
    shieldMesh.position.set(0, 1.15, 1.2);
    group.add(shieldMesh);

    // 5. Twin Outboard Marine Motors (Transom)
    [-0.6, 0.6].forEach(mx => {
      const motorGeo = new THREE.BoxGeometry(0.45, 1.1, 0.7);
      const motorMesh = new THREE.Mesh(motorGeo, darkMat);
      motorMesh.position.set(mx, 0.6, -4.0);
      motorMesh.castShadow = true;
      group.add(motorMesh);

      // Exhaust Port
      const pipeGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8);
      pipeGeo.rotateX(Math.PI / 2);
      const pipeMesh = new THREE.Mesh(pipeGeo, chromeMat);
      pipeMesh.position.set(mx, 0.4, -4.4);
      group.add(pipeMesh);
    });

    // 6. Nitro Thruster Flame (Hidden until boosting)
    const flameGeo = new THREE.ConeGeometry(0.35, 2.4, 8);
    flameGeo.rotateX(-Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.9,
    });
    const flame1 = new THREE.Mesh(flameGeo, flameMat);
    flame1.position.set(-0.6, 0.4, -5.4);
    flame1.visible = false;
    group.add(flame1);

    const flame2 = new THREE.Mesh(flameGeo, flameMat);
    flame2.position.set(0.6, 0.4, -5.4);
    flame2.visible = false;
    group.add(flame2);

    group.userData = { flame1, flame2 };
    this.scene.add(group);
    return group;
  }

  createObstacle3D(obs) {
    const group = new THREE.Group();
    group.position.set(obs.x, 0, obs.y);

    switch (obs.type) {
      case 'rock': {
        const rockGeo = new THREE.DodecahedronGeometry(obs.radius * 0.12, 1);
        // Randomize vertex roughness for craggy natural look
        const pos = rockGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i);
          const vy = pos.getY(i);
          const vz = pos.getZ(i);
          const scale = 0.8 + Math.sin(vx * 2 + vy * 3) * 0.3;
          pos.setXYZ(i, vx * scale, vy * Math.max(0.4, scale), vz * scale);
        }
        rockGeo.computeVertexNormals();

        const rockMat = new THREE.MeshStandardMaterial({
          color: 0x4a4f54,
          roughness: 0.9,
          metalness: 0.1,
          flatShading: true,
        });
        const rockMesh = new THREE.Mesh(rockGeo, rockMat);
        rockMesh.position.y = obs.radius * 0.05;
        rockMesh.castShadow = true;
        group.add(rockMesh);
        break;
      }

      case 'buoy': {
        // Red / Green marine channel buoy
        const isGreen = obs.color === '#00e676';
        const buoyMat = new THREE.MeshStandardMaterial({
          color: isGreen ? 0x00e676 : 0xff1744,
          roughness: 0.3,
          metalness: 0.3,
        });
        const baseGeo = new THREE.CylinderGeometry(1.2, 1.4, 2.6, 16);
        const baseMesh = new THREE.Mesh(baseGeo, buoyMat);
        baseMesh.position.y = 1.0;
        baseMesh.castShadow = true;
        group.add(baseMesh);

        // Blinking beacon light
        const lightGeo = new THREE.SphereGeometry(0.35, 8, 8);
        const lightMat = new THREE.MeshBasicMaterial({ color: isGreen ? 0x69f0ae : 0xff5252 });
        const lightMesh = new THREE.Mesh(lightGeo, lightMat);
        lightMesh.position.y = 2.6;
        group.add(lightMesh);
        break;
      }

      case 'mine': {
        // 3D Spiked Naval Mine
        const mineMat = new THREE.MeshStandardMaterial({
          color: 0x1f2421,
          roughness: 0.4,
          metalness: 0.85,
        });
        const sphereGeo = new THREE.SphereGeometry(1.8, 16, 16);
        const sphereMesh = new THREE.Mesh(sphereGeo, mineMat);
        sphereMesh.position.y = 0.8;
        sphereMesh.castShadow = true;
        group.add(sphereMesh);

        // Contact Spikes
        const spikeGeo = new THREE.ConeGeometry(0.25, 1.2, 6);
        spikeGeo.rotateX(Math.PI / 2);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const spike = new THREE.Mesh(spikeGeo, mineMat);
          spike.position.set(Math.cos(a) * 1.8, 0.8 + (i % 2 === 0 ? 0.6 : -0.4), Math.sin(a) * 1.8);
          spike.lookAt(group.position.x + Math.cos(a) * 10, 0.8, group.position.z + Math.sin(a) * 10);
          group.add(spike);
        }

        // Pulsing Red Danger LED
        const ledGeo = new THREE.SphereGeometry(0.4, 8, 8);
        const ledMat = new THREE.MeshBasicMaterial({ color: 0xff0054 });
        const ledMesh = new THREE.Mesh(ledGeo, ledMat);
        ledMesh.position.y = 2.4;
        group.add(ledMesh);
        group.userData = { ledMesh };
        break;
      }

      case 'crate': {
        const crateGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
        const crateMat = new THREE.MeshStandardMaterial({
          color: 0xa67c52,
          roughness: 0.8,
          metalness: 0.1,
        });
        const crateMesh = new THREE.Mesh(crateGeo, crateMat);
        crateMesh.position.y = 0.8;
        crateMesh.castShadow = true;
        group.add(crateMesh);
        break;
      }

      case 'ramp': {
        // 3D Floating Jump Kicker Ramp
        const rampGeo = new THREE.BoxGeometry(6.0, 2.2, 8.0);
        rampGeo.rotateX(-Math.PI / 8);
        const rampMat = new THREE.MeshStandardMaterial({
          color: 0xffbe0b,
          roughness: 0.3,
          metalness: 0.5,
        });
        const rampMesh = new THREE.Mesh(rampGeo, rampMat);
        rampMesh.position.y = 0.6;
        rampMesh.rotation.y = obs.angle;
        rampMesh.castShadow = true;
        group.add(rampMesh);
        break;
      }

      case 'boost_pad': {
        const padGeo = new THREE.BoxGeometry(5.0, 0.3, 7.0);
        const padMat = new THREE.MeshStandardMaterial({
          color: 0x00f5d4,
          roughness: 0.2,
          metalness: 0.8,
          emissive: 0x00b4d8,
          emissiveIntensity: 0.5,
        });
        const padMesh = new THREE.Mesh(padGeo, padMat);
        padMesh.position.y = 0.2;
        padMesh.rotation.y = obs.angle;
        group.add(padMesh);
        break;
      }

      case 'whirlpool': {
        const ringGeo = new THREE.RingGeometry(2, 14, 24);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x001122,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.8,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.y = 0.05;
        group.add(ringMesh);
        group.userData = { ringMesh };
        break;
      }
    }

    this.scene.add(group);
    return group;
  }

  createSplash(x, y, count = 25, speed = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      const geo = new THREE.SphereGeometry(0.15 + Math.random() * 0.2, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.5, y);
      this.scene.add(mesh);

      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: 3 + Math.random() * 7,
        vz: Math.sin(angle) * spd,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.4,
      });
    }
  }

  createExplosion(x, y) {
    this.screenShake = 16;
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 6 + Math.random() * 18;
      const geo = new THREE.SphereGeometry(0.4 + Math.random() * 0.6, 6, 6);
      const isFire = Math.random() > 0.3;
      const mat = new THREE.MeshBasicMaterial({
        color: isFire ? (Math.random() > 0.5 ? 0xff5400 : 0xffbe0b) : 0x333333,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 1.0, y);
      this.scene.add(mesh);

      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: 4 + Math.random() * 12,
        vz: Math.sin(angle) * spd,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.5,
      });
    }
  }

  createCrateSplinters(x, y) {
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 3 + Math.random() * 8;
      const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
      const mat = new THREE.MeshStandardMaterial({ color: 0xa67c52 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.8, y);
      this.scene.add(mesh);

      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: 2 + Math.random() * 5,
        vz: Math.sin(angle) * spd,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.4,
      });
    }
  }

  addWakePoint(x, y, angle, speed, isDrifting) {
    if (speed < 60) return;
    const fX = Math.cos(angle);
    const fY = Math.sin(angle);
    const rX = -fY;
    const rY = fX;

    [-0.8, 0.8].forEach(side => {
      const wx = x - fX * 3.5 + rX * side;
      const wy = y - fY * 3.5 + rY * side;

      const geo = new THREE.SphereGeometry(0.35 + (speed / 700) * 0.4, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, 0.15, wy);
      this.scene.add(mesh);

      this.wakeMeshes.push({
        mesh,
        life: 0,
        maxLife: 1.4,
      });
    });
  }

  update(dt) {
    this.time += dt;

    // Ocean Wave Displacements
    const pos = this.oceanGeo.attributes.position;
    const count = pos.count;
    const t = this.time;
    for (let i = 0; i < count; i += 4) {
      const vx = pos.getX(i);
      const vz = pos.getY(i); // PlaneGeometry rotated on X
      const h = this.getWaveHeight(vx, vz, t);
      pos.setZ(i, h);
    }
    this.oceanGeo.computeVertexNormals();
    this.oceanGeo.attributes.position.needsUpdate = true;

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 18 * dt; // gravity

      const progress = p.life / p.maxLife;
      p.mesh.material.opacity = 1 - progress;
      p.mesh.scale.setScalar(1 + progress * 0.5);

      if (p.life >= p.maxLife || p.mesh.position.y < 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    // Update Wake Meshes
    for (let i = this.wakeMeshes.length - 1; i >= 0; i--) {
      const w = this.wakeMeshes[i];
      w.life += dt;
      const progress = w.life / w.maxLife;
      w.mesh.scale.set(1 + progress * 3.5, 0.4, 1 + progress * 3.5);
      w.mesh.material.opacity = (1 - progress) * 0.5;

      if (w.life >= w.maxLife) {
        this.scene.remove(w.mesh);
        this.wakeMeshes.splice(i, 1);
      }
    }

    // Screen Shake Decay
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - 20 * dt);
    }
  }

  render(track, localBoat, allBoats, isCountdown, countdownSec) {
    if (!track || !localBoat) return;

    // Synchronize 3D Obstacles
    if (track.obstacles) {
      for (const obs of track.obstacles) {
        let mesh = this.obstacleMeshes.get(obs.id);
        if (!mesh) {
          mesh = this.createObstacle3D(obs);
          this.obstacleMeshes.set(obs.id, mesh);
        }
        mesh.visible = obs.active;
        if (obs.type === 'buoy' || obs.type === 'crate') {
          // Bobbing on wave
          mesh.position.y = this.getWaveHeight(obs.x, obs.y, this.time);
        }
        if (obs.type === 'mine' && mesh.userData.ledMesh) {
          const blink = (Math.sin(this.time * 6) + 1) / 2;
          mesh.userData.ledMesh.material.color.setRGB(1.0, blink * 0.2, blink * 0.2);
        }
        if (obs.type === 'whirlpool' && mesh.userData.ringMesh) {
          mesh.userData.ringMesh.rotation.z += 0.05;
        }
      }
    }

    // Synchronize 3D Boats
    allBoats.forEach(b => {
      let bMesh = this.boatMeshes.get(b.id);
      if (!bMesh) {
        bMesh = this.createBoat3D(b);
        this.boatMeshes.set(b.id, bMesh);
      }

      const p = b.physics;
      const waveH = this.getWaveHeight(p.x, p.y, this.time);
      bMesh.position.set(p.x, waveH + p.z * 0.15, p.y);

      // Realistic boat attitude: Heading, Bank (Roll), Planing (Pitch)
      const heading = -p.angle + Math.PI / 2; // Align 2D heading with 3D Z/X
      bMesh.rotation.y = heading;

      // Planing pitch: bow rises under acceleration, dips on brake
      const forwardAccel = (p.throttle > 0 ? 0.08 : (p.throttle < 0 ? -0.06 : 0));
      const flightPitch = p.isAirborne ? -0.15 : 0;
      bMesh.rotation.x = -forwardAccel + flightPitch;

      // Banking roll: boat leans inward when turning at speed
      const roll = (p.steer || 0) * Math.min(0.35, (p.speed / 700) * 0.35);
      bMesh.rotation.z = roll;

      // Nitro Flames visibility
      if (bMesh.userData.flame1 && bMesh.userData.flame2) {
        bMesh.userData.flame1.visible = p.isBoosting;
        bMesh.userData.flame2.visible = p.isBoosting;
        if (p.isBoosting) {
          const flicker = 0.8 + Math.random() * 0.4;
          bMesh.userData.flame1.scale.set(1, flicker, 1);
          bMesh.userData.flame2.scale.set(1, flicker, 1);
        }
      }
    });

    // --- REALISTIC 3D CAMERA POSITIONING ---
    const p = localBoat.physics;
    const waveH = this.getWaveHeight(p.x, p.y, this.time);
    const forwardX = Math.cos(p.angle);
    const forwardZ = Math.sin(p.angle);

    let shakeOffset = 0;
    if (this.screenShake > 0) {
      shakeOffset = (Math.random() - 0.5) * (this.screenShake * 0.04);
    }

    if (this.cameraMode === 'cockpit') {
      // 🏎️ COCKPIT / BOW POV: Directly in front of the boat looking forward over the water!
      // Mounted right above the bow/windshield
      const bowDist = 2.2;
      const eyeH = 1.6 + p.z * 0.15 + shakeOffset;

      this.camera.position.set(
        p.x + forwardX * bowDist,
        waveH + eyeH,
        p.y + forwardZ * bowDist
      );

      // Look forward along the boat's heading into the oncoming waves
      const lookahead = 40.0;
      this.camera.lookAt(
        p.x + forwardX * lookahead,
        waveH + eyeH * 0.9,
        p.y + forwardZ * lookahead
      );
    } else {
      // 📹 CHASE POV: Classic 3D Video Game Behind-the-Boat Camera!
      const chaseDist = 18.0;
      const chaseH = 5.5 + (p.speed / 800) * 1.5 + p.z * 0.15 + shakeOffset;

      this.camera.position.set(
        p.x - forwardX * chaseDist,
        waveH + chaseH,
        p.y - forwardZ * chaseDist
      );

      const lookahead = 20.0;
      this.camera.lookAt(
        p.x + forwardX * lookahead,
        waveH + 2.0,
        p.y + forwardZ * lookahead
      );
    }

    // Keep Sun Following Player
    this.sunLight.position.set(p.x + 300, 500, p.y + 300);
    this.sunLight.target.position.set(p.x, 0, p.y);
    this.sunLight.target.updateMatrixWorld();

    // Render WebGL Frame
    this.renderer.render(this.scene, this.camera);
  }

  // 2D Radar Minimap in HUD
  renderMinimap(minimapCanvas, track, allBoats, localBoatId) {
    if (!minimapCanvas || !track) return;
    const mctx = minimapCanvas.getContext('2d');
    const mw = minimapCanvas.width;
    const mh = minimapCanvas.height;

    mctx.clearRect(0, 0, mw, mh);

    // High-tech circular radar background
    mctx.fillStyle = 'rgba(5, 15, 25, 0.85)';
    mctx.fillRect(0, 0, mw, mh);

    const scaleX = (mw - 24) / track.width;
    const scaleY = (mh - 24) / track.height;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (mw - track.width * scale) / 2;
    const offsetY = (mh - track.height * scale) / 2;

    const toMapX = (x) => offsetX + x * scale;
    const toMapY = (y) => offsetY + y * scale;

    // Track Course Line
    mctx.strokeStyle = 'rgba(0, 245, 212, 0.4)';
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

    // Obstacles Markers (Mines in red, Ramps in yellow)
    if (track.obstacles) {
      for (const obs of track.obstacles) {
        if (!obs.active) continue;
        if (obs.type === 'mine') {
          mctx.fillStyle = '#ff0054';
          mctx.fillRect(toMapX(obs.x) - 1.5, toMapY(obs.y) - 1.5, 3, 3);
        } else if (obs.type === 'ramp') {
          mctx.fillStyle = '#ffbe0b';
          mctx.fillRect(toMapX(obs.x) - 2, toMapY(obs.y) - 2, 4, 4);
        }
      }
    }

    // Boats Radar Blips
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
        mctx.lineWidth = 2;
        mctx.stroke();
      }
    });
  }

  // 3D Canvas Preview for Title Screen
  renderTitlePreview(canvas, boatColor, modelId, angle) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // High quality isometric 3D preview render
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);

    // Hull Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(8, 12, 35, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sleek V-Hull
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -45);
    ctx.lineTo(16, 15);
    ctx.lineTo(12, 35);
    ctx.lineTo(-12, 35);
    ctx.lineTo(-16, 15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#223344';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Livery Deck in Selected Color
    ctx.fillStyle = boatColor || '#00f5d4';
    ctx.beginPath();
    ctx.moveTo(0, -32);
    ctx.lineTo(12, 10);
    ctx.lineTo(9, 28);
    ctx.lineTo(-9, 28);
    ctx.lineTo(-12, 10);
    ctx.closePath();
    ctx.fill();

    // Cockpit & Windshield
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(7, 4);
    ctx.lineTo(-7, 4);
    ctx.closePath();
    ctx.fill();

    // Twin Outboard Motors
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(-8, 33, 4, 8);
    ctx.fillRect(4, 33, 4, 8);

    ctx.restore();
  }
}
