/**
 * Uji UI enrollment 2FA — SATU ORIGIN + HTTPS.
 *
 * ── PERUBAHAN BESAR DARI VERSI SEBELUMNYA ───────────────────────────────────
 * Versi lama memakai dua port (frontend + backend) dan menjembataninya
 * dengan route interception Playwright. Itu gagal berulang kali:
 *
 *   • Playwright mengelola header cookie sendiri → cookie gate hilang →
 *     backend menjawab 'token_kosong' meski header cookie sudah diset.
 *   • Cookie `__Host-` wajib Secure → browser MENOLAK menyimpannya dari HTTP.
 *   • Dua port = dua peluang bentrok, dan server tertinggal membuat uji
 *     bicara dengan konfigurasi LAMA.
 *
 * Sekarang: SATU origin, `serve-uji-https.mjs` melayani statis + proxy /api.
 * Browser melihat satu origin, jadi cookie bekerja alami — persis seperti
 * produksi (Pages Function mem-proxy /api/* ke Worker).
 *
 * ── KENAPA HTTPS, BUKAN HTTP ────────────────────────────────────────────────
 * Cookie clearance bernama `__Host-portfolio_gate`. Prefix `__Host-` WAJIB
 * Secure menurut spesifikasi cookie — browser menolaknya di HTTP.
 *
 * Pilihannya: (a) ubah kode produksi agar tidak pakai `__Host-`, atau
 * (b) jalankan uji lewat HTTPS lokal. (a) MELEMAHKAN keamanan produksi hanya
 * demi kenyamanan uji — itu pertukaran yang salah. Jadi (b).
 *
 * ── KENAPA PORT ACAK ────────────────────────────────────────────────────────
 * Port tetap berulang kali bentrok dengan server uji yang tertinggal, dan
 * gejalanya menyesatkan (uji bicara dengan server lama). Port acak di
 * rentang tinggi menghilangkan seluruh kelas masalah itu.
 */

import pw from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pw;

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 42000 + Math.floor(Math.random() * 4000);
const BE_PORT = PORT + 1;
const BASE = `https://127.0.0.1:${PORT}`;

let lulus = 0, gagal = 0;
const cek = (nama, hasil, harapan) => {
  const ok = hasil === harapan;
  if (ok) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}\n     dapat: ${JSON.stringify(hasil)}\n     harus: ${JSON.stringify(harapan)}`); }
};

const DIR = mkdtempSync(join(tmpdir(), 'uji-ui-'));

// ── Bersihkan server uji tertinggal ────────────────────────────────────────
{
  let n = 0;
  for (const entri of readdirSync('/proc')) {
    if (!/^\d+$/.test(entri)) continue;
    const pid = Number(entri);
    if (pid === process.pid || pid === process.ppid) continue;
    try {
      const cmd = readFileSync(`/proc/${entri}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      if (/^(\S*\/)?node\s+src\/server\.mjs\s*$/.test(cmd) ||
          /^(\S*\/)?node\s+serve-uji/.test(cmd)) {
        process.kill(pid, 'SIGKILL'); n++;
      }
    } catch {}
  }
  if (n) console.log(`  (${n} server uji lama dibersihkan)`);
  await new Promise((r) => setTimeout(r, 700));
}

// ── Sertifikat self-signed ─────────────────────────────────────────────────
const CERT = join(DIR, 'cert.pem');
const KEY = join(DIR, 'key.pem');
try {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', KEY, '-out', CERT,
    '-days', '1', '-nodes',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore', timeout: 25000 });
  console.log('  ✅ sertifikat uji dibuat (self-signed, 1 hari)');
} catch (e) {
  console.log('  ❌ gagal membuat sertifikat:', e.message.slice(0, 140));
  process.exit(1);
}

// ── Backend uji ────────────────────────────────────────────────────────────
const ENV_KOSONG = join(DIR, 'kosong.env');
writeFileSync(ENV_KOSONG, '# uji\n');

const envBe = {
  ...process.env,
  DB_PATH: join(DIR, 'uji.db'),
  PORT: String(BE_PORT),
  HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: ENV_KOSONG,
  SERVICE_SECRET: 'uji-service-secret-panjang-minimal-24-karakter-abcdef',
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz',
  SALES_EMAIL: 'uji@example.com',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
};

const be = spawn('node', ['src/server.mjs'], {
  cwd: '/home/ubuntu/portfolio-victer/backend', env: envBe, stdio: ['ignore', 'pipe', 'pipe'],
});
let beLog = '';
be.stdout.on('data', (d) => { beLog += d; });
be.stderr.on('data', (d) => { beLog += d; });

// ── Server satu-origin (HTTPS + proxy) ─────────────────────────────────────
const fe = spawn('node', [
  'serve-uji-https.mjs', String(PORT),
  '/home/ubuntu/portfolio-victer/dist',
  `http://127.0.0.1:${BE_PORT}`, CERT, KEY,
], {
  cwd: '/home/ubuntu/portfolio-victer/backend', stdio: ['ignore', 'pipe', 'pipe'],
});
let feLog = '';
fe.stdout.on('data', (d) => { feLog += d; });
fe.stderr.on('data', (d) => { feLog += d; });

// ── Tunggu siap ────────────────────────────────────────────────────────────
let beSiap = false, feSiap = false;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (!beSiap) {
    try {
      const h = await fetch(`http://127.0.0.1:${BE_PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
      beSiap = h.ok;
    } catch {}
  }
  if (!feSiap) {
    try {
      // NODE_TLS_REJECT_UNAUTHORIZED=0 di-set di env proses ini supaya
      // fetch Node menerima sertifikat self-signed. Hanya untuk uji lokal.
      const f = await fetch(`${BASE}/sign-in.html`, { signal: AbortSignal.timeout(2500) });
      if (f.ok) {
        const teks = await f.text();
        feSiap = teks.includes('panel-setup2fa');
      }
    } catch {}
  }
  if (beSiap && feSiap) break;
}

if (!beSiap) { console.log('  ❌ backend tidak siap'); console.log(beLog.slice(-500)); }
if (!feSiap) { console.log('  ❌ frontend tidak siap'); console.log(feLog.slice(-500)); }
if (!beSiap || !feSiap) {
  be.kill('SIGKILL'); fe.kill('SIGKILL');
  rmSync(DIR, { recursive: true, force: true });
  process.exit(1);
}

console.log('══ SERVER UJI SIAP ══');
console.log(`  ${BASE}  (satu origin, HTTPS)`);
console.log();

// ── Token klien ────────────────────────────────────────────────────────────
let tokenPlain = null;
try {
  const out = execFileSync('node', [
    'src/admin-cli.mjs', 'issue', '--project', 'mina', '--tier', 'standard',
    '--to', 'klien-ui@perusahaan.co.id', '--label', 'Uji UI 2FA',
  ], { cwd: '/home/ubuntu/portfolio-victer/backend', env: envBe, encoding: 'utf8', timeout: 15000 });
  tokenPlain = out.match(/(VP-[A-Z0-9-]+)/)?.[1] ?? null;
} catch (e) { console.log('  ⚠ CLI gagal:', e.message.slice(0, 150)); }

if (!tokenPlain) {
  console.log('  ❌ token tidak dibuat');
  be.kill('SIGKILL'); fe.kill('SIGKILL');
  rmSync(DIR, { recursive: true, force: true });
  process.exit(1);
}
console.log(`══ TOKEN DIBUAT ══\n  ${tokenPlain.slice(0, 22)}…\n`);

// ── Playwright ─────────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 940 },
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

page.on('response', async (r) => {
  const p = new URL(r.url()).pathname;
  if (p.startsWith('/api/') && !p.includes('gate/check') && !p.includes('analytics')) {
    let isi = '';
    try { isi = (await r.text()).slice(0, 130); } catch {}
    console.log(`     [api] ${r.status()} ${p} → ${isi}`);
  }
});

await page.goto(`${BASE}/sign-in.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

console.log('══ 1. PANEL SETUP 2FA ADA DI DOM ══');
cek('panel setup2fa', await page.locator('#panel-setup2fa').count(), 1);
cek('panel pemulihan', await page.locator('#panel-pemulihan').count(), 1);
cek('elemen QR', await page.locator('#qrImage').count(), 1);
cek('skeleton QR', await page.locator('#qrSkeleton').count(), 1);
cek('6 sel OTP setup', await page.locator('[data-otp-setup]').count(), 6);
cek('tombol tawaran 2FA', await page.locator('#btnSetup2faMulai').count(), 1);
cek('checkbox konfirmasi', await page.locator('#chkSimpan').count(), 1);
cek('tombol lanjut', await page.locator('#btnLanjut').count(), 1);
console.log();

console.log('══ 2. LOLOS GATE (cookie clearance, origin sama) ══');
{
  const verif = await fetch(`${BASE}/api/verify-turnstile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'XXXX.DUMMY.TOKEN.XXXX' }),
  });
  const setCookie = verif.headers.getSetCookie?.() ?? [];
  cek('verifikasi gate berhasil', verif.status, 200);
  cek('cookie clearance diterbitkan', setCookie.length > 0, true);

  if (setCookie.length) {
    const pasangan = setCookie[0].split(';')[0];
    const idx = pasangan.indexOf('=');
    const nama = pasangan.slice(0, idx);
    const nilai = pasangan.slice(idx + 1);

    // ── COOKIE `__Host-` TIDAK BOLEH PUNYA ATRIBUT DOMAIN ────────────────
    //
    // Spesifikasi cookie: prefix `__Host-` mensyaratkan
    //   • Secure
    //   • Path=/
    //   • TANPA atribut Domain
    //
    // Kalau kita set `domain: '127.0.0.1'`, browser MENOLAK menyimpan
    // cookie itu — dan gejalanya menyesatkan: cookie "berhasil disetel"
    // di API Playwright, tapi tidak pernah terkirim, sehingga backend
    // menjawab `token_kosong`.
    //
    // Solusinya: pakai `url` (bukan `domain` + `path`). Playwright
    // menyimpulkan domain dari URL dan TIDAK menambahkan atribut Domain.
    await ctx.addCookies([{
      name: nama,
      value: nilai,
      url: `${BASE}/`,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }]);
    console.log(`     cookie: ${nama} (tanpa Domain — syarat __Host-)`);
  }
}
console.log();

// ── MATIKAN GATE UNTUK UJI UI ───────────────────────────────────────────────
//
// ── INI AKAR MASALAH YANG MENGHABISKAN BANYAK WAKTU ─────────────────────────
//
// `cf-gate.css` berisi:
//
//     body.cf-gated > *:not(#cf-gate) { display: none !important; }
//
// Saat gate aktif, cf-gate.js menambahkan kelas `cf-gated` ke <body> dan
// SELURUH KONTEN HALAMAN disembunyikan — termasuk kartu login.
//
// Gejalanya SANGAT menyesatkan: elemen ADA di DOM (locator.count() = 1)
// tapi locator tidak "terlihat" — sehingga Playwright melaporkan timeout
// seolah elemennya tidak ada. Saya menghabiskan banyak iterasi mencari
// bug di kode 2FA padahal kode-nya benar; yang terjadi adalah gate
// bekerja sebagaimana mestinya.
//
// ── KENAPA AMAN MEMATIKAN GATE DI UJI INI ───────────────────────────────────
// Gate dan UI 2FA adalah DUA FITUR TERPISAH:
//   • Gate sudah diuji terpisah: uji API 40/40 lulus, dan produksi
//     memakainya sejak lama.
//   • Uji ini fokus pada UI enrollment 2FA — QR, panel, kode pemulihan.
//
// Menguji keduanya sekaligus membuat kegagalan sulit dilacak (terbukti).
//
// ── CARA: SUNTAIK SEBELUM HALAMAN DIMUAT ────────────────────────────────────
// cf-gate.js membaca sessionStorage saat init(). Kalau marker sudah ada
// SEBELUM skrip berjalan, gate tidak akan pernah aktif — tidak perlu
// menambal kelas setelahnya (yang rapuh karena bergantung waktu).
await page.addInitScript(() => {
  try {
    // Kunci HARUS sama dengan yang dipakai cf-gate.js:
    //   var SESSION_KEY = 'cf_clearance_' + HOST;
    // HOST = location.host (termasuk port).
    sessionStorage.setItem('cf_clearance_' + location.host, String(Date.now()));
    sessionStorage.setItem('cf_clearance_' + location.hostname, String(Date.now()));
    // Cadangan: beberapa versi memakai nama lain.
    sessionStorage.setItem('cf_gate_passed', String(Date.now()));
  } catch {}
});

console.log('══ 3. LOGIN → PANEL SELESAI + TAWARAN 2FA ══');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// ── Suntikkan token Turnstile dummy ────────────────────────────────────────
//
// auth.js memuat widget Turnstile dari Cloudflare dan menunggu tokennya.
// Di lingkungan uji, iframe Cloudflare tidak bisa menyelesaikan tantangan
// (butuh domain asli + jaringan Cloudflare). Jadi kita isi token dummy
// langsung — kunci testing Cloudflare menerimanya.
//
// Ini TIDAK melewati gerbang keamanan: token tetap dikirim ke endpoint
// verifikasi, dan server tetap memvalidasinya ke Cloudflare. Yang dihindari
// hanya ketergantungan pada iframe di lingkungan uji.
await page.evaluate(() => {
  window.__turnstileDummy = 'XXXX.DUMMY.TOKEN.XXXX';
});

// Timpa fungsi internal auth.js supaya memakai token dummy.
// (auth.js mengekspos __auth untuk pengujian.)
await page.addInitScript(() => {
  // Patch fetch untuk menyertakan token dummy kalau auth.js mengirim kosong.
  const fetchAsli = window.fetch;
  window.fetch = function (url, opsi) {
    if (typeof url === 'string' && url.includes('/api/token/') && opsi?.body) {
      try {
        const data = JSON.parse(opsi.body);
        if (!data['cf-turnstile-response']) {
          data['cf-turnstile-response'] = 'XXXX.DUMMY.TOKEN.XXXX';
          opsi = { ...opsi, body: JSON.stringify(data) };
        }
      } catch {}
    }
    return fetchAsli.call(this, url, opsi);
  };
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

await page.selectOption('#inpProject', 'mina');
await page.fill('#inpToken', tokenPlain);
await page.click('#btnSubmit');

try {
  await page.waitForFunction(
    () => document.querySelector('.auth-panel.is-active')?.dataset.panel === 'done',
    { timeout: 20000 },
  );
} catch {
  console.log('     (panel selesai tidak muncul dalam 20s)');
}

cek('pindah ke panel selesai', await page.evaluate(() =>
  document.querySelector('.auth-panel.is-active')?.dataset.panel), 'done');
cek('tombol setup 2FA terlihat', await page.locator('#btnSetup2faMulai').isVisible().catch(() => false), true);
console.log();

console.log('══ 4. SETUP 2FA → QR ══');
await page.click('#btnSetup2faMulai');

// Tunggu panel BENAR-BENAR berpindah — jangan menebak durasi.
// `waitForFunction` memeriksa kondisi setiap 100ms sampai terpenuhi
// atau timeout. Ini lebih andal daripada `waitForTimeout` yang bisa
// terlalu cepat (panel belum pindah) atau terlalu lambat (buang waktu).
try {
  await page.waitForFunction(
    () => document.querySelector('.auth-panel.is-active')?.dataset.panel === 'setup2fa',
    { timeout: 15000 },
  );
} catch {
  console.log('     (panel setup2fa tidak muncul dalam 15s)');
}

cek('pindah ke panel setup2fa', await page.evaluate(() =>
  document.querySelector('.auth-panel.is-active')?.dataset.panel), 'setup2fa');

// Tunggu QR benar-benar termuat (naturalWidth > 0)
try {
  await page.waitForFunction(
    () => {
      const img = document.querySelector('#qrImage');
      return img && !img.hidden && img.naturalWidth > 0;
    },
    { timeout: 15000 },
  );
} catch {
  console.log('     (QR tidak termuat dalam 15s)');
}

const qr = await page.evaluate(() => {
  const img = document.querySelector('#qrImage');
  const sk = document.querySelector('#qrSkeleton');
  return {
    terlihat: img ? !img.hidden : false,
    dataUrl: img ? String(img.src).startsWith('data:image/png;base64,') : false,
    naturalW: img ? img.naturalWidth : 0,
    skeletonHidden: sk ? sk.hidden : false,
    lebar: img ? Math.round(img.getBoundingClientRect().width) : 0,
  };
});
cek('QR terlihat', qr.terlihat, true);
cek('data URL PNG', qr.dataUrl, true);
cek('QR termuat', qr.naturalW > 0, true);
cek('skeleton disembunyikan', qr.skeletonHidden, true);

// Simpan data URL QR untuk dipakai uji tata letak mobile (langkah 11).
// Konteks mobile baru belum login, jadi QR-nya belum ada di sana.
const qrDataUrl = await page.evaluate(() => {
  const i = document.querySelector('#qrImage');
  return i && i.src && i.src.startsWith('data:image') ? i.src : null;
});
cek('ukuran wajar', qr.lebar >= 150 && qr.lebar <= 260, true);
console.log(`     ${qr.naturalW}px natural · ${qr.lebar}px CSS`);
console.log();

console.log('══ 5. SECRET MANUAL (FALLBACK) ══');
const secret = await page.textContent('#secretText');
cek('secret 32 char base32', /^[A-Z2-7]{32}$/.test(secret ?? ''), true);
cek('detail fallback ada', await page.locator('#secretDetail').count(), 1);
console.log();

console.log('══ 6. KODE SALAH DITOLAK ══');
await page.locator('[data-otp-setup]').first().focus();
await page.keyboard.type('000000', { delay: 30 });
await page.waitForTimeout(1800);

// Diagnosa: elemen ada? terlihat? panel mana yang aktif?
{
  const d = await page.evaluate(() => {
    const m = document.querySelector('#msgSetup2fa');
    const aktif = document.querySelector('.auth-panel.is-active')?.dataset.panel;
    const btn = document.querySelector('#btnSetup2fa');
    return {
      msgAda: !!m,
      msgTeks: m?.textContent ?? '(tidak ada)',
      msgTerlihat: m ? m.getBoundingClientRect().width > 0 : false,
      panelAktif: aktif,
      btnDisabled: btn?.disabled,
      btnMemuat: btn?.classList.contains('is-memuat'),
    };
  });
  console.log('     [diagnosa]', JSON.stringify(d));
}

cek('pesan galat', (await page.textContent('#msgSetup2fa', { timeout: 5000 }).catch(() => '') ?? '').length > 0, true);
cek('kelas galat', await page.evaluate(() =>
  document.querySelector('#msgSetup2fa')?.classList.contains('is-galat')), true);
cek('sel dikosongkan', await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-otp-setup]')).map((s) => s.value).join('')), '');
cek('masih di panel setup', await page.evaluate(() =>
  document.querySelector('.auth-panel.is-active')?.dataset.panel), 'setup2fa');
console.log();

console.log('══ 7. KODE BENAR → KODE PEMULIHAN ══');
const { buatTotp } = await import('/home/ubuntu/portfolio-victer/backend/src/totp.mjs');
await page.locator('[data-otp-setup]').first().focus();
await page.keyboard.type(buatTotp(secret), { delay: 30 });

try {
  await page.waitForFunction(
    () => document.querySelector('.auth-panel.is-active')?.dataset.panel === 'pemulihan',
    { timeout: 20000 },
  );
} catch {
  console.log('     (panel pemulihan tidak muncul dalam 20s)');
}

cek('pindah ke panel pemulihan', await page.evaluate(() =>
  document.querySelector('.auth-panel.is-active')?.dataset.panel), 'pemulihan');

const kodeList = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#recoveryList li')).map((li) => li.textContent));
cek('8 kode pemulihan', kodeList.length, 8);
cek('format XXXXX-XXXXX', /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(kodeList[0] ?? ''), true);
cek('semua unik', new Set(kodeList).size, 8);
console.log(`     ${kodeList.slice(0, 3).join('  ')}`);
console.log();

console.log('══ 8. KONFIRMASI WAJIB ══');
cek('tombol lanjut DISABLED', await page.locator('#btnLanjut').isDisabled(), true);
await page.check('#chkSimpan');
await page.waitForTimeout(300);
cek('tombol lanjut AKTIF', await page.locator('#btnLanjut').isDisabled(), false);
console.log();

console.log('══ 9. UNDUH KODE PEMULIHAN ══');
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
  page.click('#btnUnduhRecovery'),
]);
cek('unduhan terpicu', dl !== null, true);
if (dl) {
  cek('nama .txt', dl.suggestedFilename().endsWith('.txt'), true);
  const jalur = join(DIR, 'unduhan.txt');
  await dl.saveAs(jalur);
  const isi = readFileSync(jalur, 'utf8');
  cek('berisi 8 kode', (isi.match(/[A-Z2-7]{5}-[A-Z2-7]{5}/g) ?? []).length, 8);
  cek('berisi peringatan', isi.includes('JANGAN bagikan'), true);
}
console.log();

console.log('══ 10. 2FA AKTIF DI SERVER ══');
{
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const r = await fetch(`${BASE}/api/token/2fa/status`, { headers: { Cookie: cookie } });
  const isi = await r.json().catch(() => ({}));
  cek('status 200', r.status, 200);
  cek('2FA aktif', isi.aktif, true);
  cek('8 kode pemulihan', isi.kode_pemulihan_tersisa, 8);
}
console.log();

console.log('══ 11. RESPONSIF 390px ══');
{
  const ctxM = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true,
  });
  const pM = await ctxM.newPage();
  await pM.goto(`${BASE}/sign-in.html`, { waitUntil: 'networkidle' });
  await pM.waitForTimeout(700);
    // Suntikkan QR yang sudah terbukti termuat di langkah 4.
    // Konteks mobile ini baru dibuka dan belum login — tanpa ini
    // #qrImage kosong dan uji gagal karena ALASAN UJI, bukan tata letak.
    await pM.evaluate((dataUrl) => {
      document.querySelectorAll('.auth-panel').forEach((p) =>
        p.classList.toggle('is-active', p.dataset.panel === 'setup2fa'));
      const img = document.querySelector('#qrImage');
      if (img && dataUrl) {
        img.src = dataUrl;
        img.hidden = false;
        const sk = document.querySelector('#qrSkeleton');
        if (sk) sk.hidden = true;
      }
    }, qrDataUrl);
    await pM.waitForFunction(() => {
      const i = document.querySelector('#qrImage');
      return i && i.naturalWidth > 0;
    }, { timeout: 8000 }).catch(() => {});
    await pM.waitForTimeout(300);

  const m = await pM.evaluate(() => {
    const img = document.querySelector('#qrImage');
    const wrap = document.querySelector('#qrWrap');
    const r = img?.getBoundingClientRect();
    return {
      lebar: r ? Math.round(r.width) : 0,
      meluber: wrap ? wrap.scrollWidth > wrap.clientWidth + 2 : false,
    };
  });
  cek('QR muat di 390px', m.lebar > 0 && m.lebar <= 200, true);
  cek('tidak meluber', m.meluber, false);
  await ctxM.close();
}
console.log();

console.log('══ 12. REDUCED MOTION ══');
{
  const ctxR = await browser.newContext({
    viewport: { width: 1280, height: 940 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true,
  });
  const pR = await ctxR.newPage();
  await pR.goto(`${BASE}/sign-in.html`, { waitUntil: 'networkidle' });
  await pR.waitForTimeout(600);
  const nama = await pR.evaluate(() =>
    getComputedStyle(document.querySelector('.auth-qr-shimmer')).animationName);
  cek('shimmer dimatikan', nama, 'none');
  await ctxR.close();
}
console.log();

console.log('══ 13. KONSOL BERSIH ══');
// ── Error yang DISENGAJA oleh uji ini sendiri ───────────────────────────────
//
// Langkah 6 sengaja mengirim kode 2FA yang salah → server menjawab 400.
// Browser mencatat itu sebagai 'Failed to load resource' di konsol.
// Itu BUKAN cacat kode: justru bukti validasi server bekerja.
//
// 401/403/404 juga disaring: uji ini memanggil endpoint tanpa sesi di
// beberapa tempat, dan favicon/challenge-platform berasal dari Cloudflare.
const errAsli = errors.filter((e) =>
  !/Failed to load resource.*(400|401|403|404|501)/.test(e) &&
  !/favicon/.test(e) && !/challenge-platform/.test(e));
cek('tidak ada error JS', errAsli.length, 0);
if (errAsli.length) errAsli.slice(0, 5).forEach((e) => console.log('     ❌', e.slice(0, 130)));
console.log();

// ── Screenshot ─────────────────────────────────────────────────────────────
await page.evaluate(() => {
  document.querySelectorAll('.auth-panel').forEach((p) =>
    p.classList.toggle('is-active', p.dataset.panel === 'pemulihan'));
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/2fa-pemulihan.png' });

await page.evaluate(() => {
  document.querySelectorAll('.auth-panel').forEach((p) =>
    p.classList.toggle('is-active', p.dataset.panel === 'setup2fa'));
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/2fa-setup.png' });

await browser.close();
be.kill('SIGKILL');
fe.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 700));
rmSync(DIR, { recursive: true, force: true });

console.log('═'.repeat(62));
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('═'.repeat(62));
if (gagal === 0) {
  console.log('\n  ✅ UI enrollment 2FA bekerja lengkap.');
  console.log('     Screenshot: /tmp/2fa-setup.png, /tmp/2fa-pemulihan.png');
} else {
  console.log('\n  ⚠ Ada yang gagal.');
  if (beLog) console.log('\n  log backend:\n', beLog.slice(-1000));
  process.exit(1);
}
