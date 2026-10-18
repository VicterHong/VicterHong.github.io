/**
 * DIAGRAM ARSITEKTUR — data.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA DIAGRAM, BUKAN DAFTAR FITUR
 * ══════════════════════════════════════════════════════════════════════════════
 * Daftar fitur menjawab "apa yang bisa dilakukan". Diagram menjawab "bagaimana
 * ia bekerja" — dan pertanyaan kedua yang menentukan bagi orang teknis.
 *
 * Yang tidak terlihat dari daftar fitur:
 *   - Di mana lapisan keamanannya, dan apa yang terjadi sebelum data masuk
 *   - Bagian mana yang berjalan di server, mana di perangkat klien
 *   - Di mana titik kegagalan, dan apa yang menahannya
 *
 * ── KENAPA INTERAKTIF, BUKAN GAMBAR ─────────────────────────────────────────
 * Diagram statis menampilkan semua hal sekaligus, dan yang penting tenggelam
 * di antaranya. Dengan bisa diklik, pengunjung memilih sendiri kedalaman yang
 * ia butuhkan:
 *
 *   pemilik bisnis → lihat kotaknya, paham alurnya
 *   engineer       → klik, baca detail teknisnya
 *
 * ── KENAPA DATA, BUKAN SVG YANG DIGAMBAR TANGAN ─────────────────────────────
 * SVG yang digambar tangan tidak bisa diperbarui tanpa menggambar ulang, dan
 * tidak bisa diuji. Sebagai data, ia bisa diperiksa tes: apakah setiap langkah
 * punya penjelasan, apakah alurnya masuk akal, apakah tidak ada langkah yatim.
 */

/**
 * Alur untuk tiap proyek.
 *
 * ── BENTUK TIAP LANGKAH ─────────────────────────────────────────────────────
 *   id       pengenal unik dalam satu alur
 *   label    nama singkat yang tampil di kotak
 *   jenis    'masuk' | 'proses' | 'aman' | 'simpan' | 'keluar' — menentukan warna
 *   ringkas  satu kalimat untuk yang memindai cepat
 *   detail   penjelasan teknis untuk yang mengklik
 *   fakta    daftar poin teknis (opsional)
 */
export const alurProyek = {};
export const JENIS_LANGKAH = {};
