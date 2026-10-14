/**
 * Kontras tombol "Sedang digunakan" — diukur dari CSS yang benar-benar berlaku.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════════
 * Tombol yang dinonaktifkan mudah berakhir dengan kontras gagal: godaannya
 * menurunkan opacity sampai tombolnya terlihat "cukup mati", tanpa mengukur
 * apakah teksnya masih terbaca.
 *
 * Itu yang terjadi di sini. `opacity: 0.55` menghasilkan kontras 2,92:1 —
 * GAGAL WCAG AA (butuh 4,5:1). Ketahuan hanya karena diukur, bukan dilihat.
 *
 * Perbaikannya: TIDAK memakai opacity pada tombol. Yang membuat tombol terbaca
 * "dinonaktifkan" bukan transparansinya, tapi kontras rendah antara teks dan
 * latar — dan itu bisa dicapai dengan warna teks yang lebih redup, tanpa
 * mengorbankan keterbacaan.
 *
 * ── YANG DIPERIKSA ──────────────────────────────────────────────────────────
 * Kontras dihitung dari CSS yang benar-benar berlaku di browser, termasuk
 * pengaruh `opacity` dan warna latar yang tembus pandang. Kalau seseorang
 * mengubah warna atau opacity di masa depan, tes ini menghitung ulang — jadi
 * perubahannya tidak bisa lolos tanpa terukur.
 *
 * ── CARA MENJALANKAN ────────────────────────────────────────────────────────
 * Butuh server uji di port 8897 (yang meniru /api/checkout/konteks).
 */

import { chromium } from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const BASE = 'http://127.0.0.1:8897/pricing';

let lulus = 0;
let gagal = 0;

function periksa(nama, benar, detail = '') {
  if (benar) {
    lulus++;
    console.log(`  ok  ${nama}`);
  } else {
    gagal++;
    console.log(`  X   ${nama}${detail ? ' -- ' + detail : ''}`);
  }
}

const b = await chromium.launch({ args: ['--no-sandbox'] });

for (const konteks of ['gratis', 'standar', 'profesional']) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.addCookies([{ name: 'konteks', value: konteks, domain: '127.0.0.1', path: '/' }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(4000);

  const m = await p.evaluate(() => {
    const lum = (c) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const kontras = (fg, bg) => {
      const a = lum(fg);
      const b2 = lum(bg);
      return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05);
    };
    const keRgb = (s) => {
      const m2 = String(s).match(/[\d.]+/g);
      return m2 ? m2.slice(0, 3).map(Number) : [0, 0, 0];
    };
    const campur = (atas, bawah, alpha) =>
      atas.map((v, i) => Math.round(v * alpha + bawah[i] * (1 - alpha)));

    const mati = document.querySelector('.tombol--aktif');
    if (!mati) return { err: 'tombol mati tidak ada' };

    const cs = getComputedStyle(mati);
    const kartuBg = keRgb(getComputedStyle(document.querySelector('.harga-kartu')).backgroundColor);

    // Warna latar tombol bisa tembus pandang (rgba) — ambil alpha-nya
    const latarTombol = keRgb(cs.backgroundColor);
    const cocokAlpha = String(cs.backgroundColor).match(/[\d.]+\)$/);
    const alphaLatar = cocokAlpha ? parseFloat(cocokAlpha[0]) : 1;

    // `opacity` meredupkan SELURUH elemen: teks dan latar bersama-sama.
    // Jadi kontras efektif harus dihitung SETELAH kedua lapisan itu dicampur
    // dengan latar di belakangnya.
    const op = parseFloat(cs.opacity);
    const latarEfektif = campur(campur(latarTombol, kartuBg, alphaLatar), kartuBg, op);
    const teksEfektif = campur(keRgb(cs.color), latarEfektif, op);

    return {
      label: mati.textContent.trim(),
      cursor: cs.cursor,
      disabled: mati.disabled,
      opacity: op,
      kontras: Number(kontras(teksEfektif, latarEfektif).toFixed(2)),
    };
  });

  if (m.err) {
    periksa(`${konteks}: tombol "Sedang digunakan" ada`, false, m.err);
    await ctx.close();
    continue;
  }

  periksa(`${konteks}: label "Sedang digunakan"`, m.label === 'Sedang digunakan', `"${m.label}"`);
  periksa(`${konteks}: kursor not-allowed`, m.cursor === 'not-allowed', m.cursor);
  periksa(`${konteks}: tombol disabled`, m.disabled === true);
  periksa(
    `${konteks}: kontras >= 4.5:1 (WCAG AA)`,
    m.kontras >= 4.5,
    `${m.kontras}:1 (opacity ${m.opacity})`,
  );

  await ctx.close();
}

await b.close();

console.log(`\n${'─'.repeat(50)}`);
console.log(gagal === 0
  ? `SEMUA LULUS -- ${lulus} pemeriksaan`
  : `${gagal} GAGAL dari ${lulus + gagal} pemeriksaan`);
process.exitCode = gagal === 0 ? 0 : 1;
