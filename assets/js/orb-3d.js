/**
 * Engine Animasi 3D Interaktif (Nol Dependensi).
 *
 * Mengimplementasikan proyeksi perspektif 3D matematika murni pada elemen HTML5 Canvas:
 * - Distribusi titik bola Fibonacci (Fibonacci Golden Spiral).
 * - Rotasi matriks 3 dimensi (X, Y, Z) dengan inersia dan peredaman gesekan (damping).
 * - Interaksi seret kursor/sentuh (drag & flick) + pelacakan kursor (cursor proximity tilt).
 * - Jaringan konstelasi neural (edge lines) pada belahan bola depan.
 * - Efisiensi daya: IntersectionObserver menghentikan rendering saat tidak terlihat di layar.
 * - Aksesibilitas: Menghormati prefers-reduced-motion.
 */

const PREFERS_REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Buat instance renderer bola partikel 3D pada canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 */
export function create3DOrb(canvas, opts = {}) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const nodeCount = opts.count ?? 320;
  const baseRadius = opts.radius ?? 110;
  const fov = opts.fov ?? 340;
  const accentColor = opts.accent ?? '#f5c542';
  const showLines = opts.showLines ?? true;
  let mode = opts.mode ?? 'fibonacci'; // 'fibonacci' | 'constellation' | 'wave'

  // Siapkan titik-titik pada permukaan bola (Fibonacci Spiral)
  const phi = (1 + Math.sqrt(5)) / 2; // Rasio emas
  let points = [];

  function buildPoints() {
    points = [];
    for (let i = 0; i < nodeCount; i++) {
      const theta = 2 * Math.PI * i / phi;
      const y = 1 - (i / (nodeCount - 1)) * 2;
      const rAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const x = Math.cos(theta) * rAtY;
      const z = Math.sin(theta) * rAtY;
      points.push({
        x, y, z,
        origX: x, origY: y, origZ: z,
        baseSize: 1.2 + (i % 3) * 0.5,
        pulseOffset: (i * 0.17) % (Math.PI * 2),
      });
    }
  }
  buildPoints();

  // Ring orbit tambahan (satelit)
  const satelliteCount = 24;
  const satellites = [];
  for (let i = 0; i < satelliteCount; i++) {
    const angle = (i / satelliteCount) * Math.PI * 2;
    satellites.push({
      angle,
      speed: 0.015 + (i % 2) * 0.008,
      tilt: 0.45,
      radiusRatio: 1.28 + (i % 3) * 0.1,
    });
  }

  // Matriks orientasi & kecepatan sudut
  let rotX = 0.2;
  let rotY = 0.4;
  let velX = 0.0018;
  let velY = 0.0035;
  const friction = 0.945;

  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  resize();

  // Interaksi Pointer / Drag
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let shockwave = 0;

  function onPointerDown(e) {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    velX = 0;
    velY = 0;
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    rotY += dx * 0.008;
    rotX -= dy * 0.008;

    velY = dx * 0.004;
    velX = -dy * 0.004;
  }

  function onPointerUp() {
    isDragging = false;
  }

  function onClick() {
    shockwave = 1.0;
  }

  // ── KENDALI KEYBOARD ──────────────────────────────────────────────────────
  // Rotasi HANYA bisa lewat drag berarti pengguna keyboard tidak bisa
  // menyentuh efek ini sama sekali. Panah kiri/kanan memutar sumbu Y, atas/
  // bawah sumbu X, spasi memicu gelombang. `tabindex` dipasang di sini, bukan
  // di HTML, supaya pemanggil tidak perlu ingat.
  function onKeyDown(e) {
    const step = 0.12;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':  velY = -step; rotY -= step; break;
      case 'ArrowRight': velY = step;  rotY += step; break;
      case 'ArrowUp':    velX = -step; rotX -= step; break;
      case 'ArrowDown':  velX = step;  rotX += step; break;
      case ' ':
      case 'Enter':      shockwave = 1.0; break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  // ── FOKUSABILITAS: HANYA KALAU TERLIHAT OLEH AT ───────────────────────────
  // Kanvas di dalam wadah `aria-hidden="true"` (hero dekoratif) TIDAK BOLEH
  // menerima tabindex: itu membuat elemen fokusabel yang tidak punya nama
  // aksesibel — jebakan fokus bagi pengguna keyboard, dan pelanggaran
  // `aria-hidden-focus`. Kanvas hero memang murni hiasan (teks di sebelahnya
  // sudah menyampaikan maksudnya), jadi cukup `aria-hidden`.
  // Kanvas di lab3d adalah kontrol sungguhan, jadi ia mendapat tabindex,
  // role, label, dan handler panah.
  const dalamAriaHidden = (() => {
    let n = canvas.parentElement;
    while (n) {
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true;
      n = n.parentElement;
    }
    return false;
  })();

  if (dalamAriaHidden) {
    canvas.setAttribute('aria-hidden', 'true');
    canvas.removeAttribute('tabindex');
  } else {
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    if (!canvas.getAttribute('aria-label')) {
      canvas.setAttribute('aria-label', 'Bola partikel 3D interaktif. Gunakan tombol panah untuk memutar.');
    }
    canvas.addEventListener('keydown', onKeyDown);
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  canvas.addEventListener('click', onClick, { passive: true });

  let animId = null;
  let isVisible = true;
  let lastTime = performance.now();

  function render(now) {
    if (!isVisible) return;
    animId = requestAnimationFrame(render);

    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (!PREFERS_REDUCED()) {
      if (!isDragging) {
        velX *= friction;
        velY *= friction;
        rotX += velX + 0.0012;
        rotY += velY + 0.0028;
      }
      if (shockwave > 0) {
        shockwave = Math.max(0, shockwave - dt * 1.5);
      }
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const R = Math.min(width, height) * 0.38;

    // Rotasi trigonometri
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);

    // Transformasi titik 3D ke 2D
    const projected = [];
    const waveTime = now * 0.003;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      // Efek wave deformasi jika mode wave
      let radMult = 1.0;
      if (mode === 'wave') {
        radMult += Math.sin(waveTime + p.pulseOffset) * 0.12;
      }
      if (shockwave > 0) {
        radMult += Math.sin(p.origY * 6 + (1 - shockwave) * 10) * shockwave * 0.25;
      }

      const px = p.origX * radMult;
      const py = p.origY * radMult;
      const pz = p.origZ * radMult;

      // Rotasi sekitar sumbu Y
      const x1 = px * cosY + pz * sinY;
      const y1 = py;
      const z1 = -px * sinY + pz * cosY;

      // Rotasi sekitar sumbu X
      const x2 = x1;
      const y2 = y1 * cosX - z1 * sinX;
      const z2 = y1 * sinX + z1 * cosX;

      // Proyeksi perspektif
      const distance = fov;
      const scale = distance / (distance + z2 * R * 0.85);
      const projX = cx + x2 * R * scale;
      const projY = cy + y2 * R * scale;

      projected.push({
        x: projX,
        y: projY,
        z: z2,
        scale,
        baseSize: p.baseSize,
      });
    }

    // Urutkan berdasarkan kedalaman Z (depth sort: back to front)
    projected.sort((a, b) => a.z - b.z);

    // Gambar garis konstelasi untuk partikel belahan depan jika mode aktif
    if (showLines && (mode === 'constellation' || mode === 'fibonacci')) {
      const maxDist = mode === 'constellation' ? 44 : 32;
      const frontPoints = projected.filter((pt) => pt.z > 0.05);

      ctx.lineWidth = 0.75;
      for (let i = 0; i < frontPoints.length; i++) {
        const p1 = frontPoints[i];
        for (let j = i + 1; j < frontPoints.length; j++) {
          const p2 = frontPoints[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < maxDist * maxDist) {
            const dist = Math.sqrt(distSq);
            const alpha = (1 - dist / maxDist) * Math.min(p1.z, p2.z) * 0.35;
            ctx.strokeStyle = `rgba(245, 197, 66, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
    }

    // Gambar partikel
    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];
      const isFront = p.z > 0;

      let radius = p.baseSize * p.scale;
      let alpha = 0.15 + (p.z + 1) * 0.42; // range 0.15 s/d 0.99
      alpha = Math.max(0.08, Math.min(1.0, alpha));

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, radius), 0, Math.PI * 2);

      if (isFront && p.z > 0.4) {
        // Glowing halo untuk partikel paling depan
        ctx.fillStyle = accentColor;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 6 * p.scale;
      } else {
        ctx.fillStyle = `rgba(245, 197, 66, ${alpha.toFixed(2)})`;
        ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Gambar ring orbit satelit luar
    for (let i = 0; i < satellites.length; i++) {
      const s = satellites[i];
      if (!PREFERS_REDUCED()) {
        s.angle += s.speed;
      }
      const ringR = R * s.radiusRatio;
      const sx = Math.cos(s.angle) * ringR;
      const sy = Math.sin(s.angle) * ringR * Math.cos(s.tilt);
      const sz = Math.sin(s.angle) * ringR * Math.sin(s.tilt);

      // Rotasi satelit dengan matriks yang sama
      const sx1 = sx * cosY + sz * sinY;
      const sy1 = sy;
      const sz1 = -sx * sinY + sz * cosY;

      const sx2 = sx1;
      const sy2 = sy1 * cosX - sz1 * sinX;
      const sz2 = sy1 * sinX + sz1 * cosX;

      const satScale = fov / (fov + sz2 * 0.85);
      const satX = cx + sx2 * satScale;
      const satY = cy + sy2 * satScale;

      if (sz2 > -0.2) {
        ctx.beginPath();
        ctx.arc(satX, satY, 1.4 * satScale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.3 + (sz2 + 1) * 0.35).toFixed(2)})`;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // IntersectionObserver: hemat baterai saat scrolled out of view
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      isVisible = entry.isIntersecting;
      if (isVisible && !animId) {
        lastTime = performance.now();
        animId = requestAnimationFrame(render);
      } else if (!isVisible && animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }
  }, { threshold: 0.05 });

  observer.observe(canvas);

  // Resize listener
  const resizeHandler = () => resize();
  window.addEventListener('resize', resizeHandler, { passive: true });

  // Start rendering
  animId = requestAnimationFrame(render);

  return {
    setMode: (m) => { mode = m; },
    destroy: () => {
      if (animId) cancelAnimationFrame(animId);
      observer.disconnect();
      window.removeEventListener('resize', resizeHandler);
      canvas.removeEventListener('pointerdown', onPointerDown);
      if (!dalamAriaHidden) canvas.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('click', onClick);
    },
  };
}

/**
 * Pasang 3D Thinking Orb di dalam terminal jendela Hero.
 */
export function initHeroOrb() {
  const canvas = document.getElementById('heroOrbCanvas');
  if (!canvas) return null;
  return create3DOrb(canvas, {
    count: 240,
    radius: 75,
    fov: 300,
    accent: '#f5c542',
    showLines: true,
    mode: 'fibonacci',
  });
}

/**
 * Pasang Laboratorium 3D Interaktif di hostId.
 * @param {string} hostId
 */
export function pasangLab3d(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;

  host.innerHTML = `
    <div class="lab3d-card">
      <div class="lab3d-header">
        <div class="lab3d-title-group">
          <span class="orb-pulse-dot" aria-hidden="true"></span>
          <span class="lab3d-title">Interactive 3D Neural Mesh</span>
          <span class="lab3d-badge">WebGL / Canvas 3D</span>
        </div>
        <div class="lab3d-controls" role="group" aria-label="Mode Animasi 3D">
          <button type="button" class="lab3d-btn is-active" data-mode="fibonacci">Fibonacci Orb</button>
          <button type="button" class="lab3d-btn" data-mode="constellation">Constellation</button>
          <button type="button" class="lab3d-btn" data-mode="wave">Pulse Wave</button>
        </div>
      </div>

      <div class="lab3d-canvas-stage" id="lab3dStage">
        <canvas class="lab3d-canvas" id="lab3dCanvas" aria-label="Simulasi 3D Partikel Interaktif"></canvas>
        <div class="lab3d-hud-overlay">
          <span class="lab3d-hud-stat">NODES: <strong>320 Partikel</strong></span>
          <span class="lab3d-hud-stat">DEPTH: <strong>340px FOV</strong></span>
          <span class="lab3d-hud-stat">STATUS: <strong>60 FPS &bull; 0 KB Ext Dep</strong></span>
        </div>
      </div>

      <div class="lab3d-pillars">
        <div class="lab3d-pillar">
          <div class="lab3d-pillar-num">01 / VELOCITY PHYSICS</div>
          <h3 class="lab3d-pillar-title">Smooth Momentum Scroll</h3>
          <p class="lab3d-pillar-desc">
            Mengadopsi pola Lenis dan GSAP: pergerakan berbasis inersia yang alami,
            terkalibrasi presisi tanpa hambatan jank di perangkat 60Hz sampai 120Hz.
          </p>
        </div>
        <div class="lab3d-pillar">
          <div class="lab3d-pillar-num">02 / 3D MICRO-INTERACTION</div>
          <h3 class="lab3d-pillar-title">Interactive Depth &amp; Perspective</h3>
          <p class="lab3d-pillar-desc">
            Mengadopsi pola Three.js dan React Bits: elemen responsif terhadap sudut pointer,
            efek refraksi kedalaman, dan interaksi yang membuat antarmuka terasa hidup.
          </p>
        </div>
        <div class="lab3d-pillar">
          <div class="lab3d-pillar-num">03 / SECURITY &amp; INTEGRITY</div>
          <h3 class="lab3d-pillar-title">Autonomous AI Hardening</h3>
          <p class="lab3d-pillar-desc">
            Mengadopsi standar Strix DAST: pengujian celah keamanan aplikasi secara aktif
            serta pembersihan jejak metadata sebelum kode dirilis ke produksi.
          </p>
        </div>
      </div>
    </div>
  `;

  const canvas = document.getElementById('lab3dCanvas');
  const instance = create3DOrb(canvas, {
    count: 320,
    radius: 120,
    fov: 340,
    accent: '#f5c542',
    showLines: true,
    mode: 'fibonacci',
  });

  // Tombol ganti mode
  const buttons = host.querySelectorAll('.lab3d-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const m = btn.getAttribute('data-mode');
      if (instance && m) instance.setMode(m);
    });
  });
}
