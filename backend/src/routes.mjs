/**
 * Rute HTTP layanan token.
 *
 * Publik:
 *   GET  /api/health
 *   POST /api/token/validate      — cek token, buka metadata proyek
 *   GET  /api/project/:slug/locked — konten sensitif (butuh token)
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
import { recordEvent, recentEvents, recordLead, listLeads } from './audit.mjs';
import { enforceAbuseRules, revokeMessage } from './guard.mjs';
import { isValidSlug, loadLockedContent, sampleLockedContent } from './content.mjs';
import {
  applyCors, clientCountry, clientIp, extractToken, handlePreflight,
  readJson, sendJson,
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

  // Proyek pada token harus cocok dengan proyek yang diminta — token berlaku per proyek.
  if (projectSlug && row.project_slug !== projectSlug) {
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
        label: row.label,
        issued_to: row.issued_to,
        expires_at: row.expires_at,
      });
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
      const { row, error } = verifyToken(req, {}, { projectSlug: slug, action: 'content' });
      if (error) return sendJson(res, error.status, error.body);

      const content = loadLockedContent(slug) ?? sampleLockedContent(slug);
      sendJson(res, 200, { ok: true, project: slug, issued_to: row.issued_to, content });
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
        projectSlug: String(body.project ?? '').slice(0, 64),
        message: String(body.message ?? '').slice(0, 4000),
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      recordEvent({
        projectSlug: String(body.project ?? ''), action: 'lead', outcome: 'ok',
        ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      sendJson(res, 200, { ok: true, id: result.id, message: 'Permintaan Anda tercatat. Sales akan menghubungi Anda.' });
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
      const result = issueToken({
        secret: config.secret,
        projectSlug: slug,
        label: String(body.label ?? '').slice(0, 200),
        issuedTo: String(body.issued_to ?? '').slice(0, 200),
        issuedBy: 'admin',
        expiresInDays: body.expires_in_days ? Number(body.expires_in_days) : null,
        maxIps: body.max_ips ? Number(body.max_ips) : config.maxDistinctIps,
        notes: String(body.notes ?? '').slice(0, 500),
        prefix: config.tokenPrefix,
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
        expires_at: result.expires_at,
        max_ips: result.max_ips,
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
