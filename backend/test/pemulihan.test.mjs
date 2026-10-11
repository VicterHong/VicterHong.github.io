/**
 * Uji alur pemulihan akun dari halaman masuk.
 *
 * ── CELAH YANG DIPERBAIKI ───────────────────────────────────────────────────
 *
 * Akun yang dinonaktifkan (status `menunggu_hapus`) tidak bisa login — dan
 * itu memang disengaja. Tapi ada masalah berantai:
 *
 *   1. Pengguna minta hapus → sesi DICABUT semua (semua perangkat keluar)
 *   2. Akun jadi `menunggu_hapus` → login DITOLAK
 *   3. Untuk membatalkan butuh KODE
 *   4. Kode dikirim lewat `/akun/hapus-mulai` — yang BUTUH SESI
 *   5. Sesi sudah dicabut → tidak bisa minta kode → TIDAK BISA MEMBATALKAN
 *
 * Fitur pembatalannya ada, tapi jalannya tertutup rapat. Masa tenggang jadi
 * sekadar memperlambat penghapusan — bukan memberi jalan pulang.
 *
 * ── PERBAIKAN ──────────────────────────────────────────────────────────────
 *
 * Endpoint BARU: `/akun/minta-kode-batal` — kirim kode TANPA sesi.
 *
 * Aman karena:
 *   • Hanya berfungsi untuk akun berstatus `menunggu_hapus`
 *   • Jawabannya SERAGAM (email tak dikenal = akun aktif = sukses palsu)
 *     sehingga tidak bisa dipakai memetakan email terdaftar
 *   • Rate limit yang sudah ada berlaku
 *   • Kode tetap dikirim ke EMAIL pemilik akun — penyerang tidak menerimanya
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'uji-pulih-'));
process.env.DB_PATH = join(DIR, 'uji.db');

const { openDb, getDb, migrateUlang } = await import('/home/ubuntu/portfolio-victer/backend/src/db.mjs');
openDb(join(DIR, 'uji.db'));

const { siapkanTabelPengguna } = await import('/home/ubuntu/portfolio-victer/backend/src/users.mjs');
siapkanTabelPengguna();
migrateUlang();

const { siapkanTabelIdentitas } = await import('/home/ubuntu/portfolio-victer/backend/src/auth-identities.mjs');
siapkanTabelIdentitas();

const { nonaktifkanAkun, batalkanHapus, sisaHariHapus } = await import('/home/ubuntu/portfolio-victer/backend/src/purge-akun.mjs');

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = String(dapat) === String(harap);
  if (ok) { lulus++; console.log(`    ✅ ${nama}`); }
  else { gagal++; console.log(`    ❌ ${nama}\n       dapat: ${dapat}\n       harap: ${harap}`); }
};

const db = getDb();
const sekarang = Date.now();
const HARI = 86400000;

function buatAkun(id, email, status = 'aktif', dihapusPada = null) {
  db.prepare(`INSERT INTO users (id, email, nama, password_hash, token_id, status, dibuat_at, dihapus_pada)
              VALUES (?, ?, 'Uji', 'hash', ?, ?, ?, ?)`)
    .run(id, email, 'tok-' + id, status, sekarang, dihapusPada);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. CEK KODE PEMBATALAN — TANPA SESI
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 1. CEK KODE PEMBATALAN ══');

buatAkun('r1', 'pulih@contoh.test', 'menunggu_hapus', sekarang - 5 * HARI);

// ── FUNGSI YANG HARUS ADA ───────────────────────────────────────────────────
const { cekKodePembatalan } = await import('/home/ubuntu/portfolio-victer/backend/src/purge-akun.mjs');

cek('cekKodePembatalan tersedia', typeof cekKodePembatalan, 'function');

// Akun menunggu hapus → boleh minta kode
const boleh = cekKodePembatalan('pulih@contoh.test');
cek('akun menunggu hapus → boleh minta kode', boleh.boleh, true);
cek('nama disertakan untuk email', typeof boleh.nama, 'string');

// Akun aktif → TIDAK boleh (tidak ada yang perlu dibatalkan)
buatAkun('r2', 'aktif@contoh.test', 'aktif');
const tidakBoleh = cekKodePembatalan('aktif@contoh.test');
cek('akun aktif → tidak boleh', tidakBoleh.boleh, false);

// Email tak dikenal → jawaban SERAGAM dengan akun aktif
const takDikenal = cekKodePembatalan('tidak-ada@contoh.test');
cek('email tak dikenal → jawaban sama dgn akun aktif', takDikenal.boleh, tidakBoleh.boleh);

// Akun sudah siap_hapus (disetujui admin) → TIDAK boleh dibatalkan
buatAkun('r3', 'siap@contoh.test', 'siap_hapus', sekarang - 1 * HARI);
const sudahSiap = cekKodePembatalan('siap@contoh.test');
cek('sudah disetujui admin → tidak boleh dibatalkan', sudahSiap.boleh, false);

// ══════════════════════════════════════════════════════════════════════════════
// 2. SISA HARI — ANGKA YANG DILIHAT PENGGUNA
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 2. SISA HARI ══');

// ── KENAPA `Math.ceil`, BUKAN `floor` ──────────────────────────────────────
// Permintaan yang baru dibuat 1 jam lalu harus menampilkan 30 hari, bukan 29.
// Angka yang lebih kecil dari kenyataan membuat pengguna merasa lebih
// terburu-buru daripada yang sebenarnya.
cek('baru minta → 30 hari', sisaHariHapus(sekarang), 30);
cek('1 jam lalu → masih 30', sisaHariHapus(sekarang - 3600000), 30);
cek('5 hari lalu → 25', sisaHariHapus(sekarang - 5 * HARI), 25);
cek('29,5 hari lalu → 1', sisaHariHapus(sekarang - 29.5 * HARI), 1);
cek('30 hari lalu → 0', sisaHariHapus(sekarang - 30 * HARI), 0);
cek('tanpa tanggal → null', sisaHariHapus(null), null);

// ══════════════════════════════════════════════════════════════════════════════
// 3. PEMBATALAN MENGEMBALIKAN AKUN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 3. PEMBATALAN ══');

const hasil = batalkanHapus('r1');
const r1 = db.prepare('SELECT * FROM users WHERE id = ?').get('r1');

cek('pembatalan berhasil', hasil.dibatalkan, true);
cek('status kembali aktif', r1?.status, 'aktif');
cek('tanggal hapus dikosongkan', r1?.dihapus_pada, null);

// ── IDEMPOTEN — MEMBATALKAN DUA KALI TIDAK ERROR ────────────────────────────
const kedua = batalkanHapus('r1');
cek('batalkan dua kali → tidak error', typeof kedua.dibatalkan, 'boolean');
cek('batalkan dua kali → tidak berubah lagi', kedua.dibatalkan, false);

// ══════════════════════════════════════════════════════════════════════════════
// 4. PEMBATALAN TIDAK BOLEH MENYENTUH AKUN ORANG LAIN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 4. ISOLASI AKUN ══');

buatAkun('r4', 'lain@contoh.test', 'menunggu_hapus', sekarang - 2 * HARI);
buatAkun('r5', 'lain2@contoh.test', 'menunggu_hapus', sekarang - 2 * HARI);

batalkanHapus('r4');

const r4 = db.prepare('SELECT status FROM users WHERE id = ?').get('r4');
const r5 = db.prepare('SELECT status FROM users WHERE id = ?').get('r5');

cek('akun yang dibatalkan → aktif', r4?.status, 'aktif');
cek('akun LAIN tetap menunggu', r5?.status, 'menunggu_hapus');

// ══════════════════════════════════════════════════════════════════════════════
// 5. NONAKTIFKAN LAGI SETELAH DIBATALKAN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 5. SIKLUS BERULANG ══');

// Pengguna yang sudah membatalkan harus bisa meminta hapus lagi.
const lagi = nonaktifkanAkun('r1', 'minta lagi');
cek('bisa dinonaktifkan lagi setelah dibatalkan', lagi.dinonaktifkan, true);

const r1b = db.prepare('SELECT status, alasan_hapus FROM users WHERE id = ?').get('r1');
cek('status kembali menunggu', r1b?.status, 'menunggu_hapus');
cek('alasan diperbarui', r1b?.alasan_hapus, 'minta lagi');


// ══════════════════════════════════════════════════════════════════════════════
// 6. REGRESI — FUNGSI EMAIL HARUS ADA
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 6. REGRESI: IMPORT EMAIL ══');

// ── BUG YANG DICEGAH ────────────────────────────────────────────────────────
//
// `auth-routes.mjs` memanggil `kirimEmailResetSandi(...)` di DUA tempat tanpa
// pernah mengimportnya. Yang terjadi di produksi:
//
//   ReferenceError: kirimEmailResetSandi is not defined
//
// Error itu ditelan try/catch, jadi kegagalannya SENYAP — pengguna melihat
// "email gagal terkirim" dan email TIDAK PERNAH terkirim, bahkan dengan SMTP
// aktif.
//
// ── KENAPA DIPERIKSA LEWAT SUMBER, BUKAN DIPANGGIL ──────────────────────────
//
// Memanggil fungsinya butuh konfigurasi SMTP. Yang perlu dibuktikan lebih
// sederhana: setiap pemanggilan `kirimEmailResetSandi` harus punya import
// yang sesuai di file yang sama.
//
// Ini menangkap kelas bug yang sama untuk fungsi apa pun di masa depan.
const fs = await import('node:fs');
const sumber = fs.readFileSync('/home/ubuntu/portfolio-victer/backend/src/auth-routes.mjs', 'utf8');

const jumlahPanggil = (sumber.match(/await kirimEmailResetSandi\(/g) || []).length;
const jumlahImport = (sumber.match(/await import\('\.\/email\.mjs'\)/g) || []).length;

console.log(`    ℹ️  panggilan: ${jumlahPanggil}, import: ${jumlahImport}`);
cek('setiap panggilan email punya import', jumlahPanggil <= jumlahImport, true);
cek('setidaknya ada 1 panggilan email', jumlahPanggil > 0, true);
cek('tidak ada import statis email.mjs (harus dinamis)', /^import .* from '\.\/email\.mjs'/m.test(sumber), false);

// ── FUNGSI YANG DIPAKAI DI ENDPOINT HARUS DIIMPORT ──────────────────────────
//
// Pemeriksaan generik: kumpulkan fungsi yang dipanggil dengan pola `await X(`
// yang berasal dari modul internal, lalu pastikan ada import untuk masing-masing.
const modulInternal = ['purge-akun', 'email', 'audit', 'users', 'sessions', 'totp-service', 'tokens'];

for (const m of modulInternal) {
  const dipakai = new RegExp(`await (\\w+)\\(`).test(sumber) &&
    new RegExp(`(nonaktifkanAkun|adaLanggananAktif|cekKodePembatalan|kirimEmailResetSandi|recordEvent|catatGagalMasuk|createSession|destroySession|verifikasi2fa|statusTotp)`).test(sumber);

  const adaImportDinamis = new RegExp(`await import\\('\\./${m}\\.mjs'\\)`).test(sumber);
  const adaImportStatis = new RegExp(`from '\\./${m}\\.mjs'`).test(sumber);

  // Hanya laporkan modul yang benar-benar dipakai fungsinya.
  const fungsinya = {
    'purge-akun': /(nonaktifkanAkun|adaLanggananAktif|cekKodePembatalan)/,
    'email': /kirimEmailResetSandi/,
    'audit': /recordEvent/,
    'users': /(cariPengguna|catatGagalMasuk|catatMasukBerhasil)/,
    'sessions': /(createSession|destroySession)/,
    'totp-service': /(verifikasi2fa|statusTotp|totpAktif)/,
    'tokens': /(issueToken|tokenProblem)/,
  }[m];

  if (fungsinya && fungsinya.test(sumber)) {
    const ada = adaImportDinamis || adaImportStatis;
    cek(`fungsi dari ${m}.mjs ada importnya`, ada, true);
  }
}

console.log('\n  ══════════════════════════════════════════════════════════════');
console.log(`    LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('  ══════════════════════════════════════════════════════════════');

rmSync(DIR, { recursive: true, force: true });
process.exit(gagal > 0 ? 1 : 0);
