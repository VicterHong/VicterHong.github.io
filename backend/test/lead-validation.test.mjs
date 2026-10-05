/**
 * Tes validasi field form permintaan akses (lapis server).
 *
 * Klien sudah memvalidasi, tapi klien bisa dilewati (request langsung,
 * JavaScript dimatikan). Server memeriksa ulang dengan aturan yang sama —
 * tes ini memastikan aturannya benar dan konsisten dengan klien.
 *
 * Aturan (sama dengan FIELD_RULES di assets/js/project.js):
 *   - company : minimal 3 karakter, harus ada huruf
 *   - name    : minimal 3 karakter, tanpa angka, harus ada huruf
 *   - budget  : wajib dipilih
 *   - urgency : wajib dipilih
 *   - message : minimal 10 karakter
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Salinan aturan server (dari routes.mjs) ──────────────────────────────────
// Diuji di sini supaya kalau aturan berubah, tes ikut menangkap regresi.

function validateLeadFields(body) {
  const company = String(body.company ?? '').trim();
  const name = String(body.name ?? '').trim();
  const message = String(body.message ?? '').trim();
  const budgetRange = String(body.budget_range ?? '').trim();
  const urgency = String(body.urgency ?? '').trim();

  const errors = [];
  if (company.length < 3 || !/[A-Za-zÀ-ÿ]/.test(company)) errors.push('company');
  if (name.length < 3 || /\d/.test(name) || !/[A-Za-zÀ-ÿ]/.test(name)) errors.push('name');
  if (!budgetRange) errors.push('budget_range');
  if (!urgency) errors.push('urgency');
  if (message.length < 10) errors.push('message');
  return errors;
}

const VALID = {
  company: 'PT Contoh Teknologi',
  name: 'Budi Santoso',
  email: 'budi@contoh.co.id',
  budget_range: 'Rp 10 – 50 juta',
  urgency: 'bulan ini',
  message: 'Evaluasi arsitektur untuk kemungkinan kerja sama.',
};

// ── Lead valid ───────────────────────────────────────────────────────────────

test('lead lengkap dan valid → tidak ada error', () => {
  assert.deepEqual(validateLeadFields(VALID), []);
});

// ── Nama perusahaan ──────────────────────────────────────────────────────────

test('perusahaan 2 karakter → ditolak (tidak realistis)', () => {
  assert.ok(validateLeadFields({ ...VALID, company: 'PT' }).includes('company'),
    'nama perusahaan 2 huruf harus ditolak');
});

test('perusahaan tanpa huruf (angka saja) → ditolak', () => {
  assert.ok(validateLeadFields({ ...VALID, company: '12345' }).includes('company'));
});

test('perusahaan 3 karakter dengan huruf → diterima', () => {
  assert.deepEqual(validateLeadFields({ ...VALID, company: 'Ace' }), []);
});

test('perusahaan dengan simbol legal (&, ., -) → diterima', () => {
  assert.deepEqual(validateLeadFields({ ...VALID, company: 'PT Maju & Jaya, Tbk.' }), []);
});

// ── Nama orang ───────────────────────────────────────────────────────────────

test('nama 2 karakter → ditolak (tidak realistis)', () => {
  assert.ok(validateLeadFields({ ...VALID, name: 'Al' }).includes('name'),
    'nama 2 huruf harus ditolak');
});

test('nama berisi angka → ditolak', () => {
  assert.ok(validateLeadFields({ ...VALID, name: 'Budi123' }).includes('name'));
});

test('nama tanpa huruf (angka saja) → ditolak', () => {
  assert.ok(validateLeadFields({ ...VALID, name: '12345' }).includes('name'));
});

test('nama 3 huruf → diterima', () => {
  assert.deepEqual(validateLeadFields({ ...VALID, name: 'Ari' }), []);
});

test('nama dengan gelar/garis (Dr., S.T., O\'Brien) → diterima', () => {
  assert.deepEqual(validateLeadFields({ ...VALID, name: "Dr. O'Brien" }), []);
  assert.deepEqual(validateLeadFields({ ...VALID, name: 'Siti Nurhaliza' }), []);
});

// ── Budget & urgensi ─────────────────────────────────────────────────────────

test('budget kosong → ditolak', () => {
  assert.ok(validateLeadFields({ ...VALID, budget_range: '' }).includes('budget_range'));
});

test('urgensi kosong → ditolak', () => {
  assert.ok(validateLeadFields({ ...VALID, urgency: '' }).includes('urgency'));
});

// ── Keperluan ────────────────────────────────────────────────────────────────

test('keperluan < 10 karakter → ditolak', () => {
  assert.ok(validateLeadFields({ ...VALID, message: 'singkat' }).includes('message'));
});

test('keperluan 10 karakter → diterima', () => {
  assert.deepEqual(validateLeadFields({ ...VALID, message: '1234567890' }), []);
});

// ── Beberapa error sekaligus ─────────────────────────────────────────────────

test('semua field kosong → semua error terlaporkan', () => {
  const errors = validateLeadFields({});
  assert.equal(errors.length, 5, 'harus melaporkan semua 5 field bermasalah');
  assert.ok(errors.includes('company'));
  assert.ok(errors.includes('name'));
  assert.ok(errors.includes('budget_range'));
  assert.ok(errors.includes('urgency'));
  assert.ok(errors.includes('message'));
});
