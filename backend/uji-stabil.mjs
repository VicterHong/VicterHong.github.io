/**
 * UJI STABILITAS: gate Turnstile + login, N iterasi.
 *
 * ── INI TIGHT FEEDBACK LOOP (systematic-debugging Phase 1) ──────────────────
 * Bukan uji sekali-jalan: skrip ini MENGULANG alur gate + login berkali-kali
 * dan menghitung tingkat keberhasilan. Kalau ada ketidakstabilan (kadang
 * berhasil, kadang gagal), uji sekali-jalan akan lolos secara kebetulan —
 * uji berulang tidak bisa dibohongi.
 *
 * ── YANG DIUJI (Turnstile SUNGGUHAN, bukan token dummy) ────────────────────
 * Sitekey uji Cloudflare `1x00000000000000000000AA` SELALU lolos tanpa
 * interaksi, tapi tetap melalui seluruh alur nyata:
 *
 *   1. Halaman dimuat → cf-gate.js panggil /api/gate/check
 *   2. Tenggang habis → gate ditampilkan → widget Turnstile dirender
 *   3. Widget menghasilkan token SUNGGUHAN dari Cloudflare
 *   4. Token dikirim ke /api/verify-turnstile → server verifikasi ke Cloudflare
 *   5. Cookie clearance __Host-portfolio_gate diterbitkan (HttpOnly, Secure)
 *   6. Halaman di-reveal
 *   7. Login: isi token → submit → /api/token/session
 *   8. Cookie portfolio_session diterbitkan
 *
 * Inilah yang membedakan dari uji sebelumnya: uji lama MENYUNTIKKAN token
 * dummy dan MENYETEL cookie langsung, sehingga tidak pernah menguji alur
 * sungguhan. Kalau widget gagal render, atau token tidak sampai, uji lama
 * tetap "lulus" — palsu.
 *
 * ── CARA PAKAI ──────────────────────────────────────────────────────────────
 *   node uji-stabil.mjs            # 5 iterasi (bawaan)
 *   node uji-stabil.mjs 10         # 10 iterasi
 *
 * Keluaran: ringkasan tingkat keberhasilan + detail kegagalan per iterasi.
 */

import pw from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pw;

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ITERASI = Number(process.argv[2] ?? 5);
const PORT = 48000 + Math.floor(Math.random() * 2000);
const BE_PORT = PORT + 1;
const BASE = `https://127.0.0.1:${PORT}`;
const DIR = mkdtempSync(join(tmpdir(), 'stab-'));

// ── Bersihkan server uji lama ────────────────────────────────────────────────
let dibersihkan = 0;
for (const e of readdirSync('/proc')) {
  if (!/^\d+$/.test(e)) continue;
  const pid = Number(e);
  if (pid === process.pid || pid === process.ppid) continue;
  try {
    const c = readFileSync(`/proc/${e}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (/^(\S*\/)?node\s+src\/server\.mjs\s*$/.test(c) || /^(\S*\/)?node\s+serve-uji/.test(c)) {
      process.kill(pid, 'SIGKILL');
      dibersihkan++;
    }
  } catch {}
}
await new Promise((r) => setTimeout(r, 600));
console.log(`  (${dibersihkan} server uji lama dibersihkan)`);

// ── Sertifikat HTTPS (satu origin — lihat skill playwright-single-origin) ───
const CERT = join(DIR, 'c.pem'), KEY = join(DIR, 'k.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', KEY, '-out', CERT,
  '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
  { stdio: 'ignore', timeout: 25000 });
console.log('  ✅ sertifikat uji dibuat');

// ── Backend dengan Turnstile UJI SUNGGUHAN ──────────────────────────────────
//
// SITEKEY UJI: 1x00000000000000000000AA — Cloudflare menjamin token lolos.
// SECRET UJI : 1x0000000000000000000000000000000AA — pasangan sah untuk sitekey itu.
//
// `TURNSTILE_HOSTNAMES: 'example.com'` — sitekey uji Cloudflare melaporkan
// hostname 'example.com' pada token yang dihasilkan, jadi hostname itu yang
// harus diizinkan. Kalau dikosongkan, validasi hostname dilewati.
writeFileSync(join(DIR, 'kosong.env'), '# uji\n');
const env = {
  ...process.env,
  DB_PATH: join(DIR, 'u.db'), PORT: String(BE_PORT), HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: join(DIR, 'kosong.env'),
  SERVICE_SECRET: 'uji-service-secret-panjang-minimal-24-karakter-abcdef',
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz',
  SALES_EMAIL: 'u@e.com',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
};

const be = spawn('node', ['src/server.mjs'], { cwd: '/home/ubuntu/portfolio-victer/backend', env, stdio: ['ignore', 'pipe', 'pipe'] });
let beLog = '';
be.stdout.on('data', (d) => { beLog += d; });
be.stderr.on('data', (d) => { beLog += d; });

const fe = spawn('node', ['serve-uji-https.mjs', String(PORT), '/home/ubuntu/portfolio-victer/dist',
  `http://127.0.0.1:${BE_PORT}`, CERT, KEY],
  {
    cwd: '/home/ubuntu/portfolio-victer/backend',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Sitekey produksi ditulis ulang menjadi sitekey UJI Cloudflare oleh
    // server uji. Tanpa ini, widget memakai sitekey produksi yang menuntut
    // domain produksi — token tidak akan pernah sah di 127.0.0.1.
    env: { ...process.env, SITEKEY_UJI: '1x00000000000000000000AA' },
  });

// ── Tunggu siap ──────────────────────────────────────────────────────────────
let siap = false;
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const h = await fetch(`http://127.0.0.1:${BE_PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    const f = await fetch(`${BASE}/sign-in.html`, { signal: AbortSignal.timeout(2500) });
    if (h.ok && f.ok) { siap = true; break; }
  } catch {}
}
if (!siap) {
  console.log('  ❌ server uji tidak siap');
  console.log(beLog.slice(-800));
  process.exit(1);
}
console.log(`  ✅ server siap di ${BASE}`);
console.log();

// ── Token akses untuk login ─────────────────────────────────────────────────
const out = execFileSync('node', ['src/admin-cli.mjs', 'issue', '--project', 'mina', '--to', 'stab@uji.local'],
  { cwd: '/home/ubuntu/portfolio-victer/backend', env, encoding: 'utf8', timeout: 15000 });
const TOK = out.match(/(VP-[A-Z0-9-]+)/)?.[1];
if (!TOK) { console.log('  ❌ gagal membuat token'); process.exit(1); }
console.log(`  ✅ token: ${TOK.slice(0, 20)}…`);
console.log();

// ════════════════════════════════════════════════════════════════════════════
//  LOOP UTAMA
// ════════════════════════════════════════════════════════════════════════════

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const hasil = [];

for (let n = 1; n <= ITERASI; n++) {
  const catatan = { n, gateOk: false, loginOk: false, catatan: [], api: [] };
  console.log(`═══ ITERASI ${n}/${ITERASI} ═══`);

  // Konteks BARU tiap iterasi = pengunjung baru (tanpa cookie/localStorage).
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 940 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  // Catat semua lalu lintas API — bukti kalau ada yang gagal.
  page.on('response', async (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/')) {
      let b = '';
      try { b = (await r.text()).slice(0, 120); } catch {}
      catatan.api.push(`${r.status()} ${p} ${b.replace(/\s+/g, ' ')}`);
    }
  });
  page.on('pageerror', (e) => catatan.catatan.push(`pageerror: ${e.message.slice(0, 120)}`));

  try {
    // ── LANGKAH 1: buka halaman → gate harus muncul (pengunjung baru) ──────
    await page.goto(`${BASE}/sign-in.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Tunggu cf-gate.js memutuskan: gate tampil, atau halaman di-reveal.
    // Pengunjung BARU → tenggang aktif → halaman langsung di-reveal.
    // Jadi gate TIDAK muncul. Untuk menguji gate, kita habiskan tenggang.
    await page.waitForTimeout(1200);

    // ── Paksa tenggang HABIS supaya gate muncul (simulasi pengunjung lama) ─
    await page.evaluate(() => {
      // ── KUNCI HARUS SAMA DENGAN cf-gate.js ──────────────────────────────
      // cf-gate.js:  var HOST = location.hostname;   ← TANPA port
      // Kalau di sini memakai location.host (dengan port), kuncinya beda dan
      // kode tidak melihat catatan kita → dianggap kunjungan baru → tenggang
      // aktif → gate tidak muncul. Uji lalu melaporkan kegagalan palsu.
      const host = location.hostname;
      localStorage.setItem('cf_mulai_' + host, String(Date.now() - 30 * 60 * 1000));
      localStorage.setItem('cf_akhir_' + host, String(Date.now()));
      // Kunci dengan port sekalian, untuk berjaga kalau implementasinya berubah.
      localStorage.setItem('cf_mulai_' + location.host, String(Date.now() - 30 * 60 * 1000));
      localStorage.setItem('cf_akhir_' + location.host, String(Date.now()));
    });

    // Muat ulang → gate harus muncul sekarang
    await page.goto(`${BASE}/sign-in.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // ── LANGKAH 2: tunggu gate tampil + widget Turnstile menghasilkan token ─
    // Sitekey uji 1x000...AA lolos otomatis; token muncul tanpa klik.
    const gateMuncul = await page.waitForFunction(() => {
      const g = document.getElementById('cf-gate');
      return g && g.offsetWidth > 0;
    }, { timeout: 10000 }).then(() => true).catch(() => false);

    catatan.catatan.push(gateMuncul ? 'gate tampil' : 'GATE TIDAK MUNCUL');

    if (gateMuncul) {
      // Tunggu halaman di-reveal (kelas cf-gated dilepas = verifikasi lolos).
      // Ini terjadi setelah token terkirim & cookie clearance diterbitkan.
      const revealed = await page.waitForFunction(
        () => !document.body.classList.contains('cf-gated'),
        { timeout: 25000 },
      ).then(() => true).catch(() => false);

      catatan.gateOk = revealed;
      catatan.catatan.push(revealed ? 'gate lolos (cookie clearance)' : 'GATE TIDAK LOLOS (timeout)');

      // Bukti: cookie clearance harus ada
      const cookies = await ctx.cookies();
      const clearance = cookies.find((c) => c.name.includes('portfolio_gate'));
      if (clearance) {
        catatan.catatan.push(`cookie clearance ada (httpOnly=${clearance.httpOnly}, secure=${clearance.secure})`);
      } else {
        catatan.catatan.push('COOKIE CLEARANCE TIDAK ADA');
      }
    }

    // ── LANGKAH 3: login ───────────────────────────────────────────────────
    await page.waitForSelector('#inpProject', { state: 'visible', timeout: 10000 });
    await page.selectOption('#inpProject', 'mina');
    await page.fill('#inpToken', TOK);
    await page.click('#btnSubmit');

    // Panel 'done' = sesi dibuat. Panel 'totp' = 2FA aktif (tidak di sini).
    const panel = await page.waitForFunction(() => {
      const p = document.querySelector('.auth-panel.is-active');
      return p && (p.dataset.panel === 'done' || p.dataset.panel === 'totp');
    }, { timeout: 25000 }).then(async () => {
      return await page.evaluate(() => document.querySelector('.auth-panel.is-active')?.dataset.panel);
    }).catch(() => 'TIMEOUT');

    catatan.loginOk = panel === 'done';
    catatan.catatan.push(panel === 'done' ? 'login berhasil (sesi dibuat)' : `LOGIN GAGAL (panel: ${panel})`);

    // Bukti: cookie sesi harus ada
    const cookies2 = await ctx.cookies();
    const sesi = cookies2.find((c) => c.name === 'portfolio_session');
    if (sesi) catatan.catatan.push('cookie sesi ada');
    else catatan.catatan.push('COOKIE SESI TIDAK ADA');

  } catch (e) {
    catatan.catatan.push(`ERROR: ${e.message.slice(0, 150)}`);
  }

  hasil.push(catatan);

  // Cetak hasil iterasi ini
  console.log(`  gate: ${catatan.gateOk ? '✅' : '❌'}   login: ${catatan.loginOk ? '✅' : '❌'}`);
  for (const c of catatan.catatan) console.log(`    ${c}`);
  if (catatan.api.length) {
    console.log('    ── API ──');
    for (const a of catatan.api.slice(-6)) console.log(`      ${a}`);
  }
  console.log();

  await ctx.close();
}

// ════════════════════════════════════════════════════════════════════════════
//  RINGKASAN
// ════════════════════════════════════════════════════════════════════════════

await browser.close();
be.kill('SIGKILL');
fe.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 600));

const gateLolos = hasil.filter((h) => h.gateOk).length;
const loginLolos = hasil.filter((h) => h.loginOk).length;
const keduanya = hasil.filter((h) => h.gateOk && h.loginOk).length;

console.log('══════════════════════════════════════════════════════════════');
console.log(`  RINGKASAN (${ITERASI} iterasi)`);
console.log('══════════════════════════════════════════════════════════════');
console.log(`  gate lolos  : ${gateLolos}/${ITERASI}`);
console.log(`  login lolos : ${loginLolos}/${ITERASI}`);
console.log(`  keduanya    : ${keduanya}/${ITERASI}`);
console.log();

if (keduanya < ITERASI) {
  console.log('  ── Iterasi yang gagal ──');
  for (const h of hasil.filter((x) => !x.gateOk || !x.loginOk)) {
    console.log(`    iterasi ${h.n}:`);
    for (const c of h.catatan) console.log(`      ${c}`);
    for (const a of h.api) console.log(`      api: ${a}`);
  }
  console.log();
}

console.log('  ── Log backend (50 baris terakhir) ──');
console.log(beLog.split('\n').slice(-50).map((l) => '  ' + l).join('\n'));

rmSync(DIR, { recursive: true, force: true });

// Exit code: 0 kalau semua lolos — bisa dipakai di loop CI.
process.exit(keduanya === ITERASI ? 0 : 1);
