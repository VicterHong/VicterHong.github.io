/**
 * Cloudflare Managed Challenge — replikasi alur & tampilan.
 *
 * KUNCI TAMPILAN (seperti ko-fi.com):
 *   Widget dirender dengan appearance: 'always' — lihat catatan di widgetOptions()
 *   tentang kenapa 'interaction-only' DIGANTI (gate bisa menggantung).
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

  /* ── Bahasa ─────────────────────────────────────────────────────────────
     Teks gate mengikuti bahasa perangkat pengunjung, sama seperti Cloudflare.
     Sumbernya cf-gate-i18n.js (dimuat sebelum berkas ini). Kalau berkas itu
     gagal dimuat, dipakai objek kosong — semua teks jatuh ke Inggris lewat
     cadangan per-kunci, jadi gate tidak pernah menampilkan `undefined`. */
  var I18N = window.CF_GATE_I18N || null;
  var LANG = I18N ? I18N.detect() : 'en';
  var T = I18N ? I18N.for(LANG) : {
    title: 'Verifying you are human',
    lead: 'This website uses a security service to protect against malicious bots.',
    success: 'Verification successful. Waiting for response from',
    noscript: 'Enable JavaScript and cookies to continue',
    retry: 'Verification could not load.',
    retryLink: 'Reload page',
    rayId: 'Ray ID',
    footer: 'Performance and Security by',
    privacy: 'Privacy',
    ariaBusy: 'Verification in progress'
  };

  /**
   * Isi teks berbahasa ke elemen dalam gate.
   *
   * @param {Element|Document} root Wadah pencarian.
   * @param {boolean} isGatePage true kalau halaman INI gate-nya sendiri
   *        (index.html). Hanya di situ atribut `lang` dokumen boleh diubah.
   *
   * ── KENAPA `isGatePage` PERLU ─────────────────────────────────────────────
   *
   * Di index.html, seluruh halaman adalah gate — jadi `<html lang>` harus
   * mengikuti bahasa pengunjung; itu bahasa dokumen yang sebenarnya.
   *
   * Di home.html, gate hanyalah lapisan sementara di atas konten yang
   * BERBAHASA INDONESIA. Mengubah `<html lang="en">` di sana akan berbohong
   * ke mesin baca layar dan mesin pencari: mereka akan melafalkan teks
   * Indonesia dengan aturan Inggris. Jadi di halaman konten, hanya elemen
   * gate-nya yang diberi `lang` — dokumennya tetap `id`.
   */
  function applyLanguage(root, isGatePage) {
    var map = [
      ['[data-cf-t="title"]', T.title],
      ['[data-cf-t="lead"]', T.lead],
      ['[data-cf-t="success"]', T.success],
      ['[data-cf-t="noscript"]', T.noscript],
      ['[data-cf-t="rayId"]', T.rayId],
      ['[data-cf-t="privacy"]', T.privacy],
      ['[data-cf-t="footer"]', T.footer]
    ];
    for (var i = 0; i < map.length; i++) {
      var nodes = root.querySelectorAll(map[i][0]);
      for (var j = 0; j < nodes.length; j++) nodes[j].textContent = map[i][1];
    }

    // Elemen gate itu sendiri: root bisa berupa dokumen ATAU elemen #cf-gate
    // (mode statis di index.html). Dua-duanya harus ditangani.
    var gate = (root.id === 'cf-gate') ? root : root.querySelector('#cf-gate');
    if (gate) gate.setAttribute('lang', LANG);

    if (isGatePage) document.documentElement.setAttribute('lang', LANG);
  }

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

  /**
   * Kirim token ke server untuk diverifikasi.
   *
   * ── KENAPA PAKAI TIMEOUT (BUG YANG DIPERBAIKI) ──────────────────────────
   * Sebelumnya `fetch` dipanggil tanpa batas waktu. Di jaringan seluler,
   * permintaan bisa MENGGANTUNG tanpa error dan tanpa respons — fetch baru
   * gagal setelah timeout bawaan browser (~300 detik di beberapa browser).
   *
   * Selama itu, gate tetap menampilkan "Memeriksa..." dan pengunjung tidak
   * punya cara melanjutkan. Dengan timeout 12 detik, kegagalan terdeteksi
   * cepat dan alur coba-ulang bisa jalan.
   *
   * AbortController dipakai karena itu satu-satunya cara membatalkan fetch
   * dari sisi klien. Setelah dibatalkan, promise-nya reject dan rantai
   * .catch di verifyToken() yang menangani.
   */
  function postVerify(url, token) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .finally(function () { if (timer) clearTimeout(timer); });
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
   * language: 'auto' — dokumentasi Turnstile: "auto (default): Uses the
   * visitor's browser language preference." Sebelumnya dipaksa 'id', sehingga
   * pengunjung Jepang melihat widget berbahasa Indonesia meski halaman mereka
   * sudah berbahasa Jepang. 'auto' membuat widget dan halaman gate selalu
   * sejalan, dan Cloudflare yang menerjemahkan (bukan kita).
   * Kalau bahasa tidak didukung, Turnstile jatuh ke Inggris — sama seperti
   * cadangan kita sendiri di cf-gate-i18n.js.
   */
  /**
   * Opsi render widget Turnstile.
   *
   * ── PERUBAHAN: `interaction-only` → `always` (BUG YANG DIPERBAIKI) ──────
   *
   * Sebelumnya memakai `appearance: 'interaction-only'`. Dokumentasi
   * Cloudflare: "the widget is not shown unless there is an interaction
   * required". Niatnya bagus — pengunjung tidak melihat apa-apa kalau
   * Cloudflare yakin dia manusia.
   *
   * MASALAHNYA: kalau Cloudflare MEMUTUSKAN perlu interaksi, widget muncul —
   * tapi itu terjadi setelah penilaian awal. Pada jaringan seluler dengan
   * latensi tinggi, penilaian itu bisa memakan 10-15 detik, dan selama itu
   * pengunjung melihat "Memeriksa..." tanpa apa-apa. Kalau penilaian gagal
   * (mis. sebagian permintaan internal Turnstile diblokir operator), widget
   * TIDAK PERNAH muncul dan gate menggantung.
   *
   * `always` menampilkan widget sejak awal. Untuk kasus normal (Cloudflare
   * yakin manusia), widget menyelesaikan dirinya sendiri dalam ~1 detik
   * tanpa interaksi — pengunjung hanya melihatnya sekilas. Untuk kasus sulit,
   * widget SUDAH ADA di layar dan bisa diinteraksi.
   *
   * ── `size: 'flexible'` → `normal` (BUG KEDUA) ──────────────────────────
   * `flexible` membuat widget menyesuaikan lebar container. Container di sini
   * `max-width: 320px` dengan `display: grid` — kombinasi itu bisa membuat
   * widget berukuran 0×0 di beberapa browser, sehingga tidak terlihat dan
   * tidak bisa diklik. `normal` memakai ukuran tetap 300×65 yang selalu
   * bekerja di mana pun.
   *
   * ── `retry: 'auto'` (BARU) ─────────────────────────────────────────────
   * Turnstile mencoba ulang sendiri kalau percobaan pertama gagal karena
   * masalah jaringan. Ini yang paling menolong di koneksi seluler tidak
   * stabil — tanpa ini, kegagalan sesaat langsung jadi kegagalan permanen.
   */
  function widgetOptions(onToken, onRetry) {
    return {
      sitekey: cfg().siteKey,
      theme: 'dark',
      // Selalu tampil: pengunjung bisa berinteraksi kapan pun Cloudflare minta.
      appearance: 'always',
      language: 'auto',
      // Ukuran tetap 300×65 — selalu bekerja, tidak bergantung container.
      size: 'normal',
      // Coba ulang otomatis saat gagal jaringan.
      retry: 'auto',
      'refresh-expired': 'auto',
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

    // index.html ADALAH halaman gate — jadi `lang` dokumen boleh diubah.
    applyLanguage(root, true);

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

      // Batalkan pemantau sebelumnya kalau render dipanggil ulang —
      // tanpa ini, beberapa timer menumpuk dan petunjuk muncul terlalu cepat.
      if (batalkanPantau) batalkanPantau();
      batalkanPantau = pantauToken(root, null);

      window.turnstile.render(slot, widgetOptions(
        function (token) {
          // Token datang → hentikan pemantau. Kalau verifikasi server gagal,
          // renderWidget() dipanggil ulang dan pemantau baru dipasang.
          if (batalkanPantau) { batalkanPantau(); batalkanPantau = null; }
          verifyToken(token, go, renderWidget);
        },
        renderWidget
      ));
    }

    // Pemegang fungsi pembatal — dideklarasikan di scope staticGate supaya
    // renderWidget() bisa membatalkan pemantau dari render sebelumnya.
    var batalkanPantau = null;

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
      '    <h2 class="cf-sub" data-cf-t="title"></h2>',
      '    <p class="cf-lead" data-cf-t="lead"></p>',
      '    <div class="cf-status" id="cf-checking" role="status" aria-live="polite">',
      '      <div class="cf-ring" aria-hidden="true"><div></div><div></div><div></div><div></div></div>',
      '    </div>',
      '    <div class="cf-status cf-hidden" id="cf-success">',
      '      <h2 class="cf-status-title"><span data-cf-t="success"></span> <span data-cf-host></span><span class="cf-dots"></span></h2>',
      '    </div>',
      '    <div id="cf-widget"></div>',
      '    <noscript><p class="cf-noscript" data-cf-t="noscript"></p></noscript>',
      '  </div>',
      '</div>',
      '<div class="footer" role="contentinfo">',
      '  <div class="footer-inner">',
      '    <div class="footer-wrapper">',
      '      <div class="ray-id"><span data-cf-t="rayId"></span>: <code data-cf-ray></code></div>',
      '      <div class="footer-link-wrapper">',
      '        <span class="footer-text"><span data-cf-t="footer"></span> <a rel="noopener noreferrer" href="https://www.cloudflare.com" target="_blank">Cloudflare</a></span>',
      '        <span class="footer-divider"></span>',
      '        <a target="_blank" rel="noopener noreferrer" href="https://www.cloudflare.com/privacypolicy/" class="footer-text" data-cf-t="privacy"></a>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(root);
    fillStatics(root);
    // Halaman konten: gate hanya lapisan sementara, `lang` dokumen tetap `id`.
    applyLanguage(root, false);

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

      if (batalkanPantau) batalkanPantau();
      batalkanPantau = pantauToken(root, null);

      window.turnstile.render(slot, widgetOptions(
        function (token) {
          if (batalkanPantau) { batalkanPantau(); batalkanPantau = null; }
          verifyToken(token, go, renderWidget);
        },
        renderWidget
      ));
    }

    var batalkanPantau = null;

    return { render: renderWidget };
  }

  /* ── Mulai ────────────────────────────────────────────────────────────── */

  /**
   * Petunjuk muat ulang — JALAN KELUAR kalau verifikasi menggantung.
   *
   * ── KENAPA INI PENTING (BUG YANG DIPERBAIKI) ─────────────────────────────
   * Sebelumnya fungsi ini HANYA dipanggil kalau LIBRARY Turnstile gagal
   * termuat dalam 12 detik. Tidak ada timeout untuk menunggu TOKEN.
   *
   * Akibatnya: kalau library termuat (skrip 200 OK) tapi Turnstile tidak
   * pernah memanggil callback — mis. jaringan seluler memblokir sebagian
   * permintaan internalnya, atau Cloudflare memutuskan perlu interaksi
   * sementara widget disembunyikan (interaction-only) — gate MENGGANTUNG
   * SELAMANYA. Pengunjung melihat "Memeriksa..." tanpa akhir dan tidak punya
   * cara apa pun untuk melanjutkan.
   *
   * Sekarang fungsi ini dipanggil dari TIGA tempat:
   *   1. Library tidak termuat dalam 12 detik
   *   2. Library termuat tapi token tidak datang dalam 20 detik
   *   3. Token datang tapi verifikasi server gagal berulang
   *
   * Tombol "Coba lagi" MEMUAT ULANG halaman — itu satu-satunya cara memaksa
   * Turnstile memulai tantangan dari nol. `location.reload()` dipakai, bukan
   * `turnstile.reset()`, karena reset tidak menolong kalau akar masalahnya
   * jaringan.
   */
  function showLoadHint(root) {
    var box = root.querySelector('#cf-checking');
    if (!box || box.querySelector('.cf-load-hint')) return;
    var p = document.createElement('p');
    p.className = 'cf-load-hint';
    p.style.marginTop = '1rem';
    // Teks dari kamus bahasa — bukan hardcode Indonesia.
    p.textContent = T.retry + ' ';
    // Tombol, bukan tautan kosong. `href=""` sebelumnya memuat ulang halaman
    // tanpa penjelasan; tombol memberi sasaran yang jelas untuk ditekan.
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = T.retryLink;
    b.style.cssText = 'background:none;border:0;padding:0;margin:0;'
      + 'color:inherit;text-decoration:underline;cursor:pointer;'
      + 'font:inherit;text-underline-offset:2px;';
    b.addEventListener('click', function () { location.reload(); });
    p.appendChild(b);
    p.appendChild(document.createTextNode('.'));
    box.appendChild(p);
  }

  /**
   * Pantau apakah token Turnstile datang dalam batas waktu.
   *
   * Kalau tidak, tampilkan petunjuk muat ulang — supaya pengunjung TIDAK
   * terjebak di layar "Memeriksa..." tanpa akhir.
   *
   * 20 detik dipilih dari pengukuran: di jaringan seluler lambat, tantangan
   * Turnstile bisa butuh 8-12 detik. Di bawah 15 detik akan salah memicu
   * pada koneksi yang sebenarnya masih bekerja; di atas 25 detik pengunjung
   * sudah keburu menutup halaman.
   *
   * Dipanggil setiap kali widget dirender (termasuk saat coba ulang), dan
   * dibatalkan begitu token datang.
   */
  function pantauToken(root, saatTokenDatang) {
    var timer = setTimeout(function () {
      showLoadHint(root);
    }, 20000);
    // Fungsi pembatal — dipanggil dari callback token.
    return function () { clearTimeout(timer); };
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
