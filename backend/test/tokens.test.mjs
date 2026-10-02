/**
 * Tes layanan token — perilaku inti yang dijanjikan PRD v2.0 §7.3.
 *
 * Setiap tes memakai database sementara sendiri supaya tidak saling mengganggu.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, closeDb } from '../src/db.mjs';
import { hashToken, hashesEqual, issueToken, findTokenByPlaintext, revokeToken, tokenProblem, listTokens, suspendToken, resumeToken } from '../src/tokens.mjs';
import { createSession, validateSession, destroySession, countSessions } from '../src/sessions.mjs';
import { recordEvent, distinctIpsForToken, requestsInWindow, consecutiveFailures, recordLead, listLeads, recentEvents } from '../src/audit.mjs';
import { checkAbuse, revokeMessage } from '../src/guard.mjs';
import { makeFingerprint, recordFingerprint, analyzeFingerprints } from '../src/fingerprint.mjs';
import { isValidSlug } from '../src/content.mjs';

const SECRET = 'test-secret-yang-cukup-panjang-untuk-tes';

/** Database sementara untuk satu tes. */
function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'token-test-'));
  openDb(join(dir, 'test.db'));
  try {
    return fn();
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Token: penerbitan & verifikasi ─────────────────────────────────────────────────────────

test('issueToken menghasilkan token format VP-XXXX-XXXX-XXXX-XXXX', () => {
  withDb(() => {
    const a = issueToken({ secret: SECRET, projectSlug: 'mina', prefix: 'VP-', segments: 4, segmentLength: 4 });
    assert.match(a.token, /^VP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'format token harus VP-XXXX-XXXX-XXXX-XXXX');
    assert.notEqual(hashToken(a.token, SECRET), a.token, 'hash tidak boleh sama dengan plaintext');
  });
});

test('dua token yang diterbitkan berbeda', () => {
  withDb(() => {
    const a = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const b = issueToken({ secret: SECRET, projectSlug: 'mina' });
    assert.notEqual(a.token, b.token, 'dua token harus berbeda');
  });
});

test('token yang diterbitkan bisa ditemukan kembali lewat plaintext', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', issuedTo: 'PT Contoh', company: 'PT Contoh Teknologi' });
    const found = findTokenByPlaintext(issued.token, SECRET);
    assert.ok(found, 'token harus ditemukan');
    assert.equal(found.id, issued.id);
    assert.equal(found.project_slug, 'mina');
    assert.equal(found.issued_to, 'PT Contoh');
    assert.equal(found.company, 'PT Contoh Teknologi');
    assert.equal(found.status, 'active');
    assert.equal(found.tier, 'standard');
  });
});

test('token dengan tier enterprise', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', tier: 'enterprise' });
    const found = findTokenByPlaintext(issued.token, SECRET);
    assert.equal(found.tier, 'enterprise');
  });
});

test('token dengan scopes multiple projects', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', scopes: ['mina', 'spareparts'] });
    const found = findTokenByPlaintext(issued.token, SECRET);
    assert.ok(Array.isArray(found.scopes), 'scopes harus array');
    assert.equal(found.scopes.length, 2);
    assert.ok(found.scopes.includes('mina'));
    assert.ok(found.scopes.includes('spareparts'));
  });
});

test('token dengan secret berbeda tidak ditemukan', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    assert.equal(findTokenByPlaintext(issued.token, 'secret-lain-yang-juga-panjang'), null);
  });
});

test('database TIDAK menyimpan plaintext token', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const row = findTokenByPlaintext(issued.token, SECRET);
    assert.ok(!JSON.stringify(row).includes(issued.token), 'plaintext tidak boleh ada di baris database');
  });
});

// ── Masa berlaku ──────────────────────────────────────────────────────────────────────────────────────

test('token kedaluwarsa terdeteksi', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', expiresInDays: 1 });
    const row = findTokenByPlaintext(issued.token, SECRET);
    assert.equal(tokenProblem(row, Date.now()), null, 'belum kedaluwarsa');
    const besok = Date.now() + 2 * 86_400_000;
    assert.equal(tokenProblem(row, besok), 'expired', 'harus terdeteksi kedaluwarsa');
  });
});

test('token tanpa kedaluwarsa tidak pernah expired', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const row = findTokenByPlaintext(issued.token, SECRET);
    const jauh = Date.now() + 3650 * 86_400_000;
    assert.equal(tokenProblem(row, jauh), null);
  });
});

// ── Pencabutan ────────────────────────────────────────────────────────────────────────────────────────────────────

test('revokeToken membuat token tidak valid dan mencatat alasan', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const result = revokeToken(issued.id, 'kontrak selesai');
    assert.equal(result.revoked, true);
    const row = findTokenByPlaintext(issued.token, SECRET);
    assert.equal(tokenProblem(row), 'revoked');
    assert.equal(row.revoked_reason, 'kontrak selesai');
  });
});

test('revokeToken menghapus semua sesi aktif', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', maxDevices: 3 });
    const sess1 = createSession({ tokenId: issued.id, secret: SECRET, ip: '1.1.1.1' });
    const sess2 = createSession({ tokenId: issued.id, secret: SECRET, ip: '2.2.2.2' });
    assert.equal(countSessions(issued.id), 2);
    revokeToken(issued.id, 'test');
    assert.equal(countSessions(issued.id), 0, 'semua sesi harus dihapus saat revoke');
  });
});

test('mencabut dua kali tidak mengubah apa pun', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    assert.equal(revokeToken(issued.id, 'alasan pertama').revoked, true);
    assert.equal(revokeToken(issued.id, 'alasan kedua').revoked, false, 'pencabutan kedua tidak berpengaruh');
    const row = findTokenByPlaintext(issued.token, SECRET);
    assert.equal(row.revoked_reason, 'alasan pertama', 'alasan asli dipertahankan');
  });
});

test('suspend lalu resume mengembalikan token ke aktif', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    assert.equal(suspendToken(issued.id, 'menunggu konfirmasi').suspended, true);
    assert.equal(tokenProblem(findTokenByPlaintext(issued.token, SECRET)), 'suspended');
    assert.equal(resumeToken(issued.id).resumed, true);
    assert.equal(tokenProblem(findTokenByPlaintext(issued.token, SECRET)), null);
  });
});

// ── Daftar token ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('listTokens memfilter per proyek dan tier, tidak membocorkan hash', () => {
  withDb(() => {
    issueToken({ secret: SECRET, projectSlug: 'mina', tier: 'standard' });
    issueToken({ secret: SECRET, projectSlug: 'mina', tier: 'enterprise' });
    issueToken({ secret: SECRET, projectSlug: 'spareparts', tier: 'standard' });

    const mina = listTokens({ projectSlug: 'mina' });
    assert.equal(mina.length, 2);
    assert.ok(!('token_hash' in mina[0]), 'hash tidak boleh ikut dalam daftar');
    assert.equal(listTokens({ projectSlug: 'spareparts' }).length, 1);
    assert.equal(listTokens({ tier: 'enterprise' }).length, 1);
    assert.equal(listTokens().length, 3);
  });
});

// ── Session ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('createSession membuat sesi baru', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', maxDevices: 3 });
    const sess = createSession({ tokenId: issued.id, secret: SECRET, ip: '1.1.1.1' });
    assert.ok(sess.id.startsWith('sess_'));
    assert.ok(sess.expiresAt > Date.now());
  });
});

test('validateSession mengembalikan token dan session row', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', maxDevices: 3 });
    const sess = createSession({ tokenId: issued.id, secret: SECRET, ip: '1.1.1.1' });
    const result = validateSession(sess.id, SECRET);
    assert.ok(result);
    assert.equal(result.tokenRow.id, issued.id);
    assert.equal(result.sessionRow.ip, '1.1.1.1');
  });
});

test('validateSession mengembalikan null untuk sesi tidak valid', () => {
  withDb(() => {
    assert.equal(validateSession('sess_tidak_ada', SECRET), null);
  });
});

test('maxDevices: sesi ke-4 menghapus sesi paling lama', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', maxDevices: 2 });
    const sess1 = createSession({ tokenId: issued.id, secret: SECRET, ip: '1.1.1.1' });
    const sess2 = createSession({ tokenId: issued.id, secret: SECRET, ip: '2.2.2.2' });
    assert.equal(countSessions(issued.id), 2);

    const sess3 = createSession({ tokenId: issued.id, secret: SECRET, ip: '3.3.3.3' });
    assert.equal(countSessions(issued.id), 2, 'hanya 2 sesi yang tersisa');
    assert.equal(validateSession(sess1.id, SECRET), null, 'sesi pertama dihapus');
    assert.ok(validateSession(sess3.id, SECRET), 'sesi terbaru ada');
  });
});

test('destroySession menghapus sesi', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', maxDevices: 3 });
    const sess = createSession({ tokenId: issued.id, secret: SECRET, ip: '1.1.1.1' });
    assert.ok(validateSession(sess.id, SECRET));
    assert.equal(destroySession(sess.id, SECRET), true);
    assert.equal(validateSession(sess.id, SECRET), null);
  });
});

// ── Audit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('peristiwa akses tercatat dan bisa dibaca kembali', () => {
  withDb(() => {
    recordEvent({ action: 'validate', outcome: 'ok', ip: '1.2.3.4', projectSlug: 'mina' });
    recordEvent({ action: 'validate', outcome: 'tanpa_token', ip: '5.6.7.8', projectSlug: 'mina' });
    const events = recentEvents({ limit: 10 });
    assert.equal(events.length, 2);
    assert.equal(events[0].outcome, 'tanpa_token', 'terbaru lebih dulu');
  });
});

test('distinctIpsForToken hanya menghitung IP dalam jendela waktu', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok', ip: '1.1.1.1' });
    recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok', ip: '2.2.2.2' });
    recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok', ip: '3.3.3.3' });
    assert.equal(distinctIpsForToken(issued.id, 3_600_000).length, 3);
    // Jendela sangat pendek: tidak ada yang tercatat.
    assert.equal(distinctIpsForToken(issued.id, 1).length, 0);
  });
});

test('requestsInWindow menghitung permintaan validate, content, dan session_create', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    for (let i = 0; i < 5; i += 1) {
      recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok' });
    }
    recordEvent({ tokenId: issued.id, action: 'session_create', outcome: 'ok' });
    recordEvent({ tokenId: issued.id, action: 'issue', outcome: 'ok' });
    assert.equal(requestsInWindow(issued.id, 60_000), 6, 'aksi issue tidak dihitung, session_create dihitung');
  });
});

test('consecutiveFailures berhenti di keberhasilan terakhir', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok' });
    recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'expired' });
    recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'revoked' });
    assert.equal(consecutiveFailures(issued.id), 2, 'hanya kegagalan setelah keberhasilan terakhir');
  });
});

// ── Penjaga penyalahgunaan ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('checkAbuse melaporkan token yang dipakai dari terlalu banyak IP', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', maxIps: 2 });
    const row = findTokenByPlaintext(issued.token, SECRET);
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']) {
      recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok', ip });
    }
    const verdict = checkAbuse(row, { ip: '10.0.0.4' });
    assert.equal(verdict.violated, true);
    assert.equal(verdict.reason, 'token_dibagikan');
  });
});

test('checkAbuse bersih untuk token yang dipakai satu IP', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina', maxIps: 3 });
    const row = findTokenByPlaintext(issued.token, SECRET);
    recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok', ip: '10.0.0.1' });
    assert.equal(checkAbuse(row, { ip: '10.0.0.1' }).violated, false);
  });
});

test('checkAbuse melaporkan laju request berlebihan', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const row = findTokenByPlaintext(issued.token, SECRET);
    for (let i = 0; i < 50; i += 1) {
      recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'ok', ip: '10.0.0.1' });
    }
    const verdict = checkAbuse(row, { ip: '10.0.0.1' });
    assert.equal(verdict.violated, true);
    assert.equal(verdict.reason, 'laju_berlebihan');
  });
});

test('checkAbuse melaporkan percobaan gagal beruntun', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const row = findTokenByPlaintext(issued.token, SECRET);
    for (let i = 0; i < 15; i += 1) {
      recordEvent({ tokenId: issued.id, action: 'validate', outcome: 'token_tidak_dikenal' });
    }
    const verdict = checkAbuse(row, { ip: '10.0.0.1' });
    assert.equal(verdict.violated, true);
    assert.equal(verdict.reason, 'percobaan_beruntun');
  });
});

test('checkAbuse melaporkan fingerprint anomaly (banyak device berbeda)', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const row = findTokenByPlaintext(issued.token, SECRET);
    // Simulasi 5 sesi dari 3 fingerprint berbeda
    for (let i = 0; i < 5; i++) {
      const fp = `fp_${i % 3}`; // 3 fingerprint unik
      recordFingerprint({ sessionId: `sess_${i}`, tokenId: issued.id, fingerprint: fp, ip: `10.0.0.${i}`, country: 'ID' });
    }
    const verdict = checkAbuse(row, { ip: '10.0.0.5' });
    assert.equal(verdict.violated, true);
    assert.equal(verdict.reason, 'token_dibagikan');
    assert.ok(verdict.detail.includes('fingerprint'));
  });
});

test('fingerprint bersih untuk device yang sama', () => {
  withDb(() => {
    const issued = issueToken({ secret: SECRET, projectSlug: 'mina' });
    const row = findTokenByPlaintext(issued.token, SECRET);
    // 2 sesi dari fingerprint sama
    for (let i = 0; i < 2; i++) {
      recordFingerprint({ sessionId: `sess_${i}`, tokenId: issued.id, fingerprint: 'fp_sama', ip: '10.0.0.1', country: 'ID' });
    }
    const verdict = checkAbuse(row, { ip: '10.0.0.1' });
    assert.equal(verdict.violated, false);
  });
});

test('makeFingerprint konsisten untuk request yang sama', () => {
  const req1 = { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'id-ID', 'accept-encoding': 'gzip', 'dnt': '1' } };
  const req2 = { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'id-ID', 'accept-encoding': 'gzip', 'dnt': '1' } };
  assert.equal(makeFingerprint(req1), makeFingerprint(req2));
});

test('makeFingerprint berbeda untuk request berbeda', () => {
  const req1 = { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'id-ID', 'accept-encoding': 'gzip' } };
  const req2 = { headers: { 'user-agent': 'Chrome/90.0', 'accept-language': 'en-US', 'accept-encoding': 'gzip' } };
  assert.notEqual(makeFingerprint(req1), makeFingerprint(req2));
});

test('revokeMessage selalu mengembalikan pesan untuk alasan apa pun', () => {
  assert.ok(revokeMessage('token_dibagikan').includes('dinonaktifkan'));
  assert.ok(revokeMessage('alasan_tidak_dikenal').length > 0, 'alasan asing tetap dapat pesan');
});

// ── Slug proyek ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('isValidSlug menolak upaya keluar dari direktori', () => {
  assert.equal(isValidSlug('mina'), true);
  assert.equal(isValidSlug('spareparts-inventory'), true);
  assert.equal(isValidSlug('../rahasia'), false, 'path traversal ditolak');
  assert.equal(isValidSlug('MINA'), false, 'huruf besar ditolak');
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug('a/b'), false);
  assert.equal(isValidSlug('mina.json'), false);
});

// ── Permintaan sales ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('permintaan akses tercatat dan bisa dibaca', () => {
  withDb(() => {
    const { id } = recordLead({
      company: 'PT Contoh', name: 'Budi', email: 'budi@contoh.co.id',
      role: 'CTO', projectSlug: 'mina', budgetRange: '10-50 juta', urgency: 'tinggi',
      message: 'Mau lihat arsitektur',
    });
    assert.ok(id > 0);
    const leads = listLeads();
    assert.equal(leads.length, 1);
    assert.equal(leads[0].email, 'budi@contoh.co.id');
    assert.equal(leads[0].role, 'CTO');
    assert.equal(leads[0].budget_range, '10-50 juta');
    assert.equal(leads[0].urgency, 'tinggi');
    assert.equal(leads[0].status, 'new');
  });
});

// ── Perbandingan hash aman waktu ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('hashesEqual benar untuk hash sama dan salah untuk berbeda', () => {
  const a = hashToken('VP-ABCD-EFGH-IJKL-MNOP', SECRET);
  assert.equal(hashesEqual(a, hashToken('VP-ABCD-EFGH-IJKL-MNOP', SECRET)), true);
  assert.equal(hashesEqual(a, hashToken('VP-ZZZZ-ZZZZ-ZZZZ-ZZZZ', SECRET)), false);
  assert.equal(hashesEqual(a, 'pendek'), false, 'panjang berbeda tidak melempar');
});
