/**
 * Particle System Three.js
 * Premium hero background — replacing Astra
 * Inspired by Bruno Simon + Phantom.Land (modified)
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export function initParticles() {
  const container = document.querySelector('.hero-backdrop');
  if (!container) return;

  // Check reduced motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  // Scene setup
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 50;

  const renderer = new THREE.WebGLRenderer({ 
    alpha: true, 
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x for performance
  
  // Insert before existing video
  const existingVideo = container.querySelector('.hero-video');
  if (existingVideo) {
    container.insertBefore(renderer.domElement, existingVideo);
    existingVideo.style.display = 'none'; // Hide video, use particles instead
  } else {
    container.appendChild(renderer.domElement);
  }
  
  renderer.domElement.className = 'particles-canvas';
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.zIndex = '1';

  // Particles
  const particleCount = window.innerWidth < 768 ? 800 : 1500; // Less on mobile
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);
  
  for (let i = 0; i < particleCount * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 100;     // x
    positions[i + 1] = (Math.random() - 0.5) * 100; // y
    positions[i + 2] = (Math.random() - 0.5) * 100; // z
    
    velocities[i] = (Math.random() - 0.5) * 0.02;
    velocities[i + 1] = (Math.random() - 0.5) * 0.02;
    velocities[i + 2] = (Math.random() - 0.5) * 0.02;
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  // Material with accent color
  const material = new THREE.PointsMaterial({
    size: 0.8,
    color: 0xff7a45, // Accent color
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
  });
  
  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // Mouse interaction
  const mouse = { x: 0, y: 0 };
  let targetRotationX = 0;
  let targetRotationY = 0;
  
  window.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
    targetRotationY = mouse.x * 0.3;
    targetRotationX = mouse.y * 0.3;
  }, { passive: true });

  // Resize handler
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  window.addEventListener('resize', onResize, { passive: true });

  // Animation loop
  let animationId;
  function animate() {
    animationId = requestAnimationFrame(animate);

    // Update particle positions
    const positions = particles.geometry.attributes.position.array;
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] += velocities[i];
      positions[i + 1] += velocities[i + 1];
      positions[i + 2] += velocities[i + 2];
      
      // Wrap around boundaries
      if (Math.abs(positions[i]) > 50) velocities[i] *= -1;
      if (Math.abs(positions[i + 1]) > 50) velocities[i + 1] *= -1;
      if (Math.abs(positions[i + 2]) > 50) velocities[i + 2] *= -1;
    }
    particles.geometry.attributes.position.needsUpdate = true;

    // Smooth camera rotation following mouse
    particles.rotation.x += (targetRotationX - particles.rotation.x) * 0.05;
    particles.rotation.y += (targetRotationY - particles.rotation.y) * 0.05;

    renderer.render(scene, camera);
  }
  
  animate();

  // Cleanup
  return () => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    geometry.dispose();
    material.dispose();
    renderer.domElement.remove();
  };
}
