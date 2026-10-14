/**
 * Tes status CI dari GitHub.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * YANG PALING PENTING DIUJI DI SINI
 * ══════════════════════════════════════════════════════════════════════════════
 * Bukan "data berhasil diambil" — itu bagian yang mudah. Yang menentukan
 * apakah badge ini layak ditampilkan di halaman publik:
 *
 *   1. GitHub yang error TIDAK merusak halaman (selalu ada jawaban)
 *   2. Kegagalan TIDAK disimpan di cache (tidak rusak 5 menit)
 *   3. Build yang masih berjalan TIDAK dilaporkan "gagal"
 *   4. Cache benar-benar menghemat permintaan
 *
 * Kalau nomor 1 gagal, halaman portofolio rusak setiap kali GitHub lambat —
 * dan itu terjadi lebih sering daripada yang orang duga.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ambilStatusCI, lupakanCache, ringkasCI } from '../src/ci-status.mjs';

beforeEach(() => {
  lupakanCache();
});

/* ══ PEMBUAT JAWABAN TIRUAN ════════════════════════════════════════════════ */

function jawabanGitHub(ubah = {}) {
  const run = {
    name: 'CI',
    run_number: 310,
    head_branch: 'main',
    head_sha: '0b5a076baa4967bd3747a25a268845097d5298f2',
    display_title: 'feat(sentinel): mode keamanan Pro',
    status: 'completed',
    conclusion: 'success',
    run_started_at: '2026-10-14T15:01:51Z',
    updated_at: '2026-10-14T15:02:47Z',
    html_url: 'https://github.com/VicterHong/VicterHong.github.io/actions/runs/310',
    ...ubah,
  };

  return {
    ok: true,
    status: 200,
    json: async () => ({ total_count: 1, workflow_runs: [run] }),
  };
}

/** fetch tiruan yang menghitung berapa kali dipanggil. */
function fetchTiruan(jawaban, penghitung = { n: 0 }) {
  const f = async () => {
    penghitung.n += 1;
    if (typeof jawaban === 'function') return jawaban();
    if (jawaban instanceof Error) throw jawaban;
    return jawaban;
  };
  f.penghitung = penghitung;
  return f;
}

/* ══ 1. JALUR SUKSES ═══════════════════════════════════════════════════════ */

test('mengambil status workflow terakhir', async () => {
  const f = fetchTiruan(jawabanGitHub());
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, true);
  assert.equal(r.kesimpulan, 'success');
  assert.equal(r.nama, 'CI');
  assert.equal(r.nomor, 310);
  assert.equal(r.cabang, 'main');
});

test('commit dipotong jadi 7 karakter', async () => {
  const f = fetchTiruan(jawabanGitHub());
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.commit, '0b5a076');
  assert.equal(r.commit.length, 7);
});

test('durasi dihitung dari waktu mulai & selesai', async () => {
  const f = fetchTiruan(jawabanGitHub());
  const r = await ambilStatusCI({ fetchImpl: f });

  // 15:01:51 → 15:02:47 = 56 detik
  assert.equal(r.durasiDetik, 56);
});

/* ══ 2. STATUS YANG MASIH BERJALAN ═════════════════════════════════════════ */

test('build yang masih berjalan TIDAK dilaporkan gagal', async () => {
  // ── KENAPA INI DIUJI ──────────────────────────────────────────────────────
  // Saat workflow sedang jalan, GitHub mengirim `status: 'in_progress'` dan
  // `conclusion: null`. Frontend yang hanya memeriksa "kesimpulan === 'success'"
  // akan menampilkan "gagal" untuk build yang sebenarnya sedang berjalan.
  const f = fetchTiruan(jawabanGitHub({ status: 'in_progress', conclusion: null }));
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, true);
  assert.equal(r.status, 'in_progress');
  assert.equal(r.kesimpulan, null, 'kesimpulan harus null, bukan "failure"');
});

test('durasi null saat build belum selesai', async () => {
  const f = fetchTiruan(jawabanGitHub({ status: 'in_progress', conclusion: null, updated_at: null }));
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.durasiDetik, null, 'durasi harus null, bukan NaN');
});

test('durasi tidak masuk akal diabaikan', async () => {
  // Selesai SEBELUM mulai — data rusak. Harus null, bukan angka negatif.
  const f = fetchTiruan(jawabanGitHub({
    run_started_at: '2026-10-14T15:02:47Z',
    updated_at: '2026-10-14T15:01:51Z',
  }));
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.durasiDetik, null);
});

/* ══ 3. KEGAGALAN — TIDAK PERNAH MELEMPAR ══════════════════════════════════ */

test('GitHub timeout → hasil gagal, tidak melempar', async () => {
  const err = new Error('timeout');
  err.name = 'TimeoutError';
  const f = fetchTiruan(err);

  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'github_timeout');
  assert.ok(r.pesan, 'harus ada pesan yang enak dibaca');
});

test('jaringan mati → hasil gagal, tidak melempar', async () => {
  const f = fetchTiruan(new Error('ECONNREFUSED'));
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'github_tidak_terjangkau');
});

test('repo tidak ada (404) → alasan jelas', async () => {
  const f = fetchTiruan({ ok: false, status: 404 });
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'repo_tidak_ditemukan');
});

test('batas laju habis (403) → alasan memuat kode', async () => {
  const f = fetchTiruan({ ok: false, status: 403 });
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'github_403');
});

test('jawaban bukan JSON → tidak melempar', async () => {
  const f = fetchTiruan({
    ok: true,
    status: 200,
    json: async () => { throw new Error('bukan json'); },
  });
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'jawaban_bukan_json');
});

test('belum ada workflow → alasan jelas', async () => {
  const f = fetchTiruan({
    ok: true,
    status: 200,
    json: async () => ({ total_count: 0, workflow_runs: [] }),
  });
  const r = await ambilStatusCI({ fetchImpl: f });

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'belum_ada_workflow');
});

test('setiap alasan gagal punya pesan yang enak dibaca', async () => {
  const kasus = [
    new Error('x'),
    { ok: false, status: 404 },
    { ok: false, status: 500 },
    { ok: true, status: 200, json: async () => ({}) },
  ];

  for (const jawaban of kasus) {
    const f = fetchTiruan(jawaban);
    const r = await ambilStatusCI({ fetchImpl: f });

    assert.equal(r.ok, false);
    assert.ok(typeof r.pesan === 'string' && r.pesan.length > 10,
      `pesan terlalu pendek untuk alasan ${r.alasan}: ${r.pesan}`);
  }
});

/* ══ 4. CACHE ══════════════════════════════════════════════════════════════ */

test('cache menghemat permintaan kedua', async () => {
  const f = fetchTiruan(jawabanGitHub());

  await ambilStatusCI({ fetchImpl: f });
  const kedua = await ambilStatusCI({ fetchImpl: f });

  assert.equal(f.penghitung.n, 1, 'permintaan kedua harus dilayani dari cache');
  assert.equal(kedua.dariCache, true);
});

test('cache kedaluwarsa setelah TTL', async () => {
  const f = fetchTiruan(jawabanGitHub());
  const t0 = Date.now();

  await ambilStatusCI({ fetchImpl: f, sekarang: t0 });
  // 6 menit kemudian — di atas TTL 5 menit.
  await ambilStatusCI({ fetchImpl: f, sekarang: t0 + 6 * 60 * 1000 });

  assert.equal(f.penghitung.n, 2, 'setelah TTL harus ambil ulang');
});

test('KEGAGALAN tidak disimpan di cache', async () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Kalau kegagalan disimpan selama 5 menit, badge-nya rusak 5 menit penuh
  // padahal GitHub mungkin pulih dalam 10 detik. Kegagalan sesaat menjadi
  // gangguan yang lama.
  let jawaban = new Error('ECONNREFUSED');
  const f = fetchTiruan(() => jawaban);

  const satu = await ambilStatusCI({ fetchImpl: f });
  assert.equal(satu.ok, false);

  // GitHub pulih.
  jawaban = jawabanGitHub();

  const dua = await ambilStatusCI({ fetchImpl: f });
  assert.equal(dua.ok, true, 'kegagalan tersimpan di cache — GitHub yang pulih tidak terlihat');
  assert.equal(f.penghitung.n, 2);
});

test('lupakanCache memaksa ambil ulang', async () => {
  const f = fetchTiruan(jawabanGitHub());

  await ambilStatusCI({ fetchImpl: f });
  lupakanCache();
  await ambilStatusCI({ fetchImpl: f });

  assert.equal(f.penghitung.n, 2);
});

/* ══ 5. HEADER PERMINTAAN ══════════════════════════════════════════════════ */

test('permintaan memakai header yang diwajibkan GitHub', async () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Tanpa User-Agent, GitHub menolak dengan 403. Itu terjadi DI PRODUKSI,
  // bukan di tes — karena fetch di Node otomatis menambahkan User-Agent
  // sendiri. Kalau kode kita bergantung pada perilaku itu, ia bisa rusak
  // saat runtime berubah.
  let headerDipakai = null;
  const f = async (url, opsi) => {
    headerDipakai = opsi?.headers;
    return jawabanGitHub();
  };

  await ambilStatusCI({ fetchImpl: f });

  assert.ok(headerDipakai['user-agent'], 'User-Agent wajib ada');
  assert.ok(headerDipakai.accept.includes('github'), 'Accept harus format GitHub');
  assert.ok(headerDipakai['x-github-api-version'], 'versi API harus dipatok');
});

test('URL memakai konstanta repo, bukan input', async () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Kalau repo datang dari input pengguna, siapa pun bisa menyuruh server
  // memanggil URL apa pun (SSRF). Konstanta menghilangkan kelas masalah itu.
  let urlDipakai = null;
  const f = async (url) => {
    urlDipakai = url;
    return jawabanGitHub();
  };

  await ambilStatusCI({ fetchImpl: f });

  assert.ok(urlDipakai.startsWith('https://api.github.com/repos/VicterHong/'));
  assert.ok(!urlDipakai.includes('..'), 'URL tidak boleh memuat traversal');
});

/* ══ 6. RINGKASAN ══════════════════════════════════════════════════════════ */

test('ringkasCI menyebut repo dan jalur workflow', () => {
  const r = ringkasCI();

  assert.equal(r.repo, 'VicterHong/VicterHong.github.io');
  assert.ok(r.jalurWorkflow.includes('ci.yml'));
  assert.ok(r.intervalCacheDetik > 0);
});
