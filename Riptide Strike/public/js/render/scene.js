// The stage: the renderer, the sky, the light, the lens, and the camera.
//
// Each course has a real photographed sky (a high-dynamic-range panorama from Poly Haven, CC0). It is the
// background, and it lights everything: the sea and the ships reflect it, and its light fills the shadows. The sun's
// direction, its strength, the colour of the haze at the horizon and the exposure are all read from the photo, so
// the sunlight and shadows match the clouds. Until the photo has loaded (or if it can't be), a computed sky stands in.
//
// Then a camera's finish: bloom on bright things, a lens flare when the sun is in view, a filmic colour grade, film
// grain, vignetting, colour fringes at the edges (more when we are hit) and a blur toward the edges at speed. The
// resolution adapts to keep the frame rate up, and the quality level is chosen to suit the graphics chip.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The computed sky draws the sun's disc thousands of times brighter than anything else. Past 65,504 that overflows
// the half-precision buffers the bloom and the reflections use, and the frame goes black when the camera faces the
// sun. Capped, the sun is still blinding white.
function capSky(sky) {
  sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( clamp( retColor, 0.0, 60.0 ), 1.0 );');
  return sky;
}

// The quality to start at: phones and tablets fast, built-in graphics high, a graphics card ultra
export function detectQuality(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Mali|Adreno|PowerVR|Apple GPU|SwiftShader|llvmpipe/i.test(name) || matchMedia('(pointer: coarse)').matches) return 'fast';
    if (/Intel|UHD|Iris|Radeon\(TM\) Graphics|Vega \d+ Graphics/i.test(name)) return 'high';
    return 'ultra';
  } catch { return 'high'; }
}

// The last pass: a filmic grade, grain, vignette, colour fringing and a zoom blur at speed
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVignette: { value: 0.42 }, uAberr: { value: 0.004 },
    uBlur: { value: 0 }, uSat: { value: 1.08 }, uContrast: { value: 1.06 }, uLift: { value: new THREE.Vector3(0.005, 0.008, 0.012) }, uGain: { value: new THREE.Vector3(1.02, 1.0, 0.97) }, uFlash: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uAberr, uBlur, uSat, uContrast, uFlash; uniform vec3 uLift, uGain;
    varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 fetch(vec2 uv) {
      vec2 d = uv - 0.5;
      float ab = uAberr * (0.4 + dot(d, d) * 4.0);
      return vec3(texture2D(tDiffuse, uv + d * ab).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ab).b);
    }
    void main() {
      vec2 d = vUv - 0.5;
      vec3 col = fetch(vUv);
      if (uBlur > 0.001) {
        // A zoom blur, stronger toward the edges, as at speed
        vec3 acc = col;
        for (int i = 1; i < 7; i++) acc += texture2D(tDiffuse, 0.5 + d * (1.0 - uBlur * float(i) * 0.012 * length(d) * 2.0)).rgb;
        col = acc / 7.0;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col = col * uGain + uLift;
      col = mix(col, vec3(1.0, 0.95, 0.85), uFlash);
      col *= 1.0 - uVignette * smoothstep(0.32, 0.95, length(d * vec2(1.15, 1.0)));
      col += (rand(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

function flareTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  if (kind === 'glow') { g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.08, 'rgba(255,245,220,0.9)'); g.addColorStop(0.3, 'rgba(255,200,150,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
  else if (kind === 'ring') { g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.72, 'rgba(0,0,0,0)'); g.addColorStop(0.82, 'rgba(160,220,255,0.35)'); g.addColorStop(0.9, 'rgba(255,170,120,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
  else { g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.5, 'rgba(180,210,255,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A photographed sun can be stored at nearly 60,000 times the brightness of the sky around it: so close to the
// 65,504 limit of the half-precision buffers that the bloom overflows them and the frame goes black. The brightest
// pixels are capped well below that (the sun is still blinding).
export function capPhoto(tex, max = 3000) {
  const d = tex.image.data;
  if (d instanceof Uint16Array) {
    const cap = THREE.DataUtils.toHalfFloat(max);
    for (let i = 0; i < d.length; i++) if ((i & 3) !== 3 && THREE.DataUtils.fromHalfFloat(d[i]) > max) d[i] = cap;
  } else for (let i = 0; i < d.length; i++) if ((i & 3) !== 3 && d[i] > max) d[i] = max;
  tex.needsUpdate = true;
  return tex;
}

// What a sky photo tells us: where the sun is and how strong, the colour of the haze at the horizon, and how
// bright the whole sky is (for the exposure). The panorama is equirectangular, read as three.js maps it.
export function readSky(tex) {
  const { data: raw, width: w, height: h } = tex.image;
  // Half-precision numbers (the loader's default, which every graphics chip can filter smoothly), decoded
  const half = raw instanceof Uint16Array;
  const at = half ? (i) => THREE.DataUtils.fromHalfFloat(raw[i]) : (i) => raw[i];
  const lum = (i) => at(i) * 0.2126 + at(i + 1) * 0.7152 + at(i + 2) * 0.0722;
  let best = 0;
  let bi = 0;
  let total = 0;
  let n = 0;
  const horizon = [0, 0, 0];
  let hn = 0;
  for (let y = 0; y < h / 2; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const l = lum(i);
      total += Math.min(l, 50);
      n++;
      if (l > best) { best = l; bi = y * w + x; }
    }
  }
  // The haze: just above the horizon
  for (let y = Math.floor(h * 0.47); y < Math.floor(h * 0.5); y++) for (let x = 0; x < w; x += 4) { const i = (y * w + x) * 4; const s = Math.min(1, 1.5 / Math.max(1e-4, lum(i))); horizon[0] += at(i) * s; horizon[1] += at(i + 1) * s; horizon[2] += at(i + 2) * s; hn++; }
  const avg = total / n;
  const px = bi % w;
  const py = Math.floor(bi / w);
  // Image row 0 is the top of the sky
  const u = (px + 0.5) / w;
  const v = 1 - (py + 0.5) / h;
  const phi = (u - 0.5) * Math.PI * 2;
  const lat = (v - 0.5) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat)).normalize();
  const i = bi * 4;
  const sunColor = new THREE.Color(at(i), at(i + 1), at(i + 2));
  const m = Math.max(sunColor.r, sunColor.g, sunColor.b) || 1;
  sunColor.multiplyScalar(1 / m);
  return { dir, sun: best, avg, clear: best / Math.max(0.01, avg), sunColor, haze: new THREE.Color(horizon[0] / hn, horizon[1] / hn, horizon[2] / hn) };
}

export class Stage {
  constructor(canvas, { quality = 'auto' } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.quality = quality === 'auto' ? detectQuality(this.renderer) : quality;
    const q = this.quality;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, q === 'ultra' ? 2 : q === 'high' ? 1.25 : 1);
    this.minRatio = q === 'fast' ? 0.5 : 0.6;
    this.ratio = this.maxRatio;
    this.renderer.setPixelRatio(this.ratio);
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
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 1; sc.far = 1200;
    const sm = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1d3340, 0.15);
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.hdris = new Map();

    // The lens flare, kept out where the sun is
    this.flareAnchor = new THREE.Object3D();
    if (q !== 'fast') {
      const flare = new Lensflare();
      flare.addElement(new LensflareElement(flareTexture('glow'), 520, 0, new THREE.Color(1, 0.95, 0.85)));
      flare.addElement(new LensflareElement(flareTexture('ring'), 160, 0.35));
      flare.addElement(new LensflareElement(flareTexture('spot'), 70, 0.6));
      flare.addElement(new LensflareElement(flareTexture('spot'), 110, 0.75));
      flare.addElement(new LensflareElement(flareTexture('ring'), 260, 1.0));
      this.flareAnchor.add(flare);
      this.flare = flare;
    }
    this.scene.add(this.flareAnchor);

    if (q !== 'fast') {
      const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.3, 0.55, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.cine = new ShaderPass(CinematicShader);
      this.composer.addPass(this.cine);
    } else this.renderer.setPixelRatio(this.ratio);
    this.fx = { blur: 0, aberr: 0, flash: 0 };
    this.ema = 16;
    this.adaptT = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // If the graphics card resets (a driver hiccup, too many tabs), say so, and start again once it is back
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.onLost?.(); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.ratio);
    this.composer?.setSize(w, h);
    this.height = h;
  }

  // Keep the frame rate up: fewer pixels when frames take too long, more when there is time to spare
  adapt(ms) {
    this.ema += (Math.min(ms, 100) - this.ema) * 0.05;
    this.adaptT += ms;
    if (this.adaptT < 1200) return;
    this.adaptT = 0;
    const was = this.ratio;
    if (this.ema > 21 && this.ratio > this.minRatio) this.ratio = Math.max(this.minRatio, this.ratio - 0.1);
    else if (this.ema < 13.5 && this.ratio < this.maxRatio) this.ratio = Math.min(this.maxRatio, this.ratio + 0.05);
    if (this.ratio !== was) this.resize();
  }

  // The weather and time of day of a course. The computed sky first, at once; then the photographed sky when it
  // has loaded.
  setTrack(def) {
    this.track = def;
    this.#computedSky(def);
    if (!def.hdri) return;
    const url = new URL(`../../assets/sky/${def.hdri}.hdr`, import.meta.url).href;
    const use = (tex) => { if (this.track === def) this.#photoSky(tex, def); };
    if (this.hdris.has(url)) { use(this.hdris.get(url)); return; }
    new RGBELoader().load(url, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      capPhoto(tex);
      this.hdris.set(url, tex);
      use(tex);
    }, undefined, () => { /* keep the computed sky */ });
  }

  #computedSky(def) {
    const s = def.sky;
    const u = this.sky.material.uniforms;
    this.sky.visible = true;
    this.scene.background = null;
    u.turbidity.value = s.turbidity;
    u.rayleigh.value = s.rayleigh;
    u.mieCoefficient.value = s.mie;
    u.mieDirectionalG.value = 0.82;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - s.elevation), THREE.MathUtils.degToRad(s.azimuth));
    u.sunPosition.value.copy(this.sunDir);
    const low = Math.max(0, 1 - s.elevation / 30);
    this.sun.color.setRGB(1, 0.93 - low * 0.25, 0.85 - low * 0.45);
    this.sun.intensity = 2.2 + (1 - low) * 1.6;
    this.scene.fog = new THREE.FogExp2(def.fog, def.fogDensity);
    this.hemi.color.set(def.fog);
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
    this.flareOn = s.elevation > 2;
  }

  #photoSky(tex, def) {
    const info = tex.userData.sky ?? (tex.userData.sky = readSky(tex));
    this.sky.visible = false;
    this.scene.background = tex;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env?.dispose();
    this.env = pmrem.fromEquirectangular(tex);
    this.scene.environment = this.env.texture;
    pmrem.dispose();
    // The sun where the photo has it; strong on a clear day, faint through cloud
    this.sunDir.copy(info.dir);
    if (this.sunDir.y < 0.05) this.sunDir.y = 0.05;
    this.sunDir.normalize();
    const clear = Math.min(1, Math.log10(Math.max(1, info.clear)) / 3);
    this.sun.color.copy(info.sunColor).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.sun.intensity = 0.6 + 3.2 * clear;
    this.sun.shadow.radius = clear > 0.5 ? 2 : 6;
    // Exposure: the sky's own brightness sets it, as a camera would
    const exposure = THREE.MathUtils.clamp(0.55 / Math.max(0.05, info.avg), 0.15, 2.5);
    this.renderer.toneMappingExposure = exposure;
    this.scene.backgroundIntensity = 1;
    this.scene.environmentIntensity = 1;
    // The haze at the horizon, so the sea fades into the sky
    this.scene.fog = new THREE.FogExp2(info.haze.clone(), def.fogDensity * 0.8);
    this.hemi.intensity = 0.05;
    this.flareOn = clear > 0.4;
  }

  // Between races: everything off the stage but the sky, the lights and the flare
  clear() {
    const keep = new Set([this.sky, this.sun, this.sun.target, this.hemi, this.flareAnchor]);
    for (const o of [...this.scene.children]) {
      if (keep.has(o)) continue;
      this.scene.remove(o);
      o.traverse?.((m) => { m.geometry?.dispose?.(); });
    }
  }

  // The sun's shadows follow the action
  follow(x, z) {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunDir.x * 500, Math.max(60, this.sunDir.y * 500), z + this.sunDir.z * 500);
  }

  // Momentary effects for the lens: blur at speed, colour fringes when hit, a flash from a big blast nearby
  lens({ blur = 0, aberr = 0, flash = 0 } = {}) {
    this.fx.blur = blur;
    this.fx.aberr = Math.max(this.fx.aberr, aberr);
    this.fx.flash = Math.max(this.fx.flash, flash);
  }

  render(dt = 0.016) {
    if (this.lost) return;
    this.flareAnchor.position.copy(this.camera.position).addScaledVector(this.sunDir, 30000);
    if (this.flare) this.flare.visible = Boolean(this.flareOn);
    if (this.cine) {
      const u = this.cine.uniforms;
      u.uTime.value += dt;
      u.uBlur.value += (this.fx.blur - u.uBlur.value) * Math.min(1, dt * 4);
      u.uAberr.value = 0.003 + this.fx.aberr * 0.05;
      u.uFlash.value = this.fx.flash;
      this.fx.aberr = Math.max(0, this.fx.aberr - dt * 2.5);
      this.fx.flash = Math.max(0, this.fx.flash - dt * 3);
    }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
}

// The camera: behind and above our ship, swinging round with it, pulling back and widening as it speeds up, dipping
// toward the water at speed, and shaking when something blows up nearby. Modes: chase, high, and the bridge.
// Before the start, a crane shot sweeps down over the grid; when we sink someone, it can cut to the wreck.
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 10, -30);
    this.look = new THREE.Vector3();
    this.shakeT = 0;
    this.shakeK = 0;
    this.yaw = 0;
    this.focus = null;
  }

  shake(amount) { this.shakeK = Math.max(this.shakeK, amount); this.shakeT = 0.6; }

  // Look at something else for a moment (a ship we have just sunk): { x, y, z, t }
  cut(target) { this.focus = target; }

  #finish(dt) {
    this.camera.position.copy(this.pos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakeK * Math.max(0, this.shakeT / 0.6);
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.look.x += (Math.random() - 0.5) * k * 0.3;
      if (this.shakeT <= 0) this.shakeK = 0;
    }
    this.camera.lookAt(this.look);
  }

  update(dt, b, lookBack = false) {
    if (!b) return;
    const speed = Math.abs(b.speed);
    const L = b.k.length;
    if (this.focus) {
      // A cut to the wreck: low and wide, drifting round it
      const f = this.focus;
      f.t -= dt;
      const a = f.a = (f.a ?? Math.atan2(this.pos.x - f.x, this.pos.z - f.z)) + dt * 0.25;
      const want = new THREE.Vector3(f.x + Math.sin(a) * (40 + f.r), f.y + 6 + f.r * 0.15, f.z + Math.cos(a) * (40 + f.r));
      this.pos.lerp(want, Math.min(1, dt * 3));
      this.look.lerp(new THREE.Vector3(f.x, f.y + 3, f.z), Math.min(1, dt * 5));
      if (f.t <= 0) this.focus = null;
      this.#finish(dt);
      return;
    }
    // The camera's own heading follows the ship's with a lag, so a turn swings the view round
    const target = b.h + (lookBack ? Math.PI : 0);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * (this.mode === 'helm' ? 12 : 3.2));
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let at;
    if (this.mode === 'helm') {
      // On the bridge: low in a racing cockpit, high up in a warship's
      const bridge = L > 20 ? b.k.beam * 0.34 + (L > 60 ? 15 : 8) : 3.1;
      this.pos.set(b.x - Math.sin(b.h) * L * (L > 60 ? 0.06 : 0.18), b.y + bridge + b.pitch * 2, b.z - Math.cos(b.h) * L * (L > 60 ? 0.06 : 0.18));
      at = new THREE.Vector3(b.x + fx * 60, b.y + 1.5 + b.pitch * 20, b.z + fz * 60);
    } else {
      const far = this.mode === 'high';
      const fast = Math.min(1, speed / b.k.top);
      const back = (far ? 38 : 17) + L * 0.62 + speed * (far ? 0.25 : 0.16);
      // At speed the camera drops toward the water: the sea rushes past
      const up = (far ? 22 : 5) + L * (far ? 0.3 : 0.2) - fast * (far ? 0 : L * 0.05 + 1.2);
      const want = new THREE.Vector3(b.x - fx * back, b.y + up, b.z - fz * back);
      at = new THREE.Vector3(b.x + fx * (18 + L * 0.3), b.y + (far ? 0 : 2.4 + L * 0.05), b.z + fz * (18 + L * 0.3));
      this.pos.lerp(want, Math.min(1, dt * 6));
      this.pos.y = Math.max(this.pos.y, b.y + 2.2);
    }
    this.look.lerp(at, Math.min(1, dt * 10));
    this.#finish(dt);
    const fov = 60 + Math.min(16, speed * 0.32);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix(); }
  }

  // Before the start: a crane shot from high over the grid down to behind our ship. k: 0 at the start, 1 at the go.
  intro(dt, b, k) {
    const L = b.k.length;
    const e = 1 - (1 - Math.min(1, k)) ** 3;
    const a = b.h + Math.PI + (1 - e) * 1.6;
    const r = (17 + L * 0.62) + (1 - e) * (260 + L);
    const h = (5 + L * 0.2) + (1 - e) * 120;
    this.pos.set(b.x + Math.sin(a) * r, b.y + h, b.z + Math.cos(a) * r);
    this.look.set(b.x + Math.sin(b.h) * (1 - e) * 120, b.y + 2, b.z + Math.cos(b.h) * (1 - e) * 120);
    this.yaw = b.h;
    this.#finish(dt);
  }

  // Behind the menu: a slow orbit round a ship
  orbit(dt, b, t) {
    const a = b.h + Math.PI + Math.sin(t * 0.25) * 0.9;
    const r = 22 + b.k.length * 0.9;
    this.pos.set(b.x + Math.sin(a) * r, b.y + 5 + b.k.length * 0.18, b.z + Math.cos(a) * r);
    this.look.set(b.x, b.y + 2, b.z);
    this.yaw = b.h;
    this.#finish(dt);
  }
}
