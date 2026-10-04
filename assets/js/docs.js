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

  // ── 1. Daftar isi otomatis dari heading ────────────────────────────────────
  var headings = content.querySelectorAll('h2[id], h3[id]');
  if (headings.length) {
    var frag = document.createDocumentFragment();
    var lastWasH2 = false;

    headings.forEach(function (h) {
      var isH2 = h.tagName === 'H2';

      // Judul kelompok sebelum H2 berikutnya (pola "section title" MDN).
      if (isH2 && lastWasH2) {
        var group = document.createElement('span');
        group.className = 'toc-group';
        group.textContent = h.textContent.replace(/^\s*\d+\s*/, '').trim();
        frag.appendChild(group);
      }

      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.className = 'toc-link toc-' + h.tagName.toLowerCase();

      if (isH2) {
        // Nomor bagian dipisah jadi elemen sendiri supaya bisa digayai
        // (monospace, redup) — bukan menempel di teks judul.
        var num = h.querySelector('.sec-num');
        var numText = num ? num.textContent.trim() : '';
        var titleText = h.textContent.replace(/^\s*\d+\s*/, '').trim();

        if (numText) {
          var span = document.createElement('span');
          span.className = 'toc-num';
          span.textContent = numText;
          a.appendChild(span);
        }
        a.appendChild(document.createTextNode(titleText));
      } else {
        a.textContent = h.textContent.trim();
      }

      frag.appendChild(a);
      lastWasH2 = isH2;
    });

    toc.appendChild(frag);
  }

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
