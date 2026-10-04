/**
 * Film Grain Overlay
 * Tactile texture layer — 2026 trend (from Polar26 reference, modified)
 */

export function initGrain() {
  // Create grain canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'grain-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let animationId;
  let lastFrameTime = 0;
  const fps = 24; // Cinematic frame rate
  const frameInterval = 1000 / fps;

  // Resize canvas to match viewport
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // Generate grain noise
  function drawGrain() {
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const buffer = new Uint32Array(imageData.data.buffer);

    for (let i = 0; i < buffer.length; i++) {
      // Random grayscale value
      const noise = Math.random() * 255;
      // RGBA in single 32-bit integer (alpha always 255)
      buffer[i] = (255 << 24) | (noise << 16) | (noise << 8) | noise;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // Animation loop with frame rate limit
  function animate(currentTime) {
    animationId = requestAnimationFrame(animate);

    const elapsed = currentTime - lastFrameTime;
    if (elapsed < frameInterval) return;

    lastFrameTime = currentTime - (elapsed % frameInterval);
    drawGrain();
  }

  // Respect reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  resize();
  window.addEventListener('resize', resize, { passive: true });

  if (!prefersReducedMotion) {
    animate(0);
  } else {
    // Static grain for reduced motion
    drawGrain();
  }

  // Cleanup
  return () => {
    if (animationId) cancelAnimationFrame(animationId);
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
}
