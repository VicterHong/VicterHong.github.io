/**
 * Uptime monitor portofolio — PRD §8 "Ketersediaan: Uptime 99% untuk landing".
 *
 * Memeriksa tiga titik setiap 5 menit (via cron):
 *   1. Landing/Pages   — harus 200 dan mengandung penanda halaman
 *   2. Worker health   — /health harus ok:true
 *   3. Backend (tunnel) — /api/health harus ok:true
 *
 * Kenapa lewat Worker/tunnel, bukan langsung ke 127.0.0.1:8788? Karena yang
 * ingin diketahui adalah "apakah pengunjung bisa mengakses", bukan "apakah
 * proses hidup". Tunnel bisa mati sementara prosesnya hidup — dan sebaliknya.
 *
 * Status disimpan di state file supaya hanya PERUBAHAN yang dinotifikasi —
 * tanpa itu, cron akan mengirim peringatan setiap 5 menit selama gangguan
 * (spam), dan orang berhenti membaca peringatan.
 *
 * Log ringkas ditulis ke uptime.log; ringkasan harian bisa dibaca dari sana.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const STATE_DIR = join(homedir(), '.portfolio-token');
const STATE_FILE = join(STATE_DIR, 'uptime-state.json');
const LOG_FILE = join(STATE_DIR, 'uptime.log');

// Alamat backend dibaca dari backend-url.json di repo — berkas itu diperbarui
// otomatis oleh skrip tunnel setiap kali URL quick tunnel berubah. Hardcode
// alamat tunnel akan membuat monitor ini berbohong setelah tunnel restart.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let backendBase = 'https://translation-davidson-searches-prescription.trycloudflare.com';
try {
  const data = JSON.parse(readFileSync(join(REPO, 'backend-url.json'), 'utf8'));
  if (typeof data?.api_base === 'string' && data.api_base.startsWith('http')) {
    backendBase = data.api_base.replace(/\/$/, '');
  }
} catch { /* pakai fallback */ }

const TARGETS = [
  {
    name: 'landing',
    url: 'https://portfolio-victer.pages.dev/home',
    // Penanda konten: status 200 saja tidak cukup — halaman error dari
    // CDN juga bisa 200. Kita periksa penanda nyata dari halaman.
    expect: (body) => body.includes('Victer') && body.includes('hero-title'),
  },
  {
    name: 'worker',
    url: 'https://portfolio-victer.victerphanjaya.workers.dev/health',
    expect: (body) => { try { return JSON.parse(body).ok === true; } catch { return false; } },
  },
  {
    name: 'backend',
    url: `${backendBase}/api/health`,
    expect: (body) => { try { return JSON.parse(body).ok === true; } catch { return false; } },
  },
];

mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); } catch { /* */ }
}
function log(line) {
  const stamp = new Date().toISOString();
  try { appendFileSync(LOG_FILE, `[${stamp}] ${line}\n`); } catch { /* */ }
}

async function check(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const started = Date.now();
  try {
    const res = await fetch(target.url, {
      signal: controller.signal,
      headers: { 'user-agent': 'portfolio-uptime/1.0' },
      redirect: 'follow',
    });
    const body = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) return { up: false, detail: `HTTP ${res.status}`, ms };
    if (!target.expect(body)) return { up: false, detail: 'konten tidak sesuai', ms };
    return { up: true, detail: `HTTP ${res.status}`, ms };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { up: false, detail: aborted ? 'timeout 12s' : (err?.message ?? 'gagal'), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const prev = loadState();
const next = { ...prev };
const changes = [];
let allUp = true;

for (const target of TARGETS) {
  const result = await check(target);
  const was = prev[target.name]?.up;
  next[target.name] = { up: result.up, at: Date.now(), detail: result.detail, ms: result.ms };

  if (!result.up) allUp = false;
  // Notifikasi hanya saat BERUBAH — mencegah spam peringatan tiap 5 menit.
  if (was !== undefined && was !== result.up) {
    changes.push(`${target.name}: ${was ? 'PULIH' : 'TURUN'} — ${result.detail} (${result.ms}ms)`);
  }
  log(`${result.up ? '✅' : '❌'} ${target.name} ${result.detail} ${result.ms}ms`);
}

saveState(next);

// Ringkasan: satu baris per eksekusi, plus baris perubahan yang mencolok.
if (changes.length) {
  console.log('[uptime] PERUBAHAN STATUS:');
  for (const c of changes) console.log('  ' + c);
}
console.log(`[uptime] ${allUp ? 'semua layanan normal' : 'ADA LAYANAN TURUN'} — ${TARGETS.length} target diperiksa`);

// Kode keluar 1 kalau ada yang turun — supaya cron/monitor bisa mendeteksi
// lewat exit code juga, bukan hanya dari teks.
process.exit(allUp ? 0 : 1);
