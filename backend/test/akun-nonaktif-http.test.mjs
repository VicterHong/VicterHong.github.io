/**
 * Uji end-to-end: akun nonaktif ditolak lewat HTTP sungguhan.
 *
 * ── KENAPA TERPISAH DARI TES UNIT ───────────────────────────────────────────
 * Tes unit memanggil handler langsung. Itu tidak membuktikan bahwa server
 * benar-benar TIDAK memasang cookie sesi, atau bahwa urutan lapisan HTTP
 * (Turnstile, CORS, rate limit) tidak menelan galat status.
 *
 * ── KENAPA SERVER DIJALANKAN DI DALAM PROSES INI ────────────────────────────
 * Turnstile memanggil Cloudflare lewat `fetch`. Kalau server dijalankan sebagai
 * proses anak, stub `fetch` di proses tes tidak berlaku, dan setiap request
 * ditolak 503 `secret_kosong` sebelum mencapai gerbang status akun — tes akan
 * hijau karena alasan yang salah.
 *
 * Dengan server di proses yang sama, `fetch` bisa di-stub sehingga verifikasi
 * Turnstile selalu lolos tanpa jaringan. Server tetap mendengarkan port
 * sungguhan, jadi request melewati seluruh lapisan HTTP.
 *
 * Database produksi TIDAK disentuh: DB_PATH menunjuk ke salinan di /tmp.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SUMBER = resolve(process.env.HOME, '.portfolio-token/tokens.db');
const SALINAN = `/tmp/uji-http-status-${randomBytes(4).toString('hex')}.db`;
const PORT = 18000 + Math.floor(Math.random() * 900);
const BASIS = `http://127.0.0.1:${PORT}`;

const EMAIL_NONAKTIF = 'http-nonaktif@contoh.invalid';
const EMAIL_TENGGANG = 'http-tenggang@contoh.invalid';
const SANDI = 'Sandi-uji-http-yang-kuat-987!';

let siap = false;
let serverHttp = null;
let fetchSemula = null;

before(async () => {
  if (!existsSync(SUMBER)) return;

  copyFileSync(SUMBER, SALINAN);
  for (const akhiran of ['-wal', '-shm']) {
    if (existsSync(SUMBER + akhiran)) copyFileSync(SUMBER + akhiran, SALINAN + akhiran);
  }

  // Konfigurasi HARUS diset sebelum modul config dimuat.
  process.env.DB_PATH = SALINAN;
  process.env.PORT = String(PORT);
  process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
  process.env.TURNSTILE_SITE_KEY = '';
  process.env.TURNSTILE_HOSTNAMES = '';

  // Stub verifikasi Turnstile: selalu lolos, tanpa jaringan.
  fetchSemula = globalThis.fetch;
  const fetchAsli = globalThis.fetch;
  globalThis.fetch = async (url, opsi) => {
    if (String(url).includes('challenges.cloudflare.com')) {
      return new Response(
        JSON.stringify({ success: true, hostname: 'example.com', action: '' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return fetchAsli(url, opsi);
  };

  const { openDb, closeDb, getDb } = await import('../src/db.mjs');
  const { config } = await import('../src/config.mjs');
  const { siapkanTabelPengguna, buatPengguna } = await import('../src/users.mjs');
  const { siapkanTabelIdentitas } = await import('../src/auth-identities.mjs');
  const { issueToken } = await import('../src/tokens.mjs');

  openDb(SALINAN);
  siapkanTabelPengguna();
  siapkanTabelIdentitas();

  for (const [email, status] of [[EMAIL_NONAKTIF, 'nonaktif'], [EMAIL_TENGGANG, 'menunggu_hapus']]) {
    if (getDb().prepare('SELECT id FROM users WHERE email = ?').get(email)) continue;
    const token = issueToken({
      secret: config.secret, projectSlug: 'mina', label: email,
      issuedTo: email, issuedBy: 'uji-http', tier: 'standard',
    });
    const user = await buatPengguna({
      email, nama: 'Akun Uji HTTP', perusahaan: '', sandi: SANDI, tokenId: token.id,
    });
    getDb().prepare('UPDATE users SET status = ?, dihapus_pada = ? WHERE id = ?')
      .run(status, status === 'menunggu_hapus' ? Date.now() : null, user.id);
  }

  const { initRoutes } = await import('../src/routes.mjs');
  initRoutes();
  const { requestHandler } = await import('../src/server.mjs');

  serverHttp = createServer((req, res) => requestHandler(req, res));
  await new Promise((lanjut) => serverHttp.listen(PORT, '127.0.0.1', lanjut));
  siap = true;
});

after(async () => {
  if (serverHttp) await new Promise((lanjut) => serverHttp.close(lanjut));
  if (fetchSemula) globalThis.fetch = fetchSemula;
  try { const { closeDb } = await import('../src/db.mjs'); closeDb(); } catch { /* sudah tertutup */ }
  for (const akhiran of ['', '-wal', '-shm']) {
    try { rmSync(SALINAN + akhiran, { force: true }); } catch { /* abaikan */ }
  }
});

async function masuk(email, sandi = SANDI) {
  const r = await fetch(`${BASIS}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, sandi, 'cf-turnstile-response': 'token-uji' }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body, setCookie: r.headers.getSetCookie?.() ?? [] };
}

const adaCookieSesi = (daftar) =>
  daftar.some((c) => c.startsWith('portfolio_session=') && !c.startsWith('portfolio_session=;'));

test('HTTP: akun nonaktif ditolak 403 dan TIDAK menerima cookie sesi', async (t) => {
  if (!siap) return t.skip('database produksi tidak tersedia');

  const hasil = await masuk(EMAIL_NONAKTIF);

  assert.equal(hasil.status, 403, `harus 403, dapat ${hasil.status} (${hasil.body?.error})`);
  assert.equal(hasil.body?.error, 'akun_nonaktif');
  assert.equal(adaCookieSesi(hasil.setCookie), false, 'tidak boleh ada cookie sesi pada penolakan');
});

test('HTTP: akun menunggu hapus ditolak 403 dengan info masa tenggang', async (t) => {
  if (!siap) return t.skip('database produksi tidak tersedia');

  const hasil = await masuk(EMAIL_TENGGANG);

  assert.equal(hasil.status, 403, `harus 403, dapat ${hasil.status} (${hasil.body?.error})`);
  assert.equal(hasil.body?.error, 'menunggu_hapus');
  assert.equal(hasil.body?.menunggu_hapus, true);
  assert.ok(Number(hasil.body?.sisa_hari) >= 0, 'sisa_hari harus angka');
  assert.equal(adaCookieSesi(hasil.setCookie), false, 'tidak boleh ada cookie sesi pada penolakan');
});

test('HTTP: sandi salah pada akun nonaktif TIDAK membocorkan status akun', async (t) => {
  if (!siap) return t.skip('database produksi tidak tersedia');

  const hasil = await masuk(EMAIL_NONAKTIF, 'sandi-yang-salah-sekali');

  // Pesan harus sama dengan akun yang tidak ada — bukan "akun dinonaktifkan".
  assert.equal(hasil.body?.error, 'kredensial_salah');
  assert.notEqual(hasil.body?.error, 'akun_nonaktif');
});
