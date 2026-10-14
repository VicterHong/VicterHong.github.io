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
export const metrikProyek = {
  mina: {
    ringkas: 'Daemon Python yang berjalan di laptop 2–4 GB RAM.',
    metrik: [
      {
        label: 'Tes otomatis',
        nilai: '231',
        jenis: 'klaim-repo',
        sumber: 'README repo, bagian Tests: python3 -m pytest tests/ -q',
      },
      {
        label: 'Baris kode Python',
        nilai: '5.042',
        jenis: 'terukur',
        sumber: 'find . -name "*.py" -not -path "./.git/*" -exec cat {} + | wc -l',
      },
      {
        label: 'Berkas modul',
        nilai: '7',
        jenis: 'terukur',
        sumber: 'find . -name "*.py" -not -path "*/test*" | wc -l',
      },
      {
        label: 'Pemakaian memori',
        nilai: '~25 MB',
        jenis: 'klaim-repo',
        sumber: 'README: "Runs in ~25 MB RSS with a 100 MB memory cap"',
      },
      {
        label: 'Berkas uji',
        nilai: '6',
        jenis: 'terukur',
        sumber: 'find . -path "*/test*" -name "*.py" | wc -l',
      },
    ],
    commit: 'f77b520',
    repo: 'https://github.com/VicterHong/mina-remote-control',
  },

  spareparts: {
    ringkas: 'Sistem inventaris FastAPI + PostgreSQL dengan rekap harian otomatis.',
    metrik: [
      {
        label: 'Endpoint API',
        nilai: '11',
        jenis: 'terukur',
        sumber: 'grep -rhoE "@(app|router)\\.(get|post|put|delete|patch)\\(" --include="*.py" . | wc -l',
      },
      {
        label: 'Tabel database',
        nilai: '2',
        jenis: 'terukur',
        sumber: 'grep -rhoE "__tablename__ = .[a-z_]+" --include="*.py" .',
      },
      {
        label: 'Baris kode Python',
        nilai: '860',
        jenis: 'terukur',
        sumber: 'find . -name "*.py" -not -path "./.git/*" -exec cat {} + | wc -l',
      },
      {
        label: 'Modul router',
        nilai: '3',
        jenis: 'terukur',
        sumber: 'ls app/routers/ → parts.py, movements.py, reports.py',
      },
      {
        label: 'Berkas uji',
        nilai: '3',
        jenis: 'terukur',
        sumber: 'find . -path "*test*" -name "*.py" | wc -l',
      },
    ],
    commit: 'b743e37',
    repo: 'https://github.com/VicterHong/spareparts-inventory-system',
  },

  'whatsapp-bot': {
    ringkas: 'Bot keluarga dengan kontrol anti-ban berlapis.',
    metrik: [
      {
        label: 'Baris kode Python',
        nilai: '41',
        jenis: 'terukur',
        sumber: 'find . -name "*.py" -not -path "./.git/*" -exec cat {} + | wc -l',
      },
      {
        label: 'Berkas uji',
        nilai: '0',
        jenis: 'terukur',
        sumber: 'Tidak ada tes otomatis — dicatat apa adanya, bukan disembunyikan.',
      },
    ],
    commit: '1cb0e3c',
    repo: 'https://github.com/VicterHong/whatsapp-family-bot',
  },

  // ── PORTOFOLIO INI SENDIRI ────────────────────────────────────────────────
  // Ikut dicantumkan karena ia juga sistem yang berjalan: 847 tes, backend
  // Node tanpa framework, dan Sentinel sebagai gateway webhook.
  sentinel: {
    ringkas: 'Portofolio ini sendiri — termasuk gateway webhook Sentinel.',
    metrik: [
      {
        label: 'Tes otomatis',
        nilai: '847',
        jenis: 'terukur',
        sumber: 'cd backend && npm test — dijalankan setiap push oleh GitHub Actions',
      },
      {
        label: 'Endpoint API',
        nilai: '111',
        jenis: 'terukur',
        sumber: 'Jumlah `pattern: \'/api...\'` di backend/src/*.mjs',
      },
      {
        label: 'Tabel database',
        nilai: '40',
        jenis: 'terukur',
        sumber: 'sqlite_master di database produksi',
      },
      {
        label: 'Pemakaian memori',
        nilai: '~70 MB',
        jenis: 'terukur',
        sumber: 'ps -o rss -p $(systemctl show portfolio-token -p MainPID --value)',
      },
      {
        label: 'Dependensi runtime',
        nilai: '0',
        jenis: 'terukur',
        sumber: 'backend/package.json — hanya modul bawaan Node',
      },
    ],
    commit: 'v2.4.0',
    repo: 'https://github.com/VicterHong/VicterHong.github.io',
  },
};

/**
 * Catatan kejujuran yang ditampilkan bersama metrik.
 *
 * ── KENAPA HARUS ADA ────────────────────────────────────────────────────────
 * Daftar angka tanpa keterangan terlihat seperti pameran. Yang membuatnya
 * berguna adalah penjelasan APA yang TIDAK ada di sana — dan itu yang jarang
 * ditulis orang.
 */
export const catatanMetrik = {
  judul: 'Yang tidak ada di daftar ini',
  poin: [
    'Tidak ada metrik dampak bisnis. Saya belum punya klien yang datanya bisa dipakai, dan mengarang angkanya akan membuat semua angka lain di halaman ini tidak layak dipercaya.',
    'Tidak ada perbandingan dengan kompetitor. Saya tidak mengukur produk orang lain, jadi saya tidak punya dasar untuk membandingkan.',
    'WhatsApp Bot tidak punya tes otomatis. Itu dicatat apa adanya, bukan disembunyikan — dan itu alasan proyeknya belum saya sebut siap produksi.',
  ],
};
