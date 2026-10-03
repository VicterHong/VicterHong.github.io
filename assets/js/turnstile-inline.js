/**
 * Turnstile Inline — anti-bot protection
 */

(function() {
  'use strict';
  
  const TURNSTILE_SITE_KEY = '0x4AAAAAAFMyWUdxNriDmfym';
  
  function initTurnstile() {
    const slot = document.getElementById('turnstileSlot');
    if (!slot) return;
    
    // Coba render widget Turnstile
    if (window.turnstile?.render) {
      slot.hidden = false;
      try {
        const id = window.turnstile.render(slot, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: function(token) {
            console.log('Turnstile verified');
          },
        });
        window.turnstileWidgetId = id;
        return;
      } catch(e) {
        console.warn('Turnstile render failed:', e.message);
      }
    }
    
    // Fallback: tambahkan hidden token field
    const form = document.getElementById('requestForm');
    if (form && !form.querySelector('input[name="cf-turnstile-response"]')) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'cf-turnstile-response';
      input.value = 'fallback-' + Date.now();
      form.appendChild(input);
    }
  }
  
  // Expose ke global
  window.initTurnstile = initTurnstile;
  
  // Auto-init saat form dibuka (observer)
  document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('requestAccessBtn');
    if (btn) {
      btn.addEventListener('click', function() {
        // Delay untuk memastikan form terbuka
        setTimeout(initTurnstile, 100);
        setTimeout(initTurnstile, 500);
      });
    }
  });
})();
