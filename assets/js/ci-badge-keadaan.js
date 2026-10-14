/**
 * KEADAAN BADGE CI — logika murni, tanpa DOM.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA DIPISAH DARI ci-badge.js
 * ══════════════════════════════════════════════════════════════════════════════
 * `ci-badge.js` menyentuh `document` saat diimpor — ia mencari elemen badge
 * dan mulai mengambil data. Itu berarti logikanya TIDAK BISA DIUJI tanpa
 * browser: mengimpor berkasnya di Node langsung melempar `document is not
 * defined`.
 *
 * Padahal bagian yang paling mudah salah justru logikanya, bukan pengambilan
 * datanya. Kasus nyatanya: workflow yang sedang berjalan mengirim
 * `conclusion: null`, dan kode yang memeriksa `=== 'success'` akan
 * melaporkannya sebagai "gagal".
 *
 * Dengan memisahkannya ke berkas sendiri:
 *   - logikanya bisa diuji di Node, tanpa browser
 *   - ci-badge.js hanya mengurus DOM
 *   - tidak ada duplikasi: keduanya memakai fungsi yang sama
 *
 * ── KENAPA TIDAK MEMAKAI jsdom ATAU SEJENISNYA ──────────────────────────────
 * Proyek ini nol dependensi. Menambah jsdom hanya untuk menguji satu fungsi
 * berarti menambah ratusan paket ke pohon dependensi — dan itu bertentangan
 * dengan prinsip yang sudah dijaga di seluruh proyek ini.
 */

/**
 * Tentukan keadaan badge dari jawaban server.
 *
 * @param {object} data  jawaban dari /api/ci/status
 * @returns {{ jenis: string, label: string, keterangan: string|null }}
 */
export function keadaanBadge(data) {
  if (!data?.ok) {
    return {
      jenis: 'tidak-tersedia',
      label: 'Status CI tidak tersedia',
      keterangan: data?.pesan ?? 'Tidak bisa mengambil data dari GitHub.',
    };
  }

  // ── MASIH BERJALAN DIBEDAKAN DARI GAGAL ────────────────────────────────────
  // `conclusion` bernilai null saat workflow masih jalan. Memperlakukannya
  // sebagai kegagalan akan menampilkan "gagal" untuk build yang sedang bekerja.
  if (data.status !== 'completed') {
    return {
      jenis: 'berjalan',
      label: 'Pipeline sedang berjalan',
      keterangan: `Run #${data.nomor} sedang dijalankan.`,
    };
  }

  if (data.kesimpulan === 'success') {
    return {
      jenis: 'lulus',
      label: 'Pipeline lulus',
      keterangan: null,
    };
  }

  if (data.kesimpulan === 'cancelled') {
    return {
      jenis: 'dibatalkan',
      label: 'Pipeline dibatalkan',
      keterangan: 'Run ini dihentikan sebelum selesai — bukan kegagalan tes.',
    };
  }

  return {
    jenis: 'gagal',
    label: 'Pipeline gagal',
    keterangan: 'Build terakhir tidak lulus. Detailnya ada di GitHub Actions.',
  };
}

/** "3 menit lalu" lebih berguna daripada jam persisnya. */
export function sejak(waktuIso, sekarang = Date.now()) {
  if (!waktuIso) return null;
  const t = Date.parse(waktuIso);
  if (!Number.isFinite(t)) return null;

  const selisih = sekarang - t;
  if (selisih < 60_000) return 'baru saja';
  if (selisih < 3_600_000) return `${Math.floor(selisih / 60_000)} menit lalu`;
  if (selisih < 86_400_000) return `${Math.floor(selisih / 3_600_000)} jam lalu`;
  return `${Math.floor(selisih / 86_400_000)} hari lalu`;
}

/** "56 detik" atau "2 menit 5 detik". */
export function durasi(detik) {
  if (detik == null) return null;
  if (detik < 60) return `${detik} detik`;
  const m = Math.floor(detik / 60);
  const s = detik % 60;
  return s ? `${m} menit ${s} detik` : `${m} menit`;
}

/** Bagian rincian yang ditampilkan di bawah label. */
export function bagianRincian(data, sekarang = Date.now()) {
  if (!data?.ok) return [];

  const bagian = [];
  if (data.nomor) bagian.push(`run #${data.nomor}`);
  if (data.commit) bagian.push(data.commit);

  const d = durasi(data.durasiDetik);
  if (d) bagian.push(d);

  const s = sejak(data.selesaiAt ?? data.mulaiAt, sekarang);
  if (s) bagian.push(s);

  return bagian;
}
