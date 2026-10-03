// Turnstile Token Gate - Tambahkan ke halaman token
(function() {
  const TURNSTILE_SITE_KEY = '0x4AAAAAAFMyWUdxNriDmfym';
  const VERIFY_ENDPOINT = 'https://portfolio-victer.victerphanjaya.workers.dev/api/verify-turnstile';
  const GATE_PASSED_KEY = 'token_gate_passed_' + location.pathname;
  
  // Cek apakah sudah lewat gate
  const gatePassed = sessionStorage.getItem(GATE_PASSED_KEY);
  if (gatePassed) {
    // Sudah lewat gate dalam sesi ini
    return;
  }
  
  // Tampilkan gate overlay
  function showGate() {
    const overlay = document.createElement('div');
    overlay.id = 'token-turnstile-gate';
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(10,10,15,0.98);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
        <div style="max-width:480px;width:100%;text-align:center;">
          <div style="width:80px;height:80px;margin:0 auto 24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:32px;">🔒</div>
          <h1 style="font-size:1.5rem;font-weight:600;margin-bottom:8px;color:#fff;">Verifikasi Keamanan</h1>
          <p style="color:#888;font-size:0.95rem;margin-bottom:32px;">Akses Token — Protected Content</p>
          <div id="token-turnstile-container" style="margin:20px auto;min-height:65px;display:flex;justify-content:center;"></div>
          <p id="token-gate-status" style="margin-top:16px;font-size:0.9rem;color:#fbbf24;">Melakukan verifikasi keamanan...</p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    // Render Turnstile
    if (window.turnstile) {
      window.turnstile.render(document.getElementById('token-turnstile-container'), {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: function(token) {
          verifyToken(token, overlay);
        },
        'error-callback': function() {
          document.getElementById('token-gate-status').textContent = 'Verifikasi error. Refresh halaman.';
          document.getElementById('token-gate-status').style.color = '#f87171';
        }
      });
    }
  }
  
  async function verifyToken(token, overlay) {
    const statusEl = document.getElementById('token-gate-status');
    statusEl.textContent = 'Verifikasi berhasil. Menunggu response...';
    statusEl.style.color = '#34d399';
    
    try {
      const response = await fetch(VERIFY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      
      const result = await response.json();
      
      if (result.success) {
        statusEl.textContent = 'Akses diterima. Memuat konten...';
        sessionStorage.setItem(GATE_PASSED_KEY, Date.now().toString());
        
        // Animasi fade out
        overlay.style.transition = 'opacity 0.5s ease';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
      } else {
        statusEl.textContent = 'Verifikasi gagal. Coba lagi.';
        statusEl.style.color = '#f87171';
      }
    } catch (err) {
      statusEl.textContent = 'Error koneksi. Refresh halaman.';
      statusEl.style.color = '#f87171';
    }
  }
  
  // Init saat DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showGate);
  } else {
    showGate();
  }
})();
