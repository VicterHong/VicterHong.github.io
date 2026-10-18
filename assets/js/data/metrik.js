/**
 * METRIK TERVERIFIKASI — angka yang bisa dibuktikan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ATURAN YANG DIPAKAI DI SELURUH BERKAS INI
 * ══════════════════════════════════════════════════════════════════════════════
 * SETIAP angka di sini punya `sumber` — cara pengunjung memeriksanya sendiri.
 * Angka tanpa sumber tidak boleh ada di berkas ini.
 *
 * ── KENAPA TIDAK ADA "DAMPAK BISNIS" DI SINI ────────────────────────────────
 * Yang diminta adalah metrik seperti "jam kerja manual yang dihemat per minggu"
 * atau "persentase pengurangan biaya server".
 *
 * Angka itu TIDAK BISA ditulis, karena:
 *
 *   1. Tidak ada klien nyata. Nol pelanggan berarti nol data sebelum/sesudah.
 *   2. Tidak ada pengukuran baseline. "Menghemat 12 jam" mengandaikan kita
 *      tahu berapa jam yang dipakai SEBELUM sistemnya — dan kita tidak tahu.
 *   3. Angka seperti itu tidak bisa diperiksa. Pengunjung harus percaya saja.
 *
 * Menulisnya berarti mengarang. Dan mengarang satu angka merusak SELURUH
 * portofolio ini: pengunjung yang menemukan satu klaim palsu akan meragukan
 * 1.428 tes yang asli juga.
 *
 * ── YANG DITULIS SEBAGAI GANTINYA ───────────────────────────────────────────
 * Metrik teknik yang SAYA UKUR SENDIRI dari kode yang ada. Semuanya bisa
 * diperiksa dengan membuka repo atau menjalankan perintah yang tertulis.
 *
 * Untuk dampak bisnis, ada kalkulator (roi-calculator.js) yang menghitung dari
 * angka yang DIKETIK PENGUNJUNG SENDIRI. Itu memberi jawaban tanpa perlu
 * memercayai klaim saya.
 */

/**
 * Metrik per proyek.
 *
 * ── BENTUK TIAP METRIK ──────────────────────────────────────────────────────
 *   label   apa yang diukur
 *   nilai   angkanya
 *   sumber  cara memeriksanya — WAJIB ada
 *   jenis   'terukur' (saya ukur) | 'klaim-repo' (tertulis di repo)
 */
export const metrikProyek = {};
export const catatanMetrik = { judul: '', poin: [] };
