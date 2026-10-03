/**
 * Persetujuan syarat akses (NDA ringan) — menutup pertanyaan terbuka Q5 di PRD:
 * "Apakah perlu NDA digital sebelum token diterbitkan?"
 *
 * KEPUTUSAN: ya, tapi NDA RINGAN — bukan dokumen hukum yang harus ditandatangani.
 *
 * Alasan:
 *   1. NDA penuh (PDF, tanda tangan, saksi) menambah gesekan berhari-hari pada
 *      alur sales. Untuk akses baca-saja ke dokumentasi arsitektur, itu berlebihan.
 *   2. Yang sebenarnya dibutuhkan: BUKTI bahwa pemegang token tahu kontennya
 *      rahasia dan menyetujui konsekuensinya. Itu cukup dengan persetujuan
 *      elektronik yang dicatat (timestamp + IP + versi teks).
 *   3. Untuk deal enterprise besar, NDA penuh tetap ditangani terpisah oleh
 *      sales — modul ini hanya untuk token standar.
 *
 * Modul ini menyediakan:
 *   - Teks syarat (berversi, supaya persetujuan lama tetap bisa diaudit)
 *   - Fungsi pencatatan persetujuan
 *   - Verifikasi bahwa persetujuan ada sebelum konten terkunci dikirim
 */

/**
 * Versi teks syarat. Naikkan angkanya kalau teks berubah — persetujuan lama
 * tetap terikat versi yang mereka setujui saat itu.
 */
export const TERMS_VERSION = '1.0';

/**
 * Teks syarat akses. Ditulis dalam bahasa yang bisa dipahami non-pengacara,
 * karena audiensnya engineering leader, bukan tim legal.
 */
export const TERMS_TEXT = `SYARAT AKSES KONTEN TERKUNCI — Versi ${TERMS_VERSION}

Dengan membuka konten terkunci ini, Anda menyetujui:

1. KERAHASIAAN
   Konten ini berisi detail arsitektur, keputusan desain, dan metrik internal
   yang tidak dipublikasikan. Jangan sebarkan, salin, atau publikasikan tanpa
   izin tertulis dari pemilik.

2. PENGGUNAAN TERBATAS
   Konten hanya untuk evaluasi internal Anda (mis. menilai kemungkinan kerja
   sama). Tidak untuk pelatihan model, pengumpulan data massal, atau
   perbandingan kompetitif.

3. TIDAK UNTUK DIBAGIKAN
   Token akses bersifat pribadi. Membagikan tautan atau token kepada pihak
   lain akan membuat akses dicabut otomatis oleh sistem.

4. JEJAK AKSES
   Setiap pembukaan konten dicatat (waktu, alamat IP, perangkat) untuk
   keamanan. Catatan ini disimpan di server pemilik, tidak dibagikan ke pihak
   ketiga.

5. PENCABUTAN
   Pemilik dapat mencabut akses kapan saja tanpa pemberitahuan sebelumnya.

6. TIDAK ADA GARANSI
   Konten disediakan apa adanya untuk tujuan evaluasi. Tidak ada jaminan
   kelengkapan atau kesesuaian untuk tujuan tertentu.

Pertanyaan tentang syarat ini: hubungi pemilik lewat kanal kontak di situs.`;

/**
 * Catat persetujuan pemegang token.
 *
 * Yang disimpan sengaja minimal: versi teks, waktu, IP, dan user-agent.
 * Tidak menyimpan nama atau email di sini — itu sudah ada di tabel lead/token.
 *
 * @param {object} db koneksi database
 * @param {object} input
 * @param {number} input.tokenId id token yang menyetujui
 * @param {string} input.version versi teks yang disetujui
 * @param {string} input.ip alamat IP saat menyetujui
 * @param {string} input.userAgent user-agent saat menyetujui
 * @returns {{ok: boolean, id?: number, error?: string}}
 */
export function recordConsent(db, { tokenId, version = TERMS_VERSION, ip = '', userAgent = '' }) {
  if (!tokenId) return { ok: false, error: 'token_id_wajib' };
  if (!version) return { ok: false, error: 'versi_wajib' };

  try {
    const stmt = db.prepare(
      `INSERT INTO consents (token_id, terms_version, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const info = stmt.run(
      Number(tokenId),
      String(version).slice(0, 20),
      String(ip ?? '').slice(0, 64),
      String(userAgent ?? '').slice(0, 300),
      new Date().toISOString(),
    );
    return { ok: true, id: Number(info.lastInsertRowid) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Ambil persetujuan terakhir untuk sebuah token.
 * @param {object} db koneksi database
 * @param {number} tokenId id token
 * @returns {object|null} baris persetujuan, atau null kalau belum ada
 */
export function latestConsent(db, tokenId) {
  if (!tokenId) return null;
  try {
    return db.prepare(
      `SELECT * FROM consents WHERE token_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).get(Number(tokenId)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Apakah token ini sudah menyetujui versi syarat yang berlaku sekarang.
 *
 * Dipakai sebelum mengirim konten terkunci: kalau pemegang token menyetujui
 * versi lama dan teksnya sudah berubah, frontend menampilkan syarat baru dulu.
 *
 * @param {object} db koneksi database
 * @param {number} tokenId id token
 * @returns {{ok: boolean, needsConsent: boolean, version?: string}}
 */
export function consentStatus(db, tokenId) {
  const row = latestConsent(db, tokenId);
  if (!row) return { ok: false, needsConsent: true };
  if (row.terms_version !== TERMS_VERSION) {
    return { ok: false, needsConsent: true, version: row.terms_version };
  }
  return { ok: true, needsConsent: false, version: row.terms_version };
}
