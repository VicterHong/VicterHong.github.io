/**
 * Ukur Core Web Vitals di produksi dengan browser sungguhan.
 *
 * ── KENAPA SKRIP INI ADA ────────────────────────────────────────────────────
 * Laporan rilis menyebut "field p75 LCP/INP/CLS belum terukur". Itu benar:
 * `assets/js/vitals.js` sudah mengumpulkan metrik dari pengunjung, tetapi
 * selama belum ada yang MEMBACA hasilnya, kita tidak punya angka apa pun.
 *
 * Skrip ini menjawab pertanyaan itu dengan dua langkah:
 *   1. LAB   — buka halaman produksi di Chromium, ukur LCP/FCP/CLS/TTFB
 *              langsung dari PerformanceObserver. Ini angka lab, bukan field,
 *              dan disebut apa adanya.
 *   2. FIELD — baca agregat /api/admin/performance (butuh ADMIN_KEY) untuk
 *              melihat apakah pengunjung nyata sudah mengirim metrik.
 *
 * Keluar dengan kode 1 kalau ada anggaran yang dilanggar, supaya bisa dipakai
 * di CI.
 *
 * ── CARA MENJALANKAN ────────────────────────────────────────────────────────
 *   node scripts/ukur-vitals.mjs
 *   ADMIN_KEY=... node scripts/ukur-vitals.mjs     (sekalian baca field data)
 */

import { chromium } from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const ASAL = process.env.ASAL ?? 'https://portfolio-victer.pages.dev';
const HALAMAN = ['/home', '/pricing'];
const ULANG = Number(process.env.ULANG ?? 3);

// Anggaran Google "good" untuk p75.
const ANGGARAN = { lcp: 2500, cls: 0.1, ttfb: 800, fcp: 1800 };

const hasil = [];

function nilai(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const b = await chromium.launch({ args: ['--no-sandbox'] });

try {
  for (const jalur of HALAMAN) {
    for (let i = 0; i < ULANG; i++) {
      // Cache dimatikan supaya setiap pengukuran mewakili kunjungan pertama.
      const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
      const p = await ctx.newPage();

      await p.goto(`${ASAL}${jalur}`, { waitUntil: 'load', timeout: 60000 });

      // Beri waktu LCP/CLS final terbentuk, lalu picu pelaporan.
      await p.waitForTimeout(2500);
      await p.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        document.dispatchEvent(new Event('visibilitychange'));
      });

      const m = await p.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] ?? {};
        const paint = performance.getEntriesByType('paint') ?? [];
        const fcp = paint.find((e) => e.name === 'first-contentful-paint')?.startTime ?? null;
        return {
          ttfb: nav.responseStart > 0 ? nav.responseStart - nav.requestStart : null,
          fcp,
          // LCP/CLS diambil ulang lewat observer di bawah.
          lcp: window.__lcp ?? null,
          cls: window.__cls ?? null,
        };
      });

      // Ukur ulang LCP/CLS dengan observer yang dipasang SEBELUM navigasi
      // berikutnya tidak mungkin; jadi kita pakai buffered entries.
      const lcpCls = await p.evaluate(() => new Promise((selesai) => {
        let lcp = 0;
        let cls = 0;
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) lcp = e.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch { /* tidak didukung */ }
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
        } catch { /* tidak didukung */ }
        setTimeout(() => selesai({ lcp: lcp || null, cls }), 600);
      }));

      hasil.push({
        jalur,
        ttfb: m.ttfb,
        fcp: m.fcp,
        lcp: lcpCls.lcp,
        cls: lcpCls.cls,
      });

      await ctx.close();
    }
  }
} finally {
  await b.close();
}

// ── Ringkas per halaman ─────────────────────────────────────────────────────
let langgar = 0;

console.log(`\nSumber: ${ASAL} (LAB, Chromium headless, ${ULANG}x per halaman)`);
console.log('Catatan: ini angka lab, bukan field p75 dari pengunjung nyata.\n');

for (const jalur of HALAMAN) {
  const baris = hasil.filter((h) => h.jalur === jalur);
  const ambil = (k) => baris.map((r) => r[k]).filter((v) => typeof v === 'number' && v > 0);

  const p75 = {};
  for (const k of Object.keys(ANGGARAN)) {
    p75[k] = nilai(ambil(k), 75);
  }

  console.log(`── ${jalur} ──`);
  for (const [k, batas] of Object.entries(ANGGARAN)) {
    const v = p75[k];
    if (v == null) {
      console.log(`  ?  ${k.toUpperCase().padEnd(4)} tidak terukur`);
      continue;
    }
    const lulus = k === 'cls' ? v <= batas : v <= batas;
    if (!lulus) langgar++;
    const tampil = k === 'cls' ? v.toFixed(3) : `${Math.round(v)} ms`;
    console.log(`  ${lulus ? 'ok' : 'X '} ${k.toUpperCase().padEnd(4)} ${tampil.padEnd(10)} (anggaran ${k === 'cls' ? batas : batas + ' ms'})`);
  }
  console.log('');
}

// ── Field data (opsional) ───────────────────────────────────────────────────
const kunci = process.env.ADMIN_KEY;
if (kunci) {
  try {
    const r = await fetch(`${ASAL}/api/admin/performance?days=7`, {
      headers: { 'x-admin-key': kunci },
    });
    const d = await r.json();
    if (!r.ok || !d.ok) {
      console.log(`Field data: tidak bisa dibaca (HTTP ${r.status})`);
    } else {
      console.log('── Field data 7 hari terakhir ──');
      const v = d.vitals ?? {};
      const kosong = Object.values(v).every((x) => !x || x.count === 0);
      if (kosong) {
        console.log('  (belum ada metrik dari pengunjung nyata)');
      } else {
        for (const [nama, s] of Object.entries(v)) {
          if (!s || !s.count) continue;
          console.log(`  ${nama.toUpperCase().padEnd(4)} p75=${s.p75} · n=${s.count} · ${s.rating ?? ''}`);
        }
      }
    }
  } catch (e) {
    console.log(`Field data: gagal (${e.message})`);
  }
} else {
  console.log('Field data: dilewati (set ADMIN_KEY untuk membaca /api/admin/performance)');
}

console.log(langgar === 0
  ? '\n✅ Semua anggaran lab terpenuhi.'
  : `\n⚠️  ${langgar} anggaran lab terlampaui.`);
process.exitCode = langgar === 0 ? 0 : 1;
