/**
 * Uji: pelindung error `safe()` berperilaku benar.
 *
 * ── BUG YANG DICEGAH ────────────────────────────────────────────────────────
 *
 * Rute auth (auth-routes.mjs) dulu TIDAK punya pelindung sama sekali — 30
 * handler. Error server di sana jatuh ke requestHandler (server.mjs), dan
 * pembungkus itu menjawab SEMUA error sebagai HTTP 400
 * ("permintaan_tidak_valid").
 *
 * Akibatnya:
 *   • Monitoring melihat 400 (kesalahan klien) padahal itu bug server
 *   • Log tidak menandai 5xx, jadi insiden tidak terdeteksi
 *   • Debugging salah arah: mencari input buruk padahal kode yang salah
 *
 * ── CARA UJI INI BEKERJA ────────────────────────────────────────────────────
 *
 * BEHAVIORAL — bukan sekadar membaca teks sumber. `safe()` dipanggil dengan
 * handler palsu yang melempar, dan respons palsu diperiksa:
 *
 *   1. Handler melempar Error biasa         → HTTP 500 + 'kesalahan_internal'
 *   2. Handler melempar { statusCode: 400 } → HTTP 400 + pesan terbaca
 *   3. Error 5xx DICATAT ke console.error   → bisa ditelusuri
 *   4. Error 4xx TIDAK dicatat sebagai error → tidak spam log
 *   5. `url` diteruskan ke handler          → filter query tetap bekerja
 *   6. Setelah header terkirim              → tidak menulis dua kali
 *   7. `__pelindung` = true                 → audit rute bisa memverifikasi
 *
 * Uji struktural terpisah (route-url-args.test.mjs) memastikan SETIAP rute
 * auth benar-benar dibungkus.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { safe, publicError } = await import('/home/ubuntu/portfolio-victer/backend/src/http-util.mjs');

/** Respons palsu yang merekam apa yang dikirim handler. */
function responsPalsu() {
  const rekam = { status: null, body: null, headersTerkirim: false };
  return {
    rekam,
    get headersSent() { return rekam.headersTerkirim; },
    writeHead(status, headers) {
      rekam.status = status;
      rekam.headers = headers;
      rekam.headersTerkirim = true;
    },
    end(body) {
      rekam.body = body;
    },
    setHeader() { /* tidak dipakai di jalur error */ },
    destroy() { rekam.destroyed = true; },
  };
}

// ── 1. Error server → 500 ────────────────────────────────────────────────────

test('error server (Error biasa) → HTTP 500, bukan 400', async () => {
  const res = responsPalsu();
  const handler = safe(async () => {
    throw new Error('SQLITE_ERROR: no such table: tokens');
  });

  await handler({ method: 'GET', url: '/api/auth/profil' }, res, {}, null);

  assert.equal(res.rekam.status, 500,
    'Error tanpa statusCode HARUS jadi 500 — kalau 400, bug server terlihat ' +
    'seperti kesalahan klien dan monitoring jadi buta');
  assert.equal(JSON.parse(res.rekam.body).error, 'kesalahan_internal',
    'Pesan untuk 5xx harus umum — jangan bocorkan nama tabel/path ke klien');
});

test('error server TIDAK membocorkan detail internal ke klien', async () => {
  const res = responsPalsu();
  const handler = safe(async () => {
    throw new Error("no such file or directory, open '/home/ubuntu/.portfolio-token/tokens.db'");
  });

  await handler({ method: 'GET' }, res, {}, null);

  const body = res.rekam.body;
  assert.ok(!body.includes('/home/'), 'path VPS tidak boleh muncul di respons');
  assert.ok(!body.includes('tokens.db'), 'nama berkas DB tidak boleh muncul');
  assert.ok(!body.includes('ubuntu'), 'username tidak boleh muncul');
});

// ── 2. Error klien (4xx) → diteruskan ────────────────────────────────────────

test('error 4xx dengan statusCode → HTTP 4xx + pesan terbaca', async () => {
  const res = responsPalsu();
  const handler = safe(async () => {
    throw Object.assign(new Error('JSON tidak valid'), { statusCode: 400 });
  });

  await handler({ method: 'POST' }, res, {}, null);

  assert.equal(res.rekam.status, 400, 'statusCode 400 harus dipertahankan');
  assert.equal(JSON.parse(res.rekam.body).error, 'JSON tidak valid',
    'pesan 4xx yang kita lempar sendiri harus tetap terbaca pengguna');
});

test('error 4xx TIDAK dicatat sebagai error server (tidak spam log)', async () => {
  const dicatat = [];
  const asli = console.error;
  console.error = (...args) => dicatat.push(args);

  try {
    const res = responsPalsu();
    const handler = safe(async () => {
      throw Object.assign(new Error('kode salah'), { statusCode: 401 });
    });
    await handler({ method: 'POST' }, res, {}, null);
  } finally {
    console.error = asli;
  }

  assert.equal(dicatat.length, 0,
    '4xx adalah kesalahan pengguna biasa — mencatatnya sebagai error server ' +
    'membuat log penuh dan insiden nyata tenggelam');
});

test('error 5xx DICATAT ke console.error (bisa ditelusuri)', async () => {
  const dicatat = [];
  const asli = console.error;
  console.error = (...args) => dicatat.push(args);

  try {
    const res = responsPalsu();
    const handler = safe(async () => {
      throw new Error('query gagal total');
    });
    await handler({ method: 'GET' }, res, {}, null);
  } finally {
    console.error = asli;
  }

  assert.ok(dicatat.length >= 1,
    'error 5xx HARUS meninggalkan jejak di log — tanpa itu insiden produksi ' +
    'tidak bisa ditelusuri setelah kejadian');
});

// ── 3. Argumen url & params diteruskan ───────────────────────────────────────

test('safe() meneruskan url (argumen ke-4) ke handler', async () => {
  const res = responsPalsu();
  let urlDiterima = null;

  const handler = safe(async (req, r, params, url) => {
    urlDiterima = url;
    r.writeHead(200, {});
    r.end('{}');
  });

  const urlPalsu = new URL('http://x/api?status=aktif');
  await handler({ method: 'GET' }, res, { id: '7' }, urlPalsu);

  assert.equal(urlDiterima, urlPalsu,
    'url harus diteruskan UTUH — tanpa ini, handler yang membaca ' +
    'url.searchParams diam-diam mengabaikan filternya (29 handler pernah rusak)');
});

test('safe() meneruskan params (argumen ke-3) ke handler', async () => {
  const res = responsPalsu();
  let paramsDiterima = null;

  const handler = safe(async (req, r, params) => {
    paramsDiterima = params;
    r.writeHead(200, {});
    r.end('{}');
  });

  await handler({ method: 'GET' }, res, { berkas: 'abc.png' }, null);

  assert.deepEqual(paramsDiterima, { berkas: 'abc.png' },
    'params dari pola rute (:berkas) harus diteruskan');
});

// ── 4. Header sudah terkirim → jangan tulis ulang ────────────────────────────

test('setelah header terkirim, safe() TIDAK menulis respons kedua', async () => {
  const res = responsPalsu();
  res.rekam.headersTerkirim = true; // seolah handler sudah mengirim 200

  const handler = safe(async () => {
    throw new Error('gagal setelah respons terkirim');
  });

  await handler({ method: 'GET' }, res, {}, null);

  assert.equal(res.rekam.status, null,
    'menulis header dua kali melempar ERR_HTTP_HEADERS_SENT — itu sendiri ' +
    'jadi unhandledRejection dan bisa mematikan proses');
});

// ── 5. Penanda __pelindung (audit rute) ──────────────────────────────────────

test('safe() membubuhi __pelindung = true (audit rute)', () => {
  const handler = safe(async () => {});
  assert.equal(handler.__pelindung, true,
    'penanda ini dipakai audit & tes untuk membuktikan setiap rute ' +
    'terbungkus — tanpa itu, rute tanpa pelindung hanya ketahuan saat ' +
    'produksi error di malam hari');
});

// ── 6. publicError: pesan 4xx yang mencurigakan disaring ─────────────────────

test('publicError menyaring pesan yang membocorkan sistem', () => {
  assert.equal(publicError(new Error('SQLITE_CONSTRAINT: UNIQUE failed'), 400),
    'permintaan_tidak_valid', 'istilah SQLITE harus disaring');
  assert.equal(publicError(new Error('gagal buka /var/lib/data'), 400),
    'permintaan_tidak_valid', 'path berkas harus disaring');
  assert.equal(publicError(new Error('x'.repeat(200)), 400),
    'permintaan_tidak_valid', 'pesan panjang khas sistem harus disaring');
  assert.equal(publicError(new Error('slug koleksi tidak valid'), 400),
    'slug koleksi tidak valid', 'pesan ramah pengguna harus lolos');
  assert.equal(publicError(new Error('apa pun'), 500),
    'kesalahan_internal', '5xx selalu umum');
});

// ── 7. Rute auth benar-benar terbungkus (audit runtime) ──────────────────────

test('ruteAuth() mengembalikan rute yang SEMUA terbungkus safe()', async () => {
  const { ruteAuth } = await import('/home/ubuntu/portfolio-victer/backend/src/auth-routes.mjs');
  const rute = ruteAuth();

  assert.ok(Array.isArray(rute) && rute.length > 0, 'ruteAuth() harus mengembalikan array rute');

  const telanjang = rute.filter((r) => r?.handler?.__pelindung !== true);

  assert.equal(telanjang.length, 0,
    `${telanjang.length} rute auth TANPA pelindung: ` +
    `${telanjang.slice(0, 10).map((r) => r.pattern).join(', ')}. ` +
    `Error server di rute ini akan dilaporkan sebagai HTTP 400 ` +
    `(kesalahan klien), bukan 500 — menyembunyikan bug server dari monitoring.`);
});
