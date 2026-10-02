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
  requestAccess, storeToken, storedToken, validateToken,
} from '../../src/api.js';

/**
 * Slug proyek dibaca dari URL: /projects/<slug>/index.html
 */
function currentProject() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const i = parts.lastIndexOf('projects');
  return i >= 0 && parts[i + 1] ? parts[i + 1] : 'mina';
}

const PROJECT = currentProject();

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
  const ok = await unlock(token);
  if (ok) {
    // Token hanya disimpan di sessionStorage sebagai backup (cookie adalah utama)
    storeToken(token);
  }
});

$('#requestAccessBtn').addEventListener('click', () => {
  requestSection.hidden = false;
  requestSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#reqCompany').focus();
});

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

  const button = $('#requestSubmit');
  button.disabled = true;
  button.textContent = 'Mengirim…';
  requestStatus.textContent = '';

  const result = await requestAccess({
    company: data.company ?? '',
    name: data.name ?? '',
    email,
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
  } else {
    requestStatus.textContent = result.data?.message ?? 'Gagal mengirim permintaan. Coba lagi.';
    requestStatus.className = 'request-status is-error';
  }
});

// ── Saat halaman dibuka ───────────────────────────────────────────────────────

$('#year').textContent = String(new Date().getFullYear());

// Coba ambil konten dengan session cookie yang mungkin sudah ada
(async () => {
  const result = await fetchLockedContent(PROJECT);
  if (result.ok) {
    renderLocked(result.data);
  }
  // Kalau tidak ada session, tampilkan gate (default state)
})();
