/**
 * Uji halaman /akses/ di browser sungguhan.
 *
 * Yang diperiksa, dan kenapa:
 *  - Harga benar-benar terlihat, bukan hanya ada di DOM.
 *  - Tombol pembayaran TIDAK bisa ditekan (status pengembangan).
 *  - Tidak ada overflow horizontal di 390px, 768px, 1440px.
 *  - Tidak ada em-dash di teks yang terlihat (aturan anti-slop).
 *  - Tidak ada error konsol, permintaan gagal, atau pelanggaran CSP.
 *  - reduced-motion tidak menyembunyikan isi.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8944';
const EXEC = process.env.CHROME
  ?? '/home/ubuntu/.cache/ms-playwright/chromium-1247/chrome-linux-arm64/chrome';

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: EXEC });
let gagal = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) gagal += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${nama}${detail ? `  ${detail}` : ''}`);
};

for (const vp of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const galat = [];
  const gagalReq = [];

  page.on('console', (m) => { if (m.type() === 'error') galat.push(m.text()); });
  page.on('pageerror', (e) => galat.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) gagalReq.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${BASE}/akses/`, { waitUntil: 'networkidle' });

  const teks = await page.locator('body').innerText();
  const harga = await page.locator('.plan__price').allInnerTexts();
  const total = await page.locator('.sum__total dd').innerText();
  const tombol = page.getByRole('button', { name: /pembayaran belum dibuka/i });
  const disabled = await tombol.isDisabled();
  const overflow = await page.evaluate(
    () => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  );
  const emDash = (teks.match(/[\u2014\u2013]/g) ?? []).length;
  const h1 = await page.locator('h1').count();
  const fontLoaded = await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans"'));

  console.log(`\n── ${vp.name} ${vp.width}x${vp.height} ──`);
  cek('harga tampil', harga.length === 2 && harga.some((t) => t.includes('270')), harga.join(' | '));
  cek('total terhitung', total.includes('270'), total);
  cek('tombol bayar nonaktif', disabled);
  cek('tanpa overflow', overflow === 0, `${overflow}px`);
  cek('tanpa em-dash', emDash === 0, `${emDash}`);
  cek('satu h1', h1 === 1, `${h1}`);
  cek('font termuat', fontLoaded);
  cek('tanpa galat konsol', galat.length === 0, galat.slice(0, 2).join(' / '));
  cek('tanpa permintaan gagal', gagalReq.length === 0, gagalReq.slice(0, 2).join(' / '));

  await page.screenshot({ path: `/tmp/akses-${vp.name}.png`, fullPage: vp.name === 'desktop' });
  await ctx.close();
}

// ── reduced motion: isi tetap terbaca ────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/akses/`, { waitUntil: 'networkidle' });
  const teks = await page.locator('body').innerText();
  console.log('\n── reduced motion ──');
  cek('harga tetap terbaca', /270\.000/.test(teks));
  cek('kebijakan tetap terbaca', /Refund dalam 7 hari/.test(teks));
  await ctx.close();
}

// ── tanpa JavaScript ────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/akses/`, { waitUntil: 'domcontentloaded' });
  const teks = await page.locator('body').innerText();
  console.log('\n── tanpa JavaScript ──');
  cek('ada penjelasan', /Tanpa JavaScript/i.test(teks));
  cek('ada harga ringkas', /Rp144\.000/.test(teks));
  cek('ada jalan kembali', await page.getByRole('link', { name: /kembali ke portofolio/i }).count() === 1);
  await ctx.close();
}

await browser.close();
console.log(gagal === 0 ? '\nSEMUA LULUS' : `\n${gagal} PEMERIKSAAN GAGAL`);
process.exit(gagal === 0 ? 0 : 1);
