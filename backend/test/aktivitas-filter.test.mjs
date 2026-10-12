/**
 * Uji: log Aktivitas pengguna HANYA memuat peristiwa pengguna.
 *
 * ── BUG YANG DIUJI ──────────────────────────────────────────────────────────
 *
 * Tabel `access_events` adalah log audit BERSAMA. Ia menampung:
 *
 *   • peristiwa PENGGUNA   → masuk, ganti sandi, cabut sesi
 *   • peristiwa ADMIN      → setujui/tolak penghapusan akun
 *   • peristiwa SISTEM     → kegagalan penghapusan, penonaktifan otomatis
 *
 * Endpoint /api/auth/aktivitas dulu mengirim SEMUANYA untuk token pengguna.
 * Terlihat di produksi: pengguna melihat entri `akun_hapus_gagal` dan
 * `akun_hapus_diminta` di tab Aktivitas — peristiwa yang BUKAN aksinya.
 *
 * Akibatnya pengguna menyimpulkan akunnya bermasalah, padahal itu catatan
 * internal tentang percobaan yang tidak jadi.
 *
 * ── CARA UJI INI BEKERJA ────────────────────────────────────────────────────
 *
 * Tidak memanggil endpoint HTTP (itu butuh server + cookie). Yang diuji adalah
 * DAFTAR PUTIH di level modul — sumber kebenaran penyaringan. Kalau daftar itu
 * salah (mis. `akun_hapus_gagal` ikut masuk), uji ini gagal.
 *
 * Ditambah uji query: masukkan campuran event ke tabel, panggil query yang
 * sama dengan endpoint, pastikan hanya event pengguna yang kembali.
 *
 * ── KENAPA DB SEMENTARA ─────────────────────────────────────────────────────
 * Uji ini menulis baris ke access_events. Database produksi tidak boleh
 * disentuh.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Akar repo dihitung dari lokasi berkas ini ────────────────────────────
//
// ── KENAPA TIDAK PATH ABSOLUT ────────────────────────────────────────────
// Path seperti '/home/ubuntu/portfolio-victer/...' hanya benar di SATU
// mesin. Di GitHub Actions, checkout berada di
// /home/runner/work/<repo>/<repo>/ — dan semua tes yang memakai path
// absolut GAGAL di sana meski lulus di lokal.
//
// Menghitung dari lokasi berkas membuat tes bekerja di mana pun.
const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');


const DIR = mkdtempSync(join(tmpdir(), 'uji-aktivitas-'));
process.env.DB_PATH = join(DIR, 'uji.db');

const { openDb, getDb } = await import(join(AKAR, 'backend', 'src', 'db.mjs'));
openDb(join(DIR, 'uji.db'));

// ── 1. Daftar putih: event admin/sistem TIDAK boleh ada ────────────────────────
//
// Membaca daftar dari modul, bukan menyalinnya — kalau daftarnya berubah,
// uji ini mengikuti (bukan pecah karena salinan yang basi).

const modul = await import(join(AKAR, 'backend', 'src', 'auth-routes.mjs'));

// Daftar tidak diekspor (sengaja — ia detail internal). Baca lewat sumber
// teks modul sebagai jaring pengaman terakhir, DAN uji perilakunya di bawah.
const sumber = await import('node:fs').then((fs) =>
  fs.readFileSync(join(AKAR, 'backend', 'src', 'auth-routes.mjs'), 'utf8')
);

test('event admin TIDAK ada di daftar putih aktivitas pengguna', () => {
  const terlarang = [
    'akun_hapus_diminta',    // permintaan ke admin
    'akun_hapus_gagal',      // kegagalan sistem
    'akun_hapus_disetujui',  // keputusan admin
    'akun_hapus_ditolak',    // keputusan admin
    'akun_dinonaktifkan',    // tindakan admin
    'akun_dihapus_permanen', // eksekusi sistem
    'akun_batal_diminta',    // pembatalan internal
    'akun_hapus_dibatalkan', // pembatalan internal
  ];

  for (const aksi of terlarang) {
    // Cari apakah aksi ini ada DI DALAM blok AKSI_PENGGUNA.
    const blok = sumber.match(/const AKSI_PENGGUNA = \[([\s\S]*?)\];/);
    assert.ok(blok, 'blok AKSI_PENGGUNA harus ada di auth-routes.mjs');

    assert.ok(
      !blok[1].includes(`'${aksi}'`),
      `aksi "${aksi}" TIDAK boleh ada di daftar putih — itu peristiwa admin/sistem, ` +
      `bukan aksi pengguna. Pengguna yang melihatnya akan menyimpulkan akunnya bermasalah.`
    );
  }
});

test('event internal (lead, issue, content) TIDAK ada di daftar putih', () => {
  const internal = ['lead', 'lead_spam', 'lead_turnstile', 'issue', 'content', 'validate', 'revoke'];

  const blok = sumber.match(/const AKSI_PENGGUNA = \[([\s\S]*?)\];/);
  assert.ok(blok, 'blok AKSI_PENGGUNA harus ada');

  for (const aksi of internal) {
    assert.ok(
      !blok[1].includes(`'${aksi}'`),
      `aksi "${aksi}" adalah event internal — tidak boleh muncul di log pengguna`
    );
  }
});

test('event pengguna yang penting TETAP ada di daftar putih', () => {
  const harusAda = [
    'auth_masuk',
    'auth_daftar',
    'auth_sesi_cabut',
    'auth_sesi_cabut_semua',
    'profil_diperbarui',
    'avatar_unggah',
    'auth_reset_sandi',
  ];

  const blok = sumber.match(/const AKSI_PENGGUNA = \[([\s\S]*?)\];/);
  assert.ok(blok, 'blok AKSI_PENGGUNA harus ada');

  for (const aksi of harusAda) {
    assert.ok(
      blok[1].includes(`'${aksi}'`),
      `aksi "${aksi}" HARUS ada di daftar putih — itu aksi pengguna yang perlu terlihat di log keamanan`
    );
  }
});

// ── 2. Perilaku query: campuran event masuk, hanya pengguna yang kembali ──────

test('query aktivitas menyaring event admin/sistem', () => {
  const db = getDb();

  // Buat tabel access_events kalau belum ada (modul lain yang menyiapkannya
  // di produksi; di uji ini kita buat minimal).
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER,
      action TEXT,
      outcome TEXT,
      ip TEXT,
      country TEXT,
      detail TEXT,
      at TEXT
    )
  `);

  const TOKEN = 999001;

  // Bersihkan sisa kalau tes dijalankan dua kali.
  db.prepare('DELETE FROM access_events WHERE token_id = ?').run(TOKEN);

  // ── Masukkan CAMPURAN event: pengguna + admin + sistem ─────────────────────
  const semuaEvent = [
    // Pengguna — HARUS kembali
    { action: 'auth_masuk', outcome: 'ok' },
    { action: 'auth_sesi_cabut', outcome: 'ok' },
    { action: 'profil_diperbarui', outcome: 'ok' },
    // Admin/sistem — TIDAK boleh kembali
    { action: 'akun_hapus_diminta', outcome: 'ok' },
    { action: 'akun_hapus_gagal', outcome: 'gagal' },
    { action: 'akun_hapus_disetujui', outcome: 'ok' },
    { action: 'akun_dinonaktifkan', outcome: 'ok' },
    // Internal — TIDAK boleh kembali
    { action: 'lead', outcome: 'ok' },
    { action: 'issue', outcome: 'ok' },
  ];

  const sisip = db.prepare(`
    INSERT INTO access_events (token_id, action, outcome, ip, country, detail, at)
    VALUES (?, ?, ?, '127.0.0.1', 'ID', '', datetime('now'))
  `);

  for (const e of semuaEvent) {
    sisip.run(TOKEN, e.action, e.outcome);
  }

  // ── Jalankan query YANG SAMA dengan endpoint ───────────────────────────────
  const blok = sumber.match(/const AKSI_PENGGUNA = \[([\s\S]*?)\];/);
  const aksiPengguna = [...blok[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  const placeholder = aksiPengguna.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT action FROM access_events
    WHERE token_id = ?
      AND action IN (${placeholder})
    ORDER BY at DESC, id DESC
  `).all(TOKEN, ...aksiPengguna);

  const kembali = rows.map((r) => r.action).sort();

  // ── Assertions ─────────────────────────────────────────────────────────────
  assert.deepEqual(
    kembali,
    ['auth_masuk', 'auth_sesi_cabut', 'profil_diperbarui'].sort(),
    'hanya event pengguna yang boleh kembali dari query aktivitas'
  );

  // Eksplisit: yang terlarang benar-benar tidak ada.
  for (const terlarang of ['akun_hapus_gagal', 'akun_hapus_diminta', 'akun_hapus_disetujui', 'akun_dinonaktifkan', 'lead', 'issue']) {
    assert.ok(
      !kembali.includes(terlarang),
      `"${terlarang}" LOLOS dari penyaringan — ini regresi bug yang sama`
    );
  }

  db.prepare('DELETE FROM access_events WHERE token_id = ?').run(TOKEN);
});

test('bersihkan', () => {
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* abaikan */ }
});
