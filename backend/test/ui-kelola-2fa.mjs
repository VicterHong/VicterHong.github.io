/**
 * E2E kelola 2FA di /keamanan, browser sungguhan, DB sementara.
 * Sesi + 2FA disiapkan langsung di DB uji (form login uji lama rusak).
 */
import pw from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pw;
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 52000 + Math.floor(Math.random() * 800), BE_PORT = PORT + 1;
const BASE = `https://127.0.0.1:${PORT}`;
const DIR = mkdtempSync(join(tmpdir(), 'ui-kelola2fa-'));
const CERT = join(DIR, 'c.pem'), KEY = join(DIR, 'k.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', KEY, '-out', CERT, '-days', '1', '-nodes',
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore', timeout: 25000 });
const DB = join(DIR, 'u.db');
writeFileSync(join(DIR, 'k.env'), '#\n');
const SECRET = 'uji-kelola-2fa-secret-panjang-minimal-24-karakter';
const env = { ...process.env, DB_PATH: DB, PORT: String(BE_PORT), HOST: '127.0.0.1', TOKEN_SERVICE_ENV: join(DIR, 'k.env'),
  SERVICE_SECRET: SECRET, ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz', SALES_EMAIL: 'u@e.com', SITE_URL: BASE,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: '127.0.0.1,example.com', NODE_ENV: 'test', ALLOWED_ORIGINS: BASE };

// Siapkan akun + sesi + 2FA aktif memakai modul backend asli.
const siap = execFileSync(process.execPath, ['--input-type=module', '-e', `
  const { openDb, closeDb } = await import('./src/db.mjs');
  const { config } = await import('./src/config.mjs');
  const { buatPengguna, siapkanTabelPengguna } = await import('./src/users.mjs');
  const { initRoutes } = await import('./src/routes.mjs');
  const { issueToken } = await import('./src/tokens.mjs');
  const { createSession } = await import('./src/sessions.mjs');
  const { mulaiEnrollment, selesaikanEnrollment } = await import('./src/totp-service.mjs');
  const { buatTotp } = await import('./src/totp.mjs');
  openDb(process.env.DB_PATH);
  try { siapkanTabelPengguna(); } catch {}
  initRoutes();
  const email = 'kelola@contoh.test';
  const t = issueToken({ secret: config.secret, projectSlug: 'mina', label: email, issuedTo: email, issuedBy: 'test', tier: 'standard' });
  await buatPengguna({ email, nama: 'Akun Uji', perusahaan: '', sandi: 'Sandi-uji-yang-kuat-987!', tokenId: t.id });
  const s = createSession({ tokenId: t.id, secret: config.secret });
  const m = mulaiEnrollment(email, config);
  const r = selesaikanEnrollment(email, buatTotp(m.secret), config);
  closeDb();
  console.log(JSON.stringify({ sesi: s.id, secret: m.secret, pemulihan: r.kode_pemulihan }));
`], { cwd: join(AKAR, 'backend'), env, encoding: 'utf8' }).trim().split('\n').pop();
const { sesi, secret } = JSON.parse(siap);

const be = spawn('node', ['src/server.mjs'], { cwd: join(AKAR, 'backend'), env, stdio: 'ignore' });
const fe = spawn('node', ['serve-uji-https.mjs', String(PORT), join(AKAR, 'dist'), `http://127.0.0.1:${BE_PORT}`, CERT, KEY],
  { cwd: join(AKAR, 'backend'), stdio: 'ignore', env: { ...process.env, SITEKEY_UJI: '1x00000000000000000000AA' } });
await new Promise((r) => setTimeout(r, 3500));

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = String(dapat) === String(harap);
  ok ? lulus++ : gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${nama}${ok ? '' : `  (dapat: ${dapat}, harap: ${harap})`}`);
};
const totp = () => execFileSync(process.execPath, ['--input-type=module', '-e',
  `const { buatTotp } = await import('./src/totp.mjs'); console.log(buatTotp(${JSON.stringify(secret)}));`],
  { cwd: join(AKAR, 'backend'), encoding: 'utf8' }).trim();
const isiOtp = async (page, sel, kode) => { const cells = page.locator(`${sel} .auth-otp-cell`); for (let i = 0; i < 6; i++) await cells.nth(i).fill(kode[i]); };

const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--no-sandbox'] });
const shots = process.env.SHOTS || '';
try {
  for (const w of shots ? [360, 1280] : [1280]) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: 900 } });
    await ctx.addCookies([{ name: 'portfolio_session', value: sesi, url: BASE, secure: true, httpOnly: true }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/keamanan#panelMasuk`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    if (w !== 1280) {
      await page.click('#kamAktifkan2fa'); await page.waitForTimeout(800);
      await page.locator('#kamDialogKelola2fa .kam-dialog-kotak').screenshot({ path: `${shots}-kelola-${w}.png` });
      await page.click('#kamNonaktif2fa'); await page.waitForTimeout(500);
      await page.locator('#kamDialogKelola2fa .kam-dialog-kotak').screenshot({ path: `${shots}-konfirmasi-${w}.png` });
      await ctx.close(); continue;
    }

    const awal = await page.evaluate(() => ({ lencana: document.querySelector('#kamLencana2fa')?.textContent.trim(),
      tombol: document.querySelector('#kamAktifkan2fa')?.textContent.trim(), teks: document.querySelector('#kamTeks2fa')?.textContent.trim() }));
    cek('lencana "Aktif"', awal.lencana, 'Aktif');
    cek('tombol "Kelola"', awal.tombol, 'Kelola');
    cek('"Aktif sejak" berisi tanggal, bukan kosong', /Aktif sejak \S/.test(awal.teks) && !/Invalid|undefined|—/.test(awal.teks), true);

    await page.click('#kamAktifkan2fa'); await page.waitForTimeout(800);
    const kel = await page.evaluate(() => ({ kelola: !document.querySelector('#kamDialogKelola2fa').hidden,
      setup: !document.querySelector('#kamDialog2fa').hidden, sisa: document.querySelector('#kamKelolaSisa').textContent.trim(),
      sejak: document.querySelector('#kamKelolaSejak').textContent.trim() }));
    cek('Kelola membuka dialog kelola', kel.kelola, true);
    cek('Kelola TIDAK membuka setup ulang', kel.setup, false);
    cek('sisa kode pemulihan tampil', kel.sisa, '8 dari 8 tersisa');
    cek('aktif sejak tampil', kel.sejak !== '—', true);

    // Kode pemulihan baru
    await page.click('#kamKodeBaru2fa'); await page.waitForTimeout(400);
    await isiOtp(page, '#kamOtpKelola2fa', '000000'); await page.waitForTimeout(1500);
    const salah = await page.evaluate(() => ({ kelas: document.querySelector('#kamPesanKelola2fa').className,
      masih: !document.querySelector('#kamKelolaKonfirmasi').hidden }));
    cek('kode salah ditolak dengan pesan galat', /is-galat/.test(salah.kelas), true);
    cek('kode salah tetap di langkah konfirmasi', salah.masih, true);

    await isiOtp(page, '#kamOtpKelola2fa', totp()); await page.waitForTimeout(2000);
    const baru = await page.evaluate(() => ({ tampil: !document.querySelector('#kamKelolaKodeBaru').hidden,
      n: document.querySelectorAll('#kamKelolaDaftarKode li').length,
      pesan: document.querySelector('#kamPesanKelola2fa').textContent.trim(),
      digit: [...document.querySelectorAll('#kamOtpKelola2fa .auth-otp-cell')].map((c) => c.value).join('') }));
    if (!baru.tampil) console.log('     pesan:', baru.pesan, '| digit di sel:', baru.digit);
    cek('kode pemulihan baru tampil', baru.tampil, true);
    cek('8 kode baru', baru.n, 8);
    await page.click('#kamKelolaSelesai'); await page.waitForTimeout(600);

    // Nonaktifkan memakai kode pemulihan BARU (skenario ponsel hilang)
    const kodeBaru = await page.evaluate(() => document.querySelector('#kamKelolaDaftarKode li')?.textContent.trim());
    await page.click('#kamAktifkan2fa'); await page.waitForTimeout(600);
    await page.click('#kamNonaktif2fa'); await page.waitForTimeout(400);
    const lanjutTeks = await page.locator('#kamKelolaLanjut').textContent();
    cek('tombol konfirmasi bertuliskan "Nonaktifkan"', lanjutTeks.trim(), 'Nonaktifkan');
    await page.click('#kamKelolaPakaiPemulihan summary');
    await page.fill('#kamKelolaPemulihan', kodeBaru);
    await page.click('#kamKelolaLanjut'); await page.waitForTimeout(2500);
    const akhir = await page.evaluate(() => ({ tutup: document.querySelector('#kamDialogKelola2fa').hidden,
      lencana: document.querySelector('#kamLencana2fa').textContent.trim(), tombol: document.querySelector('#kamAktifkan2fa').textContent.trim(),
      pesan: document.querySelector('#kamPesan2fa').textContent.trim() }));
    cek('dialog tertutup setelah nonaktif', akhir.tutup, true);
    cek('lencana jadi "Belum aktif"', akhir.lencana, 'Belum aktif');
    cek('tombol kembali "Aktifkan"', akhir.tombol, 'Aktifkan');
    cek('pesan konfirmasi tampil', akhir.pesan, 'Verifikasi 2 langkah dinonaktifkan.');

    const srv = await page.evaluate(async () => (await (await fetch('/api/auth/2fa/status')).json()).aktif);
    cek('server: 2FA benar-benar mati', srv, false);

    await page.click('#kamAktifkan2fa'); await page.waitForTimeout(600);
    cek('setelah nonaktif, tombol membuka setup lagi', await page.evaluate(() => !document.querySelector('#kamDialog2fa').hidden), true);

    await page.goto(`${BASE}/keamanan#panelAktivitas`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
    const akt = await page.evaluate(async () => (await (await fetch('/api/auth/aktivitas')).json()));
    const aksi = (akt.aktivitas ?? akt.daftar ?? akt.items ?? []).map((a) => a.aksi);
    cek('riwayat mencatat nonaktif', aksi.includes('totp_nonaktif'), true);
    cek('riwayat mencatat kode baru', aksi.includes('totp_kode_pemulihan_baru'), true);
    await ctx.close();
  }
} finally {
  await browser.close(); be.kill('SIGKILL'); fe.kill('SIGKILL'); rmSync(DIR, { recursive: true, force: true });
}
console.log(`\n  LULUS: ${lulus}   GAGAL: ${gagal}`);
process.exit(gagal ? 1 : 0);
