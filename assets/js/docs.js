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

  // ── 2. Sorot bagian yang sedang dibaca ────────────────────────────────────
  var links = toc.querySelectorAll('.toc-link');
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
