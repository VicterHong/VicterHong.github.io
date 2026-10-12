/**
 * Animasi indikator syarat sandi — gaya Cloudflare/GSAP Vault.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── REFERENSI ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Dari GSAP Vault "Password Strength Meter" (komponen produksi, diperbarui
 * September 2026):
 *
 *   "each rule in the checklist DRAWS A TICK in its circle the moment it is
 *    met and UN-DRAWS it when it is lost"
 *
 *   "the strength label beside it ROLLS UP to Weak, Fair, Good or Strong
 *    and rolls down again on the way back"
 *
 *   "status colours MUTED and used ONLY FOR STRENGTH"
 *
 *   "strength announced politely ONCE TYPING PAUSES"
 *
 * Empat detail itu yang membuat indikator terasa "hidup" alih-alih sekadar
 * berubah warna. Yang paling penting: centang DIGAMBAR (bukan muncul
 * mendadak), dan DIBATALKAN saat syarat hilang — bukan hanya hilang begitu
 * saja.
 *
 * ── KENAPA SVG STROKE, BUKAN KARAKTER ✓ ATAU ::after ────────────────────────
 *
 * Versi sebelumnya memakai `::after` dengan `border` yang dirotasi — centang
 * muncul MENDADAK tanpa animasi. Bisa dianimasikan, tapi hanya dengan
 * mengubah `opacity` atau `scale` — dan keduanya terasa "pop", bukan "digambar".
 *
 * SVG stroke-dasharray + stroke-dashoffset adalah satu-satunya cara
 * menggambar garis secara bertahap. Itu teknik yang sama dipakai GSAP Vault,
 * dan hasilnya terasa seperti tangan yang menulis centang.
 *
 * ── KENAPA TIDAK PAKAI LIBRARY (GSAP/Motion) ────────────────────────────────
 *
 * Yang dibutuhkan hanya satu animasi stroke — 20 baris CSS. Menambah GSAP
 * (50 KB) atau Motion (30 KB) untuk itu berarti seluruh halaman menanggung
 * bebannya. CSS stroke-dashoffset sudah didukung semua peramban modern
 * dan diproses compositor.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── YANG DIBUAT ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. Lingkaran syarat — SVG dengan stroke yang menggambar centang
 *   2. Meter kekuatan — 4 segmen yang menyapu masuk/keluar (GSAP Vault)
 *   3. Label kekuatan — Lemah / Cukup / Baik / Kuat
 *   4. Pengumuman pembaca layar — debounced, sekali per jeda ketik
 */

import { readFileSync, writeFileSync } from 'node:fs';

const HTML = 'reset-sandi.html';
const CSS = 'assets/css/auth.css';
const JS = 'assets/js/reset-sandi.js';

// ══════════════════════════════════════════════════════════════════════════════
// ── 1. HTML: ganti tanda centang dengan SVG + tambah meter ──────────────────
// ══════════════════════════════════════════════════════════════════════════════

let html = readFileSync(HTML, 'utf8');

const daftarLama = `        <ul class="auth-syarat" id="daftarSyarat" role="status" aria-live="polite">
          <li class="auth-syarat-item" data-syarat="panjang">
            <span class="auth-syarat-tanda" aria-hidden="true"></span>
            <span>Minimal 8 karakter</span>
          </li>
          <li class="auth-syarat-item" data-syarat="huruf">
            <span class="auth-syarat-tanda" aria-hidden="true"></span>
            <span>Huruf besar dan kecil</span>
          </li>
          <li class="auth-syarat-item" data-syarat="angka">
            <span class="auth-syarat-tanda" aria-hidden="true"></span>
            <span>Minimal satu angka</span>
          </li>
        </ul>`;

const daftarBaru = `        <!--
          ══════════════════════════════════════════════════════════════════════
          ── SYARAT SANDI + METER KEKUATAN ────────────────────────────────────
          ══════════════════════════════════════════════════════════════════════

          ── DUA BAGIAN, DUA TUGAS ─────────────────────────────────────────────
          Meter di atas menjawab "seberapa kuat?" dengan satu pandangan.
          Daftar di bawah menjawab "apa yang kurang?" dengan tepat.

          Keduanya diperlukan: meter saja membuat pengguna menebak apa yang
          harus diubah; daftar saja tidak memberi gambaran kemajuan.

          ── KENAPA METER 4 SEGMEN, BUKAN BAR MENERUS ──────────────────────────
          Bar menerus dengan gradien panjang terlihat seperti progress bar
          unggahan — bahasa visual yang salah untuk keamanan. Empat segmen
          diskret (pola GSAP Vault) terbaca sebagai "tingkat", bukan "proses".

          Setiap segmen menyapu masuk dari kiri ke kanan saat terisi, dan
          menyapu keluar dari kanan ke kiri saat kosong — arah yang berlawanan
          membuat pengosongan terasa seperti "membatalkan", bukan "mengulang".
        -->
        <div class="auth-meter" id="meterSandi" aria-hidden="true">
          <span class="auth-meter-segmen" data-isi="0"></span>
          <span class="auth-meter-segmen" data-isi="0"></span>
          <span class="auth-meter-segmen" data-isi="0"></span>
          <span class="auth-meter-segmen" data-isi="0"></span>
        </div>

        <!-- Label kekuatan — teks, bukan warna saja.
             Warna saja tidak terbaca oleh pengguna buta warna, dan "3 dari 4
             segmen" tidak bermakna apa pun tanpa label. -->
        <p class="auth-meter-label" id="labelKekuatan" aria-hidden="true"></p>

        <!--
          ── PENGUMUMAN PEMBACA LAYAR ──────────────────────────────────────────
          Terpisah dari label visual, dan aria-live="polite" — pembaca layar
          mengumumkan setelah pengguna berhenti mengetik, bukan setiap huruf.

          Kalau digabung dengan daftar syarat, setiap huruf yang diketik akan
          memicu pengumuman ulang seluruh daftar — tidak terbaca oleh manusia.
        -->
        <p class="auth-sr-only" id="kekuatanSr" role="status" aria-live="polite"></p>

        <!--
          ── DAFTAR SYARAT ─────────────────────────────────────────────────────
          Setiap tanda adalah SVG dengan lingkaran + jalur centang. Centang
          DIGAMBAR lewat stroke-dashoffset saat syarat terpenuhi, dan
          DIBATALKAN (dashoffset kembali) saat syarat hilang.

          ── KENAPA SVG, BUKAN KARAKTER ✓ ATAU ::after ─────────────────────────
          Versi sebelumnya memakai ::after dengan border yang dirotasi —
          centang muncul mendadak, tanpa animasi. SVG stroke-dashoffset
          adalah satu-satunya cara menggambar garis secara bertahap.

          ── KENAPA role="list" DI <ul> ──────────────────────────────────────
          list-style: none membuat Safari menghapus semantik daftar.
          Menambahkan role="list" secara eksplisit mengembalikannya, sehingga
          pembaca layar mengumumkan "daftar, 3 item".
        -->
        <ul class="auth-syarat" id="daftarSyarat" role="list">
          <li class="auth-syarat-item" data-syarat="panjang">
            <svg class="auth-syarat-tanda" viewBox="0 0 16 16" width="16" height="16"
                 aria-hidden="true" focusable="false">
              <circle class="auth-syarat-lingkaran" cx="8" cy="8" r="6.5" fill="none"/>
              <path class="auth-syarat-centang" d="M5 8.2l2.2 2.2L11 6" fill="none"/>
            </svg>
            <span class="auth-syarat-teks">Minimal 8 karakter</span>
          </li>
          <li class="auth-syarat-item" data-syarat="huruf">
            <svg class="auth-syarat-tanda" viewBox="0 0 16 16" width="16" height="16"
                 aria-hidden="true" focusable="false">
              <circle class="auth-syarat-lingkaran" cx="8" cy="8" r="6.5" fill="none"/>
              <path class="auth-syarat-centang" d="M5 8.2l2.2 2.2L11 6" fill="none"/>
            </svg>
            <span class="auth-syarat-teks">Huruf besar dan kecil</span>
          </li>
          <li class="auth-syarat-item" data-syarat="angka">
            <svg class="auth-syarat-tanda" viewBox="0 0 16 16" width="16" height="16"
                 aria-hidden="true" focusable="false">
              <circle class="auth-syarat-lingkaran" cx="8" cy="8" r="6.5" fill="none"/>
              <path class="auth-syarat-centang" d="M5 8.2l2.2 2.2L11 6" fill="none"/>
            </svg>
            <span class="auth-syarat-teks">Minimal satu angka</span>
          </li>
        </ul>`;

if (!html.includes(daftarLama)) {
  throw new Error('blok daftar syarat tidak ditemukan — struktur HTML berubah?');
}

html = html.replace(daftarLama, daftarBaru);
writeFileSync(HTML, html, 'utf8');
console.log('  ✅ HTML: SVG tanda centang + meter kekuatan');

// ══════════════════════════════════════════════════════════════════════════════
// ── 2. CSS: hapus gaya lama, tambah gaya baru ───────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let css = readFileSync(CSS, 'utf8');

// Hapus blok .auth-syarat lama (dari komentar "DAFTAR SYARAT SANDI" sampai
// sebelum blok berikutnya). Cari penanda awalnya.
const awalLama = css.indexOf('/* ── DAFTAR SYARAT SANDI ─');
const akhirLama = css.indexOf('/* ── PANEL GAGAL: WARNA IKON ─');

if (awalLama !== -1 && akhirLama !== -1 && akhirLama > awalLama) {
  css = css.slice(0, awalLama) + css.slice(akhirLama);
  console.log('  ✅ CSS: blok syarat lama dihapus');
} else {
  console.log('  ⚠️  CSS: blok lama tidak ditemukan — dilewati');
}

const cssBaru = `

/* ══════════════════════════════════════════════════════════════════════════════
   ── SYARAT SANDI + METER KEKUATAN ────────────────────────────────────────────
   ══════════════════════════════════════════════════════════════════════════════

   ── REFERENSI ───────────────────────────────────────────────────────────────
   Pola dari GSAP Vault "Password Strength Meter" (komponen produksi):

     "each rule in the checklist DRAWS A TICK in its circle the moment it is
      met and UN-DRAWS it when it is lost"

     "the strength label beside it ROLLS UP to Weak, Fair, Good or Strong"

     "status colours MUTED and used ONLY FOR STRENGTH"

   Tiga hal itu yang membedakan indikator yang terasa "hidup" dari yang
   sekadar berubah warna.

   ── WARNA: DIPAKAI HEMAT ────────────────────────────────────────────────────
   Hanya SATU warna status (emas, warna brand) — tidak ada hijau/kuning/merah
   bertingkat. Menurut spesifikasi Linear: "status hues appear only on issue
   states". Emas yang menyala vs abu yang redup sudah cukup menyampaikan
   "terpenuhi vs belum" — dan tidak ada yang perlu menghafal arti warna.
*/

/* ── METER KEKUATAN: 4 SEGMEN ───────────────────────────────────────────────── */
.auth-meter {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin: 12px 0 8px;
}

.auth-meter-segmen {
  position: relative;
  height: 3px;
  border-radius: 2px;
  /* Latar segmen kosong: permukaan yang sedikit lebih terang dari kartu. */
  background: color-mix(in srgb, var(--teks) 10%, transparent);
  overflow: hidden;
}

/* Isian segmen — disapu dari kiri, dikosongkan dari kanan.

   ── KENAPA PAKAI PSEUDO-ELEMENT, BUKAN background ────────────────────────────
   transform: scaleX() pada pseudo-element diproses compositor. Mengubah
   width atau background memicu layout/paint — dan itu terjadi setiap
   huruf yang diketik. */
.auth-meter-segmen::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--emas);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 260ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Terisi: menyapu masuk dari KIRI. */
.auth-meter-segmen[data-isi="1"]::after {
  transform: scaleX(1);
  transform-origin: left center;
}

/* ── KENAPA ARAH BERUBAH SAAT DIKOSONGKAN ────────────────────────────────────
   Saat terisi, transform-origin di kiri (menyapu ke kanan).
   Saat dikosongkan, origin dipindah ke kanan — jadi isian "mundur" ke kiri,
   bukan menghilang dari kanan.

   Hasilnya terasa seperti MEMBATALKAN, bukan mengulang. Detail kecil ini
   yang membuat animasinya terasa disengaja. */
.auth-meter-segmen[data-isi="0"]::after {
  transform: scaleX(0);
  transform-origin: right center;
}

/* ── LABEL KEKUATAN ─────────────────────────────────────────────────────────── */
.auth-meter-label {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--teks-samar);
  /* Tinggi minimum supaya tata letak tidak bergeser saat label muncul. */
  min-height: 18px;
  transition: color 200ms ease;
}

/* Label menyala saat sandi sudah memenuhi semua syarat. */
.auth-meter-label[data-kuat="1"] {
  color: var(--emas);
}

/* ── DAFTAR SYARAT ──────────────────────────────────────────────────────────── */
.auth-syarat {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: grid;
  gap: 8px;
}

.auth-syarat-item {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  line-height: 1.4;
  /* Abu redup (7.72:1 terhadap kartu) — lulus WCAG AA. Bukan --teks-samar
     yang hanya 4.09:1 dan gagal ambang. */
  color: var(--teks-redup);
  transition: color 200ms ease;
}

.auth-syarat-item.terpenuhi {
  color: var(--teks);
}

/* ── TANDA: SVG DENGAN STROKE YANG DIGAMBAR ─────────────────────────────────── */
.auth-syarat-tanda {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  /* SVG di dalam flex perlu ini supaya tidak menyusut di layar sempit. */
  min-width: 16px;
}

/* Lingkaran: selalu ada, warnanya berubah saat terpenuhi. */
.auth-syarat-lingkaran {
  stroke: var(--teks-samar);
  stroke-width: 1.5;
  transition: stroke 200ms ease, fill 200ms ease;
}

.auth-syarat-item.terpenuhi .auth-syarat-lingkaran {
  stroke: var(--emas);
  fill: var(--emas);
}

/* ── CENTANG: DIGAMBAR, BUKAN MUNCUL MENDADAK ─────────────────────────────────
   Teknik stroke-dasharray: garis dibuat "terputus" sepanjang dirinya sendiri,
   lalu dashoffset digeser ke 0 — hasilnya garis tergambar bertahap.

   Panjang jalur centang ≈ 8.5 unit (dihitung dari tiga titiknya). Angka
   dasharray dibulatkan ke atas (9) supaya tidak ada sisa yang terlihat. */
.auth-syarat-centang {
  stroke: var(--warna-di-atas-aksen, #0a0a0b);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 9;
  stroke-dashoffset: 9;
  transition: stroke-dashoffset 240ms cubic-bezier(0.65, 0, 0.35, 1);
}

/* Terpenuhi: centang tergambar dari awal ke ujung. */
.auth-syarat-item.terpenuhi .auth-syarat-centang {
  stroke-dashoffset: 0;
}

/* ── HANYA UNTUK PEMBACA LAYAR ──────────────────────────────────────────────── */
.auth-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── HORMATI PREFERENSI GERAKAN MINIMAL ──────────────────────────────────────
   Pengguna yang mematikan animasi tetap mendapat SEMUA informasi — centang
   tetap muncul, meter tetap terisi. Yang hilang hanya transisinya. */
@media (prefers-reduced-motion: reduce) {
  .auth-meter-segmen::after,
  .auth-syarat-centang,
  .auth-syarat-lingkaran,
  .auth-syarat-item,
  .auth-meter-label {
    transition: none;
  }
}
`;

css = css.replace(/\s+$/, "") + cssBaru;
writeFileSync(CSS, css, 'utf8');
console.log('  ✅ CSS: meter + animasi SVG ditambahkan');
console.log('');
console.log('  → Lanjut ke JS di langkah berikutnya.');
