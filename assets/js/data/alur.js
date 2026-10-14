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
export const alurProyek = {
  mina: {
    judul: 'Cara MINA menerima perintah',
    ringkas: 'Setiap perintah melewati empat pemeriksaan sebelum menyentuh sistem.',
    langkah: [
      {
        id: 'kanal',
        label: 'Telegram / Discord / HTTP',
        jenis: 'masuk',
        ringkas: 'Perintah datang dari kanal mana pun.',
        detail: 'Tiga kanal masuk ke satu handler yang sama. Tidak ada jalur khusus '
          + 'per kanal — itu berarti tidak ada kanal yang keamanannya lebih lemah '
          + 'dari yang lain.',
      },
      {
        id: 'token',
        label: 'Verifikasi token bearer',
        jenis: 'aman',
        ringkas: 'Permintaan tanpa token sah ditolak di sini.',
        detail: 'Token dibandingkan dengan timingSafeEqual — bukan === — supaya '
          + 'waktu balasannya tidak membocorkan berapa banyak karakter yang benar. '
          + 'Perbandingan biasa bisa dipakai menebak token karakter demi karakter.',
      },
      {
        id: 'hmac',
        label: 'HMAC-SHA256 + proteksi replay',
        jenis: 'aman',
        ringkas: 'Isi permintaan diperiksa utuh dan kesegarannya.',
        detail: 'Tanda tangan HMAC mengikat isi permintaan, jadi isi yang diubah '
          + 'di tengah jalan tidak lolos. Ada juga jendela waktu 5 menit: '
          + 'permintaan lama yang direkam lalu dikirim ulang akan ditolak.',
        fakta: [
          'Tanda tangan dihitung dari isi + timestamp',
          'Jendela replay 5 menit',
          'Timestamp di luar jendela ditolak sebelum HMAC dihitung — hemat CPU',
        ],
      },
      {
        id: 'allowlist',
        label: 'Allowlist perintah',
        jenis: 'aman',
        ringkas: 'Hanya perintah yang terdaftar yang boleh jalan.',
        detail: 'Daftar putih, bukan daftar hitam. Perintah baru yang muncul tidak '
          + 'otomatis diizinkan — harus ditambahkan dulu. shell=False di mana pun, '
          + 'jadi tidak ada eksekusi shell bebas.',
      },
      {
        id: 'ratelimit',
        label: 'Batas laju per aksi',
        jenis: 'aman',
        ringkas: 'Aksi berat dibatasi frekuensinya.',
        detail: 'Batasnya berbeda per aksi: shutdown dibatasi ketat, status '
          + 'dipanggil sesering apa pun. Membatasi semuanya sama ketatnya akan '
          + 'mengganggu pemakaian normal.',
      },
      {
        id: 'eksekusi',
        label: 'Eksekusi',
        jenis: 'proses',
        ringkas: 'Perintah yang lolos semua pemeriksaan dijalankan.',
        detail: 'Di titik ini perintahnya sudah terbukti: datang dari kanal yang '
          + 'sah, isinya utuh, segar, dan termasuk daftar yang diizinkan.',
      },
      {
        id: 'memori',
        label: 'Circuit breaker memori',
        jenis: 'proses',
        ringkas: 'Fitur berat dimatikan sendiri saat RAM menipis.',
        detail: 'Otomasi GUI dimatikan saat memori rendah, bukan dipaksa jalan '
          + 'sampai perangkatnya kehabisan. Ini yang membuatnya tetap hidup di '
          + 'laptop 2 GB.',
      },
    ],
  },

  spareparts: {
    judul: 'Cara Spareparts mencatat pergerakan stok',
    ringkas: 'Perubahan stok lewat satu jalur, dan rekap harian jalan sendiri.',
    langkah: [
      {
        id: 'klien',
        label: 'Browser / n8n / Postman',
        jenis: 'masuk',
        ringkas: 'Tiga cara mengakses, satu API.',
        detail: 'Operator memakai Swagger UI untuk kerja manual. n8n memakai '
          + 'endpoint yang sama untuk rekap otomatis jam 07:00. Tidak ada API '
          + 'terpisah untuk otomasi — itu berarti keduanya tidak bisa berbeda '
          + 'perilaku.',
      },
      {
        id: 'apikey',
        label: 'API key (endpoint tulis)',
        jenis: 'aman',
        ringkas: 'Endpoint tulis dan laporan dilindungi.',
        detail: 'Header X-API-Key diperiksa pada endpoint yang mengubah data. '
          + 'Endpoint baca dibiarkan terbuka untuk dashboard.',
      },
      {
        id: 'validasi',
        label: 'Validasi Pydantic v2',
        jenis: 'aman',
        ringkas: 'Bentuk data diperiksa sebelum menyentuh database.',
        detail: 'Validasi di lapisan API berarti data yang salah bentuk ditolak '
          + 'sebelum sampai ke database. Batas antara "permintaan buruk" dan '
          + '"data rusak" jadi jelas.',
      },
      {
        id: 'db',
        label: 'PostgreSQL',
        jenis: 'simpan',
        ringkas: 'Dua tabel: spare_parts dan stock_movements.',
        detail: 'Pemisahan ini yang membuat stok bisa diaudit: jumlah di '
          + 'spare_parts adalah keadaan SEKARANG, dan stock_movements adalah '
          + 'riwayat bagaimana ia sampai ke sana.',
        fakta: [
          'spare_parts — keadaan stok saat ini',
          'stock_movements — riwayat pergerakan',
          'Stok bisa dihitung ulang dari riwayat — dan itu yang membuatnya bisa dipercaya',
        ],
      },
      {
        id: 'rekap',
        label: 'Rekap harian',
        jenis: 'keluar',
        ringkas: 'Ringkasan dikirim otomatis tiap pagi.',
        detail: 'Endpoint /reports/daily menghasilkan total part, total nilai '
          + 'stok, daftar low-stock, dan pergerakan hari itu. n8n menariknya '
          + 'jam 07:00 lalu mengirim alert.',
      },
      {
        id: 'telegram',
        label: 'Alert Telegram',
        jenis: 'keluar',
        ringkas: 'Yang perlu diketahui sampai tanpa dibuka.',
        detail: 'Pemilik tidak perlu membuka dashboard untuk tahu ada stok yang '
          + 'menipis. Itu yang membuat sistemnya benar-benar dipakai — laporan '
          + 'yang harus dicari tidak akan dibaca.',
      },
    ],
  },

  sentinel: {
    judul: 'Cara Sentinel memproses webhook',
    ringkas: 'Empat pemeriksaan sebelum disimpan, lalu pengiriman dengan percobaan ulang.',
    langkah: [
      {
        id: 'luar',
        label: 'Stripe / GitHub / Telegram',
        jenis: 'masuk',
        ringkas: 'Webhook datang dari layanan luar.',
        detail: 'Masing-masing mengirim tanda tangan dengan caranya sendiri. '
          + 'Stripe di header dengan timestamp, GitHub di header, Midtrans di '
          + 'dalam body.',
      },
      {
        id: 'kenal',
        label: 'Sumber dikenal?',
        jenis: 'aman',
        ringkas: 'Tidak dikenal → 404, sama seperti URL yang tidak ada.',
        detail: 'Sumber tidak dikenal DAN sumber nonaktif dijawab sama: 404 '
          + 'dengan pesan identik. Membedakannya akan memberi tahu penyerang '
          + 'sumber mana yang terpasang — dan ia bisa menyisir nama satu per satu.',
      },
      {
        id: 'ukuran',
        label: 'Batas ukuran body',
        jenis: 'aman',
        ringkas: 'Diperiksa sebelum HMAC dihitung.',
        detail: 'Menghitung panjang string jauh lebih murah daripada menghitung '
          + 'HMAC atas 10 MB payload. Urutannya sengaja: yang murah dulu.',
      },
      {
        id: 'ttd',
        label: 'Verifikasi tanda tangan',
        jenis: 'aman',
        ringkas: 'Payload palsu ditolak SEBELUM apa pun disimpan.',
        detail: 'Ini urutan yang tidak boleh dibalik. Kalau verifikasi dilakukan '
          + 'nanti — saat pengiriman — payload palsu sudah tersimpan di antrean, '
          + 'dan database kita terisi sampah yang harus dibersihkan manual.',
        fakta: [
          'Stripe: HMAC-SHA256 + toleransi timestamp',
          'GitHub: SHA-256 (SHA-1 lama sengaja tidak diterima)',
          'Perbandingan pakai timingSafeEqual',
          'Verifikasi yang melempar → ditolak (fail-closed)',
        ],
      },
      {
        id: 'antrean',
        label: 'Antrean SQLite (WAL)',
        jenis: 'simpan',
        ringkas: 'Tersimpan permanen — tidak hilang saat layanan tujuan mati.',
        detail: 'Mode WAL berarti tulisan tidak memblokir pembacaan, dan data '
          + 'yang sudah masuk tetap ada walau service di-restart. Idempotensi '
          + 'dua lapis: ID peristiwa dari provider, plus sidik jari isi untuk '
          + 'yang tidak mengirim ID.',
      },
      {
        id: 'sirkuit',
        label: 'Sirkuit tujuan',
        jenis: 'aman',
        ringkas: 'Endpoint yang gagal beruntun diputus sementara.',
        detail: 'Diperiksa SEBELUM pesan diambil dari antrean. Kalau diperiksa '
          + 'setelah, semua pesan terlanjur terambil dan sirkuitnya tidak '
          + 'berguna — pelajaran yang didapat dari bug nyata.',
      },
      {
        id: 'kirim',
        label: 'Kirim + backoff',
        jenis: 'keluar',
        ringkas: 'Gagal? Coba lagi dengan jeda naik bertingkat.',
        detail: 'Jendela tunggu 30s → 60s → 2m → 5m → 10m → 30m, dengan jitter '
          + '20%. Jitter mencegah semua pesan dicoba pada detik yang sama.',
      },
      {
        id: 'dlq',
        label: 'DLQ',
        jenis: 'keluar',
        ringkas: 'Habis percobaan → disimpan, BUKAN dihapus.',
        detail: 'Pesan DLQ justru yang paling perlu disimpan: itu bukti ada yang '
          + 'salah, dan mungkin perlu dikirim ulang setelah diperbaiki. '
          + 'Menghapusnya berarti membuang satu-satunya jejaknya.',
      },
    ],
  },
};

/**
 * Warna tiap jenis langkah.
 *
 * ── KENAPA JENIS, BUKAN WARNA PER LANGKAH ───────────────────────────────────
 * Warna per langkah berarti delapan keputusan warna terpisah yang harus dijaga
 * konsisten. Sebagai jenis, ada empat keputusan — dan langkah baru otomatis
 * mendapat warna yang benar.
 */
export const JENIS_LANGKAH = {
  masuk: { label: 'Masuk', kelas: 'masuk' },
  aman: { label: 'Keamanan', kelas: 'aman' },
  proses: { label: 'Proses', kelas: 'proses' },
  simpan: { label: 'Penyimpanan', kelas: 'simpan' },
  keluar: { label: 'Keluar', kelas: 'keluar' },
};
