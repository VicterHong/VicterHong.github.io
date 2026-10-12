/**
 * Uji pemblokiran hapus akun saat ada langganan/tagihan aktif.
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 *
 * Versi pertama memakai status pembayaran YANG TIDAK ADA:
 *
 *   Kode saya:   status IN ('lunas', 'aktif', 'menunggu')
 *   Sebenarnya:  'pending', 'dibayar', 'gagal', 'kedaluwarsa', 'dikembalikan'
 *
 * NOL dari tiga status itu cocok — jadi pemeriksaannya SELALU mengembalikan 0,
 * dan pengguna dengan langganan aktif TETAP BISA menghapus akunnya.
 *
 * ── KENAPA INI BERBAHAYA ────────────────────────────────────────────────────
 *
 * Kalau akun dihapus sementara langganan berjalan:
 *   • Pengguna tetap DITAGIH setiap bulan
 *   • Tapi sudah kehilangan akses untuk membatalkannya
 *   • Token akses API mereka juga terhapus
 *   • Mereka harus menghubungi dukungan — dan mungkin sudah telanjur
 *     ditagih beberapa kali sebelum menyadarinya
 *
 * ── KENAPA TES INI MEMBACA KONSTANTA, BUKAN STRING LITERAL ─────────────────
 *
 * Menulis `'dibayar'` di tes berarti tes dan kode bisa menyimpang: kalau nama
 * statusnya berubah di produksi, tes tetap lulus karena memakai string lama.
 *
 * Mengimpor STATUS dari checkout.mjs berarti perubahan nama di satu tempat
 * langsung terlihat di sini.
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


const DIR = mkdtempSync(join(tmpdir(), 'uji-langganan-'));
process.env.DB_PATH = join(DIR, 'uji.db');

const { openDb, getDb, migrateUlang } = await import(join(AKAR, 'backend', 'src', 'db.mjs'));
openDb(join(DIR, 'uji.db'));

const { siapkanTabelPengguna } = await import(join(AKAR, 'backend', 'src', 'users.mjs'));
siapkanTabelPengguna();
migrateUlang();

// ── STATUS DIAMBIL DARI MODUL PRODUKSI ──────────────────────────────────────
//
// Bukan ditulis ulang sebagai string. Kalau namanya berubah di checkout.mjs,
// tes ini otomatis memakai nama yang baru.
const { STATUS } = await import(join(AKAR, 'backend', 'src', 'checkout.mjs'));

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = String(dapat) === String(harap);
  if (ok) { lulus++; console.log(`    ✅ ${nama}`); }
  else { gagal++; console.log(`    ❌ ${nama}\n       dapat: ${dapat}\n       harap: ${harap}`); }
};

const db = getDb();
const sekarang = Date.now();

console.log('\n  ══ 1. KONSTANTA STATUS (dibaca dari produksi) ══');
cek('STATUS.PENDING ada', typeof STATUS.PENDING, 'string');
cek('STATUS.DIBAYAR ada', typeof STATUS.DIBAYAR, 'string');
cek('STATUS.GAGAL ada', typeof STATUS.GAGAL, 'string');
cek('STATUS.KEDALUWARSA ada', typeof STATUS.KEDALUWARSA, 'string');
cek('STATUS.DIKEMBALIKAN ada', typeof STATUS.DIKEMBALIKAN, 'string');
console.log(`    ℹ️  nilai: ${Object.values(STATUS).join(', ')}`);

// ══════════════════════════════════════════════════════════════════════════════
// 2. FUNGSI PEMERIKSA — definisi yang akan dipakai produksi
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 2. PEMERIKSAAN LANGGANAN ══');

/**
 * Apakah pengguna punya langganan/tagihan yang menghalangi penghapusan?
 *
 * ── KENAPA `pending` IKUT MENGHALANGI ──────────────────────────────────────
 *
 * Tagihan `pending` adalah tagihan yang MASIH BISA DIBAYAR. Kalau akun dihapus
 * saat tagihan menggantung:
 *   • Pengguna membayar tagihan yang tidak lagi bisa diakses
 *   • Uang masuk tanpa layanan
 *   • Refund manual — dan itu memakan waktu dukungan
 *
 * Lebih baik meminta mereka menyelesaikan atau membatalkan tagihannya dulu.
 *
 * ── KENAPA `gagal` DAN `kedaluwarsa` TIDAK MENGHALANGI ─────────────────────
 *
 * Keduanya sudah SELESAI — tidak ada uang yang akan berpindah, tidak ada
 * kewajiban tersisa. Menghalangi penghapusan karena percobaan bayar yang gagal
 * berarti mengunci pengguna selamanya hanya karena satu transaksi tidak jadi.
 *
 * ── KENAPA `dikembalikan` TIDAK MENGHALANGI ────────────────────────────────
 *
 * Refund sudah selesai — uangnya sudah kembali. Tidak ada kewajiban tersisa.
 */
function adaLanggananAktif(email) {
  const baris = db.prepare(`
    SELECT id, status, tier, kedaluwarsa_pada FROM payments
    WHERE email = ? AND status IN (?, ?)
  `).all(email, STATUS.PENDING, STATUS.DIBAYAR);

  // ── PEMBAYARAN LAMA TIDAK MENGHALANGI ──────────────────────────────────────
  //
  // Pembayaran yang sudah kedaluwarsa masa berlakunya bukan langganan aktif.
  // Tanpa pemeriksaan tanggal, pengguna yang pernah berlangganan 2 tahun lalu
  // tidak akan pernah bisa menghapus akunnya.
  //
  // `kedaluwarsa_pada` NULL berarti tidak ada batas waktu — diperlakukan
  // sebagai aktif, karena itu artinya langganan berjalan tanpa akhir.
  const aktif = baris.filter((b) => {
    if (!b.kedaluwarsa_pada) return true;
    return Number(b.kedaluwarsa_pada) > sekarang;
  });

  return { ada: aktif.length > 0, jumlah: aktif.length, rincian: aktif };
}

// ── SIAPKAN DATA UJI ───────────────────────────────────────────────────────
function buatPembayaran(id, email, status, kedaluwarsa) {
  db.prepare(`INSERT INTO payments (id, idempotency_key, tier, periode, jumlah, email, nama, status, dibuat_pada, kedaluwarsa_pada)
              VALUES (?, ?, 'pro', 'bulanan', 500000, ?, 'Uji', ?, ?, ?)`)
    .run(id, 'idem-' + id, email, status, sekarang, kedaluwarsa);
}

// ── TIDAK ADA PEMBAYARAN ───────────────────────────────────────────────────
cek('tanpa pembayaran → boleh hapus', adaLanggananAktif('kosong@contoh.test').ada, false);

// ── DIBAYAR & MASIH BERLAKU → BLOKIR ───────────────────────────────────────
buatPembayaran('p-dibayar', 'bayar@contoh.test', STATUS.DIBAYAR, sekarang + 30 * 86400000);
cek('dibayar + masih berlaku → BLOKIR', adaLanggananAktif('bayar@contoh.test').ada, true);

// ── PENDING → BLOKIR ───────────────────────────────────────────────────────
buatPembayaran('p-pending', 'pending@contoh.test', STATUS.PENDING, sekarang + 86400000);
cek('pending → BLOKIR (tagihan menggantung)', adaLanggananAktif('pending@contoh.test').ada, true);

// ── GAGAL → TIDAK BLOKIR ───────────────────────────────────────────────────
buatPembayaran('p-gagal', 'gagal@contoh.test', STATUS.GAGAL, null);
cek('gagal → TIDAK blokir', adaLanggananAktif('gagal@contoh.test').ada, false);

// ── KEDALUWARSA (status) → TIDAK BLOKIR ────────────────────────────────────
buatPembayaran('p-kedaluwarsa', 'kadaluarsa@contoh.test', STATUS.KEDALUWARSA, null);
cek('status kedaluwarsa → TIDAK blokir', adaLanggananAktif('kadaluarsa@contoh.test').ada, false);

// ── DIKEMBALIKAN → TIDAK BLOKIR ────────────────────────────────────────────
buatPembayaran('p-refund', 'refund@contoh.test', STATUS.DIKEMBALIKAN, null);
cek('dikembalikan → TIDAK blokir', adaLanggananAktif('refund@contoh.test').ada, false);

// ══════════════════════════════════════════════════════════════════════════════
// 3. PEMBAYARAN LAMA (kedaluwarsa_pada sudah lewat)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 3. PEMBAYARAN LAMA TIDAK MENGHALANGI ══');

// Dibayar 2 tahun lalu, masa berlaku sudah habis.
buatPembayaran('p-lama', 'lama@contoh.test', STATUS.DIBAYAR, sekarang - 365 * 86400000);
cek('dibayar tapi sudah lewat masa → TIDAK blokir', adaLanggananAktif('lama@contoh.test').ada, false);

// Dibayar, tanpa kedaluwarsa_pada → dianggap aktif selamanya.
buatPembayaran('p-selamanya', 'selamanya@contoh.test', STATUS.DIBAYAR, null);
cek('dibayar tanpa batas waktu → BLOKIR', adaLanggananAktif('selamanya@contoh.test').ada, true);

// ══════════════════════════════════════════════════════════════════════════════
// 4. BEBERAPA PEMBAYARAN — SATU AKTIF CUKUP UNTUK MEMBLOKIR
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 4. KOMBINASI PEMBAYARAN ══');

buatPembayaran('p-campur-1', 'campur@contoh.test', STATUS.GAGAL, null);
buatPembayaran('p-campur-2', 'campur@contoh.test', STATUS.DIBAYAR, sekarang + 10 * 86400000);
cek('1 gagal + 1 aktif → BLOKIR', adaLanggananAktif('campur@contoh.test').ada, true);
cek('jumlah aktif = 1', adaLanggananAktif('campur@contoh.test').jumlah, 1);

console.log('\n  ══════════════════════════════════════════════════════════════');
console.log(`    LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('  ══════════════════════════════════════════════════════════════');

rmSync(DIR, { recursive: true, force: true });
process.exit(gagal > 0 ? 1 : 0);
