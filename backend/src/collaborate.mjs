/**
 * Collaborate — alur kerja ala Framer: branch, review, komentar, merge.
 *
 * Untuk satu orang pun ini berguna: branch = ruang aman untuk mencoba
 * perubahan konten sebelum masuk ke produksi. Komentar = catatan review
 * yang menempel pada target (halaman/elemen), bukan tercampur di chat.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './db.mjs';
import { isValidSlug } from './cms.mjs';

// ── BRANCH ───────────────────────────────────────────────────────────────────

const BRANCH_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function createBranch({ name, base = 'main', author = 'admin', message = '' }) {
  if (!BRANCH_RE.test(String(name ?? ''))) throw new Error('nama branch tidak valid');
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cms_branches (name, base, author, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?)`
  ).run(name, base, author, String(message).slice(0, 300), now, now);
  return getBranch(name);
}

export function getBranch(name) {
  if (!BRANCH_RE.test(String(name ?? ''))) return null;
  const row = getDb().prepare('SELECT * FROM cms_branches WHERE name = ?').get(name);
  if (!row) return null;
  const changes = getDb().prepare(
    'SELECT * FROM cms_branch_changes WHERE branch = ? ORDER BY created_at ASC'
  ).all(name);
  return { ...row, changes: changes.map(c => ({ ...c, payload: safeParse(c.payload, {}) })) };
}

export function listBranches({ status = null } = {}) {
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM cms_branches WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM cms_branches ORDER BY updated_at DESC').all();
  return rows.map(r => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM cms_branch_changes WHERE branch = ?').get(r.name);
    return { ...r, change_count: n };
  });
}

/** Catat perubahan di sebuah branch (tidak menyentuh data produksi). */
export function recordChange({ branch, collection, itemSlug, action = 'update', payload = {}, author = 'admin' }) {
  if (!BRANCH_RE.test(String(branch ?? ''))) throw new Error('branch tidak valid');
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cms_branch_changes (branch, collection, item_slug, action, payload, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(branch, String(collection ?? ''), String(itemSlug ?? ''), String(action).slice(0, 40), JSON.stringify(payload), author, now);
  db.prepare('UPDATE cms_branches SET updated_at = ? WHERE name = ?').run(now, branch);
  return true;
}

/** Tutup branch tanpa merge (dibuang). */
export function discardBranch(name) {
  const db = getDb();
  db.prepare('UPDATE cms_branches SET status = ?, updated_at = ? WHERE name = ?')
    .run('discarded', Date.now(), name);
  return true;
}

/**
 * Merge branch: terapkan semua perubahan ke "produksi" lewat callback.
 * Callback menerima (change) dan mengembalikan true kalau berhasil.
 * Dipisah begini supaya modul ini tidak perlu tahu soal CMS.
 */
export function mergeBranch(name, applyFn) {
  const branch = getBranch(name);
  if (!branch) return { ok: false, error: 'branch_tidak_ada' };
  if (branch.status !== 'open') return { ok: false, error: 'branch_tidak_terbuka' };

  const applied = [];
  for (const change of branch.changes) {
    try {
      const ok = applyFn(change);
      applied.push({ change: change.id, ok: Boolean(ok) });
    } catch (err) {
      applied.push({ change: change.id, ok: false, error: err.message });
    }
  }

  const failed = applied.filter(a => !a.ok);
  if (failed.length) {
    return { ok: false, error: 'sebagian_gagal', applied };
  }

  getDb().prepare('UPDATE cms_branches SET status = ?, updated_at = ? WHERE name = ?')
    .run('merged', Date.now(), name);
  return { ok: true, applied };
}

// ── COMMENTS ─────────────────────────────────────────────────────────────────

/**
 * Komentar review. `target` = halaman/konten, `anchor` = elemen spesifik
 * (mis. "hero-title" atau CSS selector) supaya feedback menempel di tempatnya.
 *
 * ── A8: MODERASI ────────────────────────────────────────────────────────────
 *
 * Komentar publik masuk dengan status 'pending' dan TIDAK ditampilkan sampai
 * admin menyetujuinya. Sebelumnya komentar langsung tayang begitu dikirim —
 * artinya siapa pun di internet bisa menulis apa pun (spam, tautan judi,
 * ujaran kebencian) ke halaman publik Anda, dan itu langsung terlihat.
 *
 * `asAdmin: true` untuk komentar yang dibuat lewat panel admin — komentar
 * Anda sendiri tidak perlu disetujui diri sendiri, jadi langsung 'approved'.
 */
export function addComment({ target, anchor = '', body, author = 'guest', parentId = null, asAdmin = false }) {
  const text = String(body ?? '').trim();
  if (!text) throw new Error('komentar kosong');
  if (text.length > 4000) throw new Error('komentar terlalu panjang');

  const db = getDb();
  const status = asAdmin ? 'approved' : 'pending';
  const info = db.prepare(
    `INSERT INTO cms_comments (target, anchor, body, author, resolved, parent_id, created_at, status)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(String(target).slice(0, 300), String(anchor).slice(0, 200), text, String(author).slice(0, 80), parentId, Date.now(), status);
  return { id: Number(info.lastInsertRowid), status };
}

/**
 * Daftar komentar.
 *
 * `status` menyaring berdasarkan moderasi. Bawaannya `'approved'` — supaya
 * pemanggil yang tidak menyebut status (halaman publik) TIDAK PERNAH
 * menampilkan komentar yang belum disetujui. Ini pilihan yang aman:
 * lupa menyebut status berarti aman, bukan berarti bocor.
 *
 * Panel admin memanggil dengan status eksplisit (mis. 'pending' atau null
 * untuk semua).
 */
export function listComments({ target = null, resolved = null, limit = 200, status = 'approved' } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (target) { where.push('target = ?'); params.push(target); }
  if (resolved !== null) { where.push('resolved = ?'); params.push(resolved ? 1 : 0); }
  // status === null berarti "semua status" (dipakai panel admin).
  if (status !== null) { where.push('status = ?'); params.push(String(status)); }
  const sql = `SELECT * FROM cms_comments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT ?`;
  params.push(Math.min(Number(limit) || 200, 500));
  return db.prepare(sql).all(...params);
}

export function resolveComment(id, resolved = true) {
  getDb().prepare('UPDATE cms_comments SET resolved = ? WHERE id = ?')
    .run(resolved ? 1 : 0, Number(id));
  return true;
}

/**
 * Setujui atau tolak komentar.
 *
 * `status` hanya menerima tiga nilai yang dikenal. Daftar putih eksplisit
 * (bukan sekadar "apa saja yang bukan approved") supaya nilai aneh dari
 * pemanggil tidak diam-diam tersimpan dan membuat komentar menghilang
 * dari semua tampilan tanpa penjelasan.
 */
export function moderateComment(id, status) {
  const allowed = ['approved', 'pending', 'rejected'];
  if (!allowed.includes(status)) {
    throw new Error(`status tidak dikenal: ${status} (harus salah satu dari ${allowed.join(', ')})`);
  }
  const info = getDb().prepare('UPDATE cms_comments SET status = ? WHERE id = ?')
    .run(status, Number(id));
  return { changed: Number(info.changes ?? 0) };
}

/** Ringkasan moderasi untuk badge di panel admin. */
export function commentStats() {
  const rows = getDb().prepare(
    'SELECT status, COUNT(*) AS n FROM cms_comments GROUP BY status'
  ).all();
  const out = { approved: 0, pending: 0, rejected: 0, total: 0 };
  for (const r of rows) {
    const k = String(r.status);
    if (k in out) out[k] = Number(r.n);
    out.total += Number(r.n);
  }
  return out;
}

// ── UTIL ─────────────────────────────────────────────────────────────────────

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
