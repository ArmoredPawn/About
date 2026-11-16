// Home page only: a globe beside the intro, turning slowly and lit like a desk globe (matte, no glow).
// Drag it sideways to spin it, up and down to tilt it. The pink pin is Pittsburgh, home.
// The land is Natural Earth's, on a 1-degree grid: rows from 90°N, columns from 180°W, stored as alternating runs
// of sea and land in base 36.
(function () {
  var canvas = document.querySelector('.home .globe canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var LAND = '1rz,8,8j,k,f,2,1,m,84,n,1,1,4,14,1,1,2,5,1x,1,5q,7,9,b,2,1e,1r,1,1,2,9,2,v,5,4n,n,8,1a,u,2,1,1,1,3,1,6,1v,7,43,4,4,5,2,3,2,4,2,b,4,1f,w,3,1,4,1,2,26,5,3u,1,3,3,4,1,9,3,2,1,2,2,2,2,1,3,8,1,3,19,z,4,3,1,1,1,27,3,3p,2,1,1,7,1,4,2,2,3,2,5,1,1,1,1,1,7,a,1b,2f,4,x,b,3n,a,6,6,2,5,1,6,m,13,25,5,r,o,n,5,1,2,1,1,2j,1,7,2,e,1,9,1,v,11,23,3,s,o,1,1,3f,9,8,2,3,4,2,5,3,2,2,7,l,v,1,3,23,3,i,2,4,q,3,3,1,5,4,3,1,1,c,3,2k,6,1,9,1,3,3,6,1,1,4,4,1,4,3,3,k,u,1,2,23,2,e,4,2,1,1,1,3,1c,c,5,y,2,1i,3,3,2,1,b,5,1,3,2,3,g,1,1,h,1,1,q,1,3,24,3,c,4,1,2,2,6,1,19,3,1,2,4,1,b,1d,8,2,1,11,9,7,4,3,l,e,2,1,m,1,1,3,1,1a,2,1,5,10,6,1,9,1,24,11,o,6,1,1,5,1,1,1,2,4,e,5,1,1,1,1,3,6,2,4,1,1,9,e,2,1,r,15,1,1,d,s,4,4,5,1,2m,3,7,2,2,c,1g,1,1,4,4,7,1,2,3,1,2,2,4,8,7,e,p,17,1,1,l,6,2,7,1,1,4,1,8,1,8,1,2z,b,1j,1,c,1,7,1,6,4,2,3,8,a,l,1d,p,3,1,3,o,2,37,6,1,4,21,2,2,9,c,8,j,1c,k,2,6,3,q,2,31,3,4,4,27,1,1,1,1,b,7,2,2,a,d,g,1,1,8,q,a,3,a,5,3w,6,2,b,21,2,4,4,2,3,8,e,b,i,8,p,a,3,b,2,3w,b,2,9,1y,5,2,d,2,1,3,e,a,l,2,q,2,1,9,2,4d,g,20,9,2,4,1,8,2,2,1,e,8,1c,c,3,3y,2,c,1,1,f,20,g,6,n,7,1b,c,5,3r,3,2,2,9,m,d,1,3,2,1f,h,8,o,2,16,1,6,d,4,4,1,1,1,3i,7,6,1,2,r,8,e,19,h,8,5,1,1x,5,1,7,7,2,1,3d,1,1,1,3,5,3,14,3,1,1,f,18,f,a,1,4,1m,2,9,3,2,6,5,1,1,39,i,3,15,1,1,3,g,17,g,f,1j,5,e,5,1,1,3,1,1,38,h,6,11,2,o,1,1,18,b,f,1l,2,b,3,2,4,4,39,i,7,1r,1,1,1a,9,h,1j,3,a,4,1,1,7,37,k,6,x,1,y,1c,2,m,1e,3,1,3,a,1,3,1,2,3,1,39,j,5,1u,1,2,1c,3,n,1a,4,3,3,7,1,1,3o,f,4,1w,1,3,1a,3,n,1a,4,2,6,3,3s,1,1,d,2,22,1z,1,1,1f,5,3,3t,1,1,d,2,22,1,2,1t,3,1,1f,1,6,3u,2,2,2h,2,1,1l,3,2,4,2,1,1,1g,1,1,3w,2,2,2k,1j,1,4,6,5,1c,41,2,1,2l,1,1,1l,9,1,1,1,1f,3x,3,1,2l,1n,1,1,2,1,1m,x,1,4,2,b,4,2d,5,1,2k,1r,1o,e,1,g,3,2,3,a,5,2c,2r,1k,2,2,1r,d,3,e,9,9,3,2e,6,1,2l,1i,1q,3,3,9,3,4,3,c,b,8,3,2c,6,4,2j,1h,1q,c,6,1,1,3,4,a,e,6,5,26,b,1,2l,1h,1q,b,b,3,3,9,4,4,5,8,5,24,2y,1e,1t,a,7,2,5,3,1,5,5,l,3,1w,1,7,b,2,2m,1e,1t,9,2,1,5,2,6,1,3,3,4,m,4,1u,2,2,2,3,c,2,2n,1c,1a,1,j,9,g,1,4,3,2,n,5,1s,7,3,c,2,2o,1a,1v,8,e,2,7,1,4,m,5,1t,1,2,5,2,a,2,2p,1a,1y,1,6,a,i,2,1,2,2,2d,6,2,7,5,2q,19,1y,1,4,c,p,2c,6,3,5,6,2r,18,1y,h,q,2c,6,1,4,3,1,2,2x,13,1z,j,o,2e,5,1,3,4,31,10,20,o,5,3,c,2e,a,1,33,2,1,x,1z,q,4,7,7,2f,9,1,35,1,2,w,1z,t,1,2t,3g,2,1,h,4,1,7,2,1z,16,1,f,3,1z,3g,1,1,f,e,2,1y,1n,3,1z,3f,3,1,e,e,3,1v,1b,2,d,4,1w,3i,2,2,c,f,2,1u,1c,2,e,7,1r,3k,1,2,c,g,1,1t,1e,2,d,9,7,1,1h,3k,1,3,a,2b,1e,2,e,4,2,a,1f,3,1,3k,1,2,9,2a,1g,3,k,9,1d,3,1,3p,8,e,1,1,4,1q,1g,3,l,a,18,6,1,3q,7,9,1,9,2,1o,1i,2,k,b,2,1,e,5,g,2,1,3z,9,7,3,a,2,1n,1h,3,j,e,e,6,e,3,1,2l,1,1e,9,5,4,e,3,1i,1h,4,h,f,c,9,c,3,2,41,9,2,1,1,3,e,6,1g,1i,3,g,g,b,a,c,3,1,45,d,20,1j,3,d,i,a,c,c,d,2,3v,b,20,1j,4,a,k,9,c,2,2,a,c,2,41,9,1v,1l,3,9,m,6,i,b,b,1,43,9,1u,1m,2,6,p,6,i,b,b,2,45,5,1v,1n,1,4,s,5,i,2,1,8,b,1,1,2,45,3,1v,1o,a,1,l,5,j,1,2,7,f,1,45,2,b,1,2,1,1i,1m,7,1,p,4,j,1,3,6,d,1,1,2,44,3,7,4,1,5,2,1,1c,1n,1,6,p,4,i,1,5,3,c,1,4c,2,2,1,3,4,1,a,1b,1t,p,3,1,1,h,1,6,1,c,1,6,1,46,4,2,i,1b,1r,r,1,2,1,h,2,n,3,49,1,2,j,1b,1q,u,2,h,1,o,3,4c,j,1b,e,1,19,v,2,i,2,e,2,6,2,4d,o,17,a,5,18,1a,1,4,3,c,4,4k,p,18,1,d,1,2,13,1c,2,3,2,b,5,4k,q,1p,11,1e,2,2,2,a,4,4l,r,1p,10,1g,2,2,2,7,7,a,1,48,t,1o,y,1j,3,1,1,5,9,a,1,47,t,1o,y,1k,4,6,9,3,3,4,1,47,w,1l,x,1m,3,1,1,4,9,9,1,2,1,1,1,42,s,1,3,1,3,1i,x,1n,3,6,7,2,3,5,1,4,2,41,v,1,4,1j,v,1o,6,3,7,2,3,e,5,3u,16,1e,t,1q,4,9,1,3,1,1,1,4,1,3,1,2,b,3r,17,1e,r,1s,3,u,9,3q,1a,1b,r,1t,2,d,1,e,1,3,8,2,1,1,2,3k,19,1b,r,1v,3,p,1,4,9,7,1,3g,19,1c,q,1w,6,i,1,6,9,3q,18,1c,q,24,6,1,2,2,1,d,3,3,2,3q,16,1d,r,27,1,4,1,m,2,1,1,3n,16,1e,q,32,1,3o,14,1f,q,2i,1,1,1,9,1,a,1,3l,13,1f,s,8,1,29,6,5,1,18,1,2o,11,1g,s,7,2,28,6,6,2,3w,11,1f,t,7,2,24,2,2,6,6,3,3w,10,1f,t,5,4,22,c,5,4,3y,y,1f,s,4,6,21,f,1,1,1,4,m,1,b,1,u,1,26,w,1f,q,6,5,21,i,1,5,40,u,1g,p,7,5,21,o,40,u,1h,m,9,5,20,r,3y,u,1h,m,9,5,8,1,1o,v,f,1,3h,t,1j,l,8,5,1v,y,g,1,3g,s,1k,m,7,5,1u,10,3w,p,1n,l,9,4,1u,11,3u,o,1q,k,9,3,1u,13,3t,m,1s,i,c,1,1w,13,3s,m,1s,i,28,14,3s,n,1r,i,29,14,3r,m,1t,g,2b,13,3r,l,1v,e,2c,12,3r,m,1v,e,2c,12,3r,k,1y,c,2e,11,3s,j,1y,b,2f,a,8,i,3s,d,1,5,1z,9,2h,8,b,2,1,d,3t,e,1,3,21,1,2o,3,g,1,1,e,3s,g,5f,c,n,1,35,g,5h,a,o,1,33,h,5h,a,p,1,32,g,5l,1,1,2,s,3,31,b,6k,3,31,c,6l,2,31,9,5u,3,o,2,1,1,33,9,5t,3,n,3,35,8,5v,1,n,3,36,8,6h,3,36,8,6i,4,36,8,6j,2,38,8,9q,1,1,7,9s,7,3t,1,5z,6,9v,5,9,2,9k,5,9v,1,1,1,2,1,9w,1,1,4,t,1,2he,1,9t,1,2,1,9w,2,4i,1,5d,2,36,7,17,7,4,4,a,2,3,8,o,1,3k,3,34,1,2,c,m,1p,45,2,1,1,2w,t,9,20,3s,3,1,6,2o,2,5,t,7,2c,3l,2,1,6,1x,3,2,7,2,1,7,14,4,2g,1,1,3g,5,1,5,1e,3,1,7,1,1w,3,2s,2i,3,n,4,2,6,1d,27,2,2s,1s,1,q,f,4,2,1,1,2,1,1,c,19,53,1p,1,3,1,8,6,1,2,a,13,17,51,1,1,1i,25,17,1,1,51,1f,25,15,5c,13,7,3,22,14,5i,2,3,z,20,2,5,9,1,h,6,8,5n,u,4,8,23,4,2,k,7,d,5a,1e,22,a,6,6,7,e,5e,10,2,6,2i,n,5n,1a,2i,7,65,q,7,1,1,1,96,9,7,9,1nk';
  var STEP = 1;
  var COLS = 360 / STEP;
  var RAD = Math.PI / 180;
  var HOME = { lat: 40.44, lon: -79.99 };
  // The light comes from the upper left, a little in front
  var LX = -0.45, LY = 0.55, LZ = 0.7;
  var LL = Math.hypot(LX, LY, LZ);
  LX /= LL; LY /= LL; LZ /= LL;
  var SHADES = 14;
  var DARK = [44, 48, 96];
  var LIT = [170, 176, 255];

  function unit(lat, lon) {
    var p = lat * RAD, l = lon * RAD;
    return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
  }

  // Land as patches of at most six cells along a row, each an outline of points on the sphere plus its middle
  var patches = [];
  (function build() {
    var runs = LAND.split(',');
    var i = 0, land = false;
    var cells = [];
    for (var k = 0; k < runs.length; k++) {
      var n = parseInt(runs[k], 36);
      if (land) for (var j = 0; j < n; j++) cells.push(i + j);
      i += n;
      land = !land;
    }
    // Group neighbouring cells of a row
    var a = 0;
    while (a < cells.length) {
      var b = a;
      var row = Math.floor(cells[a] / COLS);
      while (b + 1 < cells.length && cells[b + 1] === cells[b] + 1 && Math.floor(cells[b + 1] / COLS) === row && b + 1 - a < 6) b++;
      var c0 = cells[a] % COLS, c1 = (cells[b] % COLS) + 1;
      var lat0 = 90 - row * STEP, lat1 = lat0 - STEP;
      var lon0 = -180 + c0 * STEP, lon1 = -180 + c1 * STEP;
      var pts = [];
      for (var c = 0; c <= c1 - c0; c++) pts.push(unit(lat0, lon0 + c * STEP));
      for (var d = c1 - c0; d >= 0; d--) pts.push(unit(lat1, lon0 + d * STEP));
      patches.push({ pts: pts, mid: unit((lat0 + lat1) / 2, (lon0 + lon1) / 2) });
      a = b + 1;
    }
  })();
  var home = unit(HOME.lat, HOME.lon);

  // Turned so that home starts just left of the middle, tipped toward us a little to show the north
  var spin = 80 * RAD - 0.6;
  var tilt = 18 * RAD;
  var cs, sn, ct, st;
  function setAngles() { cs = Math.cos(spin); sn = Math.sin(spin); ct = Math.cos(tilt); st = Math.sin(tilt); }
  // Turn a point on the sphere into view space: x right, y up, z toward the viewer
  function view(p, out) {
    var x = p[0] * cs + p[2] * sn;
    var z = -p[0] * sn + p[2] * cs;
    out[0] = x;
    out[1] = p[1] * ct - z * st;
    out[2] = p[1] * st + z * ct;
    return out;
  }

  var size = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    size = canvas.clientWidth;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    draw();
  }

  var q = [0, 0, 0];
  var paths = [];
  function draw() {
    if (!size) return;
    setAngles();
    var r = size / 2 - 2;
    var cx = size / 2, cy = size / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // The sea: a ball, lighter where the light falls on it
    var sea = ctx.createRadialGradient(cx + LX * r * 0.55, cy - LY * r * 0.55, r * 0.05, cx, cy, r);
    sea.addColorStop(0, '#1c2438');
    sea.addColorStop(0.65, '#121828');
    sea.addColorStop(1, '#0a0d16');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = sea;
    ctx.fill();

    // The land, in bands of light: one path per shade
    for (var s = 0; s < SHADES; s++) paths[s] = null;
    for (var i = 0; i < patches.length; i++) {
      var p = patches[i];
      view(p.mid, q);
      if (q[2] < -0.12) continue;
      var lambert = Math.max(0, q[0] * LX + q[1] * LY + q[2] * LZ);
      var level = Math.min(SHADES - 1, Math.floor((0.2 + 0.8 * lambert) * SHADES));
      var path = paths[level] || (paths[level] = new Path2D());
      for (var k = 0; k < p.pts.length; k++) {
        view(p.pts[k], q);
        var x = q[0], y = q[1];
        // A corner just round the back is pinned to the edge of the ball
        if (q[2] < 0) { var m = Math.hypot(x, y) || 1; x /= m; y /= m; }
        if (k) path.lineTo(cx + x * r, cy - y * r);
        else path.moveTo(cx + x * r, cy - y * r);
      }
      path.closePath();
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.8;
    for (var t = 0; t < SHADES; t++) {
      if (!paths[t]) continue;
      var f = t / (SHADES - 1);
      var col = 'rgb(' + Math.round(DARK[0] + (LIT[0] - DARK[0]) * f) + ' ' + Math.round(DARK[1] + (LIT[1] - DARK[1]) * f) + ' ' + Math.round(DARK[2] + (LIT[2] - DARK[2]) * f) + ')';
      ctx.fillStyle = col;
      ctx.strokeStyle = col; // closes the hairline seams between patches
      ctx.fill(paths[t]);
      ctx.stroke(paths[t]);
    }

    // Shade the far side of the ball, so it reads as round
    var night = ctx.createRadialGradient(cx + LX * r * 0.5, cy - LY * r * 0.5, r * 0.75, cx, cy, r * 1.02);
    night.addColorStop(0, 'rgb(5 7 12 / 0)');
    night.addColorStop(1, 'rgb(5 7 12 / 0.4)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = night;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgb(143 149 255 / 0.18)';
    ctx.stroke();

    // Home
    view(home, q);
    if (q[2] > 0.05) {
      var hx = cx + q[0] * r, hy = cy - q[1] * r;
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(3, size / 60), 0, Math.PI * 2);
      ctx.fillStyle = '#f472b6';
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#07090f';
      ctx.fill();
      ctx.stroke();
    }
  }

  /* ---------- Motion ---------- */

  var still = window.matchMedia('(prefers-reduced-motion: reduce)');
  var BASE = 0.12; // radians a second: a turn about every 50 seconds
  var speed = BASE;
  var dragging = null;
  var visible = true;
  var raf = 0, last = 0;

  function frame(now) {
    raf = 0;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (!dragging) {
      // A flick slows back to the steady turn (or to a stop when motion is reduced)
      var target = still.matches ? 0 : BASE;
      speed += (target - speed) * Math.min(1, dt * 1.5);
      spin += speed * dt;
    }
    draw();
    if (running()) raf = requestAnimationFrame(frame);
  }
  function running() {
    return visible && !document.hidden && (dragging || Math.abs(speed - (still.matches ? 0 : BASE)) > 0.002 || !still.matches);
  }
  function start() {
    if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); }
  }

  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    dragging = { x: e.clientX, y: e.clientY, t: performance.now() };
    speed = 0;
    start();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var r = size / 2;
    var dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    var now = performance.now();
    var dt = Math.max(1, now - dragging.t) / 1000;
    spin += dx / r;
    tilt = Math.max(-10 * RAD, Math.min(50 * RAD, tilt + dy / r));
    speed = speed * 0.5 + (dx / r / dt) * 0.5;
    dragging = { x: e.clientX, y: e.clientY, t: now };
    if (!raf) draw();
  });
  function release() {
    if (!dragging) return;
    dragging = null;
    speed = Math.max(-6, Math.min(6, speed));
    start();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[entries.length - 1].isIntersecting;
      start();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', start);
  if (still.addEventListener) still.addEventListener('change', start);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  resize();
  start();
})();
