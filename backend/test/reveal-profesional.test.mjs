import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('konten tetap terbaca bila inisialisasi reveal atau observer gagal', () => {
  const css = readFileSync(new URL('../../assets/css/cinematic.css', import.meta.url), 'utf8');
  const base = css.match(/\[data-cine-clip\]\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(base, /opacity:\s*1\s*;/);
  assert.match(base, /clip-path:\s*none\s*;/);
});

test('observer reveal tidak memasang keadaan tersembunyi sebelum siap', async () => {
  const { initClipReveal } = await import('../../assets/js/cinematic.js');
  const added = new Set();
  globalThis.window = { matchMedia: () => ({ matches: false }), innerHeight: 800 };
  globalThis.document = { querySelectorAll: () => [{ classList: { add: (s) => added.add(s), contains: (s) => added.has(s) }, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) }] };
  try {
    initClipReveal();
    assert.ok(added.has('cine-clip-in'));
  } finally { delete globalThis.window; delete globalThis.document; }
});
