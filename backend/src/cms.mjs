/**
 * CMS — koleksi konten dinamis dengan draft/publish + versioning.
 *
 * Meniru alur kerja Framer CMS (tanpa UI kanvas):
 *   - Collection: skema konten (mis. "proyek", "catatan", "halaman")
 *   - Item: entri dalam koleksi, punya status draft → review → published
 *   - Version: setiap perubahan disimpan, bisa dibandingkan & dikembalikan
 *
 * Prinsip yang sama dengan modul lain di repo ini:
 *   - Nol dependency eksternal (node:sqlite bawaan)
 *   - Semua operasi tulis dicatat di audit log
 *   - Slug divalidasi ketat (anti path traversal)
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './db.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const STATUSES = new Set(['draft', 'review', 'published', 'archived']);

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

// ── COLLECTIONS ──────────────────────────────────────────────────────────────

/** Buat koleksi baru. `fields` = array {name, type, required?}. */
export function createCollection({ slug, title, fields, createdBy = 'admin' }) {
  if (!isValidSlug(slug)) throw new Error('slug koleksi tidak valid');
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cms_collections (slug, title, fields, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(slug, String(title ?? slug).slice(0, 200), JSON.stringify(fields ?? []), createdBy, now, now);
  return getCollection(slug);
}

export function getCollection(slug) {
  if (!isValidSlug(slug)) return null;
  const row = getDb().prepare('SELECT * FROM cms_collections WHERE slug = ?').get(slug);
  if (!row) return null;
  return { ...row, fields: safeParse(row.fields, []) };
}

export function listCollections() {
  return getDb().prepare('SELECT * FROM cms_collections ORDER BY slug').all()
    .map(r => ({ ...r, fields: safeParse(r.fields, []) }));
}

// ── ITEMS ────────────────────────────────────────────────────────────────────

/**
 * Simpan item (buat baru atau update).
 * Setiap simpanan membuat versi baru — riwayat tidak pernah hilang.
 */
export function saveItem({ collection, itemSlug, data, status = 'draft', author = 'admin', message = '' }) {
  if (!isValidSlug(collection)) throw new Error('koleksi tidak valid');
  if (!isValidSlug(itemSlug)) throw new Error('slug item tidak valid');
  if (!STATUSES.has(status)) throw new Error('status tidak valid');

  const db = getDb();
  const now = Date.now();
  const existing = db.prepare(
    'SELECT * FROM cms_items WHERE collection = ? AND item_slug = ?'
  ).get(collection, itemSlug);

  const json = JSON.stringify(data ?? {});

  if (!existing) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO cms_items (id, collection, item_slug, data, status, version, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(id, collection, itemSlug, json, status, now, now, status === 'published' ? now : null);
    recordVersion(id, 1, json, status, author, message || 'initial');
    return getItem(collection, itemSlug);
  }

  const version = existing.version + 1;
  db.prepare(
    `UPDATE cms_items SET data = ?, status = ?, version = ?, updated_at = ?,
       published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
     WHERE collection = ? AND item_slug = ?`
  ).run(json, status, version, now, status, now, collection, itemSlug);

  recordVersion(existing.id, version, json, status, author, message || `update v${version}`);
  return getItem(collection, itemSlug);
}

function recordVersion(itemId, version, json, status, author, message) {
  getDb().prepare(
    `INSERT INTO cms_item_versions (id, item_id, version, data, status, author, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), itemId, version, json, status, author, String(message).slice(0, 500), Date.now());
}

export function getItem(collection, itemSlug, { includeDraft = true } = {}) {
  if (!isValidSlug(collection) || !isValidSlug(itemSlug)) return null;
  const row = getDb().prepare(
    'SELECT * FROM cms_items WHERE collection = ? AND item_slug = ?'
  ).get(collection, itemSlug);
  if (!row) return null;
  if (!includeDraft && row.status !== 'published') return null;
  return { ...row, data: safeParse(row.data, {}) };
}

/** Daftar item — default hanya yang published (untuk situs publik). */
export function listItems(collection, { includeDraft = false, limit = 100 } = {}) {
  if (!isValidSlug(collection)) return [];
  const db = getDb();
  const rows = includeDraft
    ? db.prepare(
        'SELECT * FROM cms_items WHERE collection = ? ORDER BY updated_at DESC LIMIT ?'
      ).all(collection, Math.min(Number(limit) || 100, 500))
    : db.prepare(
        `SELECT * FROM cms_items WHERE collection = ? AND status = 'published'
         ORDER BY published_at DESC LIMIT ?`
      ).all(collection, Math.min(Number(limit) || 100, 500));
  return rows.map(r => ({ ...r, data: safeParse(r.data, {}) }));
}

/** Ubah status item (draft → review → published → archived). */
export function setItemStatus(collection, itemSlug, status, author = 'admin') {
  if (!STATUSES.has(status)) throw new Error('status tidak valid');
  const item = getItem(collection, itemSlug);
  if (!item) return null;
  return saveItem({
    collection, itemSlug, data: item.data, status, author,
    message: `status → ${status}`,
  });
}

/** Hapus item beserta versinya. */
export function deleteItem(collection, itemSlug) {
  const db = getDb();
  const item = getItem(collection, itemSlug);
  if (!item) return false;
  db.prepare('DELETE FROM cms_item_versions WHERE item_id = ?').run(item.id);
  db.prepare('DELETE FROM cms_items WHERE id = ?').run(item.id);
  return true;
}

// ── VERSIONS ─────────────────────────────────────────────────────────────────

export function listVersions(collection, itemSlug, limit = 50) {
  const item = getItem(collection, itemSlug);
  if (!item) return [];
  return getDb().prepare(
    'SELECT id, version, status, author, message, created_at FROM cms_item_versions WHERE item_id = ? ORDER BY version DESC LIMIT ?'
  ).all(item.id, Math.min(Number(limit) || 50, 200));
}

/** Kembalikan item ke versi tertentu (membuat versi baru, bukan menghapus riwayat). */
export function rollback(collection, itemSlug, version, author = 'admin') {
  const item = getItem(collection, itemSlug);
  if (!item) return null;
  const row = getDb().prepare(
    'SELECT * FROM cms_item_versions WHERE item_id = ? AND version = ?'
  ).get(item.id, Number(version));
  if (!row) return null;
  return saveItem({
    collection, itemSlug, data: safeParse(row.data, {}), status: item.status,
    author, message: `rollback ke v${version}`,
  });
}

// ── UTIL ─────────────────────────────────────────────────────────────────────

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
