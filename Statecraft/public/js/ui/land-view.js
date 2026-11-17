// The ground as the map draws it: who holds each 50 km cell (the province's controller, unless an army has taken
// it), the occupied ground as shapes to fill, and the front lines between countries at war as smooth curves.
// Worked out again only when the ground changes hands (the state's occRev) or a war starts or ends.

import { REG, GW, GH, CELL, isLand } from '../engine/land.js';

export class LandView {
  constructor() {
    this.rev = null;
    this.occ = new Map();
    this.geomKey = null;
    this.geom = null;
  }

  // Take in the occupied cells from an update ([first cell, length, holder] runs)
  sync(s) {
    if (!s.occ || s.occRev === this.rev) return;
    this.rev = s.occRev;
    this.occ = new Map();
    for (const [i, n, h] of s.occ) for (let k = 0; k < n; k++) this.occ.set(i + k, h);
    this.geomKey = null;
  }

  holder(s, i) {
    return this.occ.get(i) ?? s.regions[REG[i]]?.[1] ?? null;
  }

  // The occupied cells as an object, for running the engine's own path-finding in the browser
  occObject() {
    return Object.fromEntries(this.occ);
  }

  // { fills: Map holder -> path data of the cells it occupies, regions: provinces with occupied ground,
  //   fronts: [[x, y]...] smoothed lines where countries at war meet }
  geometry(s) {
    const wars = new Set(s.wars.flatMap((w) => [`${w.a}|${w.b}`, `${w.b}|${w.a}`]));
    const key = `${this.rev}|${[...wars].join(',')}|${s.regions.map((r) => r[1]).join(',')}`;
    if (key === this.geomKey) return this.geom;
    this.geomKey = key;
    // Occupied ground: one rectangle per run of cells along a row
    const fills = new Map();
    const regions = new Set();
    const rows = new Map();
    for (const [i, h] of this.occ) {
      regions.add(REG[i]);
      const list = rows.get(h) ?? rows.set(h, []).get(h);
      list.push(i);
    }
    for (const [h, cells] of rows) {
      cells.sort((a, b) => a - b);
      let d = '';
      let start = cells[0];
      let prev = cells[0];
      const flush = () => {
        const gy = Math.floor(start / GW);
        const gx = start % GW;
        const len = prev - start + 1;
        d += `M${gx * CELL} ${gy * CELL}h${len * CELL}v${CELL}h${-len * CELL}z`;
      };
      for (let k = 1; k < cells.length; k++) {
        const i = cells[k];
        if (i === prev + 1 && Math.floor(i / GW) === Math.floor(prev / GW)) { prev = i; continue; }
        flush();
        start = prev = i;
      }
      flush();
      fills.set(h, d);
    }
    // Fronts: every edge between two cells held by countries at war with each other
    const segs = [];
    const hostile = (a, b) => a && b && a !== b && wars.has(`${a}|${b}`);
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const i = gy * GW + gx;
        if (!isLand(i)) continue;
        const h = this.holder(s, i);
        if (gx + 1 < GW && isLand(i + 1) && hostile(h, this.holder(s, i + 1))) segs.push([(gx + 1) * CELL, gy * CELL, (gx + 1) * CELL, (gy + 1) * CELL]);
        if (gy + 1 < GH && isLand(i + GW) && hostile(h, this.holder(s, i + GW))) segs.push([gx * CELL, (gy + 1) * CELL, (gx + 1) * CELL, (gy + 1) * CELL]);
      }
    }
    this.geom = { fills, regions, fronts: chain(segs).map((line) => smooth(line, 3)) };
    return this.geom;
  }
}

// Joins edge segments end to end into lines
function chain(segs) {
  const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const at = new Map();
  segs.forEach((sg, n) => {
    for (const k of [key(sg[0], sg[1]), key(sg[2], sg[3])]) (at.get(k) ?? at.set(k, []).get(k)).push(n);
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  const walk = (line, x, y) => {
    for (;;) {
      const next = (at.get(key(x, y)) ?? []).find((n) => !used[n]);
      if (next == null) return;
      used[next] = 1;
      const sg = segs[next];
      const forward = key(sg[0], sg[1]) === key(x, y);
      [x, y] = forward ? [sg[2], sg[3]] : [sg[0], sg[1]];
      line.push([x, y]);
    }
  };
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const sg = segs[n];
    const line = [[sg[0], sg[1]], [sg[2], sg[3]]];
    walk(line, sg[2], sg[3]);
    const back = [[sg[0], sg[1]]];
    walk(back, sg[0], sg[1]);
    lines.push([...back.slice(1).reverse(), ...line]);
  }
  return lines;
}

// Rounds the staircase of cell edges into a natural line (Chaikin's corner cutting)
function smooth(line, rounds) {
  let pts = line;
  for (let r = 0; r < rounds; r++) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
