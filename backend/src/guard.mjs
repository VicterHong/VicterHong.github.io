/**
 * Penjaga penyalahgunaan — inti janji "token dishare → otomatis dicabut".
 *
 * Empat sinyal dihitung dari access_events (bukan dari memori proses), jadi penjaga
 * tetap bekerja setelah layanan di-restart:
 *   1. Terlalu banyak alamat IP berbeda dalam jendela waktu.
 *   2. Terlalu banyak request dalam jendela waktu (indikasi scrape).
 *   3. Terlalu banyak percobaan gagal beruntun (indikasi brute force token).
 *   4. User-agent yang berganti-ganti ekstrem (indikasi token dipindah-pindah alat).
 *
 * Setiap pelanggaran mencatat alasan lalu mencabut token. Tidak ada jalur yang
 * "hanya memperingatkan" — token yang mencurigakan langsung mati, sesuai PRD §11.3.
 */

import { config } from './config.mjs';
import { consecutiveFailures, distinctIpsForToken, recordEvent, requestsInWindow } from './audit.mjs';
import { revokeToken } from './tokens.mjs';
import { analyzeFingerprints } from './fingerprint.mjs';
import { notifyAutoRevoke } from './notify.mjs';

/** Hasil pemeriksaan penyalahgunaan. */
const CLEAN = { violated: false };

/**
 * Periksa apakah token melanggar aturan penyalahgunaan.
 * @returns {{violated: boolean, reason?: string, detail?: string}}
 */
export function checkAbuse(tokenRow, { ip = '' } = {}) {
  const windowMs = config.ipWindowHours * 3_600_000;

  // 1. Terlalu banyak IP berbeda — sinyal paling kuat bahwa token dibagikan.
  // IP permintaan SAAT INI ikut dihitung: tanpa itu token baru dicabut satu
  // request terlambat, dan request yang melanggar tetap lolos.
  const ips = distinctIpsForToken(tokenRow.id, windowMs);
  if (ip && !ips.includes(ip)) ips.push(ip);
  const ipLimit = Math.min(Number(tokenRow.max_ips) || config.maxDistinctIps, config.maxDistinctIps);
  if (ips.length > ipLimit) {
    return {
      violated: true,
      reason: 'token_dibagikan',
      detail: `${ips.length} alamat IP berbeda dalam ${config.ipWindowHours} jam (batas ${ipLimit})`,
    };
  }

  // 2. Terlalu banyak request — indikasi pengambilan konten massal.
  // Request saat ini ikut dihitung supaya batasnya tepat, bukan longgar satu.
  const reqs = requestsInWindow(tokenRow.id, 60_000) + 1;
  if (reqs > config.rateLimitPerMinute) {
    return {
      violated: true,
      reason: 'laju_berlebihan',
      detail: `${reqs} request dalam 1 menit (batas ${config.rateLimitPerMinute})`,
    };
  }

  // 3. Percobaan gagal beruntun — indikasi token ditebak orang lain.
  const failures = consecutiveFailures(tokenRow.id);
  if (failures >= config.maxFailedAttempts) {
    return {
      violated: true,
      reason: 'percobaan_beruntun',
      detail: `${failures} percobaan gagal beruntun (batas ${config.maxFailedAttempts})`,
    };
  }

  // 4. Device fingerprint anomaly — indikasi token dipakai di banyak device berbeda.
  const fpWindowMs = 24 * 3_600_000; // 24 jam
  const fpAnalysis = analyzeFingerprints(tokenRow.id, fpWindowMs);
  if (fpAnalysis.suspicious) {
    return {
      violated: true,
      reason: 'token_dibagikan',
      detail: `${fpAnalysis.uniqueFpCount} device fingerprint berbeda dalam 24 jam (${fpAnalysis.totalSessions} sesi)`,
    };
  }

  return CLEAN;
}

/**
 * Jalankan pemeriksaan lalu cabut token kalau melanggar.
 * @returns {{revoked: boolean, reason?: string, detail?: string}}
 */
export function enforceAbuseRules(tokenRow, { ip = '', userAgent = '', projectSlug = '' } = {}) {
  const verdict = checkAbuse(tokenRow, { ip });
  if (!verdict.violated) return { revoked: false };

  const result = revokeToken(tokenRow.id, verdict.reason, {
    automatic: true,
    detail: verdict.detail,
  });

  recordEvent({
    tokenId: tokenRow.id,
    projectSlug: projectSlug || tokenRow.project_slug,
    action: 'auto_revoke',
    outcome: result.revoked ? 'revoked' : 'already_revoked',
    ip,
    userAgent,
    detail: `${verdict.reason}: ${verdict.detail}`,
  });

  // Notifikasi ke pemilik (fire-and-forget) — hanya kalau token benar-benar baru dicabut.
  if (result.revoked) {
    notifyAutoRevoke({
      tokenLabel: tokenRow.label || tokenRow.issued_to || tokenRow.id,
      reason: verdict.reason,
      detail: verdict.detail,
    });
  }

  return { revoked: result.revoked, reason: verdict.reason, detail: verdict.detail };
}

/** Pesan publik untuk tiap alasan pencabutan — tidak membocorkan detail internal. */
export const REVOKE_MESSAGES = {
  token_dibagikan: 'Token ini terdeteksi dipakai dari beberapa lokasi berbeda sehingga dinonaktifkan otomatis. Hubungi sales untuk token baru.',
  laju_berlebihan: 'Token ini terdeteksi melakukan permintaan berlebihan sehingga dinonaktifkan otomatis. Hubungi sales untuk token baru.',
  percobaan_beruntun: 'Token ini dinonaktifkan karena terlalu banyak percobaan gagal. Hubungi sales untuk bantuan.',
  manual: 'Token ini telah dinonaktifkan oleh pemilik portofolio.',
  expired: 'Token ini sudah kedaluwarsa. Hubungi sales untuk perpanjangan.',
  revoked: 'Token ini sudah tidak berlaku. Hubungi sales untuk akses baru.',
};

/** Pesan aman untuk alasan apa pun. */
export function revokeMessage(reason) {
  return REVOKE_MESSAGES[reason] ?? 'Token ini tidak dapat digunakan. Hubungi sales untuk bantuan.';
}
