// Reactive monochrome backgrounds on a fixed full-screen canvas behind the page.
// Styles: none | dots | grid | constellation | water | hair | smoke | soccer
(function (global) {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let style = 'none', raf = 0, W = 0, H = 0, dpr = 1;
  const mouse = { x: -9999, y: -9999, active: false };
  const eased = { x: -9999, y: -9999 };
  const prev = { x: -9999, y: -9999 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let state = {};   // per-style state, reset on set()

  function ink() { return getComputedStyle(document.body).color || '#000'; }
  function accent() { return getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ffb000'; }
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
  addEventListener('pointerdown', (e) => { if (style === 'water') drop(e.clientX, e.clientY, 6); });
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

  /* ================= water (top view, rasterized wave field) ================= */
  const WCELL = 12;
  function initWater() {
    const cols = Math.ceil(W / WCELL) + 1, rows = Math.ceil(H / WCELL) + 1;
    state.cols = cols; state.rows = rows;
    state.a = new Float32Array(cols * rows); state.b = new Float32Array(cols * rows);
  }
  function drop(x, y, strength) {
    if (!state.a) return;
    const c = Math.round(x / WCELL), r = Math.round(y / WCELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cc = c + dx, rr = r + dy;
      if (cc > 0 && rr > 0 && cc < state.cols - 1 && rr < state.rows - 1) state.a[rr * state.cols + cc] += strength * (dx || dy ? 0.5 : 1);
    }
  }
  function drawWater() {
    const { cols, rows } = state; let { a, b } = state;
    if (mouse.active && (Math.abs(mouse.x - prev.x) > 1 || Math.abs(mouse.y - prev.y) > 1)) drop(mouse.x, mouse.y, 2.2);
    // wave equation: new = 2*cur - old + c*(laplacian), damped
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const lap = a[i - 1] + a[i + 1] + a[i - cols] + a[i + cols] - 4 * a[i];
      b[i] = (2 * a[i] - b[i] + 0.35 * lap) * 0.985;
    }
    state.a = b; state.b = a; a = state.a;
    ctx.fillStyle = ink();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const h = a[r * cols + c];
      const v = Math.min(1, Math.abs(h) / 2.5);
      if (v < 0.03) continue;
      // Quantized alpha steps + size steps for the rasterized look.
      const q = Math.ceil(v * 4) / 4;
      ctx.globalAlpha = 0.08 + q * 0.5;
      const s = WCELL * (0.35 + q * 0.65);
      ctx.fillRect(c * WCELL - s / 2, r * WCELL - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  /* ================= hair (strands that comb around the cursor) ================= */
  function initHair() {
    const gap = 22, L = 46;
    state.h = [];
    for (let y = gap; y < H + gap; y += gap) for (let x = gap / 2 + ((y / gap) % 2) * gap / 2; x < W + gap; x += gap) {
      state.h.push({ x, y, ang: Math.PI / 2 + (Math.random() - 0.5) * 0.4, rest: Math.PI / 2 + (Math.random() - 0.5) * 0.4, vel: 0, len: L * (0.7 + Math.random() * 0.6) });
    }
  }
  function drawHair() {
    const R = 190;
    ctx.strokeStyle = ink(); ctx.lineWidth = 1.2; ctx.globalAlpha = 0.28; ctx.lineCap = "round";
    const mvx = mouse.x - prev.x, mvy = mouse.y - prev.y;
    for (const s of state.h) {
      const dx = s.x - eased.x, dy = s.y - eased.y, d = Math.hypot(dx, dy);
      let target = s.rest;
      if (mouse.active && d < R) {
        // Strands point away from the cursor, blended with the cursor's direction of travel (combing).
        const away = Math.atan2(dy, dx);
        const comb = Math.hypot(mvx, mvy) > 1 ? Math.atan2(mvy, mvx) : away;
        const k = 1 - d / R;
        target = lerpAngle(s.rest, lerpAngle(away, comb, 0.5), k);
      }
      // spring toward target
      let diff = Math.atan2(Math.sin(target - s.ang), Math.cos(target - s.ang));
      s.vel += diff * 0.12; s.vel *= 0.82; s.ang += s.vel;
      // draw as a gentle curve
      const cx = s.x + Math.cos(s.ang) * s.len * 0.5, cy = s.y + Math.sin(s.ang) * s.len * 0.5;
      const ex = s.x + Math.cos(s.ang + s.vel * 3) * s.len, ey = s.y + Math.sin(s.ang + s.vel * 3) * s.len;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function lerpAngle(a, b, t) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; }

  /* ================= smoke (coarse stable-fluids, rasterized) ================= */
  const SCELL = 10;
  function initSmoke() {
    const cols = Math.ceil(W / SCELL) + 2, rows = Math.ceil(H / SCELL) + 2;
    const n = cols * rows;
    state.cols = cols; state.rows = rows;
    state.u = new Float32Array(n); state.v = new Float32Array(n); state.u0 = new Float32Array(n); state.v0 = new Float32Array(n);
    state.d = new Float32Array(n); state.d0 = new Float32Array(n);
    state.p = new Float32Array(n); state.div = new Float32Array(n);
  }
  function IX(c, r) { return r * state.cols + c; }
  function setBnd(f) { const { cols, rows } = state; for (let c = 0; c < cols; c++) { f[IX(c, 0)] = f[IX(c, 1)]; f[IX(c, rows - 1)] = f[IX(c, rows - 2)]; } for (let r = 0; r < rows; r++) { f[IX(0, r)] = f[IX(1, r)]; f[IX(cols - 1, r)] = f[IX(cols - 2, r)]; } }
  function diffuse(f, f0, k) { const { cols, rows } = state; for (let it = 0; it < 4; it++) { for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const i = IX(c, r); f[i] = (f0[i] + k * (f[i - 1] + f[i + 1] + f[i - cols] + f[i + cols])) / (1 + 4 * k); } setBnd(f); } }
  function advect(f, f0, u, v, dt) {
    const { cols, rows } = state;
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const i = IX(c, r);
      let x = c - dt * u[i], y = r - dt * v[i];
      x = Math.max(0.5, Math.min(cols - 1.5, x)); y = Math.max(0.5, Math.min(rows - 1.5, y));
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
    // Inject smoke and velocity at the cursor when it moves.
    const mvx = mouse.x - prev.x, mvy = mouse.y - prev.y;
    if (mouse.active && Math.hypot(mvx, mvy) > 0.5) {
      const c = Math.round(mouse.x / SCELL), r = Math.round(mouse.y / SCELL);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cc = c + dx, rr = r + dy; if (cc < 1 || rr < 1 || cc >= cols - 1 || rr >= rows - 1) continue;
        const i = IX(cc, rr); S.d[i] = Math.min(1, S.d[i] + 0.35); S.u[i] += mvx * 0.08; S.v[i] += mvy * 0.08;
      }
    }
    // Buoyancy: smoke rises slowly.
    for (let i = 0; i < S.v.length; i++) S.v[i] -= S.d[i] * 0.02;
    // Velocity step
    S.u0.set(S.u); S.v0.set(S.v);
    diffuse(S.u, S.u0, 0.02); diffuse(S.v, S.v0, 0.02);
    project(S.u, S.v, S.p, S.div);
    S.u0.set(S.u); S.v0.set(S.v);
    advect(S.u, S.u0, S.u0, S.v0, dt); advect(S.v, S.v0, S.u0, S.v0, dt);
    project(S.u, S.v, S.p, S.div);
    // Density step
    S.d0.set(S.d); diffuse(S.d, S.d0, 0.04);
    S.d0.set(S.d); advect(S.d, S.d0, S.u, S.v, dt);
    for (let i = 0; i < S.d.length; i++) S.d[i] *= 0.992;
    // Rasterized render: quantized squares.
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

  /* ================= soccer ================= */
  function initSoccer() {
    state.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 16 };
    state.score = state.score || [0, 0];
    state.flash = 0;
  }
  function drawSoccer() {
    const b = state.ball, goalH = Math.min(220, H * 0.35), goalD = 26, top = (H - goalH) / 2;
    const mvx = mouse.x - prev.x, mvy = mouse.y - prev.y;
    // Cursor kicks the ball when it touches it.
    const dx = b.x - eased.x, dy = b.y - eased.y, d = Math.hypot(dx, dy);
    const reach = b.r + 14;
    if (mouse.active && d < reach) {
      const nx = dx / (d || 1), ny = dy / (d || 1);
      const speed = Math.hypot(mvx, mvy);
      b.vx += nx * (2 + speed * 0.6) + mvx * 0.5; b.vy += ny * (2 + speed * 0.6) + mvy * 0.5;
      b.x = eased.x + nx * reach; b.y = eased.y + ny * reach;
    }
    const sp = Math.hypot(b.vx, b.vy), max = 28;
    if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
    b.x += b.vx; b.y += b.vy; b.vx *= 0.985; b.vy *= 0.985;
    // Goals: open mouths on the left and right edges.
    const inGoalY = b.y > top && b.y < top + goalH;
    if (b.x - b.r < 0) { if (inGoalY && b.x < -4) { state.score[1]++; state.flash = 40; reset(1); } else if (!inGoalY) { b.x = b.r; b.vx = -b.vx * 0.8; } }
    if (b.x + b.r > W) { if (inGoalY && b.x > W + 4) { state.score[0]++; state.flash = 40; reset(-1); } else if (!inGoalY) { b.x = W - b.r; b.vx = -b.vx * 0.8; } }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = -b.vy * 0.8; }
    if (b.y + b.r > H) { b.y = H - b.r; b.vy = -b.vy * 0.8; }
    // Goal posts block the ball from entering above/below the mouth from inside.
    for (const side of [0, W]) {
      for (const py of [top, top + goalH]) {
        const px = side; const dd = Math.hypot(b.x - px, b.y - py);
        if (dd < b.r + 4) { const nx = (b.x - px) / dd, ny = (b.y - py) / dd; b.x = px + nx * (b.r + 4); b.y = py + ny * (b.r + 4); const dot = b.vx * nx + b.vy * ny; b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
      }
    }
    function reset(dir) { b.x = W / 2; b.y = H / 2; b.vx = 0; b.vy = 0; }

    // --- draw ---
    ctx.strokeStyle = ink(); ctx.fillStyle = ink(); ctx.lineWidth = 2;
    ctx.globalAlpha = 0.18;
    // pitch: halfway line + centre circle
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2); ctx.stroke();
    // goals with net hatching
    ctx.globalAlpha = 0.5;
    for (const gx of [0, W - goalD]) {
      ctx.strokeRect(gx, top, goalD, goalH);
      ctx.globalAlpha = 0.25;
      for (let y = top + 6; y < top + goalH; y += 8) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + goalD, y); ctx.stroke(); }
      ctx.globalAlpha = 0.5;
    }
    // score
    ctx.globalAlpha = state.flash > 0 ? 0.9 : 0.25; state.flash = Math.max(0, state.flash - 1);
    ctx.font = '700 64px "Helvetica Neue", Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${state.score[0]}  –  ${state.score[1]}`, W / 2, 70);
    // ball: circle with pentagon patch
    ctx.globalAlpha = 1;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ink(); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = ink();
    const rot = (b.x + b.y) / 30;
    ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = rot + i * Math.PI * 2 / 5; const px = b.x + Math.cos(a) * b.r * 0.42, py = b.y + Math.sin(a) * b.r * 0.42; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill();
    ctx.textAlign = 'start';
  }

  /* ================= runtime ================= */
  const DRAW = { dots: drawDots, grid: drawGrid, constellation: drawConstellation, water: drawWater, hair: drawHair, smoke: drawSmoke, soccer: drawSoccer };
  const INIT = { constellation: initConstellation, water: initWater, hair: initHair, smoke: initSmoke, soccer: initSoccer };

  function frame() {
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
    stop();
    state = {};
    ctx.clearRect(0, 0, W, H);
    canvas.hidden = style === 'none';
    if (style !== 'none') { resize(); if (reduce) DRAW[style](); else start(); }
  }

  resize();
  global.BG = { set, styles: ['none', ...Object.keys(DRAW)] };
})(window);
