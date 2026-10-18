/**
 * Tes: akun nonaktif tidak boleh mendapat sesi dari jalur mana pun.
 *
 * ── BUG YANG DITUTUP TES INI ────────────────────────────────────────────────
 * Pengguna melaporkan: setelah akunnya dinonaktifkan (menunggu hapus), ia
 * masih bisa masuk dan langsung terlempar ke beranda tanpa peringatan.
 *
 * Akarnya: `/api/auth/masuk` memeriksa status, tapi TIGA jalur lain yang juga
 * membuat sesi tidak memeriksanya sama sekali:
 *
 *   1. /api/auth/2fa          → pengguna ber-2FA selalu lewat sini
 *   2. /api/token/2fa         → jalur token lama
 *   3. callback OAuth / SSO   → masuk lewat penyedia identitas
 *
 * ── RUJUKAN INDUSTRI (perilaku yang ditiru) ─────────────────────────────────
 * Semua penyedia identitas besar memperlakukan akun nonaktif sebagai keadaan
 * TERMINAL yang dilaporkan ke pengguna, bukan kegagalan senyap:
 *
 *   • Clerk — `banUser()` mencabut SEMUA sesi dan menolak login berikutnya.
 *     https://clerk.com/docs/reference/backend/user/ban-user
 *   • Auth0 — pengguna yang diblokir dialihkan kembali dengan
 *     `error=unauthorized&error_description=user is blocked`, bukan halaman
 *     sukses. https://auth0.com/docs/manage-users/user-accounts/block-and-unblock-users
 *   • Firebase — `auth/user-disabled`: "The user account has been disabled by
 *     an administrator." https://firebase.google.com/docs/auth/admin/errors
 *   • Microsoft Entra — AADSTS50057 "The user account is disabled."
 *     https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50057-user-account-is-disabled
 *   • GitHub Enterprise — "Your account is suspended."
 *     https://docs.github.com/en/enterprise-server@3.20/admin/managing-accounts-and-repositories/managing-users-in-your-enterprise/suspending-and-unsuspending-users
 *
 * Pola yang diambil: (a) sesi dicabut saat penonaktifan, (b) setiap upaya
 * login berikutnya DITOLAK dengan pesan yang menyebut keadaan akun, (c) tidak
 * pernah ada pengalihan diam-diam ke halaman yang seolah berhasil.
 *
 * Tes ini memeriksa KETIGA jalur di tingkat sumber, karena masing-masing
 * membuat sesinya sendiri (bukan lewat satu chokepoint). Pemeriksaan sumber
 * dipilih supaya tes berjalan tanpa port, jaringan, atau TOTP sungguhan —
 * yang penting di sini adalah tidak ada jalur yang lupa memeriksa status.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const routes = readFileSync(fileURLToPath(new URL('../src/routes.mjs', import.meta.url)), 'utf8');
const authRoutes = readFileSync(fileURLToPath(new URL('../src/auth-routes.mjs', import.meta.url)), 'utf8');
const sessions = readFileSync(fileURLToPath(new URL('../src/sessions.mjs', import.meta.url)), 'utf8');

/** Potong satu blok handler berdasarkan pola awal dan penanda akhir. */
function blok(sumber, awal, akhir) {
  const i = sumber.indexOf(awal);
  assert.ok(i >= 0, `penanda awal tidak ditemukan: ${awal}`);
  const j = sumber.indexOf(akhir, i + awal.length);
  assert.ok(j > i, `penanda akhir tidak ditemukan: ${akhir}`);
  return sumber.slice(i, j);
}

test('/api/auth/2fa memeriksa status akun sebelum membuat sesi', () => {
  const isi = blok(routes, "pattern: '/api/auth/2fa'", "pattern: '/api/auth/lupa-sandi'");
  const cekStatus = isi.indexOf("user.status !== 'aktif'");
  const buatSesi = isi.indexOf('createSession({');

  assert.ok(cekStatus >= 0, '/api/auth/2fa harus memeriksa user.status');
  assert.ok(buatSesi >= 0, '/api/auth/2fa harus membuat sesi (sanity)');
  assert.ok(cekStatus < buatSesi, 'pemeriksaan status HARUS sebelum createSession');
});

test('/api/token/2fa memeriksa status pemilik token sebelum membuat sesi', () => {
  const isi = blok(routes, "pattern: '/api/token/2fa'", '// ══ AUTH: MASUK');
  const cekStatus = isi.indexOf("pemilikToken.status !== 'aktif'");
  const buatSesi = isi.indexOf('createSession({');

  assert.ok(cekStatus >= 0, '/api/token/2fa harus memeriksa status pemilik token');
  assert.ok(buatSesi >= 0, '/api/token/2fa harus membuat sesi (sanity)');
  assert.ok(cekStatus < buatSesi, 'pemeriksaan status HARUS sebelum createSession');
});

test('callback OAuth dan SSO memeriksa status sebelum membuat sesi', () => {
  // Callback provider: satu fungsi `tangani` dipakai semua provider.
  const provider = blok(authRoutes, 'const tangani = async', 'function bacaFormUrlEncoded');
  assert.ok(
    provider.indexOf('galatStatusOauth(hasil.pengguna)') < provider.indexOf('buatSesiUntuk('),
    'callback OAuth harus memeriksa status sebelum buatSesiUntuk',
  );

  // Callback SSO perusahaan.
  const sso = blok(authRoutes, "pattern: '/api/auth/sso/callback'", '// ══ RIWAYAT PEMBELIAN');
  assert.ok(
    sso.indexOf('galatStatusOauth(hasil.pengguna)') < sso.indexOf('buatSesiUntuk('),
    'callback SSO harus memeriksa status sebelum buatSesiUntuk',
  );
});

test('buatSesiUntuk menolak akun non-aktif (chokepoint fail-closed)', () => {
  const isi = blok(authRoutes, 'function buatSesiUntuk(', '  // ── GEO DISIMPAN SAAT SESI DIBUAT');
  assert.match(
    isi,
    /pengguna\?\.status !== 'aktif'[\s\S]{0,80}return null/,
    'buatSesiUntuk harus mengembalikan null untuk akun non-aktif',
  );
});

test('sesi yang sudah ada berhenti berlaku saat akun dinonaktifkan', () => {
  // validateAccountSession dipakai semua endpoint ber-sesi. Status harus
  // diperiksa di sini juga — kalau tidak, sesi lama tetap hidup setelah
  // akun dinonaktifkan, dan pengguna tidak pernah terlempar keluar.
  const isi = blok(sessions, 'export function validateAccountSession', '/**\n * Hapus sesi');
  assert.match(isi, /status\s*=\s*'aktif'/, 'validateAccountSession harus menyaring status aktif');
});
