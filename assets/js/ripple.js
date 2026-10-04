/**
 * Efek tekan tombol — gelombang (ripple) dari titik sentuh.
 *
 * Pola yang diadopsi:
 *   - Material Design 3 : gelombang muncul dari titik sentuh, bukan dari
 *                         tengah tombol. Titik asal itulah yang membuat
 *                         efeknya terasa "dari jari", bukan sekadar animasi.
 *   - Framer            : gelombang tipis dan cepat (≤0.5s) — pada produk
 *                         berkecepatan tinggi, animasi panjang terasa lambat.
 *   - Dribbble/Linear   : gelombang memakai warna teks tombol dengan opacity
 *                         sangat rendah, jadi terlihat di tombol terang
 *                         maupun gelap tanpa perlu dua set warna.
 *
 * Yang disesuaikan (bukan tiruan):
 *   - Satu modul untuk SEMUA tombol situs, bukan per-komponen.
 *   - Gelombang otomatis dilepas dari DOM setelah selesai — kalau tidak,
 *     menekan tombol 100 kali meninggalkan 100 elemen.
 *   - Menghormati prefers-reduced-motion: gelombang dilewati sama sekali.
 *   - Tombol tetap bisa diklik lewat keyboard — gelombang muncul di tengah
 *     untuk Enter/Space, karena tidak ada titik sentuh.
 */

const REDUCED_MOTION = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tombol yang mendapat efek gelombang.
 *  Sengaja daftar kelas, bukan semua elemen — supaya tautan teks biasa
 *  tidak ikut beriak (akan terasa berlebihan). */
const SELECTOR = [
  '.btn',
  '.cookie-btn',
  '.copy-btn',
  '.link-btn',
  '.chip',
  '.tab',
  '.orb-item',
  '.cookie-fab',
  '.nav-toggle',
  // Tautan di menu navigasi (panel dropdown mobile) — ini yang paling
  // sering disentuh di HP, jadi wajib punya umpan balik.
  '.site-nav a',
].join(', ');

/** Buat satu gelombang di dalam tombol. */
function spawnRipple(host, clientX, clientY) {
  const rect = host.getBoundingClientRect();
  // Radius = jarak terjauh dari titik sentuh ke sudut terjauh, supaya
  // gelombang selalu menutupi seluruh tombol (bukan berhenti di tengah
  // pada tombol lebar).
  const dx = Math.max(clientX - rect.left, rect.right - clientX);
  const dy = Math.max(clientY - rect.top, rect.bottom - clientY);
  const radius = Math.hypot(dx, dy);

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${radius * 2}px`;
  ripple.style.left = `${clientX - rect.left - radius}px`;
  ripple.style.top = `${clientY - rect.top - radius}px`;

  host.appendChild(ripple);
  // Dilepas setelah animasi selesai (0.6s) — kalau tidak, elemen
  // menumpuk setiap kali tombol ditekan.
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  // Jaring pengaman: kalau animationend tidak pernah datang (tab
  // di-latent), elemen tetap dibersihkan.
  setTimeout(() => ripple.remove(), 1000);
}

/** Pasang efek gelombang ke seluruh tombol di halaman. */
export function initRipple() {
  if (REDUCED_MOTION()) return;

  // Satu listener di document (delegasi) — tombol yang dibuat belakangan
  // (banner cookie, modal) otomatis ikut dapat efek tanpa didaftarkan ulang.
  document.addEventListener('pointerdown', (e) => {
    const host = e.target.closest(SELECTOR);
    if (!host) return;
    // Tombol nonaktif tidak boleh beriak — itu isyarat "tidak bisa ditekan".
    if (host.disabled || host.getAttribute('aria-disabled') === 'true') return;
    spawnRipple(host, e.clientX, e.clientY);
  }, { passive: true });

  // Keyboard: Enter/Space tidak punya titik sentuh, jadi gelombang
  // muncul dari tengah. Tanpa ini, pengguna keyboard tidak melihat
  // umpan balik apa pun saat menekan tombol.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const host = e.target.closest(SELECTOR);
    if (!host || host.disabled) return;
    const rect = host.getBoundingClientRect();
    spawnRipple(host, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
}
