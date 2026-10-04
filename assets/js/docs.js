/**
 * Panduan penggunaan — pencarian & navigasi.
 * Ringan: tanpa dependency, filter client-side sederhana.
 */

(function () {
  'use strict';

  // ── Daftar isi otomatis dari heading ───────────────────────────────────────
  var toc = document.getElementById('toc');
  var content = document.getElementById('docContent');
  if (!toc || !content) return;

  var headings = content.querySelectorAll('h2[id], h3[id]');
  if (headings.length) {
    var frag = document.createDocumentFragment();
    var lastWasH2 = false;

    headings.forEach(function (h) {
      var isH2 = h.tagName === 'H2';

      // Judul kelompok sebelum setiap H2 (kecuali yang pertama) —
      // memisahkan bagian utama supaya struktur dokumen terlihat.
      if (isH2 && lastWasH2) {
        var group = document.createElement('span');
        group.className = 'toc-group';
        group.textContent = h.textContent.replace(/^#\s*/, '').replace(/^\d+\s*/, '');
        frag.appendChild(group);
      }

      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.className = 'toc-link toc-' + h.tagName.toLowerCase();
      // Nomor bagian (01, 02, …) dipertahankan di label H2.
      a.textContent = h.textContent.replace(/^#\s*/, '').trim();
      frag.appendChild(a);

      lastWasH2 = isH2;
    });

    toc.appendChild(frag);
  }

  // ── Sorot bagian yang sedang dibaca ────────────────────────────────────────
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

  // ── Pencarian ──────────────────────────────────────────────────────────────
  var search = document.getElementById('docSearch');
  if (!search) return;

  var sections = Array.prototype.slice.call(content.querySelectorAll('section.doc-section'));
  var empty = document.getElementById('docEmpty');

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

  // ── Salin contoh perintah ──────────────────────────────────────────────────
  content.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-btn');
    if (!btn) return;
    var code = btn.parentElement.querySelector('code');
    if (!code) return;

    var text = code.textContent;
    var done = function () {
      var old = btn.textContent;
      btn.textContent = 'Tersalin';
      btn.classList.add('is-done');
      setTimeout(function () {
        btn.textContent = old;
        btn.classList.remove('is-done');
      }, 1600);
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
