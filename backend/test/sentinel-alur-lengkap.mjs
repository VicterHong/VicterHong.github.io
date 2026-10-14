/**
 * UJI ALUR LENGKAP — dari webhook masuk sampai data yang dilihat inspector.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * APA YANG DIUJI
 * ══════════════════════════════════════════════════════════════════════════════
 * Setiap modul sudah punya tesnya sendiri (tanda-tangan, antrean, sirkuit,
 * pengirim). Yang BELUM diuji adalah apakah mereka BEKERJA BERSAMA:
 *
 *   webhook masuk → antrean
 *     → pengirim mencoba kirim
 *       → gagal → backoff naik, sirkuit mencatat
 *         → gagal beruntun → sirkuit diputus → pengiriman dilewati
 *           → batas percobaan habis → masuk DLQ
 *             → data yang dibaca inspector bentuknya benar
 *
 * ── KENAPA BENTUK DATA JUGA DIUJI ───────────────────────────────────────────
 * Inspector membaca properti dengan nama tertentu. Kalau nama itu tidak ada di
 * jawaban API, tampilannya jadi "—" atau "undefined" TANPA error apa pun —
 * halaman tampak normal padahal informasinya hilang.
 *
 * Jadi tes ini memeriksa NAMA PROPERTI, bukan hanya status HTTP.
 */
import { openDb, getDb } from '../src/db.mjs';
import {
  siapkanTabelAntrean,
  masukAntrean,
  statistikAntrean,
  MAKS_PERCOBAAN,
} from '../src/sentinel/antrean.mjs';
import {
  siapkanTabelSirkuit,
  keadaanSirkuit,
  daftarSirkuit,
  hostDari,
  tutupPaksa,
} from '../src/sentinel/sirkuit.mjs';
// `detailPesan` ada di pengirim.mjs — ia yang menggabungkan data antrean dengan
// keadaan sirkuit, dan itu yang dipakai inspector.
import { jalankanPutaran, ambilPesan } from '../src/sentinel/pengirim.mjs';

let lulus = 0;
let gagal = 0;

function periksa(nama, syarat, keterangan = '') {
  if (syarat) {
    lulus += 1;
    console.log(`  ✅ ${nama}`);
  } else {
    gagal += 1;
    console.log(`  ❌ ${nama}${keterangan ? ` — ${keterangan}` : ''}`);
  }
}

function bagian(judul) {
  console.log(`\n── ${judul} ──`);
}

/* ══ PERSIAPAN ══════════════════════════════════════════════════════════════ */

openDb(':memory:');
siapkanTabelAntrean();
siapkanTabelSirkuit();

// Tujuan yang SELALU gagal — untuk menguji backoff, sirkuit, dan DLQ.
const TUJUAN_MATI = 'http://127.0.0.1:9/mati';

let jumlahPanggilan = 0;
const fetchTiruan = async () => {
  jumlahPanggilan += 1;
  throw new Error('ECONNREFUSED');
};

/* ══ 1. WEBHOOK MASUK ══════════════════════════════════════════════════════ */

bagian('1. WEBHOOK MASUK → ANTREAN');

const isi = JSON.stringify({ event: 'order.paid', order_id: 'ORD-001', total: 250000 });

const hasil = masukAntrean({
  sumber: 'midtrans',
  idPeristiwa: 'evt-001',
  url: TUJUAN_MATI,
  body: isi,
  headers: { 'content-type': 'application/json' },
});

// ── BENTUK NILAI KEMBALIAN: { ok, id, duplikat } ─────────────────────────────
// Bukan { diterima, status } — status pesan dibaca dari database, bukan dari
// nilai kembalian. Menebak bentuknya membuat tes gagal karena alasan yang salah.
periksa('webhook diterima', hasil.ok === true && hasil.duplikat === false, JSON.stringify(hasil));
periksa('dapat id pesan', typeof hasil.id === 'string' && hasil.id.length > 0);

const barisAwal = getDb().prepare('SELECT status FROM sentinel_antrean WHERE id = ?').get(hasil.id);
periksa('status awal menunggu', barisAwal.status === 'menunggu', `dapat ${barisAwal.status}`);

const stats1 = statistikAntrean();
periksa('antrean mencatat 1 menunggu', stats1.menunggu === 1, `dapat ${stats1.menunggu}`);
periksa('total pesan 1', stats1.total === 1, `dapat ${stats1.total}`);

/* ══ 2. DUPLIKAT DITOLAK ═══════════════════════════════════════════════════ */

bagian('2. WEBHOOK DIKIRIM ULANG → DITOLAK');

const ulang = masukAntrean({
  sumber: 'midtrans',
  idPeristiwa: 'evt-001', // ID peristiwa SAMA
  url: TUJUAN_MATI,
  body: isi,
  headers: { 'content-type': 'application/json' },
});

// Duplikat tetap `ok: true` — yang membedakan adalah `duplikat: true`.
// Pesan aslinya tetap ada dan TIDAK digandakan; itu yang penting.
periksa('duplikat dikenali', ulang.duplikat === true, JSON.stringify(ulang));
periksa('alasan menyebut ID peristiwa', ulang.alasan === 'id_peristiwa_sudah_ada', `dapat ${ulang.alasan}`);
periksa('antrean TIDAK bertambah', statistikAntrean().total === 1, `dapat ${statistikAntrean().total}`);

/* ══ 3. PENGIRIMAN GAGAL → BACKOFF ═════════════════════════════════════════ */

bagian('3. PENGIRIMAN GAGAL → BACKOFF NAIK');

const putaran1 = await jalankanPutaran({ fetchImpl: fetchTiruan, batas: 10 });

periksa('ada percobaan jaringan', jumlahPanggilan >= 1, `dapat ${jumlahPanggilan}`);
periksa('putaran melaporkan gagal', putaran1.gagal >= 1, JSON.stringify(putaran1));

const baris1 = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(hasil.id);
periksa('percobaan bertambah jadi 1', baris1.percobaan === 1, `dapat ${baris1.percobaan}`);
periksa('status tetap menunggu', baris1.status === 'menunggu', `dapat ${baris1.status}`);
// ── NAMA KOLOM: `jadwal_berikut`, bukan `berikutnya_at` ──────────────────────
periksa('ada jadwal coba berikutnya', baris1.jadwal_berikut > Date.now(), `jadwal_berikut=${baris1.jadwal_berikut}`);
periksa('ada pesan galat tercatat', !!baris1.pesan_galat, `dapat ${baris1.pesan_galat}`);

/* ══ 4. SIRKUIT MENCATAT KEGAGALAN ═════════════════════════════════════════ */

bagian('4. SIRKUIT MENCATAT KEGAGALAN');

const sirkuit1 = keadaanSirkuit(TUJUAN_MATI);
periksa('sirkuit ada', !!sirkuit1, 'tidak ditemukan');
periksa('gagal beruntun = 1', sirkuit1.gagalBeruntun === 1, `dapat ${sirkuit1.gagalBeruntun}`);
periksa('keadaan masih normal', sirkuit1.keadaan === 'tertutup', `dapat ${sirkuit1.keadaan}`);

/* ══ 5. GAGAL BERUNTUN → SIRKUIT DIPUTUS ═══════════════════════════════════ */

bagian('5. GAGAL BERUNTUN → SIRKUIT DIPUTUS');

// Paksa jadwal coba berikutnya jadi "sekarang" supaya tidak perlu menunggu.
function majukanJadwal() {
  getDb().prepare('UPDATE sentinel_antrean SET jadwal_berikut = 0 WHERE status = ?').run('menunggu');
}

for (let i = 0; i < 6; i += 1) {
  majukanJadwal();
  await jalankanPutaran({ fetchImpl: fetchTiruan, batas: 10 });
}

const sirkuit2 = keadaanSirkuit(TUJUAN_MATI);
periksa('gagal beruntun naik', sirkuit2.gagalBeruntun >= 5, `dapat ${sirkuit2.gagalBeruntun}`);
periksa('sirkuit DIPUTUS', sirkuit2.keadaan === 'terbuka', `dapat ${sirkuit2.keadaan}`);
periksa('tidak boleh kirim saat terbuka', sirkuit2.bolehKirim === false, `dapat ${sirkuit2.bolehKirim}`);

// ── SISA WAKTU TUNGGU DIUJI DARI daftarSirkuit(), BUKAN keadaanSirkuit() ─────
// Keduanya punya peran berbeda:
//   keadaanSirkuit() → keputusan satu endpoint (untuk pengirim)
//   daftarSirkuit()  → data untuk ditampilkan (untuk inspector)
// Hitung mundurnya hanya ada di yang kedua, karena hanya tampilan yang
// membutuhkannya. Menguji properti tampilan lewat fungsi keputusan akan gagal
// walaupun tampilannya benar.
const daftarS = daftarSirkuit();
const barisS = daftarS.find((s) => s.host === hostDari(TUJUAN_MATI));
periksa('sirkuit muncul di daftar', !!barisS, `host tidak ditemukan di ${daftarS.length} baris`);
periksa('ada waktu tunggu tersisa', barisS && barisS.sisaTungguMs > 0, `dapat ${barisS?.sisaTungguMs}`);

/* ══ 6. SIRKUIT TERBUKA → PENGIRIMAN DILEWATI ══════════════════════════════ */

bagian('6. SIRKUIT TERBUKA → PENGIRIMAN DILEWATI (hemat CPU)');

const sebelum = jumlahPanggilan;
majukanJadwal();
const putaranDilewati = await jalankanPutaran({ fetchImpl: fetchTiruan, batas: 10 });
const sesudah = jumlahPanggilan;

periksa('TIDAK ada panggilan jaringan baru', sesudah === sebelum, `${sebelum} → ${sesudah}`);
periksa('putaran melaporkan dilewati', putaranDilewati.dilewati >= 1, JSON.stringify(putaranDilewati));

/* ══ 7. BATAS PERCOBAAN → DLQ ══════════════════════════════════════════════ */

bagian('7. BATAS PERCOBAAN HABIS → MASUK DLQ');

let putaranDlq = null;
for (let i = 0; i < MAKS_PERCOBAAN + 2; i += 1) {
  majukanJadwal();
  tutupPaksa(TUJUAN_MATI); // supaya pengiriman benar-benar dicoba
  putaranDlq = await jalankanPutaran({ fetchImpl: fetchTiruan, batas: 10 });

  const s = getDb().prepare('SELECT status FROM sentinel_antrean WHERE id = ?').get(hasil.id);
  if (s.status === 'dlq') break;
}

const barisDlq = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(hasil.id);
periksa('pesan masuk DLQ', barisDlq.status === 'dlq', `dapat ${barisDlq.status}`);
periksa('percobaan mencapai batas', barisDlq.percobaan >= MAKS_PERCOBAAN, `${barisDlq.percobaan} / ${MAKS_PERCOBAAN}`);
periksa('masuk DLQ tanpa galat sisa', !!barisDlq.pesan_galat, 'pesan galat kosong');

const stats2 = statistikAntrean();
periksa('ringkasan melaporkan DLQ', stats2.dlq === 1, `dapat ${stats2.dlq}`);

/* ══ 8. BENTUK DATA YANG DIBACA INSPECTOR ══════════════════════════════════ */

bagian('8. BENTUK DATA UNTUK INSPECTOR');

const ringkas = statistikAntrean();
periksa('ringkasan punya .menunggu', typeof ringkas.menunggu === 'number');
periksa('ringkasan punya .dikirim', typeof ringkas.dikirim === 'number');
periksa('ringkasan punya .dlq', typeof ringkas.dlq === 'number');
periksa('ringkasan punya .total', typeof ringkas.total === 'number');
periksa('ringkasan punya .latensi', typeof ringkas.latensi === 'object' && ringkas.latensi !== null);
periksa('latensi punya .rataMs', 'rataMs' in ringkas.latensi);
periksa('latensi punya .sampel', 'sampel' in ringkas.latensi);

/* ══ 9. PANEL DETAIL PUNYA SEMUA YANG DIBUTUHKAN ═══════════════════════════ */

bagian('9. PANEL DETAIL PUNYA SEMUA YANG DIBUTUHKAN');

const detail = ambilPesan(hasil.id);

periksa('detail ditemukan', !!detail, 'tidak ada');
for (const kolom of ['id', 'sumber', 'url', 'status', 'percobaan', 'body', 'headers', 'diterima_at']) {
  periksa(`detail punya .${kolom}`, detail && kolom in detail, 'tidak ada');
}

periksa('body utuh tersimpan', detail?.body === isi, 'body berubah');
periksa('headers tersimpan sebagai objek', typeof detail?.headers === 'object');

/* ══ 10. PESAN BERIKUTNYA BISA DIKIRIM (pemulihan) ═════════════════════════ */

bagian('10. TUJUAN PULIH → PESAN BARU TERKIRIM');

const fetchSehat = async () => ({
  ok: true,
  status: 200,
  text: async () => 'OK',
});

// Pesan baru setelah tujuan pulih.
const hasil2 = masukAntrean({
  sumber: 'github',
  idPeristiwa: 'evt-002',
  url: 'http://127.0.0.1:9/sehat',
  body: JSON.stringify({ event: 'push' }),
});

tutupPaksa('http://127.0.0.1:9/sehat');
const putaranSehat = await jalankanPutaran({ fetchImpl: fetchSehat, batas: 10 });

const baris2 = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(hasil2.id);
periksa('pesan baru terkirim', baris2.status === 'dikirim', `dapat ${baris2.status}`);
periksa('ada kode balasan', baris2.kode_balasan === 200, `dapat ${baris2.kode_balasan}`);
periksa('latensi tercatat', baris2.latensi_ms != null, `dapat ${baris2.latensi_ms}`);
periksa('putaran melaporkan terkirim', putaranSehat.terkirim >= 1, JSON.stringify(putaranSehat));

const statsAkhir = statistikAntrean();
periksa('latensi punya sampel setelah sukses', statsAkhir.latensi.sampel >= 1, `dapat ${statsAkhir.latensi.sampel}`);
periksa('latensi rata-rata masuk akal', statsAkhir.latensi.rataMs >= 0, `dapat ${statsAkhir.latensi.rataMs}`);

/* ══ RINGKASAN ═════════════════════════════════════════════════════════════ */

console.log('\n' + '─'.repeat(56));
if (gagal === 0) {
  console.log(`✅ SEMUA LULUS — ${lulus} pemeriksaan`);
} else {
  console.log(`❌ ${gagal} GAGAL dari ${lulus + gagal} pemeriksaan`);
}
process.exit(gagal === 0 ? 0 : 1);
