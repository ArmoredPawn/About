// The sea. A grid dense near the camera and sparse toward the horizon follows the camera around (snapped to its own
// spacing, so the waves don't shimmer). Its vertices ride the same Gerstner waves the boats float on; the surface
// is a physically based material, so it reflects the sky and the sun the way water does (dark looking straight
// down, mirror-bright at a glancing angle), with two layers of ripples scrolling across it and foam on the crests.

import * as THREE from 'three';
import { shaderWaves } from '../sim/waves.js';

const STEP = 3.5; // metres between vertices near the camera

// Grid coordinates along one axis: evenly spaced near the middle, stretching out to the horizon
function axis() {
  const near = [];
  for (let i = 0; i <= 110; i++) near.push(i * STEP);
  let x = near[near.length - 1];
  let d = STEP;
  while (x < 16000) { d *= 1.09; x += d; near.push(x); }
  return [...near.slice(1).reverse().map((v) => -v), ...near];
}

function grid() {
  const xs = axis();
  const n = xs.length;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (j * n + i) * 3;
    pos[k] = xs[i]; pos[k + 1] = 0; pos[k + 2] = xs[j];
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i;
    const b = a + 1;
    const c = a + n;
    const d = c + 1;
    idx.set([a, c, b, b, c, d], t);
    t += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * n * 2), 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30000);
  return g;
}

// A tiling ripple normal map, made here: many small waves in random directions, each a whole number of times
// across the tile so it repeats without a seam
function rippleTexture(size = 256) {
  const waves = [];
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 28; i++) {
    const m = Math.round((r() - 0.5) * 2 * (3 + i * 0.9));
    const n = Math.round((r() - 0.5) * 2 * (3 + i * 0.9));
    if (!m && !n) continue;
    waves.push({ m, n, a: 1 / Math.pow(Math.hypot(m, n), 1.15), p: r() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size;
    const v = y / size;
    let gx = 0;
    let gy = 0;
    for (const w of waves) {
      const c = Math.cos(2 * Math.PI * (w.m * u + w.n * v) + w.p) * w.a * 2 * Math.PI;
      gx += c * w.m;
      gy += c * w.n;
    }
    const s = 0.045;
    const nx = -gx * s;
    const ny = -gy * s;
    const l = Math.hypot(nx, ny, 1);
    const k = (y * size + x) * 4;
    data[k] = ((nx / l) * 0.5 + 0.5) * 255;
    data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeOcean(waves, def) {
  const pack = shaderWaves(waves);
  const uniforms = {
    uTime: { value: 0 },
    uWa: { value: pack.a.map((v) => new THREE.Vector4(...v)) },
    uWb: { value: pack.b.map((v) => new THREE.Vector4(...v)) },
    uScatter: { value: new THREE.Color(def.water.shallow).multiplyScalar(0.18) },
    uScroll: { value: new THREE.Vector4() },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(def.water.deep), roughness: 0.07, metalness: 0, ior: 1.333, specularIntensity: 1,
    normalMap: rippleTexture(), normalScale: new THREE.Vector2(0.38, 0.38), envMapIntensity: 1.05,
  });
  const N = pack.a.length;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec4 uWa[${N}];
uniform vec4 uWb[${N}];
varying float vFoam;
varying float vCrest;
vec3 gPos;
vec3 gWorld;`)
      .replace('#include <beginnormal_vertex>', `
vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
float fade = 1.0 - smoothstep(500.0, 1700.0, length(wp0.xz - cameraPosition.xz));
vec3 disp = vec3(0.0);
float nx = 0.0; float ny = 1.0; float nz = 0.0; float amp = 0.0;
for (int i = 0; i < ${N}; i++) {
  vec4 a = uWa[i]; vec4 b = uWb[i];
  float A = a.w * fade;
  float th = a.z * dot(a.xy, wp0.xz) - b.y * uTime + b.z;
  float s = sin(th); float c = cos(th);
  disp.x += b.x * A * a.x * c;
  disp.z += b.x * A * a.y * c;
  disp.y += A * s;
  nx -= a.x * a.z * A * c;
  nz -= a.y * a.z * A * c;
  ny -= b.x * a.z * A * s;
  amp += a.w;
}
gPos = position + disp;
gWorld = wp0 + disp;
vCrest = clamp(disp.y / max(0.001, amp) * 0.5 + 0.5, 0.0, 1.0);
vFoam = smoothstep(0.86, 0.6, ny) * fade + smoothstep(0.72, 0.95, vCrest) * 0.35 * fade;
vec3 objectNormal = normalize(vec3(nx, ny, nz));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vNormalMapUv = gWorld.xz * 0.045;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uScatter;
uniform vec4 uScroll;
varying float vFoam;
varying float vCrest;`)
      .replace('#include <normal_fragment_maps>', `
vec3 n1 = texture2D(normalMap, vNormalMapUv + uScroll.xy).xyz * 2.0 - 1.0;
vec3 n2 = texture2D(normalMap, vNormalMapUv * 2.3 + uScroll.zw).xyz * 2.0 - 1.0;
vec3 mapN = normalize(vec3(n1.xy + n2.xy * 0.6, n1.z * n2.z));
mapN.xy *= normalScale * (1.0 - vFoam * 0.6);
normal = normalize(tbn * mapN);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.92, 0.95), clamp(vFoam, 0.0, 1.0) * 0.75);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.7, clamp(vFoam, 0.0, 1.0));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse += uScatter * (0.25 + 0.9 * vCrest);`);
  };
  const mesh = new THREE.Mesh(grid(), mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(t, camera) {
      uniforms.uTime.value = t;
      uniforms.uScroll.value.set(t * 0.012, t * 0.007, -t * 0.009, t * 0.013);
      mesh.position.set(Math.round(camera.position.x / STEP) * STEP, 0, Math.round(camera.position.z / STEP) * STEP);
    },
  };
}
