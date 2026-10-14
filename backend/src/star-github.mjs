/**
 * STAR GITHUB — verifikasi bahwa pengguna benar-benar memberi star.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA DIPERIKSA, BUKAN DIPERCAYA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Tombol "saya sudah star" tanpa verifikasi bisa diklik siapa saja — termasuk
 * orang yang tidak punya akun GitHub, atau yang membuat sepuluh akun untuk
 * mengklaim bonus sepuluh kali. Trial ini adalah hadiah, dan hadiah yang bisa
 * diklaim tanpa syarat bukan hadiah — ia sekadar tombol.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA API PUBLIK, BUKAN OAUTH
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Dipilih pemilik proyek. Bedanya:
 *
 *   API publik   pengguna mengetik username GitHub-nya; kita tanya GitHub
 *                "apakah @username memberi star repo ini?" — jawabannya bisa
 *                dipercaya, dan tidak ada setup aplikasi GitHub
 *
 *   OAuth        pengguna login lewat GitHub; kita tahu PASTI itu akunnya
 *                karena dia membuktikan kepemilikannya. Lebih kuat, tapi
 *                butuh membuat GitHub App, menyimpan client secret, dan
 *                menangani callback.
 *
 * ── BATAS YANG PERLU DIKETAHUI DARI API PUBLIK ─────────────────────────────
 * Kita mempercayai bahwa orang yang mengetik username memang PEMILIK username
 * itu. Jadi seseorang bisa mengetik username orang lain yang kebetulan sudah
 * memberi star, dan mendapat trial.
 *
 * Risikonya kecil dan disengaja: trial ini hanya 1×, dan yang didapat adalah
 * MELIHAT data metrik — bukan mengunduh kode, bukan mengubah apa pun. Kalau
 * nanti ini jadi masalah nyata, jalannya adalah pindah ke OAuth — dan
 * `verifikasiStar()` adalah satu-satunya fungsi yang perlu diganti.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * REPO YANG DIPERIKSA
 * ══════════════════════════════════════════════════════════════════════════
 * Dua repo, dan star di SALAH SATU sudah cukup. Alasannya: pengunjung yang
 * menemukan halaman ini dari repo portofolio mungkin tidak tahu repo proyek
 * ada, dan sebaliknya. Memaksa keduanya menambah langkah tanpa menambah makna.
 */

import { getDb, now } from './db.mjs';

/** Repo yang starnya dihitung. Salah satu cukup. */
export const REPO_DIPERIKSA = [
  // Profile README — repo publik, dan yang paling masuk akal untuk di-star:
  // pengunjung yang menemukan profil GitHub ini melihatnya lebih dulu.
  'VicterHong/VicterHong',
  // Repo situs portofolio (publik — GitHub Pages).
  'VicterHong/VicterHong.github.io',
];

/**
 * ── CATATAN: REPO PORTOFOLIO PRIBADI TIDAK DIPAKAI ─────────────────────────
 *
 * `VicterHong/portfolio-victer` (repo sumber situs ini) bersifat PRIVAT, dan
 * itu keputusan pemilik proyek: "itu aset berharga".
 *
 * Konsekuensinya untuk fitur ini: repo privat TIDAK BISA di-star. GitHub
 * tidak menyediakan tombol star di repo yang tidak bisa dilihat, dan API-nya
 * menjawab 404 untuk repo yang tidak punya akses.
 *
 * Kalau repo itu dimasukkan ke daftar, endpoint stargazers-nya akan selalu
 * menjawab 404 — dan pengguna yang sudah star repo lain akan tetap ditolak
 * selama pemeriksaan berhenti di repo yang salah.
 *
 * Jadi daftar ini hanya berisi repo PUBLIK. Kalau nanti repo portofolio
 * dijadikan publik, ia bisa ditambahkan di sini.
 */

/** Berapa lama hasil pemeriksaan di-cache, dalam milidetik. */
const MASA_CACHE = 6 * 60 * 60 * 1000; // 6 jam

/**
 * Validasi bentuk username GitHub SEBELUM memanggil API.
 *
 * ── KENAPA INI PENTING ─────────────────────────────────────────────────────
 * Username yang dikirim langsung ke URL bisa menyuntikkan path atau query:
 *
 *     "../../users/admin"    → menembus path
 *     "foo?per_page=9999"    → mengubah permintaan
 *     "foo%00bar"            → karakter null
 *
 * Aturan GitHub: huruf, angka, dan tanda hubung; maksimal 39 karakter; tidak
 * boleh diawali atau diakhiri tanda hubung. Yang tidak cocok DITOLAK di sini,
 * jadi tidak pernah sampai ke URL.
 */
export function usernameSah(username) {
  if (typeof username !== 'string') return false;
  const bersih = username.trim();
  if (bersih.length < 1 || bersih.length > 39) return false;
  if (!/^[a-zA-Z0-9-]+$/.test(bersih)) return false;
  if (bersih.startsWith('-') || bersih.endsWith('-')) return false;
  return true;
}

/**
 * Tanya GitHub: apakah `username` memberi star salah satu repo?
 *
 * Mengembalikan `{ starred, repo, dariCache, error }`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * BUG YANG DIPERBAIKI: ENDPOINT YANG DIPAKAI BUTUH AUTENTIKASI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Versi pertama memakai:
 *
 *     GET /repos/{owner}/{repo}/stargazers/{username}
 *
 * Endpoint itu TERLIHAT tepat — ia menjawab 204 kalau user sudah star, dan
 * 404 kalau belum. Tapi ia BUTUH AUTENTIKASI. Diuji tanpa token GitHub:
 *
 *     /repos/cloudflare/workers-sdk/stargazers/octocat  → HTTP 404
 *     /repos/cloudflare/workers-sdk/stargazers           → HTTP 401
 *                                                    "Requires authentication"
 *
 * Artinya: setiap pengguna yang SUDAH star akan tetap ditolak, selamanya —
 * dan tidak ada cara memperbaikinya dari sisi pengguna. Kegagalannya juga
 * tidak terlihat sebagai error, hanya sebagai "belum star".
 *
 * ── ENDPOINT YANG BENAR ────────────────────────────────────────────────────
 *     GET /users/{username}/starred
 *
 * Publik, tanpa autentikasi. Diuji:
 *     user ada + punya star    → array berisi repo
 *     user ada + tidak star    → array kosong
 *     user tidak ada           → 404
 *
 * Tiga keadaan yang bisa dibedakan — dan itu yang dibutuhkan.
 *
 * ── KENAPA DIPERIKSA PER HALAMAN, BUKAN SATU REPO ──────────────────────────
 * Daftar repo yang di-star bisa panjang (ratusan). Memeriksa satu per satu
 * dengan `/repos/.../stargazers/...` berarti satu permintaan per repo.
 * Dengan `/users/.../starred` kita mengambil daftarnya dan mencari di dalamnya
 * — satu permintaan, berapa pun jumlah repo yang diperiksa.
 *
 * ── BATAS: 100 REPO PERTAMA ────────────────────────────────────────────────
 * Endpoint ini mengembalikan 30 per halaman (maks 100 dengan `per_page`).
 * Kalau pengguna punya lebih dari 100 star, repo kita mungkin tidak ada di
 * halaman pertama.
 *
 * Untuk kasus itu, halaman berikutnya diambil — maksimal 3 halaman (300 repo).
 * Batas 3 dipilih supaya tidak ada pengguna dengan 5.000 star yang memicu
 * 50 permintaan ke GitHub hanya untuk satu pemeriksaan.
 */
export async function verifikasiStar(username, { paksa = false } = {}) {
  const bersih = String(username || '').trim();

  if (!usernameSah(bersih)) {
    return { starred: false, repo: null, dariCache: false, error: 'username_tidak_sah' };
  }

  const kunci = bersih.toLowerCase();
  const db = getDb();

  // ── Cache ────────────────────────────────────────────────────────────────
  // Tanpa cache, setiap kali halaman dibuka kita memanggil GitHub. Batas
  // GitHub untuk permintaan tanpa token adalah 60 per jam per IP — dan IP
  // server dipakai bersama semua pengunjung. Beberapa orang membuka halaman
  // bersamaan sudah cukup untuk menghabiskan jatah itu.
  if (!paksa) {
    const cache = db
      .prepare('SELECT starred, dicek_at FROM star_cache WHERE github_user = ?')
      .get(kunci);

    if (cache && now() - cache.dicek_at < MASA_CACHE) {
      return {
        starred: Boolean(cache.starred),
        repo: null,
        dariCache: true,
        error: null,
      };
    }
  }

  const repoDicari = new Set(REPO_DIPERIKSA.map((r) => r.toLowerCase()));

  // Maksimal 3 halaman × 100 = 300 repo terakhir yang di-star.
  for (let halaman = 1; halaman <= 3; halaman++) {
    const url = `https://api.github.com/users/${encodeURIComponent(bersih)}/starred`
      + `?per_page=100&page=${halaman}`;

    let res;
    try {
      res = await fetch(url, {
        headers: {
          // GitHub menolak permintaan tanpa User-Agent.
          'user-agent': 'portfolio-victer/1.0',
          accept: 'application/vnd.github+json',
        },
        // Batas waktu 6 detik: kalau GitHub lambat, lebih baik memberi tahu
        // pengguna "coba lagi" daripada membuatnya menunggu tanpa batas.
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      // Jaringan gagal atau waktu habis. JANGAN cache kegagalan — nanti
      // pengguna yang sudah star tetap ditolak selama 6 jam.
      return { starred: false, repo: null, dariCache: false, error: 'github_tidak_jawab' };
    }

    if (res.status === 404) {
      // Username tidak ada di GitHub. Ini BUKAN "belum star" — usernamenya
      // yang salah, dan pengguna perlu tahu itu supaya bisa memperbaikinya.
      return { starred: false, repo: null, dariCache: false, error: 'username_tidak_ada' };
    }

    if (res.status === 403 || res.status === 429) {
      // Batas laju GitHub tercapai. Jangan cache: jawabannya tidak diketahui.
      return { starred: false, repo: null, dariCache: false, error: 'batas_github' };
    }

    if (!res.ok) {
      return { starred: false, repo: null, dariCache: false, error: 'github_tidak_jawab' };
    }

    let daftar;
    try {
      daftar = await res.json();
    } catch {
      return { starred: false, repo: null, dariCache: false, error: 'github_tidak_jawab' };
    }

    if (!Array.isArray(daftar)) {
      return { starred: false, repo: null, dariCache: false, error: 'github_tidak_jawab' };
    }

    // Cari repo kita di halaman ini.
    for (const repo of daftar) {
      const nama = String(repo?.full_name || '').toLowerCase();
      if (repoDicari.has(nama)) {
        simpanCache(kunci, true);
        // Kembalikan nama repo dalam bentuk asli (bukan lowercase).
        return {
          starred: true,
          repo: REPO_DIPERIKSA.find((r) => r.toLowerCase() === nama) || nama,
          dariCache: false,
          error: null,
        };
      }
    }

    // Halaman terakhir (kurang dari 100) → tidak ada lagi yang perlu diperiksa.
    if (daftar.length < 100) break;
  }

  // Sudah memeriksa semua halaman, repo kita tidak ada di daftarnya.
  simpanCache(kunci, false);
  return { starred: false, repo: null, dariCache: false, error: null };
}

/** Simpan hasil ke cache. Kegagalan menyimpan tidak boleh menggagalkan jawaban. */
function simpanCache(kunci, starred) {
  try {
    getDb().prepare(`
      INSERT INTO star_cache (github_user, starred, dicek_at) VALUES (?, ?, ?)
      ON CONFLICT(github_user) DO UPDATE SET starred = excluded.starred, dicek_at = excluded.dicek_at
    `).run(kunci, starred ? 1 : 0, now());
  } catch {
    // Cache adalah percepatan, bukan kebenaran. Kalau gagal menyimpan,
    // jawaban yang sudah dihitung tetap benar — hanya lebih lambat lain kali.
  }
}

/** Buang cache satu username. Dipakai saat pengguna bilang "saya baru star". */
export function lupakanCache(username) {
  const kunci = String(username || '').trim().toLowerCase();
  if (!kunci) return;
  getDb().prepare('DELETE FROM star_cache WHERE github_user = ?').run(kunci);
}
