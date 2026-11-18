// The stage: the renderer, a physically based sky (the sun's light scattered through the atmosphere), the sea
// lit and reflecting that sky, sunlight with soft shadows, haze toward the horizon, a little bloom on bright
// things, and the camera that chases our boat.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The sky shader draws the sun's disc thousands of times brighter than anything else. Past 65,504 that overflows
// the half-precision buffers the bloom and the reflections use, the overflow spreads through the blur, and the
// whole frame goes black whenever the camera looks toward the sun. Capped here, the sun is still blinding white.
function capSky(sky) {
  sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( clamp( retColor, 0.0, 60.0 ), 1.0 );');
  return sky;
}

export class Stage {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    const high = quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !high, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 40000);
    this.camera.position.set(0, 10, -30);

    this.sky = capSky(new Sky());
    this.sky.scale.setScalar(30000);
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 900;
    this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1d3340, 0.35);
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(0, 1, 0);

    if (high) {
      const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.32, 0.5, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // If the graphics card resets (a driver hiccup, too many tabs), say so, and start again once it is back
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.onLost?.(); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.height = h;
  }

  // The weather and time of day of a course: the sky, the sun, the haze, and the sky's light on everything
  setTrack(def) {
    const s = def.sky;
    const u = this.sky.material.uniforms;
    u.turbidity.value = s.turbidity;
    u.rayleigh.value = s.rayleigh;
    u.mieCoefficient.value = s.mie;
    u.mieDirectionalG.value = 0.82;
    const phi = THREE.MathUtils.degToRad(90 - s.elevation);
    const theta = THREE.MathUtils.degToRad(s.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    // Low sun: warmer, dimmer light
    const low = Math.max(0, 1 - s.elevation / 30);
    this.sun.color.setRGB(1, 0.93 - low * 0.25, 0.85 - low * 0.45);
    this.sun.intensity = 2.2 + (1 - low) * 1.6;
    this.scene.fog = new THREE.FogExp2(def.fog, def.fogDensity);
    this.hemi.color.set(def.fog);
    // The sky's light, for reflections and ambient light
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyCopy = capSky(new Sky());
    skyCopy.scale.setScalar(1000);
    for (const k of Object.keys(u)) skyCopy.material.uniforms[k].value = u[k].value?.clone ? u[k].value.clone() : u[k].value;
    envScene.add(skyCopy);
    this.env?.dispose();
    this.env = pmrem.fromScene(envScene, 0, 0.1, 2000);
    this.scene.environment = this.env.texture;
    pmrem.dispose();
    this.renderer.toneMappingExposure = 0.42 + low * 0.25;
  }

  // Between races: everything off the stage but the sky and the lights
  clear() {
    const keep = new Set([this.sky, this.sun, this.sun.target, this.hemi]);
    for (const o of [...this.scene.children]) {
      if (keep.has(o)) continue;
      this.scene.remove(o);
      o.traverse?.((m) => { m.geometry?.dispose?.(); });
    }
  }

  // The sun's shadows follow the action
  follow(x, z) {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunDir.x * 400, Math.max(60, this.sunDir.y * 400), z + this.sunDir.z * 400);
  }

  render() {
    if (this.lost) return;
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
}

// The camera: behind and above our boat, swinging round with it, pulling back and widening as it speeds up, and
// shaking when something blows up nearby. Modes: chase, high, and the helm (from the cockpit).
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 10, -30);
    this.look = new THREE.Vector3();
    this.shakeT = 0;
    this.shakeK = 0;
    this.yaw = 0;
  }

  shake(amount) { this.shakeK = Math.max(this.shakeK, amount); this.shakeT = 0.6; }

  update(dt, b, lookBack = false) {
    if (!b) return;
    const speed = Math.abs(b.speed);
    // The camera's own heading follows the boat's with a lag, so a turn swings the view round
    const target = b.h + (lookBack ? Math.PI : 0);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * (this.mode === 'helm' ? 12 : 3.2));
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const L = b.k.length;
    let want;
    let at;
    if (this.mode === 'helm') {
      // On the bridge: low in a racing cockpit, high up in a warship's
      const bridge = L > 20 ? b.k.beam * 0.34 + (L > 60 ? 15 : 8) : 3.1;
      want = new THREE.Vector3(b.x - Math.sin(b.h) * L * (L > 60 ? 0.06 : 0.18), b.y + bridge + b.pitch * 2, b.z - Math.cos(b.h) * L * (L > 60 ? 0.06 : 0.18));
      at = new THREE.Vector3(b.x + fx * 60, b.y + 1.5, b.z + fz * 60);
      this.pos.copy(want);
    } else {
      const far = this.mode === 'high';
      const back = (far ? 38 : 17) + L * 0.62 + speed * (far ? 0.25 : 0.18);
      const up = (far ? 22 : 5) + L * (far ? 0.3 : 0.2) + speed * 0.05;
      want = new THREE.Vector3(b.x - fx * back, b.y + up, b.z - fz * back);
      at = new THREE.Vector3(b.x + fx * (18 + L * 0.3), b.y + (far ? 0 : 2.4 + L * 0.05), b.z + fz * (18 + L * 0.3));
      this.pos.lerp(want, Math.min(1, dt * 6));
      this.pos.y = Math.max(this.pos.y, b.y + 2.5);
    }
    this.look.lerp(at, Math.min(1, dt * 10));
    this.camera.position.copy(this.pos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakeK * Math.max(0, this.shakeT / 0.6);
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      if (this.shakeT <= 0) this.shakeK = 0;
    }
    this.camera.lookAt(this.look);
    const fov = 60 + Math.min(14, speed * 0.3);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix(); }
  }

  // Before the start: a slow orbit round our boat on the grid
  orbit(dt, b, t) {
    const a = b.h + Math.PI + Math.sin(t * 0.25) * 0.9;
    const r = 22 + b.k.length * 0.9;
    this.pos.set(b.x + Math.sin(a) * r, b.y + 5 + b.k.length * 0.18, b.z + Math.cos(a) * r);
    this.look.set(b.x, b.y + 2, b.z);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.yaw = b.h;
  }
}
