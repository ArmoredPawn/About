// The sea's swell: a few Gerstner waves, summed. The same numbers drive the water shader (the surface you see) and
// the boats' buoyancy (how they ride it), so a boat sits on the wave it looks like it sits on.

const G = 9.81;

// Each wave: direction (degrees), wavelength (m), amplitude (m), steepness (0 to 1)
const SETS = {
  calm: [[20, 62, 0.55, 0.35], [70, 34, 0.32, 0.3], [-35, 21, 0.18, 0.28], [140, 13, 0.08, 0.25], [-80, 9, 0.05, 0.22], [35, 6.5, 0.03, 0.2]],
  choppy: [[10, 70, 0.95, 0.4], [55, 38, 0.55, 0.36], [-40, 24, 0.3, 0.32], [120, 14, 0.14, 0.3], [-95, 9.5, 0.08, 0.26], [25, 6, 0.045, 0.22]],
  rough: [[0, 90, 1.5, 0.42], [40, 48, 0.85, 0.38], [-50, 28, 0.45, 0.34], [100, 16, 0.2, 0.3], [-110, 10, 0.1, 0.27], [60, 6.8, 0.05, 0.22]],
};

export function waveSet(name) {
  return (SETS[name] ?? SETS.calm).map(([deg, L, A, Q], i) => {
    const r = (deg * Math.PI) / 180;
    const k = (2 * Math.PI) / L;
    return { dx: Math.sin(r), dz: Math.cos(r), k, A, Q, w: Math.sqrt(G * k), phase: i * 1.7 };
  });
}

// Height of the sea at a point (the horizontal shift of a Gerstner wave is small at these steepnesses, so the
// height under a point is taken as the height of the wave there)
export function heightAt(waves, x, z, t) {
  let y = 0;
  for (const v of waves) y += v.A * Math.sin(v.k * (v.dx * x + v.dz * z) - v.w * t + v.phase);
  return y;
}

// The slope of the sea at a point: { sx: dy/dx, sz: dy/dz }
export function slopeAt(waves, x, z, t) {
  let sx = 0;
  let sz = 0;
  for (const v of waves) {
    const c = v.A * v.k * Math.cos(v.k * (v.dx * x + v.dz * z) - v.w * t + v.phase);
    sx += c * v.dx;
    sz += c * v.dz;
  }
  return { sx, sz };
}

// The numbers the shader needs, packed: per wave [dx, dz, k, A] and [Q, w, phase, 0]
export function shaderWaves(waves) {
  return { a: waves.map((v) => [v.dx, v.dz, v.k, v.A]), b: waves.map((v) => [v.Q, v.w, v.phase, 0]) };
}
