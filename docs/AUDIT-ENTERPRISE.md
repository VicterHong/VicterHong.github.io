# Audit Kesiapan Skala Enterprise

**Tanggal:** 5 Oktober 2026
**Model:** Opus 5.5 (reasoning low — prompt panjang kehabisan token di medium)
**Skala dinilai:** 10.000 token · 1 juta event · 100.000 pengunjung/bulan · 500 req/menit · 50 admin bersamaan
**Biaya:** $0,63 dari saldo penalaran

---

## Ringkasan Eksekutif

**SQLite tidak pecah. VPS tidak pecah.** Yang pecah adalah tiga hal:

1. **`DatabaseSync` bersifat sinkron** — setiap query lambat membekukan SELURUH proses.
   Satu query admin 500ms menahan semua pengunjung. Ini akar dari sebagian besar temuan.
2. **Tidak ada retensi data** — masalahnya bukan ukuran DB, tapi ukuran × jumlah salinan backup.
3. **Satu heartbeat SLA per request** — 3.500 baris vs 303 event dalam 5 hari. Rasio 11:1.

**Kesimpulan:** sistem ini CUKUP untuk skenario yang dinilai dengan headroom besar
(>500×), asalkan A1–A8 dikerjakan. Migrasi ke Postgres/Redis TIDAK perlu.

**Temuan yang perlu dikoreksi:** Opus mengoreksi 5 dari 8 "temuan" yang saya
kumpulkan — 2 di antaranya salah tuduh sepenuhnya. Lihat bagian "Koreksi".

---

## Bagian 1 — Temuan A1 sampai A4


## Ringkasan

Pada skenario 1000x, **SQLite tidak pecah dan VPS tidak pecah.** Puncak 500 permintaan/menit setara 8,3 permintaan/detik. SQLite di SSD sanggup ratusan sampai ribuan commit per detik.

Yang pecah adalah tiga hal:

1. **`DatabaseSync` bersifat sinkron.** Setiap query lambat membekukan *seluruh* proses Node. Query laporan admin yang berat langsung menjadi gangguan bagi pengunjung publik.
2. **Tidak ada retensi data.** Masalahnya bukan ukuran database, tapi ukuran database **dikalikan jumlah salinan backup**.
3. **Satu heartbeat SLA ditulis per request.** Ini memperbesar beban tulis sekaligus membuat laporan SLA mahal dihitung.

Proyeksi nyata: pada laju sekarang (~60 event/hari), 1 juta event baru tercapai dalam ~45 tahun. Jadi semua angka di bawah memakai skenario 1000x, bukan laju saat ini.

---

## Koreksi atas temuan yang sudah Anda ketahui

Sebelum masuk ke bagian A, ada beberapa koreksi pada daftar temuan Anda:

| Temuan | Status setelah diverifikasi |
|---|---|
| #1 cleanup tidak dipanggil | **Benar.** Tapi jangan langsung dipanggil apa adanya (lihat A3): run pertama bisa membekukan server. |
| #2 access_events tanpa cleanup | **Benar.** Ditambah: tidak ada index di `at` saja, jadi cleanup *dan* `recentEvents` tanpa filter akan melakukan full scan. |
| #3 busy_timeout = 0 | **Benar, tapi dampaknya bersyarat.** Hanya relevan kalau ada proses lain yang menulis ke file DB yang sama. Ada jebakan tambahan: `BEGIN` deferred (lihat A5). |
| #4 audit.mjs:48 `DISTINCT ip` | **Bukan masalah.** Query difilter `token_id = ? AND at >= ?` dan memakai `idx_events_token`. Hasilnya dibatasi jumlah IP satu token dalam satu jendela waktu. |
| #4 audit.mjs:70 `SELECT outcome` | **Salah tuduh.** Query ini punya `LIMIT 40`. |
| #4 sla.mjs:68 | **Masalahnya beda dari yang dituduhkan.** Query ini punya `LIMIT 1 OFFSET`, jadi hasilnya tidak unbounded. Masalah sebenarnya: `ORDER BY latency_ms` harus mengurutkan *semua* baris dalam jendela 30 hari (lihat A1). |
| #4 cms/branches/experiments | Bukan masalah, karena data dibuat admin dan jumlahnya puluhan baris. |
| #4 collaborate.mjs:125 comments | **Ini yang berbahaya.** Tabelnya bisa ditulis dari endpoint publik (`/api/comments`) dan dibaca tanpa LIMIT (A8). |
| #5 Map rate limit | Benar, tapi bukan yang pertama pecah. Ada masalah rate limit yang jauh lebih mungkin terjadi lebih dulu (A2). |

---

## A. Yang PECAH lebih dulu (berurutan)

### A1. Heartbeat SLA per request dan laporan SLA yang mengurutkan semua baris

**Apa**

`recordHeartbeat` menulis 1 baris untuk *setiap respons*. Buktinya terlihat di data: 3.500 heartbeat berbanding 303 event dalam 5 hari, rasio ~11:1. Tabel ini sudah menjadi yang terbesar sekarang.

`slaSummary()` menjalankan 3 jendela waktu × 4 query. Query p95 melakukan:

```sql
WHERE checked_at >= ? AND ok = 1 ORDER BY latency_ms ... OFFSET (COUNT(*) ...)
```

**Kapan muncul**

Pada 1000x (~800 ribu request/bulan), jendela 30 hari berisi ~800 ribu baris. Mulai **~200 ribu baris per jendela**, `slaSummary()` butuh ratusan milidetik. Pada 800 ribu baris kira-kira 1–3 detik di 1 CPU.

**Kenapa**

- `idx_sla_checked(checked_at)` tidak mencakup `ok` maupun `latency_ms`. Akibatnya setiap baris dalam rentang harus di-lookup ke tabel.
- p95 butuh `USE TEMP B-TREE FOR ORDER BY` atas seluruh rentang. Itu dilakukan **dua kali**: untuk subquery COUNT dan untuk sort.
- Semua ini berjalan di `DatabaseSync`, sehingga event loop berhenti selama query berjalan.

**Dampak**

Setiap kali admin membuka dashboard SLA, *semua* pengunjung publik menunggu 1–3 detik. Dengan 50 admin, situs terasa mati. Ironisnya, latensi tinggi itu ikut tercatat sebagai heartbeat dan memperburuk angka SLA.

**Bonus kejujuran angka (bukan masalah skala, tapi relevan):** heartbeat hanya tercatat kalau proses hidup. Saat server mati, tidak ada baris yang ditulis, sehingga uptime tetap 100%. Perbaikan di bawah ikut menyelesaikan ini.

**Perbaikan**

Agregasikan di memori dan tulis **1 baris per menit**, termasuk menit dengan nol request. Histogram dengan bucket tetap membuat p95 bisa dihitung dari agregat.

```js
// sla.mjs
const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];
let cur = freshMinute();
function freshMinute() {
  return { minute: Math.floor(Date.now() / 60_000), n: 0, err: 0, sum: 0, hist: new Array(BUCKETS.length).fill(0) };
}

export function recordHeartbeat({ ok, latencyMs }) {
  const m = Math.floor(Date.now() / 60_000);
  if (m !== cur.minute) flushHeartbeats();
  const lat = Math.max(0, Math.round(latencyMs));
  cur.n++; if (!ok) cur.err++; else cur.sum += lat;
  cur.hist[BUCKETS.findIndex((b) => lat <= b)]++;
}

export function flushHeartbeats() {
  const c = cur; cur = freshMinute();
  getDb().prepare(`INSERT INTO sla_minutes (minute, total, errors, latency_sum, hist)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(minute) DO UPDATE SET total=total+excluded.total, errors=errors+excluded.errors,
      latency_sum=latency_sum+excluded.latency_sum, hist=excluded.hist`)
    .run(c.minute, c.n, c.err, c.sum, JSON.stringify(c.hist));
}
// server.mjs: setInterval(flushHeartbeats, 60_000).unref(); dan panggil saat SIGTERM.
```

Catatan untuk `ON CONFLICT`: menimpa `hist` cukup aman karena satu menit hanya di-flush sekali dalam keadaan normal. Kalau ingin sempurna, gabungkan array histogram di JS sebelum UPDATE.

```sql
CREATE TABLE IF NOT EXISTS sla_minutes (
  minute INTEGER PRIMARY KEY, total INTEGER NOT NULL, errors INTEGER NOT NULL,
  latency_sum INTEGER NOT NULL, hist TEXT NOT NULL
);
```

Hasilnya:

- 30 hari = maksimum 43.200 baris, berapa pun trafiknya.
- p95 dihitung dengan menjumlahkan histogram di JS (O(baris × 11)).
- **Menit yang hilang = proses mati**, sehingga uptime menjadi jujur.

**Cara menguji**

- Seed 1 juta request lewat `recordHeartbeat` di test.
- Pastikan `SELECT COUNT(*) FROM sla_minutes` ≤ jumlah menit.
- Pastikan `slaSummary()` selesai < 50 ms.

**Biaya:** 60–90 menit, termasuk migrasi dan menghapus tabel lama setelah 30 hari.

---

### A2. Rate limit per IP salah sumber atau IP bersama (VERIFIKASI DULU, 5 menit)

**Apa**

Kode ini tidak menunjukkan bagaimana `key` dibentuk. Ada dua skenario yang pecah *sebelum* soal ukuran Map relevan:

1. **Di belakang reverse proxy atau Cloudflare** (Turnstile mengindikasikan Cloudflare), sementara key diambil dari `req.socket.remoteAddress`. Akibatnya **semua pengunjung berbagi satu bucket**. Batas default 120/menit untuk seluruh situs, padahal puncak skenario 500/menit.
2. **NAT korporat.** Klien enterprise yang 30 karyawannya membuka tautan token dari satu IP kantor akan langsung kena batas `/api/token/validate` 20/menit dan `/api/token/session` 10/menit.

**Kapan muncul**

- Skenario 1: begitu trafik total melewati ~120/menit, yaitu **jauh sebelum** 500/menit.
- Skenario 2: begitu satu klien enterprise punya lebih dari ~10 orang yang aktif bersamaan.

**Dampak**

Pengunjung sah menerima 429. Di log terlihat seperti "serangan" padahal bukan.

**Perbaikan**

Pastikan key berasal dari `CF-Connecting-IP` atau `X-Forwarded-For`, **hanya** kalau `remoteAddress` termasuk rentang proxy tepercaya. Untuk endpoint token, pertimbangkan key gabungan `ip + token_hash_prefix`, sehingga brute force tetap dibatasi per IP tapi pengguna sah dari satu kantor tidak saling memblokir.

**Cara menguji**

Kirim 130 request dengan `CF-Connecting-IP` berbeda dari satu socket. Semuanya harus `allowed`.

**Biaya:** 5 menit verifikasi, 20 menit perbaikan.

---

### A3. Retensi tidak ada, dan menyalakannya secara naif akan membekukan server

**Apa**

`access_events`, `analytics_events`, `device_fingerprints`, `web_vitals`, `experiment_events`, dan `cms_comments` tumbuh tanpa batas.

**Kapan muncul**

Ukuran database sendiri bukan masalah. SQLite nyaman sampai puluhan GB. Masalahnya ada di **disk dikali backup**. Estimasi kasar pada 1000x, dengan ~300–500 byte per baris termasuk index:

| Sumber | Baris/bulan | Ukuran/tahun |
|---|---|---|
| heartbeat (kalau A1 tidak dikerjakan) | ~800 ribu | ~3–4 GB |
| analytics | ~500 ribu | ~2–3 GB |
| access_events | ~300 ribu | ~1,5 GB |

Total DB bisa mencapai ~5–8 GB dalam setahun. **Backup harian yang disimpan 14–30 salinan** akan menghabiskan sisa 17 GB disk dalam beberapa bulan, bukan tahun. Periksa skrip backup Anda: berapa salinan disimpan dan apakah dikompresi.

**Jebakan saat diperbaiki**

Kalau besok Anda memanggil `cleanupAnalytics(90 * DAY)` setelah setahun data menumpuk, satu `DELETE` itu:

- menghapus jutaan baris dalam **satu transaksi sinkron**, sehingga event loop beku puluhan detik;
- membuat WAL membengkak sebesar data yang dihapus;
- melakukan full scan, karena `analytics_events` tidak punya index yang diawali `created_at`, dan `access_events` tidak punya index yang diawali `at`.

Selain itu, `DELETE` tidak mengecilkan file. Tanpa `VACUUM` atau `auto_vacuum`, ruang hanya dipakai ulang secara internal, dan backup tetap berukuran sama besar.

**Perbaikan**

```sql
CREATE INDEX IF NOT EXISTS idx_events_at        ON access_events(at);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_vitals_created    ON web_vitals(created_at);
CREATE INDEX IF NOT EXISTS idx_fp_created        ON device_fingerprints(created_at);
```

```js
// retention.mjs
const PRUNABLE = {
  access_events: 'at', analytics_events: 'created_at', web_vitals: 'created_at',
  device_fingerprints: 'created_at', experiment_events: 'created_at',
};

/** Hapus bertahap: tiap batch transaksi kecil, lalu kembalikan event loop. */
export function prune(table, olderThanMs, batch = 2000) {
  const col = PRUNABLE[table];
  if (!col) throw new Error(`tabel tidak boleh di-prune: ${table}`);
  const cutoff = Date.now() - olderThanMs;
  const stmt = getDb().prepare(
    `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${col} < ? LIMIT ?)`
  );
  return new Promise((resolve) => {
    let total = 0;
    const step = () => {
      const n = Number(stmt.run(cutoff, batch).changes);
      total += n;
      if (n === batch) setImmediate(step); else resolve(total);
    };
    step();
  });
}
```

Usulan retensi, sesuaikan dengan kewajiban kontrak Anda kepada klien:

| Tabel | Retensi |
|---|---|
| analytics | 180 hari |
| web_vitals | 90 hari |
| device_fingerprints | 90 hari |
| access_events | 365 hari (ekspor ke arsip `.jsonl.gz` bulanan sebelum dihapus, kalau "siapa membuka proyek saya" perlu dijawab lebih lama) |

**Logika auto-revoke tidak terganggu**, karena hanya memakai jendela pendek.

Jalankan di `setInterval` harian yang sama dengan cleanup lain, *bukan* di jam backup. Tambahkan `PRAGMA incremental_vacuum` hanya kalau `auto_vacuum=INCREMENTAL` sudah diset. Itu butuh satu kali `VACUUM` saat jendela maintenance; pada DB 584 KB sekarang, prosesnya instan. **Lakukan sekarang selagi kecil.**

**Cara menguji**

- Seed 500 ribu baris lama.
- Jalankan `prune()` sambil mengukur `monitorEventLoopDelay`. Nilai p99 harus < 50 ms.
- Pastikan `EXPLAIN QUERY PLAN` memakai index `_at`/`_created`.

**Biaya:** 45 menit.

---

### A4. Query admin yang menjadi full scan, ditambah 50 admin bersamaan

**Apa**

| Fungsi | Masalah |
|---|---|
| `recentEvents()` tanpa filter: `ORDER BY at DESC, id DESC LIMIT 100` | Tidak ada index `at`, jadi full scan plus top-N sort. |
| `recentEvents({projectSlug})` | Tidak ada index `project_slug` di `access_events`. |
| `recentAnalytics()` tanpa `eventType`: `WHERE created_at >= 0 ORDER BY created_at DESC` | Full scan. |
| `uniqueVisitors()`: `COUNT(DISTINCT ip) WHERE created_at >= ?` | Tidak ada index yang diawali `created_at`, jadi full scan plus temp b-tree untuk DISTINCT. |
| `getFunnel()` | 8 query terpisah. Masing-masing memakai `idx_analytics_type` (baik), tapi filter `project_slug` dievaluasi per baris lewat table lookup. |

**Kapan muncul**

Mulai **~200–300 ribu baris**, masing-masing query 100–500 ms. Pada 1–2 juta baris, 0,5–2 detik. Satu dashboard memanggil beberapa query sekaligus, jadi wajar 2–5 detik per load.

**Kenapa ini kritis dan bukan sekadar lambat**

Lihat bagian E: setiap milidetik query admin adalah milidetik semua request publik tertahan. 50 admin × 3 detik = antrean 150 detik pada skenario terburuk.

**Perbaikan (tiga lapis, semuanya murah)**

1. **Urutkan berdasarkan `id`**, bukan `at`. `id` adalah AUTOINCREMENT, jadi monoton searah waktu penyisipan. `ORDER BY id DESC LIMIT 100` cukup menelusuri rowid dari belakang tanpa sort. Ini tetap deterministik, sehingga alasan di komentar CI tetap terpenuhi.

   ```js
   // recentEvents: ganti ORDER BY at DESC, id DESC → ORDER BY id DESC
   ```

   Satu peringatan: kalau jam sistem mundur, urutan `id` bisa berbeda dengan urutan `at`. Untuk tampilan "terbaru dulu", `id` justru lebih benar.

2. **Index:**

   ```sql
   CREATE INDEX IF NOT EXISTS idx_events_project ON access_events(project_slug, at);
   -- idx_analytics_created dari A3; untuk uniqueVisitors pakai covering:
   CREATE INDEX IF NOT EXISTS idx_analytics_created_ip ON analytics_events(created_at, ip);
   ```

   (`idx_analytics_created_ip` menggantikan `idx_analytics_created`; cukup buat salah satu.)

   Di `recentAnalytics`, hapus `created_at >= 0` lalu urutkan dengan `ORDER BY id DESC`.

3. **Cache hasil 60 detik di memori.** Ini aman karena hanya ada satu proses (lihat A5 soal
---

## Bagian 2 — Temuan A5 sampai D

## A5. Transaksi & konkurensi SQLite

**Kesimpulan: tidak ada masalah konkurensi dalam arti klasik (race, deadlock, `SQLITE_BUSY` antar-request). Yang ada adalah masalah latensi fsync dan satu potensi `SQLITE_BUSY` dari proses luar.**

### Kenapa race antar-request tidak terjadi

`DatabaseSync` bersifat sinkron, dan hanya ada satu proses dengan satu koneksi. Seluruh isi `transaction(() => {...})` di `createSession` berjalan dalam satu tick. Tidak ada request lain yang bisa menyela di antara `SELECT COUNT(*)` dan `INSERT`. Dengan begitu:

- Pola *check-then-act* di `createSession` (hitung sesi lalu hapus yang tertua) **aman**, meskipun `max_devices` dibaca di luar transaksi.
- Dalam satu proses, `busy_timeout = 0` **tidak relevan**, karena koneksi tidak pernah bersaing dengan dirinya sendiri.
- 500 req/menit setara ~8,3 req/detik. WAL dengan satu penulis sanggup ribuan commit per detik.

### Yang benar-benar perlu dicek

**1. `busy_timeout=0` menjadi masalah begitu ada proses kedua.** Contohnya skrip CLI admin, `sqlite3` di cron backup, atau skrip migrasi yang dijalankan saat server hidup. Ketika proses itu menulis, server langsung menerima `SQLITE_BUSY` (tanpa menunggu), dan request publik gagal 500. Perbaikannya:

```js
// db.mjs — saat membuka DB
db = new DatabaseSync(path, { timeout: 2000 });   // Node ≥ 22.16 / 23.10
// fallback untuk versi lebih lama:
db.exec('PRAGMA busy_timeout = 2000;');
```

Catatan: menunggu lock pada API sinkron berarti event loop ikut menunggu sampai 2 detik. Ini tetap lebih baik daripada error, asalkan proses kedua hanya menulis dalam transaksi singkat.

**2. Setiap request menulis ke disk.** `validateSession()` menjalankan `UPDATE sessions SET last_seen` pada **setiap** request terautentikasi. Bawaan SQLite adalah `synchronous=FULL`, sehingga tiap commit di WAL memicu fsync. Di disk VPS, fsync memakan 1–10 ms (bisa 50+ ms saat tetangga sibuk), dan selama itu event loop beku. Pada 8 req/detik, beban ini masih ringan (~2–8% waktu). Namun ia menjadi lantai latensi yang tidak perlu. Perbaikannya ada dua:

```js
// db.mjs SCHEMA
PRAGMA synchronous = NORMAL;   // aman dari korupsi di WAL; hanya commit terakhir bisa hilang saat mati listrik
```

```js
// sessions.mjs — validateSession: tulis last_seen paling sering 1×/menit
if (at - session.last_seen > 60_000) {
  getDb().prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(at, hash);
}
```

**3. Checkpoint WAL bisa tertahan.** Checkpoint tidak dapat memotong WAL selama ada transaksi baca yang masih berjalan. Dalam satu proses sinkron, hal ini hanya terjadi saat `VACUUM INTO` atau backup berjalan dari proses lain (lihat A7). Tanda-tandanya: file `*.db-wal` membesar ratusan MB.

**4. `prepare()` dipanggil di setiap pemanggilan,** termasuk di dalam loop `for (const row of toRemove)`. Biayanya ~10–50 µs per prepare. Ini bukan masalah skala, tetapi mudah dirapikan dengan cache statement di level modul.

**5. Verifikasi `transaction()`.** Kalau helper ini menjalankan `BEGIN` secara naif, pemanggilan bersarang (fungsi bertransaksi memanggil fungsi bertransaksi lain) akan melempar `cannot start a transaction within a transaction`. Periksa apakah helper memakai `SAVEPOINT` atau memeriksa `db.isTransaction`.

**Cara menguji**

- Jalankan `sqlite3 data.db "BEGIN IMMEDIATE; SELECT 1;"` lalu tahan 1 detik, sambil mengirim request login. Tanpa timeout hasilnya 500. Dengan timeout, request berhasil setelah jeda.
- Jalankan `PRAGMA synchronous;` setelah start. Hasil yang diharapkan `1` (NORMAL).
- Lakukan load test 20 req/detik ke endpoint terautentikasi, lalu bandingkan p99 sebelum dan sesudah throttle `last_seen`.

**Biaya:** 30 menit.

---

## A6. Kebocoran memori & pertumbuhan proses

Penilaian per komponen:

| Komponen | Tumbuh tanpa batas? | Kapan jadi masalah |
|---|---|---|
| Sesi | **Tidak.** Sesi disimpan di SQLite, bukan memori | — |
| Map rate limit (A2) | **Ya, kalau tidak ada sweep** | Lihat di bawah |
| Cache query admin (A4) | Terbatas jika key-nya hanya kombinasi filter. **Tidak terbatas** jika key memuat input bebas (`?q=`, `projectSlug` arbitrer) | Penyerang dapat membuat key tanpa akhir |
| Prepared statement | Tidak bocor. `StatementSync` dibereskan oleh GC, hanya menambah churn | — |
| `setInterval` | Aman selama didaftarkan sekali saat startup | Bocor kalau dibuat per request atau per sesi |
| Listener `req.on('close')` | Aman, ikut hilang bersama objek request | Bocor kalau dipasang ke objek global (`process`, `server`) per request. Node akan memperingatkan `MaxListenersExceededWarning` |

### Map rate limit, dengan angka

Satu entri `{ip → {count, resetAt}}` berukuran ~150–250 byte, termasuk overhead Map dan string.

- **Lalu lintas normal:** 100.000 pengunjung/bulan menghasilkan ~100 ribu key. Itu ~20 MB/bulan, atau ~240 MB/tahun bila proses tidak pernah restart. Tidak fatal di RAM 6 GB, tetapi terus naik.
- **Serangan:** penyerang dengan blok IPv6 /64 dapat membuat jutaan IP unik. 5 juta key setara ~1 GB, dan GC mulai mendominasi CPU jauh sebelum OOM.

Perbaikannya adalah sweep berkala ditambah batas keras:

```js
const MAX_KEYS = 200_000;
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of buckets) if (v.resetAt < t) buckets.delete(k);
}, 60_000).unref();

function hit(key) {
  if (!buckets.has(key) && buckets.size >= MAX_KEYS) {
    buckets.delete(buckets.keys().next().value);   // buang entri tertua (urutan sisip)
  }
  // ...
}
```

Untuk IPv6, gunakan prefix /64 sebagai key, bukan alamat penuh.

Untuk cache A4, terapkan pola yang sama: `MAX_ENTRIES = 500`, dengan TTL dicek saat baca.

**Cara menguji**

- Jalankan skrip yang mengirim 1 juta request dengan `CF-Connecting-IP` acak (setelah A2 diperbaiki, header ini hanya dipercaya dari IP Cloudflare, jadi uji di lokal dengan bypass).
- Catat `process.memoryUsage().heapUsed` setiap 10 detik. Hasil yang diharapkan: datar di bawah ~60 MB setelah melewati batas.
- Tambahkan `/healthz` yang mengembalikan `heapUsed`, `rss`, dan `buckets.size`, lalu pasang alert jika `rss` > 1 GB.
- Jalankan proses dengan `node --max-old-space-size=1024`. Jika ada kebocoran, proses lebih baik mati cepat dan di-restart systemd daripada menyeret swap.

**Biaya:** 30 menit.

---

## A7. Backup & pemulihan pada skala besar

### Berapa lama `VACUUM INTO` pada DB 5 GB?

`VACUUM INTO` membaca seluruh DB lalu menulis ulang salinan yang dipadatkan, termasuk membangun ulang semua index. Di disk VPS biasa (100–300 MB/detik, sering lebih rendah karena berbagi disk), estimasinya **1–4 menit**, dengan CPU tunggal penuh selama proses.

### Apakah memblokir request?

Tergantung di mana ia dijalankan:

- **Di dalam proses server** (`getDb().exec("VACUUM INTO ...")`): **ya, memblokir total.** API-nya sinkron, sehingga server tidak menjawab apa pun selama 1–4 menit. Pada DB 584 KB hari ini hal ini tidak terasa, dan karena itulah mudah terlewat.
- **Dari proses terpisah** (`sqlite3` CLI di cron): request tidak terblokir, tetapi CPU tunggal direbut, sehingga latensi naik 2–5×. Selain itu, transaksi baca yang panjang menahan checkpoint, dan WAL membengkak selama backup.

### Cukupkah disk?

Pada DB 5 GB dengan sisa disk 17 GB:

- Proses backup butuh +5 GB sementara.
- Salinan mentah 5 GB × 14 = 70 GB. **Tidak muat.** Kompresi gzip/zstd pada data teks seperti ini biasanya 4–8×, jadi sekitar 0,7–1,2 GB per salinan. 14 salinan setara 10–17 GB, yang **tetap tidak muat** bila ditambah DB dan ruang sementara.
- Masalah yang lebih mendasar: **backup yang tersimpan di disk yang sama bukan backup.** Satu kegagalan disk atau satu `rm` yang salah menghapus semuanya.

### Perbaikan

**1. Gunakan backup online incremental bawaan Node** (`node:sqlite` `backup()`, tersedia di Node ≥ 22.16/23.8). Fungsi ini menyalin per halaman secara async dan menyerahkan kendali ke event loop di antara batch:

```js
import { backup } from 'node:sqlite';

export async function runBackup(dest) {
  await backup(getDb(), dest, {
    rate: 200,                          // halaman per langkah (~800 KB), lalu yield
    progress: ({ totalPages, remainingPages }) => {},
  });
}
```

Jika versi Node tidak mendukungnya, jalankan `VACUUM INTO` di `worker_threads` dengan koneksi `DatabaseSync` terpisah (`readOnly: true`), lalu `nice -n 19` untuk proses kompresinya.

**2. Kompres, rotasikan, dan kirim ke luar mesin:** `zstd -T1 -10`, simpan 7 salinan harian + 4 mingguan di lokal, lalu salin ke object storage (Backblaze B2/R2/S3) dengan `rclone`. Biayanya < $1/bulan.

**3. Pertimbangkan Litestream.** Litestream mereplikasi WAL secara kontinu ke S3, sehingga RPO turun dari 24 jam menjadi beberapa detik, tanpa backup penuh harian. Ia berjalan sebagai proses terpisah dan memakai CPU kecil. Ini perbaikan dengan rasio nilai tertinggi untuk sistem yang menjanjikan SLA kepada klien.

### Pemulihan: apakah pernah diuji?

Kemungkinan besar belum. Backup yang tidak pernah dipulihkan adalah asumsi, bukan backup. Buat skrip berikut dan jalankan bulanan (atau otomatis di CI mingguan):

```bash
#!/bin/sh
# restore-test.sh
set -e
LATEST=$(rclone lsf remote:backups | sort | tail -1)
rclone copy "remote:backups/$LATEST" /tmp/rt/
zstd -d /tmp/rt/*.zst -o /tmp/rt/restore.db
sqlite3 /tmp/rt/restore.db "PRAGMA integrity_check;" | grep -qx ok
sqlite3 /tmp/rt/restore.db "SELECT COUNT(*) FROM tokens;"        # bandingkan dengan produksi
DB_PATH=/tmp/rt/restore.db PORT=9999 node src/server.mjs & sleep 2
curl -fs localhost:9999/healthz && echo "RESTORE OK"
```

Catat waktu dari awal hingga `RESTORE OK`. Itulah **RTO** Anda yang sebenarnya, dan angka inilah yang Anda tulis di kontrak.

**Cara menguji tidak-memblokir:** seed DB hingga 2 GB, jalankan backup sambil `autocannon` memukul `/healthz`. Hasil yang diharapkan: p99 < 100 ms dan tidak ada timeout.

**Biaya:** 2–3 jam (termasuk Litestream atau rclone dan skrip restore).

---

## A8. `/api/comments` publik: bisa ditulis siapa saja, dibaca tanpa LIMIT

Ini **temuan paling berbahaya di daftar ini**, karena dapat dieksploitasi hari ini tanpa skala apa pun.

### Vektor yang terbuka

1. **DoS lewat amplifikasi baca.** Penyerang memposting 200 ribu komentar (dengan rate limit yang bocor sebelum A2 diperbaiki, cukup beberapa menit). Setiap `GET /api/comments` kemudian membaca, mem-parse, dan men-`JSON.stringify` 200 ribu baris secara **sinkron**: ~1–3 detik CPU dan respons 50+ MB. Sepuluh pengunjung halaman sudah cukup untuk membekukan server bagi semua orang, termasuk validasi token klien. Biayanya bagi penyerang nol, sementara dampaknya total.
2. **Stored XSS.** Jika komentar dirender dengan `innerHTML` di halaman yang sama dengan sesi admin atau klien, penyerang dapat bertindak atas nama mereka. Cookie `httpOnly` melindungi pencurian cookie, tetapi tidak melindungi dari request yang dikirim dari halaman itu sendiri.
3. **Pengisian disk.** Tanpa batas panjang, satu komentar 10 MB × 1.000 = 10 GB, dan disk penuh. SQLite yang kehabisan disk menggagalkan **semua** penulisan, termasuk sesi.
4. **Spam SEO dan reputasi.** Tautan judi atau phishing muncul di situs yang Anda tunjukkan ke klien enterprise.
5. **Data pribadi.** Jika IP atau email penulis ikut dikembalikan di `GET`, itu berarti kebocoran data pribadi (UU PDP).

### Perbaikan (semuanya wajib, murah)

```js
// POST
const MAX_BODY = 8 * 1024;                      // tolak sebelum parse: cek content-length + hitung byte stream
if (typeof body.text !== 'string' || body.text.length < 1 || body.text.length > 2000) return bad(400);
if (body.website) return ok();                   // honeypot: bot mengisi field tersembunyi, pura-pura sukses
// + verifikasi Cloudflare Turnstile (gratis, sudah di belakang CF)
// + rate limit per IP: 5/jam, 20/hari (memakai IP yang sudah benar dari A2)
// simpan dengan status = 'pending'; hanya admin yang mengubah ke 'approved'
```

```sql
CREATE INDEX IF NOT EXISTS idx_comments_target ON cms_comments(target, status, id);
```

```js
// GET: keyset pagination, hanya approved, hanya kolom publik
const rows = getDb().prepare(`
  SELECT id, author_name, text, created_at FROM cms_comments
  WHERE target = ? AND status = 'approved' AND id < ?
  ORDER BY id DESC LIMIT 50`).all(target, before ?? Number.MAX_SAFE_INTEGER);
```

Di frontend, render dengan `textContent`, jangan pernah `innerHTML`. Tambahkan header `Content-Security-Policy: script-src 'self'` sebagai lapisan kedua.

Jika fitur komentar tidak penting secara bisnis, **matikan saja.** Itu perbaikan paling murah.

**Cara menguji**

- POST 3 MB: hasil 413, dan tidak ada baris baru.
- POST 6 kali dari satu IP: request ke-6 mendapat 429.
- POST `<img src=x onerror=alert(1)>`, setujui, buka halaman: tidak ada alert.
- Seed 100 ribu komentar, lalu `GET`: respons ≤ 50 item, < 20 ms, dan `EXPLAIN QUERY PLAN` menunjukkan `idx_comments_target`.

**Biaya:** 1–2 jam.

---

## B. Yang BUKAN masalah (tapi sering dituduh)

| Tuduhan | Kenyataan, dengan angka |
|---|---|
| "SQLite tidak untuk produksi" | 500 req/menit ≈ 8 req/detik. SQLite WAL dengan `synchronous=NORMAL` sanggup 5.000–50.000 insert/detik di SSD. Headroom **>500×**. |
| "Butuh Postgres untuk 10.000 token" | 10.000 baris × ~500 byte = **5 MB**. Lookup `token_hash` lewat UNIQUE index: B-tree dengan ~3 level, < 20 µs. |
| "1 juta event terlalu banyak" | 1 juta × ~400 byte ≈ **400 MB**, muat utuh di page cache OS dengan RAM 6 GB. Masalahnya bukan jumlah baris, tetapi query tanpa index (A4) dan DELETE masif (A3). |
| "1 CPU tidak cukup" | Jika request rata-rata memakan 2 ms CPU, 8 req/detik = **1,6% CPU**. TLS ditangani Cloudflare. CPU baru penting saat ada query lambat (lihat E). |
| "50 admin bersamaan itu berat" | 50 admin × 1 load/30 detik ≈ 1,7 req/detik. Dengan query < 5 ms setelah A4, beban ini **tidak terasa**. Masalahnya ada pada query lambat, bukan pada jumlah admin. |
| "Butuh Redis untuk rate limit/cache" | Satu proses berarti Map di memori sudah konsisten dan lebih cepat (ns vs ~0,3 ms RTT Redis). Redis baru diperlukan saat ada lebih dari satu proses. |
| "Tanpa framework tidak akan scale" | Throughput `node:http` mentah ≥ Express. Framework tidak menambah kapasitas. |
| "Sync API = buruk" | Query < 1 ms secara sinkron justru lebih cepat daripada async (tanpa overhead threadpool dan Promise). Sync API hanya berbahaya untuk operasi panjang, dan itu sudah dibahas di A3, A4, A7, dan E. |
| "100.000 pengunjung/bulan itu besar" | Itu rata-rata ~0,04 pengunjung/detik. Dengan 20 request per kunjungan, hasilnya < 1 req/detik rata-rata. |

---

## C. Batas jujur sistem ini

Arsitektur ini (1 proses Node, SQLite sinkron, 1 CPU) **benar-benar tidak cukup** saat salah satu kondisi berikut tercapai, mana pun yang lebih dulu:

| Pemicu | Ambang konkret | Gejala terukur |
|---|---|---|
| Throughput request | ~**300–500 req/detik berkelanjutan** (±40–60× skenario puncak Anda) | CPU > 70% berkelanjutan, p99 event loop delay > 100 ms setelah A1–A8 beres |
| Query analitik | `analytics_events` > **~20–30 juta baris** dengan agregasi ad-hoc (funnel, distinct per periode) | Query dashboard > 1 detik meskipun sudah ber-index dan di-cache |
| Ukuran data panas | Data yang sering dibaca > **~4 GB** (melebihi page cache) | Lonjakan I/O wait di `vmstat`, latensi tidak stabil |
| Ketersediaan | Kontrak menjanjikan **> 99,9%** (≤ 43 menit downtime/bulan) | Satu VPS tidak punya failover. Reboot kernel, deploy, atau gangguan host sudah menghabiskan kuota |
| Banyak penulis | Butuh > 1 proses atau server menulis bersamaan | `SQLITE_BUSY`, kebutuhan Redis untuk state bersama |

Untuk skenario yang dinilai (500 req/menit, 1 juta event), **sistem ini cukup dengan headroom besar**, asalkan A1–A8 dikerjakan.

### Penggantinya, bertahap (jangan lompat)

1. **Pisahkan analytics ke file SQLite sendiri** (`analytics.db`, ditulis lewat `worker_threads` atau batch setiap 1 detik). Biaya sehari kerja. Hasilnya: jalur auth tidak lagi berbagi lock, cache, dan backup dengan data besar.
2. **Naikkan VPS ke 2 CPU** dan jalankan worker analitik di core kedua. Murah dan memberi ~2× kapasitas.
3. **Saat butuh HA atau multi-server:** pindahkan data transaksional ke **PostgreSQL** (managed, misalnya ~$15–30/bulan), dan analytics ke **ClickHouse** (atau DuckDB atas Parquet untuk laporan offline). Ini proyek 1–3 minggu. Lakukan hanya jika pemicu di tabel di atas benar-benar terlihat di metrik, bukan karena dugaan.

---

## D. Urutan kerja

Skor: dampak (1–5) × kemudahan (1–5).

### SEKARANG (minggu ini, total ±1 hari)

| # | Temuan | Alasan | Biaya |
|---|---|---|---|
| 1 | **A8** komentar: batas ukuran, LIMIT, moderasi, escape | Dapat dieksploitasi hari ini, dampaknya DoS total dan XSS | 1–2 jam |
| 2 | **A2** sumber IP rate limit | Prasyarat bagi A8 dan A6. Tanpa ini, semua rate limit ilusi | 25 menit |
| 3 | **A7** backup off-thread + off-site + uji restore | Risiko kehilangan data total. Restore yang belum diuji = tidak punya backup | 2–3 jam |
| 4 | **A1** heartbeat SLA per request | Sumber pertumbuhan data terbesar, mudah dihentikan | (lihat A1) |
| 5 | **A3** index + `auto_vacuum=INCREMENTAL` + `VACUUM` sekali | **Hanya murah selagi DB kecil.** Setahun lagi, `VACUUM` ini butuh downtime | 45 menit |
| 6 | **A5** `busy_timeout`, `synchronous=NORMAL`, throttle `last_seen` | Tiga baris kode, menghapus fsync per request | 30 menit |
| 7 | **E** metrik event loop delay di `/healthz` | Tanpa ini, Anda tidak tahu kapan langkah lain diperlukan | 15 menit |

### NANTI (sebelum `analytics_events` > ~200 ribu baris, atau dalam 1–2 bulan)

| Temuan | Alasan |
|---|---|
| **A4** ubah `ORDER BY id`, index tambahan, cache 60 detik | Belum terasa pada 303 event, tetapi menjadi kritis pada ratusan ribu baris |
| **A3** jadwal `prune()` harian | Index sudah ada dari langkah 5. Penjadwalan cukup dipasang sebelum data mencapai umur retensi |
| **A6** sweep dan batas Map, batas cache | Pertumbuhan ~20 MB/bulan. Penting, tetapi tidak darurat setelah A2 menutup pemalsuan IP |
| Litestream (jika belum di langkah 3) | Menurunkan RPO dari 24 jam ke detik |

### TIDAK PERLU (pada skala yang dinilai)

- Migrasi ke Postgres, Redis, atau cluster Node.
- Mengganti ke framework HTTP.
- Sharding atau memisahkan DB per tenant.
- Message queue untuk analytics (batch insert dalam satu transaksi setiap 1 detik sudah cukup jika suatu saat diperlukan).

---

## E. Satu hal yang paling sering dilewatkan

**Di sistem ini, tidak ada konkurensi sama sekali. Seluruh server adalah satu antrean tunggal, dan setiap operasi sinkron yang lambat menahan *semua* pengguna.**

Insinyur melihat "Node.js = async, non-blocking" lalu berasumsi satu admin dengan query lambat hanya memperlambat dirinya sendiri. Dengan `node:sqlite` (`Datab
---

## E. Satu hal yang paling sering dilewatkan

## E. Konkurensi semu: satu antrean untuk semua

**1. Lanjutan kalimat terpotong**

"…Dengan node:sqlite (DatabaseSync), setiap `prepare().all()`, `run()`, atau `exec()` berjalan **di thread event loop itu sendiri**. Selama query berjalan, Node.js tidak menerima koneksi baru, tidak membaca body request, tidak menjalankan callback timer, dan tidak mengirim respons yang sebenarnya sudah siap. Satu `SELECT` 500 ms berarti server **membeku total** selama 500 ms bagi semua orang, baik pengunjung publik, pemegang token, maupun admin lain."

**2. Kenapa "async = tidak saling memblokir" salah di sini**

Node.js hanya non-blocking untuk operasi yang **diserahkan ke luar thread utama**, misalnya socket, `fs.promises`, atau driver DB async. Selama menunggu operasi seperti itu, event loop bebas melayani request lain.

DatabaseSync tidak menyerahkan apa pun. Kerja CPU dan I/O SQLite dilakukan langsung di call stack JavaScript. Kata kunci `async` pada handler juga tidak membantu, karena `await` atas nilai sinkron tidak memindahkan kerja ke tempat lain. Akibatnya:

- Konkurensi efektif untuk kerja DB = **1**.
- Server berperilaku seperti antrean M/D/1 dengan satu kasir.
- Latensi setiap request = waktu kerjanya sendiri + **total kerja sinkron semua request yang tiba sebelumnya**.

Mode WAL mengizinkan banyak pembaca bersamaan **antar-koneksi**. Namun di sini hanya ada satu koneksi di satu thread, sehingga keuntungan itu tidak terpakai.

**3. Angka konkret**

Beban puncak 500 req/menit ≈ **8,3 req/detik**, dengan asumsi request normal butuh ~3–5 ms.

*Satu query admin 500 ms:*
- Selama 500 ms itu masuk ~**4 request**.
- Request yang tiba tepat saat query mulai menunggu ~500 ms. Rata-rata keempatnya menunggu ~**250 ms ekstra**.
- Latensi mereka naik dari ~5 ms menjadi 250–500 ms, atau **50–100×**.

*Efek ke persentil*, tergantung frekuensi query lambat:

| Query 500 ms per menit | Request terdampak | p95 | p99 |
|---|---|---|---|
| 1 | ~4/500 = 0,8% | tetap ~5 ms | naik ke ~250–400 ms |
| 10 | ~40/500 = 8% | naik ke ~200–300 ms | ~450 ms+ |
| 50 (50 admin refresh/menit, tanpa cache) | lihat di bawah | rusak | rusak |

Baris terakhir tidak bisa diisi sebagai persentase. 50 × 0,5 s = **25 detik kerja blokir per menit**, artinya **42% waktu** event loop habis untuk admin. Pada utilisasi setinggi ini, antrean menumpuk secara nonlinier. Request publik bisa tertahan beberapa query berturut-turut (1–2 detik), dan rata-rata pun ikut naik, bukan hanya ekor distribusi.

Pelajarannya: **rata-rata latensi menipu**. Pada kasus 1 query/menit, rata-rata hanya naik ~2 ms, sementara p99 naik ~80×. Inilah alasan cache 60 s di A4 bukan sekadar optimasi. Cache itu mengubah "50 blokir/menit" menjadi "1 blokir/menit".

**4. Implikasi arsitektur**

- **Biaya diukur dalam milidetik blokir, bukan jumlah query.** Pertanyaan yang tepat untuk setiap fitur adalah "berapa ms event loop dibekukan, berapa kali per menit?" Contoh: 20 query × 2 ms aman, sedangkan 1 query × 500 ms berbahaya.
- **Semua kerja besar harus dipecah atau dipindah:**
  - DELETE retensi (A3) dan agregasi (A1) dijalankan per batch kecil (misalnya 500 baris, <20 ms), dengan `setImmediate()` di antara batch agar request bisa diselingi.
  - Query analytics berat dan backup (A7) dipindah ke **`worker_threads` dengan koneksi DatabaseSync sendiri**. Dengan WAL, worker membaca paralel tanpa memblokir thread utama. Di 1 CPU tidak ada paralelisme sejati, tetapi scheduler OS membagi waktu, sehingga request pendek tidak lagi menunggu query panjang selesai seluruhnya.
- **Dashboard admin berbasis pra-agregasi**, bukan scan saat dibuka. Tabel ringkasan diperbarui per menit agar query admin selalu <5 ms.
- **Metrik wajib:** pasang `perf_hooks.monitorEventLoopDelay()` dan laporkan **p99 event loop lag** di endpoint health/metrik. Bersamaan dengan itu, log setiap operasi DB >20 ms beserta nama query-nya. Metrik ini langsung menunjukkan siapa yang membekukan server, sesuatu yang tidak terlihat dari CPU% (bisa saja hanya 15% sementara p99 sudah 500 ms).
- **Jangan buru-buru ganti DB.** Masalahnya ada pada durasi operasi sinkron, bukan SQLite. Postgres dengan query 500 ms juga lambat, hanya saja tidak membekukan semua orang.

**5. Aturan praktis**

> **Tidak boleh ada satu operasi sinkron >20 ms di thread utama. Yang lebih lama harus dipecah per batch atau dipindah ke worker. Ukur kepatuhannya dengan p99 event loop lag <50 ms.**

Logika di baliknya: di sistem ini, **setiap milidetik yang dipakai satu pengguna adalah milidetik yang dicuri dari semua pengguna lain.**