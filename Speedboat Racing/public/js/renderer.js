import * as THREE from 'three';

// 3D Realistic WebGL Speedboat Renderer for Hydro Rush

// The game simulates in world units (a boat is ~46 long, a channel ~420 wide). The 3D scene is
// drawn at a fifth of that, so every model is the same size as the hitbox the physics uses:
// what you see is what you hit.
const S = 0.2;

const CAMERA_MODES = {
  chase: { label: 'Chase', dist: 20, height: 7, lookAhead: 12, lookHeight: 1.5 },
  high: { label: 'High', dist: 44, height: 24, lookAhead: 22, lookHeight: 0 },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.cameraMode = 'chase'; // 'chase' (close behind, whole boat in view) | 'high' (further back and above)
    this.camYaw = null;
    this.lastCamTime = 0;
    this.decals = []; // course markings that ride on the waves

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 4000);

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
    const modes = Object.keys(CAMERA_MODES);
    this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
    const btn = typeof document !== 'undefined' && document.getElementById('btn-camera-toggle');
    if (btn) btn.textContent = `📹 View: ${CAMERA_MODES[this.cameraMode].label} [C]`;
  }

  // Called when a race is set up: clears the last race and paints the course on the water
  setTrack(track) {
    for (const mesh of [...this.obstacleMeshes.values(), ...this.boatMeshes.values()]) this.disposeObject(mesh);
    this.obstacleMeshes.clear();
    this.boatMeshes.clear();
    for (const d of this.decals) this.disposeObject(d.mesh);
    this.decals = [];
    for (const p of [...this.particles, ...this.wakeMeshes]) this.disposeObject(p.mesh);
    this.particles = [];
    this.wakeMeshes = [];
    this.camYaw = null;

    // Ocean under the course, in the track's own water colour
    this.oceanMesh.position.set((track.width / 2) * S, 0, (track.height / 2) * S);
    if (track.waterColor) this.oceanMat.color.set(track.waterColor);

    const pts = track.path ? track.path.points : track.checkpoints;
    const half = track.trackWidth / 2;

    // Racing line down the middle: wide, bright and unlit so it reads at any distance
    this.addRibbon(pts, 0, 12, new THREE.MeshBasicMaterial({ color: 0xffd60a, toneMapped: false }), 0.32);
    // Chevrons on the racing line pointing the way round
    this.addChevrons(pts, new THREE.MeshBasicMaterial({ color: 0xff6b00, toneMapped: false }));
    // Channel edges: stay between the white lines and you will never touch the shoreline rocks
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.addRibbon(pts, half, 6, edgeMat, 0.3);
    this.addRibbon(pts, -half, 6, edgeMat, 0.3);
    // Chequered start / finish line
    if (track.startLine) this.addStartLine(track.startLine);
  }

  disposeObject(obj) {
    this.scene.remove(obj);
    obj.traverse?.((o) => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }

  // A mesh whose vertices follow the wave surface every frame. xz holds world (x, y) pairs.
  addDecal(xz, indices, material, lift, colors = null) {
    const count = xz.length / 2;
    const positions = new Float32Array(count * 3);
    const base = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      base[i * 2] = xz[i * 2] * S;
      base[i * 2 + 1] = xz[i * 2 + 1] * S;
      positions[i * 3] = base[i * 2];
      positions[i * 3 + 2] = base[i * 2 + 1];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geo.setIndex(indices);
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.decals.push({ mesh, base, lift });
  }

  // Closed strip following the course, `offset` world units left of centre, `width` wide
  addRibbon(pts, offset, width, material, lift) {
    const xz = [];
    const idx = [];
    const n = pts.length;
    for (const p of pts) {
      for (const side of [-0.5, 0.5]) {
        const o = offset + side * width;
        xz.push(p.x + p.nx * o, p.y + p.ny * o);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    this.addDecal(xz, idx, material, lift);
  }

  addChevrons(pts, material) {
    const xz = [];
    const idx = [];
    const every = 7; // one chevron every ~140 world units
    for (let i = 3; i < pts.length; i += every) {
      const p = pts[i];
      const fx = Math.cos(p.angle);
      const fy = Math.sin(p.angle);
      const at = (along, side) => [p.x + fx * along + p.nx * side, p.y + fy * along + p.ny * side];
      // Two arms of a "V" pointing forward
      for (const sgn of [1, -1]) {
        const k = xz.length / 2;
        xz.push(...at(14, 0), ...at(-6, sgn * 26), ...at(-16, sgn * 26), ...at(4, 0));
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
    }
    this.addDecal(xz, idx, material, 0.36);
  }

  addStartLine(line) {
    const cells = 16;
    const xz = [];
    const idx = [];
    const colors = [];
    const fx = Math.cos(line.angle);
    const fy = Math.sin(line.angle);
    const cellW = line.width / cells;
    for (let row = 0; row < 2; row++) {
      for (let c = 0; c < cells; c++) {
        const k = xz.length / 2;
        const s0 = -line.width / 2 + c * cellW;
        const a0 = (row - 1) * 14;
        for (const [along, side] of [[a0, s0], [a0, s0 + cellW], [a0 + 14, s0 + cellW], [a0 + 14, s0]]) {
          xz.push(line.x + fx * along + line.nx * side, line.y + fy * along + line.ny * side);
          const v = (c + row) % 2 ? 0.05 : 1;
          colors.push(v, v, v);
        }
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
    }
    this.addDecal(xz, idx, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 0.34, colors);
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
    this.scene.fog = new THREE.FogExp2(0x88ccee, 0.0016);
    this.scene.background = new THREE.Color(0x88ccee);
  }

  setupOcean() {
    // High-detail dynamic ocean wave plane
    this.oceanSize = 3000;
    this.oceanSegments = 150;
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

  // Every model is built at the size of the obstacle's hitbox (world size × S)
  createObstacle3D(obs) {
    const group = new THREE.Group();
    group.position.set(obs.x * S, 0, obs.y * S);
    const headingY = (angle) => Math.PI / 2 - angle; // world heading -> rotation of a +Z-forward model

    switch (obs.type) {
      case 'rock': {
        const r = obs.radius * S;
        const rockGeo = new THREE.DodecahedronGeometry(r, 1);
        // Randomize vertex roughness for craggy natural look (never smaller than the hitbox)
        const pos = rockGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i);
          const vy = pos.getY(i);
          const vz = pos.getZ(i);
          const scale = 1.05 + (Math.sin(vx * 2 + vy * 3) + 1) * 0.12;
          pos.setXYZ(i, vx * scale, vy * scale * 0.45, vz * scale); // low, so they don't hide the course
        }
        rockGeo.computeVertexNormals();

        const rockMat = new THREE.MeshStandardMaterial({
          color: obs.color || 0x4a4f54,
          roughness: 0.9,
          metalness: 0.1,
          flatShading: true,
        });
        const rockMesh = new THREE.Mesh(rockGeo, rockMat);
        rockMesh.position.y = r * 0.15;
        rockMesh.rotation.y = (obs.x * 7 + obs.y * 3) % 6.28;
        rockMesh.castShadow = true;
        group.add(rockMesh);
        break;
      }

      case 'buoy': {
        // Red / Green marine channel buoy
        const isGreen = obs.color === '#00e676';
        const r = obs.radius * S;
        const buoyMat = new THREE.MeshStandardMaterial({
          color: isGreen ? 0x00e676 : 0xff1744,
          roughness: 0.3,
          metalness: 0.3,
        });
        const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, 4.5, 16), buoyMat);
        baseMesh.position.y = 1.6;
        baseMesh.castShadow = true;
        group.add(baseMesh);

        const lightMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ color: isGreen ? 0x69f0ae : 0xff5252 }));
        lightMesh.position.y = 4.2;
        group.add(lightMesh);
        break;
      }

      case 'mine': {
        // 3D Spiked Naval Mine
        const r = obs.radius * S * 0.75;
        const mineMat = new THREE.MeshStandardMaterial({
          color: 0x1f2421,
          roughness: 0.4,
          metalness: 0.85,
        });
        const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), mineMat);
        sphereMesh.position.y = 0.8;
        sphereMesh.castShadow = true;
        group.add(sphereMesh);

        // Contact spikes reaching out to the edge of the hitbox
        const spikeGeo = new THREE.ConeGeometry(0.3, obs.radius * S - r + 0.4, 6);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const tilt = i % 2 === 0 ? 0.5 : -0.3;
          const dir = new THREE.Vector3(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt));
          const spike = new THREE.Mesh(spikeGeo, mineMat);
          spike.position.copy(dir).multiplyScalar(r + 0.3).add(new THREE.Vector3(0, 0.8, 0));
          spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          group.add(spike);
        }

        // Pulsing Red Danger LED
        const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0054 }));
        ledMesh.position.y = 0.8 + r + 0.3;
        group.add(ledMesh);
        group.userData = { ledMesh };
        break;
      }

      case 'crate': {
        const side = obs.radius * S * 1.6;
        const crateMat = new THREE.MeshStandardMaterial({
          color: 0xa67c52,
          roughness: 0.8,
          metalness: 0.1,
        });
        const crateMesh = new THREE.Mesh(new THREE.BoxGeometry(side, side, side), crateMat);
        crateMesh.position.y = side * 0.3;
        crateMesh.rotation.y = 0.6;
        crateMesh.castShadow = true;
        group.add(crateMesh);
        break;
      }

      case 'log': {
        const logMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.95, metalness: 0.0 });
        const logGeo = new THREE.CylinderGeometry(obs.width * S / 2, obs.width * S / 2, obs.length * S, 10);
        logGeo.rotateX(Math.PI / 2); // lie along +Z
        const logMesh = new THREE.Mesh(logGeo, logMat);
        logMesh.position.y = 0.3;
        logMesh.castShadow = true;
        group.rotation.y = headingY(obs.rotation);
        group.add(logMesh);
        break;
      }

      case 'ramp': {
        // Floating jump kicker ramp: rises towards the direction of travel
        const rampMat = new THREE.MeshStandardMaterial({
          color: 0xffbe0b,
          roughness: 0.3,
          metalness: 0.5,
        });
        const len = obs.width * S; // along the course
        const wide = obs.height * S; // across the course
        const rampGeo = new THREE.BoxGeometry(wide, 0.6, len);
        rampGeo.rotateX(-0.32);
        const rampMesh = new THREE.Mesh(rampGeo, rampMat);
        rampMesh.position.y = 1.7;
        rampMesh.castShadow = true;
        group.rotation.y = headingY(obs.angle);
        group.add(rampMesh);
        break;
      }

      case 'boost_pad': {
        const padMat = new THREE.MeshStandardMaterial({
          color: 0x00f5d4,
          roughness: 0.2,
          metalness: 0.8,
          emissive: 0x00b4d8,
          emissiveIntensity: 0.8,
        });
        const padMesh = new THREE.Mesh(new THREE.BoxGeometry(obs.height * S, 0.3, obs.width * S * 1.2), padMat);
        padMesh.position.y = 0.9;
        group.rotation.y = headingY(obs.angle);
        group.add(padMesh);
        break;
      }

      case 'whirlpool': {
        // Dark eye (spins you out) inside a faint ring showing how far the pull reaches
        const eye = new THREE.RingGeometry(1, obs.radius * S, 32);
        eye.rotateX(-Math.PI / 2);
        const ringMesh = new THREE.Mesh(eye, new THREE.MeshBasicMaterial({ color: 0x001122, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
        ringMesh.position.y = 1.15;
        group.add(ringMesh);
        const pull = new THREE.RingGeometry(obs.pullRadius * S - 1.2, obs.pullRadius * S, 48);
        pull.rotateX(-Math.PI / 2);
        const pullMesh = new THREE.Mesh(pull, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }));
        pullMesh.position.y = 1.15;
        group.add(pullMesh);
        group.userData = { ringMesh };
        break;
      }

      case 'oil_slick': {
        const disc = new THREE.CircleGeometry(obs.radius * S, 28);
        disc.rotateX(-Math.PI / 2);
        const oilMesh = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({
          color: 0x0b0b10, roughness: 0.05, metalness: 1.0, emissive: 0x2a0a3a, emissiveIntensity: 0.6,
          transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        }));
        oilMesh.position.y = 1.12;
        group.add(oilMesh);
        break;
      }

      case 'tentacle': {
        // Kraken tentacle rising from the water, swaying as it sweeps across the channel
        const r = obs.radius * S;
        const mat = new THREE.MeshStandardMaterial({ color: 0x7b2d5b, roughness: 0.6, metalness: 0.1 });
        const suckerMat = new THREE.MeshStandardMaterial({ color: 0xf2b5d4, roughness: 0.5 });
        const arm = new THREE.Group();
        let y = 0;
        let radius = r;
        for (let i = 0; i < 6; i++) {
          const h = 3.2;
          const top = radius * 0.78;
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(top, radius, h, 12), mat);
          seg.position.set(Math.sin(i * 0.55) * i * 0.35, y + h / 2, 0);
          seg.rotation.z = -0.12 * i;
          seg.castShadow = true;
          arm.add(seg);
          const sucker = new THREE.Mesh(new THREE.SphereGeometry(top * 0.35, 8, 8), suckerMat);
          sucker.position.set(seg.position.x - top * 0.9, y + h / 2, 0);
          arm.add(sucker);
          y += h * 0.92;
          radius = top;
        }
        // Foam ring where it breaks the surface
        const foam = new THREE.RingGeometry(r, r + 1.6, 24);
        foam.rotateX(-Math.PI / 2);
        const foamMesh = new THREE.Mesh(foam, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
        foamMesh.position.y = 1.1;
        group.add(foamMesh);
        group.add(arm);
        group.userData = { arm };
        break;
      }
    }

    this.scene.add(group);
    return group;
  }

  createSplash(x, y, count = 25, speed = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed * S;
      const geo = new THREE.SphereGeometry(0.12 + Math.random() * 0.18, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x * S, 0.8, y * S);
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
      mesh.position.set(x * S, 1.0, y * S);
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
      mesh.position.set(x * S, 0.8, y * S);
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
    x *= S;
    y *= S;
    const fX = Math.cos(angle);
    const fY = Math.sin(angle);
    const rX = -fY;
    const rY = fX;

    [-0.8, 0.8].forEach(side => {
      const wx = x - fX * 3.5 + rX * side;
      const wy = y - fY * 3.5 + rY * side;

      const geo = new THREE.SphereGeometry(0.22 + (speed / 700) * 0.2, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, this.getWaveHeight(wx, wy, this.time) + 0.2, wy);
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
    // (flat shading works its normals out per face, so none need recomputing)
    const pos = this.oceanGeo.attributes.position;
    const count = pos.count;
    const t = this.time;
    const ox = this.oceanMesh.position.x;
    const oz = this.oceanMesh.position.z;
    for (let i = 0; i < count; i++) {
      pos.setY(i, this.getWaveHeight(pos.getX(i) + ox, pos.getZ(i) + oz, t));
    }
    pos.needsUpdate = true;

    // Course markings ride on the waves
    for (const d of this.decals) {
      const dp = d.mesh.geometry.attributes.position;
      for (let i = 0; i < dp.count; i++) {
        const x = d.base[i * 2];
        const z = d.base[i * 2 + 1];
        dp.setY(i, this.getWaveHeight(x, z, t) + d.lift);
      }
      dp.needsUpdate = true;
    }

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
      w.mesh.scale.set(1 + progress * 2.2, 0.3, 1 + progress * 2.2);
      w.mesh.material.opacity = (1 - progress) * 0.4;

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
        mesh.position.x = obs.x * S;
        mesh.position.z = obs.y * S;
        if (obs.type === 'buoy' || obs.type === 'crate' || obs.type === 'log' || obs.type === 'mine' || obs.type === 'tentacle') {
          // Bobbing on wave
          mesh.position.y = this.getWaveHeight(obs.x * S, obs.y * S, this.time);
        }
        if (obs.type === 'tentacle' && mesh.userData.arm) {
          mesh.userData.arm.rotation.y = this.time * 0.8;
          mesh.userData.arm.rotation.z = Math.sin(this.time * 2.2 + obs.phase) * 0.25;
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
      const waveH = this.getWaveHeight(p.x * S, p.y * S, this.time);
      bMesh.position.set(p.x * S, waveH + p.z * 0.5, p.y * S);

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

    // --- CAMERA: behind and above the boat, with the whole hull in view ---
    const p = localBoat.physics;
    const bx = p.x * S;
    const bz = p.y * S;
    const waveH = this.getWaveHeight(bx, bz, this.time);
    const camDt = Math.min(0.1, Math.max(0, this.time - this.lastCamTime));
    this.lastCamTime = this.time;

    // The camera swings round after the boat smoothly, and holds steady through a spin-out
    if (this.camYaw === null) this.camYaw = p.angle;
    if (!(p.spinOutTimer > 0)) {
      let d = p.angle - this.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camYaw += d * (1 - Math.exp(-5 * camDt));
    }
    const forwardX = Math.cos(this.camYaw);
    const forwardZ = Math.sin(this.camYaw);

    let shakeOffset = 0;
    if (this.screenShake > 0) {
      shakeOffset = (Math.random() - 0.5) * (this.screenShake * 0.04);
    }

    const mode = CAMERA_MODES[this.cameraMode] || CAMERA_MODES.chase;
    const dist = mode.dist + (p.speed / 800) * 3;
    const camH = mode.height + p.z * 0.25 + shakeOffset;
    this.camera.position.set(bx - forwardX * dist, waveH + camH, bz - forwardZ * dist);
    this.camera.lookAt(bx + forwardX * mode.lookAhead, waveH + mode.lookHeight + p.z * 0.3, bz + forwardZ * mode.lookAhead);

    // Keep Sun Following Player
    this.sunLight.position.set(bx + 300, 500, bz + 300);
    this.sunLight.target.position.set(bx, 0, bz);
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
    mctx.strokeStyle = 'rgba(255, 214, 10, 0.75)';
    mctx.lineWidth = 5;
    mctx.beginPath();
    (track.path ? track.path.points : track.checkpoints).forEach((cp, i) => {
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
