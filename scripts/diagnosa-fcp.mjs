/**
 * Diagnosa FCP: apa yang menahan paint pertama di /home.
 * Mencatat timeline resource + long task + kapan elemen hero benar-benar terlihat.
 */
import { chromium } from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const ASAL = process.env.ASAL ?? 'https://portfolio-victer.pages.dev';

const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const p = await ctx.newPage();

await p.addInitScript(() => {
  window.__marks = [];
  const catat = (nama, t) => window.__marks.push({ nama, t: Math.round(t) });

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) catat('paint:' + e.name, e.startTime);
    }).observe({ type: 'paint', buffered: true });
  } catch {}

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        catat('longtask', e.startTime);
        window.__marks.push({ nama: '  durasi', t: Math.round(e.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}

  // Catat kapan gate Cloudflare dilepas, kalau ada.
  document.addEventListener('cf-gate:lulus', () => catat('gate:lulus', performance.now()));
  window.addEventListener('load', () => catat('window:load', performance.now()));
  document.addEventListener('DOMContentLoaded', () => catat('dom:ready', performance.now()));
});

await p.goto(`${ASAL}/home`, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(3500);

const d = await p.evaluate(() => {
  const res = performance.getEntriesByType('resource')
    .map((r) => ({
      n: r.name.split('/').pop().slice(0, 40),
      mulai: Math.round(r.startTime),
      selesai: Math.round(r.responseEnd),
      kb: Math.round((r.transferSize || 0) / 1024),
      tipe: r.initiatorType,
    }))
    .filter((r) => r.mulai < 2600)
    .sort((a, b) => a.mulai - b.mulai);

  const gate = document.querySelector('#cf-gate');
  return {
    marks: window.__marks,
    res,
    gateAda: !!gate,
    gateTampil: gate ? getComputedStyle(gate).display : null,
    bodyKelas: document.body.className,
  };
});

console.log(`\n═══ FCP /home ═══\n`);
console.log('Urutan kejadian:');
for (const m of d.marks.sort((a, b) => a.t - b.t)) {
  console.log(`  ${String(m.t).padStart(5)}ms  ${m.nama}`);
}

console.log('\nGate Cloudflare:', d.gateAda ? `ada (display=${d.gateTampil})` : 'tidak ada');
console.log('body.class:', d.bodyKelas || '(kosong)');

console.log('\nResource sebelum 2600ms:');
for (const r of d.res) {
  console.log(`  ${String(r.mulai).padStart(5)}→${String(r.selesai).padStart(5)}ms  ${String(r.kb).padStart(4)}KB  ${r.tipe.padEnd(9)} ${r.n}`);
}

await b.close();
