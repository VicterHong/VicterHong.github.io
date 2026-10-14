/**
 * UJI END-TO-END: paket gratis otomatis tercatat saat LOGIN SUNGGUHAN.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA — DI ATAS TES UNIT
 * ══════════════════════════════════════════════════════════════════════════════
 * `paket-gratis-otomatis.test.mjs` menguji modulnya: apakah catatPaketGratis()
 * bekerja, apakah tabelnya benar. Itu perlu — tapi TIDAK CUKUP.
 *
 * Yang tidak bisa dibuktikan tes unit: apakah fungsi itu BENAR-BENAR
 * DIPANGGIL saat pengguna login. Modul yang sempurna tapi tidak tersambung
 * ke jalur login tidak mengubah apa pun di sistem yang berjalan.
 *
 * Kesalahan itu sudah pernah terjadi di proyek ini: `aktifkanLangganan()`
 * ditulis dan diuji, tapi tidak dipanggil dari webhook — sehingga pembeli
 * yang sudah membayar tetap dianggap gratis. Semua tes unitnya lulus.
 *
 * Jadi tes ini menjalankan SERVER SUNGGUHAN dan memanggil /api/auth/daftar
 * dan /api/auth/masuk lewat HTTP, lalu memeriksa DATABASE-nya langsung.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = mkdtempSync(join(tmpdir(), 'uji-gratis-otomatis-'));
const PORT = 48000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = join(DIR, 'uji.db');

writeFileSync(join(DIR, 'kosong.env'), '# uji\n');

const env = {
  ...process.env,
  DB_PATH,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: join(DIR, 'kosong.env'),
  SERVICE_SECRET: 'uji-service-secret-panjang-minimal-24-karakter-abcdef',
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz',
  SALES_EMAIL: 'uji@example.com',
  SITE_URL: BASE,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
};

const server = spawn('node', ['src/server.mjs'], {
  cwd: join(AKAR, 'backend'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let keluaran = '';
server.stdout.on('data', (d) => { keluaran += d.toString(); });
server.stderr.on('data', (d) => { keluaran += d.toString(); });

/** Tunggu server siap — periksa portnya, bukan sekadar tidur. */
async function tungguSiap(ms = 25000) {
  const sampai = Date.now() + ms;
  while (Date.now() < sampai) {
    try {
      const r = await fetch(`${BASE}/api/pricing`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server tidak siap dalam ${ms}ms.\n${keluaran.slice(-1500)}`);
}

async function post(jalur, badan) {
  // ── TOKEN TURNSTILE WAJIB DISERTAKAN ────────────────────────────────────────
  // Tanpa ini, endpoint daftar/masuk menjawab 403 — dan tesnya gagal karena
  // alasan yang tidak ada hubungannya dengan yang sedang diuji.
  //
  // 'XXXX.DUMMY.TOKEN.XXXX' adalah token yang Cloudflare sediakan untuk
  // pengujian: selalu lolos verifikasi, tapi tetap melalui alur nyata.
  // Secret key di atas juga key uji resmi Cloudflare.
  const r = await fetch(`${BASE}${jalur}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...badan }),
  });
  let data = null;
  try { data = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, data, cookie: r.headers.get('set-cookie') ?? '' };
}

/** Buka DB yang dipakai server — untuk memeriksa ISI-nya, bukan respons API. */
function db() {
  return new DatabaseSync(DB_PATH);
}

const SANDI = 'sandi-panjang-sekali-2026';
const NAMA = 'Budi Uji';

let lulus = 0;
let gagal = 0;
function periksa(nama, benar, detail = '') {
  if (benar) { lulus++; console.log(`  ✓ ${nama}`); }
  else { gagal++; console.log(`  ✗ ${nama}${detail ? ' — ' + detail : ''}`); }
}

try {
  await tungguSiap();
  console.log('\n── 1. SEBELUM ADA APA-APA ──');
  {
    const d = db();
    const n = d.prepare('SELECT COUNT(*) AS n FROM paket_akun').get().n;
    periksa('tabel paket_akun kosong di awal', n === 0, `ada ${n} baris`);
    d.close();
  }

  console.log('\n── 2. DAFTAR AKUN BARU → BELUM ada sesi, jadi BELUM dicatat ──');
  let userId = null;
  {
    const r = await post('/api/auth/daftar', {
      email: 'baru@perusahaan.com', nama: NAMA, perusahaan: 'PT Uji', sandi: SANDI,
    });
    periksa('pendaftaran berhasil (HTTP 200/201)', r.status === 200 || r.status === 201, `HTTP ${r.status}`);

    const d = db();
    const u = d.prepare('SELECT id, email FROM users WHERE email = ?').get('baru@perusahaan.com');
    periksa('pengguna dibuat di tabel users', Boolean(u), 'tidak ditemukan');
    userId = u?.id;

    // ── PENDAFTARAN TIDAK MEMBUAT SESI ────────────────────────────────────────
    // Rute daftar sengaja TIDAK langsung membuat sesi: pengguna diarahkan ke
    // halaman masuk. Jadi pencatatan paket gratis belum terjadi di sini — dan
    // itu benar.
    //
    // Permintaannya adalah "auto default kalo LOGIN", bukan "kalo daftar".
    const p = d.prepare('SELECT * FROM paket_akun WHERE user_id = ?').get(userId);
    periksa('belum dicatat (pendaftaran tidak membuat sesi)', !p,
      p ? 'sudah tercatat — padahal belum login' : '');

    const nl = d.prepare('SELECT COUNT(*) AS n FROM langganan').get().n;
    periksa('tabel langganan TIDAK bertambah', nl === 0, `ada ${nl} baris`);
    d.close();
  }

  console.log('\n── 3. LOGIN → paket gratis HARUS tercatat ──');
  {
    const r = await post('/api/auth/masuk', { email: 'baru@perusahaan.com', sandi: SANDI });
    periksa('login berhasil', r.status === 200, `HTTP ${r.status}`);

    const d = db();
    const p = d.prepare('SELECT * FROM paket_akun WHERE user_id = ?').get(userId);
    periksa('paket gratis TERCATAT setelah login', Boolean(p),
      p ? '' : 'tidak ada baris — pencatatan tidak tersambung ke jalur login');
    if (p) {
      periksa('paketnya "gratis"', p.paket === 'gratis', `paketnya "${p.paket}"`);
      periksa('mulai_at terisi', p.mulai_at > 0);
    }
    d.close();
  }

  console.log('\n── 4. LOGIN ULANG → mulai_at tidak boleh bergeser ──');
  {
    const d1 = db();
    const sebelum = d1.prepare('SELECT mulai_at FROM paket_akun WHERE user_id = ?').get(userId);
    d1.close();
    periksa('prasyarat: baris ada dari login sebelumnya', Boolean(sebelum));

    await new Promise((r) => setTimeout(r, 1200)); // pastikan waktu berbeda
    const r = await post('/api/auth/masuk', { email: 'baru@perusahaan.com', sandi: SANDI });
    periksa('login kedua berhasil', r.status === 200, `HTTP ${r.status}`);

    const d2 = db();
    const sesudah = d2.prepare('SELECT mulai_at, diperbarui_at FROM paket_akun WHERE user_id = ?').get(userId);
    const n = d2.prepare('SELECT COUNT(*) AS n FROM paket_akun WHERE user_id = ?').get(userId).n;
    periksa('mulai_at TIDAK berubah', sesudah.mulai_at === sebelum.mulai_at,
      `${sebelum.mulai_at} → ${sesudah.mulai_at}`);
    periksa('tetap satu baris (tidak menumpuk)', n === 1, `ada ${n} baris`);
    periksa('diperbarui_at maju', sesudah.diperbarui_at >= sebelum.mulai_at);
    d2.close();
  }

  console.log('\n── 5. PENGGUNA BERBAYAR → tidak dicatat gratis ──');
  {
    const r = await post('/api/auth/daftar', {
      email: 'bayar@perusahaan.com', nama: 'Siti Bayar', perusahaan: 'PT Bayar', sandi: SANDI,
    });
    periksa('pendaftaran berhasil', r.status === 200 || r.status === 201, `HTTP ${r.status}`);

    const d = db();
    const u = d.prepare('SELECT id FROM users WHERE email = ?').get('bayar@perusahaan.com');

    // Beri langganan berbayar langsung di DB — meniru hasil webhook pembayaran.
    const HARI = 24 * 60 * 60 * 1000;
    d.prepare(`
      INSERT INTO langganan (id, user_id, paket, periode, mulai_at, selesai_at, status, dibuat_at)
      VALUES (?, ?, 'profesional', 'bulanan', ?, ?, 'aktif', ?)
    `).run('l-bayar-1', u.id, Date.now(), Date.now() + 30 * HARI, Date.now());

    // Hapus dulu baris gratis yang mungkin sudah tercatat saat daftar,
    // supaya tes ini benar-benar menguji LOGIN berikutnya.
    d.prepare('DELETE FROM paket_akun WHERE user_id = ?').run(u.id);
    d.close();

    const masuk = await post('/api/auth/masuk', { email: 'bayar@perusahaan.com', sandi: SANDI });
    periksa('login berhasil', masuk.status === 200, `HTTP ${masuk.status}`);

    const d2 = db();
    const p = d2.prepare('SELECT * FROM paket_akun WHERE user_id = ?').get(u.id);
    periksa('pengguna BERBAYAR tidak dicatat gratis', !p,
      p ? 'ADA baris gratis — pengguna berbayar tercatat sebagai gratis' : '');

    const l = d2.prepare('SELECT paket, status FROM langganan WHERE user_id = ?').all(u.id);
    periksa('langganan berbayarnya tidak tersentuh', l.length === 1 && l[0].status === 'aktif',
      JSON.stringify(l));
    d2.close();
  }

  console.log('\n── 6. TIDAK ADA BARIS GRATIS DI TABEL LANGGANAN ──');
  {
    const d = db();
    const n = d.prepare("SELECT COUNT(*) AS n FROM langganan WHERE paket = 'gratis'").get().n;
    periksa('tidak ada paket=gratis di tabel langganan', n === 0, `ada ${n} baris`);
    d.close();
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(gagal === 0
    ? `✅ SEMUA LULUS — ${lulus} pemeriksaan`
    : `❌ ${gagal} GAGAL dari ${lulus + gagal} pemeriksaan`);
  process.exitCode = gagal === 0 ? 0 : 1;

} catch (err) {
  console.error('\n❌ ERROR:', err.message);
  console.error(keluaran.slice(-1200));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* abaikan */ }
}
