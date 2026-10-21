/**
 * Uji beranda setelah penambahan jembatan ke /akses/.
 *
 * Fokusnya sempit: apakah kartu jembatan muncul, bisa diklik, dan mengarah
 * ke halaman yang benar. Halaman beranda sendiri tidak diubah selain itu.
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
  { name: 'desktop', width: 1440, height: 900 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const galat = [];
  page.on('pageerror', (e) => galat.push(String(e)));

  await page.goto(`${BASE}/home.html`, { waitUntil: 'domcontentloaded' });

  // Beranda punya gerbang Turnstile. Selama `cf-gating` masih di <html>, teks
  // kartu kosong karena lapisan gate menutupinya. Tunggu sampai kelas itu
  // hilang, kalau tidak uji membaca teks kosong dan gagal secara palsu.
  await page.waitForFunction(
    () => !document.documentElement.classList.contains('cf-gating'),
    { timeout: 20000 },
  ).catch(() => {});

  const kartu = page.locator('.akses-bridge');
  const navLink = page.locator('.site-nav a[href="/akses/"]');
  const jumlah = await kartu.count();
  const href = jumlah ? await kartu.first().getAttribute('href') : null;
  const navHref = await navLink.count() ? await navLink.first().getAttribute('href') : null;
  const teks = jumlah ? await kartu.first().innerText() : '';
  const overflow = await page.evaluate(
    () => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  );

  console.log(`\n── ${vp.name} ${vp.width} ──`);
  cek('kartu jembatan ada', jumlah === 1, `${jumlah}`);
  cek('mengarah ke /akses/', href === '/akses/', String(href));
  cek('tautan nav ada', navHref === '/akses/', String(navHref));
  cek('menyebut status pengembangan', /dalam pengembangan/i.test(teks));
  cek('menyebut pembayaran ditutup', /pembayaran ditutup/i.test(teks));
  cek('tanpa overflow', overflow === 0, `${overflow}px`);
  cek('tanpa galat halaman', galat.length === 0, galat.slice(0, 1).join(''));

  // Klik benar-benar berpindah halaman.
  await kartu.first().click();
  await page.waitForURL(/\/akses\/?$/, { timeout: 10000 }).catch(() => {});
  const tujuan = new URL(page.url()).pathname;
  cek('klik berpindah ke /akses/', tujuan === '/akses/' || tujuan === '/akses', tujuan);
  // Klik adalah navigasi penuh; harga dimuat lewat fetch setelah React mount,
  // jadi tunggu elemennya muncul sebelum menghitung.
  await page.locator('.plan__price').first().waitFor({ timeout: 15000 }).catch(() => {});
  const adaHarga = await page.locator('.plan__price').count();
  cek('harga termuat di tujuan', adaHarga === 2, `${adaHarga}`);

  await page.screenshot({ path: `/tmp/home-bridge-${vp.name}.png` });
  await ctx.close();
}

await browser.close();
console.log(gagal === 0 ? '\nSEMUA LULUS' : `\n${gagal} GAGAL`);
process.exit(gagal === 0 ? 0 : 1);
