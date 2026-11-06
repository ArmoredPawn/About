// Home page only. A WebGL scene behind the page (three.js): a star field and glowing
// wireframe shapes that drift past as you scroll and lean toward the pointer. Plus CSS 3-D:
// cards that tilt under the pointer, sections that swing in, and an avatar that turns to look.
window.__home3d = true;

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// Pointer position across the window, -1..1 on each axis
const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = (e.clientY / innerHeight) * 2 - 1;
}, { passive: true });

setupReveal();
if (finePointer && !reduceMotion) {
  setupCardTilt();
  setupAvatarTilt();
}
startScene();

/* ---------- Scroll-in ---------- */

function setupReveal() {
  if (!root.classList.contains('reveal-on')) return;
  const items = [...document.querySelectorAll('.home .intro, .home .section > h2, .home .section-note')]
    .map((el) => [el, 0]);
  for (const grid of document.querySelectorAll('.home .cards')) {
    [...grid.children].forEach((el, i) => items.push([el, Math.min(i, 6) * 70]));
  }

  const finish = (el) => { el.classList.add('revealed'); el.classList.remove('in'); };
  const io = new IntersectionObserver((entries) => {
    for (const { target: el, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      io.unobserve(el);
      el.classList.add('in');
      const delay = parseFloat(el.style.getPropertyValue('--d')) || 0;
      const timer = setTimeout(() => finish(el), 1200 + delay);
      el.addEventListener('transitionend', function done(e) {
        if (e.target !== el || e.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', done);
        clearTimeout(timer);
        finish(el);
      });
    }
  }, { rootMargin: '0px 0px -6% 0px' });

  for (const [el, delay] of items) {
    if (delay) el.style.setProperty('--d', `${delay}ms`);
    io.observe(el);
  }
}

/* ---------- Card tilt ---------- */

function setupCardTilt() {
  for (const card of document.querySelectorAll('.home .card')) {
    card.classList.add('tilt');
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const max = r.width > 360 ? 7 : 12; // wide cards tilt less, so their edges don't swing far
      card.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  }
}

function setupAvatarTilt() {
  const el = document.querySelector('.avatar-3d');
  if (!el) return;
  addEventListener('pointermove', () => {
    el.style.setProperty('--ay', `${(pointer.x * 16).toFixed(2)}deg`);
    el.style.setProperty('--ax', `${(-pointer.y * 12).toFixed(2)}deg`);
  }, { passive: true });
}

/* ---------- WebGL scene ---------- */

async function startScene() {
  let THREE;
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  } catch {
    return; // offline or blocked: the page keeps its plain navy background
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'scene3d';
  canvas.setAttribute('aria-hidden', 'true');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return; // no WebGL
  }
  document.body.prepend(canvas);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  // The page palette: navy background, indigo and pink accents
  const BG = 0x07090f;
  const INDIGO = new THREE.Color(0x8f95ff);
  const PINK = new THREE.Color(0xf472b6);
  const PALE = new THREE.Color(0xdfe2ff);

  const FOV = 50;
  const CAM_Z = 12;
  const TRAVEL = 34; // how far the camera sinks, in scene units, from the top of the page to the bottom
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const halfHeightAt = (z) => (CAM_Z - z) * tanHalf;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(BG, 0.022);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  camera.position.z = CAM_Z;

  const dot = dotTexture();

  // Stars: the same number in every depth slice, so near and far look equally dense
  const narrow = innerWidth < 700;
  const count = narrow ? 800 : 1800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const z = THREE.MathUtils.randFloat(-45, 7);
    const hh = halfHeightAt(z);
    positions[i * 3] = THREE.MathUtils.randFloatSpread(hh * 2 * 2.6);
    positions[i * 3 + 1] = THREE.MathUtils.randFloat(-TRAVEL - hh * 1.2, hh * 1.2);
    positions[i * 3 + 2] = z;
    const r = Math.random();
    c.copy(r < 0.55 ? PALE : r < 0.82 ? INDIGO : PINK).multiplyScalar(THREE.MathUtils.randFloat(0.4, 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 0.09, map: dot, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(stars);

  // Hero: a glowing core inside a wire shell, with a ringed moon, beside the intro
  const hero = new THREE.Group();
  const heroCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), glowMaterial(INDIGO, PINK, 0.75));
  const heroShell = shape(new THREE.IcosahedronGeometry(2.2, 0), INDIGO, INDIGO, 0.25, 0.4);
  const ringPlane = new THREE.Group();
  ringPlane.rotation.set(1.25, 0.35, 0);
  ringPlane.add(new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.012, 8, 180), new THREE.MeshBasicMaterial({
    color: PINK, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
  })));
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dot, color: PINK, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  moon.scale.setScalar(0.55);
  ringPlane.add(moon);
  hero.add(heroCore, heroShell, ringPlane);
  const heroTilt = new THREE.Group(); // leans toward the pointer, separate from the slow spin
  heroTilt.add(hero);

  // Shapes along the way down. frac: how far down the page (0 top, 1 bottom); side: -1 left, 1 right
  const floaters = [
    { obj: heroTilt, frac: 0, side: 1, ny: 0.42, z: -1, spin: [0.05, 0.09, 0] },
    { obj: new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.28, 140, 16), glowMaterial(PINK, INDIGO, 0.6)),
      frac: 0.2, side: -1, ny: 0.1, z: -5, spin: [0.08, 0.05, 0.02] },
    { obj: shape(new THREE.OctahedronGeometry(1.3), INDIGO, PINK), frac: 0.38, side: 1, ny: -0.1, z: -3, spin: [0.06, 0.1, 0] },
    { obj: shape(new THREE.DodecahedronGeometry(1.2), PINK, INDIGO), frac: 0.56, side: -1, ny: 0, z: -4, spin: [0.04, 0.07, 0.03] },
    { obj: shape(new THREE.BoxGeometry(1.5, 1.5, 1.5), INDIGO, PINK), frac: 0.74, side: 1, ny: 0.05, z: -3, spin: [0.07, 0.05, 0.04] },
    { obj: new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.35, 24, 72), glowMaterial(PINK, INDIGO, 0.6)),
      frac: 0.94, side: -1, ny: 0.2, z: -4, spin: [0.09, 0.03, 0.05] },
  ];
  for (const f of floaters) {
    f.phase = Math.random() * Math.PI * 2;
    f.spinTarget = f.obj === heroTilt ? hero : f.obj;
    scene.add(f.obj);
  }

  // Place the shapes in the empty margins beside the content column (or at the edges on narrow screens)
  function layout() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const contentHalf = Math.min(880, w) / 2;
    const marginMid = (contentHalf + (w / 2 - contentHalf) / 2) / (w / 2); // -1..1 screen x
    const small = w < 760;
    for (const f of floaters) {
      const hh = halfHeightAt(f.z);
      const hw = hh * camera.aspect;
      let nx = f.side * Math.max(marginMid, 0.9);
      let ny = f.ny;
      let scale = small ? 0.6 : 1;
      if (f.obj === heroTilt) {
        nx = small ? 0.55 : Math.max(0.66, marginMid);
        ny = small ? 0.6 : 0.42;
        scale = small ? 0.45 : Math.min(0.8, camera.aspect / 1.8);
      }
      f.obj.scale.setScalar(scale);
      f.obj.position.x = nx * hw;
      f.baseY = -f.frac * TRAVEL + ny * hh;
      f.obj.position.y = f.baseY;
      f.obj.position.z = f.z;
    }
  }

  const scrollProgress = () => {
    const max = root.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  };

  let progress = scrollProgress();
  let cx = 0;
  let cy = 0;
  let last = performance.now();
  let moonAngle = 0;

  function render() {
    renderer.render(scene, camera);
    canvas.classList.add('ready');
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    // Ease the camera after the scroll position and the pointer, so the scene glides
    progress += (scrollProgress() - progress) * Math.min(1, dt * 6);
    cx += (pointer.x - cx) * Math.min(1, dt * 3);
    cy += (pointer.y - cy) * Math.min(1, dt * 3);
    camera.position.set(cx * 0.9, -progress * TRAVEL - cy * 0.5, CAM_Z);

    for (const f of floaters) {
      f.spinTarget.rotation.x += f.spin[0] * dt;
      f.spinTarget.rotation.y += f.spin[1] * dt;
      f.spinTarget.rotation.z += f.spin[2] * dt;
      f.obj.position.y = f.baseY + Math.sin(t * 0.6 + f.phase) * 0.18;
    }
    heroCore.rotation.y -= dt * 0.35;
    heroTilt.rotation.set(cy * 0.35, cx * 0.5, 0);
    moonAngle += dt * 0.7;
    moon.position.set(Math.cos(moonAngle) * 3.1, Math.sin(moonAngle) * 3.1, 0);

    render();
    requestAnimationFrame(frame);
  }

  layout();
  addEventListener('resize', () => {
    layout();
    if (reduceMotion) render();
  });
  if (reduceMotion) {
    moon.position.set(3.1, 0, 0);
    render(); // a still picture, no motion
  } else {
    requestAnimationFrame(frame);
  }

  // Edges of a solid in thin lines, with a faint glowing body inside
  function shape(geo, color, rim, glow = 0.45, lineOpacity = 0.5) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, glowMaterial(color, rim, glow)));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({
      color, transparent: true, opacity: lineOpacity, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    return group;
  }

  // Brighter toward the silhouette, like glass catching light at its edges
  function glowMaterial(inner, rim, strength) {
    return new THREE.ShaderMaterial({
      uniforms: { uInner: { value: inner }, uRim: { value: rim }, uStrength: { value: strength } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uInner;
        uniform vec3 uRim;
        uniform float uStrength;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
          gl_FragColor = vec4(mix(uInner, uRim, f), (0.06 + 0.7 * f) * uStrength);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  // A soft round dot, for stars and the moon
  function dotTexture() {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
