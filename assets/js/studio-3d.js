/**
 * VIVASTIC studio: procedural solid models, orthographic camera, Canvas 2D.
 * Inspired by the material/lighting references in the saved design reels.
 * No remote renderer, textures, tracking or private application data.
 */
const CLAMP = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const FACE_INDICES = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];

function box(x, y, z, w, h, d, material = 'graphite') {
  return { x, y, z, w, h, d, material };
}

/** Author-built visual metaphors, not reconstructions of private architecture. */
export function buildStudioScene(kind = 'core') {
  const boxes = [];
  if (kind === 'inventory') {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        boxes.push(box((x - 1) * 0.73, (y - 1) * 0.73, 0, 0.62, 0.62, 0.86, (x + y) % 3 === 0 ? 'gold' : 'graphite'));
        boxes.push(box((x - 1) * 0.73, (y - 1) * 0.73 - 0.16, 0.44, 0.25, 0.055, 0.018, 'label'));
      }
    }
    boxes.push(box(0, -1.25, 0, 2.75, 0.12, 1.35, 'dark'));
  } else if (kind === 'network') {
    boxes.push(box(0, 0, 0, 0.85, 0.85, 0.85, 'gold'));
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const x = Math.cos(a) * 1.32;
      const y = Math.sin(a) * 1.12;
      boxes.push(box(x, y, (i % 2 - 0.5) * 0.65, 0.38, 0.38, 0.38, i % 2 ? 'graphite' : 'bronze'));
    }
    boxes.push(box(0, -1.65, 0, 2.55, 0.09, 1.4, 'dark'));
  } else {
    // Exploded industrial enclosure: base, board, heat-sink, gold cover.
    boxes.push(box(0, -1.04, 0, 2.25, 0.22, 1.75, 'dark'));
    boxes.push(box(0, -0.73, 0, 2.12, 0.13, 1.62, 'graphite'));
    boxes.push(box(0, -0.16, 0, 1.96, 0.22, 1.48, 'bronze'));
    boxes.push(box(0, 0.53, 0, 1.85, 0.22, 1.39, 'gold'));
    boxes.push(box(0, 0.69, 0, 0.85, 0.07, 0.69, 'dark'));
    for (let i = 0; i < 9; i++) boxes.push(box(-0.79 + i * 0.197, 0.1, 0, 0.057, 0.21, 1.22, 'graphite'));
    for (const x of [-0.93, 0.93]) for (const z of [-0.68, 0.68]) boxes.push(box(x, -0.55, z, 0.055, 0.65, 0.055, 'gold'));
  }
  return boxes;
}

function rotate([x, y, z], yaw, pitch) {
  const xx = x * Math.cos(yaw) + z * Math.sin(yaw);
  const zz = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return [xx, y * Math.cos(pitch) - zz * Math.sin(pitch), y * Math.sin(pitch) + zz * Math.cos(pitch)];
}

/** Pure camera/projection seam: shared with renderer and geometry tests. */
export function projectStudioScene(scene, { width = 640, height = 520, yaw = -0.63, pitch = -0.42 } = {}) {
  const scale = Math.min(width, height) * 0.225;
  const faces = [];
  for (const b of scene) {
    const v = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ].map(([x, y, z]) => rotate([b.x + x * b.w / 2, b.y + y * b.h / 2, b.z + z * b.d / 2], yaw, pitch));
    FACE_INDICES.forEach((indices, faceIndex) => {
      const p = indices.map((i) => v[i]);
      const ab = p[1].map((n, i) => n - p[0][i]);
      const ac = p[2].map((n, i) => n - p[0][i]);
      const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const length = Math.hypot(...normal) || 1;
      const light = CLAMP(0.5 + (normal[0] * -0.28 + normal[1] * 0.72 + normal[2] * -0.48) / length, 0.15, 1);
      faces.push({
        points: p.map(([x, y]) => [width / 2 + x * scale, height * 0.49 - y * scale]),
        depth: p.reduce((sum, pt) => sum + pt[2], 0) / 4,
        material: b.material,
        faceIndex,
        light,
      });
    });
  }
  return faces.sort((a, b) => a.depth - b.depth);
}

const MATERIALS = { gold: [190, 156, 94], bronze: [116, 91, 53], graphite: [59, 64, 66], dark: [30, 35, 38], label: [216, 211, 195] };
function shade(material, light, lift = 0) {
  const rgb = MATERIALS[material] || MATERIALS.graphite;
  return `rgb(${rgb.map((v) => Math.round(CLAMP(v * (0.45 + light * 0.86) + lift, 0, 255))).join(',')})`;
}

export function mountStudio3D(root = document.querySelector('[data-studio-model]')) {
  if (!root || root.dataset.mounted) return null;
  const canvas = root.querySelector('canvas');
  const ctx = canvas?.getContext('2d', { alpha: true });
  if (!ctx) return null;
  root.dataset.mounted = 'true';
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { kind: 'core', yaw: -0.63, pitch: -0.42, paused: false, visible: false, frame: 0 };
  let scene = buildStudioScene();
  let width = 640, height = 520, raf = 0, last = 0, pointer = null;
  const listeners = [];
  const on = (target, event, fn, options) => { target.addEventListener(event, fn, options); listeners.push(() => target.removeEventListener(event, fn, options)); };

  function render() {
    ctx.clearRect(0, 0, width, height);
    // A quiet drafting grid and soft contact shadow establish physical scale.
    ctx.save();
    ctx.strokeStyle = 'rgba(200,180,140,0.065)';
    ctx.lineWidth = 1;
    for (let i = -5; i <= 5; i++) {
      ctx.beginPath();
      ctx.moveTo(width / 2 + i * width * 0.07, height * 0.69);
      ctx.lineTo(width / 2 + i * width * 0.11, height * 0.88);
      ctx.stroke();
    }
    const shadow = ctx.createRadialGradient(width / 2, height * 0.78, 2, width / 2, height * 0.78, width * 0.26);
    shadow.addColorStop(0, 'rgba(0,0,0,0.7)'); shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.fillRect(0, height * 0.58, width, height * 0.38);
    for (const face of projectStudioScene(scene, { width, height, yaw: state.yaw, pitch: state.pitch })) {
      ctx.beginPath();
      face.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, height * 0.2, width * 0.7, height * 0.9);
      fill.addColorStop(0, shade(face.material, face.light, 16));
      fill.addColorStop(1, shade(face.material, face.light, -10));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = face.material === 'gold' ? 'rgba(243,218,162,0.55)' : 'rgba(209,205,191,0.17)';
      ctx.stroke();
    }
    ctx.restore();
    state.frame++;
    root.dataset.frame = String(state.frame);
    root.dataset.ready = 'true';
    root.dataset.mode = state.kind;
    root.dataset.yaw = state.yaw.toFixed(3);
  }

  function allowed() { return state.visible && !state.paused && !media.matches && !document.hidden && !pointer; }
  function loop(t) {
    raf = 0;
    if (!allowed()) { root.dataset.running = 'false'; return; }
    if (!last || t - last >= 32) {
      state.yaw += 0.0012;
      render(); last = t;
    }
    raf = requestAnimationFrame(loop);
  }
  function sync() {
    if (!allowed()) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; root.dataset.running = 'false';
    } else if (!raf) {
      root.dataset.running = 'true'; last = 0; raf = requestAnimationFrame(loop);
    }
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }
  const observer = new IntersectionObserver(([entry]) => { state.visible = entry.isIntersecting; if (state.visible) resize(); sync(); }, { threshold: 0.08 });
  observer.observe(root);
  const resizer = new ResizeObserver(resize); resizer.observe(canvas);
  on(document, 'visibilitychange', sync);
  on(media, 'change', () => { render(); sync(); });
  on(document, 'cf-gate:lulus', resize);

  for (const button of root.querySelectorAll('[data-model-kind]')) {
    on(button, 'click', () => {
      state.kind = button.dataset.modelKind;
      scene = buildStudioScene(state.kind);
      for (const b of root.querySelectorAll('[data-model-kind]')) b.setAttribute('aria-pressed', String(b === button));
      const title = root.querySelector('[data-model-name]');
      if (title) title.textContent = { core: 'Control core', inventory: 'Modular inventory', network: 'Connected systems' }[state.kind];
      render();
    });
  }
  const pause = root.querySelector('[data-model-pause]');
  if (pause) on(pause, 'click', () => {
    state.paused = !state.paused;
    pause.setAttribute('aria-pressed', String(state.paused));
    pause.textContent = state.paused ? 'Putar otomatis' : 'Jeda animasi';
    sync();
  });
  const reset = root.querySelector('[data-model-reset]');
  if (reset) on(reset, 'click', () => { state.yaw = -0.63; state.pitch = -0.42; render(); });
  on(canvas, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId); sync();
  });
  on(canvas, 'pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    state.yaw += (e.clientX - pointer.x) * 0.009;
    state.pitch = CLAMP(state.pitch + (e.clientY - pointer.y) * 0.006, -0.9, 0.9);
    pointer.x = e.clientX; pointer.y = e.clientY; render();
  });
  const release = () => { pointer = null; sync(); };
  on(canvas, 'pointerup', release); on(canvas, 'pointercancel', release);
  on(canvas, 'keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Home') { state.yaw = -0.63; state.pitch = -0.42; }
    else if (e.key === 'ArrowLeft') state.yaw -= 0.15;
    else if (e.key === 'ArrowRight') state.yaw += 0.15;
    else state.pitch = CLAMP(state.pitch + (e.key === 'ArrowUp' ? -0.12 : 0.12), -0.9, 0.9);
    render();
  });
  resize();
  return { destroy() { observer.disconnect(); resizer.disconnect(); if (raf) cancelAnimationFrame(raf); listeners.forEach((off) => off()); delete root.dataset.mounted; } };
}

/** Progressive enhancement: static SVG remains when JS/canvas is unavailable. */
export function initStudio3D() {
  const root = document.querySelector('[data-studio-model]');
  if (!root) return;
  let mounted = false;
  const mount = () => { if (!mounted) { mounted = true; mountStudio3D(root); } };
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    // Two frames leave a paint opportunity for the static poster first.
    requestAnimationFrame(() => requestAnimationFrame(mount));
  }, { rootMargin: '120px' });
  observer.observe(root);
}
