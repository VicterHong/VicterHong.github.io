/**
 * Ukur CLS halaman harga pada skenario NYATA: grid kosong lalu terisi kartu.
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 * Mengukur CLS di server lokal tanpa API hanya membuktikan grid tetap kosong —
 * tidak ada pergeseran karena tidak ada yang masuk. Itu bukan bukti.
 *
 * Tes ini menjawab /api/pricing dengan buildPricing() yang nyata, sehingga
 * empat kartu benar-benar dirender, dan mengukur LayoutShift yang terjadi
 * antara HTML pertama dicat dan kartu selesai masuk.
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
  console.log('  ⏭️  playwright tidak tersedia di lingkungan ini — tes CLS dilewati.');
  process.exit(0);
}
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPricing } from '../src/pricing.mjs';

const AKAR = fileURLToPath(new URL('../../dist/', import.meta.url));
const TIPE = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  let jalur = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (jalur.endsWith('/')) jalur += 'index.html';
  if (!extname(jalur)) jalur += '.html';
  const berkas = join(AKAR, normalize(jalur).replace(/^(\.\.[/\\])+/, ''));
  if (!berkas.startsWith(AKAR)) return res.writeHead(403).end();
  const info = await stat(berkas).catch(() => null);
  if (!info?.isFile()) return res.writeHead(404).end('tidak ada');
  res.writeHead(200, {
    'content-type': TIPE[extname(berkas)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  }).end(await readFile(berkas));
});

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const b = await chromium.launch({ args: ['--no-sandbox'] });
let gagal = 0;

for (const w of [1366, 900, 360]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();

  // Observer dipasang SEBELUM dokumen dimuat.
  await p.addInitScript(() => {
    window.__cls = 0;
    window.__shift = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__cls += e.value;
          window.__shift.push({
            v: Number(e.value.toFixed(4)),
            t: Math.round(e.startTime),
            src: (e.sources ?? []).map((s) => (s.node?.id ? '#' + s.node.id : s.node?.tagName ?? '?')),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });

  await ctx.route('**/api/pricing*', async (r) => {
    // ── TIRU JALUR NYATA: skeleton dulu, kartu kemudian ─────────────────────
    // Produksi menampilkan 3 kartu skeleton sebelum data tiba. Kalau tes ini
    // menjawab seketika, jalur skeleton tidak pernah diuji — dan justru di
    // situlah CLS 0.2376 berasal (skeleton 336px → kartu 862px).
    await new Promise((ok) => setTimeout(ok, 700));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildPricing()) });
  });
  await ctx.route('**/api/checkout/konteks*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, masuk: false }) }),
  );

  await p.goto(`http://127.0.0.1:${port}/pricing.html`, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(3000);

  const d = await p.evaluate(() => ({
    cls: Number(window.__cls.toFixed(4)),
    shift: window.__shift,
    kartu: document.querySelectorAll('#wadahKartu .harga-kartu').length,
  }));

  const lulus = d.cls <= 0.1 && d.kartu === 4;
  if (!lulus) gagal++;
  console.log(`  ${lulus ? 'ok' : 'X '} ${String(w).padStart(4)}px  CLS ${String(d.cls).padEnd(7)} kartu ${d.kartu}/4`);
  for (const s of d.shift.slice(0, 3)) {
    console.log(`              shift ${s.v} @${s.t}ms ← ${s.src.join(', ')}`);
  }
  await ctx.close();
}

await b.close();
await new Promise((ok) => server.close(ok));

console.log(`\n${gagal === 0 ? 'SEMUA LULUS' : gagal + ' GAGAL'} — CLS <= 0.1 dengan kartu benar-benar dirender`);
process.exitCode = gagal === 0 ? 0 : 1;
