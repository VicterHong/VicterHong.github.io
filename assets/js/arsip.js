/**
 * ARSIP — render proyek latihan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA MEMBACA DARI DATA, BUKAN MENULIS DI HTML
 * ══════════════════════════════════════════════════════════════════════════════
 * Nama dan tautan repo sudah ada di `data/projects.js`. Menulisnya ulang di
 * HTML berarti ada dua tempat yang harus dijaga tetap sama — dan satu yang
 * terlewat sudah cukup untuk membuat tautannya mati atau namanya beda.
 *
 * ── KENAPA REPO PRIVAT JADI <div>, BUKAN <a> ─────────────────────────────────
 * Sama seperti kartu proyek pendukung: kalau repo-nya tidak ada, kartu yang
 * tetap jadi <a href> akan mendarat di 404 saat diklik. Itu kerusakan yang
 * tidak terlihat dari kode — hanya ketahuan saat tautannya benar-benar dibuka.
 */

import { proyekLatihan } from './data/projects.js';

function el(tag, opsi = {}, teks) {
  const node = document.createElement(tag);
  if (opsi.class) node.className = opsi.class;
  if (opsi.href) {
    node.href = opsi.href;
    // ── rel="noopener" WAJIB UNTUK target="_blank" ────────────────────────────
    // Tanpa itu, halaman tujuan bisa mengakses `window.opener` dan mengubah
    // halaman kita. Sebagian browser modern sudah memblokirnya sendiri, tapi
    // mengandalkan perilaku default browser bukan kebiasaan yang baik.
    node.target = '_blank';
    node.rel = 'noopener';
  }
  if (teks != null) node.textContent = teks;
  return node;
}

function renderItem(p) {
  const adaRepo = Boolean(p.repo);

  // ── KARTU JADI TAUTAN HANYA KALAU REPO-NYA ADA ────────────────────────────
  const kartu = adaRepo
    ? el('a', { class: 'arsip-item', href: p.repo })
    : el('div', { class: 'arsip-item arsip-item--tanpa-tautan' });

  const kepala = el('div', { class: 'arsip-item-kepala' });
  kepala.append(
    el('h2', { class: 'arsip-item-nama' }, p.name),
    // Lencana ini ikut terlihat saat kartunya dipindai cepat — bukan hanya
    // di teks penjelasan yang mungkin tidak dibaca.
    el('span', { class: 'arsip-lencana' }, 'latihan'),
  );
  kartu.append(kepala);

  kartu.append(el('p', { class: 'arsip-item-teks' }, p.description));

  const stack = el('div', { class: 'arsip-stack' });
  for (const tech of p.stack) {
    stack.append(el('span', { class: 'arsip-tag' }, tech));
  }
  kartu.append(stack);

  return kartu;
}

function mulai() {
  const host = document.getElementById('arsipDaftar');
  if (!host) return;

  for (const p of proyekLatihan) {
    host.append(renderItem(p));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mulai, { once: true });
} else {
  mulai();
}
