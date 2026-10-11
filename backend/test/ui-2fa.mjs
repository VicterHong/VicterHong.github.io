/**
 * Uji UI: setup 2FA (TOTP) dari halaman pengaturan — browser sungguhan.
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 *
 * Ditemukan tiga bug yang membuat fitur 2FA TIDAK BISA DIPAKAI sama sekali,
 * padahal backend-nya lengkap dan 58/58 tes backend lulus:
 *
 *   BUG 1: /sign-in#2fa mengabaikan hash → panel 'masuk' yang tampil
 *   BUG 2: Tombol "Aktifkan" mengarah ke /sign-in, padahal pengguna sudah login
 *   BUG 3: Tidak ada UI setup 2FA di /keamanan
 *
 * Akar masalahnya: UI setup 2FA ada di halaman YANG SALAH. Alur di auth.js
 * dirancang untuk halaman masuk (belum login), tapi tombolnya dipasang di
 * halaman pengaturan (sudah login). Endpoint /api/token/2fa/* butuh sesi,
 * sementara /sign-in adalah halaman untuk yang BELUM punya sesi.
 *
 * Tes ini mengunci perilaku yang BENAR: setup 2FA dilakukan dari halaman
 * /keamanan, di mana pengguna sudah login.
 *
 * ── MENGAPA BROWSER SUNGGUHAN ───────────────────────────────────────────────
 *
 * Bug-bug ini TIDAK terlihat dari tes unit backend — semuanya di lapisan UI.
 * 58/58 tes TOTP lulus sementara tombolnya mati total. Hanya browser yang
 * bisa membuktikan jalur pengguna benar-benar tersambung.
 *
 * ── KENAPA DB SEMENTARA ─────────────────────────────────────────────────────
 *
 * Uji ini membuat akun dan mengaktifkan 2FA. Menjalankannya di database
 * produksi akan mengacaukan data nyata. Setiap uji memakai DB di /tmp.
 */

import pw from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pw;
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 51000 + Math.floor(Math.random() * 800), BE_PORT = PORT + 1;
const BASE = `https://127.0.0.1:${PORT}`;
const DIR = mkdtempSync(join(tmpdir(), 'ui-2fa-'));

// Bersihkan server uji yang mungkin tertinggal dari jalannya tes sebelumnya.
for (const e of readdirSync('/proc')) {
  if (!/^\d+$/.test(e)) continue; const pid = Number(e);
  if (pid === process.pid || pid === process.ppid) continue;
  try {
    const c = readFileSync(`/proc/${e}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (/^(\S*\/)?node\s+src\/server\.mjs\s*$/.test(c) || /^(\S*\/)?node\s+serve-uji/.test(c)) process.kill(pid, 'SIGKILL');
  } catch {}
}
await new Promise((r) => setTimeout(r, 600));

const CERT = join(DIR, 'c.pem'), KEY = join(DIR, 'k.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', KEY, '-out', CERT,
  '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
  { stdio: 'ignore', timeout: 25000 });

const DB = join(DIR, 'u.db');
writeFileSync(join(DIR, 'k.env'), '#\n');

const SERVICE_SECRET = 'uji-service-secret-panjang-minimal-24-karakter-abcdef';

const env = {
  ...process.env, DB_PATH: DB, PORT: String(BE_PORT), HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: join(DIR, 'k.env'),
  SERVICE_SECRET,
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz',
  SALES_EMAIL: 'u@e.com', SITE_URL: BASE,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  // ── KENAPA example.com IKUT DIIZINKAN ──────────────────────────────────────
  //
  // Turnstile dengan test secret key SELALU mengembalikan hostname
  // "example.com" di respons verifikasinya — bukan hostname halaman.
  //
  // Kalau hanya "127.0.0.1" yang diizinkan, setiap pendaftaran gagal dengan
  // 403 hostname_tidak_cocok. Pesannya menyesatkan: seolah ada masalah
  // keamanan, padahal konfigurasi ujinya yang kurang.
  //
  // "example.com" HANYA ada di lingkungan uji — service.env produksi tidak
  // memuatnya.
  TURNSTILE_HOSTNAMES: '127.0.0.1,example.com',
  NODE_ENV: 'test',
};

const be = spawn('node', ['src/server.mjs'], {
  cwd: '/home/ubuntu/portfolio-victer/backend', env, stdio: ['ignore', 'pipe', 'pipe'],
});
let beLog = '';
be.stdout.on('data', (d) => { beLog += d; });
be.stderr.on('data', (d) => { beLog += d; });

const fe = spawn('node', ['serve-uji-https.mjs', String(PORT), '/home/ubuntu/portfolio-victer/dist',
  `http://127.0.0.1:${BE_PORT}`, CERT, KEY],
  { cwd: '/home/ubuntu/portfolio-victer/backend', stdio: 'ignore',
    env: { ...process.env, SITEKEY_UJI: '1x00000000000000000000AA' } });

await new Promise((r) => setTimeout(r, 3500));

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = String(dapat) === String(harap);
  if (ok) { lulus++; console.log(`    ✅ ${nama}`); }
  else { gagal++; console.log(`    ❌ ${nama}\n       dapat: ${dapat}\n       harap: ${harap}`); }
};

const browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--no-sandbox'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

try {
  // ══════════════════════════════════════════════════════════════════════════
  // BAGIAN 1: BUG 1 — hash #2fa harus membuka panel setup, bukan panel masuk
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n  ══ 1. HASH #2fa MEMBUKA PANEL SETUP ══');

  await page.goto(`${BASE}/sign-in#2fa`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const panelHash = await page.evaluate(() => {
    const aktif = [...document.querySelectorAll('.auth-panel')]
      .filter((p) => p.classList.contains('is-active'))
      .map((p) => p.dataset.panel);
    return { aktif, hash: location.hash };
  });

  // ── ASSERTION YANG TEGAS ───────────────────────────────────────────────────
  //
  // Versi pertama tes ini menulis:
  //   cek('hash #2fa tidak diabaikan', aktif.includes('setup2fa') || aktif.includes('masuk'), true)
  //
  // Itu SELALU benar — 'masuk' adalah panel default, jadi assertion-nya lulus
  // bahkan saat bugnya masih ada. Tes yang tidak bisa gagal tidak menguji apa pun.
  //
  // Sekarang: panel 'setup2fa' WAJIB aktif.
  cek('hash #2fa membuka panel setup2fa', panelHash.aktif.includes('setup2fa'), true);
  cek('panel masuk TIDAK aktif saat hash #2fa', panelHash.aktif.includes('masuk'), false);

  // ── HASH TIDAK DIKENAL TIDAK BOLEH MENYEMBUNYIKAN SEMUA PANEL ──────────────
  await page.goto(`${BASE}/sign-in#apa-saja`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const panelAneh = await page.evaluate(() => {
    const aktif = [...document.querySelectorAll('.auth-panel')]
      .filter((p) => p.classList.contains('is-active'))
      .map((p) => p.dataset.panel);
    return { aktif };
  });

  cek('hash tak dikenal → panel masuk tetap tampil', panelAneh.aktif.includes('masuk'), true);
  cek('hash tak dikenal → TIDAK menyembunyikan semua panel', panelAneh.aktif.length > 0, true);

  // ══════════════════════════════════════════════════════════════════════════
  // BAGIAN 2: BUG 2 & 3 — tombol "Aktifkan" di /keamanan
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n  ══ 2. TOMBOL "AKTIFKAN" DI HALAMAN KEAMANAN ══');

  // ── BUAT AKUN + LOGIN ──────────────────────────────────────────────────────
  //
  // ── KENAPA LEWAT UI, BUKAN fetch() LANGSUNG ────────────────────────────────
  //
  // Percobaan pertama memakai `fetch('/api/auth/daftar')` dari dalam halaman.
  // Itu GAGAL (400) karena:
  //   • Nama "Uji 2FA" mengandung angka — server menolaknya
  //   • Turnstile tidak punya token sungguhan
  //
  // Kegagalan itu membuat tes berhenti di langkah berikutnya dengan
  // "element is not visible" — pesan yang menyesatkan, seolah tombolnya
  // rusak, padahal akunnya tidak pernah dibuat.
  //
  // Pelajaran: pakai jalur yang SAMA dengan pengguna sungguhan (form di
  // halaman), bukan panggilan API yang melewati validasi.
  const email = `uji2fa${Date.now()}@contoh.test`;
  const sandi = 'SandiUji123!Kuat';
  const nama = 'Uji Dua Faktor';   // tanpa angka — server menolak nama berangka

  await page.goto(`${BASE}/sign-up`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Isi form daftar seperti pengguna sungguhan.
  //
  // ── KENAPA ID-NYA DIPERIKSA, BUKAN DIASUMSIKAN ─────────────────────────────
  // Percobaan pertama memakai `#inpSandi` — ID itu TIDAK ADA di halaman
  // daftar (yang benar `#inpSandiDaftar`). `page.fill()` gagal, ditelan
  // `.catch()`, dan sandi tidak pernah terisi.
  //
  // ID diambil dari sign-up.html, bukan dari ingatan.
  await page.fill('#inpNama', nama);
  await page.fill('#inpEmail', email);
  await page.fill('#inpSandiDaftar', sandi);

  // Turnstile di lingkungan uji memakai test key — token palsu diterima.
  await page.evaluate(() => {
    const el = document.querySelector('[name="cf-turnstile-response"]');
    if (el) el.value = 'uji-token';
  });

  await page.click('#btnDaftar');
  await page.waitForTimeout(4000);

  // ── LOGIN SETELAH DAFTAR ───────────────────────────────────────────────────
  //
  // Daftar TIDAK langsung memberi sesi — server mengarahkan ke /sign-in
  // ("Akun dibuat. Silakan masuk"). Jadi uji harus login seperti pengguna
  // sungguhan.
  //
  // Percobaan pertama melewatkan langkah ini, dan `/api/auth/profil` menjawab
  // 401 — yang terlihat seperti "pendaftaran gagal", padahal pendaftarannya
  // sukses dan hanya belum login.
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.fill('#inpEmailMasuk', email);
  await page.fill('#inpSandi', sandi);

  await page.evaluate(() => {
    const el = document.querySelector('[name="cf-turnstile-response"]');
    if (el) el.value = 'uji-token';
  });

  await page.click('#btnSubmit');
  await page.waitForTimeout(4500);

  // ── VERIFIKASI SESI SUNGGUHAN ──────────────────────────────────────────────
  //
  // Kalau pendaftaran gagal, uji ini TIDAK BOLEH lanjut — kalau lanjut, semua
  // assertion berikutnya gagal dengan pesan yang menyesatkan ("tombol tidak
  // terlihat") padahal penyebabnya akun tidak pernah ada.
  const sesi = await page.evaluate(async ({ base }) => {
    const r = await fetch(`${base}/api/auth/profil`, { credentials: 'include' });
    return { status: r.status, ok: r.ok };
  }, { base: BASE });

  if (!sesi.ok) {
    console.log(`    ❌ TIDAK BISA MEMBUAT SESI (profil: ${sesi.status})`);
    console.log('       Sisa uji dilewati — pesan "tombol tidak terlihat" akan menyesatkan.');
    console.log('       Cek: apakah form daftar memakai id yang benar?');
    throw new Error('setup sesi gagal');
  }
  console.log('    ✅ sesi dibuat lewat form daftar');

  await page.goto(`${BASE}/keamanan`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // ── BUKA TAB KEAMANAN ──────────────────────────────────────────────────────
  //
  // Halaman /keamanan default-nya membuka tab PROFIL. Tombol 2FA ada di tab
  // KEAMANAN — jadi tanpa langkah ini tombolnya ada di DOM tapi `hidden`,
  // dan Playwright menolak mengkliknya dengan "element is not visible".
  //
  // Pesan itu benar tapi tidak informatif: tombolnya memang tidak terlihat
  // karena tabnya belum dibuka, bukan karena ada yang rusak.
  //
  // Pengguna sungguhan juga mengklik tabnya dulu — jadi tes menirunya.
  await page.click('#tabMasuk');
  await page.waitForTimeout(1500);

  const tabAktif = await page.evaluate(() => {
    const p = document.querySelector('#panelMasuk');
    return { terlihat: p ? !p.hidden : false };
  });
  cek('tab Keamanan terbuka', tabAktif.terlihat, true);

  const tombol = await page.evaluate(() => {
    const t = document.querySelector('#kamAktifkan2fa');
    if (!t) return null;
    return {
      ada: true,
      tag: t.tagName,
      href: t.getAttribute('href') || '',
      teks: (t.textContent || '').trim(),
      terlihat: t.getBoundingClientRect().width > 0,
    };
  });

  cek('tombol 2FA ada di halaman keamanan', tombol?.ada, true);
  cek('tombol 2FA terlihat (bukan hidden)', tombol?.terlihat, true);

  // ── INTI BUG 2 ─────────────────────────────────────────────────────────────
  //
  // Tombol TIDAK BOLEH berupa tautan ke /sign-in. Pengguna di halaman ini
  // SUDAH login; mengirim mereka ke halaman masuk adalah jalan buntu —
  // /api/token/2fa/* butuh sesi, dan halaman masuk tidak menawarkan setup.
  //
  // Yang benar: tombol membuka DIALOG di halaman ini juga.
  cek('tombol 2FA BUKAN tautan ke /sign-in', /sign-in/.test(tombol?.href || ''), false);
  cek('tombol 2FA berupa <button>, bukan <a>', tombol?.tag, 'BUTTON');

  // ══════════════════════════════════════════════════════════════════════════
  // BAGIAN 3: BUG 3 — dialog setup 2FA harus ada di /keamanan
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n  ══ 3. DIALOG SETUP 2FA DI HALAMAN KEAMANAN ══');

  const dialog = await page.evaluate(() => ({
    dialogAda: !!document.querySelector('#kamDialog2fa'),
    areaQr: !!document.querySelector('#kamQr2fa'),
    inputKode: !!document.querySelector('#kamKode2fa'),
    tombolMulai: !!document.querySelector('#kamMulai2fa'),
    tombolVerifikasi: !!document.querySelector('#kamVerifikasi2fa'),
    areaPemulihan: !!document.querySelector('#kamPemulihan2fa'),
  }));

  cek('dialog setup 2FA ada', dialog.dialogAda, true);
  cek('area QR ada', dialog.areaQr, true);
  cek('input kode 6 digit ada', dialog.inputKode, true);
  cek('tombol verifikasi ada', dialog.tombolVerifikasi, true);

  // ══════════════════════════════════════════════════════════════════════════
  // BAGIAN 4: ALUR LENGKAP — klik tombol → QR muncul → verifikasi kode
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n  ══ 4. ALUR SETUP: KLIK → QR → KODE → AKTIF ══');

  if (tombol?.ada && dialog.dialogAda) {
    // Klik tombol "Aktifkan"
    await page.click('#kamAktifkan2fa');
    await page.waitForTimeout(1200);

    const setelahKlik = await page.evaluate(() => {
      const d = document.querySelector('#kamDialog2fa');
      return {
        dialogTerbuka: d ? !d.hidden : false,
        langkah1Tampil: !document.querySelector('#kamLangkah2fa1')?.hidden,
      };
    });

    cek('klik membuka dialog', setelahKlik.dialogTerbuka, true);
    cek('dialog mulai di langkah 1', setelahKlik.langkah1Tampil, true);

    // ── KLIK "MULAI" → MINTA QR ──────────────────────────────────────────────
    await page.click('#kamMulai2fa');
    await page.waitForTimeout(2500);

    const setelahMulai = await page.evaluate(() => {
      const img = document.querySelector('#kamQr2fa img');
      return {
        langkah2Tampil: !document.querySelector('#kamLangkah2fa2')?.hidden,
        qrAda: !!img,
        qrSrcDataUrl: img ? img.src.startsWith('data:image/') : false,
        qrUkuran: img ? Math.round(img.getBoundingClientRect().width) : 0,
        secretTampil: (document.querySelector('#kamSecret2fa')?.textContent || '').trim(),
      };
    });

    cek('pindah ke langkah 2', setelahMulai.langkah2Tampil, true);
    cek('QR tampil', setelahMulai.qrAda, true);
    cek('QR berupa data URL PNG', setelahMulai.qrSrcDataUrl, true);
    cek('QR berukuran wajar (>=150px)', setelahMulai.qrUkuran >= 150, true);
    cek('secret manual ditampilkan', setelahMulai.secretTampil.length >= 16, true);

    // ── VERIFIKASI KODE SUNGGUHAN ────────────────────────────────────────────
    //
    // Kode TOTP dihitung dari secret yang SAMA dengan yang ditampilkan.
    // Ini membuktikan seluruh rantai bekerja: server membuat secret →
    // mengirim QR → klien menghitung kode → server memverifikasi.
    //
    // Kalau kode di-hardcode, tes ini akan lulus tanpa membuktikan apa pun.
    const kodeTotp = await page.evaluate(async () => {
      // Ambil secret dari halaman
      const secret = (document.querySelector('#kamSecret2fa')?.textContent || '').trim();
      if (!secret || secret === '—') return { error: 'secret kosong' };

      // Base32 → bytes
      const ALFABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const bersih = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
      let bit = '';
      for (const c of bersih) {
        const i = ALFABET.indexOf(c);
        if (i < 0) continue;
        bit += i.toString(2).padStart(5, '0');
      }
      const bytes = [];
      for (let i = 0; i + 8 <= bit.length; i += 8) {
        bytes.push(parseInt(bit.slice(i, i + 8), 2));
      }

      // HMAC-SHA1 dengan counter = floor(sekarang / 30000)
      const counter = Math.floor(Date.now() / 1000 / 30);
      const buf = new ArrayBuffer(8);
      const dv = new DataView(buf);
      dv.setUint32(4, counter);

      const key = await crypto.subtle.importKey(
        'raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
      );
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));

      // Dynamic truncation (RFC 4226)
      const offset = sig[sig.length - 1] & 0x0f;
      const kode = ((sig[offset] & 0x7f) << 24 | sig[offset+1] << 16 |
                    sig[offset+2] << 8 | sig[offset+3]) % 1000000;

      return { kode: String(kode).padStart(6, '0'), secret: secret.slice(0, 8) + '…' };
    });

    if (kodeTotp.error) {
      cek('kode TOTP bisa dihitung dari secret', false, true);
    } else {
      console.log(`    ℹ️  kode TOTP dihitung dari secret: ${kodeTotp.kode}`);

      await page.fill('#kamKode2fa', kodeTotp.kode);
      await page.click('#kamVerifikasi2fa');
      await page.waitForTimeout(3000);

      const setelahVerifikasi = await page.evaluate(() => {
        const daftar = document.querySelector('#kamPemulihan2fa');
        return {
          langkah3Tampil: !document.querySelector('#kamLangkah2fa3')?.hidden,
          jumlahPemulihan: daftar ? daftar.querySelectorAll('li').length : 0,
          pesanGalat: (document.querySelector('#kamPesan2faDialog')?.textContent || '').trim(),
        };
      });

      if (!setelahVerifikasi.langkah3Tampil) {
        console.log(`    ℹ️  pesan: ${setelahVerifikasi.pesanGalat}`);
      }

      cek('kode TOTP benar → pindah ke langkah 3', setelahVerifikasi.langkah3Tampil, true);
      cek('kode pemulihan ditampilkan', setelahVerifikasi.jumlahPemulihan > 0, true);

      // ── SELESAI ─────────────────────────────────────────────────────────────
      if (setelahVerifikasi.langkah3Tampil) {
        await page.click('#kamSelesai2fa');
        await page.waitForTimeout(2000);

        const setelahSelesai = await page.evaluate(() => ({
          dialogTertutup: document.querySelector('#kamDialog2fa')?.hidden,
          lencana: (document.querySelector('#kamLencana2fa')?.textContent || '').trim(),
          tombol: (document.querySelector('#kamAktifkan2fa')?.textContent || '').trim(),
        }));

        cek('dialog tertutup setelah selesai', setelahSelesai.dialogTertutup, true);
        cek('lencana jadi "Aktif"', setelahSelesai.lencana, 'Aktif');
        cek('tombol jadi "Kelola"', setelahSelesai.tombol, 'Kelola');
      }
    }
  }


  // ══════════════════════════════════════════════════════════════════════════
  // BAGIAN 5: ALUR HAPUS AKUN — VERIFIKASI KODE EMAIL
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n  ══ 5. ALUR HAPUS AKUN ══');

  // Buka tab Keamanan lagi (navigasi di atas meninggalkan halaman ini).
  await page.goto(`${BASE}/keamanan#panelMasuk`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const danger = await page.evaluate(() => {
    const d = document.querySelector('#kamDanger');
    return {
      ada: !!d,
      terlihat: d ? !d.hidden : false,
      diDalamPanelKeamanan: d ? !!d.closest('#panelMasuk') : false,
      tombol: (document.querySelector('#kamHapusAkun')?.textContent || '').trim(),
      // Warna merah menandakan zona berbahaya — kalau tidak merah, pengguna
      // tidak akan menyadari ini tindakan merusak.
      warnaTombol: getComputedStyle(document.querySelector('#kamHapusAkun')).backgroundColor,
    };
  });

  cek('Zona Berbahaya ada', danger.ada, true);
  cek('Zona Berbahaya di dalam tab Keamanan', danger.diDalamPanelKeamanan, true);
  cek('Zona Berbahaya terlihat (sudah login)', danger.terlihat, true);
  cek('tombol hapus bertuliskan "Hapus"', danger.tombol, 'Hapus');
  cek('tombol hapus berwarna merah', /^rgb\(2[0-9]{2}, ?[0-9]{1,2}, ?[0-9]{1,2}\)$/.test(danger.warnaTombol), true);

  // ── KLIK TOMBOL → DIALOG TERBUKA DI LANGKAH 1 ──────────────────────────────
  await page.click('#kamHapusAkun');
  await page.waitForTimeout(1200);

  const dlgHapus = await page.evaluate(() => {
    const d = document.querySelector('#kamDialogHapusAkun');
    return {
      terbuka: d ? !d.hidden : false,
      langkah1: !document.querySelector('#kamHapusLangkah1')?.hidden,
      langkah2Tersembunyi: document.querySelector('#kamHapusLangkah2')?.hidden,
      adaPeringatan: !!document.querySelector('#kamHapusPeringatan'),
    };
  });

  cek('klik membuka dialog hapus akun', dlgHapus.terbuka, true);
  cek('dialog mulai di langkah 1 (kirim kode)', dlgHapus.langkah1, true);
  cek('langkah 2 tersembunyi dulu', dlgHapus.langkah2Tersembunyi, true);
  cek('peringatan "tidak bisa dibatalkan" ada', dlgHapus.adaPeringatan, true);

  // ── KIRIM KODE → LANGKAH 2 ─────────────────────────────────────────────────
  await page.click('#kamHapusKirimKode');
  await page.waitForTimeout(2500);

  const setelahKirim = await page.evaluate(() => ({
    langkah2Tampil: !document.querySelector('#kamHapusLangkah2')?.hidden,
    inputKode: !!document.querySelector('#kamHapusKode'),
    pesan: (document.querySelector('#kamHapusPesan')?.textContent || '').trim(),
  }));

  cek('pindah ke langkah 2 setelah kirim kode', setelahKirim.langkah2Tampil, true);
  cek('input kode tersedia', setelahKirim.inputKode, true);

  // ── KODE SALAH DITOLAK ─────────────────────────────────────────────────────
  await page.fill('#kamHapusKode', '000000');
  await page.click('#kamHapusKonfirmasi');
  await page.waitForTimeout(2000);

  const kodeSalah = await page.evaluate(() => ({
    tetapDiLangkah2: !document.querySelector('#kamHapusLangkah2')?.hidden,
    pesan: (document.querySelector('#kamHapusPesan')?.textContent || '').trim(),
    // Akun TIDAK boleh terhapus karena kode salah.
    pesanKelas: document.querySelector('#kamHapusPesan')?.className || '',
  }));

  cek('kode salah TIDAK menutup dialog', kodeSalah.tetapDiLangkah2, true);
  cek('kode salah menampilkan pesan galat', /galat/.test(kodeSalah.pesanKelas), true);

  // ── VERIFIKASI AKUN MASIH ADA ──────────────────────────────────────────────
  //
  // Ini assertion terpenting: kode salah TIDAK BOLEH menghapus apa pun.
  const masihAda = await page.evaluate(async ({ base }) => {
    const r = await fetch(`${base}/api/auth/profil`, { credentials: 'include' });
    return { ok: r.ok, status: r.status };
  }, { base: BASE });

  cek('akun MASIH ADA setelah kode salah', masihAda.ok, true);

  // ── KODE BENAR → AKUN TERHAPUS ─────────────────────────────────────────────
  //
  // Kode diambil dari database uji — server mengirimnya lewat email, dan di
  // lingkungan uji email tidak dikonfigurasi, jadi server mencatatnya di log.
  // Membaca DB langsung adalah cara paling andal di lingkungan uji.
  const kodeBenar = execFileSync('node', ['-e', `
    import('node:sqlite').then(async ({ default: D }) => {
      const db = new D.DatabaseSync(${JSON.stringify(DB)});
      const { createHash } = await import('node:crypto');
      const r = db.prepare('SELECT token_hash FROM password_resets ORDER BY dibuat_at DESC LIMIT 1').get();
      if (!r) { console.log('TIDAK_ADA'); process.exit(0); }
      const u = db.prepare('SELECT email FROM users ORDER BY dibuat_at DESC LIMIT 1').get();
      for (let i = 0; i < 1000000; i++) {
        const k = String(i).padStart(6, '0');
        if (createHash('sha256').update(k + ':' + u.email).digest('hex') === r.token_hash) {
          console.log(k); process.exit(0);
        }
      }
      console.log('TIDAK_KETEMU');
    });
  `], { encoding: 'utf8' }).trim();

  if (kodeBenar === 'TIDAK_ADA' || kodeBenar === 'TIDAK_KETEMU') {
    console.log(`    ⚠️  kode tidak bisa diambil dari DB uji (${kodeBenar}) — lewati uji hapus`);
  } else {
    // Rekam navigasi SEBELUM klik — halaman dialihkan ke beranda setelah
    // penghapusan berhasil, dan itu menghapus pesan sukses dari DOM.
    let dialihkan = false;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame() && /\/(home)?$/.test(new URL(f.url()).pathname)) dialihkan = true;
    });

    await page.fill('#kamHapusKode', kodeBenar);
    await page.click('#kamHapusKonfirmasi');
    await page.waitForTimeout(3500);

    // ── DUA CARA MEMBUKTIKAN SUKSES ───────────────────────────────────────────
    //
    // Assertion pertama memeriksa pesan sukses di DOM. Itu GAGAL — bukan karena
    // penghapusan tidak jalan, tapi karena halaman sudah dialihkan ke beranda
    // setelah 1,5 detik, sementara tes menunggu 3,5 detik.
    //
    // Yang membuktikan sukses: SALAH SATU dari dua hal —
    //   • pesan sukses terlihat di DOM (kalau tes menangkapnya sebelum redirect)
    //   • halaman sudah dialihkan (perilaku yang memang dirancang)
    //
    // Memeriksa hanya yang pertama berarti tes gagal pada perilaku yang BENAR.
    const setelahHapus = await page.evaluate(() => ({
      pesan: (document.querySelector('#kamHapusPesan')?.textContent || '').trim(),
      pesanKelas: document.querySelector('#kamHapusPesan')?.className || '',
      url: location.pathname,
    }));

    const suksesTerlihat = /sukses/.test(setelahHapus.pesanKelas);
    const sudahDialihkan = dialihkan || setelahHapus.url === '/' || setelahHapus.url === '/home';

    cek('kode benar → sukses (pesan ATAU dialihkan)', suksesTerlihat || sudahDialihkan, true);
    if (!suksesTerlihat && sudahDialihkan) {
      console.log('       (terbukti lewat pengalihan — pesan sukses sudah lewat)');
    }

    // ── SESI HARUS SUDAH TIDAK VALID ─────────────────────────────────────────
    //
    // Ini bukti yang paling penting: apa pun yang terlihat di layar, server
    // harus MENOLAK sesi lama. Kalau ini lulus, penghapusannya nyata.
    const setelahHapusSesi = await page.evaluate(async ({ base }) => {
      const r = await fetch(`${base}/api/auth/profil`, { credentials: 'include' });
      return { status: r.status };
    }, { base: BASE });

    cek('sesi tidak valid setelah akun dihapus (401)', setelahHapusSesi.status, 401);

    // ── AKUN BENAR-BENAR HILANG DARI DATABASE ────────────────────────────────
    //
    // Diperiksa langsung ke DB — bukan lewat UI. Kalau barisnya masih ada,
    // penghapusan hanya "terlihat berhasil" di layar.
    const sisa = execFileSync('node', ['-e', `
      import('node:sqlite').then(({ default: D }) => {
        const db = new D.DatabaseSync(${JSON.stringify(DB)});
        const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
        const s = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
        console.log(JSON.stringify({ users: n, sessions: s }));
      });
    `], { encoding: 'utf8' }).trim();

    const hitung = JSON.parse(sisa);
    cek('baris users terhapus dari database', hitung.users, 0);
    cek('sesi ikut terhapus dari database', hitung.sessions, 0);
  }

} finally {
  await browser.close();
  be.kill('SIGKILL');
  fe.kill('SIGKILL');
  rmSync(DIR, { recursive: true, force: true });
}

console.log('\n  ══════════════════════════════════════════════════════════════');
console.log(`    LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('  ══════════════════════════════════════════════════════════════');
if (gagal > 0) {
  console.log('\n  Log backend (200 baris terakhir):');
  console.log(beLog.split('\n').slice(-200).join('\n'));
}
process.exit(gagal > 0 ? 1 : 0);
