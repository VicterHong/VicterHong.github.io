/**
 * Penggantian variabel {{...}} pada HTML email hasil kompilasi MJML.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── ALUR ────────────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   email-src/templates.mjml.mjs   →  sumber MJML dengan {{nama}}, {{kode}}
 *              ↓  scripts/build-email.mjs  (sekali, saat build)
 *   backend/src/email/html.mjs     →  HTML dengan {{nama}} MASIH placeholder
 *              ↓  isiVariabel()            (setiap kali kirim)
 *   HTML final                     →  "Halo Victer," dengan nilai sebenarnya
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA DIISI SAAT KIRIM, BUKAN SAAT BUILD ───────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Satu template melayani semua penerima. Nilai yang berbeda (nama, kode,
 * tautan) hanya diketahui saat email benar-benar dikirim. Mengganti di build
 * berarti butuh file terkompilasi per kombinasi nilai — mustahil.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KEAMANAN: ESCAPE HTML ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Nilai variabel berasal dari data pengguna (nama, email) dan dari sistem
 * (kode, tautan). Nama pengguna bisa berisi karakter HTML — `<`, `>`, `&`,
 * kutip. Kalau disisipkan mentah, ia bisa merusak struktur email, atau lebih
 * buruk menyisipkan elemen yang tidak kita maksud.
 *
 * Karena itu setiap nilai di-escape secara default. Untuk kasus yang memang
 * butuh HTML (mis. blok yang sudah kita susun sendiri), gunakan
 * `{ html: true }` — dan hanya untuk nilai yang KITA yang buat.
 */

/** Karakter yang punya makna khusus di HTML. */
const ESCAPE = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape teks supaya aman disisipkan ke HTML.
 *
 * Urutan penting: `&` HARUS lebih dulu. Kalau `<` diganti lebih dulu lalu
 * `&` diganti setelahnya, hasilnya `&amp;lt;` — teksnya berubah.
 */
export function escapeHtml(nilai) {
  return String(nilai ?? '').replace(/[&<>"']/g, (c) => ESCAPE[c]);
}

/**
 * Ganti SEMUA placeholder {{nama}} di dalam HTML.
 *
 * @param {string} html    - HTML hasil kompilasi MJML
 * @param {object} nilai   - { nama: 'Victer', kode: '123456', ... }
 * @param {object} [opsi]
 * @param {string[]} [opsi.mentah] - nama variabel yang isinya HTML (tidak di-escape)
 * @returns {string} HTML dengan nilai terpasang
 */
export function isiVariabel(html, nilai = {}, { mentah = [] } = {}) {
  const mentahSet = new Set(mentah);

  let hasil = html;

  for (const [nama, isi] of Object.entries(nilai)) {
    if (isi === undefined || isi === null) continue;

    const teks = mentahSet.has(nama) ? String(isi) : escapeHtml(isi);

    // `split().join()` mengganti SEMUA kemunculan — `String.replace` dengan
    // string pola hanya mengganti yang pertama. Template kita memakai
    // {{tautan}} dua kali (tombol + kotak cadangan); dengan `replace`, yang
    // kedua akan tertinggal sebagai placeholder mentah.
    hasil = hasil.split(`{{${nama}}}`).join(teks);
  }

  return hasil;
}

/**
 * Cari placeholder yang MASIH tersisa setelah pengisian.
 *
 * ── KENAPA INI PENTING ──────────────────────────────────────────────────────
 * Kalau pemanggil lupa mengirim satu nilai, email sampai ke pengguna dengan
 * "{{nama}}" mentah di dalamnya — dan itu baru ketahuan dari keluhan, setelah
 * email tidak bisa ditarik kembali.
 *
 * Fungsi ini dipakai sebagai pemeriksaan terakhir sebelum kirim: kalau ada
 * sisa placeholder, pengirim mencatatnya sebagai error (bukan mengirim email
 * yang jelas rusak).
 *
 * @returns {string[]} nama variabel yang belum terisi
 */
export function placeholderTersisa(html) {
  return [...new Set([...html.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]))];
}

/**
 * Bangun nilai standar yang dipakai SEMUA email.
 *
 * `judul` (judul besar di kartu), `judul_email` (tag <title>), dan `tahun`
 * ada di kerangka — bukan di template masing-masing. Mengisinya di satu
 * tempat mencegah setiap pemanggil harus mengingatnya.
 */
export function nilaiStandar({ judul, judulEmail } = {}) {
  return {
    judul: escapeHtml(judul ?? ''),
    judul_email: escapeHtml(judulEmail ?? judul ?? 'VIVASTIC'),
    tahun: new Date().getFullYear(),
  };
}
