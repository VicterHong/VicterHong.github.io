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
import { isValidSlug, loadLockedContent, sampleLockedContent } from './content.mjs';
import {
  applyCors, clientCountry, clientIp, extractToken, handlePreflight,
  readJson, sendJson, parseCookies, setCookie, clearCookie,
} from './http-util.mjs';

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

/** Apakah permintaan ini dari admin (kunci cocok). */
function isAdmin(req) {
  const key = req.headers['x-admin-key'];
  return typeof key === 'string' && key.length > 0 && key === config.adminKey;
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

      // Verifikasi token dulu
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
    method: 'POST',
    pattern: '/api/contact/sales',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const email = String(body.email ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return sendJson(res, 400, { ok: false, error: 'email_tidak_valid', message: 'Alamat email tidak valid.' });
      }
      const result = recordLead({
        company: String(body.company ?? '').slice(0, 200),
        name: String(body.name ?? '').slice(0, 200),
        email: email.slice(0, 300),
        role: String(body.role ?? '').slice(0, 100),
        projectSlug: String(body.project ?? '').slice(0, 64),
        budgetRange: String(body.budget_range ?? '').slice(0, 100),
        urgency: String(body.urgency ?? '').slice(0, 50),
        message: String(body.message ?? '').slice(0, 4000),
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      recordEvent({
        projectSlug: String(body.project ?? ''), action: 'lead', outcome: 'ok',
        ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      // Record analytics: lead_submit
      recordAnalytics({
        eventType: 'lead_submit',
        projectSlug: String(body.project ?? ''),
        ip: clientIp(req),
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        referrer: String(req.headers.referer ?? ''),
        metadata: { company: String(body.company ?? ''), email: String(body.email ?? '') },
      });

      // Notifikasi webhook (fire-and-forget, tidak menunda respons)
      notifyLead({
        company: String(body.company ?? ''),
        name: String(body.name ?? ''),
        email,
        role: String(body.role ?? ''),
        projectSlug: String(body.project ?? ''),
        budgetRange: String(body.budget_range ?? ''),
        urgency: String(body.urgency ?? ''),
        message: String(body.message ?? ''),
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

      recordAnalytics({
        eventType,
        projectSlug: isValidSlug(projectSlug) ? projectSlug : '',
        ip: clientIp(req),
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        referrer: String(req.headers.referer ?? ''),
        metadata: body.metadata ?? {},
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
