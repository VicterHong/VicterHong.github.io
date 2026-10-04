/**
 * Rute HTTP layanan token.
 *
 * Publik:
 *   GET  /api/health
 *   POST /api/token/validate      — cek token, buka metadata proyek
 *   POST /api/token/session       — tukar token dengan session cookie
 *   POST /api/token/logout        — hapus session
 *   GET  /api/project/:slug/locked — konten sensitif (butuh session atau token)
 *   POST /api/contact/sales       — permintaan akses dari form publik
 *
 * Admin (butuh header X-Admin-Key):
 *   POST /api/admin/token/issue
 *   POST /api/admin/token/revoke
 *   POST /api/admin/token/suspend
 *   POST /api/admin/token/resume
 *   GET  /api/admin/tokens
 *   GET  /api/admin/audit
 *   GET  /api/admin/leads
 */

import { config } from './config.mjs';
import { openDb } from './db.mjs';
import { timingSafeEqual } from 'node:crypto';
import {
  findTokenByPlaintext, getToken, issueToken, listTokens, revokeToken,
  resumeToken, suspendToken, tokenProblem,
} from './tokens.mjs';
import { createSession, validateSession, destroySession, cleanupExpiredSessions } from './sessions.mjs';
import { recordEvent, recentEvents, recordLead, listLeads } from './audit.mjs';
import { enforceAbuseRules, revokeMessage } from './guard.mjs';
import { makeFingerprint, recordFingerprint } from './fingerprint.mjs';
import { recordAnalytics, getFunnel, recentAnalytics, uniqueVisitors } from './analytics.mjs';
import { notifyLead } from './notify.mjs';
import { checkRateLimit } from './rate-limit.mjs';
import { scoreLead } from './spam-guard.mjs';
import { verifyTurnstile, turnstileMessage } from './turnstile.mjs';
import { slaSummary, slaReport } from './sla.mjs';
import { isValidSlug, loadLockedContent, sampleLockedContent } from './content.mjs';
import {
  createCollection, getCollection, listCollections,
  saveItem, getItem, listItems, setItemStatus, deleteItem,
  listVersions, rollback,
} from './cms.mjs';
import { buildSitemap, buildRobots, buildLlmsTxt, buildJsonLd } from './seo.mjs';
import { auditAssets, recordVital, vitalsSummary } from './performance.mjs';
import {
  createBranch, getBranch, listBranches, recordChange, discardBranch, mergeBranch,
  addComment, listComments, resolveComment,
} from './collaborate.mjs';
import {
  createExperiment, getExperiment, listExperiments, setStatus as setExpStatus,
  pickVariant, recordEvent as recordExpEvent, results as expResults,
} from './grow.mjs';
import { preflight, verify as verifyDeploy, recordRelease, listReleases } from './publish.mjs';
import {
  applyCors, clientCountry, clientIp, extractToken, handlePreflight,
  readJson, sendJson, parseCookies, setCookie, clearCookie,
} from './http-util.mjs';

/** Jenis event analytics yang diterima — mencegah polusi database. */
const ALLOWED_EVENTS = new Set([
  'page_view', 'modal_open', 'token_attempt', 'token_success', 'token_fail',
  'contact_sales', 'lead_submit', 'session_create', 'content_view',
]);

/**
 * Batas laju endpoint publik per alamat IP.
 * Token tak dikenal tidak punya token_id, jadi guard berbasis token tidak
 * menjangkaunya — batas per-IP ini yang menutup celah brute force.
 */
const PUBLIC_LIMITS = {
  '/api/token/validate': { limit: 20, windowMs: 60_000 },
  '/api/token/session': { limit: 10, windowMs: 60_000 },
  '/api/contact/sales': { limit: 5, windowMs: 60_000 },
  '/api/analytics/track': { limit: 60, windowMs: 60_000 },
  '/api/vitals': { limit: 60, windowMs: 60_000 },
  '/api/comments': { limit: 10, windowMs: 60_000 },
  // Gate verifikasi: cukup longgar untuk pengunjung sah (retry token
  // kedaluwarsa), cukup ketat untuk menahan pemboman token.
  '/api/verify-turnstile': { limit: 30, windowMs: 60_000 },
};

/** Terapkan batas laju. Mengembalikan true kalau permintaan ditolak. */
export function rateLimited(req, res, pathname) {
  const rule = PUBLIC_LIMITS[pathname];
  if (!rule) return false;
  const key = `${pathname}:${clientIp(req) || 'unknown'}`;
  const verdict = checkRateLimit(key, rule);
  if (verdict.allowed) return false;
  res.setHeader('retry-after', String(verdict.retryAfterSeconds));
  sendJson(res, 429, {
    ok: false,
    error: 'terlalu_banyak_permintaan',
    message: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
    retry_after: verdict.retryAfterSeconds,
  });
  return true;
}

/** Dipanggil sekali saat server mulai. */
export function initRoutes() {
  openDb(config.dbPath);
}

/** Cocokkan path dengan pola sederhana seperti '/api/project/:slug/locked'. */
function matchPath(pattern, pathname) {
  const p = pattern.split('/');
  const u = pathname.split('/');
  if (p.length !== u.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(u[i]);
    else if (p[i] !== u[i]) return null;
  }
  return params;
}

/** Apakah permintaan ini dari admin (kunci cocok).
 *  Perbandingan timing-safe: `===` membocorkan panjang awalan yang cocok lewat
 *  waktu respons, sehingga kunci bisa ditebak karakter demi karakter. */
function isAdmin(req) {
  const key = req.headers['x-admin-key'];
  if (typeof key !== 'string' || key.length === 0) return false;
  const expected = config.adminKey;
  if (!expected || key.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(expected, 'utf8'));
}

/** Bungkus handler: tangkap error supaya satu permintaan buruk tidak menjatuhkan layanan. */
function safe(handler) {
  return async (req, res, params) => {
    try {
      await handler(req, res, params);
    } catch (err) {
      const code = err?.statusCode ?? 500;
      if (code >= 500) console.error('[routes] error:', err);
      if (!res.headersSent) sendJson(res, code, { ok: false, error: err?.message ?? 'kesalahan internal' });
    }
  };
}

/**
 * Verifikasi token untuk satu proyek.
 * Mengembalikan { row, error } — error berisi { status, body } kalau gagal.
 */
function verifyToken(req, body, { projectSlug = '', action = 'validate' } = {}) {
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const country = clientCountry(req);
  const plaintext = extractToken(req, body);

  if (!plaintext) {
    recordEvent({ projectSlug, action, outcome: 'tanpa_token', ip, userAgent, country });
    return { error: { status: 401, body: { ok: false, error: 'token_required', message: 'Token diperlukan untuk membuka bagian ini.' } } };
  }

  const row = findTokenByPlaintext(plaintext, config.secret);
  if (!row) {
    recordEvent({ projectSlug, action, outcome: 'token_tidak_dikenal', ip, userAgent, country });
    return { error: { status: 403, body: { ok: false, error: 'token_invalid', message: 'Token tidak dikenali. Periksa kembali atau hubungi sales.' } } };
  }

  // Cek scope: token harus mencakup projectSlug yang diminta
  if (projectSlug && row.scopes && Array.isArray(row.scopes)) {
    if (!row.scopes.includes(projectSlug)) {
      recordEvent({
        tokenId: row.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
        ip, userAgent, country, detail: `token scope: ${row.scopes.join(',')}`,
      });
      return { error: { status: 403, body: { ok: false, error: 'token_scope_tidak_cocok', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
    }
  } else if (projectSlug && row.project_slug !== projectSlug) {
    recordEvent({
      tokenId: row.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
      ip, userAgent, country, detail: `token untuk ${row.project_slug}`,
    });
    return { error: { status: 403, body: { ok: false, error: 'token_proyek_lain', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
  }

  const problem = tokenProblem(row);
  if (problem) {
    recordEvent({ tokenId: row.id, projectSlug, action, outcome: problem, ip, userAgent, country });
    return {
      error: {
        status: 403,
        body: { ok: false, error: problem, message: revokeMessage(row.revoked_reason ?? problem) },
      },
    };
  }

  // Penjaga penyalahgunaan: token yang dibagikan dicabut otomatis.
  const abuse = enforceAbuseRules(row, { ip, userAgent, projectSlug: projectSlug || row.project_slug });
  if (abuse.revoked) {
    return {
      error: {
        status: 403,
        body: { ok: false, error: abuse.reason, message: revokeMessage(abuse.reason), detail: abuse.detail },
      },
    };
  }

  recordEvent({ tokenId: row.id, projectSlug: projectSlug || row.project_slug, action, outcome: 'ok', ip, userAgent, country });
  return { row };
}

/**
 * Verifikasi session cookie.
 * Mengembalikan { tokenRow, sessionRow, error }.
 */
function verifySession(req, { projectSlug = '', action = 'content' } = {}) {
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const country = clientCountry(req);
  const cookies = parseCookies(req);
  const sessionId = cookies.portfolio_session ?? '';

  if (!sessionId) {
    recordEvent({ projectSlug, action, outcome: 'tanpa_sesi', ip, userAgent, country });
    return { error: { status: 401, body: { ok: false, error: 'session_required', message: 'Sesi diperlukan. Masukkan token terlebih dahulu.' } } };
  }

  const result = validateSession(sessionId, config.secret);
  if (!result) {
    recordEvent({ projectSlug, action, outcome: 'sesi_tidak_valid', ip, userAgent, country });
    return { error: { status: 403, body: { ok: false, error: 'session_invalid', message: 'Sesi tidak valid atau sudah expired. Masukkan token kembali.' } } };
  }

  const { tokenRow, sessionRow } = result;

  // Cek scope
  if (projectSlug && tokenRow.scopes && Array.isArray(tokenRow.scopes)) {
    if (!tokenRow.scopes.includes(projectSlug)) {
      recordEvent({
        tokenId: tokenRow.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
        ip, userAgent, country, detail: `token scope: ${tokenRow.scopes.join(',')}`,
      });
      return { error: { status: 403, body: { ok: false, error: 'token_scope_tidak_cocok', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
    }
  } else if (projectSlug && tokenRow.project_slug !== projectSlug) {
    recordEvent({
      tokenId: tokenRow.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
      ip, userAgent, country, detail: `token untuk ${tokenRow.project_slug}`,
    });
    return { error: { status: 403, body: { ok: false, error: 'token_proyek_lain', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
  }

  const problem = tokenProblem(tokenRow);
  if (problem) {
    recordEvent({ tokenId: tokenRow.id, projectSlug, action, outcome: problem, ip, userAgent, country });
    return {
      error: {
        status: 403,
        body: { ok: false, error: problem, message: revokeMessage(tokenRow.revoked_reason ?? problem) },
      },
    };
  }

  recordEvent({ tokenId: tokenRow.id, projectSlug: projectSlug || tokenRow.project_slug, action, outcome: 'ok', ip, userAgent, country });
  return { tokenRow, sessionRow };
}

/**
 * Verifikasi Turnstile untuk aksi sensitif (gerbang token, sesi).
 *
 * Dipakai SEBELUM token diperiksa — jadi bot tidak bisa menebak token
 * sama sekali kalau belum lolos verifikasi manusia.
 *
 * Mengembalikan { ok: true } kalau lolos (atau Turnstile memang nonaktif —
 * situs tidak boleh rusak karena konfigurasi kosong), atau
 * { ok: false, status, body } kalau ditolak.
 *
 * `secret` bisa dioper eksplisit supaya bisa diuji tanpa menyentuh
 * konfigurasi produksi.
 */
export async function turnstileGate(req, body, { action = 'turnstile_gate', secret } = {}) {
  const effectiveSecret = secret ?? config.turnstileSecretKey;
  const result = await verifyTurnstile({
    token: String(body['cf-turnstile-response'] ?? body.turnstile_token ?? ''),
    secret: effectiveSecret,
    remoteip: clientIp(req),
  });

  if (result.ok) {
    if (!result.skipped) {
      recordEvent({
        action, outcome: 'ok',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
    }
    return { ok: true, skipped: result.skipped === true };
  }

  recordEvent({
    action, outcome: 'gagal', detail: result.error,
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
  });
  return {
    ok: false,
    status: 403,
    body: { ok: false, error: result.error, message: turnstileMessage(result.error) },
  };
}

/** Semua rute, dengan pola dan handler. */
export const routes = [
  {
    method: 'GET',
    pattern: '/api/health',
    handler: safe(async (req, res) => {
      sendJson(res, 200, { ok: true, service: 'portfolio-token-service', time: new Date().toISOString() });
    }),
  },

  {
    // Konfigurasi publik yang dibutuhkan frontend.
    // Hanya berisi nilai yang memang aman dilihat siapa pun — site key
    // Turnstile memang dirancang untuk dipasang di HTML publik.
    // Secret key TIDAK pernah keluar dari server.
    method: 'GET',
    pattern: '/api/config',
    handler: safe(async (req, res) => {
      sendJson(res, 200, {
        ok: true,
        turnstile: {
          enabled: Boolean(config.turnstileSiteKey),
          site_key: config.turnstileSiteKey,
        },
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/validate',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const slug = String(body.project ?? '').trim();
      if (!isValidSlug(slug)) {
        return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid', message: 'Slug proyek tidak valid.' });
      }
      const { row, error } = verifyToken(req, body, { projectSlug: slug, action: 'validate' });
      if (error) return sendJson(res, error.status, error.body);
      sendJson(res, 200, {
        ok: true,
        project: row.project_slug,
        tier: row.tier,
        scopes: row.scopes,
        label: row.label,
        issued_to: row.issued_to,
        company: row.company,
        expires_at: row.expires_at,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/session',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const slug = String(body.project ?? '').trim();
      if (!isValidSlug(slug)) {
        return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid', message: 'Slug proyek tidak valid.' });
      }

      // ── Gerbang Turnstile (sebelum token diperiksa) ──────────────────────
      // Memverifikasi pengunjung adalah MANUSIA dulu, baru tokennya dinilai.
      // Efeknya: skrip bot tidak bisa menebak/menguji token sama sekali —
      // percobaan tanpa verifikasi ditolak sebelum menyentuh database token.
      const gate = await turnstileGate(req, body, { action: 'session_turnstile' });
      if (!gate.ok) return sendJson(res, gate.status, gate.body);

      // Verifikasi token
      const { row, error } = verifyToken(req, body, { projectSlug: slug, action: 'session_create' });
      if (error) return sendJson(res, error.status, error.body);

      // Buat session
      const ip = clientIp(req);
      const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
      const country = clientCountry(req);
      const deviceFp = String(body.device_fp ?? '').slice(0, 200);

      const session = createSession({
        tokenId: row.id,
        secret: config.secret,
        deviceFp,
        ip,
        country,
        userAgent,
        durationHours: config.sessionDurationHours,
        maxDevices: row.max_devices ?? config.maxDevices,
      });

      // Record fingerprint untuk deteksi sharing
      const fingerprint = makeFingerprint(req);
      recordFingerprint({
        sessionId: session.id,
        tokenId: row.id,
        fingerprint,
        ip,
        country,
      });

      setCookie(res, 'portfolio_session', session.id, {
        maxAgeSeconds: config.sessionDurationHours * 3600,
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      });

      sendJson(res, 200, {
        ok: true,
        project: row.project_slug,
        tier: row.tier,
        scopes: row.scopes,
        session_expires: session.expiresAt,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/logout',
    handler: safe(async (req, res) => {
      const cookies = parseCookies(req);
      const sessionId = cookies.portfolio_session ?? '';
      if (sessionId) {
        destroySession(sessionId, config.secret);
      }
      clearCookie(res, 'portfolio_session');
      sendJson(res, 200, { ok: true, message: 'Sesi dihapus.' });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/project/:slug/locked',
    handler: safe(async (req, res, params) => {
      const slug = params.slug;
      if (!isValidSlug(slug)) {
        return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid', message: 'Slug proyek tidak valid.' });
      }

      // Coba session dulu, kalau tidak ada coba token di header
      let tokenRow = null;
      const cookies = parseCookies(req);
      if (cookies.portfolio_session) {
        const result = verifySession(req, { projectSlug: slug, action: 'content' });
        if (result.error) {
          // Kalau session gagal, coba token di header sebagai fallback
          const { row } = verifyToken(req, {}, { projectSlug: slug, action: 'content' });
          if (!row) return sendJson(res, result.error.status, result.error.body);
          tokenRow = row;
        } else {
          tokenRow = result.tokenRow;
        }
      } else {
        const { row, error } = verifyToken(req, {}, { projectSlug: slug, action: 'content' });
        if (error) return sendJson(res, error.status, error.body);
        tokenRow = row;
      }

      const content = loadLockedContent(slug) ?? sampleLockedContent(slug);

      // Record analytics: content_view
      recordAnalytics({
        eventType: 'content_view',
        projectSlug: slug,
        tokenId: tokenRow.id,
        ip: clientIp(req),
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        referrer: String(req.headers.referer ?? ''),
      });

      sendJson(res, 200, {
        ok: true,
        project: slug,
        tier: tokenRow.tier,
        issued_to: tokenRow.issued_to,
        company: tokenRow.company,
        content,
      });
    }),
  },

  {
    // Endpoint verifikasi Turnstile untuk gate
    method: 'POST',
    pattern: '/api/verify-turnstile',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const token = String(body.token ?? '').trim();
      
      if (!token) {
        return sendJson(res, 400, { 
          success: false, 
          error: 'token_missing',
          message: 'Token Turnstile tidak ada.'
        });
      }

      const result = await verifyTurnstile({
        token,
        secret: config.turnstileSecretKey,
        remoteip: clientIp(req),
      });

      if (!result.ok) {
        recordEvent({
          action: 'turnstile_gate',
          outcome: 'failed',
          ip: clientIp(req),
          userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
          detail: result.error,
        });
        
        return sendJson(res, 403, {
          success: false,
          error: result.error,
          message: turnstileMessage(result.error),
        });
      }

      recordEvent({
        action: 'turnstile_gate',
        outcome: 'ok',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });

      sendJson(res, 200, {
        success: true,
        hostname: result.hostname,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/contact/sales',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const email = String(body.email ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return sendJson(res, 400, { ok: false, error: 'email_tidak_valid', message: 'Alamat email tidak valid.' });
      }

      // ── Validasi field wajib (lapis server) ──────────────────────────────
      // Klien sudah memvalidasi, tapi klien bisa dilewati (request langsung,
      // JavaScript dimatikan). Server memeriksa ulang dengan aturan yang sama
      // supaya lead sampah tidak pernah masuk database.
      const company = String(body.company ?? '').trim();
      const name = String(body.name ?? '').trim();
      const message = String(body.message ?? '').trim();
      const budgetRange = String(body.budget_range ?? '').trim();
      const urgency = String(body.urgency ?? '').trim();

      const fieldErrors = [];
      if (company.length < 3 || !/[A-Za-zÀ-ÿ]/.test(company)) fieldErrors.push('company');
      if (name.length < 3 || /\d/.test(name) || !/[A-Za-zÀ-ÿ]/.test(name)) fieldErrors.push('name');
      if (!budgetRange) fieldErrors.push('budget_range');
      if (!urgency) fieldErrors.push('urgency');
      if (message.length < 10) fieldErrors.push('message');

      if (fieldErrors.length) {
        return sendJson(res, 400, {
          ok: false,
          error: 'field_tidak_lengkap',
          fields: fieldErrors,
          message: 'Lengkapi kolom bertanda * sebelum mengirim.',
        });
      }

      const ip = clientIp(req);
      const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);

      // ── Cloudflare Turnstile (lapis terkuat) ─────────────────────────────────
      // Memverifikasi bahwa pengirim adalah MANUSIA. Kalau secret belum
      // dipasang, verifyTurnstile() mengembalikan skipped dan alur tetap jalan
      // dengan lapisan penapis lain — situs tidak pernah rusak karena config.
      const turnstile = await verifyTurnstile({
        token: String(body['cf-turnstile-response'] ?? body.turnstile_token ?? ''),
        secret: config.turnstileSecretKey,
        remoteip: ip,
      });

      if (!turnstile.ok) {
        recordEvent({
          projectSlug: String(body.project ?? ''), action: 'lead_turnstile', outcome: 'failed',
          ip, userAgent,
        });
        return sendJson(res, 403, {
          ok: false,
          error: turnstile.error,
          message: turnstileMessage(turnstile.error),
        });
      }

      // ── Penjaga spam (Q3) ────────────────────────────────────────────────────
      // Turnstile memverifikasi MANUSIA, bukan NIAT — manusia yang mengirim
      // spam tetap lolos. Heuristik isi inilah yang menangkapnya. Keduanya
      // saling melengkapi, bukan saling menggantikan.
      const spam = scoreLead({ body, ip, userAgent });

      if (spam.verdict === 'block') {
        // Balas seolah berhasil supaya bot tidak belajar dari respons.
        // Lead TIDAK disimpan.
        recordEvent({
          projectSlug: String(body.project ?? ''), action: 'lead_spam', outcome: 'blocked',
          ip, userAgent,
        });
        return sendJson(res, 200, {
          ok: true,
          message: 'Permintaan Anda tercatat. Sales akan menghubungi Anda.',
        });
      }

      // Status lead: 'new' untuk yang bersih, 'review' untuk yang mencurigakan.
      const status = spam.verdict === 'review' ? 'review' : 'new';

      const result = recordLead({
        company: String(body.company ?? '').slice(0, 200),
        name: String(body.name ?? '').slice(0, 200),
        email: email.slice(0, 300),
        role: String(body.role ?? '').slice(0, 100),
        projectSlug: String(body.project ?? '').slice(0, 64),
        budgetRange: String(body.budget_range ?? '').slice(0, 100),
        urgency: String(body.urgency ?? '').slice(0, 50),
        message: String(body.message ?? '').slice(0, 4000),
        ip,
        userAgent,
        status,
      });
      recordEvent({
        projectSlug: String(body.project ?? ''), action: 'lead',
        outcome: status === 'review' ? 'review' : 'ok',
        ip, userAgent,
      });
      // Record analytics: lead_submit
      recordAnalytics({
        eventType: 'lead_submit',
        projectSlug: String(body.project ?? ''),
        ip,
        country: clientCountry(req),
        userAgent,
        referrer: String(req.headers.referer ?? ''),
        metadata: { company: String(body.company ?? ''), email: String(body.email ?? '') },
      });

      // Notifikasi webhook (fire-and-forget, tidak menunda respons).
      // Lead mencurigakan ditandai supaya bisa ditinjau sebelum dibalas.
      notifyLead({
        company: String(body.company ?? ''),
        name: String(body.name ?? ''),
        email,
        role: String(body.role ?? ''),
        projectSlug: String(body.project ?? ''),
        budgetRange: String(body.budget_range ?? ''),
        urgency: String(body.urgency ?? ''),
        message: String(body.message ?? ''),
        spamScore: spam.score,
        spamReasons: spam.reasons,
      });

      sendJson(res, 200, { ok: true, id: result.id, message: 'Permintaan Anda tercatat. Sales akan menghubungi Anda.' });
    }),
  },

  // ── ANALYTICS ────────────────────────────────────────────────────────────────

  {
    method: 'POST',
    pattern: '/api/analytics/track',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const eventType = String(body.event_type ?? '').trim();
      const projectSlug = String(body.project ?? '').trim();

      if (!eventType) {
        return sendJson(res, 400, { ok: false, error: 'event_type_required' });
      }

      // Hanya event yang dikenal diterima — mencegah database dipenuhi
      // event sampah yang merusak funnel.
      if (!ALLOWED_EVENTS.has(eventType)) {
        return sendJson(res, 400, { ok: false, error: 'event_type_tidak_dikenal' });
      }

      // Batasi metadata: hanya string pendek, maksimum 20 kunci.
      const rawMeta = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
      const metadata = {};
      let metaCount = 0;
      for (const [k, v] of Object.entries(rawMeta)) {
        if (metaCount >= 20) break;
        if (typeof k !== 'string' || k.length > 64) continue;
        metadata[k.slice(0, 64)] = String(v ?? '').slice(0, 300);
        metaCount += 1;
      }

      recordAnalytics({
        eventType,
        projectSlug: isValidSlug(projectSlug) ? projectSlug : '',
        ip: clientIp(req),
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        referrer: String(req.headers.referer ?? ''),
        metadata,
      });

      sendJson(res, 200, { ok: true });
    }),
  },

  // ── ADMIN ────────────────────────────────────────────────────────────────────

  {
    method: 'POST',
    pattern: '/api/admin/token/issue',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const slug = String(body.project ?? '').trim();
      if (!isValidSlug(slug)) return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid' });

      // Parse scopes array
      let scopes = null;
      if (body.scopes && Array.isArray(body.scopes)) {
        scopes = body.scopes.filter(s => isValidSlug(String(s)));
      }

      const result = issueToken({
        secret: config.secret,
        projectSlug: slug,
        tier: String(body.tier ?? 'standard').toLowerCase(),
        scopes,
        label: String(body.label ?? '').slice(0, 200),
        issuedTo: String(body.issued_to ?? '').slice(0, 200),
        company: String(body.company ?? '').slice(0, 200),
        issuedBy: 'admin',
        expiresInDays: body.expires_in_days ? Number(body.expires_in_days) : null,
        maxIps: body.max_ips ? Number(body.max_ips) : config.maxDistinctIps,
        maxDevices: body.max_devices ? Number(body.max_devices) : config.maxDevices,
        notes: String(body.notes ?? '').slice(0, 500),
        prefix: config.tokenPrefix,
        segments: config.tokenSegments,
        segmentLength: config.tokenSegmentLength,
      });
      recordEvent({
        tokenId: result.id, projectSlug: slug, action: 'issue', outcome: 'ok',
        ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      // Plaintext hanya muncul di jawaban ini — tidak pernah bisa dibaca lagi.
      sendJson(res, 200, {
        ok: true,
        id: result.id,
        token: result.token,
        project: result.project_slug,
        tier: result.tier,
        scopes: result.scopes,
        expires_at: result.expires_at,
        max_ips: result.max_ips,
        max_devices: result.max_devices,
        warning: 'Simpan token ini sekarang. Nilainya tidak bisa ditampilkan lagi.',
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/token/revoke',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const id = String(body.id ?? '').trim();
      if (!id) return sendJson(res, 400, { ok: false, error: 'id_diperlukan' });
      const result = revokeToken(id, String(body.reason ?? 'manual').slice(0, 200), {
        automatic: false, detail: String(body.detail ?? '').slice(0, 500),
      });
      recordEvent({
        tokenId: id, action: 'revoke', outcome: result.revoked ? 'ok' : 'tidak_ada',
        ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      sendJson(res, 200, { ok: true, revoked: result.revoked });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/token/suspend',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const result = suspendToken(String(body.id ?? ''), String(body.reason ?? 'ditangguhkan admin'));
      sendJson(res, 200, { ok: true, ...result });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/token/resume',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const result = resumeToken(String(body.id ?? ''));
      sendJson(res, 200, { ok: true, ...result });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/tokens',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const rows = listTokens({
        projectSlug: url?.searchParams.get('project') ?? null,
        status: url?.searchParams.get('status') ?? null,
        tier: url?.searchParams.get('tier') ?? null,
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 500),
      });
      sendJson(res, 200, { ok: true, count: rows.length, tokens: rows });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/audit',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const events = recentEvents({
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 1000),
        tokenId: url?.searchParams.get('token') ?? null,
        projectSlug: url?.searchParams.get('project') ?? null,
      });
      sendJson(res, 200, { ok: true, count: events.length, events });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/leads',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const leads = listLeads({
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 500),
        status: url?.searchParams.get('status') ?? null,
      });
      sendJson(res, 200, { ok: true, count: leads.length, leads });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/token/:id',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const row = getToken(params.id);
      if (!row) return sendJson(res, 404, { ok: false, error: 'token_tidak_ada' });
      // token_hash tidak pernah dikembalikan.
      const { token_hash: _ignored, ...safeRow } = row;
      sendJson(res, 200, { ok: true, token: safeRow });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cleanup',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const removed = cleanupExpiredSessions();
      sendJson(res, 200, { ok: true, removed });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/analytics/funnel',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const project = url?.searchParams.get('project') ?? null;
      const days = Math.min(Number(url?.searchParams.get('days') ?? 30), 365);
      const windowMs = days * 24 * 60 * 60 * 1000;

      const funnel = getFunnel({ projectSlug: project, windowMs });
      const visitors = uniqueVisitors({ projectSlug: project, windowMs });

      sendJson(res, 200, {
        ok: true,
        project: project ?? 'all',
        days,
        funnel,
        unique_visitors: visitors,
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/analytics/events',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const events = recentAnalytics({
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 1000),
        eventType: url?.searchParams.get('type') ?? null,
        projectSlug: url?.searchParams.get('project') ?? null,
      });
      sendJson(res, 200, { ok: true, count: events.length, events });
    }),
  },

  // ── SLA (enterprise) ─────────────────────────────────────────────────────────

  {
    method: 'GET',
    pattern: '/api/admin/sla',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const days = Math.min(Number(url?.searchParams.get('days') ?? 0), 90);
      if (days > 0) {
        return sendJson(res, 200, { ok: true, report: slaReport({ windowMs: days * 86_400_000 }) });
      }
      sendJson(res, 200, { ok: true, sla: slaSummary() });
    }),
  },

  // ── Audit export (enterprise) ────────────────────────────────────────────────

  {
    method: 'GET',
    pattern: '/api/admin/export/audit',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const format = (url?.searchParams.get('format') ?? 'json').toLowerCase();
      const limit = Math.min(Number(url?.searchParams.get('limit') ?? 5000), 50_000);
      const events = recentEvents({
        limit,
        tokenId: url?.searchParams.get('token') ?? null,
        projectSlug: url?.searchParams.get('project') ?? null,
      });

      if (format === 'csv') {
        const header = 'id,token_id,project_slug,action,outcome,ip,country,detail,at\n';
        const rows = events.map((e) => [
          e.id, e.token_id ?? '', e.project_slug, e.action, e.outcome,
          e.ip, e.country,
          `"${String(e.detail ?? '').replace(/"/g, '""')}"`,
          new Date(Number(e.at)).toISOString(),
        ].join(',')).join('\n');
        const body = header + rows;
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'content-disposition': `attachment; filename="audit-export-${Date.now()}.csv"`,
          'cache-control': 'no-store',
        });
        return res.end(body);
      }

      sendJson(res, 200, {
        ok: true,
        exported_at: new Date().toISOString(),
        count: events.length,
        events,
      });
    }),
  },

  // ══ CMS ══════════════════════════════════════════════════════════════════════
  // Publik: hanya konten PUBLISHED. Admin: semua + manajemen.

  {
    method: 'GET',
    pattern: '/api/cms/:collection/items',
    handler: safe(async (req, res, params, url) => {
      const collection = params.collection;
      const isAdminReq = isAdmin(req);
      const includeDraft = isAdminReq && url?.searchParams.get('draft') === '1';
      const limit = Number(url?.searchParams.get('limit') ?? 100);
      sendJson(res, 200, {
        ok: true,
        collection,
        items: listItems(collection, { includeDraft, limit }),
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/cms/:collection/items/:slug',
    handler: safe(async (req, res, params, url) => {
      const includeDraft = isAdmin(req) && url?.searchParams.get('draft') === '1';
      const item = getItem(params.collection, params.slug, { includeDraft });
      if (!item) return sendJson(res, 404, { ok: false, error: 'item_tidak_ada' });
      sendJson(res, 200, { ok: true, item });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/cms/collections',
    handler: safe(async (req, res) => {
      sendJson(res, 200, { ok: true, collections: listCollections() });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/collection',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const col = createCollection({
          slug: String(body.slug ?? ''),
          title: body.title,
          fields: body.fields,
        });
        sendJson(res, 200, { ok: true, collection: col });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/item',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const item = saveItem({
          collection: String(body.collection ?? ''),
          itemSlug: String(body.slug ?? ''),
          data: body.data,
          status: String(body.status ?? 'draft'),
          author: 'admin',
          message: String(body.message ?? ''),
        });
        sendJson(res, 200, { ok: true, item });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/status',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const item = setItemStatus(
        String(body.collection ?? ''), String(body.slug ?? ''), String(body.status ?? '')
      );
      if (!item) return sendJson(res, 404, { ok: false, error: 'item_tidak_ada' });
      sendJson(res, 200, { ok: true, item });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/delete',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const ok = deleteItem(String(body.collection ?? ''), String(body.slug ?? ''));
      sendJson(res, 200, { ok: true, deleted: ok });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/cms/versions/:collection/:slug',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, {
        ok: true,
        versions: listVersions(params.collection, params.slug),
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/rollback',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const item = rollback(
        String(body.collection ?? ''), String(body.slug ?? ''), Number(body.version ?? 0)
      );
      if (!item) return sendJson(res, 404, { ok: false, error: 'versi_tidak_ada' });
      sendJson(res, 200, { ok: true, item });
    }),
  },

  // ══ SEO / AEO ════════════════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/seo/sitemap',
    handler: safe(async (req, res) => {
      const { xml, count } = buildSitemap();
      res.writeHead(200, {
        'content-type': 'application/xml; charset=utf-8',
        'content-length': Buffer.byteLength(xml),
        'cache-control': 'public, max-age=3600',
      });
      res.end(xml);
    }),
  },

  {
    method: 'GET',
    pattern: '/api/seo/robots',
    handler: safe(async (req, res) => {
      const body = buildRobots();
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'public, max-age=3600',
      });
      res.end(body);
    }),
  },

  {
    method: 'GET',
    pattern: '/api/seo/llms',
    handler: safe(async (req, res) => {
      // Data proyek dibaca dari berkas data frontend supaya satu sumber.
      const { loadPortfolioData } = await import('./portfolio-data.mjs');
      const data = await loadPortfolioData();
      const body = buildLlmsTxt(data);
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'public, max-age=3600',
      });
      res.end(body);
    }),
  },

  {
    method: 'GET',
    pattern: '/api/seo/jsonld',
    handler: safe(async (req, res) => {
      const { loadPortfolioData } = await import('./portfolio-data.mjs');
      sendJson(res, 200, { ok: true, data: buildJsonLd(await loadPortfolioData()) });
    }),
  },

  // ══ PERFORMANCE ══════════════════════════════════════════════════════════════

  {
    method: 'POST',
    pattern: '/api/vitals',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const ok = recordVital({
        name: body.name,
        value: body.value,
        rating: body.rating,
        path: body.path,
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        connection: body.connection,
      });
      sendJson(res, ok ? 200 : 400, { ok });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/performance',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const days = Number(url?.searchParams.get('days') ?? 7);
      sendJson(res, 200, { ok: true, vitals: vitalsSummary({ days }) });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/performance/assets',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const root = url?.searchParams.get('root') ?? process.cwd();
      try {
        sendJson(res, 200, { ok: true, audit: auditAssets(root) });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    }),
  },

  // ══ COLLABORATE ══════════════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/admin/branches',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, { ok: true, branches: listBranches() });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/branch/:name',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const branch = getBranch(params.name);
      if (!branch) return sendJson(res, 404, { ok: false, error: 'branch_tidak_ada' });
      sendJson(res, 200, { ok: true, branch });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/create',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const branch = createBranch({
          name: String(body.name ?? ''),
          base: String(body.base ?? 'main'),
          message: String(body.message ?? ''),
        });
        sendJson(res, 200, { ok: true, branch });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/change',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        recordChange({
          branch: String(body.branch ?? ''),
          collection: String(body.collection ?? ''),
          itemSlug: String(body.slug ?? ''),
          action: String(body.action ?? 'update'),
          payload: body.payload ?? {},
        });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/merge',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const name = String(body.branch ?? '');
      // Terapkan tiap perubahan ke CMS produksi.
      const result = mergeBranch(name, (change) => {
        if (!change.collection || !change.item_slug) return false;
        saveItem({
          collection: change.collection,
          itemSlug: change.item_slug,
          data: change.payload?.data ?? {},
          status: change.payload?.status ?? 'draft',
          author: 'merge',
          message: `merge dari branch ${name}`,
        });
        return true;
      });
      sendJson(res, result.ok ? 200 : 400, result);
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/discard',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      discardBranch(String(body.branch ?? ''));
      sendJson(res, 200, { ok: true });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/comments',
    handler: safe(async (req, res, params, url) => {
      const target = url?.searchParams.get('target');
      const resolvedParam = url?.searchParams.get('resolved');
      const resolved = resolvedParam === null ? null : resolvedParam === '1';
      sendJson(res, 200, { ok: true, comments: listComments({ target, resolved }) });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/comments',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      try {
        const result = addComment({
          target: String(body.target ?? ''),
          anchor: String(body.anchor ?? ''),
          body: String(body.body ?? ''),
          author: String(body.author ?? 'guest').slice(0, 80),
          parentId: body.parent_id ? Number(body.parent_id) : null,
        });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/comment/resolve',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      resolveComment(Number(body.id ?? 0), body.resolved !== false);
      sendJson(res, 200, { ok: true });
    }),
  },

  // ══ GROW (eksperimen A/B) ════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/experiment/:slug',
    handler: safe(async (req, res, params, url) => {
      // Publik: hanya memberi varian untuk pengunjung — bukan data hasil.
      const visitor = url?.searchParams.get('v') ?? clientIp(req);
      const variant = pickVariant(params.slug, visitor);
      if (!variant) return sendJson(res, 404, { ok: false, error: 'eksperimen_tidak_aktif' });
      recordExpEvent({
        slug: params.slug, variant, event: 'exposure',
        visitor, country: clientCountry(req),
      });
      sendJson(res, 200, { ok: true, variant });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/experiment/convert',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      recordExpEvent({
        slug: String(body.slug ?? ''),
        variant: String(body.variant ?? ''),
        event: String(body.event ?? 'conversion'),
        visitor: String(body.visitor ?? clientIp(req)),
        country: clientCountry(req),
      });
      sendJson(res, 200, { ok: true });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/experiments',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, { ok: true, experiments: listExperiments() });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/experiment/:slug/results',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const r = expResults(params.slug);
      if (!r) return sendJson(res, 404, { ok: false, error: 'eksperimen_tidak_ada' });
      sendJson(res, 200, { ok: true, results: r });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/experiment',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const exp = createExperiment({
          slug: String(body.slug ?? ''),
          name: body.name,
          variants: body.variants,
          goal: body.goal,
        });
        if (body.status) setExpStatus(String(body.slug), String(body.status));
        sendJson(res, 200, { ok: true, experiment: getExperiment(String(body.slug)) });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  // ══ PUBLISH ══════════════════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/admin/preflight',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const root = url?.searchParams.get('root') ?? process.cwd();
      sendJson(res, 200, { ok: true, preflight: preflight(root) });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/releases',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, { ok: true, releases: listReleases(Number(url?.searchParams.get('limit') ?? 50)) });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/publish/verify',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const url = String(body.url ?? '');
      if (!/^https?:\/\//.test(url)) return sendJson(res, 400, { ok: false, error: 'url_tidak_valid' });
      const result = await verifyDeploy(url, { expectMarker: body.marker ?? null });
      sendJson(res, 200, { ok: true, verify: result });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/release',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const id = recordRelease({
        version: String(body.version ?? ''),
        commit: String(body.commit ?? ''),
        checks: body.checks ?? [],
        ok: Boolean(body.ok),
      });
      sendJson(res, 200, { ok: true, id });
    }),
  },
];

/** Cari rute yang cocok untuk satu permintaan. */
export function resolveRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.pattern, pathname);
    if (params) return { route, params };
  }
  return null;
}

export { handlePreflight, applyCors };
