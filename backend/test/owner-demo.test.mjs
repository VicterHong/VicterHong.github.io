/**
 * Tes: Demo Anthropic hanya bisa diakses oleh akun owner.
 *
 * ── YANG DIUJI ──────────────────────────────────────────────────────────────
 * 1. Pengunjung anonim memanggil /api/owner/demo-anthropic → 404 (tidak ditemukan).
 * 2. Pengguna biasa (bukan owner) memanggil endpoint → 404 (tidak ditemukan).
 * 3. Akun owner (email di config.ownerEmails) → 200 dengan dokumen HTML.
 * 4. Berkas demo-anthropic.html TIDAK ADA di root publik git.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { openDb, closeDb } from '../src/db.mjs';
import { siapkanTabelPengguna, buatPengguna } from '../src/users.mjs';
import { issueToken } from '../src/tokens.mjs';
import { createSession } from '../src/sessions.mjs';
import { config } from '../src/config.mjs';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Buat direktori konten dummy agar tes dapat berjalan di CI di mana ~/.portfolio-token tidak ada
const tempContentDir = join(tmpdir(), `test-content-${Date.now()}`);
mkdirSync(tempContentDir, { recursive: true });
writeFileSync(
  join(tempContentDir, 'demo-anthropic.html'),
  '<!DOCTYPE html><html><head><title>Anthropic</title></head><body>--color-ivory-medium</body></html>',
  'utf8',
);
const originalContentDir = config.contentDir;
const originalSecret = config.secret;
const originalOwnerEmails = [...config.ownerEmails];

config.contentDir = tempContentDir;
if (!config.secret) {
  config.secret = 'synthetic-test-secret-32-chars-long-minimum-hex';
}
if (!config.ownerEmails.length) {
  config.ownerEmails = ['owner.test@example.com'];
}

openDb(':memory:');
siapkanTabelPengguna();

const { resolveRoute, initRoutes } = await import('../src/routes.mjs');
initRoutes();

after(() => {
  closeDb();
  config.contentDir = originalContentDir;
  config.secret = originalSecret;
  config.ownerEmails = originalOwnerEmails;
  try { rmSync(tempContentDir, { recursive: true, force: true }); } catch {}
});

function panggil(path, method = 'GET', headers = {}) {
  return new Promise((selesai) => {
    const resolved = resolveRoute(method, path);
    if (!resolved || !resolved.route) {
      selesai({ status: 404, headers: {}, body: { ok: false, error: 'rute_tidak_ada' } });
      return;
    }

    let status = 200;
    const respHeaders = {};
    let data = '';

    const req = {
      method,
      url: path,
      headers: { host: 'localhost', ...headers },
      connection: { remoteAddress: '127.0.0.1' },
      on: (ev, fn) => { if (ev === 'end') setTimeout(fn, 0); },
    };

    const res = {
      writeHead: (st, hdrs = {}) => {
        status = st;
        Object.assign(respHeaders, hdrs);
      },
      setHeader: (k, v) => { respHeaders[k.toLowerCase()] = v; },
      end: (chunk) => {
        data += chunk ? String(chunk) : '';
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        selesai({ status, headers: respHeaders, body: parsed, raw: data });
      },
    };

    resolved.route.handler(req, res, resolved.params, new URL(path, 'http://localhost'));
  });
}

test('demo-anthropic.html TIDAK ADA di root publik git', () => {
  assert.equal(existsSync(join(AKAR, 'demo-anthropic.html')), false, 'tidak boleh ada di root publik git');
});

test('pengunjung anonim mendapat 404 pada /api/owner/demo-anthropic', async () => {
  const r = await panggil('/api/owner/demo-anthropic');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'tidak_ditemukan');
});

test('pengguna biasa (bukan owner) mendapat 404 pada /api/owner/demo-anthropic', async () => {
  const token = issueToken({ projectSlug: 'mina', issuedTo: 'user.biasa@example.com', secret: config.secret });
  const user = await buatPengguna({ email: 'user.biasa@example.com', sandi: 'SandiRahasia123!', tokenId: token.id });
  const sess = createSession({ tokenId: token.id, secret: config.secret });
  const cookie = `portfolio_session=${sess.id}`;

  const r = await panggil('/api/owner/demo-anthropic', 'GET', { cookie });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'tidak_ditemukan');
});

test('akun owner mendapat 200 dan dokumen HTML penuh', async () => {
  const ownerEmail = config.ownerEmails[0] || 'owner.test@example.com';
  if (!config.ownerEmails.includes(ownerEmail)) {
    config.ownerEmails.push(ownerEmail);
  }

  const token = issueToken({ projectSlug: 'mina', issuedTo: ownerEmail, secret: config.secret });
  const ownerUser = await buatPengguna({ email: ownerEmail, sandi: 'SandiOwner123!@#', tokenId: token.id });
  const sess = createSession({ tokenId: token.id, secret: config.secret });
  const cookie = `portfolio_session=${sess.id}`;

  const r = await panggil('/api/owner/demo-anthropic', 'GET', { cookie });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'] || r.headers['Content-Type'], /text\/html/);
  assert.match(r.raw, /Anthropic/i);
  assert.match(r.raw, /--color-ivory-medium/);
});
