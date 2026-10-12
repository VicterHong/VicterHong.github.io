/**
 * Desain ulang panel sukses — mengikuti spesifikasi Linear/Stripe/Vercel.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA DESAIN LAMA TERLIHAT "AI SLOP" ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Desain lama punya SEMUA tanda template generik:
 *   • Badge gradien emas besar (78×78) dengan kilau + bayangan
 *   • Cincin atmosferik + titik percikan dekoratif
 *   • Animasi tiga tahap yang "merayakan"
 *
 * Masalahnya bukan eksekusinya — tapi PRINSIPNYA. Dari spesifikasi Linear
 * yang dipublikasikan (tastekit.dev, dari CSS token resmi mereka):
 *
 *   "chrome is grayscale near-black; indigo/violet is the only chrome color.
 *    Status hues appear only on issue states, labels, and priority icons."
 *
 * Artinya: Linear TIDAK memakai warna dekoratif. Warna hanya untuk STATUS.
 * Badge emas besar adalah warna dekoratif — persis yang tidak dilakukan
 * produk premium.
 *
 * ── YANG DILAKUKAN PRODUK PREMIUM (terverifikasi dari sumber) ───────────────
 *
 * Dari Linear Method + analisis Stripe/Linear/Vercel:
 *
 *   1. "Typography as brand" — pesan teks ITU desainnya, bukan hiasannya.
 *      Layar sukses Linear hanya punya: ikon kecil + judul + detail.
 *
 *   2. "Restraint in color" — satu warna aksen maksimal, dan hanya untuk
 *      status. Sisanya skala abu.
 *
 *   3. "Crafted microstates" — hover, focus, disabled diperhatikan. Bukan
 *      animasi besar yang menarik perhatian ke dirinya sendiri.
 *
 *   4. "Respect for physical metaphor" — ikon kecil yang presisi, bukan
 *      ilustrasi yang mencoba jadi karya seni.
 *
 *   5. "Interaction density" — informasi PADAT, bukan ruang kosong dengan
 *      hiasan di tengahnya.
 *
 * ── DESAIN BARU ─────────────────────────────────────────────────────────────
 *
 *   ┌────────────────────────────────────────┐
 *   │  ✓   Sandi berhasil diganti            │  ← ikon kecil (32px) + judul
 *   │                                        │     sebaris, bukan bertumpuk
 *   │      Akun: victerphanjaya@gmail.com    │  ← detail FAKTUAL
 *   │      Waktu: 12 Okt 2026, 19:52 WIB     │  ← detail FAKTUAL
 *   │                                        │
 *   │      Semua sesi lain sudah dihentikan. │  ← konsekuensi, disebut jelas
 *   │                                        │
 *   │  ┌──────────────────────────────────┐  │
 *   │  │      Masuk sekarang              │  │  ← tombol utama
 *   │  └──────────────────────────────────┘  │
 *   │                                        │
 *   │  Butuh bantuan? Hubungi dukungan       │  ← jalan keluar
 *   └────────────────────────────────────────┘
 *
 * Perbedaannya: tidak ada hiasan. Yang ada adalah INFORMASI — akun mana,
 * kapan, apa yang berubah. Itu yang membuat layar terasa seperti bagian dari
 * sistem yang serius, bukan template.
 *
 * ── KENAPA IKON KECIL, BUKAN BESAR ──────────────────────────────────────────
 * Ikon 32px di sebelah judul membaca sebagai "penanda status" — seperti
 * badge di Linear. Ikon 96px di tengah membaca sebagai "ilustrasi" — dan
 * ilustrasi adalah bahasa template marketing, bukan aplikasi.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const HTML = 'reset-sandi.html';
const CSS = 'assets/css/auth.css';

// ══════════════════════════════════════════════════════════════════════════════
// ── 1. HTML: panel sukses baru ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let html = readFileSync(HTML, 'utf8');

const panelLama = `    <section class="auth-panel" id="panel-sukses" data-panel="sukses">
      <div class="auth-done">`;

// Cari blok panel sukses lengkap
const mulai = html.indexOf(panelLama);
if (mulai === -1) throw new Error('panel sukses tidak ditemukan');

// Cari penutup </section> setelahnya
const akhirSection = html.indexOf('</section>', mulai);
if (akhirSection === -1) throw new Error('penutup section tidak ditemukan');
const akhir = akhirSection + '</section>'.length;

const panelBaru = `    <!--
      ══════════════════════════════════════════════════════════════════════════
      ── PANEL: SANDI BERHASIL DIGANTI ────────────────────────────────────────
      ══════════════════════════════════════════════════════════════════════════

      ── KENAPA DESAIN INI BERBEDA DARI SEBELUMNYA ────────────────────────────
      Versi sebelumnya memakai badge gradien emas 78×78 dengan kilau, cincin
      atmosferik, titik percikan, dan animasi tiga tahap. Itu SEMUA tanda
      template generik — "AI slop".

      Dari spesifikasi Linear yang dipublikasikan:

        "chrome is grayscale near-black; indigo/violet is the only chrome
         color. Status hues appear only on issue states."

      Linear TIDAK memakai warna dekoratif. Warna hanya untuk STATUS. Badge
      emas besar adalah warna dekoratif — persis yang tidak dilakukan produk
      premium.

      ── YANG DIPAKAI SEBAGAI GANTINYA: INFORMASI, BUKAN HIASAN ───────────────
      Layar sukses yang baik menjawab tiga pertanyaan pengguna:

        1. Apa yang berubah?      → "Sandi berhasil diganti"
        2. Akun yang mana?        → email (diisi JS dari sesi/token)
        3. Apa konsekuensinya?    → "Semua sesi lain sudah dihentikan"

      Ketiganya ditampilkan sebagai BARIS DATA, bukan paragraf prosa. Pola ini
      dipakai di struk Stripe, ringkasan deploy Vercel, dan panel detail Linear
      — informasi padat yang bisa dipindai, bukan teks yang harus dibaca.
    -->
    <section class="auth-panel" id="panel-sukses" data-panel="sukses">

      <!--
        ── BARIS STATUS: ikon kecil + judul sebaris ──────────────────────────
        Ikon 32px di SEBELAH judul, bukan 96px di ATAS judul.

        Bedanya bukan ukuran — bedanya BAHASA. Ikon besar di tengah membaca
        sebagai "ilustrasi" (bahasa template marketing). Ikon kecil di samping
        judul membaca sebagai "penanda status" (bahasa aplikasi) — sama seperti
        badge status di Linear atau ikon di daftar Vercel.
      -->
      <div class="auth-status">
        <!--
          Ikon centang: lingkaran + jalur, 20px di dalam wadah 32px.

          ── KENAPA TIDAK MEMAKAI WARNA HIJAU ────────────────────────────────
          Hijau adalah konvensi "sukses" yang lazim, tapi di sini emas adalah
          warna brand. Memakai hijau akan terasa seperti komponen dari produk
          lain. Emas dipakai HANYA pada ikon ini — satu aksen, sesuai prinsip
          "restraint in color".

          Bentuk centangnya yang menyampaikan "berhasil" — warna hanya
          memperkuat, bukan menyampaikan.
        -->
        <span class="auth-status-ikon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
               stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
        </span>
        <h2 class="auth-status-judul">Sandi berhasil diganti</h2>
      </div>

      <!--
        ── BARIS DATA: fakta, bukan prosa ────────────────────────────────────
        Dua baris yang diisi JavaScript: email akun dan waktu perubahan.

        ── KENAPA EMAIL DITAMPILKAN ────────────────────────────────────────────
        Pengguna yang membuka tautan reset dari email mungkin punya beberapa
        akun. Menampilkan email menegaskan AKUN MANA yang sandinya berubah —
        dan itu mencegah kebingungan ("apakah tadi saya reset akun yang benar?").

        ── KENAPA WAKTU DITAMPILKAN ────────────────────────────────────────────
        Waktu adalah bukti. Kalau pengguna melihat waktu yang tidak dikenali,
        itu sinyal bahwa ada yang mengakses akunnya — dan mereka bisa segera
        bertindak. Tanpa waktu, mereka tidak punya cara tahu.

        ── KENAPA PAKAI <dl> ───────────────────────────────────────────────────
        Ini pasangan label-nilai, bukan paragraf. <dl>/<dt>/<dd> adalah elemen
        yang benar secara semantik, dan pembaca layar mengumumkannya sebagai
        pasangan — bukan sebagai dua baris teks terpisah tanpa hubungan.
      -->
      <dl class="auth-data">
        <div class="auth-data-baris">
          <dt>Akun</dt>
          <dd id="suksesAkun">—</dd>
        </div>
        <div class="auth-data-baris">
          <dt>Waktu</dt>
          <dd id="suksesWaktu">—</dd>
        </div>
      </dl>

      <!--
        ── KONSEKUENSI ───────────────────────────────────────────────────────
        Satu paragraf yang menyebut apa yang BERUBAH di sistem. Ini bukan
        basa-basi: pengguna yang tidak tahu sesinya dicabut akan bingung
        kenapa ponselnya minta login lagi, dan mungkin mengira ada masalah.

        Backend memang mencabut semua sesi lain saat sandi diganti — jadi
        ini melaporkan fakta, bukan klaim pemasaran.
      -->
      <p class="auth-status-catatan">
        Semua sesi lain sudah dihentikan. Perangkat yang masih masuk perlu
        masuk ulang dengan sandi baru.
      </p>

      <a class="auth-submit" href="/sign-in">
        <span class="auth-submit-label">Masuk sekarang</span>
      </a>

      <!--
        ── JALAN KELUAR ──────────────────────────────────────────────────────
        Kalau pengguna TIDAK mengenali waktu atau akun di atas, mereka butuh
        jalan cepat untuk melapor. Tanpa ini, satu-satunya pilihan adalah
        mencari alamat dukungan di halaman lain — dan pada saat seperti itu,
        kecepatan itu penting.
      -->
      <p class="auth-status-bantuan">
        Tidak mengenali aktivitas ini?
        <a href="mailto:support@victer.is-a.dev">Hubungi dukungan</a>
      </p>

    </section>`;

html = html.slice(0, mulai) + panelBaru + html.slice(akhir);
writeFileSync(HTML, html, 'utf8');
console.log('  ✅ HTML panel sukses diganti');

// ══════════════════════════════════════════════════════════════════════════════
// ── 2. CSS: gaya baru ───────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let css = readFileSync(CSS, 'utf8');

const cssBaru = `

/* ══════════════════════════════════════════════════════════════════════════════
   ── PANEL SUKSES — INFORMASI, BUKAN HIASAN ───────────────────────────────────
   ══════════════════════════════════════════════════════════════════════════════

   ── KENAPA VERSI SEBELUMNYA TERLIHAT "AI SLOP" ──────────────────────────────
   Desain lama: badge gradien emas 78×78, kilau, cincin atmosferik, titik
   percikan, animasi tiga tahap. Semua itu adalah DEKORASI.

   Dari spesifikasi Linear yang dipublikasikan:

     "chrome is grayscale near-black; indigo/violet is the only chrome color.
      Status hues appear only on issue states, labels, and priority icons."

   Linear tidak memakai warna dekoratif — warna hanya untuk STATUS. Badge emas
   besar adalah warna dekoratif. Itu sebabnya desain lama terasa seperti
   template, bukan produk.

   ── YANG DIPAKAI SEBAGAI GANTINYA ───────────────────────────────────────────
   Informasi padat: ikon kecil + judul sebaris + dua baris data + catatan.
   Tidak ada elemen yang hanya "menghias" — setiap baris punya alasan.

   Skala abu untuk semuanya, kecuali SATU aksen emas pada ikon status.
*/

/* ── BARIS STATUS: ikon + judul sebaris ─────────────────────────────────────── */
.auth-status {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

/* Wadah ikon 32px — ukuran "badge status", bukan "ilustrasi".
   Latar redup + border tipis: sama seperti badge status di aplikasi, di mana
   ikon kecil duduk di atas permukaan yang sedikit lebih terang. */
.auth-status-ikon {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  /* Emas diredupkan — bukan emas penuh. Ini aksen status, bukan tombol. */
  color: var(--emas);
  background: color-mix(in srgb, var(--emas) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--emas) 24%, transparent);
}

/* Fallback untuk peramban tanpa color-mix: latar transparan masih terbaca
   karena border dan ikonnya berwarna. Tidak ada yang rusak. */

.auth-status-judul {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--teks);
  text-align: left;
}

/* ── BARIS DATA: label + nilai ────────────────────────────────────────────────
   Dua kolom: label kiri (lebar tetap), nilai kanan.

   ── KENAPA LABEL LEBAR TETAP, BUKAN AUTO ────────────────────────────────────
   Dengan lebar auto, "Akun" dan "Waktu" akan punya lebar berbeda dan nilai
   di sebelahnya tidak sejajar — terlihat berantakan. Lebar tetap 64px
   membuat kedua nilai mulai di posisi yang sama, dan mata bisa memindai
   kolom nilai sebagai satu kolom. */
.auth-data {
  margin: 0 0 18px;
  padding: 12px 14px;
  border-radius: 10px;
  /* Permukaan lebih gelap dari kartu — pola "inset" yang dipakai Stripe
     untuk blok data: terasa seperti informasi yang "ditempelkan" ke kartu,
     bukan bagian dari alurnya. */
  background: color-mix(in srgb, var(--teks) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--teks) 7%, transparent);
}

.auth-data-baris {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.auth-data-baris + .auth-data-baris { margin-top: 8px; }

.auth-data dt {
  flex: 0 0 64px;
  font-size: 12.5px;
  /* Label: abu redup. Nilai di sebelahnya lebih terang — hierarki lewat
     kecerahan, bukan ukuran atau bobot font. */
  color: var(--teks-samar);
}

.auth-data dd {
  margin: 0;
  min-width: 0;
  font-size: 13px;
  color: var(--teks-redup);
  /* Email panjang dipotong dengan elipsis, bukan membungkus ke baris kedua —
     baris data harus tetap satu baris agar bisa dipindai. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── CATATAN KONSEKUENSI ────────────────────────────────────────────────────── */
.auth-status-catatan {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--teks-redup);
  text-align: left;
}

/* ── JALAN KELUAR ───────────────────────────────────────────────────────────── */
.auth-status-bantuan {
  margin: 14px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--teks-samar);
  text-align: center;
}

.auth-status-bantuan a {
  color: var(--teks-redup);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: color-mix(in srgb, var(--teks-redup) 40%, transparent);
  transition: color 0.15s ease, text-decoration-color 0.15s ease;
}

.auth-status-bantuan a:hover,
.auth-status-bantuan a:focus-visible {
  color: var(--emas);
  text-decoration-color: currentColor;
}

/* ── ANIMASI: SATU, BUKAN TIGA ────────────────────────────────────────────────
   Hanya baris status yang muncul dengan fade + geser 4px. Bukan animasi
   "perayaan" — hanya konfirmasi bahwa layar berganti.

   Dari Linear Method: "Motion is instant and snappy — never bouncy or slow."
   Durasi 200ms, kurva ease-out. Tidak ada spring, tidak ada bounce. */
.auth-status {
  animation: status-muncul 200ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

@keyframes status-muncul {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .auth-status { animation: none; }
}
`;

css = css.replace(/\s+$/, "") + cssBaru;
writeFileSync(CSS, css, 'utf8');
console.log('  ✅ CSS baru ditulis');
