/**
 * Masonry Portfolio Layout
 * Pinterest-style grid with staggered heights
 * More dynamic than uniform grid
 */

export function initMasonry() {
  const container = document.querySelector('[data-masonry]');
  if (!container) return;

  const items = Array.from(container.children);
  if (!items.length) return;

  // Check if CSS Grid Masonry is supported (future-proof)
  const supportsGridMasonry = CSS.supports('grid-template-rows', 'masonry');
  
  if (supportsGridMasonry) {
    container.style.gridTemplateRows = 'masonry';
    return; // Native masonry, no JS needed
  }

  // Fallback: JS-based masonry layout
  function layout() {
    // Get column count from CSS (responsive)
    const columnCount = parseInt(getComputedStyle(container).getPropertyValue('--masonry-columns') || 3);
    const gap = parseInt(getComputedStyle(container).gap) || 24;
    
    // Reset container height
    container.style.position = 'relative';
    
    // Track column heights
    const columns = Array(columnCount).fill(0);
    
    items.forEach((item, i) => {
      // Find shortest column
      const shortestColumn = columns.indexOf(Math.min(...columns));
      
      // Position item
      const x = shortestColumn * (item.offsetWidth + gap);
      const y = columns[shortestColumn];
      
      item.style.position = 'absolute';
      item.style.left = `${x}px`;
      item.style.top = `${y}px`;
      
      // Update column height
      columns[shortestColumn] += item.offsetHeight + gap;
    });
    
    // Set container height to tallest column
    container.style.height = `${Math.max(...columns)}px`;
  }

  // Throttled resize handler
  let resizeTimer;
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 100);
  }

  window.addEventListener('resize', handleResize, { passive: true });
  
  // Initial layout after images load
  const images = container.querySelectorAll('img');
  let loadedCount = 0;
  
  function checkAllLoaded() {
    loadedCount++;
    if (loadedCount === images.length) {
      layout();
    }
  }
  
  if (images.length === 0) {
    layout();
  } else {
    images.forEach(img => {
      if (img.complete) {
        checkAllLoaded();
      } else {
        img.addEventListener('load', checkAllLoaded);
        img.addEventListener('error', checkAllLoaded); // Count errors too
      }
    });
  }

  // Re-layout on content changes (MutationObserver)
  const observer = new MutationObserver(() => {
    layout();
  });
  
  observer.observe(container, { childList: true, subtree: true });

  // Cleanup
  return () => {
    window.removeEventListener('resize', handleResize);
    observer.disconnect();
  };
}
