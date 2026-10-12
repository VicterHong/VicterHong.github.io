/**
 * Uji alur penghapusan akun model korporat — 3 tahap.
 *
 * ── MODEL YANG DIMINTA ──────────────────────────────────────────────────────
 *
 * "Kalo mau otomatis itu akunnya di nonaktifkan. Kalo mau dihapus akunnya
 *  harus dari customer service atau admin yang menyetujui. Atau akunnya sudah
 *  lewat berapa bulan dari sistem korporasi baru bisa dihapus."
 *
 * Jadi tiga jalur:
 *
 *   TAHAP 1 — NONAKTIF (otomatis, langsung)
 *     Pengguna minta hapus → akun langsung nonaktif. Tidak bisa login.
 *     Data UTUH. Ini yang mencegah kerugian akibat klik salah.
 *
 *   TAHAP 2a — ADMIN MENYETUJUI (manual, jalur cepat)
 *     Customer service / admin meninjau permintaan dan menyetujui.
 *     Penghapusan permanen dijalankan setelah persetujuan.
 *
 *   TAHAP 2b — OTOMATIS (lewat masa tidak aktif)
 *     Tanpa persetujuan admin, akun dihapus otomatis setelah masa tertentu
 *     (korporat: biasanya 12 bulan sejak nonaktif).
 *
 * ── KENAPA MODEL INI LEBIH BAIK DARI "HAPUS LANGSUNG" ──────────────────────
 *
 *   1. Klik salah / akun diretas → data masih ada, bisa dipulihkan
 *   2. Admin bisa menolak penghapusan kalau ada kewajiban berjalan
 *      (tagihan, sengketa, investigasi)
 *   3. Ada jejak audit: siapa yang menyetujui, kapan
 *   4. Akun yang benar-benar ditinggalkan tetap dibersihkan otomatis
 *
 * ── KENAPA DB SEMENTARA ─────────────────────────────────────────────────────
 *
 * Uji ini membuat dan menghapus akun. Database produksi tidak boleh disentuh.
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


const DIR = mkdtempSync(join(tmpdir(), 'uji-korporat-'));
process.env.DB_PATH = join(DIR, 'uji.db');

const { openDb, getDb, migrateUlang } = await import(join(AKAR, 'backend', 'src', 'db.mjs'));
openDb(join(DIR, 'uji.db'));

const { siapkanTabelPengguna } = await import(join(AKAR, 'backend', 'src', 'users.mjs'));
siapkanTabelPengguna();
migrateUlang();

// ── TABEL DARI MODUL LAIN ───────────────────────────────────────────────────
//
// ── KENAPA HARUS DIPANGGIL SATU PER SATU ────────────────────────────────────
//
// Tabel aplikasi TIDAK semuanya dibuat oleh db.mjs. Masing-masing modul
// menyiapkan tabelnya sendiri:
//
//   • users.mjs            → users, password_resets
//   • auth-identities.mjs  → auth_identities, oauth_states, webauthn_challenges
//
// `hapusAkunPermanen()` menyentuh ketiganya. Kalau ada yang belum dibuat,
// penghapusan GAGAL dengan "no such table" — dan karena semuanya dalam satu
// transaksi, TIDAK ADA yang terhapus.
//
// Di produksi ini tidak terjadi karena semua modul sudah dimuat server. Yang
// terkena hanya uji — dan itu membuat hasilnya membingungkan: tes lain lulus,
// tapi pembersihan gagal.
const { siapkanTabelIdentitas } = await import(join(AKAR, 'backend', 'src', 'auth-identities.mjs'));
if (typeof siapkanTabelIdentitas === 'function') siapkanTabelIdentitas();

const {
  nonaktifkanAkun, setujuiPenghapusan, tolakPenghapusan,
  akunSiapHapusOtomatis, bersihkanAkunKedaluwarsa,
  hapusAkunPermanen, BULAN_OTOMATIS,
} = await import(join(AKAR, 'backend', 'src', 'purge-akun.mjs'));

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = String(dapat) === String(harap);
  if (ok) { lulus++; console.log(`    ✅ ${nama}`); }
  else { gagal++; console.log(`    ❌ ${nama}\n       dapat: ${dapat}\n       harap: ${harap}`); }
};

const db = getDb();
const sekarang = Date.now();
const HARI = 86400000;
const BULAN = 30 * HARI;

function buatAkun(id, email, status = 'aktif', nonaktifSejak = null) {
  db.prepare(`INSERT INTO users (id, email, nama, password_hash, token_id, status, dibuat_at, dihapus_pada)
              VALUES (?, ?, 'Uji', 'hash', ?, ?, ?, ?)`)
    .run(id, email, 'tok-' + id, status, sekarang, nonaktifSejak);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. KONSTANTA
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 1. MASA TENGGANG OTOMATIS ══');
cek('BULAN_OTOMATIS = 12 (standar korporat)', BULAN_OTOMATIS, 12);

// ══════════════════════════════════════════════════════════════════════════════
// 2. TAHAP 1 — NONAKTIF
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 2. TAHAP 1: NONAKTIF (bukan hapus) ══');

buatAkun('u1', 'tahap1@contoh.test');

const hasil1 = nonaktifkanAkun('u1', 'permintaan pengguna');
const a1 = db.prepare('SELECT * FROM users WHERE id = ?').get('u1');

cek('fungsi melaporkan berhasil', hasil1.dinonaktifkan, true);
cek('baris users MASIH ADA', !!a1, true);
cek('status jadi nonaktif', a1?.status, 'menunggu_hapus');

// ── KENAPA TIDAK MEMBANDINGKAN TIMESTAMP PERSIS ─────────────────────────────
//
// Versi pertama menulis `cek('tanggal nonaktif tercatat', a1?.dihapus_pada, sekarang)`
// — dan itu GAGAL karena selisih 4 milidetik: `sekarang` diambil sebelum
// INSERT, sementara `nonaktifkanAkun()` memanggil `now()` sendiri.
//
// Assertion yang membandingkan waktu persis akan rapuh setiap kali ada
// pemanggilan fungsi di antaranya. Yang penting BUKAN nilainya sama persis,
// tapi bahwa nilainya WAJAR — dekat dengan sekarang, bukan 0 atau null.
const selisihMs = Math.abs(Number(a1?.dihapus_pada) - sekarang);
cek('tanggal nonaktif tercatat (wajar)', selisihMs < 5000, true);
cek('alasan tercatat', a1?.alasan_hapus, 'permintaan pengguna');

// ── AKUN TIDAK BISA DIAKTIFKAN ULANG OLEH DIRINYA SENDIRI ───────────────────
cek('bukan status aktif', a1?.status !== 'aktif', true);

// ══════════════════════════════════════════════════════════════════════════════
// 3. TAHAP 2a — ADMIN MENYETUJUI
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 3. TAHAP 2a: PERSETUJUAN ADMIN ══');

const setuju = setujuiPenghapusan('u1', { oleh: 'admin@vivastic', catatan: 'sudah ditinjau' });
const a1b = db.prepare('SELECT * FROM users WHERE id = ?').get('u1');

cek('persetujuan berhasil', setuju.disetujui, true);
cek('status jadi siap_hapus', a1b?.status, 'siap_hapus');
cek('dicatat siapa yang menyetujui', a1b?.disetujui_oleh, 'admin@vivastic');

// ── AKUN YANG DISETUJUI MASUK DAFTAR HAPUS ──────────────────────────────────
const siapManual = db.prepare(`SELECT id FROM users WHERE status = 'siap_hapus'`).all().map((r) => r.id);
cek('akun disetujui masuk daftar hapus', siapManual.includes('u1'), true);

// ══════════════════════════════════════════════════════════════════════════════
// 4. PENOLAKAN ADMIN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 4. ADMIN MENOLAK ══');

buatAkun('u2', 'tolak@contoh.test');
nonaktifkanAkun('u2', 'permintaan pengguna');

const tolak = tolakPenghapusan('u2', { oleh: 'cs@vivastic', alasan: 'ada tagihan berjalan' });
const a2 = db.prepare('SELECT * FROM users WHERE id = ?').get('u2');

cek('penolakan berhasil', tolak.ditolak, true);
cek('akun kembali aktif', a2?.status, 'aktif');
cek('tanggal nonaktif dikosongkan', a2?.dihapus_pada, null);
cek('alasan penolakan tercatat di audit', typeof tolak.alasan, 'string');

// ══════════════════════════════════════════════════════════════════════════════
// 5. TAHAP 2b — OTOMATIS SETELAH 12 BULAN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 5. TAHAP 2b: OTOMATIS SETELAH 12 BULAN ══');

// Akun A: nonaktif 13 bulan lalu → HARUS masuk daftar otomatis
buatAkun('uA', 'lama@contoh.test', 'menunggu_hapus', sekarang - 13 * BULAN);

// Akun B: nonaktif 6 bulan lalu → BELUM
buatAkun('uB', 'enam@contoh.test', 'menunggu_hapus', sekarang - 6 * BULAN);

// Akun C: nonaktif 12 bulan + 1 hari → HARUS masuk (batas tepat)
buatAkun('uC', 'tepat@contoh.test', 'menunggu_hapus', sekarang - (12 * BULAN + HARI));

// Akun D: aktif, tidak pernah minta hapus → TIDAK
buatAkun('uD', 'aktif@contoh.test', 'aktif');

// Akun E: disetujui admin 1 bulan lalu → HARUS masuk (jalur cepat)
buatAkun('uE', 'disetujui@contoh.test', 'siap_hapus', sekarang - 1 * BULAN);

const otomatis = akunSiapHapusOtomatis().map((r) => r.id);

cek('13 bulan → masuk daftar otomatis', otomatis.includes('uA'), true);
cek('6 bulan → BELUM masuk', otomatis.includes('uB'), false);
cek('12 bulan + 1 hari → masuk', otomatis.includes('uC'), true);
cek('akun aktif → TIDAK masuk', otomatis.includes('uD'), false);
cek('disetujui admin → masuk (jalur cepat)', otomatis.includes('uE'), true);

// ══════════════════════════════════════════════════════════════════════════════
// 6. PENGECUALIAN — ADMIN TIDAK BOLEH MENYETUJUI AKUN BERMASALAH
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 6. PENGECUALIAN PERSETUJUAN ══');

// Akun dengan langganan aktif tidak boleh disetujui
buatAkun('uF', 'bayar@contoh.test');
nonaktifkanAkun('uF', 'permintaan pengguna');

db.prepare(`INSERT INTO payments (id, idempotency_key, tier, periode, jumlah, email, nama, status, dibuat_pada, kedaluwarsa_pada)
            VALUES ('p-f', 'idem-f', 'pro', 'bulanan', 500000, 'bayar@contoh.test', 'Uji', 'dibayar', ?, ?)`)
  .run(sekarang, sekarang + 30 * HARI);

const tolakBayar = setujuiPenghapusan('uF', { oleh: 'admin@vivastic' });
cek('TOLAK setujui kalau ada langganan aktif', tolakBayar.disetujui, false);
cek('alasan penolakan disebutkan', /langganan/i.test(String(tolakBayar.alasan)), true);

// ══════════════════════════════════════════════════════════════════════════════
// 7. PEMBERSIHAN AKHIR — HANYA YANG SIAP
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 7. PEMBERSIHAN AKHIR ══');

const hasil = bersihkanAkunKedaluwarsa();

cek('ada yang dibersihkan', hasil.berhasil > 0, true);
cek('akun 6 bulan TIDAK dibersihkan', !!db.prepare('SELECT id FROM users WHERE id = ?').get('uB'), true);
cek('akun aktif TIDAK dibersihkan', !!db.prepare('SELECT id FROM users WHERE id = ?').get('uD'), true);

// ══════════════════════════════════════════════════════════════════════════════
// 8. JEJAK AUDIT PERSETUJUAN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 8. JEJAK AUDIT ══');

// ── KENAPA INI PENTING ──────────────────────────────────────────────────────
//
// Regulator dan auditor ingin tahu: SIAPA yang menyetujui penghapusan, KAPAN,
// dan ATAS DASAR APA. Tanpa jejak ini, penghapusan akun tidak bisa
// dipertanggungjawabkan.
const audit = db.prepare(`SELECT * FROM access_events WHERE action LIKE 'akun_%' ORDER BY id`).all();

cek('ada catatan audit penghapusan', audit.length > 0, true);
cek('catatan menyebut persetujuan', audit.some((a) => /setujui|siap_hapus/.test(String(a.detail))), true);

console.log('\n  ══════════════════════════════════════════════════════════════');
console.log(`    LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('  ══════════════════════════════════════════════════════════════');

rmSync(DIR, { recursive: true, force: true });
process.exit(gagal > 0 ? 1 : 0);
