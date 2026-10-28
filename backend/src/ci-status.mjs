/**
 * CI/CD — STATUS PIPELINE & CAKUPAN TES
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DISELESAIKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Halaman portofolio mengklaim "1.428 tes otomatis". Klaim itu tidak bisa
 * diperiksa pengunjung — ia harus percaya begitu saja.
 *
 * Modul ini mengambil data NYATA dari GitHub: status workflow terakhir, waktu
 * selesainya, dan commit yang diuji. Jadi klaimnya bisa dibuktikan, bukan
 * diminta dipercaya.
 *
 * ── KENAPA LEWAT BACKEND, BUKAN LANGSUNG DARI BROWSER ───────────────────────
 * Browser bisa memanggil api.github.com langsung, tapi tiga alasan membuat
 * itu pilihan yang buruk:
 *
 *   1. BATAS LAJU. GitHub membatasi 60 permintaan/jam per IP. Satu pengunjung
 *      yang membuka halaman beberapa kali bisa menghabiskannya, dan badge-nya
 *      rusak untuk SEMUA pengunjung dari jaringan itu.
 *
 *   2. TANPA CACHE. Setiap tampilan halaman = satu permintaan ke GitHub.
 *      Dengan 1.000 pengunjung sehari, itu 1.000 permintaan untuk data yang
 *      berubah mungkin sekali sejam.
 *
 *   3. CSP. Halaman kita memakai CSP ketat. Mengizinkan api.github.com di
 *      `connect-src` membuka jalur keluar dari halaman kita — dan itu
 *      permukaan serangan yang tidak perlu.
 *
 * Lewat backend: satu cache di server, satu tempat yang bisa menangani
 * kegagalan GitHub dengan rapi.
 */

import { config } from './config.mjs';

/* ══ KONFIGURASI ═══════════════════════════════════════════════════════════ */

/**
 * Repo yang statusnya ditampilkan.
 *
 * ── KENAPA DITULIS DI SINI, BUKAN DARI INPUT ─────────────────────────────────
 * Nilai ini dipakai untuk MEMBENTUK URL ke api.github.com. Kalau datang dari
 * input pengguna, siapa pun bisa menyuruh server kita memanggil URL apa pun
 * (SSRF). Konstanta menghilangkan seluruh kelas masalah itu.
 */
const REPO = 'VicterHong/VicterHong.github.io';

/**
 * Berapa lama hasil disimpan (ms).
 *
 * ── KENAPA 5 MENIT ───────────────────────────────────────────────────────────
 * CI selesai dalam ~1 menit, tapi build tidak terjadi tiap menit. Lima menit
 * membuat badge terasa "hidup" tanpa memanggil GitHub untuk setiap pengunjung.
 *
 * Dengan 5 menit: 1.000 pengunjung sehari menghasilkan paling banyak 288
 * permintaan ke GitHub — jauh di bawah batas 60/jam.
 */
const TTL_CACHE_MS = 5 * 60 * 1000;

/**
 * Batas waktu permintaan ke GitHub (ms).
 *
 * ── KENAPA HARUS ADA ─────────────────────────────────────────────────────────
 * Tanpa batas waktu, satu permintaan yang menggantung menahan satu koneksi
 * server. Beberapa yang menggantung bersamaan bisa membuat halaman ini lambat
 * untuk semua orang — hanya karena GitHub sedang lambat.
 */
const TIMEOUT_MS = 8000;

/* ══ CACHE ═════════════════════════════════════════════════════════════════ */

let cache = { data: null, dibacaAt: 0 };

/** Buang cache — dipakai tes, dan saat ada yang ingin memaksa segar. */
export function lupakanCache() {
  cache = { data: null, dibacaAt: 0 };
}

/* ══ AMBIL DATA ════════════════════════════════════════════════════════════ */

/**
 * Ambil status workflow terakhir dari GitHub.
 *
 * @param {object} [p]
 * @param {Function} [p.fetchImpl]  fetch tiruan untuk tes
 * @param {number}   [p.sekarang]
 * @returns {Promise<object>} selalu objek — tidak pernah melempar
 */
export async function ambilStatusCI({ fetchImpl = fetch, sekarang = Date.now() } = {}) {
  // ── CACHE DIPERIKSA DULU ──────────────────────────────────────────────────
  if (cache.data && sekarang - cache.dibacaAt < TTL_CACHE_MS) {
    return { ...cache.data, dariCache: true };
  }

  const hasil = await ambilDariGitHub({ fetchImpl, sekarang });

  // ── HASIL GAGAL TIDAK DISIMPAN ────────────────────────────────────────────
  // Kalau GitHub sedang down dan kita menyimpan kegagalannya selama 5 menit,
  // badge-nya rusak selama 5 menit padahal GitHub mungkin pulih dalam 10 detik.
  if (hasil.ok) {
    cache = { data: hasil, dibacaAt: sekarang };
  }

  return hasil;
}

async function ambilDariGitHub({ fetchImpl, sekarang }) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/ci.yml/runs?per_page=1&branch=main&event=push`;

  let res;
  try {
    res = await fetchImpl(url, {
      headers: {
        // ── HEADER WAJIB DARI GITHUB API ──────────────────────────────────────
        // Tanpa User-Agent, GitHub menolak permintaan dengan 403.
        // Tanpa Accept, jawabannya bisa berubah bentuk tanpa pemberitahuan.
        'user-agent': 'portfolio-victer-ci-badge',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Termasuk timeout dan kegagalan jaringan.
    return gagal(err?.name === 'TimeoutError' ? 'github_timeout' : 'github_tidak_terjangkau');
  }

  if (!res.ok) {
    // 404 = repo privat atau tidak ada. 403 = batas laju habis.
    return gagal(res.status === 404 ? 'repo_tidak_ditemukan' : `github_${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return gagal('jawaban_bukan_json');
  }

  const run = data?.workflow_runs?.[0];
  if (!run) {
    // Repo ada, tapi belum pernah ada workflow yang jalan.
    return gagal('belum_ada_workflow');
  }

  return {
    ok: true,
    // ── KESIMPULAN: 'success' | 'failure' | 'cancelled' | null ────────────────
    // `null` berarti masih berjalan. Dibedakan dari 'failure' — badge yang
    // menampilkan "gagal" untuk build yang sedang jalan akan menyesatkan.
    status: run.status,
    kesimpulan: run.conclusion,
    nama: run.name,
    nomor: run.run_number,
    cabang: run.head_branch,
    commit: String(run.head_sha ?? '').slice(0, 7),
    judulCommit: String(run.display_title ?? '').slice(0, 120),
    // Waktu mulai & selesai dalam ISO — frontend yang mengubahnya jadi
    // "3 menit lalu", karena hanya browser yang tahu zona waktu pembaca.
    mulaiAt: run.run_started_at,
    selesaiAt: run.updated_at,
    // ── DURASI DIHITUNG DI SINI ───────────────────────────────────────────────
    // Dihitung di server supaya kedua waktu itu tidak perlu dikirim dan
    // dikurangi lagi di frontend. Satu tempat, satu hasil.
    durasiDetik: hitungDurasi(run.run_started_at, run.updated_at),
    tautan: run.html_url,
    repo: REPO,
    diambilAt: new Date(sekarang).toISOString(),
  };
}

function gagal(alasan) {
  return { ok: false, alasan, pesan: pesanGagal(alasan) };
}

/**
 * Hitung durasi antara dua waktu ISO.
 *
 * Mengembalikan null kalau salah satu tidak ada atau tidak bisa diurai —
 * bukan NaN, yang akan tampil sebagai "NaN detik" di halaman.
 */
function hitungDurasi(mulai, selesai) {
  if (!mulai || !selesai) return null;
  const a = Date.parse(mulai);
  const b = Date.parse(selesai);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const detik = Math.round((b - a) / 1000);
  // Waktu yang tidak masuk akal (negatif, atau lebih dari sehari) diabaikan.
  if (detik < 0 || detik > 86_400) return null;
  return detik;
}

/** Pesan yang enak dibaca untuk tiap alasan gagal. */
function pesanGagal(alasan) {
  const peta = {
    github_timeout: 'GitHub tidak menjawab tepat waktu.',
    github_tidak_terjangkau: 'Tidak bisa menghubungi GitHub.',
    repo_tidak_ditemukan: 'Repositori tidak ditemukan.',
    belum_ada_workflow: 'Belum ada pipeline yang dijalankan.',
    jawaban_bukan_json: 'Jawaban GitHub tidak bisa dibaca.',
  };
  return peta[alasan] ?? `Status CI tidak tersedia (${alasan}).`;
}

/* ══ JUMLAH TES ════════════════════════════════════════════════════════════ */

/**
 * Jumlah tes yang dijalankan.
 *
 * ── KENAPA DARI projects.js, BUKAN DARI GITHUB ───────────────────────────────
 * GitHub tidak melaporkan jumlah tes — ia hanya tahu lulus atau gagal. Jumlah
 * tes yang ditampilkan di halaman datang dari `projects.js`, dan preflight
 * memastikan angka itu cocok dengan yang tertulis di halaman.
 *
 * Jadi angkanya tetap satu sumber, dan badge ini melengkapinya dengan BUKTI
 * bahwa tesnya benar-benar dijalankan.
 */
export function ringkasCI() {
  return {
    repo: REPO,
    jalurWorkflow: `.github/workflows/ci.yml`,
    intervalCacheDetik: TTL_CACHE_MS / 1000,
  };
}
