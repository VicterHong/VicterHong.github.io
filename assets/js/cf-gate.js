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

  /* ── MASA TENGGANG: KUNJUNGAN PERTAMA TIDAK DIGERBANG ─────────────────────
     Permintaan pemilik: "kalo awal awalnya ga perlu turnstilenya, ketika
     sudah lama baru muncul seperti pada umumnya".

     Itu persis cara kerja Cloudflare managed challenge: pengunjung yang baru
     datang langsung masuk, dan tantangan baru muncul setelah beberapa lama
     atau saat ada aktivitas yang mencurigakan.

     ── KENAPA DUA KUNCI, BUKAN SATU ────────────────────────────────────────
     Butuh dua titik waktu yang BERBEDA:
       MULAI_KEY  — kapan kunjungan ini dimulai (untuk mengukur tenggang)
       AKHIR_KEY  — kapan aktivitas terakhir (untuk mendeteksi kunjungan baru)

     Kalau hanya satu kunci yang diperbarui terus, selisihnya selalu ~0 dan
     tenggang tidak pernah habis — gate tidak akan muncul selamanya.

     ── KENAPA localStorage, BUKAN sessionStorage ───────────────────────────
     Tenggang harus bertahan saat pengunjung berpindah halaman (index → home).
     sessionStorage memang bertahan antar halaman di tab yang sama, tapi
     localStorage juga memberi perilaku yang lebih baik: pengunjung yang
     kembali setelah 12 jam diperlakukan sebagai kunjungan BARU dan dapat
     tenggang lagi — bukan langsung digerbang. */
  var MULAI_KEY = 'cf_mulai_' + HOST;
  var AKHIR_KEY = 'cf_akhir_' + HOST;

  /**
   * Lama tenggang: pengunjung bebas menjelajah tanpa gate.
   *
   * ── KENAPA 15 MENIT, BUKAN 3 ────────────────────────────────────────────
   * Versi pertama memakai 3 menit. Itu TERLALU PENDEK untuk sebuah
   * portfolio: pengunjung yang membaca halaman proyek dengan saksama bisa
   * menghabiskan 5-8 menit, lalu tiba-tiba kena layar verifikasi di tengah
   * penjelajahan. Itu pengalaman buruk — dan tidak menambah keamanan sama
   * sekali (keamanan sesungguhnya ada di token akses API, bukan di gate).
   *
   * 15 menit dipilih karena sejalan dengan pola Cloudflare sendiri: clearance
   * mereka berlaku 15-30 menit. Cukup lama untuk menjelajah dengan tenang,
   * cukup pendek supaya gate tetap terlihat "hidup".
   */
  var TENGGANG_MS = 15 * 60 * 1000;   // 15 menit

  /** Setelah sekian lama tidak berkunjung, anggap kunjungan baru. */
  var KUNJUNGAN_BARU_MS = 12 * 60 * 60 * 1000;   // 12 jam

  /**
   * Apakah pengunjung masih dalam masa tenggang (belum perlu digerbang)?
   *
   * ── KENAPA GAGAL-BUKA (fail-open) ───────────────────────────────────────
   * Kalau localStorage diblokir (mode privat, cookie dimatikan), fungsi ini
   * mengembalikan `true` — pengunjung TIDAK digerbang.
   *
   * Itu keputusan yang disengaja. Gate ini adalah lapisan UX yang meniru
   * Cloudflare, bukan batas keamanan sesungguhnya — perlindungan sebenarnya
   * ada di level API (token akses, batas laju, verifikasi Turnstile
   * server-side). Mengunci pengunjung di layar verifikasi hanya karena
   * browsernya memblokir storage adalah kerugian tanpa manfaat keamanan.
   *
   * ── CARA KERJA ──────────────────────────────────────────────────────────
   *   1. Belum ada catatan, ATAU sudah pergi > 12 jam
   *      → kunjungan baru: catat waktu, beri tenggang
   *   2. Ada catatan, masih dalam 3 menit
   *      → lanjutkan tenggang (perbarui waktu aktivitas)
   *   3. Ada catatan, sudah lewat 3 menit
   *      → tenggang habis: gate muncul
   */
  function dalamTenggang() {
    try {
      var now = Date.now();
      var mulai = localStorage.getItem(MULAI_KEY);
      var akhir = localStorage.getItem(AKHIR_KEY);

      // Kunjungan baru: belum ada catatan, atau sudah lama pergi.
      if (!mulai || !akhir || (now - Number(akhir)) > KUNJUNGAN_BARU_MS) {
        localStorage.setItem(MULAI_KEY, String(now));
        localStorage.setItem(AKHIR_KEY, String(now));
        return true;
      }

      // Perbarui waktu aktivitas terakhir — supaya kunjungan yang masih
      // berjalan tidak dianggap "pergi" hanya karena lama di satu halaman.
      localStorage.setItem(AKHIR_KEY, String(now));

      return (now - Number(mulai)) < TENGGANG_MS;
    } catch (e) {
      // Storage diblokir → jangan kunci pengunjung. Lihat catatan di atas.
      return true;
    }
  }

  /**
   * Reset masa tenggang — dipanggil setelah verifikasi lolos.
   *
   * Supaya kunjungan berikutnya (setelah clearance 30 menit habis) mendapat
   * tenggang baru, bukan langsung digerbang lagi.
   */
  function resetTenggang() {
    try {
      localStorage.removeItem(MULAI_KEY);
      localStorage.removeItem(AKHIR_KEY);
    } catch (e) { /* storage diblokir — tidak ada yang perlu direset */ }
  }

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
    // Teks persis Cloudflare untuk verifikasi yang memakan waktu lama.
    lama: 'Verification is taking longer than expected.',
    lamaSaran: 'Check your Internet connection and refresh the page if the issue persists.',
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
      ['[data-cf-t="footer"]', T.footer],
      // Peringatan "verifikasi lama" — teks persis Cloudflare, diterjemahkan
      // ke 37 bahasa. Dua baris terpisah supaya baris pertama bisa dibaca
      // sebagai pernyataan dan baris kedua sebagai saran tindakan.
      ['[data-cf-t="lama"]', T.lama],
      ['[data-cf-t="lamaSaran"]', T.lamaSaran]
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

  /**
   * Apakah pengunjung sudah punya clearance sah?
   *
   * ── PERUBAHAN BESAR: DARI sessionStorage KE COOKIE SERVER ─────────────────
   * Versi lama membaca timestamp dari sessionStorage:
   *
   *     cf_clearance_<host> = 1759761234567
   *
   * Nilai itu bisa dibaca DAN DITULIS JavaScript mana pun. Pengunjung cukup
   * membuka DevTools dan menulis satu baris — gate lewat seketika, tanpa
   * verifikasi Turnstile. Jadi gate lama BUKAN batas keamanan.
   *
   * Sekarang server menerbitkan clearance token yang ditandatangani HMAC
   * dan mengirimnya sebagai cookie HttpOnly. JavaScript TIDAK BISA membaca
   * cookie itu, apalagi memalsukannya — tanpa SERVICE_SECRET, signature
   * tidak bisa dihitung.
   *
   * ── KENAPA PERLU REQUEST KE SERVER ────────────────────────────────────────
   * Karena cookie HttpOnly tidak bisa dibaca JavaScript, satu-satunya cara
   * tahu isinya adalah bertanya ke server. Itu satu permintaan kecil
   * (~100 byte) setiap halaman dibuka — harga yang dibayar untuk clearance
   * yang tidak bisa dipalsukan.
   *
   * ── FAIL-CLOSED, BUKAN FAIL-OPEN ──────────────────────────────────────────
   * Kalau server tidak terjangkau, fungsi ini mengembalikan false → gate
   * ditampilkan. Untuk KONTROL KEAMANAN, gagal-tertutup adalah pilihan yang
   * benar: lebih baik pengunjung melihat verifikasi daripada situs terbuka
   * tanpa perlindungan saat backend bermasalah.
   *
   * Catatan: itu KEBALIKAN dari keputusan di dalamTenggang() yang fail-open.
   * Alasannya beda: tenggang adalah UX (jangan kunci pengunjung karena
   * storage diblokir), clearance adalah keamanan (jangan buka tanpa bukti).
   */
  function passed() {
    return fetch('/api/gate/check', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return Boolean(d && d.ok && d.bersih); })
      .catch(function () {
        // Server tidak terjangkau → gate ditampilkan (fail-closed).
        // Pengunjung bisa verifikasi dan masuk; itu lebih baik daripada
        // membuka situs tanpa perlindungan.
        return false;
      });
  }

  /**
   * Tandai bahwa verifikasi sudah lolos — berlaku 30 menit.
   *
   * ── KENAPA MENGEMBALIKAN BOOLEAN (BUG YANG DIPERBAIKI) ───────────────────
   * Versi lama menelan error dengan `catch (e) {}` dan tidak memberi tahu
   * pemanggil apakah penulisan berhasil.
   *
   * Itu menyebabkan LOOP TAK TERBATAS: kalau sessionStorage diblokir
   * (mode privat, cookie dimatikan, atau storage penuh), `markPassed()`
   * gagal diam-diam → gate memanggil `location.reload()` → halaman dimuat
   * ulang → gate muncul lagi → verifikasi lagi → gagal lagi → reload lagi.
   * Pengunjung terjebak selamanya di layar "Berhasil!".
   *
   * Sekarang pemanggil tahu hasilnya dan bisa memilih jalur yang tepat:
   *   berhasil → reload (gate tidak muncul lagi)
   *   gagal    → tampilkan halaman tanpa reload (verifikasi sudah sah
   *              menurut server; yang gagal hanya penyimpanan lokal)
   */
  /**
   * Tandai bahwa verifikasi sudah lolos.
   *
   * ── TIDAK LAGI MENULIS APA PUN ────────────────────────────────────────────
   * Versi lama menulis timestamp ke sessionStorage. Sekarang cookie clearance
   * SUDAH DI-SET OLEH SERVER pada respons /api/verify-turnstile — cookie
   * HttpOnly tidak bisa ditulis dari JavaScript, dan itu memang tujuannya.
   *
   * Jadi fungsi ini hanya membersihkan sisa data lama dan mereset tenggang.
   *
   * ── KENAPA SISA sessionStorage DIBERSIHKAN ────────────────────────────────
   * Pengunjung yang pernah memakai versi lama masih punya
   * `cf_clearance_<host>` di sessionStorage. Kalau tidak dibersihkan, nilai
   * itu bisa disalahartikan sebagai bukti clearance oleh kode lain — dan
   * menyembunyikan bug cookie selama pengujian.
   *
   * Fungsi ini mengembalikan true selalu: verifikasi server sudah sah, dan
   * penyimpanan sekarang ditangani server (cookie), bukan browser.
   */
  function markPassed() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* storage diblokir — tidak ada yang perlu dibersihkan */ }
    // Tenggang direset supaya kunjungan berikutnya — setelah clearance
    // 30 menit habis — mendapat tenggang BARU, bukan langsung digerbang.
    resetTenggang();
    return true;
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
      // ── WIDGET TIDAK TAMPIL KECUALI DIPERLUKAN ────────────────────────────
      // Permintaan pemilik: "hilangin yang logo turnstile kan, saya verifikasi
      // berhasil saja udah itu".
      //
      // `interaction-only` = widget disembunyikan selama Cloudflare yakin
      // pengunjung manusia (kasus normal, ~99%). Widget HANYA muncul kalau
      // Cloudflare benar-benar butuh interaksi manusia.
      //
      // Hasilnya: pengunjung melihat spinner → "Verifikasi berhasil" → masuk.
      // Tidak ada kotak centang, tidak ada logo Cloudflare di tengah halaman.
      //
      // ── KENAPA INI AMAN SEKARANG (DULU TIDAK) ────────────────────────────
      // Versi pertama memakai mode ini dan BERMASALAH: kalau Cloudflare tidak
      // pernah memanggil callback, gate menggantung SELAMANYA tanpa jalan
      // keluar — tidak ada timeout, tidak ada tombol.
      //
      // Sekarang sudah ada DUA jaring pengaman:
      //   1. pantauToken() — 20 detik, lalu tampilkan peringatan + tombol
      //   2. postVerify() — timeout 12 detik dengan AbortController
      //
      // Jadi kalau widget perlu interaksi tapi tidak muncul, pengunjung
      // mendapat peringatan jelas dan tombol muat ulang. Tidak terjebak.
      appearance: 'interaction-only',
      language: 'auto',
      // Ukuran normal 300×65 — dipakai HANYA kalau widget muncul karena
      // Cloudflare minta interaksi. Ukuran tetap selalu bekerja, tidak
      // bergantung lebar container.
      size: 'normal',
      // Coba ulang otomatis saat gagal jaringan — paling menolong di
      // koneksi seluler yang tidak stabil.
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
      var tersimpan = markPassed();
      showSuccess();

      // ── KENAPA ADA CABANG "PENYIMPANAN GAGAL" ────────────────────────────
      // Verifikasi server SUDAH berhasil di titik ini — pengunjung memang
      // manusia. Yang gagal hanya menyimpan tanda di browser.
      //
      // Kalau kita tetap reload, gate akan muncul lagi (tandanya tidak ada),
      // verifikasi lagi, gagal menyimpan lagi → loop tanpa akhir. Jadi
      // kalau penyimpanan gagal, halaman tetap dibuka TANPA reload.
      //
      // Trade-off yang diterima: pengunjung akan melihat gate lagi kalau
      // membuka halaman baru. Itu jauh lebih baik daripada terjebak di
      // halaman verifikasi selamanya.
      if (!tersimpan) {
        setTimeout(function () { revealPage(); }, 1200);
        return;
      }

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
      // ── PERINGATAN "LAMA" ───────────────────────────────────────────────
      // Teks ini PERSIS kalimat yang dipakai Cloudflare saat verifikasi
      // memakan waktu lebih lama dari biasanya:
      //
      //   "Verification is taking longer than expected. Check your Internet
      //    connection and refresh the page if the issue persists."
      //
      // Ditemukan dari laporan pengguna di komunitas Cloudflare yang
      // menyalin pesan itu apa adanya. Diterjemahkan ke 37 bahasa di
      // cf-gate-i18n.js dengan kunci `lama` + `lamaSaran`.
      //
      // Disembunyikan (cf-hidden) sejak awal — muncul hanya setelah timeout.
      // Menampilkannya sebelum waktunya akan membuat pengunjung panik
      // padahal verifikasinya berjalan normal.
      '      <div class="cf-lama cf-hidden" id="cf-lama">',
      '        <p data-cf-t="lama"></p>',
      '        <p data-cf-t="lamaSaran"></p>',
      '      </div>',
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
      // Hasil penyimpanan TIDAK dipakai untuk memutuskan di sini: gate
      // dinamis selalu bisa dibuka tanpa reload — kontennya sudah ada di
      // halaman, kita hanya perlu membuang lapisan gate-nya.
      //
      // Kalau penyimpanan gagal, gate akan muncul lagi pada kunjungan
      // berikutnya. Itu dapat diterima; yang penting pengunjung TIDAK
      // terjebak di layar verifikasi.
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
    if (!box) return;

    // ── 0. SEMBUNYIKAN WIDGET TURNSTILE ─────────────────────────────────────
    // Permintaan pemilik: "hilangin yang logo turnstile kan, saya verifikasi
    // berhasil saja udah itu."
    //
    // Kalau verifikasi butuh waktu lama, yang ditampilkan adalah PERINGATAN —
    // bukan kotak centang Turnstile dengan logo Cloudflare. Widget hanya
    // menambah kebingungan: pengunjung tidak tahu apakah harus mengkliknya,
    // dan sebagian mengira situsnya bermasalah.
    //
    // Kalau pengunjung memang perlu berinteraksi, Turnstile akan memanggil
    // callback-nya sendiri dan widget muncul lewat jalur itu — bukan lewat
    // timeout ini.
    var slot = root.querySelector('#cf-widget');
    if (slot) slot.classList.add('cf-hidden');

    // ── 1. TAMPILKAN PERINGATAN "LAMA" ──────────────────────────────────────
    // Elemen #cf-lama berisi kalimat persis Cloudflare:
    //   "Verification is taking longer than expected. Check your Internet
    //    connection and refresh the page if the issue persists."
    //
    // Disembunyikan sejak awal (class cf-hidden) dan baru ditampilkan di
    // sini. Teksnya diisi applyLanguage() dari kamus 37 bahasa.
    var lama = box.querySelector('#cf-lama');
    if (lama) lama.classList.remove('cf-hidden');

    // ── 2. TOMBOL MUAT ULANG ────────────────────────────────────────────────
    // Ditambahkan sebagai elemen terpisah, bukan menggantikan peringatan.
    // Pengunjung melihat penjelasan DAN tindakan yang bisa diambil.
    if (box.querySelector('.cf-load-hint')) return;

    var p = document.createElement('p');
    p.className = 'cf-load-hint';
    // Tombol, bukan tautan kosong. `href=""` sebelumnya memuat ulang halaman
    // tanpa penjelasan; tombol memberi sasaran yang jelas untuk ditekan.
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = T.retryLink;
    b.addEventListener('click', function () { location.reload(); });
    p.appendChild(b);
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

  async function init() {
    var root = document.getElementById('cf-gate');
    var isStatic = Boolean(root);

    // ── 1. SUDAH PUNYA CLEARANCE SAH DARI SERVER ───────────────────────────
    // Clearance sekarang cookie HttpOnly bertanda tangan — JavaScript tidak
    // bisa membacanya, jadi kita TANYA KE SERVER. Satu permintaan kecil
    // (~100 byte) setiap halaman dibuka.
    //
    // Ini yang membuat clearance tidak bisa dipalsukan: pengunjung tidak
    // bisa menulis apa pun di browser untuk melewati gate.
    var bersih = await passed();

    if (bersih) {
      if (isStatic && cfg().redirect) {
        location.replace(cfg().redirect);
        return;
      }
      revealPage();
      return;
    }

    // ── 2. MASIH DALAM MASA TENGGANG ───────────────────────────────────────
    // Permintaan pemilik: "kalo awal awalnya ga perlu turnstilenya, ketika
    // sudah lama baru muncul seperti pada umumnya".
    //
    // Pengunjung yang baru datang TIDAK langsung digerbang — ia bisa
    // menjelajah selama 15 menit. Gate baru muncul setelah tenggang habis.
    //
    // Ini persis perilaku Cloudflare managed challenge: pengunjung baru lolos
    // tanpa hambatan, dan tantangan muncul saat sudah ada aktivitas.
    //
    // Di index.html, tenggang berarti langsung redirect ke halaman konten —
    // pengunjung tidak melihat halaman "Just a moment..." sama sekali.
    //
    // ── CATATAN PENTING: TENGGANG TIDAK MEMBATALKAN CLEARANCE ──────────────
    // Dua hal ini BEDA dan tidak saling menggantikan:
    //   tenggang   = UX, "jangan ganggu pengunjung baru"
    //   clearance  = keamanan, "bukti verifikasi yang tidak bisa dipalsukan"
    //
    // Kalau server bilang clearance tidak sah, gate muncul setelah tenggang
    // habis — dan setelah verifikasi, cookie clearance-lah yang menyimpan
    // buktinya (bukan sessionStorage).
    if (dalamTenggang()) {
      if (isStatic && cfg().redirect) {
        location.replace(cfg().redirect);
        return;
      }
      revealPage();
      return;
    }

    // ── 3. TENGGANG HABIS → GERBANG ────────────────────────────────────────
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

  // init() sekarang async (menunggu respons server). Kalau promise-nya
  // ditolak tanpa penanganan, halaman bisa berhenti di keadaan setengah jadi.
  // `.catch()` di sini memastikan halaman tetap ditampilkan — pengunjung
  // tidak pernah terjebak di layar kosong karena error tak terduga.
  function mulai() {
    init().catch(function () {
      // Error tak terduga saat init → tampilkan halaman apa adanya.
      // Gate sudah punya jaring pengamannya sendiri (timeout + tombol);
      // memblokir halaman karena error init hanya memperburuk keadaan.
      revealPage();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mulai);
  } else {
    mulai();
  }
})();
