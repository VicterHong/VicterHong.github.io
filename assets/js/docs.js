/**
 * Panduan penggunaan — daftar isi, pencarian, salin.
 *
 * Semua ikon memakai SVG inline (bukan emoji) supaya:
 *   - tampil konsisten di semua OS/browser
 *   - warna mengikuti CSS (currentColor)
 *   - screen reader membacakan teks, bukan nama emoji
 *
 * Ringan: tanpa dependency eksternal, semua logika client-side.
 */

import { icon, iconHtml } from './icons.js';

(function () {
  'use strict';

  var toc = document.getElementById('toc');
  var content = document.getElementById('docContent');
  if (!toc || !content) return;

  // ── 0. Ganti penanda ikon di HTML dengan SVG ───────────────────────────────
  // Elemen ber-atribut data-icon="nama" diganti SVG dari katalog icons.js.
  document.querySelectorAll('[data-icon]').forEach(function (el) {
    var svg = icon(el.dataset.icon, {
      size: Number(el.dataset.iconSize) || 16,
    });
    if (svg) el.replaceWith(svg);
  });

  // ── 1. Daftar isi otomatis dari heading (accordion) ────────────────────────
  //
  // Versi lama menampilkan 7 bagian + 21 sub sekaligus (28 tautan). Pengunjung
  // yang mencari "Batas laju" harus memindai semuanya. Sekarang jadi accordion:
  // 7 baris saja, sub muncul saat bagiannya dibuka.
  //
  // Pola ini dari dokumentasi Stripe/Vercel/Linear. Satu terbuka pada satu
  // waktu — kalau semua bisa terbuka, daftarnya kembali panjang dan accordion
  // kehilangan gunanya.
  var headings = content.querySelectorAll('h2[id], h3[id]');
  var panels = [];       // { bagian, tautan[] } — untuk observer & auto-buka

  if (headings.length) {
    var frag = document.createDocumentFragment();
    var bagianKini = null;   // panel bagian yang sedang dibangun
    var daftarSub = null;    // <ul> tempat sub-bagian ditaruh

    headings.forEach(function (h) {
      var isH2 = h.tagName === 'H2';
      var judul = h.textContent.replace(/^\s*\d+\s*/, '').trim();

      if (isH2) {
        // ── Bagian utama: jadi tombol accordion ─────────────────────────────
        var blok = document.createElement('div');
        blok.className = 'toc-bagian';

        var tombol = document.createElement('button');
        tombol.type = 'button';
        tombol.className = 'toc-judul';
        tombol.setAttribute('aria-expanded', 'false');
        tombol.dataset.target = h.id;

        var num = h.querySelector('.sec-num');
        if (num) {
          var span = document.createElement('span');
          span.className = 'toc-num';
          span.textContent = num.textContent.trim();
          tombol.appendChild(span);
        }

        var teks = document.createElement('span');
        teks.className = 'toc-judul-teks';
        teks.textContent = judul;
        tombol.appendChild(teks);

        // Chevron dari CSS (border), bukan SVG — rotasinya jadi animasi
        // transform yang murah.
        var panah = document.createElement('span');
        panah.className = 'toc-panah';
        panah.setAttribute('aria-hidden', 'true');
        tombol.appendChild(panah);

        blok.appendChild(tombol);

        daftarSub = document.createElement('ul');
        daftarSub.className = 'toc-sub';
        daftarSub.id = 'toc-sub-' + h.id;
        tombol.setAttribute('aria-controls', daftarSub.id);
        blok.appendChild(daftarSub);

        frag.appendChild(blok);

        bagianKini = { id: h.id, tombol: tombol, daftar: daftarSub, tautan: [] };
        panels.push(bagianKini);
        blok.dataset.bagian = h.id;
      } else if (bagianKini) {
        // ── Sub-bagian: masuk ke daftar bagian induknya ──────────────────────
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + h.id;
        a.className = 'toc-link';
        a.textContent = h.textContent.trim();
        li.appendChild(a);
        bagianKini.daftar.appendChild(li);
        bagianKini.tautan.push(a);
      }
    });

    toc.appendChild(frag);
  }

  // ── 1a. PANEL NAVIGASI GESER untuk MOBILE ──────────────────────────────────
  //
  // ── POLA (dari dokumentasi Claude/Stripe/Vercel) ────────────────────────────
  // Di layar kecil, daftar isi tidak memakan ruang halaman. Ia disembunyikan
  // dan muncul sebagai panel yang meluncur dari kiri saat tombol ditekan.
  //
  // Tiga cara menutup — semua yang wajar dicoba pengguna:
  //   1. Tekan lapisan gelap di belakang panel
  //   2. Tekan Escape
  //   3. Pilih satu tautan (panel menutup sendiri supaya tujuan langsung terlihat)
  //
  // Fokus keyboard dikembalikan ke tombol pemicu saat panel ditutup — tanpa
  // itu, pengguna keyboard tersesat di elemen yang sudah tidak terlihat.
  var navBuka = document.getElementById('docsNavBuka');
  var navScrim = document.getElementById('docsNavScrim');

  if (navBuka && navScrim) {
    var bagianUntukJumlah = toc.querySelectorAll('.toc-bagian').length;
    var labelJumlah = document.getElementById('docsNavJumlah');
    if (labelJumlah && bagianUntukJumlah) {
      labelJumlah.textContent = bagianUntukJumlah + ' bagian';
    }

    var bukaPanel = function () {
      toc.classList.add('is-terbuka');
      navScrim.classList.add('is-tampil');
      navBuka.setAttribute('aria-expanded', 'true');
      // Kunci scroll halaman selama panel terbuka — kalau tidak, halaman di
      // belakang ikut bergeser saat pengguna menggeser panel.
      document.body.style.overflow = 'hidden';
    };

    var tutupPanel = function (kembalikanFokus) {
      toc.classList.remove('is-terbuka');
      navScrim.classList.remove('is-tampil');
      navBuka.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (kembalikanFokus) navBuka.focus();
    };

    navBuka.addEventListener('click', function () {
      if (toc.classList.contains('is-terbuka')) {
        tutupPanel(true);
      } else {
        bukaPanel();
      }
    });

    navScrim.addEventListener('click', function () { tutupPanel(true); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toc.classList.contains('is-terbuka')) {
        e.preventDefault();
        tutupPanel(true);
      }
    });

    // Pilih tautan → panel menutup supaya tujuan langsung terlihat.
    // Tidak mengembalikan fokus ke tombol: pengguna sedang menuju konten,
    // memindahkan fokus ke tombol akan membatalkan lompatannya.
    toc.addEventListener('click', function (e) {
      var tautan = e.target.closest('a');
      if (tautan && toc.classList.contains('is-terbuka')) tutupPanel(false);
    });

    // Layar diperbesar ke ukuran desktop saat panel terbuka → bersihkan
    // keadaan, kalau tidak `body.overflow = hidden` ikut terbawa dan
    // halaman desktop tidak bisa digeser.
    var mq = window.matchMedia('(min-width: 901px)');
    var tanganiLebar = function (e) { if (e.matches) tutupPanel(false); };
    if (mq.addEventListener) mq.addEventListener('change', tanganiLebar);
    else if (mq.addListener) mq.addListener(tanganiLebar);
  }

  // ── 1c. Pemilih bahasa antarmuka ───────────────────────────────────────────
  //
  // ── KENAPA HANYA LABEL, BUKAN ISI ───────────────────────────────────────────
  // Menerjemahkan seluruh panduan berarti dua salinan konten yang harus
  // dirawat bersamaan — dan versi yang tertinggal akan menyesatkan. Yang
  // diterjemahkan di sini hanya label ANTARMUKA (tombol, judul panel,
  // placeholder pencarian), yang jumlahnya kecil dan stabil.
  //
  // Pilihan disimpan di localStorage supaya tidak perlu dipilih ulang tiap
  // kunjungan. Kalau penyimpanan diblokir (mode privat), halaman tetap
  // berfungsi — pilihan hanya tidak bertahan.
  var KAMUS = {
    id: {
      buka: 'Daftar isi',
      tutup: 'Tutup daftar isi',
      kepalaPanel: 'Daftar isi',
      bahasaLabel: 'Bahasa',
      cari: 'Cari topik…',
      bagian: 'bagian'
    },
    en: {
      buka: 'Table of contents',
      tutup: 'Close table of contents',
      kepalaPanel: 'Table of contents',
      bahasaLabel: 'Language',
      cari: 'Search topics…',
      bagian: 'sections'
    }
  };

  var pilihBahasa = document.getElementById('docsBahasa');

  function terapkanBahasa(kode) {
    var k = KAMUS[kode] || KAMUS.id;

    if (navBuka) {
      var labelBuka = navBuka.querySelector('span:not(.docs-bilah-jumlah)');
      if (labelBuka) labelBuka.textContent = k.buka;
      navBuka.setAttribute('aria-label', k.buka);
    }
    if (navScrim) navScrim.setAttribute('aria-label', k.tutup);
    if (labelJumlah) labelJumlah.textContent = bagianUntukJumlah + ' ' + k.bagian;

    var labelBahasa = toc.querySelector('.toc-bahasa-label');
    if (labelBahasa) labelBahasa.textContent = k.bahasaLabel;

    var inputCari = document.getElementById('docSearch');
    if (inputCari) inputCari.placeholder = k.cari;

    // Judul panel (::before) dibaca CSS dari atribut data — CSS tidak bisa
    // membaca variabel JS.
    toc.dataset.judulPanel = k.kepalaPanel;

    document.documentElement.lang = kode;
  }

  if (pilihBahasa) {
    var bahasaTersimpan = null;
    try { bahasaTersimpan = localStorage.getItem('docsBahasa'); } catch (e) { /* mode privat */ }

    if (bahasaTersimpan && KAMUS[bahasaTersimpan]) {
      pilihBahasa.value = bahasaTersimpan;
      terapkanBahasa(bahasaTersimpan);
    }

    pilihBahasa.addEventListener('change', function () {
      terapkanBahasa(pilihBahasa.value);
      try { localStorage.setItem('docsBahasa', pilihBahasa.value); } catch (e) { /* abaikan */ }
    });
  }

  // ── 1d. Menu aksi (titik tiga) ─────────────────────────────────────────────
  //
  // Pola dari Claude Code Docs ("More actions"). Isinya aksi halaman yang
  // jarang dipakai — ditaruh di balik satu tombol supaya tidak memenuhi layar,
  // tapi tetap ada saat dibutuhkan.
  //
  // Menu ditutup dengan cara yang sama seperti panel: klik di luar, Escape.
  // Tanpa itu, menu menggantung dan menghalangi konten di bawahnya.
  var aksiBtn = document.getElementById('docsAksi');
  var aksiMenu = document.getElementById('docsAksiMenu');

  if (aksiBtn && aksiMenu) {
    var tutupMenu = function () {
      aksiMenu.hidden = true;
      aksiBtn.setAttribute('aria-expanded', 'false');
    };

    aksiBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var terbuka = !aksiMenu.hidden;
      if (terbuka) {
        tutupMenu();
      } else {
        aksiMenu.hidden = false;
        aksiBtn.setAttribute('aria-expanded', 'true');
      }
    });

    // Klik di luar menu menutupnya. Listener di document, bukan di menu —
    // klik pada elemen mana pun selain menu harus menutup.
    document.addEventListener('click', function (e) {
      if (!aksiMenu.hidden && !aksiMenu.contains(e.target) && e.target !== aksiBtn) {
        tutupMenu();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !aksiMenu.hidden) {
        e.preventDefault();
        tutupMenu();
        aksiBtn.focus();
      }
    });

    // ── Aksi: salin tautan ────────────────────────────────────────────────────
    var btnSalin = document.getElementById('docsSalinTautan');
    if (btnSalin) {
      btnSalin.addEventListener('click', function () {
        var url = location.href;
        var teksAsli = btnSalin.textContent.trim();
        var selesai = function () {
          btnSalin.textContent = 'Tautan disalin';
          setTimeout(function () { btnSalin.textContent = teksAsli; tutupMenu(); }, 1200);
        };
        // Clipboard API butuh konteks aman (HTTPS) dan izin. Kalau gagal,
        // fallback ke prompt supaya pengguna tetap bisa menyalin manual.
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(selesai, function () {
            window.prompt('Salin tautan ini:', url);
            tutupMenu();
          });
        } else {
          window.prompt('Salin tautan ini:', url);
          tutupMenu();
        }
      });
    }

    // ── Aksi: cetak ───────────────────────────────────────────────────────────
    // CSS sudah punya @media print yang menyembunyikan navigasi — lihat
    // bagian "print" di docs.css.
    var btnCetak = document.getElementById('docsCetak');
    if (btnCetak) {
      btnCetak.addEventListener('click', function () {
        tutupMenu();
        window.print();
      });
    }

    // ── Aksi: kembali ke atas ─────────────────────────────────────────────────
    // `behavior: 'smooth'` dihormati browser; kalau pengguna memilih gerak
    // minimum, browser otomatis melompat tanpa animasi.
    var btnKeAtas = document.getElementById('docsKeAtas');
    if (btnKeAtas) {
      btnKeAtas.addEventListener('click', function () {
        tutupMenu();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  // ── 1b. Buka-tutup bagian ──────────────────────────────────────────────────
  //
  // Tombol + aria-expanded, bukan <details>: <details> tidak bisa dibuat
  // eksklusif tanpa JS juga, dan gayanya sulit diseragamkan antar-browser.
  function tutupSemua(kecuali) {
    panels.forEach(function (p) {
      if (p === kecuali) return;
      p.tombol.setAttribute('aria-expanded', 'false');
      p.daftar.hidden = true;
      p.tombol.closest('.toc-bagian').classList.remove('is-terbuka');
    });
  }

  function buka(p) {
    p.tombol.setAttribute('aria-expanded', 'true');
    p.daftar.hidden = false;
    p.tombol.closest('.toc-bagian').classList.add('is-terbuka');
  }

  panels.forEach(function (p) {
    p.daftar.hidden = true;   // semua tertutup saat halaman dimuat
    p.tombol.addEventListener('click', function () {
      var terbuka = p.tombol.getAttribute('aria-expanded') === 'true';
      if (terbuka) {
        // Klik kedua membalikkan yang pertama → semua tertutup.
        p.tombol.setAttribute('aria-expanded', 'false');
        p.daftar.hidden = true;
        p.tombol.closest('.toc-bagian').classList.remove('is-terbuka');
      } else {
        tutupSemua(p);
        buka(p);
      }
    });
  });

  // ── 2. Sorot bagian yang sedang dibaca + perbarui breadcrumb ──────────────
  var links = toc.querySelectorAll('.toc-link');
  var crumbKini = document.getElementById('docsCrumbKini');

  /** Ambil judul bagian (h2) dari sebuah id heading. */
  function judulBagian(id) {
    var h = content.querySelector('h2[id="' + id + '"]');
    if (h) return h.textContent.replace(/^\s*\d+\s*/, '').trim();
    // Heading adalah h3 — ambil h2 terdekat sebelumnya.
    var h3 = content.querySelector('h3[id="' + id + '"]');
    if (!h3) return '';
    var semuaH2 = Array.prototype.slice.call(content.querySelectorAll('h2[id]'));
    var sebelumnya = null;
    semuaH2.forEach(function (h2) {
      if (h2.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_FOLLOWING) sebelumnya = h2;
    });
    return sebelumnya ? sebelumnya.textContent.replace(/^\s*\d+\s*/, '').trim() : '';
  }

  if (links.length && 'IntersectionObserver' in window) {
    var byId = {};
    links.forEach(function (l) { byId[l.getAttribute('href').slice(1)] = l; });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var link = byId[e.target.id];
        if (!link) return;
        if (e.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('is-active'); });
          link.classList.add('is-active');

          // Perbarui breadcrumb — pembaca tahu sedang di bagian mana.
          if (crumbKini) {
            var nama = judulBagian(e.target.id);
            if (nama) crumbKini.textContent = nama;
          }

          // Auto-buka bagian yang sedang dibaca. Tanpa ini, pengunjung yang
          // menggulir ke bagian 4 melihat semua tertutup dan tidak tahu
          // posisinya. Stripe melakukan hal yang sama.
          var bagian = panels.find(function (p) {
            return p.id === e.target.id || p.tautan.indexOf(link) >= 0;
          });
          if (bagian && bagian.tombol.getAttribute('aria-expanded') !== 'true') {
            tutupSemua(bagian);
            buka(bagian);
          }
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

    headings.forEach(function (h) { observer.observe(h); });
  }

  // ── 3. Pencarian ───────────────────────────────────────────────────────────
  var search = document.getElementById('docSearch');
  if (!search) return;

  var sections = Array.prototype.slice.call(content.querySelectorAll('section.doc-section'));
  var empty = document.getElementById('docEmpty');

  // Isi ikon di keadaan kosong (sekali saja).
  if (empty && !empty.querySelector('svg')) {
    var emptyIcon = icon('search', { size: 28 });
    if (emptyIcon) empty.insertBefore(emptyIcon, empty.firstChild);
  }

  function normalize(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function filter() {
    var q = normalize(search.value.trim());
    var visible = 0;

    sections.forEach(function (sec) {
      var text = normalize(sec.textContent);
      var match = !q || text.indexOf(q) !== -1;
      sec.classList.toggle('is-hidden', !match);
      if (match) visible++;
    });

    if (empty) empty.classList.toggle('hidden', visible > 0 || !q);
  }

  var timer = null;
  search.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(filter, 120);
  });

  // Tombol Escape membersihkan pencarian.
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { search.value = ''; filter(); }
  });

  // ── 4. Salin contoh perintah (tombol ber-ikon) ─────────────────────────────
  content.querySelectorAll('.copy-btn').forEach(function (btn) {
    if (!btn.dataset.iconReady) {
      btn.innerHTML = iconHtml('copy', { size: 13 }) + '<span>Salin</span>';
      btn.dataset.iconReady = '1';
    }
  });

  content.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-btn');
    if (!btn) return;
    var code = btn.parentElement.querySelector('code');
    if (!code) return;

    var text = code.textContent;
    var done = function () {
      btn.innerHTML = iconHtml('check', { size: 13 }) + '<span>Tersalin</span>';
      btn.classList.add('is-done');
      setTimeout(function () {
        btn.innerHTML = iconHtml('copy', { size: 13 }) + '<span>Salin</span>';
        btn.classList.remove('is-done');
      }, 1800);
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  });

  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { /* abaikan */ }
    document.body.removeChild(ta);
  }
})();
