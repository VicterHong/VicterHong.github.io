/**
 * RUTE AREA KLIEN — daftar proyek, kuota token, klaim star.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA RUTE INI TERPISAH DARI auth-routes.mjs
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `auth-routes.mjs` mengurus IDENTITAS: siapa kamu, bagaimana kamu masuk,
 * bagaimana kamu keluar. Ia sudah 1400+ baris dan menangani 5 provider OAuth,
 * passkey, SSO, dan 2FA.
 *
 * Rute di sini mengurus HAL YANG BOLEH KAMU LAKUKAN setelah kamu masuk. Itu
 * pertanyaan yang berbeda, dan mencampurnya membuat berkas identitas ikut
 * berubah setiap kali aturan langganan berubah.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SETIAP RUTE DI SINI BUTUH LOGIN — TANPA KECUALI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Tidak ada satu pun rute di berkas ini yang boleh diakses tanpa sesi. Karena
 * itu pemeriksaannya dilakukan di SATU tempat (`wajibMasuk`) dan setiap rute
 * memanggilnya lebih dulu — bukan diperiksa ulang satu per satu dengan cara
 * yang bisa berbeda.
 */


import { getDb, now } from './db.mjs';
import { sendJson, readBody, clientIp, parseCookies } from './http-util.mjs';
import { validateAccountSession as validateSession } from './sessions.mjs';
import { tokenProblem, issueToken } from './tokens.mjs';
import { cariPengguna } from './users.mjs';
import { config } from './config.mjs';
import { projectDetails } from './project-details.mjs';
import { metrikProyek, catatanMetrik } from '../../assets/js/data/metrik.js';
import { alurProyek, JENIS_LANGKAH } from '../../assets/js/data/alur.js';
import { contohParts, contohMovements } from '../../assets/js/data/sandbox.js';

/**
 * Nama cookie sesi. Sama dengan yang dipakai auth-routes.mjs.
 *
 * ── KENAPA DITULIS DI SINI, BUKAN DIIMPOR ─────────────────────────────────
 * Konstanta itu tidak diekspor dari auth-routes.mjs. Mengekspornya berarti
 * mengubah berkas 1400 baris hanya untuk satu string.
 *
 * Risikonya: kalau nama cookie di sana berubah dan di sini tidak, sesi tidak
 * terbaca. Untuk itu ada tes yang memeriksa kedua berkas menyebut nama yang
 * sama — lihat test/klien-routes.test.mjs.
 */
const COOKIE_SESI = 'portfolio_session';
import { listProjects } from './projects.mjs';
import { recordEvent } from './audit.mjs';
import {
  paketPengguna,
  keadaanKuota,
  pakaiKuota,
  sudahKlaimBonus,

  keadaanMetrik,
  periksaAksesMetrik,
  daftarProyekDenganAkses,
  ringkasanAkun,
} from './akses-proyek.mjs';
import { verifikasiStar, usernameSah } from './star-github.mjs';
import { pesanTolak, PAKET_BERBAYAR } from './langganan.mjs';

/**
 * Ambil pengguna dari sesi. Mengembalikan `null` kalau belum masuk.
 *
 * ── BUG YANG DIPERBAIKI: JALUR SESI SALAH ──────────────────────────────────
 * Versi pertama membaca `sessions.user_id` — kolom itu TIDAK ADA. Tabel
 * `sessions` terhubung ke pengguna lewat `token_id` → `tokens.issued_to`
 * → `users.email`. Query pertama akan gagal dengan "no such column", dan
 * SELURUH rute area klien akan menjawab 500.
 *
 * Sekarang memakai jalur yang sama dengan halaman profil:
 *   cookie → validateSession() → tokenRow → cariPengguna(issued_to)
 *
 * ── KENAPA MEMAKAI validateSession(), BUKAN MEMBACA COOKIE SENDIRI ────────
 * `validateSession()` memeriksa TANDA TANGAN cookie, bukan hanya isinya.
 * Cookie yang dibuat sendiri oleh penyerang (berisi ID sesi karangan) akan
 * ditolak, karena tanda tangannya tidak cocok dengan `config.secret`.
 *
 * Kalau saya membaca cookie mentah dan langsung mencari ID-nya di database,
 * cookie palsu dengan ID yang kebetulan cocok akan diterima. Tanda tangan itu
 * yang membuat pemalsuan tidak mungkin — bukan rahasianya ID.
 */
function penggunaDariRequest(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_SESI] ?? '';
  if (!sessionId) return null;

  const hasil = validateSession(sessionId, config.secret);
  if (!hasil) return null;

  // Token yang dicabut atau kedaluwarsa tidak boleh memberi akses, walau
  // sesinya masih ada di database.
  if (tokenProblem(hasil.tokenRow)) return null;

  const pengguna = cariPengguna(hasil.tokenRow.issued_to);
  if (!pengguna) return null;
  if (pengguna.status !== 'aktif') return null;

  return { id: pengguna.id, email: pengguna.email, nama: pengguna.nama };
}

/** Bungkus handler: tolak kalau belum masuk, teruskan pengguna kalau sudah. */
function wajibMasuk(handler) {
  return async (req, res, params, url) => {
    const pengguna = penggunaDariRequest(req);
    if (!pengguna) {
      return sendJson(res, 401, { ok: false, error: 'belum_masuk' });
    }
    return handler(req, res, params, url, pengguna);
  };
}

/** Profil ringkas proyek untuk halaman daftar — tanpa data internal. */
function proyekPublik() {
  return listProjects().map((p) => ({
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle || '',
    summary: p.summary || '',
    stack: Array.isArray(p.stack) ? p.stack : [],
    metrics: projectDetails(p.slug)?.metrics ?? [],
  }));
}

// ── RUTE ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/klien/ringkasan
 *
 * Satu panggilan yang mengembalikan semua yang dibutuhkan halaman area klien:
 * paket, kuota, bonus star, dan status trial.
 *
 * ── KENAPA SATU PANGGILAN ──────────────────────────────────────────────────
 * Halaman ini menampilkan tiga hal yang saling bergantung. Kalau diambil lewat
 * tiga permintaan, ada saat di mana halaman menampilkan kombinasi yang tidak
 * mungkin — misalnya "paket: gratis" dengan "sisa token: 5", karena permintaan
 * paket sudah selesai tapi kuota belum.
 */
const ruteRingkasan = {
  method: 'GET',
  pattern: '/api/klien/ringkasan',
  handler: wajibMasuk(async (req, res, _params, _url, pengguna) => {
    const ringkas = ringkasanAkun(pengguna.id);
    return sendJson(res, 200, {
      ok: true,
      nama: pengguna.nama,
      email: pengguna.email,
      ...ringkas,
      // Pesan siap-tampil untuk keadaan yang menghalangi, supaya kalimatnya
      // tidak ditulis ulang di JavaScript halaman (dan bisa berbeda).
      pesan: {
        tanpaToken: ringkas.berbayar ? null : pesanTolak('bukan-langganan'),
        kuotaHabis: ringkas.kuota.bolehBuat ? null : pesanTolak('kuota-habis', ringkas.kuota),
      },
    });
  }),
};

/**
 * GET /api/klien/proyek
 *
 * Daftar proyek + status akses per pengguna.
 *
 * Data metrik HANYA ikut kalau statusnya terbuka. Yang terkunci tidak dikirim
 * sama sekali — menyembunyikannya di CSS berarti datanya tetap ada di jaringan.
 */
const ruteDaftarProyek = {
  method: 'GET',
  pattern: '/api/klien/proyek',
  handler: wajibMasuk(async (req, res, _params, _url, pengguna) => {
    const daftar = daftarProyekDenganAkses(pengguna.id, proyekPublik());
    return sendJson(res, 200, { ok: true, proyek: daftar });
  }),
};

/**
 * GET /api/klien/proyek/:slug/metrik
 *
 * Data metrik satu proyek — dengan pemeriksaan akses.
 *
 * ── KENAPA TETAP DIPERIKSA, PADAHAL /proyek SUDAH MENYARING ────────────────
 * Endpoint ini bisa dipanggil langsung, tanpa lewat halaman daftar. Kalau
 * pemeriksaannya hanya ada di daftar, siapa pun yang tahu URL-nya bisa
 * mengambil data metrik proyek yang terkunci.
 *
 * Pemeriksaan ada di SETIAP endpoint yang mengembalikan data terbatas —
 * halaman hanya menampilkan hasilnya.
 */
const ruteMetrikProyek = {
  method: 'GET',
  pattern: '/api/klien/proyek/:slug/metrik',
  handler: wajibMasuk(async (req, res, params, _url, pengguna) => {
    const slug = params.slug;
    const proyek = proyekPublik().find((p) => p.slug === slug);
    if (!proyek) {
      return sendJson(res, 404, { ok: false, error: 'proyek_tidak_ditemukan' });
    }

    const bonus = sudahKlaimBonus(pengguna.id);
    const detail = projectDetails(slug);
    if (!detail) return sendJson(res, 503, { ok: false, error: 'konten_belum_tersedia' });
    const access = keadaanMetrik(pengguna.id);
    if (req.method === 'GET' && !access.berbayar && !access.proyek.includes(slug)) {
      return sendJson(res, 403, { ok: false, error: 'proyek_belum_dibuka' });
    }
    const hasil = periksaAksesMetrik(pengguna.id, slug, { sudahStar: bonus });

    if (!hasil.boleh) {
      // 403, bukan 404: proyeknya memang ada dan publik tahu itu. Menjawab
      // 404 akan membuat pengguna mengira tautannya rusak, padahal yang
      // kurang adalah aksesnya — dan itu pesan yang berbeda.
      return sendJson(res, 403, {
        ok: false,
        error: hasil.alasan,
        pesan: pesanTolak(hasil.alasan),
      });
    }

    return sendJson(res, 200, {
      ok: true,
      slug,
      nama: proyek.name,
      metrik: detail.metrics,
      highlights: detail.highlights,
      // Ditandai supaya halaman bisa menampilkan "ini pratinjau gratis" saat
      // dibuka lewat trial — pengguna perlu tahu kenapa dia bisa melihat ini.
      lewat: hasil.alasan,
    });
  }),
};

/**
 * POST /api/klien/token
 *
 * Buat token akses baru. Memeriksa kuota, lalu memakai satu jatah.
 *
 * ── URUTAN YANG PENTING ────────────────────────────────────────────────────
 *   1. Periksa paket & kuota
 *   2. Buat tokennya
 *   3. BARU pakai jatahnya
 *
 * Kalau jatah dipakai lebih dulu (langkah 3 sebelum 2), dan pembuatan token
 * gagal, pengguna kehilangan jatahnya tanpa mendapat apa pun. Dengan urutan
 * ini, kegagalan di langkah 2 tidak menghabiskan jatah.
 */
const ruteBuatToken = {
  method: 'POST',
  pattern: '/api/klien/token',
  handler: wajibMasuk(async (req, res, _params, _url, pengguna) => {

    // Body opsional: label + proyek tujuan.
    let body = {};
    try {
      const teks = await readBody(req);
      body = teks ? JSON.parse(teks) : {};
    } catch {
      // Body kosong atau bukan JSON — token tetap bisa dibuat dengan label
      // bawaan. Menolak di sini akan menghukum pengguna yang tidak mengirim
      // body, padahal body-nya opsional.
    }

    const label = String(body.label || '').slice(0, 80).trim();
    const proyek = String(body.proyek || '').slice(0, 60).trim();
    const requestKey = body.idempotencyKey;
    if (typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(requestKey)) {
      return sendJson(res, 400, { ok: false, error: 'idempotency_wajib' });
    }

    if (proyek && !proyekPublik().some((p) => p.slug === proyek)) {
      return sendJson(res, 400, { ok: false, error: 'proyek_tidak_dikenal' });
    }

    // No await inside the reservation: quota, token and retry marker commit together.
    const db = getDb();
    let minted, kuotaBaru, paket;
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT token_id FROM token_requests WHERE user_id=? AND request_key=?')
        .get(pengguna.id, requestKey);
      if (previous) {
        db.exec('ROLLBACK');
        return sendJson(res, 409, { ok: false, error: 'token_sudah_dibuat', id: previous.token_id,
          pesan: 'Token untuk permintaan ini sudah dibuat. Buka daftar token; nilai rahasianya hanya ditampilkan sekali.' });
      }
      const kuota = keadaanKuota(pengguna.id);
      if (!kuota.bolehBuat) {
        db.exec('ROLLBACK');
        const alasan = kuota.total === 0 ? 'bukan-langganan' : 'kuota-habis';
        return sendJson(res, 403, { ok: false, error: alasan, pesan: pesanTolak(alasan, kuota), kuota });
      }
      paket = paketPengguna(pengguna.id);
      const subscription = db.prepare("SELECT selesai_at FROM langganan WHERE user_id=? AND status='aktif' ORDER BY mulai_at DESC LIMIT 1")
        .get(pengguna.id);
      const days = subscription?.selesai_at
        ? Math.min(35, (subscription.selesai_at - now()) / 86_400_000) : 35;
      minted = issueToken({ secret: config.secret, projectSlug: proyek || 'semua',
        tier: paket === 'profesional' ? 'professional' : paket === 'enterprise' ? 'enterprise' : 'standard',
        scopes: proyek ? [proyek] : listProjects().map(p => p.slug),
        label, issuedTo: pengguna.email, issuedBy: 'klien', expiresInDays: days });
      kuotaBaru = pakaiKuota(pengguna.id);
      db.prepare('INSERT INTO token_requests (user_id,request_key,token_id) VALUES (?,?,?)')
        .run(pengguna.id, requestKey, minted.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const { id, token } = minted;

    recordEvent({
      action: 'token_dibuat',
      outcome: 'sukses',
      tokenId: id,
      detail: `paket=${paket}`,
      ip: clientIp(req),
    });

    // Token MENTAH hanya dikembalikan SEKALI di sini. Yang tersimpan di
    // database hanya hash-nya — jadi kalau pengguna kehilangan tokennya,
    // kita tidak bisa menampilkannya lagi, dan itu memang disengaja.
    return sendJson(res, 201, {
      ok: true,
      token,
      id,
      label,
      proyek: proyek || null,
      kuota: kuotaBaru,
      catatan: 'Simpan token ini sekarang. Karena hanya hash-nya yang tersimpan, token tidak bisa ditampilkan lagi.',
    });
  }),
};

/**
 * GET /api/klien/token
 *
 * Daftar token milik pengguna. Token MENTAH tidak pernah ikut — hanya
 * potongan awal supaya pengguna bisa membedakan token satu dari yang lain.
 */
const ruteDaftarToken = {
  method: 'GET',
  pattern: '/api/klien/token',
  handler: wajibMasuk(async (req, res, _params, _url, pengguna) => {
    const baris = getDb().prepare(`
      SELECT id, label, project_slug, tier, issued_at, expires_at, revoked_at, status
      FROM tokens
      WHERE issued_to = ?
      ORDER BY issued_at DESC
      LIMIT 50
    `).all(pengguna.email);

    return sendJson(res, 200, {
      ok: true,
      token: baris.map((t) => ({
        id: t.id,
        label: t.label,
        proyek: t.project_slug,
        paket: t.tier,
        dibuatPada: t.issued_at,
        berakhirPada: t.expires_at,
        dicabutPada: t.revoked_at,
        status: t.revoked_at ? 'dicabut' : (t.expires_at && t.expires_at < now() ? 'kedaluwarsa' : 'aktif'),
      })),
      kuota: keadaanKuota(pengguna.id),
    });
  }),
};

/**
 * POST /api/klien/star
 *
 * Klaim bonus star. Memverifikasi ke GitHub lebih dulu.
 *
 * ── KENAPA VERIFIKASI DI SINI, BUKAN DI BROWSER ───────────────────────────
 * Browser bisa bilang "sudah diverifikasi" tanpa memeriksa apa pun. Yang
 * menentukan harus server, dan jawabannya datang dari GitHub — bukan dari
 * klien.
 */
const ruteKlaimStar = {
  method: 'POST',
  pattern: '/api/klien/star',
  handler: wajibMasuk(async (req, res, _params, _url, pengguna) => {
    if (sudahKlaimBonus(pengguna.id)) {
      return sendJson(res, 409, {
        ok: false,
        error: 'sudah_diklaim',
        pesan: 'Bonus dari star sudah pernah diklaim untuk akun ini.',
      });
    }

    let body = {};
    try {
      const teks = await readBody(req);
      body = teks ? JSON.parse(teks) : {};
    } catch {
      return sendJson(res, 400, { ok: false, error: 'body_tidak_valid' });
    }

    const username = String(body.username || '').trim();
    if (!usernameSah(username)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'username_tidak_sah',
        pesan: 'Nama pengguna GitHub hanya boleh berisi huruf, angka, dan tanda hubung.',
      });
    }

    // Existing bonus rows remain valid. New claims require a verified ownership
    // flow; a public username (even with a real star) is not proof of ownership.
    return sendJson(res, 403, { ok: false, error: 'identitas_github_belum_terverifikasi',
      pesan: 'Klaim bonus baru menunggu verifikasi kepemilikan akun GitHub. Bonus yang sudah diterima tetap berlaku.' });


  }),
};

/**
 * GET /api/klien/star
 *
 * Periksa status star TANPA mengklaim. Dipakai halaman untuk menampilkan
 * "sudah star, siap klaim" sebelum pengguna menekan tombol.
 */
const ruteCekStar = {
  method: 'GET',
  pattern: '/api/klien/star',
  handler: wajibMasuk(async (req, res, _params, _url, pengguna) => {
    const url = new URL(req.url);
    const username = url.searchParams.get('username') || '';

    if (!usernameSah(username)) {
      return sendJson(res, 400, { ok: false, error: 'username_tidak_sah' });
    }

    const hasil = await verifikasiStar(username);
    return sendJson(res, 200, {
      ok: true,
      starred: hasil.starred,
      dariCache: hasil.dariCache,
      error: hasil.error,
      sudahKlaim: sudahKlaimBonus(pengguna.id),
    });
  }),
};

/** Semua rute area klien, siap didaftarkan. */
export function ruteKlien() {
  return [
    {
      method: 'GET', pattern: '/api/klien/evidence',
      handler: wajibMasuk(async (_req, res, _params, _url, pengguna) => {
        const access = keadaanMetrik(pengguna.id);
        const owner = config.ownerEmails.includes(pengguna.email.trim().toLowerCase());
        const allowed = new Set(access.berbayar || owner ? listProjects().map(p => p.slug) : access.proyek);
        const filter = source => Object.fromEntries(Object.entries(source).filter(([slug]) => allowed.has(slug)));
        return sendJson(res, 200, { ok: true,
          metrikProyek: filter(metrikProyek), alurProyek: filter(alurProyek),
          catatanMetrik, jenisLangkah: JENIS_LANGKAH,
          sandbox: allowed.has('spareparts') ? { parts: contohParts, movements: contohMovements } : null,
        });
      }),
    },
    ruteRingkasan,
    ruteDaftarProyek,
    ruteMetrikProyek,
    { ...ruteMetrikProyek, method: 'POST' },
    ruteBuatToken,
    ruteDaftarToken,
    ruteKlaimStar,
    ruteCekStar,
  ];
}

export { penggunaDariRequest };
