// Reactive monochrome backgrounds on a fixed full-screen canvas behind the page.
// Styles: none | dots | grid | constellation | water | grass | smoke | soccer | boids | filings
(function (global) {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let style = 'none', raf = 0, W = 0, H = 0, dpr = 1, frameNo = 0;
  const mouse = { x: -9999, y: -9999, active: false };
  const eased = { x: -9999, y: -9999 };
  const prev = { x: -9999, y: -9999 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let state = {};

  function ink() { return getComputedStyle(document.body).color || '#000'; }
  function paper() { return getComputedStyle(document.body).backgroundColor || '#fff'; }
  function isDark() { const m = paper().match(/\d+/g); return m && (+m[0] + +m[1] + +m[2]) / 3 < 128; }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (INIT[style]) INIT[style]();
  }
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
  addEventListener('pointerleave', () => { mouse.active = false; });
  addEventListener('pointerdown', (e) => { if (style === 'water') drop(e.clientX, e.clientY, 2.5); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  /* ================= dots ================= */
  function drawDots() {
    const gap = 26, R = 170;
    ctx.fillStyle = ink();
    for (let y = gap / 2; y < H + gap; y += gap) for (let x = gap / 2; x < W + gap; x += gap) {
      const dx = x - eased.x, dy = y - eased.y, d = Math.hypot(dx, dy);
      const k = Math.max(0, 1 - d / R), push = k * k * 18;
      const px = d ? x + (dx / d) * push : x, py = d ? y + (dy / d) * push : y;
      ctx.globalAlpha = 0.10 + k * 0.6;
      ctx.beginPath(); ctx.arc(px, py, 1 + k * 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= grid ================= */
  function drawGrid() {
    const gap = 44, R = 220;
    ctx.strokeStyle = ink(); ctx.lineWidth = 1; ctx.globalAlpha = 0.16;
    const warp = (x, y) => {
      const dx = x - eased.x, dy = y - eased.y, d = Math.hypot(dx, dy);
      const s = Math.sin(Math.max(0, 1 - d / R) * Math.PI) * 34;
      return d ? [x + (dx / d) * s, y + (dy / d) * s] : [x, y];
    };
    for (let x = 0; x <= W + gap; x += gap) { ctx.beginPath(); for (let y = 0; y <= H + gap; y += 8) { const [px, py] = warp(x, y); y === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
    for (let y = 0; y <= H + gap; y += gap) { ctx.beginPath(); for (let x = 0; x <= W + gap; x += 8) { const [px, py] = warp(x, y); x === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  /* ================= constellation ================= */
  function initConstellation() {
    const n = Math.round((W * H) / 14000);
    state.p = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3 }));
  }
  function drawConstellation() {
    const P = state.p, R = 200, link = 110;
    ctx.fillStyle = ink(); ctx.strokeStyle = ink(); ctx.lineWidth = 1;
    for (const p of P) {
      const dx = p.x - eased.x, dy = p.y - eased.y, d = Math.hypot(dx, dy) || 1;
      if (mouse.active && d < R) { const f = (1 - d / R) * 0.25; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      p.vx *= 0.98; p.vy *= 0.98; p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x += W; if (p.x > W) p.x -= W; if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
    }
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      for (let j = i + 1; j < P.length; j++) { const b = P[j], d = Math.hypot(a.x - b.x, a.y - b.y); if (d < link) { ctx.globalAlpha = (1 - d / link) * 0.25; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
      const dm = Math.hypot(a.x - eased.x, a.y - eased.y);
      if (dm < R) { ctx.globalAlpha = (1 - dm / R) * 0.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(eased.x, eased.y); ctx.stroke(); }
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(a.x, a.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= water (top view, calm, rasterized) ================= */
  const WCELL = 12;
  function initWater() {
    const cols = Math.ceil(W / WCELL) + 1, rows = Math.ceil(H / WCELL) + 1;
    state.cols = cols; state.rows = rows;
    state.a = new Float32Array(cols * rows); state.b = new Float32Array(cols * rows);
  }
  function drop(x, y, strength) {
    if (!state.a) return;
    const c = Math.round(x / WCELL), r = Math.round(y / WCELL);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cc = c + dx, rr = r + dy, dd = Math.hypot(dx, dy);
      if (dd <= 2 && cc > 0 && rr > 0 && cc < state.cols - 1 && rr < state.rows - 1) state.a[rr * state.cols + cc] += strength * (1 - dd / 2.6);
    }
  }
  function drawWater() {
    const { cols, rows } = state; let { a, b } = state;
    // Gentle: a soft, small drop every few frames while the cursor moves.
    const moved = Math.hypot(mouse.x - prev.x, mouse.y - prev.y);
    if (mouse.active && moved > 2 && frameNo % 3 === 0) drop(mouse.x, mouse.y, Math.min(0.9, 0.25 + moved * 0.03));
    // Slow wave speed + strong damping = calm surface.
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const lap = a[i - 1] + a[i + 1] + a[i - cols] + a[i + cols] - 4 * a[i];
      b[i] = (2 * a[i] - b[i] + 0.16 * lap) * 0.984;
    }
    state.a = b; state.b = a; a = state.a;
    ctx.fillStyle = ink();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = Math.min(1, Math.abs(a[r * cols + c]) / 1.6);
      if (v < 0.04) continue;
      const q = Math.ceil(v * 4) / 4;
      ctx.globalAlpha = 0.06 + q * 0.42;
      const s = WCELL * (0.3 + q * 0.7);
      ctx.fillRect(c * WCELL - s / 2, r * WCELL - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  /* ================= grass ================= */
  function initGrass() {
    const gap = 19;
    state.g = [];
    for (let y = gap; y < H + gap; y += gap) for (let x = Math.random() * gap; x < W + gap; x += gap) {
      const depth = y / H;   // lower rows read as closer: longer, heavier, darker
      state.g.push({ x, y, len: 22 + depth * 30 + Math.random() * 14, phase: Math.random() * Math.PI * 2, lean: (Math.random() - 0.5) * 0.35, bend: 0, vel: 0, w: 0.9 + depth * 1.0, a: 0.10 + depth * 0.22 });
    }
  }
  function drawGrass() {
    const t = frameNo / 60, R = 150;
    ctx.strokeStyle = ink(); ctx.lineCap = 'round';
    const mvx = mouse.x - prev.x;
    for (const g of state.g) {
      // wind: a slow travelling wave across the field
      const wind = Math.sin(t * 1.3 + g.x * 0.01 + g.phase) * 0.22 + Math.sin(t * 0.4 + g.y * 0.006) * 0.12;
      let target = g.lean + wind;
      const dx = g.x - eased.x, dy = g.y - eased.y, d = Math.hypot(dx, dy);
      if (mouse.active && d < R) {
        const k = 1 - d / R;
        target += (dx > 0 ? 1 : -1) * k * 1.1 + mvx * 0.02 * k;   // part away from the cursor, drag along its motion
      }
      g.vel += (target - g.bend) * 0.08; g.vel *= 0.85; g.bend += g.vel;
      const tipX = g.x + Math.sin(g.bend) * g.len, tipY = g.y - Math.cos(g.bend) * g.len;
      const cX = g.x + Math.sin(g.bend * 0.45) * g.len * 0.5, cY = g.y - Math.cos(g.bend * 0.45) * g.len * 0.55;
      ctx.globalAlpha = g.a; ctx.lineWidth = g.w;
      ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.quadraticCurveTo(cX, cY, tipX, tipY); ctx.stroke();
      ctx.lineWidth = g.w * 0.45; ctx.globalAlpha = g.a * 0.7;
      ctx.beginPath(); ctx.moveTo(cX, cY); ctx.lineTo(tipX, tipY); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= smoke (coarse stable fluids, rasterized) ================= */
  const SCELL = 10;
  function initSmoke() {
    const cols = Math.ceil(W / SCELL) + 2, rows = Math.ceil(H / SCELL) + 2, n = cols * rows;
    state.cols = cols; state.rows = rows;
    state.u = new Float32Array(n); state.v = new Float32Array(n); state.u0 = new Float32Array(n); state.v0 = new Float32Array(n);
    state.d = new Float32Array(n); state.d0 = new Float32Array(n); state.p = new Float32Array(n); state.div = new Float32Array(n);
  }
  function IX(c, r) { return r * state.cols + c; }
  function setBnd(f) { const { cols, rows } = state; for (let c = 0; c < cols; c++) { f[IX(c, 0)] = f[IX(c, 1)]; f[IX(c, rows - 1)] = f[IX(c, rows - 2)]; } for (let r = 0; r < rows; r++) { f[IX(0, r)] = f[IX(1, r)]; f[IX(cols - 1, r)] = f[IX(cols - 2, r)]; } }
  function diffuse(f, f0, k) { const { cols, rows } = state; for (let it = 0; it < 4; it++) { for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const i = IX(c, r); f[i] = (f0[i] + k * (f[i - 1] + f[i + 1] + f[i - cols] + f[i + cols])) / (1 + 4 * k); } setBnd(f); } }
  function advect(f, f0, u, v, dt) {
    const { cols, rows } = state;
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const i = IX(c, r);
      const x = Math.max(0.5, Math.min(cols - 1.5, c - dt * u[i])), y = Math.max(0.5, Math.min(rows - 1.5, r - dt * v[i]));
      const c0 = Math.floor(x), r0 = Math.floor(y), s1 = x - c0, t1 = y - r0;
      f[i] = (1 - s1) * ((1 - t1) * f0[IX(c0, r0)] + t1 * f0[IX(c0, r0 + 1)]) + s1 * ((1 - t1) * f0[IX(c0 + 1, r0)] + t1 * f0[IX(c0 + 1, r0 + 1)]);
    }
    setBnd(f);
  }
  function project(u, v, p, div) {
    const { cols, rows } = state;
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const i = IX(c, r); div[i] = -0.5 * (u[i + 1] - u[i - 1] + v[i + cols] - v[i - cols]); p[i] = 0; }
    for (let it = 0; it < 8; it++) for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const i = IX(c, r); p[i] = (div[i] + p[i - 1] + p[i + 1] + p[i - cols] + p[i + cols]) / 4; }
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const i = IX(c, r); u[i] -= 0.5 * (p[i + 1] - p[i - 1]); v[i] -= 0.5 * (p[i + cols] - p[i - cols]); }
    setBnd(u); setBnd(v);
  }
  function drawSmoke() {
    const S = state, { cols, rows } = S, dt = 0.9;
    const mvx = mouse.x - prev.x, mvy = mouse.y - prev.y;
    if (mouse.active && Math.hypot(mvx, mvy) > 0.5) {
      const c = Math.round(mouse.x / SCELL), r = Math.round(mouse.y / SCELL);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cc = c + dx, rr = r + dy; if (cc < 1 || rr < 1 || cc >= cols - 1 || rr >= rows - 1) continue;
        const i = IX(cc, rr); S.d[i] = Math.min(1, S.d[i] + 0.35); S.u[i] += mvx * 0.08; S.v[i] += mvy * 0.08;
      }
    }
    for (let i = 0; i < S.v.length; i++) S.v[i] -= S.d[i] * 0.02;
    S.u0.set(S.u); S.v0.set(S.v); diffuse(S.u, S.u0, 0.02); diffuse(S.v, S.v0, 0.02); project(S.u, S.v, S.p, S.div);
    S.u0.set(S.u); S.v0.set(S.v); advect(S.u, S.u0, S.u0, S.v0, dt); advect(S.v, S.v0, S.u0, S.v0, dt); project(S.u, S.v, S.p, S.div);
    S.d0.set(S.d); diffuse(S.d, S.d0, 0.04); S.d0.set(S.d); advect(S.d, S.d0, S.u, S.v, dt);
    for (let i = 0; i < S.d.length; i++) S.d[i] *= 0.992;
    ctx.fillStyle = ink();
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const v = S.d[IX(c, r)]; if (v < 0.03) continue;
      const q = Math.ceil(Math.min(1, v) * 5) / 5;
      ctx.globalAlpha = q * 0.55;
      const s = SCELL * (0.3 + q * 0.7);
      ctx.fillRect(c * SCELL - s / 2, r * SCELL - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  /* ================= soccer (pseudo-3D: the page is the ground plane) ================= */
  // Light from the upper-left and above: objects cast soft shadows down-right onto the UI.
  const LIGHT = { x: -0.55, y: 0.75 };   // shadow offset per unit of height
  function initSoccer() {
    state.ball = { x: W / 2, y: H / 2, z: 0, vx: 0, vy: 0, vz: 0, r: 15, spin: 0 };
    state.score = state.score || [0, 0];
    state.flash = 0;
  }
  function drawSoccer() {
    const b = state.ball;
    const goalH = Math.min(200, H * 0.32), goalD = 34, goalZ = 40, top = (H - goalH) / 2;
    const mvx = mouse.x - prev.x, mvy = mouse.y - prev.y;

    // --- physics ---
    const dx = b.x - eased.x, dy = b.y - eased.y, d = Math.hypot(dx, dy), reach = b.r + 12;
    if (mouse.active && d < reach && b.z < 30) {
      const nx = dx / (d || 1), ny = dy / (d || 1), speed = Math.hypot(mvx, mvy);
      b.vx += nx * (1.5 + speed * 0.5) + mvx * 0.45; b.vy += ny * (1.5 + speed * 0.5) + mvy * 0.45;
      b.vz += 1.5 + speed * 0.35;                        // a kick lifts the ball
      b.x = eased.x + nx * reach; b.y = eased.y + ny * reach;
    }
    const sp = Math.hypot(b.vx, b.vy), max = 24;
    if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
    b.x += b.vx; b.y += b.vy;
    b.z += b.vz; b.vz -= 0.55;                            // gravity
    if (b.z < 0) { b.z = 0; b.vz = -b.vz * 0.45; if (Math.abs(b.vz) < 0.6) b.vz = 0; }
    const rolling = b.z === 0;
    b.vx *= rolling ? 0.982 : 0.995; b.vy *= rolling ? 0.982 : 0.995;
    b.spin += b.vx * 0.02;

    const inMouth = b.y > top && b.y < top + goalH && b.z < goalZ;
    if (b.x - b.r < goalD) { if (inMouth) { if (b.x < goalD * 0.4) { state.score[1]++; state.flash = 60; resetBall(); } } else if (b.x - b.r < 0) { b.x = b.r; b.vx = -b.vx * 0.7; } }
    if (b.x + b.r > W - goalD) { if (inMouth) { if (b.x > W - goalD * 0.4) { state.score[0]++; state.flash = 60; resetBall(); } } else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -b.vx * 0.7; } }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = -b.vy * 0.7; }
    if (b.y + b.r > H) { b.y = H - b.r; b.vy = -b.vy * 0.7; }
    for (const px of [goalD, W - goalD]) for (const py of [top, top + goalH]) {
      const dd = Math.hypot(b.x - px, b.y - py);
      if (dd < b.r + 3 && b.z < goalZ) { const nx = (b.x - px) / dd, ny = (b.y - py) / dd; b.x = px + nx * (b.r + 3); b.y = py + ny * (b.r + 3); const dot = b.vx * nx + b.vy * ny; b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
    }
    function resetBall() { b.x = W / 2; b.y = H / 2; b.z = 0; b.vx = b.vy = b.vz = 0; }

    // --- draw ---
    const INK = ink(), dark = isDark();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2); ctx.stroke();

    // goals: box frames standing on the plane; front posts at goalD from the edge, net box behind to the edge
    for (const side of [-1, 1]) {
      const fx = side < 0 ? goalD : W - goalD;
      const bx = side < 0 ? 0 : W;
      const r = { x: LIGHT.x * goalZ * 0.35, y: -goalZ };            // where a point at height goalZ lands on screen
      const sh = (x, y, z) => [x + LIGHT.x * z, y + LIGHT.y * z];   // where its shadow lands on the ground
      ctx.fillStyle = INK; ctx.globalAlpha = dark ? 0.35 : 0.12;
      ctx.beginPath(); ctx.moveTo(fx, top); ctx.lineTo(...sh(fx, top, goalZ)); ctx.lineTo(...sh(fx, top + goalH, goalZ)); ctx.lineTo(fx, top + goalH); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(fx, top); ctx.lineTo(bx, top); ctx.lineTo(...sh(bx, top, goalZ)); ctx.lineTo(...sh(fx, top, goalZ)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.22;
      for (let y = top; y <= top + goalH; y += 9) { ctx.beginPath(); ctx.moveTo(fx + r.x, y + r.y); ctx.lineTo(bx + r.x, y + r.y); ctx.stroke(); }
      for (let x = Math.min(fx, bx); x <= Math.max(fx, bx); x += 9) { ctx.beginPath(); ctx.moveTo(x + r.x, top + r.y); ctx.lineTo(x + r.x, top + goalH + r.y); ctx.stroke(); }
      for (let y = top; y <= top + goalH; y += 9) { ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + r.x, y + r.y); ctx.stroke(); }
      ctx.globalAlpha = 0.9; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(fx, top); ctx.lineTo(fx + r.x, top + r.y); ctx.lineTo(fx + r.x, top + goalH + r.y); ctx.lineTo(fx, top + goalH);
      ctx.moveTo(fx + r.x, top + r.y); ctx.lineTo(bx + r.x, top + r.y);
      ctx.moveTo(fx + r.x, top + goalH + r.y); ctx.lineTo(bx + r.x, top + goalH + r.y);
      ctx.stroke();
      ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(bx, top); ctx.lineTo(bx + r.x, top + r.y); ctx.moveTo(bx, top + goalH); ctx.lineTo(bx + r.x, top + goalH + r.y); ctx.stroke();
    }

    // ball shadow on the page: offset by height, larger and softer the higher the ball is
    const sx = b.x + LIGHT.x * b.z, sy = b.y + LIGHT.y * b.z, sr = b.r * (1 + b.z / 120);
    const grad = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 1.3);
    grad.addColorStop(0, dark ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = Math.max(0.25, 1 - b.z / 200);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.ellipse(sx, sy, sr * 1.3, sr, 0, 0, Math.PI * 2); ctx.fill();

    // ball: a shaded sphere drawn at its height
    const bx = b.x - LIGHT.x * b.z * 0.15, by = b.y - b.z, R = b.r * (1 + b.z / 400);
    ctx.globalAlpha = 1;
    const sphere = ctx.createRadialGradient(bx - R * 0.4, by - R * 0.4, R * 0.1, bx, by, R);
    sphere.addColorStop(0, '#ffffff'); sphere.addColorStop(0.7, dark ? '#bdbdbd' : '#e6e6e6'); sphere.addColorStop(1, dark ? '#5a5a5a' : '#8a8a8a');
    ctx.fillStyle = sphere; ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#111';
    for (let i = 0; i < 5; i++) {
      const a = b.spin + i * Math.PI * 2 / 5, px = bx + Math.cos(a) * R * 0.75, py = by + Math.sin(a * 1.3) * R * 0.75;
      ctx.beginPath(); for (let k = 0; k < 5; k++) { const t = a + k * Math.PI * 2 / 5; const qx = px + Math.cos(t) * R * 0.22, qy = py + Math.sin(t) * R * 0.22; k ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy); } ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.stroke();

    // score: small, top-right under the bar
    state.flash = Math.max(0, state.flash - 1);
    ctx.globalAlpha = state.flash > 0 ? 0.9 : 0.3;
    ctx.fillStyle = INK; ctx.font = '700 13px "Helvetica Neue", Helvetica, Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(`${state.score[0]} – ${state.score[1]}`, W - 20, 64);
    ctx.textAlign = 'start'; ctx.globalAlpha = 1;
  }

  /* ================= boids (a flock that follows the cursor) ================= */
  function initBoids() {
    const n = Math.min(160, Math.round((W * H) / 9000));
    state.b = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 }));
  }
  function drawBoids() {
    const B = state.b, R = 60, sep = 22, maxV = 3.2;
    for (const p of B) {
      let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, n = 0;
      for (const q of B) { if (q === p) continue; const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy); if (d < R) { cx += q.x; cy += q.y; ax += q.vx; ay += q.vy; n++; if (d < sep) { sx -= dx / d; sy -= dy / d; } } }
      if (n) { p.vx += (cx / n - p.x) * 0.004 + (ax / n - p.vx) * 0.05 + sx * 0.15; p.vy += (cy / n - p.y) * 0.004 + (ay / n - p.vy) * 0.05 + sy * 0.15; }
      if (mouse.active) { const dx = eased.x - p.x, dy = eased.y - p.y, d = Math.hypot(dx, dy) || 1; p.vx += (dx / d) * 0.06; p.vy += (dy / d) * 0.06; if (d < 40) { p.vx -= (dx / d) * 0.5; p.vy -= (dy / d) * 0.5; } }
      const v = Math.hypot(p.vx, p.vy); if (v > maxV) { p.vx *= maxV / v; p.vy *= maxV / v; }
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10; if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
    }
    ctx.fillStyle = ink(); ctx.globalAlpha = 0.55;
    for (const p of B) {
      const a = Math.atan2(p.vy, p.vx);
      ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 7);
      ctx.lineTo(p.x + Math.cos(a + 2.6) * 5, p.y + Math.sin(a + 2.6) * 5);
      ctx.lineTo(p.x + Math.cos(a - 2.6) * 5, p.y + Math.sin(a - 2.6) * 5); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= filings (iron filings around a cursor magnet) ================= */
  function initFilings() {
    const gap = 16;
    state.f = [];
    for (let y = gap / 2; y < H; y += gap) for (let x = gap / 2; x < W; x += gap) state.f.push({ x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 6, a: Math.random() * Math.PI, va: 0 });
  }
  function drawFilings() {
    const mvx = mouse.x - prev.x, mvy = mouse.y - prev.y;
    state.ma = state.ma ?? 0; if (Math.hypot(mvx, mvy) > 1.5) state.ma = Math.atan2(mvy, mvx);
    const mx = eased.x, my = eased.y, L = 60, R = 320;
    const px = mx + Math.cos(state.ma) * L, py = my + Math.sin(state.ma) * L;   // north pole
    const qx = mx - Math.cos(state.ma) * L, qy = my - Math.sin(state.ma) * L;   // south pole
    ctx.strokeStyle = ink(); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (const f of state.f) {
      const d = Math.hypot(f.x - mx, f.y - my);
      let target = f.a;
      if (mouse.active && d < R) {
        const d1 = Math.hypot(f.x - px, f.y - py) || 1, d2 = Math.hypot(f.x - qx, f.y - qy) || 1;
        const fx = (f.x - px) / (d1 * d1) - (f.x - qx) / (d2 * d2), fy = (f.y - py) / (d1 * d1) - (f.y - qy) / (d2 * d2);
        target = Math.atan2(fy, fx);
      }
      const diff = Math.atan2(Math.sin(target - f.a), Math.cos(target - f.a));
      f.va += diff * 0.2; f.va *= 0.7; f.a += f.va;
      const k = mouse.active ? Math.max(0, 1 - d / R) : 0;
      ctx.globalAlpha = 0.14 + k * 0.5;
      const len = 5 + k * 5;
      ctx.beginPath(); ctx.moveTo(f.x - Math.cos(f.a) * len, f.y - Math.sin(f.a) * len); ctx.lineTo(f.x + Math.cos(f.a) * len, f.y + Math.sin(f.a) * len); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= runtime ================= */
  const DRAW = { dots: drawDots, grid: drawGrid, constellation: drawConstellation, water: drawWater, grass: drawGrass, smoke: drawSmoke, soccer: drawSoccer, boids: drawBoids, filings: drawFilings };
  const INIT = { constellation: initConstellation, water: initWater, grass: initGrass, smoke: initSmoke, soccer: initSoccer, boids: initBoids, filings: initFilings };

  function frame() {
    frameNo++;
    ctx.clearRect(0, 0, W, H);
    if (mouse.active) { eased.x += (mouse.x - eased.x) * 0.25; eased.y += (mouse.y - eased.y) * 0.25; }
    DRAW[style]?.();
    prev.x = mouse.x; prev.y = mouse.y;
    raf = requestAnimationFrame(frame);
  }
  function start() { if (style !== 'none' && !raf && !reduce) raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function set(name) {
    style = DRAW[name] ? name : 'none';
    stop(); state = {}; ctx.clearRect(0, 0, W, H);
    canvas.hidden = style === 'none';
    if (style !== 'none') { resize(); if (reduce) DRAW[style](); else start(); }
  }

  resize();
  global.BG = { set, styles: ['none', ...Object.keys(DRAW)] };
})(window);
