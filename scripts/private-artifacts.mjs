/** Bounded artifact check; not a substitute for a full content classification review. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export function auditPrivateArtifacts(root) {
  const violations = [];
  const forbiddenFiles = new Set(['presentation.json', 'project-details.seed.json', 'preview-email.html', 'demo-how-it-works.html', 'demo-animasi-blackray.html']);
  // ── PENANDA HARUS UNIK PADA KONTEN PRIVAT ─────────────────────────────────
  // Versi pertama memakai "Token bearer + HMAC-SHA256 di setiap permintaan",
  // yang juga merupakan kalimat RINGKASAN PUBLIK di s/halaman proyek (sudah
  // ada sejak baseline). Akibatnya preflight menuduh kebocoran padahal yang
  // terdeteksi adalah teks publik yang sengaja ditampilkan. Penanda sekarang
  // memakai frasa yang HANYA ada di detail privat (seed), sehingga positif
  // palsu tidak lagi menutupi kebocoran sungguhan.
  const markers = [
    '5.042',
    'Tidak ada eksekusi shell bebas',
    'const contohParts = [',
    'export const metrikProyek = {',
  ];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const rel = relative(root, path);
      if (forbiddenFiles.has(entry.name) || /\.(?:db|sqlite|env|map)$/.test(entry.name)) violations.push(`${rel}: private file`);
      if (!/\.(?:js|html|json)$/.test(entry.name)) continue;
      const text = readFileSync(path, 'utf8');
      if (markers.some(marker => text.includes(marker))) violations.push(`${rel}: protected evidence payload`);
    }
  }
  walk(root);
  return violations;
}
