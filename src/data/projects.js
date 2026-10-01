/**
 * Data portofolio — SATU sumber kebenaran.
 *
 * Semua isi di sini diambil dari repo GitHub yang benar-benar ada (README, metadata,
 * jumlah tes). Tidak ada proyek karangan, tidak ada angka yang dibulatkan ke atas:
 * portofolio yang menyebut "231 tests" harus bisa dibuktikan dengan membuka reponya.
 *
 * Kalau sebuah angka berubah di repo, ubah di sini — dan hanya di sini.
 */

export const profile = {
  name: 'Victer',
  handle: 'VicterHong',
  role: 'Automation & self-hosted tools developer',
  tagline: 'Saya membangun alat otomasi yang membuat perangkat lama berguna kembali.',
  bio: [
    'Saya membuat perangkat lunak yang berjalan di tempat Anda sendiri — tanpa langganan, tanpa cloud wajib, dan tetap hidup di laptop 2 GB RAM.',
    'Fokus saya: sistem yang hemat sumber daya, keamanan yang serius (bukan tempelan), dan alat yang benar-benar dipakai sehari-hari.',
  ],
  location: 'Indonesia',
  links: {
    github: 'https://github.com/VicterHong',
    kofi: 'https://ko-fi.com/victer',
    saweria: 'https://saweria.co/victer',
  },
};

/**
 * Proyek unggulan. `metrics` hanya berisi angka yang bisa diverifikasi dari repo.
 */
export const projects = [
  {
    slug: 'mina',
    featured: true,
    name: 'MINA',
    subtitle: 'Remote Control for Your Home Machine',
    summary: 'Kendalikan komputer rumah dari Telegram, Discord, atau HTTP apa pun — shutdown, wake-on-LAN, buka aplikasi, dashboard langsung. Berjalan di laptop 2–4 GB RAM dalam ~25 MB.',
    problem: 'Perangkat lama sering dianggap sampah karena tidak sanggup menjalankan alat modern. Padahal dengan desain yang hemat, ia masih bisa jadi server pribadi yang berguna.',
    highlights: [
      {
        title: 'Keamanan sejak desain',
        detail: 'Token bearer + HMAC-SHA256 di setiap permintaan, proteksi replay (jendela 5 menit), allowlist perintah yang ketat, batas laju per aksi, dan shell=False di mana pun. Tidak ada eksekusi shell bebas — selamanya.',
      },
      {
        title: 'Hemat sumber daya',
        detail: 'Berjalan di ~25 MB RSS dengan batas memori 100 MB. Fitur berat (otomasi GUI) dimatikan sendiri saat RAM menipis, dengan circuit breaker agar tidak memaksa.',
      },
      {
        title: 'Web UI tanpa framework',
        detail: 'UI admin bawaan (hanya stdlib): setup awal, login, generator kredensial dengan tampilan sekali, dashboard. Tanpa Django, tanpa Flask, tanpa Node.',
      },
      {
        title: 'Lintas platform',
        detail: 'Windows, Linux, macOS. Manajemen daya, kontrol GUI, dan eksekusi skrip menyesuaikan diri per platform.',
      },
      {
        title: 'Wake-on-LAN bawaan',
        detail: 'Bangunkan perangkat berdasarkan nama dari registri, atau MAC mentah.',
      },
    ],
    metrics: [
      { label: 'tes otomatis', value: '231' },
      { label: 'RAM saat jalan', value: '~25 MB' },
      { label: 'lisensi', value: 'MIT' },
    ],
    stack: ['Python', 'HMAC-SHA256', 'stdlib only', 'Telegram', 'Discord'],
    repo: 'https://github.com/VicterHong/mina-remote-control',
    accent: 'amina',
  },
  {
    slug: 'spareparts',
    name: 'Spareparts Inventory System',
    subtitle: 'Inventory & logistik untuk suku cadang alat berat',
    summary: 'Sistem inventaris otomatis: FastAPI + PostgreSQL + Docker + n8n + bot Telegram. Menggantikan pencatatan manual dengan alur yang bisa diaudit.',
    problem: 'Pencatatan suku cadang secara manual mudah hilang dan sulit ditelusuri saat dibutuhkan.',
    highlights: [
      { title: 'API + database', detail: 'FastAPI di atas PostgreSQL, dijalankan lewat Docker agar penyiapan konsisten.' },
      { title: 'Otomasi alur kerja', detail: 'n8n menghubungkan kejadian stok dengan notifikasi dan tindakan lanjutan.' },
      { title: 'Bot Telegram', detail: 'Tim bisa mengecek dan memperbarui stok tanpa membuka aplikasi terpisah.' },
    ],
    metrics: [],
    stack: ['FastAPI', 'PostgreSQL', 'Docker', 'n8n', 'Telegram'],
    repo: 'https://github.com/VicterHong/spareparts-inventory-system',
    accent: 'parts',
  },
  {
    slug: 'whatsapp-bot',
    name: 'WhatsApp Family Assistant',
    subtitle: 'Bot grup keluarga yang reaktif dan aman',
    summary: 'Bot WhatsApp untuk grup keluarga: hanya menjawab saat dipanggil, dengan kontrol anti-ban berlapis, memori percakapan per grup, dan penjagaan privasi.',
    problem: 'Bot grup biasanya berisik dan rawan diblokir. Yang ini dirancang untuk diam sampai dipanggil, dan tahan lama.',
    highlights: [
      { title: 'Reaktif, bukan berisik', detail: 'Hanya menjawab saat disebut atau dibalas. Tidak pernah menyela percakapan.' },
      { title: 'Anti-ban berlapis', detail: '14 kelas kontrol: ritme manusia, batas laju, jam tenang, dan pemantau kesehatan yang menjeda sendiri saat ada dorongan dari server.' },
      { title: 'Memori per grup', detail: 'Riwayat percakapan tersimpan per grup, tidak bocor antar grup, dengan pemulihan otomatis saat berkas rusak.' },
      { title: 'Privasi dijaga', detail: 'Kunci sesi tidak pernah ditulis ke log — dua lapis penjaga mencegahnya bocor.' },
    ],
    metrics: [
      { label: 'tes otomatis', value: '1045' },
      { label: 'kelas anti-ban', value: '14' },
    ],
    stack: ['Node.js', 'Baileys', 'JSONL', 'systemd'],
    repo: 'https://github.com/VicterHong/whatsapp-family-bot',
    accent: 'wa',
  },
];

/**
 * Proyek pendukung — disebut singkat, tanpa halaman detail.
 */
export const sideProjects = [
  { name: 'Monitoring', description: 'Pemantauan bandwidth yang mengalirkan statistik jaringan ke Firebase.', stack: ['Python'], repo: 'https://github.com/VicterHong/Monitoring' },
  { name: 'EFMS Fintech', description: 'Sistem manajemen keuangan perusahaan.', stack: ['TypeScript'], repo: 'https://github.com/VicterHong/efms-fintech' },
  { name: 'Daftar Hadir', description: 'Aplikasi absensi berbasis web dengan Firebase.', stack: ['HTML', 'Firebase'], repo: 'https://github.com/VicterHong/Daftar-Hadir' },
  { name: 'jsloop', description: 'Contoh perulangan JavaScript, ditulis dalam Bahasa Indonesia.', stack: ['JavaScript'], repo: 'https://github.com/VicterHong/jsloop' },
  { name: 'strktrdata', description: 'Contoh struktur data JavaScript, ditulis dalam Bahasa Indonesia.', stack: ['JavaScript'], repo: 'https://github.com/VicterHong/strktrdata' },
];

/**
 * Prinsip kerja — dipakai di bagian "Cara saya bekerja".
 * Ditulis sebagai keyakinan yang bisa dipertanggungjawabkan, bukan slogan.
 */
export const principles = [
  {
    title: 'Hemat itu fitur',
    body: 'Perangkat lunak yang berjalan di 25 MB RAM bisa hidup di mesin yang tidak sanggup menjalankan alternatifnya. Keterbatasan memori memaksa keputusan desain yang lebih baik.',
  },
  {
    title: 'Keamanan bukan tempelan',
    body: 'HMAC di setiap permintaan, allowlist yang ketat, shell=False. Kalau sebuah alat bisa mematikan komputer Anda, ia harus dibangun seolah ada orang yang mencoba menyalahgunakannya.',
  },
  {
    title: 'Bisa dibuktikan',
    body: '231 tes, 1045 tes. Angka di portofolio ini bisa Anda periksa sendiri dengan membuka repositorinya.',
  },
  {
    title: 'Tanpa ketergantungan berlebih',
    body: 'Web UI MINA hanya memakai stdlib. Bot keluarga memakai JSONL, bukan basis data yang butuh dependensi native. Lebih sedikit bagian yang bisa rusak.',
  },
];

/**
 * Angka ringkas untuk bagian pembuka. Dihitung dari data di atas — bukan diketik manual.
 */
export function stats() {
  const all = [...projects, ...sideProjects];
  const testTotal = projects
    .flatMap((p) => p.metrics)
    .filter((m) => m.label.includes('tes'))
    .reduce((sum, m) => sum + Number(m.value.replace(/\./g, '')), 0);
  return {
    projects: all.length,
    featured: projects.filter((p) => p.featured).length,
    tests: testTotal,
    stacks: new Set(all.flatMap((p) => p.stack)).size,
  };
}
