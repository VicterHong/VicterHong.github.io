/**
 * Uji CSP hash: pastikan skrip inline benar-benar dieksekusi dan tidak ada
 * pelanggaran CSP di halaman utama.
 *
 * Dijalankan terhadap dist/ lokal (bukan produksi) supaya bisa memaksa header
 * CSP yang sama dengan yang akan dikirim _headers.
 */
import { chromium } from '/home/ubuntu/portfolio-luxury-gateway/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';

const CSP = readFileSync('/home/ubuntu/portfolio-victer/dist/_headers', 'utf8')
  .split('\n')
  .find((l) => l.trim().startsWith('Content-Security-Policy:'))
  .replace(/^\s*Content-Security-Policy:\s*/, '')
  .trim();

const BASE = 'http://127.0.0.1:8934';
const HALAMAN = ['/', '/pricing.html', '/home.html', '/docs.html'];

const browser = await chromium.launch({
  executablePath: '/home/ubuntu/.cache/ms-playwright/chromium-1247/chrome-linux-arm64/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const hasil = [];
for (const jalur of HALAMAN) {
  const page = await browser.newPage();
  const pelanggaran = [];
  const error = [];

  // _headers tidak berlaku di http.server; suntikkan CSP yang sama.
  await page.route('**/*', async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'content-security-policy': CSP },
    });
  });

  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to execute/i.test(t)) pelanggaran.push(t.slice(0, 200));
    if (m.type() === 'error') error.push(t.slice(0, 160));
  });
  page.on('pageerror', (e) => error.push(String(e).slice(0, 160)));

  try {
    await page.goto(BASE + jalur, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);
  } catch (e) {
    error.push('goto: ' + String(e.message).slice(0, 120));
  }

  // Bukti skrip inline berjalan: CF_GATE_CONFIG harus terdefinisi.
  const inlineJalan = await page.evaluate(() => typeof window.CF_GATE_CONFIG !== 'undefined');

  hasil.push({ jalur, inlineJalan, pelanggaran: pelanggaran.length, error: error.length, contohPelanggaran: pelanggaran[0], contohError: error[0] });
  await page.close();
}

await browser.close();

for (const h of hasil) {
  console.log(
    `${h.jalur.padEnd(16)} inline=${h.inlineJalan ? 'JALAN' : 'MATI '} csp_violation=${h.pelanggaran} errors=${h.error}`,
  );
  if (h.contohPelanggaran) console.log('   csp:', h.contohPelanggaran);
  if (h.contohError) console.log('   err:', h.contohError);
}

const gagal = hasil.filter((h) => !h.inlineJalan || h.pelanggaran > 0);
console.log(`\n${gagal.length === 0 ? 'LULUS' : 'GAGAL'}: ${hasil.length - gagal.length}/${hasil.length} halaman bersih`);
process.exit(gagal.length === 0 ? 0 : 1);
