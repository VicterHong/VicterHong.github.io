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
  'VicterHong/VicterHong.github.io',
  'VicterHong/portfolio-victer',
];

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
 * ── KENAPA SELALU MENGEMBALIKAN OBJEK, BUKAN BOOLEAN ──────────────────────
 * Pemanggil perlu membedakan tiga keadaan yang berbeda:
 *
 *   starred: true              → berhasil, beri bonus
 *   starred: false             → berhasil, tapi belum star — beri tahu caranya
 *   error: 'github_tidak_jawab'→ TIDAK TAHU. Ini bukan "belum star".
 *
 * Kalau fungsi ini mengembalikan boolean, keadaan ketiga jadi `false` — dan
 * pengguna yang sudah star akan diberi tahu "kamu belum star" hanya karena
 * GitHub sedang lambat. Itu membuatnya memberi star dua kali, atau menyerah.
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

  // ── Panggil GitHub ───────────────────────────────────────────────────────
  for (const repo of REPO_DIPERIKSA) {
    const url = `https://api.github.com/repos/${repo}/stargazers/${encodeURIComponent(bersih)}`;

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

    // 204 = ada (memberi star). 404 = tidak ada.
    if (res.status === 204) {
      simpanCache(kunci, true);
      return { starred: true, repo, dariCache: false, error: null };
    }

    if (res.status === 404) {
      // Belum star repo INI. Lanjut memeriksa repo berikutnya.
      continue;
    }

    if (res.status === 403 || res.status === 429) {
      // Batas laju GitHub tercapai. Sama seperti jaringan gagal: jangan cache,
      // karena jawabannya tidak diketahui.
      return { starred: false, repo: null, dariCache: false, error: 'batas_github' };
    }

    // Status lain yang tidak dikenal — perlakukan sebagai "tidak tahu".
    return { starred: false, repo: null, dariCache: false, error: 'github_tidak_jawab' };
  }

  // Sudah memeriksa semua repo, tidak ada yang 204.
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
