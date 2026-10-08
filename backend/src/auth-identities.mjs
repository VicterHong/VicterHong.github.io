/**
 * Identitas tambahan untuk pengguna: OAuth, passkey, dan state sementara.
 *
 * ── KENAPA TABEL TERPISAH, BUKAN KOLOM DI `users` ────────────────────────────
 * Satu pengguna bisa punya banyak cara masuk sekaligus: sandi, passkey di
 * ponsel, passkey di laptop, Google, dan GitHub. Kolom di `users` hanya bisa
 * menampung satu nilai per jenis. Tabel `auth_identities` memberi satu baris
 * per cara masuk, sehingga:
 *
 *   - menambah passkey kedua tidak menimpa yang pertama
 *   - mencabut akses Google tidak menghapus sandi pengguna
 *   - audit bisa menjawab "akun ini bisa dimasuki lewat apa saja"
 *
 * ── KEAMANAN: KENAPA `provider_user_id` UNIK PER PROVIDER ────────────────────
 * UNIQUE(provider, provider_user_id) mencegah dua akun lokal berbeda
 * mengklaim identitas Google yang sama. Tanpa itu, penyerang bisa membuat
 * akun dengan email yang mirip lalu menyambungkan identitas yang sama.
 */

import { getDb, transaction, now } from './db.mjs';
import { randomBytes } from 'node:crypto';

// ── Skema ─────────────────────────────────────────────────────────────────────

export function siapkanTabelIdentitas() {
  getDb().exec(`
    -- ── Cara masuk yang tersambung ke akun ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS auth_identities (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL,
      jenis            TEXT NOT NULL,          -- 'oauth' | 'passkey'
      provider         TEXT NOT NULL,          -- 'google' | 'passkey' | ...
      provider_user_id TEXT NOT NULL,          -- sub di provider, atau credential id
      email            TEXT NOT NULL DEFAULT '',
      nama             TEXT NOT NULL DEFAULT '',
      avatar           TEXT NOT NULL DEFAULT '',

      -- Khusus passkey:
      kunci_publik     TEXT NOT NULL DEFAULT '',  -- SPKI DER, base64url
      alg              TEXT NOT NULL DEFAULT '',  -- 'ES256' | 'RS256'
      sign_count       INTEGER NOT NULL DEFAULT 0,
      nama_perangkat   TEXT NOT NULL DEFAULT '',

      dibuat_at        INTEGER NOT NULL,
      dipakai_terakhir INTEGER
    );

    -- Satu identitas provider hanya boleh tersambung ke satu akun.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_identitas_unik
      ON auth_identities(provider, provider_user_id);

    -- Pencarian "cara masuk apa saja milik akun ini".
    CREATE INDEX IF NOT EXISTS idx_identitas_user
      ON auth_identities(user_id);

    -- Pencarian saat login: credential id → baris.
    CREATE INDEX IF NOT EXISTS idx_identitas_cari
      ON auth_identities(jenis, provider_user_id);

    -- ── State OAuth sementara ────────────────────────────────────────────────
    -- Menyimpan state + code_verifier antara redirect dan callback.
    --
    -- Disimpan di database, bukan di cookie, karena code_verifier adalah
    -- rahasia: kalau ia ada di cookie, ia ikut terkirim di setiap request
    -- dan bisa terbaca kalau ada XSS. Di server, ia hanya dibaca sekali
    -- oleh callback.
    CREATE TABLE IF NOT EXISTS oauth_states (
      state        TEXT PRIMARY KEY,
      provider     TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      kembali_ke   TEXT NOT NULL DEFAULT '/',   -- tujuan setelah berhasil
      dibuat_at    INTEGER NOT NULL,
      kedaluwarsa  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_states_exp
      ON oauth_states(kedaluwarsa);

    -- ── Challenge WebAuthn sementara ─────────────────────────────────────────
    -- Sama alasannya dengan oauth_states: challenge harus tidak bisa
    -- ditebak, dan hanya boleh dipakai sekali.
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id         TEXT PRIMARY KEY,   -- hash challenge
      user_id    TEXT NOT NULL DEFAULT '',
      jenis      TEXT NOT NULL,      -- 'registrasi' | 'masuk'
      dibuat_at  INTEGER NOT NULL,
      kedaluwarsa INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_webauthn_exp ON webauthn_challenges(kedaluwarsa);
  `);
}

// ── State OAuth ───────────────────────────────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000; // 10 menit — cukup untuk login, pendek untuk replay

export function simpanStateOauth({ state, provider, codeVerifier, kembaliKe = '/' }) {
  const at = now();
  getDb().prepare(`
    INSERT INTO oauth_states (state, provider, code_verifier, kembali_ke, dibuat_at, kedaluwarsa)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(state, provider, codeVerifier, String(kembaliKe).slice(0, 200), at, at + STATE_TTL_MS);
}

/**
 * Ambil DAN hapus state — sekali pakai.
 *
 * Penghapusan dilakukan bersamaan dengan pembacaan dalam satu transaksi.
 * Kalau state dibiarkan, code yang sama bisa ditukar dua kali (kalau
 * provider mengizinkan), dan percobaan berulang bisa dipakai untuk
 * memetakan perilaku server.
 */
export function pakaiStateOauth(state) {
  return transaction(() => {
    const row = getDb()
      .prepare('SELECT * FROM oauth_states WHERE state = ?')
      .get(String(state || ''));

    if (!row) return null;

    getDb().prepare('DELETE FROM oauth_states WHERE state = ?').run(row.state);

    if (row.kedaluwarsa < now()) return null;

    return row;
  });
}

export function bersihkanStateOauth() {
  getDb().prepare('DELETE FROM oauth_states WHERE kedaluwarsa < ?').run(now());
}

// ── Challenge WebAuthn ────────────────────────────────────────────────────────

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function simpanChallenge({ id, userId = '', jenis }) {
  const at = now();
  getDb().prepare(`
    INSERT INTO webauthn_challenges (id, user_id, jenis, dibuat_at, kedaluwarsa)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, jenis, at, at + CHALLENGE_TTL_MS);
}

/** Ambil dan hapus challenge — sekali pakai. */
export function pakaiChallenge(id) {
  return transaction(() => {
    const row = getDb()
      .prepare('SELECT * FROM webauthn_challenges WHERE id = ?')
      .get(String(id || ''));

    if (!row) return null;
    getDb().prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(row.id);

    if (row.kedaluwarsa < now()) return null;
    return row;
  });
}

export function bersihkanChallenge() {
  getDb().prepare('DELETE FROM webauthn_challenges WHERE kedaluwarsa < ?').run(now());
}

// ── Identitas ─────────────────────────────────────────────────────────────────

/**
 * Cari identitas berdasarkan provider + id di provider.
 * Mengembalikan baris atau null.
 */
export function cariIdentitas(provider, providerUserId) {
  return getDb().prepare(`
    SELECT * FROM auth_identities
    WHERE provider = ? AND provider_user_id = ?
  `).get(provider, String(providerUserId));
}

/** Semua cara masuk milik satu akun — untuk halaman keamanan. */
export function identitasPengguna(userId) {
  return getDb().prepare(`
    SELECT id, jenis, provider, email, nama, nama_perangkat, dibuat_at, dipakai_terakhir
    FROM auth_identities WHERE user_id = ?
    ORDER BY dibuat_at ASC
  `).all(userId);
}

/**
 * Sambungkan identitas ke akun.
 *
 * Melempar kalau identitas itu sudah tersambung ke akun LAIN — pemanggil
 * harus menanganinya sebagai penolakan, bukan menimpa. Menimpa berarti
 * akun yang sudah ada kehilangan cara masuknya tanpa persetujuan pemiliknya.
 */
export function sambungkanIdentitas({
  userId, jenis, provider, providerUserId,
  email = '', nama = '', avatar = '',
  kunciPublik = '', alg = '', signCount = 0, namaPerangkat = '',
}) {
  const id = 'idn_' + randomBytes(12).toString('hex');

  getDb().prepare(`
    INSERT INTO auth_identities
      (id, user_id, jenis, provider, provider_user_id, email, nama, avatar,
       kunci_publik, alg, sign_count, nama_perangkat, dibuat_at, dipakai_terakhir)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId, jenis, provider, String(providerUserId),
    String(email).slice(0, 320), String(nama).slice(0, 200), String(avatar).slice(0, 500),
    kunciPublik, alg, signCount, String(namaPerangkat).slice(0, 100),
    now(), now(),
  );

  return id;
}

/** Catat waktu pakai terakhir + perbarui penghitung tanda tangan passkey. */
export function tandaiDipakai(identityId, signCount = null) {
  if (signCount === null) {
    getDb().prepare('UPDATE auth_identities SET dipakai_terakhir = ? WHERE id = ?')
      .run(now(), identityId);
  } else {
    getDb().prepare(`
      UPDATE auth_identities SET dipakai_terakhir = ?, sign_count = ? WHERE id = ?
    `).run(now(), signCount, identityId);
  }
}

/** Hapus satu cara masuk. Akun tetap ada — ini bukan penghapusan akun. */
export function hapusIdentitas(userId, identityId) {
  const hasil = getDb()
    .prepare('DELETE FROM auth_identities WHERE id = ? AND user_id = ?')
    .run(identityId, userId);
  return hasil.changes > 0;
}

/**
 * Berapa cara masuk yang dimiliki akun?
 *
 * Dipakai untuk mencegah pengguna mengunci dirinya sendiri: menghapus
 * passkey terakhir padahal tidak punya sandi berarti akunnya tidak bisa
 * dimasuki lagi.
 */
export function jumlahIdentitas(userId) {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = ?')
    .get(userId);
  return row?.n ?? 0;
}
