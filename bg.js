// Reactive monochrome backgrounds. Draws on a fixed full-screen canvas behind the page and follows the pointer.
// Styles: none | dots | grid | constellation | ripple
(function (global) {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let style = 'none', raf = 0, W = 0, H = 0, dpr = 1;
  const mouse = { x: -9999, y: -9999, vx: 0, vy: 0, active: false };
  let last = { x: -9999, y: -9999 };
  let particles = [], ripples = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ink() { return getComputedStyle(document.body).color || '#000'; }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (style === 'constellation') seedParticles();
  }
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
  addEventListener('pointerleave', () => { mouse.active = false; });
  addEventListener('pointerdown', (e) => { if (style === 'ripple') ripples.push({ x: e.clientX, y: e.clientY, r: 0, a: 1 }); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  function seedParticles() {
    const n = Math.round((W * H) / 14000);
    particles = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3 }));
  }

  /* ---- styles ---- */
  function drawDots(t) {
    const gap = 26, R = 170;
    ctx.fillStyle = ink();
    for (let y = gap / 2; y < H + gap; y += gap) {
      for (let x = gap / 2; x < W + gap; x += gap) {
        const dx = x - mouse.x, dy = y - mouse.y, d = Math.hypot(dx, dy);
        const k = Math.max(0, 1 - d / R);            // 0 far .. 1 at cursor
        const push = k * k * 18;                        // displacement away from cursor
        const px = d ? x + (dx / d) * push : x, py = d ? y + (dy / d) * push : y;
        const r = 1 + k * 3.5;
        ctx.globalAlpha = 0.10 + k * 0.6;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawGrid(t) {
    const gap = 44, R = 220;
    ctx.strokeStyle = ink(); ctx.lineWidth = 1;
    const warp = (x, y) => {
      const dx = x - mouse.x, dy = y - mouse.y, d = Math.hypot(dx, dy);
      const k = Math.max(0, 1 - d / R);
      const s = Math.sin(k * Math.PI) * 34;             // bulge outward, strongest mid-radius
      return d ? [x + (dx / d) * s, y + (dy / d) * s] : [x, y];
    };
    ctx.globalAlpha = 0.16;
    for (let x = 0; x <= W + gap; x += gap) {
      ctx.beginPath();
      for (let y = 0; y <= H + gap; y += 8) { const [px, py] = warp(x, y); y === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
    }
    for (let y = 0; y <= H + gap; y += gap) {
      ctx.beginPath();
      for (let x = 0; x <= W + gap; x += 8) { const [px, py] = warp(x, y); x === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawConstellation(t) {
    if (!particles.length) seedParticles();
    const R = 200, link = 110;
    ctx.fillStyle = ink(); ctx.strokeStyle = ink();
    for (const p of particles) {
      const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy) || 1;
      if (mouse.active && d < R) { const f = (1 - d / R) * 0.25; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      p.vx *= 0.98; p.vy *= 0.98;
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x += W; if (p.x > W) p.x -= W; if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < link) { ctx.globalAlpha = (1 - d / link) * 0.25; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
      if (dm < R) { ctx.globalAlpha = (1 - dm / R) * 0.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); }
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(a.x, a.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRipple(t) {
    // Concentric rings following the cursor, plus click ripples.
    ctx.strokeStyle = ink(); ctx.lineWidth = 1;
    if (mouse.active) {
      for (let i = 0; i < 7; i++) {
        const r = ((t / 18 + i * 34) % 240);
        ctx.globalAlpha = (1 - r / 240) * 0.35;
        ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ripples = ripples.filter(r => r.a > 0.02);
    for (const r of ripples) {
      r.r += 4; r.a *= 0.965;
      ctx.globalAlpha = r.a * 0.6; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  const DRAW = { dots: drawDots, grid: drawGrid, constellation: drawConstellation, ripple: drawRipple };

  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    // Ease the pointer so motion feels fluid.
    if (mouse.active) { last.x += (mouse.x - last.x) * 0.18; last.y += (mouse.y - last.y) * 0.18; }
    const saved = { x: mouse.x, y: mouse.y };
    mouse.x = last.x; mouse.y = last.y;
    DRAW[style]?.(t);
    mouse.x = saved.x; mouse.y = saved.y;
    raf = requestAnimationFrame(frame);
  }
  function start() { if (style !== 'none' && !raf && !reduce) raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function set(name) {
    style = DRAW[name] ? name : 'none';
    stop();
    ctx.clearRect(0, 0, W, H);
    canvas.hidden = style === 'none';
    if (style !== 'none') { resize(); if (reduce) { DRAW[style](0); } else start(); }
  }

  resize();
  global.BG = { set, styles: ['none', ...Object.keys(DRAW)] };
})(window);
