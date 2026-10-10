/**
 * Uji UI: alur masuk email+sandi, daftar, lupa sandi — browser sungguhan.
 *
 * Menguji HALAMAN SEBENARNYA (dist/sign-in.html, dist/sign-up.html) lewat server
 * uji satu-origin HTTPS, dengan backend nyata.
 */

import pw from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pw;
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 50000 + Math.floor(Math.random() * 900), BE_PORT = PORT + 1;
const BASE = `https://127.0.0.1:${PORT}`;
const DIR = mkdtempSync(join(tmpdir(), 'ui-auth-'));

for (const e of readdirSync('/proc')) {
  if (!/^\d+$/.test(e)) continue; const pid = Number(e);
  if (pid === process.pid || pid === process.ppid) continue;
  try { const c = readFileSync(`/proc/${e}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (/^(\S*\/)?node\s+src\/server\.mjs\s*$/.test(c) || /^(\S*\/)?node\s+serve-uji/.test(c)) process.kill(pid, 'SIGKILL'); } catch {}
}
await new Promise((r) => setTimeout(r, 600));

const CERT = join(DIR, 'c.pem'), KEY = join(DIR, 'k.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', KEY, '-out', CERT,
  '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
  { stdio: 'ignore', timeout: 25000 });
writeFileSync(join(DIR, 'k.env'), '#\n');

const env = { ...process.env, DB_PATH: join(DIR, 'u.db'), PORT: String(BE_PORT), HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: join(DIR, 'k.env'),
  SERVICE_SECRET: 'uji-service-secret-panjang-minimal-24-karakter-abcdef',
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz', SALES_EMAIL: 'u@e.com',
  SITE_URL: BASE,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com', NODE_ENV: 'test' };

const be = spawn('node', ['src/server.mjs'], { cwd: '/home/ubuntu/portfolio-victer/backend', env, stdio: ['ignore','pipe','pipe'] });
let beLog = '';
be.stdout.on('data', d => { beLog += d; }); be.stderr.on('data', d => { beLog += d; });

const fe = spawn('node', ['serve-uji-https.mjs', String(PORT), '/home/ubuntu/portfolio-victer/dist',
  `http://127.0.0.1:${BE_PORT}`, CERT, KEY],
  { cwd: '/home/ubuntu/portfolio-victer/backend', stdio: 'ignore',
    env: { ...process.env, SITEKEY_UJI: '1x00000000000000000000AA' } });

for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250));
  try { const h = await fetch(`http://127.0.0.1:${BE_PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    const f = await fetch(`${BASE}/sign-in.html`, { signal: AbortSignal.timeout(2500) }); if (h.ok && f.ok) break; } catch {} }
console.log(`  ✅ server siap: ${BASE}`);
console.log();

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const hasil = [];
const cek = (nama, dapat, harus) => {
  const ok = JSON.stringify(dapat) === JSON.stringify(harus);
  hasil.push({ nama, ok, dapat, harus });
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 940 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const apiLog = [];
page.on('response', async (r) => {
  const p = new URL(r.url()).pathname;
  if (p.startsWith('/api/')) {
    let b = ''; try { b = (await r.text()).slice(0, 90); } catch {}
    apiLog.push(`${r.status()} ${p} ${b.replace(/\s+/g,' ')}`);
  }
});
page.on('pageerror', (e) => apiLog.push(`PAGEERROR: ${e.message.slice(0, 120)}`));

// Matikan gate untuk uji UI (gate diuji terpisah)
await page.addInitScript(() => {
  try { sessionStorage.setItem('cf_clearance_' + location.hostname, String(Date.now())); } catch {}
});

// ── SUNTIKKAN TOKEN TURNSTILE UJI SEBELUM HALAMAN DIMUAT ────────────────────
//
// ── KENAPA addInitScript, BUKAN page.evaluate() SETELAH LOAD ────────────────
// Percobaan pertama memasang patch lewat page.evaluate() SETELAH halaman
// dimuat — dan tidak berhasil. Sebabnya: auth.js memanggil kirimJson() yang
// memakai window.fetch. Kalau patch dipasang setelah auth.js dimuat, handler
// form sudah memegang referensi fetch yang lama.
//
// addInitScript berjalan SEBELUM skrip halaman apa pun, jadi patch sudah
// terpasang saat auth.js memanggil fetch.
//
// Token 'XXXX.DUMMY.TOKEN.XXXX' lolos karena backend uji memakai SECRET UJI
// Cloudflare (1x0000000000000000000000000000000AA) yang menerima token apa pun.
await page.addInitScript(() => {
  const f = window.fetch;
  window.fetch = function (u, o) {
    const url = typeof u === 'string' ? u : (u?.url ?? '');
    if (url.includes('/api/auth/') && o?.body && typeof o.body === 'string') {
      try {
        const d = JSON.parse(o.body);
        if (!d['cf-turnstile-response']) {
          d['cf-turnstile-response'] = 'XXXX.DUMMY.TOKEN.XXXX';
          o = { ...o, body: JSON.stringify(d) };
        }
      } catch {}
    }
    return f.call(this, u, o);
  };
});

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ 1. HALAMAN MASUK — struktur ═══');
await page.goto(`${BASE}/sign-in.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

{
  const m = await page.evaluate(() => {
    const ada = (s) => !!document.querySelector(s);
    const terlihat = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().width > 0 : false; };
    return {
      panelMasuk: ada('#panel-masuk'),
      panelMasukAktif: document.querySelector('.auth-panel.is-active')?.dataset.panel,
      inpEmail: ada('#inpEmailMasuk'),
      inpSandi: ada('#inpSandi'),
      btnReveal: ada('#btnRevealSandi'),
      btnLupa: ada('#btnLupaSandi'),
      // Field token lama HARUS hilang
      inpTokenLama: ada('#inpToken'),
      inpProjectLama: ada('#inpProject'),
      // Panel daftar HARUS tidak ada di sini (dipisah)
      panelDaftar: ada('#panel-daftar'),
      // Tautan ke halaman daftar
      tautanDaftar: document.querySelector('.auth-foot a[href="/sign-up"]')?.textContent?.trim() ?? '',
      // Dekorasi harus hilang
      blob: document.querySelectorAll('[class*=blob]').length,
      canvas: document.querySelectorAll('canvas').length,
      grain: document.querySelectorAll('[class*=grain]').length,
      // Latar
      latarBg: getComputedStyle(document.querySelector('.auth-bg')).backgroundImage.slice(0, 60),
    };
  });
  console.log(`  panel aktif: ${m.panelMasukAktif}`);
  console.log(`  dekorasi → blob:${m.blob} canvas:${m.canvas} grain:${m.grain}`);

  cek('panel masuk ada & aktif', m.panelMasukAktif, 'masuk');
  cek('input email ada', m.inpEmail, true);
  cek('input sandi ada', m.inpSandi, true);
  cek('tombol tampilkan sandi ada', m.btnReveal, true);
  cek('tautan lupa sandi ada', m.btnLupa, true);
  cek('field token LAMA hilang', m.inpTokenLama, false);
  cek('field proyek LAMA hilang', m.inpProjectLama, false);
  cek('panel daftar DIPISAH (tidak di sini)', m.panelDaftar, false);
  cek('tautan ke /sign-up ada', m.tautanDaftar, 'Daftar sekarang');
  cek('NOL blob (AI slop dihapus)', m.blob, 0);
  cek('NOL canvas partikel', m.canvas, 0);
  cek('NOL grain', m.grain, 0);
}
console.log();

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ 2. HALAMAN DAFTAR ═══');
await page.goto(`${BASE}/sign-up.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

{
  const m = await page.evaluate(() => ({
    judul: document.querySelector('#authTitle')?.textContent?.trim(),
    panelAktif: document.querySelector('.auth-panel.is-active')?.dataset.panel,
    formAda: !!document.querySelector('#formDaftar'),
    fieldNama: !!document.querySelector('#inpNama'),
    fieldEmail: !!document.querySelector('#inpEmail'),
    fieldPerusahaan: !!document.querySelector('#inpPerusahaan'),
    fieldSandi: !!document.querySelector('#inpSandiDaftar'),
    // Field lead HARUS tidak ada — itu pertanyaan sales, bukan sign up.
    fieldAnggaranLama: !!document.querySelector('#inpAnggaran'),
    fieldUrgensiLama: !!document.querySelector('#inpUrgensi'),
    fieldPesanLama: !!document.querySelector('#inpPesan'),
    // Syarat & ketentuan — ketiga referensi korporasi menampilkannya.
    legal: !!document.querySelector('.auth-legal'),
    legalTeks: (document.querySelector('.auth-legal')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70),
    // Perusahaan harus OPSIONAL
    perusahaanWajib: document.querySelector('#inpPerusahaan')?.required === true,
    // SSO harus TERSEMBUNYI default (backend belum punya OAuth)
    ssoTersembunyi: document.querySelector('.auth-sso')?.hidden === true,
    tautanMasuk: document.querySelector('.auth-alt-bawah a[href="/sign-in"]')?.textContent?.trim() ?? '',
    // Panel login TIDAK boleh ada di halaman daftar
    panelMasuk: !!document.querySelector('#panel-masuk'),
  }));
  console.log(`  judul: "${m.judul}" · panel: ${m.panelAktif}`);
  console.log(`  field: nama=${m.fieldNama} email=${m.fieldEmail} perusahaan=${m.fieldPerusahaan} anggaran=${m.fieldAnggaran} urgensi=${m.fieldUrgensi} pesan=${m.fieldPesan}`);

  cek('judul halaman = Daftar', m.judul, 'Daftar');
  cek('panel daftar aktif', m.panelAktif, 'daftar');
  cek('form daftar ada', m.formAda, true);
  cek('field nama', m.fieldNama, true);
  cek('field email', m.fieldEmail, true);
  cek('field perusahaan', m.fieldPerusahaan, true);
  cek('field sandi', m.fieldSandi, true);
  cek('field anggaran LAMA hilang (bukan sign up)', m.fieldAnggaranLama, false);
  cek('field urgensi LAMA hilang', m.fieldUrgensiLama, false);
  cek('field pesan LAMA hilang', m.fieldPesanLama, false);
  cek('syarat & ketentuan ada', m.legal, true);
  cek('perusahaan OPSIONAL', m.perusahaanWajib, false);
  cek('SSO tersembunyi (backend belum siap)', m.ssoTersembunyi, true);
  console.log(`  legal: "${m.legalTeks}"`);
  cek('tautan ke /sign-in ada', m.tautanMasuk, 'Masuk');
  cek('panel masuk TIDAK di halaman daftar', m.panelMasuk, false);
}
console.log();

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ 3. DAFTAR AKUN (lewat UI) ═══');
{
  await page.fill('#inpNama', 'Budi Santoso');
  await page.fill('#inpEmail', 'budi@perusahaan.com');
  await page.fill('#inpPerusahaan', 'PT Teknologi Uji');
  await page.fill('#inpSandiDaftar', 'sandi-panjang-sekali-2026');

  await page.click('#btnDaftar');
  await page.waitForTimeout(3000);

  const panel = await page.evaluate(() => document.querySelector('.auth-panel.is-active')?.dataset.panel);
  console.log(`  panel setelah kirim: ${panel}`);
  cek('pindah ke panel selesai', panel, 'daftar-selesai');

  // ── REDIRECT KE HALAMAN MASUK ─────────────────────────────────────────────
  // Setelah 2,2 detik pengguna dialihkan ke /sign-in?email=... supaya langsung
  // bisa mencoba masuk, dan tidak perlu mengetik ulang emailnya.
  await page.waitForURL(/\/masuk/, { timeout: 8000 }).catch(() => {});
  const urlAkhir = page.url();
  console.log(`  URL setelah tunggu: ${urlAkhir.replace(BASE, '')}`);
  cek('dialihkan ke /sign-in', /\/masuk/.test(urlAkhir), true);
  cek('email dibawa di query string', /email=/.test(urlAkhir), true);

  // ── Email harus terisi otomatis ───────────────────────────────────────────
  //
  // ── KENAPA PERLU waitForFunction, BUKAN LANGSUNG inputValue() ─────────────
  // `waitForURL` selesai begitu navigasi MULAI, bukan saat skrip halaman
  // selesai berjalan. auth.js mengisi emailnya di dalam init() yang berjalan
  // setelah DOMContentLoaded — jadi membaca langsung menghasilkan string
  // kosong, padahal pengisiannya bekerja.
  //
  // Diagnosa terpisah membuktikan nilainya benar ("budi@perusahaan.com")
  // saat halaman diberi waktu. Ini murni artefak timing uji, bukan bug.
  // ── TUNGGU NAVIGASI SELESAI, BUKAN HANYA URL BERUBAH ──────────────────────
  //
  // ── KENAPA INI PENYEBAB KEGAGALAN PALSU ───────────────────────────────────
  // `waitForURL` selesai begitu URL berubah — itu terjadi SANGAT AWAL dalam
  // navigasi, sebelum DOM halaman baru terbentuk dan sebelum auth.js
  // berjalan. Membaca #inpEmailMasuk saat itu menghasilkan string kosong.
  //
  // Diagnosa terpisah membuktikan pengisiannya BEKERJA: dengan
  // waitUntil:'networkidle' atau jeda 3,5 detik, nilainya benar
  // ("budi@perusahaan.com"). Jadi ini murni artefak timing uji.
  //
  // `waitForLoadState('load')` menunggu peristiwa load — setelah semua
  // subresource selesai dan skrip defer sudah dijalankan. Baru setelah itu
  // nilai diperiksa.
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);   // beri init() kesempatan menyelesaikan sisanya

  const emailOtomatis = await page.inputValue('#inpEmailMasuk').catch(() => '');
  const urlPersis = page.url();
  console.log(`  email terisi otomatis: "${emailOtomatis}" (panjang ${emailOtomatis.length})`);
  console.log(`  URL persis: ${urlPersis}`);
  cek('email terisi dari URL', emailOtomatis, 'budi@perusahaan.com');
}
console.log();

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ 4. MASUK (lewat UI) ═══');
await page.goto(`${BASE}/sign-in.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
{
  await page.fill('#inpEmailMasuk', 'budi@perusahaan.com');
  await page.fill('#inpSandi', 'sandi-panjang-sekali-2026');
  await page.click('#btnSubmit');

  await page.waitForFunction(() => {
    const p = document.querySelector('.auth-panel.is-active')?.dataset.panel;
    return p === 'done' || p === 'totp';
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);

  const panel = await page.evaluate(() => document.querySelector('.auth-panel.is-active')?.dataset.panel);
  console.log(`  panel setelah masuk: ${panel}`);
  cek('masuk berhasil (panel done)', panel, 'done');

  const cookies = await ctx.cookies();
  const sesi = cookies.find((c) => c.name === 'portfolio_session');
  cek('cookie sesi dibuat', !!sesi, true);
  if (sesi) console.log(`  cookie sesi: httpOnly=${sesi.httpOnly} secure=${sesi.secure}`);
}
console.log();

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ 5. LUPA SANDI (lewat UI) ═══');
await page.goto(`${BASE}/sign-in.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
{
  await page.fill('#inpEmailMasuk', 'budi@perusahaan.com');
  await page.click('#btnLupaSandi');
  await page.waitForTimeout(500);

  const panelLupa = await page.evaluate(() => document.querySelector('.auth-panel.is-active')?.dataset.panel);
  console.log(`  panel setelah klik "Lupa sandi?": ${panelLupa}`);
  cek('pindah ke panel lupa', panelLupa, 'lupa');

  // Email harus terisi otomatis
  const emailTerisi = await page.inputValue('#inpEmailLupa');
  cek('email terisi otomatis', emailTerisi, 'budi@perusahaan.com');
  console.log(`  email terisi otomatis: ${emailTerisi}`);

  await page.click('#btnLupa');
  await page.waitForTimeout(3000);
  const panelSelesai = await page.evaluate(() => document.querySelector('.auth-panel.is-active')?.dataset.panel);
  console.log(`  panel setelah kirim: ${panelSelesai}`);
  cek('pindah ke panel lupa-selesai', panelSelesai, 'lupa-selesai');
}
console.log();

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ 6. KONSOL BERSIH ═══');
{
  const err = apiLog.filter((l) => l.startsWith('PAGEERROR'));
  cek('tidak ada error JS', err.length, 0);
  if (err.length) err.forEach((e) => console.log(`  ❌ ${e}`));
}
console.log();

console.log('  ── API yang dipanggil ──');
for (const a of apiLog.slice(-10)) console.log(`    ${a}`);

await browser.close();
be.kill('SIGKILL'); fe.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 500));
rmSync(DIR, { recursive: true, force: true });

console.log();
console.log('══════════════════════════════════════════════════════════════');
let lulus = 0, gagal = 0;
for (const c of hasil) {
  if (c.ok) { lulus++; console.log(`  ✅ ${c.nama}`); }
  else { gagal++; console.log(`  ❌ ${c.nama}\n      dapat: ${JSON.stringify(c.dapat)}\n      harus: ${JSON.stringify(c.harus)}`); }
}
console.log('══════════════════════════════════════════════════════════════');
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
if (gagal) console.log('\n  Log backend:\n' + beLog.split('\n').slice(-15).map(l => '  ' + l).join('\n'));
process.exit(gagal === 0 ? 0 : 1);
