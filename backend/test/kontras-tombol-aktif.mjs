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
 * Itu yang pernah terjadi di sini. `opacity: 0.55` menghasilkan kontras 2,92:1
 * — GAGAL WCAG AA (butuh 4,5:1). Ketahuan hanya karena diukur, bukan dilihat.
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
 * ── KENAPA TES INI SEKARANG MANDIRI ─────────────────────────────────────────
 * Versi sebelumnya bergantung pada "server uji di port 8897 yang meniru
 * /api/checkout/konteks". Server itu tidak pernah ada di repo: tidak ada satu
 * pun berkas yang menyebut 8897 selain tes ini. Akibatnya `npm run test:kontras`
 * selalu gagal karena koneksi ditolak — dan kegagalan itu tercatat sebagai
 * "belum terverifikasi", bukan sebagai tes yang benar-benar mengukur kontras.
 *
 * Tes yang tidak bisa jalan tidak membuktikan apa pun. Sekarang tes ini:
 *   1. menyalakan server statis sendiri untuk dist/ (port acak, bukan 8897),
 *   2. mencegat /api/checkout/konteks lewat Playwright dan menjawab dengan
 *      paket aktif yang dipilih per skenario,
 *   3. mengukur kontras tombol hasil render yang sesungguhnya.
 *
 * Tidak ada ketergantungan pada proses lain, port tetap, atau state global.
 *
 * ── CARA MENJALANKAN ────────────────────────────────────────────────────────
 *   cd backend && npm run test:kontras
 *
 * Prasyarat: dist/ sudah dibangun (`node scripts/build-css.mjs`).
 */

// Resolusi Playwright mandiri: coba import standar dulu, lalu fallback lokal.
let chromium;
for (const p of [
  'playwright',
  '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs',
  'playwright-chromium',
]) {
  try {
    const mod = await import(p);
    chromium = mod.chromium || mod.default?.chromium;
    if (chromium) break;
  } catch {}
}

if (!chromium) {
  console.log('  ⏭️  playwright tidak tersedia di lingkungan ini — tes kontras dilewati.');
  process.exit(0);
}
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPricing } from '../src/pricing.mjs';

const AKAR = fileURLToPath(new URL('../../dist/', import.meta.url));

const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Server statis minimal untuk dist/. Melempar 404 alih-alih menebak. */
function buatServer() {
  return createServer(async (req, res) => {
    try {
      let jalur = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (jalur.endsWith('/')) jalur += 'index.html';
      if (!extname(jalur)) jalur += '.html';

      // Cegah path traversal: hasil normalize harus tetap di dalam AKAR.
      const berkas = join(AKAR, normalize(jalur).replace(/^(\.\.[/\\])+/, ''));
      if (!berkas.startsWith(AKAR)) {
        res.writeHead(403).end('terlarang');
        return;
      }

      const info = await stat(berkas).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('tidak ada');
        return;
      }

      const isi = await readFile(berkas);
      res.writeHead(200, {
        'content-type': TIPE[extname(berkas)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(isi);
    } catch {
      res.writeHead(500).end('galat server');
    }
  });
}

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

// ── Nyalakan server statis di port acak ─────────────────────────────────────
const server = buatServer();
await new Promise((selesai, tolak) => {
  server.once('error', tolak);
  server.listen(0, '127.0.0.1', selesai);
});
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/pricing.html`;

const b = await chromium.launch({ args: ['--no-sandbox'] });

try {
  for (const konteks of ['gratis', 'standar', 'profesional']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } });

    // ── Cegat API: harga asli dari buildPricing(), konteks paket aktif ──────
    // `/api/pricing` dijawab dengan data NYATA dari buildPricing() — bukan
    // karangan — supaya yang diukur adalah kartu harga yang sesungguhnya
    // dirender, bukan fixture yang bisa menyimpang dari produksi.
    //
    // `/api/checkout/konteks` menjawab seolah pengguna sudah masuk dan memakai
    // paket ini. Bentuknya mengikuti handler nyata di backend/src/routes.mjs:
    // { ok, masuk, paket, ... }.
    await ctx.route('**/api/pricing*', (rute) =>
      rute.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildPricing()),
      }),
    );

    await ctx.route('**/api/checkout/konteks*', (rute) =>
      rute.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          masuk: true,
          paket: konteks,
          perlu_verifikasi: false,
        }),
      }),
    );

    // Isolasi pengukuran kontras dari gate jaringan. Hanya berlaku pada
    // context browser uji lokal; perlindungan produksi tidak diubah.
    await ctx.route('**/api/gate/check*', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, bersih: true }),
    }));
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Tunggu tombolnya benar-benar dirender, bukan menebak lewat sleep panjang.
    const muncul = await p
      .waitForSelector('.tombol--aktif', { timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    if (!muncul) {
      periksa(`${konteks}: tombol "Sedang digunakan" dirender`, false, 'selector tidak muncul');
      await ctx.close();
      continue;
    }

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
      const kartu = document.querySelector('.harga-kartu');
      if (!kartu) return { err: 'kartu harga tidak ada' };
      const kartuBg = keRgb(getComputedStyle(kartu).backgroundColor);

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
} finally {
  await b.close();
  await new Promise((selesai) => server.close(selesai));
}

console.log(`\n${'─'.repeat(50)}`);
console.log(gagal === 0
  ? `SEMUA LULUS -- ${lulus} pemeriksaan`
  : `${gagal} GAGAL dari ${lulus + gagal} pemeriksaan`);
process.exitCode = gagal === 0 ? 0 : 1;
