/**
 * Tes penjaga spam form publik (PRD v2.5, menutup pertanyaan Q3).
 *
 * Yang diuji adalah perilaku yang dijanjikan: bot disaring, manusia lolos.
 * Setiap tes memakai data form tiruan — tidak menyentuh jaringan atau DB.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreLead, tooManyLeadsFromIp } from '../src/spam-guard.mjs';

// ── Lead bersih: harus lolos tanpa penandaan ─────────────────────────────────

test('lead manusia normal mendapat verdict allow', () => {
  const r = scoreLead({
    body: {
      company: 'PT Teknologi Nusantara',
      name: 'Budi Santoso',
      email: 'budi@teknologi.co.id',
      role: 'CTO',
      message: 'Kami ingin mengevaluasi arsitektur MINA untuk kemungkinan kerja sama.',
      elapsed_ms: 45000,
      website: '',
    },
    ip: '203.0.113.10',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  assert.equal(r.verdict, 'allow', `seharusnya allow, dapat ${r.verdict} (skor ${r.score}: ${r.reasons})`);
  assert.equal(r.score, 0, 'lead bersih tidak boleh dapat skor risiko');
});

// ── Honeypot: bot yang mengisi field tersembunyi ─────────────────────────────

test('honeypot terisi → verdict block', () => {
  const r = scoreLead({
    body: {
      company: 'Spam Corp', name: 'Bot', email: 'bot@spam.com',
      message: 'Buy now', elapsed_ms: 5000, website: 'http://spam.example',
    },
    ip: '198.51.100.5',
    userAgent: 'Mozilla/5.0',
  });
  assert.equal(r.verdict, 'block');
  assert.ok(r.reasons.some((x) => x.includes('honeypot')), 'alasan harus menyebut honeypot');
});

// ── Waktu isi: bot mengirim terlalu cepat ────────────────────────────────────

test('form terisi < 3 detik → skor naik, masuk review', () => {
  const r = scoreLead({
    body: {
      company: 'Cepat Sekali', name: 'Test', email: 'a@b.com',
      message: 'Isi pesan normal saja', elapsed_ms: 400, website: '',
    },
    ip: '203.0.113.11',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  });
  assert.ok(r.score >= 40, 'pengisian super cepat harus menambah skor');
  assert.notEqual(r.verdict, 'allow', 'tidak boleh langsung allow');
  assert.ok(r.reasons.some((x) => x.includes('terlalu cepat')));
});

test('elapsed_ms tidak dikirim → tidak dihukum (manusia pakai autofill)', () => {
  const r = scoreLead({
    body: {
      company: 'PT Serius', name: 'Siti Rahayu', email: 'siti@serius.id',
      message: 'Kami tertarik dengan sistem inventory Anda untuk gudang kami.',
      website: '',
    },
    ip: '203.0.113.12',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  });
  assert.equal(r.verdict, 'allow', 'tanpa elapsed_ms tidak boleh dianggap bot');
});

// ── Email sekali-pakai: ditandai, bukan diblokir ─────────────────────────────

test('domain email sekali-pakai → review, bukan block', () => {
  const r = scoreLead({
    body: {
      company: 'Perorangan', name: 'Andi', email: 'andi@mailinator.com',
      message: 'Saya ingin melihat detail teknis proyek untuk belajar.', elapsed_ms: 30000,
    },
    ip: '203.0.113.13',
    userAgent: 'Mozilla/5.0',
  });
  assert.equal(r.verdict, 'review', 'email sekali-pakai ditandai, bukan diblokir — sebagian orang sah memakainya');
  assert.ok(r.reasons.some((x) => x.includes('sekali-pakai')));
});

// ── Kata kunci spam: diblokir ────────────────────────────────────────────────

test('kata kunci spam → skor tinggi', () => {
  const r = scoreLead({
    body: {
      company: 'SEO Masters', name: 'John', email: 'john@seo.example',
      message: 'We offer SEO services and buy backlinks for your website', elapsed_ms: 20000,
    },
    ip: '198.51.100.6',
    userAgent: 'Mozilla/5.0',
  });
  assert.ok(r.score >= 50, 'kata kunci spam harus menambah skor besar');
  assert.notEqual(r.verdict, 'allow');
});

// ── Tautan berlebihan ────────────────────────────────────────────────────────

test('pesan dengan banyak tautan ditandai', () => {
  const r = scoreLead({
    body: {
      company: 'Link Co', name: 'Test', email: 'test@example.com',
      message: 'Lihat https://a.com https://b.com https://c.com https://d.com https://e.com',
      elapsed_ms: 20000,
    },
    ip: '198.51.100.7',
    userAgent: 'Mozilla/5.0',
  });
  assert.ok(r.reasons.some((x) => x.includes('tautan')));
});

test('satu tautan wajar tidak dihukum', () => {
  const r = scoreLead({
    body: {
      company: 'PT Maju', name: 'Dewi', email: 'dewi@maju.co.id',
      message: 'Referensi kami: https://maju.co.id — ingin diskusi soal integrasi.',
      elapsed_ms: 60000,
    },
    ip: '203.0.113.14',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
  });
  assert.equal(r.verdict, 'allow');
});

// ── User-agent mencurigakan ──────────────────────────────────────────────────

test('user-agent curl/bot menambah skor', () => {
  const r = scoreLead({
    body: {
      company: 'PT A', name: 'B', email: 'b@a.com',
      message: 'Pesan biasa saja tanpa tautan', elapsed_ms: 30000,
    },
    ip: '198.51.100.8',
    userAgent: 'python-requests/2.31.0',
  });
  assert.ok(r.score > 0);
  assert.ok(r.reasons.some((x) => x.includes('user-agent')));
});

// ── Ambang verdict ───────────────────────────────────────────────────────────

test('skor 0-24 → allow, 25-99 → review, >=100 → block', () => {
  const clean = scoreLead({ body: { email: 'a@b.com', elapsed_ms: 30000 }, userAgent: 'Mozilla/5.0' });
  assert.equal(clean.verdict, 'allow');

  const suspicious = scoreLead({
    body: { email: 'a@mailinator.com', elapsed_ms: 30000 }, userAgent: 'Mozilla/5.0',
  });
  assert.equal(suspicious.verdict, 'review');

  const bot = scoreLead({
    body: { email: 'a@b.com', website: 'x', elapsed_ms: 100 }, userAgent: 'curl/8.0',
  });
  assert.equal(bot.verdict, 'block');
});

// ── Batas lead per IP ────────────────────────────────────────────────────────

test('tooManyLeadsFromIp mendeteksi IP yang membanjiri', () => {
  const now = new Date().toISOString();
  const leads = [
    { ip: '1.2.3.4', created_at: now },
    { ip: '1.2.3.4', created_at: now },
    { ip: '1.2.3.4', created_at: now },
    { ip: '5.6.7.8', created_at: now },
  ];
  assert.equal(tooManyLeadsFromIp(leads, '1.2.3.4', 3600_000, 3), true, '3 lead = sudah batas');
  assert.equal(tooManyLeadsFromIp(leads, '5.6.7.8', 3600_000, 3), false, '1 lead masih aman');
  assert.equal(tooManyLeadsFromIp(leads, '', 3600_000, 3), false, 'IP kosong tidak diblokir');
});

test('tooManyLeadsFromIp mengabaikan lead lama di luar jendela', () => {
  const old = new Date(Date.now() - 7200_000).toISOString(); // 2 jam lalu
  const leads = [
    { ip: '1.2.3.4', created_at: old },
    { ip: '1.2.3.4', created_at: old },
    { ip: '1.2.3.4', created_at: old },
  ];
  assert.equal(tooManyLeadsFromIp(leads, '1.2.3.4', 3600_000, 3), false, 'lead di luar jendela tidak dihitung');
});
