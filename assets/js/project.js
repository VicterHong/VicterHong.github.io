/**
 * Halaman proyek — gerbang token.
 *
 * Flow baru (v2.1):
 *   1. User submit token → POST /api/token/session → server set httpOnly cookie
 *   2. Konten diambil via GET /api/project/:slug/locked (cookie otomatis terkirim)
 *   3. Session persist di cookie, tidak di sessionStorage
 *   4. Logout → POST /api/token/logout → cookie dihapus
 *
 * Konten terkunci TIDAK pernah ada di halaman ini sampai server mengirimkannya.
 */

import {
  clearToken, createSession, destroySession, fetchLockedContent,
  requestAccess, storeToken, storedToken, trackEvent, validateToken, apiBase,
} from './api.js';
import { initAstra } from './astra.js';
import { createNarrativeVideo } from './narrative.js';
import { mountInteractiveLogo } from './logo.js';
import { projects } from './data/projects.js';

/**
 * Petakan kode akses acak → slug internal.
 *
 * URL publik memakai kode acak (mis. /s/e7kz4swubfvg/) supaya nama proyek
 * tidak bocor ke tautan, riwayat peramban, atau log server — pola yang dipakai
 * Notion, Figma, dan Linear. Slug internal tetap dipakai untuk API karena
 * backend menyimpan data dengan kunci itu.
 *
 * Setiap proyek boleh punya BEBERAPA kode (`access_codes`): kode utama yang
 * dipakai sekarang, plus alias lama yang tetap bekerja. Jadi kode bisa
 * dirotasi kapan saja tanpa memutus tautan yang sudah dibagikan.
 */
const CODE_TO_SLUG = Object.fromEntries(
  projects.flatMap((p) => (p.access_codes ?? []).map((c) => [c, p.slug])),
);

/** Kode akses dari URL: /s/<code>/ → '<code>'. */
function currentCode() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('s');
  return i >= 0 && parts[i + 1] ? parts[i + 1] : '';
}

/** Slug internal untuk API. Fallback ke proyek pertama kalau kode tak dikenal. */
function currentProject() {
  const code = currentCode();
  return CODE_TO_SLUG[code] ?? projects.find((p) => p.gated)?.slug ?? 'mina';
}

const PROJECT = currentProject();
const ACCESS_CODE = currentCode();

const $ = (sel) => document.querySelector(sel);

const gate = $('#lockedGate');
const body = $('#lockedBody');
const contentHost = $('#lockedContent');
const form = $('#tokenForm');
const input = $('#tokenInput');
const submit = $('#tokenSubmit');
const status = $('#gateStatus');
const requestSection = $('#request');
const requestForm = $('#requestForm');
const requestStatus = $('#requestStatus');

/** Tulis status di bawah form token. */
function setStatus(message, kind = '') {
  status.textContent = message ?? '';
  status.className = 'gate-status' + (kind ? ` is-${kind}` : '');
}

/** Kunci tombol selama permintaan berjalan. */
function setBusy(busy) {
  submit.disabled = busy;
  submit.textContent = busy ? 'Memeriksa…' : 'Buka';
}

/** Tambahkan watermark dinamis ke konten. */
function addWatermark(container, text) {
  const wm = document.createElement('div');
  wm.className = 'dynamic-watermark';
  wm.textContent = text;
  wm.setAttribute('aria-hidden', 'true');
  container.append(wm);
}

/** Tampilkan konten terkunci yang datang dari server. */
function renderLocked(payload) {
  const content = payload?.content ?? {};
  contentHost.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'locked-content-head';
  const h2 = document.createElement('h2');
  h2.textContent = content.title ?? 'Detail arsitektur';
  head.append(h2);

  // Badge tier
  const tier = payload?.tier ?? 'standard';
  const badge = document.createElement('span');
  badge.className = `tier-badge tier-${tier}`;
  badge.textContent = tier === 'enterprise' ? '🛡️ Enterprise' : '🔒 Gated';
  head.append(badge);

  if (payload.issued_to || payload.company) {
    const who = document.createElement('p');
    who.className = 'locked-issued';
    const name = payload.company ? `${payload.company} (${payload.issued_to})` : payload.issued_to;
    who.textContent = `Akses untuk: ${name}`;
    head.append(who);
  }
  contentHost.append(head);

  if (content.note) {
    const note = document.createElement('p');
    note.className = 'locked-content-note';
    note.textContent = content.note;
    contentHost.append(note);
  }

  for (const section of content.sections ?? []) {
    const wrap = document.createElement('section');
    wrap.className = 'locked-content-section';
    const h3 = document.createElement('h3');
    h3.textContent = section.heading ?? '';
    wrap.append(h3);
    const p = document.createElement('p');
    p.textContent = section.body ?? '';
    wrap.append(p);
    contentHost.append(wrap);
  }

  // Video narasi proyek — dimuat lazy, hanya untuk pengguna dengan akses.
  const videoSlug = { mina: 'mina', spareparts: 'spareparts' }[PROJECT] ?? 'portal';
  contentHost.append(createNarrativeVideo({
    slug: videoSlug,
    title: `${PROJECT.toUpperCase()} — Video Narasi`,
    caption: 'Ringkasan visual arsitektur dan alur kerja sistem.',
  }));

  // Watermark: nama perusahaan + tier
  const wmText = payload.company
    ? `Lisensi: ${payload.company} • ${tier.toUpperCase()}`
    : `Lisensi: ${payload.issued_to || 'Dibatasi'} • ${tier.toUpperCase()}`;
  addWatermark(contentHost, wmText);

  // Sembunyikan pratinjau kabur dan gerbang; tampilkan konten asli.
  body.hidden = true;
  gate.hidden = true;
  contentHost.hidden = false;

  const foot = document.createElement('div');
  foot.className = 'locked-content-foot';
  const lockBtn = document.createElement('button');
  lockBtn.type = 'button';
  lockBtn.className = 'link-btn';
  lockBtn.textContent = 'Kunci kembali / Logout';
  lockBtn.addEventListener('click', async () => {
    await destroySession();
    clearToken();
    contentHost.hidden = true;
    contentHost.innerHTML = '';
    body.hidden = false;
    gate.hidden = false;
    input.value = '';
    setStatus('Sesi ditutup. Token dihapus dari peramban ini.', 'ok');
  });
  foot.append(lockBtn);
  contentHost.append(foot);
}

/** Buka konten: token → session → content. */
async function unlock(token) {
  setBusy(true);
  setStatus('Memeriksa token…');

  // Step 1: Buat session cookie
  const sess = await createSession(token, PROJECT);
  if (!sess.ok) {
    setBusy(false);
    const message = sess.data?.message
      ?? (sess.status === 0
        ? 'Tidak bisa menghubungi server. Coba lagi sebentar lagi.'
        : 'Token tidak dapat digunakan.');
    setStatus(message, 'error');
    return false;
  }

  // Step 2: Ambil konten dengan session cookie
  const result = await fetchLockedContent(PROJECT);
  setBusy(false);

  if (!result.ok) {
    setStatus(result.data?.message ?? 'Konten tidak bisa dibuka.', 'error');
    return false;
  }

  renderLocked(result.data);
  setStatus('');
  return true;
}

// ── Kejadian ──────────────────────────────────────────────────────────────────

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = input.value.trim();
  if (!token) {
    setStatus('Masukkan token terlebih dahulu.', 'error');
    return;
  }

  // Track: token attempt
  trackEvent('token_attempt', PROJECT);

  const ok = await unlock(token);
  if (ok) {
    // Token hanya disimpan di sessionStorage sebagai backup (cookie adalah utama)
    storeToken(token);
    // Track: token success
    trackEvent('token_success', PROJECT);
  } else {
    // Track: token fail
    trackEvent('token_fail', PROJECT);
  }
});

$('#requestAccessBtn').addEventListener('click', () => {
  requestSection.hidden = false;
  requestSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#reqCompany').focus();

  // Catat waktu form mulai terlihat. Dipakai backend untuk menilai apakah
  // pengisian terlalu cepat (ciri bot) — lihat backend/src/spam-guard.mjs.
  const startedAt = $('#reqStartedAt');
  if (startedAt) startedAt.value = String(Date.now());

  // Render widget Turnstile saat form pertama dibuka (lazy). Kalau site key
  // tidak tersedia, slot tetap tersembunyi dan form jalan tanpa Turnstile.
  renderTurnstile();

  // Track: contact sales clicked
  trackEvent('contact_sales', PROJECT);
});

// ── Cloudflare Turnstile ──────────────────────────────────────────────────────
// CAPTCHA tanpa geser. Site key diambil dari backend (/api/config) supaya
// tidak perlu hardcode di HTML — dan supaya menyalakan/mematikan Turnstile
// cukup lewat service.env, tanpa menyentuh frontend.
//
// Widget dirender "explicit" (bukan otomatis) supaya tidak membebani halaman
// yang belum tentu membuka form.

let turnstileWidgetId = null;
let turnstileConfig = null;

/** Ambil konfigurasi Turnstile dari backend (sekali saja). */
async function loadTurnstileConfig() {
  if (turnstileConfig !== null) return turnstileConfig;
  try {
    const base = await apiBase();
    const res = await fetch(`${base}/api/config`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    turnstileConfig = data?.turnstile ?? { enabled: false };
  } catch {
    // Backend tidak terjangkau: anggap Turnstile nonaktif. Form tetap bisa
    // dikirim — server tetap menjalankan penapis lapis lain.
    turnstileConfig = { enabled: false };
  }
  return turnstileConfig;
}

/** Render widget Turnstile ke slot, kalau aktif dan library sudah dimuat. */
async function renderTurnstile() {
  const slot = $('#turnstileSlot');
  if (!slot || turnstileWidgetId !== null) return;

  const cfg = await loadTurnstileConfig();
  if (!cfg.enabled || !cfg.site_key) return;

  // Library dimuat async; tunggu sebentar kalau belum siap.
  const turnstile = window.turnstile;
  if (!turnstile?.render) return;

  slot.hidden = false;
  turnstileWidgetId = turnstile.render(slot, {
    sitekey: cfg.site_key,
    theme: 'dark',
    action: 'lead_form',
    // Kalau token kedaluwarsa (pengunjung lama mengisi), perbarui otomatis
    // supaya tidak perlu muat ulang halaman.
    'refresh-expired': 'auto',
  });
}

$('#requestCancel').addEventListener('click', () => {
  requestSection.hidden = true;
  requestStatus.textContent = '';
});

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(requestForm).entries());
  const email = String(data.email ?? '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    requestStatus.textContent = 'Alamat email tidak valid.';
    requestStatus.className = 'request-status is-error';
    return;
  }

  // Hitung berapa lama form diisi. Backend memakai angka ini untuk menilai
  // apakah pengisian terlalu cepat (ciri bot). Dikirim sebagai elapsed_ms.
  const startedAt = Number($('#reqStartedAt')?.value ?? 0);
  const elapsedMs = startedAt > 0 ? Date.now() - startedAt : null;

  // Token Turnstile (kalau widget aktif). Dikirim sebagai
  // cf-turnstile-response — nama field yang diharapkan Cloudflare.
  const turnstileToken = (turnstileWidgetId !== null && window.turnstile?.getResponse)
    ? (window.turnstile.getResponse(turnstileWidgetId) ?? '')
    : '';

  const button = $('#requestSubmit');
  button.disabled = true;
  button.textContent = 'Mengirim…';
  requestStatus.textContent = '';

  const result = await requestAccess({
    company: data.company ?? '',
    name: data.name ?? '',
    email,
    // Field honeypot: manusia tidak melihatnya, jadi selalu kosong.
    // Bot yang membaca HTML akan mengisinya — backend menolak lead seperti itu.
    website: data.website ?? '',
    elapsed_ms: elapsedMs,
    'cf-turnstile-response': turnstileToken,
    role: data.role ?? '',
    project: PROJECT,
    budget_range: data.budget_range ?? '',
    urgency: data.urgency ?? '',
    message: data.message ?? '',
  });

  button.disabled = false;
  button.textContent = 'Kirim permintaan';

  if (result.ok) {
    requestForm.reset();
    requestStatus.textContent = 'Permintaan terkirim. Sales akan menghubungi Anda lewat email.';
    requestStatus.className = 'request-status is-ok';
    // Track: lead submitted
    trackEvent('lead_submit', PROJECT, { company: data.company, email });
  } else {
    requestStatus.textContent = result.data?.message ?? 'Gagal mengirim permintaan. Coba lagi.';
    requestStatus.className = 'request-status is-error';
  }
});

// ── Saat halaman dibuka ───────────────────────────────────────────────────────

$('#year').textContent = String(new Date().getFullYear());

// Track: page view
trackEvent('page_view', PROJECT);

// Track: modal open (gate visible)
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting && !entry.target.hidden) {
      trackEvent('modal_open', PROJECT);
      observer.disconnect();
    }
  }
});
observer.observe(gate);

// Coba ambil konten dengan session cookie yang mungkin sudah ada
(async () => {
  const result = await fetchLockedContent(PROJECT);
  if (result.ok) {
    renderLocked(result.data);
  }
  // Kalau tidak ada session, tampilkan gate (default state)

  // Micro-interactions Astra — setelah konten statis siap.
  initAstra();

  // Logo interaktif — simbol coding yang bergerak saat hover/klik.
  mountInteractiveLogo();
})();
