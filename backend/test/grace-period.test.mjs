/**
 * Uji grace period hapus akun — standar korporat.
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 *
 * Versi pertama menghapus akun SEGERA. Itu melanggar standar korporat:
 *
 *   • Salah klik / akun diretas → data hilang permanen, tidak bisa kembali
 *   • Tidak ada jalan pulang sama sekali
 *
 * Riset (GDPR Pasal 12(3), vNext, Stripe, GitHub) menunjukkan pola yang benar:
 * permintaan hapus → MASA TENGGANG 30 hari → purge otomatis.
 *
 * Selama masa tenggang:
 *   • Akun TERKUNCI — tidak bisa login (mencegah akun diretas dihapus diam-diam)
 *   • Tapi bisa DIBATALKAN — pengguna login untuk membatalkan
 *   • Data BELUM dihapus — masih bisa dipulihkan
 *
 * ── KENAPA DB SEMENTARA ─────────────────────────────────────────────────────
 *
 * Uji ini membuat dan menghapus akun. Menjalankannya di database produksi
 * akan mengacaukan data nyata.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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


const DIR = mkdtempSync(join(tmpdir(), 'uji-grace-'));
process.env.TOKEN_DB_PATH = join(DIR, 'uji.db');
process.env.DB_PATH = join(DIR, 'uji.db');

const { openDb, getDb } = await import(join(AKAR, 'backend', 'src', 'db.mjs'));
openDb(join(DIR, 'uji.db'));

// ── KENAPA siapkanTabelPengguna() DIPANGGIL ─────────────────────────────────
//
// `openDb()` menjalankan SCHEMA dan migrasi, tapi tabel `users` TIDAK dibuat
// di sana — modul users.mjs yang menyiapkannya lewat fungsi ini.
//
// Tanpa baris ini: "no such table: users" — dan itu terlihat seperti masalah
// migrasi, padahal hanya urutan inisialisasi yang kurang.
const { siapkanTabelPengguna } = await import(join(AKAR, 'backend', 'src', 'users.mjs'));
siapkanTabelPengguna();

// ── KENAPA MIGRASI DIJALANKAN ULANG SETELAH INI ────────────────────────────
//
// ── URUTAN YANG SALAH (dan kenapa hasilnya membingungkan) ───────────────────
//
//   1. openDb()                → SCHEMA + migrate()
//   2. siapkanTabelPengguna()  → CREATE TABLE users (kolom LAMA saja)
//
// Di langkah 1, tabel `users` BELUM ADA — jadi `addColumn('users', ...)`
// melempar "no such table" dan ditelan (migrate() menangkapnya dengan sengaja).
// Di langkah 2, tabelnya baru dibuat — TANPA kolom grace period.
//
// Hasilnya: kolom `dihapus_pada` tidak pernah ada, dan pesan galatnya
// ("no such column") menunjuk ke tempat yang salah.
//
// Di produksi ini tidak terjadi karena tabel users sudah ada sejak lama —
// jadi migrasi jalan normal. Hanya database BARU yang terkena.
//
// Memanggil openDb() lagi tidak membantu: ia langsung `return db` kalau
// sudah terbuka. Jadi migrasinya dijalankan manual di sini.
const { migrateUlang } = await import(join(AKAR, 'backend', 'src', 'db.mjs'));
if (typeof migrateUlang === 'function') migrateUlang();

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = String(dapat) === String(harap);
  if (ok) { lulus++; console.log(`    ✅ ${nama}`); }
  else { gagal++; console.log(`    ❌ ${nama}\n       dapat: ${dapat}\n       harap: ${harap}`); }
};

const db = getDb();
const sekarang = Date.now();
const HARI = 86400000;

// ══════════════════════════════════════════════════════════════════════════════
// 1. KOLOM BARU ADA
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 1. KOLOM GRACE PERIOD ══');

const kolom = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
cek('kolom dihapus_pada ada', kolom.includes('dihapus_pada'), true);
cek('kolom alasan_hapus ada', kolom.includes('alasan_hapus'), true);

// ══════════════════════════════════════════════════════════════════════════════
// 2. PERMINTAAN HAPUS → STATUS BERUBAH, DATA MASIH ADA
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 2. PERMINTAAN HAPUS (belum dihapus) ══');

const uid = 'uji-grace-1';
const tid = 'tok-grace-1';
const email = 'grace@contoh.test';

db.prepare(`INSERT INTO users (id, email, nama, password_hash, token_id, status, dibuat_at)
            VALUES (?, ?, ?, ?, ?, 'aktif', ?)`)
  .run(uid, email, 'Uji Grace', 'hash', tid, sekarang);

// Simulasi permintaan hapus: status berubah + timestamp dicatat
const batas = sekarang + 30 * HARI;
db.prepare(`UPDATE users SET status = 'menunggu_hapus', dihapus_pada = ?, alasan_hapus = ? WHERE id = ?`)
  .run(sekarang, 'permintaan pengguna', uid);

const setelahMinta = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);

cek('baris users MASIH ADA', !!setelahMinta, true);
cek('status jadi menunggu_hapus', setelahMinta?.status, 'menunggu_hapus');
cek('dihapus_pada tercatat', setelahMinta?.dihapus_pada, sekarang);
cek('alasan tercatat', setelahMinta?.alasan_hapus, 'permintaan pengguna');

// ══════════════════════════════════════════════════════════════════════════════
// 3. SISA HARI DIHITUNG BENAR
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 3. PERHITUNGAN SISA HARI ══');

/**
 * Hitung sisa hari sampai purge.
 *
 * ── KENAPA `Math.ceil`, BUKAN `Math.floor` ─────────────────────────────────
 *
 * Dengan `floor`, permintaan yang dibuat 1 jam lalu menampilkan "sisa 29 hari"
 * — padahal secara praktis masih 30 hari. Pengguna melihat angka yang lebih
 * kecil dari kenyataan, dan itu membuat mereka merasa lebih terburu-buru
 * daripada yang sebenarnya.
 *
 * `ceil` membulatkan ke atas: 29,04 hari → 30. Angka yang ditampilkan tidak
 * pernah LEBIH KECIL dari waktu nyata yang tersisa.
 */
function sisaHari(dihapusPada, { hari = 30 } = {}) {
  if (!dihapusPada) return null;
  const batasMs = dihapusPada + hari * HARI;
  const sisaMs = batasMs - Date.now();
  if (sisaMs <= 0) return 0;
  return Math.ceil(sisaMs / HARI);
}

cek('baru minta → sisa 30 hari', sisaHari(sekarang), 30);
cek('1 jam lalu → masih 30 hari (ceil)', sisaHari(Date.now() - 3600000), 30);
cek('5 hari lalu → sisa 25 hari', sisaHari(Date.now() - 5 * HARI), 25);
cek('29,5 hari lalu → sisa 1 hari', sisaHari(Date.now() - 29.5 * HARI), 1);
cek('30 hari lalu → 0 (habis)', sisaHari(Date.now() - 30 * HARI), 0);
cek('31 hari lalu → 0 (sudah lewat)', sisaHari(Date.now() - 31 * HARI), 0);
cek('tanpa dihapus_pada → null', sisaHari(null), null);

// ══════════════════════════════════════════════════════════════════════════════
// 4. PEMBATALAN MENGEMBALIKAN AKUN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 4. PEMBATALAN ══');

db.prepare(`UPDATE users SET status = 'aktif', dihapus_pada = NULL, alasan_hapus = '' WHERE id = ?`).run(uid);

const setelahBatal = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);

cek('status kembali aktif', setelahBatal?.status, 'aktif');
cek('dihapus_pada dikosongkan', setelahBatal?.dihapus_pada, null);
cek('alasan dikosongkan', setelahBatal?.alasan_hapus, '');
cek('data utuh setelah batal', setelahBatal?.email, email);

// ══════════════════════════════════════════════════════════════════════════════
// 5. PEMBERSIHAN OTOMATIS — HANYA YANG SUDAH LEWAT BATAS
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 5. PEMBERSIHAN OTOMATIS ══');

// Akun A: minta hapus 31 hari lalu → HARUS dibersihkan
const uidA = 'uji-grace-A';
db.prepare(`INSERT INTO users (id, email, nama, password_hash, token_id, status, dibuat_at, dihapus_pada)
            VALUES (?, ?, ?, ?, ?, 'menunggu_hapus', ?, ?)`)
  .run(uidA, 'a@contoh.test', 'A', 'hash', 'tok-A', sekarang, sekarang - 31 * HARI);

// Akun B: minta hapus 5 hari lalu → TIDAK boleh dibersihkan
const uidB = 'uji-grace-B';
db.prepare(`INSERT INTO users (id, email, nama, password_hash, token_id, status, dibuat_at, dihapus_pada)
            VALUES (?, ?, ?, ?, ?, 'menunggu_hapus', ?, ?)`)
  .run(uidB, 'b@contoh.test', 'B', 'hash', 'tok-B', sekarang, sekarang - 5 * HARI);

// Akun C: tidak minta hapus → TIDAK boleh dibersihkan
const uidC = 'uji-grace-C';
db.prepare(`INSERT INTO users (id, email, nama, password_hash, token_id, status, dibuat_at)
            VALUES (?, ?, ?, ?, ?, 'aktif', ?)`)
  .run(uidC, 'c@contoh.test', 'C', 'hash', 'tok-C', sekarang);

// ── KUMPULKAN YANG SIAP DIHAPUS ────────────────────────────────────────────
//
// ── KENAPA MEMERIKSA `dihapus_pada IS NOT NULL` ────────────────────────────
//
// Tanpa itu, akun AKTIF (dihapus_pada NULL) ikut terpilih — karena di SQL,
// `NULL < angka` bernilai NULL (bukan true), jadi baris itu memang tidak
// terpilih. Tapi menuliskannya eksplisit membuat maksudnya jelas untuk
// pembaca berikutnya, dan melindungi dari perubahan tipe kolom di masa depan.
const siapHapus = db.prepare(`
  SELECT id FROM users
  WHERE status = 'menunggu_hapus'
    AND dihapus_pada IS NOT NULL
    AND dihapus_pada <= ?
`).all(Date.now() - 30 * HARI).map((r) => r.id);

cek('akun lewat 31 hari → masuk daftar hapus', siapHapus.includes(uidA), true);
cek('akun 5 hari → TIDAK masuk daftar', siapHapus.includes(uidB), false);
cek('akun aktif → TIDAK masuk daftar', siapHapus.includes(uidC), false);
cek('total yang siap dihapus = 1', siapHapus.length, 1);

// ══════════════════════════════════════════════════════════════════════════════
// 6. RETENSI LEGAL — PEMBAYARAN TIDAK DIHAPUS, HANYA DI-ANONYMIZE
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 6. RETENSI LEGAL (pembayaran) ══');

// Tabel `payments` sudah dibuat oleh SCHEMA — kolomnya lengkap, termasuk
// `idempotency_key` yang NOT NULL. Nilainya diisi karena constraint itu.
db.prepare(`INSERT INTO payments (id, idempotency_key, tier, periode, jumlah, email, nama, status, dibuat_pada)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('pay-1', 'idem-1', 'pro', 'bulanan', 500000, email, 'Uji Grace', 'lunas', sekarang);

/**
 * Anonymize PII pembayaran, simpan data finansial.
 *
 * ── KENAPA TIDAK DIHAPUS ───────────────────────────────────────────────────
 *
 * Hukum pajak (Indonesia: UU KUP Pasal 28, umumnya 10 tahun; EU: 7 tahun)
 * mewajibkan catatan transaksi disimpan. Menghapusnya melanggar hukum —
 * dan GDPR sendiri MENGIZINKAN pengecualian ini (Pasal 17(3)).
 *
 * ── KENAPA HARUS ANONYMIZE, BUKAN SEKADAR SIMPAN ───────────────────────────
 *
 * Menyimpan email di catatan pembayaran berarti data pribadi masih ada —
 * dan itu melanggar hak penghapusan.
 *
 * Anonymize: ganti email dengan penanda yang tidak bisa dikembalikan.
 * Angka dan tanggal tetap ada untuk pembukuan.
 */
function anonymizePembayaran(userEmail) {
  // ── KENAPA `.invalid` ──────────────────────────────────────────────────────
  //
  // RFC 6761 menetapkan `.invalid` sebagai TLD yang DIJAMIN tidak akan pernah
  // ada. Kalau suatu saat ada bug yang mengirim email ke alamat ini, tidak ada
  // orang sungguhan yang menerimanya.
  //
  // Memakai domain sungguhan (mis. @contoh.test) berisiko: kalau domainnya
  // nanti terdaftar, email bisa sampai ke orang yang salah.
  const pengganti = 'dihapus@erased.invalid';
  const info = db.prepare('UPDATE payments SET email = ? WHERE email = ?').run(pengganti, userEmail);
  return info.changes;
}

const diubah = anonymizePembayaran(email);
const pembayaran = db.prepare('SELECT * FROM payments WHERE id = ?').get('pay-1');

cek('pembayaran di-anonymize (1 baris)', diubah, 1);
cek('email pembayaran diganti', pembayaran?.email, 'dihapus@erased.invalid');
cek('jumlah TETAP tersimpan', pembayaran?.jumlah, 500000);
cek('tanggal TETAP tersimpan', pembayaran?.dibuat_pada, sekarang);
cek('email asli tidak bisa dicari lagi',
  db.prepare('SELECT COUNT(*) c FROM payments WHERE email = ?').get(email).c, 0);

// ══════════════════════════════════════════════════════════════════════════════
// 7. AUDIT — IP DAN USER-AGENT JUGA DATA PRIBADI
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 7. AUDIT (IP + user-agent) ══');

try {
  db.exec(`CREATE TABLE IF NOT EXISTS access_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, token_id TEXT, action TEXT,
    outcome TEXT, ip TEXT, user_agent TEXT, country TEXT, at INTEGER
  )`);
} catch {}

db.prepare(`INSERT INTO access_events (token_id, action, outcome, ip, user_agent, at)
            VALUES (?, ?, ?, ?, ?, ?)`)
  .run(tid, 'uji', 'ok', '203.0.113.45', 'Mozilla/5.0 (Windows NT 10.0; Win64)', sekarang);

/**
 * Bersihkan PII dari catatan audit, simpan catatannya.
 *
 * ── KENAPA IP DAN USER-AGENT IKUT DIHAPUS ──────────────────────────────────
 *
 * GDPR Recital 30 menyatakan IP address dan user-agent adalah data pribadi —
 * keduanya bisa mengidentifikasi orang. Menyimpannya berarti hak penghapusan
 * belum dipenuhi, walaupun token_id sudah di-NULL-kan.
 *
 * Ini mudah terlewat: yang terlihat jelas adalah email dan nama, sementara
 * IP dan user-agent ada di kolom yang jarang dibaca.
 *
 * ── KENAPA CATATANNYA TETAP ADA ────────────────────────────────────────────
 *
 * Jejak keamanan (kapan masuk, dari mana, berhasil/gagal) mungkin dibutuhkan
 * untuk investigasi. Yang dihapus adalah IDENTITASnya, bukan kejadiannya.
 */
function bersihkanAudit(tokenId) {
  const info = db.prepare(`
    UPDATE access_events
    SET token_id = NULL, ip = '', user_agent = ''
    WHERE token_id = ?
  `).run(tokenId);
  return info.changes;
}

const auditDiubah = bersihkanAudit(tid);
const audit = db.prepare('SELECT * FROM access_events WHERE action = ?').get('uji');

cek('catatan audit diubah (1 baris)', auditDiubah, 1);
cek('catatan audit MASIH ADA', !!audit, true);
cek('token_id diputus', audit?.token_id, null);
cek('ip dikosongkan', audit?.ip, '');
cek('user_agent dikosongkan', audit?.user_agent, '');
cek('action tetap tersimpan', audit?.action, 'uji');

console.log('\n  ══════════════════════════════════════════════════════════════');
console.log(`    LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('  ══════════════════════════════════════════════════════════════');

rmSync(DIR, { recursive: true, force: true });
process.exit(gagal > 0 ? 1 : 0);
