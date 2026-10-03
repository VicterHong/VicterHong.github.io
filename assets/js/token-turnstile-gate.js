// Turnstile Token Gate - Professional Style
(function() {
  const TURNSTILE_SITE_KEY = '0x4AAAAAAFMyWUdxNriDmfym';
  const VERIFY_ENDPOINT = 'https://portfolio-victer.victerphanjaya.workers.dev/api/verify-turnstile';
  const GATE_PASSED_KEY = 'token_gate_passed_' + location.pathname;
  
  // Cek apakah sudah lewat gate
  const gatePassed = sessionStorage.getItem(GATE_PASSED_KEY);
  if (gatePassed) return;
  
  // Generate Ray ID
  function generateRayId() {
    const chars = '0123456789abcdef';
    let id = '';
    for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }
  
  function showGate() {
    const overlay = document.createElement('div');
    overlay.id = 'token-turnstile-gate';
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:#fff;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="max-width:500px;width:100%;text-align:center;">
          <div style="font-size:2rem;font-weight:700;color:#1a1a2e;margin-bottom:40px;">${location.hostname}</div>
          <div style="width:48px;height:48px;border:3px solid #e0e0e0;border-top-color:#6366f1;border-radius:50%;animation:spin 0.8s linear infinite;margin:30px auto;"></div>
          <h1 style="font-size:1.25rem;font-weight:600;color:#1a1a2e;margin-bottom:16px;">Performing security verification</h1>
          <p style="color:#666;font-size:0.95rem;margin-bottom:24px;line-height:1.7;">
            This website uses a security service to protect against malicious bots. 
            This page is displayed while the website verifies you are not a bot.
          </p>
          <div style="background:#f8f9fa;border-radius:12px;padding:24px;margin:24px 0;border:1px solid #e9ecef;">
            <div id="token-turnstile-container" style="min-height:65px;display:flex;justify-content:center;margin:16px 0;"></div>
            <p id="token-gate-status" style="font-size:0.9rem;color:#888;margin-top:12px;">Waiting for verification...</p>
          </div>
          <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e9ecef;font-size:0.8rem;color:#999;font-family:'Courier New',monospace;">
            Ray ID: ${generateRayId()}
          </div>
          <div style="margin-top:40px;font-size:0.75rem;color:#aaa;">
            <p>Performance and Security by <a href="https://www.cloudflare.com" style="color:#6366f1;text-decoration:none;">Cloudflare</a></p>
          </div>
        </div>
      </div>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-color-scheme: dark) {
          #token-turnstile-gate > div:first-child { background: #0f0f1a !important; color: #e0e0e0 !important; }
          #token-turnstile-gate h1 { color: #fff !important; }
          #token-turnstile-gate p { color: #aaa !important; }
          #token-turnstile-gate > div > div:nth-child(5) { background: rgba(255,255,255,0.05) !important; border-color: rgba(255,255,255,0.1) !important; }
        }
      </style>
    `;
    document.body.appendChild(overlay);
    
    if (window.turnstile) {
      window.turnstile.render(document.getElementById('token-turnstile-container'), {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'auto',
        callback: function(token) {
          verifyToken(token, overlay);
        },
        'error-callback': function() {
          document.getElementById('token-gate-status').textContent = 'Verification error. Please refresh.';
        }
      });
    }
  }
  
  async function verifyToken(token, overlay) {
    const statusEl = document.getElementById('token-gate-status');
    statusEl.textContent = 'Verifying token...';
    
    try {
      const response = await fetch(VERIFY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      
      const result = await response.json();
      
      if (result.success) {
        statusEl.textContent = 'Access granted. Loading content...';
        sessionStorage.setItem(GATE_PASSED_KEY, Date.now().toString());
        overlay.style.transition = 'opacity 0.5s ease';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
      } else {
        statusEl.textContent = 'Verification failed. Please try again.';
      }
    } catch (err) {
      statusEl.textContent = 'Connection error. Please refresh.';
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showGate);
  } else {
    showGate();
  }
})();
