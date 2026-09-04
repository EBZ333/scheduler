// Reactive monochrome backgrounds on a fixed full-screen canvas behind the page.
// Styles: none | dots | constellation | water | smoke | boids | soccer | pong | cars
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
  addEventListener('pointermove', (e) => { if (!mouse.active) { prev.x = e.clientX; prev.y = e.clientY; eased.x = e.clientX; eased.y = e.clientY; } mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
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
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cc = c + dx, rr = r + dy;
      if (cc > 0 && rr > 0 && cc < state.cols - 1 && rr < state.rows - 1) state.a[rr * state.cols + cc] += strength * (dx || dy ? 0.5 : 1);
    }
  }
  function drawWater() {
    const { cols, rows } = state; let { a, b } = state;
    if (mouse.active && (Math.abs(mouse.x - prev.x) > 1 || Math.abs(mouse.y - prev.y) > 1)) drop(mouse.x, mouse.y, 2.2);
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const lap = a[i - 1] + a[i + 1] + a[i - cols] + a[i + cols] - 4 * a[i];
      b[i] = (2 * a[i] - b[i] + 0.35 * lap) * 0.985;
    }
    state.a = b; state.b = a; a = state.a;
    ctx.fillStyle = ink();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = Math.min(1, Math.abs(a[r * cols + c]) / 2.5);
      if (v < 0.03) continue;
      const q = Math.ceil(v * 4) / 4;
      ctx.globalAlpha = 0.08 + q * 0.5;
      const s = WCELL * (0.35 + q * 0.65);
      ctx.fillRect(c * WCELL - s / 2, r * WCELL - s / 2, s, s);
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

  /* ================= soccer (flat pitch, drop shadows, rolling ball) ================= */
  // Fixed sphere patch directions (icosahedron vertices) rotated by the ball's rolling.
  const PHI = (1 + Math.sqrt(5)) / 2;
  const PATCHES = [[0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI], [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1]]
    .map(v => { const n = Math.hypot(...v); return v.map(c => c / n); })
    .map(n => {
      // A pentagon of points on the sphere around normal n, fixed in the ball's own frame.
      const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let t = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
      const tl = Math.hypot(...t); t = t.map(c => c / tl);
      const u = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      const s = 0.36, cs = Math.cos(s), ss = Math.sin(s), pts = [];
      for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5; pts.push([0, 1, 2].map(i => n[i] * cs + (t[i] * Math.cos(a) + u[i] * Math.sin(a)) * ss)); }
      return { n, pts };
    });
  function mul(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
  function rotAxis(M, ax, ay, az, ang) {   // M = R(axis, ang) * M   (M is a 3x3 array of rows)
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const R = [[t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay], [t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax], [t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c]];
    const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = R[i][0] * M[0][j] + R[i][1] * M[1][j] + R[i][2] * M[2][j];
    return out;
  }
  function withShadow(fn, blur = 14, ox = 5, oy = 7, a = 0.5) {
    ctx.save(); ctx.shadowColor = `rgba(0,0,0,${a})`; ctx.shadowBlur = blur; ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy; fn(); ctx.restore();
  }
  function initSoccer() {
    state.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 16, M: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
    state.score = state.score || [0, 0];
    state.flash = 0;
  }
  function drawSoccer() {
    const b = state.ball, goalH = Math.min(220, H * 0.34), goalD = 30, top = (H - goalH) / 2;
    const mvx = mouse.x - prev.x, mvy = mouse.y - prev.y;
    // kick: test against the segment the cursor swept since last frame so fast flicks can't tunnel through
    const reach = b.r + 12;
    let cx = eased.x, cy = eased.y;
    if (mouse.active && Math.hypot(mvx, mvy) > 0) {
      const sx = prev.x, sy = prev.y, ex = mouse.x, ey = mouse.y, L2 = (ex - sx) ** 2 + (ey - sy) ** 2;
      const tt = Math.max(0, Math.min(1, ((b.x - sx) * (ex - sx) + (b.y - sy) * (ey - sy)) / (L2 || 1)));
      cx = sx + (ex - sx) * tt; cy = sy + (ey - sy) * tt;
    }
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    if (mouse.active && d < reach) {
      const nx = dx / (d || 1), ny = dy / (d || 1), speed = Math.hypot(mvx, mvy);
      b.vx += nx * (2 + speed * 0.6) + mvx * 0.5; b.vy += ny * (2 + speed * 0.6) + mvy * 0.5;
      b.x = cx + nx * reach; b.y = cy + ny * reach;
    }
    const sp = Math.hypot(b.vx, b.vy), max = 26;
    if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
    b.x += b.vx; b.y += b.vy; b.vx *= 0.985; b.vy *= 0.985;
    // roll the texture: rotate around the axis perpendicular to travel by distance / radius
    const v = Math.hypot(b.vx, b.vy);
    if (v > 0.05) b.M = rotAxis(b.M, -b.vy / v, b.vx / v, 0, v / b.r);
    const inMouth = b.y > top && b.y < top + goalH;
    if (b.x - b.r < goalD) { if (inMouth) { if (b.x < goalD * 0.35) { state.score[1]++; state.flash = 60; reset(); } } else if (b.x - b.r < 0) { b.x = b.r; b.vx = -b.vx * 0.75; } }
    if (b.x + b.r > W - goalD) { if (inMouth) { if (b.x > W - goalD * 0.35) { state.score[0]++; state.flash = 60; reset(); } } else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -b.vx * 0.75; } }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = -b.vy * 0.75; }
    if (b.y + b.r > H) { b.y = H - b.r; b.vy = -b.vy * 0.75; }
    for (const px of [goalD, W - goalD]) for (const py of [top, top + goalH]) {
      const dd = Math.hypot(b.x - px, b.y - py);
      if (dd < b.r + 3) { const nx = (b.x - px) / dd, ny = (b.y - py) / dd; b.x = px + nx * (b.r + 3); b.y = py + ny * (b.r + 3); const dot = b.vx * nx + b.vy * ny; b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
    }
    function reset() { b.x = W / 2; b.y = H / 2; b.vx = b.vy = 0; }

    // --- draw ---
    const INK = ink(), PAPER = paper(), dark = isDark();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    // ball: flat disc with a drop shadow and a rolling patch texture (drawn before the nets so it goes inside them)
    withShadow(() => { ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }, 12, 4, 6, dark ? 0.8 : 0.35);
    ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = INK;
    for (const p of PATCHES) {
      const n = mul(b.M, p.n);
      if (n[2] <= 0.02) continue;
      ctx.beginPath();
      p.pts.forEach((q, k) => { const v = mul(b.M, q); const x = b.x + v[0] * b.r, y = b.y + v[1] * b.r; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    // goals: flat hatched boxes with a drop shadow, drawn over the ball
    for (const gx of [0, W - goalD]) {
      withShadow(() => { ctx.globalAlpha = 0.55; ctx.fillStyle = PAPER; ctx.fillRect(gx, top, goalD, goalH); ctx.globalAlpha = 1; }, 18, 6, 8, dark ? 0.8 : 0.35);
      ctx.save(); ctx.beginPath(); ctx.rect(gx, top, goalD, goalH); ctx.clip();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      for (let y = top - goalD; y < top + goalH + goalD; y += 7) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + goalD, y + goalD); ctx.stroke(); ctx.beginPath(); ctx.moveTo(gx, y + goalD); ctx.lineTo(gx + goalD, y); ctx.stroke(); }
      ctx.restore();
      ctx.globalAlpha = 0.9; ctx.lineWidth = 3; ctx.strokeStyle = INK;
      ctx.beginPath();
      if (gx === 0) { ctx.moveTo(goalD, top); ctx.lineTo(0, top); ctx.moveTo(goalD, top + goalH); ctx.lineTo(0, top + goalH); ctx.moveTo(goalD, top); ctx.lineTo(goalD, top + goalH); }
      else { ctx.moveTo(gx, top); ctx.lineTo(W, top); ctx.moveTo(gx, top + goalH); ctx.lineTo(W, top + goalH); ctx.moveTo(gx, top); ctx.lineTo(gx, top + goalH); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    scoreText(`${state.score[0]} – ${state.score[1]}`);
  }
  function scoreText(txt) {
    state.flash = Math.max(0, (state.flash || 0) - 1);
    ctx.globalAlpha = state.flash > 0 ? 0.9 : 0.3;
    ctx.fillStyle = ink(); ctx.font = '700 13px "Helvetica Neue", Helvetica, Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(txt, W - 20, 64);
    ctx.textAlign = 'start'; ctx.globalAlpha = 1;
  }

  /* ================= pong ================= */
  function initPong() {
    state.ball = { x: W / 2, y: H / 2, vx: 5, vy: 3, r: 8 };
    state.ai = H / 2; state.score = state.score || [0, 0]; state.flash = 0;
  }
  function drawPong() {
    const b = state.ball, ph = 110, pw = 10, px = 30, INK = ink();
    const my = Math.max(ph / 2, Math.min(H - ph / 2, mouse.active ? eased.y : H / 2));
    state.ai += (b.y - state.ai) * 0.07;                       // the computer paddle lags behind the ball
    const ay = Math.max(ph / 2, Math.min(H - ph / 2, state.ai));
    b.x += b.vx; b.y += b.vy;
    if (b.y < b.r || b.y > H - b.r) { b.vy = -b.vy; b.y = Math.max(b.r, Math.min(H - b.r, b.y)); }
    if (b.x - b.r < px + pw && b.x > px && Math.abs(b.y - my) < ph / 2 + b.r) { b.vx = Math.abs(b.vx) * 1.04; b.vy += (b.y - my) * 0.08; b.x = px + pw + b.r; }
    if (b.x + b.r > W - px - pw && b.x < W - px && Math.abs(b.y - ay) < ph / 2 + b.r) { b.vx = -Math.abs(b.vx) * 1.04; b.vy += (b.y - ay) * 0.06; b.x = W - px - pw - b.r; }
    const sp = Math.hypot(b.vx, b.vy); if (sp > 16) { b.vx *= 16 / sp; b.vy *= 16 / sp; }
    if (b.x < -20) { state.score[1]++; state.flash = 60; Object.assign(b, { x: W / 2, y: H / 2, vx: 5, vy: (Math.random() - 0.5) * 6 }); }
    if (b.x > W + 20) { state.score[0]++; state.flash = 60; Object.assign(b, { x: W / 2, y: H / 2, vx: -5, vy: (Math.random() - 0.5) * 6 }); }
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.15; ctx.setLineDash([8, 10]); ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1; ctx.fillStyle = INK;
    withShadow(() => { ctx.fillRect(px, my - ph / 2, pw, ph); ctx.fillRect(W - px - pw, ay - ph / 2, pw, ph); ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }, 10, 3, 5, 0.4);
    scoreText(`${state.score[0]} – ${state.score[1]}`);
  }

  /* ================= cars (top-down: drive toward the cursor, knock over cones) ================= */
  function initCars() {
    state.car = { x: W / 2, y: H / 2, a: 0, v: 0, drift: 0 };
    state.marks = [];
    state.cones = Array.from({ length: 9 }, () => ({ x: 60 + Math.random() * (W - 120), y: 90 + Math.random() * (H - 160), vx: 0, vy: 0, rot: 0, vr: 0, down: false }));
    state.cars = Array.from({ length: 3 }, (_, i) => ({ x: Math.random() * W, y: 100 + Math.random() * (H - 200), a: Math.random() * Math.PI * 2, v: 2.2 + i * 0.4, t: Math.random() * 100 }));
  }
  function drawCars() {
    const c = state.car, INK = ink(), PAPER = paper(), dark = isDark();
    // --- steering physics: turn toward the cursor, accelerate when far, brake when near
    if (mouse.active) {
      const dx = eased.x - c.x, dy = eased.y - c.y, dist = Math.hypot(dx, dy), ta = Math.atan2(dy, dx);
      const diff = Math.atan2(Math.sin(ta - c.a), Math.cos(ta - c.a));
      const steer = Math.max(-0.06, Math.min(0.06, diff * 0.25)) * Math.min(1, c.v / 2);
      c.a += steer;
      const want = Math.min(9, dist / 25);
      c.v += (want - c.v) * (want > c.v ? 0.05 : 0.12);
      c.drift = c.drift * 0.85 + Math.abs(steer) * c.v * 0.6;
    } else c.v *= 0.96;
    c.x += Math.cos(c.a) * c.v; c.y += Math.sin(c.a) * c.v;
    if (c.x < 20) { c.x = 20; c.v *= 0.5; } if (c.x > W - 20) { c.x = W - 20; c.v *= 0.5; } if (c.y < 70) { c.y = 70; c.v *= 0.5; } if (c.y > H - 20) { c.y = H - 20; c.v *= 0.5; }
    // tire marks when cornering hard
    if (c.drift > 1.6 && c.v > 3) for (const s of [-1, 1]) state.marks.push({ x: c.x - Math.cos(c.a) * 12 + Math.cos(c.a + Math.PI / 2) * 8 * s, y: c.y - Math.sin(c.a) * 12 + Math.sin(c.a + Math.PI / 2) * 8 * s, life: 1 });
    if (state.marks.length > 1500) state.marks.splice(0, state.marks.length - 1500);
    // --- traffic: wander, avoid the player's car
    for (const o of state.cars) {
      o.t += 0.02; o.a += Math.sin(o.t) * 0.02;
      const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy);
      if (d < 110) { const away = Math.atan2(dy, dx); o.a += Math.atan2(Math.sin(away - o.a), Math.cos(away - o.a)) * 0.08; }
      o.x += Math.cos(o.a) * o.v; o.y += Math.sin(o.a) * o.v;
      if (o.x < -30) o.x = W + 30; if (o.x > W + 30) o.x = -30; if (o.y < 40) { o.y = 40; o.a = -o.a; } if (o.y > H + 30) o.y = 40;
    }
    // --- cones
    for (const k of state.cones) {
      const dx = k.x - c.x, dy = k.y - c.y, d = Math.hypot(dx, dy);
      if (d < 22 && c.v > 1) { k.vx = (dx / d) * c.v * 0.9 + Math.cos(c.a) * c.v * 0.6; k.vy = (dy / d) * c.v * 0.9 + Math.sin(c.a) * c.v * 0.6; k.vr = (Math.random() - 0.5) * 0.6; k.down = true; }
      k.x += k.vx; k.y += k.vy; k.rot += k.vr; k.vx *= 0.9; k.vy *= 0.9; k.vr *= 0.92;
      k.x = Math.max(10, Math.min(W - 10, k.x)); k.y = Math.max(70, Math.min(H - 10, k.y));
    }
    // --- draw
    ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 3;
    for (const m of state.marks) { m.life -= 0.0015; ctx.globalAlpha = Math.max(0, m.life) * 0.35; ctx.beginPath(); ctx.arc(m.x, m.y, 1.5, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill(); }
    state.marks = state.marks.filter(m => m.life > 0);
    ctx.globalAlpha = 1;
    const drawCar = (o, len, wid, fill) => {
      ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.a);
      withShadow(() => { ctx.fillStyle = fill; ctx.fillRect(-len / 2, -wid / 2, len, wid); }, 10, 4, 6, dark ? 0.8 : 0.35);
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(-len / 2, -wid / 2, len, wid);
      ctx.fillStyle = INK; ctx.globalAlpha = 0.85;
      ctx.fillRect(len * 0.05, -wid / 2 + 3, len * 0.28, wid - 6);        // windshield
      ctx.fillRect(-len / 2 + 3, -wid / 2 + 3, len * 0.18, wid - 6);     // rear window
      ctx.globalAlpha = 1;
      for (const s of [-1, 1]) { ctx.fillRect(-len / 2 + 4, s * wid / 2 - (s > 0 ? 4 : 0), 8, 4); ctx.fillRect(len / 2 - 12, s * wid / 2 - (s > 0 ? 4 : 0), 8, 4); }
      ctx.restore();
    };
    for (const o of state.cars) drawCar(o, 34, 18, dark ? '#333' : '#ddd');
    for (const k of state.cones) {
      ctx.save(); ctx.translate(k.x, k.y); ctx.rotate(k.rot);
      withShadow(() => { ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ffb000'; ctx.beginPath(); if (k.down) { ctx.moveTo(-9, -5); ctx.lineTo(9, 0); ctx.lineTo(-9, 5); } else { ctx.moveTo(0, -9); ctx.lineTo(8, 7); ctx.lineTo(-8, 7); } ctx.closePath(); ctx.fill(); }, 6, 2, 3, 0.35);
      ctx.restore();
    }
    drawCar(c, 40, 20, PAPER);
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

  /* ================= runtime ================= */
  const DRAW = { dots: drawDots, constellation: drawConstellation, water: drawWater, smoke: drawSmoke, boids: drawBoids, soccer: drawSoccer, pong: drawPong, cars: drawCars };
  const INIT = { constellation: initConstellation, water: initWater, smoke: initSmoke, boids: initBoids, soccer: initSoccer, pong: initPong, cars: initCars };

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
