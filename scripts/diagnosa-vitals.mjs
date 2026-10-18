/**
 * Diagnosa: elemen apa yang jadi LCP, dan apa yang menggeser layout (CLS).
 * Dibuat untuk menjawab "kenapa" sebelum mengubah apa pun.
 */
import { chromium } from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const ASAL = process.env.ASAL ?? 'https://portfolio-victer.pages.dev';
const JALUR = process.argv[2] ?? '/home';

const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const p = await ctx.newPage();

// Pasang observer SEBELUM navigasi lewat init script.
await p.addInitScript(() => {
  window.__lcp = [];
  window.__shifts = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__lcp.push({
          time: Math.round(e.startTime),
          size: e.size,
          tag: e.element?.tagName ?? '?',
          cls: (e.element?.className ?? '').toString().slice(0, 80),
          id: e.element?.id ?? '',
          url: e.url ?? '',
        });
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__shifts.push({
          value: Number(e.value.toFixed(4)),
          time: Math.round(e.startTime),
          sources: (e.sources ?? []).map((s) => ({
            tag: s.node?.tagName ?? '?',
            cls: (s.node?.className ?? '').toString().slice(0, 60),
            id: s.node?.id ?? '',
          })),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
});

await p.goto(`${ASAL}${JALUR}`, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(4000);

const d = await p.evaluate(() => ({
  lcp: window.__lcp,
  shifts: window.__shifts,
  resources: performance.getEntriesByType('resource')
    .map((r) => ({ n: r.name.split('/').pop(), t: Math.round(r.startTime), d: Math.round(r.duration), size: r.transferSize }))
    .filter((r) => r.size > 30000)
    .sort((a, b) => b.size - a.size)
    .slice(0, 8),
}));

console.log(`\n═══ ${JALUR} ═══\n`);
console.log('LCP kandidat (urut waktu):');
for (const e of d.lcp) {
  console.log(`  ${String(e.time).padStart(5)}ms  ${String(e.size).padStart(8)}px²  <${e.tag}> ${e.id ? '#' + e.id : ''} .${e.cls}`);
}
const last = d.lcp[d.lcp.length - 1];
console.log(`\nLCP final: ${last ? last.time + 'ms <' + last.tag + '> ' + (last.url || last.cls) : 'tidak ada'}`);

console.log('\nLayout shift (penyebab CLS):');
const total = d.shifts.reduce((a, s) => a + s.value, 0);
for (const s of d.shifts.slice(0, 10)) {
  console.log(`  ${String(s.time).padStart(5)}ms  nilai ${s.value}`);
  for (const src of s.sources.slice(0, 3)) {
    console.log(`           ← <${src.tag}> ${src.id ? '#' + src.id : ''} .${src.cls}`);
  }
}
console.log(`  TOTAL CLS: ${total.toFixed(4)}`);

console.log('\nAset terberat:');
for (const r of d.resources) {
  console.log(`  ${String(Math.round(r.size / 1024)).padStart(5)} KB  mulai ${String(r.t).padStart(5)}ms  ${r.n}`);
}

await b.close();
