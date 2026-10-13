/**
 * Tes: URL pembayaran tersimpan & migrasi kolomnya.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * API status v2 Midtrans tidak mengenal transaksi Snap yang belum dibuka
 * pembeli ("Transaction doesn't exist"). Tanpa URL yang disimpan sendiri,
 * setiap percobaan ulang checkout membuat transaksi Snap BARU dengan
 * order_id yang sama — dua halaman pembayaran yang keduanya bisa dibayar.
 *
 * Tes ini memastikan:
 *   1. Database baru punya kolom payment_url & snap_token
 *   2. Database LAMA (skema tanpa kolom itu) mendapatkannya lewat migrate()
 *   3. Baris lama tidak hilang, dan nilai kolom barunya kosong (bukan karangan)
 *
 * Jalankan: node --test backend/test/pembayaran-url.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, getDb, closeDb } from '../src/db.mjs';

const KOLOM_BARU = ['payment_url', 'snap_token'];

describe('kolom URL pembayaran', () => {
  let dir;
  let dbBaru;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'uji-url-bayar-'));
  });

  after(() => {
    try { closeDb(); } catch { /* sudah tertutup */ }
    rmSync(dir, { recursive: true, force: true });
  });

  test('database baru punya kolom payment_url & snap_token', () => {
    const path = join(dir, 'baru.db');
    openDb(path);
    dbBaru = getDb();
    const kolom = dbBaru.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
    for (const c of KOLOM_BARU) {
      assert.ok(kolom.includes(c), `kolom ${c} harus ada di database baru`);
    }
  });

  test('database LAMA mendapat kolomnya lewat migrate()', () => {
    // Bangun database "lama": skema payments TANPA kolom baru — persis
    // seperti database produksi sebelum migrasi ini.
    const path = join(dir, 'lama.db');
    const lama = new DatabaseSync(path);
    lama.exec(`
      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        midtrans_order_id TEXT,
        midtrans_customer_id TEXT,
        midtrans_subscription_id TEXT,
        tier TEXT NOT NULL,
        periode TEXT NOT NULL,
        jumlah INTEGER NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        nama TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        alasan_gagal TEXT,
        token_id TEXT,
        dibuat_pada INTEGER NOT NULL,
        dibayar_pada INTEGER,
        kedaluwarsa_pada INTEGER,
        catatan TEXT NOT NULL DEFAULT '{}'
      );
    `);
    lama.prepare(`
      INSERT INTO payments (id, idempotency_key, tier, periode, jumlah, email, status, dibuat_pada)
      VALUES ('pay_lama', 'kunci-lama-1234567890', 'standar', 'bulanan', 63200, 'lama@contoh.com', 'pending', 1)
    `).run();
    lama.close();

    // Buka lewat openDb() — SCHEMA + migrate() dijalankan pada database lama.
    closeDb();
    openDb(path);
    const db = getDb();

    const kolom = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
    for (const c of KOLOM_BARU) {
      assert.ok(kolom.includes(c), `kolom ${c} harus ditambahkan oleh migrate()`);
    }

    // Baris lama tetap ada, dan kolom barunya kosong — bukan nilai karangan.
    const baris = db.prepare('SELECT * FROM payments WHERE id = ?').get('pay_lama');
    assert.ok(baris, 'baris lama tidak boleh hilang');
    assert.equal(baris.payment_url, null, 'baris lama tidak punya URL — harus null');
    assert.equal(baris.snap_token, null, 'baris lama tidak punya token Snap — harus null');

    // Kolom baru bisa ditulis & dibaca.
    db.prepare('UPDATE payments SET payment_url = ?, snap_token = ? WHERE id = ?')
      .run('https://app.midtrans.com/snap/v4/redirection/abc', 'tok-snap-abc', 'pay_lama');
    const sesudah = db.prepare('SELECT payment_url, snap_token FROM payments WHERE id = ?').get('pay_lama');
    assert.equal(sesudah.payment_url, 'https://app.midtrans.com/snap/v4/redirection/abc');
    assert.equal(sesudah.snap_token, 'tok-snap-abc');
  });
});
