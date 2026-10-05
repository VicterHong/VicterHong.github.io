# PRD Perbaikan Keamanan: portfolio-victer (backend token)

**Dasar:** audit 8 temuan, ditambah kode baru `server.mjs`, `http-util.mjs`, `turnstile.mjs`, dan `rate-limit.mjs`.
**Batasan:** tidak ada perubahan arsitektur. Semua perbaikan diuji dulu di instans kedua (port 8790), baru kemudian `systemctl restart`. Downtime restart sekitar 1 detik.

---

## A. Verifikasi

| # | Temuan | Status | Dasar dari kode |
|---|---|---|---|
| 1 | IP bisa dipalsukan | **BERBEDA** | `server.mjs` hanya bind ke `127.0.0.1` dan `::1`, jadi Skenario A (origin dijangkau langsung dari internet) **tidak terbukti**. Lewat tunnel, edge Cloudflare menimpa `CF-Connecting-IP`, sehingga nilai dari klien tidak dipakai. Sisa risiko: (a) proses lokal di VPS bisa memalsukan header; (b) fallback `x-forwarded-for` tidak diperlukan; (c) Skenario B (Worker atau Pages Function sebagai proxy) belum bisa dipastikan. Cek dengan kueri audit di FIX-09. |
| 2 | Crash akibat `decodeURIComponent` | **TERKONFIRMASI, lebih luas dari dugaan** | `resolveRoute()`, `rateLimited()`, dan `new URL(..., req.headers.host)` dipanggil **di luar** `try` pada `requestHandler`. Fungsi ini `async`, jadi exception berubah menjadi *unhandled rejection*. Di Node ≥15 itu berarti **proses mati**. Header `Host` yang rusak juga memicu crash lewat `new URL`. Untuk path traversal: `isValidSlug` tidak terlihat, jadi tetap perlu verifikasi. FIX-02 menutupnya di level router. |
| 3 | Error internal bocor | **TERKONFIRMASI sebagian** | `catch` di `server.mjs` sudah generik (`kesalahan_internal`). Namun `safe()` di `routes.mjs` menangkap error lebih dulu dan mengirim `err.message`, jadi kebocoran tetap terjadi di semua endpoint yang dibungkus `safe()`. |
| 4 | Kunci admin di browser storage | **BERBEDA** | `admin.html` disajikan backend dan **hanya untuk loopback** (lewat SSH tunnel). Origin-nya `localhost:8789`, bukan Pages, sehingga XSS di Pages tidak bisa mencuri kunci. **Celah baru:** pemeriksaan loopback hanya berlaku untuk `/admin`, sedangkan **`/api/admin/*` tetap terbuka ke internet lewat tunnel** dan hanya dijaga oleh kunci statis. |
| 4b | Bug panjang pada `timingSafeEqual` | **Perlu verifikasi** (`isAdmin` tidak terlihat) | Perbaikannya tetap aman diterapkan apa pun bentuk kodenya sekarang. |
| 5 | XSS komentar di panel admin | **Perlu verifikasi** | CSP admin memuat `script-src 'unsafe-inline'`, jadi XSS yang tersimpan akan **tetap berjalan**. `connect-src 'self'` membatasi pengiriman data keluar, tetapi skrip itu masih bisa memanggil API admin dari origin yang sama. Header Pages: terkonfirmasi tidak ada. `sendJson` sudah mengirim `x-frame-options: DENY`. |
| 6 | Turnstile fail-open | **TERKONFIRMASI** | Hasil `skipped:true` dikembalikan untuk secret kosong, respons 5xx, timeout, dan error jaringan. `hostname` tidak divalidasi, `action` tidak dibaca sama sekali. |
| 7 | `/api/ready` dan endpoint lain tanpa batas | **TERKONFIRMASI** | `server.mjs` tidak punya limiter default. Isi `readiness()` perlu verifikasi. |
| 8 | Rate limit per IPv6 penuh | **TERKONFIRMASI** | Kunci limiter memakai IP mentah. |

Temuan tambahan (Rendah): `setInterval` cleanup tidak dibungkus `try`. Jika `cleanupExpiredSessions()` melempar error (misalnya DB terkunci), proses mati.

---

## B. Perbaikan (urut prioritas)

### FIX-01: Proses tidak boleh mati karena satu request
- **Temuan:** #2 (crash), tambahan
- **Berkas:** `backend/src/server.mjs`

**SEBELUM:**
```js
async function requestHandler(req, res) {
  const startedAt = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
```
**SESUDAH:**
```js
async function requestHandler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('[server] request gagal:', err?.stack ?? err);
    if (!res.headersSent) sendJson(res, 400, { ok: false, error: 'permintaan_tidak_valid' });
    else res.destroy();
  }
}

async function handleRequest(req, res) {
  const startedAt = Date.now();
  // Base tetap: header Host dari klien tidak boleh bisa membuat URL() melempar.
  let url;
  try { url = new URL(req.url ?? '/', 'http://localhost'); }
  catch { return sendJson(res, 400, { ok: false, error: 'url_tidak_valid' }); }
  const pathname = url.pathname;
```
Sisa isi fungsi lama tetap sama. Sekarang ia menjadi badan `handleRequest`.

Tambahkan di akhir berkas:
```js
process.on('unhandledRejection', (err) => {
  console.error('[fatal-dicegah] unhandledRejection:', err?.stack ?? err);
});
```
Bungkus juga isi `setInterval`:
```js
setInterval(() => {
  try {
    const removed = cleanupExpiredSessions();
    if (removed > 0) console.log(`[cleanup] ${removed} sesi expired dihapus`);
    cleanupHeartbeats(90 * 24 * 3_600_000);
  } catch (err) {
    console.error('[cleanup] gagal:', err?.message);
  }
}, 3_600_000);
```

**Uji** (di instans kedua, jangan langsung ke produksi):
```bash
PORT=8790 node backend/src/server.mjs &   # sesuaikan nama env port di config.mjs
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:8790/api/project/%E0%A4%A/locked'
curl -s -H 'Host: [' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/api/health
curl -s http://127.0.0.1:8790/api/health   # harus tetap 200, proses masih hidup
```
- **Risiko:** sangat rendah. Hanya respons error yang berubah, dan hanya untuk request rusak.
- **Waktu:** 15 menit

---

### FIX-02: Router aman terhadap decode dan traversal
- **Temuan:** #2
- **Berkas:** `backend/src/routes.mjs` → `matchPath()`

**SEBELUM:**
```js
if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(u[i]);
```
**SESUDAH:**
```js
if (p[i].startsWith(':')) {
  let v;
  try { v = decodeURIComponent(u[i]); } catch { return null; }
  // Whitelist: hanya huruf kecil, angka, tanda hubung. Menolak '/', '..', '\', NUL.
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) return null;
  params[p[i].slice(1)] = v;
}
```
Jika ada parameter yang bukan slug (misalnya ID numerik atau token di path), sesuaikan regex-nya per nama parameter. Cek dengan `grep -n "/:" backend/src/routes.mjs`.

**Uji:**
```bash
grep -n "'/api/.*:" backend/src/routes.mjs   # daftar semua param, pastikan cocok dengan regex
curl -s 'http://127.0.0.1:8790/api/project/..%2F..%2Fetc/locked'   # → 404
curl -s 'http://127.0.0.1:8790/api/project/%E0%A4%A/locked'        # → 404
curl -s 'http://127.0.0.1:8790/api/project/<slug-asli>/locked'     # perilaku normal
```
- **Risiko:** rendah. Slug lama yang memakai huruf besar atau garis bawah akan menjadi 404. Cek isi direktori konten dulu.
- **Waktu:** 15 menit

---

### FIX-03: Batasi `/api/admin/*` ke loopback
- **Temuan:** #4 (celah baru dari verifikasi)
- **Berkas:** `backend/src/server.mjs`, sisipkan **sebelum** `if (rateLimited(...))`:
```js
  // API admin hanya dari panel lokal (SSH tunnel). Lewat tunnel Cloudflare = 404,
  // supaya keberadaan endpoint tidak terlihat dan kunci admin tidak bisa dicoba dari internet.
  if (pathname.startsWith('/api/admin/') || pathname === '/api/admin') {
    if (!isLoopback(req)) {
      return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan' });
    }
  }
```
**Prasyarat:** pastikan tidak ada klien di Pages yang memanggil `/api/admin`. Cek dengan `grep -rn "api/admin" <folder-frontend>`. Panel admin memakai `connect-src 'self'` (localhost:8789), jadi panel tetap berfungsi.

**Uji:**
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host-api>/api/admin/tokens          # → 404 (dari luar)
curl -s -H "x-admin-key: $ADMIN_KEY" http://127.0.0.1:8790/api/admin/tokens           # → 200 (lokal)
curl -s -H 'cf-ray: x' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/api/admin/tokens  # → 404
```
Sesuaikan nama header kunci admin dengan `isAdmin`.
- **Risiko:** rendah. Jika ada otomasi eksternal (cron di luar VPS) yang memanggil API admin, otomasi itu akan berhenti. Pindahkan ke cron lokal.
- **Waktu:** 10 menit

---

### FIX-04: Jangan bocorkan `err.message` dari `safe()`
- **Temuan:** #3
- **Berkas:** `backend/src/routes.mjs` → `safe()`

**SEBELUM:**
```js
if (!res.headersSent) sendJson(res, code, { ok: false, error: err?.message ?? 'kesalahan internal' });
```
**SESUDAH:**
```js
if (code >= 500) console.error('[safe]', err?.stack ?? err);
const publicMsg = code >= 500
  ? 'kesalahan_internal'
  : (err?.publicCode ?? (typeof err?.message === 'string' && err.message.length <= 80 && !/[\/\\]|SQLITE|ENOENT|EACCES/i.test(err.message)
      ? err.message
      : 'permintaan_tidak_valid'));
if (!res.headersSent) sendJson(res, code, { ok: false, error: publicMsg });
```
Error 4xx yang sengaja dibuat (misalnya `body terlalu besar` atau `JSON tidak valid`) tetap tampil. Path dan pesan SQLite disaring.

**Uji:**
```bash
curl -s -X POST -H 'content-type: application/json' -d '{bad' http://127.0.0.1:8790/api/token/validate  # → "JSON tidak valid"
grep -rn "statusCode: 5\|throw new Error" backend/src | head   # tinjau pesan yang dilempar
```
- **Risiko:** rendah. Frontend yang mencocokkan teks error 500 mentah akan melihat `kesalahan_internal`.
- **Waktu:** 10 menit

---

### FIX-05: Normalisasi IP dan hapus fallback XFF
- **Temuan:** #1 (sisa), #8
- **Berkas:** `backend/src/http-util.mjs`

**SEBELUM:**
```js
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '';
}
```
**SESUDAH:**
```js
/**
 * Alamat IP klien. Backend hanya listen di loopback, jadi satu-satunya
 * perantara yang sah adalah cloudflared, dan edge Cloudflare MENIMPA
 * CF-Connecting-IP. X-Forwarded-For tidak dipercaya (bisa dari klien).
 */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim() && cf.length <= 45) return cf.trim();
  return req.socket?.remoteAddress ?? '';
}

/**
 * Kunci rate limit: IPv4 apa adanya, IPv6 dipotong ke prefiks /64
 * (satu pelanggan VPS biasanya memegang satu /64 penuh).
 */
export function ipBucket(ip) {
  let a = String(ip ?? '').trim().toLowerCase().split('%')[0];
  if (!a) return 'unknown';
  if (a.startsWith('::ffff:') && a.includes('.')) return a.slice(7);
  if (!a.includes(':')) return a;
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  let groups = h;
  if (a.includes('::')) {
    const t = tail ? tail.split(':') : [];
    const fill = 8 - h.length - t.length;
    if (fill < 0) return a;
    groups = [...h, ...Array(fill).fill('0'), ...t];
  }
  if (groups.length !== 8) return a;
  return groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':') + '::/64';
}
```
Di `routes.mjs` → `rateLimited()`, ganti kunci:
```js
// SEBELUM: `${pathname}:${clientIp(req)}`
`${pathname}:${ipBucket(clientIp(req))}`
```
Tambahkan juga `ipBucket` ke baris `import`. `clientIp` tetap dipakai untuk audit dan Turnstile (IP penuh). `maxDistinctIps` sebaiknya juga memakai `ipBucket` agar satu /64 tidak terhitung sebagai banyak IP. Cek di `tokens.mjs`.

**Uji:**
```bash
node -e "import('./backend/src/http-util.mjs').then(m=>{for(const x of ['2001:db8::1','2001:db8:0:0:ffff::9','::ffff:1.2.3.4','1.2.3.4','::1'])console.log(x,'→',m.ipBucket(x))})"
# 2001:db8::1 dan 2001:db8:0:0:ffff::9 → 2001:0db8:0000:0000::/64 (sama)
for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -H "cf-connecting-ip: 2001:db8::$i" -X POST http://127.0.0.1:8790/api/token/validate; done
# harus muncul 429 setelah batas
```
- **Risiko:** sedang-rendah. Pengguna yang berbagi /64 (jarang, misalnya kampus atau CGNAT IPv6) ikut berbagi kuota. Batas di FIX-06 cukup longgar.
- **Waktu:** 20 menit

---

### FIX-06: Rate limit default untuk semua `/api/*` dan cache `/api/ready`
- **Temuan:** #7
- **Berkas:** `backend/src/server.mjs`

Tambahkan import:
```js
import { checkRateLimit } from './rate-limit.mjs';
import { applyCors, sendJson, clientIp, ipBucket } from './http-util.mjs';
```
Sisipkan **setelah** blok FIX-03 dan **sebelum** `if (rateLimited(...))`:
```js
  // Batas default (default-deny): berlaku untuk SEMUA /api/*, di atas batas khusus per path.
  // Loopback lokal (panel admin) dikecualikan.
  if (pathname.startsWith('/api/') && !isLoopback(req)) {
    const rl = checkRateLimit(`global:${ipBucket(clientIp(req))}`, { limit: 120, windowMs: 60_000 });
    if (!rl.allowed) {
      res.setHeader('retry-after', String(rl.retryAfterSeconds));
      return sendJson(res, 429, { ok: false, error: 'terlalu_banyak_permintaan' });
    }
    if (pathname === '/api/experiment/convert') {
      const rc = checkRateLimit(`convert:${ipBucket(clientIp(req))}`, { limit: 10, windowMs: 3_600_000 });
      if (!rc.allowed) return sendJson(res, 429, { ok: false, error: 'terlalu_banyak_permintaan' });
    }
  }
```
Untuk `/api/ready`, bungkus di handler `routes.mjs`:
```js
let readyCache = { at: 0, body: null, code: 200 };
// di handler /api/ready:
if (Date.now() - readyCache.at < 10_000 && readyCache.body) return sendJson(res, readyCache.code, readyCache.body);
const body = readiness();               // panggilan yang sudah ada
const code = body.ok ? 200 : 503;       // sesuaikan dengan logika lama
readyCache = { at: Date.now(), body, code };
return sendJson(res, code, body);
```
Jika `readiness()` memuat path, ruang disk, atau status konfigurasi, kembalikan `{ ok }` saja untuk request yang bukan loopback.

**Uji:**
```bash
for i in $(seq 1 130); do curl -s -o /dev/null -w '%{http_code}\n' -H 'cf-connecting-ip: 9.9.9.9' http://127.0.0.1:8790/api/config; done | sort | uniq -c
# ≈120 × 200, ≈10 × 429
curl -s http://127.0.0.1:8790/api/ready   # cek isi, tidak boleh ada path/username
```
- **Risiko:** rendah. 120/menit jauh di atas kebutuhan pengunjung manusia. Health checker eksternal (uptime monitor) yang memanggil lebih dari 2×/detik akan kena batas.
- **Waktu:** 20 menit

---

### FIX-07: Perbandingan kunci admin yang benar
- **Temuan:** #4b
- **Berkas:** `backend/src/routes.mjs` (atau tempat `isAdmin` didefinisikan)

**SEBELUM** (bentuk yang dilaporkan audit):
```js
if (key.length !== expected.length) return false;
return timingSafeEqual(Buffer.from(key), Buffer.from(expected));
```
**SESUDAH:**
```js
import { createHash, timingSafeEqual } from 'node:crypto';
const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest();

function isAdmin(req) {
  const key = req.headers['x-admin-key'];   // pertahankan sumber kunci yang sudah ada
  const expected = config.adminKey;
  if (typeof key !== 'string' || !key || !expected) return false;
  return timingSafeEqual(sha(key), sha(expected));
}
```
Kegagalan admin juga sebaiknya dicatat (misalnya `recordEvent({ outcome: 'admin_gagal' })`). Dengan FIX-03, percobaan ini hanya mungkin dari VPS sendiri, jadi rate limit admin tidak lagi mendesak.

**Uji:**
```bash
curl -s -H 'x-admin-key: ééééééééééééééééééééééééé' http://127.0.0.1:8790/api/admin/tokens   # → 401, bukan 500
curl -s -H "x-admin-key: $ADMIN_KEY" http://127.0.0.1:8790/api/admin/tokens                   # → 200
```
- **Risiko:** sangat rendah.
- **Waktu:** 10 menit

---

### FIX-08: Turnstile terlihat, divalidasi, dan fail-closed untuk gerbang token
- **Temuan:** #6
- **Berkas:** `backend/src/turnstile.mjs`, pemanggil di `routes.mjs` (`turnstileGate`), dan `server.mjs`

**`turnstile.mjs`**: ubah tanda tangan fungsi (kompatibel ke belakang, semua parameter baru opsional):
```js
export async function verifyTurnstile({
  token, secret, remoteip = '', timeoutMs = 8000,
  expectedHostnames = [], expectedAction = '', failOpen = true,
}) {
```
Ganti **tiga** return `ok: true, skipped: true` yang terkait Cloudflare (5xx dan `catch`) dengan:
```js
return { ok: failOpen, skipped: true, error: `cloudflare_http_${res.status}` };
// ...dan di catch:
return { ok: failOpen, skipped: true, error: aborted ? 'cloudflare_timeout' : 'cloudflare_tidak_terjangkau' };
```
Ganti blok sukses:
```js
// SEBELUM
if (data.success === true) {
  return { ok: true, hostname: data.hostname ?? '' };
}
// SESUDAH
if (data.success === true) {
  const host = data.hostname ?? '';
  const hosts = expectedHostnames.filter(Boolean);
  if (hosts.length && !hosts.includes(host)) {
    return { ok: false, error: 'verifikasi_gagal', codes: ['hostname-mismatch'], hostname: host };
  }
  if (expectedAction && data.action !== expectedAction) {
    return { ok: false, error: 'verifikasi_gagal', codes: ['action-mismatch'], hostname: host };
  }
  return { ok: true, hostname: host };
}
```
Gunakan `turnstileMessage('verifikasi_gagal')` agar pesan untuk pengunjung tetap sama.

**`routes.mjs` → `turnstileGate`**: setelah memanggil verify:
```js
const result = await verifyTurnstile({
  token, secret: config.turnstileSecret /* nama properti yang ada */, remoteip: clientIp(req),
  expectedHostnames: (process.env.TURNSTILE_HOSTNAMES ?? '').split(',').map((s) => s.trim()),
  // fail-closed hanya untuk gerbang token; form sales tetap fail-open demi konversi
  failOpen: !pathname.startsWith('/api/token/'),
});
if (result.skipped) {
  console.warn('[turnstile] DILEWATI:', result.error ?? 'secret_kosong', pathname);
  recordEvent({ outcome: 'turnstile_dilewati', detail: result.error ?? 'secret_kosong' /* sesuaikan field */ });
}
```
`expectedAction` baru diaktifkan setelah widget frontend diberi `data-action="token-validate"` / `"sales"`. Jangan diisi sebelum itu.

**`server.mjs`**: tambahkan setelah blok `validateConfig()`:
```js
if (process.env.NODE_ENV === 'production' && !process.env.TURNSTILE_SECRET_KEY) {
  console.error('[startup] TURNSTILE_SECRET_KEY kosong di produksi — menolak start.');
  process.exit(1);
}
```
Pastikan `config.mjs` memuat `ENV_FILE` ke `process.env`. Jika tidak, ganti dengan properti config yang setara. Tambahkan `TURNSTILE_HOSTNAMES=<domain-pages>,<domain-kustom>` di `service.env`, dan **jangan** masukkan domain preview.

**Uji:**
```bash
grep -n TURNSTILE /etc/<...>/service.env            # pastikan secret & hostnames ada SEBELUM restart
NODE_ENV=production TURNSTILE_SECRET_KEY= PORT=8790 node backend/src/server.mjs; echo "exit=$?"   # → exit=1
# Simulasi Cloudflare tak terjangkau:
node -e "import('./backend/src/turnstile.mjs').then(async m=>console.log(await m.verifyTurnstile({token:'x',secret:'1x0000000000000000000000000000000AA',timeoutMs:1,failOpen:false})))"
# → ok:false, skipped:true
# Hostname salah: secret uji selalu-lolos mengembalikan hostname 'example.com'
node -e "import('./backend/src/turnstile.mjs').then(async m=>console.log(await m.verifyTurnstile({token:'x',secret:'1x0000000000000000000000000000000AA',expectedHostnames:['situs-saya.pages.dev']})))"
# → ok:false, hostname-mismatch
```
- **Risiko:** sedang. (1) Jika `TURNSTILE_HOSTNAMES` diisi salah, semua pengunjung ditolak. Uji dulu dengan satu validasi token sungguhan dari browser. (2) Saat Cloudflare siteverify bermasalah, gerbang token menolak pengunjung. Ini disengaja, dan Turnstile memiliki ketersediaan yang sama dengan tunnel yang Anda pakai.
- **Waktu:** 35 menit

---

### FIX-09: Pastikan IP di audit memang IP pengunjung (Skenario B)
- **Temuan:** #1
- **Berkas:** tidak ada perubahan kode, hanya pemeriksaan.

**STATUS: SELESAI — tidak ada masalah ditemukan.**
Lihat `docs/FIX-09-VERIFIKASI-IP.md` untuk laporan lengkap.

Hasil: 15 IP berbeda tercatat di audit, termasuk IP pengunjung asli
(103.179.248.71, 129.225.15.88, 2001:448a:80d2:...) pada aksi sensitif
(session_create, session_turnstile). Rate limit terbukti bekerja per
pengunjung — diuji dengan tiga IP terpisah, masing-masing punya bucket
sendiri dan tidak saling memblokir.

IP Cloudflare (2a06:98c0:3600::103) memang muncul, tapi hanya dari
request lewat Worker (victer.workers.dev) — bukan jalur pengunjung normal.

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.portfolio-token/tokens.db');
const rows = db.prepare(\"SELECT ip, COUNT(*) as n FROM access_events WHERE ip != '' GROUP BY ip ORDER BY n DESC LIMIT 20\").all();
rows.forEach(r => console.log(r.ip.padEnd(45), r.n));
db.close();
"
```

**Catatan:** kalau arsitektur berubah dan SEMUA trafik pengunjung
dialihkan lewat Worker, verifikasi ini perlu diulang.

---